import { describe, expect, it } from "vitest";
import {
  ManagementAccessDeniedError,
  resolveAuthorizedStoreFilter,
  resolveAuthorizedStoreIds,
} from "@/server/analytics/management-authz";
import type { ManagementScope } from "@/server/authz/management-scope";

/**
 * Unit-Tests fuer den reinen Teil des Analytics-Authorization-Layers (Phase 7
 * AP2, siehe PHASE_7_IMPLEMENTATION_PLAN.md Abschnitt 5). Deckt den von
 * ChatGPT vorgegebenen zentralen Pruefpunkt ab: ein angefragter Filter darf
 * den autorisierten Scope nur EINSCHRAENKEN, nie erweitern. Die zusaetzliche
 * `employeeId`-DB-Pruefung (in `resolveAuthorizedStoreFilter()`) wird in
 * AP7 durch Integrationstests gegen Seed-Fixtures abgedeckt, da sie einen
 * aktiven TenantContext/DB-Zugriff benoetigt.
 */
describe("resolveAuthorizedStoreIds", () => {
  it("wirft ManagementAccessDeniedError bei null-Scope (deny-by-default)", () => {
    expect(() => resolveAuthorizedStoreIds(null)).toThrow(ManagementAccessDeniedError);
  });

  it("liefert den vollen Scope, wenn kein storeId angefragt wird", () => {
    const scope: ManagementScope = { level: "COMPANY", storeIds: ["store-1", "store-2"] };
    expect(resolveAuthorizedStoreIds(scope)).toEqual(["store-1", "store-2"]);
  });

  it("schraenkt auf die angefragte Filiale ein, wenn sie innerhalb des Scopes liegt", () => {
    const scope: ManagementScope = { level: "COMPANY", storeIds: ["store-1", "store-2"] };
    expect(resolveAuthorizedStoreIds(scope, "store-2")).toEqual(["store-2"]);
  });

  it("wirft ManagementAccessDeniedError bei einer Filiale ausserhalb des Scopes (IDOR-Schutz)", () => {
    const scope: ManagementScope = { level: "STORE", storeIds: ["store-1"] };
    expect(() => resolveAuthorizedStoreIds(scope, "store-99")).toThrow(ManagementAccessDeniedError);
  });

  it("erweitert den Scope niemals ueber die angefragte Filiale hinaus", () => {
    const scope: ManagementScope = { level: "TENANT", storeIds: ["store-1", "store-2", "store-3"] };
    const result = resolveAuthorizedStoreIds(scope, "store-1");
    expect(result).toEqual(["store-1"]);
    expect(result).not.toContain("store-2");
    expect(result).not.toContain("store-3");
  });
});

describe("resolveAuthorizedStoreFilter (ohne employeeId-Filter, kein DB-Zugriff)", () => {
  it("liefert den vollen Scope ohne employeeId-Feld, wenn kein employeeId angefragt wird", async () => {
    const scope: ManagementScope = { level: "STORE", storeIds: ["store-1"] };
    const result = await resolveAuthorizedStoreFilter(scope);
    expect(result).toEqual({ storeIds: ["store-1"] });
  });

  it("wirft ManagementAccessDeniedError bei null-Scope, auch ohne employeeId-Filter", async () => {
    await expect(resolveAuthorizedStoreFilter(null)).rejects.toThrow(ManagementAccessDeniedError);
  });

  it("wirft ManagementAccessDeniedError bei angefragter Filiale ausserhalb des Scopes, bevor ein DB-Zugriff fuer employeeId erfolgen wuerde", async () => {
    const scope: ManagementScope = { level: "STORE", storeIds: ["store-1"] };
    await expect(resolveAuthorizedStoreFilter(scope, "store-99")).rejects.toThrow(
      ManagementAccessDeniedError,
    );
  });
});
