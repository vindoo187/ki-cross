/**
 * Komponententests fuer `EvaluateRecommendationButton.tsx` (AP12,
 * ChatGPT-Vorgabe Punkt 2: Ladezustaende/Fehlerzustaende). `useRouter`
 * gemockt (siehe `OutcomeDialog.test.tsx` fuer die Begruendung), `fetch`
 * global gemockt.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { EvaluateRecommendationButton } from "@/components/consultation/EvaluateRecommendationButton";

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

describe("EvaluateRecommendationButton", () => {
  it("zeigt 'Wertet aus…' waehrend der Anfrage und deaktiviert den Button", async () => {
    const user = userEvent.setup();
    let resolveFetch: (value: Response) => void = () => {};
    (fetch as ReturnType<typeof vi.fn>).mockReturnValue(
      new Promise<Response>((resolve) => {
        resolveFetch = resolve;
      }),
    );
    render(<EvaluateRecommendationButton sessionId="session-1" />);
    const button = screen.getByRole("button", { name: "Empfehlung auswerten" });
    await user.click(button);
    expect(await screen.findByRole("button", { name: "Wertet aus…" })).toBeDisabled();
    resolveFetch({ ok: true } as Response);
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
  });

  it("zeigt eine Fehlermeldung, wenn der Server einen Fehler liefert", async () => {
    const user = userEvent.setup();
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 422,
      json: async () => ({ message: "Fragebogen noch nicht vollstaendig." }),
    } as Response);
    render(<EvaluateRecommendationButton sessionId="session-1" />);
    await user.click(screen.getByRole("button", { name: "Empfehlung auswerten" }));
    expect(await screen.findByText("Fragebogen noch nicht vollstaendig.")).toBeInTheDocument();
    expect(refresh).not.toHaveBeenCalled();
  });
});
