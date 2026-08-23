/**
 * Credential-Pruefung fuer den Admin-/Konfigurations-Login (Phase 8 AP1,
 * siehe PHASE_8_IMPLEMENTATION_PLAN.md Abschnitt 3.1/4).
 *
 * Additiv zum bestehenden `dev-login` (Beratungsfluss, kein Passwort,
 * siehe src/server/auth/dev-users.ts) -- schuetzt ausschliesslich die neuen
 * Admin-/Konfigurationsflaechen. Verwendet bewusst `rawPrismaClient` (nicht
 * `db`/`withTenantScope`), aus demselben Grund wie dev-users.ts: der
 * Tenant-Kontext besteht an dieser Stelle noch nicht, er wird ja erst durch
 * den Login hergestellt.
 *
 * Baut nach erfolgreicher Passwort-Pruefung auf der bereits bestehenden,
 * getesteten `buildSessionPayloadForEmployee()`-Logik auf (dev-users.ts) --
 * dieselbe SessionPayload-Struktur, dieselbe Session-Signierung (ChatGPT-
 * Auflage: kein zweiter Signierungsmechanismus). Ein Admin-User erhaelt wie
 * jeder andere synthetische Nutzer einen Employee-Datensatz (siehe
 * prisma/seed.ts) -- das ist notwendig, weil SessionPayload verbindlich
 * employeeId/storeId enthaelt; die Config-Berechtigungen selbst sind
 * TENANT-scoped und unabhaengig vom zugewiesenen Store.
 */

import { rawPrismaClient } from "../db/client";
import { buildSessionPayloadForEmployee } from "./dev-users";
import { InvalidDevLoginCandidateError } from "./errors";
import type { SessionPayload } from "./session";
import { DUMMY_PASSWORD_HASH, verifyPassword } from "./password";

/**
 * Prueft E-Mail+Passwort fuer den Admin-Login und liefert bei Erfolg den
 * fertigen SessionPayload (gleiche Struktur wie `dev-login`). Liefert
 * `null` bei jeder Art von Fehlschlag -- unbekannte E-Mail, falsches
 * Passwort, kein gesetzter `passwordHash`, kein synthetischer Nutzer, oder
 * kein verknuepfter Employee-Datensatz sind bewusst NICHT unterscheidbar
 * (ChatGPT-Auflage: keine Nutzer-Enumeration, siehe
 * PHASE_8_IMPLEMENTATION_PLAN.md Abschnitt 15, Punkt 2 / AP1).
 *
 * Timing-Schutz: `verifyPassword()` wird IMMER aufgerufen -- bei
 * nicht existierendem Nutzer oder fehlendem `passwordHash` gegen einen
 * fixen Dummy-Hash, damit die Laufzeit nicht verraet, ob die E-Mail
 * existiert.
 */
export async function verifyAdminCredentials(
  tenantId: string,
  email: string,
  password: string,
): Promise<Omit<SessionPayload, "issuedAt"> | null> {
  const user = await rawPrismaClient.user.findUnique({
    where: { tenantId_email: { tenantId, email } },
    include: { employee: true },
  });

  const hashToCheck = user?.passwordHash ?? DUMMY_PASSWORD_HASH;
  const passwordValid = verifyPassword(password, hashToCheck);

  if (
    !user ||
    !user.passwordHash ||
    !user.isSynthetic ||
    !passwordValid ||
    !user.employee ||
    user.employee.employmentStatus !== "ACTIVE"
  ) {
    return null;
  }

  // Erneute Pruefung gegen die DB ueber die bereits getestete Funktion aus
  // dev-users.ts statt eigener Payload-Konstruktion -- vermeidet doppelte,
  // potenziell abweichende Logik fuer denselben Payload-Aufbau. Faengt den
  // (bei den obigen Vorpruefungen eigentlich unerwarteten) Fehlerfall ab,
  // z. B. ein Race-Condition-Statuswechsel zwischen den beiden DB-Zugriffen.
  try {
    return await buildSessionPayloadForEmployee(user.employee.id);
  } catch (error) {
    if (error instanceof InvalidDevLoginCandidateError) {
      return null;
    }
    throw error;
  }
}
