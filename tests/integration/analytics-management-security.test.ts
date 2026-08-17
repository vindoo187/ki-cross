/**
 * Phase 7 AP7 -- der von ChatGPT als "entscheidender Validierungsblock"
 * bezeichnete Sicherheits-/Integrationstest fuer die VOLLE Kette
 *   Session -> managementScope -> resolveAuthorizedStoreFilter() ->
 *   KPI-Aggregation -> ManagementAnalyticsView -> HTTP-Route.
 * Siehe PHASE_7_IMPLEMENTATION_PLAN.md Abschnitt 8 (AP7) fuer den
 * verbindlichen Testumfang (6 Abschnitte, siehe Gliederung unten).
 *
 * Alles gegen ECHTE Postgres-Fixtures (kein `vi.mock`, Codebase-Konvention).
 * Ohne DATABASE_URL wird die gesamte Suite uebersprungen statt fehlzuschlagen.
 *
 * Fixture-Szenario (bewusst mit UNTERSCHEIDBAREN Finanzwerten je Filiale,
 * damit eine versehentliche Datenvermischung sofort sichtbar wird, siehe
 * ChatGPTs Beispiel "Store A -> 100 EUR, Store B -> 900 EUR"):
 *
 *   Tenant A
 *     Company A1 -> Store A1a (Deal: 1_111 / Provision 111 / Marge 11, Outcome ACCEPTED)
 *                -> Store A1b (Deal: 2_222 / Provision 222 / Marge 22, Outcome REJECTED)
 *     Company A2 -> Store A2a (Deal: 3_333 / Provision 333 / Marge 33, Outcome DEFERRED)
 *   Tenant B (voellig separat, MUSS in keinem Tenant-A-Ergebnis auftauchen)
 *     Company B1 -> Store B1a (Deal: 9_999 / Provision 999 / Marge 99, Outcome ACCEPTED)
 *
 * "Manager"-Akteure (Tenant A) mit unterschiedlichen RoleAssignment-
 * Konfigurationen fuer Abschnitt 1 (Scope-Aufloesung):
 *   - managerStoreA1a:      1x STORE-Assignment auf A1a
 *   - managerCompanyA1:     1x COMPANY-Assignment auf Company A1 (deckt A1a+A1b)
 *   - managerTenantA:       1x TENANT-Assignment (deckt A1a+A1b+A2a)
 *   - managerMultiStore:    2x STORE-Assignment auf A1a UND A2a (Union+Dedup, ueber Company-Grenzen hinweg)
 *   - managerMultiLevel:    1x STORE (A1b) + 1x COMPANY (A1) -> hoechste Stufe (COMPANY) gewinnt
 *   - managerWrongPermission: 1x STORE-Assignment, aber Rolle OHNE analytics.view_store
 *   - managerRevoked:       1x STORE-Assignment mit korrekter Permission, aber revokedAt gesetzt
 *   - managerNone:          gar kein RoleAssignment
 */

import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runWithTenantContext } from "@/server/tenant/context";
import {
  resolveManagementScopeForUser,
  buildSessionPayloadForEmployee,
} from "@/server/auth/dev-users";
import {
  resolveAuthorizedStoreFilter,
  ManagementAccessDeniedError,
} from "@/server/analytics/management-authz";
import { buildManagementAnalyticsView } from "@/server/analytics/management-view";
import { buildAnalyticsDashboardView } from "@/server/analytics/dashboard-view";
import { createSessionToken, SESSION_COOKIE_NAME } from "@/server/auth/session";
import { GET as getManagementAnalytics } from "@/app/api/analytics/management/route";

const hasDatabaseUrl = Boolean(process.env.DATABASE_URL);
// Nur zum Signieren von Test-Session-Tokens noetig (siehe session.ts) -- kein
// echtes Geheimnis, analog zum CI-Platzhalter in .github/workflows/ci.yml.
process.env.DEV_AUTH_SECRET ??= "ap7-test-secret-not-for-prod";

describe.skipIf(!hasDatabaseUrl)(
  "Phase 7 AP7: Sicherheitskette Scope -> AuthZ -> KPI-Aggregation -> UI (echte Postgres-DB)",
  () => {
    const rawClient = new PrismaClient();
    const suffix = randomUUID().slice(0, 8);
    const FROM = new Date("2026-01-01T00:00:00Z");
    // Bewusst nahe an der ECHTEN aktuellen Zeit (nicht ein fixes historisches
    // Datum): Abschnitt 6 testet den echten HTTP-Route-Handler, der
    // buildManagementAnalyticsView() OHNE expliziten `now`-Parameter aufruft
    // (verwendet also intern `new Date()`). Die Fixture-Zeitstempel muessen
    // deshalb tatsaechlich "diesen Monat" liegen, egal wann die Suite laeuft.
    const NOW = new Date();
    const IN_PERIOD = new Date(NOW.getTime() - 60_000);

    afterAll(async () => {
      await rawClient.$disconnect();
    });

    // -------------------------------------------------------------------
    // Generische Fixture-Helfer
    // -------------------------------------------------------------------

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

    async function createUserEmployee(tenantId: string, storeId: string, key: string) {
      const user = await rawClient.user.create({
        data: { tenantId, email: `${key}-${suffix}@example-synthetic.test`, isSynthetic: true },
      });
      const employee = await rawClient.employee.create({
        data: { tenantId, storeId, userId: user.id, displayName: `MA ${key}` },
      });
      return { userId: user.id, employeeId: employee.id };
    }

    async function upsertPermission(key: string, description: string) {
      const permission = await rawClient.permission.upsert({
        where: { key },
        update: {},
        create: { key, description },
      });
      return permission.id;
    }

    async function createRole(tenantId: string, key: string, permissionIds: string[]) {
      const role = await rawClient.role.create({
        data: { tenantId, key: `${key}-${suffix}`, name: `Rolle ${key}` },
      });
      for (const permissionId of permissionIds) {
        await rawClient.rolePermission.create({ data: { roleId: role.id, permissionId } });
      }
      return role.id;
    }

    async function createRoleAssignment(
      tenantId: string,
      userId: string,
      roleId: string,
      scopeType: "TENANT" | "COMPANY" | "STORE",
      companyId: string | null,
      storeId: string | null,
      revoked = false,
    ) {
      await rawClient.roleAssignment.create({
        data: {
          tenantId,
          userId,
          roleId,
          scopeType,
          companyId,
          storeId,
          revokedAt: revoked ? new Date("2026-01-02T00:00:00Z") : null,
        },
      });
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

    async function createCatalog(tenantId: string, key: string) {
      const provider = await rawClient.provider.create({
        data: { key: `provider-${key}-${suffix}`, name: `Provider ${key}`, isSynthetic: true },
      });
      const category = await rawClient.productCategory.create({
        data: { tenantId, key: `category-${key}-${suffix}`, name: `Kategorie ${key}` },
      });
      const product = await rawClient.product.create({
        data: {
          tenantId,
          providerId: provider.id,
          categoryId: category.id,
          productType: "MOBILE_NEW_CONTRACT",
          name: `Produkt ${key}`,
          isSynthetic: true,
        },
      });
      const productVersion = await rawClient.productVersion.create({
        data: {
          tenantId,
          productId: product.id,
          versionNumber: 1,
          status: "ACTIVE",
          validFrom: FROM,
          validTo: null,
          currency: "EUR",
          monthlyPriceMinor: 1000,
          oneTimePriceMinor: 0,
        },
      });
      const ruleSet = await rawClient.ruleSet.create({
        data: { tenantId, key: `rs-${key}-${suffix}` },
      });
      const ruleSetVersion = await rawClient.ruleSetVersion.create({
        data: {
          tenantId,
          ruleSetId: ruleSet.id,
          label: "V1",
          validFrom: FROM,
          validTo: null,
          status: "ACTIVE",
        },
      });
      return { productVersionId: productVersion.id, ruleSetVersionId: ruleSetVersion.id };
    }

    /**
     * Legt fuer EINE Filiale eine vollstaendige, in sich unterscheidbare
     * Daten-Kohorte an: 1 abgeschlossene Beratung, 1 Empfehlung mit 1
     * Outcome (Typ als Parameter, um Vermischung sichtbar zu machen), 1
     * Deal mit den uebergebenen (bewusst je Filiale unterschiedlichen)
     * Finanzwerten.
     */
    async function createStoreCohort(
      tenantId: string,
      storeId: string,
      employeeId: string,
      questionnaireVersionId: string,
      productVersionId: string,
      ruleSetVersionId: string,
      outcomeType: "ACCEPTED" | "REJECTED" | "DEFERRED",
      oneTimeRevenueMinor: number,
      commissionAmountMinor: number,
      contributionMarginMinor: number,
    ) {
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

      const recommendation = await rawClient.recommendation.create({
        data: {
          tenantId,
          consultationSessionId: session.id,
          ruleSetVersionId,
          algorithmVersion: 1,
          evaluationFingerprint: randomUUID().replace(/-/g, "").padEnd(64, "0"),
          generatedAt: IN_PERIOD,
        },
      });
      const item = await rawClient.recommendationItem.create({
        data: {
          tenantId,
          recommendationId: recommendation.id,
          productVersionId,
          eligibilityPassed: true,
          customerFitScore: 80,
          businessPriorityScore: 50,
          priorityRank: 1,
        },
      });
      await rawClient.recommendationOutcome.create({
        data: {
          tenantId,
          recommendationItemId: item.id,
          outcome: outcomeType,
          decidedByEmployeeId: employeeId,
          decidedAt: IN_PERIOD,
        },
      });

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
          monthlyRecurringRevenueMinor: 100,
          totalContractValueMinor: oneTimeRevenueMinor + 100,
          oneTimeRevenueMinor,
          commissionAmountMinor,
          expectedRecurringCommissionMinor: 0,
          hardwarePurchaseCostMinor: 0,
          subsidyCostMinor: 0,
          discountCostMinor: 0,
          otherDirectCostMinor: 0,
          contributionMarginMinor,
          contributionMarginFormulaVersion: "v1",
          capturedAt: IN_PERIOD,
        },
      });

      return { sessionId: session.id };
    }

    // -------------------------------------------------------------------
    // Fixture-Zustand
    // -------------------------------------------------------------------

    let tenantA: string, tenantB: string;
    let companyA1: string, companyA2: string, companyB1: string;
    let storeA1a: string, storeA1b: string, storeA2a: string, storeB1a: string;
    let empA1a: { userId: string; employeeId: string };
    let empA1b: { userId: string; employeeId: string };
    let empA2a: { userId: string; employeeId: string };
    let empB1a: { userId: string; employeeId: string };

    let permStore: string, permCompany: string, permTenant: string;
    let roleStoreAdmin: string,
      roleCompanyMgmt: string,
      roleTenantMgmt: string,
      roleSalesOnly: string;

    let managerStoreA1a: { userId: string; employeeId: string };
    let managerCompanyA1: { userId: string; employeeId: string };
    let managerTenantA: { userId: string; employeeId: string };
    let managerMultiStore: { userId: string; employeeId: string };
    let managerMultiLevel: { userId: string; employeeId: string };
    let managerWrongPermission: { userId: string; employeeId: string };
    let managerRevoked: { userId: string; employeeId: string };
    let managerNone: { userId: string; employeeId: string };

    beforeAll(async () => {
      tenantA = await createTenant("ap7-a");
      tenantB = await createTenant("ap7-b");

      companyA1 = await createCompany(tenantA, "a1");
      companyA2 = await createCompany(tenantA, "a2");
      companyB1 = await createCompany(tenantB, "b1");

      storeA1a = await createStore(tenantA, companyA1, "a1a");
      storeA1b = await createStore(tenantA, companyA1, "a1b");
      storeA2a = await createStore(tenantA, companyA2, "a2a");
      storeB1a = await createStore(tenantB, companyB1, "b1a");

      empA1a = await createUserEmployee(tenantA, storeA1a, "emp-a1a");
      empA1b = await createUserEmployee(tenantA, storeA1b, "emp-a1b");
      empA2a = await createUserEmployee(tenantA, storeA2a, "emp-a2a");
      empB1a = await createUserEmployee(tenantB, storeB1a, "emp-b1a");

      permStore = await upsertPermission(
        "analytics.view_store",
        "Management-Analytics: eigene Filiale",
      );
      permCompany = await upsertPermission(
        "analytics.view_company",
        "Management-Analytics: eigenes Unternehmen",
      );
      permTenant = await upsertPermission(
        "analytics.view_tenant",
        "Management-Analytics: gesamter Mandant",
      );

      roleStoreAdmin = await createRole(tenantA, "store-admin", [permStore]);
      roleCompanyMgmt = await createRole(tenantA, "company-mgmt", [permCompany]);
      roleTenantMgmt = await createRole(tenantA, "tenant-mgmt", [permTenant]);
      // Rolle OHNE die drei Management-Analytics-Permissions -- fuer den
      // "falsche/keine passende Permission"-Testfall.
      roleSalesOnly = await createRole(tenantA, "sales-only", []);

      managerStoreA1a = await createUserEmployee(tenantA, storeA1a, "mgr-store-a1a");
      managerCompanyA1 = await createUserEmployee(tenantA, storeA1a, "mgr-company-a1");
      managerTenantA = await createUserEmployee(tenantA, storeA1a, "mgr-tenant-a");
      managerMultiStore = await createUserEmployee(tenantA, storeA1a, "mgr-multi-store");
      managerMultiLevel = await createUserEmployee(tenantA, storeA1b, "mgr-multi-level");
      managerWrongPermission = await createUserEmployee(tenantA, storeA1a, "mgr-wrong-perm");
      managerRevoked = await createUserEmployee(tenantA, storeA1a, "mgr-revoked");
      managerNone = await createUserEmployee(tenantA, storeA1a, "mgr-none");

      await createRoleAssignment(
        tenantA,
        managerStoreA1a.userId,
        roleStoreAdmin,
        "STORE",
        companyA1,
        storeA1a,
      );
      await createRoleAssignment(
        tenantA,
        managerCompanyA1.userId,
        roleCompanyMgmt,
        "COMPANY",
        companyA1,
        null,
      );
      await createRoleAssignment(
        tenantA,
        managerTenantA.userId,
        roleTenantMgmt,
        "TENANT",
        null,
        null,
      );
      await createRoleAssignment(
        tenantA,
        managerMultiStore.userId,
        roleStoreAdmin,
        "STORE",
        companyA1,
        storeA1a,
      );
      await createRoleAssignment(
        tenantA,
        managerMultiStore.userId,
        roleStoreAdmin,
        "STORE",
        companyA2,
        storeA2a,
      );
      await createRoleAssignment(
        tenantA,
        managerMultiLevel.userId,
        roleStoreAdmin,
        "STORE",
        companyA1,
        storeA1b,
      );
      await createRoleAssignment(
        tenantA,
        managerMultiLevel.userId,
        roleCompanyMgmt,
        "COMPANY",
        companyA1,
        null,
      );
      await createRoleAssignment(
        tenantA,
        managerWrongPermission.userId,
        roleSalesOnly,
        "STORE",
        companyA1,
        storeA1a,
      );
      await createRoleAssignment(
        tenantA,
        managerRevoked.userId,
        roleStoreAdmin,
        "STORE",
        companyA1,
        storeA1a,
        true,
      );
      // managerNone bekommt bewusst KEIN RoleAssignment.

      const questionnaireVersionIdA = await createQuestionnaireVersion(tenantA, "ap7-a");
      const questionnaireVersionIdB = await createQuestionnaireVersion(tenantB, "ap7-b");
      const catalogA = await createCatalog(tenantA, "ap7-a");
      const catalogB = await createCatalog(tenantB, "ap7-b");

      await createStoreCohort(
        tenantA,
        storeA1a,
        empA1a.employeeId,
        questionnaireVersionIdA,
        catalogA.productVersionId,
        catalogA.ruleSetVersionId,
        "ACCEPTED",
        1_111,
        111,
        11,
      );
      await createStoreCohort(
        tenantA,
        storeA1b,
        empA1b.employeeId,
        questionnaireVersionIdA,
        catalogA.productVersionId,
        catalogA.ruleSetVersionId,
        "REJECTED",
        2_222,
        222,
        22,
      );
      await createStoreCohort(
        tenantA,
        storeA2a,
        empA2a.employeeId,
        questionnaireVersionIdA,
        catalogA.productVersionId,
        catalogA.ruleSetVersionId,
        "DEFERRED",
        3_333,
        333,
        33,
      );
      await createStoreCohort(
        tenantB,
        storeB1a,
        empB1a.employeeId,
        questionnaireVersionIdB,
        catalogB.productVersionId,
        catalogB.ruleSetVersionId,
        "ACCEPTED",
        9_999,
        999,
        99,
      );
    });

    // ===================================================================
    // 1. Scope-Aufloesung (resolveManagementScopeForUser, echte DB-Fixtures)
    // ===================================================================
    describe("1. Scope-Aufloesung", () => {
      async function loadAssignments(userId: string) {
        return rawClient.roleAssignment.findMany({
          where: { userId },
          select: {
            scopeType: true,
            companyId: true,
            storeId: true,
            revokedAt: true,
            role: {
              select: { rolePermissions: { select: { permission: { select: { key: true } } } } },
            },
          },
        });
      }

      it("STORE-Scope: liefert genau die eine zugewiesene Filiale", async () => {
        const assignments = await loadAssignments(managerStoreA1a.userId);
        const scope = await resolveManagementScopeForUser(tenantA, assignments);
        expect(scope).toEqual({ level: "STORE", storeIds: [storeA1a] });
      });

      it("COMPANY-Scope: liefert alle Filialen der Company (A1a + A1b), nicht A2a", async () => {
        const assignments = await loadAssignments(managerCompanyA1.userId);
        const scope = await resolveManagementScopeForUser(tenantA, assignments);
        expect(scope?.level).toBe("COMPANY");
        expect(scope?.storeIds.sort()).toEqual([storeA1a, storeA1b].sort());
      });

      it("TENANT-Scope: liefert alle Filialen des Tenants (A1a+A1b+A2a), nicht Tenant B", async () => {
        const assignments = await loadAssignments(managerTenantA.userId);
        const scope = await resolveManagementScopeForUser(tenantA, assignments);
        expect(scope?.level).toBe("TENANT");
        expect(scope?.storeIds.sort()).toEqual([storeA1a, storeA1b, storeA2a].sort());
        expect(scope?.storeIds).not.toContain(storeB1a);
      });

      it("mehrere STORE-Assignments (verschiedene Companies): Union + Dedup", async () => {
        const assignments = await loadAssignments(managerMultiStore.userId);
        const scope = await resolveManagementScopeForUser(tenantA, assignments);
        expect(scope?.level).toBe("STORE");
        expect(scope?.storeIds.sort()).toEqual([storeA1a, storeA2a].sort());
      });

      it("STORE + COMPANY kombiniert: hoechste Stufe (COMPANY) gewinnt, nicht nur die einzelne Filiale", async () => {
        const assignments = await loadAssignments(managerMultiLevel.userId);
        const scope = await resolveManagementScopeForUser(tenantA, assignments);
        expect(scope?.level).toBe("COMPANY");
        // Company A1 umfasst A1a+A1b -- NICHT nur die per STORE-Assignment
        // explizit genannte A1b.
        expect(scope?.storeIds.sort()).toEqual([storeA1a, storeA1b].sort());
      });

      it("RoleAssignment mit Rolle OHNE passende analytics.view_store-Permission qualifiziert nicht -> null", async () => {
        const assignments = await loadAssignments(managerWrongPermission.userId);
        const scope = await resolveManagementScopeForUser(tenantA, assignments);
        expect(scope).toBeNull();
      });

      it("revoked RoleAssignment zaehlt nicht -> null (deny-by-default)", async () => {
        const assignments = await loadAssignments(managerRevoked.userId);
        const scope = await resolveManagementScopeForUser(tenantA, assignments);
        expect(scope).toBeNull();
      });

      it("kein RoleAssignment ueberhaupt -> null", async () => {
        const assignments = await loadAssignments(managerNone.userId);
        const scope = await resolveManagementScopeForUser(tenantA, assignments);
        expect(scope).toBeNull();
      });
    });

    // ===================================================================
    // 2. IDOR/AuthZ (resolveAuthorizedStoreFilter, echter DB-employeeId-Check)
    // ===================================================================
    describe("2. IDOR/AuthZ mit echtem employeeId-DB-Check", () => {
      it("autorisierte storeId (innerhalb Company A1) wird akzeptiert", async () => {
        const scope = { level: "COMPANY" as const, storeIds: [storeA1a, storeA1b] };
        const result = await runWithTenantContext(
          {
            tenantId: tenantA,
            userId: managerCompanyA1.userId,
            employeeId: managerCompanyA1.employeeId,
            roles: [],
            managementScope: scope,
          },
          () => resolveAuthorizedStoreFilter(scope, storeA1a),
        );
        expect(result).toEqual({ storeIds: [storeA1a] });
      });

      it("fremde storeId (andere Company, selber Tenant) wird abgelehnt (403-Ursache)", async () => {
        const scope = { level: "COMPANY" as const, storeIds: [storeA1a, storeA1b] };
        await expect(
          runWithTenantContext(
            {
              tenantId: tenantA,
              userId: managerCompanyA1.userId,
              employeeId: managerCompanyA1.employeeId,
              roles: [],
              managementScope: scope,
            },
            () => resolveAuthorizedStoreFilter(scope, storeA2a),
          ),
        ).rejects.toThrow(ManagementAccessDeniedError);
      });

      it("employeeId innerhalb des autorisierten Scopes wird akzeptiert", async () => {
        const scope = { level: "COMPANY" as const, storeIds: [storeA1a, storeA1b] };
        const result = await runWithTenantContext(
          {
            tenantId: tenantA,
            userId: managerCompanyA1.userId,
            employeeId: managerCompanyA1.employeeId,
            roles: [],
            managementScope: scope,
          },
          () => resolveAuthorizedStoreFilter(scope, undefined, empA1a.employeeId),
        );
        expect(result).toEqual({ storeIds: [storeA1a, storeA1b], employeeId: empA1a.employeeId });
      });

      it("employeeId aus Filiale AUSSERHALB des Scopes wird abgelehnt", async () => {
        const scope = { level: "COMPANY" as const, storeIds: [storeA1a, storeA1b] };
        await expect(
          runWithTenantContext(
            {
              tenantId: tenantA,
              userId: managerCompanyA1.userId,
              employeeId: managerCompanyA1.employeeId,
              roles: [],
              managementScope: scope,
            },
            () => resolveAuthorizedStoreFilter(scope, undefined, empA2a.employeeId),
          ),
        ).rejects.toThrow(ManagementAccessDeniedError);
      });

      it("nicht existierende employeeId wird abgelehnt", async () => {
        const scope = { level: "COMPANY" as const, storeIds: [storeA1a, storeA1b] };
        await expect(
          runWithTenantContext(
            {
              tenantId: tenantA,
              userId: managerCompanyA1.userId,
              employeeId: managerCompanyA1.employeeId,
              roles: [],
              managementScope: scope,
            },
            () => resolveAuthorizedStoreFilter(scope, undefined, randomUUID()),
          ),
        ).rejects.toThrow(ManagementAccessDeniedError);
      });

      it("employeeId aus einem ANDEREN TENANT wird abgelehnt (tenant-gescopter db-Client findet sie nicht)", async () => {
        // TENANT-Scope von Tenant A -- selbst der volle Tenant-Scope darf
        // niemals einen Mitarbeiter eines anderen Tenants referenzieren
        // koennen, auch nicht ueber eine manipulierte employeeId.
        const scope = { level: "TENANT" as const, storeIds: [storeA1a, storeA1b, storeA2a] };
        await expect(
          runWithTenantContext(
            {
              tenantId: tenantA,
              userId: managerTenantA.userId,
              employeeId: managerTenantA.employeeId,
              roles: [],
              managementScope: scope,
            },
            () => resolveAuthorizedStoreFilter(scope, undefined, empB1a.employeeId),
          ),
        ).rejects.toThrow(ManagementAccessDeniedError);
      });

      it("eine fremde storeId aus einem ANDEREN TENANT wird abgelehnt, auch bei vollem TENANT-Scope", async () => {
        const scope = { level: "TENANT" as const, storeIds: [storeA1a, storeA1b, storeA2a] };
        await expect(
          runWithTenantContext(
            {
              tenantId: tenantA,
              userId: managerTenantA.userId,
              employeeId: managerTenantA.employeeId,
              roles: [],
              managementScope: scope,
            },
            () => resolveAuthorizedStoreFilter(scope, storeB1a),
          ),
        ).rejects.toThrow(ManagementAccessDeniedError);
      });

      // Positiver Gegenpart zu den obigen Ablehnungsfaellen (von ChatGPT als
      // ergaenzender Check angeregt): ein TENANT-Scope-User, der eine
      // storeId INNERHALB des eigenen Tenants angibt, bekommt den Scope
      // korrekt auf GENAU diese eine Filiale eingeschraenkt -- nicht auf
      // den vollen TENANT-Scope und nicht abgelehnt.
      it("TENANT-Scope + storeId = eigene Filiale: schraenkt korrekt auf GENAU diese eine Filiale ein", async () => {
        const scope = { level: "TENANT" as const, storeIds: [storeA1a, storeA1b, storeA2a] };
        const result = await runWithTenantContext(
          {
            tenantId: tenantA,
            userId: managerTenantA.userId,
            employeeId: managerTenantA.employeeId,
            roles: [],
            managementScope: scope,
          },
          () => resolveAuthorizedStoreFilter(scope, storeA1b),
        );
        expect(result).toEqual({ storeIds: [storeA1b] });
      });
    });

    // ===================================================================
    // 3. KPI-Daten-Isolation (buildManagementAnalyticsView, echte
    //    unterscheidbare Fixture-Werte je Filiale)
    // ===================================================================
    describe("3. KPI-Daten-Isolation", () => {
      it("STORE-Scope (A1a): sieht NUR die eigene Filiale -- 1 Beratung, 1 ACCEPTED, Deal 1_111/111/11", async () => {
        const scope = { level: "STORE" as const, storeIds: [storeA1a] };
        const view = await runWithTenantContext(
          {
            tenantId: tenantA,
            userId: managerStoreA1a.userId,
            employeeId: managerStoreA1a.employeeId,
            roles: [],
            managementScope: scope,
          },
          () => buildManagementAnalyticsView(scope, { period: "month" }, NOW),
        );
        expect(view.consultationVolume.totalSessions).toBe(1);
        expect(view.recommendationOutcome.accepted).toBe(1);
        expect(view.recommendationOutcome.rejected).toBe(0);
        expect(view.recommendationOutcome.deferred).toBe(0);
        expect(view.deals).toHaveLength(1);
        expect(view.deals[0]!.oneTimeRevenueMinor).toBe(1_111);
        expect(view.deals[0]!.commissionAmountMinor).toBe(111);
        expect(view.deals[0]!.contributionMarginMinor).toBe(11);
      });

      it("COMPANY-Scope (A1): aggregiert A1a+A1b, NICHT A2a", async () => {
        const scope = { level: "COMPANY" as const, storeIds: [storeA1a, storeA1b] };
        const view = await runWithTenantContext(
          {
            tenantId: tenantA,
            userId: managerCompanyA1.userId,
            employeeId: managerCompanyA1.employeeId,
            roles: [],
            managementScope: scope,
          },
          () => buildManagementAnalyticsView(scope, { period: "month" }, NOW),
        );
        expect(view.consultationVolume.totalSessions).toBe(2);
        expect(view.recommendationOutcome.accepted).toBe(1);
        expect(view.recommendationOutcome.rejected).toBe(1);
        expect(view.recommendationOutcome.deferred).toBe(0); // A2a (DEFERRED) bleibt ausserhalb
        expect(view.deals).toHaveLength(1); // eine Waehrung (EUR), zusammengefasst
        expect(view.deals[0]!.dealsClosed).toBe(2);
        expect(view.deals[0]!.oneTimeRevenueMinor).toBe(1_111 + 2_222);
        expect(view.deals[0]!.commissionAmountMinor).toBe(111 + 222);
        expect(view.deals[0]!.contributionMarginMinor).toBe(11 + 22);
      });

      it("TENANT-Scope: aggregiert A1a+A1b+A2a, garantiert OHNE Tenant-B-Daten (9_999/999/99)", async () => {
        const scope = { level: "TENANT" as const, storeIds: [storeA1a, storeA1b, storeA2a] };
        const view = await runWithTenantContext(
          {
            tenantId: tenantA,
            userId: managerTenantA.userId,
            employeeId: managerTenantA.employeeId,
            roles: [],
            managementScope: scope,
          },
          () => buildManagementAnalyticsView(scope, { period: "month" }, NOW),
        );
        expect(view.consultationVolume.totalSessions).toBe(3);
        expect(view.recommendationOutcome.accepted).toBe(1);
        expect(view.recommendationOutcome.rejected).toBe(1);
        expect(view.recommendationOutcome.deferred).toBe(1);
        expect(view.deals).toHaveLength(1);
        expect(view.deals[0]!.dealsClosed).toBe(3);
        const expectedRevenue = 1_111 + 2_222 + 3_333;
        expect(view.deals[0]!.oneTimeRevenueMinor).toBe(expectedRevenue);
        expect(view.deals[0]!.oneTimeRevenueMinor).not.toBe(expectedRevenue + 9_999);
        expect(view.deals[0]!.commissionAmountMinor).toBe(111 + 222 + 333);
        expect(view.deals[0]!.contributionMarginMinor).toBe(11 + 22 + 33);
      });
    });

    // ===================================================================
    // 4. Financial-KPI-Trennung end-to-end (baut auf AP5 auf, hier ueber
    //    den vollen mehrfilialen autorisierten Scope statt nur einem Deal)
    // ===================================================================
    describe("4. Financial-KPI-Trennung Management vs. Mitarbeitersicht", () => {
      it("Mitarbeitersicht (buildAnalyticsDashboardView) enthaelt commissionAmountMinor/contributionMarginMinor NICHT, auch nicht ueber mehrere Filialen aggregiert", async () => {
        const view = await runWithTenantContext(
          {
            tenantId: tenantA,
            userId: empA1a.userId,
            employeeId: empA1a.employeeId,
            roles: [],
            managementScope: null,
          },
          () => buildAnalyticsDashboardView({ period: "month" }, NOW),
        );
        expect(view.deals.length).toBeGreaterThan(0);
        for (const row of view.deals) {
          expect(row).not.toHaveProperty("commissionAmountMinor");
          expect(row).not.toHaveProperty("contributionMarginMinor");
        }
        expect(JSON.stringify(view)).not.toContain("commissionAmountMinor");
        expect(JSON.stringify(view)).not.toContain("contributionMarginMinor");
      });

      it("Management-Sicht (TENANT-Scope) enthaelt commissionAmountMinor/contributionMarginMinor korrekt aggregiert", async () => {
        const scope = { level: "TENANT" as const, storeIds: [storeA1a, storeA1b, storeA2a] };
        const view = await runWithTenantContext(
          {
            tenantId: tenantA,
            userId: managerTenantA.userId,
            employeeId: managerTenantA.employeeId,
            roles: [],
            managementScope: scope,
          },
          () => buildManagementAnalyticsView(scope, { period: "month" }, NOW),
        );
        expect(view.deals[0]!.commissionAmountMinor).toBe(111 + 222 + 333);
        expect(view.deals[0]!.contributionMarginMinor).toBe(11 + 22 + 33);
      });
    });

    // ===================================================================
    // 5. Tenant-Isolation
    // ===================================================================
    describe("5. Tenant-Isolation", () => {
      it("TENANT-Management-User von Tenant A kann Tenant-B-Daten auch ueber manipulierte storeId/employeeId-Parameter nicht erreichen", async () => {
        const scope = { level: "TENANT" as const, storeIds: [storeA1a, storeA1b, storeA2a] };
        await runWithTenantContext(
          {
            tenantId: tenantA,
            userId: managerTenantA.userId,
            employeeId: managerTenantA.employeeId,
            roles: [],
            managementScope: scope,
          },
          async () => {
            await expect(
              buildManagementAnalyticsView(scope, { period: "month", storeId: storeB1a }, NOW),
            ).rejects.toThrow(ManagementAccessDeniedError);
            await expect(
              buildManagementAnalyticsView(
                scope,
                { period: "month", employeeId: empB1a.employeeId },
                NOW,
              ),
            ).rejects.toThrow(ManagementAccessDeniedError);
          },
        );
      });

      it("ein RoleAssignment/Scope aus Tenant A kann in einem Tenant-B-Kontext gar nicht erst aufgeloest werden (Store-Lookup ist tenant-gescopt)", async () => {
        // resolveManagementScopeForUser(tenantB, ...) mit Tenant-A-Assignments
        // wuerde die Store-IDs anhand von Tenant B aufloesen -- da die
        // RoleAssignment-Zeilen selbst tenant-gebunden sind (tenantId-Spalte),
        // ist ein Cross-Tenant-Aufruf in der Praxis nicht moeglich; dieser
        // Test dokumentiert das anhand des tatsaechlichen Datenmodells: die
        // fuer Tenant A aufgeloesten Store-IDs liegen nie in Tenant B.
        const assignments = await rawClient.roleAssignment.findMany({
          where: { userId: managerTenantA.userId },
          select: {
            scopeType: true,
            companyId: true,
            storeId: true,
            revokedAt: true,
            role: {
              select: { rolePermissions: { select: { permission: { select: { key: true } } } } },
            },
          },
        });
        const scope = await resolveManagementScopeForUser(tenantA, assignments);
        expect(scope?.storeIds).not.toContain(storeB1a);
      });
    });

    // ===================================================================
    // 6. API + UI End-to-End (echter Route-Handler, echtes signiertes
    //    Session-Cookie -- die UI selbst trifft KEINE eigene
    //    Scope-Entscheidung, siehe ManagementAnalyticsContent.tsx)
    // ===================================================================
    describe("6. API + UI End-to-End", () => {
      function requestWithCookie(url: string, token: string) {
        return new NextRequest(url, {
          headers: new Headers({ cookie: `${SESSION_COOKIE_NAME}=${token}` }),
        });
      }

      it("STORE-Scope-User: GET ohne Parameter -> 200, nur die eigene Filiale (A1a)", async () => {
        const payload = await buildSessionPayloadForEmployee(managerStoreA1a.employeeId);
        const token = createSessionToken(payload);
        const request = requestWithCookie(
          "http://localhost/api/analytics/management?period=month",
          token,
        );
        const response = await getManagementAnalytics(request);
        expect(response.status).toBe(200);
        const body = await response.json();
        expect(body.scopeLevel).toBe("STORE");
        expect(body.deals).toHaveLength(1);
        expect(body.deals[0].commissionAmountMinor).toBe(111);
      });

      it("STORE-Scope-User: GET mit fremder storeId (A2a) -> 403", async () => {
        const payload = await buildSessionPayloadForEmployee(managerStoreA1a.employeeId);
        const token = createSessionToken(payload);
        const request = requestWithCookie(
          `http://localhost/api/analytics/management?period=month&storeId=${storeA2a}`,
          token,
        );
        const response = await getManagementAnalytics(request);
        expect(response.status).toBe(403);
      });

      it("User ohne qualifizierenden RoleAssignment (managementScope=null) -> 403 (deny-by-default)", async () => {
        const payload = await buildSessionPayloadForEmployee(managerNone.employeeId);
        expect(payload.managementScope).toBeNull();
        const token = createSessionToken(payload);
        const request = requestWithCookie(
          "http://localhost/api/analytics/management?period=month",
          token,
        );
        const response = await getManagementAnalytics(request);
        expect(response.status).toBe(403);
      });

      it("revoked RoleAssignment -> managementScope=null bei Session-Aufbau -> 403", async () => {
        const payload = await buildSessionPayloadForEmployee(managerRevoked.employeeId);
        expect(payload.managementScope).toBeNull();
        const token = createSessionToken(payload);
        const request = requestWithCookie(
          "http://localhost/api/analytics/management?period=month",
          token,
        );
        const response = await getManagementAnalytics(request);
        expect(response.status).toBe(403);
      });

      it("kein Session-Cookie -> 401", async () => {
        const request = new NextRequest("http://localhost/api/analytics/management?period=month");
        const response = await getManagementAnalytics(request);
        expect(response.status).toBe(401);
      });

      it("manipuliertes/ungueltiges Session-Cookie -> 401", async () => {
        const request = requestWithCookie(
          "http://localhost/api/analytics/management?period=month",
          "kaputtes.token",
        );
        const response = await getManagementAnalytics(request);
        expect(response.status).toBe(401);
      });

      it("COMPANY-Scope-User: GET mit employeeId aus der eigenen Company -> 200, mit employeeId aus fremder Company -> 403", async () => {
        const payload = await buildSessionPayloadForEmployee(managerCompanyA1.employeeId);
        const token = createSessionToken(payload);

        const allowed = await getManagementAnalytics(
          requestWithCookie(
            `http://localhost/api/analytics/management?period=month&employeeId=${empA1b.employeeId}`,
            token,
          ),
        );
        expect(allowed.status).toBe(200);

        const denied = await getManagementAnalytics(
          requestWithCookie(
            `http://localhost/api/analytics/management?period=month&employeeId=${empA2a.employeeId}`,
            token,
          ),
        );
        expect(denied.status).toBe(403);
      });
    });
  },
);
