/**
 * Unit-Tests fuer `formatAnswerValue()` (AP9, siehe
 * PHASE_5_IMPLEMENTATION_PLAN.md Abschnitt 5, Schritt 10). Reine Logik,
 * keine DB -- plain Node vitest-Environment (kein jsdom noetig).
 */

import { describe, expect, it } from "vitest";
import { formatAnswerValue } from "@/server/consultation-ui/answer-formatting";
import type { QuestionForAnswering } from "@/server/questionnaire/service";
import type { AnswerType } from "@/server/questionnaire/types";

function makeQuestion(
  overrides: Partial<QuestionForAnswering> & { answerType: AnswerType },
): QuestionForAnswering {
  return {
    questionId: "q-1",
    questionVersionId: "qv-1",
    label: "Testfrage",
    isRequired: false,
    sortOrder: 1,
    answerOptions: [],
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

describe("formatAnswerValue", () => {
  it("liefert 'Nicht beantwortet' fuer currentAnswer === null, unabhaengig vom answerType", () => {
    const question = makeQuestion({ answerType: "SHORT_TEXT", currentAnswer: null });
    expect(formatAnswerValue(question)).toBe("Nicht beantwortet");
  });

  describe("SINGLE_CHOICE", () => {
    const answerOptions = [
      { key: "DSL", label: "DSL-Anschluss" },
      { key: "FIBER", label: "Glasfaser" },
    ];

    it("loest den gewaehlten Key auf das Options-Label auf", () => {
      const question = makeQuestion({
        answerType: "SINGLE_CHOICE",
        answerOptions,
        currentAnswer: { choiceValues: ["FIBER"] },
        currentAnswerVersion: 1,
      });
      expect(formatAnswerValue(question)).toBe("Glasfaser");
    });

    it("faellt auf den rohen Key zurueck, wenn er nicht in answerOptions vorkommt", () => {
      const question = makeQuestion({
        answerType: "SINGLE_CHOICE",
        answerOptions,
        currentAnswer: { choiceValues: ["UNBEKANNT"] },
        currentAnswerVersion: 1,
      });
      expect(formatAnswerValue(question)).toBe("UNBEKANNT");
    });

    it("liefert 'Nicht beantwortet' bei leerem choiceValues", () => {
      const question = makeQuestion({
        answerType: "SINGLE_CHOICE",
        answerOptions,
        currentAnswer: { choiceValues: [] },
        currentAnswerVersion: 1,
      });
      expect(formatAnswerValue(question)).toBe("Nicht beantwortet");
    });
  });

  describe("MULTIPLE_CHOICE", () => {
    const answerOptions = [
      { key: "STREAMING", label: "Streaming" },
      { key: "GAMING", label: "Gaming" },
      { key: "HOMEOFFICE", label: "Homeoffice" },
    ];

    it("verbindet mehrere aufgeloeste Labels mit Komma", () => {
      const question = makeQuestion({
        answerType: "MULTIPLE_CHOICE",
        answerOptions,
        currentAnswer: { choiceValues: ["STREAMING", "HOMEOFFICE"] },
        currentAnswerVersion: 1,
      });
      expect(formatAnswerValue(question)).toBe("Streaming, Homeoffice");
    });

    it("liefert 'Nicht beantwortet' bei leerem choiceValues", () => {
      const question = makeQuestion({
        answerType: "MULTIPLE_CHOICE",
        answerOptions,
        currentAnswer: { choiceValues: [] },
        currentAnswerVersion: 1,
      });
      expect(formatAnswerValue(question)).toBe("Nicht beantwortet");
    });
  });

  describe("BOOLEAN", () => {
    it("uebersetzt true zu 'Ja' und false zu 'Nein'", () => {
      const trueQuestion = makeQuestion({
        answerType: "BOOLEAN",
        currentAnswer: { booleanValue: true },
        currentAnswerVersion: 1,
      });
      const falseQuestion = makeQuestion({
        answerType: "BOOLEAN",
        currentAnswer: { booleanValue: false },
        currentAnswerVersion: 1,
      });
      expect(formatAnswerValue(trueQuestion)).toBe("Ja");
      expect(formatAnswerValue(falseQuestion)).toBe("Nein");
    });

    it("liefert 'Nicht beantwortet', wenn booleanValue fehlt", () => {
      const question = makeQuestion({
        answerType: "BOOLEAN",
        currentAnswer: {},
        currentAnswerVersion: 1,
      });
      expect(formatAnswerValue(question)).toBe("Nicht beantwortet");
    });
  });

  describe("INTEGER", () => {
    it("formatiert den Zahlenwert als String", () => {
      const question = makeQuestion({
        answerType: "INTEGER",
        currentAnswer: { integerValue: 42 },
        currentAnswerVersion: 1,
      });
      expect(formatAnswerValue(question)).toBe("42");
    });

    it("formatiert 0 korrekt (kein Falsy-Bug)", () => {
      const question = makeQuestion({
        answerType: "INTEGER",
        currentAnswer: { integerValue: 0 },
        currentAnswerVersion: 1,
      });
      expect(formatAnswerValue(question)).toBe("0");
    });
  });

  describe("DECIMAL", () => {
    it("zeigt den Dezimalwert unveraendert als String an", () => {
      const question = makeQuestion({
        answerType: "DECIMAL",
        currentAnswer: { decimalValue: "1234.5000" },
        currentAnswerVersion: 1,
      });
      expect(formatAnswerValue(question)).toBe("1234.5000");
    });
  });

  describe("DATE", () => {
    it("lokalisiert ein ISO-Datum als de-DE-Datumsstring", () => {
      const question = makeQuestion({
        answerType: "DATE",
        currentAnswer: { dateValue: "2026-08-01T00:00:00.000Z" },
        currentAnswerVersion: 1,
      });
      expect(formatAnswerValue(question)).toBe(
        new Date("2026-08-01T00:00:00.000Z").toLocaleDateString("de-DE"),
      );
    });
  });

  describe("SHORT_TEXT", () => {
    it("zeigt den Freitext an", () => {
      const question = makeQuestion({
        answerType: "SHORT_TEXT",
        currentAnswer: { freeTextValue: "Kunde wuenscht Rueckruf" },
        currentAnswerVersion: 1,
      });
      expect(formatAnswerValue(question)).toBe("Kunde wuenscht Rueckruf");
    });

    it("liefert 'Nicht beantwortet' bei leerem String", () => {
      const question = makeQuestion({
        answerType: "SHORT_TEXT",
        currentAnswer: { freeTextValue: "" },
        currentAnswerVersion: 1,
      });
      expect(formatAnswerValue(question)).toBe("Nicht beantwortet");
    });
  });
});
