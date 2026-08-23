/**
 * Passwort-Hashing fuer den Admin-/Konfigurations-Login (Phase 8 AP1, siehe
 * PHASE_8_IMPLEMENTATION_PLAN.md Abschnitt 3.1/4).
 *
 * Bewusste Abweichung von der im Plan urspruenglich genannten "bcrypt"-
 * Bibliothek: diese Sandbox kann keine neuen npm-Abhaengigkeiten
 * installieren (kein `npm install` moeglich, siehe Projektregeln) und
 * `bcrypt` ist bislang keine Dependency. Statt einer neuen Abhaengigkeit
 * wird `node:crypto`'s eingebaute `scrypt`-Funktion verwendet -- ein von
 * Node.js selbst fuer Passwort-Hashing empfohlener Key-Derivation-Algorithmus
 * (RFC 7914), ohne zusaetzliche Dependency. `src/server/auth/session.ts`
 * nutzt bereits `node:crypto` fuer die HMAC-Signierung -- diese Wahl folgt
 * demselben, bereits etablierten Muster. Sicherheitseigenschaften
 * (Salt pro Passwort, konfigurierbarer Rechenaufwand, timing-safe Vergleich)
 * sind gleichwertig zu bcrypt fuer den hier vorgesehenen Zweck (Admin-Login
 * fuer eine kleine Anzahl synthetischer Testnutzer, kein hochfrequentiertes
 * Consumer-Login).
 *
 * Gespeichertes Format: "<salt-hex>:<hash-hex>" in `User.passwordHash`.
 * Passwort selbst wird NIEMALS persistiert oder geloggt.
 */

import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

const SALT_BYTES = 16;
const KEY_LENGTH = 64;

/**
 * Hasht ein Klartext-Passwort mit einem frischen zufaelligen Salt.
 * Nur beim Seed/Anlegen eines Admin-Testnutzers verwendet (siehe
 * prisma/seed.ts) -- es gibt in Phase 8 keinen Self-Service-
 * Registrierungsflow (siehe PHASE_8_IMPLEMENTATION_PLAN.md Abschnitt 3.1).
 */
export function hashPassword(password: string): string {
  const salt = randomBytes(SALT_BYTES).toString("hex");
  const hash = scryptSync(password, salt, KEY_LENGTH).toString("hex");
  return `${salt}:${hash}`;
}

/**
 * Ein syntaktisch gueltiger, aber nie einem echten Nutzer zugeordneter
 * Dummy-Hash. Wird verwendet, um bei einer nicht existierenden E-Mail
 * trotzdem denselben `scrypt`-Rechenaufwand auszufuehren wie bei einem
 * existierenden Nutzer mit falschem Passwort -- verhindert, dass ein
 * Timing-Unterschied zwischen "E-Mail existiert nicht" und "Passwort
 * falsch" Nutzer-Enumeration ermoeglicht (ChatGPT-Auflage, siehe
 * PHASE_8_IMPLEMENTATION_PLAN.md Abschnitt 15, Punkt 2 / AP1).
 */
export const DUMMY_PASSWORD_HASH = hashPassword(
  "dummy-password-fuer-timing-schutz-niemals-gueltig",
);

/**
 * Prueft ein Klartext-Passwort gegen einen gespeicherten Hash im Format
 * "<salt-hex>:<hash-hex>". Liefert `false` bei jeder Art von Ungueltigkeit
 * (falsches Format, falsches Passwort) -- wirft nie, damit Aufrufer nicht
 * versehentlich unterschiedliche Fehlerpfade fuer unterschiedliche
 * Fehlerursachen offenlegen.
 */
export function verifyPassword(password: string, storedHash: string): boolean {
  const separatorIndex = storedHash.indexOf(":");
  if (separatorIndex <= 0 || separatorIndex === storedHash.length - 1) {
    return false;
  }
  const salt = storedHash.slice(0, separatorIndex);
  const expectedHex = storedHash.slice(separatorIndex + 1);

  let expected: Buffer;
  try {
    expected = Buffer.from(expectedHex, "hex");
  } catch {
    return false;
  }
  if (expected.length !== KEY_LENGTH) {
    return false;
  }

  const actual = scryptSync(password, salt, KEY_LENGTH);
  return timingSafeEqual(actual, expected);
}
