/**
 * Unit-Tests fuer `src/lib/ai-suggestion-format.ts` (Phase 12 AP3,
 * ChatGPT-GO 2026-08-23). Reine Funktionen, kein DB-Zugriff.
 */
import { describe, expect, it } from "vitest";
import { candidateToAnswerValueInput, formatSuggestionValue } from "@/lib/ai-suggestion-format";
import type { AiExtractionCandidate } from "@/server/ai-extraction/types";
import type { QuestionForAnswering } from "@/server/questionnaire/service";

function buildQuestion(overrides: Partial<QuestionForAnswering> = {}): QuestionForAnswering {
  return {
    questionId: "question-1",
    questionVersionId: "question-version-1",
    label: "Frage",
    answerType: "SINGLE_CHOICE",
    isRequired: false,
    sortOrder: 1,
    answerOptions: [
      { key: "one", label: "Eine Person" },
      { key: "family", label: "Familie" },
    ],
    minValue: null,
    maxValue: null,
    maxLength: null,
    minSelections: null,
    maxSelections: null,
    currentAnswer: null,
    currentAnswerVersion: null,
    ...overrides,
  };
}

describe("candidateToAnswerValueInput", () => {
  it("INTEGER: setzt nur integerValue", () => {
    const candidate: AiExtractionCandidate = {
      questionId: "q1",
      answerType: "INTEGER",
      integerValue: 42,
    };
    expect(candidateToAnswerValueInput(candidate)).toEqual({ integerValue: 42 });
  });

  it("DECIMAL: setzt nur decimalValue", () => {
    const candidate: AiExtractionCandidate = {
      questionId: "q1",
      answerType: "DECIMAL",
      decimalValue: "19.99",
    };
    expect(candidateToAnswerValueInput(candidate)).toEqual({ decimalValue: "19.99" });
  });

  it("BOOLEAN: setzt nur booleanValue (auch false)", () => {
    const candidate: AiExtractionCandidate = {
      questionId: "q1",
      answerType: "BOOLEAN",
      booleanValue: false,
    };
    expect(candidateToAnswerValueInput(candidate)).toEqual({ booleanValue: false });
  });

  it("DATE: setzt nur dateValue", () => {
    const candidate: AiExtractionCandidate = {
      questionId: "q1",
      answerType: "DATE",
      dateValue: "2026-09-30",
    };
    expect(candidateToAnswerValueInput(candidate)).toEqual({ dateValue: "2026-09-30" });
  });

  it("SINGLE_CHOICE: setzt nur choiceValues", () => {
    const candidate: AiExtractionCandidate = {
      questionId: "q1",
      answerType: "SINGLE_CHOICE",
      choiceValues: ["family"],
    };
    expect(candidateToAnswerValueInput(candidate)).toEqual({ choiceValues: ["family"] });
  });

  it("MULTIPLE_CHOICE: setzt mehrere choiceValues", () => {
    const candidate: AiExtractionCandidate = {
      questionId: "q1",
      answerType: "MULTIPLE_CHOICE",
      choiceValues: ["a", "b"],
    };
    expect(candidateToAnswerValueInput(candidate)).toEqual({ choiceValues: ["a", "b"] });
  });

  it("SINGLE_CHOICE ohne choiceValues: liefert leeres Array (kein Absturz)", () => {
    const candidate: AiExtractionCandidate = {
      questionId: "q1",
      answerType: "SINGLE_CHOICE",
    };
    expect(candidateToAnswerValueInput(candidate)).toEqual({ choiceValues: [] });
  });
});

describe("formatSuggestionValue", () => {
  it("BOOLEAN true -> 'Ja'", () => {
    const question = buildQuestion({ answerType: "BOOLEAN", answerOptions: [] });
    const candidate: AiExtractionCandidate = {
      questionId: "q1",
      answerType: "BOOLEAN",
      booleanValue: true,
    };
    expect(formatSuggestionValue(candidate, question)).toBe("Ja");
  });

  it("BOOLEAN false -> 'Nein'", () => {
    const question = buildQuestion({ answerType: "BOOLEAN", answerOptions: [] });
    const candidate: AiExtractionCandidate = {
      questionId: "q1",
      answerType: "BOOLEAN",
      booleanValue: false,
    };
    expect(formatSuggestionValue(candidate, question)).toBe("Nein");
  });

  it("INTEGER: formatiert die Zahl als String", () => {
    const question = buildQuestion({ answerType: "INTEGER", answerOptions: [] });
    const candidate: AiExtractionCandidate = {
      questionId: "q1",
      answerType: "INTEGER",
      integerValue: 7,
    };
    expect(formatSuggestionValue(candidate, question)).toBe("7");
  });

  it("DECIMAL: gibt den Rohwert unveraendert zurueck", () => {
    const question = buildQuestion({ answerType: "DECIMAL", answerOptions: [] });
    const candidate: AiExtractionCandidate = {
      questionId: "q1",
      answerType: "DECIMAL",
      decimalValue: "39.90",
    };
    expect(formatSuggestionValue(candidate, question)).toBe("39.90");
  });

  it("DATE: formatiert als de-DE-Datum (identische Berechnung wie answer-formatting.ts, Timezone-robust)", () => {
    const question = buildQuestion({ answerType: "DATE", answerOptions: [] });
    const candidate: AiExtractionCandidate = {
      questionId: "q1",
      answerType: "DATE",
      dateValue: "2026-09-30",
    };
    expect(formatSuggestionValue(candidate, question)).toBe(
      new Date("2026-09-30").toLocaleDateString("de-DE"),
    );
  });

  it("SINGLE_CHOICE: loest den Options-Key zum Label auf", () => {
    const question = buildQuestion();
    const candidate: AiExtractionCandidate = {
      questionId: "q1",
      answerType: "SINGLE_CHOICE",
      choiceValues: ["family"],
    };
    expect(formatSuggestionValue(candidate, question)).toBe("Familie");
  });

  it("MULTIPLE_CHOICE: verbindet mehrere Labels mit Komma", () => {
    const question = buildQuestion({ answerType: "MULTIPLE_CHOICE" });
    const candidate: AiExtractionCandidate = {
      questionId: "q1",
      answerType: "MULTIPLE_CHOICE",
      choiceValues: ["one", "family"],
    };
    expect(formatSuggestionValue(candidate, question)).toBe("Eine Person, Familie");
  });

  it("SINGLE_CHOICE mit unbekanntem Key: faellt auf den Key selbst zurueck", () => {
    const question = buildQuestion();
    const candidate: AiExtractionCandidate = {
      questionId: "q1",
      answerType: "SINGLE_CHOICE",
      choiceValues: ["unbekannt"],
    };
    expect(formatSuggestionValue(candidate, question)).toBe("unbekannt");
  });

  it("ohne choiceValues: liefert Platzhalter '–'", () => {
    const question = buildQuestion();
    const candidate: AiExtractionCandidate = {
      questionId: "q1",
      answerType: "SINGLE_CHOICE",
    };
    expect(formatSuggestionValue(candidate, question)).toBe("–");
  });
});
