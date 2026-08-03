/**
 * Komponententests fuer `OutcomeDialog.tsx` (AP12, ChatGPT-Vorgabe Punkt 2:
 * "Ablehnungs-/Aenderungs-/Abbruch-Dialoge"). `useRouter` aus `next/navigation`
 * wird gemockt, da diese Client-Komponente ausserhalb eines echten Next.js
 * App-Router-Baums gerendert wird. `fetch` wird global gemockt, um Server-
 * Antworten (200/409/4xx/Netzwerkfehler) deterministisch zu simulieren --
 * es wird bewusst KEINE echte Server-Logik nachgebildet (siehe Modulkommentar
 * in `OutcomeDialog.tsx`: Validierung/Transition-Regeln bleiben serverseitig).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { OutcomeDialog } from "@/components/consultation/OutcomeDialog";
import { buildRejectionReason } from "./fixtures";

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

describe("OutcomeDialog", () => {
  it("zeigt bereits getroffene Entscheidung ohne Buttons, wenn outcome gesetzt ist", () => {
    render(
      <OutcomeDialog
        recommendationItemId="item-1"
        outcome={{ outcome: "ACCEPTED", decidedAt: "2026-08-01T10:00:00.000Z" }}
        rejectionReasons={[]}
      />,
    );
    expect(screen.getByText(/Angenommen am/)).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("sendet ACCEPTED sofort und ruft danach router.refresh() auf", async () => {
    const user = userEvent.setup();
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true } as Response);
    render(<OutcomeDialog recommendationItemId="item-1" outcome={null} rejectionReasons={[]} />);
    await user.click(screen.getByRole("button", { name: "Annehmen" }));
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    expect(fetch).toHaveBeenCalledWith(
      "/api/consultation/recommendation-items/item-1/outcome",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("verlangt bei Ablehnung die Auswahl eines Grundes, bevor bestaetigt werden kann", async () => {
    const user = userEvent.setup();
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true } as Response);
    const reason = buildRejectionReason();
    render(
      <OutcomeDialog recommendationItemId="item-1" outcome={null} rejectionReasons={[reason]} />,
    );
    await user.click(screen.getByRole("button", { name: "Ablehnen" }));
    const confirmButton = screen.getByRole("button", { name: "Ablehnung bestaetigen" });
    expect(confirmButton).toBeDisabled();

    await user.click(screen.getByLabelText(reason.label));
    expect(confirmButton).not.toBeDisabled();
    await user.click(confirmButton);
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
  });

  it("bricht den Ablehnungs-Flow ab, ohne einen Request zu senden", async () => {
    const user = userEvent.setup();
    render(
      <OutcomeDialog
        recommendationItemId="item-1"
        outcome={null}
        rejectionReasons={[buildRejectionReason()]}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Ablehnen" }));
    await user.click(screen.getByRole("button", { name: "Abbrechen" }));
    expect(screen.getByRole("button", { name: "Annehmen" })).toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("laedt bei 409 (bereits entschieden) still per router.refresh() neu, ohne Fehlertext", async () => {
    const user = userEvent.setup();
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: false, status: 409 } as Response);
    render(<OutcomeDialog recommendationItemId="item-1" outcome={null} rejectionReasons={[]} />);
    await user.click(screen.getByRole("button", { name: "Zurueckstellen" }));
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    expect(screen.queryByText(/Fehler/)).not.toBeInTheDocument();
  });

  it("zeigt eine Fehlermeldung bei Netzwerkfehler", async () => {
    const user = userEvent.setup();
    (fetch as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("network down"));
    render(<OutcomeDialog recommendationItemId="item-1" outcome={null} rejectionReasons={[]} />);
    await user.click(screen.getByRole("button", { name: "Zurueckstellen" }));
    expect(await screen.findByText("Verbindung zum Server fehlgeschlagen.")).toBeInTheDocument();
  });
});
