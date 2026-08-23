/**
 * Komponententests fuer `RationaleDrawer.tsx` (AP12, ChatGPT-Vorgabe Punkt 2:
 * "bekannte und unbekannte Begruendungsfaktoren" sowie Basis-Tastaturbedienung
 * -- Accordion-Toggle per `aria-expanded`, Escape schliesst das (auf
 * Desktop unsichtbare) Bottom-Sheet-Backdrop).
 */
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RationaleDrawer } from "@/components/consultation/RationaleDrawer";

describe("RationaleDrawer", () => {
  it("ist initial zugeklappt (aria-expanded=false, kein Panel im DOM)", () => {
    render(
      <RationaleDrawer
        positiveEligibilityReasons={["Haushaltsgroesse passt"]}
        unmetSoftEligibilityCriteria={[]}
      />,
    );
    expect(screen.getByRole("button")).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("Haushaltsgroesse passt")).not.toBeInTheDocument();
  });

  it("zeigt bekannte (positive) Begruendungsfaktoren nach dem Aufklappen", async () => {
    const user = userEvent.setup();
    render(
      <RationaleDrawer
        positiveEligibilityReasons={["Haushaltsgroesse passt zum Tarif"]}
        unmetSoftEligibilityCriteria={[]}
      />,
    );
    await user.click(screen.getByRole("button"));
    expect(screen.getByText("Haushaltsgroesse passt zum Tarif")).toBeInTheDocument();
    expect(screen.getByRole("button")).toHaveAttribute("aria-expanded", "true");
  });

  it("zeigt einen Leerstand-Hinweis, wenn keine positiven Gruende vorliegen", async () => {
    const user = userEvent.setup();
    render(<RationaleDrawer positiveEligibilityReasons={[]} unmetSoftEligibilityCriteria={[]} />);
    await user.click(screen.getByRole("button"));
    expect(screen.getByText("Keine speziellen Eignungsgruende hinterlegt.")).toBeInTheDocument();
  });

  it("zeigt unbekannte/offene Begruendungsfaktoren nur, wenn welche vorliegen", async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <RationaleDrawer
        positiveEligibilityReasons={["Grund A"]}
        unmetSoftEligibilityCriteria={[]}
      />,
    );
    await user.click(screen.getByRole("button"));
    expect(screen.queryByText("Nicht ausschlaggebende, offene Punkte")).not.toBeInTheDocument();

    rerender(
      <RationaleDrawer
        positiveEligibilityReasons={["Grund A"]}
        unmetSoftEligibilityCriteria={["Vertragslaufzeit unklar"]}
      />,
    );
    expect(screen.getByText("Nicht ausschlaggebende, offene Punkte")).toBeInTheDocument();
    expect(screen.getByText("Vertragslaufzeit unklar")).toBeInTheDocument();
  });

  it("schliesst per Escape-Taste, wenn geoeffnet", async () => {
    const user = userEvent.setup();
    render(
      <RationaleDrawer
        positiveEligibilityReasons={["Grund A"]}
        unmetSoftEligibilityCriteria={[]}
      />,
    );
    await user.click(screen.getByRole("button"));
    expect(screen.getByRole("button")).toHaveAttribute("aria-expanded", "true");
    await user.keyboard("{Escape}");
    expect(screen.getByRole("button")).toHaveAttribute("aria-expanded", "false");
  });
});
