/**
 * Phase 11 AP2 -- Integrationstests fuer die Goal-Management-API (siehe
 * PHASE_11_IMPLEMENTATION_PLAN.md Abschnitt 3, ChatGPT finales GO
 * 2026-08-22). Testet die Service-Schicht (`src/server/admin/goal-admin.ts`)
 * direkt innerhalb `runWithTenantContext()` gegen ECHTE Postgres-Fixtures
 * (kein `vi.mock`, Codebase-Konvention, siehe
 * tests/integration/commission-admin.test.ts). Es gibt in AP2 noch keine
 * API-Routen (die kommen erst mit AP3, siehe Modulkommentar in
 * `goal-admin.ts`) -- diese Suite deckt daher ausschliesslich die
 * Service-Schicht ab.
 *
 * ZENTRALER STRUKTUR-UNTERSCHIED zu `commission-admin.test.ts`/
 * `rule-admin.test.ts`: `Goal`/`GoalVersion` haben KEINEN Draft/Publish-
 * Workflow (kein `status`-Feld) -- "aktuelle Version" ist ausschliesslich
 * ueber `getCurrentGoalVersion()` (hoechste `versionNumber`) definiert.
 *
 * Ohne DATABASE_URL wird die gesamte Suite uebersprungen statt fehlzuschlagen.
 */

import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, describe, expect, it } from "vitest";
import { runWithTenantContext } from "@/server/tenant/context";
import {
  createGoal,
  createGoalVersion,
  getCurrentGoalVersion,
  getGoalDetail,
  listGoals,
} from "@/server/admin/goal-admin";
import {
  GoalAlreadyExistsError,
  GoalNotFoundError,
  GoalScopeInvalidError,
} from "@/server/admin/goal-admin-errors";
import type { CreateGoalInput } from "@/server/admin/goal-schemas";

const hasDatabaseUrl = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDatabaseUrl)("Phase 11 AP2: Goal-Management-Service", () => {
  const rawClient = new PrismaClient();
  const suffix = randomUUID().slice(0, 8);

  afterAll(async () => {
    await rawClient.$disconnect();
  });

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

  async function createCompany(tenantId: string, key: string) {
    const company = await rawClient.company.create({
      data: { tenantId, key: `company-${key}-${suffix}`, name: `Company ${key}` },
    });
    return company.id;
  }

  async function createStore(tenantId: string, companyId: string, key: string) {
    const store = await rawClient.store.create({
      data: { tenantId, companyId, key: `store-${key}-${suffix}`, name: `Store ${key}` },
    });
    return store.id;
  }

  async function createEmployee(tenantId: string, storeId: string, key: string) {
    const userId = await createUser(tenantId, `emp-${key}`);
    const employee = await rawClient.employee.create({
      data: { tenantId, storeId, userId, displayName: `MA ${key}` },
    });
    return employee.id;
  }

  function ctx(tenantId: string, userId: string) {
    return { tenantId, userId, roles: [], managementScope: null };
  }

  function tenantGoalInput(
    tenantId: string,
    overrides: Partial<CreateGoalInput> = {},
  ): CreateGoalInput {
    return {
      scopeType: "TENANT",
      scopeId: tenantId,
      metricKey: "DEALS_CLOSED",
      periodType: "QUARTER",
      periodStart: new Date("2026-07-01T00:00:00Z"),
      targetCount: 100,
      ...overrides,
    };
  }

  // -------------------------------------------------------------------
  // 1. createGoal() -- Identitaet + erste GoalVersion, atomar
  // -------------------------------------------------------------------
  describe("1. createGoal()", () => {
    it("legt ein TENANT-Goal + GoalVersion(1) an und liefert das GoalDetail mit currentVersion", async () => {
      const tenantId = await createTenant("ap2-create-tenant");
      const actorUserId = await createUser(tenantId, "actor");

      const detail = await runWithTenantContext(ctx(tenantId, actorUserId), () =>
        createGoal(tenantGoalInput(tenantId)),
      );

      expect(detail.scopeType).toBe("TENANT");
      expect(detail.scopeId).toBe(tenantId);
      expect(detail.metricKey).toBe("DEALS_CLOSED");
      expect(detail.periodType).toBe("QUARTER");
      expect(detail.currentVersion.versionNumber).toBe(1);
      expect(detail.currentVersion.targetCount).toBe(100);
      expect(detail.versions).toHaveLength(1);

      const auditEntries = await rawClient.auditLog.findMany({
        where: { tenantId, entityType: { in: ["Goal", "GoalVersion"] }, action: "CREATE" },
      });
      expect(auditEntries).toHaveLength(2);
    });

    it("legt ein COMPANY-Goal an, wenn die Company zum aktuellen Tenant gehoert", async () => {
      const tenantId = await createTenant("ap2-create-company");
      const actorUserId = await createUser(tenantId, "actor");
      const companyId = await createCompany(tenantId, "c1");

      const detail = await runWithTenantContext(ctx(tenantId, actorUserId), () =>
        createGoal(
          tenantGoalInput(tenantId, {
            scopeType: "COMPANY",
            scopeId: companyId,
            metricKey: "REVENUE",
            currency: "EUR",
            targetCount: null,
            targetAmountMinor: 500_000,
          }),
        ),
      );

      expect(detail.scopeType).toBe("COMPANY");
      expect(detail.scopeId).toBe(companyId);
      expect(detail.currency).toBe("EUR");
      expect(detail.currentVersion.targetAmountMinor).toBe(500_000);
    });

    it("legt ein STORE-Goal an, wenn der Store zum aktuellen Tenant gehoert", async () => {
      const tenantId = await createTenant("ap2-create-store");
      const actorUserId = await createUser(tenantId, "actor");
      const companyId = await createCompany(tenantId, "c1");
      const storeId = await createStore(tenantId, companyId, "s1");

      const detail = await runWithTenantContext(ctx(tenantId, actorUserId), () =>
        createGoal(tenantGoalInput(tenantId, { scopeType: "STORE", scopeId: storeId })),
      );

      expect(detail.scopeType).toBe("STORE");
      expect(detail.scopeId).toBe(storeId);
    });

    it("legt ein EMPLOYEE-Goal an, wenn der Employee zum aktuellen Tenant gehoert", async () => {
      const tenantId = await createTenant("ap2-create-employee");
      const actorUserId = await createUser(tenantId, "actor");
      const companyId = await createCompany(tenantId, "c1");
      const storeId = await createStore(tenantId, companyId, "s1");
      const employeeId = await createEmployee(tenantId, storeId, "e1");

      const detail = await runWithTenantContext(ctx(tenantId, actorUserId), () =>
        createGoal(tenantGoalInput(tenantId, { scopeType: "EMPLOYEE", scopeId: employeeId })),
      );

      expect(detail.scopeType).toBe("EMPLOYEE");
      expect(detail.scopeId).toBe(employeeId);
    });

    it("Kardinalitaet: ein zweites Goal mit identischer Scope/Metrik/Periode-Identitaet wirft GoalAlreadyExistsError", async () => {
      const tenantId = await createTenant("ap2-cardinality");
      const actorUserId = await createUser(tenantId, "actor");

      await runWithTenantContext(ctx(tenantId, actorUserId), () =>
        createGoal(tenantGoalInput(tenantId)),
      );

      await expect(
        runWithTenantContext(ctx(tenantId, actorUserId), () =>
          createGoal(tenantGoalInput(tenantId)),
        ),
      ).rejects.toThrow(GoalAlreadyExistsError);

      const goals = await rawClient.goal.findMany({ where: { tenantId } });
      expect(goals).toHaveLength(1);
    });

    it("ein Goal mit ANDEREM periodStart fuer dieselbe Scope/Metrik-Kombination ist weiterhin zulaessig (keine ueberzogene Kardinalitaet)", async () => {
      const tenantId = await createTenant("ap2-cardinality-diff-period");
      const actorUserId = await createUser(tenantId, "actor");

      await runWithTenantContext(ctx(tenantId, actorUserId), () =>
        createGoal(tenantGoalInput(tenantId)),
      );
      await runWithTenantContext(ctx(tenantId, actorUserId), () =>
        createGoal(tenantGoalInput(tenantId, { periodStart: new Date("2026-10-01T00:00:00Z") })),
      );

      const goals = await rawClient.goal.findMany({ where: { tenantId } });
      expect(goals).toHaveLength(2);
    });

    it("scopeId-Tenant-Bindung: TENANT-Scope mit scopeId != tenantId wirft GoalScopeInvalidError, keine Mutation/kein Audit-Eintrag", async () => {
      const tenantId = await createTenant("ap2-scope-tenant-invalid");
      const actorUserId = await createUser(tenantId, "actor");
      const foreignId = randomUUID();

      await expect(
        runWithTenantContext(ctx(tenantId, actorUserId), () =>
          createGoal(tenantGoalInput(tenantId, { scopeId: foreignId })),
        ),
      ).rejects.toThrow(GoalScopeInvalidError);

      const goals = await rawClient.goal.findMany({ where: { tenantId } });
      expect(goals).toHaveLength(0);
      const auditEntries = await rawClient.auditLog.findMany({
        where: { tenantId, entityType: { in: ["Goal", "GoalVersion"] } },
      });
      expect(auditEntries).toHaveLength(0);
    });

    it("scopeId-Tenant-Bindung: COMPANY-scopeId, die zu einem ANDEREN Tenant gehoert, wirft GoalScopeInvalidError (IDOR-Schutz)", async () => {
      const tenantId = await createTenant("ap2-scope-company-cross-tenant-a");
      const otherTenantId = await createTenant("ap2-scope-company-cross-tenant-b");
      const actorUserId = await createUser(tenantId, "actor");
      const foreignCompanyId = await createCompany(otherTenantId, "c1");

      await expect(
        runWithTenantContext(ctx(tenantId, actorUserId), () =>
          createGoal(
            tenantGoalInput(tenantId, { scopeType: "COMPANY", scopeId: foreignCompanyId }),
          ),
        ),
      ).rejects.toThrow(GoalScopeInvalidError);

      const goals = await rawClient.goal.findMany({ where: { tenantId } });
      expect(goals).toHaveLength(0);
    });

    it("scopeId-Tenant-Bindung: STORE-scopeId, die zu einem ANDEREN Tenant gehoert, wirft GoalScopeInvalidError (IDOR-Schutz)", async () => {
      const tenantId = await createTenant("ap2-scope-store-cross-tenant-a");
      const otherTenantId = await createTenant("ap2-scope-store-cross-tenant-b");
      const actorUserId = await createUser(tenantId, "actor");
      const otherCompanyId = await createCompany(otherTenantId, "c1");
      const foreignStoreId = await createStore(otherTenantId, otherCompanyId, "s1");

      await expect(
        runWithTenantContext(ctx(tenantId, actorUserId), () =>
          createGoal(tenantGoalInput(tenantId, { scopeType: "STORE", scopeId: foreignStoreId })),
        ),
      ).rejects.toThrow(GoalScopeInvalidError);
    });

    it("scopeId-Tenant-Bindung: EMPLOYEE-scopeId, die zu einem ANDEREN Tenant gehoert, wirft GoalScopeInvalidError (IDOR-Schutz)", async () => {
      const tenantId = await createTenant("ap2-scope-employee-cross-tenant-a");
      const otherTenantId = await createTenant("ap2-scope-employee-cross-tenant-b");
      const actorUserId = await createUser(tenantId, "actor");
      const otherCompanyId = await createCompany(otherTenantId, "c1");
      const otherStoreId = await createStore(otherTenantId, otherCompanyId, "s1");
      const foreignEmployeeId = await createEmployee(otherTenantId, otherStoreId, "e1");

      await expect(
        runWithTenantContext(ctx(tenantId, actorUserId), () =>
          createGoal(
            tenantGoalInput(tenantId, { scopeType: "EMPLOYEE", scopeId: foreignEmployeeId }),
          ),
        ),
      ).rejects.toThrow(GoalScopeInvalidError);
    });

    it("scopeId-Tenant-Bindung: eine voellig unbekannte COMPANY-scopeId wirft GoalScopeInvalidError", async () => {
      const tenantId = await createTenant("ap2-scope-unknown");
      const actorUserId = await createUser(tenantId, "actor");

      await expect(
        runWithTenantContext(ctx(tenantId, actorUserId), () =>
          createGoal(tenantGoalInput(tenantId, { scopeType: "COMPANY", scopeId: randomUUID() })),
        ),
      ).rejects.toThrow(GoalScopeInvalidError);
    });
  });

  // -------------------------------------------------------------------
  // 2. getCurrentGoalVersion() / createGoalVersion() -- Historisierung
  // -------------------------------------------------------------------
  describe("2. createGoalVersion() / getCurrentGoalVersion()", () => {
    it("haengt eine neue GoalVersion an, die bisherige Version bleibt unveraendert bestehen", async () => {
      const tenantId = await createTenant("ap2-version-append");
      const actorUserId = await createUser(tenantId, "actor");

      const detail = await runWithTenantContext(ctx(tenantId, actorUserId), () =>
        createGoal(tenantGoalInput(tenantId)),
      );

      const v2 = await runWithTenantContext(ctx(tenantId, actorUserId), () =>
        createGoalVersion(detail.id, { targetCount: 150 }),
      );
      expect(v2.versionNumber).toBe(2);
      expect(v2.targetCount).toBe(150);

      const v1Unchanged = await rawClient.goalVersion.findFirst({
        where: { goalId: detail.id, versionNumber: 1 },
      });
      expect(v1Unchanged?.targetCount).toBe(100);

      const current = await runWithTenantContext(ctx(tenantId, actorUserId), () =>
        getCurrentGoalVersion(detail.id),
      );
      expect(current.versionNumber).toBe(2);
      expect(current.targetCount).toBe(150);

      const allVersions = await rawClient.goalVersion.findMany({ where: { goalId: detail.id } });
      expect(allVersions).toHaveLength(2);
    });

    it("createGoalVersion() fuer ein nicht existierendes Goal wirft GoalNotFoundError", async () => {
      const tenantId = await createTenant("ap2-version-missing-goal");
      const actorUserId = await createUser(tenantId, "actor");

      await expect(
        runWithTenantContext(ctx(tenantId, actorUserId), () =>
          createGoalVersion(randomUUID(), { targetCount: 10 }),
        ),
      ).rejects.toThrow(GoalNotFoundError);
    });

    /**
     * Regressionstest fuer ChatGPTs zusaetzliche Auflage bei der finalen
     * Plan-Freigabe (2026-08-22, analog dem in Phase 10 AP9 gefundenen
     * Race-Condition-Bug bei `createDraftCommissionModelVersion()`): zwei
     * ECHT parallele `createGoalVersion()`-Aufrufe fuer DASSELBE Goal
     * muessen BEIDE erfolgreich sein und unterschiedliche `versionNumber`
     * erhalten -- kein "SELECT MAX() dann INSERT" ohne Row-Lock.
     */
    it("Nebenlaeufigkeit: zwei ECHT parallele createGoalVersion()-Aufrufe DESSELBEN Goal sind BEIDE erfolgreich und erhalten unterschiedliche versionNumber (Row-Lock-Regressionstest)", async () => {
      const tenantId = await createTenant("ap2-parallel-same-goal");
      const actorUserId = await createUser(tenantId, "actor");

      const detail = await runWithTenantContext(ctx(tenantId, actorUserId), () =>
        createGoal(tenantGoalInput(tenantId)),
      );

      // Bewusst KEIN sequentielles await -- beide Version-Erstellungen werden
      // ECHT gleichzeitig fuer DASSELBE Goal gestartet, um den in
      // goal-admin.ts dokumentierten Goal-Row-Lock zu pruefen.
      const results = await Promise.allSettled([
        runWithTenantContext(ctx(tenantId, actorUserId), () =>
          createGoalVersion(detail.id, { targetCount: 110 }),
        ),
        runWithTenantContext(ctx(tenantId, actorUserId), () =>
          createGoalVersion(detail.id, { targetCount: 120 }),
        ),
      ]);

      expect(results.every((r) => r.status === "fulfilled")).toBe(true);
      const fulfilled = results as PromiseFulfilledResult<
        Awaited<ReturnType<typeof createGoalVersion>>
      >[];
      const versionNumbers = fulfilled.map((r) => r.value.versionNumber).sort();
      // Basisversion (createGoal) ist bereits versionNumber 1 -- beide neuen
      // Versionen muessen 2 und 3 erhalten, in irgendeiner Reihenfolge.
      expect(versionNumbers).toEqual([2, 3]);

      const allVersions = await rawClient.goalVersion.findMany({ where: { goalId: detail.id } });
      expect(allVersions).toHaveLength(3);

      const auditEntries = await rawClient.auditLog.findMany({
        where: { tenantId, entityType: "GoalVersion", action: "CREATE" },
      });
      expect(auditEntries).toHaveLength(3);
    });

    it("Gegenprobe: zwei ECHT parallele createGoalVersion()-Aufrufe fuer VERSCHIEDENE Goals duerfen sich NICHT gegenseitig blockieren (kein falscher Tenant-weiter Lock)", async () => {
      const tenantId = await createTenant("ap2-parallel-different-goals");
      const actorUserId = await createUser(tenantId, "actor");

      const goalX = await runWithTenantContext(ctx(tenantId, actorUserId), () =>
        createGoal(tenantGoalInput(tenantId, { metricKey: "DEALS_CLOSED" })),
      );
      const goalY = await runWithTenantContext(ctx(tenantId, actorUserId), () =>
        createGoal(
          tenantGoalInput(tenantId, {
            metricKey: "REVENUE",
            currency: "EUR",
            targetCount: null,
            targetAmountMinor: 10_000,
          }),
        ),
      );

      const results = await Promise.allSettled([
        runWithTenantContext(ctx(tenantId, actorUserId), () =>
          createGoalVersion(goalX.id, { targetCount: 200 }),
        ),
        runWithTenantContext(ctx(tenantId, actorUserId), () =>
          createGoalVersion(goalY.id, { targetAmountMinor: 20_000 }),
        ),
      ]);

      expect(results.every((r) => r.status === "fulfilled")).toBe(true);
      const versionsX = await rawClient.goalVersion.findMany({ where: { goalId: goalX.id } });
      const versionsY = await rawClient.goalVersion.findMany({ where: { goalId: goalY.id } });
      expect(versionsX).toHaveLength(2);
      expect(versionsY).toHaveLength(2);
    });
  });

  // -------------------------------------------------------------------
  // 3. listGoals() / getGoalDetail() / Tenant-Isolation
  // -------------------------------------------------------------------
  describe("3. listGoals() / getGoalDetail() / Tenant-Isolation", () => {
    it("listGoals() liefert alle Goals des Tenant mit currentVersion (hoechste versionNumber)", async () => {
      const tenantId = await createTenant("ap2-list");
      const actorUserId = await createUser(tenantId, "actor");

      const goal = await runWithTenantContext(ctx(tenantId, actorUserId), () =>
        createGoal(tenantGoalInput(tenantId)),
      );
      await runWithTenantContext(ctx(tenantId, actorUserId), () =>
        createGoalVersion(goal.id, { targetCount: 130 }),
      );

      const list = await runWithTenantContext(ctx(tenantId, actorUserId), () => listGoals());
      expect(list).toHaveLength(1);
      expect(list[0]?.currentVersion.versionNumber).toBe(2);
      expect(list[0]?.currentVersion.targetCount).toBe(130);
    });

    it("getGoalDetail() fuer eine nicht existierende goalId wirft GoalNotFoundError", async () => {
      const tenantId = await createTenant("ap2-detail-missing");
      const actorUserId = await createUser(tenantId, "actor");

      await expect(
        runWithTenantContext(ctx(tenantId, actorUserId), () => getGoalDetail(randomUUID())),
      ).rejects.toThrow(GoalNotFoundError);
    });

    it("Tenant-Isolation: ein Goal aus Tenant A ist ueber den TenantContext von Tenant B NICHT erreichbar (GoalNotFoundError, kein Cross-Tenant-Leck)", async () => {
      const tenantAId = await createTenant("ap2-isolation-a");
      const tenantBId = await createTenant("ap2-isolation-b");
      const actorAId = await createUser(tenantAId, "actor-a");
      const actorBId = await createUser(tenantBId, "actor-b");

      const goalA = await runWithTenantContext(ctx(tenantAId, actorAId), () =>
        createGoal(tenantGoalInput(tenantAId)),
      );

      await expect(
        runWithTenantContext(ctx(tenantBId, actorBId), () => getGoalDetail(goalA.id)),
      ).rejects.toThrow(GoalNotFoundError);

      await expect(
        runWithTenantContext(ctx(tenantBId, actorBId), () =>
          createGoalVersion(goalA.id, { targetCount: 999 }),
        ),
      ).rejects.toThrow(GoalNotFoundError);

      const listForB = await runWithTenantContext(ctx(tenantBId, actorBId), () => listGoals());
      expect(listForB).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------
  // 4. AP8: Audit-Vollstaendigkeit + Reproduzierbarkeit (append-only
  //    Regression, siehe project_ki_cross_phase11_plan_go.md, ChatGPT-GO
  //    2026-08-22 nach AP8-Discovery)
  // -------------------------------------------------------------------
  describe("4. AP8: Audit-Vollstaendigkeit / Reproduzierbarkeit", () => {
    /**
     * Deckt exakt die von ChatGPT nach der AP8-Discovery vorgegebene
     * Test-Sequenz ab (bewusst KEIN asOf-Resolver/historischer Report --
     * das ist ausdruecklich NICHT Teil von AP8, siehe Modulkommentar):
     * Goal anlegen -> v1, getCurrentGoalVersion() liefert v1, neue Version
     * -> v2, getCurrentGoalVersion() liefert v2, v1 bleibt UNVERAENDERT
     * bestehen (byte-fuer-byte identisch zur urspruenglichen Erstellung),
     * Audit enthaelt sowohl v1 als auch v2. Der letzte Punkt ("Ziel-Ist-
     * Berechnung der aktuellen aktiven Periode verwendet v2") wird hier
     * NICHT erneut geprueft -- das ist bereits durch
     * tests/integration/goal-progress-view.test.ts (AP7) abgedeckt, deren
     * `computeGoalProgress()`-Aufruf strukturell IMMER `goal.currentVersion`
     * erhaelt (siehe `buildGoalProgressViewModels()` in `goal-visibility.ts`).
     */
    it("Reproduzierbarkeits-Sequenz: v1 bleibt nach Anlegen von v2 unveraendert bestehen, getCurrentGoalVersion() liefert stets die neueste, Audit erfasst beide", async () => {
      const tenantId = await createTenant("ap8-reproducibility");
      const actorUserId = await createUser(tenantId, "actor");

      const goal = await runWithTenantContext(ctx(tenantId, actorUserId), () =>
        createGoal(tenantGoalInput(tenantId, { targetCount: 100 })),
      );
      const v1BeforeCorrection = await runWithTenantContext(ctx(tenantId, actorUserId), () =>
        getCurrentGoalVersion(goal.id),
      );
      expect(v1BeforeCorrection.versionNumber).toBe(1);
      expect(v1BeforeCorrection.targetCount).toBe(100);

      const v2 = await runWithTenantContext(ctx(tenantId, actorUserId), () =>
        createGoalVersion(goal.id, { targetCount: 150 }),
      );
      expect(v2.versionNumber).toBe(2);

      const currentAfterCorrection = await runWithTenantContext(ctx(tenantId, actorUserId), () =>
        getCurrentGoalVersion(goal.id),
      );
      expect(currentAfterCorrection.versionNumber).toBe(2);
      expect(currentAfterCorrection.targetCount).toBe(150);

      // v1 bleibt UNVERAENDERT bestehen -- kein Update-/Delete-Codepfad hat
      // sie angefasst. Byte-fuer-byte-Vergleich gegen den urspruenglichen
      // createGoal()-Rueckgabewert (nicht nur "existiert noch").
      const detail = await runWithTenantContext(ctx(tenantId, actorUserId), () =>
        getGoalDetail(goal.id),
      );
      expect(detail.versions).toHaveLength(2);
      const v1AfterCorrection = detail.versions.find((v) => v.versionNumber === 1);
      expect(v1AfterCorrection).toEqual(v1BeforeCorrection);

      // Audit erfasst BEIDE Versionen (CREATE Goal + CREATE GoalVersion v1,
      // dann CREATE GoalVersion v2) -- 3 Eintraege insgesamt.
      const auditEntries = await rawClient.auditLog.findMany({
        where: { tenantId, entityType: { in: ["Goal", "GoalVersion"] }, action: "CREATE" },
        orderBy: { occurredAt: "asc" },
      });
      expect(auditEntries).toHaveLength(3);
      const goalVersionAuditEntries = auditEntries.filter((e) => e.entityType === "GoalVersion");
      expect(goalVersionAuditEntries.map((e) => e.entityId).sort()).toEqual(
        [v1BeforeCorrection.id, v2.id].sort(),
      );
    });

    /**
     * Append-only-Regression (ChatGPTs ausdrueckliche AP8-Auflage): stellt
     * sicher, dass `createGoalVersion()` bei einem bereits existierenden
     * Goal STETS eine NEUE Zeile mit fortlaufender `versionNumber` anlegt --
     * es gibt keinen Codepfad, der eine bestehende `GoalVersion`-Zeile
     * aktualisiert (kein `update()`/`upsert()` auf `goalVersion` irgendwo in
     * `goal-admin.ts`, siehe Modulkommentar). Drei aufeinanderfolgende
     * Korrekturen muessen daher drei UNTERSCHIEDLICHE Zeilen ergeben, deren
     * fruehere Eintraege inhaltlich unangetastet bleiben.
     */
    it("drei aufeinanderfolgende createGoalVersion()-Aufrufe erzeugen drei separate, seitdem unveraenderliche Zeilen (kein Update-Pfad)", async () => {
      const tenantId = await createTenant("ap8-append-only");
      const actorUserId = await createUser(tenantId, "actor");

      const goal = await runWithTenantContext(ctx(tenantId, actorUserId), () =>
        createGoal(tenantGoalInput(tenantId, { targetCount: 10 })),
      );
      const v2 = await runWithTenantContext(ctx(tenantId, actorUserId), () =>
        createGoalVersion(goal.id, { targetCount: 20 }),
      );
      const v3 = await runWithTenantContext(ctx(tenantId, actorUserId), () =>
        createGoalVersion(goal.id, { targetCount: 30 }),
      );

      const allVersions = await rawClient.goalVersion.findMany({
        where: { goalId: goal.id },
        orderBy: { versionNumber: "asc" },
      });
      expect(allVersions.map((v) => v.versionNumber)).toEqual([1, 2, 3]);
      expect(allVersions.map((v) => v.targetCount)).toEqual([10, 20, 30]);
      // v2/v3 wie von den Service-Aufrufen zurueckgegeben, unveraendert in der DB wiedergefunden.
      expect(allVersions[1]?.id).toBe(v2.id);
      expect(allVersions[2]?.id).toBe(v3.id);
    });
  });
});
