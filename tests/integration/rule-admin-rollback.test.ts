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
 *
 * WICHTIG (CI #52-Fix, 2026-08-19): zwei unabhaengige Befunde in dieser
 * Datei, die vor dem heutigen Batch-Push nie gegen eine echte Postgres-
 * Instanz in CI liefen:
 *
 * 1) `addOneRuleOfEachType()` fuegte Regeln bislang ueber die ECHTEN
 *    Service-Funktionen (`addEligibilityRuleToDraft()` etc.) hinzu -- diese
 *    verlangen zwingend eine DRAFT-Version (`requireDraftRuleSetVersion()`).
 *    Alle Aufrufer dieser Datei erzeugen die Quellversion jedoch bewusst als
 *    ACTIVE (realistisches Rollback-Szenario: man rollt zu einer bereits
 *    veroeffentlichten Version zurueck). Das fuehrte zu
 *    `RuleSetVersionNotDraftError`. Fix: die Fixture erzeugt die vier
 *    Beispielregeln jetzt per RAW Prisma-Create direkt (analog
 *    `createRuleSetV1()` in recommendation-ruleset-snapshot.test.ts) --
 *    diese Hilfsfunktion testet die Rollback-Deep-Copy-Logik, nicht das
 *    Draft-CRUD (das ist rule-admin-crud.test.ts's Aufgabe), daher ist der
 *    direkte Rohzugriff hier sachlich korrekt und nicht nur ein Workaround.
 * 2) Jede echte Mutation (Rollback, Publish) schreibt einen `AuditLog`-
 *    Eintrag mit `actorUserId`, per FK (`audit_logs_tenant_id_actor_user_id_fkey`)
 *    an eine echte `users`-Zeile desselben Mandanten gebunden. Ein frei
 *    erfundener `randomUUID()` als Actor verletzt diese Constraint. Fix: alle
 *    Aufrufe verwenden jetzt einen ueber `createUser()` echten Actor.
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

  function baseSessionPayload(tenantId: string, userId: string): Omit<SessionPayload, "issuedAt"> {
    return {
      tenantId,
      userId,
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

  async function createUser(tenantId: string, key: string) {
    const user = await rawClient.user.create({
      data: { tenantId, email: `${key}-${suffix}@example-synthetic.test`, isSynthetic: true },
    });
    return user.id;
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

  /**
   * Fuegt jeweils eine Regel jedes der vier Typen hinzu, inkl. einer
   * Condition je Regel -- per RAW Prisma-Create (siehe Modulkommentar oben,
   * Punkt 1: `versionId` ist hier bewusst haeufig eine ACTIVE-Version, die
   * echten Draft-Mutationsfunktionen wuerden das ablehnen).
   */
  async function addOneRuleOfEachType(tenantId: string, versionId: string) {
    const conditionBase = {
      tenantId,
      groupIndex: 0,
      sourceType: "SESSION_ATTRIBUTE" as const,
      attributeKey: "region",
      operator: "EQUALS" as const,
      comparisonValue: "nord",
    };

    const eligibilityRule = await rawClient.eligibilityRule.create({
      data: {
        tenantId,
        ruleSetVersionId: versionId,
        key: "elig-1",
        description: "Test",
        isRequired: false,
        fitWeight: 1,
        isActive: true,
      },
    });
    await rawClient.eligibilityRuleCondition.create({
      data: { ...conditionBase, eligibilityRuleId: eligibilityRule.id },
    });

    const exclusionRule = await rawClient.exclusionRule.create({
      data: {
        tenantId,
        ruleSetVersionId: versionId,
        key: "excl-1",
        reasonCode: "REASON_1",
        description: "Test",
        isActive: true,
      },
    });
    await rawClient.exclusionRuleCondition.create({
      data: { ...conditionBase, exclusionRuleId: exclusionRule.id },
    });

    const prioritizationRule = await rawClient.prioritizationRule.create({
      data: {
        tenantId,
        ruleSetVersionId: versionId,
        key: "prio-1",
        description: "Test",
        weight: 5,
        commissionRequired: false,
        isActive: true,
      },
    });
    await rawClient.prioritizationRuleCondition.create({
      data: { ...conditionBase, prioritizationRuleId: prioritizationRule.id },
    });

    const crossSellingRule = await rawClient.crossSellingRule.create({
      data: {
        tenantId,
        ruleSetVersionId: versionId,
        key: "cross-1",
        description: "Test",
        needType: "DSL",
        priority: 1,
        reasonCode: "CROSS_1",
        isActive: true,
      },
    });
    await rawClient.crossSellingRuleCondition.create({
      data: { ...conditionBase, crossSellingRuleId: crossSellingRule.id },
    });
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
    const actorUserId = await createUser(tenantId, "actor");
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
      { tenantId, userId: actorUserId, roles: [], managementScope: null },
      () => getRuleSetVersionHistory(ruleSetId),
    );

    expect(history.map((h) => h.id)).toEqual([v3.id, v2.id, v1]);
    expect(history.find((h) => h.id === v1)?.status).toBe("EXPIRED");
    expect(history.find((h) => h.id === v2.id)?.status).toBe("ACTIVE");
    expect(history.find((h) => h.id === v3.id)?.status).toBe("DRAFT");
  });

  it("Rollback erzeugt eine neue DRAFT-Version mit Deep-Copy aller vier Regeltypen inkl. Conditions; Quelle bleibt unveraendert", async () => {
    const tenantId = await createTenant("rollback-copy");
    const actorUserId = await createUser(tenantId, "actor");
    const { ruleSetId, versionId: sourceVersionId } = await createRuleSetVersion(
      tenantId,
      "rs",
      "ACTIVE",
    );
    await addOneRuleOfEachType(tenantId, sourceVersionId);

    const sourceBefore = await rawClient.ruleSetVersion.findUniqueOrThrow({
      where: { id: sourceVersionId },
    });

    const rolledBack = await runWithTenantContext(
      { tenantId, userId: actorUserId, roles: [], managementScope: null },
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
    const actorUserId = await createUser(tenantId, "actor");
    const { ruleSetId, versionId: sourceVersionId } = await createRuleSetVersion(
      tenantId,
      "rs",
      "ACTIVE",
    );
    await addOneRuleOfEachType(tenantId, sourceVersionId);

    const rolledBack = await runWithTenantContext(
      { tenantId, userId: actorUserId, roles: [], managementScope: null },
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
    const actorUserId = await createUser(tenantId, "actor");
    const { ruleSetId, versionId: sourceVersionId } = await createRuleSetVersion(
      tenantId,
      "rs",
      "ACTIVE",
    );
    await addOneRuleOfEachType(tenantId, sourceVersionId);

    const rolledBack = await runWithTenantContext(
      { tenantId, userId: actorUserId, roles: [], managementScope: null },
      () => rollbackToRuleSetVersion(ruleSetId, sourceVersionId),
    );

    const published = await runWithTenantContext(
      { tenantId, userId: actorUserId, roles: [], managementScope: null },
      () => publishRuleSetVersion(ruleSetId, rolledBack.id),
    );

    expect(published.version.status).toBe("ACTIVE");
    expect(published.previousActiveVersionId).toBe(sourceVersionId);
  });

  it("Rollback einer DRAFT-Quelle wird abgelehnt (RollbackSourceNotEligibleError)", async () => {
    const tenantId = await createTenant("rollback-draft-source");
    const actorUserId = await createUser(tenantId, "actor");
    const { ruleSetId, versionId: draftVersionId } = await createRuleSetVersion(
      tenantId,
      "rs",
      "DRAFT",
    );

    await expect(
      runWithTenantContext(
        { tenantId, userId: actorUserId, roles: [], managementScope: null },
        () => rollbackToRuleSetVersion(ruleSetId, draftVersionId),
      ),
    ).rejects.toThrow(RollbackSourceNotEligibleError);
  });

  it("BESONDERS WICHTIG (ChatGPT 2026-08-18): Cross-RuleSet-Rollback wird abgelehnt (RuleSetVersionNotFoundError)", async () => {
    const tenantId = await createTenant("cross-ruleset-rollback");
    const actorUserId = await createUser(tenantId, "actor");
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
        { tenantId, userId: actorUserId, roles: [], managementScope: null },
        () => rollbackToRuleSetVersion(targetRuleSetId, sourceVersionInOtherRuleSet),
      ),
    ).rejects.toThrow(RuleSetVersionNotFoundError);
  });

  it("Tenant-Isolation: Rollback mit einer sourceVersionId eines FREMDEN Mandanten wird abgelehnt", async () => {
    const tenantA = await createTenant("tenant-a");
    const tenantB = await createTenant("tenant-b");
    const actorA = await createUser(tenantA, "actor-a");
    const { versionId: versionInTenantB } = await createRuleSetVersion(tenantB, "rs", "ACTIVE");
    const { ruleSetId: ruleSetInTenantA } = await createRuleSetVersion(tenantA, "rs", "DRAFT");

    await expect(
      runWithTenantContext(
        { tenantId: tenantA, userId: actorA, roles: [], managementScope: null },
        () => rollbackToRuleSetVersion(ruleSetInTenantA, versionInTenantB),
      ),
    ).rejects.toThrow(RuleSetVersionNotFoundError);
  });

  describe("HTTP-Kette", () => {
    it("GET .../versions ohne config.rules.view -> 403", async () => {
      const tenantId = await createTenant("http-history-403");
      const actorUserId = await createUser(tenantId, "actor");
      const { ruleSetId } = await createRuleSetVersion(tenantId, "rs", "ACTIVE");
      const token = createSessionToken({
        ...baseSessionPayload(tenantId, actorUserId),
        configPermissions: [],
      });
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
      const actorUserId = await createUser(tenantId, "actor");
      const { ruleSetId } = await createRuleSetVersion(tenantId, "rs", "ACTIVE");
      const token = createSessionToken({
        ...baseSessionPayload(tenantId, actorUserId),
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
      const actorUserId = await createUser(tenantId, "actor");
      const { ruleSetId, versionId } = await createRuleSetVersion(tenantId, "rs", "ACTIVE");
      const token = createSessionToken({
        ...baseSessionPayload(tenantId, actorUserId),
        configPermissions: [],
      });
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
      const actorUserId = await createUser(tenantId, "actor");
      const { ruleSetId, versionId } = await createRuleSetVersion(tenantId, "rs", "ACTIVE");
      await addOneRuleOfEachType(tenantId, versionId);
      const token = createSessionToken({
        ...baseSessionPayload(tenantId, actorUserId),
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
      const actorUserId = await createUser(tenantId, "actor");
      const { ruleSetId, versionId } = await createRuleSetVersion(tenantId, "rs", "DRAFT");
      const token = createSessionToken({
        ...baseSessionPayload(tenantId, actorUserId),
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
      const actorUserId = await createUser(tenantId, "actor");
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
        ...baseSessionPayload(tenantId, actorUserId),
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
