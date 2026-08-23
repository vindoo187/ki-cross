/**
 * Exclusion-Pruefung (PHASE_3B_IMPLEMENTATION_PLAN.md Abschnitt 3.9): wertet
 * alle ExclusionRules eines RuleSetVersion gegen einen
 * ProductCandidateInput aus. Jede GETROFFENE Regel traegt zu
 * `exclusionReasonCodes` bei (`ExclusionRule.reasonCode` ist
 * unique/non-empty pro RuleSetVersion, `@@unique([tenantId,
 * ruleSetVersionId, reasonCode])`) und erzeugt eine
 * RecommendationRationale-Zeile mit `factorKey = "exclusion:<reasonCode>"`.
 * Ergebnisse werden nach reasonCode sortiert, damit die Reihenfolge
 * deterministisch bleibt (unabhaengig von der DB-Rueckgabereihenfolge).
 */

import { evaluateConditionGroups } from "./conditions";
import type { AnsweredValue } from "../questionnaire/types";
import type { ExclusionResult, ExclusionRuleInput, RationaleEntry } from "./types";

export interface ExclusionEvaluationContext {
  answersByQuestionId: ReadonlyMap<string, AnsweredValue>;
  productAttributes: ReadonlyMap<string, string>;
  sessionAttributes: ReadonlyMap<string, string>;
}

export function evaluateExclusionRules(
  rules: ExclusionRuleInput[],
  context: ExclusionEvaluationContext,
): ExclusionResult {
  const matched = rules
    .filter((rule) => evaluateConditionGroups(rule.conditions, context))
    .sort((a, b) => a.reasonCode.localeCompare(b.reasonCode));

  const exclusionReasonCodes = matched.map((rule) => rule.reasonCode);
  const rationales: RationaleEntry[] = matched.map((rule) => ({
    factorKey: `exclusion:${rule.reasonCode}`,
    factorValue: JSON.stringify(rule.justificationParams ?? null),
  }));

  return { exclusionReasonCodes, rationales };
}
