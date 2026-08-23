/**
 * Komponententests fuer `AnalyticsDashboardContent.tsx` (Phase 6 AP12,
 * ChatGPT-Vorgabe "Analytics-Dashboard: Dashboard laedt, KPI-Werte werden
 * korrekt dargestellt, keine Provisions-/Margenwerte werden im Mitarbeiter-
 * Dashboard gerendert, Empty-State funktioniert"). Reine Anzeige-Komponente
 * (siehe deren Modulkommentar) -- kein `fetch`/`useRouter`-Mock noetig, da
 * das GET-Formular ohne Client-JS auskommt.
 */
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { AnalyticsDashboardContent } from "@/components/analytics/AnalyticsDashboardContent";
import type { AnalyticsDashboardView } from "@/server/analytics/dashboard-view";

function buildView(overrides: Partial<AnalyticsDashboardView> = {}): AnalyticsDashboardView {
  return {
    period: "week",
    periodLabel: "Diese Woche",
    from: "2026-08-10T00:00:00.000Z",
    to: "2026-08-17T00:00:00.000Z",
    storeId: null,
    storeOptions: [],
    consultationVolume: {
      totalSessions: 10,
      completed: 6,
      abandoned: 2,
      inProgress: 2,
      completionRate: 0.75,
      abandonmentRate: 0.25,
    },
    recommendationOutcome: {
      itemsGenerated: 20,
      accepted: 8,
      rejected: 4,
      deferred: 1,
      decided: 13,
      acceptanceRate: 8 / 13,
      rejectionRate: 4 / 13,
    },
    deals: [
      {
        currency: "EUR",
        dealsClosed: 5,
        monthlyRecurringRevenueMinor: 19950,
        totalContractValueMinor: 25000,
      },
    ],
    // Phase 11 AP7: neues Pflichtfeld auf AnalyticsDashboardView -- leeres
    // Array als Default (kein aktives Goal), da diese bestehenden Tests die
    // Goal-Kartensektion nicht pruefen (siehe eigene Tests dafuer).
    goals: [],
    ...overrides,
  };
}

describe("AnalyticsDashboardContent", () => {
  it("zeigt Beratungs-/Empfehlungs-/Abschluss-KPIs korrekt an", () => {
    render(
      <AnalyticsDashboardContent view={buildView()} displayName="Max Mustermann" period="week" />,
    );
    expect(screen.getByText(/Angenommen als Max Mustermann/)).toBeInTheDocument();
    expect(screen.getByText("10")).toBeInTheDocument(); // totalSessions
    expect(screen.getByText("20")).toBeInTheDocument(); // itemsGenerated
    expect(screen.getByText("75 %")).toBeInTheDocument(); // completionRate formatiert
    expect(screen.getByText("199,50 €")).toBeInTheDocument(); // monthlyRecurringRevenueMinor
  });

  it("zeigt '--' fuer Quoten, wenn noch keine Entscheidungen vorliegen (keine irrefuehrende 0%)", () => {
    render(
      <AnalyticsDashboardContent
        view={buildView({
          consultationVolume: {
            totalSessions: 0,
            completed: 0,
            abandoned: 0,
            inProgress: 0,
            completionRate: null,
            abandonmentRate: null,
          },
        })}
        displayName="Max Mustermann"
        period="week"
      />,
    );
    expect(screen.getAllByText("--").length).toBeGreaterThan(0);
  });

  it("zeigt einen Empty-State statt einer irrefuehrenden Tabelle, wenn keine Abschluesse vorliegen", () => {
    render(
      <AnalyticsDashboardContent
        view={buildView({ deals: [] })}
        displayName="Max Mustermann"
        period="week"
      />,
    );
    expect(screen.getByText("Keine Abschluesse im Zeitraum.")).toBeInTheDocument();
  });

  it("zeigt den Filialfilter nur bei Mehrfilialen-Mandanten (storeOptions.length > 1, siehe dashboard-view.ts)", () => {
    const { rerender } = render(
      <AnalyticsDashboardContent
        view={buildView({ storeOptions: [] })}
        displayName="X"
        period="week"
      />,
    );
    expect(screen.queryByLabelText("Filiale")).not.toBeInTheDocument();

    rerender(
      <AnalyticsDashboardContent
        view={buildView({
          storeOptions: [
            { id: "store-1", name: "Filiale Nord" },
            { id: "store-2", name: "Filiale Sued" },
          ],
        })}
        displayName="X"
        period="week"
      />,
    );
    expect(screen.getByLabelText("Filiale")).toBeInTheDocument();
    expect(screen.getByText("Filiale Nord")).toBeInTheDocument();
  });

  it("rendert an keiner Stelle Provisions-/Margendaten (View-Model enthaelt diese Felder bewusst nicht, siehe dashboard-view.ts)", () => {
    render(
      <AnalyticsDashboardContent view={buildView()} displayName="Max Mustermann" period="week" />,
    );
    expect(screen.queryByText(/Provision/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Marge/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Deckungsbeitrag/i)).not.toBeInTheDocument();
  });
});
