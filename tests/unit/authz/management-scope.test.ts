import { describe, expect, it } from "vitest";
import {
  deriveManagementScope,
  type ManagementScopeCandidate,
} from "@/server/authz/management-scope";

/**
 * Regressionstests fuer die reine Auswahllogik aus Phase 7 AP1 (siehe
 * PHASE_7_IMPLEMENTATION_PLAN.md Abschnitt 3.4/4). Deckt die von ChatGPT
 * verbindlich vorgegebenen Leitplanken ab: deny-by-default und die Semantik
 * bei kombinierten RoleAssignments (hoechste Stufe gewinnt, Union bei
 * gleicher Stufe).
 */
describe("deriveManagementScope", () => {
  it("liefert null (deny-by-default), wenn keine Kandidaten vorhanden sind", () => {
    expect(deriveManagementScope([])).toBeNull();
  });

  it("liefert null, wenn keine Zuweisung die zu ihrer Scope-Ebene passende Permission traegt", () => {
    const candidates: ManagementScopeCandidate[] = [
      { scopeType: "STORE", permissionKeys: ["consultation.create"], storeIds: ["store-1"] },
      { scopeType: "COMPANY", permissionKeys: ["deal.create"], storeIds: ["store-1", "store-2"] },
    ];
    expect(deriveManagementScope(candidates)).toBeNull();
  });

  it("liefert STORE-Scope mit der einen Filiale bei einer einzelnen STORE-Zuweisung", () => {
    const candidates: ManagementScopeCandidate[] = [
      { scopeType: "STORE", permissionKeys: ["analytics.view_store"], storeIds: ["store-1"] },
    ];
    expect(deriveManagementScope(candidates)).toEqual({ level: "STORE", storeIds: ["store-1"] });
  });

  it("liefert COMPANY-Scope mit allen Filialen der Company", () => {
    const candidates: ManagementScopeCandidate[] = [
      {
        scopeType: "COMPANY",
        permissionKeys: ["analytics.view_company"],
        storeIds: ["store-1", "store-2"],
      },
    ];
    expect(deriveManagementScope(candidates)).toEqual({
      level: "COMPANY",
      storeIds: ["store-1", "store-2"],
    });
  });

  it("liefert TENANT-Scope mit allen Filialen des Mandanten", () => {
    const candidates: ManagementScopeCandidate[] = [
      {
        scopeType: "TENANT",
        permissionKeys: ["analytics.view_tenant"],
        storeIds: ["store-1", "store-2", "store-3"],
      },
    ];
    expect(deriveManagementScope(candidates)).toEqual({
      level: "TENANT",
      storeIds: ["store-1", "store-2", "store-3"],
    });
  });

  it("kombinierte Zuweisungen: STORE + COMPANY -> die hoehere COMPANY-Stufe gewinnt", () => {
    const candidates: ManagementScopeCandidate[] = [
      { scopeType: "STORE", permissionKeys: ["analytics.view_store"], storeIds: ["store-1"] },
      {
        scopeType: "COMPANY",
        permissionKeys: ["analytics.view_company"],
        storeIds: ["store-1", "store-2"],
      },
    ];
    expect(deriveManagementScope(candidates)).toEqual({
      level: "COMPANY",
      storeIds: ["store-1", "store-2"],
    });
  });

  it("kombinierte Zuweisungen: COMPANY + TENANT -> die hoechste TENANT-Stufe gewinnt", () => {
    const candidates: ManagementScopeCandidate[] = [
      {
        scopeType: "COMPANY",
        permissionKeys: ["analytics.view_company"],
        storeIds: ["store-1", "store-2"],
      },
      {
        scopeType: "TENANT",
        permissionKeys: ["analytics.view_tenant"],
        storeIds: ["store-1", "store-2", "store-3"],
      },
    ];
    expect(deriveManagementScope(candidates)).toEqual({
      level: "TENANT",
      storeIds: ["store-1", "store-2", "store-3"],
    });
  });

  it("zwei Zuweisungen derselben Stufe (STORE): Union der Store-IDs, keine Duplikate", () => {
    const candidates: ManagementScopeCandidate[] = [
      { scopeType: "STORE", permissionKeys: ["analytics.view_store"], storeIds: ["store-1"] },
      { scopeType: "STORE", permissionKeys: ["analytics.view_store"], storeIds: ["store-2"] },
      { scopeType: "STORE", permissionKeys: ["analytics.view_store"], storeIds: ["store-1"] },
    ];
    const result = deriveManagementScope(candidates);
    expect(result?.level).toBe("STORE");
    expect(result?.storeIds.sort()).toEqual(["store-1", "store-2"]);
  });

  it("ignoriert eine STORE-Zuweisung ohne die passende Permission, wertet aber die qualifizierende COMPANY-Zuweisung", () => {
    const candidates: ManagementScopeCandidate[] = [
      { scopeType: "STORE", permissionKeys: ["consultation.view_store"], storeIds: ["store-1"] },
      {
        scopeType: "COMPANY",
        permissionKeys: ["analytics.view_company"],
        storeIds: ["store-1", "store-2"],
      },
    ];
    expect(deriveManagementScope(candidates)).toEqual({
      level: "COMPANY",
      storeIds: ["store-1", "store-2"],
    });
  });

  it("liefert null (deny-by-default), wenn die hoechste qualifizierende Stufe keine Store-IDs hat (z. B. Company ohne Filialen)", () => {
    const candidates: ManagementScopeCandidate[] = [
      { scopeType: "COMPANY", permissionKeys: ["analytics.view_company"], storeIds: [] },
    ];
    expect(deriveManagementScope(candidates)).toBeNull();
  });
});
