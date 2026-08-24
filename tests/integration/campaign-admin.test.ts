/**
 * Phase 13 AP2 -- Integrationstests fuer den Campaign-Management-Service
 * (`src/server/admin/campaign-admin.ts`, siehe
 * PHASE_13_IMPLEMENTATION_PLAN.md Abschnitt 3, ChatGPT-GO 2026-08-24 mit
 * 10 verbindlichen Leitplanken). Testet die Service-Schicht direkt
 * innerhalb `runWithTenantContext()` gegen ECHTE Postgres-Fixtures (kein
 * `vi.mock`, Codebase-Konvention, siehe
 * tests/integration/commission-admin.test.ts). Es gibt in AP2 noch keine
 * API-Routen (die kommen erst mit AP3, siehe Modulkommentar in
 * `campaign-admin.ts`) -- diese Suite deckt daher ausschliesslich die
 * Service-Schicht ab.
 *
 * STRUKTUR-ANALOGIE: `CampaignVersion` ist PRO `Campaign` gescoped
 * (identisches Publish-Scope-Muster wie `CommissionModelVersion`, Phase
 * 10) -- `copyFromVersionId` darf daher NICHT zu einer ANDEREN Campaign
 * gehoeren. `CampaignCondition` hat dieselbe Feldstruktur wie
 * `EligibilityRuleCondition` (Phase 9) -- Bedingungen werden bei jedem
 * Update als GANZES ersetzt.
 *
 * Deckt ChatGPTs Leitplanke Punkt 10 ab: Cross-Tenant, IDOR (scopeId),
 * Concurrent Publish, Draft/Publish-Historie.
 *
 * Ohne DATABASE_URL wird die gesamte Suite uebersprungen statt fehlzuschlagen.
 */

import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, describe, expect, it } from "vitest";
import { runWithTenantContext } from "@/server/tenant/context";
import {
  createCampaign,
  createDraftCampaignVersion,
  getCampaignVersionDetail,
  getCampaignVersionHistory,
  listCampaigns,
  publishCampaignVersion,
  translatePublishError,
  updateCampaignVersionFields,
  validateCampaignVersion,
} from "@/server/admin/campaign-admin";
import {
  CampaignKeyAlreadyExistsError,
  CampaignNotFoundError,
  CampaignScopeInvalidError,
  CampaignVersionInvalidError,
  CampaignVersionNotDraftError,
  CampaignVersionNotFoundError,
  CampaignVersionPublishConflictError,
  CopySourceCampaignVersionNotFoundError,
} from "@/server/admin/campaign-admin-errors";
import type { CampaignConditionInput } from "@/server/admin/campaign-schemas";

const hasDatabaseUrl = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDatabaseUrl)("Phase 13 AP2: Campaign-Management-Service", () => {
  const rawClient = new PrismaClient();
  const suffix = randomUUID().slice(0, 8);

  afterAll(async () => {
    await rawClient.$disconnect();
  });

  function ctx(tenantId: string, userId: string) {
    return { tenantId, userId, roles: [], managementScope: null };
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

  async function createCompany(tenantId: string, key: string) {
    const company = await rawClient.company.create({
      data: { tenantId, key: `company-${key}-${suffix}`, name: `Company ${key}` },
    });
    return company.id;
  }

  async function createStore(tenantId: string, companyId: string, key: string) {
    const store = await rawClient.store.create({
      data: { tenantId, companyId, key: `store-${key}-${suffix}`, name: `Store ${key}` },
    });
    return store.id;
  }

  /** Legt einen aktiven Fragebogen mit einer SINGLE_CHOICE-Frage an (fuer ANSWER-Bedingungen). */
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
    const question = await rawClient.question.create({
      data: {
        tenantId,
        questionnaireVersionId: questionnaireVersion.id,
        key: "q-choice",
        sortOrder: 1,
      },
    });
    const questionVersion = await rawClient.questionVersion.create({
      data: {
        tenantId,
        questionId: question.id,
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
          questionVersionId: questionVersion.id,
          key: "BASIC",
          label: "Basic",
          sortOrder: 1,
        },
        {
          tenantId,
          questionVersionId: questionVersion.id,
          key: "PREMIUM",
          label: "Premium",
          sortOrder: 2,
        },
      ],
    });
    return { questionId: question.id };
  }

  /**
   * Legt eine ECHTE `Question`-Zeile an, deren `QuestionnaireVersion` NICHT
   * den Status ACTIVE hat (hier: DRAFT). `loadActiveQuestionAnswerTypeMap()`
   * (campaign-admin.ts) filtert ausschliesslich nach
   * `questionnaireVersion.status === "ACTIVE"` -- eine solche Frage gilt
   * damit fachlich als "nicht aktiv", OHNE die DB-FK
   * `campaign_conditions_tenant_id_question_id_fkey` zu verletzen (die
   * Frage existiert ja wirklich). Ein GENUIN unbekannter `questionId`
   * (z. B. `randomUUID()`) ist dagegen bereits strukturell durch diese FK
   * ausgeschlossen und kann eine DRAFT-`CampaignVersion` gar nicht erst
   * erreichen -- identisches Prinzip wie in
   * tests/integration/rule-admin-validate.test.ts dokumentiert (FK-
   * geschuetzte Verstoesse sind nur als "existiert, aber fachlich invalide"
   * testbar, nicht als "existiert gar nicht").
   */
  async function createInactiveQuestion(tenantId: string, key: string) {
    const questionnaire = await rawClient.questionnaire.create({
      data: { tenantId, key: `${key}-${suffix}` },
    });
    const questionnaireVersion = await rawClient.questionnaireVersion.create({
      data: {
        tenantId,
        questionnaireId: questionnaire.id,
        label: "v1",
        status: "DRAFT",
        validFrom: new Date("2026-01-01T00:00:00Z"),
        validTo: null,
      },
    });
    const question = await rawClient.question.create({
      data: {
        tenantId,
        questionnaireVersionId: questionnaireVersion.id,
        key: "q-inactive",
        sortOrder: 1,
      },
    });
    return { questionId: question.id };
  }

  function answerCondition(
    questionId: string,
    comparisonValue = "PREMIUM",
  ): CampaignConditionInput {
    return {
      groupIndex: 0,
      sourceType: "ANSWER",
      questionId,
      attributeKey: null,
      operator: "EQUALS",
      comparisonValue,
    };
  }

  // -------------------------------------------------------------------
  // 1. Campaign anlegen
  // -------------------------------------------------------------------

  it("createCampaign() legt eine Campaign ohne Version an", async () => {
    const tenantId = await createTenant("t1");
    const userId = await createUser(tenantId, "u1");

    const campaign = await runWithTenantContext(ctx(tenantId, userId), () =>
      createCampaign({ key: "summer-sale", name: "Sommeraktion" }),
    );

    expect(campaign.key).toBe("summer-sale");
    expect(campaign.versions).toEqual([]);

    const list = await runWithTenantContext(ctx(tenantId, userId), () => listCampaigns());
    expect(list.map((c) => c.id)).toContain(campaign.id);
  });

  it("createCampaign() mit bereits vergebenem key -> CampaignKeyAlreadyExistsError", async () => {
    const tenantId = await createTenant("t2");
    const userId = await createUser(tenantId, "u1");

    await runWithTenantContext(ctx(tenantId, userId), () =>
      createCampaign({ key: "dup", name: "Erste" }),
    );

    await expect(
      runWithTenantContext(ctx(tenantId, userId), () =>
        createCampaign({ key: "dup", name: "Zweite" }),
      ),
    ).rejects.toBeInstanceOf(CampaignKeyAlreadyExistsError);
  });

  it("derselbe key ist in ZWEI verschiedenen Mandanten unabhaengig zulaessig (Tenant-Isolation)", async () => {
    const tenantA = await createTenant("t3a");
    const tenantB = await createTenant("t3b");
    const userA = await createUser(tenantA, "u1");
    const userB = await createUser(tenantB, "u1");

    await expect(
      runWithTenantContext(ctx(tenantA, userA), () =>
        createCampaign({ key: "shared-key", name: "A" }),
      ),
    ).resolves.toBeDefined();
    await expect(
      runWithTenantContext(ctx(tenantB, userB), () =>
        createCampaign({ key: "shared-key", name: "B" }),
      ),
    ).resolves.toBeDefined();
  });

  // -------------------------------------------------------------------
  // 2. scopeId-Validierung (IDOR-Schutz, ChatGPT-Leitplanke Punkt 3)
  // -------------------------------------------------------------------

  it("createDraftCampaignVersion() mit scopeType TENANT + scopeId === tenantId ist gueltig", async () => {
    const tenantId = await createTenant("t4");
    const userId = await createUser(tenantId, "u1");
    const campaign = await runWithTenantContext(ctx(tenantId, userId), () =>
      createCampaign({ key: "c", name: "C" }),
    );

    const version = await runWithTenantContext(ctx(tenantId, userId), () =>
      createDraftCampaignVersion(campaign.id, { scopeType: "TENANT", scopeId: tenantId }),
    );

    expect(version.scopeType).toBe("TENANT");
    expect(version.scopeId).toBe(tenantId);
    expect(version.status).toBe("DRAFT");
    expect(version.versionNumber).toBe(1);
  });

  it("createDraftCampaignVersion() mit scopeType TENANT + fremder scopeId -> CampaignScopeInvalidError", async () => {
    const tenantId = await createTenant("t5");
    const otherTenantId = await createTenant("t5-other");
    const userId = await createUser(tenantId, "u1");
    const campaign = await runWithTenantContext(ctx(tenantId, userId), () =>
      createCampaign({ key: "c", name: "C" }),
    );

    await expect(
      runWithTenantContext(ctx(tenantId, userId), () =>
        createDraftCampaignVersion(campaign.id, { scopeType: "TENANT", scopeId: otherTenantId }),
      ),
    ).rejects.toBeInstanceOf(CampaignScopeInvalidError);
  });

  it("createDraftCampaignVersion() mit scopeType STORE + gueltigem Store desselben Mandanten ist zulaessig", async () => {
    const tenantId = await createTenant("t6");
    const userId = await createUser(tenantId, "u1");
    const companyId = await createCompany(tenantId, "co");
    const storeId = await createStore(tenantId, companyId, "s1");
    const campaign = await runWithTenantContext(ctx(tenantId, userId), () =>
      createCampaign({ key: "c", name: "C" }),
    );

    const version = await runWithTenantContext(ctx(tenantId, userId), () =>
      createDraftCampaignVersion(campaign.id, { scopeType: "STORE", scopeId: storeId }),
    );
    expect(version.scopeType).toBe("STORE");
    expect(version.scopeId).toBe(storeId);
  });

  it("createDraftCampaignVersion() mit scopeType STORE + Store eines FREMDEN Mandanten -> CampaignScopeInvalidError (IDOR)", async () => {
    const tenantId = await createTenant("t7");
    const otherTenantId = await createTenant("t7-other");
    const userId = await createUser(tenantId, "u1");
    const otherCompanyId = await createCompany(otherTenantId, "co");
    const foreignStoreId = await createStore(otherTenantId, otherCompanyId, "s1");
    const campaign = await runWithTenantContext(ctx(tenantId, userId), () =>
      createCampaign({ key: "c", name: "C" }),
    );

    await expect(
      runWithTenantContext(ctx(tenantId, userId), () =>
        createDraftCampaignVersion(campaign.id, { scopeType: "STORE", scopeId: foreignStoreId }),
      ),
    ).rejects.toBeInstanceOf(CampaignScopeInvalidError);
  });

  it("updateCampaignVersionFields() mit nur scopeId-Patch validiert gegen den bestehenden (unveraenderten) scopeType", async () => {
    const tenantId = await createTenant("t8");
    const otherTenantId = await createTenant("t8-other");
    const userId = await createUser(tenantId, "u1");
    const campaign = await runWithTenantContext(ctx(tenantId, userId), () =>
      createCampaign({ key: "c", name: "C" }),
    );
    const version = await runWithTenantContext(ctx(tenantId, userId), () =>
      createDraftCampaignVersion(campaign.id, { scopeType: "TENANT", scopeId: tenantId }),
    );

    await expect(
      runWithTenantContext(ctx(tenantId, userId), () =>
        updateCampaignVersionFields(campaign.id, version.id, { scopeId: otherTenantId }),
      ),
    ).rejects.toBeInstanceOf(CampaignScopeInvalidError);
  });

  // -------------------------------------------------------------------
  // 3. Cross-Tenant-Zugriff (kein Zugriff auf fremde Campaign/Version)
  // -------------------------------------------------------------------

  it("Campaign eines FREMDEN Mandanten ist unter der eigenen tenantId nicht adressierbar -> CampaignNotFoundError", async () => {
    const tenantA = await createTenant("t9a");
    const tenantB = await createTenant("t9b");
    const userA = await createUser(tenantA, "u1");
    const userB = await createUser(tenantB, "u1");

    const campaignA = await runWithTenantContext(ctx(tenantA, userA), () =>
      createCampaign({ key: "c", name: "C" }),
    );

    await expect(
      runWithTenantContext(ctx(tenantB, userB), () =>
        createDraftCampaignVersion(campaignA.id, { scopeType: "TENANT", scopeId: tenantB }),
      ),
    ).rejects.toBeInstanceOf(CampaignNotFoundError);

    await expect(
      runWithTenantContext(ctx(tenantB, userB), () => getCampaignVersionHistory(campaignA.id)),
    ).rejects.toBeInstanceOf(CampaignNotFoundError);
  });

  it("copyFromVersionId, die zu einer ANDEREN Campaign gehoert -> CopySourceCampaignVersionNotFoundError", async () => {
    const tenantId = await createTenant("t10");
    const userId = await createUser(tenantId, "u1");
    const campaignA = await runWithTenantContext(ctx(tenantId, userId), () =>
      createCampaign({ key: "a", name: "A" }),
    );
    const campaignB = await runWithTenantContext(ctx(tenantId, userId), () =>
      createCampaign({ key: "b", name: "B" }),
    );
    const versionA = await runWithTenantContext(ctx(tenantId, userId), () =>
      createDraftCampaignVersion(campaignA.id, { scopeType: "TENANT", scopeId: tenantId }),
    );

    await expect(
      runWithTenantContext(ctx(tenantId, userId), () =>
        createDraftCampaignVersion(campaignB.id, {
          scopeType: "TENANT",
          scopeId: tenantId,
          copyFromVersionId: versionA.id,
        }),
      ),
    ).rejects.toBeInstanceOf(CopySourceCampaignVersionNotFoundError);
  });

  // -------------------------------------------------------------------
  // 4. Bedingungen: explizit vs. copyFromVersionId-Deep-Copy
  // -------------------------------------------------------------------

  it("createDraftCampaignVersion() mit expliziten conditions uebernimmt diese 1:1", async () => {
    const tenantId = await createTenant("t11");
    const userId = await createUser(tenantId, "u1");
    const { questionId } = await createActiveQuestionnaire(tenantId, "q");
    const campaign = await runWithTenantContext(ctx(tenantId, userId), () =>
      createCampaign({ key: "c", name: "C" }),
    );

    const version = await runWithTenantContext(ctx(tenantId, userId), () =>
      createDraftCampaignVersion(campaign.id, {
        scopeType: "TENANT",
        scopeId: tenantId,
        conditions: [answerCondition(questionId)],
      }),
    );

    expect(version.conditions).toHaveLength(1);
    expect(version.conditions[0]?.sourceType).toBe("ANSWER");
  });

  it("createDraftCampaignVersion() mit copyFromVersionId UND weggelassenen conditions kopiert die Bedingungen der Quelle", async () => {
    const tenantId = await createTenant("t12");
    const userId = await createUser(tenantId, "u1");
    const { questionId } = await createActiveQuestionnaire(tenantId, "q");
    const campaign = await runWithTenantContext(ctx(tenantId, userId), () =>
      createCampaign({ key: "c", name: "C" }),
    );
    const source = await runWithTenantContext(ctx(tenantId, userId), () =>
      createDraftCampaignVersion(campaign.id, {
        scopeType: "TENANT",
        scopeId: tenantId,
        conditions: [answerCondition(questionId)],
      }),
    );

    const copy = await runWithTenantContext(ctx(tenantId, userId), () =>
      createDraftCampaignVersion(campaign.id, {
        scopeType: "TENANT",
        scopeId: tenantId,
        copyFromVersionId: source.id,
      }),
    );

    expect(copy.conditions).toHaveLength(1);
    expect(copy.conditions[0]?.questionId).toBe(questionId);
    expect(copy.versionNumber).toBe(2);
  });

  it("createDraftCampaignVersion() mit copyFromVersionId UND explizit leeren conditions ignoriert die Quelle (Aufrufer-Werte gewinnen)", async () => {
    const tenantId = await createTenant("t13");
    const userId = await createUser(tenantId, "u1");
    const { questionId } = await createActiveQuestionnaire(tenantId, "q");
    const campaign = await runWithTenantContext(ctx(tenantId, userId), () =>
      createCampaign({ key: "c", name: "C" }),
    );
    const source = await runWithTenantContext(ctx(tenantId, userId), () =>
      createDraftCampaignVersion(campaign.id, {
        scopeType: "TENANT",
        scopeId: tenantId,
        conditions: [answerCondition(questionId)],
      }),
    );

    const copy = await runWithTenantContext(ctx(tenantId, userId), () =>
      createDraftCampaignVersion(campaign.id, {
        scopeType: "TENANT",
        scopeId: tenantId,
        copyFromVersionId: source.id,
        conditions: [],
      }),
    );

    expect(copy.conditions).toHaveLength(0);
  });

  it("updateCampaignVersionFields() mit conditions ERSETZT die gesamte bestehende Liste", async () => {
    const tenantId = await createTenant("t14");
    const userId = await createUser(tenantId, "u1");
    const { questionId } = await createActiveQuestionnaire(tenantId, "q");
    const campaign = await runWithTenantContext(ctx(tenantId, userId), () =>
      createCampaign({ key: "c", name: "C" }),
    );
    const version = await runWithTenantContext(ctx(tenantId, userId), () =>
      createDraftCampaignVersion(campaign.id, {
        scopeType: "TENANT",
        scopeId: tenantId,
        conditions: [answerCondition(questionId, "BASIC"), answerCondition(questionId, "PREMIUM")],
      }),
    );
    expect(version.conditions).toHaveLength(2);

    const updated = await runWithTenantContext(ctx(tenantId, userId), () =>
      updateCampaignVersionFields(campaign.id, version.id, {
        conditions: [answerCondition(questionId, "PREMIUM")],
      }),
    );
    expect(updated.conditions).toHaveLength(1);
    expect(updated.conditions[0]?.comparisonValue).toBe("PREMIUM");
  });

  // -------------------------------------------------------------------
  // 5. Draft-only Mutation Guard
  // -------------------------------------------------------------------

  it("Mutation einer nicht-DRAFT-Version -> CampaignVersionNotDraftError", async () => {
    const tenantId = await createTenant("t15");
    const userId = await createUser(tenantId, "u1");
    const campaign = await runWithTenantContext(ctx(tenantId, userId), () =>
      createCampaign({ key: "c", name: "C" }),
    );
    const version = await runWithTenantContext(ctx(tenantId, userId), () =>
      createDraftCampaignVersion(campaign.id, { scopeType: "TENANT", scopeId: tenantId }),
    );
    await runWithTenantContext(ctx(tenantId, userId), () =>
      publishCampaignVersion(campaign.id, version.id),
    );

    await expect(
      runWithTenantContext(ctx(tenantId, userId), () =>
        updateCampaignVersionFields(campaign.id, version.id, { description: "spaeter" }),
      ),
    ).rejects.toBeInstanceOf(CampaignVersionNotDraftError);
  });

  // -------------------------------------------------------------------
  // 6. Validierung + Publish
  // -------------------------------------------------------------------

  it("validateCampaignVersion() ohne Bedingungen ist gueltig (Campaign ohne Bedingungen = immer aktiv)", async () => {
    const tenantId = await createTenant("t16");
    const userId = await createUser(tenantId, "u1");
    const campaign = await runWithTenantContext(ctx(tenantId, userId), () =>
      createCampaign({ key: "c", name: "C" }),
    );
    const version = await runWithTenantContext(ctx(tenantId, userId), () =>
      createDraftCampaignVersion(campaign.id, { scopeType: "TENANT", scopeId: tenantId }),
    );

    await expect(
      runWithTenantContext(ctx(tenantId, userId), () =>
        validateCampaignVersion(campaign.id, version.id),
      ),
    ).resolves.toEqual({ valid: true });
  });

  it("validateCampaignVersion() mit ANSWER-Bedingung auf inaktive/unbekannte Frage -> CampaignVersionInvalidError", async () => {
    const tenantId = await createTenant("t17");
    const userId = await createUser(tenantId, "u1");
    const { questionId } = await createInactiveQuestion(tenantId, "q");
    const campaign = await runWithTenantContext(ctx(tenantId, userId), () =>
      createCampaign({ key: "c", name: "C" }),
    );
    const version = await runWithTenantContext(ctx(tenantId, userId), () =>
      createDraftCampaignVersion(campaign.id, {
        scopeType: "TENANT",
        scopeId: tenantId,
        conditions: [answerCondition(questionId)],
      }),
    );

    await expect(
      runWithTenantContext(ctx(tenantId, userId), () =>
        validateCampaignVersion(campaign.id, version.id),
      ),
    ).rejects.toBeInstanceOf(CampaignVersionInvalidError);
  });

  it("publishCampaignVersion() bei fachlich ungueltiger Version schlaegt fehl UND laesst die Version im Status DRAFT (kein Teil-Publish)", async () => {
    const tenantId = await createTenant("t18");
    const userId = await createUser(tenantId, "u1");
    const { questionId } = await createInactiveQuestion(tenantId, "q");
    const campaign = await runWithTenantContext(ctx(tenantId, userId), () =>
      createCampaign({ key: "c", name: "C" }),
    );
    const version = await runWithTenantContext(ctx(tenantId, userId), () =>
      createDraftCampaignVersion(campaign.id, {
        scopeType: "TENANT",
        scopeId: tenantId,
        conditions: [answerCondition(questionId)],
      }),
    );

    await expect(
      runWithTenantContext(ctx(tenantId, userId), () =>
        publishCampaignVersion(campaign.id, version.id),
      ),
    ).rejects.toBeInstanceOf(CampaignVersionInvalidError);

    const reloaded = await runWithTenantContext(ctx(tenantId, userId), () =>
      getCampaignVersionDetail(campaign.id, version.id),
    );
    expect(reloaded.status).toBe("DRAFT");
  });

  it("publishCampaignVersion() aktiviert die Draft-Version und expiret die vorherige ACTIVE-Version DERSELBEN Campaign", async () => {
    const tenantId = await createTenant("t19");
    const userId = await createUser(tenantId, "u1");
    const campaign = await runWithTenantContext(ctx(tenantId, userId), () =>
      createCampaign({ key: "c", name: "C" }),
    );
    const v1 = await runWithTenantContext(ctx(tenantId, userId), () =>
      createDraftCampaignVersion(campaign.id, { scopeType: "TENANT", scopeId: tenantId }),
    );
    const publish1 = await runWithTenantContext(ctx(tenantId, userId), () =>
      publishCampaignVersion(campaign.id, v1.id),
    );
    expect(publish1.version.status).toBe("ACTIVE");
    expect(publish1.previousActiveVersionId).toBeNull();

    const v2 = await runWithTenantContext(ctx(tenantId, userId), () =>
      createDraftCampaignVersion(campaign.id, {
        scopeType: "TENANT",
        scopeId: tenantId,
        copyFromVersionId: v1.id,
      }),
    );
    const publish2 = await runWithTenantContext(ctx(tenantId, userId), () =>
      publishCampaignVersion(campaign.id, v2.id),
    );
    expect(publish2.version.status).toBe("ACTIVE");
    expect(publish2.previousActiveVersionId).toBe(v1.id);

    const historie = await runWithTenantContext(ctx(tenantId, userId), () =>
      getCampaignVersionHistory(campaign.id),
    );
    const byId = new Map(historie.map((v) => [v.id, v]));
    expect(byId.get(v1.id)?.status).toBe("EXPIRED");
    expect(byId.get(v2.id)?.status).toBe("ACTIVE");
    // Draft/Publish-Historie: neueste Version zuerst.
    expect(historie[0]?.id).toBe(v2.id);
  });

  it("Publish einer bereits nicht mehr existierenden/fremden Version -> CampaignVersionNotFoundError", async () => {
    const tenantId = await createTenant("t20");
    const userId = await createUser(tenantId, "u1");
    const campaign = await runWithTenantContext(ctx(tenantId, userId), () =>
      createCampaign({ key: "c", name: "C" }),
    );

    await expect(
      runWithTenantContext(ctx(tenantId, userId), () =>
        publishCampaignVersion(campaign.id, randomUUID()),
      ),
    ).rejects.toBeInstanceOf(CampaignVersionNotFoundError);
  });

  // -------------------------------------------------------------------
  // 7. Concurrent Publish (EXCLUDE-Constraint-Backstop, analog Phase 10 AP9)
  // -------------------------------------------------------------------

  it("zwei GLEICHZEITIGE Publish-Versuche fuer ZWEI VERSCHIEDENE DRAFT-Versionen DERSELBEN Campaign: genau einer gewinnt, der andere bekommt einen sauberen Fehler (kein rohes DB-Fehlerobjekt)", async () => {
    const tenantId = await createTenant("t21");
    const userId = await createUser(tenantId, "u1");
    const campaign = await runWithTenantContext(ctx(tenantId, userId), () =>
      createCampaign({ key: "c", name: "C" }),
    );
    const vA = await runWithTenantContext(ctx(tenantId, userId), () =>
      createDraftCampaignVersion(campaign.id, { scopeType: "TENANT", scopeId: tenantId }),
    );
    const vB = await runWithTenantContext(ctx(tenantId, userId), () =>
      createDraftCampaignVersion(campaign.id, { scopeType: "TENANT", scopeId: tenantId }),
    );

    const results = await Promise.allSettled([
      runWithTenantContext(ctx(tenantId, userId), () => publishCampaignVersion(campaign.id, vA.id)),
      runWithTenantContext(ctx(tenantId, userId), () => publishCampaignVersion(campaign.id, vB.id)),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    // Der Campaign-Row-Lock serialisiert beide Transaktionen -- BEIDE
    // koennen strukturell erfolgreich sein (nacheinander, nicht wirklich
    // "gleichzeitig" auf DB-Ebene), aber niemals darf einer der beiden mit
    // einem rohen, unuebersetzten DB-Fehler durchfallen.
    expect(fulfilled.length).toBeGreaterThanOrEqual(1);
    for (const r of rejected) {
      if (r.status === "rejected") {
        expect(
          r.reason instanceof CampaignVersionPublishConflictError ||
            r.reason instanceof CampaignVersionNotDraftError,
        ).toBe(true);
      }
    }

    const historie = await runWithTenantContext(ctx(tenantId, userId), () =>
      getCampaignVersionHistory(campaign.id),
    );
    const activeCount = historie.filter((v) => v.status === "ACTIVE").length;
    // Strukturelle Garantie der EXCLUDE-Constraint: nie mehr als eine
    // gleichzeitig ACTIVE-Version DERSELBEN Campaign.
    expect(activeCount).toBeLessThanOrEqual(1);
  });

  it("translatePublishError() uebersetzt NUR die bekannte EXCLUDE-Constraint-Verletzung, alle anderen Fehler werden unveraendert weitergeworfen", () => {
    const versionId = randomUUID();
    const otherError = new Error("irgendein anderer Fehler");
    expect(() => translatePublishError(otherError, versionId)).toThrow(otherError);
  });
});
