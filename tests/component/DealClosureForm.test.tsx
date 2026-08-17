/**
 * Komponententests fuer `DealClosureForm.tsx` (Phase 6 AP12, ChatGPT-Vorgabe
 * "DealClosureForm: korrekte Darstellung, erfolgreiche Deal-Erfassung, Fehler
 * bei ungueltiger Eingabe, Submit wird nicht doppelt ausgeloest, Erfolg/
 * Aktualisierung funktioniert"). `useRouter` gemockt, `fetch` gemockt --
 * analog `OutcomeDialog.test.tsx` (siehe dortiger Modulkommentar).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DealClosureForm } from "@/components/consultation/DealClosureForm";
import { buildDealClosureCandidate } from "./fixtures";

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

describe("DealClosureForm", () => {
  it("zeigt nichts, wenn keine Kandidaten vorliegen", () => {
    const { container } = render(
      <DealClosureForm consultationSessionId="session-1" candidates={[]} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("zeigt die Kandidaten mit Produktname und Preis, standardmaessig ausgewaehlt", () => {
    render(
      <DealClosureForm
        consultationSessionId="session-1"
        candidates={[buildDealClosureCandidate({ productName: "Fiber 250" })]}
      />,
    );
    expect(screen.getByText("Fiber 250")).toBeInTheDocument();
    expect(screen.getByRole("checkbox")).toBeChecked();
    expect(screen.getByRole("button", { name: "Abschluss erfassen" })).not.toBeDisabled();
  });

  it("Submit-Button ist deaktiviert, wenn keine Position ausgewaehlt ist", async () => {
    const user = userEvent.setup();
    render(
      <DealClosureForm
        consultationSessionId="session-1"
        candidates={[buildDealClosureCandidate()]}
      />,
    );
    await user.click(screen.getByRole("checkbox"));
    expect(screen.getByRole("button", { name: "Abschluss erfassen" })).toBeDisabled();
  });

  it("sendet die ausgewaehlten Positionen an POST .../deals und ruft bei Erfolg router.refresh() auf", async () => {
    const user = userEvent.setup();
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true } as Response);
    render(
      <DealClosureForm
        consultationSessionId="session-1"
        candidates={[buildDealClosureCandidate({ productVersionId: "pv-1" })]}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Abschluss erfassen" }));
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    expect(fetch).toHaveBeenCalledWith(
      "/api/consultation/sessions/session-1/deals",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ items: [{ productVersionId: "pv-1", quantity: 1 }] }),
      }),
    );
  });

  it("deaktiviert den Submit-Button waehrend des Sendens (kein Doppel-Submit)", async () => {
    const user = userEvent.setup();
    let resolveFetch: (value: Response) => void = () => {};
    (fetch as ReturnType<typeof vi.fn>).mockReturnValue(
      new Promise<Response>((resolve) => {
        resolveFetch = resolve;
      }),
    );
    render(
      <DealClosureForm
        consultationSessionId="session-1"
        candidates={[buildDealClosureCandidate()]}
      />,
    );
    const button = screen.getByRole("button", { name: "Abschluss erfassen" });
    await user.click(button);
    expect(screen.getByRole("button", { name: "Wird abgeschlossen…" })).toBeDisabled();
    expect(fetch).toHaveBeenCalledTimes(1);

    resolveFetch({ ok: true } as Response);
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
  });

  it("laedt bei 409 (bereits abgeschlossen, z. B. zweiter Tab) still per router.refresh() neu, ohne Fehlertext", async () => {
    const user = userEvent.setup();
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: false, status: 409 } as Response);
    render(
      <DealClosureForm
        consultationSessionId="session-1"
        candidates={[buildDealClosureCandidate()]}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Abschluss erfassen" }));
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("zeigt eine Fehlermeldung bei ungueltiger Eingabe (4xx mit message)", async () => {
    const user = userEvent.setup();
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 422,
      json: async () => ({ message: "Mindestens eine Position ist erforderlich." }),
    } as Response);
    render(
      <DealClosureForm
        consultationSessionId="session-1"
        candidates={[buildDealClosureCandidate()]}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Abschluss erfassen" }));
    expect(
      await screen.findByText("Mindestens eine Position ist erforderlich."),
    ).toBeInTheDocument();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("zeigt eine Fehlermeldung bei Netzwerkfehler", async () => {
    const user = userEvent.setup();
    (fetch as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("network down"));
    render(
      <DealClosureForm
        consultationSessionId="session-1"
        candidates={[buildDealClosureCandidate()]}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Abschluss erfassen" }));
    expect(await screen.findByText("Verbindung zum Server fehlgeschlagen.")).toBeInTheDocument();
  });

  it("passt die Menge an und sendet sie mit", async () => {
    const user = userEvent.setup();
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true } as Response);
    render(
      <DealClosureForm
        consultationSessionId="session-1"
        candidates={[buildDealClosureCandidate({ productVersionId: "pv-1" })]}
      />,
    );
    const quantityInput = screen.getByLabelText("Menge");
    await user.clear(quantityInput);
    await user.type(quantityInput, "3");
    await user.click(screen.getByRole("button", { name: "Abschluss erfassen" }));
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    expect(fetch).toHaveBeenCalledWith(
      "/api/consultation/sessions/session-1/deals",
      expect.objectContaining({
        body: JSON.stringify({ items: [{ productVersionId: "pv-1", quantity: 3 }] }),
      }),
    );
  });
});
