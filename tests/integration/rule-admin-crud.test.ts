/**
 * Phase 9 AP3 -- Integrationstests fuer das Rule-CRUD (flacher
 * Condition-Baum, alle vier Regeltypen), siehe
 * PHASE_9_IMPLEMENTATION_PLAN.md Abschnitt 5. Testet die Service-Schicht
 * (`src/server/admin/rule-admin.ts`, direkt innerhalb
 * `runWithTenantContext()`) gegen ECHTE Postgres-Fixtures (kein `vi.mock`,
 * Codebase-Konvention), sowie stichprobenartig die volle HTTP-Kette am
 * Beispiel `EligibilityRule` (die RBAC-/Fehler-Mapping-Logik ist fuer alle
 * vier Regeltypen identisch, siehe Routen-Dateien).
 *
 * Deckt explizit die von ChatGPT geforderten Punkte ab (2026-08-18):
 * DRAFT-only fuer saemtliche Mutationen, alle vier Regeltypen, keine
 * Moeglichkeit ueber manipulierte IDs die Tenant-/Versions-Grenze zu
 * umgehen, Audit je tatsaechlicher Mutation.
 *
 * Ohne DATABASE_URL wird die gesamte Suite uebersprungen statt fehlzuschlagen.
 *
 * WICHTIG (CI #51-Fix, 2026-08-19): jede Mutation ueber
 * `runWithTenantContext({ ..., userId, ... })` schreibt innerhalb derselben
 * Transaktion einen `AuditLog`-Eintrag mit `actorUserId = userId` -- die
 * Spalte ist per FK (`audit_logs_tenant_id_actor_user_id_fkey`) an eine
 * ECHTE `users`-Zeile desselben Mandanten gebunden. Ein frei erfundener
 * `randomUUID()` als Actor (ohne zugehoerige `User`-Zeile) verletzt diese
 * Constraint und laesst die GESAMTE Transaktion (inkl. der eigentlich
 * getesteten Mutation) fehlschlagen -- dieser Fehler blieb bislang
 * unentdeckt, weil `npx vitest run` im Sandbox nicht lauffaehig ist
 * (fehlendes @rollup/rollup-linux-arm64-gnu-Binary) und diese Datei vor dem
 * heutigen Batch-Push nie tatsaechlich gegen eine echte Postgres-Instanz in
 * CI lief. Fix: jeder Aufruf, der eine tatsaechliche Mutation ausloest (also
 * potenziell einen AuditLog schreibt), verwendet jetzt einen ueber
 * `createUser()` echten, dem jeweiligen Mandanten zugeordneten Actor statt
 * eines frei erfundenen `randomUUID()`. Rein lesende Aufrufe sowie Faelle,
 * die VOR jeder Mutation mit einem Fehler abbrechen (z. B. RBAC-403 oder
 * "gegen ACTIVE-Version"-Guards, die vor dem Transaktionsstart pruefen),
 * benoetigen weiterhin keinen echten Actor, werden hier aber aus
 * Konsistenzgruenden ebenfalls auf echte Actors umgestellt.
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
  addCrossSellingRuleToDraft,
  addEligibilityRuleToDraft,
  addExclusionRuleToDraft,
  addPrioritizationRuleToDraft,
  getRuleSetVersionDetail,
  removeCrossSellingRuleFromDraft,
  removeEligibilityRuleFromDraft,
  removeExclusionRuleFromDraft,
  removePrioritizationRuleFromDraft,
  updateCrossSellingRuleInDraft,
  updateEligibilityRuleInDraft,
  updateExclusionRuleInDraft,
  updatePrioritizationRuleInDraft,
} from "@/server/admin/rule-admin";
import {
  AdminRuleNotFoundError,
  RuleSetVersionNotDraftError,
} from "@/server/admin/rule-admin-errors";
import { POST as addEligibilityRuleRoute } from "@/app/api/admin/rule-sets/[id]/versions/[versionId]/eligibility-rules/route";
import {
  DELETE as deleteEligibilityRuleRoute,
  PATCH as patchEligibilityRuleRoute,
} from "@/app/api/admin/rule-sets/[id]/versions/[versionId]/eligibility-rules/[ruleId]/route";

const hasDatabaseUrl = Boolean(process.env.DATABASE_URL);
process.env.DEV_AUTH_SECRET ??= "ap3-rule-admin-crud-test-secret-not-for-prod";

describe.skipIf(!hasDatabaseUrl)("Phase 9 AP3: Rule-CRUD (flacher Condition-Baum)", () => {
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
      consultationPermissions: [],
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

  async function createRuleSetWithVersion(
    tenantId: string,
    key: string,
    status: "DRAFT" | "ACTIVE",
  ) {
    const ruleSet = await rawClient.ruleSet.create({ data: { tenantId, key: `${key}-${suffix}` } });
    const version = await rawClient.ruleSetVersion.create({
      data: {
        tenantId,
        ruleSetId: ruleSet.id,
        label: status === "DRAFT" ? "draft" : "v1",
        status,
        validFrom: new Date(),
        validTo: null,
      },
    });
    return { ruleSetId: ruleSet.id, versionId: version.id };
  }

  const sampleCondition = {
    groupIndex: 0,
    sourceType: "SESSION_ATTRIBUTE" as const,
    attributeKey: "region",
    operator: "EQUALS" as const,
    comparisonValue: "nord",
  };

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
  // 1. EligibilityRule
  // -------------------------------------------------------------------
  describe("1. EligibilityRule", () => {
    it("addEligibilityRuleToDraft() erstellt Regel + Condition in einer DRAFT-Version", async () => {
      const tenantId = await createTenant("elig-add");
      const actorUserId = await createUser(tenantId, "actor");
      const { ruleSetId, versionId } = await createRuleSetWithVersion(tenantId, "rs", "DRAFT");
      const rule = await runWithTenantContext(
        { tenantId, userId: actorUserId, roles: [], managementScope: null },
        () =>
          addEligibilityRuleToDraft(ruleSetId, versionId, {
            key: "elig-1",
            description: "Test",
            isRequired: true,
            fitWeight: 0,
            isActive: true,
            conditions: [sampleCondition],
          }),
      );
      expect(rule.key).toBe("elig-1");
      expect(rule.conditions).toHaveLength(1);
    });

    it("addEligibilityRuleToDraft() gegen ACTIVE-Version -> RuleSetVersionNotDraftError", async () => {
      const tenantId = await createTenant("elig-add-active");
      const actorUserId = await createUser(tenantId, "actor");
      const { ruleSetId, versionId } = await createRuleSetWithVersion(tenantId, "rs", "ACTIVE");
      await expect(
        runWithTenantContext(
          { tenantId, userId: actorUserId, roles: [], managementScope: null },
          () =>
            addEligibilityRuleToDraft(ruleSetId, versionId, {
              key: "elig-1",
              description: "Test",
              isRequired: true,
              fitWeight: 0,
              isActive: true,
              conditions: [],
            }),
        ),
      ).rejects.toThrow(RuleSetVersionNotDraftError);
    });

    it("updateEligibilityRuleInDraft() aktualisiert Felder und ersetzt Conditions vollstaendig", async () => {
      const tenantId = await createTenant("elig-update");
      const actorUserId = await createUser(tenantId, "actor");
      const { ruleSetId, versionId } = await createRuleSetWithVersion(tenantId, "rs", "DRAFT");
      const rule = await runWithTenantContext(
        { tenantId, userId: actorUserId, roles: [], managementScope: null },
        () =>
          addEligibilityRuleToDraft(ruleSetId, versionId, {
            key: "elig-1",
            description: "Alt",
            isRequired: true,
            fitWeight: 0,
            isActive: true,
            conditions: [sampleCondition],
          }),
      );
      const updated = await runWithTenantContext(
        { tenantId, userId: actorUserId, roles: [], managementScope: null },
        () =>
          updateEligibilityRuleInDraft(ruleSetId, versionId, rule.id, {
            description: "Neu",
            fitWeight: 5,
            conditions: [{ ...sampleCondition, comparisonValue: "sued" }],
          }),
      );
      expect(updated.description).toBe("Neu");
      expect(updated.fitWeight).toBe(5);
      expect(updated.conditions).toHaveLength(1);
      expect(updated.conditions[0]?.comparisonValue).toBe("sued");
    });

    it("updateEligibilityRuleInDraft() mit ruleId aus ANDERER Version -> AdminRuleNotFoundError (Tenant-/Versions-Grenze)", async () => {
      const tenantId = await createTenant("elig-update-foreign");
      const actorUserId = await createUser(tenantId, "actor");
      const { ruleSetId: ruleSetA, versionId: versionA } = await createRuleSetWithVersion(
        tenantId,
        "rs-a",
        "DRAFT",
      );
      const { ruleSetId: ruleSetB, versionId: versionB } = await createRuleSetWithVersion(
        tenantId,
        "rs-b",
        "DRAFT",
      );
      const ruleInA = await runWithTenantContext(
        { tenantId, userId: actorUserId, roles: [], managementScope: null },
        () =>
          addEligibilityRuleToDraft(ruleSetA, versionA, {
            key: "elig-a",
            description: "A",
            isRequired: true,
            fitWeight: 0,
            isActive: true,
            conditions: [],
          }),
      );
      await expect(
        runWithTenantContext(
          { tenantId, userId: actorUserId, roles: [], managementScope: null },
          () =>
            updateEligibilityRuleInDraft(ruleSetB, versionB, ruleInA.id, { description: "Hack" }),
        ),
      ).rejects.toThrow(AdminRuleNotFoundError);
    });

    it("removeEligibilityRuleFromDraft() entfernt Regel + Conditions vollstaendig", async () => {
      const tenantId = await createTenant("elig-remove");
      const actorUserId = await createUser(tenantId, "actor");
      const { ruleSetId, versionId } = await createRuleSetWithVersion(tenantId, "rs", "DRAFT");
      const rule = await runWithTenantContext(
        { tenantId, userId: actorUserId, roles: [], managementScope: null },
        () =>
          addEligibilityRuleToDraft(ruleSetId, versionId, {
            key: "elig-1",
            description: "Test",
            isRequired: true,
            fitWeight: 0,
            isActive: true,
            conditions: [sampleCondition],
          }),
      );
      await runWithTenantContext(
        { tenantId, userId: actorUserId, roles: [], managementScope: null },
        () => removeEligibilityRuleFromDraft(ruleSetId, versionId, rule.id),
      );
      const detail = await runWithTenantContext(
        { tenantId, userId: actorUserId, roles: [], managementScope: null },
        () => getRuleSetVersionDetail(ruleSetId, versionId),
      );
      expect(detail.eligibilityRules).toHaveLength(0);
      const remainingConditions = await rawClient.eligibilityRuleCondition.findMany({
        where: { eligibilityRuleId: rule.id },
      });
      expect(remainingConditions).toHaveLength(0);
    });

    it("addEligibilityRuleToDraft() schreibt AuditLog (CREATE), removeEligibilityRuleFromDraft() (DELETE)", async () => {
      const tenantId = await createTenant("elig-audit");
      const actorUserId = await createUser(tenantId, "actor");
      const { ruleSetId, versionId } = await createRuleSetWithVersion(tenantId, "rs", "DRAFT");
      const rule = await runWithTenantContext(
        { tenantId, userId: actorUserId, roles: [], managementScope: null },
        () =>
          addEligibilityRuleToDraft(ruleSetId, versionId, {
            key: "elig-1",
            description: "Test",
            isRequired: true,
            fitWeight: 0,
            isActive: true,
            conditions: [],
          }),
      );
      await runWithTenantContext(
        { tenantId, userId: actorUserId, roles: [], managementScope: null },
        () => removeEligibilityRuleFromDraft(ruleSetId, versionId, rule.id),
      );
      const auditEntries = await rawClient.auditLog.findMany({
        where: { tenantId, entityType: "EligibilityRule", entityId: rule.id },
        orderBy: { occurredAt: "asc" },
      });
      expect(auditEntries.map((a) => a.action)).toEqual(["CREATE", "DELETE"]);
    });
  });

  // -------------------------------------------------------------------
  // 2. ExclusionRule
  // -------------------------------------------------------------------
  describe("2. ExclusionRule", () => {
    it("addExclusionRuleToDraft()/updateExclusionRuleInDraft()/removeExclusionRuleFromDraft() Zyklus", async () => {
      const tenantId = await createTenant("excl-cycle");
      const actorUserId = await createUser(tenantId, "actor");
      const { ruleSetId, versionId } = await createRuleSetWithVersion(tenantId, "rs", "DRAFT");
      const rule = await runWithTenantContext(
        { tenantId, userId: actorUserId, roles: [], managementScope: null },
        () =>
          addExclusionRuleToDraft(ruleSetId, versionId, {
            key: "excl-1",
            reasonCode: "REASON_1",
            description: "Test",
            isActive: true,
            conditions: [sampleCondition],
          }),
      );
      expect(rule.reasonCode).toBe("REASON_1");

      const updated = await runWithTenantContext(
        { tenantId, userId: actorUserId, roles: [], managementScope: null },
        () => updateExclusionRuleInDraft(ruleSetId, versionId, rule.id, { reasonCode: "REASON_2" }),
      );
      expect(updated.reasonCode).toBe("REASON_2");

      await runWithTenantContext(
        { tenantId, userId: actorUserId, roles: [], managementScope: null },
        () => removeExclusionRuleFromDraft(ruleSetId, versionId, rule.id),
      );
      const detail = await runWithTenantContext(
        { tenantId, userId: actorUserId, roles: [], managementScope: null },
        () => getRuleSetVersionDetail(ruleSetId, versionId),
      );
      expect(detail.exclusionRules).toHaveLength(0);
    });

    it("addExclusionRuleToDraft() gegen ACTIVE-Version -> RuleSetVersionNotDraftError", async () => {
      const tenantId = await createTenant("excl-active");
      const actorUserId = await createUser(tenantId, "actor");
      const { ruleSetId, versionId } = await createRuleSetWithVersion(tenantId, "rs", "ACTIVE");
      await expect(
        runWithTenantContext(
          { tenantId, userId: actorUserId, roles: [], managementScope: null },
          () =>
            addExclusionRuleToDraft(ruleSetId, versionId, {
              key: "excl-1",
              reasonCode: "REASON_1",
              description: "Test",
              isActive: true,
              conditions: [],
            }),
        ),
      ).rejects.toThrow(RuleSetVersionNotDraftError);
    });
  });

  // -------------------------------------------------------------------
  // 3. PrioritizationRule
  // -------------------------------------------------------------------
  describe("3. PrioritizationRule", () => {
    it("addPrioritizationRuleToDraft()/updatePrioritizationRuleInDraft()/removePrioritizationRuleFromDraft() Zyklus", async () => {
      const tenantId = await createTenant("prio-cycle");
      const actorUserId = await createUser(tenantId, "actor");
      const { ruleSetId, versionId } = await createRuleSetWithVersion(tenantId, "rs", "DRAFT");
      const rule = await runWithTenantContext(
        { tenantId, userId: actorUserId, roles: [], managementScope: null },
        () =>
          addPrioritizationRuleToDraft(ruleSetId, versionId, {
            key: "prio-1",
            description: "Test",
            weight: 3,
            commissionRequired: false,
            isActive: true,
            conditions: [sampleCondition],
          }),
      );
      expect(rule.weight).toBe(3);

      const updated = await runWithTenantContext(
        { tenantId, userId: actorUserId, roles: [], managementScope: null },
        () => updatePrioritizationRuleInDraft(ruleSetId, versionId, rule.id, { weight: 7 }),
      );
      expect(updated.weight).toBe(7);

      await runWithTenantContext(
        { tenantId, userId: actorUserId, roles: [], managementScope: null },
        () => removePrioritizationRuleFromDraft(ruleSetId, versionId, rule.id),
      );
      const detail = await runWithTenantContext(
        { tenantId, userId: actorUserId, roles: [], managementScope: null },
        () => getRuleSetVersionDetail(ruleSetId, versionId),
      );
      expect(detail.prioritizationRules).toHaveLength(0);
    });

    it("updatePrioritizationRuleInDraft() mit ruleId aus fremdem Mandanten -> AdminRuleNotFoundError", async () => {
      const tenantA = await createTenant("prio-tenant-a");
      const tenantB = await createTenant("prio-tenant-b");
      const actorA = await createUser(tenantA, "actor-a");
      const actorB = await createUser(tenantB, "actor-b");
      const { ruleSetId: ruleSetB, versionId: versionB } = await createRuleSetWithVersion(
        tenantB,
        "rs",
        "DRAFT",
      );
      const ruleInB = await runWithTenantContext(
        { tenantId: tenantB, userId: actorB, roles: [], managementScope: null },
        () =>
          addPrioritizationRuleToDraft(ruleSetB, versionB, {
            key: "prio-b",
            description: "B",
            weight: 1,
            commissionRequired: false,
            isActive: true,
            conditions: [],
          }),
      );
      const { ruleSetId: ruleSetA, versionId: versionA } = await createRuleSetWithVersion(
        tenantA,
        "rs",
        "DRAFT",
      );
      await expect(
        runWithTenantContext(
          { tenantId: tenantA, userId: actorA, roles: [], managementScope: null },
          () => updatePrioritizationRuleInDraft(ruleSetA, versionA, ruleInB.id, { weight: 99 }),
        ),
      ).rejects.toThrow(AdminRuleNotFoundError);
    });
  });

  // -------------------------------------------------------------------
  // 4. CrossSellingRule
  // -------------------------------------------------------------------
  describe("4. CrossSellingRule", () => {
    it("addCrossSellingRuleToDraft()/updateCrossSellingRuleInDraft()/removeCrossSellingRuleFromDraft() Zyklus", async () => {
      const tenantId = await createTenant("css-cycle");
      const actorUserId = await createUser(tenantId, "actor");
      const { ruleSetId, versionId } = await createRuleSetWithVersion(tenantId, "rs", "DRAFT");
      const rule = await runWithTenantContext(
        { tenantId, userId: actorUserId, roles: [], managementScope: null },
        () =>
          addCrossSellingRuleToDraft(ruleSetId, versionId, {
            key: "css-1",
            description: "Test",
            needType: "DSL",
            priority: 1,
            reasonCode: "CSS_REASON_1",
            isActive: true,
            conditions: [sampleCondition],
          }),
      );
      expect(rule.needType).toBe("DSL");

      const updated = await runWithTenantContext(
        { tenantId, userId: actorUserId, roles: [], managementScope: null },
        () => updateCrossSellingRuleInDraft(ruleSetId, versionId, rule.id, { needType: "FIBER" }),
      );
      expect(updated.needType).toBe("FIBER");

      await runWithTenantContext(
        { tenantId, userId: actorUserId, roles: [], managementScope: null },
        () => removeCrossSellingRuleFromDraft(ruleSetId, versionId, rule.id),
      );
      const detail = await runWithTenantContext(
        { tenantId, userId: actorUserId, roles: [], managementScope: null },
        () => getRuleSetVersionDetail(ruleSetId, versionId),
      );
      expect(detail.crossSellingRules).toHaveLength(0);
    });

    it("removeCrossSellingRuleFromDraft() gegen ACTIVE-Version -> RuleSetVersionNotDraftError", async () => {
      const tenantId = await createTenant("css-active");
      const actorUserId = await createUser(tenantId, "actor");
      const { ruleSetId, versionId: draftVersionId } = await createRuleSetWithVersion(
        tenantId,
        "rs",
        "DRAFT",
      );
      const rule = await runWithTenantContext(
        { tenantId, userId: actorUserId, roles: [], managementScope: null },
        () =>
          addCrossSellingRuleToDraft(ruleSetId, draftVersionId, {
            key: "css-1",
            description: "Test",
            needType: "DSL",
            priority: 1,
            reasonCode: "CSS_REASON_1",
            isActive: true,
            conditions: [],
          }),
      );
      // Version manuell auf ACTIVE setzen, um den Guard unabhaengig vom
      // eigentlichen Publish-Workflow (erst AP5) zu pruefen.
      await rawClient.ruleSetVersion.update({
        where: { id: draftVersionId },
        data: { status: "ACTIVE" },
      });
      await expect(
        runWithTenantContext(
          { tenantId, userId: actorUserId, roles: [], managementScope: null },
          () => removeCrossSellingRuleFromDraft(ruleSetId, draftVersionId, rule.id),
        ),
      ).rejects.toThrow(RuleSetVersionNotDraftError);
    });
  });

  // -------------------------------------------------------------------
  // 5. HTTP-Kette (stichprobenartig anhand EligibilityRule)
  // -------------------------------------------------------------------
  describe("5. HTTP-Kette", () => {
    it("POST .../eligibility-rules ohne config.rules.edit -> 403", async () => {
      const tenantId = await createTenant("http-403-add");
      const actorUserId = await createUser(tenantId, "actor");
      const { ruleSetId, versionId } = await createRuleSetWithVersion(tenantId, "rs", "DRAFT");
      const token = createSessionToken({
        ...baseSessionPayload(tenantId, actorUserId),
        configPermissions: ["config.rules.view"],
      });
      const response = await addEligibilityRuleRoute(
        requestWithCookie(
          `http://localhost/api/admin/rule-sets/${ruleSetId}/versions/${versionId}/eligibility-rules`,
          token,
          { method: "POST", body: JSON.stringify({ key: "x" }) },
        ),
        routeParams({ id: ruleSetId, versionId }),
      );
      expect(response.status).toBe(403);
    });

    it("POST -> PATCH -> DELETE .../eligibility-rules/:ruleId mit config.rules.edit -> 201/200/204", async () => {
      const tenantId = await createTenant("http-cycle");
      const actorUserId = await createUser(tenantId, "actor");
      const { ruleSetId, versionId } = await createRuleSetWithVersion(tenantId, "rs", "DRAFT");
      const token = createSessionToken({
        ...baseSessionPayload(tenantId, actorUserId),
        configPermissions: ["config.rules.edit"],
      });

      const createResponse = await addEligibilityRuleRoute(
        requestWithCookie(
          `http://localhost/api/admin/rule-sets/${ruleSetId}/versions/${versionId}/eligibility-rules`,
          token,
          {
            method: "POST",
            body: JSON.stringify({
              key: "http-elig-1",
              description: "Test",
              isRequired: true,
              fitWeight: 0,
              isActive: true,
              conditions: [sampleCondition],
            }),
          },
        ),
        routeParams({ id: ruleSetId, versionId }),
      );
      expect(createResponse.status).toBe(201);
      const createBody = await createResponse.json();
      const ruleId = createBody.rule.id as string;

      const patchResponse = await patchEligibilityRuleRoute(
        requestWithCookie(
          `http://localhost/api/admin/rule-sets/${ruleSetId}/versions/${versionId}/eligibility-rules/${ruleId}`,
          token,
          { method: "PATCH", body: JSON.stringify({ fitWeight: 9 }) },
        ),
        routeParams({ id: ruleSetId, versionId, ruleId }),
      );
      expect(patchResponse.status).toBe(200);
      const patchBody = await patchResponse.json();
      expect(patchBody.rule.fitWeight).toBe(9);

      const deleteResponse = await deleteEligibilityRuleRoute(
        requestWithCookie(
          `http://localhost/api/admin/rule-sets/${ruleSetId}/versions/${versionId}/eligibility-rules/${ruleId}`,
          token,
          { method: "DELETE" },
        ),
        routeParams({ id: ruleSetId, versionId, ruleId }),
      );
      expect(deleteResponse.status).toBe(204);
    });

    it("PATCH .../eligibility-rules/:ruleId gegen ACTIVE-Version -> 409", async () => {
      const tenantId = await createTenant("http-409-patch");
      const actorUserId = await createUser(tenantId, "actor");
      const { ruleSetId, versionId } = await createRuleSetWithVersion(tenantId, "rs", "DRAFT");
      const token = createSessionToken({
        ...baseSessionPayload(tenantId, actorUserId),
        configPermissions: ["config.rules.edit"],
      });
      const rule = await runWithTenantContext(
        { tenantId, userId: actorUserId, roles: [], managementScope: null },
        () =>
          addEligibilityRuleToDraft(ruleSetId, versionId, {
            key: "elig-1",
            description: "Test",
            isRequired: true,
            fitWeight: 0,
            isActive: true,
            conditions: [],
          }),
      );
      await rawClient.ruleSetVersion.update({
        where: { id: versionId },
        data: { status: "ACTIVE" },
      });

      const response = await patchEligibilityRuleRoute(
        requestWithCookie(
          `http://localhost/api/admin/rule-sets/${ruleSetId}/versions/${versionId}/eligibility-rules/${rule.id}`,
          token,
          { method: "PATCH", body: JSON.stringify({ fitWeight: 1 }) },
        ),
        routeParams({ id: ruleSetId, versionId, ruleId: rule.id }),
      );
      expect(response.status).toBe(409);
    });
  });
});
