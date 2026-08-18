/**
 * Phase 9 AP6 -- Integrationstests fuer Versionshistorie + Rollback
 * (`getRuleSetVersionHistory()`, `rollbackToRuleSetVersion()`, siehe
 * PHASE_9_IMPLEMENTATION_PLAN.md Abschnitt 8). Deckt ChatGPTs explizit
 * geforderte Pruefungen ab (2026-08-18): vollstaendige Historie; Rollback
 * ausschliesslich als neue DRAFT-Version; keine Mutation der historischen
 * Quelle; Deep-Copy aller vier Regeltypen inkl. Conditions; Audit ROLLBACK
 * atomar; anschliessender AP5-Publish-Pfad (keine zweite Publish-
 * Implementierung); Rollback einer DRAFT-Quelle ablehnen; Tenant-Isolation;
 * und -- besonders wichtig -- Ablehnung von Cross-RuleSet-Rollback.
 *
 * Ohne DATABASE_URL wird die gesamte Suite uebersprungen statt fehlzuschlagen.
 */

import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { NextRequest } from "next/server";
import { afterAll, describe, expect, it } from "vitest";
import { runWithTenantContext } from "@/server/tenant/context";
import {
  createSessionToken,
  SESSION_COOKIE_NAME,
  type SessionPayload,
} from "@/server/auth/session";
import {
  addEligibilityRuleToDraft,
  addExclusionRuleToDraft,
  addPrioritizationRuleToDraft,
  addCrossSellingRuleToDraft,
  getRuleSetVersionHistory,
  publishRuleSetVersion,
  rollbackToRuleSetVersion,
} from "@/server/admin/rule-admin";
import {
  RollbackSourceNotEligibleError,
  RuleSetVersionNotFoundError,
} from "@/server/admin/rule-admin-errors";
import { GET as versionsRoute } from "@/app/api/admin/rule-sets/[id]/versions/route";
import { POST as rollbackRoute } from "@/app/api/admin/rule-sets/[id]/versions/[versionId]/rollback/route";

const hasDatabaseUrl = Boolean(process.env.DATABASE_URL);
process.env.DEV_AUTH_SECRET ??= "ap6-rule-admin-rollback-test-secret-not-for-prod";

describe.skipIf(!hasDatabaseUrl)("Phase 9 AP6: Versionshistorie + Rollback", () => {
  const rawClient = new PrismaClient();
  const suffix = randomUUID().slice(0, 8);

  afterAll(async () => {
    await rawClient.$disconnect();
  });

  function baseSessionPayload(tenantId: string): Omit<SessionPayload, "issuedAt"> {
    return {
      tenantId,
      userId: randomUUID(),
      employeeId: randomUUID(),
      storeId: randomUUID(),
      displayName: "Test",
      roles: [],
      managementScope: null,
      configPermissions: [],
    };
  }

  async function createTenant(key: string) {
    const tenant = await rawClient.tenant.create({
      data: { key: `${key}-${suffix}`, name: `Test ${key}`, isSynthetic: true },
    });
    return tenant.id;
  }

  async function createRuleSetVersion(
    tenantId: string,
    key: string,
    status: "DRAFT" | "ACTIVE" | "EXPIRED" | "ARCHIVED",
    validFrom = new Date("2026-01-01T00:00:00Z"),
    validTo: Date | null = null,
  ) {
    const ruleSet = await rawClient.ruleSet.create({ data: { tenantId, key: `${key}-${suffix}` } });
    const version = await rawClient.ruleSetVersion.create({
      data: {
        tenantId,
        ruleSetId: ruleSet.id,
        label: status === "DRAFT" ? "draft" : "v1",
        status,
        validFrom,
        validTo,
      },
    });
    return { ruleSetId: ruleSet.id, versionId: version.id };
  }

  /** Fuegt jeweils eine Regel jedes der vier Typen hinzu, inkl. einer Condition je Regel. */
  async function addOneRuleOfEachType(tenantId: string, ruleSetId: string, versionId: string) {
    const condition = {
      groupIndex: 0,
      sourceType: "SESSION_ATTRIBUTE" as const,
      attributeKey: "region",
      operator: "EQUALS" as const,
      comparisonValue: "nord",
    };
    await runWithTenantContext(
      { tenantId, userId: randomUUID(), roles: [], managementScope: null },
      async () => {
        await addEligibilityRuleToDraft(ruleSetId, versionId, {
          key: "elig-1",
          description: "Test",
          isRequired: false,
          fitWeight: 1,
          isActive: true,
          conditions: [condition],
        });
        await addExclusionRuleToDraft(ruleSetId, versionId, {
          key: "excl-1",
          reasonCode: "REASON_1",
          description: "Test",
          isActive: true,
          conditions: [condition],
        });
        await addPrioritizationRuleToDraft(ruleSetId, versionId, {
          key: "prio-1",
          description: "Test",
          weight: 5,
          commissionRequired: false,
          isActive: true,
          conditions: [condition],
        });
        await addCrossSellingRuleToDraft(ruleSetId, versionId, {
          key: "cross-1",
          description: "Test",
          needType: "DSL",
          priority: 1,
          reasonCode: "CROSS_1",
          suggestedProductVersionId: null,
          isActive: true,
          conditions: [condition],
        });
      },
    );
  }

  function requestWithCookie(url: string, token: string, method: "GET" | "POST" = "POST") {
    return new NextRequest(url, {
      method,
      headers: new Headers({ cookie: `${SESSION_COOKIE_NAME}=${token}` }),
    });
  }

  function routeParamsWithVersion(value: { id: string; versionId: string }) {
    return { params: Promise.resolve(value) };
  }

  function routeParams(value: { id: string }) {
    return { params: Promise.resolve(value) };
  }

  it("getRuleSetVersionHistory() liefert vollstaendige Historie (alle Status, neueste zuerst)", async () => {
    const tenantId = await createTenant("history");
    const { ruleSetId, versionId: v1 } = await createRuleSetVersion(
      tenantId,
      "rs",
      "EXPIRED",
      new Date("2026-01-01T00:00:00Z"),
      new Date("2026-02-01T00:00:00Z"),
    );
    const ruleSet = await rawClient.ruleSet.findUniqueOrThrow({ where: { id: ruleSetId } });
    const v2 = await rawClient.ruleSetVersion.create({
      data: {
        tenantId,
        ruleSetId: ruleSet.id,
        label: "v2",
        status: "ACTIVE",
        validFrom: new Date("2026-02-01T00:00:00Z"),
        validTo: null,
      },
    });
    const v3 = await rawClient.ruleSetVersion.create({
      data: {
        tenantId,
        ruleSetId: ruleSet.id,
        label: "v3-draft",
        status: "DRAFT",
        validFrom: new Date("2026-03-01T00:00:00Z"),
        validTo: null,
      },
    });

    const history = await runWithTenantContext(
      { tenantId, userId: randomUUID(), roles: [], managementScope: null },
      () => getRuleSetVersionHistory(ruleSetId),
    );

    expect(history.map((h) => h.id)).toEqual([v3.id, v2.id, v1]);
    expect(history.find((h) => h.id === v1)?.status).toBe("EXPIRED");
    expect(history.find((h) => h.id === v2.id)?.status).toBe("ACTIVE");
    expect(history.find((h) => h.id === v3.id)?.status).toBe("DRAFT");
  });

  it("Rollback erzeugt eine neue DRAFT-Version mit Deep-Copy aller vier Regeltypen inkl. Conditions; Quelle bleibt unveraendert", async () => {
    const tenantId = await createTenant("rollback-copy");
    const { ruleSetId, versionId: sourceVersionId } = await createRuleSetVersion(
      tenantId,
      "rs",
      "ACTIVE",
    );
    await addOneRuleOfEachType(tenantId, ruleSetId, sourceVersionId);

    const sourceBefore = await rawClient.ruleSetVersion.findUniqueOrThrow({
      where: { id: sourceVersionId },
    });

    const rolledBack = await runWithTenantContext(
      { tenantId, userId: randomUUID(), roles: [], managementScope: null },
      () => rollbackToRuleSetVersion(ruleSetId, sourceVersionId),
    );

    expect(rolledBack.id).not.toBe(sourceVersionId);
    expect(rolledBack.status).toBe("DRAFT");
    expect(rolledBack.eligibilityRules).toHaveLength(1);
    expect(rolledBack.exclusionRules).toHaveLength(1);
    expect(rolledBack.prioritizationRules).toHaveLength(1);
    expect(rolledBack.crossSellingRules).toHaveLength(1);
    expect(rolledBack.eligibilityRules[0]?.conditions).toHaveLength(1);
    expect(rolledBack.exclusionRules[0]?.conditions).toHaveLength(1);
    expect(rolledBack.prioritizationRules[0]?.conditions).toHaveLength(1);
    expect(rolledBack.crossSellingRules[0]?.conditions).toHaveLength(1);

    // Quelle unveraendert (kein UPDATE, kein DELETE).
    const sourceAfter = await rawClient.ruleSetVersion.findUniqueOrThrow({
      where: { id: sourceVersionId },
    });
    expect(sourceAfter).toEqual(sourceBefore);
    const sourceEligibility = await rawClient.eligibilityRule.findMany({
      where: { ruleSetVersionId: sourceVersionId },
    });
    expect(sourceEligibility).toHaveLength(1);
  });

  it("Rollback schreibt AuditLog-Eintrag (ROLLBACK) mit sourceVersionId in metadata, atomar mit der Tiefkopie", async () => {
    const tenantId = await createTenant("rollback-audit");
    const { ruleSetId, versionId: sourceVersionId } = await createRuleSetVersion(
      tenantId,
      "rs",
      "ACTIVE",
    );
    await addOneRuleOfEachType(tenantId, ruleSetId, sourceVersionId);

    const rolledBack = await runWithTenantContext(
      { tenantId, userId: randomUUID(), roles: [], managementScope: null },
      () => rollbackToRuleSetVersion(ruleSetId, sourceVersionId),
    );

    const auditEntries = await rawClient.auditLog.findMany({
      where: {
        tenantId,
        entityType: "RuleSetVersion",
        entityId: rolledBack.id,
        action: "ROLLBACK",
      },
    });
    expect(auditEntries).toHaveLength(1);
    expect(auditEntries[0]?.metadata).toMatchObject({
      ruleSetId,
      sourceVersionId,
      sourceVersionStatus: "ACTIVE",
      ruleCount: 4,
    });
  });

  it("Rollback-Ergebnis durchlaeuft regulaer den bestehenden AP5-Publish-Pfad (keine zweite Publish-Implementierung)", async () => {
    const tenantId = await createTenant("rollback-then-publish");
    const { ruleSetId, versionId: sourceVersionId } = await createRuleSetVersion(
      tenantId,
      "rs",
      "ACTIVE",
    );
    await addOneRuleOfEachType(tenantId, ruleSetId, sourceVersionId);

    const rolledBack = await runWithTenantContext(
      { tenantId, userId: randomUUID(), roles: [], managementScope: null },
      () => rollbackToRuleSetVersion(ruleSetId, sourceVersionId),
    );

    const published = await runWithTenantContext(
      { tenantId, userId: randomUUID(), roles: [], managementScope: null },
      () => publishRuleSetVersion(ruleSetId, rolledBack.id),
    );

    expect(published.version.status).toBe("ACTIVE");
    expect(published.previousActiveVersionId).toBe(sourceVersionId);
  });

  it("Rollback einer DRAFT-Quelle wird abgelehnt (RollbackSourceNotEligibleError)", async () => {
    const tenantId = await createTenant("rollback-draft-source");
    const { ruleSetId, versionId: draftVersionId } = await createRuleSetVersion(
      tenantId,
      "rs",
      "DRAFT",
    );

    await expect(
      runWithTenantContext(
        { tenantId, userId: randomUUID(), roles: [], managementScope: null },
        () => rollbackToRuleSetVersion(ruleSetId, draftVersionId),
      ),
    ).rejects.toThrow(RollbackSourceNotEligibleError);
  });

  it("BESONDERS WICHTIG (ChatGPT 2026-08-18): Cross-RuleSet-Rollback wird abgelehnt (RuleSetVersionNotFoundError)", async () => {
    const tenantId = await createTenant("cross-ruleset-rollback");
    const { versionId: sourceVersionInOtherRuleSet } = await createRuleSetVersion(
      tenantId,
      "rs-source",
      "ACTIVE",
    );
    const { ruleSetId: targetRuleSetId } = await createRuleSetVersion(
      tenantId,
      "rs-target",
      "DRAFT",
    );

    await expect(
      runWithTenantContext(
        { tenantId, userId: randomUUID(), roles: [], managementScope: null },
        () => rollbackToRuleSetVersion(targetRuleSetId, sourceVersionInOtherRuleSet),
      ),
    ).rejects.toThrow(RuleSetVersionNotFoundError);
  });

  it("Tenant-Isolation: Rollback mit einer sourceVersionId eines FREMDEN Mandanten wird abgelehnt", async () => {
    const tenantA = await createTenant("tenant-a");
    const tenantB = await createTenant("tenant-b");
    const { versionId: versionInTenantB } = await createRuleSetVersion(tenantB, "rs", "ACTIVE");
    const { ruleSetId: ruleSetInTenantA } = await createRuleSetVersion(tenantA, "rs", "DRAFT");

    await expect(
      runWithTenantContext(
        { tenantId: tenantA, userId: randomUUID(), roles: [], managementScope: null },
        () => rollbackToRuleSetVersion(ruleSetInTenantA, versionInTenantB),
      ),
    ).rejects.toThrow(RuleSetVersionNotFoundError);
  });

  describe("HTTP-Kette", () => {
    it("GET .../versions ohne config.rules.view -> 403", async () => {
      const tenantId = await createTenant("http-history-403");
      const { ruleSetId } = await createRuleSetVersion(tenantId, "rs", "ACTIVE");
      const token = createSessionToken({ ...baseSessionPayload(tenantId), configPermissions: [] });
      const response = await versionsRoute(
        requestWithCookie(
          `http://localhost/api/admin/rule-sets/${ruleSetId}/versions`,
          token,
          "GET",
        ),
        routeParams({ id: ruleSetId }),
      );
      expect(response.status).toBe(403);
    });

    it("GET .../versions mit config.rules.view -> 200, vollstaendige Historie", async () => {
      const tenantId = await createTenant("http-history-200");
      const { ruleSetId } = await createRuleSetVersion(tenantId, "rs", "ACTIVE");
      const token = createSessionToken({
        ...baseSessionPayload(tenantId),
        configPermissions: ["config.rules.view"],
      });
      const response = await versionsRoute(
        requestWithCookie(
          `http://localhost/api/admin/rule-sets/${ruleSetId}/versions`,
          token,
          "GET",
        ),
        routeParams({ id: ruleSetId }),
      );
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.versions).toHaveLength(1);
    });

    it("POST .../rollback ohne config.rules.edit -> 403", async () => {
      const tenantId = await createTenant("http-rollback-403");
      const { ruleSetId, versionId } = await createRuleSetVersion(tenantId, "rs", "ACTIVE");
      const token = createSessionToken({ ...baseSessionPayload(tenantId), configPermissions: [] });
      const response = await rollbackRoute(
        requestWithCookie(
          `http://localhost/api/admin/rule-sets/${ruleSetId}/versions/${versionId}/rollback`,
          token,
        ),
        routeParamsWithVersion({ id: ruleSetId, versionId }),
      );
      expect(response.status).toBe(403);
    });

    it("POST .../rollback mit config.rules.edit -> 201, neue DRAFT-Version", async () => {
      const tenantId = await createTenant("http-rollback-201");
      const { ruleSetId, versionId } = await createRuleSetVersion(tenantId, "rs", "ACTIVE");
      await addOneRuleOfEachType(tenantId, ruleSetId, versionId);
      const token = createSessionToken({
        ...baseSessionPayload(tenantId),
        configPermissions: ["config.rules.edit"],
      });
      const response = await rollbackRoute(
        requestWithCookie(
          `http://localhost/api/admin/rule-sets/${ruleSetId}/versions/${versionId}/rollback`,
          token,
        ),
        routeParamsWithVersion({ id: ruleSetId, versionId }),
      );
      expect(response.status).toBe(201);
      const body = await response.json();
      expect(body.version.status).toBe("DRAFT");
      expect(body.version.id).not.toBe(versionId);
    });

    it("POST .../rollback mit DRAFT-Quelle -> 409", async () => {
      const tenantId = await createTenant("http-rollback-409");
      const { ruleSetId, versionId } = await createRuleSetVersion(tenantId, "rs", "DRAFT");
      const token = createSessionToken({
        ...baseSessionPayload(tenantId),
        configPermissions: ["config.rules.edit"],
      });
      const response = await rollbackRoute(
        requestWithCookie(
          `http://localhost/api/admin/rule-sets/${ruleSetId}/versions/${versionId}/rollback`,
          token,
        ),
        routeParamsWithVersion({ id: ruleSetId, versionId }),
      );
      expect(response.status).toBe(409);
    });

    it("POST .../rollback mit fremder RuleSetId (Cross-RuleSet) -> 404", async () => {
      const tenantId = await createTenant("http-rollback-cross-404");
      const { versionId: sourceInOtherRuleSet } = await createRuleSetVersion(
        tenantId,
        "rs-source",
        "ACTIVE",
      );
      const { ruleSetId: targetRuleSetId } = await createRuleSetVersion(
        tenantId,
        "rs-target",
        "DRAFT",
      );
      const token = createSessionToken({
        ...baseSessionPayload(tenantId),
        configPermissions: ["config.rules.edit"],
      });
      const response = await rollbackRoute(
        requestWithCookie(
          `http://localhost/api/admin/rule-sets/${targetRuleSetId}/versions/${sourceInOtherRuleSet}/rollback`,
          token,
        ),
        routeParamsWithVersion({ id: targetRuleSetId, versionId: sourceInOtherRuleSet }),
      );
      expect(response.status).toBe(404);
    });
  });
});
