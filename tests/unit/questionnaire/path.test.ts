import { describe, expect, it } from "vitest";
import {
  computeProgress,
  computeVisiblePath,
  findNewlyHiddenAnsweredQuestionIds,
  type VisibleQuestionSummary,
} from "@/server/questionnaire/path";
import type { AnsweredValue, QuestionNode } from "@/server/questionnaire/types";

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

describe("computeVisiblePath", () => {
  it("filtert unsichtbare Fragen heraus und sortiert nach sortOrder", () => {
    const nodes = [
      questionNode({ questionId: "q2", sortOrder: 2 }),
      questionNode({ questionId: "q1", sortOrder: 1 }),
      questionNode({
        questionId: "q3",
        sortOrder: 3,
        visibilityConditions: [
          {
            id: "c1",
            targetQuestionId: "q1",
            operator: "IS_ANSWERED",
            comparisonValue: "",
            combinator: "AND",
          },
        ],
      }),
    ];
    const answers = new Map<string, AnsweredValue>();
    const path = computeVisiblePath(nodes, answers);
    expect(path.map((p) => p.questionId)).toEqual(["q1", "q2"]);
  });

  it("markiert isAnswered korrekt anhand der Antwortkarte", () => {
    const nodes = [questionNode({ questionId: "q1", sortOrder: 1 })];
    const answers = new Map<string, AnsweredValue>([
      ["q1", { answerType: "BOOLEAN", isAnswered: true, booleanValue: true }],
    ]);
    const path = computeVisiblePath(nodes, answers);
    expect(path[0]?.isAnswered).toBe(true);
  });
});

describe("computeProgress", () => {
  function summary(overrides: Partial<VisibleQuestionSummary>): VisibleQuestionSummary {
    return { questionId: "q", sortOrder: 1, isRequired: false, isAnswered: false, ...overrides };
  }

  it("liefert 100% und canComplete=true bei leerem Pfad", () => {
    const progress = computeProgress([]);
    expect(progress.percentComplete).toBe(100);
    expect(progress.canComplete).toBe(true);
    expect(progress.nextQuestionId).toBeNull();
  });

  it("berechnet percentComplete, nextQuestionId und missingRequiredQuestionIds korrekt", () => {
    const path = [
      summary({ questionId: "q1", sortOrder: 1, isRequired: true, isAnswered: true }),
      summary({ questionId: "q2", sortOrder: 2, isRequired: true, isAnswered: false }),
      summary({ questionId: "q3", sortOrder: 3, isRequired: false, isAnswered: false }),
    ];
    const progress = computeProgress(path);
    expect(progress.totalVisibleQuestions).toBe(3);
    expect(progress.answeredVisibleQuestions).toBe(1);
    expect(progress.requiredVisibleQuestions).toBe(2);
    expect(progress.answeredRequiredVisibleQuestions).toBe(1);
    expect(progress.percentComplete).toBe(33);
    expect(progress.nextQuestionId).toBe("q2");
    expect(progress.missingRequiredQuestionIds).toEqual(["q2"]);
    expect(progress.canComplete).toBe(false);
  });

  it("canComplete=true, wenn alle sichtbaren Pflichtfragen beantwortet sind (optionale duerfen offen bleiben)", () => {
    const path = [
      summary({ questionId: "q1", isRequired: true, isAnswered: true }),
      summary({ questionId: "q2", isRequired: false, isAnswered: false }),
    ];
    const progress = computeProgress(path);
    expect(progress.canComplete).toBe(true);
    expect(progress.missingRequiredQuestionIds).toEqual([]);
  });
});

describe("findNewlyHiddenAnsweredQuestionIds", () => {
  function summary(overrides: Partial<VisibleQuestionSummary>): VisibleQuestionSummary {
    return { questionId: "q", sortOrder: 1, isRequired: false, isAnswered: false, ...overrides };
  }

  it("erkennt beantwortete Fragen, die nach einer Aenderung nicht mehr sichtbar sind", () => {
    const before = [
      summary({ questionId: "q1", isAnswered: true }),
      summary({ questionId: "q2", isAnswered: false }),
    ];
    const after = [summary({ questionId: "q2", isAnswered: false })];
    expect(findNewlyHiddenAnsweredQuestionIds(before, after)).toEqual(["q1"]);
  });

  it("ignoriert unbeantwortete Fragen, die verschwinden", () => {
    const before = [summary({ questionId: "q1", isAnswered: false })];
    const after: VisibleQuestionSummary[] = [];
    expect(findNewlyHiddenAnsweredQuestionIds(before, after)).toEqual([]);
  });

  it("liefert leeres Array, wenn nichts verschwindet", () => {
    const before = [summary({ questionId: "q1", isAnswered: true })];
    const after = [summary({ questionId: "q1", isAnswered: true })];
    expect(findNewlyHiddenAnsweredQuestionIds(before, after)).toEqual([]);
  });
});
