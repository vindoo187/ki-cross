import { test, expect } from "@playwright/test";
import { readE2eSeedOutput } from "./seed-output";
import {
  loginAs,
  startNewConsultation,
  goToQuestion,
  answerBoolean,
  answerSingleChoice,
  completeQuestionnaire,
  evaluateRecommendation,
} from "./helpers";

/**
 * Voller Happy-Path-Test (ChatGPTs AP12d-Pflichtumfang): Start -> Fragen ->
 * Pfadaenderung (Q1 false->true, Q3 erscheint) -> Fragebogen abschliessen ->
 * Empfehlung auswerten -> Begruendung ansehen -> Cross-Selling anbieten ->
 * Empfehlung ablehnen -> Zusammenfassung -> Beratung abschliessen.
 *
 * Verwendet Tenant A ("e2e-tenant-a", Fragebogen "e2e-basisberatung", siehe
 * prisma/seed-e2e.ts). Situation "vertrag_mit_streaming": Q1=true, Q2=vertrag
 * -> sichtbare Fragen {Q1, Q2, Q3}.
 */

const Q1_LABEL = "Interessieren Sie sich fuer ein Streaming-Zusatzpaket?";
const Q2_LABEL = "Welchen Tarif-Typ bevorzugen Sie?";
const Q3_LABEL = "Welches Streaming-Paket bevorzugen Sie?";

test("Happy Path: Beratung von Start bis Abschluss (vertrag_mit_streaming)", async ({ page }) => {
  const seed = readE2eSeedOutput();

  await loginAs(page, seed.tenantA.employeeDisplayName);
  const sessionId = await startNewConsultation(page);

  // --- Fragen beantworten, zunaechst OHNE Streaming-Bedarf ---
  await answerBoolean(page, Q1_LABEL, false);
  await goToQuestion(page, Q2_LABEL);
  await answerSingleChoice(page, Q2_LABEL, "Vertrag");

  // Q3 ist bei Q1=false nicht sichtbar.
  await expect(
    page
      .getByRole("navigation", { name: "Fragen-Navigation" })
      .getByRole("button", { name: Q3_LABEL }),
  ).toHaveCount(0);

  // --- Pfadaenderung: Q1 auf "Ja" aendern -> Q3 erscheint ---
  await goToQuestion(page, Q1_LABEL);
  await answerBoolean(page, Q1_LABEL, true);
  await expect(
    page
      .getByRole("navigation", { name: "Fragen-Navigation" })
      .getByRole("button", { name: Q3_LABEL }),
  ).toBeVisible();

  await goToQuestion(page, Q3_LABEL);
  await answerSingleChoice(page, Q3_LABEL, "Netflix");

  // --- Fragebogen abschliessen ---
  await completeQuestionnaire(page);
  await Promise.all([
    page.waitForURL(new RegExp(`/consultation/${sessionId}/recommendation$`)),
    page.getByRole("button", { name: "Zur Empfehlung" }).click(),
  ]);

  // --- Empfehlung auswerten ---
  await evaluateRecommendation(page);
  await expect(page.getByRole("heading", { name: "E2E TestTel Mobil M" })).toBeVisible();

  // --- Begruendung ansehen ---
  await page.getByRole("button", { name: "Begruendung ansehen" }).click();
  await expect(page.getByRole("heading", { name: "Warum passt dieser Tarif?" })).toBeVisible();

  // --- Cross-Selling: Streaming-Zusatzpaket anbieten ---
  await expect(page.getByRole("heading", { name: "Erkannter Zusatzbedarf" })).toBeVisible();
  await Promise.all([
    page.waitForResponse(
      (response) =>
        /\/sales-opportunities\//.test(response.url()) && response.request().method() === "PATCH",
    ),
    page.getByRole("button", { name: "Anbieten" }).click(),
  ]);
  await expect(page.getByText("Status: Angeboten")).toBeVisible();

  // --- Empfehlung ablehnen (mit Grund) ---
  await page.getByRole("button", { name: "Ablehnen" }).click();
  await page.getByRole("radio", { name: "Kein Bedarf beim Kunden" }).click();
  await Promise.all([
    page.waitForResponse(
      (response) => /\/outcome$/.test(response.url()) && response.request().method() === "POST",
    ),
    page.getByRole("button", { name: "Ablehnung bestaetigen" }).click(),
  ]);
  await expect(page.getByText(/^Abgelehnt am/)).toBeVisible();

  // --- Zusammenfassung ---
  await page.goto(`/consultation/${sessionId}/summary`);
  await expect(page.getByRole("heading", { name: "Zusammenfassung" })).toBeVisible();

  // --- Beratung abschliessen ---
  await Promise.all([
    page.waitForResponse(
      (response) =>
        /\/summary\/complete$/.test(response.url()) && response.request().method() === "POST",
    ),
    page.getByRole("button", { name: "Beratung abschliessen" }).click(),
  ]);
  await page.waitForURL(/\/consultation$/);
});
