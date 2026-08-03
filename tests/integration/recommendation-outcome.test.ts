/**
 * Integrationstests fuer `recommendation/outcome.ts::recordRecommendationOutcome()`
 * (AP5, siehe PHASE_5_IMPLEMENTATION_PLAN.md Abschnitt 2.2 Punkt 3 +
 * Abschnitt 8) gegen eine ECHTE Postgres-Datenbank (gleiches Muster wie
 * `recommendation-engine.test.ts`).
 *
 * Fixtures legen `Recommendation`/`RecommendationItem`-Zeilen bewusst DIREKT
 * per Raw-Client an (kein vollstaendiger `evaluate()`-Regelsatz noetig) -
 * `recordRecommendationOutcome()` interessiert sich nur fuer das bereits
 * existierende Item, nicht fuer dessen Entstehungsweg.
 *
 * Ohne DATABASE_URL wird die gesamte Suite uebersprungen statt fehlzuschlagen.
 */

import { randomBytes, randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runWithTenantContext } from "@/server/tenant/context";
import { recordRecommendationOutcome } from "@/server/recommendation/outcome";
import {
  RecommendationItemNotFoundError,
  RecommendationOutcomeAlreadyExistsError,
  RejectionReasonNotApplicableError,
  RejectionReasonNotFoundError,
  RejectionReasonRequiredError,
} from "@/server/recommendation/errors";

const hasDatabaseUrl = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDatabaseUrl)(
  "recordRecommendationOutcome() (Integrationstest, echte Postgres-DB)",
  () => {
    const rawClient = new PrismaClient();
    const suffix = randomUUID().slice(0, 8);
    const FROM = new Date("2026-01-01T00:00:00Z");
    const SESSION_AT = new Date("2026-03-01T00:00:00Z");

    afterAll(async () => {
      // Bewusst kein deleteMany - siehe recommendation-engine.test.ts
      // (recommendation_outcomes ist append-only, DB-Trigger
      // forbid_update_delete verbietet DELETE ohnehin).
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
      return { tenantId: tenant.id, companyId: company.id, storeId: store.id };
    }

    async function createEmployee(tenantId: string, storeId: string, key: string) {
      const user = await rawClient.user.create({
        data: {
          tenantId,
          email: `${key}-${suffix}@example-synthetic.test`,
          isSynthetic: true,
        },
      });
      const employee = await rawClient.employee.create({
        data: { tenantId, storeId, userId: user.id, displayName: `MA ${key}` },
      });
      return employee.id;
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

    async function createRuleSetVersion(tenantId: string, key: string) {
      const ruleSet = await rawClient.ruleSet.create({
        data: { tenantId, key: `${key}-${suffix}` },
      });
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
          validFrom: FROM,
          validTo: null,
          currency: "EUR",
          monthlyPriceMinor: 1000,
        },
      });
      return version.id;
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

    async function createRecommendationItem(
      tenantId: string,
      consultationSessionId: string,
      ruleSetVersionId: string,
      productVersionId: string,
    ) {
      const recommendation = await rawClient.recommendation.create({
        data: {
          tenantId,
          consultationSessionId,
          ruleSetVersionId,
          algorithmVersion: 1,
          evaluationFingerprint: randomBytes(32).toString("hex"),
          generatedAt: SESSION_AT,
        },
      });
      const item = await rawClient.recommendationItem.create({
        data: {
          tenantId,
          recommendationId: recommendation.id,
          productVersionId,
          eligibilityPassed: true,
          exclusionReasonCodes: [],
          customerFitScore: 50,
          businessPriorityScore: 0,
          priorityRank: 1,
        },
      });
      return { recommendationId: recommendation.id, itemId: item.id };
    }

    async function createRejectionReason(tenantId: string, key: string, isActive = true) {
      const reason = await rawClient.rejectionReason.create({
        data: { tenantId, key: `${key}-${suffix}`, label: `Grund ${key}`, isActive },
      });
      return reason.id;
    }

    function asEmployee<T>(tenantId: string, employeeId: string, fn: () => Promise<T>): Promise<T> {
      return runWithTenantContext({ tenantId, userId: randomUUID(), employeeId, roles: [] }, fn);
    }

    let tenantAId: string;
    let storeAId: string;
    let sessionOwnerEmployeeId: string;
    let deciderEmployeeId: string;
    let questionnaireVersionAId: string;
    let ruleSetVersionAId: string;
    let productVersionAId: string;

    let tenantBId: string;

    beforeAll(async () => {
      const a = await createTenant("out-a");
      tenantAId = a.tenantId;
      storeAId = a.storeId;
      sessionOwnerEmployeeId = await createEmployee(tenantAId, storeAId, "out-a-owner");
      deciderEmployeeId = await createEmployee(tenantAId, storeAId, "out-a-decider");
      questionnaireVersionAId = await createQuestionnaireVersion(tenantAId, "out-a-fragebogen");
      ruleSetVersionAId = await createRuleSetVersion(tenantAId, "out-a-ruleset");
      productVersionAId = await createProductVersion(tenantAId, "out-a");

      const b = await createTenant("out-b");
      tenantBId = b.tenantId;
    });

    async function freshItem() {
      const sessionId = await createSession(
        tenantAId,
        storeAId,
        sessionOwnerEmployeeId,
        questionnaireVersionAId,
      );
      return createRecommendationItem(tenantAId, sessionId, ruleSetVersionAId, productVersionAId);
    }

    it("ACCEPTED: speichert Outcome mit decidedByEmployeeId des AKTUELLEN Akteurs (nicht des Sitzungsinhabers) und schreibt RECOMMENDATION_ACCEPTED-Analytics-Event mit Sitzungs-Attribution", async () => {
      const { itemId } = await freshItem();

      const result = await asEmployee(tenantAId, deciderEmployeeId, () =>
        recordRecommendationOutcome({ recommendationItemId: itemId, outcome: "ACCEPTED" }),
      );

      expect(result.outcome).toBe("ACCEPTED");
      expect(result.rejectionReasonId).toBeNull();
      expect(result.decidedByEmployeeId).toBe(deciderEmployeeId);

      const stored = await rawClient.recommendationOutcome.findUniqueOrThrow({
        where: { id: result.id },
      });
      expect(stored.outcome).toBe("ACCEPTED");

      const event = await rawClient.analyticsEvent.findFirst({
        where: { eventType: "RECOMMENDATION_ACCEPTED", tenantId: tenantAId },
      });
      expect(event).not.toBeNull();
      expect(event!.storeId).toBe(storeAId);
      expect(event!.employeeId).toBe(sessionOwnerEmployeeId);
    });

    it("REJECTED ohne rejectionReasonId wirft RejectionReasonRequiredError", async () => {
      const { itemId } = await freshItem();
      await expect(
        asEmployee(tenantAId, deciderEmployeeId, () =>
          recordRecommendationOutcome({ recommendationItemId: itemId, outcome: "REJECTED" }),
        ),
      ).rejects.toThrow(RejectionReasonRequiredError);
    });

    it("REJECTED mit gueltiger aktiver rejectionReasonId: speichert Outcome + schreibt RECOMMENDATION_REJECTED-Analytics-Event", async () => {
      const { itemId } = await freshItem();
      const reasonId = await createRejectionReason(tenantAId, "zu-teuer");

      const result = await asEmployee(tenantAId, deciderEmployeeId, () =>
        recordRecommendationOutcome({
          recommendationItemId: itemId,
          outcome: "REJECTED",
          rejectionReasonId: reasonId,
        }),
      );

      expect(result.outcome).toBe("REJECTED");
      expect(result.rejectionReasonId).toBe(reasonId);

      const event = await rawClient.analyticsEvent.findFirst({
        where: {
          eventType: "RECOMMENDATION_REJECTED",
          tenantId: tenantAId,
          employeeId: sessionOwnerEmployeeId,
        },
        orderBy: { createdAt: "desc" },
      });
      expect(event).not.toBeNull();
    });

    it("REJECTED mit inaktiver rejectionReasonId wirft RejectionReasonNotFoundError", async () => {
      const { itemId } = await freshItem();
      const reasonId = await createRejectionReason(tenantAId, "inaktiv", false);
      await expect(
        asEmployee(tenantAId, deciderEmployeeId, () =>
          recordRecommendationOutcome({
            recommendationItemId: itemId,
            outcome: "REJECTED",
            rejectionReasonId: reasonId,
          }),
        ),
      ).rejects.toThrow(RejectionReasonNotFoundError);
    });

    it("REJECTED mit rejectionReasonId eines anderen Mandanten wirft RejectionReasonNotFoundError (Mandantentrennung)", async () => {
      const { itemId } = await freshItem();
      const foreignReasonId = await createRejectionReason(tenantBId, "fremd");
      await expect(
        asEmployee(tenantAId, deciderEmployeeId, () =>
          recordRecommendationOutcome({
            recommendationItemId: itemId,
            outcome: "REJECTED",
            rejectionReasonId: foreignReasonId,
          }),
        ),
      ).rejects.toThrow(RejectionReasonNotFoundError);
    });

    it("ACCEPTED mit gesetzter rejectionReasonId wirft RejectionReasonNotApplicableError", async () => {
      const { itemId } = await freshItem();
      const reasonId = await createRejectionReason(tenantAId, "unpassend");
      await expect(
        asEmployee(tenantAId, deciderEmployeeId, () =>
          recordRecommendationOutcome({
            recommendationItemId: itemId,
            outcome: "ACCEPTED",
            rejectionReasonId: reasonId,
          }),
        ),
      ).rejects.toThrow(RejectionReasonNotApplicableError);
    });

    it("DEFERRED: speichert Outcome, schreibt aber bewusst KEIN Analytics-Event (dokumentierte Enum-Luecke, siehe Modulkommentar)", async () => {
      const { itemId } = await freshItem();

      const result = await asEmployee(tenantAId, deciderEmployeeId, () =>
        recordRecommendationOutcome({ recommendationItemId: itemId, outcome: "DEFERRED" }),
      );
      expect(result.outcome).toBe("DEFERRED");

      const events = await rawClient.analyticsEvent.findMany({
        where: { tenantId: tenantAId },
      });
      // Kein einziges Event referenziert dieses Item ueber die Outcome-Payload
      // fuer einen "DEFERRED"-Wert - da es kein passendes AnalyticsEventType-
      // Enum-Feld dafuer gibt (siehe Plan Abschnitt 10).
      const deferredEvent = events.find(
        (e) =>
          e.payload !== null &&
          typeof e.payload === "object" &&
          (e.payload as Record<string, unknown>).recommendationItemId === itemId,
      );
      expect(deferredEvent).toBeUndefined();
    });

    it("ein zweiter Outcome-Versuch fuer dasselbe Item wirft RecommendationOutcomeAlreadyExistsError (append-only, Doppel-Request-Race)", async () => {
      const { itemId } = await freshItem();
      await asEmployee(tenantAId, deciderEmployeeId, () =>
        recordRecommendationOutcome({ recommendationItemId: itemId, outcome: "ACCEPTED" }),
      );

      await expect(
        asEmployee(tenantAId, deciderEmployeeId, () =>
          recordRecommendationOutcome({ recommendationItemId: itemId, outcome: "ACCEPTED" }),
        ),
      ).rejects.toThrow(RecommendationOutcomeAlreadyExistsError);
    });

    it("nicht existierendes RecommendationItem wirft RecommendationItemNotFoundError", async () => {
      await expect(
        asEmployee(tenantAId, deciderEmployeeId, () =>
          recordRecommendationOutcome({
            recommendationItemId: randomUUID(),
            outcome: "ACCEPTED",
          }),
        ),
      ).rejects.toThrow(RecommendationItemNotFoundError);
    });

    it("Mandantentrennung: ein RecommendationItem von Tenant A ist unter Tenant B nicht sichtbar", async () => {
      const { itemId } = await freshItem();
      const employeeB = await createEmployee(
        tenantBId,
        (await rawClient.store.findFirstOrThrow({ where: { tenantId: tenantBId } })).id,
        "out-b-decider",
      );
      await expect(
        asEmployee(tenantBId, employeeB, () =>
          recordRecommendationOutcome({ recommendationItemId: itemId, outcome: "ACCEPTED" }),
        ),
      ).rejects.toThrow(RecommendationItemNotFoundError);
    });
  },
);
