/**
 * Integrationstests fuer `analytics/kpis.ts` (Phase 6 AP7/AP9, siehe
 * PHASE_6_IMPLEMENTATION_PLAN.md Abschnitt 3.3 + Abschnitt 5: "KPI-
 * Aggregationsfunktionen gegen Seed-Daten mit bekannten Erwartungswerten")
 * gegen eine ECHTE Postgres-Datenbank.
 *
 * Fixtures werden bewusst per Raw-Client direkt angelegt (kein Fragebogen-/
 * Empfehlungs-Durchlauf noetig) -- die KPI-Funktionen aggregieren nur
 * bereits vorhandene Datensaetze, ihr Entstehungsweg ist irrelevant.
 *
 * Ohne DATABASE_URL wird die gesamte Suite uebersprungen statt fehlzuschlagen.
 */

import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runWithTenantContext } from "@/server/tenant/context";
import {
  getConsultationVolumeKpi,
  getRecommendationOutcomeKpi,
  getDealKpi,
} from "@/server/analytics/kpis";

const hasDatabaseUrl = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDatabaseUrl)("analytics/kpis.ts (Integrationstest, echte Postgres-DB)", () => {
  const rawClient = new PrismaClient();
  const suffix = randomUUID().slice(0, 8);
  const FROM = new Date("2026-01-01T00:00:00Z");

  // Der zu pruefende Zeitraum: 2026-05-01 bis 2026-06-01 (exklusiv).
  const PERIOD_FROM = new Date("2026-05-01T00:00:00Z");
  const PERIOD_TO = new Date("2026-06-01T00:00:00Z");
  const IN_PERIOD = new Date("2026-05-15T10:00:00Z");
  const BEFORE_PERIOD = new Date("2026-04-15T10:00:00Z");
  // Nur fuer Sessions, die ausschliesslich als Deal-Traeger dienen (AP12-Fix,
  // siehe Kommentar bei den Deal-Fixtures unten) -- liegt bewusst ausserhalb
  // aller in diesem File per Datumsfenster geprueften Zeitraeume.
  const OTHER_PERIOD = new Date("2026-02-15T10:00:00Z");

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
    status: "IN_PROGRESS" | "COMPLETED" | "ABANDONED",
    startedAt: Date,
  ) {
    const session = await rawClient.consultationSession.create({
      data: {
        tenantId,
        storeId,
        employeeId,
        questionnaireVersionId,
        consultationType: "NEW_CONTRACT",
        status,
        startedAt,
        endedAt: status === "IN_PROGRESS" ? null : startedAt,
      },
    });
    return session.id;
  }

  async function createProvider(key: string) {
    const provider = await rawClient.provider.create({
      data: { key: `provider-${key}-${suffix}`, name: `Provider ${key}`, isSynthetic: true },
    });
    return provider.id;
  }

  async function createCategory(tenantId: string, key: string) {
    const category = await rawClient.productCategory.create({
      data: { tenantId, key: `category-${key}-${suffix}`, name: `Kategorie ${key}` },
    });
    return category.id;
  }

  async function createProductVersion(
    tenantId: string,
    categoryId: string,
    providerId: string,
    key: string,
  ) {
    const product = await rawClient.product.create({
      data: {
        tenantId,
        providerId,
        categoryId,
        productType: "MOBILE_NEW_CONTRACT",
        name: `Produkt ${key}`,
        isSynthetic: true,
      },
    });
    const version = await rawClient.productVersion.create({
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
    return version.id;
  }

  async function createRuleSetVersion(tenantId: string, key: string) {
    const ruleSet = await rawClient.ruleSet.create({ data: { tenantId, key: `${key}-${suffix}` } });
    const version = await rawClient.ruleSetVersion.create({
      data: {
        tenantId,
        ruleSetId: ruleSet.id,
        label: "V1",
        validFrom: FROM,
        validTo: null,
        status: "ACTIVE",
      },
    });
    return version.id;
  }

  async function createRecommendation(
    tenantId: string,
    sessionId: string,
    ruleSetVersionId: string,
    generatedAt: Date,
    fingerprint: string,
  ) {
    const recommendation = await rawClient.recommendation.create({
      data: {
        tenantId,
        consultationSessionId: sessionId,
        ruleSetVersionId,
        algorithmVersion: 1,
        evaluationFingerprint: fingerprint,
        generatedAt,
      },
    });
    return recommendation.id;
  }

  async function createRecommendationItem(
    tenantId: string,
    recommendationId: string,
    productVersionId: string,
    eligibilityPassed: boolean,
  ) {
    const item = await rawClient.recommendationItem.create({
      data: {
        tenantId,
        recommendationId,
        productVersionId,
        eligibilityPassed,
        customerFitScore: 80,
        businessPriorityScore: 50,
        priorityRank: 1,
      },
    });
    return item.id;
  }

  async function createOutcome(
    tenantId: string,
    recommendationItemId: string,
    employeeId: string,
    outcome: "ACCEPTED" | "REJECTED" | "DEFERRED",
    decidedAt: Date,
  ) {
    await rawClient.recommendationOutcome.create({
      data: { tenantId, recommendationItemId, outcome, decidedByEmployeeId: employeeId, decidedAt },
    });
  }

  async function createDealWithSnapshot(
    tenantId: string,
    sessionId: string,
    storeId: string,
    employeeId: string,
    closedAt: Date,
    currency: string,
    oneTimeRevenueMinor: number,
  ) {
    const deal = await rawClient.deal.create({
      data: { tenantId, consultationSessionId: sessionId, storeId, employeeId, currency, closedAt },
    });
    await rawClient.dealFinancialSnapshot.create({
      data: {
        tenantId,
        dealId: deal.id,
        currency,
        monthlyRecurringRevenueMinor: 500,
        totalContractValueMinor: oneTimeRevenueMinor + 500,
        oneTimeRevenueMinor,
        commissionAmountMinor: 0,
        expectedRecurringCommissionMinor: 0,
        hardwarePurchaseCostMinor: 0,
        subsidyCostMinor: 0,
        discountCostMinor: 0,
        otherDirectCostMinor: 0,
        contributionMarginMinor: oneTimeRevenueMinor,
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
  let productVersionId: string;

  beforeAll(async () => {
    const t = await createTenant("kpi");
    tenantId = t.tenantId;
    storeId = t.storeId;
    employeeId = t.employeeId;
    questionnaireVersionId = await createQuestionnaireVersion(tenantId, "kpi-fragebogen");

    const providerId = await createProvider("kpi");
    const categoryId = await createCategory(tenantId, "kpi");
    productVersionId = await createProductVersion(tenantId, categoryId, providerId, "kpi-tarif");

    // -- Beratungen: 1 COMPLETED, 1 ABANDONED, 1 IN_PROGRESS im Zeitraum,
    //    1 COMPLETED VOR dem Zeitraum (darf nicht mitgezaehlt werden).
    await createSession(
      tenantId,
      storeId,
      employeeId,
      questionnaireVersionId,
      "COMPLETED",
      IN_PERIOD,
    );
    await createSession(
      tenantId,
      storeId,
      employeeId,
      questionnaireVersionId,
      "ABANDONED",
      IN_PERIOD,
    );
    const inProgressSessionId = await createSession(
      tenantId,
      storeId,
      employeeId,
      questionnaireVersionId,
      "IN_PROGRESS",
      IN_PERIOD,
    );
    await createSession(
      tenantId,
      storeId,
      employeeId,
      questionnaireVersionId,
      "COMPLETED",
      BEFORE_PERIOD,
    );

    // -- Empfehlungen: 1 Recommendation im Zeitraum mit 2 Items (1 eligible, 1 nicht).
    const ruleSetVersionId = await createRuleSetVersion(tenantId, "kpi");
    const recommendationId = await createRecommendation(
      tenantId,
      inProgressSessionId,
      ruleSetVersionId,
      IN_PERIOD,
      "b".repeat(64),
    );
    const eligibleItemId = await createRecommendationItem(
      tenantId,
      recommendationId,
      productVersionId,
      true,
    );
    await createRecommendationItem(tenantId, recommendationId, productVersionId, false);
    await createOutcome(tenantId, eligibleItemId, employeeId, "ACCEPTED", IN_PERIOD);

    // Zweite Recommendation (separates Fingerprint) mit einem abgelehnten Item.
    const recommendationId2 = await createRecommendation(
      tenantId,
      inProgressSessionId,
      ruleSetVersionId,
      IN_PERIOD,
      "c".repeat(64),
    );
    const rejectedItemId = await createRecommendationItem(
      tenantId,
      recommendationId2,
      productVersionId,
      true,
    );
    await createOutcome(tenantId, rejectedItemId, employeeId, "REJECTED", IN_PERIOD);

    // -- Deals: 2 EUR-Deals im Zeitraum, 1 EUR-Deal VOR dem Zeitraum (darf nicht zaehlen).
    // Phase 6 AP12 (Hardening): seit dem DB-Unique-Constraint
    // "deals_tenant_id_consultation_session_id_key" (ein Deal pro
    // ConsultationSession) braucht jeder Deal seine EIGENE Session --
    // vorher teilten sich alle 3 Deals hier `inProgressSessionId`, was den
    // neuen Constraint verletzt. Die zusaetzlichen Sessions liegen bewusst
    // AUSSERHALB von PERIOD_FROM/PERIOD_TO und des in der "vor dem Zeitraum"-
    // Volumen-Testfalls geprueften BEFORE_PERIOD-Tagesfensters, damit sie
    // keine der bestehenden getConsultationVolumeKpi()-Erwartungswerte
    // (totalSessions/inProgress/completed etc.) veraendern -- getDealKpi()
    // filtert ohnehin ueber `closedAt`, nicht ueber die Session.
    const dealOnlySession1 = await createSession(
      tenantId,
      storeId,
      employeeId,
      questionnaireVersionId,
      "COMPLETED",
      OTHER_PERIOD,
    );
    const dealOnlySession2 = await createSession(
      tenantId,
      storeId,
      employeeId,
      questionnaireVersionId,
      "COMPLETED",
      OTHER_PERIOD,
    );
    await createDealWithSnapshot(
      tenantId,
      inProgressSessionId,
      storeId,
      employeeId,
      IN_PERIOD,
      "EUR",
      5_000,
    );
    await createDealWithSnapshot(
      tenantId,
      dealOnlySession1,
      storeId,
      employeeId,
      IN_PERIOD,
      "EUR",
      3_000,
    );
    await createDealWithSnapshot(
      tenantId,
      dealOnlySession2,
      storeId,
      employeeId,
      BEFORE_PERIOD,
      "EUR",
      99_999,
    );
  });

  it("getConsultationVolumeKpi(): zaehlt nur Sessions im Zeitraum, Quoten korrekt berechnet", async () => {
    const result = await asEmployee(tenantId, employeeId, () =>
      getConsultationVolumeKpi({ from: PERIOD_FROM, to: PERIOD_TO, storeId }),
    );
    expect(result.completed).toBe(1);
    expect(result.abandoned).toBe(1);
    expect(result.inProgress).toBe(1);
    expect(result.totalSessions).toBe(3);
    expect(result.completionRate).toBe(0.5);
    expect(result.abandonmentRate).toBe(0.5);
  });

  it("getConsultationVolumeKpi(): Session vor dem Zeitraum wird nicht mitgezaehlt", async () => {
    const result = await asEmployee(tenantId, employeeId, () =>
      getConsultationVolumeKpi({
        from: BEFORE_PERIOD,
        to: new Date(BEFORE_PERIOD.getTime() + 24 * 60 * 60 * 1000),
        storeId,
      }),
    );
    expect(result.completed).toBe(1);
    expect(result.totalSessions).toBe(1);
  });

  it("getRecommendationOutcomeKpi(): zaehlt nur eligibilityPassed=true Items als 'generiert'", async () => {
    const result = await asEmployee(tenantId, employeeId, () =>
      getRecommendationOutcomeKpi({ from: PERIOD_FROM, to: PERIOD_TO, storeId }),
    );
    // 2 Recommendations mit je 1 eligible Item (das 2. Item der ersten
    // Recommendation ist eligibilityPassed=false und zaehlt nicht mit).
    expect(result.itemsGenerated).toBe(2);
    expect(result.accepted).toBe(1);
    expect(result.rejected).toBe(1);
    expect(result.deferred).toBe(0);
    expect(result.decided).toBe(2);
    expect(result.acceptanceRate).toBe(0.5);
    expect(result.rejectionRate).toBe(0.5);
  });

  it("getDealKpi(): summiert nur Deals im Zeitraum, pro Waehrung gruppiert", async () => {
    const result = await asEmployee(tenantId, employeeId, () =>
      getDealKpi({ from: PERIOD_FROM, to: PERIOD_TO, storeId }),
    );
    expect(result).toHaveLength(1);
    expect(result[0]!.currency).toBe("EUR");
    expect(result[0]!.dealsClosed).toBe(2);
    expect(result[0]!.oneTimeRevenueMinor).toBe(8_000); // 5_000 + 3_000, NICHT 99_999 (vor dem Zeitraum)
    expect(result[0]!.monthlyRecurringRevenueMinor).toBe(1_000); // 500 * 2
  });

  it("Mandantentrennung: KPIs eines Tenants beeinflussen keinen anderen Tenant", async () => {
    const other = await createTenant("kpi-other");
    const result = await asEmployee(other.tenantId, other.employeeId, () =>
      getConsultationVolumeKpi({ from: PERIOD_FROM, to: PERIOD_TO }),
    );
    expect(result.totalSessions).toBe(0);
  });
});
