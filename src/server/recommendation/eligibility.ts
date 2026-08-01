/**
 * Eligibility-Pruefung (PHASE_3B_IMPLEMENTATION_PLAN.md Abschnitt 3.3):
 * harte Ausschlusslogik ueber `EligibilityRule.isRequired` - eine
 * ProductVersion ist nur dann `eligibilityPassed`, wenn ALLE required
 * EligibilityRules getroffen haben. Nicht-required Regeln (fitWeight > 0,
 * isRequired = false) fliessen NICHT in `eligibilityPassed` ein, sondern
 * ausschliesslich in `customerFitScore` (siehe fit-score.ts) - beide nutzen
 * dieselbe Auswertung (`evaluateEligibilityRuleMatches`), um Doppelarbeit zu
 * vermeiden.
 */

import { evaluateConditionGroups } from "./conditions";
import type { AnsweredValue } from "../questionnaire/types";
import type { EligibilityResult, EligibilityRuleInput, RationaleEntry } from "./types";

export interface EligibilityRuleMatch {
  rule: EligibilityRuleInput;
  matched: boolean;
}

export interface EligibilityEvaluationContext {
  answersByQuestionId: ReadonlyMap<string, AnsweredValue>;
  productAttributes: ReadonlyMap<string, string>;
  sessionAttributes: ReadonlyMap<string, string>;
}

/** Wertet jede EligibilityRule gegen den Kontext aus (Basis fuer eligibilityPassed UND customerFitScore). */
export function evaluateEligibilityRuleMatches(
  rules: EligibilityRuleInput[],
  context: EligibilityEvaluationContext,
): EligibilityRuleMatch[] {
  return rules.map((rule) => ({
    rule,
    matched: evaluateConditionGroups(rule.conditions, context),
  }));
}

/** Leitet eligibilityPassed + Rationale-Zeilen (eine je EligibilityRule) aus den Matches ab. */
export function computeEligibilityResult(matches: EligibilityRuleMatch[]): EligibilityResult {
  const failedRequired = matches.some((m) => m.rule.isRequired && !m.matched);
  const rationales: RationaleEntry[] = matches.map((m) => ({
    factorKey: `eligibility:${m.rule.key}`,
    factorValue: m.matched ? "matched" : "not_matched",
  }));
  return { eligibilityPassed: !failedRequired, rationales };
}
