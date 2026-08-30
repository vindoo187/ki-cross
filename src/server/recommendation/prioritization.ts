/**
 * Priorisierung (PHASE_3B_IMPLEMENTATION_PLAN.md Abschnitt 3.8):
 * businessPriorityScore = Summe der `weight`-Werte ALLER getroffenen
 * PrioritizationRules. FUER JEDE getroffene Regel wird eine
 * Provisions-Aufloesung versucht (nicht nur fuer eine Teilmenge) -
 * `commissionRequired` steuert lediglich, ob ein Aufloesungsfehler die
 * GESAMTE Session-Auswertung kontrolliert abbricht
 * (`CommissionModelUnresolvedError`, siehe errors.ts) oder ob degradiert
 * wird (zusaetzliche Rationale-Zeile `factorKey = "commission_model_unresolved"`,
 * `commissionModelVersionId = null`).
 *
 * Die Provisions-Aufloesung selbst benoetigt DB-Zugriff und lebt daher in
 * service.ts; diese Funktion nimmt eine bereits DB-lose
 * `resolveCommission`-Callback entgegen, damit `prioritization.ts` eine
 * reine, ohne Datenbank testbare Funktion bleibt.
 */

import { evaluateConditionGroups } from "./conditions";
import { CommissionModelUnresolvedError } from "./errors";
import type { AnsweredValue } from "../questionnaire/types";
import type {
  CommissionResolution,
  PrioritizationResult,
  PrioritizationRuleInput,
  RationaleEntry,
} from "./types";

export interface PrioritizationEvaluationContext {
  answersByQuestionId: ReadonlyMap<string, AnsweredValue>;
  productAttributes: ReadonlyMap<string, string>;
  sessionAttributes: ReadonlyMap<string, string>;
  // Phase 13 AP4: Campaign.key-Werte, die zum Auswertungszeitpunkt fuer
  // diese Session aktiv sind (fuer CAMPAIGN_ACTIVE-Conditions, siehe
  // conditions.ts-Modulkommentar).
  activeCampaignKeys: ReadonlySet<string>;
}

export function evaluatePrioritizationRules(
  rules: PrioritizationRuleInput[],
  productId: string,
  context: PrioritizationEvaluationContext,
  resolveCommission: (productId: string) => CommissionResolution | null,
): PrioritizationResult {
  const matched = rules.filter((rule) => evaluateConditionGroups(rule.conditions, context));

  let businessPriorityScore = 0;
  const rationales: RationaleEntry[] = [];

  for (const rule of matched) {
    businessPriorityScore += rule.weight;

    const resolution = resolveCommission(productId);
    if (resolution) {
      rationales.push({
        factorKey: `prioritization:${rule.key}`,
        factorValue: String(rule.weight),
        commissionModelVersionId: resolution.commissionModelVersionId,
        commissionValueMinor: resolution.commissionValueMinor,
      });
      continue;
    }

    if (rule.commissionRequired) {
      throw new CommissionModelUnresolvedError(rule.key, productId);
    }

    // Degradiert: Regel zaehlt weiterhin zum businessPriorityScore, aber
    // ohne Provisions-Pinning; zusaetzliche Rationale dokumentiert das
    // Fehlen fuer Nachvollziehbarkeit/Analytics.
    rationales.push({
      factorKey: `prioritization:${rule.key}`,
      factorValue: String(rule.weight),
      commissionModelVersionId: null,
      commissionValueMinor: null,
    });
    rationales.push({
      factorKey: "commission_model_unresolved",
      factorValue: rule.key,
    });
  }

  return { businessPriorityScore, rationales };
}
