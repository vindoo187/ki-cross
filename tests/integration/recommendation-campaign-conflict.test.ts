/**
 * Integrationstests fuer Phase 13 AP5 (Konflikt-/Parallelitaetslogik bei
 * mehreren gleichzeitig aktiven Campaigns, ChatGPT-GO 2026-08-30, siehe
 * PHASE_13_IMPLEMENTATION_PLAN.md Abschnitt 3 AP5) gegen eine ECHTE
 * Postgres-Datenbank (gleiches Muster wie
 * `recommendation-campaign-active.test.ts`).
 *
 * Laut Plan gibt es fuer AP5 KEINE neue Produktionslogik: Campaigns
 * gewichten nicht selbst, sondern werden nur als CAMPAIGN_ACTIVE-
 * Bedingungszustand referenziert; die businessPriorityScore-Summenlogik
 * (`evaluatePrioritizationRules()`) und die DNF-Engine
 * (`evaluateConditionGroups()`) existieren bereits unveraendert seit
 * Phase 3B/AP4. AP5 besteht daher ausschliesslich darin, das
 * "deterministische Verhalten bei ueberlappendem Produkt-/Kategorie-/
 * Store-Fokus" MIT TESTS explizit zu belegen statt nur zu behaupten
 * (woertliche Plan-Vorgabe) -- inklusive der Randfaelle, bei denen ein
 * echter Bug am ehesten sichtbar wuerde: AND-Verknuepfung mehrerer
 * gleichzeitig aktiver Campaigns, OR-Verknuepfung ohne Doppelzaehlung des
 * Gewichts, ueberlappende Produkt-Kriterien und kombinierter STORE+TENANT-
 * Scope.
 *
 * Bewusst als EIGENE Datei statt Erweiterung von
 * `recommendation-campaign-active.test.ts`: dort geht es um die
 * CAMPAIGN_ACTIVE-Bedingung selbst (ist eine einzelne Campaign aktiv?),
 * hier um das Zusammenspiel MEHRERER gleichzeitig aktiver Campaigns
 * innerhalb der bestehenden DNF-/Summenlogik. Minimale Pro-Test-Fixtures,
 * identisches "self-contained"-Muster.
 *
 * Ohne DATABASE_URL wird die gesamte Suite uebersprungen statt fehlzuschlagen.
 */

import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, describe, expect, it } from "vitest";
import type { VisibilityOperator } from "@/server/questionnaire/types";
import { runWithTenantContext } from "@/server/tenant/context";
import { evaluate } from "@/server/recommendation/service";

const hasDatabaseUrl = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDatabaseUrl)(
  "Phase 13 AP5: Konflikt-/Parallelitaetslogik mehrerer aktiver Campaigns (Integrationstest, echte Postgres-DB)",
  () => {
    const rawClient = new PrismaClient();
    const suffix = randomUUID().slice(0, 8);

    // Bewusst weit in der Vergangenheit/Zukunft (Campaign-Aktivitaet wird zu
    // ruleSetAt = new Date() ausgewertet, siehe
    // service.ts::loadActiveCampaignContext()-Modulkommentar).
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

    /** attributes: TariffAttribute-Zeilen (Key -> Wert), fuer PRODUCT_ATTRIBUTE-Bedingungen. */
    async function createProductVersion(
      tenantId: string,
      key: string,
      attributes: Record<string, string> = {},
    ) {
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
      const valueTypeByKey: Record<string, string> = {
        dataVolumeGb: "number",
        contractCommitmentMonths: "number",
        pricePlanTier: "string",
        hasEuRoaming: "boolean",
      };
      if (Object.keys(attributes).length > 0) {
        await rawClient.tariffAttribute.createMany({
          data: Object.entries(attributes).map(([attributeKey, attributeValue]) => ({
            tenantId,
            productVersionId: version.id,
            attributeKey,
            attributeValue,
            valueType: valueTypeByKey[attributeKey] ?? "string",
          })),
        });
      }
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

    /** Condition-Zeile fuer eine PrioritizationRule (beliebiger sourceType, fuer AND/OR-Kombinationen). */
    async function addPrioritizationCondition(
      tenantId: string,
      prioritizationRuleId: string,
      groupIndex: number,
      sourceType: "CAMPAIGN_ACTIVE" | "PRODUCT_ATTRIBUTE",
      attributeKey: string,
      operator: VisibilityOperator,
      comparisonValue: string,
    ) {
      await rawClient.prioritizationRuleCondition.create({
        data: {
          tenantId,
          prioritizationRuleId,
          groupIndex,
          sourceType,
          attributeKey,
          operator,
          comparisonValue,
        },
      });
    }

    function asTenant<T>(tenantId: string, fn: () => Promise<T>): Promise<T> {
      return runWithTenantContext(
        { tenantId, userId: randomUUID(), roles: [], managementScope: null },
        fn,
      );
    }

    it("AND-Verknuepfung: Regel matcht nur, wenn BEIDE gleichzeitig aktiven Campaigns aktiv sind, nicht wenn nur eine davon aktiv ist", async () => {
      const tenant = await createTenant("and-both");
      const qn = await createQuestionnaire(tenant.tenantId, "and-both");
      const ruleSetVersionId = await createRuleSetVersion(tenant.tenantId, "and-both");
      await createProductVersion(tenant.tenantId, "and-both");
      const campaignA = await createCampaignWithVersion(
        tenant.tenantId,
        "and-a",
        "TENANT",
        tenant.tenantId,
        "ACTIVE",
        FAR_PAST,
        FAR_FUTURE,
      );
      // Campaign B ist DRAFT, also NICHT aktiv.
      const campaignB = await createCampaignWithVersion(
        tenant.tenantId,
        "and-b",
        "TENANT",
        tenant.tenantId,
        "DRAFT",
        FAR_PAST,
        FAR_FUTURE,
      );
      const rule = await rawClient.prioritizationRule.create({
        data: {
          tenantId: tenant.tenantId,
          ruleSetVersionId,
          key: "and-both-bonus",
          description: "Nur wenn beide Campaigns aktiv sind.",
          weight: 25,
          commissionRequired: false,
        },
      });
      // Beide Conditions im selben groupIndex = AND.
      await addPrioritizationCondition(
        tenant.tenantId,
        rule.id,
        0,
        "CAMPAIGN_ACTIVE",
        campaignA,
        "IS_ANSWERED",
        "",
      );
      await addPrioritizationCondition(
        tenant.tenantId,
        rule.id,
        0,
        "CAMPAIGN_ACTIVE",
        campaignB,
        "IS_ANSWERED",
        "",
      );
      const sessionId = await createSession(
        tenant.tenantId,
        tenant.storeId,
        tenant.employeeId,
        qn.questionnaireVersionId,
      );

      const result = await asTenant(tenant.tenantId, () => evaluate(sessionId));
      // Campaign B ist nicht aktiv -> AND-Gruppe nicht vollstaendig erfuellt -> Regel matcht nicht.
      expect(result.items[0]?.businessPriorityScore).toBe(0);
    });

    it("AND-Verknuepfung: Regel matcht, sobald tatsaechlich BEIDE Campaigns gleichzeitig aktiv sind", async () => {
      const tenant = await createTenant("and-both-active");
      const qn = await createQuestionnaire(tenant.tenantId, "and-both-active");
      const ruleSetVersionId = await createRuleSetVersion(tenant.tenantId, "and-both-active");
      await createProductVersion(tenant.tenantId, "and-both-active");
      const campaignA = await createCampaignWithVersion(
        tenant.tenantId,
        "and2-a",
        "TENANT",
        tenant.tenantId,
        "ACTIVE",
        FAR_PAST,
        FAR_FUTURE,
      );
      const campaignB = await createCampaignWithVersion(
        tenant.tenantId,
        "and2-b",
        "TENANT",
        tenant.tenantId,
        "ACTIVE",
        FAR_PAST,
        FAR_FUTURE,
      );
      const rule = await rawClient.prioritizationRule.create({
        data: {
          tenantId: tenant.tenantId,
          ruleSetVersionId,
          key: "and-both-active-bonus",
          description: "Beide Campaigns gleichzeitig aktiv.",
          weight: 25,
          commissionRequired: false,
        },
      });
      await addPrioritizationCondition(
        tenant.tenantId,
        rule.id,
        0,
        "CAMPAIGN_ACTIVE",
        campaignA,
        "IS_ANSWERED",
        "",
      );
      await addPrioritizationCondition(
        tenant.tenantId,
        rule.id,
        0,
        "CAMPAIGN_ACTIVE",
        campaignB,
        "IS_ANSWERED",
        "",
      );
      const sessionId = await createSession(
        tenant.tenantId,
        tenant.storeId,
        tenant.employeeId,
        qn.questionnaireVersionId,
      );

      const result = await asTenant(tenant.tenantId, () => evaluate(sessionId));
      expect(result.items[0]?.businessPriorityScore).toBe(25);
    });

    it("OR-Verknuepfung: Gewicht wird nur EINMAL angerechnet, auch wenn beide Campaigns gleichzeitig aktiv sind (kein Doppel-Zaehlen)", async () => {
      const tenant = await createTenant("or-no-double");
      const qn = await createQuestionnaire(tenant.tenantId, "or-no-double");
      const ruleSetVersionId = await createRuleSetVersion(tenant.tenantId, "or-no-double");
      await createProductVersion(tenant.tenantId, "or-no-double");
      const campaignA = await createCampaignWithVersion(
        tenant.tenantId,
        "or-a",
        "TENANT",
        tenant.tenantId,
        "ACTIVE",
        FAR_PAST,
        FAR_FUTURE,
      );
      const campaignB = await createCampaignWithVersion(
        tenant.tenantId,
        "or-b",
        "TENANT",
        tenant.tenantId,
        "ACTIVE",
        FAR_PAST,
        FAR_FUTURE,
      );
      const rule = await rawClient.prioritizationRule.create({
        data: {
          tenantId: tenant.tenantId,
          ruleSetVersionId,
          key: "or-no-double-bonus",
          description: "Matcht wenn IRGENDEINE der beiden Campaigns aktiv ist.",
          weight: 25,
          commissionRequired: false,
        },
      });
      // Unterschiedliche groupIndex = OR-Gruppen.
      await addPrioritizationCondition(
        tenant.tenantId,
        rule.id,
        0,
        "CAMPAIGN_ACTIVE",
        campaignA,
        "IS_ANSWERED",
        "",
      );
      await addPrioritizationCondition(
        tenant.tenantId,
        rule.id,
        1,
        "CAMPAIGN_ACTIVE",
        campaignB,
        "IS_ANSWERED",
        "",
      );
      const sessionId = await createSession(
        tenant.tenantId,
        tenant.storeId,
        tenant.employeeId,
        qn.questionnaireVersionId,
      );

      const result = await asTenant(tenant.tenantId, () => evaluate(sessionId));
      // Beide OR-Gruppen sind erfuellt, aber die Regel darf trotzdem nur EINMAL
      // zaehlen (evaluateConditionGroups() liefert einen einzelnen Boolean pro
      // Regel, evaluatePrioritizationRules() summiert pro getroffener Regel
      // genau einmal -- kein struktureller Doppelzaehl-Pfad).
      expect(result.items[0]?.businessPriorityScore).toBe(25);
    });

    it("ueberlappender Produkt-Fokus: zwei Campaigns mit unterschiedlichen Produkt-Kriterien summieren sich nur fuer ein Produkt, das BEIDE Kriterien erfuellt", async () => {
      const tenant = await createTenant("product-overlap");
      const qn = await createQuestionnaire(tenant.tenantId, "product-overlap");
      const ruleSetVersionId = await createRuleSetVersion(tenant.tenantId, "product-overlap");
      // Produkt A erfuellt BEIDE Kriterien (EU-Roaming + kurze Laufzeit).
      const productBoth = await createProductVersion(tenant.tenantId, "product-both", {
        hasEuRoaming: "true",
        contractCommitmentMonths: "6",
      });
      // Produkt B erfuellt NUR das EU-Roaming-Kriterium.
      const productOnlyRoaming = await createProductVersion(tenant.tenantId, "product-roaming", {
        hasEuRoaming: "true",
        contractCommitmentMonths: "24",
      });
      const campaignRoaming = await createCampaignWithVersion(
        tenant.tenantId,
        "roaming-campaign",
        "TENANT",
        tenant.tenantId,
        "ACTIVE",
        FAR_PAST,
        FAR_FUTURE,
      );
      const campaignShortTerm = await createCampaignWithVersion(
        tenant.tenantId,
        "shortterm-campaign",
        "TENANT",
        tenant.tenantId,
        "ACTIVE",
        FAR_PAST,
        FAR_FUTURE,
      );
      const ruleRoaming = await rawClient.prioritizationRule.create({
        data: {
          tenantId: tenant.tenantId,
          ruleSetVersionId,
          key: "roaming-bonus",
          description: "Roaming-Campaign-Bonus fuer EU-Roaming-Produkte.",
          weight: 15,
          commissionRequired: false,
        },
      });
      await addPrioritizationCondition(
        tenant.tenantId,
        ruleRoaming.id,
        0,
        "CAMPAIGN_ACTIVE",
        campaignRoaming,
        "IS_ANSWERED",
        "",
      );
      await addPrioritizationCondition(
        tenant.tenantId,
        ruleRoaming.id,
        0,
        "PRODUCT_ATTRIBUTE",
        "hasEuRoaming",
        "EQUALS",
        "true",
      );
      const ruleShortTerm = await rawClient.prioritizationRule.create({
        data: {
          tenantId: tenant.tenantId,
          ruleSetVersionId,
          key: "shortterm-bonus",
          description: "Kurzlaufzeit-Campaign-Bonus.",
          weight: 10,
          commissionRequired: false,
        },
      });
      await addPrioritizationCondition(
        tenant.tenantId,
        ruleShortTerm.id,
        0,
        "CAMPAIGN_ACTIVE",
        campaignShortTerm,
        "IS_ANSWERED",
        "",
      );
      await addPrioritizationCondition(
        tenant.tenantId,
        ruleShortTerm.id,
        0,
        "PRODUCT_ATTRIBUTE",
        "contractCommitmentMonths",
        "LESS_THAN",
        "12",
      );
      const sessionId = await createSession(
        tenant.tenantId,
        tenant.storeId,
        tenant.employeeId,
        qn.questionnaireVersionId,
      );

      const result = await asTenant(tenant.tenantId, () => evaluate(sessionId));
      const bothItem = result.items.find(
        (i) => i.productVersionId === productBoth.productVersionId,
      );
      const roamingOnlyItem = result.items.find(
        (i) => i.productVersionId === productOnlyRoaming.productVersionId,
      );
      // Produkt, das beide Kriterien erfuellt -> beide Regeln matchen -> Summe 25.
      expect(bothItem?.businessPriorityScore).toBe(25);
      // Produkt, das nur ein Kriterium erfuellt -> nur eine Regel matcht -> 15.
      expect(roamingOnlyItem?.businessPriorityScore).toBe(15);
    });

    it("ueberlappender Store-Fokus: STORE-gescopte und TENANT-gescopte Campaign in einer AND-Bedingung matcht nur in der passenden Filiale", async () => {
      const tenant = await createTenant("store-overlap");
      const qn = await createQuestionnaire(tenant.tenantId, "store-overlap");
      const ruleSetVersionId = await createRuleSetVersion(tenant.tenantId, "store-overlap");
      await createProductVersion(tenant.tenantId, "store-overlap");
      const campaignTenant = await createCampaignWithVersion(
        tenant.tenantId,
        "tenant-wide",
        "TENANT",
        tenant.tenantId,
        "ACTIVE",
        FAR_PAST,
        FAR_FUTURE,
      );
      const campaignStore = await createCampaignWithVersion(
        tenant.tenantId,
        "store-only",
        "STORE",
        tenant.storeId,
        "ACTIVE",
        FAR_PAST,
        FAR_FUTURE,
      );
      const rule = await rawClient.prioritizationRule.create({
        data: {
          tenantId: tenant.tenantId,
          ruleSetVersionId,
          key: "store-overlap-bonus",
          description: "Nur in der Filiale, in der beide Campaigns aktiv sind.",
          weight: 20,
          commissionRequired: false,
        },
      });
      await addPrioritizationCondition(
        tenant.tenantId,
        rule.id,
        0,
        "CAMPAIGN_ACTIVE",
        campaignTenant,
        "IS_ANSWERED",
        "",
      );
      await addPrioritizationCondition(
        tenant.tenantId,
        rule.id,
        0,
        "CAMPAIGN_ACTIVE",
        campaignStore,
        "IS_ANSWERED",
        "",
      );
      const sessionInMatchingStore = await createSession(
        tenant.tenantId,
        tenant.storeId,
        tenant.employeeId,
        qn.questionnaireVersionId,
      );
      const employeeOtherStore = await rawClient.employee.create({
        data: {
          tenantId: tenant.tenantId,
          storeId: tenant.otherStoreId,
          userId: (
            await rawClient.user.create({
              data: {
                tenantId: tenant.tenantId,
                email: `store-overlap-other-${suffix}@example-synthetic.test`,
                isSynthetic: true,
              },
            })
          ).id,
          displayName: "MA andere Filiale",
        },
      });
      const sessionInOtherStore = await createSession(
        tenant.tenantId,
        tenant.otherStoreId,
        employeeOtherStore.id,
        qn.questionnaireVersionId,
      );

      const matchingResult = await asTenant(tenant.tenantId, () =>
        evaluate(sessionInMatchingStore),
      );
      const otherResult = await asTenant(tenant.tenantId, () => evaluate(sessionInOtherStore));
      // Passende Filiale: STORE-Campaign ist dort aktiv -> AND vollstaendig erfuellt.
      expect(matchingResult.items[0]?.businessPriorityScore).toBe(20);
      // Andere Filiale: STORE-Campaign gilt dort NICHT als aktiv -> AND nicht erfuellt.
      expect(otherResult.items[0]?.businessPriorityScore).toBe(0);
    });

    it("CrossSellingRule: mehrere gleichzeitig aktive Campaigns erzeugen unabhaengige, nicht kollidierende Signale", async () => {
      const tenant = await createTenant("cross-multi");
      const qn = await createQuestionnaire(tenant.tenantId, "cross-multi");
      const ruleSetVersionId = await createRuleSetVersion(tenant.tenantId, "cross-multi");
      await createProductVersion(tenant.tenantId, "cross-multi");
      const campaignA = await createCampaignWithVersion(
        tenant.tenantId,
        "cross-a",
        "TENANT",
        tenant.tenantId,
        "ACTIVE",
        FAR_PAST,
        FAR_FUTURE,
      );
      const campaignB = await createCampaignWithVersion(
        tenant.tenantId,
        "cross-b",
        "TENANT",
        tenant.tenantId,
        "ACTIVE",
        FAR_PAST,
        FAR_FUTURE,
      );
      const ruleA = await rawClient.crossSellingRule.create({
        data: {
          tenantId: tenant.tenantId,
          ruleSetVersionId,
          key: "cross-multi-a",
          description: "Cross-Selling bei Campaign A.",
          needType: "ACCESSORY",
          priority: 40,
          reasonCode: "CAMPAIGN_ADDON_SUGGESTED",
        },
      });
      await rawClient.crossSellingRuleCondition.create({
        data: {
          tenantId: tenant.tenantId,
          crossSellingRuleId: ruleA.id,
          groupIndex: 0,
          sourceType: "CAMPAIGN_ACTIVE",
          attributeKey: campaignA,
          operator: "IS_ANSWERED",
          comparisonValue: "",
        },
      });
      const ruleB = await rawClient.crossSellingRule.create({
        data: {
          tenantId: tenant.tenantId,
          ruleSetVersionId,
          key: "cross-multi-b",
          description: "Cross-Selling bei Campaign B.",
          needType: "DEVICE_PROTECTION",
          priority: 30,
          reasonCode: "CAMPAIGN_PROTECTION_SUGGESTED",
        },
      });
      await rawClient.crossSellingRuleCondition.create({
        data: {
          tenantId: tenant.tenantId,
          crossSellingRuleId: ruleB.id,
          groupIndex: 0,
          sourceType: "CAMPAIGN_ACTIVE",
          attributeKey: campaignB,
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
      expect(result.crossSellingSignals).toHaveLength(2);
      const reasonCodes = result.crossSellingSignals.map((s) => s.reasonCode).sort();
      expect(reasonCodes).toEqual(["CAMPAIGN_ADDON_SUGGESTED", "CAMPAIGN_PROTECTION_SUGGESTED"]);
    });

    it("Determinismus: zweimalige Auswertung derselben Session mit mehreren aktiven Campaigns liefert identischen businessPriorityScore", async () => {
      const tenant = await createTenant("deterministic");
      const qn = await createQuestionnaire(tenant.tenantId, "deterministic");
      const ruleSetVersionId = await createRuleSetVersion(tenant.tenantId, "deterministic");
      await createProductVersion(tenant.tenantId, "deterministic");
      const campaignA = await createCampaignWithVersion(
        tenant.tenantId,
        "det-a",
        "TENANT",
        tenant.tenantId,
        "ACTIVE",
        FAR_PAST,
        FAR_FUTURE,
      );
      const campaignB = await createCampaignWithVersion(
        tenant.tenantId,
        "det-b",
        "TENANT",
        tenant.tenantId,
        "ACTIVE",
        FAR_PAST,
        FAR_FUTURE,
      );
      const campaignC = await createCampaignWithVersion(
        tenant.tenantId,
        "det-c",
        "TENANT",
        tenant.tenantId,
        "ACTIVE",
        FAR_PAST,
        FAR_FUTURE,
      );
      for (const [key, campaignKey, weight] of [
        ["det-rule-a", campaignA, 5],
        ["det-rule-b", campaignB, 10],
        ["det-rule-c", campaignC, 15],
      ] as const) {
        const rule = await rawClient.prioritizationRule.create({
          data: {
            tenantId: tenant.tenantId,
            ruleSetVersionId,
            key,
            description: "Determinismus-Test-Regel.",
            weight,
            commissionRequired: false,
          },
        });
        await addPrioritizationCondition(
          tenant.tenantId,
          rule.id,
          0,
          "CAMPAIGN_ACTIVE",
          campaignKey,
          "IS_ANSWERED",
          "",
        );
      }
      const sessionId = await createSession(
        tenant.tenantId,
        tenant.storeId,
        tenant.employeeId,
        qn.questionnaireVersionId,
      );

      const first = await asTenant(tenant.tenantId, () => evaluate(sessionId));
      const second = await asTenant(tenant.tenantId, () => evaluate(sessionId));
      expect(first.items[0]?.businessPriorityScore).toBe(30);
      expect(second.items[0]?.businessPriorityScore).toBe(30);
      expect(second.items[0]?.businessPriorityScore).toBe(first.items[0]?.businessPriorityScore);
    });
  },
);
