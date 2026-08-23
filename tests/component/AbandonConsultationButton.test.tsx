/**
 * Komponententests fuer `AbandonConsultationButton.tsx` (AP12, ChatGPT-
 * Vorgabe Punkt 2: "Abbruch-Dialog" sowie "gegenseitiger Ausschluss von
 * CONSULTATION_COMPLETED/CONSULTATION_ABANDONED"). Das eigentliche
 * Sichtbarkeits-Gate (`summary.status === "IN_PROGRESS"`) liegt serverseitig
 * in den aufrufenden Page-Komponenten (siehe Modulkommentar in
 * `AbandonConsultationButton.tsx`) und ist dort/in den Unit-/Integrationstests
 * von `abandonment.ts` abgedeckt -- auf Komponentenebene wird hier geprueft,
 * dass ein 409 (`ConsultationAlreadyCompletedError`, d. h. die Sitzung wurde
 * bereits per `CompleteConsultationButton` abgeschlossen) korrekt als
 * fachliche Meldung dargestellt wird, statt den Abbruch stillschweigend
 * zuzulassen.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AbandonConsultationButton } from "@/components/consultation/AbandonConsultationButton";

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

describe("AbandonConsultationButton", () => {
  it("zeigt zweistufig: erst Bestaetigungspanel, kein Request vor dem zweiten Klick", async () => {
    const user = userEvent.setup();
    render(<AbandonConsultationButton consultationSessionId="session-1" />);
    await user.click(screen.getByRole("button", { name: "Beratung abbrechen" }));
    expect(screen.getByText(/Beratung wirklich abbrechen/)).toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("Abbruchgrund ist optional -- 'Abbruch bestaetigen' ist auch ohne Auswahl aktiv", async () => {
    const user = userEvent.setup();
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true } as Response);
    render(<AbandonConsultationButton consultationSessionId="session-1" />);
    await user.click(screen.getByRole("button", { name: "Beratung abbrechen" }));
    const confirmButton = screen.getByRole("button", { name: "Abbruch bestaetigen" });
    expect(confirmButton).not.toBeDisabled();
    await user.click(confirmButton);
    await waitFor(() => expect(push).toHaveBeenCalledWith("/consultation"));
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining("/summary/abandon"),
      expect.objectContaining({ body: JSON.stringify({}) }),
    );
  });

  it("sendet den gewaehlten Abbruchgrund mit, wenn ausgewaehlt", async () => {
    const user = userEvent.setup();
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true } as Response);
    render(<AbandonConsultationButton consultationSessionId="session-1" />);
    await user.click(screen.getByRole("button", { name: "Beratung abbrechen" }));
    await user.click(screen.getByLabelText("Kunde hat keine Zeit"));
    await user.click(screen.getByRole("button", { name: "Abbruch bestaetigen" }));
    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining("/summary/abandon"),
        expect.objectContaining({
          body: JSON.stringify({ reasonCode: "CUSTOMER_HAS_NO_TIME" }),
        }),
      ),
    );
  });

  it("'Zurueck' kehrt ohne Request zum idle-Zustand zurueck", async () => {
    const user = userEvent.setup();
    render(<AbandonConsultationButton consultationSessionId="session-1" />);
    await user.click(screen.getByRole("button", { name: "Beratung abbrechen" }));
    await user.click(screen.getByRole("button", { name: "Zurueck" }));
    expect(screen.getByRole("button", { name: "Beratung abbrechen" })).toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("zeigt bei 409 die fachliche Meldung zum bereits abgeschlossenen Zustand (Ausschluss ABANDONED nach COMPLETED)", async () => {
    const user = userEvent.setup();
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: false, status: 409 } as Response);
    render(<AbandonConsultationButton consultationSessionId="session-1" />);
    await user.click(screen.getByRole("button", { name: "Beratung abbrechen" }));
    await user.click(screen.getByRole("button", { name: "Abbruch bestaetigen" }));
    expect(
      await screen.findByText(
        "Diese Beratung wurde bereits abgeschlossen und kann daher nicht mehr abgebrochen werden.",
      ),
    ).toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
  });
});
