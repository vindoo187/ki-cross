import { describe, expect, it } from "vitest";
import { assignPriorityRanks, type RankableItem } from "@/server/recommendation/tie-break";

function item(overrides: Partial<RankableItem> = {}): RankableItem {
  return {
    productVersionId: "pv-1",
    monthlyPriceMinor: 1000,
    businessPriorityScore: 0,
    customerFitScore: 0,
    ...overrides,
  };
}

describe("assignPriorityRanks", () => {
  it("sortiert primaer nach businessPriorityScore DESC", () => {
    const result = assignPriorityRanks([
      item({ productVersionId: "low", businessPriorityScore: 10 }),
      item({ productVersionId: "high", businessPriorityScore: 50 }),
    ]);
    expect(result.map((r) => r.productVersionId)).toEqual(["high", "low"]);
    expect(result.map((r) => r.priorityRank)).toEqual([1, 2]);
  });

  it("sortiert bei gleichem businessPriorityScore nach customerFitScore DESC", () => {
    const result = assignPriorityRanks([
      item({ productVersionId: "low-fit", businessPriorityScore: 10, customerFitScore: 20 }),
      item({ productVersionId: "high-fit", businessPriorityScore: 10, customerFitScore: 80 }),
    ]);
    expect(result.map((r) => r.productVersionId)).toEqual(["high-fit", "low-fit"]);
  });

  it("sortiert bei gleichem Score nach monthlyPriceMinor ASC", () => {
    const result = assignPriorityRanks([
      item({ productVersionId: "expensive", monthlyPriceMinor: 2000 }),
      item({ productVersionId: "cheap", monthlyPriceMinor: 500 }),
    ]);
    expect(result.map((r) => r.productVersionId)).toEqual(["cheap", "expensive"]);
  });

  it("monthlyPriceMinor=null steht immer zuletzt (unabhaengig davon, ob es der niedrigere Wert waere)", () => {
    const result = assignPriorityRanks([
      item({ productVersionId: "no-price", monthlyPriceMinor: null }),
      item({ productVersionId: "with-price", monthlyPriceMinor: 999999 }),
    ]);
    expect(result.map((r) => r.productVersionId)).toEqual(["with-price", "no-price"]);
  });

  it("zwei null-Preise: kein Tie-break-Fehler, faellt weiter durch auf productVersionId", () => {
    const result = assignPriorityRanks([
      item({ productVersionId: "z-product", monthlyPriceMinor: null }),
      item({ productVersionId: "a-product", monthlyPriceMinor: null }),
    ]);
    expect(result.map((r) => r.productVersionId)).toEqual(["a-product", "z-product"]);
  });

  it("letzter Tie-Break: productVersionId ASC (lexikographisch)", () => {
    const result = assignPriorityRanks([
      item({ productVersionId: "pv-z" }),
      item({ productVersionId: "pv-a" }),
    ]);
    expect(result.map((r) => r.productVersionId)).toEqual(["pv-a", "pv-z"]);
  });

  it("volle Prioritaetskette: score -> fit -> preis -> id, in dieser Reihenfolge", () => {
    const result = assignPriorityRanks([
      item({
        productVersionId: "d",
        businessPriorityScore: 10,
        customerFitScore: 50,
        monthlyPriceMinor: 100,
      }),
      item({
        productVersionId: "c",
        businessPriorityScore: 20,
        customerFitScore: 10,
        monthlyPriceMinor: 999,
      }),
      item({
        productVersionId: "b",
        businessPriorityScore: 20,
        customerFitScore: 90,
        monthlyPriceMinor: 500,
      }),
      item({
        productVersionId: "a",
        businessPriorityScore: 20,
        customerFitScore: 90,
        monthlyPriceMinor: 200,
      }),
    ]);
    expect(result.map((r) => r.productVersionId)).toEqual(["a", "b", "c", "d"]);
    expect(result.map((r) => r.priorityRank)).toEqual([1, 2, 3, 4]);
  });

  it("veraendert die Eingabe-Liste nicht (immutable)", () => {
    const items = [item({ productVersionId: "z" }), item({ productVersionId: "a" })];
    const copy = [...items];
    assignPriorityRanks(items);
    expect(items).toEqual(copy);
  });
});
