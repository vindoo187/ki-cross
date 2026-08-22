import { test, expect } from "@playwright/test";
import { readE2eSeedOutput } from "./seed-output";
import { loginAs, loginAsAdmin } from "./helpers";

/**
 * `/admin/goals` E2E-Suite (Phase 11 AP9, ChatGPT-GO 2026-08-23 nach der
 * AP9-Discovery -- vierte identifizierte Luecke: "keine Playwright-Spec fuer
 * /admin/goals, obwohl Commission und Rules je eine eigene admin-*.spec.ts
 * haben"). Bewusst schlank gehalten (ChatGPTs ausdrueckliche Vorgabe: "Keine
 * neuen fachlichen Funktionen ... nur Testabdeckung und Regression"):
 * Listing oeffnen, kein Zugriff ohne `config.goals.view`, neues Goal
 * anlegen, Detailseite oeffnen, neue GoalVersion erfassen, Historie
 * sichtbar.
 *
 * ANDERS als `admin-rules.spec.ts`/`admin-commissions.spec.ts`: Goal hat
 * KEIN Draft/Publish-Konzept (siehe `goal-admin.ts`-Modulkommentar) -- daher
 * kein Validate-/Publish-/Rollback-Schritt, kein
 * `config.goals.publish`-Recht (existiert nicht, siehe
 * `prisma/seed-e2e.ts`-Kommentar). `configEditorAdmin` hat bereits
 * `config.goals.view`+`.edit` (Phase 11 AP1, additiv ueber
 * `permissionKeysForSeedRole()`) und genuegt daher fuer den vollstaendigen
 * Anlegen-/Korrektur-Fluss -- ein separater "Publisher"-Nutzer ist fuer
 * Goals nicht noetig.
 *
 * Laeuft automatisch auf Desktop + Tablet (siehe playwright.config.ts, zwei
 * Projekte je Spec-Datei). Da Desktop- und Tablet-Projekt bei
 * `fullyParallel: true` gegen DIESELBE per `globalSetup` einmalig geseedete
 * DB laufen (siehe Kommentar in `admin-rules.spec.ts`), verwendet der
 * mutierende Anlegen-Test einen PRO PROJEKT eindeutigen `periodStart`
 * (ueber `testInfo.project.name`) -- sonst wuerde der zweite Lauf denselben
 * Scope+Metrik+Periode-Identitaetsschluessel (`goals_scope_metric_period_
 * key`) treffen und mit 409 fehlschlagen (kein Bug, sondern die korrekt
 * funktionierende Kardinalitaetsregel aus AP2).
 */

const GOAL_DETAIL_URL_PATTERN = /\/admin\/goals\/[0-9a-f-]{36}$/;

function periodStartForProject(projectName: string): string {
  // Zwei verschiedene Kalendermonate reichen aus, um die beiden Projekte
  // (desktop-chromium / tablet-ipad-landscape) sicher zu trennen. Faellt bei
  // einem unbekannten/zukuenftigen Projektnamen auf einen dritten Monat
  // zurueck, statt still zu kollidieren.
  if (projectName === "desktop-chromium") return "2026-11-01";
  if (projectName === "tablet-ipad-landscape") return "2026-12-01";
  return "2027-01-01";
}

test.describe("/admin/goals – Ziele-Verwaltung (Phase 11 AP9)", () => {
  test("config.goals.view: Zugriff auf /admin/goals, Ueberschrift sichtbar", async ({ page }) => {
    const seed = readE2eSeedOutput();
    await loginAsAdmin(page, {
      tenantId: seed.tenantA.tenantId,
      email: seed.tenantA.configEditorAdmin.email,
      password: seed.tenantA.configEditorAdmin.password,
    });

    await page.goto("/admin/goals");

    await expect(page.getByRole("heading", { name: "Ziele" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Neues Ziel anlegen" })).toBeVisible();
  });

  test("kein Zugriff ohne config.goals.view (normaler Mitarbeiter)", async ({ page }) => {
    const seed = readE2eSeedOutput();
    await loginAs(page, seed.tenantA.employeeDisplayName);

    await page.goto("/admin/goals");

    await expect(page.getByRole("heading", { name: "Kein Zugriff" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Ziele" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Neues Ziel anlegen" })).toHaveCount(0);
  });

  test("Neues Ziel anlegen (TENANT-Scope) -> Detailseite -> neue Zielkorrektur erfassen -> Historie zeigt beide Versionen", async ({
    page,
  }, testInfo) => {
    const seed = readE2eSeedOutput();
    const periodStart = periodStartForProject(testInfo.project.name);

    await loginAsAdmin(page, {
      tenantId: seed.tenantA.tenantId,
      email: seed.tenantA.configEditorAdmin.email,
      password: seed.tenantA.configEditorAdmin.password,
    });

    // --- Listing oeffnen, Anlegen-Formular starten. ---
    await page.goto("/admin/goals");
    await page.getByRole("button", { name: "Neues Ziel anlegen" }).click();
    await expect(page.getByRole("heading", { name: "Neues Ziel anlegen" })).toBeVisible();

    // Scope-Typ TENANT ist die Vorbelegung fuer den Scope-Options-Request
    // NICHT garantiert (Default im Formular ist "STORE", siehe
    // CreateGoalButton.tsx) -- daher explizit auf TENANT umschalten, danach
    // ist das Scope-Feld automatisch vorbelegt (kein Auswahlfeld, da genau
    // eine Option) und muss nicht bedient werden.
    await Promise.all([
      page.waitForResponse((r) => r.url().includes("/scope-options?scopeType=TENANT")),
      page.getByLabel("Scope-Typ").selectOption("TENANT"),
    ]);
    await page.getByLabel("Metrik").selectOption("DEALS_CLOSED");
    await page.getByLabel("Zielanzahl Deals").fill("50");
    await page.getByLabel("Periodentyp").selectOption("MONTH");
    await page.getByLabel("Periodenbeginn").fill(periodStart);

    await Promise.all([
      page.waitForURL(GOAL_DETAIL_URL_PATTERN),
      page.getByRole("button", { name: "Ziel anlegen" }).click(),
    ]);

    // --- Detailseite: Identitaet + aktuelle Version (1) sichtbar. ---
    await expect(page.getByRole("heading", { name: "Abgeschlossene Deals" })).toBeVisible();
    await expect(page.getByText("Mandant:", { exact: false })).toBeVisible();
    await expect(page.getByText("Aktuelle Version: 1", { exact: false })).toBeVisible();
    await expect(page.getByText("Ziel: 50", { exact: false })).toBeVisible();

    // --- Neue Zielkorrektur erfassen -> wirkt sofort als Version 2. ---
    await page.getByRole("button", { name: "Neue Zielkorrektur erfassen" }).click();
    await expect(page.getByRole("heading", { name: "Neue Zielkorrektur erfassen" })).toBeVisible();
    await page.getByLabel("Zielanzahl Deals").fill("80");

    await Promise.all([
      page.waitForResponse((r) => r.url().includes("/versions") && r.request().method() === "POST"),
      page.getByRole("button", { name: "Zielkorrektur speichern" }).click(),
    ]);

    await expect(page.getByText("Aktuelle Version: 2", { exact: false })).toBeVisible();
    await expect(page.getByText("Ziel: 80", { exact: false })).toBeVisible();

    // --- Historie vollstaendig: BEIDE Versionen sichtbar, alte unveraendert. ---
    const historySection = page
      .locator("section")
      .filter({ has: page.getByRole("heading", { name: "Versionshistorie" }) });
    await expect(historySection.getByText("Version 1")).toBeVisible();
    await expect(historySection.getByText("Version 2")).toBeVisible();
    await expect(historySection).toContainText("50");
    await expect(historySection).toContainText("80");

    // --- Auch in der /admin/goals-Liste sichtbar (Ziel: 80, Version 2). ---
    await page.goto("/admin/goals");
    await expect(page.getByText(/Ziel: 80 Deals.*Version 2/)).toBeVisible();
  });
});
