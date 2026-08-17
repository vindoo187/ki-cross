/**
 * Analytics-Dashboard `/analytics` (Phase 6 AP8, siehe
 * PHASE_6_IMPLEMENTATION_PLAN.md Abschnitt 3.4). Server Component -- laedt
 * das bereits server-seitig komponierte `AnalyticsDashboardView`
 * (`buildAnalyticsDashboardView()`, siehe `dashboard-view.ts`), reine
 * Anzeige. Zeitraum-/Filialfilter als einfaches GET-`<form>` (kein Client-
 * JS noetig) -- konsistent mit "kein Chart-Overengineering" (Plan Abschnitt
 * 3.4): erste Version zeigt Zahlen/Karten, keine Diagramme.
 *
 * Zugriff: wie `/consultation` nur "eingeloggt" (kein RBAC, siehe
 * bestehender, dokumentierter Stop-Punkt aus Phase 5) -- jeder
 * authentifizierte Mitarbeiter sieht das Dashboard fuer seinen Mandanten.
 * Zeigt bewusst KEINE Provisions-/Margendaten (siehe Modulkommentar in
 * `dashboard-view.ts`).
 */

import Link from "next/link";
import { redirect } from "next/navigation";
import {
  getOptionalServerSession,
  withServerSessionTenantContext,
} from "@/server/auth/server-context";
import {
  buildAnalyticsDashboardView,
  type AnalyticsPeriodKey,
} from "@/server/analytics/dashboard-view";

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<{ period?: string; storeId?: string }>;
}

function isPeriodKey(value: string | undefined): value is AnalyticsPeriodKey {
  return value === "week" || value === "month";
}

function formatMinorAmount(amountMinor: number, currency: string): string {
  return new Intl.NumberFormat("de-DE", { style: "currency", currency }).format(amountMinor / 100);
}

function formatPercent(rate: number | null): string {
  return rate == null ? "--" : new Intl.NumberFormat("de-DE", { style: "percent" }).format(rate);
}

export default async function AnalyticsDashboardPage({ searchParams }: PageProps) {
  const session = await getOptionalServerSession();
  if (!session) {
    redirect("/login");
  }

  const params = await searchParams;
  const period: AnalyticsPeriodKey = isPeriodKey(params.period) ? params.period : "week";
  const storeId = params.storeId && params.storeId.length > 0 ? params.storeId : undefined;

  const view = await withServerSessionTenantContext(() =>
    buildAnalyticsDashboardView({ period, storeId }),
  );

  return (
    <main className="analytics-dashboard">
      <h1>Analytics</h1>
      <p className="analytics-dashboard__hint">
        Angemeldet als {session.displayName} &middot; Zeitraum: {view.periodLabel}
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
