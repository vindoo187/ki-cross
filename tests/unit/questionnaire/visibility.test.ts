import { describe, expect, it } from "vitest";
import {
  evaluateSingleCondition,
  isOperatorSupportedForAnswerType,
  isQuestionVisible,
  OPERATORS_BY_ANSWER_TYPE,
  validateVisibilityGraph,
} from "@/server/questionnaire/visibility";
import { MixedCombinatorError, VisibilityCycleError } from "@/server/questionnaire/errors";
import type {
  AnsweredValue,
  QuestionNode,
  VisibilityConditionInput,
} from "@/server/questionnaire/types";

function condition(overrides: Partial<VisibilityConditionInput> = {}): VisibilityConditionInput {
  return {
    id: "cond-1",
    targetQuestionId: "q-target",
    operator: "EQUALS",
    comparisonValue: "yes",
    combinator: "AND",
    ...overrides,
  };
}

describe("evaluateSingleCondition", () => {
  it("IS_ANSWERED / IS_NOT_ANSWERED ignorieren den Antworttyp", () => {
    expect(evaluateSingleCondition(condition({ operator: "IS_ANSWERED" }), undefined)).toBe(false);
    expect(evaluateSingleCondition(condition({ operator: "IS_NOT_ANSWERED" }), undefined)).toBe(
      true,
    );
    const answered: AnsweredValue = { answerType: "BOOLEAN", isAnswered: true, booleanValue: true };
    expect(evaluateSingleCondition(condition({ operator: "IS_ANSWERED" }), answered)).toBe(true);
  });

  it("liefert false fuer alle anderen Operatoren, wenn unbeantwortet", () => {
    expect(evaluateSingleCondition(condition({ operator: "EQUALS" }), undefined)).toBe(false);
    const notAnswered: AnsweredValue = { answerType: "BOOLEAN", isAnswered: false };
    expect(evaluateSingleCondition(condition({ operator: "EQUALS" }), notAnswered)).toBe(false);
  });

  it("BOOLEAN: EQUALS/NOT_EQUALS", () => {
    const answer: AnsweredValue = { answerType: "BOOLEAN", isAnswered: true, booleanValue: true };
    expect(
      evaluateSingleCondition(condition({ operator: "EQUALS", comparisonValue: "true" }), answer),
    ).toBe(true);
    expect(
      evaluateSingleCondition(condition({ operator: "EQUALS", comparisonValue: "false" }), answer),
    ).toBe(false);
    expect(
      evaluateSingleCondition(
        condition({ operator: "NOT_EQUALS", comparisonValue: "false" }),
        answer,
      ),
    ).toBe(true);
  });

  it("SINGLE_CHOICE: EQUALS/IN/NOT_IN", () => {
    const answer: AnsweredValue = {
      answerType: "SINGLE_CHOICE",
      isAnswered: true,
      choiceValues: ["business"],
    };
    expect(
      evaluateSingleCondition(
        condition({ operator: "EQUALS", comparisonValue: "business" }),
        answer,
      ),
    ).toBe(true);
    expect(
      evaluateSingleCondition(
        condition({ operator: "IN", comparisonValue: "private, business" }),
        answer,
      ),
    ).toBe(true);
    expect(
      evaluateSingleCondition(
        condition({ operator: "NOT_IN", comparisonValue: "private" }),
        answer,
      ),
    ).toBe(true);
  });

  it("MULTIPLE_CHOICE: CONTAINS/EQUALS/IN", () => {
    const answer: AnsweredValue = {
      answerType: "MULTIPLE_CHOICE",
      isAnswered: true,
      choiceValues: ["dsl", "mobile"],
    };
    expect(
      evaluateSingleCondition(condition({ operator: "CONTAINS", comparisonValue: "dsl" }), answer),
    ).toBe(true);
    expect(
      evaluateSingleCondition(
        condition({ operator: "EQUALS", comparisonValue: "mobile, dsl" }),
        answer,
      ),
    ).toBe(true);
    expect(
      evaluateSingleCondition(condition({ operator: "IN", comparisonValue: "fiber" }), answer),
    ).toBe(false);
  });

  it("INTEGER: GREATER_THAN/LESS_THAN_OR_EQUAL", () => {
    const answer: AnsweredValue = { answerType: "INTEGER", isAnswered: true, integerValue: 42 };
    expect(
      evaluateSingleCondition(
        condition({ operator: "GREATER_THAN", comparisonValue: "40" }),
        answer,
      ),
    ).toBe(true);
    expect(
      evaluateSingleCondition(
        condition({ operator: "LESS_THAN_OR_EQUAL", comparisonValue: "42" }),
        answer,
      ),
    ).toBe(true);
    expect(
      evaluateSingleCondition(condition({ operator: "LESS_THAN", comparisonValue: "42" }), answer),
    ).toBe(false);
  });

  it("DECIMAL: vergleicht ohne Float-Ungenauigkeit", () => {
    const answer: AnsweredValue = {
      answerType: "DECIMAL",
      isAnswered: true,
      decimalValue: "0.3000",
    };
    expect(
      evaluateSingleCondition(
        condition({ operator: "GREATER_THAN", comparisonValue: "0.1" }),
        answer,
      ),
    ).toBe(true);
    expect(
      evaluateSingleCondition(condition({ operator: "EQUALS", comparisonValue: "0.3" }), answer),
    ).toBe(true);
  });

  it("DATE: vergleicht ISO-Datumswerte", () => {
    const answer: AnsweredValue = {
      answerType: "DATE",
      isAnswered: true,
      dateValue: "2026-06-01T00:00:00.000Z",
    };
    expect(
      evaluateSingleCondition(
        condition({ operator: "GREATER_THAN_OR_EQUAL", comparisonValue: "2026-01-01" }),
        answer,
      ),
    ).toBe(true);
    expect(
      evaluateSingleCondition(
        condition({ operator: "LESS_THAN", comparisonValue: "2026-01-01" }),
        answer,
      ),
    ).toBe(false);
  });

  it("SHORT_TEXT als Bedingungsziel wirft (Freitext darf nie fuer Bedingungen verwendet werden)", () => {
    const answer: AnsweredValue = {
      answerType: "SHORT_TEXT",
      isAnswered: true,
    };
    expect(() => evaluateSingleCondition(condition({ operator: "EQUALS" }), answer)).toThrow(
      /Freitext/,
    );
  });
});

function questionNode(overrides: Partial<QuestionNode> = {}): QuestionNode {
  return {
    questionId: "q-1",
    sortOrder: 1,
    activeVersion: {
      id: "qv-1",
      answerType: "BOOLEAN",
      isRequired: false,
      answerOptions: [],
    },
    visibilityConditions: [],
    ...overrides,
  };
}

describe("isQuestionVisible", () => {
  it("ist ohne Bedingungen immer sichtbar", () => {
    expect(isQuestionVisible(questionNode(), new Map())).toBe(true);
  });

  it("AND-Gruppe: nur sichtbar, wenn ALLE Bedingungen erfuellt sind", () => {
    const node = questionNode({
      visibilityConditions: [
        condition({ targetQuestionId: "a", operator: "IS_ANSWERED", combinator: "AND" }),
        condition({ targetQuestionId: "b", operator: "IS_ANSWERED", combinator: "AND" }),
      ],
    });
    const bothAnswered = new Map<string, AnsweredValue>([
      ["a", { answerType: "BOOLEAN", isAnswered: true }],
      ["b", { answerType: "BOOLEAN", isAnswered: true }],
    ]);
    const onlyOneAnswered = new Map<string, AnsweredValue>([
      ["a", { answerType: "BOOLEAN", isAnswered: true }],
      ["b", { answerType: "BOOLEAN", isAnswered: false }],
    ]);
    expect(isQuestionVisible(node, bothAnswered)).toBe(true);
    expect(isQuestionVisible(node, onlyOneAnswered)).toBe(false);
  });

  it("OR-Gruppe: sichtbar, wenn MINDESTENS EINE Bedingung erfuellt ist", () => {
    const node = questionNode({
      visibilityConditions: [
        condition({ targetQuestionId: "a", operator: "IS_ANSWERED", combinator: "OR" }),
        condition({ targetQuestionId: "b", operator: "IS_ANSWERED", combinator: "OR" }),
      ],
    });
    const onlyOneAnswered = new Map<string, AnsweredValue>([
      ["a", { answerType: "BOOLEAN", isAnswered: true }],
      ["b", { answerType: "BOOLEAN", isAnswered: false }],
    ]);
    expect(isQuestionVisible(node, onlyOneAnswered)).toBe(true);
  });

  it("wirft MixedCombinatorError bei gemischten Kombinatoren", () => {
    const node = questionNode({
      visibilityConditions: [
        condition({ targetQuestionId: "a", combinator: "AND" }),
        condition({ targetQuestionId: "b", combinator: "OR" }),
      ],
    });
    expect(() => isQuestionVisible(node, new Map())).toThrow(MixedCombinatorError);
  });
});

describe("OPERATORS_BY_ANSWER_TYPE / isOperatorSupportedForAnswerType", () => {
  it("SHORT_TEXT unterstuetzt keinerlei Operatoren (Freitext darf nie Bedingungsziel sein)", () => {
    expect(OPERATORS_BY_ANSWER_TYPE.SHORT_TEXT.size).toBe(0);
    expect(isOperatorSupportedForAnswerType("EQUALS", "SHORT_TEXT")).toBe(false);
    expect(isOperatorSupportedForAnswerType("IS_ANSWERED", "SHORT_TEXT")).toBe(false);
  });

  it("BOOLEAN unterstuetzt nur Gleichheits- und Beantwortungs-Operatoren", () => {
    expect(isOperatorSupportedForAnswerType("EQUALS", "BOOLEAN")).toBe(true);
    expect(isOperatorSupportedForAnswerType("NOT_EQUALS", "BOOLEAN")).toBe(true);
    expect(isOperatorSupportedForAnswerType("IS_ANSWERED", "BOOLEAN")).toBe(true);
    expect(isOperatorSupportedForAnswerType("GREATER_THAN", "BOOLEAN")).toBe(false);
    expect(isOperatorSupportedForAnswerType("CONTAINS", "BOOLEAN")).toBe(false);
  });

  it("INTEGER/DECIMAL/DATE unterstuetzen Groessenvergleiche, SINGLE_CHOICE nicht", () => {
    expect(isOperatorSupportedForAnswerType("GREATER_THAN", "INTEGER")).toBe(true);
    expect(isOperatorSupportedForAnswerType("GREATER_THAN", "DECIMAL")).toBe(true);
    expect(isOperatorSupportedForAnswerType("GREATER_THAN", "DATE")).toBe(true);
    expect(isOperatorSupportedForAnswerType("GREATER_THAN", "SINGLE_CHOICE")).toBe(false);
  });

  it("nur MULTIPLE_CHOICE unterstuetzt CONTAINS", () => {
    expect(isOperatorSupportedForAnswerType("CONTAINS", "MULTIPLE_CHOICE")).toBe(true);
    expect(isOperatorSupportedForAnswerType("CONTAINS", "SINGLE_CHOICE")).toBe(false);
    expect(isOperatorSupportedForAnswerType("CONTAINS", "INTEGER")).toBe(false);
  });
});

describe("validateVisibilityGraph", () => {
  it("akzeptiert einen zyklenfreien Graphen", () => {
    const nodes = [
      questionNode({ questionId: "q1" }),
      questionNode({
        questionId: "q2",
        visibilityConditions: [condition({ targetQuestionId: "q1" })],
      }),
    ];
    expect(() => validateVisibilityGraph(nodes)).not.toThrow();
  });

  it("wirft VisibilityCycleError bei einem Zyklus (q1 -> q2 -> q1)", () => {
    const nodes = [
      questionNode({
        questionId: "q1",
        visibilityConditions: [condition({ targetQuestionId: "q2" })],
      }),
      questionNode({
        questionId: "q2",
        visibilityConditions: [condition({ targetQuestionId: "q1" })],
      }),
    ];
    expect(() => validateVisibilityGraph(nodes)).toThrow(VisibilityCycleError);
  });

  it("wirft bei Referenz auf eine fragebogen-fremde Zielfrage", () => {
    const nodes = [
      questionNode({
        questionId: "q1",
        visibilityConditions: [condition({ targetQuestionId: "does-not-exist" })],
      }),
    ];
    expect(() => validateVisibilityGraph(nodes)).toThrow(/fragebogen-fremde/);
  });

  it("wirft MixedCombinatorError, wenn eine Frage gemischte Kombinatoren hat", () => {
    const nodes = [
      questionNode({
        questionId: "q1",
        visibilityConditions: [
          condition({ targetQuestionId: "q2", combinator: "AND" }),
          condition({ targetQuestionId: "q3", combinator: "OR" }),
        ],
      }),
      questionNode({ questionId: "q2" }),
      questionNode({ questionId: "q3" }),
    ];
    expect(() => validateVisibilityGraph(nodes)).toThrow(MixedCombinatorError);
  });
});
