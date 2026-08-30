import { test, expect } from "@playwright/test";
import { readE2eSeedOutput } from "./seed-output";
import { loginAs, loginAsAdmin } from "./helpers";

/**
 * `/admin/campaigns` E2E-Suite (Phase 13 AP8, ChatGPT-GO 2026-08-30, siehe
 * PHASE_13_IMPLEMENTATION_PLAN.md Abschnitt 3 AP8: "Security/Regression/E2E
 * (Desktop+Tablet, gleiche Haerte wie Phase 8-12)"). Strukturell nahezu
 * identisch zu `admin-commissions.spec.ts` (Phase 10 AP9) -- `CampaignVersion`
 * folgt demselben Draft/Validate/Publish/Historie-Muster wie
 * `CommissionModelVersion` (beide OHNE eigenes Rollback-Route-Pendant, "Neuen
 * Entwurf aus dieser Version erstellen" deckt denselben Bedarf ab, siehe
 * `campaign-schemas.ts`-Modulkommentar) und Publish ist ebenfalls PRO
 * Entitaet (hier: PRO Campaign) gescoped, NICHT mandantenweit wie
 * `RuleSetVersion`.
 *
 * Deckt ab: RBAC (view/edit/publish, 403/kein UI-Zugriff bei fehlender
 * Permission), Tenant-Isolation/IDOR (manipulierte campaignId/versionId),
 * kompletter UI-Flow (Neue Kampagne anlegen -> erster Entwurf -> Validate ->
 * Publish; sowie DRAFT aus bestehender ACTIVE-Version -> Validate -> Publish
 * -> alte Version EXPIRED -> Historie -> "Neuen Entwurf aus dieser Version
 * erstellen" -> Validate -> Publish), Bedingungs-Editor-Interaktion,
 * campaign-scoped Publish-Semantik (Hinweistext "DIESER Kampagne", nicht
 * "GESAMTEN Mandanten").
 *
 * Laeuft automatisch auf Desktop + Tablet (siehe playwright.config.ts, zwei
 * Projekte je Spec-Datei -- keine Duplizierung noetig).
 *
 * `CampaignVersion` hat KEIN Label-Feld (wie `CommissionModelVersion`,
 * anders als `RuleSetVersion`) -- jede Referenzierung historischer Versionen
 * erfolgt daher ausschliesslich ueber die Detail-URL/href der jeweiligen
 * Version, niemals ueber Text-Matching (identische Lehre wie
 * `admin-commissions.spec.ts`).
 *
 * Da Desktop- und Tablet-Projekt `fullyParallel: true` gegen dieselbe per
 * `globalSetup` einmalig geseedete DB laufen, verwendet die mutierende
 * Haupt-Flow-Testkette ausschliesslich den WEG UEBER DIE UI ("Neuen Entwurf
 * erstellen" fuer die per Seed vorhandene Campaign `e2e-sommeraktion"),
 * NICHT eine erneute "die aktive Version"-Abfrage, und setzt/prueft
 * ausschliesslich selbst gesetzte Feldwerte -- identisches Vorsichtsprinzip
 * wie in `admin-commissions.spec.ts` (die Quelle koennte durch das jeweils
 * andere Projekt zwischenzeitlich veraendert worden sein).
 *
 * Reproduzierbarkeit von `RecommendationCampaignSignal.campaignVersionId`
 * nach einem spaeteren Publish ist bereits durch
 * `tests/integration/recommendation-campaign-attribution.test.ts` (Phase 13
 * AP8, direkter DB-Zugriff) exakt bewiesen -- diese Suite besitzt keine
 * Admin-Oberflaeche, die eine einzelne Recommendation/ihr Signal anzeigt, ein
 * rein UI-basierter Beweis ist auf dieser Ebene daher nicht moeglich und wird
 * bewusst NICHT dupliziert (analog `admin-commissions.spec.ts`s Behandlung
 * der Deal-Reproduzierbarkeit).
 */

test.describe("/admin/campaigns – Kampagnen-Verwaltung (Phase 13 AP8)", () => {
  test("config.campaigns.view: Zugriff auf /admin/campaigns, Kampagne + kampagnengescopter Hinweis sichtbar", async ({
    page,
  }) => {
    const seed = readE2eSeedOutput();
    await loginAsAdmin(page, {
      tenantId: seed.tenantA.tenantId,
      email: seed.tenantA.configEditorAdmin.email,
      password: seed.tenantA.configEditorAdmin.password,
    });

    await page.goto("/admin/campaigns");

    await expect(page.getByRole("heading", { name: "Kampagnen" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "E2E Sommeraktion" })).toBeVisible();

    const hint = page.getByText(
      "Hinweis: Veroeffentlichen betrifft ausschliesslich die jeweilige Kampagne",
      { exact: false },
    );
    await expect(hint).toBeVisible();
    // WICHTIGER Unterschied zu Phase 9 (mandantenweiter RuleSet-Warnhinweis).
    await expect(hint).not.toContainText("GESAMTEN Mandanten");
  });

  test("kein Zugriff ohne config.campaigns.view (normaler Mitarbeiter)", async ({ page }) => {
    const seed = readE2eSeedOutput();
    await loginAs(page, seed.tenantA.employeeDisplayName);

    await page.goto("/admin/campaigns");

    await expect(page.getByRole("heading", { name: "Kein Zugriff" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Kampagnen" })).toHaveCount(0);
  });

  test("Publish ohne config.campaigns.publish nicht moeglich, kampagnengescopter Publish-Hinweis dennoch sichtbar", async ({
    page,
  }) => {
    const seed = readE2eSeedOutput();
    await loginAsAdmin(page, {
      tenantId: seed.tenantA.tenantId,
      email: seed.tenantA.configEditorAdmin.email,
      password: seed.tenantA.configEditorAdmin.password,
    });

    const createResponse = await page.request.post(
      `/api/admin/campaigns/${seed.tenantA.campaignId}/versions`,
      {
        data: {
          scopeType: "TENANT",
          scopeId: seed.tenantA.tenantId,
          description: null,
        },
      },
    );
    expect(createResponse.ok(), await createResponse.text()).toBe(true);
    const { version } = (await createResponse.json()) as { version: { id: string } };

    await page.goto(`/admin/campaigns/${seed.tenantA.campaignId}/versions/${version.id}`);

    await expect(page.getByRole("button", { name: "Validieren" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Veroeffentlichen" })).toHaveCount(0);
    const hint = page.getByText(
      "Hinweis: Veroeffentlichen betrifft ausschliesslich diese Kampagne",
      { exact: false },
    );
    await expect(hint).toBeVisible();
    await expect(hint).not.toContainText("GESAMTEN Mandanten");
  });

  test("kein Zugriff auf einen fremden Tenant ueber manipulierte Campaign-/Version-IDs", async ({
    page,
  }) => {
    const seed = readE2eSeedOutput();
    await loginAsAdmin(page, {
      tenantId: seed.tenantA.tenantId,
      email: seed.tenantA.configPublisherAdmin.email,
      password: seed.tenantA.configPublisherAdmin.password,
    });

    const response = await page.goto(
      `/admin/campaigns/${seed.tenantB.campaignId}/versions/${seed.tenantB.campaignVersionId}`,
    );

    expect(response, "Navigation sollte eine HTTP-Antwort liefern").not.toBeNull();
    expect(
      response?.ok(),
      `Erwartete eine fehlgeschlagene Antwort, erhielt Status ${response?.status()}`,
    ).toBe(false);
    await expect(page.getByRole("button", { name: "Entwurf speichern" })).toHaveCount(0);
  });

  test("Neue Kampagne anlegen -> erster Entwurf -> Bedingung -> Validate -> Publish", async ({
    page,
  }, testInfo) => {
    const seed = readE2eSeedOutput();
    // Eindeutiger Schluessel pro Projekt/Retry -- vermeidet eine Kollision
    // mit der @@unique([tenantId, key])-Constraint bei parallelen
    // Playwright-Projekten oder einem CI-Retry (identisches Prinzip wie
    // `periodStartForProject()` in admin-goals.spec.ts).
    const campaignKey = `e2e-neue-kampagne-${testInfo.project.name}-${testInfo.retry}`;
    // Der ANZEIGENAME muss -- exakt wie der Key -- projekt-/retry-eindeutig
    // sein: Playwright fuehrt desktop-chromium und tablet-ipad-landscape
    // parallel gegen DIESELBE Test-DB/denselben Tenant aus (kein Schema-Reset
    // zwischen Projekten), daher wuerde ein hartkodierter Name zu ZWEI
    // Listeneintraegen mit identischem Heading-Text fuehren (Playwright
    // strict-mode-Fehler, CI #133 real beobachtet).
    const campaignName = `E2E Neue Testkampagne (${testInfo.project.name}-${testInfo.retry})`;

    await loginAsAdmin(page, {
      tenantId: seed.tenantA.tenantId,
      email: seed.tenantA.configPublisherAdmin.email,
      password: seed.tenantA.configPublisherAdmin.password,
    });

    await page.goto("/admin/campaigns");
    await page.getByRole("button", { name: "Neue Kampagne anlegen" }).click();
    await expect(page.getByRole("heading", { name: "Neue Kampagne anlegen" })).toBeVisible();
    await page.getByLabel("Schluessel (eindeutig je Mandant)").fill(campaignKey);
    await page.getByLabel("Name").fill(campaignName);

    // Anlegen erzeugt KEINE Weiterleitung (Campaign ohne Version hat keine
    // eigene Detailseite, siehe CreateCampaignButton.tsx-Modulkommentar) --
    // die Liste aktualisiert sich stattdessen per router.refresh(). Die
    // campaignId wird direkt aus der POST-Antwort erfasst, damit die
    // nachfolgende Entwurf-POST-Wartebedingung eindeutig (nicht nur "irgendeine
    // /versions-POST") formuliert werden kann.
    const [createCampaignResponse] = await Promise.all([
      page.waitForResponse(
        (r) => r.url().endsWith("/api/admin/campaigns") && r.request().method() === "POST",
      ),
      page.getByRole("button", { name: "Kampagne anlegen" }).click(),
    ]);
    const { campaign } = (await createCampaignResponse.json()) as { campaign: { id: string } };
    await expect(page.getByRole("heading", { name: campaignName })).toBeVisible();

    const newItem = page
      .getByRole("listitem")
      .filter({ has: page.getByRole("heading", { name: campaignName }) });
    await expect(newItem.getByText("Keine Versionen vorhanden.")).toBeVisible();

    // --- Ersten Entwurf erstellen (kein copyFromVersionId, Default
    // TENANT-Scope, siehe CreateDraftCampaignVersionButton.tsx). ---
    await Promise.all([
      page.waitForResponse(
        (r) =>
          r.url().includes(`/campaigns/${campaign.id}/versions`) && r.request().method() === "POST",
      ),
      newItem.getByRole("button", { name: "Neuen Entwurf erstellen" }).click(),
    ]);
    await page.waitForURL(new RegExp(`/admin/campaigns/${campaign.id}/versions/[0-9a-f-]{36}$`));

    await expect(page.locator("h1")).toContainText("Entwurf");
    await expect(page.getByRole("button", { name: "Validieren" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Veroeffentlichen" })).toBeVisible();

    // --- Beschreibung setzen + eine Bedingung hinzufuegen, speichern. ---
    await page.getByLabel("Beschreibung").fill("E2E Testbeschreibung");
    await page.getByRole("button", { name: "Bedingung hinzufuegen" }).click();
    const conditionRow = page.locator(".admin-questions__condition-row").first();
    await conditionRow.locator("select").first().selectOption("SESSION_ATTRIBUTE");
    await conditionRow.getByPlaceholder("Attribut-Schluessel").fill("consultationType");
    await conditionRow.locator("select").nth(1).selectOption("EQUALS");
    await conditionRow
      .getByPlaceholder("Vergleichswert (bei IN/NOT_IN: kommagetrennt)")
      .fill("RENEWAL");

    await Promise.all([
      page.waitForResponse(
        (r) => /\/versions\/[0-9a-f-]{36}$/.test(r.url()) && r.request().method() === "PATCH",
      ),
      page.getByRole("button", { name: "Entwurf speichern" }).click(),
    ]);
    await expect(page.getByText("Entwurf gespeichert.")).toBeVisible();

    // --- Validieren. ---
    await Promise.all([
      page.waitForResponse((r) => r.url().endsWith("/validate") && r.request().method() === "POST"),
      page.getByRole("button", { name: "Validieren" }).click(),
    ]);
    await expect(page.getByText("Entwurf ist vollstaendig und gueltig.")).toBeVisible();

    // --- Veroeffentlichen: kampagnengescopter Bestaetigungsdialog. ---
    page.once("dialog", async (dialog) => {
      expect(dialog.type()).toBe("confirm");
      expect(dialog.message()).toContain("DIESER Kampagne");
      expect(dialog.message()).not.toContain("GESAMTEN Mandanten");
      await dialog.accept();
    });
    await Promise.all([
      page.waitForResponse((r) => r.url().endsWith("/publish") && r.request().method() === "POST"),
      page.getByRole("button", { name: "Veroeffentlichen" }).click(),
    ]);

    await expect(page.locator("h1").getByText("Aktiv")).toBeVisible();
    await expect(
      page.getByText("Diese Version ist nicht mehr im Entwurf und daher schreibgeschuetzt."),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Veroeffentlichen" })).toHaveCount(0);
  });

  test("Bestehende Kampagne: Neuer Entwurf aus ACTIVE-Version -> Validate -> Publish -> alte Version EXPIRED -> Historie -> Neuer Entwurf aus historischer Version -> Validate -> Publish", async ({
    page,
  }) => {
    test.slow();
    const seed = readE2eSeedOutput();
    await loginAsAdmin(page, {
      tenantId: seed.tenantA.tenantId,
      email: seed.tenantA.configPublisherAdmin.email,
      password: seed.tenantA.configPublisherAdmin.password,
    });

    // --- Ausgangsversion (zu diesem Zeitpunkt fuer DIESES Projekt aktiv)
    // ueber ihren href erfassen, BEVOR irgendeine Mutation stattfindet. ---
    await page.goto("/admin/campaigns");
    const campaignItem = page
      .getByRole("listitem")
      .filter({ has: page.getByRole("heading", { name: "E2E Sommeraktion" }) });
    const activeLink = campaignItem.locator(
      `a[href*="/admin/campaigns/${seed.tenantA.campaignId}/versions/"]`,
      { hasText: "Aktiv" },
    );
    await expect(activeLink.first()).toBeVisible();
    const originalActiveHref = await activeLink.first().getAttribute("href");
    if (!originalActiveHref) {
      throw new Error("Konnte href der urspruenglich aktiven Version nicht ermitteln.");
    }

    // --- Neuen Entwurf erstellen (kopiert Scope/Beschreibung von der
    // aktiven Version, siehe CreateDraftCampaignVersionButton.tsx). ---
    await Promise.all([
      page.waitForResponse(
        (r) =>
          r.url().includes(`/campaigns/${seed.tenantA.campaignId}/versions`) &&
          r.request().method() === "POST",
      ),
      campaignItem.getByRole("button", { name: "Neuen Entwurf erstellen" }).click(),
    ]);
    await page.waitForURL(
      new RegExp(`/admin/campaigns/${seed.tenantA.campaignId}/versions/[0-9a-f-]{36}$`),
    );
    const draftUrl = page.url();

    await expect(page.locator("h1")).toContainText("Entwurf");

    // --- Beschreibung im neuen Entwurf setzen (eigener, selbst gesetzter
    // Wert -- siehe Modulkommentar). ---
    await page.getByLabel("Beschreibung").fill("E2E Herbstaktion");
    await Promise.all([
      page.waitForResponse(
        (r) => /\/versions\/[0-9a-f-]{36}$/.test(r.url()) && r.request().method() === "PATCH",
      ),
      page.getByRole("button", { name: "Entwurf speichern" }).click(),
    ]);
    await expect(page.getByText("Entwurf gespeichert.")).toBeVisible();

    // --- Validieren + Veroeffentlichen. ---
    await Promise.all([
      page.waitForResponse((r) => r.url().endsWith("/validate") && r.request().method() === "POST"),
      page.getByRole("button", { name: "Validieren" }).click(),
    ]);
    await expect(page.getByText("Entwurf ist vollstaendig und gueltig.")).toBeVisible();

    page.once("dialog", async (dialog) => {
      await dialog.accept();
    });
    await Promise.all([
      page.waitForResponse((r) => r.url().endsWith("/publish") && r.request().method() === "POST"),
      page.getByRole("button", { name: "Veroeffentlichen" }).click(),
    ]);
    await expect(page.locator("h1").getByText("Aktiv")).toBeVisible();

    // --- Historie: die urspruenglich aktive Version ist jetzt EXPIRED. ---
    await page.goto(draftUrl);
    const historyPanel = page
      .locator("section")
      .filter({ has: page.getByRole("heading", { name: "Versionshistorie" }) });
    const oldVersionLink = historyPanel.locator(`a[href="${originalActiveHref}"]`);
    await expect(oldVersionLink).toBeVisible();
    await expect(oldVersionLink.getByText("Abgelaufen")).toBeVisible();

    // --- Alte Version weiterhin read-only, "Neuen Entwurf aus dieser
    // Version erstellen" verfuegbar. ---
    await oldVersionLink.click();
    await expect(page.locator("h1").getByText("Abgelaufen")).toBeVisible();
    await expect(page.getByRole("button", { name: "Entwurf speichern" })).toHaveCount(0);
    const rollbackButton = page.getByRole("button", {
      name: "Neuen Entwurf aus dieser Version erstellen",
    });
    await expect(rollbackButton).toBeVisible();

    await Promise.all([
      page.waitForResponse(
        (r) =>
          r.url().includes(`/campaigns/${seed.tenantA.campaignId}/versions`) &&
          r.request().method() === "POST",
      ),
      rollbackButton.click(),
    ]);
    await page.waitForURL(
      new RegExp(`/admin/campaigns/${seed.tenantA.campaignId}/versions/[0-9a-f-]{36}$`),
    );
    await expect(page.locator("h1")).toContainText("Entwurf");
    // Kopiert von der historischen (urspruenglichen, beschreibungslosen)
    // Version, NICHT von der zuletzt publizierten "E2E Herbstaktion".
    await expect(page.getByLabel("Beschreibung")).toHaveValue("");

    await Promise.all([
      page.waitForResponse((r) => r.url().endsWith("/validate") && r.request().method() === "POST"),
      page.getByRole("button", { name: "Validieren" }).click(),
    ]);
    await expect(page.getByText("Entwurf ist vollstaendig und gueltig.")).toBeVisible();

    page.once("dialog", async (dialog) => {
      await dialog.accept();
    });
    await Promise.all([
      page.waitForResponse((r) => r.url().endsWith("/publish") && r.request().method() === "POST"),
      page.getByRole("button", { name: "Veroeffentlichen" }).click(),
    ]);
    await expect(page.locator("h1").getByText("Aktiv")).toBeVisible();
  });
});
