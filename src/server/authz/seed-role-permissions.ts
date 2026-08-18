import { ALL_CONFIG_PERMISSION_KEYS } from "./config-permissions";

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
 *
 * Phase 8 AP2 (ChatGPT-GO 2026-08-18) erweitert diese Tabelle um zwei
 * Config-Rollen: config_editor -> config.questions.view+edit,
 * config_publisher -> config.questions.view+edit+publish. WICHTIG: die
 * `sales_employee`-Regel "alle Permissions AUSSER Management-Analytics"
 * muss die neuen `config.questions.*`-Keys ebenfalls ausschliessen, sonst
 * wuerde ein einfacher Verkaufsberater automatisch Config-Rechte bekommen,
 * sobald die Keys im globalen Katalog auftauchen -- derselbe Fehlertyp wie
 * der urspruengliche Phase-7-AP1-Bug, hier praeventiv vermieden.
 *
 * Phase 9 AP1 (ChatGPT-GO 2026-08-18) erweitert config_editor/
 * config_publisher additiv um die neuen `config.rules.*`-Keys (keine neuen
 * Rollen, siehe PHASE_9_IMPLEMENTATION_PLAN.md Abschnitt 2.1):
 * config_editor -> zusaetzlich config.rules.view+edit, config_publisher ->
 * zusaetzlich config.rules.view+edit+publish. Dieselbe
 * `sales_employee`-Ausschlussregel gilt fuer `config.rules.*` genauso wie
 * fuer `config.questions.*`.
 */

export const SEED_ROLE_KEYS = [
  "sales_employee",
  "store_admin",
  "company_management",
  "executive_management",
  "config_editor",
  "config_publisher",
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
      // Alle Permissions AUSSER den drei Management-Analytics-Rechten UND
      // allen config.questions.*/config.rules.*-Rechten -- ein normaler
      // Verkaufsberater darf weder die Management-Sicht noch die
      // Fragen-/Regel-Administration sehen.
      return allPermissionKeys.filter(
        (key) =>
          !(MANAGEMENT_ANALYTICS_PERMISSION_KEYS as readonly string[]).includes(key) &&
          !(ALL_CONFIG_PERMISSION_KEYS as readonly string[]).includes(key),
      );
    case "store_admin":
      return allPermissionKeys.filter((key) => key === "analytics.view_store");
    case "company_management":
      return allPermissionKeys.filter((key) => key === "analytics.view_company");
    case "executive_management":
      return allPermissionKeys.filter((key) => key === "analytics.view_tenant");
    case "config_editor":
      return allPermissionKeys.filter(
        (key) =>
          key === "config.questions.view" ||
          key === "config.questions.edit" ||
          key === "config.rules.view" ||
          key === "config.rules.edit",
      );
    case "config_publisher":
      return allPermissionKeys.filter((key) =>
        (ALL_CONFIG_PERMISSION_KEYS as readonly string[]).includes(key),
      );
    default: {
      const exhaustiveCheck: never = roleKey;
      throw new Error(`Unbekannter Seed-Rollen-Key: ${String(exhaustiveCheck)}`);
    }
  }
}
