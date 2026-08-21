import { test, expect } from "@playwright/test";
import { readE2eSeedOutput } from "./seed-output";
import { loginAs, loginAsAdmin } from "./helpers";

/**
 * `/admin/commissions` E2E-Suite (Phase 10 AP9, ChatGPT-GO 2026-08-22, siehe
 * PHASE_10_IMPLEMENTATION_PLAN.md Abschnitt 11). Deckt ab: RBAC
 * (view/edit/publish, 403/kein UI-Zugriff bei fehlender Permission),
 * Tenant-Isolation/IDOR (manipulierte commissionModelId/versionId),
 * kompletter UI-Flow (DRAFT bearbeiten -> Validate -> Publish -> Historie ->
 * "Neuen Entwurf aus dieser Version erstellen"), TIERED-Editor-Interaktion,
 * model-scoped Publish-Semantik (ein ANDERES CommissionModel desselben
 * Mandanten bleibt unveraendert), paralleles Publish (Concurrency).
 *
 * Laeuft automatisch auf Desktop + Tablet (siehe playwright.config.ts, zwei
 * Projekte je Spec-Datei -- keine Duplizierung noetig).
 *
 * ChatGPTs ausdrueckliche Vorgabe fuer AP9 ("von Anfang an mit href-/
 * ID-basierter Referenzierung historischer Versionen, nicht Label-basiert --
 * direkte Anwendung der Phase-9-Lehre, nicht erst nach einem eigenen
 * Befund"): `CommissionModelVersion` hat ohnehin KEIN Label-Feld (anders als
 * `RuleSetVersion`), jede Referenzierung hier erfolgt daher von Anfang an
 * ausschliesslich ueber die Detail-URL/href der jeweiligen Version, niemals
 * ueber Text-Matching. Da Desktop- und Tablet-Projekt `fullyParallel:true`
 * gegen dieselbe geseedete DB laufen, wird JEDE mutierende Testkette so
 * geschrieben, dass sie ihren eigenen erzeugten Draft ausschliesslich ueber
 * dessen soeben erhaltene URL/href weiterverfolgt -- niemals ueber eine
 * erneute "die aktive Version"-Abfrage (die durch das jeweils andere Projekt
 * zwischenzeitlich veraendert worden sein koennte). Aus demselben Grund
 * werden in der Haupt-Flow-Testkette keine von der urspruenglich kopierten
 * Version geerbten Feldwerte behauptet (die Quelle koennte durch das
 * parallele Projekt bereits ueberschrieben worden sein) -- alle Feldwerte
 * werden im Test selbst gesetzt und ausschliesslich diese eigenen Werte
 * geprueft.
 *
 * `CommissionModelVersion` hat -- anders als `RuleSetVersion` -- KEIN
 * Rollback-Route-Pendant (siehe `commission-schemas.ts` Modulkommentar) --
 * "Neuen Entwurf aus dieser Version erstellen" auf der historischen
 * Detailseite deckt denselben Bedarf ab und wird hier statt eines
 * Rollback-Buttons getestet.
 *
 * Deal-Reproduzierbarkeit (`DealItem.commissionModelVersionId` bleibt nach
 * einem spaeteren Publish unveraendert) ist bereits durch
 * `tests/integration/deals-service.test.ts` (Phase 10 AP6/AP7) mit direktem
 * DB-Zugriff exakt bewiesen -- diese Suite besitzt keine Admin-Oberflaeche,
 * die den gespeicherten `commissionAmountMinor` eines einzelnen Deals
 * anzeigt, ein rein UI-basierter Beweis ist auf dieser Ebene daher nicht
 * moeglich und wird bewusst NICHT dupliziert (analog `admin-rules.spec.ts`s
 * Behandlung der RuleSetVersion-Timing-Regression). `deal-closure.spec.ts`
 * deckt den Deal-Abschluss-UI-Fluss bereits ab.
 */

test.describe("/admin/commissions – Provisionsmodell-Editor (Phase 10 AP9)", () => {
  test("config.commissions.view: Zugriff auf /admin/commissions, Modell + modellgescopter Hinweis sichtbar", async ({
    page,
  }) => {
    const seed = readE2eSeedOutput();
    await loginAsAdmin(page, {
      tenantId: seed.tenantA.tenantId,
      email: seed.tenantA.configEditorAdmin.email,
      password: seed.tenantA.configEditorAdmin.password,
    });

    await page.goto("/admin/commissions");

    await expect(page.getByRole("heading", { name: "Provisionsmodelle" })).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "E2E Standardprovision Mobil M" }),
    ).toBeVisible();

    const hint = page.getByText(
      "Hinweis: Veroeffentlichen betrifft ausschliesslich das jeweilige Provisionsmodell",
      { exact: false },
    );
    await expect(hint).toBeVisible();
    // WICHTIGER Unterschied zu Phase 9 (ChatGPTs AP8-/AP9-Leitplanke): NICHT
    // der mandantenweite RuleSet-Warnhinweis.
    await expect(hint).not.toContainText("GESAMTEN Mandanten");
  });

  test("kein Zugriff ohne config.commissions.view (normaler Mitarbeiter)", async ({ page }) => {
    const seed = readE2eSeedOutput();
    await loginAs(page, seed.tenantA.employeeDisplayName);

    await page.goto("/admin/commissions");

    await expect(page.getByRole("heading", { name: "Kein Zugriff" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Provisionsmodelle" })).toHaveCount(0);
  });

  test("Publish ohne config.commissions.publish nicht moeglich, modellgescopter Publish-Hinweis dennoch sichtbar", async ({
    page,
  }) => {
    const seed = readE2eSeedOutput();
    await loginAsAdmin(page, {
      tenantId: seed.tenantA.tenantId,
      email: seed.tenantA.configEditorAdmin.email,
      password: seed.tenantA.configEditorAdmin.password,
    });

    const createResponse = await page.request.post(
      `/api/admin/commission-models/${seed.tenantA.commissionModelId}/versions`,
      {
        data: {
          commissionType: "FLAT",
          currency: "EUR",
          commissionAmountMinor: 500,
          commissionPercentageBasisPoints: null,
          recurringCommissionAmountMinor: null,
        },
      },
    );
    expect(createResponse.ok(), await createResponse.text()).toBe(true);
    const { version } = (await createResponse.json()) as { version: { id: string } };

    await page.goto(`/admin/commissions/${seed.tenantA.commissionModelId}/versions/${version.id}`);

    await expect(page.getByRole("button", { name: "Validieren" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Veroeffentlichen" })).toHaveCount(0);
    const hint = page.getByText(
      "Hinweis: Veroeffentlichen betrifft ausschliesslich dieses Provisionsmodell",
      { exact: false },
    );
    await expect(hint).toBeVisible();
    await expect(hint).not.toContainText("GESAMTEN Mandanten");
  });

  test("kein Zugriff auf einen fremden Tenant ueber manipulierte CommissionModel-/Version-IDs", async ({
    page,
  }) => {
    const seed = readE2eSeedOutput();
    await loginAsAdmin(page, {
      tenantId: seed.tenantA.tenantId,
      email: seed.tenantA.configPublisherAdmin.email,
      password: seed.tenantA.configPublisherAdmin.password,
    });

    const response = await page.goto(
      `/admin/commissions/${seed.tenantB.commissionModelId}/versions/${seed.tenantB.commissionModelVersionId}`,
    );

    expect(response, "Navigation sollte eine HTTP-Antwort liefern").not.toBeNull();
    expect(
      response?.ok(),
      `Erwartete eine fehlgeschlagene Antwort, erhielt Status ${response?.status()}`,
    ).toBe(false);
    await expect(page.getByRole("button", { name: "Speichern" })).toHaveCount(0);
  });

  test("DRAFT bearbeiten (TIERED) -> Validate -> Publish -> alte Version read-only -> Historie -> Neuer Entwurf aus historischer Version -> Validate -> Publish", async ({
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
    await page.goto("/admin/commissions");
    const modelItem = page
      .getByRole("listitem")
      .filter({ has: page.getByRole("heading", { name: "E2E Standardprovision Mobil M" }) });
    const activeLink = modelItem.locator(
      `a[href*="/admin/commissions/${seed.tenantA.commissionModelId}/versions/"]`,
      { hasText: "Aktiv" },
    );
    await expect(activeLink.first()).toBeVisible();
    const originalActiveHref = await activeLink.first().getAttribute("href");
    if (!originalActiveHref) {
      throw new Error("Konnte href der urspruenglich aktiven Version nicht ermitteln.");
    }

    // --- Neuen Entwurf erstellen (Button auf der Listenseite fuer dieses
    // Modell). ---
    await Promise.all([
      page.waitForResponse(
        (r) =>
          r.url().includes(`/commission-models/${seed.tenantA.commissionModelId}/versions`) &&
          r.request().method() === "POST",
      ),
      modelItem.getByRole("button", { name: "Neuen Entwurf erstellen" }).click(),
    ]);
    await page.waitForURL(
      new RegExp(`/admin/commissions/${seed.tenantA.commissionModelId}/versions/[0-9a-f-]{36}$`),
    );
    const draftUrl = page.url();

    await expect(page.locator("h1")).toContainText("Entwurf");
    await expect(page.getByRole("button", { name: "Validieren" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Veroeffentlichen" })).toBeVisible();

    // --- Auf TIERED umstellen und zwei Stufen anlegen. ---
    await page.getByLabel("Provisionsart").selectOption("TIERED");
    await page.getByLabel("Waehrung").fill("EUR");
    await Promise.all([
      page.waitForResponse(
        (r) => /\/versions\/[0-9a-f-]{36}$/.test(r.url()) && r.request().method() === "PATCH",
      ),
      page.getByRole("button", { name: "Speichern" }).click(),
    ]);
    await expect(page.getByText("Provisionsstufen")).toBeVisible();

    const tierSection = page
      .locator("section")
      .filter({ has: page.getByText("Provisionsstufen", { exact: true }) });

    // Stufe 1: thresholdMinor=0 (vom Validator zwingend gefordert), Fixbetrag.
    await tierSection.getByRole("button", { name: "Neue Stufe hinzufuegen" }).click();
    let addRow = tierSection.locator(".admin-questions__condition-row").last();
    await addRow.getByLabel("Schwelle").fill("0");
    await addRow.locator("select").selectOption("amount");
    await addRow.locator('input[type="number"]').nth(1).fill("500");
    await addRow.getByLabel("Reihenfolge").fill("0");
    await Promise.all([
      page.waitForResponse((r) => r.url().includes("/tiers") && r.request().method() === "POST"),
      tierSection.getByRole("button", { name: "Stufe hinzufuegen" }).click(),
    ]);
    await expect(tierSection.getByText("ab 0")).toBeVisible();

    // Stufe 2: thresholdMinor=2500, Prozent (Basispunkte).
    await tierSection.getByRole("button", { name: "Neue Stufe hinzufuegen" }).click();
    addRow = tierSection.locator(".admin-questions__condition-row").last();
    await addRow.getByLabel("Schwelle").fill("2500");
    await addRow.locator("select").selectOption("percentage");
    await addRow.locator('input[type="number"]').nth(1).fill("1000");
    await addRow.getByLabel("Reihenfolge").fill("1");
    await Promise.all([
      page.waitForResponse((r) => r.url().includes("/tiers") && r.request().method() === "POST"),
      tierSection.getByRole("button", { name: "Stufe hinzufuegen" }).click(),
    ]);
    await expect(tierSection.getByText("ab 2500")).toBeVisible();

    // --- Validieren. ---
    await Promise.all([
      page.waitForResponse((r) => r.url().endsWith("/validate") && r.request().method() === "POST"),
      page.getByRole("button", { name: "Validieren" }).click(),
    ]);
    await expect(page.getByText("Entwurf ist vollstaendig und gueltig.")).toBeVisible();

    // --- Veroeffentlichen: modellgescopter Bestaetigungsdialog. ---
    page.once("dialog", async (dialog) => {
      expect(dialog.type()).toBe("confirm");
      expect(dialog.message()).toContain("DIESES Provisionsmodells");
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
    await expect(page.getByRole("button", { name: "Speichern" })).toHaveCount(0);
    const rollbackButton = page.getByRole("button", {
      name: "Neuen Entwurf aus dieser Version erstellen",
    });
    await expect(rollbackButton).toBeVisible();

    await Promise.all([
      page.waitForResponse(
        (r) =>
          r.url().includes(`/commission-models/${seed.tenantA.commissionModelId}/versions`) &&
          r.request().method() === "POST",
      ),
      rollbackButton.click(),
    ]);
    await page.waitForURL(
      new RegExp(`/admin/commissions/${seed.tenantA.commissionModelId}/versions/[0-9a-f-]{36}$`),
    );
    await expect(page.locator("h1")).toContainText("Entwurf");
    // Kopiert von der historischen (FLAT-)Version, NICHT von der zuletzt
    // publizierten TIERED-Version.
    await expect(page.getByLabel("Provisionsart")).toHaveValue("FLAT");

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

  test("Publish ersetzt NUR dieses CommissionModel -- ein anderes Modell desselben Mandanten bleibt unveraendert", async ({
    page,
  }) => {
    const seed = readE2eSeedOutput();
    await loginAsAdmin(page, {
      tenantId: seed.tenantA.tenantId,
      email: seed.tenantA.configPublisherAdmin.email,
      password: seed.tenantA.configPublisherAdmin.password,
    });

    // Zustand des ZWEITEN Modells (nicht Ziel dieses Tests) vor der Mutation.
    const beforeResponse = await page.request.get(
      `/api/admin/commission-models/${seed.tenantA.commissionModelSecondaryId}/versions`,
    );
    expect(beforeResponse.ok()).toBe(true);
    const before = (await beforeResponse.json()) as { versions: { status: string }[] };
    const activeCountBefore = before.versions.filter((v) => v.status === "ACTIVE").length;
    expect(activeCountBefore).toBe(1);

    // Neuen Draft fuer das ERSTE Modell erstellen und veroeffentlichen.
    const createResponse = await page.request.post(
      `/api/admin/commission-models/${seed.tenantA.commissionModelId}/versions`,
      {
        data: {
          commissionType: "FLAT",
          currency: "EUR",
          commissionAmountMinor: 999,
          commissionPercentageBasisPoints: null,
          recurringCommissionAmountMinor: null,
        },
      },
    );
    expect(createResponse.ok(), await createResponse.text()).toBe(true);
    const { version } = (await createResponse.json()) as { version: { id: string } };
    const publishResponse = await page.request.post(
      `/api/admin/commission-models/${seed.tenantA.commissionModelId}/versions/${version.id}/publish`,
    );
    expect(publishResponse.ok(), await publishResponse.text()).toBe(true);

    // Das ZWEITE Modell muss unveraendert genau eine ACTIVE-Version haben.
    const afterResponse = await page.request.get(
      `/api/admin/commission-models/${seed.tenantA.commissionModelSecondaryId}/versions`,
    );
    expect(afterResponse.ok()).toBe(true);
    const after = (await afterResponse.json()) as { versions: { status: string }[] };
    const activeCountAfter = after.versions.filter((v) => v.status === "ACTIVE").length;
    expect(activeCountAfter).toBe(1);
  });

  test("paralleles Publish zweier Entwuerfe DESSELBEN CommissionModel: genau eine Version endet ACTIVE", async ({
    page,
  }) => {
    const seed = readE2eSeedOutput();
    await loginAsAdmin(page, {
      tenantId: seed.tenantA.tenantId,
      email: seed.tenantA.configPublisherAdmin.email,
      password: seed.tenantA.configPublisherAdmin.password,
    });

    const [createA, createB] = await Promise.all([
      page.request.post(`/api/admin/commission-models/${seed.tenantA.commissionModelId}/versions`, {
        data: {
          commissionType: "FLAT",
          currency: "EUR",
          commissionAmountMinor: 111,
          commissionPercentageBasisPoints: null,
          recurringCommissionAmountMinor: null,
        },
      }),
      page.request.post(`/api/admin/commission-models/${seed.tenantA.commissionModelId}/versions`, {
        data: {
          commissionType: "FLAT",
          currency: "EUR",
          commissionAmountMinor: 222,
          commissionPercentageBasisPoints: null,
          recurringCommissionAmountMinor: null,
        },
      }),
    ]);
    expect(createA.ok(), await createA.text()).toBe(true);
    expect(createB.ok(), await createB.text()).toBe(true);
    const versionA = ((await createA.json()) as { version: { id: string } }).version;
    const versionB = ((await createB.json()) as { version: { id: string } }).version;

    const [publishA, publishB] = await Promise.all([
      page.request.post(
        `/api/admin/commission-models/${seed.tenantA.commissionModelId}/versions/${versionA.id}/publish`,
      ),
      page.request.post(
        `/api/admin/commission-models/${seed.tenantA.commissionModelId}/versions/${versionB.id}/publish`,
      ),
    ]);

    // Die per Row-Lock serialisierte Reihenfolge ist nicht deterministisch --
    // entscheidend ist ausschliesslich die Invariante danach: BEIDE Publishes
    // erfolgreich (jeder ersetzt einfach die zu diesem Zeitpunkt aktuell
    // aktive Version) UND am Ende steht genau EINE ACTIVE-Version fuer
    // dieses Modell (das EXCLUDE-Constraint verhindert Ueberlappung).
    expect(publishA.ok(), await publishA.text()).toBe(true);
    expect(publishB.ok(), await publishB.text()).toBe(true);

    const listResponse = await page.request.get(
      `/api/admin/commission-models/${seed.tenantA.commissionModelId}/versions`,
    );
    expect(listResponse.ok()).toBe(true);
    const { versions } = (await listResponse.json()) as { versions: { status: string }[] };
    const activeCount = versions.filter((v) => v.status === "ACTIVE").length;
    expect(activeCount).toBe(1);
  });
});
