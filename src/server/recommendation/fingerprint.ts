/**
 * Idempotenz-Fingerprint fuer eine Recommendation-Auswertung (siehe
 * PHASE_3B_IMPLEMENTATION_PLAN.md Abschnitt 3.7): SHA-256 ueber eine
 * kanonische JSON-Repraesentation aller Auswertungs-Inputs. Zwei
 * Auswertungen derselben Session mit identischem Fingerprint duerfen
 * dieselbe Recommendation wiederverwenden (Fast-Path-SELECT vor dem
 * Schreiben, siehe service.ts / Recommendation.evaluationFingerprint
 * @@unique([tenantId, consultationSessionId, evaluationFingerprint])).
 *
 * Kanonisches Schema (alphabetische Top-Level-Schluessel):
 * algorithmVersion, answers, commissionModelVersionIds, productInputs,
 * questionnaireVersionId, ruleSetVersionId, sessionAttributes, sessionId,
 * tenantId.
 *
 * Kanonisierungsregeln:
 * - Objektschluessel werden rekursiv alphabetisch sortiert
 *   (canonicalJsonStringify), damit die Serialisierung unabhaengig von der
 *   Einfuegereihenfolge der JS-Engine deterministisch ist.
 * - Arrays (answers, productInputs) werden VOR der Serialisierung explizit
 *   sortiert (answers nach answerId, productInputs nach productVersionId) -
 *   canonicalJsonStringify aendert die Array-Reihenfolge selbst NICHT.
 * - Antwortwerte werden gemaess QuestionVersion.answerType kanonisiert
 *   (canonicalizeAnswerValue) - bewusst NICHT ueber die attribute-registry,
 *   da Antworten keine Attribute sind.
 * - Produkt-/Session-Attributwerte werden ueber attribute-registry.parse()
 *   kanonisiert (z.B. "true"/"TRUE" -> derselbe Fingerprint); ein fuer ein
 *   Produkt nicht gesetztes Attribut wird als JSON `null` aufgenommen
 *   (NICHT weggelassen), damit ein spaeter ergaenztes TariffAttribute den
 *   Fingerprint aendert.
 * - commissionModelVersionIds erfasst die zum Auswertungszeitpunkt tenant-
 *   weit potenziell relevanten, gueltigen CommissionModelVersion-IDs, damit
 *   eine spaetere Provisionsaenderung (neue ACTIVE Version) den Fingerprint
 *   aendert und keine veraltete Recommendation wiederverwendet wird.
 */

import { createHash } from "node:crypto";
import { parseDecimalToScaledBigInt } from "../questionnaire/decimal";
import type { AnswerType } from "../questionnaire/types";
import { PRODUCT_ATTRIBUTE_DEFINITIONS, SESSION_ATTRIBUTE_DEFINITIONS } from "./attribute-registry";

export interface FingerprintAnswerInput {
  answerId: string;
  answerType: AnswerType;
  booleanValue?: boolean | null;
  integerValue?: number | null;
  decimalValue?: string | null;
  dateValue?: string | null;
  choiceValues?: string[];
}

export interface FingerprintProductInput {
  productVersionId: string;
  /** Rohwerte (TariffAttribute.attributeValue), keyed nach attributeKey. */
  attributes: ReadonlyMap<string, string>;
}

export interface FingerprintInput {
  algorithmVersion: number;
  tenantId: string;
  sessionId: string;
  questionnaireVersionId: string;
  ruleSetVersionId: string;
  answers: FingerprintAnswerInput[];
  productInputs: FingerprintProductInput[];
  /** Rohwerte, keyed nach attributeKey. */
  sessionAttributes: ReadonlyMap<string, string>;
  /** Tenant-weit zum Auswertungszeitpunkt gueltige CommissionModelVersion-IDs. */
  commissionModelVersionIds: string[];
}

/**
 * Normalisiert einen Dezimalstring ueber den skalierten BigInt
 * (SCALE=4, gekoppelt an questionnaire/decimal.ts) zurueck in einen festen
 * 4-Nachkommastellen-String, damit z.B. "12.5" und "12.5000" denselben
 * Fingerprint ergeben.
 */
function normalizeDecimalString(value: string): string {
  const scaled = parseDecimalToScaledBigInt(value);
  const negative = scaled < 0n;
  const abs = negative ? -scaled : scaled;
  const digits = abs.toString().padStart(5, "0");
  const intPart = digits.slice(0, -4);
  const fracPart = digits.slice(-4);
  return `${negative ? "-" : ""}${intPart}.${fracPart}`;
}

/** Kanonisiert einen Antwortwert gemaess seinem AnswerType. SHORT_TEXT ist fuer Fingerprints/Conditions verboten. */
export function canonicalizeAnswerValue(answer: FingerprintAnswerInput): unknown {
  switch (answer.answerType) {
    case "BOOLEAN":
      return answer.booleanValue === true;
    case "INTEGER":
      return answer.integerValue == null ? null : String(answer.integerValue);
    case "DECIMAL":
      return answer.decimalValue ? normalizeDecimalString(answer.decimalValue) : null;
    case "SINGLE_CHOICE":
      return (answer.choiceValues ?? [])[0] ?? null;
    case "MULTIPLE_CHOICE":
      return [...(answer.choiceValues ?? [])].sort();
    case "DATE":
      return answer.dateValue ?? null;
    case "SHORT_TEXT":
      throw new Error(
        `Antwort "${answer.answerId}": SHORT_TEXT darf nicht in den Fingerprint einfliessen (Freitext ist fuer Conditions/Fingerprints ausgeschlossen).`,
      );
    default: {
      const exhaustive: never = answer.answerType;
      throw new Error(`Unbekannter AnswerType: ${String(exhaustive)}`);
    }
  }
}

function canonicalizeProductAttributes(
  attributes: ReadonlyMap<string, string>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const key of Object.keys(PRODUCT_ATTRIBUTE_DEFINITIONS)) {
    const raw = attributes.get(key);
    result[key] = raw === undefined ? null : PRODUCT_ATTRIBUTE_DEFINITIONS[key]!.parse(raw);
  }
  return result;
}

function canonicalizeSessionAttributes(
  attributes: ReadonlyMap<string, string>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const key of Object.keys(SESSION_ATTRIBUTE_DEFINITIONS)) {
    const raw = attributes.get(key);
    result[key] = raw === undefined ? null : SESSION_ATTRIBUTE_DEFINITIONS[key]!.parse(raw);
  }
  return result;
}

/** Baut das kanonische Fingerprint-Objekt (vor der JSON-Serialisierung), siehe Modulkommentar fuer das Schema. */
export function buildFingerprintObject(input: FingerprintInput): Record<string, unknown> {
  const answers = [...input.answers]
    .sort((a, b) => a.answerId.localeCompare(b.answerId))
    .map((answer) => ({ answerId: answer.answerId, value: canonicalizeAnswerValue(answer) }));

  const productInputs = [...input.productInputs]
    .sort((a, b) => a.productVersionId.localeCompare(b.productVersionId))
    .map((product) => ({
      productVersionId: product.productVersionId,
      attributes: canonicalizeProductAttributes(product.attributes),
    }));

  return {
    algorithmVersion: input.algorithmVersion,
    answers,
    commissionModelVersionIds: [...input.commissionModelVersionIds].sort(),
    productInputs,
    questionnaireVersionId: input.questionnaireVersionId,
    ruleSetVersionId: input.ruleSetVersionId,
    sessionAttributes: canonicalizeSessionAttributes(input.sessionAttributes),
    sessionId: input.sessionId,
    tenantId: input.tenantId,
  };
}

/**
 * Serialisiert einen JSON-kompatiblen Wert deterministisch: Objektschluessel
 * werden rekursiv alphabetisch sortiert; Arrays behalten ihre Reihenfolge
 * (muss vom Aufrufer bereits definiert sein, siehe buildFingerprintObject).
 */
export function canonicalJsonStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value ?? null);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJsonStringify(item)).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  const entries = keys.map(
    (key) => `${JSON.stringify(key)}:${canonicalJsonStringify(record[key])}`,
  );
  return `{${entries.join(",")}}`;
}

/** Berechnet den SHA-256-Fingerprint (64 Hex-Zeichen, siehe Recommendation.evaluationFingerprint). */
export function computeEvaluationFingerprint(input: FingerprintInput): string {
  const canonicalObject = buildFingerprintObject(input);
  const json = canonicalJsonStringify(canonicalObject);
  return createHash("sha256").update(json, "utf8").digest("hex");
}
