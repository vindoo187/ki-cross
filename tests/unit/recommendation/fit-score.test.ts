import { describe, expect, it } from "vitest";
import { computeCustomerFitScore, roundHalfUpFraction } from "@/server/recommendation/fit-score";
import type { EligibilityRuleMatch } from "@/server/recommendation/eligibility";
import type { EligibilityRuleInput } from "@/server/recommendation/types";

function eligibilityRule(overrides: Partial<EligibilityRuleInput> = {}): EligibilityRuleInput {
  return {
    id: "rule-1",
    key: "roaming_passt_zu_streaming_bedarf",
    isRequired: false,
    fitWeight: 0,
    conditions: [],
    ...overrides,
  };
}

describe("roundHalfUpFraction", () => {
  it("rundet exakte Werte korrekt", () => {
    expect(roundHalfUpFraction(50n, 100n)).toBe(1); // 0.5 -> round_half_up -> 1... siehe naechster Test fuer Praezision
  });

  it("round-half-up bei .5-Grenzfaellen (aufrunden, nicht banker's rounding)", () => {
    // 1/2 = 0.5 -> round_half_up -> 1
    expect(roundHalfUpFraction(1n, 2n)).toBe(1);
    // 3/2 = 1.5 -> round_half_up -> 2
    expect(roundHalfUpFraction(3n, 2n)).toBe(2);
    // 5/2 = 2.5 -> round_half_up -> 3
    expect(roundHalfUpFraction(5n, 2n)).toBe(3);
  });

  it("rundet ohne .5-Grenzfall normal", () => {
    expect(roundHalfUpFraction(1n, 3n)).toBe(0); // 0.333.. -> 0
    expect(roundHalfUpFraction(2n, 3n)).toBe(1); // 0.666.. -> 1
  });

  it("wirft bei denominator <= 0", () => {
    expect(() => roundHalfUpFraction(1n, 0n)).toThrow();
    expect(() => roundHalfUpFraction(1n, -1n)).toThrow();
  });

  it("wirft bei negativem numerator", () => {
    expect(() => roundHalfUpFraction(-1n, 1n)).toThrow();
  });
});

describe("computeCustomerFitScore", () => {
  it("keine Regeln -> 100 (no_weighted_eligibility_rules)", () => {
    expect(computeCustomerFitScore([])).toBe(100);
  });

  it("alle fitWeight <= 0 -> 100 (no_weighted_eligibility_rules)", () => {
    const matches: EligibilityRuleMatch[] = [
      { rule: eligibilityRule({ fitWeight: 0 }), matched: true },
      { rule: eligibilityRule({ key: "r2", fitWeight: -5 }), matched: false },
    ];
    expect(computeCustomerFitScore(matches)).toBe(100);
  });

  it("alle gewichteten Regeln getroffen -> 100", () => {
    const matches: EligibilityRuleMatch[] = [
      { rule: eligibilityRule({ fitWeight: 60 }), matched: true },
    ];
    expect(computeCustomerFitScore(matches)).toBe(100);
  });

  it("keine gewichtete Regel getroffen -> 0", () => {
    const matches: EligibilityRuleMatch[] = [
      { rule: eligibilityRule({ fitWeight: 60 }), matched: false },
    ];
    expect(computeCustomerFitScore(matches)).toBe(0);
  });

  it("teilweise getroffen: gewichteter Anteil, gerundet (round-half-up)", () => {
    // 60 von insgesamt 100 (60+40) getroffen -> 60%.
    const matches: EligibilityRuleMatch[] = [
      { rule: eligibilityRule({ key: "r1", fitWeight: 60 }), matched: true },
      { rule: eligibilityRule({ key: "r2", fitWeight: 40 }), matched: false },
    ];
    expect(computeCustomerFitScore(matches)).toBe(60);
  });

  it("nicht-gewichtete Regeln (fitWeight=0) fliessen nicht in die Summe ein", () => {
    const matches: EligibilityRuleMatch[] = [
      { rule: eligibilityRule({ key: "r1", fitWeight: 60 }), matched: true },
      { rule: eligibilityRule({ key: "r2", fitWeight: 0 }), matched: false },
    ];
    expect(computeCustomerFitScore(matches)).toBe(100);
  });

  it("Score ist auf [0, 100] geklemmt", () => {
    const matches: EligibilityRuleMatch[] = [
      { rule: eligibilityRule({ key: "r1", fitWeight: 1 }), matched: true },
    ];
    const score = computeCustomerFitScore(matches);
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(100);
  });
});
