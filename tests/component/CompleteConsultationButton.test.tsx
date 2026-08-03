/**
 * Komponententests fuer `CompleteConsultationButton.tsx` (AP12, ChatGPT-
 * Vorgabe Punkt 2: "gegenseitiger Ausschluss von
 * CONSULTATION_COMPLETED/CONSULTATION_ABANDONED"). Ergaenzt
 * `AbandonConsultationButton.test.tsx` um die Gegenseite: Ladezustand,
 * erfolgreiche Navigation nach `/consultation`, fachliche Fehlermeldung vom
 * Server sowie generischer Netzwerkfehler-Fallback. Die Idempotenz von
 * `completeConsultation()` selbst ist serverseitig in `completion.ts`
 * abgedeckt (siehe Modulkommentar) und wird hier nicht erneut getestet.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CompleteConsultationButton } from "@/components/consultation/CompleteConsultationButton";

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, refresh: vi.fn() }),
}));

beforeEach(() => {
  push.mockReset();
  vi.stubGlobal("fetch", vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("CompleteConsultationButton", () => {
  it("zeigt 'Wird abgeschlossen…' waehrend der Anfrage und deaktiviert den Button", async () => {
    const user = userEvent.setup();
    let resolveFetch: (value: Response) => void = () => {};
    (fetch as ReturnType<typeof vi.fn>).mockReturnValue(
      new Promise<Response>((resolve) => {
        resolveFetch = resolve;
      }),
    );
    render(<CompleteConsultationButton consultationSessionId="session-1" />);
    const button = screen.getByRole("button", { name: "Beratung abschliessen" });
    await user.click(button);
    expect(await screen.findByRole("button", { name: "Wird abgeschlossen…" })).toBeDisabled();
    resolveFetch({ ok: true } as Response);
    await waitFor(() => expect(push).toHaveBeenCalledWith("/consultation"));
  });

  it("navigiert bei Erfolg zurueck zur Uebersicht", async () => {
    const user = userEvent.setup();
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true } as Response);
    render(<CompleteConsultationButton consultationSessionId="session-1" />);
    await user.click(screen.getByRole("button", { name: "Beratung abschliessen" }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/consultation"));
    expect(fetch).toHaveBeenCalledWith(
      "/api/consultation/sessions/session-1/summary/complete",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("zeigt die fachliche Fehlermeldung vom Server und navigiert nicht", async () => {
    const user = userEvent.setup();
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      json: async () => ({ message: "Sitzung nicht gefunden." }),
    } as Response);
    render(<CompleteConsultationButton consultationSessionId="session-1" />);
    await user.click(screen.getByRole("button", { name: "Beratung abschliessen" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Sitzung nicht gefunden.");
    expect(push).not.toHaveBeenCalled();
  });

  it("zeigt eine generische Fehlermeldung, wenn der Server keine Nachricht liefert", async () => {
    const user = userEvent.setup();
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      json: async () => null,
    } as Response);
    render(<CompleteConsultationButton consultationSessionId="session-1" />);
    await user.click(screen.getByRole("button", { name: "Beratung abschliessen" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Beratung konnte nicht abgeschlossen werden.",
    );
    expect(push).not.toHaveBeenCalled();
  });

  it("zeigt einen Verbindungsfehler bei einem Netzwerkfehler", async () => {
    const user = userEvent.setup();
    (fetch as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("network down"));
    render(<CompleteConsultationButton consultationSessionId="session-1" />);
    await user.click(screen.getByRole("button", { name: "Beratung abschliessen" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Verbindung zum Server fehlgeschlagen.",
    );
    expect(push).not.toHaveBeenCalled();
  });
});
