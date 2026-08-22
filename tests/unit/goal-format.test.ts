import { describe, expect, it } from "vitest";
import { formatGoalMetricValue, formatGoalPeriodLabel } from "@/lib/goal-format";

/**
 * Unit-Tests fuer die Phase-11-AP7-Ergaenzungen in `goal-format.ts`
 * (ChatGPT-GO 2026-08-22 nach AP7-Discovery). Rein synchron/pure (keine
 * DB-, keine React-Abhaengigkeit) -- deckt nur die beiden NEUEN Funktionen
 * ab (`formatGoalMetricValue()`, `formatGoalPeriodLabel()`); die
 * AP6-Funktionen (`formatGoalScopeLabel()`, `formatGoalTargetValue()`) sind
 * unveraendert und nicht Teil dieses AP7-Scopes.
 *
 * WICHTIG (Root-Cause-Fix nach CI #94-Fehlschlag): `Intl.NumberFormat`s
 * Waehrungs-/Prozent-Ausgabe verwendet je nach Node-/ICU-Version ein
 * unterschiedliches Leerzeichen-Unicode-Zeichen vor "€"/"%" (z. B. U+00A0
 * vs. U+202F) -- die Sandbox laeuft auf Node 22, CI auf Node 24 (siehe
 * CI-Log-Warnung). Ein hartkodiertes Erwartungs-Literal mit dem "falschen"
 * Leerzeichen besteht dadurch lokal, schlaegt aber in CI fehl (oder
 * umgekehrt). Deshalb wird die Erwartung fuer Waehrungs-/Prozentwerte HIER
 * ueber denselben `Intl.NumberFormat()`-Aufruf wie in `goal-format.ts`
 * berechnet, statt das Zeichen zu erraten -- versionsunabhaengig korrekt.
 */

function expectedCurrency(amount: number, currency: string): string {
  return new Intl.NumberFormat("de-DE", { style: "currency", currency }).format(amount);
}

function expectedPercent(ratio: number): string {
  return new Intl.NumberFormat("de-DE", { style: "percent", maximumFractionDigits: 2 }).format(
    ratio,
  );
}

describe("formatGoalMetricValue()", () => {
  it("DEALS_CLOSED: rohe Stueckzahl mit 'Deals'-Suffix, waehrungsunabhaengig", () => {
    expect(formatGoalMetricValue("DEALS_CLOSED", 7, null)).toBe("7 Deals");
    // currency wird bei DEALS_CLOSED ignoriert (analog formatGoalTargetValue()).
    expect(formatGoalMetricValue("DEALS_CLOSED", 7, "EUR")).toBe("7 Deals");
  });

  it("REVENUE: Minor-Einheiten (Cent) werden durch 100 geteilt und als Waehrung formatiert", () => {
    expect(formatGoalMetricValue("REVENUE", 19950, "EUR")).toBe(expectedCurrency(199.5, "EUR"));
  });

  it("REVENUE ohne currency liefert '--' statt eines Fehlers (Anzeige darf nie crashen)", () => {
    expect(formatGoalMetricValue("REVENUE", 19950, null)).toBe("--");
  });

  it("CLOSE_RATE: Basispunkte (0..10000) werden durch 10000 geteilt und als Prozent formatiert", () => {
    expect(formatGoalMetricValue("CLOSE_RATE", 2500, null)).toBe(expectedPercent(0.25));
  });

  it("CLOSE_RATE: 10000 Basispunkte entsprechen 100 %", () => {
    expect(formatGoalMetricValue("CLOSE_RATE", 10000, null)).toBe(expectedPercent(1));
  });

  it("unbekannter metricKey liefert '--' (Defense-in-Depth, analog formatGoalTargetValue())", () => {
    expect(formatGoalMetricValue("UNKNOWN_METRIC", 5, null)).toBe("--");
  });

  it("0 ist ein gueltiger Wert (kein Fallback auf '--') -- z. B. 0 Deals oder 0 % Zielerreichung", () => {
    expect(formatGoalMetricValue("DEALS_CLOSED", 0, null)).toBe("0 Deals");
    expect(formatGoalMetricValue("CLOSE_RATE", 0, null)).toBe(expectedPercent(0));
  });
});

describe("formatGoalPeriodLabel()", () => {
  it("MONTH: 'Monat Jahr - Monatsziel' (deutsches Monatsformat, UTC)", () => {
    expect(formatGoalPeriodLabel("MONTH", "2026-08-01T00:00:00.000Z")).toBe(
      "August 2026 - Monatsziel",
    );
  });

  it("QUARTER: leitet die Quartalsnummer (1-4) aus dem UTC-Monat ab", () => {
    expect(formatGoalPeriodLabel("QUARTER", "2026-07-01T00:00:00.000Z")).toBe(
      "Q3 2026 - Quartalsziel",
    );
    expect(formatGoalPeriodLabel("QUARTER", "2026-01-01T00:00:00.000Z")).toBe(
      "Q1 2026 - Quartalsziel",
    );
    expect(formatGoalPeriodLabel("QUARTER", "2026-10-01T00:00:00.000Z")).toBe(
      "Q4 2026 - Quartalsziel",
    );
  });

  it("YEAR: '<Jahr> - Jahresziel' (Fugen-'es', NICHT das generische '<Label>sziel'-Muster)", () => {
    expect(formatGoalPeriodLabel("YEAR", "2026-01-01T00:00:00.000Z")).toBe("2026 - Jahresziel");
  });

  it("rechnet in UTC, nicht in der lokalen Zeitzone des Testlaeufers (konsistent mit getCalendarPeriodBounds())", () => {
    // 2026-01-01T00:00:00.000Z waere in negativen UTC-Offsets (z. B. UTC-5)
    // lokal noch "31. Dezember 2025" -- die Funktion muss trotzdem "2026"
    // liefern, da sie ausschliesslich UTC-Getter verwendet.
    expect(formatGoalPeriodLabel("YEAR", "2026-01-01T00:00:00.000Z")).toBe("2026 - Jahresziel");
  });

  it("unbekannter periodType faellt auf den rohen Typ-String zurueck (Defense-in-Depth)", () => {
    expect(formatGoalPeriodLabel("UNKNOWN_PERIOD", "2026-08-01T00:00:00.000Z")).toBe(
      "August 2026 - UNKNOWN_PERIODsziel",
    );
  });
});
