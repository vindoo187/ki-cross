/**
 * Phase 9 AP2 -- Integrationstests fuer die RuleSet-/Version-Management-API
 * (siehe PHASE_9_IMPLEMENTATION_PLAN.md Abschnitt 4). Testet sowohl die
 * Service-Schicht (`src/server/admin/rule-admin.ts`, direkt innerhalb
 * `runWithTenantContext()`) als auch die volle HTTP-Kette (Route-Handler mit
 * echtem signiertem Session-Cookie), gegen ECHTE Postgres-Fixtures (kein
 * `vi.mock`, Codebase-Konvention, siehe tests/integration/question-admin.test.ts).
 *
 * Deckt insbesondere den von ChatGPT als "einer der wichtigsten Punkte des
 * Plans" bezeichneten Fall ab: `copyFromVersionId` darf zu einem ANDEREN
 * `RuleSet` desselben Mandanten gehoeren (mandantenweiter, nicht
 * pro-RuleSet-ACTIVE-Scope, siehe PHASE_9_DISCOVERY.md Abschnitt 1).
 *
 * Ohne DATABASE_URL wird die gesamte Suite uebersprungen statt fehlzuschlagen.
 *
 * WICHTIG (CI #52-Folgefix, proaktive Pruefung 2026-08-19): dieselbe
 * `audit_logs_tenant_id_actor_user_id_fkey`-Problematik wie in
 * rule-admin-crud.test.ts / rule-admin-publish.test.ts / rule-admin-rollback.test.ts
 * (siehe dortige Modulkommentare) betrifft auch diese Datei --
 * `createDraftRuleSetVersion()` schreibt einen AuditLog-Eintrag (action
 * CREATE, siehe Abschnitt "3. Auditierung" unten) und verlangt daher einen
 * ECHTEN Actor. Alle `runWithTenantContext()`-Aufrufe verwenden jetzt einen
 * ueber `createUser()` echten Actor statt eines frei erfundenen
 * `randomUUID()` -- unabhaengig davon, ob der jeweilige Testfall die
 * Mutation tatsaechlich erfolgreich abschliesst, um zukuenftige CI-
 * Ueberraschungen bei Refactorings zu vermeiden.
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
  createDraftRuleSetVersion,
  getRuleSetVersionDetail,
  listRuleSets,
} from "@/server/admin/rule-admin";
import {
  CopySourceRuleSetVersionNotFoundError,
  RuleSetNotFoundError,
  RuleSetVersionNotFoundError,
} from "@/server/admin/rule-admin-errors";
import { GET as listRuleSetsRoute } from "@/app/api/admin/rule-sets/route";
import { POST as createDraftRuleSetVersionRoute } from "@/app/api/admin/rule-sets/[id]/versions/route";
import { GET as getRuleSetVersionDetailRoute } from "@/app/api/admin/rule-sets/[id]/versions/[versionId]/route";

const hasDatabaseUrl = Boolean(process.env.DATABASE_URL);
process.env.DEV_AUTH_SECRET ??= "ap2-rule-admin-test-secret-not-for-prod";

describe.skipIf(!hasDatabaseUrl)("Phase 9 AP2: RuleSet-/Version-Management API", () => {
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

  /**
   * Legt ein `RuleSet` mit einer ACTIVE-Version an, die je EINE Regel jedes
   * der vier Regeltypen (samt einer Condition) enthaelt -- Grundlage fuer
   * die Deep-Copy-Tests (`copyFromVersionId`).
   */
  async function createRuleSetWithActiveVersion(
    tenantId: string,
    key: string,
    validFrom = new Date("2026-01-01T00:00:00Z"),
  ) {
    const ruleSet = await rawClient.ruleSet.create({
      data: { tenantId, key: `${key}-${suffix}` },
    });
    const version = await rawClient.ruleSetVersion.create({
      data: {
        tenantId,
        ruleSetId: ruleSet.id,
        label: "v1",
        status: "ACTIVE",
        validFrom,
        validTo: null,
      },
    });

    const eligibilityRule = await rawClient.eligibilityRule.create({
      data: {
        tenantId,
        ruleSetVersionId: version.id,
        key: "elig-1",
        description: "Elig 1",
        isRequired: true,
        fitWeight: 0,
      },
    });
    await rawClient.eligibilityRuleCondition.create({
      data: {
        tenantId,
        eligibilityRuleId: eligibilityRule.id,
        groupIndex: 0,
        sourceType: "SESSION_ATTRIBUTE",
        attributeKey: "region",
        operator: "EQUALS",
        comparisonValue: "nord",
      },
    });

    const exclusionRule = await rawClient.exclusionRule.create({
      data: {
        tenantId,
        ruleSetVersionId: version.id,
        key: "excl-1",
        reasonCode: "REASON_1",
        description: "Excl 1",
      },
    });
    await rawClient.exclusionRuleCondition.create({
      data: {
        tenantId,
        exclusionRuleId: exclusionRule.id,
        groupIndex: 0,
        sourceType: "SESSION_ATTRIBUTE",
        attributeKey: "region",
        operator: "EQUALS",
        comparisonValue: "sued",
      },
    });

    const prioritizationRule = await rawClient.prioritizationRule.create({
      data: {
        tenantId,
        ruleSetVersionId: version.id,
        key: "prio-1",
        description: "Prio 1",
        weight: 5,
      },
    });
    await rawClient.prioritizationRuleCondition.create({
      data: {
        tenantId,
        prioritizationRuleId: prioritizationRule.id,
        groupIndex: 0,
        sourceType: "SESSION_ATTRIBUTE",
        attributeKey: "region",
        operator: "EQUALS",
        comparisonValue: "nord",
      },
    });

    const crossSellingRule = await rawClient.crossSellingRule.create({
      data: {
        tenantId,
        ruleSetVersionId: version.id,
        key: "css-1",
        description: "CSS 1",
        needType: "DSL",
        priority: 1,
        reasonCode: "CSS_REASON_1",
      },
    });
    await rawClient.crossSellingRuleCondition.create({
      data: {
        tenantId,
        crossSellingRuleId: crossSellingRule.id,
        groupIndex: 0,
        sourceType: "SESSION_ATTRIBUTE",
        attributeKey: "region",
        operator: "EQUALS",
        comparisonValue: "nord",
      },
    });

    return { ruleSetId: ruleSet.id, activeVersionId: version.id };
  }

  async function createEmptyRuleSet(tenantId: string, key: string) {
    const ruleSet = await rawClient.ruleSet.create({
      data: { tenantId, key: `${key}-${suffix}` },
    });
    return ruleSet.id;
  }

  function requestWithCookie(
    url: string,
    token: string,
    init?: { method?: string; body?: string },
  ) {
    return new NextRequest(url, {
      method: init?.method,
      body: init?.body,
      headers: new Headers({ cookie: `${SESSION_COOKIE_NAME}=${token}` }),
    });
  }

  function routeParams<T extends Record<string, string>>(value: T) {
    return { params: Promise.resolve(value) };
  }

  // -------------------------------------------------------------------
  // 1. Service-Schicht
  // -------------------------------------------------------------------
  describe("1. Service-Schicht", () => {
    it("listRuleSets() liefert RuleSets inkl. Versionen+Status", async () => {
      const tenantId = await createTenant("svc-list");
      await createRuleSetWithActiveVersion(tenantId, "rs");
      const result = await runWithTenantContext(
        { tenantId, userId: randomUUID(), roles: [], managementScope: null },
        () => listRuleSets(),
      );
      expect(result.length).toBeGreaterThanOrEqual(1);
      expect(result[0]?.versions[0]?.status).toBe("ACTIVE");
    });

    it("getRuleSetVersionDetail() liefert alle vier Regeltypen inkl. Conditions", async () => {
      const tenantId = await createTenant("svc-detail");
      const { ruleSetId, activeVersionId } = await createRuleSetWithActiveVersion(tenantId, "rs");
      const detail = await runWithTenantContext(
        { tenantId, userId: randomUUID(), roles: [], managementScope: null },
        () => getRuleSetVersionDetail(ruleSetId, activeVersionId),
      );
      expect(detail.eligibilityRules).toHaveLength(1);
      expect(detail.eligibilityRules[0]?.conditions).toHaveLength(1);
      expect(detail.exclusionRules).toHaveLength(1);
      expect(detail.prioritizationRules).toHaveLength(1);
      expect(detail.crossSellingRules).toHaveLength(1);
      expect(detail.crossSellingRules[0]?.needType).toBe("DSL");
    });

    it("getRuleSetVersionDetail() mit fremder ruleSetId -> RuleSetNotFoundError", async () => {
      const tenantId = await createTenant("svc-rsnf");
      const { activeVersionId } = await createRuleSetWithActiveVersion(tenantId, "rs");
      await expect(
        runWithTenantContext(
          { tenantId, userId: randomUUID(), roles: [], managementScope: null },
          () => getRuleSetVersionDetail(randomUUID(), activeVersionId),
        ),
      ).rejects.toThrow(RuleSetNotFoundError);
    });

    it("getRuleSetVersionDetail() mit versionId aus anderem RuleSet -> RuleSetVersionNotFoundError", async () => {
      const tenantId = await createTenant("svc-vnf");
      const { ruleSetId } = await createRuleSetWithActiveVersion(tenantId, "rs-a");
      // Zweite ACTIVE-Version desselben Mandanten braucht ein
      // nicht-ueberlappendes Zeitfenster, sonst verletzt der zweite Insert
      // den EXCLUDE-Constraint rule_set_versions_tenant_active_no_overlap
      // (mandantenweit hoechstens eine ACTIVE-Version je Zeitspanne, siehe
      // Modulkommentar in rule-admin.ts zu AP5) -- dieser Test prueft
      // ausschliesslich "versionId aus fremdem RuleSet", nicht die
      // Zeitfenster-Semantik selbst.
      const { activeVersionId: otherVersionId } = await createRuleSetWithActiveVersion(
        tenantId,
        "rs-b",
        new Date("2027-01-01T00:00:00Z"),
      );
      await expect(
        runWithTenantContext(
          { tenantId, userId: randomUUID(), roles: [], managementScope: null },
          () => getRuleSetVersionDetail(ruleSetId, otherVersionId),
        ),
      ).rejects.toThrow(RuleSetVersionNotFoundError);
    });

    it("createDraftRuleSetVersion() ohne copyFromVersionId liefert eine leere DRAFT-Version", async () => {
      const tenantId = await createTenant("svc-empty");
      const actorUserId = await createUser(tenantId, "actor");
      const ruleSetId = await createEmptyRuleSet(tenantId, "rs");
      const detail = await runWithTenantContext(
        { tenantId, userId: actorUserId, roles: [], managementScope: null },
        () => createDraftRuleSetVersion(ruleSetId, { label: "Entwurf 1" }),
      );
      expect(detail.status).toBe("DRAFT");
      expect(detail.eligibilityRules).toHaveLength(0);
      expect(detail.exclusionRules).toHaveLength(0);
      expect(detail.prioritizationRules).toHaveLength(0);
      expect(detail.crossSellingRules).toHaveLength(0);
    });

    it("createDraftRuleSetVersion() mit copyFromVersionId DESSELBEN RuleSet kopiert alle vier Regeltypen", async () => {
      const tenantId = await createTenant("svc-copy-same");
      const actorUserId = await createUser(tenantId, "actor");
      const { ruleSetId, activeVersionId } = await createRuleSetWithActiveVersion(tenantId, "rs");
      const detail = await runWithTenantContext(
        { tenantId, userId: actorUserId, roles: [], managementScope: null },
        () =>
          createDraftRuleSetVersion(ruleSetId, {
            label: "Entwurf aus v1",
            copyFromVersionId: activeVersionId,
          }),
      );
      expect(detail.eligibilityRules).toHaveLength(1);
      expect(detail.eligibilityRules[0]?.id).not.toBe(
        (
          await runWithTenantContext(
            { tenantId, userId: actorUserId, roles: [], managementScope: null },
            () => getRuleSetVersionDetail(ruleSetId, activeVersionId),
          )
        ).eligibilityRules[0]?.id,
      );
      expect(detail.exclusionRules).toHaveLength(1);
      expect(detail.prioritizationRules).toHaveLength(1);
      expect(detail.crossSellingRules).toHaveLength(1);
    });

    it("createDraftRuleSetVersion() mit copyFromVersionId eines ANDEREN RuleSet kopiert dessen Regeln (zentraler AP2-Testfall)", async () => {
      const tenantId = await createTenant("svc-copy-cross");
      const actorUserId = await createUser(tenantId, "actor");
      const { activeVersionId: sourceVersionId } = await createRuleSetWithActiveVersion(
        tenantId,
        "rs-source",
      );
      const targetRuleSetId = await createEmptyRuleSet(tenantId, "rs-target");

      const detail = await runWithTenantContext(
        { tenantId, userId: actorUserId, roles: [], managementScope: null },
        () =>
          createDraftRuleSetVersion(targetRuleSetId, {
            label: "Entwurf RuleSet-uebergreifend",
            copyFromVersionId: sourceVersionId,
          }),
      );

      expect(detail.ruleSetId).toBe(targetRuleSetId);
      expect(detail.eligibilityRules).toHaveLength(1);
      expect(detail.eligibilityRules[0]?.key).toBe("elig-1");
      expect(detail.eligibilityRules[0]?.conditions[0]?.attributeKey).toBe("region");
      expect(detail.exclusionRules).toHaveLength(1);
      expect(detail.exclusionRules[0]?.reasonCode).toBe("REASON_1");
      expect(detail.prioritizationRules).toHaveLength(1);
      expect(detail.prioritizationRules[0]?.weight).toBe(5);
      expect(detail.crossSellingRules).toHaveLength(1);
      expect(detail.crossSellingRules[0]?.needType).toBe("DSL");
    });

    it("createDraftRuleSetVersion() mit nicht existierender copyFromVersionId -> CopySourceRuleSetVersionNotFoundError", async () => {
      const tenantId = await createTenant("svc-copy-missing");
      const actorUserId = await createUser(tenantId, "actor");
      const ruleSetId = await createEmptyRuleSet(tenantId, "rs");
      await expect(
        runWithTenantContext(
          { tenantId, userId: actorUserId, roles: [], managementScope: null },
          () =>
            createDraftRuleSetVersion(ruleSetId, {
              label: "Entwurf",
              copyFromVersionId: randomUUID(),
            }),
        ),
      ).rejects.toThrow(CopySourceRuleSetVersionNotFoundError);
    });

    it("createDraftRuleSetVersion() mit copyFromVersionId aus FREMDEM Mandanten -> CopySourceRuleSetVersionNotFoundError (Tenant-Isolation)", async () => {
      const tenantA = await createTenant("svc-tenant-a");
      const tenantB = await createTenant("svc-tenant-b");
      const actorA = await createUser(tenantA, "actor-a");
      const { activeVersionId: foreignVersionId } = await createRuleSetWithActiveVersion(
        tenantB,
        "rs",
      );
      const ruleSetId = await createEmptyRuleSet(tenantA, "rs");
      await expect(
        runWithTenantContext(
          { tenantId: tenantA, userId: actorA, roles: [], managementScope: null },
          () =>
            createDraftRuleSetVersion(ruleSetId, {
              label: "Entwurf",
              copyFromVersionId: foreignVersionId,
            }),
        ),
      ).rejects.toThrow(CopySourceRuleSetVersionNotFoundError);
    });
  });

  // -------------------------------------------------------------------
  // 2. HTTP-Kette
  // -------------------------------------------------------------------
  describe("2. HTTP-Kette", () => {
    it("GET /api/admin/rule-sets ohne config.rules.view -> 403", async () => {
      const tenantId = await createTenant("http-403-list");
      const actorUserId = await createUser(tenantId, "actor");
      const token = createSessionToken(baseSessionPayload(tenantId, actorUserId));
      const response = await listRuleSetsRoute(
        requestWithCookie("http://localhost/api/admin/rule-sets", token),
      );
      expect(response.status).toBe(403);
    });

    it("GET /api/admin/rule-sets mit config.rules.view -> 200 mit Liste", async () => {
      const tenantId = await createTenant("http-200-list");
      const actorUserId = await createUser(tenantId, "actor");
      await createRuleSetWithActiveVersion(tenantId, "rs");
      const token = createSessionToken({
        ...baseSessionPayload(tenantId, actorUserId),
        configPermissions: ["config.rules.view"],
      });
      const response = await listRuleSetsRoute(
        requestWithCookie("http://localhost/api/admin/rule-sets", token),
      );
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.ruleSets.length).toBeGreaterThanOrEqual(1);
    });

    it("GET .../versions/:versionId mit config.rules.view -> 200 mit Detail", async () => {
      const tenantId = await createTenant("http-200-detail");
      const actorUserId = await createUser(tenantId, "actor");
      const { ruleSetId, activeVersionId } = await createRuleSetWithActiveVersion(tenantId, "rs");
      const token = createSessionToken({
        ...baseSessionPayload(tenantId, actorUserId),
        configPermissions: ["config.rules.view"],
      });
      const response = await getRuleSetVersionDetailRoute(
        requestWithCookie(
          `http://localhost/api/admin/rule-sets/${ruleSetId}/versions/${activeVersionId}`,
          token,
        ),
        routeParams({ id: ruleSetId, versionId: activeVersionId }),
      );
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.version.eligibilityRules).toHaveLength(1);
    });

    it("POST .../versions ohne config.rules.edit -> 403", async () => {
      const tenantId = await createTenant("http-403-post");
      const actorUserId = await createUser(tenantId, "actor");
      const ruleSetId = await createEmptyRuleSet(tenantId, "rs");
      const token = createSessionToken({
        ...baseSessionPayload(tenantId, actorUserId),
        configPermissions: ["config.rules.view"],
      });
      const response = await createDraftRuleSetVersionRoute(
        requestWithCookie(`http://localhost/api/admin/rule-sets/${ruleSetId}/versions`, token, {
          method: "POST",
          body: JSON.stringify({ label: "Entwurf" }),
        }),
        routeParams({ id: ruleSetId }),
      );
      expect(response.status).toBe(403);
    });

    it("POST .../versions mit config.rules.edit + RuleSet-uebergreifender Kopie -> 201", async () => {
      const tenantId = await createTenant("http-201-cross");
      const actorUserId = await createUser(tenantId, "actor");
      const { activeVersionId: sourceVersionId } = await createRuleSetWithActiveVersion(
        tenantId,
        "rs-source",
      );
      const targetRuleSetId = await createEmptyRuleSet(tenantId, "rs-target");
      const token = createSessionToken({
        ...baseSessionPayload(tenantId, actorUserId),
        configPermissions: ["config.rules.edit"],
      });
      const response = await createDraftRuleSetVersionRoute(
        requestWithCookie(
          `http://localhost/api/admin/rule-sets/${targetRuleSetId}/versions`,
          token,
          {
            method: "POST",
            body: JSON.stringify({
              label: "HTTP Entwurf RuleSet-uebergreifend",
              copyFromVersionId: sourceVersionId,
            }),
          },
        ),
        routeParams({ id: targetRuleSetId }),
      );
      expect(response.status).toBe(201);
      const body = await response.json();
      expect(body.version.ruleSetId).toBe(targetRuleSetId);
      expect(body.version.status).toBe("DRAFT");
      expect(body.version.eligibilityRules).toHaveLength(1);
      expect(body.version.exclusionRules).toHaveLength(1);
      expect(body.version.prioritizationRules).toHaveLength(1);
      expect(body.version.crossSellingRules).toHaveLength(1);
    });

    it("POST .../versions mit ungueltigem Body (fehlendes label) -> 400", async () => {
      const tenantId = await createTenant("http-400-post");
      const actorUserId = await createUser(tenantId, "actor");
      const ruleSetId = await createEmptyRuleSet(tenantId, "rs");
      const token = createSessionToken({
        ...baseSessionPayload(tenantId, actorUserId),
        configPermissions: ["config.rules.edit"],
      });
      const response = await createDraftRuleSetVersionRoute(
        requestWithCookie(`http://localhost/api/admin/rule-sets/${ruleSetId}/versions`, token, {
          method: "POST",
          body: JSON.stringify({}),
        }),
        routeParams({ id: ruleSetId }),
      );
      expect(response.status).toBe(400);
    });
  });

  // -------------------------------------------------------------------
  // 3. Auditierung (Phase 9 AP2, von Anfang an eingebaut)
  // -------------------------------------------------------------------
  describe("3. Auditierung", () => {
    it("createDraftRuleSetVersion() schreibt einen AuditLog-Eintrag (action CREATE, entityType RuleSetVersion)", async () => {
      const tenantId = await createTenant("audit-create");
      const actorUserId = await createUser(tenantId, "actor");
      const ruleSetId = await createEmptyRuleSet(tenantId, "rs");
      const detail = await runWithTenantContext(
        { tenantId, userId: actorUserId, roles: [], managementScope: null },
        () => createDraftRuleSetVersion(ruleSetId, { label: "Entwurf" }),
      );
      const auditEntries = await rawClient.auditLog.findMany({
        where: { tenantId, entityType: "RuleSetVersion", entityId: detail.id },
      });
      expect(auditEntries).toHaveLength(1);
      expect(auditEntries[0]?.action).toBe("CREATE");
      expect(auditEntries[0]?.actorUserId).toBe(actorUserId);
    });
  });
});
