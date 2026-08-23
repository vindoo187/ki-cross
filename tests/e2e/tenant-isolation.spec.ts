import { test, expect } from "@playwright/test";
import { readE2eSeedOutput } from "./seed-output";
import { loginAs } from "./helpers";

/**
 * Negativer Tenant-Isolationstest (ChatGPTs AP12d-Pflichtumfang: "Tenant-
 * Isolation ... durch einen negativen Zugriffstest abgesichert"). Ein bei
 * Tenant A angemeldeter Mitarbeiter versucht, direkt per URL auf eine
 * ConsultationSession von Tenant B zuzugreifen (siehe prisma/seed-e2e.ts,
 * `tenantB.consultationSessionId`).
 *
 * `src/app/consultation/[sessionId]/page.tsx` faengt
 * `ConsultationSessionNotFoundError` (siehe
 * src/server/questionnaire/errors.ts) NICHT explizit ab und es existiert
 * KEIN eigenes `error.tsx`/`not-found.tsx` in diesem Routensegment (Stand
 * dieses Tests) -- der Zugriff muss daher ueber Next.js' eingebaute
 * Fehlerbehandlung fehlschlagen. Bewusst KEINE Annahme eines konkreten
 * Statuscodes (403/404) -- stattdessen wird generisch auf einen
 * fehlgeschlagenen (nicht-2xx) initialen Dokument-Request UND das Ausbleiben
 * jeglichen Fragebogen-Inhalts von Tenant B geprueft, siehe ChatGPTs
 * bedingtes GO ("keine Annahme eines konkreten Statuscodes").
 */

test("Tenant-Isolation: Tenant-A-Mitarbeiter kann NICHT auf eine Tenant-B-Session zugreifen", async ({
  page,
}) => {
  const seed = readE2eSeedOutput();

  await loginAs(page, seed.tenantA.employeeDisplayName);

  const response = await page.goto(`/consultation/${seed.tenantB.consultationSessionId}`);

  expect(response, "Navigation sollte eine HTTP-Antwort liefern").not.toBeNull();
  expect(
    response?.ok(),
    `Erwartete eine fehlgeschlagene Antwort, erhielt Status ${response?.status()}`,
  ).toBe(false);

  // Unabhaengig vom exakten Fehlerbild: der Fragebogen-Arbeitsplatz (der bei
  // erfolgreichem Zugriff die Fragen-Navigation rendert) darf in keinem Fall
  // sichtbar sein.
  await expect(page.getByRole("navigation", { name: "Fragen-Navigation" })).toHaveCount(0);
});
