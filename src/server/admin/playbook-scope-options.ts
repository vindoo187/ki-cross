/**
 * Rein lesende Komfortfunktion fuer den Scope-Auswahl-Picker der Playbook-
 * Admin-UI (Phase 14 AP6, siehe project_ki_cross_phase14_ap5_status.md,
 * ChatGPT-GO 2026-08-31). Analog `campaign-scope-options.ts` (Phase 13
 * AP6) -- `PlaybookScopeType = TENANT | STORE` (siehe `playbook-schemas.ts`),
 * identisches Muster wie bei Campaigns (kein COMPANY-/EMPLOYEE-Scope).
 *
 * SICHERHEITSHINWEIS (identisches Prinzip wie `campaign-scope-options.ts`):
 * diese Funktion ist AUSSCHLIESSLICH eine Komfort-/Anzeigefunktion fuer das
 * Formular. Die fachliche Sicherheitspruefung, ob eine vom Client gesendete
 * `scopeId` tatsaechlich zum aktuellen Mandanten gehoert, bleibt WEITERHIN
 * allein `validateScopeId()` in `playbook-admin.ts` vorbehalten -- eine
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

export type PlaybookScopeType = "TENANT" | "STORE";

export interface PlaybookScopeOption {
  id: string;
  name: string;
}

/**
 * `TENANT` liefert bewusst KEINE Datenbankabfrage der Store-Tabelle --
 * die einzige gueltige `scopeId` fuer `scopeType: "TENANT"` ist die
 * `tenantId` des aktuellen Mandanten selbst (siehe `validateScopeId()` in
 * `playbook-admin.ts`), das Formular soll diese daher vorbelegt und nicht
 * editierbar anzeigen (identisches Muster wie `listCampaignScopeOptions()`).
 */
export async function listPlaybookScopeOptions(
  scopeType: PlaybookScopeType,
): Promise<PlaybookScopeOption[]> {
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
      throw new Error(`Unbekannter PlaybookScopeType: ${String(exhaustiveCheck)}`);
    }
  }
}
