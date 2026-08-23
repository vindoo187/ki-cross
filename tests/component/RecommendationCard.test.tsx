/**
 * Komponententests fuer `RecommendationCard.tsx`/`RecommendationList.tsx`
 * (AP12, ChatGPT-Vorgabe Punkt 2: "Empfehlungsdarstellung"). Bestaetigt
 * insbesondere, dass `businessPriorityScore`/Provisions-/Margendaten NICHT
 * gerendert werden (Plan Abschnitt 7 -- diese Felder existieren im
 * `ConsultationRecommendationItemView` bewusst nicht, siehe `view-models.ts`).
 * `useRouter` gemockt, da `OutcomeDialog` (verschachtelt) `useRouter` nutzt.
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { RecommendationCard } from "@/components/consultation/RecommendationCard";
import { RecommendationList } from "@/components/consultation/RecommendationList";
import { buildProduct, buildRecommendationItem, buildRejectionReason } from "./fixtures";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

describe("RecommendationCard", () => {
  it("zeigt Produktname, Passgenauigkeit und formatierten Monatspreis (de-DE)", () => {
    render(
      <RecommendationCard
        item={buildRecommendationItem({
          product: buildProduct({ productName: "Fiber 250", monthlyPriceMinor: 3990 }),
          customerFitLabel: "Hohe Passgenauigkeit",
        })}
        rejectionReasons={[]}
      />,
    );
    expect(screen.getByText("Fiber 250")).toBeInTheDocument();
    expect(screen.getByText("Hohe Passgenauigkeit")).toBeInTheDocument();
    expect(screen.getByText(/39,90/)).toBeInTheDocument();
  });

  it("zeigt Produktattribute als Liste", () => {
    render(
      <RecommendationCard
        item={buildRecommendationItem({
          product: buildProduct({ attributes: [{ key: "Bandbreite", value: "250 MBit/s" }] }),
        })}
        rejectionReasons={[]}
      />,
    );
    expect(screen.getByText("Bandbreite: 250 MBit/s")).toBeInTheDocument();
  });

  it("zeigt bewusst KEINE Business-/Provisions-/Margendaten an", () => {
    render(<RecommendationCard item={buildRecommendationItem()} rejectionReasons={[]} />);
    expect(screen.queryByText(/businessPriorityScore/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Provision/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Marge/i)).not.toBeInTheDocument();
  });

  it("bettet RationaleDrawer und OutcomeDialog ein", () => {
    render(
      <RecommendationCard
        item={buildRecommendationItem()}
        rejectionReasons={[buildRejectionReason()]}
      />,
    );
    expect(screen.getByRole("button", { name: "Begruendung ansehen" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Annehmen" })).toBeInTheDocument();
  });
});

describe("RecommendationList", () => {
  it("zeigt einen Leerstand-Hinweis, wenn keine passenden Tarife vorliegen", () => {
    render(<RecommendationList items={[]} rejectionReasons={[]} />);
    expect(
      screen.getByText("Fuer die aktuellen Angaben ist kein passender Tarif verfuegbar."),
    ).toBeInTheDocument();
  });

  it("rendert eine Karte pro Empfehlungs-Item", () => {
    render(
      <RecommendationList
        items={[
          buildRecommendationItem({
            id: "item-1",
            product: buildProduct({ productName: "Fiber 100" }),
          }),
          buildRecommendationItem({
            id: "item-2",
            product: buildProduct({ productName: "Fiber 250" }),
          }),
        ]}
        rejectionReasons={[]}
      />,
    );
    expect(screen.getByText("Fiber 100")).toBeInTheDocument();
    expect(screen.getByText("Fiber 250")).toBeInTheDocument();
  });
});
