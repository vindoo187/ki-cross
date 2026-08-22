/**
 * Analytics-Dashboard-Komposition (Phase 6 AP8, siehe
 * PHASE_6_IMPLEMENTATION_PLAN.md Abschnitt 3.4). Duenne Adapter-Schicht --
 * loest den Zeitraum-Filter (Woche/Monat) auf und komponiert die reinen
 * KPI-Read-Funktionen aus `kpis.ts` zu einem fertigen View-Model, analog zu
 * `consultation-ui/view-models.ts`. Enthaelt bewusst KEINE eigene
 * SQL-Aggregation -- nur Komposition/Formatierungsvorbereitung.
 *
 * `storeId`-Filter (Plan Abschnitt 3.4: "optionaler Filialfilter fuer
 * Mehrfilialen-Tenants") -- KEIN `employeeId`-Filter in dieser ersten
 * Dashboard-Version, obwohl `kpis.ts` ihn unterstuetzt: Plan Abschnitt 3.4
 * nennt fuer AP8 ausdruecklich nur Zeitraum + Filiale, kein
 * Mitarbeiterfilter (waere zudem ohne RBAC ein eigenes, hier nicht
 * geklaertes Sichtbarkeitsthema).
 *
 * Zeigt bewusst NUR die Umsatz-KPIs (1-7) an -- Provision/Marge (KPI 8) wird
 * aus `getDealKpi()` NICHT in dieses View-Model uebernommen (siehe
 * PHASE_6_IMPLEMENTATION_PLAN.md Abschnitt 12.6: offene, noch mit ChatGPT zu
 * klaerende Frage, ob diese Daten in einem RBAC-losen Dashboard angezeigt
 * werden duerfen).
 */

import { db } from "../db/client";
import {
  getConsultationVolumeKpi,
  getRecommendationOutcomeKpi,
  getDealKpi,
  type ConsultationVolumeKpi,
  type RecommendationOutcomeKpi,
} from "./kpis";
import { buildGoalProgressForEmployee } from "./goal-visibility";
import type { GoalProgressViewModel } from "./goal-progress";

export type AnalyticsPeriodKey = "week" | "month";

/**
 * Zeitraumgrenzen fuer den gewaehlten Filter, bezogen auf `now` (Standard:
 * Serverzeit zum Aufrufzeitpunkt). "week" = laufende ISO-Woche (Montag
 * 00:00 bis kommenden Montag 00:00), "month" = laufender Kalendermonat --
 * beide als dokumentierte Implementierungsannahme (Plan nennt nur die
 * beiden Granularitaeten, keine exakten Grenzen).
 */
/**
 * Exportiert (Phase 7 AP3): `management-view.ts` verwendet dieselbe
 * Zeitraum-Aufloesung fuer die Management-Sicht -- bewusst wiederverwendet
 * statt dupliziert, damit "Diese Woche"/"Dieser Monat" fuer Mitarbeiter- und
 * Management-Sicht garantiert identisch definiert sind.
 */
export function resolvePeriodRange(
  period: AnalyticsPeriodKey,
  now: Date,
): { from: Date; to: Date } {
  if (period === "week") {
    const dayOfWeek = now.getDay(); // 0 = Sonntag
    const daysSinceMonday = (dayOfWeek + 6) % 7;
    const from = new Date(now);
    from.setHours(0, 0, 0, 0);
    from.setDate(from.getDate() - daysSinceMonday);
    const to = new Date(from);
    to.setDate(to.getDate() + 7);
    return { from, to };
  }
  const from = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
  const to = new Date(now.getFullYear(), now.getMonth() + 1, 1, 0, 0, 0, 0);
  return { from, to };
}

/** Exportiert (Phase 7 AP3) fuer dieselbe Wiederverwendung wie {@link resolvePeriodRange}. */
export const PERIOD_LABELS: Record<AnalyticsPeriodKey, string> = {
  week: "Diese Woche",
  month: "Dieser Monat",
};

export interface AnalyticsStoreOption {
  id: string;
  name: string;
}

export interface AnalyticsDashboardFilter {
  period: AnalyticsPeriodKey;
  storeId?: string;
}

export interface AnalyticsDashboardView {
  period: AnalyticsPeriodKey;
  periodLabel: string;
  /** ISO-8601 (UTC). */
  from: string;
  /** ISO-8601 (UTC), exklusiv. */
  to: string;
  storeId: string | null;
  /** Nur befuellt, wenn der Mandant mehr als eine Filiale hat (Plan: "fuer Mehrfilialen-Tenants"). */
  storeOptions: AnalyticsStoreOption[];
  consultationVolume: ConsultationVolumeKpi;
  recommendationOutcome: RecommendationOutcomeKpi;
  /** Nur Anzahl + Umsatz (KPI 5-7) -- Provision/Marge bewusst nicht Teil dieses View-Models (siehe Modulkommentar). */
  deals: {
    currency: string;
    dealsClosed: number;
    monthlyRecurringRevenueMinor: number;
    totalContractValueMinor: number;
  }[];
  /**
   * Phase 11 AP7 (Ziel-vs.-Ist, ChatGPT-GO 2026-08-22 nach AP7-Discovery):
   * ausschliesslich das/die eigene(n) AKTIVE(n) EMPLOYEE-Goal(s)
   * (`buildGoalProgressForEmployee()`, `goal-visibility.ts`). Bewusst
   * UNABHAENGIG vom `period`-Filter oben (eigene, feste Kalenderperiode je
   * Goal statt Woche/Monat) -- siehe Modulkommentar dort.
   */
  goals: GoalProgressViewModel[];
}

/** Listet alle Filialen des aktuellen Mandanten (Grundlage fuer den Filialfilter, nur bei Mehrfilialen-Tenants relevant). */
async function listStoreOptions(): Promise<AnalyticsStoreOption[]> {
  const stores = await db.store.findMany({
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });
  return stores;
}

export async function buildAnalyticsDashboardView(
  filter: AnalyticsDashboardFilter,
  now: Date = new Date(),
): Promise<AnalyticsDashboardView> {
  const { from, to } = resolvePeriodRange(filter.period, now);
  const kpiFilter = { from, to, storeId: filter.storeId };

  const [consultationVolume, recommendationOutcome, dealsByCurrency, storeOptions, goals] =
    await Promise.all([
      getConsultationVolumeKpi(kpiFilter),
      getRecommendationOutcomeKpi(kpiFilter),
      getDealKpi(kpiFilter),
      listStoreOptions(),
      buildGoalProgressForEmployee(now),
    ]);

  return {
    period: filter.period,
    periodLabel: PERIOD_LABELS[filter.period],
    from: from.toISOString(),
    to: to.toISOString(),
    storeId: filter.storeId ?? null,
    storeOptions: storeOptions.length > 1 ? storeOptions : [],
    consultationVolume,
    recommendationOutcome,
    deals: dealsByCurrency.map((row) => ({
      currency: row.currency,
      dealsClosed: row.dealsClosed,
      monthlyRecurringRevenueMinor: row.monthlyRecurringRevenueMinor,
      totalContractValueMinor: row.totalContractValueMinor,
    })),
    goals,
  };
}
