/**
 * Komponententests fuer `ProgressBar.tsx` (AP12, ChatGPT-Vorgabe Punkt 2:
 * "Fortschrittsanzeige"). Die Komponente ist rein darstellend -- getestet
 * wird nur, dass die vom Server bereits berechneten Werte korrekt
 * uebernommen werden (kein eigenes Berechnungsverhalten).
 */
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { ProgressBar } from "@/components/consultation/ProgressBar";
import { buildProgress } from "./fixtures";

describe("ProgressBar", () => {
  it("zeigt percentComplete als aria-valuenow der progressbar", () => {
    render(<ProgressBar progress={buildProgress({ percentComplete: 42 })} />);
    const bar = screen.getByRole("progressbar");
    expect(bar).toHaveAttribute("aria-valuenow", "42");
    expect(bar).toHaveAttribute("aria-valuemin", "0");
    expect(bar).toHaveAttribute("aria-valuemax", "100");
  });

  it("zeigt beantwortete/gesamt und Pflichtfragen-Zaehler als Text", () => {
    render(
      <ProgressBar
        progress={buildProgress({
          answeredVisibleQuestions: 2,
          totalVisibleQuestions: 5,
          requiredVisibleQuestions: 3,
          answeredRequiredVisibleQuestions: 1,
        })}
      />,
    );
    expect(screen.getByText(/2 von 5 Fragen beantwortet/)).toBeInTheDocument();
    expect(screen.getByText(/1 von 3 Pflichtfragen/)).toBeInTheDocument();
  });

  it("blendet den Pflichtfragen-Zaehler aus, wenn es keine Pflichtfragen gibt", () => {
    render(
      <ProgressBar
        progress={buildProgress({
          requiredVisibleQuestions: 0,
          answeredRequiredVisibleQuestions: 0,
        })}
      />,
    );
    expect(screen.queryByText(/Pflichtfragen/)).not.toBeInTheDocument();
  });
});
