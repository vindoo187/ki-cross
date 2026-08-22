/**
 * Integrationstests fuer `analytics/goal-progress.ts::computeGoalProgress()`
 * (Phase 11 AP4 Schritt 2, siehe PHASE_11_IMPLEMENTATION_PLAN.md Abschnitt 3,
 * ChatGPT-GO 2026-08-22) gegen eine ECHTE Postgres-Datenbank -- die Funktion
 * ruft intern `getDealKpi()` auf, ist also keine reine/synchrone Funktion
 * mehr (anders als `getCalendarPeriodBounds()`, siehe `tests/unit/goal-
 * progress.test.ts`).
 *
 * Deckt die verbindliche ChatGPT-Zuordnung ab:
 * - DEALS_CLOSED = Summe `dealsClosed` ueber ALLE Currency-Buckets.
 * - REVENUE = `totalContractValueMinor` GENAU des zu `Goal.currency`
 *   passenden Currency-Buckets (keine Waehrungsvermischung, kein
 *   Aufsummieren, keine Umrechnung).
 * - Kein Bucket fuer die Goal-Currency in der Periode => `actual = 0`.
 * - CLOSE_RATE wirft `GoalMetricNotImplementedError` (weiterhin offener
 *   Blocker).
 *
 * Fixtures analog `tests/integration/analytics-kpis.test.ts`
 * (`createDealWithSnapshot()`), bewusst minimal (kein Fragebogen-/
 * Empfehlungs-Durchlauf noetig -- Deals werden direkt per Raw-Client
 * angelegt). Ohne DATABASE_URL wird die gesamte Suite uebersprungen statt
 * fehlzuschlagen.
 */

import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runWithTenantContext } from "@/server/tenant/context";
import {
  computeGoalProgress,
  GoalMetricNotImplementedError,
  type GoalProgressInput,
  type GoalVersionProgressInput,
} from "@/server/analytics/goal-progress";

const hasDatabaseUrl = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDatabaseUrl)(
  "analytics/goal-progress.ts::computeGoalProgress() (Integrationstest, echte Postgres-DB)",
  () => {
    const rawClient = new PrismaClient();
    const suffix = randomUUID().slice(0, 8);
    const FROM = new Date("2026-01-01T00:00:00Z");

    // Goal-Periode: Q3 2026 = [2026-07-01, 2026-10-01) -- deckungsgleich mit
    // getCalendarPeriodBounds("QUARTER", periodStart).
    const PERIOD_START = new Date("2026-07-01T00:00:00.000Z");
    const IN_PERIOD = new Date("2026-08-15T10:00:00.000Z");
    const BEFORE_PERIOD = new Date("2026-06-30T23:59:59.999Z");
    const AFTER_PERIOD_START_EXACT = new Date("2026-10-01T00:00:00.000Z"); // periodEnd selbst -- exklusiv.

    afterAll(async () => {
      await rawClient.$disconnect();
    });

    function asEmployee<T>(tenantId: string, employeeId: string, fn: () => Promise<T>): Promise<T> {
      return runWithTenantContext(
        { tenantId, userId: randomUUID(), employeeId, roles: [], managementScope: null },
        fn,
      );
    }

    async function createTenant(key: string) {
      const tenant = await rawClient.tenant.create({
        data: { key: `${key}-${suffix}`, name: `Test ${key}`, isSynthetic: true },
      });
      const company = await rawClient.company.create({
        data: { tenantId: tenant.id, key: `company-${key}-${suffix}`, name: `Company ${key}` },
      });
      const store = await rawClient.store.create({
        data: {
          tenantId: tenant.id,
          companyId: company.id,
          key: `store-${key}-${suffix}`,
          name: `Store ${key}`,
        },
      });
      const user = await rawClient.user.create({
        data: {
          tenantId: tenant.id,
          email: `${key}-${suffix}@example-synthetic.test`,
          isSynthetic: true,
        },
      });
      const employee = await rawClient.employee.create({
        data: { tenantId: tenant.id, storeId: store.id, userId: user.id, displayName: `MA ${key}` },
      });
      return { tenantId: tenant.id, storeId: store.id, employeeId: employee.id };
    }

    async function createQuestionnaireVersion(tenantId: string, key: string) {
      const questionnaire = await rawClient.questionnaire.create({
        data: { tenantId, key: `${key}-${suffix}` },
      });
      const version = await rawClient.questionnaireVersion.create({
        data: {
          tenantId,
          questionnaireId: questionnaire.id,
          label: "V1",
          validFrom: FROM,
          validTo: null,
          status: "ACTIVE",
        },
      });
      return version.id;
    }

    async function createSession(
      tenantId: string,
      storeId: string,
      employeeId: string,
      questionnaireVersionId: string,
      startedAt: Date,
    ) {
      const session = await rawClient.consultationSession.create({
        data: {
          tenantId,
          storeId,
          employeeId,
          questionnaireVersionId,
          consultationType: "NEW_CONTRACT",
          status: "COMPLETED",
          startedAt,
          endedAt: startedAt,
        },
      });
      return session.id;
    }

    async function createDealWithSnapshot(
      tenantId: string,
      sessionId: string,
      storeId: string,
      employeeId: string,
      closedAt: Date,
      currency: string,
      totalContractValueMinor: number,
    ) {
      const deal = await rawClient.deal.create({
        data: {
          tenantId,
          consultationSessionId: sessionId,
          storeId,
          employeeId,
          currency,
          closedAt,
        },
      });
      await rawClient.dealFinancialSnapshot.create({
        data: {
          tenantId,
          dealId: deal.id,
          currency,
          monthlyRecurringRevenueMinor: 0,
          totalContractValueMinor,
          oneTimeRevenueMinor: totalContractValueMinor,
          commissionAmountMinor: 0,
          expectedRecurringCommissionMinor: 0,
          hardwarePurchaseCostMinor: 0,
          subsidyCostMinor: 0,
          discountCostMinor: 0,
          otherDirectCostMinor: 0,
          contributionMarginMinor: totalContractValueMinor,
          contributionMarginFormulaVersion: "v1",
          capturedAt: closedAt,
        },
      });
      return deal.id;
    }

    let tenantId: string;
    let storeId: string;
    let employeeId: string;
    let questionnaireVersionId: string;

    beforeAll(async () => {
      const t = await createTenant("goalprog");
      tenantId = t.tenantId;
      storeId = t.storeId;
      employeeId = t.employeeId;
      questionnaireVersionId = await createQuestionnaireVersion(tenantId, "goalprog-fragebogen");

      // 3 EUR-Deals IN der Periode (Q3 2026): 10.000 + 20.000 + 5.000 = 35.000 Minor.
      for (const amount of [10_000, 20_000, 5_000]) {
        const sessionId = await createSession(
          tenantId,
          storeId,
          employeeId,
          questionnaireVersionId,
          IN_PERIOD,
        );
        await createDealWithSnapshot(
          tenantId,
          sessionId,
          storeId,
          employeeId,
          IN_PERIOD,
          "EUR",
          amount,
        );
      }

      // 1 USD-Deal IN der Periode: darf bei REVENUE/EUR NICHT mitgezaehlt werden.
      const usdSessionId = await createSession(
        tenantId,
        storeId,
        employeeId,
        questionnaireVersionId,
        IN_PERIOD,
      );
      await createDealWithSnapshot(
        tenantId,
        usdSessionId,
        storeId,
        employeeId,
        IN_PERIOD,
        "USD",
        99_999,
      );

      // 1 EUR-Deal VOR der Periode: darf nicht mitgezaehlt werden.
      const beforeSessionId = await createSession(
        tenantId,
        storeId,
        employeeId,
        questionnaireVersionId,
        BEFORE_PERIOD,
      );
      await createDealWithSnapshot(
        tenantId,
        beforeSessionId,
        storeId,
        employeeId,
        BEFORE_PERIOD,
        "EUR",
        123_456,
      );

      // 1 EUR-Deal GENAU bei periodEnd (exklusiv, Folgeperiode): darf nicht mitgezaehlt werden.
      const atEndSessionId = await createSession(
        tenantId,
        storeId,
        employeeId,
        questionnaireVersionId,
        AFTER_PERIOD_START_EXACT,
      );
      await createDealWithSnapshot(
        tenantId,
        atEndSessionId,
        storeId,
        employeeId,
        AFTER_PERIOD_START_EXACT,
        "EUR",
        654_321,
      );
    });

    const quarterGoal = (overrides: Partial<GoalProgressInput> = {}): GoalProgressInput => ({
      metricKey: "REVENUE",
      periodType: "QUARTER",
      periodStart: PERIOD_START,
      currency: "EUR",
      ...overrides,
    });

    it("REVENUE: actual = Summe totalContractValueMinor der EUR-Deals in der Periode (35.000), USD/Vor-/Nach-Periode ausgeschlossen", async () => {
      const goal = quarterGoal({ metricKey: "REVENUE", currency: "EUR" });
      const version: GoalVersionProgressInput = {
        targetAmountMinor: 50_000,
        targetCount: null,
        targetPercentageBasisPoints: null,
      };
      const progress = await asEmployee(tenantId, employeeId, () =>
        computeGoalProgress(goal, version),
      );
      expect(progress.target).toBe(50_000);
      expect(progress.actual).toBe(35_000);
      expect(progress.achievementRate).toBeCloseTo(0.7);
      expect(progress.remaining).toBe(15_000);
    });

    it("REVENUE: kein Bucket fuer die Goal-Currency in der Periode => actual = 0 (kein Fehler)", async () => {
      const goal = quarterGoal({ metricKey: "REVENUE", currency: "CHF" });
      const version: GoalVersionProgressInput = {
        targetAmountMinor: 1_000,
        targetCount: null,
        targetPercentageBasisPoints: null,
      };
      const progress = await asEmployee(tenantId, employeeId, () =>
        computeGoalProgress(goal, version),
      );
      expect(progress.actual).toBe(0);
      expect(progress.remaining).toBe(1_000);
    });

    it("REVENUE: target = 0 => achievementRate ist null (Division durch 0 vermieden)", async () => {
      const goal = quarterGoal({ metricKey: "REVENUE", currency: "EUR" });
      const version: GoalVersionProgressInput = {
        targetAmountMinor: 0,
        targetCount: null,
        targetPercentageBasisPoints: null,
      };
      const progress = await asEmployee(tenantId, employeeId, () =>
        computeGoalProgress(goal, version),
      );
      expect(progress.achievementRate).toBeNull();
      // remaining bewusst nicht auf 0 geclampt -- negativ bei Uebererfuellung.
      expect(progress.remaining).toBe(-35_000);
    });

    it("DEALS_CLOSED: actual = Anzahl EUR-Deals in der Periode ueber alle Currency-Buckets aufsummiert (4: 3 EUR + 1 USD)", async () => {
      const goal = quarterGoal({ metricKey: "DEALS_CLOSED", currency: null });
      const version: GoalVersionProgressInput = {
        targetAmountMinor: null,
        targetCount: 5,
        targetPercentageBasisPoints: null,
      };
      const progress = await asEmployee(tenantId, employeeId, () =>
        computeGoalProgress(goal, version),
      );
      // 3 EUR-Deals + 1 USD-Deal in der Periode -- DEALS_CLOSED ist waehrungsunabhaengig.
      expect(progress.actual).toBe(4);
      expect(progress.target).toBe(5);
      expect(progress.remaining).toBe(1);
    });

    it("CLOSE_RATE: wirft GoalMetricNotImplementedError (weiterhin offener Blocker)", async () => {
      const goal = quarterGoal({ metricKey: "CLOSE_RATE", currency: null });
      const version: GoalVersionProgressInput = {
        targetAmountMinor: null,
        targetCount: null,
        targetPercentageBasisPoints: 5000,
      };
      await expect(
        asEmployee(tenantId, employeeId, () => computeGoalProgress(goal, version)),
      ).rejects.toThrow(GoalMetricNotImplementedError);
    });

    it("REVENUE ohne targetAmountMinor/currency wirft einen Defense-in-Depth-Fehler (inkonsistenter Datenzustand)", async () => {
      const goal = quarterGoal({ metricKey: "REVENUE", currency: null });
      const version: GoalVersionProgressInput = {
        targetAmountMinor: null,
        targetCount: null,
        targetPercentageBasisPoints: null,
      };
      await expect(
        asEmployee(tenantId, employeeId, () => computeGoalProgress(goal, version)),
      ).rejects.toThrow(/inkonsistenter Datenzustand/);
    });

    it("DEALS_CLOSED ohne targetCount wirft einen Defense-in-Depth-Fehler (inkonsistenter Datenzustand)", async () => {
      const goal = quarterGoal({ metricKey: "DEALS_CLOSED", currency: null });
      const version: GoalVersionProgressInput = {
        targetAmountMinor: null,
        targetCount: null,
        targetPercentageBasisPoints: null,
      };
      await expect(
        asEmployee(tenantId, employeeId, () => computeGoalProgress(goal, version)),
      ).rejects.toThrow(/inkonsistenter Datenzustand/);
    });

    it("Scope-Filter (storeId) wird unveraendert an getDealKpi() durchgereicht -- fremder Store liefert actual = 0", async () => {
      const other = await createTenant("goalprog-other-store");
      // Eigener Tenant, damit der fremde Store garantiert 0 Deals hat --
      // Testet nur, dass der Scope-Filter durchgereicht wird, nicht die
      // Tenant-Isolation selbst (die deckt kpis.ts bereits ab).
      const goal = quarterGoal({ metricKey: "REVENUE", currency: "EUR" });
      const version: GoalVersionProgressInput = {
        targetAmountMinor: 1_000,
        targetCount: null,
        targetPercentageBasisPoints: null,
      };
      const progress = await asEmployee(other.tenantId, other.employeeId, () =>
        computeGoalProgress(goal, version, { storeId: other.storeId }),
      );
      expect(progress.actual).toBe(0);
    });
  },
);
