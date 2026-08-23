/**
 * `MockExtractionProvider` -- ChatGPT-Schicht 3 "AI Extraction" (Phase 12
 * AP1, siehe PHASE_12_IMPLEMENTATION_PLAN.md Abschnitt 1 nach Punkt 8 +
 * Abschnitt 2). Der EINZIGE in AP1-AP4 verwendete `AiExtractionProvider` --
 * eine echte externe KI-Anbindung ist explizit AP5 und erfordert ein
 * separates GO (siehe PHASE_12_IMPLEMENTATION_PLAN.md Abschnitt 4).
 *
 * WICHTIG: Dies ist KEIN Sprachmodell und simuliert auch keines. Es ist ein
 * bewusst einfacher, rein deterministischer Mustervergleich (Substring-/
 * Regex-Suche), dessen einziger Zweck die ChatGPT-Anforderung ist: "Gleicher
 * Input + gleicher sichtbarer Fragenkatalog -> exakt gleiche strukturierte
 * Kandidaten." Das macht die gesamte Pipeline (Freitext -> Context ->
 * Extraction Contract -> Validation -> Suggestions) unabhaengig vom
 * spaeteren echten Provider testbar, OHNE bereits Kosten, Providerverhalten
 * oder Halluzinationen in den Tests zu haben (ChatGPT, woertlich). AP5 tauscht
 * spaeter lediglich die Provider-Implementierung aus (siehe `contract.ts`),
 * nicht die Architektur.
 *
 * Heuristik (bewusst einfach, keine echte Sprachverarbeitung):
 * - BOOLEAN: mindestens ein signifikantes Wort (>= 4 Zeichen) aus dem
 *   Fragetext kommt im Freitext vor -> `booleanValue: true`. Es gibt keine
 *   Negationserkennung (kein "false"-Vorschlag) -- Unsicherheit bedeutet hier
 *   wie ueberall: kein Kandidat statt Ratewahl.
 * - SINGLE_CHOICE/MULTIPLE_CHOICE: `AnswerOption.label` als Substring im
 *   Freitext gesucht (case-insensitive). SINGLE_CHOICE nur bei GENAU EINEM
 *   Treffer (mehrere Treffer = Mehrdeutigkeit = kein Kandidat, konsistent mit
 *   ChatGPT-Entscheidung 5); MULTIPLE_CHOICE bei mindestens einem Treffer
 *   (Bereichsgrenzen prueft ohnehin `extraction-validator.ts`).
 * - INTEGER/DECIMAL/DATE: nur wenn GENAU EINE Frage dieses Typs im
 *   sichtbaren Katalog steht UND GENAU EIN passender Zahlen-/Datumswert im
 *   Freitext gefunden wird (sonst nicht eindeutig zuordenbar -> kein
 *   Kandidat). Datum wird zuerst erkannt und aus dem Text entfernt, danach
 *   Dezimalzahlen, danach Ganzzahlen -- verhindert, dass z. B. "30.09.2026"
 *   faelschlich auch als Dezimalzahl "30.09" erkannt wird.
 */

import type { AiExtractionProvider, AiExtractionRequest } from "../contract";
import type { AiExtractionCandidate, AiExtractionVisibleQuestion } from "../types";

const ISO_DATE_REGEX = /\b\d{4}-\d{2}-\d{2}\b/g;
const GERMAN_DATE_REGEX = /\b\d{2}\.\d{2}\.\d{4}\b/g;
const DECIMAL_REGEX = /\b\d+[.,]\d+\b/g;
const INTEGER_REGEX = /\b\d+\b/g;

function uniqueMatches(text: string, regex: RegExp): string[] {
  return [...new Set(text.match(regex) ?? [])];
}

function stripAll(text: string, matches: string[]): string {
  let result = text;
  for (const match of matches) {
    result = result.split(match).join(" ");
  }
  return result;
}

function germanDateToIso(value: string): string {
  const [day, month, year] = value.split(".");
  return `${year}-${month}-${day}`;
}

function extractIsoDates(freeText: string): { dates: string[]; remainder: string } {
  const isoMatches = uniqueMatches(freeText, ISO_DATE_REGEX);
  const germanMatches = uniqueMatches(freeText, GERMAN_DATE_REGEX);
  const remainder = stripAll(stripAll(freeText, isoMatches), germanMatches);
  const dates = [...new Set([...isoMatches, ...germanMatches.map(germanDateToIso)])];
  return { dates, remainder };
}

function extractDecimals(remainderAfterDates: string): { decimals: string[]; remainder: string } {
  const matches = uniqueMatches(remainderAfterDates, DECIMAL_REGEX);
  const remainder = stripAll(remainderAfterDates, matches);
  const decimals = [...new Set(matches.map((m) => m.replace(",", ".")))];
  return { decimals, remainder };
}

function extractIntegers(remainderAfterDecimals: string): number[] {
  const matches = uniqueMatches(remainderAfterDecimals, INTEGER_REGEX);
  return [...new Set(matches.map(Number))];
}

function findMatchingOptionKeys(
  question: AiExtractionVisibleQuestion,
  normalizedText: string,
): string[] {
  return question.answerOptions
    .filter((o) => o.label.trim().length > 0 && normalizedText.includes(o.label.toLowerCase()))
    .map((o) => o.key);
}

function looksLikeBooleanMatch(
  question: AiExtractionVisibleQuestion,
  normalizedText: string,
): boolean {
  const significantWords = question.label
    .toLowerCase()
    .split(/[^a-z0-9äöüß]+/)
    .filter((w) => w.length >= 4);
  return significantWords.some((word) => normalizedText.includes(word));
}

/**
 * Reine, deterministische Extraktionsfunktion -- kein DB-Zugriff, keine
 * Seiteneffekte, kein `await` noetig. Als eigenstaendige Funktion exportiert
 * (nicht nur als Klassenmethode), damit sie im Contract-Determinismus-Test
 * direkt zweimal mit identischem Input aufgerufen und das Ergebnis
 * strukturell verglichen werden kann.
 */
export function extractDeterministicCandidates(
  freeText: string,
  visibleQuestions: AiExtractionVisibleQuestion[],
): AiExtractionCandidate[] {
  const normalizedText = freeText.toLowerCase();
  const candidates: AiExtractionCandidate[] = [];

  const { dates, remainder: afterDates } = extractIsoDates(freeText);
  const { decimals, remainder: afterDecimals } = extractDecimals(afterDates);
  const integers = extractIntegers(afterDecimals);

  const dateQuestions = visibleQuestions.filter((q) => q.answerType === "DATE");
  if (dateQuestions.length === 1 && dates.length === 1) {
    candidates.push({
      questionId: dateQuestions[0]!.questionId,
      answerType: "DATE",
      dateValue: dates[0],
    });
  }

  const decimalQuestions = visibleQuestions.filter((q) => q.answerType === "DECIMAL");
  if (decimalQuestions.length === 1 && decimals.length === 1) {
    candidates.push({
      questionId: decimalQuestions[0]!.questionId,
      answerType: "DECIMAL",
      decimalValue: decimals[0],
    });
  }

  const integerQuestions = visibleQuestions.filter((q) => q.answerType === "INTEGER");
  if (integerQuestions.length === 1 && integers.length === 1) {
    candidates.push({
      questionId: integerQuestions[0]!.questionId,
      answerType: "INTEGER",
      integerValue: integers[0],
    });
  }

  for (const question of visibleQuestions) {
    if (question.answerType === "BOOLEAN") {
      if (looksLikeBooleanMatch(question, normalizedText)) {
        candidates.push({
          questionId: question.questionId,
          answerType: "BOOLEAN",
          booleanValue: true,
        });
      }
      continue;
    }

    if (question.answerType === "SINGLE_CHOICE") {
      const matches = findMatchingOptionKeys(question, normalizedText);
      if (matches.length === 1) {
        candidates.push({
          questionId: question.questionId,
          answerType: "SINGLE_CHOICE",
          choiceValues: matches,
        });
      }
      continue;
    }

    if (question.answerType === "MULTIPLE_CHOICE") {
      const matches = findMatchingOptionKeys(question, normalizedText);
      if (matches.length >= 1) {
        candidates.push({
          questionId: question.questionId,
          answerType: "MULTIPLE_CHOICE",
          choiceValues: matches,
        });
      }
    }
  }

  return candidates;
}

export class MockExtractionProvider implements AiExtractionProvider {
  async extract(request: AiExtractionRequest): Promise<AiExtractionCandidate[]> {
    return Promise.resolve(
      extractDeterministicCandidates(request.freeText, request.visibleQuestions),
    );
  }
}
