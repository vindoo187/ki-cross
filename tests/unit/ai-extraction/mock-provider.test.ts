import { describe, expect, it } from "vitest";
import {
  extractDeterministicCandidates,
  MockExtractionProvider,
} from "@/server/ai-extraction/providers/mock-provider";
import type { AiExtractionVisibleQuestion } from "@/server/ai-extraction/types";

/**
 * Unit-Tests fuer `mock-provider.ts` (Phase 12 AP1, ChatGPT-Schicht 3 "AI
 * Extraction"). Rein synchron/pure (keine DB-Zugriffe), daher `tests/unit/`.
 * Wichtigster Testfall (ChatGPT-Anforderung, siehe
 * PHASE_12_IMPLEMENTATION_PLAN.md Abschnitt 1): der Contract-Determinismus-
 * Test -- gleicher Input + gleicher sichtbarer Fragenkatalog muss exakt
 * gleiche Kandidaten liefern.
 */

const BOOLEAN_QUESTION: AiExtractionVisibleQuestion = {
  questionId: "q-roaming",
  label: "EU-Roaming gewuenscht",
  answerType: "BOOLEAN",
  answerOptions: [],
  minValue: null,
  maxValue: null,
  maxLength: null,
  minSelections: null,
  maxSelections: null,
};

const SINGLE_CHOICE_QUESTION: AiExtractionVisibleQuestion = {
  questionId: "q-volumen",
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
  questionId: "q-optionen",
  label: "Zusatzoptionen",
  answerType: "MULTIPLE_CHOICE",
  answerOptions: [
    { key: "streaming", label: "Streaming-Paket" },
    { key: "musik", label: "Musik-Flat" },
  ],
  minValue: null,
  maxValue: null,
  maxLength: null,
  minSelections: null,
  maxSelections: null,
};

const INTEGER_QUESTION: AiExtractionVisibleQuestion = {
  questionId: "q-laufzeit",
  label: "Vertragslaufzeit in Monaten",
  answerType: "INTEGER",
  answerOptions: [],
  minValue: null,
  maxValue: null,
  maxLength: null,
  minSelections: null,
  maxSelections: null,
};

const DECIMAL_QUESTION: AiExtractionVisibleQuestion = {
  questionId: "q-budget",
  label: "Monatliches Budget",
  answerType: "DECIMAL",
  answerOptions: [],
  minValue: null,
  maxValue: null,
  maxLength: null,
  minSelections: null,
  maxSelections: null,
};

const DATE_QUESTION: AiExtractionVisibleQuestion = {
  questionId: "q-kuendigung",
  label: "Kuendigungsdatum bestehender Vertrag",
  answerType: "DATE",
  answerOptions: [],
  minValue: null,
  maxValue: null,
  maxLength: null,
  minSelections: null,
  maxSelections: null,
};

describe("mock-provider", () => {
  it("Contract-Determinismus: gleicher Input + gleicher Fragenkatalog -> exakt gleiche Kandidaten", () => {
    const freeText =
      "Kunde wuenscht 50 GB Datenvolumen und EU-Roaming, Vertrag laeuft am 2026-09-30 aus.";
    const visibleQuestions = [BOOLEAN_QUESTION, SINGLE_CHOICE_QUESTION, DATE_QUESTION];

    const first = extractDeterministicCandidates(freeText, visibleQuestions);
    const second = extractDeterministicCandidates(freeText, visibleQuestions);

    expect(second).toEqual(first);
    expect(first.length).toBeGreaterThan(0);
  });

  it("erkennt eine BOOLEAN-Frage anhand eines Stichworts aus dem Fragetext", () => {
    const candidates = extractDeterministicCandidates("Der Kunde moechte EU-Roaming.", [
      BOOLEAN_QUESTION,
    ]);
    expect(candidates).toEqual([
      { questionId: "q-roaming", answerType: "BOOLEAN", booleanValue: true },
    ]);
  });

  it("schlaegt keinen BOOLEAN-Kandidaten vor, wenn kein Stichwort vorkommt", () => {
    const candidates = extractDeterministicCandidates("Der Kunde ist unschluessig.", [
      BOOLEAN_QUESTION,
    ]);
    expect(candidates).toEqual([]);
  });

  it("erkennt SINGLE_CHOICE bei genau einem Options-Treffer", () => {
    const candidates = extractDeterministicCandidates("Bitte 50 GB einplanen.", [
      SINGLE_CHOICE_QUESTION,
    ]);
    expect(candidates).toEqual([
      { questionId: "q-volumen", answerType: "SINGLE_CHOICE", choiceValues: ["gb_50"] },
    ]);
  });

  it("schlaegt bei SINGLE_CHOICE nichts vor, wenn mehrere Optionen im Text vorkommen (Mehrdeutigkeit)", () => {
    const candidates = extractDeterministicCandidates(
      "Der Kunde ueberlegt zwischen 10 GB und 50 GB.",
      [SINGLE_CHOICE_QUESTION],
    );
    expect(candidates).toEqual([]);
  });

  it("erkennt MULTIPLE_CHOICE bei mehreren Options-Treffern", () => {
    const candidates = extractDeterministicCandidates(
      "Gewuenscht: Streaming-Paket und Musik-Flat.",
      [MULTIPLE_CHOICE_QUESTION],
    );
    const candidate = candidates[0];
    expect(candidate?.questionId).toBe("q-optionen");
    expect(new Set(candidate?.choiceValues)).toEqual(new Set(["streaming", "musik"]));
  });

  it("erkennt INTEGER bei genau einer Zahl und genau einer INTEGER-Frage", () => {
    const candidates = extractDeterministicCandidates("Vertragslaufzeit soll 24 Monate sein.", [
      INTEGER_QUESTION,
    ]);
    expect(candidates).toEqual([
      { questionId: "q-laufzeit", answerType: "INTEGER", integerValue: 24 },
    ]);
  });

  it("schlaegt bei mehreren Zahlen und mehreren INTEGER-Fragen nichts vor (nicht eindeutig zuordenbar)", () => {
    const laufzeit2: AiExtractionVisibleQuestion = {
      ...INTEGER_QUESTION,
      questionId: "q-laufzeit-2",
    };
    const candidates = extractDeterministicCandidates("24 Monate, 5 Geraete.", [
      INTEGER_QUESTION,
      laufzeit2,
    ]);
    expect(candidates).toEqual([]);
  });

  it("erkennt DECIMAL bei genau einer Dezimalzahl und genau einer DECIMAL-Frage", () => {
    const candidates = extractDeterministicCandidates("Budget liegt bei 19,99 Euro.", [
      DECIMAL_QUESTION,
    ]);
    expect(candidates).toEqual([
      { questionId: "q-budget", answerType: "DECIMAL", decimalValue: "19.99" },
    ]);
  });

  it("erkennt ISO-Datum bei genau einem Datum und genau einer DATE-Frage", () => {
    const candidates = extractDeterministicCandidates("Kuendigung zum 2026-09-30.", [
      DATE_QUESTION,
    ]);
    expect(candidates).toEqual([
      { questionId: "q-kuendigung", answerType: "DATE", dateValue: "2026-09-30" },
    ]);
  });

  it("erkennt deutsches Datumsformat und wandelt es nach ISO um", () => {
    const candidates = extractDeterministicCandidates("Kuendigung zum 30.09.2026.", [
      DATE_QUESTION,
    ]);
    expect(candidates).toEqual([
      { questionId: "q-kuendigung", answerType: "DATE", dateValue: "2026-09-30" },
    ]);
  });

  it("verwechselt ein deutsches Datum nicht mit einer Dezimalzahl", () => {
    const candidates = extractDeterministicCandidates("Kuendigung zum 30.09.2026, Budget offen.", [
      DATE_QUESTION,
      DECIMAL_QUESTION,
    ]);
    expect(candidates).toEqual([
      { questionId: "q-kuendigung", answerType: "DATE", dateValue: "2026-09-30" },
    ]);
  });

  it("liefert eine leere Kandidatenliste bei komplett unpassendem Freitext", () => {
    const candidates = extractDeterministicCandidates("Kunde moechte nur Informationsmaterial.", [
      BOOLEAN_QUESTION,
      SINGLE_CHOICE_QUESTION,
      INTEGER_QUESTION,
    ]);
    expect(candidates).toEqual([]);
  });

  it("MockExtractionProvider.extract() liefert dasselbe Ergebnis wie extractDeterministicCandidates()", async () => {
    const provider = new MockExtractionProvider();
    const freeText = "Der Kunde moechte EU-Roaming.";
    const result = await provider.extract({ freeText, visibleQuestions: [BOOLEAN_QUESTION] });
    expect(result).toEqual(extractDeterministicCandidates(freeText, [BOOLEAN_QUESTION]));
  });
});
