/**
 * Komponententests fuer `SessionSummaryView.tsx` (AP12, ChatGPT-Vorgabe
 * Punkt 2: "Empfehlungsdarstellung" + Leerstands-Faelle). Reiner
 * Anzeige-Wrapper (siehe Modulkommentar) -- geprueft wird nur die
 * Fallunterscheidung beantwortete Fragen/keine Fragen sowie
 * Empfehlung/keine Empfehlung, nicht die verschachtelten
 * `RecommendationList`/`CrossSellingBanner`-Details (siehe deren eigene
 * Tests). `useRouter` gemockt, da `RecommendationList` -> `RecommendationCard`
 * -> `OutcomeDialog` transitiv `useRouter` nutzt.
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { SessionSummaryView } from "@/components/consultation/SessionSummaryView";
import { buildSessionSummary } from "./fixtures";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

describe("SessionSummaryView", () => {
  it("zeigt beantwortete Fragen als Definitionsliste", () => {
    render(
      <SessionSummaryView
        summary={buildSessionSummary({
          answeredQuestions: [
            {
              questionId: "question-1",
              label: "Wie viele Personen nutzen den Anschluss?",
              formattedValue: "Familie",
            },
          ],
        })}
      />,
    );
    expect(screen.getByText("Wie viele Personen nutzen den Anschluss?")).toBeInTheDocument();
    expect(screen.getByText("Familie")).toBeInTheDocument();
  });

  it("zeigt 'Keine Fragen beantwortet.', wenn keine Antworten vorliegen", () => {
    render(<SessionSummaryView summary={buildSessionSummary({ answeredQuestions: [] })} />);
    expect(screen.getByText("Keine Fragen beantwortet.")).toBeInTheDocument();
  });

  it("zeigt die Empfehlung, wenn vorhanden", () => {
    render(
      <SessionSummaryView
        summary={buildSessionSummary({
          recommendation: {
            id: "recommendation-1",
            consultationSessionId: "session-1",
            generatedAt: "2026-08-01T10:00:00.000Z",
            items: [
              {
                id: "recommendation-item-1",
                priorityRank: 1,
                product: {
                  id: "product-version-1",
                  productName: "Fiber 250",
                  currency: "EUR",
                  monthlyPriceMinor: 3990,
                  oneTimePriceMinor: null,
                  contractMonths: 24,
                  attributes: [],
                },
                customerFitCategory: "hoch",
                customerFitLabel: "Hohe Passgenauigkeit",
                positiveEligibilityReasons: [],
                unmetSoftEligibilityCriteria: [],
                outcome: null,
              },
            ],
            rejectionReasons: [],
            crossSellingSignals: [],
          },
        })}
      />,
    );
    expect(screen.getByText("Fiber 250")).toBeInTheDocument();
  });

  it("zeigt 'Fuer diese Sitzung liegt noch keine Empfehlung vor.', wenn keine Empfehlung vorliegt", () => {
    render(<SessionSummaryView summary={buildSessionSummary({ recommendation: null })} />);
    expect(
      screen.getByText("Fuer diese Sitzung liegt noch keine Empfehlung vor."),
    ).toBeInTheDocument();
  });
});
