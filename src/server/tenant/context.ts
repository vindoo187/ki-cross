/**
 * Request-gebundener Mandantenkontext (Tenant-Kontext).
 *
 * Nutzt Node.js `AsyncLocalStorage`, damit jede Anfrage (bzw. jede davon
 * abgeleitete asynchrone Aufrufkette) ihren eigenen isolierten Kontext
 * (Tenant, Benutzer, Mitarbeiter, Rollen) traegt, ohne dass dieser Kontext
 * manuell durch jede Funktionssignatur durchgereicht werden muss.
 *
 * WICHTIG: Dies ist KEINE eigenstaendige Sicherheitsgrenze. Der Kontext ist
 * nur die Informationsquelle fuer `withTenantScope()`
 * (siehe `src/server/tenant/scoped-client.ts`), welches die eigentliche
 * Durchsetzung der Mandantentrennung auf Anwendungsebene vornimmt. Die
 * primaere Sicherheitsgrenze bleibt die Datenbank selbst (siehe
 * mandantengebundene Fremdschluessel in `prisma/schema.prisma` und
 * docs/PRIVACY_AND_SECURITY.md, Abschnitt Mandantentrennung).
 */

import { AsyncLocalStorage } from "node:async_hooks";
import type { ManagementScope } from "../authz/management-scope";

export interface TenantContext {
  /** UUID des Mandanten (Tenant), an den dieser Request gebunden ist. */
  tenantId: string;
  /** UUID des authentifizierten Benutzers. */
  userId: string;
  /** Optionale UUID des zugehoerigen Mitarbeiter-Datensatzes. */
  employeeId?: string;
  /** Rollen des Benutzers (z. B. fuer zukuenftige Autorisierungspruefungen). */
  roles: string[];
  /**
   * Beim Login serverseitig aus den `RoleAssignment`-Zeilen aufgeloester
   * Management-Analytics-Scope (Phase 7), `null` falls keine
   * Management-Berechtigung besteht. Siehe
   * `src/server/authz/management-scope.ts` und
   * `src/server/analytics/management-authz.ts` (AP2) fuer die Durchsetzung.
   */
  managementScope: ManagementScope | null;
}

const storage = new AsyncLocalStorage<TenantContext>();

/**
 * Wird geworfen, wenn versucht wird, auf mandantengebundene Daten
 * zuzugreifen, ohne dass zuvor `runWithTenantContext()` aufgerufen wurde.
 */
export class MissingTenantContextError extends Error {
  constructor() {
    super(
      "Kein TenantContext vorhanden. Jeder mandantengebundene Datenzugriff MUSS innerhalb von runWithTenantContext() erfolgen.",
    );
    this.name = "MissingTenantContextError";
  }
}

/**
 * Fuehrt `fn` innerhalb eines neuen Tenant-Kontexts aus. Alle innerhalb von
 * `fn` (synchron oder asynchron, direkt oder ueber weitere Aufrufe) getaetigten
 * Aufrufe von `getTenantContext()`/`getTenantId()` liefern diesen Kontext.
 */
export function runWithTenantContext<T>(context: TenantContext, fn: () => T): T {
  return storage.run(context, fn);
}

/**
 * Liefert den aktuellen Tenant-Kontext oder `undefined`, falls keiner aktiv ist.
 * Fuer Stellen, an denen ein fehlender Kontext explizit erlaubt/behandelt wird.
 */
export function getOptionalTenantContext(): TenantContext | undefined {
  return storage.getStore();
}

/**
 * Liefert den aktuellen Tenant-Kontext.
 *
 * @throws {MissingTenantContextError} falls kein Kontext aktiv ist.
 */
export function getTenantContext(): TenantContext {
  const context = storage.getStore();
  if (!context) {
    throw new MissingTenantContextError();
  }
  return context;
}

/**
 * Kurzform fuer den haeufigsten Anwendungsfall: nur die Tenant-ID abrufen.
 *
 * @throws {MissingTenantContextError} falls kein Kontext aktiv ist.
 */
export function getTenantId(): string {
  return getTenantContext().tenantId;
}
