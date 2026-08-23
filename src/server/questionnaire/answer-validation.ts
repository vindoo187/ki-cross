/**
 * Reine Antwortvalidierung (kein DB-Zugriff): prueft eine Roheingabe gegen
 * die Validierungsregeln ihres `QuestionVersion.answerType` (siehe Kommentar
 * an `QuestionVersion` in prisma/schema.prisma und
 * docs/QUESTION_ENGINE.md, Abschnitt "Validierungsregeln").
 *
 * Sammelt ALLE gefundenen Verstoesse statt beim ersten abzubrechen, damit
 * `InvalidAnswerError.issues` eine vollstaendige Fehlerliste liefert.
 */

import { compareDecimalStrings, isValidDecimalString } from "./decimal";
import { InvalidAnswerError } from "./errors";
import type { AnswerValueInput, QuestionVersionConstraints } from "./types";

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})?)?$/;

function collectPopulatedFields(input: AnswerValueInput): string[] {
  const fields: string[] = [];
  if (input.integerValue !== undefined && input.integerValue !== null) fields.push("integerValue");
  if (input.decimalValue !== undefined && input.decimalValue !== null) fields.push("decimalValue");
  if (input.booleanValue !== undefined && input.booleanValue !== null) fields.push("booleanValue");
  if (input.dateValue !== undefined && input.dateValue !== null) fields.push("dateValue");
  if (input.choiceValues !== undefined && input.choiceValues.length > 0)
    fields.push("choiceValues");
  if (input.freeTextValue !== undefined && input.freeTextValue !== null)
    fields.push("freeTextValue");
  return fields;
}

const FIELD_BY_ANSWER_TYPE: Record<QuestionVersionConstraints["answerType"], string> = {
  SINGLE_CHOICE: "choiceValues",
  MULTIPLE_CHOICE: "choiceValues",
  BOOLEAN: "booleanValue",
  INTEGER: "integerValue",
  DECIMAL: "decimalValue",
  SHORT_TEXT: "freeTextValue",
  DATE: "dateValue",
};

/**
 * Validiert `input` gegen die Constraints von `version`. Wirft
 * `InvalidAnswerError` mit allen gefundenen Verstoessen, wenn `input` keine
 * gueltige Antwort fuer diesen AnswerType ist. Ein "leerer" Input (keine
 * Wertfelder gesetzt) gilt als "keine Antwort" und wird NICHT hier abgelehnt -
 * die Pflichtfeld-Pruefung (isRequired) erfolgt erst bei der
 * Vollstaendigkeits-/Abschlusspruefung (siehe path.ts), da eine Frage
 * jederzeit unbeantwortet bleiben darf, solange sie sichtbar/optional ist
 * oder der Fragebogen noch nicht abgeschlossen wird.
 */
export function validateAnswerInput(
  version: QuestionVersionConstraints,
  input: AnswerValueInput,
): void {
  const issues: string[] = [];
  const populated = collectPopulatedFields(input);

  if (populated.length === 0) {
    return; // "keine Antwort" - siehe Kommentar oben.
  }

  const expectedField = FIELD_BY_ANSWER_TYPE[version.answerType];
  const unexpectedFields = populated.filter((f) => f !== expectedField);
  if (unexpectedFields.length > 0) {
    issues.push(
      `Fuer AnswerType "${version.answerType}" duerfen nur "${expectedField}" gesetzt sein, gefunden: ${unexpectedFields.join(", ")}`,
    );
  }

  switch (version.answerType) {
    case "BOOLEAN": {
      if (typeof input.booleanValue !== "boolean") {
        issues.push("booleanValue muss ein boolescher Wert sein.");
      }
      break;
    }

    case "INTEGER": {
      const value = input.integerValue;
      if (typeof value !== "number" || !Number.isInteger(value)) {
        issues.push("integerValue muss eine ganze Zahl sein.");
        break;
      }
      if (version.minValue !== null && version.minValue !== undefined) {
        if (compareDecimalStrings(String(value), version.minValue) < 0) {
          issues.push(`integerValue muss >= ${version.minValue} sein.`);
        }
      }
      if (version.maxValue !== null && version.maxValue !== undefined) {
        if (compareDecimalStrings(String(value), version.maxValue) > 0) {
          issues.push(`integerValue muss <= ${version.maxValue} sein.`);
        }
      }
      break;
    }

    case "DECIMAL": {
      const value = input.decimalValue;
      if (typeof value !== "string" || !isValidDecimalString(value)) {
        issues.push(
          "decimalValue muss eine gueltige Dezimalzahl als String sein (keine Float-Ungenauigkeit).",
        );
        break;
      }
      if (version.minValue !== null && version.minValue !== undefined) {
        if (compareDecimalStrings(value, version.minValue) < 0) {
          issues.push(`decimalValue muss >= ${version.minValue} sein.`);
        }
      }
      if (version.maxValue !== null && version.maxValue !== undefined) {
        if (compareDecimalStrings(value, version.maxValue) > 0) {
          issues.push(`decimalValue muss <= ${version.maxValue} sein.`);
        }
      }
      break;
    }

    case "SHORT_TEXT": {
      const value = input.freeTextValue;
      if (typeof value !== "string" || value.length === 0) {
        issues.push("freeTextValue darf nicht leer sein.");
        break;
      }
      if (version.maxLength !== null && version.maxLength !== undefined) {
        if (value.length > version.maxLength) {
          issues.push(`freeTextValue darf hoechstens ${version.maxLength} Zeichen lang sein.`);
        }
      }
      break;
    }

    case "DATE": {
      const value = input.dateValue;
      if (
        typeof value !== "string" ||
        !ISO_DATE_PATTERN.test(value) ||
        Number.isNaN(Date.parse(value))
      ) {
        issues.push("dateValue muss ein gueltiges ISO-8601-Datum sein.");
      }
      break;
    }

    case "SINGLE_CHOICE": {
      const values = input.choiceValues ?? [];
      if (values.length !== 1) {
        issues.push("Fuer SINGLE_CHOICE muss genau ein Wert in choiceValues stehen.");
        break;
      }
      const selected = values[0] ?? "";
      const validKeys = new Set(version.answerOptions.map((o) => o.key));
      if (!validKeys.has(selected)) {
        issues.push(`"${selected}" ist keine gueltige AnswerOption fuer diese Frage.`);
      }
      break;
    }

    case "MULTIPLE_CHOICE": {
      const values = input.choiceValues ?? [];
      if (values.length === 0) {
        issues.push("Fuer MULTIPLE_CHOICE muss mindestens ein Wert in choiceValues stehen.");
        break;
      }
      const uniqueValues = new Set(values);
      if (uniqueValues.size !== values.length) {
        issues.push("choiceValues darf keine doppelten Werte enthalten.");
      }
      const validKeys = new Set(version.answerOptions.map((o) => o.key));
      const invalidKeys = values.filter((v) => !validKeys.has(v));
      if (invalidKeys.length > 0) {
        issues.push(`Ungueltige AnswerOption(en) fuer diese Frage: ${invalidKeys.join(", ")}`);
      }
      const min = version.minSelections ?? 0;
      const max = version.maxSelections ?? Number.POSITIVE_INFINITY;
      if (values.length < min) {
        issues.push(`Mindestens ${min} Auswahl(en) erforderlich.`);
      }
      if (values.length > max) {
        issues.push(`Hoechstens ${max} Auswahl(en) erlaubt.`);
      }
      break;
    }
  }

  if (issues.length > 0) {
    throw new InvalidAnswerError(version.id, issues);
  }
}

/** Liefert `true`, wenn `input` mindestens ein Wertfeld gesetzt hat ("beantwortet"). */
export function hasAnswerValue(input: AnswerValueInput): boolean {
  return collectPopulatedFields(input).length > 0;
}
