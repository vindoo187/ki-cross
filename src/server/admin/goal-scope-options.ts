/**
 * Rein lesende Komfortfunktion fuer den Scope-Auswahl-Picker der Goal-
 * Admin-UI (Phase 11 AP6, siehe PHASE_11_IMPLEMENTATION_PLAN.md Abschnitt 9,
 * ChatGPT-GO 2026-08-22 nach AP6-Discovery).
 *
 * BEWUSST EIN SEPARATES MODUL, NICHT TEIL DER MANAGEMENT-SCOPE-LOGIK
 * (ChatGPTs ausdrueckliche Vorgabe): `resolveAuthorizedStoreFilter()`/
 * `ManagementScope` (`src/server/analytics/management-authz.ts`) beantworten
 * die Frage "welche Stores/Employees darf DIESER Manager im Reporting
 * sehen" -- eine voellig andere Fragestellung als hier ("welche Companies/
 * Stores/Employees EXISTIEREN in diesem Tenant, damit ein Admin mit
 * `config.goals.edit` eine gueltige `scopeId` auswaehlen kann"). Eine
 * Vermischung wuerde `goal-scope-options.ts` faelschlich auf
 * Management-Scope-Berechtigungen einschraenken, obwohl `config.goals.*`
 * eine eigene, tenant-weite Administrationsberechtigung ist (siehe
 * `goal-admin.ts`-Modulkommentar).
 *
 * SICHERHEITSHINWEIS (ChatGPTs ausdrueckliche Auflage): Diese Funktion ist
 * AUSSCHLIESSLICH eine Komfort-/Anzeigefunktion fuer das Formular. Die
 * fachliche Sicherheitspruefung, ob eine vom Client gesendete `scopeId`
 * tatsaechlich zum aktuellen Mandanten gehoert, bleibt WEITERHIN allein
 * `validateScopeId()` in `goal-admin.ts` vorbehalten (aufgerufen aus
 * `createGoal()`) -- eine manipulierte `scopeId` aus dem Browser, die NICHT
 * aus dieser Liste stammt, muss dort genauso sicher abgefangen werden wie
 * bisher. Diese Datei selbst trifft keine Sicherheitsentscheidung, sondern
 * nutzt lediglich den tenant-gescopten `db`-Client (siehe
 * `src/server/tenant/scoped-client.ts`), der jedes `where` automatisch um
 * die `tenantId` des aktuellen `TenantContext` ergaenzt -- dadurch koennen
 * strukturell nur Entitaeten DES AKTUELLEN Mandanten in der Ergebnisliste
 * auftauchen (kein Cross-Tenant-Leck ueber den Picker).
 *
 * `EMPLOYEE`-Liste ist bewusst NICHT nach `employmentStatus` gefiltert --
 * `validateScopeId()` selbst filtert ebenfalls nicht danach (jede
 * `Employee`-Zeile des Tenants ist ein gueltiger Scope, siehe
 * `goal-admin.ts`), eine zusaetzliche Filterung hier waere eine eigene,
 * nicht angeforderte Scope-Entscheidung.
 */

import { db } from "../db/client";
import { getTenantContext } from "../tenant/context";

export type GoalScopeType = "TENANT" | "COMPANY" | "STORE" | "EMPLOYEE";

export interface GoalScopeOption {
  id: string;
  name: string;
}

/**
 * Liefert die fuer den Scope-Picker anzuzeigenden Optionen fuer den
 * uebergebenen `scopeType`, ausschliesslich fuer den aktuellen Mandanten
 * (`tenantId` wird bewusst NICHT als Parameter entgegengenommen, sondern
 * immer aus dem aktuellen `TenantContext` gelesen -- identisches Muster wie
 * `getTenantId()` in `goal-admin.ts`, verhindert eine versehentliche
 * Cross-Tenant-Abfrage durch einen falsch uebergebenen Parameter).
 *
 * `TENANT` liefert bewusst KEINE Datenbankabfrage -- die einzige gueltige
 * `scopeId` fuer `scopeType: "TENANT"` ist die `tenantId` des aktuellen
 * Mandanten selbst (siehe `validateScopeId()` in `goal-admin.ts`), das
 * Formular soll diese daher vorbelegt und nicht editierbar anzeigen.
 */
export async function listGoalScopeOptions(scopeType: GoalScopeType): Promise<GoalScopeOption[]> {
  const { tenantId } = getTenantContext();

  switch (scopeType) {
    case "TENANT": {
      const tenant = await db.tenant.findUnique({
        where: { id: tenantId },
        select: { id: true, name: true },
      });
      return tenant ? [{ id: tenant.id, name: tenant.name }] : [];
    }
    case "COMPANY": {
      const companies = await db.company.findMany({
        select: { id: true, name: true },
        orderBy: { name: "asc" },
      });
      return companies;
    }
    case "STORE": {
      const stores = await db.store.findMany({
        select: { id: true, name: true },
        orderBy: { name: "asc" },
      });
      return stores;
    }
    case "EMPLOYEE": {
      const employees = await db.employee.findMany({
        select: { id: true, displayName: true },
        orderBy: { displayName: "asc" },
      });
      return employees.map((e: { id: string; displayName: string }) => ({
        id: e.id,
        name: e.displayName,
      }));
    }
    default: {
      const exhaustiveCheck: never = scopeType;
      throw new Error(`Unbekannter GoalScopeType: ${String(exhaustiveCheck)}`);
    }
  }
}
