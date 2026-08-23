/**
 * Gemeinsame Typen der Empfehlungs-Engine (Phase 3B), siehe
 * PHASE_3B_IMPLEMENTATION_PLAN.md Abschnitte 3-7. `AnswerType`,
 * `VisibilityOperator` und `AnsweredValue` werden bewusst aus der
 * Fragebogen-Engine wiederverwendet statt dupliziert, um Drift zwischen
 * den beiden Engines zu vermeiden.
 */

import type { AnswerType, AnsweredValue, VisibilityOperator } from "../questionnaire/types";

export type { AnswerType, AnsweredValue, VisibilityOperator };

/** Aktuelle Algorithmus-Version, siehe Recommendation.algorithmVersion. */
export const RECOMMENDATION_ALGORITHM_VERSION = 1;

// ---------------------------------------------------------------------------
// Bedarfs-/Condition-Modell (Abschnitt 3.1 - 3.2)
// ---------------------------------------------------------------------------

export type NeedType =
  | "PARTNER_CARD"
  | "FAMILY"
  | "YOUNG"
  | "DSL"
  | "FIBER"
  | "STREAMING"
  | "ACCESSORY"
  | "DEVICE_PROTECTION"
  | "OTHER";

export type ConditionSourceType = "ANSWER" | "PRODUCT_ATTRIBUTE" | "SESSION_ATTRIBUTE";

/**
 * Eine einzelne Condition-Zeile aus eligibility_rule_conditions /
 * exclusion_rule_conditions / prioritization_rule_conditions /
 * cross_selling_rule_conditions. `groupIndex` bestimmt die DNF-Gruppierung:
 * gleicher groupIndex = AND (innerhalb der Gruppe), unterschiedlicher
 * groupIndex = OR (zwischen Gruppen) - eine Ebene, keine Verschachtelung.
 */
export interface ConditionInput {
  id: string;
  groupIndex: number;
  sourceType: ConditionSourceType;
  questionId?: string | null;
  attributeKey?: string | null;
  operator: VisibilityOperator;
  comparisonValue: string;
}

// ---------------------------------------------------------------------------
// Regel-Inputs (Abschnitt 3.3 - 3.4)
// ---------------------------------------------------------------------------

export interface EligibilityRuleInput {
  id: string;
  key: string;
  isRequired: boolean;
  fitWeight: number;
  conditions: ConditionInput[];
}

export interface ExclusionRuleInput {
  id: string;
  key: string;
  reasonCode: string;
  justificationParams: unknown;
  conditions: ConditionInput[];
}

export interface PrioritizationRuleInput {
  id: string;
  key: string;
  weight: number;
  commissionRequired: boolean;
  conditions: ConditionInput[];
}

export interface CrossSellingRuleInput {
  id: string;
  key: string;
  needType: NeedType;
  priority: number;
  reasonCode: string;
  justificationParams: unknown;
  suggestedProductVersionId: string | null;
  conditions: ConditionInput[];
}

// ---------------------------------------------------------------------------
// Produkt-/Session-Kontext fuer die Auswertung
// ---------------------------------------------------------------------------

/** Ein tenant-weit gueltiger ProductVersion-Kandidat samt aufgeloesten Attributen (TariffAttribute). */
export interface ProductCandidateInput {
  productVersionId: string;
  productId: string;
  categoryId: string;
  monthlyPriceMinor: number | null;
  attributes: ReadonlyMap<string, string>;
}

/** Auswertungskontext: beantwortete Fragen + Session-Attribute, tenant-/session-gebunden. */
export interface EvaluationInputContext {
  tenantId: string;
  sessionId: string;
  questionnaireVersionId: string;
  ruleSetVersionId: string;
  answersByQuestionId: ReadonlyMap<string, AnsweredValue>;
  sessionAttributes: ReadonlyMap<string, string>;
}

// ---------------------------------------------------------------------------
// Ergebnis-Bausteine (RecommendationRationale-Zeilen, Abschnitt 3.7 - 3.9)
// ---------------------------------------------------------------------------

/** Entspricht einer persistierten RecommendationRationale-Zeile (ohne recommendationItemId, wird beim Schreiben ergaenzt). */
export interface RationaleEntry {
  factorKey: string;
  factorValue: string;
  weight?: number | null;
  commissionModelVersionId?: string | null;
  commissionValueMinor?: number | null;
}

/** Ergebnis der Eligibility-Pruefung (Abschnitt 3.3) fuer einen ProductCandidateInput. */
export interface EligibilityResult {
  eligibilityPassed: boolean;
  rationales: RationaleEntry[];
}

/** Ergebnis der Exclusion-Pruefung (Abschnitt 3.9) fuer einen ProductCandidateInput. */
export interface ExclusionResult {
  exclusionReasonCodes: string[];
  rationales: RationaleEntry[];
}

/**
 * Ergebnis der Priorisierung (Abschnitt 3.8) fuer einen ProductCandidateInput:
 * businessPriorityScore = Summe der weight-Werte aller getroffenen
 * PrioritizationRules, plus die dazugehoerigen Rationale-Zeilen
 * (inkl. Provisions-Pinning je Regel).
 */
export interface PrioritizationResult {
  businessPriorityScore: number;
  rationales: RationaleEntry[];
}

/** Ergebnis einer getroffenen CrossSellingRule, Grundlage fuer RecommendationCrossSellingSignal. */
export interface CrossSellingSignalResult {
  triggerRuleId: string;
  triggerRuleSetVersionId: string;
  sourceAnswerId: string | null;
  needType: NeedType;
  reasonCode: string;
  justificationParams: unknown;
  priority: number;
  suggestedProductVersionId: string | null;
}

/** Provisions-Aufloesung fuer eine PrioritizationRule mit commissionRequired (Abschnitt 3.8). */
export interface CommissionResolution {
  commissionModelVersionId: string;
  commissionValueMinor: number | null;
}
