import { execSync } from "node:child_process";

/**
 * Playwright `globalSetup`: fuehrt das dedizierte E2E-Seed-Skript
 * (`prisma/seed-e2e.ts`, siehe dort fuer den vollen Modulkommentar) genau
 * EINMAL vor der gesamten Testsuite aus. Getrennt vom produktiven
 * `prisma/seed.ts` (demotel-nord/demotel-sued), damit die E2E-Tests nicht
 * von manuell gepflegten oder anderweitig genutzten Demo-Daten abhaengen
 * (siehe ChatGPTs AP12d-Auflage "kontrollierte, reproduzierbare Testdaten").
 *
 * Erwartet eine bereits migrierte Datenbank (`DATABASE_URL`) - in CI durch
 * die vorherigen Workflow-Schritte (`prisma migrate deploy`) sichergestellt,
 * lokal durch den Entwickler.
 */
export default async function globalSetup(): Promise<void> {
  execSync("npm run seed:e2e", { stdio: "inherit" });
}
