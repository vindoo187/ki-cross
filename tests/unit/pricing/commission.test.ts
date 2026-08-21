import { describe, expect, it } from "vitest";
import { buildResolveCommission, computeCommissionAmountMinor } from "@/server/pricing/commission";
import type { CommissionModelVersionRow } from "@/server/pricing/commission";

function row(overrides: Partial<CommissionModelVersionRow> = {}): CommissionModelVersionRow {
  return {
    id: "cmv-1",
    productId: "prod-1",
    validFrom: new Date("2026-01-01T00:00:00Z"),
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

/**
 * Phase 10 AP2 (ChatGPT-GO 2026-08-21, siehe PHASE_10_IMPLEMENTATION_PLAN.md
 * Abschnitt 4/14 Punkt 3): neuer, fachlich begruendeter Tie-Breaker
 * `ORDER BY validFrom DESC, id DESC` fuer den (schema-seitig weiterhin
 * moeglichen) Fall mehrerer gleichzeitig ACTIVE `CommissionModelVersion`-
 * Zeilen fuer dasselbe Produkt -- ersetzt den vormaligen rein technischen
 * "kleinste id gewinnt"-Tie-Breaker aus Phase 3B/6.
 */
describe("buildResolveCommission() -- Tie-Breaker bei mehreren Zeilen je productId", () => {
  it("genau eine Zeile je Produkt: wird unveraendert aufgeloest", () => {
    const resolve = buildResolveCommission([row({ id: "cmv-1", productId: "prod-1" })]);
    expect(resolve("prod-1")?.commissionModelVersionId).toBe("cmv-1");
  });

  it("unbekanntes Produkt liefert null", () => {
    const resolve = buildResolveCommission([row({ id: "cmv-1", productId: "prod-1" })]);
    expect(resolve("prod-unknown")).toBeNull();
  });

  it("zwei Zeilen, unterschiedliche validFrom: die JUENGSTE validFrom gewinnt (unabhaengig von der Einfuegereihenfolge)", () => {
    const older = row({
      id: "cmv-a",
      productId: "prod-1",
      validFrom: new Date("2026-01-01T00:00:00Z"),
    });
    const newer = row({
      id: "cmv-b",
      productId: "prod-1",
      validFrom: new Date("2026-06-01T00:00:00Z"),
    });
    expect(buildResolveCommission([older, newer])("prod-1")?.commissionModelVersionId).toBe(
      "cmv-b",
    );
    // Reihenfolge im Array darf das Ergebnis nicht beeinflussen.
    expect(buildResolveCommission([newer, older])("prod-1")?.commissionModelVersionId).toBe(
      "cmv-b",
    );
  });

  it("zwei Zeilen mit EXAKT gleicher validFrom: die groessere id gewinnt (deterministischer Sekundaer-Tie-Breaker)", () => {
    const sameTime = new Date("2026-01-01T00:00:00Z");
    const smallerId = row({ id: "cmv-a", productId: "prod-1", validFrom: sameTime });
    const largerId = row({ id: "cmv-b", productId: "prod-1", validFrom: sameTime });
    expect(buildResolveCommission([smallerId, largerId])("prod-1")?.commissionModelVersionId).toBe(
      "cmv-b",
    );
    expect(buildResolveCommission([largerId, smallerId])("prod-1")?.commissionModelVersionId).toBe(
      "cmv-b",
    );
  });

  it("drei Zeilen (unterschiedliche Produkte + ein Duplikat): jedes Produkt wird unabhaengig aufgeloest", () => {
    const resolve = buildResolveCommission([
      row({ id: "cmv-p1-old", productId: "prod-1", validFrom: new Date("2025-01-01T00:00:00Z") }),
      row({ id: "cmv-p1-new", productId: "prod-1", validFrom: new Date("2026-01-01T00:00:00Z") }),
      row({ id: "cmv-p2", productId: "prod-2", validFrom: new Date("2025-01-01T00:00:00Z") }),
    ]);
    expect(resolve("prod-1")?.commissionModelVersionId).toBe("cmv-p1-new");
    expect(resolve("prod-2")?.commissionModelVersionId).toBe("cmv-p2");
  });
});
