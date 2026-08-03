/**
 * Formatiert `QuestionForAnswering.currentAnswer` (siehe
 * `questionnaire/service.ts`) als menschenlesbaren Anzeigewert fuer die
 * Zusammenfassungsseite (AP9, siehe PHASE_5_IMPLEMENTATION_PLAN.md Abschnitt
 * 2.2 Punkt 5 + Abschnitt 5 Schritt 10). Rein praesentationsseitig, keine
 * neue Fachlogik: `QuestionInputs.tsx` enthaelt nur editierbare
 * Eingabe-Komponenten (Formulare), keine Lesedarstellung -- diese Funktion
 * schliesst genau diese Luecke, analog zu `translateRationale()`
 * (`rationale-translation.ts`), als eigenstaendiges, DB-freies Modul fuer
 * direkte Unit-Testbarkeit ohne Tenant-Kontext/Prisma-Mock.
 *
 * Auswahl-Keys (`SINGLE_CHOICE`/`MULTIPLE_CHOICE`) werden ueber
 * `QuestionForAnswering.answerOptions` auf ihr `label` aufgeloest --
 * dieselbe Liste, die auch `SingleChoiceInput`/`MultipleChoiceInput`
 * (`QuestionInputs.tsx`) fuer die Auswahl-Darstellung nutzen. Fehlt ein Key
 * ausnahmsweise in `answerOptions` (z. B. nach nachtraeglicher Aenderung der
 * Optionsliste einer QuestionVersion), wird der rohe Key als Fallback
 * angezeigt statt eines Fehlers -- analog zum Fallback-Muster in
 * `view-models.ts::loadProductVersionSummaries()`.
 */

import type { QuestionForAnswering } from "../questionnaire/service";

const NOT_ANSWERED = "Nicht beantwortet";

export function formatAnswerValue(question: QuestionForAnswering): string {
  const value = question.currentAnswer;
  if (value == null) {
    return NOT_ANSWERED;
  }

  switch (question.answerType) {
    case "SINGLE_CHOICE": {
      const key = value.choiceValues?.[0];
      if (key == null) return NOT_ANSWERED;
      return question.answerOptions.find((option) => option.key === key)?.label ?? key;
    }
    case "MULTIPLE_CHOICE": {
      const keys = value.choiceValues ?? [];
      if (keys.length === 0) return NOT_ANSWERED;
      return keys
        .map((key) => question.answerOptions.find((option) => option.key === key)?.label ?? key)
        .join(", ");
    }
    case "BOOLEAN":
      if (value.booleanValue == null) return NOT_ANSWERED;
      return value.booleanValue ? "Ja" : "Nein";
    case "INTEGER":
      return value.integerValue == null ? NOT_ANSWERED : String(value.integerValue);
    case "DECIMAL":
      return value.decimalValue ?? NOT_ANSWERED;
    case "DATE":
      if (!value.dateValue) return NOT_ANSWERED;
      return new Date(value.dateValue).toLocaleDateString("de-DE");
    case "SHORT_TEXT":
      return value.freeTextValue && value.freeTextValue.length > 0
        ? value.freeTextValue
        : NOT_ANSWERED;
    default:
      return NOT_ANSWERED;
  }
}
