/**
 * AP5c-PoC-Runner (Phase 12 AP5, echter externer KI-Provider, isolierter
 * PoC, ChatGPT-GO 2026-09-01). Fuehrt die synthetischen Testfaelle aus
 * `test-cases.ts` gegen den ECHTEN `AnthropicExtractionProvider` aus und
 * gibt einen Testreport aus.
 *
 * NIEMALS Teil der normalen Push-/PR-CI (`npm run test:integration`) --
 * ausschliesslich manuell via `npm run test:ai-poc` (lokal, eigener
 * `ANTHROPIC_API_KEY`) oder ueber den separaten GitHub-Actions-Workflow
 * `.github/workflows/ai-extraction-poc.yml` (ausschliesslich
 * `workflow_dispatch`), um keinen unkontrollierten, wiederkehrenden
 * API-Spend zu erzeugen (ChatGPT-Vorgabe, 2026-09-01).
 *
 * Kein Datenbankzugriff: die Testfaelle verwenden handgeschriebene
 * `AiExtractionVisibleQuestion[]`-Fixtures statt der DB-gestuetzten
 * `buildVisibleQuestionContext()` -- der PoC braucht daher weder Postgres
 * noch Prisma (ChatGPT-Vorgabe "kein produktiver Datenbankzugriff").
 *
 * Sicherheitsgelaender (ChatGPT verbatim, 2026-09-01), hier umgesetzt:
 * - ANTHROPIC_API_KEY ausschliesslich aus der Umgebung (GitHub Secret bzw.
 *   lokale Shell-Variable) -- niemals hartkodiert.
 * - Nur synthetische Testdaten (`test-cases.ts`).
 * - Kein produktiver Datenbankzugriff (siehe oben).
 * - Klar begrenzte Anzahl API-Requests (`MAX_ALLOWED_POC_CASES`-Pruefung
 *   plus die feste, im Code sichtbare Fallliste).
 * - Keine Retry-Kaskaden (der Provider selbst retried nie, siehe
 *   `anthropic-provider.ts`-Modulkommentar) -- ein fehlgeschlagener Fall
 *   wird einmal versucht und als Fehler im Report vermerkt.
 * - Timeout pro Request (im Provider selbst, 20s).
 * - Kosten-/Tokenverbrauch je Testlauf erfassen (siehe `formatReport()`).
 * - Ergebnis am Ende als Testreport ausgegeben (Konsole + Markdown-Datei
 *   `ai-extraction-poc-report.md` fuer den GitHub-Actions-Artifact-Upload).
 * - Bei fehlendem Secret sauber abbrechen (kein Fallback auf einen
 *   anderen Provider).
 */

import { writeFileSync } from "node:fs";
import {
  AnthropicExtractionProvider,
  AnthropicProviderConfigError,
  ANTHROPIC_MODEL_ID,
  ANTHROPIC_PROVIDER_VERSION,
} from "../../src/server/ai-extraction/providers/anthropic-provider";
import { validateExtractionCandidates } from "../../src/server/ai-extraction/extraction-validator";
import type { AiExtractionCandidate } from "../../src/server/ai-extraction/types";
import { AI_EXTRACTION_POC_CASES, MAX_ALLOWED_POC_CASES } from "./test-cases";
import type { AiExtractionPocCase } from "./test-cases";

// Haiku-4.5-Preise (Stand 2026-09-01, siehe project_ki_cross_ap5c_klaerung.md), pro 1M Tokens.
const INPUT_PRICE_PER_MILLION_USD = 1;
const OUTPUT_PRICE_PER_MILLION_USD = 5;
const DELAY_BETWEEN_REQUESTS_MS = 350;

interface CaseRunResult {
  caseId: string;
  description: string;
  freeText: string;
  observationalOnly: boolean;
  status: "pass" | "fail" | "error" | "observed";
  acceptedQuestionIds: string[];
  acceptedCandidates: AiExtractionCandidate[];
  rejectedCount: number;
  errorMessage?: string;
  usage: { inputTokens: number; outputTokens: number };
  latencyMs: number;
  stopReason?: string;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runOneCase(
  provider: AnthropicExtractionProvider,
  testCase: AiExtractionPocCase,
  labelSuffix = "",
): Promise<CaseRunResult> {
  const base: Omit<
    CaseRunResult,
    | "status"
    | "acceptedQuestionIds"
    | "acceptedCandidates"
    | "rejectedCount"
    | "usage"
    | "latencyMs"
  > = {
    caseId: testCase.id + labelSuffix,
    description: testCase.description,
    freeText: testCase.freeText,
    observationalOnly: testCase.observationalOnly ?? false,
  };

  try {
    const result = await provider.extractWithUsage({
      freeText: testCase.freeText,
      visibleQuestions: testCase.visibleQuestions,
    });
    const { accepted, rejected } = validateExtractionCandidates(
      testCase.visibleQuestions,
      result.candidates,
    );
    const acceptedQuestionIds = accepted.map((c) => c.questionId);

    if (base.observationalOnly) {
      return {
        ...base,
        status: "observed",
        acceptedQuestionIds,
        acceptedCandidates: accepted,
        rejectedCount: rejected.length,
        usage: result.usage,
        latencyMs: result.latencyMs,
        stopReason: result.stopReason,
      };
    }

    const missingExpected = testCase.expectedPresent.filter(
      (id) => !acceptedQuestionIds.includes(id),
    );
    const unexpectedPresent = testCase.expectedAbsent.filter((id) =>
      acceptedQuestionIds.includes(id),
    );
    const booleanMismatches = (testCase.expectedBooleanValues ?? []).filter((expected) => {
      const candidate = accepted.find((c) => c.questionId === expected.questionId);
      return candidate?.booleanValue !== expected.value;
    });
    const passed =
      missingExpected.length === 0 &&
      unexpectedPresent.length === 0 &&
      booleanMismatches.length === 0;

    const messageParts: string[] = [];
    if (missingExpected.length > 0) {
      messageParts.push(`Fehlend erwartet: [${missingExpected.join(", ")}]`);
    }
    if (unexpectedPresent.length > 0) {
      messageParts.push(`Unerwartet vorhanden: [${unexpectedPresent.join(", ")}]`);
    }
    if (booleanMismatches.length > 0) {
      const details = booleanMismatches
        .map((m) => {
          const candidate = accepted.find((c) => c.questionId === m.questionId);
          return `${m.questionId}: erwartet=${m.value}, erhalten=${candidate?.booleanValue ?? "(kein Kandidat)"}`;
        })
        .join("; ");
      messageParts.push(`Boolean-Wertabweichung: ${details}`);
    }

    return {
      ...base,
      status: passed ? "pass" : "fail",
      acceptedQuestionIds,
      acceptedCandidates: accepted,
      rejectedCount: rejected.length,
      usage: result.usage,
      latencyMs: result.latencyMs,
      stopReason: result.stopReason,
      errorMessage: passed ? undefined : messageParts.join(" | "),
    };
  } catch (error) {
    return {
      ...base,
      status: "error",
      acceptedQuestionIds: [],
      acceptedCandidates: [],
      rejectedCount: 0,
      usage: { inputTokens: 0, outputTokens: 0 },
      latencyMs: 0,
      errorMessage: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
    };
  }
}

function formatCandidateValue(c: AiExtractionCandidate): string {
  if (c.booleanValue !== undefined) return `booleanValue=${c.booleanValue}`;
  if (c.integerValue !== undefined) return `integerValue=${c.integerValue}`;
  if (c.decimalValue !== undefined) return `decimalValue=${c.decimalValue}`;
  if (c.dateValue !== undefined) return `dateValue=${c.dateValue}`;
  if (c.choiceValues !== undefined) return `choiceValues=[${c.choiceValues.join(", ")}]`;
  return "(kein Wertfeld gesetzt)";
}

function formatReport(results: CaseRunResult[]): string {
  const scored = results.filter((r) => !r.observationalOnly);
  const passed = scored.filter((r) => r.status === "pass").length;
  const failed = scored.filter((r) => r.status === "fail" || r.status === "error").length;

  const totalInputTokens = results.reduce((sum, r) => sum + r.usage.inputTokens, 0);
  const totalOutputTokens = results.reduce((sum, r) => sum + r.usage.outputTokens, 0);
  const totalCostUsd =
    (totalInputTokens / 1_000_000) * INPUT_PRICE_PER_MILLION_USD +
    (totalOutputTokens / 1_000_000) * OUTPUT_PRICE_PER_MILLION_USD;
  const totalLatencyMs = results.reduce((sum, r) => sum + r.latencyMs, 0);

  const lines: string[] = [];
  lines.push("# AP5c-PoC-Report: Anthropic-Extraktion (echte API-Calls)");
  lines.push("");
  lines.push(
    `Modell: \`${ANTHROPIC_MODEL_ID}\` (Provider-Version \`${ANTHROPIC_PROVIDER_VERSION}\`)`,
  );
  lines.push(`Zeitpunkt: ${new Date().toISOString()}`);
  lines.push("");
  lines.push(
    `**Ergebnis (harte Kriterien): ${passed}/${scored.length} bestanden, ${failed} fehlgeschlagen.**`,
  );
  lines.push("");
  lines.push(`Gesamt-Tokenverbrauch: ${totalInputTokens} Input / ${totalOutputTokens} Output`);
  lines.push(`Geschaetzte Gesamtkosten: $${totalCostUsd.toFixed(6)}`);
  lines.push(`Gesamtlatenz aller Requests: ${totalLatencyMs}ms`);
  lines.push("");
  lines.push("## Einzelergebnisse");
  lines.push("");
  for (const r of results) {
    const statusLabel = {
      pass: "✅ PASS",
      fail: "❌ FAIL",
      error: "💥 ERROR",
      observed: "ℹ️ BEOBACHTET",
    }[r.status];
    lines.push(`### ${r.caseId} -- ${statusLabel}`);
    lines.push(r.description);
    lines.push(`- Freitext (synthetisch): "${r.freeText}"`);
    lines.push(`- Akzeptierte questionIds: [${r.acceptedQuestionIds.join(", ") || "-"}]`);
    lines.push(`- Verworfene Kandidaten (extraction-validator.ts): ${r.rejectedCount}`);
    if (r.acceptedCandidates.length > 0) {
      const values = r.acceptedCandidates
        .map((c) => `${c.questionId}(${formatCandidateValue(c)})`)
        .join(", ");
      lines.push(`- Kandidatenwerte: ${values}`);
    }
    lines.push(
      `- stop_reason: ${r.stopReason ?? "-"} | Latenz: ${r.latencyMs}ms | Tokens: ${r.usage.inputTokens} in / ${r.usage.outputTokens} out`,
    );
    if (r.errorMessage) {
      lines.push(`- Hinweis: ${r.errorMessage}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

async function main(): Promise<void> {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error(
      new AnthropicProviderConfigError(
        "ANTHROPIC_API_KEY ist nicht gesetzt. AP5c-PoC wird sauber abgebrochen -- " +
          "kein automatischer Wechsel auf einen anderen Provider.",
      ).message,
    );
    process.exit(1);
  }

  if (AI_EXTRACTION_POC_CASES.length > MAX_ALLOWED_POC_CASES) {
    console.error(
      `Abgebrochen: ${AI_EXTRACTION_POC_CASES.length} Testfaelle definiert, ` +
        `erlaubtes Maximum ist ${MAX_ALLOWED_POC_CASES} (bewusste Kostenobergrenze, Review noetig).`,
    );
    process.exit(1);
  }

  const provider = new AnthropicExtractionProvider();
  const results: CaseRunResult[] = [];

  for (const testCase of AI_EXTRACTION_POC_CASES) {
    console.log(`-> Fuehre Fall aus: ${testCase.id}`);
    results.push(await runOneCase(provider, testCase));
    await sleep(DELAY_BETWEEN_REQUESTS_MS);
  }

  // Determinismus-Check (ChatGPT-Pruefliste): denselben eindeutigen Fall
  // zweimal ausfuehren und die akzeptierten questionIds vergleichen. Ein
  // Sprachmodell garantiert KEINE Byte-Identitaet wie
  // `MockExtractionProvider` -- Abweichung wird berichtet, nicht hart als
  // Fehlschlag gewertet.
  const determinismBase = AI_EXTRACTION_POC_CASES.find((c) => c.id === "clear-multi-field");
  if (determinismBase) {
    console.log("-> Fuehre Determinismus-Wiederholung aus: clear-multi-field (2. Durchlauf)");
    await sleep(DELAY_BETWEEN_REQUESTS_MS);
    const repeat = await runOneCase(provider, determinismBase, "-repeat");
    results.push({ ...repeat, observationalOnly: true, status: "observed" });
  }

  const report = formatReport(results);
  console.log("\n" + report);
  writeFileSync("ai-extraction-poc-report.md", report, "utf-8");
  console.log('\nReport geschrieben nach "ai-extraction-poc-report.md".');

  const scored = results.filter((r) => !r.observationalOnly);
  const anyFailed = scored.some((r) => r.status === "fail" || r.status === "error");
  process.exit(anyFailed ? 1 : 0);
}

main().catch((error) => {
  console.error("AP5c-PoC-Runner abgebrochen mit unerwartetem Fehler:", error);
  process.exit(1);
});
