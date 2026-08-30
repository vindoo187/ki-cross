/**
 * Auswertung von ConditionInput-Zeilen (eligibility_rule_conditions /
 * exclusion_rule_conditions / prioritization_rule_conditions /
 * cross_selling_rule_conditions), siehe PHASE_3B_IMPLEMENTATION_PLAN.md
 * Abschnitt 3.1-3.2.
 *
 * ANSWER-Conditions werden bewusst NICHT neu implementiert, sondern
 * delegieren an `evaluateSingleCondition` aus der Fragen-Engine
 * (questionnaire/visibility.ts), um Drift zwischen den beiden Engines zu
 * vermeiden. PRODUCT_ATTRIBUTE/SESSION_ATTRIBUTE-Conditions laufen ueber
 * die geschlossene attribute-registry.ts.
 *
 * CAMPAIGN_ACTIVE-Conditions (Phase 13 AP4, ChatGPT-GO 2026-08-30, siehe
 * PHASE_13_IMPLEMENTATION_PLAN.md Abschnitt 3 AP4) sind bewusst KEINE
 * eigene Engine, sondern folgen exakt demselben "Praesenz-Check in einer
 * Map"-Muster wie PRODUCT_ATTRIBUTE/SESSION_ATTRIBUTE mit
 * IS_ANSWERED/IS_NOT_ANSWERED: `context.activeCampaignKeys` enthaelt genau
 * die `Campaign.key`-Werte, die zum Auswertungszeitpunkt fuer die Session
 * aktiv sind (veroeffentlichte CampaignVersion + gueltiger Zeitraum +
 * passender Scope -- Aufloesung in `recommendation/service.ts`, siehe
 * dortigen Modulkommentar). Andere Operatoren als IS_ANSWERED/
 * IS_NOT_ANSWERED ergeben fachlich keinen Sinn (es gibt keinen
 * Vergleichswert, nur "aktiv"/"nicht aktiv") und werden abgelehnt. Anders
 * als PRODUCT_ATTRIBUTE/SESSION_ATTRIBUTE ist `attributeKey` hier KEIN
 * Eintrag in einer geschlossenen Code-Registry, sondern ein
 * `Campaign.key`-Wert des Mandanten (Existenzpruefung erfolgt
 * anwendungsseitig im Validator, `rule-admin.ts::validateDraftRuleSetVersion()`,
 * analog zur "unbekannte Frage"-Pruefung bei ANSWER-Conditions).
 * Ausschliesslich fuer PrioritizationRuleCondition/CrossSellingRuleCondition
 * vorgesehen -- ebenfalls serverseitig im Validator durchgesetzt, nicht per
 * DB-Constraint.
 */

import { evaluateSingleCondition } from "../questionnaire/visibility";
import type {
  AnsweredValue,
  VisibilityConditionInput,
  VisibilityOperator,
} from "../questionnaire/types";
import {
  assertOperatorAllowedForAttribute,
  evaluateAttributeComparison,
} from "./attribute-registry";
import { InvalidConditionSourceError, InvalidOperatorForAttributeError } from "./errors";
import type { ConditionInput } from "./types";

/** Einzig sinnvolle Operatoren fuer CAMPAIGN_ACTIVE -- siehe Modulkommentar. */
const CAMPAIGN_ACTIVE_OPERATORS: ReadonlySet<VisibilityOperator> = new Set([
  "IS_ANSWERED",
  "IS_NOT_ANSWERED",
]);

/**
 * Validiert die strukturelle Invariante "genau eines von
 * questionId/attributeKey ist abhaengig von sourceType gesetzt" (Abschnitt
 * 3.1). Wird sowohl beim Auswerten als auch separat bei der
 * Regel-Autoring-Validierung aufgerufen.
 */
export function assertValidConditionSource(condition: ConditionInput): void {
  const hasQuestionId = condition.questionId != null && condition.questionId !== "";
  const hasAttributeKey = condition.attributeKey != null && condition.attributeKey !== "";

  if (condition.sourceType === "ANSWER") {
    if (!hasQuestionId || hasAttributeKey) {
      throw new InvalidConditionSourceError(condition.id, condition.sourceType);
    }
    return;
  }

  // PRODUCT_ATTRIBUTE | SESSION_ATTRIBUTE
  if (!hasAttributeKey || hasQuestionId) {
    throw new InvalidConditionSourceError(condition.id, condition.sourceType);
  }
}

/**
 * Wertet EINE Condition aus.
 *
 * @param answersByQuestionId Antworten der Session (fuer ANSWER-Conditions), keyed nach `Question.id`.
 * @param productAttributes Aufgeloeste TariffAttribute-Werte des aktuell geprueften ProductVersion-Kandidaten (fuer PRODUCT_ATTRIBUTE-Conditions).
 * @param sessionAttributes Session-Attribute (fuer SESSION_ATTRIBUTE-Conditions).
 * @param activeCampaignKeys `Campaign.key`-Werte, die zum Auswertungszeitpunkt fuer diese Session aktiv sind (fuer CAMPAIGN_ACTIVE-Conditions, Phase 13 AP4). Optional -- Aufrufer, die keine CAMPAIGN_ACTIVE-Conditions erwarten (Eligibility/Exclusion), muessen das Feld nicht setzen.
 */
export function evaluateCondition(
  condition: ConditionInput,
  context: {
    answersByQuestionId: ReadonlyMap<string, AnsweredValue>;
    productAttributes: ReadonlyMap<string, string>;
    sessionAttributes: ReadonlyMap<string, string>;
    activeCampaignKeys?: ReadonlySet<string>;
  },
): boolean {
  assertValidConditionSource(condition);

  if (condition.sourceType === "ANSWER") {
    const legacyCondition: VisibilityConditionInput = {
      id: condition.id,
      targetQuestionId: condition.questionId as string,
      operator: condition.operator,
      comparisonValue: condition.comparisonValue,
      combinator: "AND",
    };
    const answer = context.answersByQuestionId.get(condition.questionId as string);
    return evaluateSingleCondition(legacyCondition, answer);
  }

  if (condition.sourceType === "CAMPAIGN_ACTIVE") {
    const campaignKey = condition.attributeKey as string;
    if (!CAMPAIGN_ACTIVE_OPERATORS.has(condition.operator)) {
      throw new InvalidOperatorForAttributeError(
        condition.sourceType,
        campaignKey,
        condition.operator,
      );
    }
    const isActive = (context.activeCampaignKeys ?? new Set<string>()).has(campaignKey);
    return condition.operator === "IS_ANSWERED" ? isActive : !isActive;
  }

  const attributeKey = condition.attributeKey as string;
  const rawValues =
    condition.sourceType === "PRODUCT_ATTRIBUTE"
      ? context.productAttributes
      : context.sessionAttributes;
  const definition = assertOperatorAllowedForAttribute(
    condition.sourceType,
    attributeKey,
    condition.operator,
  );

  if (condition.operator === "IS_ANSWERED") {
    return rawValues.has(attributeKey);
  }
  if (condition.operator === "IS_NOT_ANSWERED") {
    return !rawValues.has(attributeKey);
  }

  const raw = rawValues.get(attributeKey);
  if (raw === undefined) {
    // Kein gesetzter Wert (z.B. TariffAttribute fehlt fuer dieses Produkt) -
    // alle Vergleichsoperatoren ausser IS_ANSWERED/IS_NOT_ANSWERED gelten
    // dann als nicht erfuellt, analog zu "unbeantwortet" bei ANSWER-Conditions.
    return false;
  }
  const actual = definition.parse(raw);
  return evaluateAttributeComparison(
    definition,
    condition.operator,
    actual,
    condition.comparisonValue,
  );
}

/**
 * Wertet eine Liste von Conditions als DNF (OR-of-ANDs) aus: gleicher
 * `groupIndex` = AND (innerhalb der Gruppe), unterschiedlicher `groupIndex`
 * = OR (zwischen Gruppen). Eine leere Conditions-Liste gilt als IMMER
 * erfuellt (Regel ohne Einschraenkung), siehe Abschnitt 3.2.
 */
export function evaluateConditionGroups(
  conditions: ConditionInput[],
  context: {
    answersByQuestionId: ReadonlyMap<string, AnsweredValue>;
    productAttributes: ReadonlyMap<string, string>;
    sessionAttributes: ReadonlyMap<string, string>;
    activeCampaignKeys?: ReadonlySet<string>;
  },
): boolean {
  if (conditions.length === 0) return true;

  const groups = new Map<number, ConditionInput[]>();
  for (const condition of conditions) {
    const group = groups.get(condition.groupIndex) ?? [];
    group.push(condition);
    groups.set(condition.groupIndex, group);
  }

  for (const group of groups.values()) {
    const allMatch = group.every((condition) => evaluateCondition(condition, context));
    if (allMatch) return true;
  }
  return false;
}
