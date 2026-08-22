/**
 * Reine Anzeige-/Formatierungshilfen fuer die Goal-Admin-UI (Phase 11 AP6,
 * siehe PHASE_11_IMPLEMENTATION_PLAN.md Abschnitt 9). Bewusst UNTER
 * `src/lib/` (nicht `src/server/`) abgelegt, da diese Funktionen sowohl von
 * Server- als auch von Client-Komponenten (`"use client"`) importiert
 * werden -- reine, seiteneffektfreie Funktionen ohne DB-/Session-Zugriff,
 * analog dem bestehenden `formatMoney()`-Muster in
 * `AnalyticsDashboardContent.tsx`/`ManagementAnalyticsContent.tsx`.
 *
 * Trifft KEINE fachliche Entscheidung (z. B. welches Zielwert-Feld zu
 * welcher Metrik gehoert) -- das bleibt ausschliesslich `goal-validator.ts`
 * vorbehalten. Diese Datei formatiert nur bereits validierte, vom Server
 * gelieferte Werte fuer die Anzeige.
 */

export const GOAL_METRIC_LABELS: Record<string, string> = {
  DEALS_CLOSED: "Abgeschlossene Deals",
  REVENUE: "Umsatz",
  CLOSE_RATE: "Abschlussquote",
};

export const GOAL_PERIOD_TYPE_LABELS: Record<string, string> = {
  MONTH: "Monat",
  QUARTER: "Quartal",
  YEAR: "Jahr",
};

export const GOAL_SCOPE_TYPE_LABELS: Record<string, string> = {
  TENANT: "Mandant",
  COMPANY: "Firma",
  STORE: "Filiale",
  EMPLOYEE: "Mitarbeiter",
};

/**
 * Formatiert die Scope-Zeile eines Goal ("Filiale: Store A1a"). `scopeName`
 * ist optional -- die aufrufende Seite loest ihn ueber
 * `listGoalScopeOptions()` auf (reine Anzeige-Konvenienz, siehe
 * `goal-scope-options.ts`-Modulkommentar); ohne aufgeloesten Namen faellt
 * diese Funktion auf die rohe `scopeId` zurueck, statt einen Fehler zu
 * werfen (die Anzeige darf nie an einem fehlenden Namens-Lookup scheitern).
 */
export function formatGoalScopeLabel(
  scopeType: string,
  scopeId: string,
  scopeName: string | undefined,
): string {
  const typeLabel = GOAL_SCOPE_TYPE_LABELS[scopeType] ?? scopeType;
  return `${typeLabel}: ${scopeName ?? scopeId}`;
}

interface TargetValueFields {
  targetAmountMinor: number | null;
  targetCount: number | null;
  targetPercentageBasisPoints: number | null;
}

/**
 * Formatiert den Zielwert einer `GoalVersion` passend zur `metricKey`
 * (DEALS_CLOSED -> Stueckzahl, REVENUE -> Waehrungsbetrag,
 * CLOSE_RATE -> Prozentsatz aus Basispunkten). Liefert "--", falls das
 * erwartete Feld fehlt (sollte durch `goal-validator.ts` serverseitig nie
 * vorkommen -- reine Absicherung der Anzeige, keine eigene
 * Validierungslogik).
 */
export function formatGoalTargetValue(
  metricKey: string,
  version: TargetValueFields,
  currency: string | null,
): string {
  switch (metricKey) {
    case "DEALS_CLOSED":
      return version.targetCount != null ? `${version.targetCount} Deals` : "--";
    case "REVENUE": {
      if (version.targetAmountMinor == null || !currency) {
        return "--";
      }
      return new Intl.NumberFormat("de-DE", { style: "currency", currency }).format(
        version.targetAmountMinor / 100,
      );
    }
    case "CLOSE_RATE": {
      if (version.targetPercentageBasisPoints == null) {
        return "--";
      }
      return new Intl.NumberFormat("de-DE", { style: "percent", maximumFractionDigits: 2 }).format(
        version.targetPercentageBasisPoints / 10000,
      );
    }
    default:
      return "--";
  }
}

/**
 * Formatiert einen ROHEN Zahlenwert (kein `GoalVersion`-Objekt) passend zur
 * `metricKey` -- Phase 11 AP7 (siehe PHASE_11_IMPLEMENTATION_PLAN.md
 * Abschnitt 3, ChatGPT-GO 2026-08-22): `GoalProgressViewModel.target`/
 * `.actual`/`.remaining` (aus `computeGoalProgress()`) sind bereits reine
 * `number`-Felder in derselben Speichereinheit wie die jeweilige
 * `GoalVersion` (Stueck bei DEALS_CLOSED, Minor-Einheiten bei REVENUE,
 * Basispunkte bei CLOSE_RATE) -- diese Funktion formatiert sie fuer die
 * Analytics-UI, ohne eine neue Umrechnungsregel einzufuehren (dieselbe
 * Umrechnung wie `formatGoalTargetValue()` oben, nur ohne den Umweg ueber ein
 * `TargetValueFields`-Objekt).
 */
export function formatGoalMetricValue(
  metricKey: string,
  valueInStorageUnit: number,
  currency: string | null,
): string {
  switch (metricKey) {
    case "DEALS_CLOSED":
      return `${valueInStorageUnit} Deals`;
    case "REVENUE":
      if (!currency) {
        return "--";
      }
      return new Intl.NumberFormat("de-DE", { style: "currency", currency }).format(
        valueInStorageUnit / 100,
      );
    case "CLOSE_RATE":
      return new Intl.NumberFormat("de-DE", { style: "percent", maximumFractionDigits: 2 }).format(
        valueInStorageUnit / 10000,
      );
    default:
      return "--";
  }
}

/**
 * Formatiert die Periodenbezeichnung einer Ziel-Karte fuer die Analytics-UI
 * (Phase 11 AP7, ChatGPTs ausdrueckliche Vorgabe: die Periode muss auf der
 * Karte sichtbar sein, z. B. "August 2026 - Monatsziel"/"Q3 2026 -
 * Quartalsziel", damit fuer den Nutzer erkennbar bleibt, dass die
 * Ziel-Karte eine EIGENE, vom bestehenden Woche/Monat-KPI-Filter
 * UNABHAENGIGE Periode zeigt).
 */
export function formatGoalPeriodLabel(periodType: string, periodStartIso: string): string {
  const date = new Date(periodStartIso);
  const typeLabel = GOAL_PERIOD_TYPE_LABELS[periodType] ?? periodType;
  if (periodType === "QUARTER") {
    const quarter = Math.floor(date.getUTCMonth() / 3) + 1;
    return `Q${quarter} ${date.getUTCFullYear()} - ${typeLabel}sziel`;
  }
  if (periodType === "YEAR") {
    return `${date.getUTCFullYear()} - ${typeLabel}sziel`;
  }
  const monthLabel = new Intl.DateTimeFormat("de-DE", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
  return `${monthLabel} - ${typeLabel}sziel`;
}
