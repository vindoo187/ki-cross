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

  /**
   * DIAGNOSE (ChatGPT 2026-08-19, CI #53-Befund "AP9 Haertung
   * (Nebenlaeufigkeit)" lieferte 2 statt maximal 1 erfolgreichen Publish):
   * "erst beweisen, dann fixen" -- bevor an publishRuleSetVersion() etwas
   * geaendert wird, muss belegt sein, DASS der EXCLUDE-Constraint
   * rule_set_versions_tenant_active_no_overlap in der CI-Postgres-Instanz
   * ueberhaupt existiert (Migrationsstatus) und WIE er tatsaechlich lautet
   * (btree_gist-basierter EXCLUDE ueber tenant_id + Zeitfenster-Ueberlappung
   * WHERE status='ACTIVE', siehe
   * prisma/migrations/20260801130000_recommendation_engine/migration.sql).
   * Faellt dieser Test durch, ist die Ursache ein Migrations-/CI-Problem
   * und NICHT der in der naechsten it() beobachtete Nebenlaeufigkeitsfall
   * -- dann darf am Produktcode nichts geaendert werden, sondern nur an
   * Migration/CI-Setup.
   */
  it("DIAGNOSE: EXCLUDE-Constraint rule_set_versions_tenant_active_no_overlap existiert und ist btree_gist-basiert", async () => {
    const constraints = await rawClient.$queryRaw<Array<{ conname: string; definition: string }>>`
      SELECT conname, pg_get_constraintdef(oid) AS definition
      FROM pg_constraint
      WHERE conname = 'rule_set_versions_tenant_active_no_overlap'
    `;
    expect(constraints).toHaveLength(1);
    const definition = constraints[0]?.definition ?? "";
    expect(definition).toContain("EXCLUDE USING gist");
    expect(definition).toContain("tenant_id");
    expect(definition).toContain("&&");
    expect(definition.toUpperCase()).toContain("ACTIVE");

    const extensions = await rawClient.$queryRaw<Array<{ extname: string }>>`
      SELECT extname FROM pg_extension WHERE extname = 'btree_gist'
    `;
    expect(extensions).toHaveLength(1);
  });

  it("AP9 Haertung (Nebenlaeufigkeit): zwei ECHT parallele Publishes verschiedener Drafts (verschiedene RuleSets desselben Mandanten) -- Tenant-Lock serialisiert korrekt: am Ende genau 1 ACTIVE-Version, jeder erfolgreiche Publish vollstaendig auditiert, keine Dateninkonsistenz (rule_set_versions_tenant_active_no_overlap EXCLUDE-Constraint als Backstop)", async () => {
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

    // DIAGNOSE (ChatGPT-Vorgabe 2026-08-19, CI #56): den tatsaechlichen
    // DB-Endzustand IMMER erfassen, BEVOR die scharfen Assertions unten
    // werfen koennen -- sonst bricht der Test bei der ersten fehlschlagenden
    // Assertion ab und die nachfolgenden Diagnosedaten (ACTIVE-Anzahl,
    // Draft-Status, Audit-Eintraege) werden nie sichtbar. Damit laesst sich
    // zweifelsfrei zwischen "Lock greift nicht (2 ACTIVE)" und "Lock greift,
    // aber beide Publishes werden trotzdem sequentiell erfolgreich (1
    // ACTIVE)" unterscheiden.
    const finalActiveVersions = await rawClient.ruleSetVersion.findMany({
      where: { tenantId, status: "ACTIVE" },
    });
    const versionXRow = await rawClient.ruleSetVersion.findUniqueOrThrow({
      where: { id: versionX },
    });
    const versionYRow = await rawClient.ruleSetVersion.findUniqueOrThrow({
      where: { id: versionY },
    });
    const activateAuditsForDiagnosis = await rawClient.auditLog.findMany({
      where: { tenantId, entityType: "RuleSetVersion", action: "ACTIVATE" },
    });
    const diagnosis = JSON.stringify(
      {
        fulfilledCount: fulfilled.length,
        rejectedCount: rejected.length,
        rejectedReasons: rejected.map((r) => (r.status === "rejected" ? String(r.reason) : null)),
        activeCount: finalActiveVersions.length,
        activeVersionIds: finalActiveVersions.map((v) => v.id),
        versionXStatus: versionXRow.status,
        versionYStatus: versionYRow.status,
        activateAuditCount: activateAuditsForDiagnosis.length,
      },
      null,
      2,
    );

    // Kernaussage (ChatGPT-Entscheidung 2026-08-19, nach Beweis via CI #57
    // mit dem obigen Diagnose-Block): Der Tenant-Row-Lock serialisiert alle
    // Publish-Transaktionen desselben Mandanten korrekt -- das bedeutet aber
    // NICHT, dass ein zweiter, waehrend der Wartezeit neu entstandener
    // previousActive abgelehnt wird. publishRuleSetVersion() uebernimmt ihn
    // stattdessen automatisch (Design: "Publish ersetzt die aktuell aktive
    // Regelkonfiguration des gesamten Mandanten"). Zwei unabhaengige,
    // gueltige Publish-Anfragen fuer zwei verschiedene Drafts duerfen
    // deshalb BEIDE erfolgreich sein (sequentiell serialisiert) -- die
    // verbindliche Invariante ist NICHT "nur einer darf gewinnen", sondern:
    // am Ende existiert exakt eine ACTIVE-Version, und jeder tatsaechlich
    // erfolgreiche Publish ist vollstaendig (und nur einmal) auditiert. Die
    // urspruengliche "genau ein Gewinner"-Erwartung wurde bewusst NICHT
    // durch einen Produktcode-Eingriff (Konflikt bei neu entstandenem
    // previousActive) erzwungen, siehe ChatGPT-Begruendung im
    // Phase-9-Abschlussbericht.
    expect(finalActiveVersions, `Diagnose:\n${diagnosis}`).toHaveLength(1);
    expect(activateAuditsForDiagnosis, `Diagnose:\n${diagnosis}`).toHaveLength(fulfilled.length);

    // Bewusst KEINE Erwartung an eine feste Gewinner-Reihenfolge (X vs. Y)
    // -- bei echter Nebenlaeufigkeit kann je nach Scheduling entweder X oder
    // Y als letztes committen und damit gewinnen.
    const winnerVersionId = finalActiveVersions[0]?.id;
    expect([versionX, versionY]).toContain(winnerVersionId);
    const loserVersionId = winnerVersionId === versionX ? versionY : versionX;
    const loserRow = await rawClient.ruleSetVersion.findUniqueOrThrow({
      where: { id: loserVersionId },
    });
    if (fulfilled.length === 2) {
      // Beide Publishes erfolgreich -> der Verlierer wurde durch den
      // spaeter committenden, gewinnenden Publish sauber auf EXPIRED
      // gesetzt (kein Doppel-ACTIVE, keine verwaiste ACTIVE-Version).
      expect(loserRow.status, `Diagnose:\n${diagnosis}`).toBe("EXPIRED");
    } else {
      // Defensiver Fallback fuer einen hier nicht erwarteten Fehlerpfad
      // (z. B. falls doch nur 1 Promise fulfilled sein sollte): der
      // Verlierer darf dann keinesfalls ACTIVE sein.
      expect(loserRow.status, `Diagnose:\n${diagnosis}`).not.toBe("ACTIVE");
    }

    // Dokumentiert (fuer den AP9-Bericht an ChatGPT) was ein etwaiger
    // Verlierer tatsaechlich als Fehler erhaelt -- nicht Teil der
    // Kernassertion oben, da dies je nach Race-Timing entweder die erwartete
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
