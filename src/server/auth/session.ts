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
import type { NextRequest } from "next/server";
import type { ManagementScope, ManagementScopeLevel } from "../authz/management-scope";
import { ALL_CONFIG_PERMISSION_KEYS, type ConfigPermissionKey } from "../authz/config-permissions";

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
  /**
   * Beim Login serverseitig aus den `RoleAssignment`-Zeilen aufgeloester
   * Management-Analytics-Scope (Phase 7 AP1), `null` falls keine
   * Management-Berechtigung besteht. Ausschliesslich serverseitig gesetzt
   * (`src/server/auth/dev-users.ts::resolveManagementScopeForUser()`) --
   * der Client liest dieses Feld nur, definiert es nie. Wie `roles` gilt
   * dieser Wert bis zum naechsten Login/Session-Refresh als massgeblich
   * (kein DB-Reabgleich pro Analytics-Anfrage, siehe
   * PHASE_7_IMPLEMENTATION_PLAN.md Abschnitt 3.2 fuer die akzeptierte
   * Freshness-Eigenschaft bei Rollenentzug).
   */
  managementScope: ManagementScope | null;
  /**
   * Beim Login serverseitig aus den `RoleAssignment`-Zeilen aufgeloeste
   * `config.questions.*`- UND (seit Phase 9 AP1) `config.rules.*`-
   * Permissions, ausschliesslich aus TENANT-scoped Zuweisungen (siehe
   * `src/server/authz/config-permissions.ts::deriveConfigPermissions()`).
   * Getrennt von `managementScope` (eigene, unabhaengige RBAC-Architektur,
   * siehe PHASE_8_IMPLEMENTATION_PLAN.md Abschnitt 3.2). Leeres Array =
   * keine Config-Berechtigung (deny-by-default). Ausschliesslich
   * serverseitig gesetzt, der Client liest dieses Feld nur.
   */
  configPermissions: ConfigPermissionKey[];
  /** Unix-Timestamp (Sekunden), zu dem die Session ausgestellt wurde. */
  issuedAt: number;
}

const MANAGEMENT_SCOPE_LEVELS: ReadonlySet<ManagementScopeLevel> = new Set([
  "STORE",
  "COMPANY",
  "TENANT",
]);

function isValidConfigPermissions(value: unknown): value is ConfigPermissionKey[] {
  return (
    Array.isArray(value) &&
    value.every(
      (key) =>
        typeof key === "string" && (ALL_CONFIG_PERMISSION_KEYS as readonly string[]).includes(key),
    )
  );
}

function isValidManagementScope(value: unknown): value is ManagementScope | null {
  if (value === null) {
    return true;
  }
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.level === "string" &&
    MANAGEMENT_SCOPE_LEVELS.has(candidate.level as ManagementScopeLevel) &&
    Array.isArray(candidate.storeIds) &&
    candidate.storeIds.every((id) => typeof id === "string")
  );
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
    !isValidManagementScope(payload.managementScope) ||
    !isValidConfigPermissions(payload.configPermissions) ||
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

/**
 * Entscheidet, ob das Session-Cookie mit dem `Secure`-Attribut gesetzt werden
 * soll -- ausgehend vom TATSAECHLICHEN Transportprotokoll der eingehenden
 * Anfrage, NICHT von `NODE_ENV`.
 *
 * Hintergrund (CI #23, Root Cause 4, mit ChatGPT abgestimmt am 2026-08-03):
 * `next start` (Produktions-Modus) setzt `NODE_ENV=production` unabhaengig
 * davon, ob die Verbindung tatsaechlich per TLS erfolgt. In den Playwright-
 * E2E-Tests laeuft der Server im Produktions-Modus, die Tests verbinden sich
 * aber ueber reines HTTP zu `127.0.0.1`. Ein an `NODE_ENV` gekoppeltes
 * `Secure`-Attribut wuerde dort faelschlich gesetzt: Chromium akzeptiert das
 * dank seiner Loopback-Ausnahme trotzdem, WebKit (u.a. im
 * `tablet-ipad-landscape`-Projekt) verweigert das Senden eines Secure-Cookies
 * ueber eine unverschluesselte Verbindung jedoch strikt -- die Session ging
 * dadurch auf dem Tablet-Profil vollstaendig verloren.
 *
 * Zusaetzlich zum direkten Anfrageprotokoll wird `x-forwarded-proto`
 * ausgewertet, damit das Cookie auch hinter einem TLS-terminierenden
 * Reverse-Proxy (bei dem die interne Verbindung zum Node-Prozess selbst nur
 * HTTP ist) korrekt als Secure gilt. WICHTIG: `x-forwarded-proto` darf in
 * einem echten Deployment nur von einem vertrauenswuerdigen Reverse-Proxy
 * gesetzt werden -- dieser Dev-/Pilot-Mechanismus bleibt unabhaengig davon
 * ausdruecklich NICHT produktionsreif (siehe src/server/auth/errors.ts).
 */
export function resolveSecureCookieFlag(request: NextRequest): boolean {
  if (request.nextUrl.protocol === "https:") {
    return true;
  }
  const forwardedProto = request.headers
    .get("x-forwarded-proto")
    ?.split(",")[0]
    ?.trim()
    .toLowerCase();
  return forwardedProto === "https";
}
