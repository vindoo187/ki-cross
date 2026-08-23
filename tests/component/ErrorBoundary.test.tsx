/**
 * Komponententests fuer `ErrorBoundary.tsx` (AP12, ChatGPT-Vorgabe Punkt 2:
 * "Fehlerzustaende"). Nutzt eine kleine Test-Komponente, die kontrolliert
 * einen Fehler wirft, um `getDerivedStateFromError`/`componentDidCatch`
 * auszuloesen. `console.error` wird waehrend des Wurf-Tests unterdrueckt, da
 * React selbst bei Error Boundaries zusaetzliche Fehlerausgaben in die
 * Konsole schreibt (erwartetes Verhalten, kein Testfehler).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ErrorBoundary } from "@/components/consultation/ErrorBoundary";

function Bomb(): never {
  throw new Error("Kaboom");
}

let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
const reload = vi.fn();

beforeEach(() => {
  consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  reload.mockReset();
  Object.defineProperty(window, "location", {
    configurable: true,
    value: { ...window.location, reload },
  });
});

afterEach(() => {
  consoleErrorSpy.mockRestore();
});

describe("ErrorBoundary", () => {
  it("rendert die Kinder normal, wenn kein Fehler auftritt", () => {
    render(
      <ErrorBoundary>
        <p>Alles gut</p>
      </ErrorBoundary>,
    );
    expect(screen.getByText("Alles gut")).toBeInTheDocument();
  });

  it("faengt einen Rendering-Fehler ab und zeigt die Reload-UI mit role=alert", () => {
    render(
      <ErrorBoundary>
        <Bomb />
      </ErrorBoundary>,
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Es ist ein unerwarteter Fehler aufgetreten. Bitte laden Sie die Seite neu. Bereits gespeicherte Antworten gehen dabei nicht verloren.",
    );
    expect(screen.getByRole("button", { name: "Seite neu laden" })).toBeInTheDocument();
  });

  it("laedt die Seite bei Klick auf 'Seite neu laden' neu", async () => {
    const user = userEvent.setup();
    render(
      <ErrorBoundary>
        <Bomb />
      </ErrorBoundary>,
    );
    await user.click(screen.getByRole("button", { name: "Seite neu laden" }));
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
