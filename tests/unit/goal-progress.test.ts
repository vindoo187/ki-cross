import { describe, expect, it } from "vitest";
import { getCalendarPeriodBounds, isGoalPeriodActive } from "@/server/analytics/goal-progress";

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

/**
 * Unit-Tests fuer `isGoalPeriodActive()` (Phase 11 AP7, ChatGPTs verbindliche
 * Regel nach AP7-Discovery: `periodStart <= now < periodEnd`). Rein
 * synchron/pure -- deckt exakt die drei Intervallgrenzen ab (unmittelbar vor
 * `periodStart`, exakt `periodStart`, exakt `periodEnd`, unmittelbar nach
 * `periodEnd`), da die Halboffenheit des Intervalls (`[periodStart,
 * periodEnd)`, siehe `getCalendarPeriodBounds()`-Modulkommentar) sonst durch
 * einen Off-by-one-Fehler unbemerkt bliebe.
 */
describe("isGoalPeriodActive()", () => {
  const PERIOD_START = new Date("2026-08-01T00:00:00.000Z");

  it("ist aktiv genau bei periodStart (Intervallgrenze eingeschlossen)", () => {
    expect(isGoalPeriodActive("MONTH", PERIOD_START, PERIOD_START)).toBe(true);
  });

  it("ist NICHT aktiv unmittelbar VOR periodStart (Goal beginnt erst in der Zukunft)", () => {
    const now = new Date(PERIOD_START.getTime() - 1);
    expect(isGoalPeriodActive("MONTH", PERIOD_START, now)).toBe(false);
  });

  it("ist aktiv kurz vor periodEnd (letzte Millisekunde der Periode)", () => {
    const now = new Date("2026-08-31T23:59:59.999Z");
    expect(isGoalPeriodActive("MONTH", PERIOD_START, now)).toBe(true);
  });

  it("ist NICHT aktiv exakt bei periodEnd (Intervallgrenze ausgeschlossen, halboffen)", () => {
    const periodEnd = new Date("2026-09-01T00:00:00.000Z");
    expect(isGoalPeriodActive("MONTH", PERIOD_START, periodEnd)).toBe(false);
  });

  it("ist NICHT aktiv nach periodEnd (Goal ist bereits abgeschlossen)", () => {
    const now = new Date("2026-09-15T00:00:00.000Z");
    expect(isGoalPeriodActive("MONTH", PERIOD_START, now)).toBe(false);
  });

  it("nutzt getCalendarPeriodBounds() fuer QUARTER/YEAR konsistent (keine eigene Ad-hoc-Berechnung)", () => {
    // Q3 2026 (Juli-September) -- Mitte August ist aktiv, Mitte Oktober nicht.
    expect(isGoalPeriodActive("QUARTER", new Date("2026-07-01T00:00:00.000Z"), PERIOD_START)).toBe(
      true,
    );
    expect(
      isGoalPeriodActive(
        "QUARTER",
        new Date("2026-07-01T00:00:00.000Z"),
        new Date("2026-10-15T00:00:00.000Z"),
      ),
    ).toBe(false);
  });

  it("verwendet new Date() als Default fuer `now`, wenn kein dritter Parameter uebergeben wird", () => {
    // YEAR-Periode ab dem 1. Januar des LAUFENDEN Jahres (UTC) -- deckt damit
    // per Definition den gesamten aktuellen Zeitpunkt ab, unabhaengig vom
    // konkreten Testlauf-Datum (kein hartkodiertes "heute", vermeidet
    // Flakiness).
    const currentYearStart = new Date(Date.UTC(new Date().getUTCFullYear(), 0, 1));
    expect(isGoalPeriodActive("YEAR", currentYearStart)).toBe(true);
  });
});
