import type { GoalMetricKey, GoalPeriodType } from "@prisma/client";
import { getDealKpi, type KpiPeriodFilter } from "./kpis";

/**
 * Phase 11 AP4 (Ziel-vs.-Ist-Berechnung, siehe PHASE_11_IMPLEMENTATION_PLAN.md
 * Abschnitt 3, ChatGPT-GO 2026-08-22). Schritt 1: `getCalendarPeriodBounds()`
 * -- die EINZIGE Stelle, die aus `Goal.periodType`/`Goal.periodStart` das
 * (bewusst nicht gespeicherte) `periodEnd` ableitet.
 *
 * WICHTIG (ChatGPT-Praezisierung nach AP3.5, 2026-08-22): Die Berechnung
 * erfolgt DETERMINISTISCH IN UTC -- explizit NICHT nach dem Muster von
 * `dashboard-view.ts::resolvePeriodRange()`, das lokale `Date`-Getter/
 * -Konstruktoren nutzt (also die Laufzeit-Zeitzone des Node-Prozesses).
 * Grund: sonst koennte dasselbe Goal je nach Deployment-Umgebung
 * unterschiedliche Grenzen erzeugen -- fuer ein revisionsfaehiges
 * Zielsystem inakzeptabel. `resolvePeriodRange()` wird NICHT rueckwirkend
 * umgebaut (separater Scope), sondern bewusst NICHT wiederverwendet.
 *
 * Rueckgabe ist ein halboffenes Intervall `[periodStart, periodEnd)` --
 * identisch zur bestehenden `{ gte: from, lt: to }`-Konvention in
 * `kpis.ts` (AP3.5 hat die Kompatibilitaet bereits bestaetigt, siehe
 * PHASE_11_IMPLEMENTATION_PLAN.md Abschnitt 3 AP3.5).
 *
 * Nimmt `periodStart` UNVERAENDERT als Eingabe entgegen (kein Runden/
 * Snapping auf Kalendergrenzen). Eine Ausrichtungspruefung (z. B. "MONTH
 * erfordert periodStart = 1. des Monats um 00:00 UTC") ist NICHT Teil
 * dieser Funktion und aktuell auch nicht in `goal-validator.ts` (AP3)
 * vorhanden -- offene Beobachtung, kein Blocker fuer diesen Schritt.
 *
 * Schritt 2 (DEALS_CLOSED/REVENUE-Mapping, ChatGPT-GO 2026-08-22): siehe
 * `computeGoalProgress()` weiter unten. Verbindliche Zuordnung von ChatGPT:
 *
 * - DEALS_CLOSED -> `DealKpiByCurrency.dealsClosed`, waehrungsunabhaengig
 *   ueber ALLE Currency-Buckets aufsummiert (Stueckzahl, keine Geldgroesse).
 * - REVENUE -> `DealKpiByCurrency.totalContractValueMinor` GENAU des
 *   Currency-Buckets, der `Goal.currency` entspricht (kein Aufsummieren
 *   ueber Waehrungen, keine Waehrungsumrechnung, keine Neuberechnung aus
 *   `oneTimeRevenueMinor`/`monthlyRecurringRevenueMinor` -- diese Summe
 *   liefert `getDealKpi()` bereits fertig). Gibt es fuer die Goal-Currency
 *   keinen Bucket in der Periode, ist `actual` explizit 0 (kein Fehler).
 * - CLOSE_RATE bleibt bewusst NICHT implementiert (weiterhin offener
 *   Blocker: Zaehler/Nenner fachlich noch nicht geklaert) -- wirft
 *   `GoalMetricNotImplementedError`.
 *
 * `computeGoalProgress()` fuehrt KEINE eigene Aggregation durch, sondern
 * ruft ausschliesslich die bestehende `getDealKpi()` auf (ChatGPT-Auflage:
 * "kein neuer Aggregations-Code, nur Wiederverwendung + Vergleich").
 *
 * Scope-Aufloesung (`Goal.scopeType`/`scopeId` -> `storeId`/`storeIds`/
 * `employeeId`) ist ausdruecklich NICHT Teil dieser Funktion -- das ist laut
 * Plan Aufgabe von AP5 (RBAC/Sichtbarkeits-Integration, u. a.
 * `resolveAuthorizedStoreFilter()`). Aufrufer uebergeben den bereits
 * aufgeloesten Scope-Filter.
 */

export interface CalendarPeriodBounds {
  periodStart: Date;
  /** Exklusiv -- siehe Modulkommentar, `[periodStart, periodEnd)`. */
  periodEnd: Date;
}

/**
 * Leitet deterministisch (UTC-Kalendermonatsarithmetik ueber `Date.UTC()`
 * mit den `getUTC*()`-Feldern von `periodStart`, keine lokale Zeitzone) das
 * Ende einer Zielperiode aus Periodentyp + -start ab.
 */
export function getCalendarPeriodBounds(
  periodType: GoalPeriodType,
  periodStart: Date,
): CalendarPeriodBounds {
  const monthsToAdd = periodLengthInMonths(periodType);
  const periodEnd = new Date(
    Date.UTC(
      periodStart.getUTCFullYear(),
      periodStart.getUTCMonth() + monthsToAdd,
      periodStart.getUTCDate(),
      periodStart.getUTCHours(),
      periodStart.getUTCMinutes(),
      periodStart.getUTCSeconds(),
      periodStart.getUTCMilliseconds(),
    ),
  );
  return { periodStart, periodEnd };
}

function periodLengthInMonths(periodType: GoalPeriodType): number {
  switch (periodType) {
    case "MONTH":
      return 1;
    case "QUARTER":
      return 3;
    case "YEAR":
      return 12;
    default: {
      const exhaustiveCheck: never = periodType;
      throw new Error(`Unbekannter GoalPeriodType: ${String(exhaustiveCheck)}`);
    }
  }
}

/**
 * `CLOSE_RATE` ist bewusst (noch) nicht implementiert -- siehe Modulkommentar
 * und PHASE_11_IMPLEMENTATION_PLAN.md Abschnitt 3 AP4: Zaehler/Nenner sind
 * fachlich noch nicht mit ChatGPT geklaert (weiterhin der einzige offene
 * Blocker innerhalb von AP4).
 */
export class GoalMetricNotImplementedError extends Error {
  constructor(public readonly metricKey: GoalMetricKey) {
    super(
      `Ziel-vs.-Ist-Berechnung fuer metricKey "${metricKey}" ist noch nicht implementiert ` +
        `(fachliche Definition von Zaehler/Nenner steht noch aus, siehe Modulkommentar in goal-progress.ts).`,
    );
  }
}

/**
 * `computeGoalProgress()` benoetigt aus `Goal` nur die fuer die Berechnung
 * relevanten Felder -- absichtlich ein eigenes, schlankes Interface statt
 * `GoalSummary` aus `goal-admin.ts` zu importieren, damit `goal-progress.ts`
 * nicht an dessen (staendig wachsende) DTO-Form gekoppelt ist.
 */
export interface GoalProgressInput {
  metricKey: GoalMetricKey;
  periodType: GoalPeriodType;
  periodStart: Date;
  /** `null` bei DEALS_CLOSED/CLOSE_RATE (goal-validator.ts erzwingt das serverseitig). */
  currency: string | null;
}

/** Analog schlankes Gegenstueck zu `GoalVersionSummary` (nur die Zielwert-Felder). */
export interface GoalVersionProgressInput {
  targetAmountMinor: number | null;
  targetCount: number | null;
  targetPercentageBasisPoints: number | null;
}

/**
 * Bereits aufgeloester Scope-Filter (siehe Modulkommentar -- Scope-Aufloesung
 * ist AP5-Aufgabe). Bewusst ohne `from`/`to`: die werden hier IMMER aus
 * `getCalendarPeriodBounds()` abgeleitet, nie vom Aufrufer uebergeben, damit
 * Ziel- und Ist-Zeitraum niemals auseinanderlaufen koennen.
 */
export type GoalProgressScopeFilter = Pick<KpiPeriodFilter, "storeId" | "storeIds" | "employeeId">;

export interface GoalProgress {
  /** Zielwert aus der aktuellen `GoalVersion` (metrikabhaengiges Feld, siehe `GoalVersionProgressInput`). */
  target: number;
  /** Ist-Wert aus `getDealKpi()` fuer den ueber `getCalendarPeriodBounds()` abgeleiteten Zeitraum. */
  actual: number;
  /** `actual / target`, `null` falls `target` 0 ist (Division durch 0 vermieden, analog `kpis.ts`-Konvention). */
  achievementRate: number | null;
  /** `target - actual` -- bewusst NICHT auf 0 geclampt, damit Uebererfuellung (negativer Wert) erkennbar bleibt. */
  remaining: number;
}

/**
 * Gleicht eine `GoalVersion` (Ziel) gegen die bestehende `getDealKpi()`-KPI
 * (Ist) fuer den vom `Goal` definierten Kalenderzeitraum ab. Siehe
 * Modulkommentar fuer die verbindliche Metrik-Zuordnung (ChatGPT-GO
 * 2026-08-22) und die bewusste Nicht-Implementierung von `CLOSE_RATE`.
 *
 * Fuehrt selbst KEINE Aggregation durch -- ruft ausschliesslich die
 * bestehende `getDealKpi()` auf und vergleicht das Ergebnis mit dem
 * Zielwert. Erfordert `TenantContext` (wie `getDealKpi()` selbst, siehe
 * `kpis.ts`-Modulkommentar).
 */
export async function computeGoalProgress(
  goal: GoalProgressInput,
  currentVersion: GoalVersionProgressInput,
  scopeFilter: GoalProgressScopeFilter = {},
): Promise<GoalProgress> {
  const { periodStart, periodEnd } = getCalendarPeriodBounds(goal.periodType, goal.periodStart);
  const periodFilter: KpiPeriodFilter = { from: periodStart, to: periodEnd, ...scopeFilter };

  switch (goal.metricKey) {
    case "DEALS_CLOSED": {
      // goal-validator.ts erzwingt targetCount bei DEALS_CLOSED serverseitig
      // -- defense-in-depth statt stillschweigendem Fallback auf 0.
      if (currentVersion.targetCount == null) {
        throw new Error(
          "DEALS_CLOSED-Goal ohne targetCount -- inkonsistenter Datenzustand " +
            "(goal-validator.ts haette dies bereits verhindern muessen).",
        );
      }
      const rows = await getDealKpi(periodFilter);
      // Waehrungsunabhaengige Stueckzahl -- ueber ALLE Currency-Buckets
      // aufsummiert (ChatGPT-GO, siehe Modulkommentar).
      const actual = rows.reduce((sum, row) => sum + row.dealsClosed, 0);
      return buildGoalProgress(currentVersion.targetCount, actual);
    }
    case "REVENUE": {
      // goal-validator.ts erzwingt targetAmountMinor + currency bei REVENUE
      // serverseitig -- defense-in-depth statt stillschweigendem Fallback.
      if (currentVersion.targetAmountMinor == null || goal.currency == null) {
        throw new Error(
          "REVENUE-Goal ohne targetAmountMinor/currency -- inkonsistenter Datenzustand " +
            "(goal-validator.ts haette dies bereits verhindern muessen).",
        );
      }
      const rows = await getDealKpi(periodFilter);
      // Exakt der zu Goal.currency passende Bucket -- NIEMALS ueber
      // Waehrungen aufsummieren oder umrechnen (ChatGPT-GO). Kein Bucket
      // fuer die Goal-Currency in der Periode => actual = 0, kein Fehler.
      const matchingRow = rows.find((row) => row.currency === goal.currency);
      const actual = matchingRow?.totalContractValueMinor ?? 0;
      return buildGoalProgress(currentVersion.targetAmountMinor, actual);
    }
    case "CLOSE_RATE":
      throw new GoalMetricNotImplementedError(goal.metricKey);
    default: {
      const exhaustiveCheck: never = goal.metricKey;
      throw new Error(`Unbekannter GoalMetricKey: ${String(exhaustiveCheck)}`);
    }
  }
}

function buildGoalProgress(target: number, actual: number): GoalProgress {
  return {
    target,
    actual,
    achievementRate: target > 0 ? actual / target : null,
    remaining: target - actual,
  };
}
