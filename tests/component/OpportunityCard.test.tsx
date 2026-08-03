/**
 * Komponententests fuer `OpportunityCard.tsx` (AP12, ChatGPT-Vorgabe Punkt 2:
 * "zustandsabhaengige Buttonverfuegbarkeit"). Deckt die Button-Darstellung
 * je `SalesOpportunityStatus` ab (OPEN/OFFERED/DEFERRED/ACCEPTED/DECLINED) --
 * die eigentliche Uebergangs-Validierung bleibt serverseitig
 * (`ALLOWED_TRANSITIONS`, siehe Modulkommentar).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { OpportunityCard } from "@/components/consultation/OpportunityCard";
import { buildCrossSellingSignal, buildOpportunityStatus } from "./fixtures";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh }),
}));

beforeEach(() => {
  refresh.mockReset();
  vi.stubGlobal("fetch", vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("OpportunityCard", () => {
  it("zeigt bei OPEN nur den 'Anbieten'-Button", () => {
    render(
      <OpportunityCard
        signal={buildCrossSellingSignal({
          opportunity: buildOpportunityStatus({ status: "OPEN" }),
        })}
      />,
    );
    expect(screen.getByRole("button", { name: "Anbieten" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Angenommen" })).not.toBeInTheDocument();
  });

  it("zeigt bei OFFERED alle drei Folgeaktionen", () => {
    render(
      <OpportunityCard
        signal={buildCrossSellingSignal({
          opportunity: buildOpportunityStatus({ status: "OFFERED" }),
        })}
      />,
    );
    expect(screen.getByRole("button", { name: "Angenommen" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Abgelehnt" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Zurueckstellen" })).toBeInTheDocument();
  });

  it("zeigt bei DEFERRED 'Erneut anbieten'", () => {
    render(
      <OpportunityCard
        signal={buildCrossSellingSignal({
          opportunity: buildOpportunityStatus({ status: "DEFERRED" }),
        })}
      />,
    );
    expect(screen.getByRole("button", { name: "Erneut anbieten" })).toBeInTheDocument();
  });

  it("zeigt bei ACCEPTED/DECLINED nur noch den terminalen Text, keine Buttons mehr", () => {
    render(
      <OpportunityCard
        signal={buildCrossSellingSignal({
          opportunity: buildOpportunityStatus({
            status: "ACCEPTED",
            resolvedAt: "2026-08-01T12:00:00.000Z",
          }),
        })}
      />,
    );
    expect(screen.getByText(/Angenommen am/)).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("sendet PATCH mit dem Zielstatus und ruft router.refresh() auf", async () => {
    const user = userEvent.setup();
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true } as Response);
    render(
      <OpportunityCard
        signal={buildCrossSellingSignal({
          opportunity: buildOpportunityStatus({ id: "opportunity-9", status: "OPEN" }),
        })}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Anbieten" }));
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    expect(fetch).toHaveBeenCalledWith(
      "/api/consultation/sales-opportunities/opportunity-9",
      expect.objectContaining({ method: "PATCH" }),
    );
  });
});
