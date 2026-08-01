import { describe, expect, it } from "vitest";
import {
  buildFingerprintObject,
  canonicalizeAnswerValue,
  canonicalJsonStringify,
  computeEvaluationFingerprint,
  type FingerprintAnswerInput,
  type FingerprintInput,
} from "@/server/recommendation/fingerprint";

function baseInput(overrides: Partial<FingerprintInput> = {}): FingerprintInput {
  return {
    algorithmVersion: 1,
    tenantId: "tenant-1",
    sessionId: "session-1",
    questionnaireVersionId: "qv-1",
    ruleSetVersionId: "rsv-1",
    answers: [],
    productInputs: [],
    sessionAttributes: new Map(),
    commissionModelVersionIds: [],
    ...overrides,
  };
}

describe("canonicalizeAnswerValue", () => {
  it("BOOLEAN: nur true zaehlt als true", () => {
    expect(
      canonicalizeAnswerValue({ answerId: "a1", answerType: "BOOLEAN", booleanValue: true }),
    ).toBe(true);
    expect(
      canonicalizeAnswerValue({ answerId: "a1", answerType: "BOOLEAN", booleanValue: false }),
    ).toBe(false);
    expect(canonicalizeAnswerValue({ answerId: "a1", answerType: "BOOLEAN" })).toBe(false);
  });

  it("INTEGER: als String kanonisiert, null bei fehlendem Wert", () => {
    expect(
      canonicalizeAnswerValue({ answerId: "a1", answerType: "INTEGER", integerValue: 20 }),
    ).toBe("20");
    expect(canonicalizeAnswerValue({ answerId: "a1", answerType: "INTEGER" })).toBeNull();
  });

  it("DECIMAL: normalisiert auf 4 Nachkommastellen, damit '12.5' und '12.5000' gleich sind", () => {
    const a = canonicalizeAnswerValue({
      answerId: "a1",
      answerType: "DECIMAL",
      decimalValue: "12.5",
    });
    const b = canonicalizeAnswerValue({
      answerId: "a1",
      answerType: "DECIMAL",
      decimalValue: "12.5000",
    });
    expect(a).toBe(b);
    expect(a).toBe("12.5000");
  });

  it("DECIMAL: null bei fehlendem Wert", () => {
    expect(canonicalizeAnswerValue({ answerId: "a1", answerType: "DECIMAL" })).toBeNull();
  });

  it("SINGLE_CHOICE: erster Wert, null wenn leer", () => {
    expect(
      canonicalizeAnswerValue({
        answerId: "a1",
        answerType: "SINGLE_CHOICE",
        choiceValues: ["business"],
      }),
    ).toBe("business");
    expect(
      canonicalizeAnswerValue({ answerId: "a1", answerType: "SINGLE_CHOICE", choiceValues: [] }),
    ).toBeNull();
  });

  it("MULTIPLE_CHOICE: sortiert die Werte (Reihenfolge-unabhaengig)", () => {
    const a = canonicalizeAnswerValue({
      answerId: "a1",
      answerType: "MULTIPLE_CHOICE",
      choiceValues: ["b", "a"],
    });
    const b = canonicalizeAnswerValue({
      answerId: "a1",
      answerType: "MULTIPLE_CHOICE",
      choiceValues: ["a", "b"],
    });
    expect(a).toEqual(b);
    expect(a).toEqual(["a", "b"]);
  });

  it("DATE: Rohwert oder null", () => {
    expect(
      canonicalizeAnswerValue({
        answerId: "a1",
        answerType: "DATE",
        dateValue: "2026-01-01T00:00:00.000Z",
      }),
    ).toBe("2026-01-01T00:00:00.000Z");
    expect(canonicalizeAnswerValue({ answerId: "a1", answerType: "DATE" })).toBeNull();
  });

  it("SHORT_TEXT wirft (verboten fuer Fingerprints/Conditions)", () => {
    expect(() => canonicalizeAnswerValue({ answerId: "a1", answerType: "SHORT_TEXT" })).toThrow();
  });
});

describe("canonicalJsonStringify", () => {
  it("sortiert Objektschluessel rekursiv alphabetisch", () => {
    expect(canonicalJsonStringify({ b: 1, a: { d: 2, c: 3 } })).toBe('{"a":{"c":3,"d":2},"b":1}');
  });

  it("aendert die Array-Reihenfolge NICHT", () => {
    expect(canonicalJsonStringify([3, 1, 2])).toBe("[3,1,2]");
  });

  it("null/undefined werden als JSON null serialisiert", () => {
    expect(canonicalJsonStringify(null)).toBe("null");
    expect(canonicalJsonStringify(undefined)).toBe("null");
  });
});

describe("buildFingerprintObject", () => {
  it("sortiert answers nach answerId und productInputs nach productVersionId", () => {
    const answers: FingerprintAnswerInput[] = [
      { answerId: "z-answer", answerType: "BOOLEAN", booleanValue: true },
      { answerId: "a-answer", answerType: "BOOLEAN", booleanValue: false },
    ];
    const productInputs = [
      { productVersionId: "pv-z", attributes: new Map() },
      { productVersionId: "pv-a", attributes: new Map() },
    ];
    const result = buildFingerprintObject(baseInput({ answers, productInputs }));
    expect((result.answers as Array<{ answerId: string }>).map((a) => a.answerId)).toEqual([
      "a-answer",
      "z-answer",
    ]);
    expect(
      (result.productInputs as Array<{ productVersionId: string }>).map((p) => p.productVersionId),
    ).toEqual(["pv-a", "pv-z"]);
  });

  it("fehlendes PRODUCT_ATTRIBUTE wird als null aufgenommen (nicht weggelassen)", () => {
    const productInputs = [
      { productVersionId: "pv-1", attributes: new Map([["dataVolumeGb", "20"]]) },
    ];
    const result = buildFingerprintObject(baseInput({ productInputs }));
    const attributes = (result.productInputs as Array<{ attributes: Record<string, unknown> }>)[0]!
      .attributes;
    expect(attributes.dataVolumeGb).toBe(20);
    expect(attributes.hasEuRoaming).toBeNull();
    expect(attributes.pricePlanTier).toBeNull();
    expect(attributes.contractCommitmentMonths).toBeNull();
  });

  it("fehlendes SESSION_ATTRIBUTE wird als null aufgenommen", () => {
    const result = buildFingerprintObject(baseInput({ sessionAttributes: new Map() }));
    expect((result.sessionAttributes as Record<string, unknown>).consultationType).toBeNull();
  });

  it("commissionModelVersionIds werden sortiert", () => {
    const result = buildFingerprintObject(
      baseInput({ commissionModelVersionIds: ["cmv-z", "cmv-a"] }),
    );
    expect(result.commissionModelVersionIds).toEqual(["cmv-a", "cmv-z"]);
  });
});

describe("computeEvaluationFingerprint", () => {
  it("liefert einen 64-stelligen Hex-String (SHA-256)", () => {
    const fingerprint = computeEvaluationFingerprint(baseInput());
    expect(fingerprint).toMatch(/^[0-9a-f]{64}$/);
  });

  it("ist deterministisch fuer identische Inputs", () => {
    const a = computeEvaluationFingerprint(baseInput());
    const b = computeEvaluationFingerprint(baseInput());
    expect(a).toBe(b);
  });

  it("ist unabhaengig von der Einfuegereihenfolge der answers/productInputs-Arrays", () => {
    const answers: FingerprintAnswerInput[] = [
      { answerId: "a1", answerType: "BOOLEAN", booleanValue: true },
      { answerId: "a2", answerType: "BOOLEAN", booleanValue: false },
    ];
    const a = computeEvaluationFingerprint(baseInput({ answers }));
    const b = computeEvaluationFingerprint(baseInput({ answers: [...answers].reverse() }));
    expect(a).toBe(b);
  });

  it("ist unabhaengig von Gross-/Kleinschreibung bei BOOLEAN-Attributwerten ('true' vs 'TRUE')", () => {
    const a = computeEvaluationFingerprint(
      baseInput({
        sessionAttributes: new Map(),
        productInputs: [
          { productVersionId: "pv-1", attributes: new Map([["hasEuRoaming", "true"]]) },
        ],
      }),
    );
    const b = computeEvaluationFingerprint(
      baseInput({
        sessionAttributes: new Map(),
        productInputs: [
          { productVersionId: "pv-1", attributes: new Map([["hasEuRoaming", "TRUE"]]) },
        ],
      }),
    );
    expect(a).toBe(b);
  });

  it("aendert sich, wenn sich ein relevanter Input aendert", () => {
    const a = computeEvaluationFingerprint(baseInput({ sessionId: "session-1" }));
    const b = computeEvaluationFingerprint(baseInput({ sessionId: "session-2" }));
    expect(a).not.toBe(b);
  });

  it("aendert sich, wenn ein zuvor fehlendes Produktattribut ergaenzt wird", () => {
    const a = computeEvaluationFingerprint(
      baseInput({ productInputs: [{ productVersionId: "pv-1", attributes: new Map() }] }),
    );
    const b = computeEvaluationFingerprint(
      baseInput({
        productInputs: [
          { productVersionId: "pv-1", attributes: new Map([["dataVolumeGb", "20"]]) },
        ],
      }),
    );
    expect(a).not.toBe(b);
  });
});
