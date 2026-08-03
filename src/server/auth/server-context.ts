/**
 * Analog zu `request-context.ts`, aber fuer Next.js Server Components/Server
 * Actions, die keinen `NextRequest` erhalten, sondern ueber `next/headers`
 * `cookies()` auf die eingehenden Request-Cookies zugreifen. Wird bewusst als
 * eigene Datei gefuehrt (nicht in `request-context.ts` zusammengefasst), da
 * `next/headers` nur in Server-Component-/Server-Action-Kontexten importierbar
 * ist, nicht in Route Handlers, die stattdessen `NextRequest` erhalten.
 */

import { cookies } from "next/headers";
import { runWithTenantContext } from "../tenant/context";
import { MissingSessionError, InvalidSessionError } from "./errors";
import { SESSION_COOKIE_NAME, verifySessionToken, type SessionPayload } from "./session";
import { sessionToTenantContext } from "./request-context";

/**
 * Liest und verifiziert die Session aus den Request-Cookies der aktuellen
 * Server-Component-Anfrage.
 *
 * @throws {InvalidSessionError} falls ein Cookie vorhanden, aber ungueltig ist.
 */
export async function readSessionFromCookies(): Promise<SessionPayload | null> {
  const store = await cookies();
  const cookieValue = store.get(SESSION_COOKIE_NAME)?.value;
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
 * Wie `readSessionFromCookies()`, liefert aber bei jeder Ungueltigkeit
 * (kein Cookie ODER ungueltiges Cookie) `null` statt zu werfen -- fuer
 * Stellen, die nur "eingeloggt ja/nein" wissen wollen (z. B. Redirect-
 * Entscheidung), ohne den Fehlerfall gesondert zu behandeln.
 */
export async function getOptionalServerSession(): Promise<SessionPayload | null> {
  try {
    return await readSessionFromCookies();
  } catch {
    return null;
  }
}

/**
 * Fuehrt `fn` innerhalb des `TenantContext` aus, der sich aus der Session der
 * aktuellen Server-Component-Anfrage ergibt.
 *
 * @throws {MissingSessionError} falls kein Session-Cookie vorhanden ist.
 * @throws {InvalidSessionError} falls das Cookie vorhanden, aber ungueltig ist.
 */
export async function withServerSessionTenantContext<T>(
  fn: (session: SessionPayload) => Promise<T>,
): Promise<T> {
  const session = await readSessionFromCookies();
  if (!session) {
    throw new MissingSessionError();
  }
  return runWithTenantContext(sessionToTenantContext(session), () => fn(session));
}
