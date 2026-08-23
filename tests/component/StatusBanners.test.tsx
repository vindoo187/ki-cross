/**
 * Komponententests fuer `StatusBanners.tsx` (AP12, ChatGPT-Vorgabe Punkt 2:
 * "Ladezustaende/Speicherzustaende/Fehlerzustaende" sowie
 * "Versionskonflikt"-Anzeige). `SavingIndicator` ist bereits per Smoke-Test
 * abgedeckt (Setup-Verifikation); hier folgen die verbleibenden Faelle sowie
 * `ConflictBanner`/`OfflineBanner`.
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  ConflictBanner,
  OfflineBanner,
  SavingIndicator,
} from "@/components/consultation/StatusBanners";

describe("SavingIndicator", () => {
  it("zeigt 'Gespeichert' im 'saved'-Status", () => {
    render(<SavingIndicator status="saved" />);
    expect(screen.getByText("Gespeichert")).toBeInTheDocument();
  });
});

describe("ConflictBanner", () => {
  it("zeigt eine role='alert' Warnung und ruft onReload bei Klick", async () => {
    const user = userEvent.setup();
    const onReload = vi.fn();
    render(<ConflictBanner onReload={onReload} />);
    expect(screen.getByRole("alert")).toHaveTextContent(/zwischenzeitlich anderswo geaendert/);
    await user.click(screen.getByRole("button", { name: "Aktuellen Stand neu laden" }));
    expect(onReload).toHaveBeenCalledTimes(1);
  });
});

describe("OfflineBanner", () => {
  it("ruft onRetry bei Klick auf und ist im retrying-Zustand deaktiviert", async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    const { rerender } = render(<OfflineBanner onRetry={onRetry} retrying={false} />);
    const button = screen.getByRole("button", { name: "Erneut speichern" });
    expect(button).not.toBeDisabled();
    await user.click(button);
    expect(onRetry).toHaveBeenCalledTimes(1);

    rerender(<OfflineBanner onRetry={onRetry} retrying={true} />);
    expect(screen.getByRole("button", { name: "Versucht erneut…" })).toBeDisabled();
  });
});
