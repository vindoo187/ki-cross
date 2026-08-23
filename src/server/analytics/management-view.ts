/**
 * Management-Analytics-Dashboard-Komposition (Phase 7 AP3, siehe
 * PHASE_7_IMPLEMENTATION_PLAN.md Abschnitt 6). Duenne Adapter-Schicht, analog
 * `dashboard-view.ts` (Mitarbeitersicht) -- komponiert die reinen
 * KPI-Read-Funktionen aus `kpis.ts` zu einem fertigen View-Model. Enthaelt
 * bewusst KEINE eigene SQL-Aggregation UND KEINE eigene Autorisierungslogik:
 * `resolveAuthorizedStoreFilter()` (`management-authz.ts`) ist die EINZIGE
 * Quelle des Store-/Mitarbeiter-Filters, der an die KPI-Funktionen geht
 * (Autorisierung-VOR-Aggregation-Leitplanke, ChatGPT verbindlich) --
 * `buildManagementAnalyticsView()` konstruiert selbst keinen eigenen Filter.
 *
 * Unterschied zur Mitarbeitersicht (`dashboard-view.ts`): dieses View-Model
 * enthaelt das VOLLE `DealKpiByCurrency` inklusive `commissionAmountMinor`/
 * `contributionMarginMinor` -- diese Werte sind bewusst nur in der
 * RBAC-geschuetzten Management-Sicht sichtbar (Phase-6-Entscheidung, hier
 * umgesetzt).
 */

import { db } from "../db/client";
import { resolveAuthorizedStoreFilter, ManagementAccessDeniedError } from "./management-authz";
import { resolvePeriodRange, PERIOD_LABELS, type AnalyticsPeriodKey } from "./dashboard-view";
import {
  getConsultationVolumeKpi,
  getRecommendationOutcomeKpi,
  getDealKpi,
  type ConsultationVolumeKpi,
  type RecommendationOutcomeKpi,
  type DealKpiByCurrency,
} from "./kpis";
import { buildGoalProgressForManagement } from "./goal-visibility";
import type { GoalProgressViewModel } from "./goal-progress";
import type { ManagementScope, ManagementScopeLevel } from "../authz/management-scope";

export interface ManagementAnalyticsFilter {
  period: AnalyticsPeriodKey;
  /** Optionaler, vom Client angefragter Filialfilter -- wird gegen den Scope geprueft, siehe management-authz.ts. */
  storeId?: string;
  /** Optionaler, vom Client angefragter Mitarbeiterfilter -- wird gegen den Scope geprueft, siehe management-authz.ts. */
  employeeId?: string;
}

export interface ManagementAnalyticsStoreOption {
  id: string;
  name: string;
}

export interface ManagementAnalyticsView {
  period: AnalyticsPeriodKey;
  periodLabel: string;
  /** ISO-8601 (UTC). */
  from: string;
  /** ISO-8601 (UTC), exklusiv. */
  to: string;
  /** Scope-Ebene des anfragenden Users (fuer die UI, z. B. "Filiale"/"Unternehmen"/"Mandant"-Bezeichnung). */
  scopeLevel: ManagementScopeLevel;
  /** Der VOLLE autorisierte Store-Umfang (fuer einen Filial-Umschalter in AP4) -- unabhaengig von einer evtl. Einschraenkung durch `storeId`. */
  authorizedStoreIds: string[];
  /** Der tatsaechlich angewendete Filialfilter (nach Pruefung durch resolveAuthorizedStoreFilter), `null` = voller Scope. */
  storeId: string | null;
  /** Der tatsaechlich angewendete Mitarbeiterfilter (nach Pruefung), `null` = kein Mitarbeiterfilter. */
  employeeId: string | null;
  /** Filialen INNERHALB des autorisierten Scopes (fuer einen Filial-Dropdown in AP4). */
  storeOptions: ManagementAnalyticsStoreOption[];
  consultationVolume: ConsultationVolumeKpi;
  recommendationOutcome: RecommendationOutcomeKpi;
  /** Volles KPI 5-8 INKLUSIVE commissionAmountMinor/contributionMarginMinor -- Unterschied zur Mitarbeitersicht. */
  deals: DealKpiByCurrency[];
  /**
   * Phase 11 AP7 (Ziel-vs.-Ist, ChatGPT-GO 2026-08-22 nach AP7-Discovery):
   * alle AKTIVEN Goals, die fuer den aktuell angewendeten `storeId`/
   * `employeeId`-Filter SOWOHL autorisiert ALS AUCH scope-passend sind
   * (`buildGoalProgressForManagement()`, `goal-visibility.ts` -- siehe
   * dortigen Modulkommentar zur "keine anteilige Zielprojektion"-Regel).
   * Bewusst UNABHAENGIG vom `period`-Filter oben.
   */
  goals: GoalProgressViewModel[];
}

/** Listet die Filialen INNERHALB der bereits autorisierten Store-Menge (kein ungeprueftes `db.store.findMany()` ueber den ganzen Mandanten). */
async function listAuthorizedStoreOptions(
  authorizedStoreIds: string[],
): Promise<ManagementAnalyticsStoreOption[]> {
  return db.store.findMany({
    where: { id: { in: authorizedStoreIds } },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });
}

/**
 * Baut das Management-Analytics-View-Model. Muss innerhalb eines aktiven
 * `TenantContext` aufgerufen werden.
 *
 * Ablauf (Autorisierung-VOR-Aggregation): zuerst wird `filter.storeId`/
 * `filter.employeeId` ueber `resolveAuthorizedStoreFilter()` gegen den
 * `scope` geprueft -- danach werden die KPI-Funktionen AUSSCHLIESSLICH mit
 * dem so autorisierten Filter aufgerufen.
 *
 * @throws {ManagementAccessDeniedError} bei `scope === null` (deny-by-default)
 *   oder einem Zugriffsversuch ausserhalb des Scopes (IDOR-Schutz).
 */
export async function buildManagementAnalyticsView(
  scope: ManagementScope | null,
  filter: ManagementAnalyticsFilter,
  now: Date = new Date(),
): Promise<ManagementAnalyticsView> {
  // Erneute Deny-by-default-Pruefung an der Kompositionsschicht (Defense-in-
  // Depth, analog dem zweischichtigen Tenant-Scoping in scoped-client.ts):
  // `resolveAuthorizedStoreFilter()` wirft bei null-Scope ohnehin denselben
  // Fehler, aber der explizite Guard hier erlaubt TypeScript, `scope` fuer
  // den Rest der Funktion als `ManagementScope` (nicht-null) zu verengen --
  // ohne eine Non-Null-Assertion zu benoetigen.
  if (!scope) {
    throw new ManagementAccessDeniedError();
  }

  const authorized = await resolveAuthorizedStoreFilter(scope, filter.storeId, filter.employeeId);
  const { from, to } = resolvePeriodRange(filter.period, now);
  const kpiFilter = { from, to, storeIds: authorized.storeIds, employeeId: authorized.employeeId };

  const [consultationVolume, recommendationOutcome, deals, storeOptions, goals] = await Promise.all(
    [
      getConsultationVolumeKpi(kpiFilter),
      getRecommendationOutcomeKpi(kpiFilter),
      getDealKpi(kpiFilter),
      listAuthorizedStoreOptions(authorized.storeIds),
      // Bewusst der ROH angefragte filter.storeId/filter.employeeId (NICHT
      // authorized.storeIds) -- buildGoalProgressForManagement() muss den
      // exakt aktuell angewendeten Filter kennen, um Goal-Scope UND
      // Autorisierung gemeinsam zu pruefen (siehe Modulkommentar
      // goal-visibility.ts, ChatGPTs AP7-Praezisierung).
      buildGoalProgressForManagement(scope, filter.storeId, filter.employeeId, now),
    ],
  );

  return {
    period: filter.period,
    periodLabel: PERIOD_LABELS[filter.period],
    from: from.toISOString(),
    to: to.toISOString(),
    scopeLevel: scope.level,
    authorizedStoreIds: authorized.storeIds,
    storeId: filter.storeId ?? null,
    employeeId: authorized.employeeId ?? null,
    storeOptions,
    consultationVolume,
    recommendationOutcome,
    deals,
    goals,
  };
}
