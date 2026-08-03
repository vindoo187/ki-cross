/**
 * Signierte Session-Tokens fuer den minimalen Dev-/Pilot-Auth-Mechanismus.
 *
 * Format: base64url(JSON-Payload) + "." + hex(HMAC-SHA256(payload, DEV_AUTH_SECRET)).
 * Kein Verschluesselung, nur Integritaetsschutz (Manipulationserkennung) --
 * der Payload ist fuer jeden mit Zugriff auf das Cookie lesbar (kein
 * Geheimnis wie ein Passwort enthalten). Das ist bewusst analog zu
 * unsigned/self-verifying JWTs, aber ohne externe Abhaengigkeit.
 *
 * NICHT produktionsreif -- siehe src/server/auth/errors.ts, Modul-Kommentar.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

export const SESSION_COOKIE_NAME = "ki_cross_dev_session";

/** Maximale Lebensdauer einer Dev-Session (Sekunden). Bewusst kurz gehalten. */
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 8; // 8 Stunden

export interface SessionPayload {
  tenantId: string;
  userId: string;
  employeeId: string;
  storeId: string;
  displayName: string;
  roles: string[];
  /** Unix-Timestamp (Sekunden), zu dem die Session ausgestellt wurde. */
  issuedAt: number;
}

function getDevAuthSecret(): string {
  const secret = process.env.DEV_AUTH_SECRET;
  if (!secret || secret.trim().length === 0) {
    throw new Error(
      "DEV_AUTH_SECRET ist nicht gesetzt. Siehe .env.example. (Diese Pruefung erfolgt bewusst hier statt still einen Default zu verwenden.)",
    );
  }
  return secret;
}

function base64UrlEncode(input: string): string {
  return Buffer.from(input, "utf8").toString("base64url");
}

function base64UrlDecode(input: string): string {
  return Buffer.from(input, "base64url").toString("utf8");
}

function sign(payloadEncoded: string, secret: string): string {
  return createHmac("sha256", secret).update(payloadEncoded).digest("hex");
}

/**
 * Erstellt ein signiertes Session-Token aus dem gegebenen Payload.
 * `issuedAt` wird automatisch gesetzt.
 */
export function createSessionToken(payload: Omit<SessionPayload, "issuedAt">): string {
  const secret = getDevAuthSecret();
  const fullPayload: SessionPayload = { ...payload, issuedAt: Math.floor(Date.now() / 1000) };
  const encoded = base64UrlEncode(JSON.stringify(fullPayload));
  const signature = sign(encoded, secret);
  return `${encoded}.${signature}`;
}

/**
 * Prueft Signatur und Ablauf eines Session-Tokens.
 *
 * Liefert `null` bei jeder Art von Ungueltigkeit (falsches Format, falsche
 * Signatur, abgelaufen, kaputtes JSON) -- der Aufrufer entscheidet, ob daraus
 * ein `MissingSessionError` oder `InvalidSessionError` wird.
 */
export function verifySessionToken(token: string | undefined | null): SessionPayload | null {
  if (!token) {
    return null;
  }
  const separatorIndex = token.lastIndexOf(".");
  if (separatorIndex <= 0 || separatorIndex === token.length - 1) {
    return null;
  }
  const encoded = token.slice(0, separatorIndex);
  const signature = token.slice(separatorIndex + 1);

  let secret: string;
  try {
    secret = getDevAuthSecret();
  } catch {
    return null;
  }

  const expectedSignature = sign(encoded, secret);
  const expectedBuffer = Buffer.from(expectedSignature, "hex");
  const actualBuffer = Buffer.from(signature, "hex");
  if (
    expectedBuffer.length !== actualBuffer.length ||
    !timingSafeEqual(expectedBuffer, actualBuffer)
  ) {
    return null;
  }

  let payload: SessionPayload;
  try {
    payload = JSON.parse(base64UrlDecode(encoded)) as SessionPayload;
  } catch {
    return null;
  }

  if (
    typeof payload.tenantId !== "string" ||
    typeof payload.userId !== "string" ||
    typeof payload.employeeId !== "string" ||
    typeof payload.storeId !== "string" ||
    typeof payload.displayName !== "string" ||
    !Array.isArray(payload.roles) ||
    typeof payload.issuedAt !== "number"
  ) {
    return null;
  }

  const ageSeconds = Math.floor(Date.now() / 1000) - payload.issuedAt;
  if (ageSeconds < 0 || ageSeconds > SESSION_MAX_AGE_SECONDS) {
    return null;
  }

  return payload;
}
