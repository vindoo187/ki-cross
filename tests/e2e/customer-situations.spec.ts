import { test, expect, type Page, type Locator } from "@playwright/test";
import { readE2eSeedOutput } from "./seed-output";
import {
  loginAs,
  startNewConsultation,
  goToQuestion,
  answerBoolean,
  answerSingleChoice,
  answerInteger,
} from "./helpers";

/**
 * Drei nachweislich unterschiedliche Kundensituationen (siehe
 * prisma/seed-e2e.ts Modulkommentar + ChatGPTs AP12d-Pflichtumfang
 * "mindestens drei ... Kundensituationen"). Jede Situation prueft die
 * tatsaechlich sichtbare Fragenmenge ueber die "Fragen-Navigation" -- nicht
 * nur einzelne Antworten.
 */

const Q1_LABEL = "Interessieren Sie sich fuer ein Streaming-Zusatzpaket?";
const Q2_LABEL = "Welchen Tarif-Typ bevorzugen Sie?";
const Q3_LABEL = "Welches Streaming-Paket bevorzugen Sie?";
const Q4_LABEL = "Wie viele Familienmitglieder sollen den Tarif mitnutzen?";

function navigatorButtons(page: Page): Locator {
  return page.getByRole("navigation", { name: "Fragen-Navigation" }).getByRole("button");
}

test.describe("Kundensituationen: unterschiedliche sichtbare Fragenpfade", () => {
  test("privat_prepaid_ohne_streaming: nur Q1+Q2 sichtbar (2 Fragen)", async ({ page }) => {
    const seed = readE2eSeedOutput();
    await loginAs(page, seed.tenantA.employeeDisplayName);
    await startNewConsultation(page);

    await answerBoolean(page, Q1_LABEL, false);
    await goToQuestion(page, Q2_LABEL);
    await answerSingleChoice(page, Q2_LABEL, "Prepaid");

    await expect(navigatorButtons(page)).toHaveCount(2);
    await expect(navigatorButtons(page).filter({ hasText: Q3_LABEL })).toHaveCount(0);
    await expect(navigatorButtons(page).filter({ hasText: Q4_LABEL })).toHaveCount(0);
  });

  test("vertrag_mit_streaming: Q1+Q2+Q3 sichtbar (3 Fragen, Q3 statt Q4)", async ({ page }) => {
    const seed = readE2eSeedOutput();
    await loginAs(page, seed.tenantA.employeeDisplayName);
    await startNewConsultation(page);

    await answerBoolean(page, Q1_LABEL, true);
    await goToQuestion(page, Q2_LABEL);
    await answerSingleChoice(page, Q2_LABEL, "Vertrag");

    await expect(navigatorButtons(page)).toHaveCount(3);
    await expect(navigatorButtons(page).filter({ hasText: Q3_LABEL })).toHaveCount(1);
    await expect(navigatorButtons(page).filter({ hasText: Q4_LABEL })).toHaveCount(0);

    await goToQuestion(page, Q3_LABEL);
    await answerSingleChoice(page, Q3_LABEL, "Disney+");
  });

  test("family_ohne_streaming: Q1+Q2+Q4 sichtbar (3 Fragen, Q4 statt Q3)", async ({ page }) => {
    const seed = readE2eSeedOutput();
    await loginAs(page, seed.tenantA.employeeDisplayName);
    await startNewConsultation(page);

    await answerBoolean(page, Q1_LABEL, false);
    await goToQuestion(page, Q2_LABEL);
    await answerSingleChoice(page, Q2_LABEL, "Family-Tarif");

    await expect(navigatorButtons(page)).toHaveCount(3);
    await expect(navigatorButtons(page).filter({ hasText: Q4_LABEL })).toHaveCount(1);
    await expect(navigatorButtons(page).filter({ hasText: Q3_LABEL })).toHaveCount(0);

    await goToQuestion(page, Q4_LABEL);
    await answerInteger(page, Q4_LABEL, 4);
  });
});
