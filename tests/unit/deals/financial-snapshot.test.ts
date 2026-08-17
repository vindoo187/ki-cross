import { describe, expect, it } from "vitest";
import {
  computeDealFinancialSnapshot,
  CONTRIBUTION_MARGIN_FORMULA_VERSION,
  type DealItemPricing,
  type ProductCostRow,
} from "@/server/deals/financial-snapshot";
import type { CommissionModelVersionRow } from "@/server/pricing/commission";

function item(overrides: Partial<DealItemPricing> = {}): DealItemPricing {
  return {
    productVersionId: "pv-1",
    productId: "prod-1",
    quantity: 1,
    monthlyPriceMinor: null,
    oneTimePriceMinor: null,
    ...overrides,
  };
}

function costRow(overrides: Partial<ProductCostRow> = {}): ProductCostRow {
  return {
    hardwarePurchaseCostMinor: null,
    subsidyCostMinor: null,
    otherDirectCostMinor: null,
    ...overrides,
  };
}

function commissionRow(
  overrides: Partial<CommissionModelVersionRow> = {},
): CommissionModelVersionRow {
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

describe("computeDealFinancialSnapshot() (Formel v1)", () => {
  it("ein Item ohne Kosten/Provision: Marge = einmaliger Umsatz, Rest 0", () => {
    const result = computeDealFinancialSnapshot(
      [item({ oneTimePriceMinor: 5_000, monthlyPriceMinor: 1_000, quantity: 1 })],
      new Map(),
      new Map(),
    );
    expect(result.oneTimeRevenueMinor).toBe(5_000);
    expect(result.monthlyRecurringRevenueMinor).toBe(1_000);
    expect(result.totalContractValueMinor).toBe(6_000);
    expect(result.hardwarePurchaseCostMinor).toBe(0);
    expect(result.subsidyCostMinor).toBe(0);
    expect(result.otherDirectCostMinor).toBe(0);
    expect(result.discountCostMinor).toBe(0);
    expect(result.commissionAmountMinor).toBe(0);
    expect(result.expectedRecurringCommissionMinor).toBe(0);
    expect(result.contributionMarginMinor).toBe(5_000);
    expect(result.contributionMarginFormulaVersion).toBe(CONTRIBUTION_MARGIN_FORMULA_VERSION);
  });

  it("mehrere Items werden korrekt aufsummiert (Umsatz UND Menge)", () => {
    const result = computeDealFinancialSnapshot(
      [
        item({ productVersionId: "pv-1", oneTimePriceMinor: 1_000, quantity: 2 }),
        item({ productVersionId: "pv-2", oneTimePriceMinor: 500, quantity: 3 }),
      ],
      new Map(),
      new Map(),
    );
    // 1_000*2 + 500*3 = 2_000 + 1_500 = 3_500
    expect(result.oneTimeRevenueMinor).toBe(3_500);
    expect(result.contributionMarginMinor).toBe(3_500);
  });

  it("fehlende Preise (null) werden als 0 behandelt, kein Fehler", () => {
    const result = computeDealFinancialSnapshot(
      [item({ oneTimePriceMinor: null, monthlyPriceMinor: null, quantity: 5 })],
      new Map(),
      new Map(),
    );
    expect(result.oneTimeRevenueMinor).toBe(0);
    expect(result.monthlyRecurringRevenueMinor).toBe(0);
    expect(result.contributionMarginMinor).toBe(0);
  });

  it("Kostendaten reduzieren die Marge um genau die (mengenskalierten) Kosten", () => {
    const costs = new Map([
      [
        "prod-1",
        costRow({
          hardwarePurchaseCostMinor: 300,
          subsidyCostMinor: 100,
          otherDirectCostMinor: 50,
        }),
      ],
    ]);
    const result = computeDealFinancialSnapshot(
      [item({ oneTimePriceMinor: 1_000, quantity: 2 })],
      costs,
      new Map(),
    );
    // Umsatz: 2_000. Kosten je Stueck 450 * 2 = 900. Marge = 2_000 - 900 = 1_100.
    expect(result.oneTimeRevenueMinor).toBe(2_000);
    expect(result.hardwarePurchaseCostMinor).toBe(600);
    expect(result.subsidyCostMinor).toBe(200);
    expect(result.otherDirectCostMinor).toBe(100);
    expect(result.contributionMarginMinor).toBe(1_100);
  });

  it("fehlende ProductCostVersion fuer ein Produkt wird als 'keine Kosten' (0) behandelt, kein Fehler", () => {
    const result = computeDealFinancialSnapshot(
      [item({ productId: "prod-ohne-kosten", oneTimePriceMinor: 1_000, quantity: 1 })],
      new Map([["anderes-produkt", costRow({ hardwarePurchaseCostMinor: 999 })]]),
      new Map(),
    );
    expect(result.hardwarePurchaseCostMinor).toBe(0);
    expect(result.contributionMarginMinor).toBe(1_000);
  });

  it("discountCostMinor ist in v1 IMMER 0, auch bei hohem Umsatz/Kosten", () => {
    const result = computeDealFinancialSnapshot(
      [item({ oneTimePriceMinor: 100_000, quantity: 10 })],
      new Map(),
      new Map(),
    );
    expect(result.discountCostMinor).toBe(0);
  });

  it("monthlyRecurringRevenueMinor fliesst NICHT in die v1-Marge ein (nur oneTimeRevenueMinor)", () => {
    const result = computeDealFinancialSnapshot(
      [item({ oneTimePriceMinor: 0, monthlyPriceMinor: 50_000, quantity: 1 })],
      new Map(),
      new Map(),
    );
    expect(result.monthlyRecurringRevenueMinor).toBe(50_000);
    expect(result.contributionMarginMinor).toBe(0);
  });

  it("FIXED-Provision (commissionAmountMinor/recurringCommissionAmountMinor) wird GENAU EINMAL mit quantity skaliert (Regressionstest fuer den AP3-Bugfix)", () => {
    const commissions = new Map([
      [
        "prod-1",
        commissionRow({
          commissionType: "FLAT",
          commissionAmountMinor: 200, // pro Stueck, einmalig
          recurringCommissionAmountMinor: 50, // pro Stueck, wiederkehrend
        }),
      ],
    ]);
    const result = computeDealFinancialSnapshot(
      [item({ oneTimePriceMinor: 1_000, monthlyPriceMinor: 300, quantity: 4 })],
      new Map(),
      commissions,
    );
    // 200 * 4 = 800 (NICHT 200 * 4 * irgendetwas), 50 * 4 = 200.
    expect(result.commissionAmountMinor).toBe(800);
    expect(result.expectedRecurringCommissionMinor).toBe(200);
  });

  it("PERCENTAGE-Provision wird auf den STUECKPREIS berechnet und danach EINMAL mit quantity skaliert (Regressionstest fuer den AP3-Bugfix: KEINE doppelte Mengenverrechnung)", () => {
    const commissions = new Map([
      [
        "prod-1",
        commissionRow({
          commissionType: "PERCENTAGE",
          commissionPercentageBasisPoints: 1000, // 10%
        }),
      ],
    ]);
    const result = computeDealFinancialSnapshot(
      [item({ oneTimePriceMinor: 10_000, monthlyPriceMinor: 0, quantity: 3 })],
      new Map(),
      commissions,
    );
    // Korrekt: 10% von 10_000 (Stueckpreis) = 1_000, mal 3 Stueck = 3_000.
    // FALSCH (der urspruengliche Bug) waere: 10% von (10_000*3=30_000) = 3_000,
    // dann NOCHMAL *3 = 9_000.
    expect(result.commissionAmountMinor).toBe(3_000);
  });

  it("kein Provisionsmodell fuer das Produkt: commissionAmountMinor bleibt 0, kein Fehler", () => {
    const result = computeDealFinancialSnapshot(
      [item({ oneTimePriceMinor: 1_000, quantity: 1 })],
      new Map(),
      new Map([["anderes-produkt", commissionRow({ commissionAmountMinor: 999 })]]),
    );
    expect(result.commissionAmountMinor).toBe(0);
  });
});
