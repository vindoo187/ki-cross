/**
 * Cross-Selling-Signale (PHASE_3B_IMPLEMENTATION_PLAN.md Abschnitt 3.4):
 * wertet alle CrossSellingRules eines RuleSetVersion gegen die Session aus.
 * `RecommendationCrossSellingSignal` (append-only) ist die einzige Quelle
 * der Wahrheit fuer RULE_BASED-Bedarfe - `SalesOpportunity` liest/kopiert
 * nur per nullable `triggerSignalId` (siehe sales-opportunity.ts).
 */

import { evaluateConditionGroups } from "./conditions";
import type { AnsweredValue } from "../questionnaire/types";
import type { CrossSellingRuleInput, CrossSellingSignalResult } from "./types";

export interface CrossSellingEvaluationContext {
  answersByQuestionId: ReadonlyMap<string, AnsweredValue>;
  /**
   * questionId -> answerId, fuer die "ausloesende Antwort" pro Regel
   * (best-effort: erste ANSWER-Condition-Zielfrage mit gesetzter Antwort).
   */
  answerIdByQuestionId: ReadonlyMap<string, string>;
  sessionAttributes: ReadonlyMap<string, string>;
  // Phase 13 AP4: Campaign.key-Werte, die zum Auswertungszeitpunkt fuer
  // diese Session aktiv sind (fuer CAMPAIGN_ACTIVE-Conditions, siehe
  // conditions.ts-Modulkommentar).
  activeCampaignKeys: ReadonlySet<string>;
}

export function evaluateCrossSellingRules(
  rules: CrossSellingRuleInput[],
  ruleSetVersionId: string,
  context: CrossSellingEvaluationContext,
): CrossSellingSignalResult[] {
  const matched = rules.filter((rule) =>
    evaluateConditionGroups(rule.conditions, {
      answersByQuestionId: context.answersByQuestionId,
      // Cross-Selling-Regeln referenzierten bislang nur ANSWER-Conditions,
      // seit Phase 13 AP4 zusaetzlich CAMPAIGN_ACTIVE; eine leere
      // Attribute-Map ist weiterhin unschaedlich, falls doch ein
      // PRODUCT_ATTRIBUTE/SESSION_ATTRIBUTE-Fall auftritt, evaluiert er
      // korrekt als "nicht gesetzt" (siehe conditions.ts).
      productAttributes: new Map(),
      sessionAttributes: context.sessionAttributes,
      activeCampaignKeys: context.activeCampaignKeys,
    }),
  );

  return matched.map((rule) => {
    const firstAnswerCondition = rule.conditions.find(
      (c) => c.sourceType === "ANSWER" && c.questionId,
    );
    const sourceAnswerId =
      firstAnswerCondition?.questionId != null
        ? (context.answerIdByQuestionId.get(firstAnswerCondition.questionId) ?? null)
        : null;

    return {
      triggerRuleId: rule.id,
      triggerRuleSetVersionId: ruleSetVersionId,
      sourceAnswerId,
      needType: rule.needType,
      reasonCode: rule.reasonCode,
      justificationParams: rule.justificationParams,
      priority: rule.priority,
      suggestedProductVersionId: rule.suggestedProductVersionId,
    };
  });
}
