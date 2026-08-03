/**
 * Verbindet den Dev-Session-Mechanismus (`session.ts`) mit dem bestehenden
 * `TenantContext` (`src/server/tenant/context.ts`). Dies ist die einzige
 * Stelle, an der ein eingehender Next.js-Request in einen `TenantContext`
 * uebersetzt wird -- Route Handler rufen ausschliesslich
 * `withRequestTenantContext()` auf und duplizieren diese Logik nicht.
 */

import type { NextRequest } from "next/server";
import { runWithTenantContext, type TenantContext } from "../tenant/context";
import { MissingSessionError, InvalidSessionError } from "./errors";
import { SESSION_COOKIE_NAME, verifySessionToken, type SessionPayload } from "./session";

/**
 * Liest und verifiziert die Session aus dem Request-Cookie.
 * Liefert `null`, falls kein Cookie gesetzt ist (Aufrufer entscheidet, ob
 * das ein Fehler ist -- z. B. ist das fuer `GET /api/auth/session` kein Fehler).
 *
 * @throws {InvalidSessionError} falls ein Cookie vorhanden, aber ungueltig
 *   ist (falsche Signatur, abgelaufen, kaputtes Format).
 */
export function readSessionFromRequest(request: NextRequest): SessionPayload | null {
  const cookieValue = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (!cookieValue) {
    return null;
  }
  const payload = verifySessionToken(cookieValue);
  if (!payload) {
    throw new InvalidSessionError();
  }
  return payload;
}

/**
 * Uebersetzt einen verifizierten Session-Payload in den `TenantContext`-Shape.
 * Exportiert, damit `server-context.ts` (Server Components, liest aus
 * `next/headers` `cookies()` statt aus einem `NextRequest`) dieselbe Zuordnung
 * verwendet und sie nicht dupliziert.
 */
export function sessionToTenantContext(session: SessionPayload): TenantContext {
  return {
    tenantId: session.tenantId,
    userId: session.userId,
    employeeId: session.employeeId,
    roles: session.roles,
  };
}

/**
 * Fuehrt `fn` innerhalb des `TenantContext` aus, der sich aus der Session
 * des Requests ergibt.
 *
 * @throws {MissingSessionError} falls kein Session-Cookie vorhanden ist.
 * @throws {InvalidSessionError} falls das Cookie vorhanden, aber ungueltig ist.
 */
export async function withRequestTenantContext<T>(
  request: NextRequest,
  fn: (session: SessionPayload) => Promise<T>,
): Promise<T> {
  const session = readSessionFromRequest(request);
  if (!session) {
    throw new MissingSessionError();
  }
  return runWithTenantContext(sessionToTenantContext(session), () => fn(session));
}
