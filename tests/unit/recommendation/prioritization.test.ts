import { describe, expect, it } from "vitest";
import { evaluatePrioritizationRules } from "@/server/recommendation/prioritization";
import { CommissionModelUnresolvedError } from "@/server/recommendation/errors";
import type { CommissionResolution, PrioritizationRuleInput } from "@/server/recommendation/types";
import type { AnsweredValue } from "@/server/questionnaire/types";

function rule(overrides: Partial<PrioritizationRuleInput> = {}): PrioritizationRuleInput {
  return {
    id: "prio-1",
    key: "bonus_eu_roaming",
    weight: 30,
    commissionRequired: false,
    conditions: [],
    ...overrides,
  };
}

const emptyContext = {
  answersByQuestionId: new Map<string, AnsweredValue>(),
  productAttributes: new Map<string, string>(),
  sessionAttributes: new Map<string, string>(),
  activeCampaignKeys: new Set<string>(),
};

const resolution: CommissionResolution = {
  commissionModelVersionId: "cmv-1",
  commissionValueMinor: 500,
};

describe("evaluatePrioritizationRules", () => {
  it("summiert weight ueber ALLE getroffenen Regeln", () => {
    const result = evaluatePrioritizationRules(
      [rule({ key: "a", weight: 30 }), rule({ key: "b", weight: 20 })],
      "prod-1",
      emptyContext,
      () => resolution,
    );
    expect(result.businessPriorityScore).toBe(50);
  });

  it("nicht getroffene Regeln zaehlen nicht", () => {
    const conditions = [
      {
        id: "c1",
        groupIndex: 0,
        sourceType: "SESSION_ATTRIBUTE" as const,
        attributeKey: "consultationType",
        operator: "EQUALS" as const,
        comparisonValue: "RENEWAL",
      },
    ];
    const result = evaluatePrioritizationRules(
      [rule({ key: "a", weight: 30, conditions })],
      "prod-1",
      emptyContext,
      () => resolution,
    );
    expect(result.businessPriorityScore).toBe(0);
    expect(result.rationales).toEqual([]);
  });

  it("versucht resolveCommission fuer JEDE getroffene Regel und pinnt bei Erfolg die Provision", () => {
    const result = evaluatePrioritizationRules(
      [rule({ key: "bonus_eu_roaming", weight: 30 })],
      "prod-1",
      emptyContext,
      () => resolution,
    );
    expect(result.rationales).toEqual([
      {
        factorKey: "prioritization:bonus_eu_roaming",
        factorValue: "30",
        commissionModelVersionId: "cmv-1",
        commissionValueMinor: 500,
      },
    ]);
  });

  it("commissionRequired=true + Aufloesung schlaegt fehl -> CommissionModelUnresolvedError, gesamte Auswertung bricht ab", () => {
    expect(() =>
      evaluatePrioritizationRules(
        [rule({ key: "bonus_neuvertrag_premium", weight: 20, commissionRequired: true })],
        "prod-1",
        emptyContext,
        () => null,
      ),
    ).toThrow(CommissionModelUnresolvedError);
  });

  it("commissionRequired=false + Aufloesung schlaegt fehl -> degradiert mit zwei Rationale-Zeilen", () => {
    const result = evaluatePrioritizationRules(
      [rule({ key: "bonus_eu_roaming", weight: 30, commissionRequired: false })],
      "prod-1",
      emptyContext,
      () => null,
    );
    expect(result.businessPriorityScore).toBe(30);
    expect(result.rationales).toEqual([
      {
        factorKey: "prioritization:bonus_eu_roaming",
        factorValue: "30",
        commissionModelVersionId: null,
        commissionValueMinor: null,
      },
      {
        factorKey: "commission_model_unresolved",
        factorValue: "bonus_eu_roaming",
      },
    ]);
  });

  it("Phase 13 AP4: CAMPAIGN_ACTIVE-Bedingung matcht ueber activeCampaignKeys", () => {
    const conditions = [
      {
        id: "c1",
        groupIndex: 0,
        sourceType: "CAMPAIGN_ACTIVE" as const,
        attributeKey: "summer-sale",
        operator: "IS_ANSWERED" as const,
        comparisonValue: "",
      },
    ];
    const contextWithActiveCampaign = {
      ...emptyContext,
      activeCampaignKeys: new Set(["summer-sale"]),
    };
    const result = evaluatePrioritizationRules(
      [rule({ key: "campaign_bonus", weight: 15, conditions })],
      "prod-1",
      contextWithActiveCampaign,
      () => resolution,
    );
    expect(result.businessPriorityScore).toBe(15);

    // Dieselbe Regel darf NICHT matchen, wenn die Campaign nicht aktiv ist.
    const resultInactive = evaluatePrioritizationRules(
      [rule({ key: "campaign_bonus", weight: 15, conditions })],
      "prod-1",
      emptyContext,
      () => resolution,
    );
    expect(resultInactive.businessPriorityScore).toBe(0);
  });

  it("mehrere Regeln koennen unterschiedliche commissionModelVersionId in ihren Rationale-Zeilen tragen", () => {
    const resolutionA: CommissionResolution = {
      commissionModelVersionId: "cmv-a",
      commissionValueMinor: 100,
    };
    const resolutionB: CommissionResolution = {
      commissionModelVersionId: "cmv-b",
      commissionValueMinor: 200,
    };
    let callCount = 0;
    const result = evaluatePrioritizationRules(
      [rule({ key: "a", weight: 10 }), rule({ key: "b", weight: 20 })],
      "prod-1",
      emptyContext,
      () => {
        callCount += 1;
        return callCount === 1 ? resolutionA : resolutionB;
      },
    );
    expect(result.rationales.map((r) => r.commissionModelVersionId)).toEqual(["cmv-a", "cmv-b"]);
  });
});
