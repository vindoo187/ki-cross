/**
 * Integrationstests fuer die Empfehlungs-Engine (`recommendation/service.ts`)
 * gegen eine ECHTE Postgres-Datenbank (gleiches Muster wie
 * `tests/integration/questionnaire-engine.test.ts`).
 *
 * Deckt die in PHASE_3B_IMPLEMENTATION_PLAN.md Abschnitt 11 ("Testplan")
 * geforderten DB-abhaengigen Faelle ab: vollstaendige Auswertungspipeline
 * (Pflicht-Eligibility/Fit-Score/Exclusion/Prioritization inkl.
 * Provisionsaufloesung/Cross-Selling), Idempotenz ueber
 * evaluationFingerprint (Fast-Path UND echte Nebenlaeufigkeit),
 * SalesOpportunity-Erzeugung ausschliesslich auf dem Frisch-Schreib-Pfad,
 * Mandantentrennung, Append-only-Unveraenderlichkeit der Recommendation*-
 * Tabellen (DB-Trigger forbid_update_delete) sowie die evaluate()-
 * Fehlerpfade (SessionNotEvaluableError/InsufficientAnswerDataError/
 * RuleSetNotConfiguredError/NoValidProductVersionError).
 *
 * Rein logische Faelle (Bedingungsauswertung, Fit-Score-Rundung, Tie-Break,
 * Fingerprint-Kanonisierung, Attribute-Registry, SalesOpportunity-Builder,
 * ...) sind bereits als DB-freie Unit-Tests in
 * `tests/unit/recommendation/*.test.ts` abgedeckt und werden hier NICHT
 * wiederholt.
 *
 * Ohne DATABASE_URL wird die gesamte Suite uebersprungen statt fehlzuschlagen.
 */

import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runWithTenantContext } from "@/server/tenant/context";
import { ConsultationSessionNotFoundError } from "@/server/questionnaire/errors";
import { completeQuestionnaire } from "@/server/questionnaire/service";
import { evaluate, getLatestRecommendation } from "@/server/recommendation/service";
import {
  InsufficientAnswerDataError,
  NoValidProductVersionError,
  RuleSetNotConfiguredError,
  SessionNotEvaluableError,
} from "@/server/recommendation/errors";

const hasDatabaseUrl = Boolean(process.env.DATABASE_URL);

const VALUE_TYPE_BY_ATTRIBUTE_KEY: Record<string, string> = {
  dataVolumeGb: "number",
  contractCommitmentMonths: "number",
  pricePlanTier: "string",
  hasEuRoaming: "boolean",
};

describe.skipIf(!hasDatabaseUrl)("Empfehlungs-Engine (Integrationstest, echte Postgres-DB)", () => {
  const rawClient = new PrismaClient();
  const suffix = randomUUID().slice(0, 8);

  const FROM = new Date("2026-01-01T00:00:00Z");
  const SESSION_AT = new Date("2026-03-01T00:00:00Z"); // liegt in [FROM, unbegrenzt)

  afterAll(async () => {
    // Bewusst kein deleteMany - siehe questionnaire-engine.test.ts (append-only
    // Tabellen inkl. recommendations/recommendation_items/
    // recommendation_rationales/recommendation_cross_selling_signals lassen
    // sich ohnehin nicht loeschen). CI nutzt einen ephemeren Postgres-
    // Service-Container pro Lauf; Testisolation ist durch den
    // randomUUID-Suffix sichergestellt.
    await rawClient.$disconnect();
  });

  // -------------------------------------------------------------------------
  // Fixture-Helfer (Muster siehe questionnaire-engine.test.ts::createTenant)
  // -------------------------------------------------------------------------

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

  /** Fragebogen mit genau einer BOOLEAN-Frage (optional oder Pflicht), ohne Sichtbarkeitsbedingungen. */
  async function createQuestionnaire(
    tenantId: string,
    key: string,
    questionKey: string,
    isRequired: boolean,
  ) {
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
    const question = await rawClient.question.create({
      data: { tenantId, questionnaireVersionId: version.id, key: questionKey, sortOrder: 1 },
    });
    await rawClient.questionVersion.create({
      data: {
        tenantId,
        questionId: question.id,
        label: `Frage ${questionKey}`,
        answerType: "BOOLEAN",
        isRequired,
        validFrom: FROM,
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
    attributes: Record<string, string>,
    monthlyPriceMinor: number,
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
        monthlyPriceMinor,
      },
    });
    await rawClient.tariffAttribute.createMany({
      data: Object.entries(attributes).map(([attributeKey, attributeValue]) => ({
        tenantId,
        productVersionId: version.id,
        attributeKey,
        attributeValue,
        valueType: VALUE_TYPE_BY_ATTRIBUTE_KEY[attributeKey] ?? "string",
      })),
    });
    return { productId: product.id, productVersionId: version.id };
  }

  async function createCommissionModelVersion(
    tenantId: string,
    productId: string,
    amountMinor: number,
  ) {
    const model = await rawClient.commissionModel.create({
      data: { tenantId, productId, name: `Provision ${productId}` },
    });
    const version = await rawClient.commissionModelVersion.create({
      data: {
        tenantId,
        commissionModelId: model.id,
        versionNumber: 1,
        status: "ACTIVE",
        validFrom: FROM,
        validTo: null,
        commissionType: "FLAT",
        currency: "EUR",
        commissionAmountMinor: amountMinor,
      },
    });
    return version.id;
  }

  async function createSession(
    tenantId: string,
    storeId: string,
    employeeId: string,
    questionnaireVersionId: string,
    consultationType: "NEW_CONTRACT" | "RENEWAL",
    status: "IN_PROGRESS" | "COMPLETED" | "ABANDONED" = "IN_PROGRESS",
  ) {
    const session = await rawClient.consultationSession.create({
      data: {
        tenantId,
        storeId,
        employeeId,
        questionnaireVersionId,
        consultationType,
        status,
        startedAt: SESSION_AT,
      },
    });
    return session.id;
  }

  async function answerBoolean(
    tenantId: string,
    sessionId: string,
    questionId: string,
    value: boolean,
  ) {
    const questionVersion = await rawClient.questionVersion.findFirstOrThrow({
      where: { tenantId, questionId },
    });
    await rawClient.customerAnswer.create({
      data: {
        tenantId,
        consultationSessionId: sessionId,
        questionVersionId: questionVersion.id,
        answerType: "BOOLEAN",
        booleanValue: value,
        isActive: true,
        answerVersion: 1,
        answeredAt: SESSION_AT,
      },
    });
  }

  function asTenant<T>(tenantId: string, fn: () => Promise<T>): Promise<T> {
    return runWithTenantContext(
      { tenantId, userId: randomUUID(), roles: [], managementScope: null },
      fn,
    );
  }

  // -------------------------------------------------------------------------
  // Haupt-Fixture ("rec-a"): voller Regelsatz (Eligibility/Exclusion/
  // Prioritization/Cross-Selling) + zwei Produkte + eine Provision.
  // -------------------------------------------------------------------------

  let tenantAId: string;
  let storeAId: string;
  let employeeAId: string;
  let questionnaireVersionAId: string;
  let streamingQuestionId: string;
  let basicProductVersionId: string;
  let premiumProductVersionId: string;
  let premiumCommissionModelVersionId: string;

  let tenantBId: string;

  beforeAll(async () => {
    const a = await createTenant("rec-a");
    tenantAId = a.tenantId;
    storeAId = a.storeId;
    employeeAId = a.employeeId;

    const qa = await createQuestionnaire(
      tenantAId,
      "rec-a-fragebogen",
      "hat_streaming_bedarf",
      false,
    );
    questionnaireVersionAId = qa.questionnaireVersionId;
    streamingQuestionId = qa.questionId;

    const providerId = await createProvider("rec-a");
    const categoryId = await createCategory(tenantAId, "rec-a");

    const basic = await createProductVersion(
      tenantAId,
      categoryId,
      providerId,
      "basic",
      {
        dataVolumeGb: "2",
        hasEuRoaming: "false",
        pricePlanTier: "BASIC",
        contractCommitmentMonths: "12",
      },
      1000,
    );
    basicProductVersionId = basic.productVersionId;

    const premium = await createProductVersion(
      tenantAId,
      categoryId,
      providerId,
      "premium",
      {
        dataVolumeGb: "50",
        hasEuRoaming: "true",
        pricePlanTier: "PREMIUM",
        contractCommitmentMonths: "24",
      },
      3000,
    );
    premiumProductVersionId = premium.productVersionId;

    premiumCommissionModelVersionId = await createCommissionModelVersion(
      tenantAId,
      premium.productId,
      500,
    );

    const ruleSetVersionId = await createRuleSetVersion(tenantAId, "rec-a-ruleset");

    const eligRequired = await rawClient.eligibilityRule.create({
      data: {
        tenantId: tenantAId,
        ruleSetVersionId,
        key: "ausreichendes_datenvolumen",
        description: "Mindestens 5GB Datenvolumen erforderlich.",
        isRequired: true,
        fitWeight: 0,
      },
    });
    await rawClient.eligibilityRuleCondition.create({
      data: {
        tenantId: tenantAId,
        eligibilityRuleId: eligRequired.id,
        groupIndex: 0,
        sourceType: "PRODUCT_ATTRIBUTE",
        attributeKey: "dataVolumeGb",
        operator: "GREATER_THAN_OR_EQUAL",
        comparisonValue: "5",
      },
    });

    const eligFit = await rawClient.eligibilityRule.create({
      data: {
        tenantId: tenantAId,
        ruleSetVersionId,
        key: "roaming_passt_zu_streaming_bedarf",
        description: "EU-Roaming passt zum geaeusserten Streaming-Bedarf.",
        isRequired: false,
        fitWeight: 60,
      },
    });
    await rawClient.eligibilityRuleCondition.createMany({
      data: [
        {
          tenantId: tenantAId,
          eligibilityRuleId: eligFit.id,
          groupIndex: 0,
          sourceType: "ANSWER",
          questionId: streamingQuestionId,
          operator: "EQUALS",
          comparisonValue: "true",
        },
        {
          tenantId: tenantAId,
          eligibilityRuleId: eligFit.id,
          groupIndex: 0,
          sourceType: "PRODUCT_ATTRIBUTE",
          attributeKey: "hasEuRoaming",
          operator: "EQUALS",
          comparisonValue: "true",
        },
      ],
    });

    const exclusion = await rawClient.exclusionRule.create({
      data: {
        tenantId: tenantAId,
        ruleSetVersionId,
        key: "renewal_kein_premium",
        reasonCode: "RENEWAL_NO_PREMIUM_TIER",
        description: "Bei Vertragsverlaengerung kein Premium-Tarif.",
      },
    });
    await rawClient.exclusionRuleCondition.createMany({
      data: [
        {
          tenantId: tenantAId,
          exclusionRuleId: exclusion.id,
          groupIndex: 0,
          sourceType: "SESSION_ATTRIBUTE",
          attributeKey: "consultationType",
          operator: "EQUALS",
          comparisonValue: "RENEWAL",
        },
        {
          tenantId: tenantAId,
          exclusionRuleId: exclusion.id,
          groupIndex: 0,
          sourceType: "PRODUCT_ATTRIBUTE",
          attributeKey: "pricePlanTier",
          operator: "EQUALS",
          comparisonValue: "PREMIUM",
        },
      ],
    });

    const prioRoaming = await rawClient.prioritizationRule.create({
      data: {
        tenantId: tenantAId,
        ruleSetVersionId,
        key: "bonus_eu_roaming",
        description: "Bonus fuer EU-Roaming.",
        weight: 30,
        commissionRequired: false,
      },
    });
    await rawClient.prioritizationRuleCondition.create({
      data: {
        tenantId: tenantAId,
        prioritizationRuleId: prioRoaming.id,
        groupIndex: 0,
        sourceType: "PRODUCT_ATTRIBUTE",
        attributeKey: "hasEuRoaming",
        operator: "EQUALS",
        comparisonValue: "true",
      },
    });

    const prioPremium = await rawClient.prioritizationRule.create({
      data: {
        tenantId: tenantAId,
        ruleSetVersionId,
        key: "bonus_neuvertrag_premium",
        description: "Bonus fuer Neuvertrag mit Premium-Tarif (provisionspflichtig).",
        weight: 20,
        commissionRequired: true,
      },
    });
    await rawClient.prioritizationRuleCondition.createMany({
      data: [
        {
          tenantId: tenantAId,
          prioritizationRuleId: prioPremium.id,
          groupIndex: 0,
          sourceType: "SESSION_ATTRIBUTE",
          attributeKey: "consultationType",
          operator: "EQUALS",
          comparisonValue: "NEW_CONTRACT",
        },
        {
          tenantId: tenantAId,
          prioritizationRuleId: prioPremium.id,
          groupIndex: 0,
          sourceType: "PRODUCT_ATTRIBUTE",
          attributeKey: "pricePlanTier",
          operator: "EQUALS",
          comparisonValue: "PREMIUM",
        },
      ],
    });

    const crossSelling = await rawClient.crossSellingRule.create({
      data: {
        tenantId: tenantAId,
        ruleSetVersionId,
        key: "streaming_zusatzpaket",
        description: "Streaming-Zusatzpaket bei geaeussertem Bedarf.",
        needType: "STREAMING",
        priority: 70,
        reasonCode: "STREAMING_ADDON_SUGGESTED",
      },
    });
    await rawClient.crossSellingRuleCondition.create({
      data: {
        tenantId: tenantAId,
        crossSellingRuleId: crossSelling.id,
        groupIndex: 0,
        sourceType: "ANSWER",
        questionId: streamingQuestionId,
        operator: "EQUALS",
        comparisonValue: "true",
      },
    });

    // --- Tenant B: nur fuer den Mandantentrennungs-Test, ohne eigene Regeln/Produkte. ---
    const b = await createTenant("rec-b");
    tenantBId = b.tenantId;
  });

  // -------------------------------------------------------------------------
  // Volle Auswertungspipeline
  // -------------------------------------------------------------------------

  it("wertet die volle Pipeline aus: Pflicht-Eligibility, Fit-Score, Provisionsaufloesung, Tie-Break-Rang", async () => {
    const sessionId = await createSession(
      tenantAId,
      storeAId,
      employeeAId,
      questionnaireVersionAId,
      "NEW_CONTRACT",
    );

    const result = await asTenant(tenantAId, () => evaluate(sessionId));

    expect(result.items).toHaveLength(2);
    const basicItem = result.items.find((i) => i.productVersionId === basicProductVersionId)!;
    const premiumItem = result.items.find((i) => i.productVersionId === premiumProductVersionId)!;

    // BASIC: Pflichtregel (dataVolumeGb >= 5) nicht erfuellt -> hartes Gate.
    expect(basicItem.eligibilityPassed).toBe(false);
    expect(
      basicItem.rationales.some(
        (r) =>
          r.factorKey === "eligibility:ausreichendes_datenvolumen" &&
          r.factorValue === "not_matched",
      ),
    ).toBe(true);

    // PREMIUM: Pflichtregel erfuellt, Fit-Regel nicht (Streaming-Frage unbeantwortet) -> Fit-Score 0.
    expect(premiumItem.eligibilityPassed).toBe(true);
    expect(premiumItem.customerFitScore).toBe(0);

    // Business-Priority: Roaming-Bonus (30, ohne Provisionspflicht) + Neuvertrag-Premium-Bonus
    // (20, provisionspflichtig, Provision aufloesbar).
    expect(premiumItem.businessPriorityScore).toBe(50);
    const commissionRationale = premiumItem.rationales.find(
      (r) => r.factorKey === "prioritization:bonus_neuvertrag_premium",
    );
    expect(commissionRationale?.commissionModelVersionId).toBe(premiumCommissionModelVersionId);
    expect(commissionRationale?.commissionValueMinor).toBe(500);

    // Tie-Break: PREMIUM (Score 50) vor BASIC (Score 0).
    expect(premiumItem.priorityRank).toBe(1);
    expect(basicItem.priorityRank).toBe(2);

    expect(result.algorithmVersion).toBe(1);
    expect(result.evaluationFingerprint).toMatch(/^[0-9a-f]{64}$/);
  });

  // -------------------------------------------------------------------------
  // Idempotenz
  // -------------------------------------------------------------------------

  it("ist idempotent: ein zweiter evaluate()-Aufruf mit unveraendertem Input liefert dieselbe Recommendation ohne neue Zeile", async () => {
    const sessionId = await createSession(
      tenantAId,
      storeAId,
      employeeAId,
      questionnaireVersionAId,
      "NEW_CONTRACT",
    );

    const first = await asTenant(tenantAId, () => evaluate(sessionId));
    const second = await asTenant(tenantAId, () => evaluate(sessionId));

    expect(second.id).toBe(first.id);
    expect(second.evaluationFingerprint).toBe(first.evaluationFingerprint);

    const count = await rawClient.recommendation.count({
      where: { consultationSessionId: sessionId },
    });
    expect(count).toBe(1);
  });

  it("liefert bei echter Nebenlaeufigkeit (zwei parallele Erst-Auswertungen derselben Session) genau eine Recommendation-Zeile", async () => {
    const sessionId = await createSession(
      tenantAId,
      storeAId,
      employeeAId,
      questionnaireVersionAId,
      "NEW_CONTRACT",
    );

    const [r1, r2] = await Promise.all([
      asTenant(tenantAId, () => evaluate(sessionId)),
      asTenant(tenantAId, () => evaluate(sessionId)),
    ]);

    expect(r2.id).toBe(r1.id);
    const count = await rawClient.recommendation.count({
      where: { consultationSessionId: sessionId },
    });
    expect(count).toBe(1);
  });

  it("getLatestRecommendation() liefert null, solange noch keine Recommendation existiert", async () => {
    const sessionId = await createSession(
      tenantAId,
      storeAId,
      employeeAId,
      questionnaireVersionAId,
      "NEW_CONTRACT",
    );
    const result = await asTenant(tenantAId, () => getLatestRecommendation(sessionId));
    expect(result).toBeNull();
  });

  // -------------------------------------------------------------------------
  // Exclusion
  // -------------------------------------------------------------------------

  it("Exclusion-Regel greift bei Vertragsverlaengerung + Premium-Tarif und setzt eligibilityPassed=false trotz erfuellter Pflichtregel", async () => {
    const sessionId = await createSession(
      tenantAId,
      storeAId,
      employeeAId,
      questionnaireVersionAId,
      "RENEWAL",
    );

    const result = await asTenant(tenantAId, () => evaluate(sessionId));
    const premiumItem = result.items.find((i) => i.productVersionId === premiumProductVersionId)!;

    expect(premiumItem.exclusionReasonCodes).toEqual(["RENEWAL_NO_PREMIUM_TIER"]);
    expect(premiumItem.eligibilityPassed).toBe(false);
    expect(
      premiumItem.rationales.some(
        (r) => r.factorKey === "exclusion:RENEWAL_NO_PREMIUM_TIER" && r.factorValue === "null",
      ),
    ).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Cross-Selling + SalesOpportunity (nur auf dem Frisch-Schreib-Pfad)
  // -------------------------------------------------------------------------

  it("erzeugt bei einer Frisch-Auswertung ein Cross-Selling-Signal + genau eine SalesOpportunity, aber keine zusaetzliche bei einem idempotenten Wiederholungsaufruf", async () => {
    const sessionId = await createSession(
      tenantAId,
      storeAId,
      employeeAId,
      questionnaireVersionAId,
      "NEW_CONTRACT",
    );
    await answerBoolean(tenantAId, sessionId, streamingQuestionId, true);

    const first = await asTenant(tenantAId, () => evaluate(sessionId));
    expect(first.crossSellingSignals).toHaveLength(1);
    const signal = first.crossSellingSignals[0]!;
    expect(signal.reasonCode).toBe("STREAMING_ADDON_SUGGESTED");
    expect(signal.needType).toBe("STREAMING");

    const premiumItem = first.items.find((i) => i.productVersionId === premiumProductVersionId)!;
    // Fit-Regel matcht jetzt (Streaming-Bedarf=true UND hasEuRoaming=true) -> Fit-Score 100.
    expect(premiumItem.customerFitScore).toBe(100);

    const opportunitiesAfterFirst = await rawClient.salesOpportunity.findMany({
      where: { consultationSessionId: sessionId },
    });
    expect(opportunitiesAfterFirst).toHaveLength(1);
    expect(opportunitiesAfterFirst[0]!.triggerSignalId).toBe(signal.id);

    // Zweiter Aufruf mit unveraendertem Input: Fast-Path, keine erneute SalesOpportunity-Erzeugung.
    const second = await asTenant(tenantAId, () => evaluate(sessionId));
    expect(second.id).toBe(first.id);
    const opportunitiesAfterSecond = await rawClient.salesOpportunity.findMany({
      where: { consultationSessionId: sessionId },
    });
    expect(opportunitiesAfterSecond).toHaveLength(1);
  });

  // -------------------------------------------------------------------------
  // Mandantentrennung
  // -------------------------------------------------------------------------

  it("Mandantentrennung: eine Session/Recommendation von Tenant A ist unter Tenant B nicht sichtbar", async () => {
    const sessionId = await createSession(
      tenantAId,
      storeAId,
      employeeAId,
      questionnaireVersionAId,
      "NEW_CONTRACT",
    );
    await asTenant(tenantAId, () => evaluate(sessionId));

    await expect(asTenant(tenantBId, () => getLatestRecommendation(sessionId))).rejects.toThrow(
      ConsultationSessionNotFoundError,
    );
  });

  // -------------------------------------------------------------------------
  // Append-only-Unveraenderlichkeit (DB-Trigger forbid_update_delete)
  // -------------------------------------------------------------------------

  it("Recommendation-Zeilen sind unveraenderlich (DB-Trigger forbid_update_delete verbietet UPDATE/DELETE)", async () => {
    const sessionId = await createSession(
      tenantAId,
      storeAId,
      employeeAId,
      questionnaireVersionAId,
      "NEW_CONTRACT",
    );
    const result = await asTenant(tenantAId, () => evaluate(sessionId));

    await expect(
      rawClient.recommendation.update({
        where: { id: result.id },
        data: { algorithmVersion: 999 },
      }),
    ).rejects.toThrow();

    await expect(rawClient.recommendation.delete({ where: { id: result.id } })).rejects.toThrow();
  });

  // -------------------------------------------------------------------------
  // Fehlerpfade
  // -------------------------------------------------------------------------

  it("evaluate() wirft SessionNotEvaluableError fuer eine abgebrochene (ABANDONED) Session", async () => {
    // AP14/CI#22-Fix (mit ChatGPT abgestimmt): ABANDONED bleibt gesperrt,
    // waehrend COMPLETED seit diesem Fix bewusst auswertbar ist (siehe die
    // beiden folgenden Tests). Vor dem Fix stand hier "COMPLETED" - das
    // testete faelschlich genau das Verhalten, das den echten Bug in CI #22
    // verursacht hat (completeQuestionnaire() setzt COMPLETED bereits VOR
    // dem "Empfehlung auswerten"-Schritt im regulaeren Ablauf).
    const sessionId = await createSession(
      tenantAId,
      storeAId,
      employeeAId,
      questionnaireVersionAId,
      "NEW_CONTRACT",
      "ABANDONED",
    );
    await expect(asTenant(tenantAId, () => evaluate(sessionId))).rejects.toThrow(
      SessionNotEvaluableError,
    );
  });

  it("evaluate() wertet eine bereits abgeschlossene (COMPLETED) Session erfolgreich aus", async () => {
    // Positiv-Gegenstueck zum AP14/CI#22-Fix: completeQuestionnaire() setzt
    // den Status bereits auf COMPLETED, bevor "Empfehlung auswerten" im
    // regulaeren Ablauf ueberhaupt geklickt wird - assertSessionEvaluable()
    // muss das seit Fix 3 zulassen (positive Whitelist IN_PROGRESS|COMPLETED).
    const sessionId = await createSession(
      tenantAId,
      storeAId,
      employeeAId,
      questionnaireVersionAId,
      "NEW_CONTRACT",
      "COMPLETED",
    );
    const result = await asTenant(tenantAId, () => evaluate(sessionId));
    expect(result.items.length).toBeGreaterThan(0);
  });

  it("Pipeline completeQuestionnaire() -> evaluate(): erfolgreiche Auswertung nach regulaerem Fragebogen-Abschluss", async () => {
    // Genau die Kombination, die den Bug in CI #22 verdeckt hat (siehe
    // ChatGPT-Abstimmung zu AP14/Fix 3): ueber den echten Service-Aufruf
    // completeQuestionnaire() (nicht per rawClient direkt auf COMPLETED
    // gesetzt) und danach evaluate() auf derselben Session.
    const sessionId = await createSession(
      tenantAId,
      storeAId,
      employeeAId,
      questionnaireVersionAId,
      "NEW_CONTRACT",
    );

    await asTenant(tenantAId, () => completeQuestionnaire(sessionId));

    const sessionAfterCompletion = await rawClient.consultationSession.findUniqueOrThrow({
      where: { id: sessionId },
    });
    expect(sessionAfterCompletion.status).toBe("COMPLETED");

    const result = await asTenant(tenantAId, () => evaluate(sessionId));
    expect(result.items.length).toBeGreaterThan(0);
  });

  it("evaluate() wirft InsufficientAnswerDataError, wenn eine sichtbare Pflichtfrage unbeantwortet ist", async () => {
    const tenant = await createTenant("rec-required");
    const qn = await createQuestionnaire(
      tenant.tenantId,
      "rec-required-fragebogen",
      "pflichtfrage",
      true,
    );
    const sessionId = await createSession(
      tenant.tenantId,
      tenant.storeId,
      tenant.employeeId,
      qn.questionnaireVersionId,
      "NEW_CONTRACT",
    );
    await expect(asTenant(tenant.tenantId, () => evaluate(sessionId))).rejects.toThrow(
      InsufficientAnswerDataError,
    );
  });

  it("evaluate() wirft RuleSetNotConfiguredError, wenn keine ACTIVE RuleSetVersion existiert", async () => {
    const tenant = await createTenant("rec-noruleset");
    const qn = await createQuestionnaire(
      tenant.tenantId,
      "rec-noruleset-fragebogen",
      "frage",
      false,
    );
    const sessionId = await createSession(
      tenant.tenantId,
      tenant.storeId,
      tenant.employeeId,
      qn.questionnaireVersionId,
      "NEW_CONTRACT",
    );
    await expect(asTenant(tenant.tenantId, () => evaluate(sessionId))).rejects.toThrow(
      RuleSetNotConfiguredError,
    );
  });

  it("evaluate() wirft NoValidProductVersionError, wenn tenant-weit keine gueltige ProductVersion existiert", async () => {
    const tenant = await createTenant("rec-noproduct");
    const qn = await createQuestionnaire(
      tenant.tenantId,
      "rec-noproduct-fragebogen",
      "frage",
      false,
    );
    await createRuleSetVersion(tenant.tenantId, "rec-noproduct-ruleset");
    const sessionId = await createSession(
      tenant.tenantId,
      tenant.storeId,
      tenant.employeeId,
      qn.questionnaireVersionId,
      "NEW_CONTRACT",
    );
    await expect(asTenant(tenant.tenantId, () => evaluate(sessionId))).rejects.toThrow(
      NoValidProductVersionError,
    );
  });
});
