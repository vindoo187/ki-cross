import { describe, expect, it } from "vitest";
import { validateExtractionCandidates } from "@/server/ai-extraction/extraction-validator";
import type {
  AiExtractionCandidate,
  AiExtractionVisibleQuestion,
} from "@/server/ai-extraction/types";

/**
 * Unit-Tests fuer `extraction-validator.ts` (Phase 12 AP1, ChatGPT-Schicht 4
 * "Server Validation"). Rein synchron/pure (keine DB-Zugriffe), daher
 * `tests/unit/` -- analog `tests/unit/questionnaire/answer-validation.test.ts`.
 * Deckt die drei extraktionsspezifischen Regeln ab (fragebogen-fremde/
 * unbekannte Frage, AnswerType-Mismatch, Mehrdeutigkeit) sowie die
 * Wiederverwendung von `validateAnswerInput()` fuer jeden Antworttyp.
 */

const BOOLEAN_QUESTION: AiExtractionVisibleQuestion = {
  questionId: "q-bool",
  label: "Wird EU-Roaming benoetigt?",
  answerType: "BOOLEAN",
  answerOptions: [],
  minValue: null,
  maxValue: null,
  maxLength: null,
  minSelections: null,
  maxSelections: null,
};

const INTEGER_QUESTION: AiExtractionVisibleQuestion = {
  questionId: "q-int",
  label: "Vertragslaufzeit in Monaten",
  answerType: "INTEGER",
  answerOptions: [],
  minValue: "1",
  maxValue: "36",
  maxLength: null,
  minSelections: null,
  maxSelections: null,
};

const SINGLE_CHOICE_QUESTION: AiExtractionVisibleQuestion = {
  questionId: "q-single",
  label: "Gewuenschtes Datenvolumen",
  answerType: "SINGLE_CHOICE",
  answerOptions: [
    { key: "gb_10", label: "10 GB" },
    { key: "gb_50", label: "50 GB" },
  ],
  minValue: null,
  maxValue: null,
  maxLength: null,
  minSelections: null,
  maxSelections: null,
};

const MULTIPLE_CHOICE_QUESTION: AiExtractionVisibleQuestion = {
  questionId: "q-multi",
  label: "Gewuenschte Zusatzoptionen",
  answerType: "MULTIPLE_CHOICE",
  answerOptions: [
    { key: "opt_a", label: "Option A" },
    { key: "opt_b", label: "Option B" },
  ],
  minValue: null,
  maxValue: null,
  maxLength: null,
  minSelections: 1,
  maxSelections: 2,
};

const VISIBLE_QUESTIONS = [
  BOOLEAN_QUESTION,
  INTEGER_QUESTION,
  SINGLE_CHOICE_QUESTION,
  MULTIPLE_CHOICE_QUESTION,
];

describe("extraction-validator", () => {
  it("akzeptiert einen gueltigen BOOLEAN-Kandidaten", () => {
    const candidate: AiExtractionCandidate = {
      questionId: "q-bool",
      answerType: "BOOLEAN",
      booleanValue: true,
    };
    const result = validateExtractionCandidates(VISIBLE_QUESTIONS, [candidate]);
    expect(result.accepted).toEqual([candidate]);
    expect(result.rejected).toEqual([]);
  });

  it("akzeptiert einen gueltigen INTEGER-Kandidaten innerhalb min/max", () => {
    const candidate: AiExtractionCandidate = {
      questionId: "q-int",
      answerType: "INTEGER",
      integerValue: 24,
    };
    const result = validateExtractionCandidates(VISIBLE_QUESTIONS, [candidate]);
    expect(result.accepted).toEqual([candidate]);
  });

  it("verwirft einen INTEGER-Kandidaten ausserhalb von max", () => {
    const candidate: AiExtractionCandidate = {
      questionId: "q-int",
      answerType: "INTEGER",
      integerValue: 999,
    };
    const result = validateExtractionCandidates(VISIBLE_QUESTIONS, [candidate]);
    expect(result.accepted).toEqual([]);
    expect(result.rejected[0]?.questionId).toBe("q-int");
    expect(result.rejected[0]?.reasons.join(" ")).toContain("<=");
  });

  it("akzeptiert einen gueltigen SINGLE_CHOICE-Kandidaten", () => {
    const candidate: AiExtractionCandidate = {
      questionId: "q-single",
      answerType: "SINGLE_CHOICE",
      choiceValues: ["gb_50"],
    };
    const result = validateExtractionCandidates(VISIBLE_QUESTIONS, [candidate]);
    expect(result.accepted).toEqual([candidate]);
  });

  it("verwirft einen SINGLE_CHOICE-Kandidaten mit unbekanntem Options-Key", () => {
    const candidate: AiExtractionCandidate = {
      questionId: "q-single",
      answerType: "SINGLE_CHOICE",
      choiceValues: ["gb_erfunden"],
    };
    const result = validateExtractionCandidates(VISIBLE_QUESTIONS, [candidate]);
    expect(result.accepted).toEqual([]);
    expect(result.rejected[0]?.reasons.join(" ")).toContain("gueltige AnswerOption");
  });

  it("akzeptiert einen gueltigen MULTIPLE_CHOICE-Kandidaten innerhalb der Auswahlgrenzen", () => {
    const candidate: AiExtractionCandidate = {
      questionId: "q-multi",
      answerType: "MULTIPLE_CHOICE",
      choiceValues: ["opt_a", "opt_b"],
    };
    const result = validateExtractionCandidates(VISIBLE_QUESTIONS, [candidate]);
    expect(result.accepted).toEqual([candidate]);
  });

  it("verwirft einen Kandidaten fuer eine nicht im sichtbaren Katalog enthaltene Frage", () => {
    const candidate: AiExtractionCandidate = {
      questionId: "q-unbekannt",
      answerType: "BOOLEAN",
      booleanValue: true,
    };
    const result = validateExtractionCandidates(VISIBLE_QUESTIONS, [candidate]);
    expect(result.accepted).toEqual([]);
    expect(result.rejected[0]?.reasons.join(" ")).toContain(
      "nicht im sichtbaren, unbeantworteten Fragenkatalog",
    );
  });

  it("verwirft einen Kandidaten mit answerType-Mismatch (Provider behauptet falschen Typ)", () => {
    const candidate: AiExtractionCandidate = {
      questionId: "q-bool",
      answerType: "INTEGER",
      integerValue: 1,
    };
    const result = validateExtractionCandidates(VISIBLE_QUESTIONS, [candidate]);
    expect(result.accepted).toEqual([]);
    expect(result.rejected[0]?.reasons.join(" ")).toContain("passt nicht zum tatsaechlichen Typ");
  });

  it("verwirft BEIDE Kandidaten bei Mehrdeutigkeit (zwei Kandidaten fuer dieselbe Frage)", () => {
    const candidateA: AiExtractionCandidate = {
      questionId: "q-single",
      answerType: "SINGLE_CHOICE",
      choiceValues: ["gb_10"],
    };
    const candidateB: AiExtractionCandidate = {
      questionId: "q-single",
      answerType: "SINGLE_CHOICE",
      choiceValues: ["gb_50"],
    };
    const result = validateExtractionCandidates(VISIBLE_QUESTIONS, [candidateA, candidateB]);
    expect(result.accepted).toEqual([]);
    expect(result.rejected).toHaveLength(2);
    for (const rejection of result.rejected) {
      expect(rejection.reasons.join(" ")).toContain("Mehrdeutig");
    }
  });

  it("verwirft einen Kandidaten ohne gesetzten Wert", () => {
    const candidate: AiExtractionCandidate = { questionId: "q-bool", answerType: "BOOLEAN" };
    const result = validateExtractionCandidates(VISIBLE_QUESTIONS, [candidate]);
    expect(result.accepted).toEqual([]);
    expect(result.rejected[0]?.reasons.join(" ")).toContain("keinen gesetzten Wert");
  });

  it("liefert leere accepted/rejected-Listen bei leerer Kandidatenliste", () => {
    const result = validateExtractionCandidates(VISIBLE_QUESTIONS, []);
    expect(result.accepted).toEqual([]);
    expect(result.rejected).toEqual([]);
  });

  it("verarbeitet mehrere unabhaengige gueltige Kandidaten fuer verschiedene Fragen korrekt", () => {
    const candidates: AiExtractionCandidate[] = [
      { questionId: "q-bool", answerType: "BOOLEAN", booleanValue: false },
      { questionId: "q-int", answerType: "INTEGER", integerValue: 12 },
    ];
    const result = validateExtractionCandidates(VISIBLE_QUESTIONS, candidates);
    expect(result.accepted).toHaveLength(2);
    expect(result.rejected).toEqual([]);
  });
});
