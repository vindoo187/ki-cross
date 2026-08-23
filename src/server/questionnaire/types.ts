/**
 * Gemeinsame, DB-unabhaengige Typen der Fragen-Engine (Phase 3A).
 *
 * Bewusst NICHT direkt von `@prisma/client`-Typen abgeleitet: Diese Typen
 * beschreiben die reinen, ohne Datenbank testbaren Kernfunktionen
 * (`visibility.ts`, `answer-validation.ts`, `path.ts`, `status.ts`). Die
 * Orchestrierung in `service.ts` mappt zwischen Prisma-Modellen und diesen
 * Typen. Siehe docs/QUESTION_ENGINE.md fuer die fachliche Beschreibung.
 */

export type AnswerType =
  "SINGLE_CHOICE" | "MULTIPLE_CHOICE" | "BOOLEAN" | "INTEGER" | "DECIMAL" | "SHORT_TEXT" | "DATE";

export type VisibilityOperator =
  | "EQUALS"
  | "NOT_EQUALS"
  | "GREATER_THAN"
  | "GREATER_THAN_OR_EQUAL"
  | "LESS_THAN"
  | "LESS_THAN_OR_EQUAL"
  | "IN"
  | "NOT_IN"
  | "CONTAINS"
  | "IS_ANSWERED"
  | "IS_NOT_ANSWERED";

export type LogicalCombinator = "AND" | "OR";

/** Eine Sichtbarkeitsbedingung, losgeloest vom Prisma-Modell (`VisibilityCondition`). */
export interface VisibilityConditionInput {
  id: string;
  targetQuestionId: string;
  operator: VisibilityOperator;
  /** Rohwert als String; Interpretation haengt vom AnswerType der Zielfrage ab. */
  comparisonValue: string;
  combinator: LogicalCombinator;
}

/**
 * Die aktuell aktive, fuer Sichtbarkeits-/Vollstaendigkeitspruefungen
 * relevante Antwort auf eine Frage (`Question`, nicht `QuestionVersion`:
 * Sichtbarkeitsbedingungen referenzieren die stabile Frage, nicht eine
 * konkrete Version). `isAnswered = false` bildet sowohl "nie beantwortet"
 * als auch "Antwort durch spaetere Aenderung deaktiviert" ab.
 */
export interface AnsweredValue {
  answerType: AnswerType;
  isAnswered: boolean;
  integerValue?: number | null;
  /** Dezimalwert als String (keine Float-Ungenauigkeit), z. B. "1234.5000". */
  decimalValue?: string | null;
  booleanValue?: boolean | null;
  /** ISO-8601-Datumsstring (UTC). */
  dateValue?: string | null;
  choiceValues?: string[];
}

/** Eine Antwortoption (`AnswerOption`) fuer SINGLE_CHOICE/MULTIPLE_CHOICE. */
export interface AnswerOptionInput {
  key: string;
  label: string;
}

/** Die validierungsrelevanten Felder einer `QuestionVersion`. */
export interface QuestionVersionConstraints {
  id: string;
  answerType: AnswerType;
  isRequired: boolean;
  minValue?: string | null;
  maxValue?: string | null;
  maxLength?: number | null;
  minSelections?: number | null;
  maxSelections?: number | null;
  answerOptions: AnswerOptionInput[];
}

/** Roheingabe eines Kunden-/Mitarbeiter-Antwortwerts (vor Persistierung). */
export interface AnswerValueInput {
  integerValue?: number | null;
  decimalValue?: string | null;
  booleanValue?: boolean | null;
  dateValue?: string | null;
  choiceValues?: string[];
  freeTextValue?: string | null;
}

/**
 * Eine Frage innerhalb einer QuestionnaireVersion, so wie sie fuer
 * Sichtbarkeits-/Pfadberechnung benoetigt wird.
 */
export interface QuestionNode {
  questionId: string;
  sortOrder: number;
  /** Aktive/zeitlich gueltige Version dieser Frage fuer die aktuelle Session. */
  activeVersion: QuestionVersionConstraints;
  visibilityConditions: VisibilityConditionInput[];
}

export type QuestionnaireRunStatus =
  "NOT_STARTED" | "IN_PROGRESS" | "COMPLETED" | "ABANDONED" | "NEEDS_REVIEW";
