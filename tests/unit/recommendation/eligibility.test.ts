import { describe, expect, it } from "vitest";
import {
  computeEligibilityResult,
  evaluateEligibilityRuleMatches,
  type EligibilityRuleMatch,
} from "@/server/recommendation/eligibility";
import type { ConditionInput, EligibilityRuleInput } from "@/server/recommendation/types";
import type { AnsweredValue } from "@/server/questionnaire/types";

function rule(overrides: Partial<EligibilityRuleInput> = {}): EligibilityRuleInput {
  return {
    id: "rule-1",
    key: "mind_18",
    isRequired: true,
    fitWeight: 0,
    conditions: [],
    ...overrides,
  };
}

const emptyContext = {
  answersByQuestionId: new Map<string, AnsweredValue>(),
  productAttributes: new Map<string, string>(),
  sessionAttributes: new Map<string, string>(),
};

describe("evaluateEligibilityRuleMatches", () => {
  it("Regel ohne Conditions matcht immer (leere Conditions-Liste = immer erfuellt)", () => {
    const matches = evaluateEligibilityRuleMatches([rule()], emptyContext);
    expect(matches).toEqual([{ rule: rule(), matched: true }]);
  });

  it("wertet Conditions ueber evaluateConditionGroups aus", () => {
    const conditions: ConditionInput[] = [
      {
        id: "c1",
        groupIndex: 0,
        sourceType: "PRODUCT_ATTRIBUTE",
        attributeKey: "dataVolumeGb",
        operator: "GREATER_THAN_OR_EQUAL",
        comparisonValue: "5",
      },
    ];
    const matched = evaluateEligibilityRuleMatches([rule({ conditions })], {
      ...emptyContext,
      productAttributes: new Map([["dataVolumeGb", "20"]]),
    });
    expect(matched[0]?.matched).toBe(true);

    const notMatched = evaluateEligibilityRuleMatches([rule({ conditions })], emptyContext);
    expect(notMatched[0]?.matched).toBe(false);
  });
});

describe("computeEligibilityResult", () => {
  it("eligibilityPassed=true, wenn alle required Regeln matchen", () => {
    const matches: EligibilityRuleMatch[] = [
      { rule: rule({ key: "r1", isRequired: true }), matched: true },
      { rule: rule({ key: "r2", isRequired: false }), matched: false },
    ];
    const result = computeEligibilityResult(matches);
    expect(result.eligibilityPassed).toBe(true);
  });

  it("eligibilityPassed=false, wenn eine required Regel nicht matcht", () => {
    const matches: EligibilityRuleMatch[] = [
      { rule: rule({ key: "r1", isRequired: true }), matched: false },
    ];
    const result = computeEligibilityResult(matches);
    expect(result.eligibilityPassed).toBe(false);
  });

  it("nicht-required, nicht-getroffene Regeln beeinflussen eligibilityPassed nicht", () => {
    const matches: EligibilityRuleMatch[] = [
      { rule: rule({ key: "r1", isRequired: false }), matched: false },
    ];
    expect(computeEligibilityResult(matches).eligibilityPassed).toBe(true);
  });

  it("erzeugt eine Rationale-Zeile je Regel mit factorKey/factorValue-Konvention", () => {
    const matches: EligibilityRuleMatch[] = [
      { rule: rule({ key: "mind_18" }), matched: true },
      { rule: rule({ key: "ausreichendes_datenvolumen" }), matched: false },
    ];
    const result = computeEligibilityResult(matches);
    expect(result.rationales).toEqual([
      { factorKey: "eligibility:mind_18", factorValue: "matched" },
      { factorKey: "eligibility:ausreichendes_datenvolumen", factorValue: "not_matched" },
    ]);
  });
});
