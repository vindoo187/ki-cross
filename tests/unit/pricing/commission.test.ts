import { describe, expect, it } from "vitest";
import { buildResolveCommission, computeCommissionAmountMinor } from "@/server/pricing/commission";
import type { CommissionModelVersionRow, CommissionTierRow } from "@/server/pricing/commission";

function row(overrides: Partial<CommissionModelVersionRow> = {}): CommissionModelVersionRow {
  return {
    id: "cmv-1",
    productId: "prod-1",
    validFrom: new Date("2026-01-01T00:00:00Z"),
    commissionType: "FLAT",
    commissionAmountMinor: null,
    commissionPercentageBasisPoints: null,
    recurringCommissionAmountMinor: null,
    tiers: [],
    ...overrides,
  };
}

/**
 * Phase 10 AP4 (ChatGPT-GO 2026-08-21) -- die vom Projektleiter geforderte
 * "Kern-Test"-Referenzstaffel fuer die TIERED-Grenzfaelle: drei Stufen bei
 * thresholdMinor 0 (Amount-Variante), 1_000 (Percentage-Variante) und 2_500
 * (Amount-Variante) -- deckt Amount- UND Percentage-Stufen sowie alle
 * relevanten Schwellenwert-Grenzfaelle ab (siehe describe-Block unten).
 */
const tierZero: CommissionTierRow = {
  thresholdMinor: 0,
  tierAmountMinor: 100,
  tierPercentageBasisPoints: null,
};
const tierOneThousand: CommissionTierRow = {
  thresholdMinor: 1_000,
  tierAmountMinor: null,
  tierPercentageBasisPoints: 500, // 5%
};
const tierTwoFiveHundred: CommissionTierRow = {
  thresholdMinor: 2_500,
  tierAmountMinor: 900,
  tierPercentageBasisPoints: null,
};
const threeTiers: CommissionTierRow[] = [tierZero, tierOneThousand, tierTwoFiveHundred];

describe("computeCommissionAmountMinor()", () => {
  it("FLAT: liefert den uebergebenen fixedAmountMinor unveraendert (baseAmountMinor wird ignoriert)", () => {
    expect(computeCommissionAmountMinor(row({ commissionType: "FLAT" }), 999_999, 1_500)).toBe(
      1_500,
    );
  });

  it("FLAT: liefert null, falls kein fixedAmountMinor uebergeben wurde", () => {
    expect(computeCommissionAmountMinor(row({ commissionType: "FLAT" }), 10_000, null)).toBeNull();
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

/**
 * Phase 10 AP4 (ChatGPT-GO 2026-08-21) -- "Kern-Test": vollstaendige
 * Grenzfall-Matrix fuer die TIERED-Berechnung anhand der drei Referenz-
 * Stufen `threeTiers` (0 -> 100 Minor fix, 1_000 -> 5%, 2_500 -> 900 Minor
 * fix). Nicht progressiv: die Stufe mit der HOECHSTEN thresholdMinor
 * <= baseAmountMinor gewinnt und ihr Satz gilt fuer den GESAMTEN Betrag.
 */
describe("computeCommissionAmountMinor() -- TIERED (Kern-Test-Grenzfaelle)", () => {
  const tieredRow = row({ commissionType: "TIERED", tiers: threeTiers });

  it("baseAmountMinor genau 0: unterste Stufe (Amount-Variante) greift", () => {
    expect(computeCommissionAmountMinor(tieredRow, 0, null)).toBe(100);
  });

  it("baseAmountMinor knapp unter der zweiten Schwelle (999): unterste Stufe greift weiterhin", () => {
    expect(computeCommissionAmountMinor(tieredRow, 999, null)).toBe(100);
  });

  it("baseAmountMinor exakt an der zweiten Schwelle (1_000, inklusive Untergrenze): zweite Stufe (Percentage-Variante) greift", () => {
    // 1_000 * 500 / 10000 = 50
    expect(computeCommissionAmountMinor(tieredRow, 1_000, null)).toBe(50);
  });

  it("baseAmountMinor zwischen zweiter und dritter Schwelle (2_000): zweite Stufe greift weiterhin", () => {
    // 2_000 * 500 / 10000 = 100
    expect(computeCommissionAmountMinor(tieredRow, 2_000, null)).toBe(100);
  });

  it("baseAmountMinor exakt an der hoechsten Schwelle (2_500): dritte Stufe (Amount-Variante) greift", () => {
    expect(computeCommissionAmountMinor(tieredRow, 2_500, null)).toBe(900);
  });

  it("baseAmountMinor deutlich ueber der hoechsten Schwelle (100_000): die hoechste Stufe gilt weiterhin fuer den GESAMTEN Betrag (nicht progressiv/gestaffelt)", () => {
    expect(computeCommissionAmountMinor(tieredRow, 100_000, null)).toBe(900);
  });

  it("keine Stufe mit thresholdMinor <= baseAmountMinor vorhanden (unvollstaendige/ungueltige Version ohne 0-Stufe): liefert null statt eines falschen Werts", () => {
    const incompleteRow = row({
      commissionType: "TIERED",
      tiers: [{ thresholdMinor: 500, tierAmountMinor: 100, tierPercentageBasisPoints: null }],
    });
    expect(computeCommissionAmountMinor(incompleteRow, 100, null)).toBeNull();
  });

  it("leeres tiers-Array liefert null", () => {
    expect(
      computeCommissionAmountMinor(row({ commissionType: "TIERED", tiers: [] }), 5_000, null),
    ).toBeNull();
  });

  it("Reihenfolge der Stufen im Array darf das Ergebnis nicht beeinflussen (kein Verlass auf sortOrder/Array-Position)", () => {
    const shuffled = row({
      commissionType: "TIERED",
      tiers: [tierTwoFiveHundred, tierZero, tierOneThousand],
    });
    expect(computeCommissionAmountMinor(shuffled, 2_500, null)).toBe(900);
    expect(computeCommissionAmountMinor(shuffled, 1_500, null)).toBe(75); // 1_500 * 500 / 10000
    expect(computeCommissionAmountMinor(shuffled, 0, null)).toBe(100);
  });

  it("Percentage-Stufe mit tierPercentageBasisPoints = 0 liefert 0 (nicht null)", () => {
    const zeroPercentRow = row({
      commissionType: "TIERED",
      tiers: [{ thresholdMinor: 0, tierAmountMinor: null, tierPercentageBasisPoints: 0 }],
    });
    expect(computeCommissionAmountMinor(zeroPercentRow, 10_000, null)).toBe(0);
  });
});

describe("buildResolveCommission() -- TIERED", () => {
  it("TIERED liefert -- wie PERCENTAGE -- bewusst commissionValueMinor = null (finaler Preis zum Empfehlungszeitpunkt unbekannt)", () => {
    const resolve = buildResolveCommission([
      row({ id: "cmv-1", productId: "prod-1", commissionType: "TIERED", tiers: threeTiers }),
    ]);
    const resolution = resolve("prod-1");
    expect(resolution?.commissionModelVersionId).toBe("cmv-1");
    expect(resolution?.commissionValueMinor).toBeNull();
  });
});
