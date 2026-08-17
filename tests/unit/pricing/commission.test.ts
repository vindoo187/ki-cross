import { describe, expect, it } from "vitest";
import { computeCommissionAmountMinor } from "@/server/pricing/commission";
import type { CommissionModelVersionRow } from "@/server/pricing/commission";

function row(overrides: Partial<CommissionModelVersionRow> = {}): CommissionModelVersionRow {
  return {
    id: "cmv-1",
    productId: "prod-1",
    commissionType: "FLAT",
    commissionAmountMinor: null,
    commissionPercentageBasisPoints: null,
    recurringCommissionAmountMinor: null,
    ...overrides,
  };
}

describe("computeCommissionAmountMinor()", () => {
  it("FLAT: liefert den uebergebenen fixedAmountMinor unveraendert (baseAmountMinor wird ignoriert)", () => {
    expect(computeCommissionAmountMinor(row({ commissionType: "FLAT" }), 999_999, 1_500)).toBe(
      1_500,
    );
  });

  it("FLAT: liefert null, falls kein fixedAmountMinor uebergeben wurde", () => {
    expect(computeCommissionAmountMinor(row({ commissionType: "FLAT" }), 10_000, null)).toBeNull();
  });

  it("TIERED: faellt wie FLAT auf den uebergebenen fixedAmountMinor zurueck (unveraendertes Verhalten aus buildResolveCommission())", () => {
    expect(computeCommissionAmountMinor(row({ commissionType: "TIERED" }), 10_000, 750)).toBe(750);
  });

  it("PERCENTAGE: berechnet Basis-Points korrekt (10000 = 100%)", () => {
    const percentageRow = row({
      commissionType: "PERCENTAGE",
      commissionPercentageBasisPoints: 1000,
    }); // 10%
    expect(computeCommissionAmountMinor(percentageRow, 10_000, null)).toBe(1_000);
  });

  it("PERCENTAGE: rundet kaufmaennisch auf ganze Minor-Einheiten", () => {
    const percentageRow = row({
      commissionType: "PERCENTAGE",
      commissionPercentageBasisPoints: 333,
    }); // 3.33%
    // 10_000 * 333 / 10000 = 333.0 -> exakt, daher ein zweiter Fall mit Rundungsbedarf:
    expect(computeCommissionAmountMinor(percentageRow, 10_000, null)).toBe(333);
    expect(computeCommissionAmountMinor(percentageRow, 10_001, null)).toBe(333); // 333.03 -> 333
    expect(computeCommissionAmountMinor(percentageRow, 10_150, null)).toBe(338); // 338.0 -> 338
  });

  it("PERCENTAGE: liefert null, falls commissionPercentageBasisPoints fehlt", () => {
    const percentageRow = row({
      commissionType: "PERCENTAGE",
      commissionPercentageBasisPoints: null,
    });
    expect(computeCommissionAmountMinor(percentageRow, 10_000, null)).toBeNull();
  });

  it("PERCENTAGE: 0 Basis-Points liefert 0 (nicht null)", () => {
    const percentageRow = row({ commissionType: "PERCENTAGE", commissionPercentageBasisPoints: 0 });
    expect(computeCommissionAmountMinor(percentageRow, 10_000, null)).toBe(0);
  });

  it("PERCENTAGE: baseAmountMinor = 0 liefert 0", () => {
    const percentageRow = row({
      commissionType: "PERCENTAGE",
      commissionPercentageBasisPoints: 500,
    });
    expect(computeCommissionAmountMinor(percentageRow, 0, null)).toBe(0);
  });
});
