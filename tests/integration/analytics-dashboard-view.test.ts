/**
 * Regressionstest fuer die Mitarbeitersicht `/analytics` nach Phase 7
 * AP1-AP4 (siehe PHASE_7_IMPLEMENTATION_PLAN.md Abschnitt 8, AP5:
 * "Regressionsschutz Mitarbeitersicht"). Kein neues Feature -- Nachweis,
 * dass `buildAnalyticsDashboardView()` (Mitarbeitersicht,
 * `dashboard-view.ts`) durch die Einfuehrung der Management-Sicht
 * (`management-view.ts`) unveraendert bleibt, insbesondere:
 *
 * 1. `commissionAmountMinor`/`contributionMarginMinor` sind NICHT Teil des
 *    Mitarbeiter-View-Modells (ChatGPT-Auflage, verbatim aus der
 *    AP4-Rueckmeldung: "Insbesondere wuerde ich einen Test aufnehmen, der
 *    sicherstellt, dass commissionAmountMinor und contributionMarginMinor
 *    nicht Bestandteil des Mitarbeiter-View-Modells bzw. der Response
 *    werden.").
 * 2. Als Kontrastfall: `buildManagementAnalyticsView()` enthaelt dieselben
 *    Felder fuer denselben zugrundeliegenden Deal SEHR WOHL (RBAC-geschuetzt,
 *    Phase 7 AP3/AP4) -- belegt, dass der Unterschied gezielt und nicht
 *    zufaellig (z. B. durch fehlende Daten) zustande kommt.
 * 3. Die bestehende `storeId`-Filtersemantik/KPI-Werte der Mitarbeitersicht
 *    bleiben unveraendert (bereits durch `analytics-kpis.test.ts`
 *    abgedeckt, hier nicht dupliziert).
 *
 * Fixture-Muster identisch zu `analytics-kpis.test.ts` (Raw-Prisma-Client,
 * `describe.skipIf(!hasDatabaseUrl)`, `runWithTenantContext()`-Wrapper) --
 * bewusst NICHT dupliziert als eigene Hilfsfunktionen-Bibliothek, sondern
 * hier auf das fuer AP5 Noetige reduziert (nur EIN Deal-Fixture mit
 * bewusst von 0 verschiedenen Provisions-/Margenwerten, um ein
 * versehentliches "leeres Feld sieht man nicht" -Ergebnis auszuschliessen).
 */

import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runWithTenantContext } from "@/server/tenant/context";
import { buildAnalyticsDashboardView } from "@/server/analytics/dashboard-view";
import { buildManagementAnalyticsView } from "@/server/analytics/management-view";

const hasDatabaseUrl = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDatabaseUrl)(
  "analytics/dashboard-view.ts vs. management-view.ts (Integrationstest, echte Postgres-DB) -- AP5 Regressionsschutz",
  () => {
    const rawClient = new PrismaClient();
    const suffix = randomUUID().slice(0, 8);
    const FROM = new Date("2026-01-01T00:00:00Z");
    // "month"-Periode fuer PERIOD_FROM ergibt 2026-07-01T00:00:00Z (inklusiv)
    // bis 2026-08-01T00:00:00Z (exklusiv), siehe resolvePeriodRange() in
    // dashboard-view.ts -- IN_PERIOD liegt bewusst mittig darin.
    const PERIOD_FROM = new Date("2026-07-01T00:00:00Z");
    const IN_PERIOD = new Date("2026-07-15T10:00:00Z");

    afterAll(async () => {
      await rawClient.$disconnect();
    });

    function asEmployee<T>(tenantId: string, employeeId: string, fn: () => Promise<T>): Promise<T> {
      return runWithTenantContext(
        { tenantId, userId: randomUUID(), employeeId, roles: [], managementScope: null },
        fn,
      );
    }

    function asManager<T>(tenantId: string, employeeId: string, fn: () => Promise<T>): Promise<T> {
      return runWithTenantContext(
        {
          tenantId,
          userId: randomUUID(),
          employeeId,
          roles: [],
          managementScope: { level: "STORE", storeIds: [storeId] },
        },
        fn,
      );
    }

    let tenantId: string;
    let storeId: string;
    let employeeId: string;
    let questionnaireVersionId: string;

    beforeAll(async () => {
      const tenant = await rawClient.tenant.create({
        data: { key: `ap5-${suffix}`, name: "Test AP5", isSynthetic: true },
      });
      tenantId = tenant.id;
      const company = await rawClient.company.create({
        data: { tenantId, key: `company-ap5-${suffix}`, name: "Company AP5" },
      });
      const store = await rawClient.store.create({
        data: { tenantId, companyId: company.id, key: `store-ap5-${suffix}`, name: "Store AP5" },
      });
      storeId = store.id;
      const user = await rawClient.user.create({
        data: { tenantId, email: `ap5-${suffix}@example-synthetic.test`, isSynthetic: true },
      });
      const employee = await rawClient.employee.create({
        data: { tenantId, storeId, userId: user.id, displayName: "MA AP5" },
      });
      employeeId = employee.id;

      const questionnaire = await rawClient.questionnaire.create({
        data: { tenantId, key: `ap5-fragebogen-${suffix}` },
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
      questionnaireVersionId = version.id;

      const session = await rawClient.consultationSession.create({
        data: {
          tenantId,
          storeId,
          employeeId,
          questionnaireVersionId,
          consultationType: "NEW_CONTRACT",
          status: "COMPLETED",
          startedAt: IN_PERIOD,
          endedAt: IN_PERIOD,
        },
      });

      // EIN Deal mit bewusst von 0 verschiedenen Provisions-/Margenwerten --
      // stellt sicher, dass ein Fehlen dieser Felder im Mitarbeiter-View-
      // Modell nicht zufaellig durch "keine Daten vorhanden" erklaerbar ist.
      const deal = await rawClient.deal.create({
        data: {
          tenantId,
          consultationSessionId: session.id,
          storeId,
          employeeId,
          currency: "EUR",
          closedAt: IN_PERIOD,
        },
      });
      await rawClient.dealFinancialSnapshot.create({
        data: {
          tenantId,
          dealId: deal.id,
          currency: "EUR",
          monthlyRecurringRevenueMinor: 500,
          totalContractValueMinor: 6_000,
          oneTimeRevenueMinor: 5_500,
          commissionAmountMinor: 12_345,
          expectedRecurringCommissionMinor: 0,
          hardwarePurchaseCostMinor: 0,
          subsidyCostMinor: 0,
          discountCostMinor: 0,
          otherDirectCostMinor: 0,
          contributionMarginMinor: 6_789,
          contributionMarginFormulaVersion: "v1",
          capturedAt: IN_PERIOD,
        },
      });
    });

    it("buildAnalyticsDashboardView() (Mitarbeitersicht): deals[]-Eintraege enthalten KEINE commissionAmountMinor/contributionMarginMinor-Schluessel", async () => {
      const view = await asEmployee(tenantId, employeeId, () =>
        buildAnalyticsDashboardView({ period: "month", storeId }, PERIOD_FROM),
      );
      expect(view.deals).toHaveLength(1);
      const row = view.deals[0]!;
      expect(row.dealsClosed).toBe(1);
      expect(row.totalContractValueMinor).toBe(6_000);
      expect(row).not.toHaveProperty("commissionAmountMinor");
      expect(row).not.toHaveProperty("contributionMarginMinor");
      expect(JSON.stringify(view)).not.toContain("commissionAmountMinor");
      expect(JSON.stringify(view)).not.toContain("contributionMarginMinor");
    });

    it("buildManagementAnalyticsView() (Kontrastfall, Management-Sicht): deals[]-Eintraege ENTHALTEN commissionAmountMinor/contributionMarginMinor mit den korrekten Werten", async () => {
      const view = await asManager(tenantId, employeeId, () =>
        buildManagementAnalyticsView(
          { level: "STORE", storeIds: [storeId] },
          { period: "month" },
          PERIOD_FROM,
        ),
      );
      expect(view.deals).toHaveLength(1);
      const row = view.deals[0]!;
      expect(row.commissionAmountMinor).toBe(12_345);
      expect(row.contributionMarginMinor).toBe(6_789);
    });
  },
);

// Hinweis zu den weiteren AP5-Auflagen (siehe PHASE_7_IMPLEMENTATION_PLAN.md
// Abschnitt 8):
// - "bestehende storeId-Filtersemantik/KPI-Werte unveraendert": bereits durch
//   die unveraenderte, weiterhin gruene Suite `analytics-kpis.test.ts`
//   nachgewiesen (kpis.ts selbst wurde in Phase 7 nicht angefasst, nur um
//   `storeIds`/`employeeId` ERWEITERT).
// - "keine Nutzung von managementScope in dashboard-view.ts": per
//   Code-Inspektion bestaetigt -- `buildAnalyticsDashboardView()` nimmt nur
//   `filter: AnalyticsDashboardFilter` (kein `scope`-Parameter) entgegen und
//   importiert `management-scope.ts`/`management-authz.ts` nicht (siehe
//   Modulkommentar in dashboard-view.ts).
// - "kein indirekter Zugriff auf /analytics/management ohne Permission":
//   bereits durch `tests/unit/analytics/management-view.test.ts`
//   (`scope === null` -> `ManagementAccessDeniedError`, deny-by-default)
//   sowie `tests/unit/analytics/management-authz.test.ts` abgedeckt -- hier
//   bewusst nicht dupliziert.
