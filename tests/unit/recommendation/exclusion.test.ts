import { describe, expect, it } from "vitest";
import { evaluateExclusionRules } from "@/server/recommendation/exclusion";
import type { ConditionInput, ExclusionRuleInput } from "@/server/recommendation/types";
import type { AnsweredValue } from "@/server/questionnaire/types";

function rule(overrides: Partial<ExclusionRuleInput> = {}): ExclusionRuleInput {
  return {
    id: "excl-1",
    key: "renewal_kein_premium",
    reasonCode: "RENEWAL_NO_PREMIUM_TIER",
    justificationParams: null,
    conditions: [],
    ...overrides,
  };
}

const emptyContext = {
  answersByQuestionId: new Map<string, AnsweredValue>(),
  productAttributes: new Map<string, string>(),
  sessionAttributes: new Map<string, string>(),
};

describe("evaluateExclusionRules", () => {
  it("keine Regel matcht -> leere Ergebnisse", () => {
    const result = evaluateExclusionRules(
      [
        rule({
          conditions: [
            {
              id: "c1",
              groupIndex: 0,
              sourceType: "SESSION_ATTRIBUTE",
              attributeKey: "consultationType",
              operator: "EQUALS",
              comparisonValue: "RENEWAL",
            },
          ],
        }),
      ],
      emptyContext,
    );
    expect(result).toEqual({ exclusionReasonCodes: [], rationales: [] });
  });

  it("eine getroffene Regel erzeugt reasonCode + Rationale mit JSON-serialisierten justificationParams", () => {
    const conditions: ConditionInput[] = [
      {
        id: "c1",
        groupIndex: 0,
        sourceType: "SESSION_ATTRIBUTE",
        attributeKey: "consultationType",
        operator: "EQUALS",
        comparisonValue: "RENEWAL",
      },
    ];
    const sessionAttributes = new Map([["consultationType", "RENEWAL"]]);
    const result = evaluateExclusionRules(
      [rule({ conditions, justificationParams: { note: "test" } })],
      { ...emptyContext, sessionAttributes },
    );
    expect(result.exclusionReasonCodes).toEqual(["RENEWAL_NO_PREMIUM_TIER"]);
    expect(result.rationales).toEqual([
      { factorKey: "exclusion:RENEWAL_NO_PREMIUM_TIER", factorValue: '{"note":"test"}' },
    ]);
  });

  it("justificationParams=null wird als JSON 'null' serialisiert", () => {
    const sessionAttributes = new Map([["consultationType", "RENEWAL"]]);
    const result = evaluateExclusionRules(
      [
        rule({
          conditions: [
            {
              id: "c1",
              groupIndex: 0,
              sourceType: "SESSION_ATTRIBUTE",
              attributeKey: "consultationType",
              operator: "EQUALS",
              comparisonValue: "RENEWAL",
            },
          ],
          justificationParams: null,
        }),
      ],
      { ...emptyContext, sessionAttributes },
    );
    expect(result.rationales[0]?.factorValue).toBe("null");
  });

  it("Ergebnisse werden nach reasonCode sortiert (unabhaengig von Eingabereihenfolge)", () => {
    const sessionAttributes = new Map([["consultationType", "RENEWAL"]]);
    const alwaysMatchingConditions: ConditionInput[] = [
      {
        id: "c",
        groupIndex: 0,
        sourceType: "SESSION_ATTRIBUTE",
        attributeKey: "consultationType",
        operator: "EQUALS",
        comparisonValue: "RENEWAL",
      },
    ];
    const result = evaluateExclusionRules(
      [
        rule({ id: "r-z", reasonCode: "Z_REASON", conditions: alwaysMatchingConditions }),
        rule({ id: "r-a", reasonCode: "A_REASON", conditions: alwaysMatchingConditions }),
      ],
      { ...emptyContext, sessionAttributes },
    );
    expect(result.exclusionReasonCodes).toEqual(["A_REASON", "Z_REASON"]);
  });
});
