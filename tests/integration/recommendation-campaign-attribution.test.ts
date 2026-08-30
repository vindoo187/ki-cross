/**
 * Integrationstests fuer die Campaign-Attribution (`RecommendationCampaignSignal`,
 * Phase 13 AP7, ChatGPT-GO 2026-08-30, siehe PHASE_13_IMPLEMENTATION_PLAN.md
 * Abschnitt 3 AP7) gegen eine ECHTE Postgres-Datenbank (gleiches Muster wie
 * `tests/integration/recommendation-campaign-active.test.ts`).
 *
 * Bewusst als EIGENE, schlanke Datei statt Erweiterung von
 * `recommendation-campaign-active.test.ts`: dort wird CAMPAIGN_ACTIVE als
 * Bedingung getestet (matcht die Regel ueberhaupt?), hier wird die
 * NACHGELAGERTE Signal-Schreibung getestet (wird bei einem Match auch
 * korrekt attribuiert?) -- unterschiedliche Verantwortlichkeit, gleiches
 * Fixture-Muster.
 *
 * Deckt exakt die von ChatGPT (2026-08-30) verbindlich geforderten Faelle
 * ab: (1) Signal-Erzeugung bei einer getroffenen CAMPAIGN_ACTIVE-
 * PrioritizationRule, (2) Deduplizierung -- mehrere Regeln, die dieselbe
 * Campaign fuer dasselbe Item referenzieren, erzeugen NUR EIN Signal, (3)
 * IS_NOT_ANSWERED (Abwesenheits-Match) erzeugt KEIN Signal, (4)
 * CrossSellingRule-Matches erzeugen KEIN RecommendationCampaignSignal
 * (dokumentierte Luecke, siehe docs/DECISION_LOG.md), (5) eine lediglich
 * aktive, aber von keiner Regel referenzierte/getroffene Campaign erzeugt
 * KEIN Signal, (6) Tenant-Isolation der Signal-Tabelle.
 *
 * Phase 13 AP8 (Security/Regression/E2E, ChatGPT-GO 2026-08-30) ergaenzt
 * einen expliziten Reproduzierbarkeits-Regressionstest (verbindlich
 * gefordert: "nicht nur pruefen, dass die Zeile noch existiert -- die
 * gespeicherten IDs muessen explizit vor und nach dem Publish verglichen
 * werden"): eine bereits geschriebene RecommendationCampaignSignal-Zeile
 * behaelt ihre campaignVersionId unveraendert, auch nachdem eine NEUE
 * CampaignVersion derselben Campaign veroeffentlicht wurde -- und eine
 * NACH diesem Publish neu erzeugte Recommendation referenziert bereits die
 * neue Version. Identisches Historisierungsprinzip wie
 * `DealItem.commissionModelVersionId` (Phase 10 AP6).
 *
 * Ohne DATABASE_URL wird die gesamte Suite uebersprungen statt fehlzuschlagen.
 */

import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, describe, expect, it } from "vitest";
import { runWithTenantContext } from "@/server/tenant/context";
import { evaluate } from "@/server/recommendation/service";
import { createDraftCampaignVersion, publishCampaignVersion } from "@/server/admin/campaign-admin";

const hasDatabaseUrl = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDatabaseUrl)(
  "Phase 13 AP7: RecommendationCampaignSignal-Attribution (Integrationstest, echte Postgres-DB)",
  () => {
    const rawClient = new PrismaClient();
    const suffix = randomUUID().slice(0, 8);

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
      return { tenantId: tenant.id, storeId: store.id, employeeId: employee.id, userId: user.id };
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

    /** Legt eine Campaign + genau eine ACTIVE, tenantweite CampaignVersion an. */
    async function createActiveTenantCampaign(tenantId: string, key: string) {
      const campaignKey = `${key}-${suffix}`;
      const campaign = await rawClient.campaign.create({
        data: { tenantId, key: campaignKey, name: `Campaign ${key}` },
      });
      const campaignVersion = await rawClient.campaignVersion.create({
        data: {
          tenantId,
          campaignId: campaign.id,
          versionNumber: 1,
          status: "ACTIVE",
          scopeType: "TENANT",
          scopeId: tenantId,
          validFrom: FAR_PAST,
          validTo: FAR_FUTURE,
        },
      });
      return { campaignId: campaign.id, campaignKey, campaignVersionId: campaignVersion.id };
    }

    async function addCampaignActiveConditionToPrioritizationRule(
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

    async function setUpTenantWithSession(key: string) {
      const tenant = await createTenant(key);
      const qn = await createQuestionnaire(tenant.tenantId, key);
      const ruleSetVersionId = await createRuleSetVersion(tenant.tenantId, key);
      const { productId } = await createProductVersion(tenant.tenantId, key);
      const sessionId = await createSession(
        tenant.tenantId,
        tenant.storeId,
        tenant.employeeId,
        qn.questionnaireVersionId,
      );
      return { ...tenant, productId, ruleSetVersionId, sessionId };
    }

    it("erzeugt genau ein RecommendationCampaignSignal fuer eine getroffene CAMPAIGN_ACTIVE-PrioritizationRule", async () => {
      const t = await setUpTenantWithSession("signal-basic");
      const campaign = await createActiveTenantCampaign(t.tenantId, "summer-sale");
      const rule = await rawClient.prioritizationRule.create({
        data: {
          tenantId: t.tenantId,
          ruleSetVersionId: t.ruleSetVersionId,
          key: "bonus-summer",
          description: "Campaign-Bonus.",
          weight: 25,
          commissionRequired: false,
        },
      });
      await addCampaignActiveConditionToPrioritizationRule(
        t.tenantId,
        rule.id,
        campaign.campaignKey,
      );

      const result = await asTenant(t.tenantId, () => evaluate(t.sessionId));
      expect(result.items[0]?.businessPriorityScore).toBe(25);
      expect(result.items[0]?.campaignSignals).toHaveLength(1);
      expect(result.items[0]?.campaignSignals[0]).toMatchObject({
        campaignId: campaign.campaignId,
        campaignVersionId: campaign.campaignVersionId,
      });

      // Direkte DB-Verifikation: die Zeile existiert wirklich in der Tabelle,
      // nicht nur im zusammengesetzten Lese-DTO.
      const rows = await rawClient.recommendationCampaignSignal.findMany({
        where: { tenantId: t.tenantId, recommendationItemId: result.items[0]!.id },
      });
      expect(rows).toHaveLength(1);
      expect(rows[0]?.campaignId).toBe(campaign.campaignId);
      expect(rows[0]?.campaignVersionId).toBe(campaign.campaignVersionId);
    });

    it("Dedup: zwei verschiedene PrioritizationRules, die dieselbe Campaign fuer dasselbe Item referenzieren, erzeugen NUR EIN Signal", async () => {
      const t = await setUpTenantWithSession("signal-dedup");
      const campaign = await createActiveTenantCampaign(t.tenantId, "dedup-sale");
      const ruleA = await rawClient.prioritizationRule.create({
        data: {
          tenantId: t.tenantId,
          ruleSetVersionId: t.ruleSetVersionId,
          key: "bonus-dedup-a",
          description: "Erste Regel, referenziert dieselbe Campaign.",
          weight: 10,
          commissionRequired: false,
        },
      });
      const ruleB = await rawClient.prioritizationRule.create({
        data: {
          tenantId: t.tenantId,
          ruleSetVersionId: t.ruleSetVersionId,
          key: "bonus-dedup-b",
          description: "Zweite Regel, referenziert dieselbe Campaign.",
          weight: 20,
          commissionRequired: false,
        },
      });
      await addCampaignActiveConditionToPrioritizationRule(
        t.tenantId,
        ruleA.id,
        campaign.campaignKey,
      );
      await addCampaignActiveConditionToPrioritizationRule(
        t.tenantId,
        ruleB.id,
        campaign.campaignKey,
      );

      const result = await asTenant(t.tenantId, () => evaluate(t.sessionId));
      // Beide Regeln matchen (Gewichte summieren sich) ...
      expect(result.items[0]?.businessPriorityScore).toBe(30);
      // ... aber es entsteht trotzdem nur EIN Signal fuer (Campaign, Item).
      expect(result.items[0]?.campaignSignals).toHaveLength(1);
      expect(result.items[0]?.campaignSignals[0]?.campaignId).toBe(campaign.campaignId);

      const rows = await rawClient.recommendationCampaignSignal.findMany({
        where: {
          tenantId: t.tenantId,
          recommendationItemId: result.items[0]!.id,
          campaignId: campaign.campaignId,
        },
      });
      expect(rows).toHaveLength(1);
    });

    it("IS_NOT_ANSWERED (Abwesenheits-Match) erzeugt KEIN Signal", async () => {
      const t = await setUpTenantWithSession("signal-absence");
      // Campaign existiert, ist aber NICHT aktiv (DRAFT) -- die Regel matcht
      // ueber IS_NOT_ANSWERED gerade WEIL die Campaign inaktiv ist.
      const campaignKey = `inactive-sale-${suffix}`;
      const campaign = await rawClient.campaign.create({
        data: { tenantId: t.tenantId, key: campaignKey, name: "Inactive Sale" },
      });
      await rawClient.campaignVersion.create({
        data: {
          tenantId: t.tenantId,
          campaignId: campaign.id,
          versionNumber: 1,
          status: "DRAFT",
          scopeType: "TENANT",
          scopeId: t.tenantId,
          validFrom: FAR_PAST,
          validTo: FAR_FUTURE,
        },
      });
      const rule = await rawClient.prioritizationRule.create({
        data: {
          tenantId: t.tenantId,
          ruleSetVersionId: t.ruleSetVersionId,
          key: "bonus-absence",
          description: "Bonus bei INAKTIVER Campaign.",
          weight: 15,
          commissionRequired: false,
        },
      });
      await addCampaignActiveConditionToPrioritizationRule(
        t.tenantId,
        rule.id,
        campaignKey,
        "IS_NOT_ANSWERED",
      );

      const result = await asTenant(t.tenantId, () => evaluate(t.sessionId));
      expect(result.items[0]?.businessPriorityScore).toBe(15);
      expect(result.items[0]?.campaignSignals).toEqual([]);

      const rows = await rawClient.recommendationCampaignSignal.findMany({
        where: { tenantId: t.tenantId, recommendationItemId: result.items[0]!.id },
      });
      expect(rows).toHaveLength(0);
    });

    it("CrossSellingRule-Match ueber CAMPAIGN_ACTIVE erzeugt KEIN RecommendationCampaignSignal (dokumentierte Luecke)", async () => {
      const t = await setUpTenantWithSession("signal-crosssell-gap");
      const campaign = await createActiveTenantCampaign(t.tenantId, "cross-sale");
      const crossSellingRule = await rawClient.crossSellingRule.create({
        data: {
          tenantId: t.tenantId,
          ruleSetVersionId: t.ruleSetVersionId,
          key: "campaign-crosssell-gap",
          description: "Cross-Selling bei aktiver Campaign.",
          needType: "ACCESSORY",
          priority: 40,
          reasonCode: "CAMPAIGN_ADDON_SUGGESTED",
        },
      });
      await rawClient.crossSellingRuleCondition.create({
        data: {
          tenantId: t.tenantId,
          crossSellingRuleId: crossSellingRule.id,
          groupIndex: 0,
          sourceType: "CAMPAIGN_ACTIVE",
          attributeKey: campaign.campaignKey,
          operator: "IS_ANSWERED",
          comparisonValue: "",
        },
      });

      const result = await asTenant(t.tenantId, () => evaluate(t.sessionId));
      expect(result.crossSellingSignals).toHaveLength(1);
      expect(result.crossSellingSignals[0]?.reasonCode).toBe("CAMPAIGN_ADDON_SUGGESTED");
      // Keine PrioritizationRule referenziert die Campaign -> kein Item hat
      // ein RecommendationCampaignSignal, obwohl die Campaign aktiv war und
      // ueber CrossSellingRule zu einem Signal gefuehrt hat.
      expect(result.items[0]?.campaignSignals).toEqual([]);

      const rows = await rawClient.recommendationCampaignSignal.findMany({
        where: { tenantId: t.tenantId, campaignId: campaign.campaignId },
      });
      expect(rows).toHaveLength(0);
    });

    it("eine aktive, aber von KEINER Regel referenzierte Campaign erzeugt kein Signal", async () => {
      const t = await setUpTenantWithSession("signal-unreferenced");
      const campaign = await createActiveTenantCampaign(t.tenantId, "unreferenced-sale");
      // Ganz normale Regel ohne jeden Campaign-Bezug.
      await rawClient.prioritizationRule.create({
        data: {
          tenantId: t.tenantId,
          ruleSetVersionId: t.ruleSetVersionId,
          key: "bonus-plain",
          description: "Regel ohne Campaign-Bezug.",
          weight: 5,
          commissionRequired: false,
        },
      });

      const result = await asTenant(t.tenantId, () => evaluate(t.sessionId));
      expect(result.items[0]?.campaignSignals).toEqual([]);

      const rows = await rawClient.recommendationCampaignSignal.findMany({
        where: { tenantId: t.tenantId, campaignId: campaign.campaignId },
      });
      expect(rows).toHaveLength(0);
    });

    it("OR-Gruppe (zwei Gruppen, je eine Campaign): nur die Campaign aus der tatsaechlich getroffenen Gruppe wird attribuiert", async () => {
      const t = await setUpTenantWithSession("signal-or-group");
      // Gruppe 0 referenziert eine INAKTIVE Campaign (DRAFT) -> Gruppe 0
      // matcht nicht. Gruppe 1 referenziert eine AKTIVE Campaign -> Gruppe 1
      // matcht, die Regel matcht insgesamt ueber die OR-Verknuepfung.
      const inactiveCampaignKey = `or-inactive-${suffix}`;
      const inactiveCampaign = await rawClient.campaign.create({
        data: { tenantId: t.tenantId, key: inactiveCampaignKey, name: "OR Inactive" },
      });
      await rawClient.campaignVersion.create({
        data: {
          tenantId: t.tenantId,
          campaignId: inactiveCampaign.id,
          versionNumber: 1,
          status: "DRAFT",
          scopeType: "TENANT",
          scopeId: t.tenantId,
          validFrom: FAR_PAST,
          validTo: FAR_FUTURE,
        },
      });
      const activeCampaign = await createActiveTenantCampaign(t.tenantId, "or-active");

      const rule = await rawClient.prioritizationRule.create({
        data: {
          tenantId: t.tenantId,
          ruleSetVersionId: t.ruleSetVersionId,
          key: "bonus-or-group",
          description: "OR aus zwei Campaign-Bedingungen in unterschiedlichen Gruppen.",
          weight: 20,
          commissionRequired: false,
        },
      });
      await rawClient.prioritizationRuleCondition.create({
        data: {
          tenantId: t.tenantId,
          prioritizationRuleId: rule.id,
          groupIndex: 0,
          sourceType: "CAMPAIGN_ACTIVE",
          attributeKey: inactiveCampaignKey,
          operator: "IS_ANSWERED",
          comparisonValue: "",
        },
      });
      await rawClient.prioritizationRuleCondition.create({
        data: {
          tenantId: t.tenantId,
          prioritizationRuleId: rule.id,
          groupIndex: 1,
          sourceType: "CAMPAIGN_ACTIVE",
          attributeKey: activeCampaign.campaignKey,
          operator: "IS_ANSWERED",
          comparisonValue: "",
        },
      });

      const result = await asTenant(t.tenantId, () => evaluate(t.sessionId));
      expect(result.items[0]?.businessPriorityScore).toBe(20);
      expect(result.items[0]?.campaignSignals).toHaveLength(1);
      expect(result.items[0]?.campaignSignals[0]?.campaignId).toBe(activeCampaign.campaignId);

      const rows = await rawClient.recommendationCampaignSignal.findMany({
        where: { tenantId: t.tenantId, recommendationItemId: result.items[0]!.id },
      });
      expect(rows).toHaveLength(1);
      expect(rows[0]?.campaignId).toBe(activeCampaign.campaignId);
    });

    it("Tenant-Isolation: RecommendationCampaignSignal-Zeilen eines fremden Mandanten sind ueber den tenant-gescopten Query nicht sichtbar", async () => {
      const t = await setUpTenantWithSession("signal-isolation-a");
      const otherTenant = await setUpTenantWithSession("signal-isolation-b");
      const campaignA = await createActiveTenantCampaign(t.tenantId, "isolation-sale-a");
      const campaignB = await createActiveTenantCampaign(otherTenant.tenantId, "isolation-sale-b");
      const ruleA = await rawClient.prioritizationRule.create({
        data: {
          tenantId: t.tenantId,
          ruleSetVersionId: t.ruleSetVersionId,
          key: "bonus-isolation-a",
          description: "Mandant A.",
          weight: 10,
          commissionRequired: false,
        },
      });
      const ruleB = await rawClient.prioritizationRule.create({
        data: {
          tenantId: otherTenant.tenantId,
          ruleSetVersionId: otherTenant.ruleSetVersionId,
          key: "bonus-isolation-b",
          description: "Mandant B.",
          weight: 10,
          commissionRequired: false,
        },
      });
      await addCampaignActiveConditionToPrioritizationRule(
        t.tenantId,
        ruleA.id,
        campaignA.campaignKey,
      );
      await addCampaignActiveConditionToPrioritizationRule(
        otherTenant.tenantId,
        ruleB.id,
        campaignB.campaignKey,
      );

      const resultA = await asTenant(t.tenantId, () => evaluate(t.sessionId));
      const resultB = await asTenant(otherTenant.tenantId, () => evaluate(otherTenant.sessionId));

      expect(resultA.items[0]?.campaignSignals).toHaveLength(1);
      expect(resultA.items[0]?.campaignSignals[0]?.campaignId).toBe(campaignA.campaignId);
      expect(resultB.items[0]?.campaignSignals).toHaveLength(1);
      expect(resultB.items[0]?.campaignSignals[0]?.campaignId).toBe(campaignB.campaignId);

      // Rohe, tenant-uebergreifende Kontrollabfrage bestaetigt: jede Zeile
      // traegt exakt den eigenen tenantId, keine Vermischung.
      const rowsA = await rawClient.recommendationCampaignSignal.findMany({
        where: { campaignId: campaignA.campaignId },
      });
      expect(rowsA.every((r) => r.tenantId === t.tenantId)).toBe(true);
      const rowsB = await rawClient.recommendationCampaignSignal.findMany({
        where: { campaignId: campaignB.campaignId },
      });
      expect(rowsB.every((r) => r.tenantId === otherTenant.tenantId)).toBe(true);
    });

    it("Reproduzierbarkeit (Phase 13 AP8): campaignVersionId einer bereits geschriebenen Signal-Zeile bleibt nach einem spaeteren Publish unveraendert; eine NEUE Recommendation nach dem Publish referenziert die neue Version", async () => {
      const t = await setUpTenantWithSession("signal-reproducibility");
      const campaign = await createActiveTenantCampaign(t.tenantId, "reproducibility-sale");
      const originalActiveVersionId = campaign.campaignVersionId;

      const rule = await rawClient.prioritizationRule.create({
        data: {
          tenantId: t.tenantId,
          ruleSetVersionId: t.ruleSetVersionId,
          key: "bonus-reproducibility",
          description: "Campaign-Bonus fuer Reproduzierbarkeitstest.",
          weight: 25,
          commissionRequired: false,
        },
      });
      await addCampaignActiveConditionToPrioritizationRule(
        t.tenantId,
        rule.id,
        campaign.campaignKey,
      );

      // --- Schritt 1: Recommendation zu T1 auswerten -- Signal referenziert
      // die zu diesem Zeitpunkt aktive Version V1. ---
      const resultAtV1 = await asTenant(t.tenantId, () => evaluate(t.sessionId));
      expect(resultAtV1.items[0]?.campaignSignals).toHaveLength(1);
      const signalId = resultAtV1.items[0]!.campaignSignals[0]!.id;
      expect(resultAtV1.items[0]?.campaignSignals[0]?.campaignVersionId).toBe(
        originalActiveVersionId,
      );

      // Direkte DB-Kontrolle des IST-Zustands VOR dem Publish (nicht nur
      // ueber das zusammengesetzte Lese-DTO).
      const signalBeforePublish = await rawClient.recommendationCampaignSignal.findUniqueOrThrow({
        where: { id: signalId },
      });
      expect(signalBeforePublish.campaignVersionId).toBe(originalActiveVersionId);

      // --- Schritt 2: eine NEUE CampaignVersion (V2) erstellen und ECHT
      // ueber den bestehenden publishCampaignVersion()-Service-Pfad
      // veroeffentlichen (keine Rohmanipulation) -- das expiriert V1 und
      // aktiviert V2. ---
      // publishCampaignVersion()/createDraftCampaignVersion() schreiben einen
      // AuditLog-Eintrag mit einer echten FK auf User -- anders als
      // asTenant() (fingierte randomUUID() als userId, ausreichend fuer
      // evaluate(), das keinen actorUserId referenziert) wird hier daher der
      // ECHTE, in createTenant() angelegte User verwendet.
      const newVersionId = await runWithTenantContext(
        { tenantId: t.tenantId, userId: t.userId, roles: [], managementScope: null },
        async () => {
          const draft = await createDraftCampaignVersion(campaign.campaignId, {
            scopeType: "TENANT",
            scopeId: t.tenantId,
          });
          await publishCampaignVersion(campaign.campaignId, draft.id);
          return draft.id;
        },
      );
      expect(newVersionId).not.toBe(originalActiveVersionId);

      // --- Schritt 3: dieselbe, bereits VOR dem Publish geschriebene
      // Signal-Zeile erneut aus der DB laden -- campaignVersionId MUSS
      // weiterhin V1 sein, NICHT rueckwirkend auf V2 aktualisiert. ---
      const signalAfterPublish = await rawClient.recommendationCampaignSignal.findUniqueOrThrow({
        where: { id: signalId },
      });
      expect(signalAfterPublish.campaignVersionId).toBe(originalActiveVersionId);
      expect(signalAfterPublish.campaignVersionId).not.toBe(newVersionId);

      // --- Schritt 4: eine NEUE Auswertung DERSELBEN Session NACH dem
      // Publish erzeugt eine neue Recommendation, deren Signal bereits V2
      // referenziert -- historische Trennung: alte Recommendation -> V1,
      // neue Recommendation -> V2. ---
      const resultAtV2 = await asTenant(t.tenantId, () => evaluate(t.sessionId));
      expect(resultAtV2.items[0]?.campaignSignals).toHaveLength(1);
      expect(resultAtV2.items[0]?.campaignSignals[0]?.campaignVersionId).toBe(newVersionId);
      expect(resultAtV2.id).not.toBe(resultAtV1.id);
    });
  },
);
