/**
 * Rein lesende Komfortfunktion fuer den Scope-Auswahl-Picker der Campaign-
 * Admin-UI (Phase 13 AP6, siehe PHASE_13_IMPLEMENTATION_PLAN.md Abschnitt 3,
 * ChatGPT-GO 2026-08-30). Analog `goal-scope-options.ts` (Phase 11 AP6),
 * aber auf `CampaignScopeType = TENANT | STORE` beschraenkt (siehe
 * `campaign-schemas.ts`) -- Campaigns kennen (anders als Goals) keine
 * COMPANY-/EMPLOYEE-Scopes.
 *
 * SICHERHEITSHINWEIS (identisches Prinzip wie `goal-scope-options.ts`):
 * diese Funktion ist AUSSCHLIESSLICH eine Komfort-/Anzeigefunktion fuer das
 * Formular. Die fachliche Sicherheitspruefung, ob eine vom Client gesendete
 * `scopeId` tatsaechlich zum aktuellen Mandanten gehoert, bleibt WEITERHIN
 * allein `validateScopeId()` in `campaign-admin.ts` vorbehalten -- eine
 * manipulierte `scopeId` aus dem Browser, die NICHT aus dieser Liste
 * stammt, muss dort genauso sicher abgefangen werden wie bisher. Diese
 * Datei trifft keine Sicherheitsentscheidung, sondern nutzt lediglich den
 * tenant-gescopten `db`-Client, der jedes `where` automatisch um die
 * `tenantId` des aktuellen `TenantContext` ergaenzt -- dadurch koennen
 * strukturell nur Entitaeten DES AKTUELLEN Mandanten in der Ergebnisliste
 * auftauchen (kein Cross-Tenant-Leck ueber den Picker).
 */

import { db } from "../db/client";
import { getTenantContext } from "../tenant/context";

export type CampaignScopeType = "TENANT" | "STORE";

export interface CampaignScopeOption {
  id: string;
  name: string;
}

/**
 * `TENANT` liefert bewusst KEINE Datenbankabfrage der Store-Tabelle --
 * die einzige gueltige `scopeId` fuer `scopeType: "TENANT"` ist die
 * `tenantId` des aktuellen Mandanten selbst (siehe `validateScopeId()` in
 * `campaign-admin.ts`), das Formular soll diese daher vorbelegt und nicht
 * editierbar anzeigen (identisches Muster wie `listGoalScopeOptions()`).
 */
export async function listCampaignScopeOptions(
  scopeType: CampaignScopeType,
): Promise<CampaignScopeOption[]> {
  const { tenantId } = getTenantContext();

  switch (scopeType) {
    case "TENANT": {
      const tenant = await db.tenant.findUnique({
        where: { id: tenantId },
        select: { id: true, name: true },
      });
      return tenant ? [{ id: tenant.id, name: tenant.name }] : [];
    }
    case "STORE": {
      const stores = await db.store.findMany({
        select: { id: true, name: true },
        orderBy: { name: "asc" },
      });
      return stores;
    }
    default: {
      const exhaustiveCheck: never = scopeType;
      throw new Error(`Unbekannter CampaignScopeType: ${String(exhaustiveCheck)}`);
    }
  }
}
