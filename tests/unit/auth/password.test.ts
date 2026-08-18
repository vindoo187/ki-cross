import { describe, expect, it } from "vitest";
import { DUMMY_PASSWORD_HASH, hashPassword, verifyPassword } from "@/server/auth/password";

/**
 * Unit-Tests fuer das Passwort-Hashing des Admin-/Konfigurations-Logins
 * (Phase 8 AP1, siehe PHASE_8_IMPLEMENTATION_PLAN.md Abschnitt 3.1/4).
 */
describe("hashPassword / verifyPassword", () => {
  it("verifiziert das korrekte Passwort gegen seinen eigenen Hash", () => {
    const hash = hashPassword("korrektes-passwort-123");
    expect(verifyPassword("korrektes-passwort-123", hash)).toBe(true);
  });

  it("lehnt ein falsches Passwort gegen einen gueltigen Hash ab", () => {
    const hash = hashPassword("korrektes-passwort-123");
    expect(verifyPassword("falsches-passwort", hash)).toBe(false);
  });

  it("erzeugt fuer dasselbe Passwort bei jedem Aufruf einen anderen Hash (frischer Salt)", () => {
    const hashA = hashPassword("gleiches-passwort");
    const hashB = hashPassword("gleiches-passwort");
    expect(hashA).not.toBe(hashB);
    expect(verifyPassword("gleiches-passwort", hashA)).toBe(true);
    expect(verifyPassword("gleiches-passwort", hashB)).toBe(true);
  });

  it("speichert niemals das Klartext-Passwort im Hash-String", () => {
    const hash = hashPassword("darf-nicht-im-hash-auftauchen");
    expect(hash).not.toContain("darf-nicht-im-hash-auftauchen");
  });

  it("liefert false bei einem strukturell ungueltigen gespeicherten Hash (kein Trennzeichen)", () => {
    expect(verifyPassword("irgendein-passwort", "kein-gueltiges-format")).toBe(false);
  });

  it("liefert false bei leerem Salt- oder Hash-Teil", () => {
    expect(verifyPassword("passwort", ":nurhash")).toBe(false);
    expect(verifyPassword("passwort", "nursalt:")).toBe(false);
  });

  it("liefert false bei ungueltigem Hex im Hash-Teil", () => {
    expect(verifyPassword("passwort", "aabbcc:nicht-hex-zzzz")).toBe(false);
  });

  it("DUMMY_PASSWORD_HASH ist syntaktisch gueltig, aber verifiziert kein reales Passwort", () => {
    expect(verifyPassword("irgendein-beliebiges-passwort", DUMMY_PASSWORD_HASH)).toBe(false);
    // Struktur pruefen (salt:hash, beide non-empty) -- stellt sicher, dass
    // verifyPassword() denselben Rechenaufwand wie bei einem echten Hash
    // durchlaeuft (Timing-Schutz gegen Nutzer-Enumeration).
    expect(DUMMY_PASSWORD_HASH).toMatch(/^[0-9a-f]+:[0-9a-f]+$/);
  });
});
