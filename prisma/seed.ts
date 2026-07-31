/**
 * Synthetisches Seed-Skript (Phase 2).
 *
 * Erzeugt AUSSCHLIESSLICH synthetische/fiktive Testdaten (keine echten
 * Kunden-, Mitarbeiter- oder Vertragsdaten), markiert ueberall mit
 * isSynthetic = true bzw. eindeutig fiktiven Namen ("DemoTel ...").
 *
 * Kernzweck: ZWEI unabhaengige Tenants ("demotel-nord", "demotel-sued")
 * anlegen, die strukturell identisch aufgebaut sind, damit die
 * Isolationstests (tests/integration/tenant-isolation.test.ts) exakt
 * pruefen koennen, dass ein Tenant niemals Daten eines anderen Tenants
 * lesen oder referenzieren kann.
 *
 * Idempotent: Kann mehrfach ausgefuehrt werden (upsert auf eindeutigen
 * Schluesseln wie tenant.key, product.key, ...).
 */

import { PrismaClient, ProductType, CommissionType, AnswerType, NeedType } from "@prisma/client";

const prisma = new PrismaClient();

const RENEWAL_LOOKAHEAD_DAYS_DEFAULT = 180;

// ---------------------------------------------------------------------------
// Globaler Katalog (nicht tenant-gebunden): Provider, Permissions
// ---------------------------------------------------------------------------

async function seedGlobalCatalog() {
  const providers = await Promise.all(
    [
      { key: "o2-telefonica", name: "O2 / Telefonica (synthetisch)" },
      { key: "telekom", name: "Telekom (synthetisch)" },
      { key: "freenet", name: "freenet (synthetisch)" },
    ].map((p) =>
      prisma.provider.upsert({
        where: { key: p.key },
        update: {},
        create: { ...p, isSynthetic: true },
      }),
    ),
  );

  const permissionKeys = [
    "consultation.create",
    "consultation.view_own",
    "consultation.view_store",
    "deal.create",
    "deal.view_own",
    "deal.view_store",
    "analytics.view_store",
    "analytics.view_company",
    "analytics.view_tenant",
    "master_data.manage",
    "user.manage",
  ];
  const permissions = await Promise.all(
    permissionKeys.map((key) =>
      prisma.permission.upsert({
        where: { key },
        update: {},
        create: { key, description: `Berechtigung: ${key}` },
      }),
    ),
  );

  return { providers, permissions };
}

// ---------------------------------------------------------------------------
// Pro Tenant: vollstaendiger, strukturell identischer Aufbau
// ---------------------------------------------------------------------------

interface TenantConfig {
  key: string;
  name: string;
  companyKey: string;
  companyName: string;
  storeKeys: [string, string];
}

async function seedTenant(
  config: TenantConfig,
  providers: Awaited<ReturnType<typeof seedGlobalCatalog>>["providers"],
  permissions: Awaited<ReturnType<typeof seedGlobalCatalog>>["permissions"],
) {
  const tenant = await prisma.tenant.upsert({
    where: { key: config.key },
    update: {},
    create: { key: config.key, name: config.name, isSynthetic: true },
  });

  const company = await prisma.company.upsert({
    where: { tenantId_key: { tenantId: tenant.id, key: config.companyKey } },
    update: {},
    create: { tenantId: tenant.id, key: config.companyKey, name: config.companyName },
  });

  const stores = await Promise.all(
    config.storeKeys.map((storeKey, i) =>
      prisma.store.upsert({
        where: { tenantId_key: { tenantId: tenant.id, key: storeKey } },
        update: {},
        create: {
          tenantId: tenant.id,
          companyId: company.id,
          key: storeKey,
          name: `${config.companyName} Filiale ${i + 1}`,
        },
      }),
    ),
  );

  // --- Rollen & Zuweisung ---
  const adminRole = await prisma.role.upsert({
    where: { tenantId_key: { tenantId: tenant.id, key: "store_admin" } },
    update: {},
    create: {
      tenantId: tenant.id,
      key: "store_admin",
      name: "Filialleitung",
      isSystemDefined: true,
    },
  });
  const salesRole = await prisma.role.upsert({
    where: { tenantId_key: { tenantId: tenant.id, key: "sales_employee" } },
    update: {},
    create: {
      tenantId: tenant.id,
      key: "sales_employee",
      name: "Verkaufsberater:in",
      isSystemDefined: true,
    },
  });
  for (const perm of permissions) {
    await prisma.rolePermission
      .upsert({
        where: { roleId_permissionId: { roleId: salesRole.id, permissionId: perm.id } },
        update: {},
        create: { roleId: salesRole.id, permissionId: perm.id },
      })
      .catch(() => undefined);
  }

  // --- Mitarbeitende ---
  const employees = await Promise.all(
    stores.map(async (store, i) => {
      const user = await prisma.user.upsert({
        where: {
          tenantId_email: {
            tenantId: tenant.id,
            email: `${config.key}-mitarbeiter${i + 1}@example-synthetic.test`,
          },
        },
        update: {},
        create: {
          tenantId: tenant.id,
          email: `${config.key}-mitarbeiter${i + 1}@example-synthetic.test`,
          isSynthetic: true,
        },
      });
      return prisma.employee.upsert({
        where: { tenantId_userId: { tenantId: tenant.id, userId: user.id } },
        update: {},
        create: {
          tenantId: tenant.id,
          storeId: store.id,
          userId: user.id,
          displayName: `Synthetische:r Mitarbeiter:in ${i + 1} (${config.key})`,
        },
      });
    }),
  );

  await prisma.roleAssignment
    .create({
      data: {
        tenantId: tenant.id,
        userId: employees[0]!.userId!,
        roleId: adminRole.id,
        scopeType: "STORE",
        companyId: company.id,
        storeId: stores[0]!.id,
      },
    })
    .catch(() => undefined);

  // --- Produktkatalog (tenant-eigene Kategorien/Produkte, globaler Provider) ---
  const category = await prisma.productCategory.upsert({
    where: { tenantId_key: { tenantId: tenant.id, key: "mobilfunk" } },
    update: {},
    create: { tenantId: tenant.id, key: "mobilfunk", name: "Mobilfunk" },
  });

  const product = await prisma.product.create({
    data: {
      tenantId: tenant.id,
      providerId: providers[0]!.id,
      categoryId: category.id,
      productType: ProductType.MOBILE_NEW_CONTRACT,
      name: "DemoTel Mobil M (synthetisch)",
      isSynthetic: true,
    },
  });

  const productVersion = await prisma.productVersion.create({
    data: {
      tenantId: tenant.id,
      productId: product.id,
      versionNumber: 1,
      status: "ACTIVE",
      validFrom: new Date("2026-01-01T00:00:00Z"),
      currency: "EUR",
      monthlyPriceMinor: 2999,
      oneTimePriceMinor: 0,
      contractMonths: 24,
    },
  });

  await prisma.tariffAttribute.createMany({
    data: [
      {
        tenantId: tenant.id,
        productVersionId: productVersion.id,
        attributeKey: "data_gb",
        attributeValue: "20",
        valueType: "number",
      },
      {
        tenantId: tenant.id,
        productVersionId: productVersion.id,
        attributeKey: "5g",
        attributeValue: "true",
        valueType: "boolean",
      },
    ],
  });

  const commissionModel = await prisma.commissionModel.create({
    data: { tenantId: tenant.id, productId: product.id, name: "Standardprovision Mobil M" },
  });
  await prisma.commissionModelVersion.create({
    data: {
      tenantId: tenant.id,
      commissionModelId: commissionModel.id,
      versionNumber: 1,
      status: "ACTIVE",
      validFrom: new Date("2026-01-01T00:00:00Z"),
      commissionType: CommissionType.FLAT,
      currency: "EUR",
      commissionAmountMinor: 3000,
      recurringCommissionAmountMinor: 100,
    },
  });

  // --- Konfigurierbarer Schwellenwert (Renewal-Lookahead, seed = 180 Tage) ---
  await prisma.configurableThreshold.upsert({
    where: {
      tenantId_key_validFrom: {
        tenantId: tenant.id,
        key: "renewal_lookahead_days",
        validFrom: new Date("2026-01-01T00:00:00Z"),
      },
    },
    update: {},
    create: {
      tenantId: tenant.id,
      key: "renewal_lookahead_days",
      value: String(RENEWAL_LOOKAHEAD_DAYS_DEFAULT),
      validFrom: new Date("2026-01-01T00:00:00Z"),
    },
  });

  // --- Fragebogen (minimal, ein Bedarfsfeld) ---
  const questionnaire = await prisma.questionnaire.upsert({
    where: { tenantId_key: { tenantId: tenant.id, key: "basisberatung" } },
    update: {},
    create: { tenantId: tenant.id, key: "basisberatung" },
  });
  const questionnaireVersion = await prisma.questionnaireVersion.create({
    data: {
      tenantId: tenant.id,
      questionnaireId: questionnaire.id,
      label: "Basisberatung v1",
      validFrom: new Date("2026-01-01T00:00:00Z"),
      status: "ACTIVE",
    },
  });
  const question = await prisma.question.create({
    data: {
      tenantId: tenant.id,
      questionnaireVersionId: questionnaireVersion.id,
      key: "hat_streaming_bedarf",
      needType: NeedType.STREAMING,
      sortOrder: 1,
    },
  });
  const questionVersion = await prisma.questionVersion.create({
    data: {
      tenantId: tenant.id,
      questionId: question.id,
      label: "Interessieren Sie sich fuer ein Streaming-Paket?",
      answerType: AnswerType.BOOLEAN,
      isRequired: false,
      validFrom: new Date("2026-01-01T00:00:00Z"),
      status: "ACTIVE",
    },
  });

  // --- Fragebogen (erweitert): weitere AnswerTypes + Sichtbarkeits-Branching ---

  const tarifTypQuestion = await prisma.question.create({
    data: {
      tenantId: tenant.id,
      questionnaireVersionId: questionnaireVersion.id,
      key: "bevorzugter_tarif_typ",
      sortOrder: 2,
    },
  });
  const tarifTypQuestionVersion = await prisma.questionVersion.create({
    data: {
      tenantId: tenant.id,
      questionId: tarifTypQuestion.id,
      label: "Welchen Tarif-Typ bevorzugen Sie?",
      answerType: AnswerType.SINGLE_CHOICE,
      isRequired: false,
      validFrom: new Date("2026-01-01T00:00:00Z"),
      status: "ACTIVE",
    },
  });
  await prisma.answerOption.createMany({
    data: [
      {
        tenantId: tenant.id,
        questionVersionId: tarifTypQuestionVersion.id,
        key: "prepaid",
        label: "Prepaid",
        sortOrder: 1,
      },
      {
        tenantId: tenant.id,
        questionVersionId: tarifTypQuestionVersion.id,
        key: "vertrag",
        label: "Vertrag",
        sortOrder: 2,
      },
      {
        tenantId: tenant.id,
        questionVersionId: tarifTypQuestionVersion.id,
        key: "family",
        label: "Family-Tarif",
        sortOrder: 3,
      },
    ],
  });

  const zusatzleistungenQuestion = await prisma.question.create({
    data: {
      tenantId: tenant.id,
      questionnaireVersionId: questionnaireVersion.id,
      key: "gewuenschte_zusatzleistungen",
      sortOrder: 3,
    },
  });
  const zusatzleistungenQuestionVersion = await prisma.questionVersion.create({
    data: {
      tenantId: tenant.id,
      questionId: zusatzleistungenQuestion.id,
      label: "Welche Zusatzleistungen interessieren Sie?",
      answerType: AnswerType.MULTIPLE_CHOICE,
      isRequired: false,
      minSelections: 0,
      maxSelections: 2,
      validFrom: new Date("2026-01-01T00:00:00Z"),
      status: "ACTIVE",
    },
  });
  await prisma.answerOption.createMany({
    data: [
      {
        tenantId: tenant.id,
        questionVersionId: zusatzleistungenQuestionVersion.id,
        key: "geraeteschutz",
        label: "Geraeteschutz",
        sortOrder: 1,
      },
      {
        tenantId: tenant.id,
        questionVersionId: zusatzleistungenQuestionVersion.id,
        key: "auslandsflat",
        label: "Auslandsflat",
        sortOrder: 2,
      },
      {
        tenantId: tenant.id,
        questionVersionId: zusatzleistungenQuestionVersion.id,
        key: "cloud_speicher",
        label: "Cloud-Speicher",
        sortOrder: 3,
      },
    ],
  });

  const simKartenQuestion = await prisma.question.create({
    data: {
      tenantId: tenant.id,
      questionnaireVersionId: questionnaireVersion.id,
      key: "anzahl_sim_karten",
      sortOrder: 4,
    },
  });
  await prisma.questionVersion.create({
    data: {
      tenantId: tenant.id,
      questionId: simKartenQuestion.id,
      label: "Wie viele SIM-Karten benoetigen Sie?",
      answerType: AnswerType.INTEGER,
      isRequired: false,
      minValue: 1,
      maxValue: 10,
      validFrom: new Date("2026-01-01T00:00:00Z"),
      status: "ACTIVE",
    },
  });

  const budgetQuestion = await prisma.question.create({
    data: {
      tenantId: tenant.id,
      questionnaireVersionId: questionnaireVersion.id,
      key: "monatliches_budget",
      sortOrder: 5,
    },
  });
  await prisma.questionVersion.create({
    data: {
      tenantId: tenant.id,
      questionId: budgetQuestion.id,
      label: "Wie viel moechten Sie monatlich ausgeben (EUR)?",
      answerType: AnswerType.DECIMAL,
      isRequired: false,
      minValue: 0,
      maxValue: 200,
      validFrom: new Date("2026-01-01T00:00:00Z"),
      status: "ACTIVE",
    },
  });

  const aktuellerAnbieterQuestion = await prisma.question.create({
    data: {
      tenantId: tenant.id,
      questionnaireVersionId: questionnaireVersion.id,
      key: "aktueller_anbieter",
      sortOrder: 6,
    },
  });
  await prisma.questionVersion.create({
    data: {
      tenantId: tenant.id,
      questionId: aktuellerAnbieterQuestion.id,
      label: "Wer ist Ihr aktueller Anbieter?",
      answerType: AnswerType.SHORT_TEXT,
      isRequired: false,
      maxLength: 100,
      validFrom: new Date("2026-01-01T00:00:00Z"),
      status: "ACTIVE",
    },
  });

  const wunschterminQuestion = await prisma.question.create({
    data: {
      tenantId: tenant.id,
      questionnaireVersionId: questionnaireVersion.id,
      key: "wunschtermin_wechsel",
      sortOrder: 7,
    },
  });
  await prisma.questionVersion.create({
    data: {
      tenantId: tenant.id,
      questionId: wunschterminQuestion.id,
      label: "Zu welchem Termin moechten Sie wechseln?",
      answerType: AnswerType.DATE,
      isRequired: false,
      validFrom: new Date("2026-01-01T00:00:00Z"),
      status: "ACTIVE",
    },
  });

  // Sichtbarkeits-Branching: diese Frage ist nur sichtbar, wenn
  // "hat_streaming_bedarf" (siehe oben) mit "true" beantwortet wurde.
  const streamingPaketQuestion = await prisma.question.create({
    data: {
      tenantId: tenant.id,
      questionnaireVersionId: questionnaireVersion.id,
      key: "bevorzugtes_streaming_paket",
      needType: NeedType.STREAMING,
      sortOrder: 8,
    },
  });
  const streamingPaketQuestionVersion = await prisma.questionVersion.create({
    data: {
      tenantId: tenant.id,
      questionId: streamingPaketQuestion.id,
      label: "Welches Streaming-Paket bevorzugen Sie?",
      answerType: AnswerType.SINGLE_CHOICE,
      isRequired: false,
      validFrom: new Date("2026-01-01T00:00:00Z"),
      status: "ACTIVE",
    },
  });
  await prisma.answerOption.createMany({
    data: [
      {
        tenantId: tenant.id,
        questionVersionId: streamingPaketQuestionVersion.id,
        key: "netflix",
        label: "Netflix",
        sortOrder: 1,
      },
      {
        tenantId: tenant.id,
        questionVersionId: streamingPaketQuestionVersion.id,
        key: "disney_plus",
        label: "Disney+",
        sortOrder: 2,
      },
      {
        tenantId: tenant.id,
        questionVersionId: streamingPaketQuestionVersion.id,
        key: "amazon_prime",
        label: "Amazon Prime Video",
        sortOrder: 3,
      },
    ],
  });
  await prisma.visibilityCondition.create({
    data: {
      tenantId: tenant.id,
      questionVersionId: streamingPaketQuestionVersion.id,
      targetQuestionId: question.id,
      operator: "EQUALS",
      comparisonValue: "true",
      combinator: "AND",
    },
  });

  // --- Regelsatz (minimal, eine Eligibility-Regel) ---
  const ruleSet = await prisma.ruleSet.upsert({
    where: { tenantId_key: { tenantId: tenant.id, key: "standardregeln" } },
    update: {},
    create: { tenantId: tenant.id, key: "standardregeln" },
  });
  const ruleSetVersion = await prisma.ruleSetVersion.create({
    data: {
      tenantId: tenant.id,
      ruleSetId: ruleSet.id,
      label: "Standardregeln v1",
      validFrom: new Date("2026-01-01T00:00:00Z"),
      status: "ACTIVE",
    },
  });
  await prisma.eligibilityRule.create({
    data: {
      tenantId: tenant.id,
      ruleSetVersionId: ruleSetVersion.id,
      key: "mind_18",
      description: "Kunde ist volljaehrig (synthetische Platzhalterregel)",
      expression: "true",
    },
  });

  // --- Pseudonymer Kundenbezug (kein echter Name) ---
  const customerReference = await prisma.customerReference.create({
    data: {
      tenantId: tenant.id,
      storeId: stores[0]!.id,
      displayCode: `${config.key.toUpperCase()}-K-0001`,
    },
  });

  // --- Beratungssitzung -> Bedarf -> Opportunity -> Empfehlung -> Deal ---
  const session = await prisma.consultationSession.create({
    data: {
      tenantId: tenant.id,
      storeId: stores[0]!.id,
      employeeId: employees[0]!.id,
      customerReferenceId: customerReference.id,
      questionnaireVersionId: questionnaireVersion.id,
      consultationType: "NEW_CONTRACT",
      status: "COMPLETED",
      startedAt: new Date("2026-07-15T09:00:00Z"),
      endedAt: new Date("2026-07-15T09:20:00Z"),
      dataCompletenessScore: 0.9,
    },
  });

  await prisma.consultationTopic.create({
    data: {
      tenantId: tenant.id,
      consultationSessionId: session.id,
      topicKey: NeedType.STREAMING,
      openedAt: new Date("2026-07-15T09:05:00Z"),
      closedAt: new Date("2026-07-15T09:08:00Z"),
    },
  });

  await prisma.customerAnswer.create({
    data: {
      tenantId: tenant.id,
      consultationSessionId: session.id,
      questionVersionId: questionVersion.id,
      answerType: AnswerType.BOOLEAN,
      booleanValue: true,
      answeredAt: new Date("2026-07-15T09:06:00Z"),
    },
  });

  const detectedNeed = await prisma.detectedNeed.create({
    data: {
      tenantId: tenant.id,
      consultationSessionId: session.id,
      needType: NeedType.STREAMING,
      source: "RULE_BASED",
      detectedAt: new Date("2026-07-15T09:06:30Z"),
    },
  });

  await prisma.salesOpportunity.create({
    data: {
      tenantId: tenant.id,
      consultationSessionId: session.id,
      detectedNeedId: detectedNeed.id,
      status: "OFFERED",
      offeredAt: new Date("2026-07-15T09:10:00Z"),
    },
  });

  const recommendation = await prisma.recommendation.create({
    data: {
      tenantId: tenant.id,
      consultationSessionId: session.id,
      ruleSetVersionId: ruleSetVersion.id,
      generatedAt: new Date("2026-07-15T09:07:00Z"),
    },
  });

  const recommendationItem = await prisma.recommendationItem.create({
    data: {
      tenantId: tenant.id,
      recommendationId: recommendation.id,
      productVersionId: productVersion.id,
      eligibilityPassed: true,
      exclusionReasonCodes: [],
      businessPriorityScore: 0.8,
      priorityRank: 1,
    },
  });

  await prisma.recommendationRationale.create({
    data: {
      tenantId: tenant.id,
      recommendationItemId: recommendationItem.id,
      factorKey: "detected_need_match",
      factorValue: "STREAMING",
      weight: 0.8,
    },
  });

  await prisma.recommendationOutcome.create({
    data: {
      tenantId: tenant.id,
      recommendationItemId: recommendationItem.id,
      outcome: "ACCEPTED",
      decidedByEmployeeId: employees[0]!.id,
      decidedAt: new Date("2026-07-15T09:15:00Z"),
    },
  });

  const deal = await prisma.deal.create({
    data: {
      tenantId: tenant.id,
      consultationSessionId: session.id,
      storeId: stores[0]!.id,
      employeeId: employees[0]!.id,
      customerReferenceId: customerReference.id,
      currency: "EUR",
      closedAt: new Date("2026-07-15T09:18:00Z"),
    },
  });

  await prisma.dealItem.create({
    data: {
      tenantId: tenant.id,
      dealId: deal.id,
      productVersionId: productVersion.id,
      quantity: 1,
    },
  });

  await prisma.dealFinancialSnapshot.create({
    data: {
      tenantId: tenant.id,
      dealId: deal.id,
      currency: "EUR",
      monthlyRecurringRevenueMinor: 2999,
      totalContractValueMinor: 2999 * 24,
      oneTimeRevenueMinor: 0,
      commissionAmountMinor: 3000,
      expectedRecurringCommissionMinor: 100,
      hardwarePurchaseCostMinor: 0,
      subsidyCostMinor: 0,
      discountCostMinor: 0,
      otherDirectCostMinor: 0,
      contributionMarginMinor: 2999 * 24 + 3000 - 100,
      contributionMarginFormulaVersion: "v1",
      capturedAt: new Date("2026-07-15T09:18:00Z"),
    },
  });

  await prisma.followUp.create({
    data: {
      tenantId: tenant.id,
      consultationSessionId: session.id,
      customerReferenceId: customerReference.id,
      reason: "RENEWAL_LOOKAHEAD",
      status: "OPEN",
      dueDate: new Date("2028-01-15T09:00:00Z"),
      thresholdUsedDays: RENEWAL_LOOKAHEAD_DAYS_DEFAULT,
    },
  });

  // --- Analytics-/Audit-Beispiele ---
  await prisma.analyticsEvent.create({
    data: {
      tenantId: tenant.id,
      storeId: stores[0]!.id,
      employeeId: employees[0]!.id,
      eventType: "DEAL_CLOSED",
      payload: { dealId: deal.id },
      occurredAt: new Date("2026-07-15T09:18:00Z"),
    },
  });

  await prisma.auditLog.create({
    data: {
      tenantId: tenant.id,
      actorUserId: employees[0]!.userId,
      action: "CREATE",
      entityType: "Deal",
      entityId: deal.id,
      metadata: { source: "seed" },
    },
  });

  await prisma.baselineMeasurement.create({
    data: {
      tenantId: tenant.id,
      storeId: stores[0]!.id,
      employeeId: employees[0]!.id,
      metricKey: "cross_sell_rate_before_rollout",
      metricValue: 0.12,
      periodStart: new Date("2026-06-01T00:00:00Z"),
      periodEnd: new Date("2026-06-30T23:59:59Z"),
      measurementSource: "MANUAL",
      measurementMethod: "OBSERVATION",
      startedAt: new Date("2026-06-15T09:00:00Z"),
      endedAt: new Date("2026-06-15T09:20:00Z"),
      activeDurationSeconds: 900,
      inactiveDurationSeconds: 300,
      consultationOutcome: "COMPLETED",
      dealCompleted: true,
      productsSoldCount: 1,
      detectedCrossSellCount: 1,
      offeredCrossSellCount: 1,
      acceptedCrossSellCount: 0,
      dataCompletenessScore: 0.9,
    },
  });

  return { tenant, stores, employees, customerReference, deal };
}

async function main() {
  console.log("Seeding: globaler Katalog ...");
  const { providers, permissions } = await seedGlobalCatalog();

  console.log("Seeding: Tenant A (demotel-nord) ...");
  const tenantA = await seedTenant(
    {
      key: "demotel-nord",
      name: "DemoTel Nord (synthetisch)",
      companyKey: "demotel-nord-gmbh",
      companyName: "DemoTel Nord GmbH",
      storeKeys: ["nord-filiale-1", "nord-filiale-2"],
    },
    providers,
    permissions,
  );

  console.log("Seeding: Tenant B (demotel-sued) ...");
  const tenantB = await seedTenant(
    {
      key: "demotel-sued",
      name: "DemoTel Sued (synthetisch)",
      companyKey: "demotel-sued-gmbh",
      companyName: "DemoTel Sued GmbH",
      storeKeys: ["sued-filiale-1", "sued-filiale-2"],
    },
    providers,
    permissions,
  );

  console.log("Seed abgeschlossen.");
  console.log(`Tenant A: ${tenantA.tenant.key} (${tenantA.tenant.id})`);
  console.log(`Tenant B: ${tenantB.tenant.key} (${tenantB.tenant.id})`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
