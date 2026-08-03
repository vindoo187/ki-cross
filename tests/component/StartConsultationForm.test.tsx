/**
 * Komponententests fuer `StartConsultationForm.tsx` (AP12, ChatGPT-Vorgabe
 * Punkt 2: Ladezustaende/Fehlerzustaende, Leerstand). `storeId`/`employeeId`
 * werden bewusst NICHT abgefragt (serverseitig ermittelt, siehe
 * Modulkommentar) und sind daher hier nicht Gegenstand der Tests.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StartConsultationForm } from "@/components/consultation/StartConsultationForm";
import type { ActiveQuestionnaireSummary } from "@/server/consultation-ui/view-models";

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, refresh: vi.fn() }),
}));

function buildQuestionnaireSummary(
  overrides: Partial<ActiveQuestionnaireSummary> = {},
): ActiveQuestionnaireSummary {
  return {
    questionnaireKey: "residential-default",
    label: "Privatkunden-Standard",
    ...overrides,
  };
}

beforeEach(() => {
  push.mockReset();
  vi.stubGlobal("fetch", vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("StartConsultationForm", () => {
  it("zeigt den Leerstand-Hinweis, wenn kein Fragebogen verfuegbar ist", () => {
    render(<StartConsultationForm questionnaires={[]} />);
    expect(
      screen.getByText("Kein aktiver Fragebogen verfuegbar. Bitte Fragebogen-Verwaltung pruefen."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("zeigt KEIN Fragebogen-Auswahlfeld, wenn nur ein Fragebogen vorliegt", () => {
    render(<StartConsultationForm questionnaires={[buildQuestionnaireSummary()]} />);
    expect(screen.queryByText("Fragebogen")).not.toBeInTheDocument();
    expect(screen.getByText("Art der Beratung")).toBeInTheDocument();
  });

  it("zeigt ein Fragebogen-Auswahlfeld, wenn mehrere Fragebogen vorliegen", () => {
    render(
      <StartConsultationForm
        questionnaires={[
          buildQuestionnaireSummary({ questionnaireKey: "a", label: "Fragebogen A" }),
          buildQuestionnaireSummary({ questionnaireKey: "b", label: "Fragebogen B" }),
        ]}
      />,
    );
    expect(screen.getByText("Fragebogen A")).toBeInTheDocument();
    expect(screen.getByText("Fragebogen B")).toBeInTheDocument();
  });

  it("navigiert bei Erfolg zur neuen Sitzung", async () => {
    const user = userEvent.setup();
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ consultationSessionId: "session-42" }),
    } as Response);
    render(<StartConsultationForm questionnaires={[buildQuestionnaireSummary()]} />);
    await user.click(screen.getByRole("button", { name: "Neue Beratung starten" }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/consultation/session-42"));
    expect(fetch).toHaveBeenCalledWith(
      "/api/consultation/sessions",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          questionnaireKey: "residential-default",
          consultationType: "NEW_CONTRACT",
        }),
      }),
    );
  });

  it("zeigt 'Startet…' waehrend der Anfrage und deaktiviert den Button", async () => {
    const user = userEvent.setup();
    let resolveFetch: (value: Response) => void = () => {};
    (fetch as ReturnType<typeof vi.fn>).mockReturnValue(
      new Promise<Response>((resolve) => {
        resolveFetch = resolve;
      }),
    );
    render(<StartConsultationForm questionnaires={[buildQuestionnaireSummary()]} />);
    await user.click(screen.getByRole("button", { name: "Neue Beratung starten" }));
    expect(await screen.findByRole("button", { name: "Startet…" })).toBeDisabled();
    resolveFetch({
      ok: true,
      json: async () => ({ consultationSessionId: "session-1" }),
    } as Response);
    await waitFor(() => expect(push).toHaveBeenCalled());
  });

  it("zeigt die fachliche Fehlermeldung vom Server und navigiert nicht", async () => {
    const user = userEvent.setup();
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      json: async () => ({ message: "Kein aktiver Fragebogen fuer diesen Tenant." }),
    } as Response);
    render(<StartConsultationForm questionnaires={[buildQuestionnaireSummary()]} />);
    await user.click(screen.getByRole("button", { name: "Neue Beratung starten" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Kein aktiver Fragebogen fuer diesen Tenant.",
    );
    expect(push).not.toHaveBeenCalled();
  });

  it("zeigt einen Verbindungsfehler bei einem Netzwerkfehler", async () => {
    const user = userEvent.setup();
    (fetch as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("network down"));
    render(<StartConsultationForm questionnaires={[buildQuestionnaireSummary()]} />);
    await user.click(screen.getByRole("button", { name: "Neue Beratung starten" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Verbindung zum Server fehlgeschlagen.",
    );
    expect(push).not.toHaveBeenCalled();
  });
});
