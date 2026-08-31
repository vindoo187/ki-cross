import { test, expect } from "@playwright/test";
import { readE2eSeedOutput } from "./seed-output";
import { loginAs, loginAsAdmin } from "./helpers";

/**
 * `/admin/playbooks` E2E-Suite (Phase 14 AP8, ChatGPT-GO 2026-08-31, siehe
 * PHASE_14_IMPLEMENTATION_PLAN.md / project_ki_cross_phase14_ap7_status.md
 * AP8-Leitplanken: "bereits vorhandene Security-Haertung plus Desktop/
 * Tablet-E2E und die vollstaendige Admin-Lifecycle-Kette testen, ohne AP5c
 * oder Prompt-Integration vorwegzunehmen"). Strukturell nahezu identisch zu
 * `admin-campaigns.spec.ts` (Phase 13 AP8) -- `PlaybookVersion` folgt
 * demselben Draft/Validate/Publish/Historie-Muster wie `CampaignVersion`
 * (beide OHNE eigenes Rollback-Route-Pendant, "Neuen Entwurf aus dieser
 * Version erstellen" deckt denselben Bedarf ab) und Publish ist ebenfalls
 * PRO Entitaet (hier: PRO Playbook) gescoped, NICHT mandantenweit wie
 * `RuleSetVersion`.
 *
 * Deckt ab: RBAC (view/edit/publish, 403/kein UI-Zugriff bei fehlender
 * Permission), Tenant-Isolation/IDOR (manipulierte playbookId/versionId),
 * kompletter UI-Flow (Neues Playbook anlegen -> erster Entwurf -> Section ->
 * Validate -> Publish; sowie DRAFT aus bestehender ACTIVE-Version ->
 * Validate -> Publish -> alte Version EXPIRED -> Historie -> "Neuen Entwurf
 * aus dieser Version erstellen" -> Validate -> Publish),
 * Section-Editor-Interaktion (Content-Textarea bleibt reiner Text, siehe
 * playbook-security.test.ts fuer die tiefere Sicherheitsverifikation),
 * playbook-scoped Publish-Semantik (Hinweistext "DIESES Playbooks"/"dieses
 * Playbook", nicht "GESAMTEN Mandanten").
 *
 * Laeuft automatisch auf Desktop + Tablet (siehe playwright.config.ts, zwei
 * Projekte je Spec-Datei -- keine Duplizierung noetig).
 *
 * `PlaybookVersion` hat KEIN Label-Feld (wie `CampaignVersion`/
 * `CommissionModelVersion`) -- jede Referenzierung historischer Versionen
 * erfolgt daher ausschliesslich ueber die Detail-URL/href der jeweiligen
 * Version, niemals ueber Text-Matching (identische Lehre wie
 * `admin-campaigns.spec.ts`).
 *
 * Da Desktop- und Tablet-Projekt `fullyParallel: true` gegen dieselbe per
 * `globalSetup` einmalig geseedete DB laufen, verwendet die mutierende
 * Haupt-Flow-Testkette ausschliesslich den WEG UEBER DIE UI ("Neuen Entwurf
 * erstellen" fuer das per Seed vorhandene Playbook "E2E Basisverkauf"),
 * NICHT eine erneute "die aktive Version"-Abfrage, und setzt/prueft
 * ausschliesslich selbst gesetzte Feldwerte -- identisches Vorsichtsprinzip
 * wie in `admin-campaigns.spec.ts` (die Quelle koennte durch das jeweils
 * andere Projekt zwischenzeitlich veraendert worden sein).
 *
 * Tiefere Security-/Content-Trust-Boundary-Verifikation (adversarialer
 * Content, kein Prompt-Injection, keine Kopplung zur Recommendation
 * Engine, Reproduzierbarkeit) ist bereits durch
 * `tests/integration/playbook-security.test.ts` (Phase 14 AP5) und
 * `tests/integration/playbook-audit-reproducibility.test.ts` (Phase 14
 * AP7, direkter DB-/Service-Zugriff) exakt bewiesen -- diese Suite
 * dupliziert das bewusst NICHT, sondern deckt ausschliesslich die
 * UI-/HTTP-Ebene ab (analog `admin-commissions.spec.ts`s Behandlung der
 * Deal-Reproduzierbarkeit).
 */

test.describe("/admin/playbooks – Playbook-Verwaltung (Phase 14 AP8)", () => {
  test("config.playbooks.view: Zugriff auf /admin/playbooks, Playbook + playbookgescopter Hinweis sichtbar", async ({
    page,
  }) => {
    const seed = readE2eSeedOutput();
    await loginAsAdmin(page, {
      tenantId: seed.tenantA.tenantId,
      email: seed.tenantA.configEditorAdmin.email,
      password: seed.tenantA.configEditorAdmin.password,
    });

    await page.goto("/admin/playbooks");

    await expect(page.getByRole("heading", { name: "Playbooks" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "E2E Basisverkauf" })).toBeVisible();

    const hint = page.getByText(
      "Hinweis: Veroeffentlichen betrifft ausschliesslich das jeweilige Playbook",
      { exact: false },
    );
    await expect(hint).toBeVisible();
    // WICHTIGER Unterschied zu Phase 9 (mandantenweiter RuleSet-Warnhinweis).
    await expect(hint).not.toContainText("GESAMTEN Mandanten");
  });

  test("kein Zugriff ohne config.playbooks.view (normaler Mitarbeiter)", async ({ page }) => {
    const seed = readE2eSeedOutput();
    await loginAs(page, seed.tenantA.employeeDisplayName);

    await page.goto("/admin/playbooks");

    await expect(page.getByRole("heading", { name: "Kein Zugriff" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Playbooks" })).toHaveCount(0);
  });

  test("Publish ohne config.playbooks.publish nicht moeglich, playbookgescopter Publish-Hinweis dennoch sichtbar", async ({
    page,
  }) => {
    const seed = readE2eSeedOutput();
    await loginAsAdmin(page, {
      tenantId: seed.tenantA.tenantId,
      email: seed.tenantA.configEditorAdmin.email,
      password: seed.tenantA.configEditorAdmin.password,
    });

    const createResponse = await page.request.post(
      `/api/admin/playbooks/${seed.tenantA.playbookId}/versions`,
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

    await page.goto(`/admin/playbooks/${seed.tenantA.playbookId}/versions/${version.id}`);

    await expect(page.getByRole("button", { name: "Validieren" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Veroeffentlichen" })).toHaveCount(0);
    const hint = page.getByText(
      "Hinweis: Veroeffentlichen betrifft ausschliesslich dieses Playbook",
      { exact: false },
    );
    await expect(hint).toBeVisible();
    await expect(hint).not.toContainText("GESAMTEN Mandanten");
  });

  test("kein Zugriff auf einen fremden Tenant ueber manipulierte Playbook-/Version-IDs", async ({
    page,
  }) => {
    const seed = readE2eSeedOutput();
    await loginAsAdmin(page, {
      tenantId: seed.tenantA.tenantId,
      email: seed.tenantA.configPublisherAdmin.email,
      password: seed.tenantA.configPublisherAdmin.password,
    });

    const response = await page.goto(
      `/admin/playbooks/${seed.tenantB.playbookId}/versions/${seed.tenantB.playbookVersionId}`,
    );

    expect(response, "Navigation sollte eine HTTP-Antwort liefern").not.toBeNull();
    expect(
      response?.ok(),
      `Erwartete eine fehlgeschlagene Antwort, erhielt Status ${response?.status()}`,
    ).toBe(false);
    await expect(page.getByRole("button", { name: "Entwurf speichern" })).toHaveCount(0);
  });

  test("Neues Playbook anlegen -> erster Entwurf -> Section -> Validate -> Publish", async ({
    page,
  }, testInfo) => {
    const seed = readE2eSeedOutput();
    // Eindeutiger Schluessel pro Projekt/Retry -- vermeidet eine Kollision
    // mit der @@unique([tenantId, key])-Constraint bei parallelen
    // Playwright-Projekten oder einem CI-Retry (identisches Prinzip wie
    // `admin-campaigns.spec.ts`).
    const playbookKey = `e2e-neues-playbook-${testInfo.project.name}-${testInfo.retry}`;
    // Der ANZEIGENAME muss -- exakt wie der Key -- projekt-/retry-eindeutig
    // sein: Playwright fuehrt desktop-chromium und tablet-ipad-landscape
    // parallel gegen DIESELBE Test-DB/denselben Tenant aus (kein
    // Schema-Reset zwischen Projekten), daher wuerde ein hartkodierter Name
    // zu ZWEI Listeneintraegen mit identischem Heading-Text fuehren
    // (Playwright strict-mode-Fehler, identische Lehre wie CI #133 bei
    // Kampagnen).
    const playbookName = `E2E Neues Testplaybook (${testInfo.project.name}-${testInfo.retry})`;

    await loginAsAdmin(page, {
      tenantId: seed.tenantA.tenantId,
      email: seed.tenantA.configPublisherAdmin.email,
      password: seed.tenantA.configPublisherAdmin.password,
    });

    await page.goto("/admin/playbooks");
    await page.getByRole("button", { name: "Neues Playbook anlegen" }).click();
    await expect(page.getByRole("heading", { name: "Neues Playbook anlegen" })).toBeVisible();
    await page.getByLabel("Schluessel (eindeutig je Mandant)").fill(playbookKey);
    await page.getByLabel("Name").fill(playbookName);

    // Anlegen erzeugt KEINE Weiterleitung (Playbook ohne Version hat keine
    // eigene Detailseite, siehe CreatePlaybookButton.tsx-Modulkommentar) --
    // die Liste aktualisiert sich stattdessen per router.refresh(). Die
    // playbookId wird direkt aus der POST-Antwort erfasst, damit die
    // nachfolgende Entwurf-POST-Wartebedingung eindeutig formuliert werden
    // kann.
    const [createPlaybookResponse] = await Promise.all([
      page.waitForResponse(
        (r) => r.url().endsWith("/api/admin/playbooks") && r.request().method() === "POST",
      ),
      page.getByRole("button", { name: "Playbook anlegen" }).click(),
    ]);
    const { playbook } = (await createPlaybookResponse.json()) as { playbook: { id: string } };
    await expect(page.getByRole("heading", { name: playbookName })).toBeVisible();

    const newItem = page
      .getByRole("listitem")
      .filter({ has: page.getByRole("heading", { name: playbookName }) });
    await expect(newItem.getByText("Keine Versionen vorhanden.")).toBeVisible();

    // --- Ersten Entwurf erstellen (kein copyFromVersionId, Default
    // TENANT-Scope, siehe CreateDraftPlaybookVersionButton.tsx). ---
    await Promise.all([
      page.waitForResponse(
        (r) =>
          r.url().includes(`/playbooks/${playbook.id}/versions`) && r.request().method() === "POST",
      ),
      newItem.getByRole("button", { name: "Neuen Entwurf erstellen" }).click(),
    ]);
    await page.waitForURL(new RegExp(`/admin/playbooks/${playbook.id}/versions/[0-9a-f-]{36}$`));

    await expect(page.locator("h1")).toContainText("Entwurf");
    await expect(page.getByRole("button", { name: "Validieren" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Veroeffentlichen" })).toBeVisible();

    // --- Beschreibung setzen + eine Section hinzufuegen, speichern. ---
    await page.getByLabel("Beschreibung").fill("E2E Testbeschreibung");
    await page.getByRole("button", { name: "Section hinzufuegen" }).click();
    const sectionBlock = page.locator(".admin-playbooks__section-block").first();
    await sectionBlock.getByPlaceholder("Titel").fill("E2E Section-Titel");
    await sectionBlock
      .getByLabel("Inhalt (reiner Text -- wird niemals als HTML interpretiert)")
      .fill("E2E Section-Inhalt fuer den kompletten Admin-Flow.");

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

    // --- Veroeffentlichen: playbookgescopter Bestaetigungsdialog. ---
    page.once("dialog", async (dialog) => {
      expect(dialog.type()).toBe("confirm");
      expect(dialog.message()).toContain("DIESES Playbooks");
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

  test("Bestehendes Playbook: Neuer Entwurf aus ACTIVE-Version -> Validate -> Publish -> alte Version EXPIRED -> Historie -> Neuer Entwurf aus historischer Version -> Validate -> Publish", async ({
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
    await page.goto("/admin/playbooks");
    const playbookItem = page
      .getByRole("listitem")
      .filter({ has: page.getByRole("heading", { name: "E2E Basisverkauf" }) });
    const activeLink = playbookItem.locator(
      `a[href*="/admin/playbooks/${seed.tenantA.playbookId}/versions/"]`,
      { hasText: "Aktiv" },
    );
    await expect(activeLink.first()).toBeVisible();
    const originalActiveHref = await activeLink.first().getAttribute("href");
    if (!originalActiveHref) {
      throw new Error("Konnte href der urspruenglich aktiven Version nicht ermitteln.");
    }

    // --- Neuen Entwurf erstellen (kopiert Scope/Beschreibung/Sections von
    // der aktiven Version, siehe CreateDraftPlaybookVersionButton.tsx). ---
    await Promise.all([
      page.waitForResponse(
        (r) =>
          r.url().includes(`/playbooks/${seed.tenantA.playbookId}/versions`) &&
          r.request().method() === "POST",
      ),
      playbookItem.getByRole("button", { name: "Neuen Entwurf erstellen" }).click(),
    ]);
    await page.waitForURL(
      new RegExp(`/admin/playbooks/${seed.tenantA.playbookId}/versions/[0-9a-f-]{36}$`),
    );
    const draftUrl = page.url();

    await expect(page.locator("h1")).toContainText("Entwurf");

    // --- Beschreibung im neuen Entwurf setzen (eigener, selbst gesetzter
    // Wert -- siehe Modulkommentar). ---
    await page.getByLabel("Beschreibung").fill("E2E Herbstschulung");
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
          r.url().includes(`/playbooks/${seed.tenantA.playbookId}/versions`) &&
          r.request().method() === "POST",
      ),
      rollbackButton.click(),
    ]);
    await page.waitForURL(
      new RegExp(`/admin/playbooks/${seed.tenantA.playbookId}/versions/[0-9a-f-]{36}$`),
    );
    await expect(page.locator("h1")).toContainText("Entwurf");
    // Kopiert von der historischen (urspruenglichen, beschreibungslosen)
    // Version, NICHT von der zuletzt publizierten "E2E Herbstschulung".
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
