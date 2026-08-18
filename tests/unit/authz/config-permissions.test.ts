import { describe, expect, it } from "vitest";
import {
  CONFIG_QUESTIONS_PERMISSION_KEYS,
  ConfigAccessDeniedError,
  deriveConfigPermissions,
  requireConfigPermission,
  type ConfigPermissionCandidate,
} from "@/server/authz/config-permissions";

/**
 * Regressionstests fuer die reine Auswahllogik aus Phase 8 AP2 (siehe
 * PHASE_8_IMPLEMENTATION_PLAN.md Abschnitt 3.2/5). Deckt die von ChatGPT
 * verbindlich vorgegebenen Leitplanken ab: ausschliesslich TENANT-Scope
 * (kein "kuenstlicher Store-Scope"), deny-by-default, `publish` entsteht
 * nicht implizit aus `edit`.
 */
describe("deriveConfigPermissions", () => {
  it("liefert ein leeres Array (deny-by-default), wenn keine Kandidaten vorhanden sind", () => {
    expect(deriveConfigPermissions([])).toEqual([]);
  });

  it("liefert ein leeres Array fuer eine STORE-Zuweisung, selbst mit config.questions.*-Permissions", () => {
    const candidates: ConfigPermissionCandidate[] = [
      {
        scopeType: "STORE",
        permissionKeys: ["config.questions.view", "config.questions.edit"],
      },
    ];
    expect(deriveConfigPermissions(candidates)).toEqual([]);
  });

  it("liefert ein leeres Array fuer eine COMPANY-Zuweisung, selbst mit config.questions.*-Permissions", () => {
    const candidates: ConfigPermissionCandidate[] = [
      {
        scopeType: "COMPANY",
        permissionKeys: [...CONFIG_QUESTIONS_PERMISSION_KEYS],
      },
    ];
    expect(deriveConfigPermissions(candidates)).toEqual([]);
  });

  it("liefert genau view+edit fuer eine TENANT-Zuweisung mit config_editor-Permissions", () => {
    const candidates: ConfigPermissionCandidate[] = [
      {
        scopeType: "TENANT",
        permissionKeys: ["config.questions.view", "config.questions.edit"],
      },
    ];
    expect(deriveConfigPermissions(candidates).sort()).toEqual([
      "config.questions.edit",
      "config.questions.view",
    ]);
  });

  it("liefert alle drei Permissions fuer eine TENANT-Zuweisung mit config_publisher-Permissions", () => {
    const candidates: ConfigPermissionCandidate[] = [
      {
        scopeType: "TENANT",
        permissionKeys: [...CONFIG_QUESTIONS_PERMISSION_KEYS],
      },
    ];
    expect(deriveConfigPermissions(candidates).sort()).toEqual(
      [...CONFIG_QUESTIONS_PERMISSION_KEYS].sort(),
    );
  });

  it("ignoriert Permission-Keys, die nicht zum config.questions.*-Katalog gehoeren", () => {
    const candidates: ConfigPermissionCandidate[] = [
      {
        scopeType: "TENANT",
        permissionKeys: ["analytics.view_tenant", "config.questions.view"],
      },
    ];
    expect(deriveConfigPermissions(candidates)).toEqual(["config.questions.view"]);
  });

  it("vereinigt Permissions ueber mehrere TENANT-Zuweisungen (keine Duplikate)", () => {
    const candidates: ConfigPermissionCandidate[] = [
      { scopeType: "TENANT", permissionKeys: ["config.questions.view"] },
      { scopeType: "TENANT", permissionKeys: ["config.questions.view", "config.questions.edit"] },
    ];
    expect(deriveConfigPermissions(candidates).sort()).toEqual([
      "config.questions.edit",
      "config.questions.view",
    ]);
  });

  it("mischt STORE-/COMPANY-Rauschen mit einer qualifizierenden TENANT-Zuweisung korrekt (nur TENANT zaehlt)", () => {
    const candidates: ConfigPermissionCandidate[] = [
      { scopeType: "STORE", permissionKeys: [...CONFIG_QUESTIONS_PERMISSION_KEYS] },
      { scopeType: "TENANT", permissionKeys: ["config.questions.view"] },
    ];
    expect(deriveConfigPermissions(candidates)).toEqual(["config.questions.view"]);
  });
});

describe("requireConfigPermission", () => {
  it("wirft nicht, wenn die Session die geforderte Permission besitzt", () => {
    const session = { configPermissions: ["config.questions.view", "config.questions.edit"] };
    expect(() => requireConfigPermission(session as never, "config.questions.view")).not.toThrow();
  });

  it("wirft ConfigAccessDeniedError, wenn die Session die Permission NICHT besitzt", () => {
    const session = { configPermissions: ["config.questions.view", "config.questions.edit"] };
    expect(() => requireConfigPermission(session as never, "config.questions.publish")).toThrow(
      ConfigAccessDeniedError,
    );
  });

  it("wirft ConfigAccessDeniedError bei komplett leeren Config-Permissions (deny-by-default)", () => {
    const session = { configPermissions: [] };
    expect(() => requireConfigPermission(session as never, "config.questions.view")).toThrow(
      ConfigAccessDeniedError,
    );
  });

  it("config_editor-Fall: edit erlaubt, publish verweigert (publish entsteht nicht implizit aus edit)", () => {
    const editorSession = { configPermissions: ["config.questions.view", "config.questions.edit"] };
    expect(() =>
      requireConfigPermission(editorSession as never, "config.questions.edit"),
    ).not.toThrow();
    expect(() =>
      requireConfigPermission(editorSession as never, "config.questions.publish"),
    ).toThrow(ConfigAccessDeniedError);
  });
});
