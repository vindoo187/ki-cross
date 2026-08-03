/**
 * Komponententests fuer `CrossSellingBanner.tsx` (AP12, ChatGPT-Vorgabe
 * Punkt 2). `useRouter` gemockt, da die verschachtelte `OpportunityCard`
 * ebenfalls `useRouter` aufruft.
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { CrossSellingBanner } from "@/components/consultation/CrossSellingBanner";
import { buildCrossSellingSignal } from "./fixtures";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

describe("CrossSellingBanner", () => {
  it("rendert nichts, wenn keine Signale vorliegen", () => {
    const { container } = render(<CrossSellingBanner signals={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("rendert eine OpportunityCard pro Signal", () => {
    render(
      <CrossSellingBanner
        signals={[
          buildCrossSellingSignal({ id: "signal-1", needLabel: "Streaming-Bedarf erkannt" }),
          buildCrossSellingSignal({ id: "signal-2", needLabel: "Mobilfunk-Bedarf erkannt" }),
        ]}
      />,
    );
    expect(screen.getByText("Streaming-Bedarf erkannt")).toBeInTheDocument();
    expect(screen.getByText("Mobilfunk-Bedarf erkannt")).toBeInTheDocument();
  });
});
