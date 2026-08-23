/**
 * Phase 9 AP7 -- Gezielte Audit-Re-Pruefung der gesamten Mutationskette
 * AP1-AP6 (siehe PHASE_9_IMPLEMENTATION_PLAN.md Abschnitt 9 sowie ChatGPTs
 * expliziter Pruefkatalog vom 2026-08-18). KEIN neuer fachlicher Scope --
 * reine Verifikation bereits bestehenden Verhaltens, analog Phase 8 AP7.
 *
 * Deckt zwei Aspekte ab, die die bisherigen AP2/AP3/AP4/AP5/AP6-Testdateien
 * jeweils nur einzeln/indirekt abdecken:
 *
 * 1) Die VOLLSTAENDIGE Mutationskette (Draft erstellen -> Regel hinzufuegen
 *    -> Regel aendern -> Regel loeschen -> Publish -> Rollback) erzeugt
 *    GENAU die von ChatGPT vorgegebene Audit-Abfolge, chronologisch korrekt.
 * 2) Fehlgeschlagene Operationen (403/404/409) hinterlassen NIEMALS einen
 *    (auch keinen teilweisen) AuditLog-Eintrag -- Beleg dafuer, dass alle
 *    Guards (`requireRuleSet`/`requireDraftRuleSetVersion`/Existenzpruefung)
 *    strukturell VOR jedem `db.$transaction()`-Block liegen (siehe
 *    rule-admin.ts). Der 422-Fall (Publish eines ungueltigen Drafts) ist
 *    bereits in rule-admin-publish.test.ts abgedeckt und wird hier bewusst
 *    nicht dupliziert.
 *
 * tenantId/actorUserId stammen in JEDER Mutation ausschliesslich aus
 * `getTenantId()`/`getTenantContext().userId` (Server-Kontext) -- keines der
 * Input-Schemas (`rule-schemas.ts`) besitzt ueberhaupt ein `tenantId`- oder
 * `actorUserId`-Feld, ein client-seitiges Ueberschreiben ist also bereits
 * strukturell (nicht nur laufzeitseitig) ausgeschlossen; kein separater Test
 * noetig.
 *
 * Ohne DATABASE_URL wird die gesamte Suite uebersprungen statt fehlzuschlagen.
 *
 * WICHTIG (CI #51-Fix, 2026-08-19): der erste Testfall (vollstaendige
 * Mutationskette) durchlaeuft ausschliesslich ECHTE Mutationen und schreibt
 * daher bei jedem Schritt einen `AuditLog`-Eintrag mit `actorUserId` --
 * diese Spalte ist per FK (`audit_logs_tenant_id_actor_user_id_fkey`) an
 * eine echte `users`-Zeile desselben Mandanten gebunden. Ein frei
 * erfundener `randomUUID()` (ohne zugehoerige `User`-Zeile) verletzt diese
 * Constraint. Die drei uebrigen Testfaelle (403/409/404) brechen jeweils VOR
 * jeder Mutation ab und schreiben daher bewusst NIE einen AuditLog-Eintrag
 * -- dort bleibt ein frei erfundener `randomUUID()` unschaedlich und wird
 * unveraendert beibehalten.
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
  createDraftRuleSetVersion,
  publishRuleSetVersion,
  removeEligibilityRuleFromDraft,
  rollbackToRuleSetVersion,
  updateEligibilityRuleInDraft,
} from "@/server/admin/rule-admin";
import { AdminRuleNotFoundError } from "@/server/admin/rule-admin-errors";
import { POST as versionsRoute } from "@/app/api/admin/rule-sets/[id]/versions/route";
import { PATCH as patchEligibilityRuleRoute } from "@/app/api/admin/rule-sets/[id]/versions/[versionId]/eligibility-rules/[ruleId]/route";

const hasDatabaseUrl = Boolean(process.env.DATABASE_URL);
process.env.DEV_AUTH_SECRET ??= "ap7-rule-admin-audit-regression-test-secret-not-for-prod";

describe.skipIf(!hasDatabaseUrl)("Phase 9 AP7: Audit-Re-Pruefung", () => {
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

  it("Vollstaendige Mutationskette erzeugt exakt die erwartete, chronologisch korrekte Audit-Abfolge", async () => {
    const tenantId = await createTenant("chain");
    const actorUserId = await createUser(tenantId, "actor");
    const ctx = { tenantId, userId: actorUserId, roles: [], managementScope: null };

    const { ruleSetId } = await createRuleSetWithVersion(tenantId, "rs", "ACTIVE");

    // 1. Draft erstellen -> CREATE / RuleSetVersion
    const draft = await runWithTenantContext(ctx, () =>
      createDraftRuleSetVersion(ruleSetId, { label: "chain-draft" }),
    );

    // 2. Regel hinzufuegen -> CREATE / EligibilityRule
    const rule = await runWithTenantContext(ctx, () =>
      addEligibilityRuleToDraft(ruleSetId, draft.id, {
        key: "elig-chain",
        description: "Test",
        isRequired: false,
        fitWeight: 1,
        isActive: true,
        conditions: [],
      }),
    );

    // 3. Regel aendern -> UPDATE / EligibilityRule
    await runWithTenantContext(ctx, () =>
      updateEligibilityRuleInDraft(ruleSetId, draft.id, rule.id, { fitWeight: 2 }),
    );

    // 4. Regel loeschen -> DELETE / EligibilityRule
    await runWithTenantContext(ctx, () =>
      removeEligibilityRuleFromDraft(ruleSetId, draft.id, rule.id),
    );

    // Fuer einen gueltigen (nicht-leeren) Draft vor dem Publish erneut eine Regel anlegen.
    await runWithTenantContext(ctx, () =>
      addEligibilityRuleToDraft(ruleSetId, draft.id, {
        key: "elig-chain-final",
        description: "Test",
        isRequired: false,
        fitWeight: 1,
        isActive: true,
        conditions: [],
      }),
    );

    // 5. Publish -> ACTIVATE / RuleSetVersion (+ previousActiveVersionId)
    const published = await runWithTenantContext(ctx, () =>
      publishRuleSetVersion(ruleSetId, draft.id),
    );

    // 6. Rollback -> ROLLBACK / RuleSetVersion (+ sourceVersionId)
    const rolledBack = await runWithTenantContext(ctx, () =>
      rollbackToRuleSetVersion(ruleSetId, published.version.id),
    );

    const auditEntries = await rawClient.auditLog.findMany({
      where: { tenantId },
      orderBy: { occurredAt: "asc" },
    });

    const observed = auditEntries.map((e) => `${e.action}/${e.entityType}`);

    expect(observed).toEqual([
      "CREATE/RuleSetVersion", // Draft erstellen
      "CREATE/EligibilityRule", // Regel hinzufuegen
      "UPDATE/EligibilityRule", // Regel aendern
      "DELETE/EligibilityRule", // Regel loeschen
      "CREATE/EligibilityRule", // erneut hinzufuegen (fuer gueltigen Draft)
      "ACTIVATE/RuleSetVersion", // Publish
      "ROLLBACK/RuleSetVersion", // Rollback
    ]);

    const activateEntry = auditEntries.find((e) => e.action === "ACTIVATE");
    expect(activateEntry?.metadata).toMatchObject({
      ruleSetId,
      previousActiveVersionId: expect.any(String),
    });

    const rollbackEntry = auditEntries.find((e) => e.action === "ROLLBACK");
    expect(rollbackEntry?.metadata).toMatchObject({
      ruleSetId,
      sourceVersionId: published.version.id,
    });
    expect(rollbackEntry?.entityId).toBe(rolledBack.id);

    // tenantId/actorUserId stammen ausschliesslich aus dem TenantContext, NICHT aus Client-Payloads.
    for (const entry of auditEntries) {
      expect(entry.tenantId).toBe(tenantId);
      expect(entry.actorUserId).toBe(ctx.userId);
    }
  });

  it("403 (fehlende config.rules.edit) hinterlaesst KEINEN AuditLog-Eintrag", async () => {
    const tenantId = await createTenant("no-audit-403");
    const { ruleSetId } = await createRuleSetWithVersion(tenantId, "rs", "ACTIVE");
    const token = createSessionToken({ ...baseSessionPayload(tenantId), configPermissions: [] });

    const response = await versionsRoute(
      new NextRequest(`http://localhost/api/admin/rule-sets/${ruleSetId}/versions`, {
        method: "POST",
        headers: new Headers({
          cookie: `${SESSION_COOKIE_NAME}=${token}`,
          "content-type": "application/json",
        }),
        body: JSON.stringify({ label: "should-not-be-created" }),
      }),
      { params: Promise.resolve({ id: ruleSetId }) },
    );
    expect(response.status).toBe(403);

    const auditEntries = await rawClient.auditLog.findMany({ where: { tenantId } });
    expect(auditEntries).toHaveLength(0);
  });

  it("409 (Mutation gegen bereits ACTIVE Version) hinterlaesst KEINEN AuditLog-Eintrag", async () => {
    const tenantId = await createTenant("no-audit-409");
    const { ruleSetId, versionId } = await createRuleSetWithVersion(tenantId, "rs", "ACTIVE");
    const rule = await rawClient.eligibilityRule.create({
      data: {
        tenantId,
        ruleSetVersionId: versionId,
        key: "elig-active",
        description: "Test",
        isRequired: false,
        fitWeight: 1,
        isActive: true,
      },
    });
    const token = createSessionToken({
      ...baseSessionPayload(tenantId),
      configPermissions: ["config.rules.edit"],
    });

    const response = await patchEligibilityRuleRoute(
      new NextRequest(
        `http://localhost/api/admin/rule-sets/${ruleSetId}/versions/${versionId}/eligibility-rules/${rule.id}`,
        {
          method: "PATCH",
          headers: new Headers({
            cookie: `${SESSION_COOKIE_NAME}=${token}`,
            "content-type": "application/json",
          }),
          body: JSON.stringify({ fitWeight: 5 }),
        },
      ),
      { params: Promise.resolve({ id: ruleSetId, versionId, ruleId: rule.id }) },
    );
    expect(response.status).toBe(409);

    const auditEntries = await rawClient.auditLog.findMany({ where: { tenantId } });
    expect(auditEntries).toHaveLength(0);
  });

  it("404 (unbekannte ruleId) hinterlaesst KEINEN AuditLog-Eintrag", async () => {
    const tenantId = await createTenant("no-audit-404");
    const { ruleSetId, versionId } = await createRuleSetWithVersion(tenantId, "rs", "DRAFT");

    await expect(
      runWithTenantContext(
        { tenantId, userId: randomUUID(), roles: [], managementScope: null },
        () => updateEligibilityRuleInDraft(ruleSetId, versionId, randomUUID(), { fitWeight: 5 }),
      ),
    ).rejects.toThrow(AdminRuleNotFoundError);

    const auditEntries = await rawClient.auditLog.findMany({ where: { tenantId } });
    expect(auditEntries).toHaveLength(0);
  });
});
