import { test, expect } from "@playwright/test";
import { readE2eSeedOutput } from "./seed-output";
import { loginAs, loginAsAdmin } from "./helpers";

/**
 * `/admin/rules` E2E-Suite (Phase 9 AP9, ChatGPTs Szenario-Checkliste vom
 * 2026-08-18): Zugriff mit `config.rules.view` / kein Zugriff ohne
 * Permission / DRAFT oeffnen + Regel bearbeiten / Condition hinzufuegen und
 * aendern / Validate -> gueltiger Entwurf / Publish -> mandantenweiter
 * Warnhinweis + explizite Bestaetigung / neue ACTIVE-Version sichtbar / alte
 * Version read-only / Historie vollstaendig / Rollback einer historischen
 * Version -> neuer DRAFT / Rollback-Entwurf -> Validate -> Publish / Publish
 * ohne `config.rules.publish` nicht moeglich / mandantenweiter
 * Publish-Hinweis tatsaechlich sichtbar / kein Zugriff auf einen fremden
 * Tenant ueber manipulierte URL/IDs.
 *
 * Laeuft automatisch auf Desktop + Tablet (siehe playwright.config.ts, zwei
 * Projekte je Spec-Datei -- keine Duplizierung noetig).
 *
 * Verwendet die in `prisma/seed-e2e.ts` (Phase 9 AP9-Erweiterung) angelegten
 * Admin-Testnutzer `configEditorAdmin` (view+edit, KEIN publish) und
 * `configPublisherAdmin` (view+edit+publish) via `loginAsAdmin()` (Phase 8
 * AP1 Admin-Login-API, kein eigenes UI-Formular).
 *
 * Der Fragen-Regressionstest fuer die AP9-RuleSetVersion-Timing-Korrektur
 * ist bewusst NICHT Teil dieser Suite (ChatGPT-Vorgabe 2026-08-18) -- er ist
 * bereits auf Integrationsebene ueber
 * tests/integration/recommendation-ruleset-snapshot.test.ts abgedeckt.
 *
 * `window.prompt()`/`window.confirm()` werden per `page.once("dialog", ...)`
 * VOR jedem ausloesenden Klick behandelt -- Playwright verwirft native
 * Dialoge sonst standardmaessig automatisch (leeres Ergebnis bei prompt(),
 * Abbruch bei confirm()).
 *
 * Die beiden Bedingungs-Editor-Felder ohne eigenes ARIA-Label (sourceType-/
 * operator-`<select>`, siehe RuleDraftEditor.tsx `ConditionsEditor` --
 * bewusst kein `<label>`, um die Bedingungszeile kompakt zu halten) haben
 * keine robuste rollenbasierte Alternative; sie werden stattdessen
 * strukturell ueber ihre Position INNERHALB der zuletzt per "Bedingung
 * hinzufuegen" angehaengten Zeile adressiert (deterministisch, da neue
 * Zeilen immer ans Ende angehaengt werden) statt ueber eine geratene
 * Text-/CSS-Positionsannahme auf Seitenebene.
 */

const DRAFT_VERSION_URL_PATTERN = /\/admin\/rules\/[0-9a-f-]{36}\/versions\/[0-9a-f-]{36}$/;

test.describe("/admin/rules – Regel-Editor (Phase 9 AP9)", () => {
  test("config.rules.view: Zugriff auf /admin/rules, RuleSet + mandantenweiter Hinweis sichtbar", async ({
    page,
  }) => {
    const seed = readE2eSeedOutput();
    await loginAsAdmin(page, {
      tenantId: seed.tenantA.tenantId,
      email: seed.tenantA.configEditorAdmin.email,
      password: seed.tenantA.configEditorAdmin.password,
    });

    await page.goto("/admin/rules");

    await expect(page.getByRole("heading", { name: "Regelverwaltung" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "e2e-standardregeln" })).toBeVisible();
    await expect(
      page.getByText("Hinweis: Die aktive Regelkonfiguration gilt mandantenweit", {
        exact: false,
      }),
    ).toBeVisible();
  });

  test("kein Zugriff ohne config.rules.view (normaler Mitarbeiter)", async ({ page }) => {
    const seed = readE2eSeedOutput();
    await loginAs(page, seed.tenantA.employeeDisplayName);

    await page.goto("/admin/rules");

    await expect(page.getByRole("heading", { name: "Kein Zugriff" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Regelverwaltung" })).toHaveCount(0);
  });

  test("Publish ohne config.rules.publish nicht moeglich, mandantenweiter Publish-Hinweis dennoch sichtbar", async ({
    page,
  }) => {
    const seed = readE2eSeedOutput();
    await loginAsAdmin(page, {
      tenantId: seed.tenantA.tenantId,
      email: seed.tenantA.configEditorAdmin.email,
      password: seed.tenantA.configEditorAdmin.password,
    });

    await page.goto("/admin/rules");
    const ruleSetItem = page
      .getByRole("listitem")
      .filter({ has: page.getByRole("heading", { name: "e2e-standardregeln" }) });

    page.once("dialog", async (dialog) => {
      await dialog.accept("E2E Entwurf (ohne Publish-Recht)");
    });
    await Promise.all([
      page.waitForURL(DRAFT_VERSION_URL_PATTERN),
      ruleSetItem.getByRole("button", { name: "Neuen Entwurf erstellen" }).click(),
    ]);

    await expect(page.getByRole("button", { name: "Validieren" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Veroeffentlichen" })).toHaveCount(0);
    await expect(
      page.getByText(
        "Hinweis: Veroeffentlichen ersetzt die aktive Regelkonfiguration des gesamten Mandanten",
        { exact: false },
      ),
    ).toBeVisible();
  });

  test("kein Zugriff auf einen fremden Tenant ueber manipulierte RuleSet-/Version-IDs", async ({
    page,
  }) => {
    const seed = readE2eSeedOutput();
    await loginAsAdmin(page, {
      tenantId: seed.tenantA.tenantId,
      email: seed.tenantA.configPublisherAdmin.email,
      password: seed.tenantA.configPublisherAdmin.password,
    });

    const response = await page.goto(
      `/admin/rules/${seed.tenantB.ruleSetId}/versions/${seed.tenantB.ruleSetVersionId}`,
    );

    expect(response, "Navigation sollte eine HTTP-Antwort liefern").not.toBeNull();
    expect(
      response?.ok(),
      `Erwartete eine fehlgeschlagene Antwort, erhielt Status ${response?.status()}`,
    ).toBe(false);
    await expect(page.getByRole("button", { name: "Speichern" })).toHaveCount(0);
  });

  test("DRAFT bearbeiten -> Validate -> Publish (mandantenweite Bestaetigung) -> alte Version read-only -> Historie -> Rollback -> Validate -> Publish", async ({
    page,
  }, testInfo) => {
    test.slow();
    const seed = readE2eSeedOutput();
    await loginAsAdmin(page, {
      tenantId: seed.tenantA.tenantId,
      email: seed.tenantA.configPublisherAdmin.email,
      password: seed.tenantA.configPublisherAdmin.password,
    });

    // ChatGPT-Vorgabe (AP9-E2E-Befund 2026-08-19, CI #59): globalSetup seedet
    // die Test-DB GENAU EINMAL fuer die GESAMTE Suite, Desktop- und
    // Tablet-Projekt laufen mit fullyParallel:true gegen denselben
    // webServer/dieselbe DB -- ein fixes Draft-Label wuerde bei diesem
    // mutierenden Test also projektuebergreifend kollidieren (zwei Versionen
    // mit identischem Label im selben RuleSet, Playwright-Strict-Mode-
    // Violation). Deshalb das Label pro Playwright-Projekt eindeutig machen,
    // statt den Locator unten mit .first() zu entschaerfen.
    const draftLabel = `E2E Entwurf v2 (${testInfo.project.name})`;

    // --- Neuen Entwurf aus der aktiven Version erstellen. ---
    await page.goto("/admin/rules");
    const ruleSetItem = page
      .getByRole("listitem")
      .filter({ has: page.getByRole("heading", { name: "e2e-standardregeln" }) });

    page.once("dialog", async (dialog) => {
      await dialog.accept(draftLabel);
    });
    await Promise.all([
      page.waitForURL(DRAFT_VERSION_URL_PATTERN),
      ruleSetItem.getByRole("button", { name: "Neuen Entwurf erstellen" }).click(),
    ]);

    const draftUrl = page.url();
    if (!DRAFT_VERSION_URL_PATTERN.test(draftUrl)) {
      throw new Error(`Unerwartete URL nach Entwurfserstellung: ${draftUrl}`);
    }

    await expect(page.locator("h1")).toContainText(draftLabel);
    await expect(page.locator("h1")).toContainText("Entwurf");
    await expect(page.getByRole("button", { name: "Validieren" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Veroeffentlichen" })).toBeVisible();

    // --- Bestehende Eligibility-Regel bearbeiten: Beschreibung aendern +
    // eine neue Bedingung hinzufuegen (alle Interaktionen sektionsweit
    // adressiert, NICHT ueber die ruleItem-Zeile selbst -- deren Textinhalt
    // aendert sich beim Wechsel in den Bearbeitungsmodus, siehe
    // Modulkommentar). ---
    const eligibilitySection = page
      .locator("section")
      .filter({ has: page.getByRole("heading", { name: "Eligibility-Regeln", exact: true }) });
    const targetRuleItem = eligibilitySection
      .getByRole("listitem")
      .filter({ hasText: "e2e_ausreichendes_datenvolumen" });

    await targetRuleItem.getByRole("button", { name: "Bearbeiten" }).click();
    const newDescription = "Produkt bietet mindestens 5 GB Datenvolumen (E2E bearbeitet)";
    await eligibilitySection.getByLabel("Beschreibung").fill(newDescription);

    const conditionRows = eligibilitySection.locator(".admin-questions__condition-row");
    const initialConditionCount = await conditionRows.count();
    await eligibilitySection.getByRole("button", { name: "Bedingung hinzufuegen" }).click();
    await expect(conditionRows).toHaveCount(initialConditionCount + 1);
    const newRow = conditionRows.last();
    await newRow.locator("select").nth(0).selectOption("PRODUCT_ATTRIBUTE");
    await newRow.getByPlaceholder("Attribut-Schluessel").fill("pricePlanTier");
    await newRow.locator("select").nth(1).selectOption("EQUALS");
    await newRow.getByPlaceholder(/Vergleichswert/).fill("STANDARD");

    await Promise.all([
      page.waitForResponse(
        (r) => r.url().includes("/eligibility-rules/") && r.request().method() === "PATCH",
      ),
      eligibilitySection.getByRole("button", { name: "Speichern" }).click(),
    ]);

    await expect(eligibilitySection.getByText(newDescription)).toBeVisible();
    await expect(
      eligibilitySection.getByText(`(${initialConditionCount + 1} Bedingungen)`),
    ).toBeVisible();

    // --- Validieren. ---
    await Promise.all([
      page.waitForResponse((r) => r.url().endsWith("/validate") && r.request().method() === "POST"),
      page.getByRole("button", { name: "Validieren" }).click(),
    ]);
    await expect(page.getByText("Entwurf ist vollstaendig und gueltig.")).toBeVisible();

    // --- Veroeffentlichen: mandantenweiter Warnhinweis im nativen
    // Bestaetigungsdialog + explizite Bestaetigung. ---
    page.once("dialog", async (dialog) => {
      expect(dialog.type()).toBe("confirm");
      expect(dialog.message()).toContain("GESAMTEN Mandanten");
      await dialog.accept();
    });
    await Promise.all([
      page.waitForResponse((r) => r.url().endsWith("/publish") && r.request().method() === "POST"),
      page.getByRole("button", { name: "Veroeffentlichen" }).click(),
    ]);

    // Nach erfolgreichem Publish (router.refresh(), keine Navigation): die
    // Version ist jetzt ACTIVE und schreibgeschuetzt.
    await expect(page.locator("h1").getByText("Aktiv")).toBeVisible();
    await expect(
      page.getByText("Diese Version ist nicht mehr im Entwurf und daher schreibgeschuetzt."),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Veroeffentlichen" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Bearbeiten" })).toHaveCount(0);

    // --- Neue ACTIVE-Version auch in der /admin/rules-Liste sichtbar. ---
    await page.goto("/admin/rules");
    await expect(
      page
        .getByRole("listitem")
        .filter({ has: page.getByRole("heading", { name: "e2e-standardregeln" }) })
        .getByText(draftLabel),
    ).toBeVisible();

    // --- Historie vollstaendig: alte Version (jetzt EXPIRED) + neue
    // ACTIVE-Version. ---
    await page.goto(draftUrl);
    await expect(page.getByRole("heading", { name: "Versionshistorie" })).toBeVisible();
    const historyPanel = page
      .locator("section")
      .filter({ has: page.getByRole("heading", { name: "Versionshistorie" }) });
    const oldVersionLink = historyPanel.getByRole("link", { name: /E2E Standardregeln v1/ });
    await expect(oldVersionLink).toBeVisible();
    await expect(oldVersionLink.getByText("Abgelaufen")).toBeVisible();

    // --- Alte Version weiterhin read-only. ---
    await oldVersionLink.click();
    await expect(page.locator("h1").getByText("Abgelaufen")).toBeVisible();
    await expect(page.getByRole("button", { name: "Bearbeiten" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Neue Regel hinzufuegen" })).toHaveCount(0);

    // --- Rollback der historischen Version -> neuer DRAFT. Der
    // Rollback-Button erscheint nur neben EINEM ANDEREN Eintrag als dem
    // aktuell angezeigten (siehe RuleVersionHistoryPanel.tsx) -- daher zurueck
    // zur jetzt aktiven v2-Seite, dort den Rollback-Button neben dem
    // v1-Eintrag klicken. Rollback kopiert von v1 (NICHT von der bearbeiteten
    // v2) -- Beschreibung im neuen Entwurf ist daher wieder das Original. ---
    await page.goto(draftUrl);
    const historyPanel2 = page
      .locator("section")
      .filter({ has: page.getByRole("heading", { name: "Versionshistorie" }) });
    const v1HistoryItem = historyPanel2
      .getByRole("listitem")
      .filter({ hasText: "E2E Standardregeln v1" });

    page.once("dialog", async (dialog) => {
      expect(dialog.type()).toBe("confirm");
      expect(dialog.message()).toContain("Rollback erstellt einen neuen Entwurf");
      await dialog.accept();
    });
    await Promise.all([
      page.waitForResponse((r) => r.url().endsWith("/rollback") && r.request().method() === "POST"),
      v1HistoryItem.getByRole("button", { name: "Rollback" }).click(),
    ]);
    await page.waitForURL(DRAFT_VERSION_URL_PATTERN);

    await expect(page.locator("h1")).toContainText("Entwurf");
    const rollbackEligibilitySection = page
      .locator("section")
      .filter({ has: page.getByRole("heading", { name: "Eligibility-Regeln", exact: true }) });
    await expect(
      rollbackEligibilitySection.getByText("Produkt bietet mindestens 5 GB Datenvolumen"),
    ).toBeVisible();
    await expect(rollbackEligibilitySection.getByText(newDescription)).toHaveCount(0);

    // --- Rollback-Entwurf: Validate -> Publish. ---
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
