/**
 * Gemeinsame, providerunabhaengige Typen des Freitext-KI-Angebotsfeatures
 * (Phase 12 AP1, siehe PHASE_12_IMPLEMENTATION_PLAN.md Abschnitt 2). Analog
 * `src/server/questionnaire/types.ts`: reine Typdefinitionen ohne DB-Zugriff,
 * damit `contract.ts`, `visible-question-context.ts`, `extraction-validator.ts`
 * und `providers/mock-provider.ts` unabhaengig voneinander testbar bleiben.
 */

import type { AnswerType } from "../questionnaire/types";

export type { AnswerType };

/** Eine Antwortoption, wie sie der Extraktionskomponente als Kontext angeboten wird. */
export interface AiExtractionAnswerOption {
  key: string;
  label: string;
}

/**
 * Eine fuer die KI-Extraktion zulaessige Frage ("Visible-Question Context",
 * ChatGPT-Schicht 2). Wird AUSSCHLIESSLICH serverseitig erzeugt (siehe
 * `visible-question-context.ts`) -- niemals vom Client uebernommen (ChatGPT-
 * Vorgabe, PHASE_12_IMPLEMENTATION_PLAN.md Abschnitt 1 Punkt 8). Enthaelt nur
 * bereits sichtbare, UNBEANTWORTETE, NICHT-SHORT_TEXT-Fragen (ChatGPT-
 * Entscheidungen 3+4, siehe Abschnitt 1).
 */
export interface AiExtractionVisibleQuestion {
  questionId: string;
  label: string;
  answerType: Exclude<AnswerType, "SHORT_TEXT">;
  answerOptions: AiExtractionAnswerOption[];
  minValue: string | null;
  maxValue: string | null;
  maxLength: number | null;
  minSelections: number | null;
  maxSelections: number | null;
}

/**
 * Ein von der Extraktionskomponente vorgeschlagener Kandidat -- NOCH KEINE
 * `CustomerAnswer` (ChatGPT-Schicht 5, "Suggestion State: kein neues
 * Datenmodell"). Struktur bewusst analog `AnswerValueInput`
 * (`src/server/questionnaire/types.ts`), aber ohne `freeTextValue` (SHORT_TEXT
 * ist als KI-Ziel ausgeschlossen) und mit optionalem `confidence` fuer
 * spaetere Provider, die eine Unsicherheitsangabe liefern (AP1 nutzt dies
 * noch nicht, siehe `extraction-validator.ts`).
 */
export interface AiExtractionCandidate {
  questionId: string;
  answerType: Exclude<AnswerType, "SHORT_TEXT">;
  integerValue?: number;
  decimalValue?: string;
  booleanValue?: boolean;
  /** ISO-8601-Datumsstring (Kalenderdatum, kein Zeitanteil), z. B. "2026-09-30". */
  dateValue?: string;
  choiceValues?: string[];
  /** 0..1, optional -- AP1-Validator wertet dies (noch) nicht aus. */
  confidence?: number;
}
