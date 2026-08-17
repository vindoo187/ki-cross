/**
 * Reine Anzeige-Komponente fuer das Analytics-Dashboard (Phase 6 AP12
 * Hardening -- aus `src/app/analytics/page.tsx` extrahiert, damit die
 * Darstellung isoliert komponententestbar ist, analog `SessionSummaryView.tsx`
 * fuer die Zusammenfassungsseite). Enthaelt bewusst KEINE Datenbeschaffung
 * (kein `db`-Zugriff, kein Auth-Check) -- reine Funktion von
 * `AnalyticsDashboardView` auf JSX. Siehe `dashboard-view.ts`-Modulkommentar
 * zur bewussten Auslassung von Provisions-/Margendaten aus dem View-Model.
 */

import Link from "next/link";
import type { AnalyticsDashboardView, AnalyticsPeriodKey } from "@/server/analytics/dashboard-view";

function formatMinorAmount(amountMinor: number, currency: string): string {
  return new Intl.NumberFormat("de-DE", { style: "currency", currency }).format(amountMinor / 100);
}

function formatPercent(rate: number | null): string {
  return rate == null ? "--" : new Intl.NumberFormat("de-DE", { style: "percent" }).format(rate);
}

interface AnalyticsDashboardContentProps {
  view: AnalyticsDashboardView;
  displayName: string;
  period: AnalyticsPeriodKey;
}

export function AnalyticsDashboardContent({
  view,
  displayName,
  period,
}: AnalyticsDashboardContentProps) {
  return (
    <main className="analytics-dashboard">
      <h1>Analytics</h1>
      <p className="analytics-dashboard__hint">
        Angemeldet als {displayName} &middot; Zeitraum: {view.periodLabel}
      </p>

      <form className="analytics-dashboard__filters" method="get">
        <label>
          Zeitraum
          <select name="period" defaultValue={period}>
            <option value="week">Diese Woche</option>
            <option value="month">Dieser Monat</option>
          </select>
        </label>
        {view.storeOptions.length > 0 && (
          <label>
            Filiale
            <select name="storeId" defaultValue={view.storeId ?? ""}>
              <option value="">Alle Filialen</option>
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

        <div className="analytics-dashboard__card">
          <h2>Abschluesse</h2>
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
              </dl>
            ))
          )}
        </div>
      </section>

      <p className="analytics-dashboard__back">
        <Link href="/consultation">Zurueck zur Beratungsuebersicht</Link>
      </p>
    </main>
  );
}
