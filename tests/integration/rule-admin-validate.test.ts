/**
 * Phase 9 AP4 -- Integrationstests fuer den serverseitigen RuleSet-Validator
 * (`validateDraftRuleSetVersion()`, siehe PHASE_9_IMPLEMENTATION_PLAN.md
 * Abschnitt 6). Testet die Service-Schicht direkt innerhalb von
 * `runWithTenantContext()` sowie stichprobenartig die HTTP-Kette, gegen
 * ECHTE Postgres-Fixtures (kein `vi.mock`, Codebase-Konvention).
 *
 * WICHTIGER HINWEIS zu zwei der von ChatGPT (2026-08-18) geforderten Checks:
 * `ExclusionRule.reasonCode`-Eindeutigkeit je Version UND
 * `CrossSellingRule.suggestedProductVersionId`-Existenz sind beide bereits
 * durch echte DB-Constraints strukturell ausgeschlossen (siehe
 * `exclusion_rules_tenant_id_rule_set_version_id_reason_code_key`
 * UNIQUE-Constraint bzw. die FK
 * `CrossSellingRule.suggestedProductVersion` mit `onDelete: SetNull`) --
 * ein Verstoss kann daher ueber den normalen Schreibpfad (AP3-Service, wie
 * auch echte Rohinserts) gar nicht erst in der DB entstehen, ein
 * POSITIVER Test (der den Validator tatsaechlich "ausloest") ist also
 * strukturell nicht moeglich, ohne den Test selbst inkonsistent mit der
 * echten DB zu machen. Der Validator behaelt beide Pruefungen dennoch bei
 * (Verteidigung in der Tiefe / Unabhaengigkeit von DB-Interna, siehe
 * rule-admin.ts Modulkommentar) -- hier daher nur je ein Happy-Path-Test,
 * der bestaetigt, dass ein gueltiger, existierender Wert NICHT
 * faelschlicherweise als Verstoss gemeldet wird.
 *
 * Ohne DATABASE_URL wird die gesamte Suite uebersprungen statt fehlzuschlagen.
 *
 * WICHTIG (proaktive Pruefung 2026-08-19, siehe CI #51/#52-Fix in
 * rule-admin-crud.test.ts / rule-admin-publish.test.ts / rule-admin-rollback.test.ts):
 * `addEligibilityRuleToDraft()` / `addCrossSellingRuleToDraft()` /
 * `addPrioritizationRuleToDraft()` schreiben (wie alle echten Mutationen)
 * einen `AuditLog`-Eintrag mit `actorUserId`, per FK an eine echte
 * `users`-Zeile gebunden. Alle `runWithTenantContext()`-Aufrufe, die eine
 * dieser Funktionen aufrufen, verwenden daher einen ueber `createUser()`
 * echten Actor. `validateDraftRuleSetVersion()` selbst ist rein lesend
 * (siehe Test "ist rein lesend" unten) und bleibt dort, wo sie isoliert
 * aufgerufen wird, bei `randomUUID()`.
 */

import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { NextRequest } from "next/server";
import { afterAll, describe, expect, it } from "vitest";
import { runWithTenantContext } from "@/server/tenant/context";
import {
  createSessionToken,
  SESSION_COOKIE_NAME,
  type SessionPayload,
} from "@/server/auth/session";
import {
  addCrossSellingRuleToDraft,
  addEligibilityRuleToDraft,
  addPrioritizationRuleToDraft,
  validateDraftRuleSetVersion,
} from "@/server/admin/rule-admin";
import { POST as validateRoute } from "@/app/api/admin/rule-sets/[id]/versions/[versionId]/validate/route";

const hasDatabaseUrl = Boolean(process.env.DATABASE_URL);
process.env.DEV_AUTH_SECRET ??= "ap4-rule-admin-validate-test-secret-not-for-prod";

describe.skipIf(!hasDatabaseUrl)("Phase 9 AP4: Serverseitiger RuleSet-Validator", () => {
  const rawClient = new PrismaClient();
  const suffix = randomUUID().slice(0, 8);

  afterAll(async () => {
    await rawClient.$disconnect();
  });

  function baseSessionPayload(tenantId: string): Omit<SessionPayload, "issuedAt"> {
    return {
      tenantId,
      userId: randomUUID(),
      employeeId: randomUUID(),
      storeId: randomUUID(),
      displayName: "Test",
      roles: [],
      managementScope: null,
      configPermissions: [],
      consultationPermissions: [],
    };
  }

  async function createTenant(key: string) {
    const tenant = await rawClient.tenant.create({
      data: { key: `${key}-${suffix}`, name: `Test ${key}`, isSynthetic: true },
    });
    return tenant.id;
  }

  async function createUser(tenantId: string, key: string) {
    const user = await rawClient.user.create({
      data: { tenantId, email: `${key}-${suffix}@example-synthetic.test`, isSynthetic: true },
    });
    return user.id;
  }

  async function createDraftRuleSetVersionRaw(tenantId: string, key: string) {
    const ruleSet = await rawClient.ruleSet.create({ data: { tenantId, key: `${key}-${suffix}` } });
    const version = await rawClient.ruleSetVersion.create({
      data: {
        tenantId,
        ruleSetId: ruleSet.id,
        label: "draft",
        status: "DRAFT",
        validFrom: new Date(),
        validTo: null,
      },
    });
    return { ruleSetId: ruleSet.id, versionId: version.id };
  }

  /** Legt einen aktiven Fragebogen mit einer SINGLE_CHOICE- und einer BOOLEAN-Frage an. */
  async function createActiveQuestionnaire(tenantId: string, key: string) {
    const questionnaire = await rawClient.questionnaire.create({
      data: { tenantId, key: `${key}-${suffix}` },
    });
    const questionnaireVersion = await rawClient.questionnaireVersion.create({
      data: {
        tenantId,
        questionnaireId: questionnaire.id,
        label: "v1",
        status: "ACTIVE",
        validFrom: new Date("2026-01-01T00:00:00Z"),
        validTo: null,
      },
    });
    const choiceQuestion = await rawClient.question.create({
      data: {
        tenantId,
        questionnaireVersionId: questionnaireVersion.id,
        key: "q-choice",
        sortOrder: 1,
      },
    });
    const choiceVersion = await rawClient.questionVersion.create({
      data: {
        tenantId,
        questionId: choiceQuestion.id,
        label: "Welcher Tarif?",
        answerType: "SINGLE_CHOICE",
        status: "ACTIVE",
        validFrom: new Date("2026-01-01T00:00:00Z"),
      },
    });
    await rawClient.answerOption.createMany({
      data: [
        {
          tenantId,
          questionVersionId: choiceVersion.id,
          key: "BASIC",
          label: "Basic",
          sortOrder: 1,
        },
        {
          tenantId,
          questionVersionId: choiceVersion.id,
          key: "PREMIUM",
          label: "Premium",
          sortOrder: 2,
        },
      ],
    });

    const boolQuestion = await rawClient.question.create({
      data: {
        tenantId,
        questionnaireVersionId: questionnaireVersion.id,
        key: "q-bool",
        sortOrder: 2,
      },
    });
    await rawClient.questionVersion.create({
      data: {
        tenantId,
        questionId: boolQuestion.id,
        label: "EU-Roaming gewuenscht?",
        answerType: "BOOLEAN",
        status: "ACTIVE",
        validFrom: new Date("2026-01-01T00:00:00Z"),
      },
    });

    return { choiceQuestionId: choiceQuestion.id, boolQuestionId: boolQuestion.id };
  }

  function requestWithCookie(url: string, token: string) {
    return new NextRequest(url, {
      method: "POST",
      headers: new Headers({ cookie: `${SESSION_COOKIE_NAME}=${token}` }),
    });
  }

  function routeParams(value: { id: string; versionId: string }) {
    return { params: Promise.resolve(value) };
  }

  it("leerer Draft (keine Regeln) -> Issue 'enthaelt keine Regeln'", async () => {
    const tenantId = await createTenant("empty");
    const { ruleSetId, versionId } = await createDraftRuleSetVersionRaw(tenantId, "rs");

    await expect(
      runWithTenantContext(
        { tenantId, userId: randomUUID(), roles: [], managementScope: null },
        () => validateDraftRuleSetVersion(ruleSetId, versionId),
      ),
    ).rejects.toMatchObject({
      issues: expect.arrayContaining([expect.stringContaining("enthaelt keine Regeln")]),
    });
  });

  it("gueltiger Draft (ANSWER + PRODUCT_ATTRIBUTE + SESSION_ATTRIBUTE, korrekte Werte) -> {valid: true}", async () => {
    const tenantId = await createTenant("valid");
    const actorUserId = await createUser(tenantId, "actor");
    const { choiceQuestionId } = await createActiveQuestionnaire(tenantId, "qn");
    const { ruleSetId, versionId } = await createDraftRuleSetVersionRaw(tenantId, "rs");

    const result = await runWithTenantContext(
      { tenantId, userId: actorUserId, roles: [], managementScope: null },
      async () => {
        await addEligibilityRuleToDraft(ruleSetId, versionId, {
          key: "elig-1",
          description: "Test",
          isRequired: true,
          fitWeight: 5,
          isActive: true,
          conditions: [
            {
              groupIndex: 0,
              sourceType: "ANSWER",
              questionId: choiceQuestionId,
              operator: "EQUALS",
              comparisonValue: "PREMIUM",
            },
            {
              groupIndex: 1,
              sourceType: "PRODUCT_ATTRIBUTE",
              attributeKey: "hasEuRoaming",
              operator: "EQUALS",
              comparisonValue: "true",
            },
            {
              groupIndex: 2,
              sourceType: "SESSION_ATTRIBUTE",
              attributeKey: "consultationType",
              operator: "EQUALS",
              comparisonValue: "NEW_CONTRACT",
            },
          ],
        });
        return validateDraftRuleSetVersion(ruleSetId, versionId);
      },
    );

    expect(result).toEqual({ valid: true });
  });

  it("ANSWER-Bedingung verweist auf Frage ausserhalb der aktiven QuestionnaireVersion -> Issue", async () => {
    const tenantId = await createTenant("foreign-question");
    const actorUserId = await createUser(tenantId, "actor");
    await createActiveQuestionnaire(tenantId, "qn");
    const { ruleSetId, versionId } = await createDraftRuleSetVersionRaw(tenantId, "rs");

    // Die Question-FK verlangt eine echte Question desselben Tenants -- fuer
    // "existiert, gehoert zum Tenant, aber nicht Teil der aktuell aktiven
    // Fragebogen-Version" wird hier eine Frage in einer DRAFT- statt
    // ACTIVE-QuestionnaireVersion angelegt.
    const questionnaire = await rawClient.questionnaire.create({
      data: { tenantId, key: `draft-qn-${suffix}` },
    });
    const draftVersion = await rawClient.questionnaireVersion.create({
      data: {
        tenantId,
        questionnaireId: questionnaire.id,
        label: "draft",
        status: "DRAFT",
        validFrom: new Date("2026-01-01T00:00:00Z"),
      },
    });
    const draftQuestion = await rawClient.question.create({
      data: { tenantId, questionnaireVersionId: draftVersion.id, key: "q-draft", sortOrder: 1 },
    });
    await rawClient.questionVersion.create({
      data: {
        tenantId,
        questionId: draftQuestion.id,
        label: "Nicht aktiv",
        answerType: "BOOLEAN",
        status: "DRAFT",
        validFrom: new Date("2026-01-01T00:00:00Z"),
      },
    });

    await expect(
      runWithTenantContext(
        { tenantId, userId: actorUserId, roles: [], managementScope: null },
        async () => {
          await addEligibilityRuleToDraft(ruleSetId, versionId, {
            key: "elig-1",
            description: "Test",
            isRequired: true,
            fitWeight: 0,
            isActive: true,
            conditions: [
              {
                groupIndex: 0,
                sourceType: "ANSWER",
                questionId: draftQuestion.id,
                operator: "EQUALS",
                comparisonValue: "true",
              },
            ],
          });
          return validateDraftRuleSetVersion(ruleSetId, versionId);
        },
      ),
    ).rejects.toMatchObject({
      issues: expect.arrayContaining([
        expect.stringContaining("nicht Teil einer aktuell aktiven Fragebogen-Version"),
      ]),
    });
  });

  it("ANSWER-Bedingung mit fuer den AnswerType unzulaessigem Operator -> Issue", async () => {
    const tenantId = await createTenant("bad-operator");
    const actorUserId = await createUser(tenantId, "actor");
    const { boolQuestionId } = await createActiveQuestionnaire(tenantId, "qn");
    const { ruleSetId, versionId } = await createDraftRuleSetVersionRaw(tenantId, "rs");

    await expect(
      runWithTenantContext(
        { tenantId, userId: actorUserId, roles: [], managementScope: null },
        async () => {
          await addEligibilityRuleToDraft(ruleSetId, versionId, {
            key: "elig-1",
            description: "Test",
            isRequired: true,
            fitWeight: 0,
            isActive: true,
            conditions: [
              {
                groupIndex: 0,
                sourceType: "ANSWER",
                questionId: boolQuestionId,
                operator: "GREATER_THAN",
                comparisonValue: "true",
              },
            ],
          });
          return validateDraftRuleSetVersion(ruleSetId, versionId);
        },
      ),
    ).rejects.toMatchObject({
      issues: expect.arrayContaining([expect.stringContaining("nicht zulaessig")]),
    });
  });

  it("ANSWER-Bedingung (SINGLE_CHOICE) mit ungueltigem AnswerOption-Key -> Issue", async () => {
    const tenantId = await createTenant("bad-option");
    const actorUserId = await createUser(tenantId, "actor");
    const { choiceQuestionId } = await createActiveQuestionnaire(tenantId, "qn");
    const { ruleSetId, versionId } = await createDraftRuleSetVersionRaw(tenantId, "rs");

    await expect(
      runWithTenantContext(
        { tenantId, userId: actorUserId, roles: [], managementScope: null },
        async () => {
          await addEligibilityRuleToDraft(ruleSetId, versionId, {
            key: "elig-1",
            description: "Test",
            isRequired: true,
            fitWeight: 0,
            isActive: true,
            conditions: [
              {
                groupIndex: 0,
                sourceType: "ANSWER",
                questionId: choiceQuestionId,
                operator: "EQUALS",
                comparisonValue: "NICHT_EXISTENT",
              },
            ],
          });
          return validateDraftRuleSetVersion(ruleSetId, versionId);
        },
      ),
    ).rejects.toMatchObject({
      issues: expect.arrayContaining([expect.stringContaining("ungueltige AnswerOption")]),
    });
  });

  it("PRODUCT_ATTRIBUTE-Bedingung mit unbekanntem attributeKey -> Issue", async () => {
    const tenantId = await createTenant("unknown-attr");
    const actorUserId = await createUser(tenantId, "actor");
    const { ruleSetId, versionId } = await createDraftRuleSetVersionRaw(tenantId, "rs");

    await expect(
      runWithTenantContext(
        { tenantId, userId: actorUserId, roles: [], managementScope: null },
        async () => {
          await addEligibilityRuleToDraft(ruleSetId, versionId, {
            key: "elig-1",
            description: "Test",
            isRequired: true,
            fitWeight: 0,
            isActive: true,
            conditions: [
              {
                groupIndex: 0,
                sourceType: "PRODUCT_ATTRIBUTE",
                attributeKey: "voelligUnbekannt",
                operator: "EQUALS",
                comparisonValue: "x",
              },
            ],
          });
          return validateDraftRuleSetVersion(ruleSetId, versionId);
        },
      ),
    ).rejects.toMatchObject({
      issues: expect.arrayContaining([expect.stringContaining("Unbekannter attributeKey")]),
    });
  });

  it("PRODUCT_ATTRIBUTE-Bedingung mit unparsbarem comparisonValue -> Issue", async () => {
    const tenantId = await createTenant("bad-value");
    const actorUserId = await createUser(tenantId, "actor");
    const { ruleSetId, versionId } = await createDraftRuleSetVersionRaw(tenantId, "rs");

    await expect(
      runWithTenantContext(
        { tenantId, userId: actorUserId, roles: [], managementScope: null },
        async () => {
          await addEligibilityRuleToDraft(ruleSetId, versionId, {
            key: "elig-1",
            description: "Test",
            isRequired: true,
            fitWeight: 0,
            isActive: true,
            conditions: [
              {
                groupIndex: 0,
                sourceType: "PRODUCT_ATTRIBUTE",
                attributeKey: "dataVolumeGb",
                operator: "EQUALS",
                comparisonValue: "keine-zahl",
              },
            ],
          });
          return validateDraftRuleSetVersion(ruleSetId, versionId);
        },
      ),
    ).rejects.toMatchObject({
      issues: expect.arrayContaining([expect.stringContaining("keine gueltige Auspraegung")]),
    });
  });

  it("EligibilityRule.fitWeight negativ -> Issue (spiegelt Math.max(0,...)-Clamp in fit-score.ts)", async () => {
    const tenantId = await createTenant("neg-fitweight");
    const actorUserId = await createUser(tenantId, "actor");
    const { ruleSetId, versionId } = await createDraftRuleSetVersionRaw(tenantId, "rs");

    await expect(
      runWithTenantContext(
        { tenantId, userId: actorUserId, roles: [], managementScope: null },
        async () => {
          await addEligibilityRuleToDraft(ruleSetId, versionId, {
            key: "elig-1",
            description: "Test",
            isRequired: false,
            fitWeight: -5,
            isActive: true,
            conditions: [],
          });
          return validateDraftRuleSetVersion(ruleSetId, versionId);
        },
      ),
    ).rejects.toMatchObject({
      issues: expect.arrayContaining([
        expect.stringContaining("fitWeight (-5) darf nicht negativ sein"),
      ]),
    });
  });

  it("CrossSellingRule.priority negativ -> Issue", async () => {
    const tenantId = await createTenant("neg-priority");
    const actorUserId = await createUser(tenantId, "actor");
    const { ruleSetId, versionId } = await createDraftRuleSetVersionRaw(tenantId, "rs");

    await expect(
      runWithTenantContext(
        { tenantId, userId: actorUserId, roles: [], managementScope: null },
        async () => {
          await addCrossSellingRuleToDraft(ruleSetId, versionId, {
            key: "css-1",
            description: "Test",
            needType: "DSL",
            priority: -1,
            reasonCode: "R1",
            isActive: true,
            conditions: [],
          });
          return validateDraftRuleSetVersion(ruleSetId, versionId);
        },
      ),
    ).rejects.toMatchObject({
      issues: expect.arrayContaining([
        expect.stringContaining("priority (-1) darf nicht negativ sein"),
      ]),
    });
  });

  it("PrioritizationRule.weight NEGATIV wird bewusst NICHT abgelehnt (reine Summierung in prioritization.ts unterstuetzt negative Werte)", async () => {
    const tenantId = await createTenant("neg-weight-ok");
    const actorUserId = await createUser(tenantId, "actor");
    const { ruleSetId, versionId } = await createDraftRuleSetVersionRaw(tenantId, "rs");

    const result = await runWithTenantContext(
      { tenantId, userId: actorUserId, roles: [], managementScope: null },
      async () => {
        await addPrioritizationRuleToDraft(ruleSetId, versionId, {
          key: "prio-1",
          description: "Test",
          weight: -10,
          commissionRequired: false,
          isActive: true,
          conditions: [],
        });
        return validateDraftRuleSetVersion(ruleSetId, versionId);
      },
    );
    expect(result).toEqual({ valid: true });
  });

  it("CrossSellingRule.suggestedProductVersionId mit existierender ProductVersion -> kein Issue (Happy Path fuer die Existenzpruefung)", async () => {
    const tenantId = await createTenant("valid-product");
    const provider = await rawClient.provider.create({
      data: { key: `provider-${suffix}`, name: "Testprovider", isSynthetic: true },
    });
    const category = await rawClient.productCategory.create({
      data: { tenantId, key: `category-${suffix}`, name: "Testkategorie" },
    });
    const product = await rawClient.product.create({
      data: {
        tenantId,
        providerId: provider.id,
        categoryId: category.id,
        productType: "DSL",
        name: "Testprodukt",
        isSynthetic: true,
      },
    });
    const productVersion = await rawClient.productVersion.create({
      data: {
        tenantId,
        productId: product.id,
        versionNumber: 1,
        status: "ACTIVE",
        validFrom: new Date("2026-01-01T00:00:00Z"),
        currency: "EUR",
      },
    });
    const { ruleSetId, versionId } = await createDraftRuleSetVersionRaw(tenantId, "rs");
    const actorUserId = await createUser(tenantId, "actor");

    const result = await runWithTenantContext(
      { tenantId, userId: actorUserId, roles: [], managementScope: null },
      async () => {
        await addCrossSellingRuleToDraft(ruleSetId, versionId, {
          key: "css-1",
          description: "Test",
          needType: "DSL",
          priority: 1,
          reasonCode: "R1",
          suggestedProductVersionId: productVersion.id,
          isActive: true,
          conditions: [],
        });
        return validateDraftRuleSetVersion(ruleSetId, versionId);
      },
    );
    expect(result).toEqual({ valid: true });
  });

  // ---------------------------------------------------------------------
  // Phase 13 AP4 (Campaign Rule Integration, ChatGPT-GO 2026-08-30, siehe
  // PHASE_13_IMPLEMENTATION_PLAN.md Abschnitt 3 AP4): CAMPAIGN_ACTIVE-
  // Validierung -- ausschliesslich PrioritizationRule/CrossSellingRule,
  // attributeKey muss zu einer existierenden Campaign des Mandanten
  // gehoeren, Operator auf IS_ANSWERED/IS_NOT_ANSWERED beschraenkt.
  // ---------------------------------------------------------------------

  async function createCampaign(tenantId: string, key: string) {
    const campaignKey = `${key}-${suffix}`;
    await rawClient.campaign.create({
      data: { tenantId, key: campaignKey, name: `Campaign ${key}` },
    });
    return campaignKey;
  }

  it("CAMPAIGN_ACTIVE-Bedingung mit existierender Campaign + IS_ANSWERED -> kein Issue (Happy Path)", async () => {
    const tenantId = await createTenant("campaign-ok");
    const actorUserId = await createUser(tenantId, "actor");
    const campaignKey = await createCampaign(tenantId, "summer-sale");
    const { ruleSetId, versionId } = await createDraftRuleSetVersionRaw(tenantId, "rs");

    const result = await runWithTenantContext(
      { tenantId, userId: actorUserId, roles: [], managementScope: null },
      async () => {
        await addPrioritizationRuleToDraft(ruleSetId, versionId, {
          key: "prio-campaign",
          description: "Test",
          weight: 10,
          commissionRequired: false,
          isActive: true,
          conditions: [
            {
              groupIndex: 0,
              sourceType: "CAMPAIGN_ACTIVE",
              attributeKey: campaignKey,
              operator: "IS_ANSWERED",
              comparisonValue: "",
            },
          ],
        });
        return validateDraftRuleSetVersion(ruleSetId, versionId);
      },
    );
    expect(result).toEqual({ valid: true });
  });

  it("CAMPAIGN_ACTIVE-Bedingung mit unbekanntem Campaign-Key -> Issue", async () => {
    const tenantId = await createTenant("campaign-unknown");
    const actorUserId = await createUser(tenantId, "actor");
    const { ruleSetId, versionId } = await createDraftRuleSetVersionRaw(tenantId, "rs");

    await expect(
      runWithTenantContext(
        { tenantId, userId: actorUserId, roles: [], managementScope: null },
        async () => {
          await addCrossSellingRuleToDraft(ruleSetId, versionId, {
            key: "css-campaign",
            description: "Test",
            needType: "DSL",
            priority: 1,
            reasonCode: "R1",
            isActive: true,
            conditions: [
              {
                groupIndex: 0,
                sourceType: "CAMPAIGN_ACTIVE",
                attributeKey: "voellig-unbekannt",
                operator: "IS_ANSWERED",
                comparisonValue: "",
              },
            ],
          });
          return validateDraftRuleSetVersion(ruleSetId, versionId);
        },
      ),
    ).rejects.toMatchObject({
      issues: expect.arrayContaining([
        expect.stringContaining("zu keiner Campaign dieses Mandanten gehoert"),
      ]),
    });
  });

  it("CAMPAIGN_ACTIVE-Bedingung mit unzulaessigem Operator (EQUALS) -> Issue", async () => {
    const tenantId = await createTenant("campaign-bad-op");
    const actorUserId = await createUser(tenantId, "actor");
    const campaignKey = await createCampaign(tenantId, "winter-sale");
    const { ruleSetId, versionId } = await createDraftRuleSetVersionRaw(tenantId, "rs");

    await expect(
      runWithTenantContext(
        { tenantId, userId: actorUserId, roles: [], managementScope: null },
        async () => {
          await addPrioritizationRuleToDraft(ruleSetId, versionId, {
            key: "prio-campaign-badop",
            description: "Test",
            weight: 10,
            commissionRequired: false,
            isActive: true,
            conditions: [
              {
                groupIndex: 0,
                sourceType: "CAMPAIGN_ACTIVE",
                attributeKey: campaignKey,
                operator: "EQUALS",
                comparisonValue: "true",
              },
            ],
          });
          return validateDraftRuleSetVersion(ruleSetId, versionId);
        },
      ),
    ).rejects.toMatchObject({
      issues: expect.arrayContaining([
        expect.stringContaining("ist fuer CAMPAIGN_ACTIVE-Bedingungen nicht zulaessig"),
      ]),
    });
  });

  it("CAMPAIGN_ACTIVE-Bedingung bei EligibilityRule -> Issue (nur Prioritization/CrossSelling zulaessig)", async () => {
    const tenantId = await createTenant("campaign-wrong-rule");
    const actorUserId = await createUser(tenantId, "actor");
    const campaignKey = await createCampaign(tenantId, "wrong-rule-sale");
    const { ruleSetId, versionId } = await createDraftRuleSetVersionRaw(tenantId, "rs");

    await expect(
      runWithTenantContext(
        { tenantId, userId: actorUserId, roles: [], managementScope: null },
        async () => {
          await addEligibilityRuleToDraft(ruleSetId, versionId, {
            key: "elig-campaign",
            description: "Test",
            isRequired: false,
            fitWeight: 0,
            isActive: true,
            conditions: [
              {
                groupIndex: 0,
                sourceType: "CAMPAIGN_ACTIVE",
                attributeKey: campaignKey,
                operator: "IS_ANSWERED",
                comparisonValue: "",
              },
            ],
          });
          return validateDraftRuleSetVersion(ruleSetId, versionId);
        },
      ),
    ).rejects.toMatchObject({
      issues: expect.arrayContaining([
        expect.stringContaining(
          "ausschliesslich fuer PrioritizationRule/CrossSellingRule vorgesehen",
        ),
      ]),
    });
  });

  it("validateDraftRuleSetVersion() ist rein lesend -- Regel-Zaehler unveraendert nach Aufruf", async () => {
    const tenantId = await createTenant("read-only");
    const actorUserId = await createUser(tenantId, "actor");
    const { ruleSetId, versionId } = await createDraftRuleSetVersionRaw(tenantId, "rs");
    await runWithTenantContext(
      { tenantId, userId: actorUserId, roles: [], managementScope: null },
      () =>
        addEligibilityRuleToDraft(ruleSetId, versionId, {
          key: "elig-1",
          description: "Test",
          isRequired: false,
          fitWeight: 1,
          isActive: true,
          conditions: [],
        }),
    );
    const before = await rawClient.eligibilityRule.count({
      where: { ruleSetVersionId: versionId },
    });
    await runWithTenantContext(
      { tenantId, userId: randomUUID(), roles: [], managementScope: null },
      () => validateDraftRuleSetVersion(ruleSetId, versionId),
    );
    const after = await rawClient.eligibilityRule.count({ where: { ruleSetVersionId: versionId } });
    const versionRow = await rawClient.ruleSetVersion.findUnique({ where: { id: versionId } });
    expect(after).toBe(before);
    expect(versionRow?.status).toBe("DRAFT");
  });

  describe("HTTP-Kette", () => {
    function baseSessionForRoute(tenantId: string) {
      return createSessionToken({
        ...baseSessionPayload(tenantId),
        configPermissions: ["config.rules.edit"],
      });
    }

    it("POST .../validate ohne config.rules.edit -> 403", async () => {
      const tenantId = await createTenant("http-403");
      const { ruleSetId, versionId } = await createDraftRuleSetVersionRaw(tenantId, "rs");
      const token = createSessionToken({
        ...baseSessionPayload(tenantId),
        configPermissions: ["config.rules.view"],
      });
      const response = await validateRoute(
        requestWithCookie(
          `http://localhost/api/admin/rule-sets/${ruleSetId}/versions/${versionId}/validate`,
          token,
        ),
        routeParams({ id: ruleSetId, versionId }),
      );
      expect(response.status).toBe(403);
    });

    it("POST .../validate fuer gueltigen Draft -> 200 {valid: true}", async () => {
      const tenantId = await createTenant("http-200");
      const { ruleSetId, versionId } = await createDraftRuleSetVersionRaw(tenantId, "rs");
      const token = baseSessionForRoute(tenantId);
      const response = await validateRoute(
        requestWithCookie(
          `http://localhost/api/admin/rule-sets/${ruleSetId}/versions/${versionId}/validate`,
          token,
        ),
        routeParams({ id: ruleSetId, versionId }),
      );
      // Leerer Draft -> 422 (keine Regeln), NICHT 200 -- siehe naechster Test
      // fuer den 200-Fall mit tatsaechlichem Inhalt.
      expect(response.status).toBe(422);
      const body = await response.json();
      expect(body.issues).toEqual(
        expect.arrayContaining([expect.stringContaining("enthaelt keine Regeln")]),
      );
    });

    it("POST .../validate fuer Draft mit gueltiger Regel -> 200 {valid: true}", async () => {
      const tenantId = await createTenant("http-200-valid");
      const actorUserId = await createUser(tenantId, "actor");
      const { ruleSetId, versionId } = await createDraftRuleSetVersionRaw(tenantId, "rs");
      await runWithTenantContext(
        { tenantId, userId: actorUserId, roles: [], managementScope: null },
        () =>
          addEligibilityRuleToDraft(ruleSetId, versionId, {
            key: "elig-1",
            description: "Test",
            isRequired: false,
            fitWeight: 1,
            isActive: true,
            conditions: [],
          }),
      );
      const token = baseSessionForRoute(tenantId);
      const response = await validateRoute(
        requestWithCookie(
          `http://localhost/api/admin/rule-sets/${ruleSetId}/versions/${versionId}/validate`,
          token,
        ),
        routeParams({ id: ruleSetId, versionId }),
      );
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body).toEqual({ valid: true });
    });
  });
});
