import { describe, expect, it } from "vitest";
import {
  MANAGEMENT_ANALYTICS_PERMISSION_KEYS,
  permissionKeysForSeedRole,
} from "@/server/authz/seed-role-permissions";

/**
 * Regressionstest fuer den Phase-7-AP1-Bugfix (ChatGPT-GO 2026-08-17):
 * `sales_employee` bekam zuvor pauschal ALLE Permissions inkl.
 * `analytics.view_tenant`, `store_admin` gar keine. Dieser Test sichert die
 * verbindliche Rollentabelle ab, damit ein spaeterer Seed-Lauf/eine
 * spaetere Aenderung die Berechtigungen nicht wieder falsch setzt (siehe
 * PHASE_7_IMPLEMENTATION_PLAN.md Abschnitt 3.1/4).
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
  ];

  it("sales_employee erhaelt KEINE der drei Management-Analytics-Permissions", () => {
    const granted = permissionKeysForSeedRole("sales_employee", allPermissionKeys);
    for (const managementKey of MANAGEMENT_ANALYTICS_PERMISSION_KEYS) {
      expect(granted).not.toContain(managementKey);
    }
  });

  it("sales_employee erhaelt weiterhin alle anderen Permissions", () => {
    const granted = permissionKeysForSeedRole("sales_employee", allPermissionKeys);
    const nonManagementKeys = allPermissionKeys.filter(
      (key) => !(MANAGEMENT_ANALYTICS_PERMISSION_KEYS as readonly string[]).includes(key),
    );
    expect(granted.sort()).toEqual(nonManagementKeys.sort());
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

  it("liefert eine leere Liste, falls die relevante Permission im Katalog fehlt (kein Absturz)", () => {
    const reducedKeys = allPermissionKeys.filter((key) => key !== "analytics.view_store");
    expect(permissionKeysForSeedRole("store_admin", reducedKeys)).toEqual([]);
  });
});
