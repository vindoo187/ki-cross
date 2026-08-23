/**
 * Analytics-KPI-Aggregation (Phase 6 AP7, siehe PHASE_6_IMPLEMENTATION_PLAN.md
 * Abschnitt 3.3 fuer die von ChatGPT priorisierte Kern-KPI-Liste). Reine
 * Read-Funktionen, LIVE gegen die bestehenden Fachtabellen aggregiert -- kein
 * `KpiSnapshot` (ChatGPT-Vorgabe im Plan-Review: kein Snapshot-Mechanismus in
 * Phase 6, siehe Plan Abschnitt 1.4/12.1). SQL-seitige Aggregation ueber
 * Prisma `count()`/`groupBy()`/`aggregate()` -- keine Anwendungslogik-
 * Schleifen ueber grosse Datenmengen.
 *
 * Muss innerhalb eines `TenantContext` aufgerufen werden (nutzt den
 * mandantengescopten Client `db`), analog `consultation-ui/view-models.ts`.
 * Enthaelt bewusst KEINE UI-Sichtbarkeitsentscheidungen (z. B. ob Provisions-/
 * Margendaten angezeigt werden) -- das ist Aufgabe der aufrufenden
 * Dashboard-Schicht (AP8), nicht dieser reinen Datenschicht.
 *
 * Implementierungsannahme (dokumentiert, keine Fachvorgabe): jede KPI
 * filtert nach dem fachlich naheliegendsten Zeitstempel des jeweiligen
 * Datensatzes fuer den angefragten Zeitraum (Sessions: `startedAt`,
 * Empfehlungen: `generatedAt`, Empfehlungs-Outcomes: `decidedAt`, Deals:
 * `closedAt`) -- NICHT ueber eine gemeinsame Session-Kohorte verknuepft.
 * "Abschlussquote" (Deals/Sessions, siehe Dashboard-Komposition in AP8) ist
 * damit ein PERIODEN-Verhaeltnis (Deals abgeschlossen in Periode / Beratungen
 * gestartet in Periode), kein exaktes Pro-Session-Konversionsmass -- ein Deal
 * kann z. B. kurz nach Periodenende zu einer Session aus der Periode
 * geschlossen werden. Dies ist die im Vertriebs-Reporting uebliche Konvention
 * (analog "Leads this month" vs. "Deals this month") und fuer ein erstes
 * Dashboard (Plan Abschnitt 3.4: "kein Chart-Overengineering") ausreichend.
 */

import { db } from "../db/client";
import type { ConsultationStatus, RecommendationOutcomeType } from "@prisma/client";

export interface KpiPeriodFilter {
  from: Date;
  to: Date;
  /** Einzel-Filialfilter der Mitarbeitersicht (`/analytics`) -- unveraendert seit Phase 6. */
  storeId?: string;
  /**
   * Mengen-Filialfilter der Management-Sicht (Phase 7 AP2/AP3): eine
   * COMPANY-/TENANT-Berechtigung umfasst typischerweise mehrere Filialen.
   * Wird ausschliesslich von `resolveAuthorizedStoreFilter()`
   * (`src/server/analytics/management-authz.ts`) befuellt, niemals direkt
   * aus ungeprueften Request-Parametern. `storeId` und `storeIds` schliessen
   * sich in der Praxis gegenseitig aus (Mitarbeiter- vs. Management-Sicht),
   * werden hier aber unabhaengig behandelt (beide als zusaetzliche
   * UND-Bedingung), falls beide gesetzt sind.
   */
  storeIds?: string[];
  employeeId?: string;
}

function storeEmployeeWhere(filter: KpiPeriodFilter) {
  return {
    ...(filter.storeId ? { storeId: filter.storeId } : {}),
    ...(filter.storeIds ? { storeId: { in: filter.storeIds } } : {}),
    ...(filter.employeeId ? { employeeId: filter.employeeId } : {}),
  };
}

// ---------------------------------------------------------------------------
// KPI 1+2 -- Beratungen (Anzahl) + Completion-/Abbruchquote
// ---------------------------------------------------------------------------

export interface ConsultationVolumeKpi {
  totalSessions: number;
  completed: number;
  abandoned: number;
  inProgress: number;
  /** `null`, falls weder COMPLETED noch ABANDONED in der Periode vorliegen (Division durch 0 vermieden). */
  completionRate: number | null;
  abandonmentRate: number | null;
}

/** Beratungen im Zeitraum, gefiltert nach `ConsultationSession.startedAt`. */
export async function getConsultationVolumeKpi(
  filter: KpiPeriodFilter,
): Promise<ConsultationVolumeKpi> {
  const grouped = await db.consultationSession.groupBy({
    by: ["status"],
    where: {
      startedAt: { gte: filter.from, lt: filter.to },
      ...storeEmployeeWhere(filter),
    },
    _count: { _all: true },
  });

  const countByStatus = new Map<ConsultationStatus, number>(
    grouped.map((row) => [row.status, row._count._all]),
  );
  const completed = countByStatus.get("COMPLETED") ?? 0;
  const abandoned = countByStatus.get("ABANDONED") ?? 0;
  const inProgress = countByStatus.get("IN_PROGRESS") ?? 0;
  const decided = completed + abandoned;

  return {
    totalSessions: completed + abandoned + inProgress,
    completed,
    abandoned,
    inProgress,
    completionRate: decided > 0 ? completed / decided : null,
    abandonmentRate: decided > 0 ? abandoned / decided : null,
  };
}

// ---------------------------------------------------------------------------
// KPI 3+4 -- Empfehlungen generiert + Annahme-/Ablehnungsquote
// ---------------------------------------------------------------------------

export interface RecommendationOutcomeKpi {
  /** Nur `eligibilityPassed = true`-Items (tatsaechlich dem Mitarbeiter angezeigte Empfehlungen, siehe `buildConsultationRecommendationView()`). */
  itemsGenerated: number;
  accepted: number;
  rejected: number;
  deferred: number;
  /** `accepted + rejected + deferred` -- Nenner fuer die Quoten. */
  decided: number;
  /** `null`, falls noch keine Entscheidung in der Periode vorliegt. */
  acceptanceRate: number | null;
  rejectionRate: number | null;
}

/**
 * Empfehlungs-Items im Zeitraum (`Recommendation.generatedAt`) sowie deren
 * Entscheidungen (`RecommendationOutcome.decidedAt`) -- BEWUSST zwei separat
 * gefilterte Aggregationen (nicht derselbe Zeitraum-Zweck): "generiert" zaehlt
 * neu erzeugte Empfehlungen der Periode, "entschieden" zaehlt in der Periode
 * getroffene Annahme-/Ablehnungsentscheidungen, die sich auch auf Empfehlungen
 * ausserhalb der Periode beziehen koennen (z. B. spaete Entscheidung zu einer
 * frueher generierten Empfehlung). Beide Zahlen sind fuer sich genommen
 * korrekt, aber NICHT als Zaehler/Nenner derselben Kohorte zu interpretieren.
 */
export async function getRecommendationOutcomeKpi(
  filter: KpiPeriodFilter,
): Promise<RecommendationOutcomeKpi> {
  const sessionFilter = storeEmployeeWhere(filter);

  const itemsGenerated = await db.recommendationItem.count({
    where: {
      eligibilityPassed: true,
      recommendation: {
        generatedAt: { gte: filter.from, lt: filter.to },
        session: sessionFilter,
      },
    },
  });

  const groupedOutcomes = await db.recommendationOutcome.groupBy({
    by: ["outcome"],
    where: {
      decidedAt: { gte: filter.from, lt: filter.to },
      recommendationItem: { recommendation: { session: sessionFilter } },
    },
    _count: { _all: true },
  });

  const countByOutcome = new Map<RecommendationOutcomeType, number>(
    groupedOutcomes.map((row) => [row.outcome, row._count._all]),
  );
  const accepted = countByOutcome.get("ACCEPTED") ?? 0;
  const rejected = countByOutcome.get("REJECTED") ?? 0;
  const deferred = countByOutcome.get("DEFERRED") ?? 0;
  const decided = accepted + rejected + deferred;

  return {
    itemsGenerated,
    accepted,
    rejected,
    deferred,
    decided,
    acceptanceRate: decided > 0 ? accepted / decided : null,
    rejectionRate: decided > 0 ? rejected / decided : null,
  };
}

// ---------------------------------------------------------------------------
// KPI 5-8 -- Abschluesse, Umsatz, Provision/Marge
// ---------------------------------------------------------------------------

/**
 * Deal-Kennzahlen PRO WAEHRUNG (`ProductVersion.currency` -> `Deal.currency`)
 * -- Minor-Betraege verschiedener Waehrungen duerfen nicht blind summiert
 * werden. In der aktuellen Produktdatenbasis ist praktisch nur "EUR" im
 * Einsatz (siehe Seed-Daten), das Schema erlaubt aber grundsaetzlich
 * mandantenweit unterschiedliche Waehrungen je `ProductVersion` -- daher
 * hier bewusst als Array statt einer einzelnen Summe.
 *
 * `commissionAmountMinor`/`contributionMarginMinor` sind Teil dieses
 * Ergebnisses (KPI 8, "Provision/Marge") -- ob diese Felder tatsaechlich in
 * der Dashboard-UI (AP8) angezeigt werden, ist eine separate, noch zu
 * treffende Entscheidung (siehe PHASE_6_IMPLEMENTATION_PLAN.md Abschnitt 8,
 * offener AP8-Punkt): die bestehende Regel "Provisions-/Margendaten nicht in
 * der Mitarbeiter-UI" galt bisher fuer die Pro-Sitzung-Empfehlungsansicht;
 * ob sie auch fuer ein aggregiertes Management-Dashboard ohne RBAC gilt, ist
 * vor der UI-Umsetzung mit ChatGPT zu klaeren.
 */
export interface DealKpiByCurrency {
  currency: string;
  dealsClosed: number;
  monthlyRecurringRevenueMinor: number;
  oneTimeRevenueMinor: number;
  totalContractValueMinor: number;
  commissionAmountMinor: number;
  contributionMarginMinor: number;
}

/** Deals im Zeitraum, gefiltert nach `Deal.closedAt`. */
export async function getDealKpi(filter: KpiPeriodFilter): Promise<DealKpiByCurrency[]> {
  const grouped = await db.dealFinancialSnapshot.groupBy({
    by: ["currency"],
    where: {
      deal: {
        closedAt: { gte: filter.from, lt: filter.to },
        ...storeEmployeeWhere(filter),
      },
    },
    _count: { _all: true },
    _sum: {
      monthlyRecurringRevenueMinor: true,
      oneTimeRevenueMinor: true,
      totalContractValueMinor: true,
      commissionAmountMinor: true,
      contributionMarginMinor: true,
    },
  });

  return grouped.map((row) => ({
    currency: row.currency,
    dealsClosed: row._count._all,
    monthlyRecurringRevenueMinor: row._sum.monthlyRecurringRevenueMinor ?? 0,
    oneTimeRevenueMinor: row._sum.oneTimeRevenueMinor ?? 0,
    totalContractValueMinor: row._sum.totalContractValueMinor ?? 0,
    commissionAmountMinor: row._sum.commissionAmountMinor ?? 0,
    contributionMarginMinor: row._sum.contributionMarginMinor ?? 0,
  }));
}
