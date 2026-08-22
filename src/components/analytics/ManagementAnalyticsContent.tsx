/**
 * Reine Anzeige-Komponente fuer das Management-Analytics-Dashboard (Phase 7
 * AP4, siehe PHASE_7_IMPLEMENTATION_PLAN.md Abschnitt 7). Analog
 * `AnalyticsDashboardContent.tsx` (Mitarbeitersicht) -- enthaelt bewusst KEINE
 * Datenbeschaffung und KEINE eigene Autorisierungslogik (kein `db`-Zugriff,
 * keine Scope-Pruefung hier): reine Funktion von `ManagementAnalyticsView`
 * (bereits serverseitig ueber `resolveAuthorizedStoreFilter()` autorisiert,
 * siehe `management-view.ts`) auf JSX.
 *
 * **EINE** gemeinsame Komponente fuer alle drei Scope-Ebenen (STORE/COMPANY/
 * TENANT, Scope-Entscheidung 1 aus PHASE_7_IMPLEMENTATION_PLAN.md Abschnitt
 * 7) -- der Datenumfang ergibt sich ausschliesslich aus dem bereits
 * autorisierten `view`-Objekt, keine eigene Fallunterscheidung nach Rolle.
 *
 * Filial-"Aufschluesselung" (Plan: "optionale Aufschluesselung nach Filiale")
 * ist hier bewusst schlicht gehalten (kein Chart-Overengineering, analog
 * Phase-6-Prinzip): der bestehende Filial-Filter (wie in der Mitarbeitersicht)
 * erlaubt, zwischen dem vollen autorisierten Scope ("Alle Filialen") und
 * einer einzelnen Filiale umzuschalten -- keine zusaetzliche serverseitige
 * Gruppierungs-Query noetig.
 */

import Link from "next/link";
import type {
  ManagementAnalyticsView,
  ManagementAnalyticsFilter,
} from "@/server/analytics/management-view";
import type { ManagementScopeLevel } from "@/server/authz/management-scope";
import {
  GOAL_METRIC_LABELS,
  formatGoalMetricValue,
  formatGoalPeriodLabel,
} from "@/lib/goal-format";

const SCOPE_LABELS: Record<ManagementScopeLevel, string> = {
  STORE: "Filiale",
  COMPANY: "Unternehmen",
  TENANT: "Mandant",
};

function formatMinorAmount(amountMinor: number, currency: string): string {
  return new Intl.NumberFormat("de-DE", { style: "currency", currency }).format(amountMinor / 100);
}

function formatPercent(rate: number | null): string {
  return rate == null ? "--" : new Intl.NumberFormat("de-DE", { style: "percent" }).format(rate);
}

interface ManagementAnalyticsContentProps {
  view: ManagementAnalyticsView;
  displayName: string;
  period: ManagementAnalyticsFilter["period"];
}

export function ManagementAnalyticsContent({
  view,
  displayName,
  period,
}: ManagementAnalyticsContentProps) {
  const scopeLabel = SCOPE_LABELS[view.scopeLevel];

  return (
    <main className="analytics-dashboard management-dashboard">
      <h1>Management-Analytics</h1>
      <p className="analytics-dashboard__hint">
        Angemeldet als {displayName} &middot; Sicht: {scopeLabel} &middot; Zeitraum:{" "}
        {view.periodLabel}
      </p>

      <form className="analytics-dashboard__filters" method="get">
        <label>
          Zeitraum
          <select name="period" defaultValue={period}>
            <option value="week">Diese Woche</option>
            <option value="month">Dieser Monat</option>
          </select>
        </label>
        {view.storeOptions.length > 1 && (
          <label>
            Filiale
            <select name="storeId" defaultValue={view.storeId ?? ""}>
              <option value="">Alle Filialen ({scopeLabel})</option>
              {view.storeOptions.map((store) => (
                <option key={store.id} value={store.id}>
                  {store.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <button type="submit">Anwenden</button>
      </form>

      <section className="analytics-dashboard__cards">
        <div className="analytics-dashboard__card">
          <h2>Beratungen</h2>
          <p className="analytics-dashboard__card-value">{view.consultationVolume.totalSessions}</p>
          <dl className="analytics-dashboard__card-details">
            <div>
              <dt>Abgeschlossen</dt>
              <dd>{view.consultationVolume.completed}</dd>
            </div>
            <div>
              <dt>Abgebrochen</dt>
              <dd>{view.consultationVolume.abandoned}</dd>
            </div>
            <div>
              <dt>Laufend</dt>
              <dd>{view.consultationVolume.inProgress}</dd>
            </div>
            <div>
              <dt>Completion-Quote</dt>
              <dd>{formatPercent(view.consultationVolume.completionRate)}</dd>
            </div>
            <div>
              <dt>Abbruchquote</dt>
              <dd>{formatPercent(view.consultationVolume.abandonmentRate)}</dd>
            </div>
          </dl>
        </div>

        <div className="analytics-dashboard__card">
          <h2>Empfehlungen</h2>
          <p className="analytics-dashboard__card-value">
            {view.recommendationOutcome.itemsGenerated}
          </p>
          <dl className="analytics-dashboard__card-details">
            <div>
              <dt>Angenommen</dt>
              <dd>{view.recommendationOutcome.accepted}</dd>
            </div>
            <div>
              <dt>Abgelehnt</dt>
              <dd>{view.recommendationOutcome.rejected}</dd>
            </div>
            <div>
              <dt>Zurueckgestellt</dt>
              <dd>{view.recommendationOutcome.deferred}</dd>
            </div>
            <div>
              <dt>Annahmequote</dt>
              <dd>{formatPercent(view.recommendationOutcome.acceptanceRate)}</dd>
            </div>
            <div>
              <dt>Ablehnungsquote</dt>
              <dd>{formatPercent(view.recommendationOutcome.rejectionRate)}</dd>
            </div>
          </dl>
        </div>

        {/* Phase 7 AP4: gegenueber der Mitarbeitersicht zusaetzliche Kacheln
            fuer Provision/Deckungsbeitrag -- nur hier sichtbar (RBAC-geschuetzt). */}
        <div className="analytics-dashboard__card">
          <h2>Abschluesse, Provision &amp; Marge</h2>
          {view.deals.length === 0 ? (
            <p className="analytics-dashboard__card-empty">Keine Abschluesse im Zeitraum.</p>
          ) : (
            view.deals.map((row) => (
              <dl key={row.currency} className="analytics-dashboard__card-details">
                <div>
                  <dt>Anzahl ({row.currency})</dt>
                  <dd>{row.dealsClosed}</dd>
                </div>
                <div>
                  <dt>Monatlicher Umsatz</dt>
                  <dd>{formatMinorAmount(row.monthlyRecurringRevenueMinor, row.currency)}</dd>
                </div>
                <div>
                  <dt>Gesamtvertragswert</dt>
                  <dd>{formatMinorAmount(row.totalContractValueMinor, row.currency)}</dd>
                </div>
                <div>
                  <dt>Provision</dt>
                  <dd>{formatMinorAmount(row.commissionAmountMinor, row.currency)}</dd>
                </div>
                <div>
                  <dt>Deckungsbeitrag</dt>
                  <dd>{formatMinorAmount(row.contributionMarginMinor, row.currency)}</dd>
                </div>
              </dl>
            ))
          )}
        </div>
      </section>

      {/* Phase 11 AP7 (Ziel-vs.-Ist, ChatGPT-GO 2026-08-22): eigene, vom
          Zeitraum-Filter oben UNABHAENGIGE Ziel-Kartensektion. Anders als in
          der Mitarbeitersicht koennen hier MEHRERE Goals unterschiedlicher
          Scopes gleichzeitig sichtbar sein (siehe management-view.ts/
          goal-visibility.ts Modulkommentare zur "keine anteilige
          Zielprojektion"-Regel) -- deshalb wird `scopeLabel` je Karte
          zusaetzlich angezeigt. Reine Anzeige, keine eigene Berechnung. */}
      <section className="analytics-dashboard__goals">
        <h2 className="analytics-dashboard__section-heading">Ziele</h2>
        {view.goals.length === 0 ? (
          <p className="analytics-dashboard__card-empty">
            Keine aktiven Ziele im aktuellen Zeitraum.
          </p>
        ) : (
          <div className="analytics-dashboard__cards">
            {view.goals.map((goal) => (
              <div key={goal.goalId} className="analytics-dashboard__card">
                <h2>{GOAL_METRIC_LABELS[goal.metricKey] ?? goal.metricKey}</h2>
                <p className="analytics-dashboard__card-value">
                  {formatGoalMetricValue(goal.metricKey, goal.actual, goal.currency)}
                </p>
                <dl className="analytics-dashboard__card-details">
                  <div>
                    <dt>Scope</dt>
                    <dd>{goal.scopeLabel}</dd>
                  </div>
                  <div>
                    <dt>Zielwert</dt>
                    <dd>{formatGoalMetricValue(goal.metricKey, goal.target, goal.currency)}</dd>
                  </div>
                  <div>
                    <dt>Zielerreichung</dt>
                    <dd>{formatPercent(goal.achievementRate)}</dd>
                  </div>
                  <div>
                    <dt>{goal.remaining < 0 ? "Ueber Ziel" : "Verbleibend"}</dt>
                    <dd>
                      {formatGoalMetricValue(
                        goal.metricKey,
                        Math.abs(goal.remaining),
                        goal.currency,
                      )}
                    </dd>
                  </div>
                  <div>
                    <dt>Zeitraum</dt>
                    <dd>{formatGoalPeriodLabel(goal.periodType, goal.periodStart)}</dd>
                  </div>
                </dl>
              </div>
            ))}
          </div>
        )}
      </section>

      <p className="analytics-dashboard__back">
        <Link href="/consultation">Zurueck zur Beratungsuebersicht</Link>
      </p>
    </main>
  );
}
