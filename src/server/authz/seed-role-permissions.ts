/**
 * Zentrale, reine (kein DB-Zugriff) Zuordnung: welche Permission-Keys
 * erhaelt welche Seed-Rolle in `prisma/seed.ts`? Ausgelagert aus dem
 * imperativen Seed-Skript, damit die Phase-7-AP1-Korrektur (echter Bug,
 * ChatGPT-GO 2026-08-17: `sales_employee` verlor bislang faelschlich NICHT
 * die Management-Analytics-Rechte, `store_admin` bekam gar keine
 * Permission) durch einen Regressionstest abgesichert ist -- ein spaeterer
 * Seed-Lauf/eine spaetere Aenderung darf die Berechtigungen nicht wieder
 * falsch setzen (ChatGPT-Auflage, siehe PHASE_7_IMPLEMENTATION_PLAN.md
 * Abschnitt 3.1/4).
 *
 * Verbindliche Rollentabelle (ChatGPT, 2026-08-17):
 * sales_employee -> kein Management-Analytics, store_admin -> STORE,
 * company_management -> COMPANY, executive_management -> TENANT.
 */

export const SEED_ROLE_KEYS = [
  "sales_employee",
  "store_admin",
  "company_management",
  "executive_management",
] as const;

export type SeedRoleKey = (typeof SEED_ROLE_KEYS)[number];

/** Die drei Management-Analytics-Permission-Keys (siehe `prisma/seed.ts::seedGlobalCatalog()`). */
export const MANAGEMENT_ANALYTICS_PERMISSION_KEYS = [
  "analytics.view_store",
  "analytics.view_company",
  "analytics.view_tenant",
] as const;

/**
 * Liefert die Permission-Keys, die eine Seed-Rolle aus dem uebergebenen
 * globalen Permission-Katalog (`allPermissionKeys`) erhalten soll. Reine
 * Funktion, keine Seiteneffekte -- `prisma/seed.ts` fuehrt die eigentlichen
 * `RolePermission`-Inserts anhand des Rueckgabewerts aus.
 */
export function permissionKeysForSeedRole(
  roleKey: SeedRoleKey,
  allPermissionKeys: string[],
): string[] {
  switch (roleKey) {
    case "sales_employee":
      // Alle Permissions AUSSER den drei Management-Analytics-Rechten --
      // ein normaler Verkaufsberater darf keine Management-Sicht sehen.
      return allPermissionKeys.filter(
        (key) => !(MANAGEMENT_ANALYTICS_PERMISSION_KEYS as readonly string[]).includes(key),
      );
    case "store_admin":
      return allPermissionKeys.filter((key) => key === "analytics.view_store");
    case "company_management":
      return allPermissionKeys.filter((key) => key === "analytics.view_company");
    case "executive_management":
      return allPermissionKeys.filter((key) => key === "analytics.view_tenant");
    default: {
      const exhaustiveCheck: never = roleKey;
      throw new Error(`Unbekannter Seed-Rollen-Key: ${String(exhaustiveCheck)}`);
    }
  }
}
