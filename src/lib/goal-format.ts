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
