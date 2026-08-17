/**
 * Analytics Authorization Layer (Phase 7 AP2, siehe
 * PHASE_7_IMPLEMENTATION_PLAN.md Abschnitt 3.3/5). `resolveAuthorizedStoreFilter()`
 * ist die EINZIGE erlaubte Quelle fuer den Store-Filter, den die
 * Management-KPI-Funktionen (`src/server/analytics/kpis.ts`) erhalten -- kein
 * Codepfad darf `getDealKpi()`/`getConsultationVolumeKpi()`/
 * `getRecommendationOutcomeKpi()` mit einem ungeprueften Store-Filter
 * aufrufen (Autorisierung-VOR-Aggregation-Leitplanke, ChatGPT verbindlich).
 *
 * IDOR-Schutz (ChatGPT, zentraler Pruefpunkt fuer AP2, woertlich): ein vom
 * Client angefragter `storeId`-/`employeeId`-Filter darf den bereits durch
 * `managementScope` autorisierten Datenbereich NUR EINSCHRAENKEN, niemals
 * erweitern. Ein Zugriffsversuch ausserhalb des Scopes wirft
 * `ManagementAccessDeniedError` -- es wird bewusst KEIN leeres Ergebnis
 * zurueckgegeben, das einen echten "0 Datensaetze im erlaubten Scope"-Fall
 * verschleiern wuerde (siehe Plan Abschnitt 5, Testhinweis).
 *
 * Pure-Logic-Module-Konvention (wie `src/server/authz/management-scope.ts`):
 * die reine Scope-Pruefung (`resolveAuthorizedStoreIds()`) ist ohne
 * DB-Zugriff testbar; nur die zusaetzliche `employeeId`-Pruefung braucht
 * einen DB-Zugriff (Mitarbeiter-Filiale nachschlagen) und ist daher als
 * duenner, async Wrapper (`resolveAuthorizedStoreFilter()`) ausgelagert.
 */

import { db } from "../db/client";
import type { ManagementScope } from "../authz/management-scope";

export class ManagementAccessDeniedError extends Error {
  constructor(message = "Kein Zugriff auf Management-Analytics fuer den angefragten Scope.") {
    super(message);
    this.name = new.target.name;
  }
}

export interface AuthorizedManagementFilter {
  /** Die tatsaechlich autorisierte Store-ID-Menge -- niemals leer, niemals ueber den Scope hinaus erweitert. */
  storeIds: string[];
  /** Nur gesetzt, wenn ein `employeeId`-Filter angefragt UND als innerhalb des Scopes liegend verifiziert wurde. */
  employeeId?: string;
}

/**
 * Reine Pruefung (kein DB-Zugriff): validiert einen optionalen, vom Client
 * angefragten `storeId`-Filter gegen den bereits serverseitig aufgeloesten
 * `managementScope` und liefert die tatsaechlich zulaessige Store-ID-Menge.
 *
 * - `scope === null` (keine Management-Berechtigung) -> immer Fehler
 *   (deny-by-default, konsistent mit `deriveManagementScope()`).
 * - Kein angefragter `storeId` -> der volle autorisierte Scope gilt.
 * - Angefragter `storeId` ausserhalb des Scopes -> Fehler (IDOR-Schutz: der
 *   Request darf den Scope nur einschraenken, nie erweitern).
 * - Angefragter `storeId` innerhalb des Scopes -> Einschraenkung auf genau
 *   diese eine Filiale.
 */
export function resolveAuthorizedStoreIds(
  scope: ManagementScope | null,
  requestedStoreId?: string,
): string[] {
  if (!scope) {
    throw new ManagementAccessDeniedError();
  }
  if (!requestedStoreId) {
    return scope.storeIds;
  }
  if (!scope.storeIds.includes(requestedStoreId)) {
    throw new ManagementAccessDeniedError(
      `Filiale "${requestedStoreId}" liegt ausserhalb des autorisierten Management-Scopes.`,
    );
  }
  return [requestedStoreId];
}

/**
 * Einzige erlaubte Quelle fuer den Store-/Mitarbeiter-Filter, den
 * Management-KPI-Funktionen erhalten. Muss innerhalb eines aktiven
 * `TenantContext` aufgerufen werden (nutzt den mandantengescopten `db`-Client
 * fuer die `employeeId`-Pruefung).
 *
 * Ablauf: zuerst wird `requestedStoreId` rein gegen den Scope geprueft
 * (`resolveAuthorizedStoreIds()`); danach wird, falls `requestedEmployeeId`
 * angefragt ist, dessen Filiale nachgeschlagen und ebenfalls gegen die
 * (ggf. bereits auf `requestedStoreId` eingeschraenkte) autorisierte
 * Store-Menge geprueft. Ein nicht gefundener oder ausserhalb des Scopes
 * liegender Mitarbeiter fuehrt zum selben Fehler wie eine fremde Filiale --
 * ein Angreifer kann so nicht zwischen "existiert nicht" und "keine
 * Berechtigung" unterscheiden (kein Information-Leak über die Fehlermeldung
 * hinaus, die ohnehin keine Existenzaussage macht).
 *
 * @throws {ManagementAccessDeniedError} bei fehlendem Scope, Filiale
 *   ausserhalb des Scopes, oder Mitarbeiter ausserhalb des Scopes/nicht
 *   gefunden.
 */
export async function resolveAuthorizedStoreFilter(
  scope: ManagementScope | null,
  requestedStoreId?: string,
  requestedEmployeeId?: string,
): Promise<AuthorizedManagementFilter> {
  const storeIds = resolveAuthorizedStoreIds(scope, requestedStoreId);

  if (!requestedEmployeeId) {
    return { storeIds };
  }

  const employee = await db.employee.findUnique({
    where: { id: requestedEmployeeId },
    select: { storeId: true },
  });

  if (!employee || !storeIds.includes(employee.storeId)) {
    throw new ManagementAccessDeniedError(
      `Mitarbeiter "${requestedEmployeeId}" liegt ausserhalb des autorisierten Management-Scopes.`,
    );
  }

  return { storeIds, employeeId: requestedEmployeeId };
}
