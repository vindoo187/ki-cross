/**
 * Integrationstests fuer die CAMPAIGN_ACTIVE-Bedingung (Phase 13 AP4,
 * ChatGPT-GO 2026-08-30, siehe PHASE_13_IMPLEMENTATION_PLAN.md Abschnitt 3
 * AP4) gegen eine ECHTE Postgres-Datenbank (gleiches Muster wie
 * `tests/integration/recommendation-engine.test.ts`).
 *
 * Bewusst als EIGENE, schlanke Datei statt Erweiterung der bereits sehr
 * grossen `recommendation-engine.test.ts`: minimale Pro-Test-Fixtures
 * (`createTenant()`/`createQuestionnaire()`/`createRuleSetVersion()`/
 * `createProductVersion()`/`createSession()`, identisches Muster wie die
 * dortigen "self-contained" Faelle am Dateiende), OHNE EligibilityRule/
 * ExclusionRule/CommissionModelVersion -- fuer eine Session ohne
 * Eligibility-/Exclusion-Regeln gilt `eligibilityPassed = true` (leere
 * `.some()`-Pruefung), und `commissionRequired: false` an der
 * PrioritizationRule vermeidet die Notwendigkeit einer
 * CommissionModelVersion (`resolveCommission()` liefert dann `null` und
 * degradiert, siehe `pricing/commission.ts::buildResolveCommission()`).
 *
 * Deckt genau die in ChatGPTs AP4-Leitplanken (2026-08-30) geforderten
 * DB-abhaengigen Faelle ab: TENANT-Scope (tenantweit aktiv), STORE-Scope
 * (nur fuer die exakt passende Filiale aktiv, NICHT fuer eine andere Filiale
 * desselben Mandanten), Zeitraumgrenzen (DRAFT/EXPIRED/zukuenftig-noch-nicht-
 * gueltig zaehlen NICHT als aktiv), sowie PrioritizationRule UND
 * CrossSellingRule (beide laut Implementierungsplan vorgesehen).
 *
 * Regression fuer bestehende ANSWER/PRODUCT_ATTRIBUTE/SESSION_ATTRIBUTE-
 * Conditions wird bewusst NICHT hier dupliziert: diese Codepfade wurden
 * durch AP4 nicht veraendert (siehe conditions.ts -- CAMPAIGN_ACTIVE ist ein
 * zusaetzlicher fruehzeitiger `if`-Zweig, kein Umbau bestehender Zweige) und
 * bleiben durch die bereits existierende, sehr umfangreiche Abdeckung in
 * `recommendation-engine.test.ts` UND `tests/unit/recommendation/*.test.ts`
 * abgesichert -- ein echter Regressionsbruch dort wuerde diese Suiten zum
 * Scheitern bringen.
 *
 * Ohne DATABASE_URL wird die gesamte Suite uebersprungen statt fehlzuschlagen.
 */

import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, describe, expect, it } from "vitest";
import { runWithTenantContext } from "@/server/tenant/context";
import { evaluate } from "@/server/recommendation/service";

const hasDatabaseUrl = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDatabaseUrl)(
  "Phase 13 AP4: CAMPAIGN_ACTIVE-Bedingung (Integrationstest, echte Postgres-DB)",
  () => {
    const rawClient = new PrismaClient();
    const suffix = randomUUID().slice(0, 8);

    // Bewusst weit in der Vergangenheit/Zukunft (nicht an SESSION_AT
    // gebunden): Campaign-Aktivitaet wird zu ruleSetAt = new Date() (ECHTES
    // "JETZT" zum Testlaufzeitpunkt) ausgewertet, siehe
    // service.ts::loadActiveCampaignKeys()-Modulkommentar -- identisches
    // Prinzip wie die RuleSetVersion-Aufloesung, die in
    // recommendation-engine.test.ts ebenfalls mit einem FROM weit in der
    // Vergangenheit gegen echtes `new Date()` getestet wird.
    const FAR_PAST = new Date("2020-01-01T00:00:00Z");
    const FAR_FUTURE = new Date("2099-01-01T00:00:00Z");
    const SESSION_AT = new Date("2026-03-01T00:00:00Z");

    afterAll(async () => {
      await rawClient.$disconnect();
    });

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
      const secondStore = await rawClient.store.create({
        data: {
          tenantId: tenant.id,
          companyId: company.id,
          key: `store2-${key}-${suffix}`,
          name: `Store2 ${key}`,
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
      return {
        tenantId: tenant.id,
        storeId: store.id,
        otherStoreId: secondStore.id,
        employeeId: employee.id,
      };
    }

    /** Fragebogen mit genau einer optionalen BOOLEAN-Frage, ohne Sichtbarkeitsbedingungen. */
    async function createQuestionnaire(tenantId: string, key: string) {
      const questionnaire = await rawClient.questionnaire.create({
        data: { tenantId, key: `${key}-${suffix}` },
      });
      const version = await rawClient.questionnaireVersion.create({
        data: {
          tenantId,
          questionnaireId: questionnaire.id,
          label: "V1",
          validFrom: FAR_PAST,
          validTo: null,
          status: "ACTIVE",
        },
      });
      const question = await rawClient.question.create({
        data: { tenantId, questionnaireVersionId: version.id, key: "frage", sortOrder: 1 },
      });
      await rawClient.questionVersion.create({
        data: {
          tenantId,
          questionId: question.id,
          label: "Frage",
          answerType: "BOOLEAN",
          isRequired: false,
          validFrom: FAR_PAST,
          status: "ACTIVE",
        },
      });
      return { questionnaireVersionId: version.id, questionId: question.id };
    }

    async function createRuleSetVersion(tenantId: string, key: string) {
      const ruleSet = await rawClient.ruleSet.create({
        data: { tenantId, key: `${key}-${suffix}` },
      });
      const version = await rawClient.ruleSetVersion.create({
        data: {
          tenantId,
          ruleSetId: ruleSet.id,
          label: "V1",
          validFrom: FAR_PAST,
          validTo: null,
          status: "ACTIVE",
        },
      });
      return version.id;
    }

    async function createProductVersion(tenantId: string, key: string) {
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
      const version = await rawClient.productVersion.create({
        data: {
          tenantId,
          productId: product.id,
          versionNumber: 1,
          status: "ACTIVE",
          validFrom: FAR_PAST,
          validTo: null,
          currency: "EUR",
          monthlyPriceMinor: 1000,
        },
      });
      return { productId: product.id, productVersionId: version.id };
    }

    async function createSession(
      tenantId: string,
      storeId: string,
      employeeId: string,
      questionnaireVersionId: string,
    ) {
      const session = await rawClient.consultationSession.create({
        data: {
          tenantId,
          storeId,
          employeeId,
          questionnaireVersionId,
          consultationType: "NEW_CONTRACT",
          status: "IN_PROGRESS",
          startedAt: SESSION_AT,
        },
      });
      return session.id;
    }

    /** Legt eine Campaign + genau eine CampaignVersion an (Struktur analog campaign-admin.ts, hier per Rohinsert). */
    async function createCampaignWithVersion(
      tenantId: string,
      key: string,
      scopeType: "TENANT" | "STORE",
      scopeId: string,
      status: "DRAFT" | "ACTIVE" | "EXPIRED" | "ARCHIVED",
      validFrom: Date,
      validTo: Date | null,
    ) {
      const campaignKey = `${key}-${suffix}`;
      const campaign = await rawClient.campaign.create({
        data: { tenantId, key: campaignKey, name: `Campaign ${key}` },
      });
      await rawClient.campaignVersion.create({
        data: {
          tenantId,
          campaignId: campaign.id,
          versionNumber: 1,
          status,
          scopeType,
          scopeId,
          validFrom,
          validTo,
        },
      });
      return campaignKey;
    }

    async function addCampaignActiveCondition(
      tenantId: string,
      prioritizationRuleId: string,
      campaignKey: string,
      operator: "IS_ANSWERED" | "IS_NOT_ANSWERED" = "IS_ANSWERED",
    ) {
      await rawClient.prioritizationRuleCondition.create({
        data: {
          tenantId,
          prioritizationRuleId,
          groupIndex: 0,
          sourceType: "CAMPAIGN_ACTIVE",
          attributeKey: campaignKey,
          operator,
          comparisonValue: "",
        },
      });
    }

    function asTenant<T>(tenantId: string, fn: () => Promise<T>): Promise<T> {
      return runWithTenantContext(
        { tenantId, userId: randomUUID(), roles: [], managementScope: null },
        fn,
      );
    }

    async function setUpTenantWithRule(key: string) {
      const tenant = await createTenant(key);
      const qn = await createQuestionnaire(tenant.tenantId, key);
      const ruleSetVersionId = await createRuleSetVersion(tenant.tenantId, key);
      const { productId } = await createProductVersion(tenant.tenantId, key);
      const rule = await rawClient.prioritizationRule.create({
        data: {
          tenantId: tenant.tenantId,
          ruleSetVersionId,
          key: `bonus-${key}`,
          description: "Campaign-Bonus.",
          weight: 25,
          commissionRequired: false,
        },
      });
      const sessionId = await createSession(
        tenant.tenantId,
        tenant.storeId,
        tenant.employeeId,
        qn.questionnaireVersionId,
      );
      return { ...tenant, productId, ruleId: rule.id, ruleSetVersionId, sessionId };
    }

    it("TENANT-Scope: veroeffentlichte, zeitlich gueltige Campaign gilt tenantweit als aktiv", async () => {
      const t = await setUpTenantWithRule("tenant-active");
      const campaignKey = await createCampaignWithVersion(
        t.tenantId,
        "summer-sale",
        "TENANT",
        t.tenantId,
        "ACTIVE",
        FAR_PAST,
        FAR_FUTURE,
      );
      await addCampaignActiveCondition(t.tenantId, t.ruleId, campaignKey);

      const result = await asTenant(t.tenantId, () => evaluate(t.sessionId));
      expect(result.items[0]?.businessPriorityScore).toBe(25);
      expect(result.items[0]?.rationales.some((r) => r.factorValue === "25")).toBe(true);
    });

    it("TENANT-Scope: DRAFT-Version (nicht veroeffentlicht) gilt NICHT als aktiv", async () => {
      const t = await setUpTenantWithRule("tenant-draft");
      const campaignKey = await createCampaignWithVersion(
        t.tenantId,
        "draft-sale",
        "TENANT",
        t.tenantId,
        "DRAFT",
        FAR_PAST,
        FAR_FUTURE,
      );
      await addCampaignActiveCondition(t.tenantId, t.ruleId, campaignKey);

      const result = await asTenant(t.tenantId, () => evaluate(t.sessionId));
      expect(result.items[0]?.businessPriorityScore).toBe(0);
    });

    it("TENANT-Scope: EXPIRED-Version (validTo in der Vergangenheit) gilt NICHT als aktiv", async () => {
      const t = await setUpTenantWithRule("tenant-expired");
      const campaignKey = await createCampaignWithVersion(
        t.tenantId,
        "expired-sale",
        "TENANT",
        t.tenantId,
        "ACTIVE",
        FAR_PAST,
        new Date("2021-01-01T00:00:00Z"),
      );
      await addCampaignActiveCondition(t.tenantId, t.ruleId, campaignKey);

      const result = await asTenant(t.tenantId, () => evaluate(t.sessionId));
      expect(result.items[0]?.businessPriorityScore).toBe(0);
    });

    it("TENANT-Scope: noch nicht gueltige Version (validFrom in der Zukunft) gilt NICHT als aktiv", async () => {
      const t = await setUpTenantWithRule("tenant-future");
      const campaignKey = await createCampaignWithVersion(
        t.tenantId,
        "future-sale",
        "TENANT",
        t.tenantId,
        "ACTIVE",
        new Date("2098-01-01T00:00:00Z"),
        FAR_FUTURE,
      );
      await addCampaignActiveCondition(t.tenantId, t.ruleId, campaignKey);

      const result = await asTenant(t.tenantId, () => evaluate(t.sessionId));
      expect(result.items[0]?.businessPriorityScore).toBe(0);
    });

    it("STORE-Scope: aktiv NUR fuer die exakt passende Filiale, NICHT fuer eine andere Filiale desselben Mandanten", async () => {
      const t = await setUpTenantWithRule("store-scope");
      const campaignKey = await createCampaignWithVersion(
        t.tenantId,
        "store-sale",
        "STORE",
        t.storeId,
        "ACTIVE",
        FAR_PAST,
        FAR_FUTURE,
      );
      await addCampaignActiveCondition(t.tenantId, t.ruleId, campaignKey);

      const matchingStoreResult = await asTenant(t.tenantId, () => evaluate(t.sessionId));
      expect(matchingStoreResult.items[0]?.businessPriorityScore).toBe(25);

      // Zweite Session derselben Campaign-Konfiguration, aber ueber die
      // ANDERE Filiale desselben Mandanten -- darf NICHT matchen.
      const qn = await createQuestionnaire(t.tenantId, "store-scope-2");
      const otherStoreSessionId = await createSession(
        t.tenantId,
        t.otherStoreId,
        t.employeeId,
        qn.questionnaireVersionId,
      );
      const otherStoreResult = await asTenant(t.tenantId, () => evaluate(otherStoreSessionId));
      expect(otherStoreResult.items[0]?.businessPriorityScore).toBe(0);
    });

    it("IS_NOT_ANSWERED matcht genau dann, wenn die Campaign NICHT aktiv ist", async () => {
      const t = await setUpTenantWithRule("not-answered");
      const campaignKey = await createCampaignWithVersion(
        t.tenantId,
        "inactive-sale",
        "TENANT",
        t.tenantId,
        "DRAFT",
        FAR_PAST,
        FAR_FUTURE,
      );
      await addCampaignActiveCondition(t.tenantId, t.ruleId, campaignKey, "IS_NOT_ANSWERED");

      const result = await asTenant(t.tenantId, () => evaluate(t.sessionId));
      expect(result.items[0]?.businessPriorityScore).toBe(25);
    });

    it("mehrere gleichzeitig aktive Campaigns sind zulaessig (kein gegenseitiger Ausschluss)", async () => {
      const t = await setUpTenantWithRule("multi-active");
      const campaignKeyA = await createCampaignWithVersion(
        t.tenantId,
        "campaign-a",
        "TENANT",
        t.tenantId,
        "ACTIVE",
        FAR_PAST,
        FAR_FUTURE,
      );
      const campaignKeyB = await createCampaignWithVersion(
        t.tenantId,
        "campaign-b",
        "TENANT",
        t.tenantId,
        "ACTIVE",
        FAR_PAST,
        FAR_FUTURE,
      );
      await addCampaignActiveCondition(t.tenantId, t.ruleId, campaignKeyA);
      const ruleB = await rawClient.prioritizationRule.create({
        data: {
          tenantId: t.tenantId,
          ruleSetVersionId: t.ruleSetVersionId,
          key: "bonus-multi-b",
          description: "Zweiter Campaign-Bonus.",
          weight: 10,
          commissionRequired: false,
        },
      });
      await addCampaignActiveCondition(t.tenantId, ruleB.id, campaignKeyB);

      const result = await asTenant(t.tenantId, () => evaluate(t.sessionId));
      expect(result.items[0]?.businessPriorityScore).toBe(35);
    });

    it("CrossSellingRule: CAMPAIGN_ACTIVE-Bedingung erzeugt ein Signal, wenn die Campaign aktiv ist", async () => {
      const tenant = await createTenant("cross-campaign");
      const qn = await createQuestionnaire(tenant.tenantId, "cross-campaign");
      const ruleSetVersionId = await createRuleSetVersion(tenant.tenantId, "cross-campaign");
      await createProductVersion(tenant.tenantId, "cross-campaign");
      const campaignKey = await createCampaignWithVersion(
        tenant.tenantId,
        "cross-sale",
        "TENANT",
        tenant.tenantId,
        "ACTIVE",
        FAR_PAST,
        FAR_FUTURE,
      );
      const crossSellingRule = await rawClient.crossSellingRule.create({
        data: {
          tenantId: tenant.tenantId,
          ruleSetVersionId,
          key: "campaign-crosssell",
          description: "Cross-Selling bei aktiver Campaign.",
          needType: "ACCESSORY",
          priority: 40,
          reasonCode: "CAMPAIGN_ADDON_SUGGESTED",
        },
      });
      await rawClient.crossSellingRuleCondition.create({
        data: {
          tenantId: tenant.tenantId,
          crossSellingRuleId: crossSellingRule.id,
          groupIndex: 0,
          sourceType: "CAMPAIGN_ACTIVE",
          attributeKey: campaignKey,
          operator: "IS_ANSWERED",
          comparisonValue: "",
        },
      });
      const sessionId = await createSession(
        tenant.tenantId,
        tenant.storeId,
        tenant.employeeId,
        qn.questionnaireVersionId,
      );

      const result = await asTenant(tenant.tenantId, () => evaluate(sessionId));
      expect(result.crossSellingSignals).toHaveLength(1);
      expect(result.crossSellingSignals[0]?.reasonCode).toBe("CAMPAIGN_ADDON_SUGGESTED");
    });
  },
);
