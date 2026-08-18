import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * Liest die von `prisma/seed-e2e.ts` bei jedem `globalSetup`-Lauf frisch
 * geschriebene Ausgabedatei (`.e2e-seed-output.json`, siehe .gitignore) mit
 * den zur Seed-Zeit generierten UUIDs. Noetig, weil die Spec-Dateien in einem
 * eigenen Prozess laufen und diese Werte sonst nur per erneuter DB-Abfrage
 * kennen wuerden.
 */

interface E2eAdminCredentials {
  email: string;
  password: string;
}

export interface E2eSeedOutput {
  tenantA: {
    tenantId: string;
    employeeDisplayName: string;
    questionnaireKey: string;
    /** RuleSet mit einer ACTIVE-Version (Phase 9 AP9, /admin/rules-E2E-Suite). */
    ruleSetId: string;
    /** config.rules.view+edit, KEIN .publish. */
    configEditorAdmin: E2eAdminCredentials;
    /** config.rules.view+edit+publish. */
    configPublisherAdmin: E2eAdminCredentials;
  };
  tenantB: {
    tenantId: string;
    employeeDisplayName: string;
    consultationSessionId: string;
    /** Fuer den negativen /admin/rules-Tenant-Isolationstest (Phase 9 AP9). */
    ruleSetId: string;
    ruleSetVersionId: string;
  };
}

const SEED_OUTPUT_PATH = path.join(__dirname, ".e2e-seed-output.json");

export function readE2eSeedOutput(): E2eSeedOutput {
  const raw = readFileSync(SEED_OUTPUT_PATH, "utf-8");
  return JSON.parse(raw) as E2eSeedOutput;
}
