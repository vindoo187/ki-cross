import { describe, expect, it } from "vitest";
import {
  validateCreateGoalInput,
  validateCreateGoalVersionInput,
} from "@/server/admin/goal-validator";
import { GoalTargetValueInvalidError } from "@/server/admin/goal-admin-errors";
import type { CreateGoalInput, CreateGoalVersionInput } from "@/server/admin/goal-schemas";

/**
 * Unit-Tests fuer `goal-validator.ts` (Phase 11 AP3). Rein synchron/pure
 * (keine DB-Zugriffe), daher `tests/unit/` statt `tests/integration/` --
 * analog `contact-data-guard.test.ts`/`event-payload-schemas.test.ts`.
 * Deckt die von ChatGPT vorgegebene Metrik->Zielwert-Zuordnungstabelle und
 * die Currency-Regel vollstaendig ab (je gueltiger Fall + jede denkbare
 * Verletzung), siehe PHASE_11_IMPLEMENTATION_PLAN.md Abschnitt 2/3.
 */

const baseGoalInput = {
  scopeType: "TENANT",
  scopeId: "11111111-1111-1111-1111-111111111111",
  periodType: "MONTH",
  periodStart: new Date("2026-08-01T00:00:00Z"),
} as const;

function goalInput(overrides: Partial<CreateGoalInput>): CreateGoalInput {
  return { ...baseGoalInput, metricKey: "DEALS_CLOSED", ...overrides } as CreateGoalInput;
}

describe("goal-validator", () => {
  describe("validateCreateGoalInput() -- Metrik-Zielwert-Zuordnung", () => {
    it("DEALS_CLOSED mit targetCount ist gueltig", () => {
      expect(
        validateCreateGoalInput(goalInput({ metricKey: "DEALS_CLOSED", targetCount: 10 })),
      ).toEqual({ valid: true });
    });

    it("REVENUE mit targetAmountMinor + currency ist gueltig", () => {
      expect(
        validateCreateGoalInput(
          goalInput({ metricKey: "REVENUE", targetAmountMinor: 500000, currency: "EUR" }),
        ),
      ).toEqual({ valid: true });
    });

    it("CLOSE_RATE mit targetPercentageBasisPoints ist gueltig", () => {
      expect(
        validateCreateGoalInput(
          goalInput({ metricKey: "CLOSE_RATE", targetPercentageBasisPoints: 5000 }),
        ),
      ).toEqual({ valid: true });
    });

    it("DEALS_CLOSED ohne targetCount wirft GoalTargetValueInvalidError", () => {
      try {
        validateCreateGoalInput(goalInput({ metricKey: "DEALS_CLOSED" }));
        expect.fail("haette werfen muessen");
      } catch (err) {
        expect(err).toBeInstanceOf(GoalTargetValueInvalidError);
        const issues = (err as GoalTargetValueInvalidError).issues;
        expect(issues.some((i) => i.includes("DEALS_CLOSED") && i.includes("targetCount"))).toBe(
          true,
        );
      }
    });

    it("DEALS_CLOSED mit targetAmountMinor UND targetCount wirft (falsches Feld zusaetzlich gesetzt)", () => {
      try {
        validateCreateGoalInput(
          goalInput({ metricKey: "DEALS_CLOSED", targetCount: 5, targetAmountMinor: 100 }),
        );
        expect.fail("haette werfen muessen");
      } catch (err) {
        expect(err).toBeInstanceOf(GoalTargetValueInvalidError);
        const issues = (err as GoalTargetValueInvalidError).issues;
        expect(issues.some((i) => i.includes("targetAmountMinor"))).toBe(true);
      }
    });

    it("REVENUE mit targetCount statt targetAmountMinor wirft ZWEI Verstoesse (fehlendes + falsches Feld)", () => {
      try {
        validateCreateGoalInput(
          goalInput({ metricKey: "REVENUE", targetCount: 5, currency: "EUR" }),
        );
        expect.fail("haette werfen muessen");
      } catch (err) {
        expect(err).toBeInstanceOf(GoalTargetValueInvalidError);
        const issues = (err as GoalTargetValueInvalidError).issues;
        expect(issues.some((i) => i.includes("targetAmountMinor"))).toBe(true);
        expect(issues.some((i) => i.includes("targetCount"))).toBe(true);
      }
    });

    it("CLOSE_RATE mit targetAmountMinor statt targetPercentageBasisPoints wirft", () => {
      try {
        validateCreateGoalInput(goalInput({ metricKey: "CLOSE_RATE", targetAmountMinor: 100 }));
        expect.fail("haette werfen muessen");
      } catch (err) {
        expect(err).toBeInstanceOf(GoalTargetValueInvalidError);
      }
    });
  });

  describe("validateCreateGoalInput() -- Currency-Regel", () => {
    it("REVENUE ohne currency wirft", () => {
      try {
        validateCreateGoalInput(goalInput({ metricKey: "REVENUE", targetAmountMinor: 100 }));
        expect.fail("haette werfen muessen");
      } catch (err) {
        expect(err).toBeInstanceOf(GoalTargetValueInvalidError);
        const issues = (err as GoalTargetValueInvalidError).issues;
        expect(issues.some((i) => i.includes("REVENUE") && i.includes("currency"))).toBe(true);
      }
    });

    it("DEALS_CLOSED MIT currency wirft (keine Vermischung erlaubt)", () => {
      try {
        validateCreateGoalInput(
          goalInput({ metricKey: "DEALS_CLOSED", targetCount: 5, currency: "EUR" }),
        );
        expect.fail("haette werfen muessen");
      } catch (err) {
        expect(err).toBeInstanceOf(GoalTargetValueInvalidError);
        const issues = (err as GoalTargetValueInvalidError).issues;
        expect(issues.some((i) => i.includes("currency"))).toBe(true);
      }
    });

    it("CLOSE_RATE MIT currency wirft", () => {
      try {
        validateCreateGoalInput(
          goalInput({
            metricKey: "CLOSE_RATE",
            targetPercentageBasisPoints: 5000,
            currency: "USD",
          }),
        );
        expect.fail("haette werfen muessen");
      } catch (err) {
        expect(err).toBeInstanceOf(GoalTargetValueInvalidError);
      }
    });

    it("kombinierter Verstoss (falsches Zielwert-Feld UND falsche Currency) liefert BEIDE Issues", () => {
      try {
        validateCreateGoalInput(
          goalInput({ metricKey: "DEALS_CLOSED", targetAmountMinor: 100, currency: "EUR" }),
        );
        expect.fail("haette werfen muessen");
      } catch (err) {
        expect(err).toBeInstanceOf(GoalTargetValueInvalidError);
        const issues = (err as GoalTargetValueInvalidError).issues;
        // targetCount fehlt + targetAmountMinor verboten + currency verboten = 3 Verstoesse
        expect(issues.length).toBe(3);
      }
    });
  });

  describe("validateCreateGoalVersionInput() -- nur Zielwert-Zuordnung, kein currency-Feld", () => {
    function versionInput(overrides: Partial<CreateGoalVersionInput>): CreateGoalVersionInput {
      return { ...overrides } as CreateGoalVersionInput;
    }

    it("metricKey aus dem Goal wird korrekt gegen die GoalVersion-Eingabe geprueft (gueltig)", () => {
      expect(
        validateCreateGoalVersionInput("REVENUE", versionInput({ targetAmountMinor: 250000 })),
      ).toEqual({ valid: true });
    });

    it("falsches Feld fuer die uebergebene metricKey wirft", () => {
      try {
        validateCreateGoalVersionInput("REVENUE", versionInput({ targetCount: 5 }));
        expect.fail("haette werfen muessen");
      } catch (err) {
        expect(err).toBeInstanceOf(GoalTargetValueInvalidError);
      }
    });

    it("unbekannte metricKey (Defense-in-Depth) wirft mit erklaerender Meldung", () => {
      try {
        validateCreateGoalVersionInput("UNKNOWN_METRIC", versionInput({ targetCount: 5 }));
        expect.fail("haette werfen muessen");
      } catch (err) {
        expect(err).toBeInstanceOf(GoalTargetValueInvalidError);
        const issues = (err as GoalTargetValueInvalidError).issues;
        expect(issues.some((i) => i.includes("Unbekannter GoalMetricKey"))).toBe(true);
      }
    });
  });
});
