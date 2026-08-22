/**
 * Integrationstests fuer `buildGoalProgressForEmployee()`/
 * `buildGoalProgressForManagement()` (Phase 11 AP7, siehe
 * PHASE_11_IMPLEMENTATION_PLAN.md Abschnitt 3, ChatGPT-GO 2026-08-22 nach
 * AP7-Discovery) gegen eine ECHTE Postgres-Datenbank.
 *
 * Ergaenzt (nicht dupliziert) `tests/integration/goal-visibility.test.ts`
 * (AP5, deckt bereits die vier Sichtbarkeitsregeln + `resolveGoalKpiScope
 * Filter()` ab) um die AP7-spezifische Komposition:
 * - Nur AKTIVE Goals (`isGoalPeriodActive()`) werden aufbereitet --
 *   vergangene/zukuenftige Goals bleiben unsichtbar in diesem View-Model.
 * - `GoalProgressViewModel`-Felder sind korrekt befuellt (scopeLabel,
 *   periodStart/periodEnd als ISO-Strings, target/actual/achievementRate/
 *   remaining aus `computeGoalProgress()`).
 * - Management: die "keine anteilige Zielprojektion"-Regel (ChatGPTs
 *   Praezisierung) -- ein COMPANY-Goal verschwindet, sobald auf eine
 *   einzelne Filiale dieser Company gefiltert wird, weil
 *   `buildGoalProgressForManagement()` den ROHEN angefragten Filter (nicht
 *   den vollen autorisierten Scope) an `listVisibleGoalsForManagement()`
 *   durchreicht.
 *
 * Metrik `DEALS_CLOSED` mit `targetCount` gewaehlt, um OHNE Deal-Fixtures
 * auszukommen (0 Abschluesse in der Periode -> `actual = 0`, kein Fehler --
 * siehe `computeGoalProgress()`-Modulkommentar). Die eigentliche
 * Ziel-vs.-Ist-Rechenlogik ist bereits vollstaendig in
 * `tests/integration/goal-progress.test.ts` (AP4) abgedeckt; hier geht es
 * ausschliesslich um die AP7-Komposition (aktiv-Filter + Scope-Wiring).
 *
 * Ohne DATABASE_URL wird die gesamte Suite uebersprungen statt fehlzuschlagen.
 */

import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runWithTenantContext } from "@/server/tenant/context";
import { createGoal, createGoalVersion } from "@/server/admin/goal-admin";
import type { ManagementScope } from "@/server/authz/management-scope";
import {
  buildGoalProgressForEmployee,
  buildGoalProgressForManagement,
} from "@/server/analytics/goal-visibility";

const hasDatabaseUrl = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDatabaseUrl)(
  "analytics/goal-visibility.ts: buildGoalProgressForEmployee()/buildGoalProgressForManagement() (Integrationstest, echte Postgres-DB)",
  () => {
    const rawClient = new PrismaClient();
    const suffix = randomUUID().slice(0, 8);
    // "now" fuer alle Tests -- fest, damit "aktiv"/"inaktiv" deterministisch
    // ist (siehe isGoalPeriodActive()-Praezisierung).
    const NOW = new Date("2026-08-15T00:00:00.000Z");
    const ACTIVE_PERIOD_START = new Date("2026-08-01T00:00:00.000Z"); // MONTH, deckt NOW ab
    const PAST_PERIOD_START = new Date("2026-06-01T00:00:00.000Z"); // MONTH, liegt bereits in der Vergangenheit
    const FUTURE_PERIOD_START = new Date("2026-10-01T00:00:00.000Z"); // MONTH, liegt noch in der Zukunft

    afterAll(async () => {
      await rawClient.$disconnect();
    });

    function asContext<T>(
      tenantId: string,
      userId: string,
      employeeId: string | undefined,
      managementScope: ManagementScope | null,
      fn: () => Promise<T>,
    ): Promise<T> {
      return runWithTenantContext({ tenantId, userId, employeeId, roles: [], managementScope }, fn);
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
    let actorId: string;
    let companyId: string;
    let storeAId: string;
    let storeBId: string;
    let employeeId: string;

    let goalEmployeeActiveId: string;
    let goalEmployeePastId: string;
    let goalCompanyActiveId: string;

    beforeAll(async () => {
      tenantId = await createTenant("goalview");
      actorId = await createUser(tenantId, "actor");
      companyId = await createCompany(tenantId, "C1");
      storeAId = await createStore(tenantId, companyId, "C1a");
      storeBId = await createStore(tenantId, companyId, "C1b");
      employeeId = await createEmployee(tenantId, storeAId, "C1a");

      const createGoalAs = (
        scopeType: "TENANT" | "COMPANY" | "STORE" | "EMPLOYEE",
        scopeId: string,
        periodStart: Date,
      ) =>
        asContext(tenantId, actorId, undefined, null, () =>
          createGoal({
            scopeType,
            scopeId,
            metricKey: "DEALS_CLOSED",
            periodType: "MONTH",
            periodStart,
            currency: null,
            targetAmountMinor: null,
            targetCount: 10,
            targetPercentageBasisPoints: null,
          }),
        );

      // Aktives EMPLOYEE-Goal (deckt NOW ab) + ein bereits abgeschlossenes
      // EMPLOYEE-Goal desselben Mitarbeiters (Vergangenheit) -- muss von
      // buildGoalProgressForEmployee() ausgefiltert werden.
      goalEmployeeActiveId = (await createGoalAs("EMPLOYEE", employeeId, ACTIVE_PERIOD_START)).id;
      goalEmployeePastId = (await createGoalAs("EMPLOYEE", employeeId, PAST_PERIOD_START)).id;

      // Aktives COMPANY-Goal (beide Stores der Company) fuer die
      // "keine anteilige Zielprojektion"-Pruefung + ein zukuenftiges
      // COMPANY-Goal (muss ausgefiltert werden).
      goalCompanyActiveId = (await createGoalAs("COMPANY", companyId, ACTIVE_PERIOD_START)).id;
      await createGoalAs("COMPANY", companyId, FUTURE_PERIOD_START);
    });

    // -----------------------------------------------------------------
    // 1. buildGoalProgressForEmployee()
    // -----------------------------------------------------------------

    it("liefert ausschliesslich das AKTIVE eigene EMPLOYEE-Goal, nicht das vergangene", async () => {
      const viewModels = await asContext(tenantId, actorId, employeeId, null, () =>
        buildGoalProgressForEmployee(NOW),
      );
      expect(viewModels.map((v) => v.goalId)).toEqual([goalEmployeeActiveId]);
      expect(viewModels.some((v) => v.goalId === goalEmployeePastId)).toBe(false);
    });

    it("GoalProgressViewModel-Felder sind vollstaendig befuellt (Scope-Label, Periodengrenzen, Ziel-vs.-Ist)", async () => {
      const viewModels = await asContext(tenantId, actorId, employeeId, null, () =>
        buildGoalProgressForEmployee(NOW),
      );
      expect(viewModels).toHaveLength(1);
      const viewModel = viewModels[0]!;
      expect(viewModel.metricKey).toBe("DEALS_CLOSED");
      expect(viewModel.periodType).toBe("MONTH");
      expect(viewModel.periodStart).toBe("2026-08-01T00:00:00.000Z");
      expect(viewModel.periodEnd).toBe("2026-09-01T00:00:00.000Z");
      expect(viewModel.currency).toBeNull();
      expect(viewModel.target).toBe(10);
      // Keine Deal-Fixtures angelegt -- 0 Abschluesse in der Periode ist der
      // korrekte, fehlerfreie Ist-Wert (siehe computeGoalProgress()).
      expect(viewModel.actual).toBe(0);
      expect(viewModel.achievementRate).toBe(0);
      expect(viewModel.remaining).toBe(10);
      expect(viewModel.scopeLabel).toContain("Mitarbeiter");
      expect(viewModel.scopeLabel).toContain("MA C1a");
    });

    it("Mitarbeiter ohne aktive Goals erhaelt eine leere Liste (kein Fehler)", async () => {
      const viewModels = await asContext(tenantId, actorId, employeeId, null, () =>
        buildGoalProgressForEmployee(new Date("2027-01-01T00:00:00.000Z")),
      );
      expect(viewModels).toEqual([]);
    });

    // -----------------------------------------------------------------
    // 2. buildGoalProgressForManagement() -- aktiv-Filter
    // -----------------------------------------------------------------

    it("Management sieht das AKTIVE COMPANY-Goal bei vollem Company-Scope, das zukuenftige COMPANY-Goal jedoch nicht", async () => {
      const scope: ManagementScope = { level: "COMPANY", storeIds: [storeAId, storeBId] };
      const viewModels = await asContext(tenantId, actorId, undefined, scope, () =>
        buildGoalProgressForManagement(scope, undefined, undefined, NOW),
      );
      const ids = viewModels.map((v) => v.goalId);
      expect(ids).toContain(goalCompanyActiveId);
      expect(ids).toContain(goalEmployeeActiveId);
      expect(ids).not.toContain(goalEmployeePastId);
      expect(viewModels.length).toBe(2);
    });

    // -----------------------------------------------------------------
    // 3. "Keine anteilige Zielprojektion" -- ChatGPTs AP7-Praezisierung
    // -----------------------------------------------------------------

    it("COMPANY-Goal verschwindet, sobald auf EINE einzelne Filiale der Company gefiltert wird (kein anteiliges Ziel)", async () => {
      // Voller autorisierter Scope deckt BEIDE Stores ab, der Manager filtert
      // das Dashboard aber auf storeAId -- buildGoalProgressForManagement()
      // muss den ROHEN Filter (nicht den vollen Scope) durchreichen, damit
      // isCompanyFullyAuthorized() korrekt "false" liefert (siehe
      // Modulkommentar goal-visibility.ts).
      const scope: ManagementScope = { level: "COMPANY", storeIds: [storeAId, storeBId] };
      const viewModels = await asContext(tenantId, actorId, undefined, scope, () =>
        buildGoalProgressForManagement(scope, storeAId, undefined, NOW),
      );
      const ids = viewModels.map((v) => v.goalId);
      expect(ids).not.toContain(goalCompanyActiveId);
      // Das EMPLOYEE-Goal von employeeId (gehoert zu storeAId) bleibt sichtbar.
      expect(ids).toContain(goalEmployeeActiveId);
    });

    it("Ohne Filialfilter (voller Scope) ist das COMPANY-Goal wieder sichtbar -- bestaetigt, dass der Effekt am Filter liegt", async () => {
      const scope: ManagementScope = { level: "COMPANY", storeIds: [storeAId, storeBId] };
      const viewModels = await asContext(tenantId, actorId, undefined, scope, () =>
        buildGoalProgressForManagement(scope, undefined, undefined, NOW),
      );
      expect(viewModels.map((v) => v.goalId)).toContain(goalCompanyActiveId);
    });

    // -----------------------------------------------------------------
    // 4. AP9: Mehrere gleichzeitig aktive Goals (unterschiedliche Metrik)
    //    + Versionshistorie -> tatsaechlicher Progress nutzt v2
    //    (ChatGPT-Praezisierung nach AP9-Discovery, 2026-08-23: "Der
    //    bestehende Unique-Constraint darf nur echte Duplikate verhindern"
    //    bzw. "computeGoalProgress() bzw. der vollstaendige Visibility-/
    //    View-Pfad muss nachweislich v2 verwenden" -- beide Tests nutzen
    //    bewusst den ECHTEN Service-/DB-Pfad statt Mocks, wie von ChatGPT
    //    ausdruecklich gefordert.)
    // -----------------------------------------------------------------
    describe("4. AP9: mehrere aktive Goals + Versionshistorie im echten View-Pfad", () => {
      it("zwei gleichzeitig aktive Goals mit UNTERSCHIEDLICHER Metrik fuer denselben Scope+Periode sind beide sichtbar und werden unabhaengig berechnet", async () => {
        const soloTenantId = await createTenant("ap9-multi-metric");
        const soloActorId = await createUser(soloTenantId, "actor");
        const soloCompanyId = await createCompany(soloTenantId, "C1");
        const soloStoreId = await createStore(soloTenantId, soloCompanyId, "S1");
        const soloEmployeeId = await createEmployee(soloTenantId, soloStoreId, "E1");

        // Gleicher Scope (EMPLOYEE) + gleiche Periode, aber unterschiedliche
        // metricKey -- der Unique-Constraint (scope+metric+period) darf dies
        // NICHT als Duplikat ablehnen, da die Identitaet ueber metricKey
        // mitbestimmt wird (siehe goals_scope_metric_period_key).
        const dealsGoal = await asContext(soloTenantId, soloActorId, undefined, null, () =>
          createGoal({
            scopeType: "EMPLOYEE",
            scopeId: soloEmployeeId,
            metricKey: "DEALS_CLOSED",
            periodType: "MONTH",
            periodStart: ACTIVE_PERIOD_START,
            currency: null,
            targetAmountMinor: null,
            targetCount: 15,
            targetPercentageBasisPoints: null,
          }),
        );
        const revenueGoal = await asContext(soloTenantId, soloActorId, undefined, null, () =>
          createGoal({
            scopeType: "EMPLOYEE",
            scopeId: soloEmployeeId,
            metricKey: "REVENUE",
            periodType: "MONTH",
            periodStart: ACTIVE_PERIOD_START,
            currency: "EUR",
            targetAmountMinor: 250_000,
            targetCount: null,
            targetPercentageBasisPoints: null,
          }),
        );

        const viewModels = await asContext(soloTenantId, soloActorId, soloEmployeeId, null, () =>
          buildGoalProgressForEmployee(NOW),
        );

        expect(viewModels).toHaveLength(2);
        const byGoalId = new Map(viewModels.map((v) => [v.goalId, v]));
        const dealsView = byGoalId.get(dealsGoal.id);
        const revenueView = byGoalId.get(revenueGoal.id);
        expect(dealsView).toBeDefined();
        expect(revenueView).toBeDefined();
        // Unabhaengige Berechnung: jede Metrik behaelt ihr eigenes Target/
        // Currency, keine Vermischung der beiden gleichzeitig aktiven Goals.
        expect(dealsView?.metricKey).toBe("DEALS_CLOSED");
        expect(dealsView?.target).toBe(15);
        expect(dealsView?.currency).toBeNull();
        expect(revenueView?.metricKey).toBe("REVENUE");
        expect(revenueView?.target).toBe(250_000);
        expect(revenueView?.currency).toBe("EUR");
      });

      it("nach Anlegen einer neuen GoalVersion (v2) verwendet der VOLLSTAENDIGE View-Pfad (buildGoalProgressForEmployee) nachweislich v2, nicht v1", async () => {
        const soloTenantId = await createTenant("ap9-version-progress");
        const soloActorId = await createUser(soloTenantId, "actor");
        const soloCompanyId = await createCompany(soloTenantId, "C1");
        const soloStoreId = await createStore(soloTenantId, soloCompanyId, "S1");
        const soloEmployeeId = await createEmployee(soloTenantId, soloStoreId, "E1");

        const goal = await asContext(soloTenantId, soloActorId, undefined, null, () =>
          createGoal({
            scopeType: "EMPLOYEE",
            scopeId: soloEmployeeId,
            metricKey: "DEALS_CLOSED",
            periodType: "MONTH",
            periodStart: ACTIVE_PERIOD_START,
            currency: null,
            targetAmountMinor: null,
            targetCount: 10,
            targetPercentageBasisPoints: null,
          }),
        );

        const viewBeforeV2 = await asContext(soloTenantId, soloActorId, soloEmployeeId, null, () =>
          buildGoalProgressForEmployee(NOW),
        );
        expect(viewBeforeV2).toHaveLength(1);
        expect(viewBeforeV2[0]?.target).toBe(10);
        // 0 Abschluesse in der Periode -> achievementRate = actual/target = 0.
        expect(viewBeforeV2[0]?.achievementRate).toBe(0);
        expect(viewBeforeV2[0]?.remaining).toBe(10);

        await asContext(soloTenantId, soloActorId, undefined, null, () =>
          createGoalVersion(goal.id, { targetCount: 40 }),
        );

        const viewAfterV2 = await asContext(soloTenantId, soloActorId, soloEmployeeId, null, () =>
          buildGoalProgressForEmployee(NOW),
        );
        expect(viewAfterV2).toHaveLength(1);
        // Der komplette Pfad Goal -> currentVersion -> computeGoalProgress()
        // -> GoalProgressViewModel muss jetzt das NEUE Target (v2 = 40)
        // liefern, nicht mehr das urspruengliche (v1 = 10).
        expect(viewAfterV2[0]?.target).toBe(40);
        expect(viewAfterV2[0]?.remaining).toBe(40);

        // Gegenprobe: v1 selbst bleibt in der DB unveraendert bestehen (kein
        // Update-Pfad) -- die Aenderung im View kommt ausschliesslich daher,
        // dass getCurrentGoalVersion() jetzt v2 statt v1 liefert.
        const v1Row = await rawClient.goalVersion.findFirst({
          where: { goalId: goal.id, versionNumber: 1 },
        });
        expect(v1Row?.targetCount).toBe(10);
      });
    });
  },
);
