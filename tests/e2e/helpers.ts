import { type Page, expect } from "@playwright/test";

/**
 * Gemeinsame Hilfsfunktionen fuer die E2E-Spec-Dateien (AP12d). Bewusst
 * OHNE `page.waitForTimeout()` (siehe ChatGPTs bedingtes GO vom 2026-08-03) --
 * jede Aktion, die eine Server-Antwort ausloest, wird per
 * `page.waitForResponse()` mit der eigentlichen UI-Interaktion verkoppelt;
 * jeder Navigationsschritt wird per `expect(...).toBeVisible()`/`toHaveURL()`
 * auf einen sichtbaren Zielzustand hin geprueft. Alle Selektoren nutzen
 * ausschliesslich Rollen/Labels (kein CSS, keine Textpositionen), siehe
 * ChatGPTs Vorgabe "robuste Selektoren ... keine fragilen CSS- oder
 * Textpositionsselektoren".
 */

/** Meldet sich ueber den Dev-Login (`/login`) mit dem gegebenen Mitarbeiter an. */
export async function loginAs(page: Page, employeeDisplayName: string): Promise<void> {
  await page.goto("/login");
  await Promise.all([
    page.waitForURL(/\/consultation$/),
    page.getByRole("button", { name: employeeDisplayName }).click(),
  ]);
}

/** Startet eine neue Beratung (Tenant A hat genau einen aktiven Fragebogen, kein Auswahlfeld noetig). */
export async function startNewConsultation(page: Page): Promise<string> {
  await page.goto("/consultation");
  await Promise.all([
    page.waitForURL(/\/consultation\/[0-9a-f-]{36}$/),
    page.getByRole("button", { name: "Neue Beratung starten" }).click(),
  ]);
  const match = /\/consultation\/([0-9a-f-]{36})$/.exec(page.url());
  const sessionId = match?.[1];
  if (!sessionId) {
    throw new Error(`Unerwartete URL nach Beratungsstart: ${page.url()}`);
  }
  return sessionId;
}

/** Wechselt in der Fragen-Navigation zur Frage mit dem gegebenen Label und wartet auf deren Anzeige. */
export async function goToQuestion(page: Page, questionLabel: string): Promise<void> {
  await page
    .getByRole("navigation", { name: "Fragen-Navigation" })
    .getByRole("button", { name: questionLabel })
    .click();
  await expect(page.getByRole("heading", { name: questionLabel })).toBeVisible();
}

async function waitForAnswerSaved(page: Page, action: () => Promise<void>): Promise<void> {
  await Promise.all([
    page.waitForResponse(
      (response) => response.url().includes("/answers") && response.request().method() !== "GET",
    ),
    action(),
  ]);
}

export async function answerBoolean(
  page: Page,
  questionLabel: string,
  value: boolean,
): Promise<void> {
  const group = page.getByRole("radiogroup", { name: questionLabel });
  await waitForAnswerSaved(page, () =>
    group.getByRole("radio", { name: value ? "Ja" : "Nein" }).click(),
  );
}

export async function answerSingleChoice(
  page: Page,
  questionLabel: string,
  optionLabel: string,
): Promise<void> {
  const group = page.getByRole("radiogroup", { name: questionLabel });
  await waitForAnswerSaved(page, () => group.getByRole("radio", { name: optionLabel }).click());
}

export async function answerInteger(
  page: Page,
  questionLabel: string,
  value: number,
): Promise<void> {
  await waitForAnswerSaved(page, () =>
    page.getByRole("spinbutton", { name: questionLabel }).fill(String(value)),
  );
}

/** Klickt "Fragebogen abschliessen" und wartet auf den Abschluss-Bildschirm. */
export async function completeQuestionnaire(page: Page): Promise<void> {
  await Promise.all([
    page.waitForResponse(
      (response) => response.url().endsWith("/complete") && response.request().method() === "POST",
    ),
    page.getByRole("button", { name: "Fragebogen abschliessen" }).click(),
  ]);
  await expect(page.getByRole("heading", { name: "Fragebogen abgeschlossen" })).toBeVisible();
}

/** Loest die Empfehlungsauswertung aus und wartet auf die aktualisierte Empfehlungsliste. */
export async function evaluateRecommendation(page: Page): Promise<void> {
  await Promise.all([
    page.waitForResponse(
      (response) =>
        /\/recommendation$/.test(response.url()) && response.request().method() === "POST",
    ),
    page.getByRole("button", { name: "Empfehlung auswerten" }).click(),
  ]);
}
