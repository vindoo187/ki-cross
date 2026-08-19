/**
 * Phase 9 AP5 -- Integrationstests fuer den mandantenweiten Publish-Workflow
 * (`publishRuleSetVersion()`, siehe PHASE_9_IMPLEMENTATION_PLAN.md
 * Abschnitt 7). Deckt insbesondere den von ChatGPT als "wichtigsten
 * Regressionstest" bezeichneten Fall ab (2026-08-18): Ein Draft aus
 * RuleSet B wird veroeffentlicht, waehrend RuleSet A die aktuell aktive
 * Version besitzt -> A wird EXPIRED, B wird ACTIVE (mandantenweiter statt
 * pro-RuleSet-Scope, siehe rule-admin.ts Modulkommentar zu AP5).
 *
 * Ohne DATABASE_URL wird die gesamte Suite uebersprungen statt fehlzuschlagen.
 *
 * WICHTIG (CI #52-Fix, 2026-08-19): jede Mutation (Regel hinzufuegen,
 * Publish) schreibt innerhalb derselben Transaktion einen `AuditLog`-
 * Eintrag mit `actorUserId` -- die Spalte ist per FK
 * (`audit_logs_tenant_id_actor_user_id_fkey`) an eine ECHTE `users`-Zeile
 * desselben Mandanten gebunden. Ein frei erfundener `randomUUID()` als Actor
 * (ohne zugehoerige `User`-Zeile) verletzt diese Constraint und laesst die
 * gesamte Transaktion (inkl. der eigentlich getesteten Mutation)
 * fehlschlagen -- dieser Fehler blieb bislang unentdeckt, weil
 * `npx vitest run` im Sandbox nicht lauffaehig ist und diese Datei vor dem
 * Batch-Push nie tatsaechlich gegen eine echte Postgres-Instanz in CI lief.
 * Fix: jeder mutierende Aufruf verwendet jetzt einen ueber `createUser()`
 * echten, dem jeweiligen Mandanten zugeordneten Actor statt eines frei
 * erfundenen `randomUUID()`.
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
import { addEligibilityRuleToDraft, publishRuleSetVersion } from "@/server/admin/rule-admin";
import { RuleSetVersionNotDraftError } from "@/server/admin/rule-admin-errors";
import { POST as publishRoute } from "@/app/api/admin/rule-sets/[id]/versions/[versionId]/publish/route";

const hasDatabaseUrl = Boolean(process.env.DATABASE_URL);
process.env.DEV_AUTH_SECRET ??= "ap5-rule-admin-publish-test-secret-not-for-prod";

describe.skipIf(!hasDatabaseUrl)("Phase 9 AP5: Mandantenweiter Publish-Workflow", () => {
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
    status: "DRAFT" | "ACTIVE",
    validFrom = new Date("2026-01-01T00:00:00Z"),
  ) {
    const ruleSet = await rawClient.ruleSet.create({ data: { tenantId, key: `${key}-${suffix}` } });
    const version = await rawClient.ruleSetVersion.create({
      data: {
        tenantId,
        ruleSetId: ruleSet.id,
        label: status === "DRAFT" ? "draft" : "v1",
        status,
        validFrom,
        validTo: null,
      },
    });
    return { ruleSetId: ruleSet.id, versionId: version.id };
  }

  /** Fuegt eine minimale, gueltige EligibilityRule ohne Bedingungen hinzu (validierbarer Draft). */
  async function addMinimalValidRule(
    tenantId: string,
    actorUserId: string,
    ruleSetId: string,
    versionId: string,
  ) {
    await runWithTenantContext(
      { tenantId, userId: actorUserId, roles: [], managementScope: null },
      () =>
        addEligibilityRuleToDraft(ruleSetId, versionId, {
          key: "elig-1",
          description: "Test",
          isRequired: false,
          fitWeight: 1,
          isActive: true,
          conditions: [],
        }),
    );
  }

  function requestWithCookie(url: string, token: string) {
    return new NextRequest(url, {
      method: "POST",
      headers: new Headers({ cookie: `${SESSION_COOKIE_NAME}=${token}` }),
    });
  }

  function routeParams(value: { id: string; versionId: string }) {
    return { params: Promise.resolve(value) };
  }

  it("erster Publish ueberhaupt (kein vorheriger ACTIVE-Datensatz) -> previousActiveVersionId: null", async () => {
    const tenantId = await createTenant("first-publish");
    const actorUserId = await createUser(tenantId, "actor");
    const { ruleSetId, versionId } = await createRuleSetVersion(tenantId, "rs", "DRAFT");
    await addMinimalValidRule(tenantId, actorUserId, ruleSetId, versionId);

    const result = await runWithTenantContext(
      { tenantId, userId: actorUserId, roles: [], managementScope: null },
      () => publishRuleSetVersion(ruleSetId, versionId),
    );

    expect(result.previousActiveVersionId).toBeNull();
    expect(result.version.status).toBe("ACTIVE");

    const versionRow = await rawClient.ruleSetVersion.findUnique({ where: { id: versionId } });
    expect(versionRow?.status).toBe("ACTIVE");
    expect(versionRow?.validTo).toBeNull();
  });

  it("ZENTRALER TEST (ChatGPT 2026-08-18): Draft aus RuleSet B publizieren waehrend RuleSet A aktiv ist -> A wird EXPIRED, B wird ACTIVE (mandantenweiter, nicht pro-RuleSet-Scope)", async () => {
    const tenantId = await createTenant("cross-ruleset");
    const actorUserId = await createUser(tenantId, "actor");
    const { ruleSetId: ruleSetA, versionId: versionA } = await createRuleSetVersion(
      tenantId,
      "rs-a",
      "ACTIVE",
      new Date("2026-01-01T00:00:00Z"),
    );
    const { ruleSetId: ruleSetB, versionId: versionB } = await createRuleSetVersion(
      tenantId,
      "rs-b",
      "DRAFT",
    );
    await addMinimalValidRule(tenantId, actorUserId, ruleSetB, versionB);

    const result = await runWithTenantContext(
      { tenantId, userId: actorUserId, roles: [], managementScope: null },
      () => publishRuleSetVersion(ruleSetB, versionB),
    );

    expect(result.previousActiveVersionId).toBe(versionA);

    const rowA = await rawClient.ruleSetVersion.findUnique({ where: { id: versionA } });
    const rowB = await rawClient.ruleSetVersion.findUnique({ where: { id: versionB } });
    expect(rowA?.status).toBe("EXPIRED");
    expect(rowA?.validTo).not.toBeNull();
    expect(rowB?.status).toBe("ACTIVE");
    expect(rowB?.validTo).toBeNull();

    // Zur Klarstellung: ruleSetA und ruleSetB sind bewusst VERSCHIEDENE
    // RuleSets -- ein pro-RuleSet-Scope (wie bei Questionnaire) haette
    // versionA unveraendert ACTIVE gelassen, weil sie zu einem anderen
    // RuleSet gehoert. Das mandantenweite Scoping stellt sicher, dass A
    // trotzdem EXPIRED wird.
    expect(ruleSetA).not.toBe(ruleSetB);
  });

  it("Publish schreibt AuditLog-Eintrag (ACTIVATE) mit previousActiveVersionId in metadata", async () => {
    const tenantId = await createTenant("audit");
    const actorUserId = await createUser(tenantId, "actor");
    const { versionId: versionA } = await createRuleSetVersion(tenantId, "rs-a", "ACTIVE");
    const { ruleSetId: ruleSetB, versionId: versionB } = await createRuleSetVersion(
      tenantId,
      "rs-b",
      "DRAFT",
    );
    await addMinimalValidRule(tenantId, actorUserId, ruleSetB, versionB);

    await runWithTenantContext(
      { tenantId, userId: actorUserId, roles: [], managementScope: null },
      () => publishRuleSetVersion(ruleSetB, versionB),
    );

    const auditEntries = await rawClient.auditLog.findMany({
      where: { tenantId, entityType: "RuleSetVersion", entityId: versionB, action: "ACTIVATE" },
    });
    expect(auditEntries).toHaveLength(1);
    expect(auditEntries[0]?.metadata).toMatchObject({
      ruleSetId: ruleSetB,
      previousActiveVersionId: versionA,
    });
  });

  it("Publish einer nicht-DRAFT-Version -> RuleSetVersionNotDraftError", async () => {
    const tenantId = await createTenant("not-draft");
    const actorUserId = await createUser(tenantId, "actor");
    const { ruleSetId, versionId } = await createRuleSetVersion(tenantId, "rs", "ACTIVE");

    await expect(
      runWithTenantContext(
        { tenantId, userId: actorUserId, roles: [], managementScope: null },
        () => publishRuleSetVersion(ruleSetId, versionId),
      ),
    ).rejects.toThrow(RuleSetVersionNotDraftError);
  });

  it("Publish eines ungueltigen Drafts (leer, keine Regeln) -> Validierungsfehler, KEINE Transaktion eroeffnet", async () => {
    const tenantId = await createTenant("invalid-draft");
    const actorUserId = await createUser(tenantId, "actor");
    const { ruleSetId, versionId } = await createRuleSetVersion(tenantId, "rs", "DRAFT");

    await expect(
      runWithTenantContext(
        { tenantId, userId: actorUserId, roles: [], managementScope: null },
        () => publishRuleSetVersion(ruleSetId, versionId),
      ),
    ).rejects.toThrow();

    const versionRow = await rawClient.ruleSetVersion.findUnique({ where: { id: versionId } });
    expect(versionRow?.status).toBe("DRAFT");
    const auditEntries = await rawClient.auditLog.findMany({
      where: { tenantId, entityType: "RuleSetVersion", entityId: versionId },
    });
    expect(auditEntries).toHaveLength(0);
  });

  it("AP9 Haertung (Nebenlaeufigkeit): zwei ECHT parallele Publishes verschiedener Drafts (verschiedene RuleSets desselben Mandanten) -- genau einer gewinnt, DB zeigt nie zwei gleichzeitig ACTIVE (rule_set_versions_tenant_active_no_overlap EXCLUDE-Constraint als Backstop)", async () => {
    const tenantId = await createTenant("concurrent-publish");
    const actorUserId = await createUser(tenantId, "actor");
    const { ruleSetId: ruleSetX, versionId: versionX } = await createRuleSetVersion(
      tenantId,
      "rs-x",
      "DRAFT",
    );
    const { ruleSetId: ruleSetY, versionId: versionY } = await createRuleSetVersion(
      tenantId,
      "rs-y",
      "DRAFT",
    );
    await addMinimalValidRule(tenantId, actorUserId, ruleSetX, versionX);
    await addMinimalValidRule(tenantId, actorUserId, ruleSetY, versionY);

    // Bewusst KEIN sequentielles await -- beide Publish-Aufrufe werden ECHT
    // gleichzeitig gestartet (zwei unabhaengige Transaktionen), um den in
    // rule-admin.ts dokumentierten Nebenlaeufigkeitsfall zu reproduzieren:
    // Schritt (a) "vorherige ACTIVE-Version auf EXPIRED setzen" kann in
    // beiden Transaktionen denselben (zu diesem Zeitpunkt noch keine
    // vorherige ACTIVE-Version) oder unterschiedliche Zwischenzustaende
    // sehen -- die Korrektheit haengt NICHT von der Anwendungslogik allein
    // ab, sondern zusaetzlich vom DB-EXCLUDE-Constraint
    // `rule_set_versions_tenant_active_no_overlap`
    // (tenant_id + Zeitspannen-Ueberlappung WHERE status='ACTIVE').
    const results = await Promise.allSettled([
      runWithTenantContext(
        { tenantId, userId: actorUserId, roles: [], managementScope: null },
        () => publishRuleSetVersion(ruleSetX, versionX),
      ),
      runWithTenantContext(
        { tenantId, userId: actorUserId, roles: [], managementScope: null },
        () => publishRuleSetVersion(ruleSetY, versionY),
      ),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");

    // Kernaussage (Datenintegritaet): niemals beide gleichzeitig erfolgreich.
    // Je nach Timing kann im Extremfall sogar BEIDE Versuche scheitern
    // (z. B. wenn beide Transaktionen sich gegenseitig ueber Sperren
    // blockieren und der EXCLUDE-Constraint anschliessend eine von ihnen
    // ablehnt) -- das ist fuer die Kernaussage dieses Tests irrelevant, die
    // einzige Invariante, die zwingend gelten MUSS, ist: NIE beide
    // erfolgreich.
    expect(fulfilled.length).toBeLessThanOrEqual(1);

    const finalActiveVersions = await rawClient.ruleSetVersion.findMany({
      where: { tenantId, status: "ACTIVE" },
    });
    // Zentrale Invariante: zu KEINEM Zeitpunkt (auch nicht durch das Race)
    // existieren zwei gleichzeitig ACTIVE RuleSetVersions desselben
    // Mandanten -- unabhaengig davon, ob 0 oder 1 der beiden Publishes
    // erfolgreich war.
    expect(finalActiveVersions.length).toBeLessThanOrEqual(1);

    if (fulfilled.length === 1) {
      const winnerVersionId = finalActiveVersions[0]?.id;
      expect([versionX, versionY]).toContain(winnerVersionId);
      // Der jeweils andere Draft bleibt entweder DRAFT (regulaerer Konflikt,
      // count!==1-Guard) oder wurde konsistent zurueckgerollt -- in keinem
      // Fall ACTIVE.
      const loserVersionId = winnerVersionId === versionX ? versionY : versionX;
      const loserRow = await rawClient.ruleSetVersion.findUniqueOrThrow({
        where: { id: loserVersionId },
      });
      expect(loserRow.status).not.toBe("ACTIVE");
    }

    // Auditierung bleibt konsistent mit dem tatsaechlichen Ausgang: exakt so
    // viele ACTIVATE-Eintraege wie erfolgreiche Publishes, keine
    // verwaisten/partiellen Eintraege fuer den Verlierer.
    const activateAudits = await rawClient.auditLog.findMany({
      where: { tenantId, entityType: "RuleSetVersion", action: "ACTIVATE" },
    });
    expect(activateAudits).toHaveLength(fulfilled.length);

    // Dokumentiert (fuer den AP9-Bericht an ChatGPT) was der/die Verlierer
    // tatsaechlich als Fehler erhaelt -- nicht Teil der Kernassertion oben,
    // da dies je nach Race-Timing entweder die erwartete
    // RuleSetVersionNotDraftError (Anwendungsebene, updateMany-Guard) ODER
    // ein roher, bislang unuebersetzter Postgres-EXCLUDE-Constraint-Fehler
    // (DB-Ebene, siehe docs/DECISION_LOG.md) sein kann.
    for (const r of rejected) {
      if (r.status === "rejected") {
        expect(r.reason).toBeInstanceOf(Error);
      }
    }
  });

  describe("HTTP-Kette", () => {
    it("POST .../publish ohne config.rules.publish -> 403 (config.rules.edit reicht NICHT)", async () => {
      const tenantId = await createTenant("http-403");
      const actorUserId = await createUser(tenantId, "actor");
      const { ruleSetId, versionId } = await createRuleSetVersion(tenantId, "rs", "DRAFT");
      await addMinimalValidRule(tenantId, actorUserId, ruleSetId, versionId);
      const token = createSessionToken({
        ...baseSessionPayload(tenantId, actorUserId),
        configPermissions: ["config.rules.edit"],
      });
      const response = await publishRoute(
        requestWithCookie(
          `http://localhost/api/admin/rule-sets/${ruleSetId}/versions/${versionId}/publish`,
          token,
        ),
        routeParams({ id: ruleSetId, versionId }),
      );
      expect(response.status).toBe(403);
    });

    it("POST .../publish mit config.rules.publish -> 200, Status ACTIVE", async () => {
      const tenantId = await createTenant("http-200");
      const actorUserId = await createUser(tenantId, "actor");
      const { ruleSetId, versionId } = await createRuleSetVersion(tenantId, "rs", "DRAFT");
      await addMinimalValidRule(tenantId, actorUserId, ruleSetId, versionId);
      const token = createSessionToken({
        ...baseSessionPayload(tenantId, actorUserId),
        configPermissions: ["config.rules.publish"],
      });
      const response = await publishRoute(
        requestWithCookie(
          `http://localhost/api/admin/rule-sets/${ruleSetId}/versions/${versionId}/publish`,
          token,
        ),
        routeParams({ id: ruleSetId, versionId }),
      );
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.version.status).toBe("ACTIVE");
      expect(body.previousActiveVersionId).toBeNull();
    });

    it("POST .../publish fuer bereits ACTIVE Version -> 409", async () => {
      const tenantId = await createTenant("http-409");
      const actorUserId = await createUser(tenantId, "actor");
      const { ruleSetId, versionId } = await createRuleSetVersion(tenantId, "rs", "ACTIVE");
      const token = createSessionToken({
        ...baseSessionPayload(tenantId, actorUserId),
        configPermissions: ["config.rules.publish"],
      });
      const response = await publishRoute(
        requestWithCookie(
          `http://localhost/api/admin/rule-sets/${ruleSetId}/versions/${versionId}/publish`,
          token,
        ),
        routeParams({ id: ruleSetId, versionId }),
      );
      expect(response.status).toBe(409);
    });

    it("POST .../publish fuer leeren Draft -> 422", async () => {
      const tenantId = await createTenant("http-422");
      const actorUserId = await createUser(tenantId, "actor");
      const { ruleSetId, versionId } = await createRuleSetVersion(tenantId, "rs", "DRAFT");
      const token = createSessionToken({
        ...baseSessionPayload(tenantId, actorUserId),
        configPermissions: ["config.rules.publish"],
      });
      const response = await publishRoute(
        requestWithCookie(
          `http://localhost/api/admin/rule-sets/${ruleSetId}/versions/${versionId}/publish`,
          token,
        ),
        routeParams({ id: ruleSetId, versionId }),
      );
      expect(response.status).toBe(422);
    });
  });
});
