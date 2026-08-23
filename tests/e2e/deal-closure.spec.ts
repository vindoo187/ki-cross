import { test, expect } from "@playwright/test";
import { readE2eSeedOutput } from "./seed-output";
import {
  loginAs,
  startNewConsultation,
  answerBoolean,
  answerSingleChoice,
  completeQuestionnaire,
  evaluateRecommendation,
} from "./helpers";

/**
 * Gezielter E2E-Test fuer den Deal-Abschluss-Flow (Phase 6 AP12, ChatGPT-
 * Vorgabe: "gezielter E2E-Test fuer den wichtigsten Deal-Abschluss-Flow,
 * falls die bestehende E2E-Infrastruktur ohne unverhaeltnismaessigen Aufwand
 * nutzbar ist"). Nutzt dieselbe Tenant-A-Fixture wie `happy-path.spec.ts`,
 * nimmt die Empfehlung aber AN (statt abzulehnen) und schliesst danach auf
 * der Zusammenfassungsseite einen Deal ab -- der Teil des End-to-End-Flusses,
 * den `happy-path.spec.ts` bewusst nicht abdeckt (dort wird die Empfehlung
 * abgelehnt).
 *
 * Deckt ab: Empfehlung annehmen -> Zusammenfassung zeigt Abschluss-Kandidaten
 * -> Deal erfassen -> read-only DealSummaryCard wird angezeigt -> ein
 * zweiter Abschlussversuch fuer dieselbe Sitzung ist nicht mehr moeglich
 * (Formular verschwindet, kein Doppelabschluss ueber die UI erreichbar).
 */

const Q1_LABEL = "Interessieren Sie sich fuer ein Streaming-Zusatzpaket?";
const Q2_LABEL = "Welchen Tarif-Typ bevorzugen Sie?";

test("Deal-Abschluss: Empfehlung annehmen -> auf der Zusammenfassungsseite abschliessen", async ({
  page,
}) => {
  const seed = readE2eSeedOutput();

  await loginAs(page, seed.tenantA.employeeDisplayName);
  const sessionId = await startNewConsultation(page);

  await answerBoolean(page, Q1_LABEL, false);
  await answerSingleChoice(page, Q2_LABEL, "Vertrag");
  await completeQuestionnaire(page);
  await Promise.all([
    page.waitForURL(new RegExp(`/consultation/${sessionId}/recommendation$`)),
    page.getByRole("button", { name: "Zur Empfehlung" }).click(),
  ]);

  await evaluateRecommendation(page);
  await expect(page.getByRole("heading", { name: "E2E TestTel Mobil M" })).toBeVisible();

  // --- Empfehlung annehmen (statt ablehnen, wie in happy-path.spec.ts) ---
  await Promise.all([
    page.waitForResponse(
      (response) => /\/outcome$/.test(response.url()) && response.request().method() === "POST",
    ),
    page.getByRole("button", { name: "Annehmen" }).click(),
  ]);
  await expect(page.getByText(/^Angenommen am/)).toBeVisible();

  // --- Zusammenfassung: Abschluss-Kandidat aus der angenommenen Empfehlung ---
  // Hinweis: "E2E TestTel Mobil M" erscheint auf dieser Seite bewusst zweimal
  // (Empfehlungsliste + Abschluss-Kandidat im Formular) -- daher hier keine
  // zusaetzliche getByText-Pruefung (wuerde Playwrights Strict Mode
  // verletzen); der Formular-Checkbox-Test unten ist eindeutig genug.
  await page.goto(`/consultation/${sessionId}/summary`);
  await expect(page.getByRole("heading", { name: "Zusammenfassung" })).toBeVisible();
  await expect(page.getByRole("checkbox")).toBeChecked();

  // --- Deal erfassen ---
  await Promise.all([
    page.waitForResponse(
      (response) => /\/deals$/.test(response.url()) && response.request().method() === "POST",
    ),
    page.getByRole("button", { name: "Abschluss erfassen" }).click(),
  ]);

  // --- Read-only Deal-Zusammenfassung sichtbar, Formular verschwunden ---
  await expect(page.getByText(/^Abgeschlossen am/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Abschluss erfassen" })).toHaveCount(0);

  // --- Reload bestaetigt: kein erneuter Abschluss ueber die UI moeglich ---
  await page.reload();
  await expect(page.getByText(/^Abgeschlossen am/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Abschluss erfassen" })).toHaveCount(0);
});
