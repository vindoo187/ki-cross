import { describe, expect, it } from "vitest";
import { evaluateCrossSellingRules } from "@/server/recommendation/cross-selling";
import type { ConditionInput, CrossSellingRuleInput } from "@/server/recommendation/types";
import type { AnsweredValue } from "@/server/questionnaire/types";

function rule(overrides: Partial<CrossSellingRuleInput> = {}): CrossSellingRuleInput {
  return {
    id: "cs-1",
    key: "streaming_zusatzpaket",
    needType: "STREAMING",
    priority: 70,
    reasonCode: "STREAMING_ADDON_SUGGESTED",
    justificationParams: null,
    suggestedProductVersionId: null,
    conditions: [],
    ...overrides,
  };
}

const answerCondition: ConditionInput = {
  id: "c1",
  groupIndex: 0,
  sourceType: "ANSWER",
  questionId: "q-streaming",
  operator: "EQUALS",
  comparisonValue: "true",
};

describe("evaluateCrossSellingRules", () => {
  it("keine Regel matcht -> leeres Array", () => {
    const result = evaluateCrossSellingRules([rule({ conditions: [answerCondition] })], "rsv-1", {
      answersByQuestionId: new Map(),
      answerIdByQuestionId: new Map(),
      sessionAttributes: new Map(),
    });
    expect(result).toEqual([]);
  });

  it("getroffene Regel erzeugt ein CrossSellingSignalResult mit allen Regel-Feldern", () => {
    const answersByQuestionId = new Map<string, AnsweredValue>([
      ["q-streaming", { answerType: "BOOLEAN", isAnswered: true, booleanValue: true }],
    ]);
    const answerIdByQuestionId = new Map([["q-streaming", "answer-42"]]);
    const result = evaluateCrossSellingRules([rule({ conditions: [answerCondition] })], "rsv-1", {
      answersByQuestionId,
      answerIdByQuestionId,
      sessionAttributes: new Map(),
    });
    expect(result).toEqual([
      {
        triggerRuleId: "cs-1",
        triggerRuleSetVersionId: "rsv-1",
        sourceAnswerId: "answer-42",
        needType: "STREAMING",
        reasonCode: "STREAMING_ADDON_SUGGESTED",
        justificationParams: null,
        priority: 70,
        suggestedProductVersionId: null,
      },
    ]);
  });

  it("sourceAnswerId ist null, wenn die ausloesende Frage in answerIdByQuestionId fehlt", () => {
    const answersByQuestionId = new Map<string, AnsweredValue>([
      ["q-streaming", { answerType: "BOOLEAN", isAnswered: true, booleanValue: true }],
    ]);
    const result = evaluateCrossSellingRules([rule({ conditions: [answerCondition] })], "rsv-1", {
      answersByQuestionId,
      answerIdByQuestionId: new Map(),
      sessionAttributes: new Map(),
    });
    expect(result[0]?.sourceAnswerId).toBeNull();
  });

  it("sourceAnswerId ist null, wenn die Regel keine ANSWER-Condition hat", () => {
    const productOnlyCondition: ConditionInput = {
      id: "c1",
      groupIndex: 0,
      sourceType: "SESSION_ATTRIBUTE",
      attributeKey: "consultationType",
      operator: "EQUALS",
      comparisonValue: "NEW_CONTRACT",
    };
    const sessionAttributes = new Map([["consultationType", "NEW_CONTRACT"]]);
    const result = evaluateCrossSellingRules(
      [rule({ conditions: [productOnlyCondition] })],
      "rsv-1",
      { answersByQuestionId: new Map(), answerIdByQuestionId: new Map(), sessionAttributes },
    );
    expect(result[0]?.sourceAnswerId).toBeNull();
  });

  it("PRODUCT_ATTRIBUTE-Conditions evaluieren gegen eine leere Map (immer 'nicht gesetzt')", () => {
    const productAttributeCondition: ConditionInput = {
      id: "c1",
      groupIndex: 0,
      sourceType: "PRODUCT_ATTRIBUTE",
      attributeKey: "hasEuRoaming",
      operator: "EQUALS",
      comparisonValue: "true",
    };
    const result = evaluateCrossSellingRules(
      [rule({ conditions: [productAttributeCondition] })],
      "rsv-1",
      {
        answersByQuestionId: new Map(),
        answerIdByQuestionId: new Map(),
        sessionAttributes: new Map(),
      },
    );
    expect(result).toEqual([]);

    const isNotAnsweredCondition: ConditionInput = {
      ...productAttributeCondition,
      operator: "IS_NOT_ANSWERED",
    };
    const matched = evaluateCrossSellingRules(
      [rule({ conditions: [isNotAnsweredCondition] })],
      "rsv-1",
      {
        answersByQuestionId: new Map(),
        answerIdByQuestionId: new Map(),
        sessionAttributes: new Map(),
      },
    );
    expect(matched).toHaveLength(1);
  });
});
