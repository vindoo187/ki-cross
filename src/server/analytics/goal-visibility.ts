/**
 * Phase 11 AP5 (RBAC-/Sichtbarkeits-Integration fuer Goals, siehe
 * PHASE_11_IMPLEMENTATION_PLAN.md Abschnitt 3, ChatGPT-GO 2026-08-22 nach
 * AP5-Designklaerung). Separater Read-Pfad fuer die Mitarbeiter-/
 * Management-SICHTBARKEIT von `Goal`s -- ausdruecklich GETRENNT von
 * `goal-admin.ts::listGoals()`, das der tenantweite Admin-/Config-Pfad
 * bleibt (`config.goals.*`-Permission, keine Sichtbarkeitseinschraenkung,
 * unveraendert seit AP2/AP3). Diese Datei fuehrt KEINE neue
 * Rollen-/Permission-Architektur ein und interpretiert `ManagementScope`
 * nicht neu -- `resolveAuthorizedStoreFilter()` (Phase 7,
 * `management-authz.ts`) bleibt die EINZIGE Quelle fuer die autorisierte
 * Store-/Mitarbeiter-Menge.
 *
 * Architektur (ChatGPT-Vorgabe, woertlich):
 *   Admin-CRUD            -> goal-admin.ts       -> config.goals.*
 *   Mitarbeiter-/Mgmt-Read -> goal-visibility.ts -> ManagementScope/Employee-Context -> computeGoalProgress()
 *
 * VERBINDLICHE SICHTBARKEITSREGELN (ChatGPT, 2026-08-22):
 * - Mitarbeiter: AUSSCHLIESSLICH das eigene `scopeType=EMPLOYEE`-Goal
 *   (`scopeId` == eigene `employeeId` aus dem `TenantContext` -- NIEMALS aus
 *   einem Request-Parameter, siehe `listVisibleGoalsForEmployee()`).
 * - Management (`listVisibleGoalsForManagement()`), je nach `Goal.scopeType`:
 *     STORE    -> sichtbar, wenn `goal.scopeId` (die Store-ID) in
 *                 `authorizedStoreIds` enthalten ist.
 *     COMPANY  -> sichtbar, wenn ALLE Stores dieser Company vollstaendig in
 *                 `authorizedStoreIds` enthalten sind (Subset-Prinzip -- ein
 *                 Manager mit nur zwei von vier Filialen einer Company darf
 *                 das Company-Ziel NICHT sehen, das wuerde Informationen
 *                 ausserhalb seines Scopes offenlegen).
 *     TENANT   -> sichtbar, wenn `authorizedStoreIds` ALLE Stores des
 *                 Mandanten abdeckt (NICHT `scope.level === "TENANT"` allein
 *                 pruefen -- ein Company-Manager, der zufaellig alle Stores
 *                 seiner Company autorisiert hat, deckt dadurch nicht
 *                 automatisch den gesamten Mandanten ab, falls weitere
 *                 Companies existieren).
 *     EMPLOYEE -> sichtbar, wenn der Mitarbeiter (`goal.scopeId`) einem
 *                 autorisierten Store angehoert (`employee.storeId` in
 *                 `authorizedStoreIds`). Management DARF individuelle
 *                 Mitarbeiterziele sehen (ChatGPTs ausdrueckliche
 *                 Entscheidung) -- das ist keine Umkehr der
 *                 Mitarbeiter-Sichtbarkeitsregel oben, sondern ergaenzend:
 *                 Mitarbeiter sehen NUR ihr eigenes Ziel, Management sieht
 *                 Ziele (inkl. Mitarbeiterziele) INNERHALB seines Scopes.
 * - Tenant-Isolation gilt IMMER zuerst und strukturell: alle Abfragen laufen
 *   ueber den tenant-gescopten `db`-Client (siehe `scoped-client.ts`) -- ein
 *   Goal eines fremden Mandanten kann durch keine nachgelagerte
 *   Scope-Pruefung sichtbar werden.
 *
 * `resolveGoalKpiScopeFilter()` ist die in `goal-progress.ts` (AP4) bewusst
 * ausgelagerte Scope-Aufloesung: sie bildet `Goal.scopeType`/`scopeId` auf
 * den `GoalProgressScopeFilter` ab, den `computeGoalProgress()` fuer die
 * KPI-Aggregation braucht (WELCHE Deals/Beratungen zaehlen als "Ist" fuer
 * dieses Goal) -- unabhaengig davon, WER das Goal sehen darf (das regeln die
 * beiden `listVisibleGoalsFor*()`-Funktionen oben). Beide Aufloesungen sind
 * bewusst getrennt: Sichtbarkeit (wer darf sehen) und KPI-Scope (was zaehlt
 * als Ist) sind unterschiedliche Fragen, auch wenn beide von `Goal.scopeType`
 * ausgehen.
 */

import { db } from "../db/client";
import { getTenantContext } from "../tenant/context";
import type { ManagementScope } from "../authz/management-scope";
import { resolveAuthorizedStoreFilter } from "./management-authz";
import { listGoals, type GoalSummary } from "../admin/goal-admin";
import type { GoalProgressScopeFilter } from "./goal-progress";

// ---------------------------------------------------------------------------
// 1. Mitarbeiter-Sichtbarkeit -- ausschliesslich das eigene EMPLOYEE-Goal
// ---------------------------------------------------------------------------

/**
 * Liefert ausschliesslich das/die `Goal`(s) mit `scopeType=EMPLOYEE` und
 * `scopeId` == der eigenen `employeeId` aus dem aktuellen `TenantContext`.
 * Die `employeeId` kommt STRUKTURELL nie aus einem Request-Parameter --
 * diese Funktion nimmt bewusst keinen `employeeId`-Parameter entgegen
 * (ChatGPTs ausdrueckliche Sicherheitsauflage fuer AP5).
 *
 * Liefert eine leere Liste (kein Fehler), wenn der aktuelle Benutzer keiner
 * `Employee`-Zeile zugeordnet ist (z. B. ein reiner Management-/Admin-Account
 * ohne `employeeId`) -- analog dem Deny-by-default-Prinzip aus Phase 7.
 */
export async function listVisibleGoalsForEmployee(): Promise<GoalSummary[]> {
  const { employeeId } = getTenantContext();
  if (!employeeId) {
    return [];
  }
  const goals = await listGoals();
  return goals.filter((goal) => goal.scopeType === "EMPLOYEE" && goal.scopeId === employeeId);
}

// ---------------------------------------------------------------------------
// 2. Management-Sichtbarkeit -- vier verbindliche Regeln je scopeType
// ---------------------------------------------------------------------------

/**
 * Prueft, ob ALLE Stores der angegebenen Company (tenant-gescopt) in
 * `authorizedStoreIds` enthalten sind. Eine Company OHNE Stores liefert
 * bewusst `false` (Deny-by-default -- ein "leeres, aber gueltiges" Subset
 * waere von einem echten Sichtbarkeits-Fall nicht mehr unterscheidbar,
 * analog `deriveManagementScope()` in `management-scope.ts`).
 */
async function isCompanyFullyAuthorized(
  companyId: string,
  authorizedStoreIds: readonly string[],
): Promise<boolean> {
  const stores = await db.store.findMany({ where: { companyId }, select: { id: true } });
  if (stores.length === 0) {
    return false;
  }
  const authorized = new Set(authorizedStoreIds);
  return stores.every((store) => authorized.has(store.id));
}

/**
 * Prueft, ob `authorizedStoreIds` den GESAMTEN Mandanten abdeckt (alle
 * `Store`-Zeilen des aktuellen Tenant). Bewusst NICHT ueber
 * `managementScope.level === "TENANT"` geprueft (ChatGPTs ausdrueckliche
 * Korrektur): ein Company-Manager, dessen autorisierte Stores zufaellig alle
 * Stores SEINER Company abdecken, deckt dadurch nicht automatisch weitere
 * Companies desselben Mandanten ab.
 */
async function isEntireTenantAuthorized(authorizedStoreIds: readonly string[]): Promise<boolean> {
  const stores = await db.store.findMany({ select: { id: true } });
  if (stores.length === 0) {
    return false;
  }
  const authorized = new Set(authorizedStoreIds);
  return stores.every((store) => authorized.has(store.id));
}

/**
 * Prueft, ob der Mitarbeiter (`employeeId`, tenant-gescopt) einem
 * autorisierten Store angehoert. Ein nicht (mehr) existierender oder zu
 * einem fremden Mandanten gehoerender Mitarbeiter liefert `false` (0 Treffer
 * ueber den tenant-gescopten `db`-Client, analog `resolveAuthorizedStoreFilter()`).
 */
async function isEmployeeStoreAuthorized(
  employeeId: string,
  authorizedStoreIds: readonly string[],
): Promise<boolean> {
  const employee = await db.employee.findUnique({
    where: { id: employeeId },
    select: { storeId: true },
  });
  if (!employee) {
    return false;
  }
  return authorizedStoreIds.includes(employee.storeId);
}

/**
 * Wendet die vier verbindlichen Sichtbarkeitsregeln (siehe Modulkommentar)
 * auf ein einzelnes `Goal` an.
 */
async function isGoalVisibleToManagement(
  goal: Pick<GoalSummary, "scopeType" | "scopeId">,
  authorizedStoreIds: readonly string[],
): Promise<boolean> {
  switch (goal.scopeType) {
    case "STORE":
      return authorizedStoreIds.includes(goal.scopeId);
    case "COMPANY":
      return isCompanyFullyAuthorized(goal.scopeId, authorizedStoreIds);
    case "TENANT":
      return isEntireTenantAuthorized(authorizedStoreIds);
    case "EMPLOYEE":
      return isEmployeeStoreAuthorized(goal.scopeId, authorizedStoreIds);
    default:
      // Unbekannter/zukuenftiger scopeType -- Deny-by-default statt eines
      // stillschweigenden "sichtbar".
      return false;
  }
}

/**
 * Liefert alle `Goal`s, die fuer den uebergebenen Management-Scope sichtbar
 * sind (siehe Modulkommentar fuer die vier Regeln je `scopeType`).
 *
 * `resolveAuthorizedStoreFilter()` ist die EINZIGE Quelle fuer die
 * autorisierte Store-/Mitarbeiter-Menge -- identisches IDOR-Schutzmuster wie
 * die bestehende Management-KPI-Route (Phase 7 AP2): ein angefragter
 * `requestedStoreId`/`requestedEmployeeId` darf den Scope nur einschraenken,
 * nie erweitern (wirft `ManagementAccessDeniedError` bei einem Versuch,
 * ausserhalb des Scopes zu filtern).
 *
 * Ist ein `requestedEmployeeId` (nach Autorisierungspruefung) gesetzt, wird
 * zusaetzlich auf EMPLOYEE-Goals genau dieses Mitarbeiters eingeschraenkt --
 * die Store-Autorisierungspruefung selbst bleibt unveraendert (kein Fall,
 * bei dem eine engere Store-Auswahl eine Bewertung ueber die vier Regeln
 * hinaus veraendert).
 */
export async function listVisibleGoalsForManagement(
  scope: ManagementScope | null,
  requestedStoreId?: string,
  requestedEmployeeId?: string,
): Promise<GoalSummary[]> {
  const authorized = await resolveAuthorizedStoreFilter(
    scope,
    requestedStoreId,
    requestedEmployeeId,
  );
  const goals = await listGoals();

  const visible: GoalSummary[] = [];
  for (const goal of goals) {
    if (
      authorized.employeeId &&
      goal.scopeType === "EMPLOYEE" &&
      goal.scopeId !== authorized.employeeId
    ) {
      continue;
    }
    if (await isGoalVisibleToManagement(goal, authorized.storeIds)) {
      visible.push(goal);
    }
  }
  return visible;
}

// ---------------------------------------------------------------------------
// 3. KPI-Scope-Aufloesung fuer computeGoalProgress() (AP4-Nachtrag)
// ---------------------------------------------------------------------------

/**
 * Bildet `Goal.scopeType`/`scopeId` auf den `GoalProgressScopeFilter` ab, den
 * `computeGoalProgress()` (`goal-progress.ts`, AP4) fuer die KPI-Aggregation
 * benoetigt -- d. h. WELCHE Deals/Beratungen als "Ist" fuer dieses Goal
 * zaehlen. Bewusst UNABHAENGIG von der Sichtbarkeitspruefung oben (siehe
 * Modulkommentar): diese Funktion beantwortet "was zaehlt als Ist", nicht
 * "wer darf das Goal sehen".
 *
 * - TENANT   -> kein Filter (der gesamte Mandant zaehlt -- `db` ist ohnehin
 *               tenant-gescopt, ein leeres `{}` reicht).
 * - COMPANY  -> `storeIds` = alle Stores dieser Company.
 * - STORE    -> `storeId` = die Store-ID selbst.
 * - EMPLOYEE -> `employeeId` = die Mitarbeiter-ID selbst.
 */
export async function resolveGoalKpiScopeFilter(
  goal: Pick<GoalSummary, "scopeType" | "scopeId">,
): Promise<GoalProgressScopeFilter> {
  switch (goal.scopeType) {
    case "TENANT":
      return {};
    case "COMPANY": {
      const stores = await db.store.findMany({
        where: { companyId: goal.scopeId },
        select: { id: true },
      });
      return { storeIds: stores.map((store) => store.id) };
    }
    case "STORE":
      return { storeId: goal.scopeId };
    case "EMPLOYEE":
      return { employeeId: goal.scopeId };
    default:
      throw new Error(`Unbekannter Goal-scopeType: ${String(goal.scopeType)}`);
  }
}
