import { describe, expect, it } from "vitest";
import { getCalendarPeriodBounds } from "@/server/analytics/goal-progress";

/**
 * Unit-Tests fuer `getCalendarPeriodBounds()` (Phase 11 AP4, Schritt 1).
 * Rein synchron/pure (keine DB-Zugriffe), daher `tests/unit/` -- analog
 * `goal-validator.test.ts`. Deckt die von ChatGPT explizit geforderten
 * Faelle ab (siehe PHASE_11_IMPLEMENTATION_PLAN.md / AP4-GO 2026-08-22):
 * Monat, Quartal, Jahr, Schaltjahr, Jahreswechsel, exakt `[start, end)`.
 *
 * Alle Eingaben/Erwartungen als UTC-ISO-Strings, um sicherzustellen, dass
 * die Funktion unabhaengig von der lokalen Zeitzone des Testlaeufers
 * korrekt in UTC rechnet (siehe Modulkommentar in goal-progress.ts).
 */

describe("getCalendarPeriodBounds()", () => {
  it("MONTH: periodEnd ist der 1. des Folgemonats (UTC)", () => {
    const bounds = getCalendarPeriodBounds("MONTH", new Date("2026-08-01T00:00:00.000Z"));
    expect(bounds.periodStart.toISOString()).toBe("2026-08-01T00:00:00.000Z");
    expect(bounds.periodEnd.toISOString()).toBe("2026-09-01T00:00:00.000Z");
  });

  it("QUARTER: periodEnd liegt 3 Kalendermonate spaeter (UTC)", () => {
    const bounds = getCalendarPeriodBounds("QUARTER", new Date("2026-07-01T00:00:00.000Z"));
    expect(bounds.periodEnd.toISOString()).toBe("2026-10-01T00:00:00.000Z");
  });

  it("YEAR: periodEnd liegt genau 12 Kalendermonate spaeter (UTC)", () => {
    const bounds = getCalendarPeriodBounds("YEAR", new Date("2026-01-01T00:00:00.000Z"));
    expect(bounds.periodEnd.toISOString()).toBe("2027-01-01T00:00:00.000Z");
  });

  it("Schaltjahr: MONTH-Periode Februar 2028 (Schaltjahr) endet am 1. Maerz (nicht am 29./1.)", () => {
    // 2028 ist ein Schaltjahr (durch 4 teilbar, nicht durch 100). Die
    // Monatsarithmetik ueber Date.UTC() ist davon unabhaengig korrekt,
    // da sie nicht "+29 Tage" rechnet, sondern den Kalendermonat erhoeht.
    const bounds = getCalendarPeriodBounds("MONTH", new Date("2028-02-01T00:00:00.000Z"));
    expect(bounds.periodEnd.toISOString()).toBe("2028-03-01T00:00:00.000Z");
  });

  it("Schaltjahr: YEAR-Periode ab 2028-01-01 endet 2029-01-01 (366-Tage-Jahr korrekt ueberbrueckt)", () => {
    const bounds = getCalendarPeriodBounds("YEAR", new Date("2028-01-01T00:00:00.000Z"));
    expect(bounds.periodEnd.toISOString()).toBe("2029-01-01T00:00:00.000Z");
  });

  it("Jahreswechsel: QUARTER ab November laeuft korrekt ueber den Jahreswechsel (Nov->Feb)", () => {
    const bounds = getCalendarPeriodBounds("QUARTER", new Date("2026-11-01T00:00:00.000Z"));
    expect(bounds.periodStart.toISOString()).toBe("2026-11-01T00:00:00.000Z");
    expect(bounds.periodEnd.toISOString()).toBe("2027-02-01T00:00:00.000Z");
  });

  it("Jahreswechsel: MONTH ab Dezember endet im Januar des Folgejahres", () => {
    const bounds = getCalendarPeriodBounds("MONTH", new Date("2026-12-01T00:00:00.000Z"));
    expect(bounds.periodEnd.toISOString()).toBe("2027-01-01T00:00:00.000Z");
  });

  it("Intervall ist exakt halboffen [periodStart, periodEnd): periodStart selbst liegt VOR periodEnd, Differenz > 0", () => {
    const bounds = getCalendarPeriodBounds("MONTH", new Date("2026-08-01T00:00:00.000Z"));
    expect(bounds.periodStart.getTime()).toBeLessThan(bounds.periodEnd.getTime());
  });

  it("gibt periodStart unveraendert zurueck (keine Mutation/kein Snapping)", () => {
    const input = new Date("2026-08-15T12:34:56.789Z");
    const bounds = getCalendarPeriodBounds("MONTH", input);
    expect(bounds.periodStart).toBe(input);
    expect(bounds.periodStart.toISOString()).toBe("2026-08-15T12:34:56.789Z");
  });

  it("unbekannter periodType wirft einen Fehler (Defense-in-Depth)", () => {
    expect(() =>
      getCalendarPeriodBounds(
        // Absichtlich ungueltiger Wert fuer den Defense-in-Depth-Test -- per
        // Cast statt @ts-expect-error, da GoalPeriodType ein Prisma-generierter
        // Enum-Typ ist (kein lokal getipptes Zod-Enum wie bei goal-validator.ts).
        "UNKNOWN_PERIOD" as unknown as Parameters<typeof getCalendarPeriodBounds>[0],
        new Date("2026-08-01T00:00:00.000Z"),
      ),
    ).toThrow(/Unbekannter GoalPeriodType/);
  });
});
