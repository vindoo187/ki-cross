/**
 * Dediziertes Seed-Skript AUSSCHLIESSLICH fuer die Playwright-E2E-Suite
 * (AP12d, siehe ChatGPTs Projektleiter-Entscheidung "Vorgehen akzeptiert -
 * bedingtes GO" vom 2026-08-03, Punkt "kontrollierte, reproduzierbare
 * Testdaten ohne Abhaengigkeit von manuell gepflegten Bestaenden" +
 * "Tenant-Isolation ... durch einen negativen Zugriffstest abgesichert").
 *
 * Bewusst GETRENNT von `prisma/seed.ts` (Tenants "demotel-nord"/
 * "demotel-sued", genutzt fuer manuelle Demo-/Review-Zwecke): die E2E-Suite
 * soll nicht von Aenderungen an diesen Demo-Daten abhaengen oder sie
 * beeinflussen. Erzeugt AUSSCHLIESSLICH synthetische Daten
 * (isSynthetic = true ueberall, wie in `prisma/seed.ts`).
 *
 * Erzeugt ZWEI Tenants:
 * - "e2e-tenant-a": der Haupt-Testmandant fuer alle E2E-Fluesse
 *   (Happy Path, Abbruch, drei Kundensituationen). Enthaelt einen
 *   Fragebogen mit ZWEI Sichtbarkeits-Bedingungen (siehe unten), die
 *   zusammen mindestens drei nachweislich unterschiedliche sichtbare
 *   Fragenpfade erzeugen.
 * - "e2e-tenant-b": ein zweiter, unabhaengiger Mandant NUR fuer den
 *   negativen Tenant-Isolationstest (tests/e2e/tenant-isolation.spec.ts) -
 *   enthaelt eine bereits abgeschlossene Beratungssitzung, auf die eine bei
 *   Tenant A angemeldete Sitzung NICHT zugreifen darf.
 *
 * Sichtbarkeits-Branching fuer Tenant A (Questionnaire "e2e-basisberatung"):
 *   Q1 e2e_streaming_bedarf     (BOOLEAN, Pflicht)
 *   Q2 e2e_tarif_typ            (SINGLE_CHOICE, Pflicht: prepaid/vertrag/family)
 *   Q3 e2e_streaming_paket      (SINGLE_CHOICE, sichtbar NUR wenn Q1 = true)
 *   Q4 e2e_familienmitglieder   (INTEGER, sichtbar NUR wenn Q2 = family)
 *
 *   Situation "privat_prepaid_ohne_streaming": Q1=false, Q2=prepaid
 *     -> sichtbare Fragen: {Q1, Q2}                         (2 Fragen)
 *   Situation "vertrag_mit_streaming": Q1=true, Q2=vertrag
 *     -> sichtbare Fragen: {Q1, Q2, Q3}                     (3 Fragen, Q3 statt Q4)
 *   Situation "family_ohne_streaming": Q1=false, Q2=family
 *     -> sichtbare Fragen: {Q1, Q2, Q4}                     (3 Fragen, Q4 statt Q3)
 *
 * NICHT idempotent (analog zur bereits dokumentierten Einschraenkung der
 * Phase-3B-Ergaenzungen in `prisma/seed.ts`): ein zweiter Lauf gegen
 * dieselbe, bereits befuellte Datenbank wuerde Duplikate anlegen. Das
 * Skript bricht daher kontrolliert ab, falls Tenant "e2e-tenant-a" bereits
 * existiert (siehe Guard unten). In CI ist das unkritisch, da dort pro Lauf
 * eine frische Postgres-Service-Instanz verwendet wird.
 */

import { writeFileSync } from "node:fs";
import path from "node:path";
import { PrismaClient, ProductType, CommissionType, AnswerType, NeedType } from "@prisma/client";
import { hashPassword } from "../src/server/auth/password";
import { permissionKeysForSeedRole } from "../src/server/authz/seed-role-permissions";

const prisma = new PrismaClient();

// Phase 9 AP9 (E2E-Erweiterung fuer /admin/rules, ChatGPT-Vorgabe
// 2026-08-18): synthetisches, klar als Test gekennzeichnetes Passwort fuer
// die beiden Admin-Testnutzer unten -- analog prisma/seed.ts
// (adminTestPassword), NICHT produktionsreif, siehe src/server/auth/errors.ts.
const E2E_ADMIN_PASSWORD = "synthetic-e2e-admin-test-passwort-2026";

// Wird nach jedem Lauf ueberschrieben (siehe .gitignore) und von
// tests/e2e/seed-output.ts eingelesen: die Playwright-Spec-Dateien laufen in
// einem eigenen Prozess und kennen daher die zur Seed-Zeit generierten UUIDs
// (insb. tenantB.consultationSessionId fuer tests/e2e/tenant-isolation.spec.ts)
// nicht anders als ueber diese Datei oder eine erneute DB-Abfrage.
const SEED_OUTPUT_PATH = path.join(__dirname, "..", "tests", "e2e", ".e2e-seed-output.json");

const VALID_FROM = new Date("2026-01-01T00:00:00Z");

async function seedGlobalCatalog() {
  const provider = await prisma.provider.upsert({
    where: { key: "o2-telefonica" },
    update: {},
    create: { key: "o2-telefonica", name: "O2 / Telefonica (synthetisch)", isSynthetic: true },
  });

  // Phase 9 AP9 + Phase 10 AP9 + Phase 11 AP9: nur die Regel-, Provisions-
  // modell- und Ziele-Administrations-Permissions werden fuer diese
  // E2E-Suiten benoetigt (die Fragenverwaltung ist nicht Teil des
  // /admin/rules- bzw. /admin/commissions-/admin/goals-E2E-Umfangs) --
  // bewusst minimal, kein voller config.questions.*-Katalog wie in
  // prisma/seed.ts. `config.goals.*` hat -- anders als die anderen drei
  // Gruppen -- KEIN `.publish`-Recht (Goal kennt kein Draft/Publish-
  // Konzept, siehe goal-admin.ts-Modulkommentar); config_editor/
  // config_publisher erhalten beide config.goals.view+edit automatisch ueber
  // permissionKeysForSeedRole() (Phase 11 AP1, ChatGPT finales GO
  // 2026-08-22), siehe tests/e2e/admin-goals.spec.ts (Phase 11 AP9).
  const rulePermissionKeys = [
    "config.rules.view",
    "config.rules.edit",
    "config.rules.publish",
    "config.commissions.view",
    "config.commissions.edit",
    "config.commissions.publish",
    "config.goals.view",
    "config.goals.edit",
    // Phase 13 AP8 (E2E-Suite fuer /admin/campaigns): analog den anderen
    // drei Gruppen erhalten config_editor/config_publisher config.campaigns.*
    // automatisch ueber permissionKeysForSeedRole() (Phase 13 AP1, siehe
    // dortigen Modulkommentar) -- hier nur der Permission-Katalog-Eintrag.
    "config.campaigns.view",
    "config.campaigns.edit",
    "config.campaigns.publish",
  ];
  const permissions = await Promise.all(
    rulePermissionKeys.map((key) =>
      prisma.permission.upsert({
        where: { key },
        update: {},
        create: { key, description: `Berechtigung: ${key}` },
      }),
    ),
  );

  return { provider, permissions };
}

interface TenantBase {
  tenantId: string;
  companyId: string;
  storeId: string;
  userId: string;
  employeeId: string;
  displayName: string;
}

async function seedTenantShell(config: {
  key: string;
  name: string;
  companyKey: string;
  companyName: string;
  storeKey: string;
  employeeDisplayName: string;
}): Promise<TenantBase> {
  const tenant = await prisma.tenant.create({
    data: { key: config.key, name: config.name, isSynthetic: true },
  });
  const company = await prisma.company.create({
    data: { tenantId: tenant.id, key: config.companyKey, name: config.companyName },
  });
  const store = await prisma.store.create({
    data: {
      tenantId: tenant.id,
      companyId: company.id,
      key: config.storeKey,
      name: `${config.companyName} Filiale E2E`,
    },
  });
  const user = await prisma.user.create({
    data: {
      tenantId: tenant.id,
      email: `${config.key}-mitarbeiter@example-synthetic.test`,
      isSynthetic: true,
    },
  });
  const employee = await prisma.employee.create({
    data: {
      tenantId: tenant.id,
      storeId: store.id,
      userId: user.id,
      displayName: config.employeeDisplayName,
    },
  });

  return {
    tenantId: tenant.id,
    companyId: company.id,
    storeId: store.id,
    userId: user.id,
    employeeId: employee.id,
    displayName: employee.displayName,
  };
}

async function seedTenantA(
  providerId: string,
  permissions: Awaited<ReturnType<typeof seedGlobalCatalog>>["permissions"],
) {
  const base = await seedTenantShell({
    key: "e2e-tenant-a",
    name: "E2E TestTel A (synthetisch)",
    companyKey: "e2e-company-a",
    companyName: "E2E TestTel A GmbH",
    storeKey: "e2e-store-a",
    employeeDisplayName: "E2E Testperson A (e2e-tenant-a)",
  });
  const tenantId = base.tenantId;

  // --- Produkt (ein Tarif genuegt fuer die E2E-Zwecke: Eligibility +
  // Cross-Selling nachweisbar, keine Prioritization-/Exclusion-Vielfalt
  // noetig, da nicht Teil von ChatGPTs AP12d-Pflichtumfang). ---
  const category = await prisma.productCategory.create({
    data: { tenantId, key: "mobilfunk", name: "Mobilfunk" },
  });
  const product = await prisma.product.create({
    data: {
      tenantId,
      providerId,
      categoryId: category.id,
      productType: ProductType.MOBILE_NEW_CONTRACT,
      name: "E2E TestTel Mobil M (synthetisch)",
      isSynthetic: true,
    },
  });
  const productVersion = await prisma.productVersion.create({
    data: {
      tenantId,
      productId: product.id,
      versionNumber: 1,
      status: "ACTIVE",
      validFrom: VALID_FROM,
      currency: "EUR",
      monthlyPriceMinor: 2999,
      oneTimePriceMinor: 0,
      contractMonths: 24,
    },
  });
  await prisma.tariffAttribute.createMany({
    data: [
      {
        tenantId,
        productVersionId: productVersion.id,
        attributeKey: "dataVolumeGb",
        attributeValue: "20",
        valueType: "number",
      },
      {
        tenantId,
        productVersionId: productVersion.id,
        attributeKey: "pricePlanTier",
        attributeValue: "STANDARD",
        valueType: "string",
      },
      {
        tenantId,
        productVersionId: productVersion.id,
        attributeKey: "hasEuRoaming",
        attributeValue: "true",
        valueType: "boolean",
      },
      {
        tenantId,
        productVersionId: productVersion.id,
        attributeKey: "contractCommitmentMonths",
        attributeValue: "24",
        valueType: "number",
      },
    ],
  });
  const commissionModel = await prisma.commissionModel.create({
    data: { tenantId, productId: product.id, name: "E2E Standardprovision Mobil M" },
  });
  const commissionModelVersion = await prisma.commissionModelVersion.create({
    data: {
      tenantId,
      commissionModelId: commissionModel.id,
      versionNumber: 1,
      status: "ACTIVE",
      validFrom: VALID_FROM,
      commissionType: CommissionType.FLAT,
      currency: "EUR",
      commissionAmountMinor: 3000,
      recurringCommissionAmountMinor: 100,
    },
  });

  // Phase 10 AP9: ZWEITES CommissionModel fuer denselben Tenant/dasselbe
  // Produkt -- dient dem E2E-Test "Publish ersetzt nur DIESES
  // CommissionModel, ein anderes Modell desselben Mandanten bleibt
  // unveraendert" (Kardinalitaets-Tie-Breaker aus AP2 erlaubt mehrere
  // CommissionModels pro Produkt, siehe commission.ts).
  const commissionModelSecondary = await prisma.commissionModel.create({
    data: { tenantId, productId: product.id, name: "E2E Zweitprovision Mobil M" },
  });
  await prisma.commissionModelVersion.create({
    data: {
      tenantId,
      commissionModelId: commissionModelSecondary.id,
      versionNumber: 1,
      status: "ACTIVE",
      validFrom: VALID_FROM,
      commissionType: CommissionType.FLAT,
      currency: "EUR",
      commissionAmountMinor: 4200,
    },
  });

  // Phase 13 AP8: Campaign + eine ACTIVE, TENANT-gescopte CampaignVersion
  // fuer die /admin/campaigns-E2E-Suite (tests/e2e/admin-campaigns.spec.ts) --
  // analog dem CommissionModel-Fixture oben, dient als Ausgangspunkt fuer
  // den "Neuen Entwurf erstellen"-Fluss.
  const campaign = await prisma.campaign.create({
    data: { tenantId, key: "e2e-sommeraktion", name: "E2E Sommeraktion" },
  });
  const campaignVersion = await prisma.campaignVersion.create({
    data: {
      tenantId,
      campaignId: campaign.id,
      versionNumber: 1,
      status: "ACTIVE",
      scopeType: "TENANT",
      scopeId: tenantId,
      validFrom: VALID_FROM,
      validTo: null,
    },
  });

  await prisma.configurableThreshold.create({
    data: {
      tenantId,
      key: "renewal_lookahead_days",
      value: "180",
      validFrom: VALID_FROM,
    },
  });

  // --- Fragebogen mit zwei unabhaengigen Sichtbarkeits-Bedingungen (siehe
  // Modulkommentar oben fuer die drei daraus resultierenden Pfade). ---
  const questionnaire = await prisma.questionnaire.create({
    data: { tenantId, key: "e2e-basisberatung" },
  });
  const questionnaireVersion = await prisma.questionnaireVersion.create({
    data: {
      tenantId,
      questionnaireId: questionnaire.id,
      label: "E2E Basisberatung v1",
      validFrom: VALID_FROM,
      status: "ACTIVE",
    },
  });

  const streamingQuestion = await prisma.question.create({
    data: {
      tenantId,
      questionnaireVersionId: questionnaireVersion.id,
      key: "e2e_streaming_bedarf",
      needType: NeedType.STREAMING,
      sortOrder: 1,
    },
  });
  await prisma.questionVersion.create({
    data: {
      tenantId,
      questionId: streamingQuestion.id,
      label: "Interessieren Sie sich fuer ein Streaming-Zusatzpaket?",
      answerType: AnswerType.BOOLEAN,
      isRequired: true,
      validFrom: VALID_FROM,
      status: "ACTIVE",
    },
  });

  const tarifTypQuestion = await prisma.question.create({
    data: {
      tenantId,
      questionnaireVersionId: questionnaireVersion.id,
      key: "e2e_tarif_typ",
      sortOrder: 2,
    },
  });
  const tarifTypQuestionVersion = await prisma.questionVersion.create({
    data: {
      tenantId,
      questionId: tarifTypQuestion.id,
      label: "Welchen Tarif-Typ bevorzugen Sie?",
      answerType: AnswerType.SINGLE_CHOICE,
      isRequired: true,
      validFrom: VALID_FROM,
      status: "ACTIVE",
    },
  });
  await prisma.answerOption.createMany({
    data: [
      {
        tenantId,
        questionVersionId: tarifTypQuestionVersion.id,
        key: "prepaid",
        label: "Prepaid",
        sortOrder: 1,
      },
      {
        tenantId,
        questionVersionId: tarifTypQuestionVersion.id,
        key: "vertrag",
        label: "Vertrag",
        sortOrder: 2,
      },
      {
        tenantId,
        questionVersionId: tarifTypQuestionVersion.id,
        key: "family",
        label: "Family-Tarif",
        sortOrder: 3,
      },
    ],
  });

  // Q3: sichtbar NUR wenn Q1 (Streaming-Bedarf) = true.
  const streamingPaketQuestion = await prisma.question.create({
    data: {
      tenantId,
      questionnaireVersionId: questionnaireVersion.id,
      key: "e2e_streaming_paket",
      needType: NeedType.STREAMING,
      sortOrder: 3,
    },
  });
  const streamingPaketQuestionVersion = await prisma.questionVersion.create({
    data: {
      tenantId,
      questionId: streamingPaketQuestion.id,
      label: "Welches Streaming-Paket bevorzugen Sie?",
      answerType: AnswerType.SINGLE_CHOICE,
      isRequired: false,
      validFrom: VALID_FROM,
      status: "ACTIVE",
    },
  });
  await prisma.answerOption.createMany({
    data: [
      {
        tenantId,
        questionVersionId: streamingPaketQuestionVersion.id,
        key: "netflix",
        label: "Netflix",
        sortOrder: 1,
      },
      {
        tenantId,
        questionVersionId: streamingPaketQuestionVersion.id,
        key: "disney_plus",
        label: "Disney+",
        sortOrder: 2,
      },
      {
        tenantId,
        questionVersionId: streamingPaketQuestionVersion.id,
        key: "amazon_prime",
        label: "Amazon Prime Video",
        sortOrder: 3,
      },
    ],
  });
  await prisma.visibilityCondition.create({
    data: {
      tenantId,
      questionVersionId: streamingPaketQuestionVersion.id,
      targetQuestionId: streamingQuestion.id,
      operator: "EQUALS",
      comparisonValue: "true",
      combinator: "AND",
    },
  });

  // Q4: sichtbar NUR wenn Q2 (Tarif-Typ) = family.
  const familienmitgliederQuestion = await prisma.question.create({
    data: {
      tenantId,
      questionnaireVersionId: questionnaireVersion.id,
      key: "e2e_familienmitglieder",
      sortOrder: 4,
    },
  });
  const familienmitgliederQuestionVersion = await prisma.questionVersion.create({
    data: {
      tenantId,
      questionId: familienmitgliederQuestion.id,
      label: "Wie viele Familienmitglieder sollen den Tarif mitnutzen?",
      answerType: AnswerType.INTEGER,
      isRequired: false,
      minValue: 1,
      maxValue: 10,
      validFrom: VALID_FROM,
      status: "ACTIVE",
    },
  });
  await prisma.visibilityCondition.create({
    data: {
      tenantId,
      questionVersionId: familienmitgliederQuestionVersion.id,
      targetQuestionId: tarifTypQuestion.id,
      operator: "EQUALS",
      comparisonValue: "family",
      combinator: "AND",
    },
  });

  // --- Regelsatz: ein hartes Gate (immer erfuellt bei unserem einzigen
  // Tarif), eine weiche Regel (liefert eine zweite Begruendungszeile), eine
  // Cross-Selling-Regel (matcht Q1 = true, siehe Situation
  // "vertrag_mit_streaming" im Happy-Path-Test). ---
  const ruleSet = await prisma.ruleSet.create({
    data: { tenantId, key: "e2e-standardregeln" },
  });
  const ruleSetVersion = await prisma.ruleSetVersion.create({
    data: {
      tenantId,
      ruleSetId: ruleSet.id,
      label: "E2E Standardregeln v1",
      validFrom: VALID_FROM,
      status: "ACTIVE",
    },
  });

  const ausreichendesDatenvolumen = await prisma.eligibilityRule.create({
    data: {
      tenantId,
      ruleSetVersionId: ruleSetVersion.id,
      key: "e2e_ausreichendes_datenvolumen",
      description: "Produkt bietet mindestens 5 GB Datenvolumen",
      isRequired: true,
    },
  });
  await prisma.eligibilityRuleCondition.create({
    data: {
      tenantId,
      eligibilityRuleId: ausreichendesDatenvolumen.id,
      groupIndex: 0,
      sourceType: "PRODUCT_ATTRIBUTE",
      attributeKey: "dataVolumeGb",
      operator: "GREATER_THAN_OR_EQUAL",
      comparisonValue: "5",
    },
  });

  const euRoamingBonus = await prisma.eligibilityRule.create({
    data: {
      tenantId,
      ruleSetVersionId: ruleSetVersion.id,
      key: "e2e_eu_roaming_bonus",
      description: "Produkt bietet EU-Roaming",
      isRequired: false,
      fitWeight: 50,
    },
  });
  await prisma.eligibilityRuleCondition.create({
    data: {
      tenantId,
      eligibilityRuleId: euRoamingBonus.id,
      groupIndex: 0,
      sourceType: "PRODUCT_ATTRIBUTE",
      attributeKey: "hasEuRoaming",
      operator: "EQUALS",
      comparisonValue: "true",
    },
  });

  const streamingZusatzpaket = await prisma.crossSellingRule.create({
    data: {
      tenantId,
      ruleSetVersionId: ruleSetVersion.id,
      key: "e2e_streaming_zusatzpaket",
      description: "Cross-Selling-Signal fuer ein Streaming-Zusatzpaket",
      needType: NeedType.STREAMING,
      priority: 70,
      reasonCode: "STREAMING_ADDON_SUGGESTED",
    },
  });
  await prisma.crossSellingRuleCondition.create({
    data: {
      tenantId,
      crossSellingRuleId: streamingZusatzpaket.id,
      groupIndex: 0,
      sourceType: "ANSWER",
      questionId: streamingQuestion.id,
      operator: "EQUALS",
      comparisonValue: "true",
    },
  });

  // --- Ablehnungsgrund (fuer den "Empfehlung ablehnen"-Zweig im
  // Happy-Path-Test - ohne mindestens einen aktiven RejectionReason ist der
  // Ablehnen-Flow in der UI blockiert, siehe OutcomeDialog.tsx). ---
  await prisma.rejectionReason.create({
    data: {
      tenantId,
      key: "kein_bedarf",
      label: "Kein Bedarf beim Kunden",
      isActive: true,
    },
  });

  // --- Phase 9 AP9: Admin-/Config-RBAC-Testnutzer fuer die
  // /admin/rules-E2E-Suite (tests/e2e/admin-rules.spec.ts). Zwei Rollen,
  // analog prisma/seed.ts (config_editor/config_publisher), TENANT-Scope --
  // dieselbe geteilte, getestete Zuordnung (permissionKeysForSeedRole())
  // statt einer eigenen, potenziell abweichenden Permission-Liste. ---
  const configEditorRole = await prisma.role.upsert({
    where: { tenantId_key: { tenantId, key: "config_editor" } },
    update: {},
    create: {
      tenantId,
      key: "config_editor",
      name: "Fachadministration (Entwurf)",
      isSystemDefined: true,
    },
  });
  const configPublisherRole = await prisma.role.upsert({
    where: { tenantId_key: { tenantId, key: "config_publisher" } },
    update: {},
    create: {
      tenantId,
      key: "config_publisher",
      name: "Fachadministration (Veroeffentlichung)",
      isSystemDefined: true,
    },
  });

  const allPermissionKeys = permissions.map((p) => p.key);
  for (const [roleKey, role] of [
    ["config_editor", configEditorRole],
    ["config_publisher", configPublisherRole],
  ] as const) {
    for (const key of permissionKeysForSeedRole(roleKey, allPermissionKeys)) {
      const permission = permissions.find((p) => p.key === key);
      if (!permission) continue;
      await prisma.rolePermission
        .upsert({
          where: { roleId_permissionId: { roleId: role.id, permissionId: permission.id } },
          update: {},
          create: { roleId: role.id, permissionId: permission.id },
        })
        .catch(() => undefined);
    }
  }

  // config_editor-Testnutzer: config.rules.view+edit, KEIN .publish --
  // fuer den negativen Szenario-Test "Publish ohne config.rules.publish
  // nicht moeglich".
  const configEditorEmail = `e2e-tenant-a-config-editor@example-synthetic.test`;
  const configEditorUser = await prisma.user.create({
    data: {
      tenantId,
      email: configEditorEmail,
      isSynthetic: true,
      passwordHash: hashPassword(E2E_ADMIN_PASSWORD),
    },
  });
  await prisma.employee.create({
    data: {
      tenantId,
      storeId: base.storeId,
      userId: configEditorUser.id,
      displayName: "E2E Regel-Editor:in (e2e-tenant-a, ohne Publish)",
    },
  });
  await prisma.roleAssignment.create({
    data: {
      tenantId,
      userId: configEditorUser.id,
      roleId: configEditorRole.id,
      scopeType: "TENANT",
      companyId: null,
      storeId: null,
    },
  });

  // config_publisher-Testnutzer: config.rules.view+edit+publish -- fuer den
  // vollstaendigen DRAFT->Edit->Validate->Publish->Rollback-Fluss.
  const configPublisherEmail = `e2e-tenant-a-config-publisher@example-synthetic.test`;
  const configPublisherUser = await prisma.user.create({
    data: {
      tenantId,
      email: configPublisherEmail,
      isSynthetic: true,
      passwordHash: hashPassword(E2E_ADMIN_PASSWORD),
    },
  });
  await prisma.employee.create({
    data: {
      tenantId,
      storeId: base.storeId,
      userId: configPublisherUser.id,
      displayName: "E2E Regel-Publisher:in (e2e-tenant-a)",
    },
  });
  await prisma.roleAssignment.create({
    data: {
      tenantId,
      userId: configPublisherUser.id,
      roleId: configPublisherRole.id,
      scopeType: "TENANT",
      companyId: null,
      storeId: null,
    },
  });

  return {
    ...base,
    questionnaireKey: questionnaire.key,
    questions: {
      streaming: { questionKey: streamingQuestion.key },
      tarifTyp: { questionKey: tarifTypQuestion.key },
      streamingPaket: { questionKey: streamingPaketQuestion.key },
      familienmitglieder: { questionKey: familienmitgliederQuestion.key },
    },
    ruleSetId: ruleSet.id,
    commissionModelId: commissionModel.id,
    commissionModelVersionId: commissionModelVersion.id,
    commissionModelSecondaryId: commissionModelSecondary.id,
    campaignId: campaign.id,
    campaignVersionId: campaignVersion.id,
    configEditorAdmin: { email: configEditorEmail, password: E2E_ADMIN_PASSWORD },
    configPublisherAdmin: { email: configPublisherEmail, password: E2E_ADMIN_PASSWORD },
  };
}

async function seedTenantB() {
  const base = await seedTenantShell({
    key: "e2e-tenant-b",
    name: "E2E TestTel B (synthetisch)",
    companyKey: "e2e-company-b",
    companyName: "E2E TestTel B GmbH",
    storeKey: "e2e-store-b",
    employeeDisplayName: "E2E Testperson B (e2e-tenant-b)",
  });
  const tenantId = base.tenantId;

  // Minimaler Fragebogen, nur damit eine echte ConsultationSession
  // angelegt werden kann (Ziel des negativen Tenant-Isolationstests).
  const questionnaire = await prisma.questionnaire.create({
    data: { tenantId, key: "e2e-basisberatung-b" },
  });
  const questionnaireVersion = await prisma.questionnaireVersion.create({
    data: {
      tenantId,
      questionnaireId: questionnaire.id,
      label: "E2E Basisberatung B v1",
      validFrom: VALID_FROM,
      status: "ACTIVE",
    },
  });
  await prisma.question.create({
    data: {
      tenantId,
      questionnaireVersionId: questionnaireVersion.id,
      key: "e2e_b_platzhalterfrage",
      sortOrder: 1,
    },
  });

  const customerReference = await prisma.customerReference.create({
    data: {
      tenantId,
      storeId: base.storeId,
      displayCode: "E2E-TENANT-B-K-0001",
    },
  });

  // Bereits laufende Sitzung von Tenant B - Ziel des Zugriffsversuchs aus
  // tests/e2e/tenant-isolation.spec.ts (eingeloggt als Tenant-A-Mitarbeiter).
  const session = await prisma.consultationSession.create({
    data: {
      tenantId,
      storeId: base.storeId,
      employeeId: base.employeeId,
      customerReferenceId: customerReference.id,
      questionnaireVersionId: questionnaireVersion.id,
      consultationType: "NEW_CONTRACT",
      status: "IN_PROGRESS",
      startedAt: new Date("2026-08-01T09:00:00Z"),
      dataCompletenessScore: 0,
    },
  });

  // Phase 9 AP9: minimaler RuleSet fuer den negativen /admin/rules-
  // Tenant-Isolationstest (Tenant-A-Admin versucht per manipulierter URL auf
  // eine RuleSetVersion von Tenant B zuzugreifen).
  const ruleSet = await prisma.ruleSet.create({
    data: { tenantId, key: "e2e-b-regeln" },
  });
  const ruleSetVersion = await prisma.ruleSetVersion.create({
    data: {
      tenantId,
      ruleSetId: ruleSet.id,
      label: "E2E B Regeln v1",
      validFrom: VALID_FROM,
      status: "ACTIVE",
    },
  });

  // Phase 10 AP9: minimales Produkt + CommissionModel/-Version fuer den
  // negativen /admin/commissions-Tenant-Isolationstest (Tenant-A-Admin
  // versucht per manipulierter URL auf ein CommissionModel von Tenant B
  // zuzugreifen).
  const providerB = await prisma.provider.upsert({
    where: { key: "o2-telefonica" },
    update: {},
    create: { key: "o2-telefonica", name: "O2 / Telefonica (synthetisch)", isSynthetic: true },
  });
  const categoryB = await prisma.productCategory.create({
    data: { tenantId, key: "mobilfunk-b", name: "Mobilfunk B" },
  });
  const productB = await prisma.product.create({
    data: {
      tenantId,
      providerId: providerB.id,
      categoryId: categoryB.id,
      productType: ProductType.MOBILE_NEW_CONTRACT,
      name: "E2E TestTel B Mobil (synthetisch)",
      isSynthetic: true,
    },
  });
  const commissionModelB = await prisma.commissionModel.create({
    data: { tenantId, productId: productB.id, name: "E2E B Provision" },
  });
  const commissionModelVersionB = await prisma.commissionModelVersion.create({
    data: {
      tenantId,
      commissionModelId: commissionModelB.id,
      versionNumber: 1,
      status: "ACTIVE",
      validFrom: VALID_FROM,
      commissionType: CommissionType.FLAT,
      currency: "EUR",
      commissionAmountMinor: 1000,
    },
  });

  // Phase 13 AP8: minimale Campaign + CampaignVersion fuer den negativen
  // /admin/campaigns-Tenant-Isolationstest (Tenant-A-Admin versucht per
  // manipulierter URL auf eine CampaignVersion von Tenant B zuzugreifen).
  const campaignB = await prisma.campaign.create({
    data: { tenantId, key: "e2e-b-kampagne", name: "E2E B Kampagne" },
  });
  const campaignVersionB = await prisma.campaignVersion.create({
    data: {
      tenantId,
      campaignId: campaignB.id,
      versionNumber: 1,
      status: "ACTIVE",
      scopeType: "TENANT",
      scopeId: tenantId,
      validFrom: VALID_FROM,
      validTo: null,
    },
  });

  return {
    ...base,
    consultationSessionId: session.id,
    ruleSetId: ruleSet.id,
    ruleSetVersionId: ruleSetVersion.id,
    commissionModelId: commissionModelB.id,
    commissionModelVersionId: commissionModelVersionB.id,
    campaignId: campaignB.id,
    campaignVersionId: campaignVersionB.id,
  };
}

async function main() {
  const existing = await prisma.tenant.findUnique({ where: { key: "e2e-tenant-a" } });
  if (existing) {
    throw new Error(
      'Tenant "e2e-tenant-a" existiert bereits. prisma/seed-e2e.ts ist NICHT idempotent ' +
        "(analog zu den Phase-3B-Ergaenzungen in prisma/seed.ts) - bitte gegen eine frische " +
        "Datenbank ausfuehren (in CI automatisch der Fall, lokal z. B. per docker compose down -v).",
    );
  }

  console.log("E2E-Seed: globaler Katalog ...");
  const { provider, permissions } = await seedGlobalCatalog();

  console.log("E2E-Seed: Tenant A (e2e-tenant-a) ...");
  const tenantA = await seedTenantA(provider.id, permissions);

  console.log("E2E-Seed: Tenant B (e2e-tenant-b) ...");
  const tenantB = await seedTenantB();

  const output = {
    tenantA: {
      tenantId: tenantA.tenantId,
      employeeDisplayName: tenantA.displayName,
      questionnaireKey: tenantA.questionnaireKey,
      ruleSetId: tenantA.ruleSetId,
      commissionModelId: tenantA.commissionModelId,
      commissionModelVersionId: tenantA.commissionModelVersionId,
      commissionModelSecondaryId: tenantA.commissionModelSecondaryId,
      campaignId: tenantA.campaignId,
      campaignVersionId: tenantA.campaignVersionId,
      configEditorAdmin: tenantA.configEditorAdmin,
      configPublisherAdmin: tenantA.configPublisherAdmin,
    },
    tenantB: {
      tenantId: tenantB.tenantId,
      employeeDisplayName: tenantB.displayName,
      consultationSessionId: tenantB.consultationSessionId,
      ruleSetId: tenantB.ruleSetId,
      ruleSetVersionId: tenantB.ruleSetVersionId,
      commissionModelId: tenantB.commissionModelId,
      commissionModelVersionId: tenantB.commissionModelVersionId,
      campaignId: tenantB.campaignId,
      campaignVersionId: tenantB.campaignVersionId,
    },
  };
  writeFileSync(SEED_OUTPUT_PATH, JSON.stringify(output, null, 2), "utf-8");

  console.log("E2E-Seed abgeschlossen.");
  console.log(`Tenant A: ${tenantA.tenantId} (Mitarbeiter: ${tenantA.displayName})`);
  console.log(
    `Tenant B: ${tenantB.tenantId} (Session fuer Isolationstest: ${tenantB.consultationSessionId})`,
  );
  console.log(`Seed-Ausgabe geschrieben nach ${SEED_OUTPUT_PATH}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
