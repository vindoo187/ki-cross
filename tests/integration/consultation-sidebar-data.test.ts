/**
 * Integrationstests fuer `consultation-ui/view-models.ts::getConsultationSidebarData()`
 * (Phase 15 AP1, siehe PHASE_15_DISCOVERY.md + project_ki_cross_phase15_ap1_bestandspruefung.md)
 * gegen eine ECHTE Postgres-Datenbank.
 *
 * Testet AUSSCHLIESSLICH die Komposition (Session-Status + eigene aktive
 * Ziele in einem Read-Model) -- NICHT erneut die zugrunde liegende
 * Goal-Sichtbarkeits-/Fortschrittslogik (bereits vollstaendig abgedeckt in
 * `goal-visibility.test.ts`/`goal-progress.test.ts`, Phase 11 AP5/AP9-1)
 * und NICHT erneut `loadConsultationSessionStatus()` selbst (triviale
 * Ein-Feld-Abfrage, keine eigene Fachlogik).
 *
 * Jeder Testfall bekommt einen EIGENEN Employee (gemeinsamer Tenant/Store),
 * damit Goals aus verschiedenen Testfaellen sich nicht gegenseitig
 * beeinflussen (Goal-Sichtbarkeit ist strikt `employeeId`-gescoped).
 *
 * `now` wird bewusst als expliziter Parameter an `getConsultationSidebarData()`
 * uebergeben (analog `buildGoalProgressForEmployee(now)`) statt sich auf die
 * tatsaechliche Wanduhrzeit des Testlaufs zu verlassen -- sonst waere der
 * Test abhaengig davon, in welchem Kalendermonat CI gerade laeuft.
 *
 * Ohne DATABASE_URL wird die gesamte Suite uebersprungen statt fehlzuschlagen.
 */

import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runWithTenantContext } from "@/server/tenant/context";
import { createGoal } from "@/server/admin/goal-admin";
import { getConsultationSidebarData } from "@/server/consultation-ui/view-models";

const hasDatabaseUrl = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDatabaseUrl)(
  "getConsultationSidebarData() (Integrationstest, echte Postgres-DB)",
  () => {
    const rawClient = new PrismaClient();
    const suffix = randomUUID().slice(0, 8);
    const PERIOD_START = new Date("2026-08-01T00:00:00.000Z");
    const NOW_IN_PERIOD = new Date("2026-08-15T00:00:00.000Z");
    const SESSION_AT = new Date("2026-08-05T00:00:00.000Z");

    afterAll(async () => {
      await rawClient.$disconnect();
    });

    function asEmployee<T>(tenantId: string, employeeId: string, fn: () => Promise<T>): Promise<T> {
      return runWithTenantContext(
        { tenantId, userId: randomUUID(), employeeId, roles: [], managementScope: null },
        fn,
      );
    }

    let tenantId: string;
    let storeId: string;
    let questionnaireVersionId: string;
    let actorId: string;

    beforeAll(async () => {
      const tenant = await rawClient.tenant.create({
        data: { key: `sidebar-${suffix}`, name: "Test Sidebar", isSynthetic: true },
      });
      tenantId = tenant.id;
      const company = await rawClient.company.create({
        data: { tenantId, key: `sidebar-company-${suffix}`, name: "Company Sidebar" },
      });
      const store = await rawClient.store.create({
        data: {
          tenantId,
          companyId: company.id,
          key: `sidebar-store-${suffix}`,
          name: "Store Sidebar",
        },
      });
      storeId = store.id;
      const questionnaire = await rawClient.questionnaire.create({
        data: { tenantId, key: `sidebar-fragebogen-${suffix}` },
      });
      const version = await rawClient.questionnaireVersion.create({
        data: {
          tenantId,
          questionnaireId: questionnaire.id,
          label: "V1",
          validFrom: PERIOD_START,
          validTo: null,
          status: "ACTIVE",
        },
      });
      questionnaireVersionId = version.id;
      const actor = await rawClient.user.create({
        data: {
          tenantId,
          email: `sidebar-actor-${suffix}@example-synthetic.test`,
          isSynthetic: true,
        },
      });
      actorId = actor.id;
    });

    async function createEmployee(key: string) {
      const user = await rawClient.user.create({
        data: { tenantId, email: `${key}-${suffix}@example-synthetic.test`, isSynthetic: true },
      });
      const employee = await rawClient.employee.create({
        data: { tenantId, storeId, userId: user.id, displayName: `MA ${key}` },
      });
      return employee.id;
    }

    async function createSession(
      employeeId: string,
      status: "IN_PROGRESS" | "COMPLETED" | "ABANDONED",
    ) {
      const session = await rawClient.consultationSession.create({
        data: {
          tenantId,
          storeId,
          employeeId,
          questionnaireVersionId,
          consultationType: "NEW_CONTRACT",
          status,
          startedAt: SESSION_AT,
          endedAt: status === "IN_PROGRESS" ? null : new Date("2026-08-05T00:30:00Z"),
        },
      });
      return session.id;
    }

    it("liefert Sitzungsstatus + leeres activeGoals-Array, wenn kein eigenes aktives Ziel existiert", async () => {
      const employeeId = await createEmployee("empty");
      const sessionId = await createSession(employeeId, "IN_PROGRESS");

      const data = await asEmployee(tenantId, employeeId, () =>
        getConsultationSidebarData(sessionId, NOW_IN_PERIOD),
      );

      expect(data.consultationSessionId).toBe(sessionId);
      expect(data.sessionStatus).toBe("IN_PROGRESS");
      expect(data.activeGoals).toEqual([]);
    });

    it("liefert das eigene aktive EMPLOYEE-Ziel korrekt aufbereitet (target/actual/achievementRate)", async () => {
      const employeeId = await createEmployee("one-goal");
      const sessionId = await createSession(employeeId, "COMPLETED");

      await runWithTenantContext(
        { tenantId, userId: actorId, employeeId: undefined, roles: [], managementScope: null },
        () =>
          createGoal({
            scopeType: "EMPLOYEE",
            scopeId: employeeId,
            metricKey: "DEALS_CLOSED",
            periodType: "MONTH",
            periodStart: PERIOD_START,
            currency: null,
            targetAmountMinor: null,
            targetCount: 10,
            targetPercentageBasisPoints: null,
          }),
      );

      const data = await asEmployee(tenantId, employeeId, () =>
        getConsultationSidebarData(sessionId, NOW_IN_PERIOD),
      );

      expect(data.sessionStatus).toBe("COMPLETED");
      expect(data.activeGoals).toHaveLength(1);
      expect(data.activeGoals[0]).toMatchObject({
        metricKey: "DEALS_CLOSED",
        target: 10,
        actual: 0,
        achievementRate: 0,
      });
    });

    it("liefert mehrere gleichzeitig aktive Ziele mit unterschiedlichen Metriken (analog Phase-11-AP9-1)", async () => {
      const employeeId = await createEmployee("two-goals");
      const sessionId = await createSession(employeeId, "IN_PROGRESS");

      await runWithTenantContext(
        { tenantId, userId: actorId, employeeId: undefined, roles: [], managementScope: null },
        async () => {
          await createGoal({
            scopeType: "EMPLOYEE",
            scopeId: employeeId,
            metricKey: "DEALS_CLOSED",
            periodType: "MONTH",
            periodStart: PERIOD_START,
            currency: null,
            targetAmountMinor: null,
            targetCount: 5,
            targetPercentageBasisPoints: null,
          });
          await createGoal({
            scopeType: "EMPLOYEE",
            scopeId: employeeId,
            metricKey: "REVENUE",
            periodType: "MONTH",
            periodStart: PERIOD_START,
            currency: "EUR",
            targetAmountMinor: 100000,
            targetCount: null,
            targetPercentageBasisPoints: null,
          });
        },
      );

      const data = await asEmployee(tenantId, employeeId, () =>
        getConsultationSidebarData(sessionId, NOW_IN_PERIOD),
      );

      const metricKeys = data.activeGoals.map((g) => g.metricKey).sort();
      expect(metricKeys).toEqual(["DEALS_CLOSED", "REVENUE"]);
    });

    it("liefert sessionStatus=null fuer eine unbekannte Session-ID, ohne zu werfen", async () => {
      const employeeId = await createEmployee("unknown-session");

      const data = await asEmployee(tenantId, employeeId, () =>
        getConsultationSidebarData(randomUUID(), NOW_IN_PERIOD),
      );
      expect(data.sessionStatus).toBeNull();
    });
  },
);
