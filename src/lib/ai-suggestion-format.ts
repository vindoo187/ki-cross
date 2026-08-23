/**
 * Reine Anzeige-/Mapping-Hilfen fuer die Freitext-KI-Bestaetigungs-UX (Phase
 * 12 AP3, ChatGPT-GO 2026-08-23). Bewusst UNTER `src/lib/` (nicht
 * `src/server/`), da diese Funktionen ausschliesslich von Client-Komponenten
 * (`"use client"`) importiert werden -- reine, seiteneffektfreie Funktionen
 * ohne DB-/Session-Zugriff, analog dem bestehenden `goal-format.ts`-Muster.
 *
 * Trifft KEINE fachliche Entscheidung -- `candidateToAnswerValueInput()`
 * kopiert lediglich das bereits vom Server (`extraction-validator.ts`)
 * validierte Feld je `answerType` 1:1 in die Form, die der bestehende
 * `saveAnswer()`-Pfad (`answerValueSchema`, `src/server/consultation-ui/
 * schemas.ts`) ohnehin erwartet. Kein neuer Validierungscode.
 */

import type { AiExtractionCandidate } from "@/server/ai-extraction/types";
import type { AnswerValueInput } from "@/server/questionnaire/types";
import type { QuestionForAnswering } from "@/server/questionnaire/service";

/**
 * Wandelt einen KI-Kandidaten in genau die Form um, die `onCommit()`
 * (`QuestionFlow`/`QuestionInputs`) bzw. der bestehende
 * `saveAnswer()`/`changeAnswer()`-Request-Body ohnehin erwartet -- nur das
 * zum `answerType` passende Feld wird gesetzt, analog dazu, wie jede
 * `QuestionInputs.tsx`-Komponente ihren eigenen `AnswerValueInput` baut.
 */
export function candidateToAnswerValueInput(candidate: AiExtractionCandidate): AnswerValueInput {
  switch (candidate.answerType) {
    case "INTEGER":
      return { integerValue: candidate.integerValue ?? null };
    case "DECIMAL":
      return { decimalValue: candidate.decimalValue ?? null };
    case "BOOLEAN":
      return { booleanValue: candidate.booleanValue ?? null };
    case "DATE":
      return { dateValue: candidate.dateValue ?? null };
    case "SINGLE_CHOICE":
    case "MULTIPLE_CHOICE":
      return { choiceValues: candidate.choiceValues ?? [] };
    default: {
      // Erschoepfende switch-Pruefung: bei neuem AnswerType faellt dies zur
      // Compile-Zeit auf (SHORT_TEXT ist bereits im Typ selbst ausgeschlossen).
      const exhaustiveCheck: never = candidate.answerType;
      throw new Error(`Unbekannter AnswerType: ${String(exhaustiveCheck)}`);
    }
  }
}

/** Menschenlesbare Kurzdarstellung eines KI-Vorschlagswerts fuer die Suggestion-Karte. */
export function formatSuggestionValue(
  candidate: AiExtractionCandidate,
  question: QuestionForAnswering,
): string {
  switch (candidate.answerType) {
    case "BOOLEAN":
      return candidate.booleanValue ? "Ja" : "Nein";
    case "INTEGER":
      return candidate.integerValue != null ? String(candidate.integerValue) : "–";
    case "DECIMAL":
      return candidate.decimalValue ?? "–";
    case "DATE":
      return candidate.dateValue ? new Date(candidate.dateValue).toLocaleDateString("de-DE") : "–";
    case "SINGLE_CHOICE":
    case "MULTIPLE_CHOICE": {
      const labels = (candidate.choiceValues ?? []).map(
        (key) => question.answerOptions.find((option) => option.key === key)?.label ?? key,
      );
      return labels.length > 0 ? labels.join(", ") : "–";
    }
    default: {
      const exhaustiveCheck: never = candidate.answerType;
      return String(exhaustiveCheck);
    }
  }
}
