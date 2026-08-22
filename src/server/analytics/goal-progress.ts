import type { GoalMetricKey, GoalPeriodType } from "@prisma/client";
import { getConsultationVolumeKpi, getDealKpi, type KpiPeriodFilter } from "./kpis";

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
 * - CLOSE_RATE -> "periodische Abschlussquote" (ChatGPT-GO 2026-08-22, nach
 *   Discovery-Verifikation): `dealsClosed / totalSessions`, Zaehler aus
 *   `getDealKpi()` (identisches DEALS_CLOSED-Mapping), Nenner aus
 *   `getConsultationVolumeKpi().totalSessions`, BEIDE mit exakt denselben
 *   `[periodStart, periodEnd)`-Grenzen. Bewusst OHNE Session->Deal-Zuordnung
 *   auf Datensatzebene -- ein reines Perioden-Verhaeltnis (analog "Leads
 *   this month" vs. "Deals this month"), KEINE Kohorten-Conversion-Rate.
 *   `totalSessions === 0` -> `actual = null`-Aequivalent: siehe
 *   `buildGoalProgress()`, `achievementRate` wird `null` (mathematisch
 *   undefiniert, analog `RecommendationOutcomeKpi.acceptanceRate`).
 *   WICHTIG (eigene Praezisierung, siehe Bericht an ChatGPT): `target` liegt
 *   in `targetPercentageBasisPoints` bereits als Basispunkte vor (0..10000,
 *   siehe `goal-schemas.ts`/`commission.ts`-Konvention: 10000 Basispunkte =
 *   100 %). Damit `achievementRate = actual / target` einheitlich bleibt,
 *   wird `actual` ebenfalls in Basispunkten berechnet
 *   (`dealsClosed / totalSessions * 10000`, gerundet), NICHT als Prozentzahl
 *   0..100. Sonst waere `achievementRate` um Faktor 100 verfaelscht.
 *   Es wird bewusst KEINE neue `getCloseRateKpi()`-Funktion in `kpis.ts`
 *   eingefuehrt (ChatGPT-Auflage) -- die Division bleibt lokal in
 *   `computeGoalProgress()`.
 *
 * `computeGoalProgress()` fuehrt KEINE eigene KPI-Aggregation durch, sondern
 * ruft ausschliesslich bestehende KPI-Funktionen auf (ChatGPT-Auflage:
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
 * Wird aktuell fuer keinen `GoalMetricKey` mehr geworfen -- alle drei
 * Metriken (`DEALS_CLOSED`/`REVENUE`/`CLOSE_RATE`) sind seit AP4 Schritt 3
 * implementiert (ChatGPT-GO 2026-08-22). Bleibt als Defense-in-Depth-Klasse
 * fuer einen zukuenftigen, noch nicht abgebildeten `GoalMetricKey` erhalten,
 * falls der Enum spaeter erweitert wird, bevor `computeGoalProgress()`
 * nachgezogen ist.
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
  /** Ist-Wert aus der/den zustaendigen KPI-Funktion(en) fuer den ueber `getCalendarPeriodBounds()` abgeleiteten Zeitraum (siehe Modulkommentar). */
  actual: number;
  /** `actual / target`, `null` falls `target` 0 ist (Division durch 0 vermieden, analog `kpis.ts`-Konvention). */
  achievementRate: number | null;
  /** `target - actual` -- bewusst NICHT auf 0 geclampt, damit Uebererfuellung (negativer Wert) erkennbar bleibt. */
  remaining: number;
}

/**
 * Gleicht eine `GoalVersion` (Ziel) gegen die bestehende(n) KPI-Funktion(en)
 * (Ist) fuer den vom `Goal` definierten Kalenderzeitraum ab. Siehe
 * Modulkommentar fuer die verbindliche Metrik-Zuordnung (ChatGPT-GO
 * 2026-08-22, CLOSE_RATE-GO 2026-08-22 nach Discovery-Verifikation).
 *
 * Fuehrt selbst KEINE eigene KPI-Aggregation durch -- ruft ausschliesslich
 * bestehende KPI-Funktionen (`getDealKpi()`, bei CLOSE_RATE zusaetzlich
 * `getConsultationVolumeKpi()`) auf und vergleicht das Ergebnis mit dem
 * Zielwert. Erfordert `TenantContext` (wie die aufgerufenen KPI-Funktionen
 * selbst, siehe `kpis.ts`-Modulkommentar).
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
    case "CLOSE_RATE": {
      // goal-validator.ts erzwingt targetPercentageBasisPoints bei CLOSE_RATE
      // serverseitig -- defense-in-depth statt stillschweigendem Fallback.
      if (currentVersion.targetPercentageBasisPoints == null) {
        throw new Error(
          "CLOSE_RATE-Goal ohne targetPercentageBasisPoints -- inkonsistenter Datenzustand " +
            "(goal-validator.ts haette dies bereits verhindern muessen).",
        );
      }
      // Zaehler identisch zum DEALS_CLOSED-Mapping (waehrungsunabhaengige
      // Stueckzahl ueber alle Currency-Buckets), Nenner aus der bestehenden
      // Beratungsvolumen-KPI -- BEIDE mit denselben [periodStart, periodEnd)
      // Grenzen (ChatGPT-GO, siehe Modulkommentar).
      const [dealRows, consultationVolume] = await Promise.all([
        getDealKpi(periodFilter),
        getConsultationVolumeKpi(periodFilter),
      ]);
      const dealsClosed = dealRows.reduce((sum, row) => sum + row.dealsClosed, 0);
      const totalSessions = consultationVolume.totalSessions;
      // 0 Beratungen in der Periode => mathematisch undefiniert, nicht 0 %
      // (analog RecommendationOutcomeKpi.acceptanceRate-Konvention). Da
      // GoalProgress.actual als number typisiert ist (kein number | null wie
      // bei den anderen Metriken), wird hier 0 als actual zurueckgegeben,
      // ABER achievementRate wird ueber buildGoalProgress() bereits dann auf
      // null gesetzt, wenn target 0 ist -- das deckt den 0-Beratungen-Fall
      // NICHT ab (target kann > 0 sein bei 0 Beratungen). Deshalb hier ein
      // expliziter Sonderfall: bei totalSessions === 0 wird achievementRate
      // zusaetzlich auf null erzwungen (siehe Rueckgabe unten).
      if (totalSessions === 0) {
        return {
          target: currentVersion.targetPercentageBasisPoints,
          actual: 0,
          achievementRate: null,
          remaining: currentVersion.targetPercentageBasisPoints,
        };
      }
      // Basispunkte (0..10000 = 0..100 %), NICHT Prozentzahl 0..100 -- muss
      // dieselbe Einheit wie targetPercentageBasisPoints haben, siehe
      // Modulkommentar.
      const actual = Math.round((dealsClosed / totalSessions) * 10000);
      return buildGoalProgress(currentVersion.targetPercentageBasisPoints, actual);
    }
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
