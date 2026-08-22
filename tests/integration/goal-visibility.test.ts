/**
 * Integrationstests fuer `analytics/goal-visibility.ts` (Phase 11 AP5, siehe
 * PHASE_11_IMPLEMENTATION_PLAN.md Abschnitt 3, ChatGPT-GO 2026-08-22 nach
 * AP5-Designklaerung) gegen eine ECHTE Postgres-Datenbank.
 *
 * Deckt die vier verbindlichen Sichtbarkeitsregeln ab (Modulkommentar
 * `goal-visibility.ts`):
 * - Mitarbeiter: ausschliesslich das eigene EMPLOYEE-Goal.
 * - Management STORE: `scopeId` in `authorizedStoreIds`.
 * - Management COMPANY: ALLE Stores der Company in `authorizedStoreIds`
 *   (Subset-Prinzip -- ein Company-Goal ist NICHT sichtbar, wenn nur ein Teil
 *   der Company-Stores autorisiert ist).
 * - Management TENANT: `authorizedStoreIds` deckt den GESAMTEN Mandanten ab
 *   (nicht nur eine Company vollstaendig).
 * - Management EMPLOYEE: Mitarbeiter gehoert einem autorisierten Store an.
 * - Tenant-Isolation (ein Tenant-B-Goal darf niemals in Tenant-A-Ergebnissen
 *   auftauchen).
 * - `resolveGoalKpiScopeFilter()`-Mapping fuer alle vier `scopeType`-Werte.
 *
 * Fixture: Tenant A mit Company A1 (Store A1a, Store A1b) und Company A2
 * (Store A2a) -- damit die COMPANY/TENANT-Subset-Regeln unterscheidbar
 * pruefbar sind. Tenant B (isoliert) fuer den Tenant-Isolationstest.
 * `ManagementScope`-Objekte werden direkt konstruiert (die Ableitung aus
 * RoleAssignments ist bereits in `management-scope.test.ts`/
 * `analytics-management-security.test.ts` abgedeckt) -- dieser Test isoliert
 * bewusst NUR die Goal-Sichtbarkeitslogik.
 *
 * Ohne DATABASE_URL wird die gesamte Suite uebersprungen statt fehlzuschlagen.
 */

import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runWithTenantContext } from "@/server/tenant/context";
import { createGoal } from "@/server/admin/goal-admin";
import type { ManagementScope } from "@/server/authz/management-scope";
import {
  listVisibleGoalsForEmployee,
  listVisibleGoalsForManagement,
  resolveGoalKpiScopeFilter,
} from "@/server/analytics/goal-visibility";

const hasDatabaseUrl = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDatabaseUrl)(
  "analytics/goal-visibility.ts (Integrationstest, echte Postgres-DB)",
  () => {
    const rawClient = new PrismaClient();
    const suffix = randomUUID().slice(0, 8);
    const PERIOD_START = new Date("2026-08-01T00:00:00.000Z");

    afterAll(async () => {
      await rawClient.$disconnect();
    });

    function asContext<T>(
      tenantId: string,
      employeeId: string | undefined,
      managementScope: ManagementScope | null,
      fn: () => Promise<T>,
    ): Promise<T> {
      return runWithTenantContext(
        { tenantId, userId: randomUUID(), employeeId, roles: [], managementScope },
        fn,
      );
    }

    async function createTenant(key: string) {
      const tenant = await rawClient.tenant.create({
        data: { key: `${key}-${suffix}`, name: `Test ${key}`, isSynthetic: true },
      });
      return tenant.id;
    }

    async function createCompany(tenantId: string, key: string) {
      const company = await rawClient.company.create({
        data: { tenantId, key: `${key}-${suffix}`, name: `Company ${key}` },
      });
      return company.id;
    }

    async function createStore(tenantId: string, companyId: string, key: string) {
      const store = await rawClient.store.create({
        data: { tenantId, companyId, key: `${key}-${suffix}`, name: `Store ${key}` },
      });
      return store.id;
    }

    async function createEmployee(tenantId: string, storeId: string, key: string) {
      const user = await rawClient.user.create({
        data: { tenantId, email: `${key}-${suffix}@example-synthetic.test`, isSynthetic: true },
      });
      const employee = await rawClient.employee.create({
        data: { tenantId, storeId, userId: user.id, displayName: `MA ${key}` },
      });
      return employee.id;
    }

    let tenantId: string;
    let companyA1Id: string;
    let storeA1aId: string;
    let storeA1bId: string;
    let companyA2Id: string;
    let storeA2aId: string;
    let employeeA1aId: string;

    let goalStoreA1aId: string;
    let goalCompanyA1Id: string;
    let goalTenantAId: string;
    let goalEmployeeA1aId: string;

    let tenantBId: string;

    beforeAll(async () => {
      tenantId = await createTenant("goalvis");
      companyA1Id = await createCompany(tenantId, "A1");
      storeA1aId = await createStore(tenantId, companyA1Id, "A1a");
      storeA1bId = await createStore(tenantId, companyA1Id, "A1b");
      companyA2Id = await createCompany(tenantId, "A2");
      storeA2aId = await createStore(tenantId, companyA2Id, "A2a");
      employeeA1aId = await createEmployee(tenantId, storeA1aId, "A1a");

      // Zweiter, unabhaengiger Mandant fuer den Tenant-Isolationstest.
      tenantBId = await createTenant("goalvis-b");
      const companyBId = await createCompany(tenantBId, "B1");
      const storeBId = await createStore(tenantBId, companyBId, "B1a");

      // Vier Goals in Tenant A (je scopeType einmal) -- Metrik/Zielwert sind
      // fuer die Sichtbarkeitspruefung irrelevant, DEALS_CLOSED/targetCount
      // gewaehlt als einfachster gueltiger Fall.
      const createGoalAs = (
        scopeType: "TENANT" | "COMPANY" | "STORE" | "EMPLOYEE",
        scopeId: string,
      ) =>
        asContext(tenantId, undefined, null, () =>
          createGoal({
            scopeType,
            scopeId,
            metricKey: "DEALS_CLOSED",
            periodType: "MONTH",
            periodStart: PERIOD_START,
            currency: null,
            targetAmountMinor: null,
            targetCount: 10,
            targetPercentageBasisPoints: null,
          }),
        );

      goalStoreA1aId = (await createGoalAs("STORE", storeA1aId)).id;
      goalCompanyA1Id = (await createGoalAs("COMPANY", companyA1Id)).id;
      goalTenantAId = (await createGoalAs("TENANT", tenantId)).id;
      goalEmployeeA1aId = (await createGoalAs("EMPLOYEE", employeeA1aId)).id;

      // Ein Goal in Tenant B -- darf in KEINEM Tenant-A-Ergebnis auftauchen.
      await asContext(tenantBId, undefined, null, () =>
        createGoal({
          scopeType: "STORE",
          scopeId: storeBId,
          metricKey: "DEALS_CLOSED",
          periodType: "MONTH",
          periodStart: PERIOD_START,
          currency: null,
          targetAmountMinor: null,
          targetCount: 5,
          targetPercentageBasisPoints: null,
        }),
      );
    });

    function idsOf(goals: { id: string }[]): string[] {
      return goals.map((g) => g.id).sort();
    }

    // -----------------------------------------------------------------
    // 1. Mitarbeiter-Sichtbarkeit
    // -----------------------------------------------------------------

    it("Mitarbeiter sieht ausschliesslich das eigene EMPLOYEE-Goal", async () => {
      const goals = await asContext(tenantId, employeeA1aId, null, () =>
        listVisibleGoalsForEmployee(),
      );
      expect(idsOf(goals)).toEqual([goalEmployeeA1aId]);
    });

    it("Mitarbeiter ohne employeeId (reiner Management-Account) erhaelt leere Liste, keinen Fehler", async () => {
      const goals = await asContext(tenantId, undefined, null, () => listVisibleGoalsForEmployee());
      expect(goals).toEqual([]);
    });

    // -----------------------------------------------------------------
    // 2. Management-Sichtbarkeit -- vier Regeln
    // -----------------------------------------------------------------

    it("Management mit STORE-Scope (nur A1a) sieht STORE- und EMPLOYEE-Goal von A1a, nicht COMPANY/TENANT", async () => {
      const scope: ManagementScope = { level: "STORE", storeIds: [storeA1aId] };
      const goals = await asContext(tenantId, undefined, scope, () =>
        listVisibleGoalsForManagement(scope),
      );
      expect(idsOf(goals)).toEqual([goalEmployeeA1aId, goalStoreA1aId].sort());
    });

    it("Management mit COMPANY-Scope (A1a+A1b) sieht STORE/COMPANY/EMPLOYEE von A1, nicht TENANT", async () => {
      const scope: ManagementScope = { level: "COMPANY", storeIds: [storeA1aId, storeA1bId] };
      const goals = await asContext(tenantId, undefined, scope, () =>
        listVisibleGoalsForManagement(scope),
      );
      expect(idsOf(goals)).toEqual([goalCompanyA1Id, goalEmployeeA1aId, goalStoreA1aId].sort());
    });

    it("Management mit TENANT-Scope (alle 3 Stores) sieht alle vier Goals", async () => {
      const scope: ManagementScope = {
        level: "TENANT",
        storeIds: [storeA1aId, storeA1bId, storeA2aId],
      };
      const goals = await asContext(tenantId, undefined, scope, () =>
        listVisibleGoalsForManagement(scope),
      );
      expect(idsOf(goals)).toEqual(
        [goalCompanyA1Id, goalEmployeeA1aId, goalStoreA1aId, goalTenantAId].sort(),
      );
    });

    it("COMPANY-Goal NICHT sichtbar, wenn nur ein Teil der Company-Stores autorisiert ist (Subset-Prinzip)", async () => {
      // Scope deckt nur A1a ab, NICHT A1b -- Company A1 hat aber beide.
      const scope: ManagementScope = { level: "STORE", storeIds: [storeA1aId] };
      const goals = await asContext(tenantId, undefined, scope, () =>
        listVisibleGoalsForManagement(scope),
      );
      expect(goals.some((g) => g.id === goalCompanyA1Id)).toBe(false);
    });

    it("TENANT-Goal NICHT sichtbar, wenn Scope nur eine Company voll abdeckt (nicht den gesamten Mandanten)", async () => {
      // Deckt Company A1 vollstaendig ab, aber NICHT Store A2a -- der
      // Mandant hat aber auch Company A2. scope.level waere hier "COMPANY",
      // aber selbst bei einem (hypothetischen) level="TENANT"-Objekt darf die
      // Pruefung NICHT allein auf level vertrauen (ChatGPTs Korrektur).
      const scope: ManagementScope = { level: "COMPANY", storeIds: [storeA1aId, storeA1bId] };
      const goals = await asContext(tenantId, undefined, scope, () =>
        listVisibleGoalsForManagement(scope),
      );
      expect(goals.some((g) => g.id === goalTenantAId)).toBe(false);
    });

    it("EMPLOYEE-Goal sichtbar fuer Management, wenn der Mitarbeiter einem autorisierten Store angehoert", async () => {
      const scope: ManagementScope = { level: "STORE", storeIds: [storeA1aId] };
      const goals = await asContext(tenantId, undefined, scope, () =>
        listVisibleGoalsForManagement(scope),
      );
      expect(goals.some((g) => g.id === goalEmployeeA1aId)).toBe(true);
    });

    it("EMPLOYEE-Goal NICHT sichtbar, wenn der Mitarbeiter zu einem nicht autorisierten Store gehoert", async () => {
      // Scope deckt nur A2a ab -- employeeA1aId gehoert zu A1a.
      const scope: ManagementScope = { level: "STORE", storeIds: [storeA2aId] };
      const goals = await asContext(tenantId, undefined, scope, () =>
        listVisibleGoalsForManagement(scope),
      );
      expect(goals.some((g) => g.id === goalEmployeeA1aId)).toBe(false);
    });

    it("requestedStoreId schraenkt den Scope korrekt ein (IDOR-Schutz via resolveAuthorizedStoreFilter)", async () => {
      const scope: ManagementScope = {
        level: "TENANT",
        storeIds: [storeA1aId, storeA1bId, storeA2aId],
      };
      const goals = await asContext(tenantId, undefined, scope, () =>
        listVisibleGoalsForManagement(scope, storeA2aId),
      );
      // Nach Einschraenkung auf A2a ist weder das TENANT- noch das
      // COMPANY-A1- noch das STORE-A1a-Goal sichtbar.
      expect(goals).toEqual([]);
    });

    it("kein Zugriff (scope=null) wirft ManagementAccessDeniedError (Deny-by-default)", async () => {
      await expect(
        asContext(tenantId, undefined, null, () => listVisibleGoalsForManagement(null)),
      ).rejects.toThrow();
    });

    // -----------------------------------------------------------------
    // 3. Tenant-Isolation
    // -----------------------------------------------------------------

    it("Tenant-B-Goal taucht in keinem Tenant-A-Ergebnis auf (strukturelle Tenant-Isolation)", async () => {
      const scope: ManagementScope = {
        level: "TENANT",
        storeIds: [storeA1aId, storeA1bId, storeA2aId],
      };
      const goals = await asContext(tenantId, undefined, scope, () =>
        listVisibleGoalsForManagement(scope),
      );
      expect(goals.every((g) => g.id !== undefined)).toBe(true);
      // Vier Goals in Tenant A erwartet -- das Tenant-B-Goal ist strukturell
      // unerreichbar (tenant-gescopter db-Client in listGoals()), nicht nur
      // zufaellig durch die Sichtbarkeitsregel ausgeschlossen.
      expect(goals.length).toBe(4);
    });

    // -----------------------------------------------------------------
    // 4. resolveGoalKpiScopeFilter()
    // -----------------------------------------------------------------

    it("resolveGoalKpiScopeFilter(): TENANT -> kein Filter", async () => {
      const filter = await asContext(tenantId, undefined, null, () =>
        resolveGoalKpiScopeFilter({ scopeType: "TENANT", scopeId: tenantId }),
      );
      expect(filter).toEqual({});
    });

    it("resolveGoalKpiScopeFilter(): COMPANY -> storeIds aller Stores der Company", async () => {
      const filter = await asContext(tenantId, undefined, null, () =>
        resolveGoalKpiScopeFilter({ scopeType: "COMPANY", scopeId: companyA1Id }),
      );
      expect(filter.storeIds?.slice().sort()).toEqual([storeA1aId, storeA1bId].sort());
    });

    it("resolveGoalKpiScopeFilter(): STORE -> storeId", async () => {
      const filter = await asContext(tenantId, undefined, null, () =>
        resolveGoalKpiScopeFilter({ scopeType: "STORE", scopeId: storeA1aId }),
      );
      expect(filter).toEqual({ storeId: storeA1aId });
    });

    it("resolveGoalKpiScopeFilter(): EMPLOYEE -> employeeId", async () => {
      const filter = await asContext(tenantId, undefined, null, () =>
        resolveGoalKpiScopeFilter({ scopeType: "EMPLOYEE", scopeId: employeeA1aId }),
      );
      expect(filter).toEqual({ employeeId: employeeA1aId });
    });
  },
);
