import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright-E2E-Konfiguration (AP12d, siehe ChatGPTs Projektleiter-
 * Entscheidung "Vorgehen akzeptiert - bedingtes GO" vom 2026-08-03).
 *
 * Verbindliche Vorgaben aus dieser Entscheidung, umgesetzt hier:
 * - Desktop- UND mindestens ein Tablet-Profil (Projekte unten).
 * - Trace, Screenshot UND Video bei Fehlern (retain-on-failure/
 *   only-on-failure), keine stillschweigend nur-lokale Ausfuehrung.
 * - Keine `waitForTimeout`-Aufrufe im gesamten Testcode (siehe
 *   tests/e2e/*.spec.ts - Warten ausschliesslich auf sichtbare
 *   Zustaende/Responses via `expect(...).toBeVisible()`,
 *   `page.waitForResponse()` o.ae.).
 * - `globalSetup` fuehrt `npm run seed:e2e` (prisma/seed-e2e.ts) genau
 *   einmal vor der gesamten Testsuite aus - kontrollierte, tenant-isolierte
 *   Testdaten, keine Abhaengigkeit von manuell gepflegten Bestaenden.
 *
 * WICHTIG (siehe docs/... AP12d-Zwischenstand): diese Konfiguration und
 * alle tests/e2e/*.spec.ts wurden lokal NICHT ausgefuehrt/verifiziert
 * (Sandbox-Einschraenkung: kein persistenter Mehrprozess-Stack ueber
 * mehrere Tool-Aufrufe hinweg moeglich - derselbe Grund, aus dem
 * `npm run test:integration` hier ebenfalls nie lokal laeuft). Die
 * Erstausfuehrung erfolgt in AP12e ueber GitHub Actions (Postgres-Service +
 * Next-Server + Playwright-Browser in einem durchgehenden Job).
 */
export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? [["html", { open: "never" }], ["list"]] : "list",
  timeout: 60_000,
  expect: {
    timeout: 10_000,
  },
  globalSetup: "./tests/e2e/global-setup.ts",

  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://127.0.0.1:3000",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },

  projects: [
    {
      name: "desktop-chromium",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      // Tablet-Profil (Querformat) - deckt den in AP11 umgesetzten
      // Tablet-Breakpoint (RationaleDrawer-Bottom-Sheet, Touch-Ziele) ab.
      name: "tablet-ipad-landscape",
      use: { ...devices["iPad (gen 7) landscape"] },
    },
  ],

  webServer: {
    command: process.env.CI ? "npm run build && npm run start" : "npm run dev",
    url: process.env.E2E_BASE_URL ?? "http://127.0.0.1:3000",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
