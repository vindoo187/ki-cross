import { test, expect } from "@playwright/test";
import { readE2eSeedOutput } from "./seed-output";
import { loginAs, startNewConsultation } from "./helpers";

/**
 * E2E-Suite fuer die Phase-15-AP1-Sidebar (`ConsultationWorkspace`
 * layout.tsx + `ConsultationSidebar`/`ConsultationNav`, siehe
 * PHASE_15_DISCOVERY.md Abschnitt 9 fuer die urspruenglich geplanten
 * Testfaelle). Deckt NICHT erneut den vollstaendigen Beratungsablauf ab
 * (bereits `happy-path.spec.ts`/`abandonment.spec.ts`) -- nur das neue
 * Sidebar-/Navigations-Verhalten.
 *
 * Korrektur ggue. dem alten Task-Text (2026-08-03, "Chromium+WebKit"):
 * laeuft ausschliesslich in den seit AP12 etablierten Projekten Desktop
 * Chromium + Tablet (iPad Landscape), siehe playwright.config.ts.
 */

test("Sidebar: Navigation zwischen den drei Unterseiten funktioniert", async ({ page }) => {
  const seed = readE2eSeedOutput();

  await loginAs(page, seed.tenantA.employeeDisplayName);
  const sessionId = await startNewConsultation(page);

  const nav = page.getByRole("navigation", { name: "Beratungsnavigation" });
  await expect(nav).toBeVisible();

  await Promise.all([
    page.waitForURL(new RegExp(`/consultation/${sessionId}/recommendation$`)),
    nav.getByRole("link", { name: "Empfehlung" }).click(),
  ]);
  await expect(page.getByRole("heading", { name: "Empfehlung" })).toBeVisible();

  await Promise.all([
    page.waitForURL(new RegExp(`/consultation/${sessionId}/summary$`)),
    nav.getByRole("link", { name: "Zusammenfassung" }).click(),
  ]);
  await expect(page.getByRole("heading", { name: "Zusammenfassung" })).toBeVisible();

  await Promise.all([
    page.waitForURL(new RegExp(`/consultation/${sessionId}$`)),
    nav.getByRole("link", { name: "Fragen" }).click(),
  ]);
  await expect(page.getByRole("navigation", { name: "Fragen-Navigation" })).toBeVisible();
});

test("Sidebar: zeigt den Sitzungsstatus 'Laufend' fuer eine IN_PROGRESS-Sitzung", async ({
  page,
}) => {
  const seed = readE2eSeedOutput();

  await loginAs(page, seed.tenantA.employeeDisplayName);
  await startNewConsultation(page);

  const sidebar = page.getByRole("complementary", { name: "Beratungsuebersicht" });
  await expect(sidebar).toBeVisible();
  await expect(sidebar.getByText("Laufend")).toBeVisible();
});

test("Sidebar: zeigt das eigene aktive Ziel (Tenant A, siehe seed-e2e.ts Goal-Fixture)", async ({
  page,
}) => {
  const seed = readE2eSeedOutput();

  await loginAs(page, seed.tenantA.employeeDisplayName);
  await startNewConsultation(page);

  const sidebar = page.getByRole("complementary", { name: "Beratungsuebersicht" });
  await expect(sidebar.getByText("Abgeschlossene Deals")).toBeVisible();
  // Keine Provisions-/Margendaten in der Sidebar (bestehende, seit Phase 6
  // gueltige Regel -- Negativtest, siehe view-models.ts-Modulkommentar).
  await expect(sidebar.getByText(/Provision/i)).toHaveCount(0);
  await expect(sidebar.getByText(/Marge/i)).toHaveCount(0);
});

test("Sidebar: zeigt einen dezenten Leerstand, wenn kein eigenes aktives Ziel existiert (Tenant B, kein Goal-Fixture)", async ({
  page,
}) => {
  const seed = readE2eSeedOutput();

  await loginAs(page, seed.tenantB.employeeDisplayName);
  await startNewConsultation(page);

  const sidebar = page.getByRole("complementary", { name: "Beratungsuebersicht" });
  await expect(sidebar).toBeVisible();
  await expect(sidebar.getByText("Kein aktives Ziel in diesem Zeitraum.")).toBeVisible();
});
