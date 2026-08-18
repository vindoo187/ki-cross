import { describe, expect, it } from "vitest";
import {
  MANAGEMENT_ANALYTICS_PERMISSION_KEYS,
  permissionKeysForSeedRole,
} from "@/server/authz/seed-role-permissions";
import { CONFIG_QUESTIONS_PERMISSION_KEYS } from "@/server/authz/config-permissions";

/**
 * Regressionstest fuer den Phase-7-AP1-Bugfix (ChatGPT-GO 2026-08-17):
 * `sales_employee` bekam zuvor pauschal ALLE Permissions inkl.
 * `analytics.view_tenant`, `store_admin` gar keine. Dieser Test sichert die
 * verbindliche Rollentabelle ab, damit ein spaeterer Seed-Lauf/eine
 * spaetere Aenderung die Berechtigungen nicht wieder falsch setzt (siehe
 * PHASE_7_IMPLEMENTATION_PLAN.md Abschnitt 3.1/4).
 *
 * Erweitert um Phase 8 AP2 (ChatGPT-GO 2026-08-18): dieselbe Absicherung
 * fuer die neuen config_editor/config_publisher-Rollen -- insbesondere,
 * dass `sales_employee` (und alle anderen bestehenden Rollen) die neuen
 * config.questions.*-Permissions NICHT automatisch ueber die "alle
 * Permissions AUSSER ..."-Regel erhalten (derselbe Fehlertyp wie der
 * urspruengliche Phase-7-AP1-Bug).
 */
describe("permissionKeysForSeedRole", () => {
  const allPermissionKeys = [
    "consultation.create",
    "consultation.view_own",
    "consultation.view_store",
    "deal.create",
    "deal.view_own",
    "deal.view_store",
    "analytics.view_store",
    "analytics.view_company",
    "analytics.view_tenant",
    "master_data.manage",
    "user.manage",
    "config.questions.view",
    "config.questions.edit",
    "config.questions.publish",
  ];

  it("sales_employee erhaelt KEINE der drei Management-Analytics-Permissions", () => {
    const granted = permissionKeysForSeedRole("sales_employee", allPermissionKeys);
    for (const managementKey of MANAGEMENT_ANALYTICS_PERMISSION_KEYS) {
      expect(granted).not.toContain(managementKey);
    }
  });

  it("sales_employee erhaelt KEINE der drei config.questions.*-Permissions", () => {
    const granted = permissionKeysForSeedRole("sales_employee", allPermissionKeys);
    for (const configKey of CONFIG_QUESTIONS_PERMISSION_KEYS) {
      expect(granted).not.toContain(configKey);
    }
  });

  it("sales_employee erhaelt weiterhin alle anderen Permissions", () => {
    const granted = permissionKeysForSeedRole("sales_employee", allPermissionKeys);
    const excludedKeys: readonly string[] = [
      ...MANAGEMENT_ANALYTICS_PERMISSION_KEYS,
      ...CONFIG_QUESTIONS_PERMISSION_KEYS,
    ];
    const expectedKeys = allPermissionKeys.filter((key) => !excludedKeys.includes(key));
    expect(granted.sort()).toEqual(expectedKeys.sort());
  });

  it("store_admin erhaelt genau analytics.view_store", () => {
    expect(permissionKeysForSeedRole("store_admin", allPermissionKeys)).toEqual([
      "analytics.view_store",
    ]);
  });

  it("company_management erhaelt genau analytics.view_company", () => {
    expect(permissionKeysForSeedRole("company_management", allPermissionKeys)).toEqual([
      "analytics.view_company",
    ]);
  });

  it("executive_management erhaelt genau analytics.view_tenant", () => {
    expect(permissionKeysForSeedRole("executive_management", allPermissionKeys)).toEqual([
      "analytics.view_tenant",
    ]);
  });

  it("config_editor erhaelt genau config.questions.view und .edit, NICHT .publish", () => {
    const granted = permissionKeysForSeedRole("config_editor", allPermissionKeys);
    expect(granted.sort()).toEqual(["config.questions.edit", "config.questions.view"]);
    expect(granted).not.toContain("config.questions.publish");
  });

  it("config_publisher erhaelt alle drei config.questions.*-Permissions", () => {
    const granted = permissionKeysForSeedRole("config_publisher", allPermissionKeys);
    expect(granted.sort()).toEqual([...CONFIG_QUESTIONS_PERMISSION_KEYS].sort());
  });

  it("liefert eine leere Liste, falls die relevante Permission im Katalog fehlt (kein Absturz)", () => {
    const reducedKeys = allPermissionKeys.filter((key) => key !== "analytics.view_store");
    expect(permissionKeysForSeedRole("store_admin", reducedKeys)).toEqual([]);
  });

  it("config_editor liefert eine leere Liste, falls die relevanten Permissions im Katalog fehlen", () => {
    const reducedKeys = allPermissionKeys.filter(
      (key) => !(CONFIG_QUESTIONS_PERMISSION_KEYS as readonly string[]).includes(key),
    );
    expect(permissionKeysForSeedRole("config_editor", reducedKeys)).toEqual([]);
  });
});
