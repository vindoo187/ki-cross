import { describe, expect, it } from "vitest";
import {
  ALL_CONFIG_PERMISSION_KEYS,
  CONFIG_COMMISSIONS_PERMISSION_KEYS,
  CONFIG_GOALS_PERMISSION_KEYS,
  CONFIG_QUESTIONS_PERMISSION_KEYS,
  CONFIG_RULES_PERMISSION_KEYS,
  ConfigAccessDeniedError,
  deriveConfigPermissions,
  requireConfigPermission,
  type ConfigPermissionCandidate,
} from "@/server/authz/config-permissions";

/**
 * Regressionstests fuer die reine Auswahllogik aus Phase 8 AP2 (siehe
 * PHASE_8_IMPLEMENTATION_PLAN.md Abschnitt 3.2/5), erweitert um
 * `config.rules.*` in Phase 9 AP1 (ChatGPT-GO 2026-08-18, siehe
 * PHASE_9_IMPLEMENTATION_PLAN.md Abschnitt 2.1), um
 * `config.commissions.*` in Phase 10 AP1 (ChatGPT-GO 2026-08-21, siehe
 * PHASE_10_IMPLEMENTATION_PLAN.md Abschnitt 3) und um `config.goals.*` in
 * Phase 11 AP1 (ChatGPT finales GO 2026-08-22, siehe
 * PHASE_11_IMPLEMENTATION_PLAN.md Abschnitt 1 Punkt 7). Deckt die von
 * ChatGPT verbindlich vorgegebenen Leitplanken ab: ausschliesslich
 * TENANT-Scope (kein "kuenstlicher Store-Scope"), deny-by-default,
 * `publish` entsteht nicht implizit aus `edit` -- fuer ALLE VIER
 * Permission-Gruppen gleichermassen.
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

  it("liefert genau view+edit fuer eine TENANT-Zuweisung mit config.rules.*-Editor-Permissions (Phase 9 AP1)", () => {
    const candidates: ConfigPermissionCandidate[] = [
      {
        scopeType: "TENANT",
        permissionKeys: ["config.rules.view", "config.rules.edit"],
      },
    ];
    expect(deriveConfigPermissions(candidates).sort()).toEqual([
      "config.rules.edit",
      "config.rules.view",
    ]);
  });

  it("liefert alle zwoelf Permissions fuer eine TENANT-Zuweisung mit allen config_publisher-Rechten (Fragen + Regeln + Provisionsmodelle + Ziele)", () => {
    const candidates: ConfigPermissionCandidate[] = [
      { scopeType: "TENANT", permissionKeys: [...ALL_CONFIG_PERMISSION_KEYS] },
    ];
    expect(deriveConfigPermissions(candidates).sort()).toEqual(
      [...ALL_CONFIG_PERMISSION_KEYS].sort(),
    );
  });

  it("vereinigt config.questions.*- und config.rules.*-Permissions unabhaengig voneinander (kein implizites Bundling)", () => {
    const candidates: ConfigPermissionCandidate[] = [
      { scopeType: "TENANT", permissionKeys: ["config.questions.view", "config.rules.edit"] },
    ];
    expect(deriveConfigPermissions(candidates).sort()).toEqual([
      "config.questions.view",
      "config.rules.edit",
    ]);
  });

  it("liefert ein leeres Array fuer eine STORE-Zuweisung mit config.rules.*-Permissions", () => {
    const candidates: ConfigPermissionCandidate[] = [
      { scopeType: "STORE", permissionKeys: [...CONFIG_RULES_PERMISSION_KEYS] },
    ];
    expect(deriveConfigPermissions(candidates)).toEqual([]);
  });

  it("liefert genau view+edit fuer eine TENANT-Zuweisung mit config.commissions.*-Editor-Permissions (Phase 10 AP1)", () => {
    const candidates: ConfigPermissionCandidate[] = [
      {
        scopeType: "TENANT",
        permissionKeys: ["config.commissions.view", "config.commissions.edit"],
      },
    ];
    expect(deriveConfigPermissions(candidates).sort()).toEqual([
      "config.commissions.edit",
      "config.commissions.view",
    ]);
  });

  it("vereinigt config.rules.*- und config.commissions.*-Permissions unabhaengig voneinander (kein implizites Bundling, Phase 10 AP1)", () => {
    const candidates: ConfigPermissionCandidate[] = [
      { scopeType: "TENANT", permissionKeys: ["config.rules.view", "config.commissions.edit"] },
    ];
    expect(deriveConfigPermissions(candidates).sort()).toEqual([
      "config.commissions.edit",
      "config.rules.view",
    ]);
  });

  it("liefert ein leeres Array fuer eine STORE-Zuweisung mit config.commissions.*-Permissions (Phase 10 AP1)", () => {
    const candidates: ConfigPermissionCandidate[] = [
      { scopeType: "STORE", permissionKeys: [...CONFIG_COMMISSIONS_PERMISSION_KEYS] },
    ];
    expect(deriveConfigPermissions(candidates)).toEqual([]);
  });

  it("liefert genau view+edit fuer eine TENANT-Zuweisung mit config.goals.*-Editor-Permissions (Phase 11 AP1)", () => {
    const candidates: ConfigPermissionCandidate[] = [
      {
        scopeType: "TENANT",
        permissionKeys: ["config.goals.view", "config.goals.edit"],
      },
    ];
    expect(deriveConfigPermissions(candidates).sort()).toEqual([
      "config.goals.edit",
      "config.goals.view",
    ]);
  });

  it("vereinigt config.commissions.*- und config.goals.*-Permissions unabhaengig voneinander (kein implizites Bundling, Phase 11 AP1)", () => {
    const candidates: ConfigPermissionCandidate[] = [
      { scopeType: "TENANT", permissionKeys: ["config.commissions.view", "config.goals.edit"] },
    ];
    expect(deriveConfigPermissions(candidates).sort()).toEqual([
      "config.commissions.view",
      "config.goals.edit",
    ]);
  });

  it("liefert ein leeres Array fuer eine STORE-Zuweisung mit config.goals.*-Permissions, obwohl Goal.scopeType selbst STORE sein kann (Phase 11 AP1 -- keine Vermischung von Config-Scope und Goal-Scope)", () => {
    const candidates: ConfigPermissionCandidate[] = [
      { scopeType: "STORE", permissionKeys: [...CONFIG_GOALS_PERMISSION_KEYS] },
    ];
    expect(deriveConfigPermissions(candidates)).toEqual([]);
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

  it("config.rules.*-Fall (Phase 9 AP1): edit erlaubt, publish verweigert, unabhaengig von config.questions.*", () => {
    const rulesEditorSession = {
      configPermissions: [
        "config.questions.view",
        "config.questions.edit",
        "config.rules.view",
        "config.rules.edit",
      ],
    };
    expect(() =>
      requireConfigPermission(rulesEditorSession as never, "config.rules.edit"),
    ).not.toThrow();
    expect(() =>
      requireConfigPermission(rulesEditorSession as never, "config.rules.publish"),
    ).toThrow(ConfigAccessDeniedError);
  });

  it("config.commissions.*-Fall (Phase 10 AP1): edit erlaubt, publish verweigert, unabhaengig von config.questions.*/config.rules.*", () => {
    const commissionsEditorSession = {
      configPermissions: [
        "config.questions.view",
        "config.questions.edit",
        "config.rules.view",
        "config.rules.edit",
        "config.commissions.view",
        "config.commissions.edit",
      ],
    };
    expect(() =>
      requireConfigPermission(commissionsEditorSession as never, "config.commissions.edit"),
    ).not.toThrow();
    expect(() =>
      requireConfigPermission(commissionsEditorSession as never, "config.commissions.publish"),
    ).toThrow(ConfigAccessDeniedError);
  });

  it("config.goals.*-Fall (Phase 11 AP1): edit erlaubt, publish verweigert, unabhaengig von config.questions.*/config.rules.*/config.commissions.*", () => {
    const goalsEditorSession = {
      configPermissions: [
        "config.questions.view",
        "config.questions.edit",
        "config.rules.view",
        "config.rules.edit",
        "config.commissions.view",
        "config.commissions.edit",
        "config.goals.view",
        "config.goals.edit",
      ],
    };
    expect(() =>
      requireConfigPermission(goalsEditorSession as never, "config.goals.edit"),
    ).not.toThrow();
    expect(() =>
      requireConfigPermission(goalsEditorSession as never, "config.goals.publish"),
    ).toThrow(ConfigAccessDeniedError);
  });
});
