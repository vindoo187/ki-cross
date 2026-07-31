import { describe, expect, it } from "vitest";
import { hasAnswerValue, validateAnswerInput } from "@/server/questionnaire/answer-validation";
import { InvalidAnswerError } from "@/server/questionnaire/errors";
import type { AnswerValueInput, QuestionVersionConstraints } from "@/server/questionnaire/types";

function version(overrides: Partial<QuestionVersionConstraints> = {}): QuestionVersionConstraints {
  return {
    id: "qv-1",
    answerType: "BOOLEAN",
    isRequired: false,
    answerOptions: [],
    ...overrides,
  };
}

describe("validateAnswerInput", () => {
  it("akzeptiert eine leere Eingabe als 'keine Antwort'", () => {
    expect(() => validateAnswerInput(version(), {})).not.toThrow();
  });

  it("wirft, wenn Felder gesetzt sind, die nicht zum AnswerType passen", () => {
    const v = version({ answerType: "BOOLEAN" });
    const input: AnswerValueInput = { booleanValue: true, integerValue: 5 };
    expect(() => validateAnswerInput(v, input)).toThrow(InvalidAnswerError);
  });

  it("BOOLEAN: akzeptiert booleschen Wert", () => {
    const v = version({ answerType: "BOOLEAN" });
    expect(() => validateAnswerInput(v, { booleanValue: false })).not.toThrow();
  });

  it("INTEGER: prueft min/max", () => {
    const v = version({ answerType: "INTEGER", minValue: "0", maxValue: "10" });
    expect(() => validateAnswerInput(v, { integerValue: 5 })).not.toThrow();
    expect(() => validateAnswerInput(v, { integerValue: -1 })).toThrow(InvalidAnswerError);
    expect(() => validateAnswerInput(v, { integerValue: 11 })).toThrow(InvalidAnswerError);
    expect(() => validateAnswerInput(v, { integerValue: 1.5 })).toThrow(InvalidAnswerError);
  });

  it("DECIMAL: lehnt ungueltige Strings ab und prueft min/max ohne Float-Fehler", () => {
    const v = version({ answerType: "DECIMAL", minValue: "0.1", maxValue: "0.5" });
    expect(() => validateAnswerInput(v, { decimalValue: "0.3000" })).not.toThrow();
    expect(() => validateAnswerInput(v, { decimalValue: "0.05" })).toThrow(InvalidAnswerError);
    expect(() => validateAnswerInput(v, { decimalValue: "abc" })).toThrow(InvalidAnswerError);
  });

  it("SHORT_TEXT: prueft Nicht-Leer und maxLength", () => {
    const v = version({ answerType: "SHORT_TEXT", maxLength: 5 });
    expect(() => validateAnswerInput(v, { freeTextValue: "abc" })).not.toThrow();
    expect(() => validateAnswerInput(v, { freeTextValue: "" })).toThrow(InvalidAnswerError);
    expect(() => validateAnswerInput(v, { freeTextValue: "toolong" })).toThrow(InvalidAnswerError);
  });

  it("DATE: prueft ISO-8601-Format", () => {
    const v = version({ answerType: "DATE" });
    expect(() => validateAnswerInput(v, { dateValue: "2026-01-01" })).not.toThrow();
    expect(() => validateAnswerInput(v, { dateValue: "not-a-date" })).toThrow(InvalidAnswerError);
  });

  it("SINGLE_CHOICE: genau ein gueltiger Wert erforderlich", () => {
    const v = version({
      answerType: "SINGLE_CHOICE",
      answerOptions: [
        { key: "a", label: "A" },
        { key: "b", label: "B" },
      ],
    });
    expect(() => validateAnswerInput(v, { choiceValues: ["a"] })).not.toThrow();
    expect(() => validateAnswerInput(v, { choiceValues: ["a", "b"] })).toThrow(InvalidAnswerError);
    expect(() => validateAnswerInput(v, { choiceValues: ["x"] })).toThrow(InvalidAnswerError);
    expect(() => validateAnswerInput(v, { choiceValues: [] })).not.toThrow();
  });

  it("MULTIPLE_CHOICE: prueft Duplikate, gueltige Keys und min/maxSelections", () => {
    const v = version({
      answerType: "MULTIPLE_CHOICE",
      answerOptions: [
        { key: "a", label: "A" },
        { key: "b", label: "B" },
        { key: "c", label: "C" },
      ],
      minSelections: 1,
      maxSelections: 2,
    });
    expect(() => validateAnswerInput(v, { choiceValues: ["a", "b"] })).not.toThrow();
    expect(() => validateAnswerInput(v, { choiceValues: ["a", "a"] })).toThrow(InvalidAnswerError);
    expect(() => validateAnswerInput(v, { choiceValues: ["x"] })).toThrow(InvalidAnswerError);
    expect(() => validateAnswerInput(v, { choiceValues: ["a", "b", "c"] })).toThrow(
      InvalidAnswerError,
    );
  });

  it("sammelt mehrere Verstoesse gleichzeitig in InvalidAnswerError.issues", () => {
    const v = version({
      answerType: "MULTIPLE_CHOICE",
      answerOptions: [{ key: "a", label: "A" }],
      minSelections: 2,
    });
    try {
      validateAnswerInput(v, { choiceValues: ["x"] });
      expect.fail("sollte werfen");
    } catch (err) {
      expect(err).toBeInstanceOf(InvalidAnswerError);
      const issues = (err as InvalidAnswerError).issues;
      expect(issues.length).toBeGreaterThanOrEqual(2);
    }
  });
});

describe("hasAnswerValue", () => {
  it("erkennt gesetzte und leere Eingaben korrekt", () => {
    expect(hasAnswerValue({})).toBe(false);
    expect(hasAnswerValue({ booleanValue: false })).toBe(true);
    expect(hasAnswerValue({ choiceValues: [] })).toBe(false);
    expect(hasAnswerValue({ choiceValues: ["a"] })).toBe(true);
  });
});
