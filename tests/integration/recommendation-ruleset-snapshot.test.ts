/**
 * Phase 9 AP9 -- Kern-Testfall (ChatGPT-Vorgabe 2026-08-18): Questionnaire-
 * Pinning vs. RuleSet-Evaluation-Snapshot. Verifiziert die von ChatGPT
 * ausdruecklich vorgegebene, unterschiedliche Zeit-Semantik in
 * `evaluate()` (`src/server/recommendation/service.ts`):
 *
 *   - Questionnaire-Version: SESSION-PINNING. `ConsultationSession`
 *     referenziert eine feste `questionnaireVersionId` -- besitzt und
 *     bekommt AUCH DURCH DIESEN FIX KEIN `ruleSetVersionId`-Feld.
 *   - RuleSet-Version: EVALUATION-SNAPSHOT. Jede `evaluate()`-Auswertung
 *     verwendet die zum jeweiligen AUSWERTUNGSZEITPUNKT aktuell ACTIVE
 *     RuleSetVersion -- nicht die zum Session-Start aktive.
 *
 * Deckt den von einem echten, vorbestehenden Befund ausgeloesten Fix ab
 * (`questionnaireAt`/`ruleSetAt`/`commercialAt` statt eines einzigen
 * gemeinsamen `atTime`, siehe service.ts Modulkommentar bei `evaluate()`):
 * vor dem Fix haette eine zweite Auswertung derselben Session nach einem
 * RuleSet-Publish weiterhin die zum Session-Start aktive (ggf. laengst
 * EXPIRED) RuleSetVersion verwendet.
 *
 * Szenario exakt nach ChatGPTs Vorgabe:
 * 1. Session A startet, RuleSet v1 ist ACTIVE -> erste Auswertung verwendet v1.
 * 2. RuleSet v2 wird ueber den ECHTEN Publish-Workflow (rule-admin.ts,
 *    AP5) veroeffentlicht -- v1 wird dadurch mandantenweit EXPIRED.
 * 3. Dieselbe Session A wird ERNEUT ausgewertet (kein neuer Session-Start):
 *    - Questionnaire bleibt unveraendert (session.questionnaireVersionId).
 *    - Die zweite Recommendation verwendet RuleSet v2
 *      (Recommendation.ruleSetVersionId zeigt auf v2).
 * 4. Eine NEU gestartete Session B verwendet ebenfalls v2.
 *
 * Ohne DATABASE_URL wird die gesamte Suite uebersprungen statt fehlzuschlagen.
 */

import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, describe, expect, it } from "vitest";
import { runWithTenantContext } from "@/server/tenant/context";
import { evaluate } from "@/server/recommendation/service";
import {
  addEligibilityRuleToDraft,
  createDraftRuleSetVersion,
  publishRuleSetVersion,
} from "@/server/admin/rule-admin";

const hasDatabaseUrl = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDatabaseUrl)(
  "Phase 9 AP9 Kern-Testfall: Questionnaire-Pinning vs. RuleSet-Evaluation-Snapshot",
  () => {
    const rawClient = new PrismaClient();
    const suffix = randomUUID().slice(0, 8);

    // Bewusst in der Vergangenheit relativ zum tatsaechlichen Testlauf --
    // sowohl FROM (RuleSet v1 Gueltigkeitsbeginn) als auch SESSION_AT
    // (Session-Start) muessen VOR dem tatsaechlichen `publishRuleSetVersion()`-
    // Aufruf innerhalb dieses Tests liegen (der intern `new Date()` als
    // validFrom fuer v2 verwendet), damit das Szenario "Session startete VOR
    // dem RuleSet-v2-Publish" realistisch nachgebildet wird.
    const FROM = new Date("2026-01-01T00:00:00Z");
    const SESSION_AT = new Date("2026-03-01T00:00:00Z");

    afterAll(async () => {
      await rawClient.$disconnect();
    });

    function asTenant<T>(tenantId: string, fn: () => Promise<T>): Promise<T> {
      return runWithTenantContext(
        { tenantId, userId: randomUUID(), roles: [], managementScope: null },
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

    /** Fragebogen ohne Pflichtfragen -- evaluate() kommt so ohne beantwortete Fragen aus. */
    async function createQuestionnaire(tenantId: string, key: string) {
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
        },
      });
      return version.id;
    }

    /** RuleSet v1 -- direkt per Rohzugriff angelegt (ACTIVE seit FROM), analog recommendation-engine.test.ts. */
    async function createRuleSetV1(tenantId: string, key: string) {
      const ruleSet = await rawClient.ruleSet.create({
        data: { tenantId, key: `${key}-${suffix}` },
      });
      const version = await rawClient.ruleSetVersion.create({
        data: {
          tenantId,
          ruleSetId: ruleSet.id,
          label: "v1",
          validFrom: FROM,
          validTo: null,
          status: "ACTIVE",
        },
      });
      await rawClient.eligibilityRule.create({
        data: {
          tenantId,
          ruleSetVersionId: version.id,
          key: "v1-rule",
          description: "v1",
          isRequired: false,
          fitWeight: 0,
        },
      });
      return version.id;
    }

    /**
     * RuleSet v2 -- ueber den ECHTEN Admin-Publish-Workflow (AP2/AP3/AP5,
     * `rule-admin.ts`) erzeugt und veroeffentlicht, NICHT per Rohzugriff --
     * das ist bewusst, damit dieser Test den tatsaechlichen
     * Produktionscode-Pfad ausuebt, ueber den ein Publish in der echten
     * Anwendung ablaeuft (inkl. der mandantenweiten EXPIRED-Ueberfuehrung
     * von v1).
     */
    async function publishRuleSetV2(tenantId: string, key: string): Promise<string> {
      return asTenant(tenantId, async () => {
        const ruleSet = await rawClient.ruleSet.create({
          data: { tenantId, key: `${key}-v2-${suffix}` },
        });
        const draft = await createDraftRuleSetVersion(ruleSet.id, { label: "v2" });
        await addEligibilityRuleToDraft(ruleSet.id, draft.id, {
          key: "v2-rule",
          description: "v2",
          isRequired: false,
          fitWeight: 0,
          isActive: true,
          conditions: [],
        });
        const published = await publishRuleSetVersion(ruleSet.id, draft.id);
        return published.version.id;
      });
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

    it("Session bleibt auf Questionnaire v1 gepinnt; erneute Auswertung verwendet die AKTUELL aktive RuleSetVersion (v2), nicht die zum Session-Start aktive (v1)", async () => {
      const { tenantId, storeId, employeeId } = await createTenant("snapshot");
      const questionnaireVersionId = await createQuestionnaire(tenantId, "snapshot-qv");
      const providerId = await createProvider("snapshot");
      const categoryId = await createCategory(tenantId, "snapshot");
      await createProductVersion(tenantId, categoryId, providerId, "snapshot");
      const ruleSetV1Id = await createRuleSetV1(tenantId, "snapshot-rs-v1");

      const sessionId = await createSession(tenantId, storeId, employeeId, questionnaireVersionId);

      // 1. Erste Auswertung -- RuleSet v1 ist die einzige ACTIVE Version.
      const firstResult = await asTenant(tenantId, () => evaluate(sessionId));
      expect(firstResult.ruleSetVersionId).toBe(ruleSetV1Id);

      // 2. RuleSet v2 wird ueber den echten Publish-Workflow veroeffentlicht
      //    -- v1 wird dadurch mandantenweit EXPIRED (AP5-Verhalten).
      const ruleSetV2Id = await publishRuleSetV2(tenantId, "snapshot-rs");
      expect(ruleSetV2Id).not.toBe(ruleSetV1Id);

      const v1AfterPublish = await rawClient.ruleSetVersion.findUniqueOrThrow({
        where: { id: ruleSetV1Id },
      });
      expect(v1AfterPublish.status).toBe("EXPIRED");

      // 3. Dieselbe Session A wird erneut ausgewertet (kein neuer Session-Start).
      const sessionAfterPublish = await rawClient.consultationSession.findUniqueOrThrow({
        where: { id: sessionId },
      });
      expect(sessionAfterPublish.questionnaireVersionId).toBe(questionnaireVersionId);

      const secondResult = await asTenant(tenantId, () => evaluate(sessionId));

      // Questionnaire bleibt unveraendert gepinnt (kein neues Feld, keine
      // Aenderung der Session-Referenz).
      const sessionAfterSecondEvaluate = await rawClient.consultationSession.findUniqueOrThrow({
        where: { id: sessionId },
      });
      expect(sessionAfterSecondEvaluate.questionnaireVersionId).toBe(questionnaireVersionId);

      // Die zweite Recommendation verwendet die AKTUELL aktive RuleSetVersion (v2).
      expect(secondResult.ruleSetVersionId).toBe(ruleSetV2Id);
      expect(secondResult.id).not.toBe(firstResult.id);

      // Beide Recommendation-Zeilen bleiben unveraendert bestehen (append-only)
      // und zeigen jeweils auf die zum Zeitpunkt ihrer Erzeugung tatsaechlich
      // verwendete RuleSetVersion.
      const firstRow = await rawClient.recommendation.findUniqueOrThrow({
        where: { id: firstResult.id },
      });
      expect(firstRow.ruleSetVersionId).toBe(ruleSetV1Id);

      // 4. Eine NEU gestartete Session B verwendet ebenfalls v2.
      const sessionBId = await createSession(tenantId, storeId, employeeId, questionnaireVersionId);
      const thirdResult = await asTenant(tenantId, () => evaluate(sessionBId));
      expect(thirdResult.ruleSetVersionId).toBe(ruleSetV2Id);
    });
  },
);
