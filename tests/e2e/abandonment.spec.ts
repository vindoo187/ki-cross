import { test, expect } from "@playwright/test";
import { readE2eSeedOutput } from "./seed-output";
import { loginAs, startNewConsultation, answerBoolean } from "./helpers";

/**
 * Abbruch-Test (separat vom Happy Path, siehe ChatGPTs AP12d-Pflichtumfang):
 * Start -> eine Frage beantworten -> "Beratung abbrechen" -> Grund waehlen ->
 * "Abbruch bestaetigen" -> Rueckkehr zur Uebersicht (CONSULTATION_ABANDONED).
 */

const Q1_LABEL = "Interessieren Sie sich fuer ein Streaming-Zusatzpaket?";

test("Abbruch: Beratung mit Grund abbrechen fuehrt zurueck zur Uebersicht", async ({ page }) => {
  const seed = readE2eSeedOutput();

  await loginAs(page, seed.tenantA.employeeDisplayName);
  await startNewConsultation(page);

  await answerBoolean(page, Q1_LABEL, false);

  await page.getByRole("button", { name: "Beratung abbrechen" }).click();
  await expect(page.getByText("Beratung wirklich abbrechen?")).toBeVisible();

  await page.getByRole("radio", { name: "Kunde hat keine Zeit" }).click();

  await Promise.all([
    page.waitForResponse(
      (response) =>
        /\/summary\/abandon$/.test(response.url()) && response.request().method() === "POST",
    ),
    page.getByRole("button", { name: "Abbruch bestaetigen" }).click(),
  ]);

  await page.waitForURL(/\/consultation$/);
  await expect(page.getByRole("heading", { name: "Beratung" })).toBeVisible();
});
