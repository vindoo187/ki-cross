/**
 * Integrationstests fuer `deals/service.ts::closeDeal()` (Phase 6 AP3/AP9,
 * siehe PHASE_6_IMPLEMENTATION_PLAN.md Abschnitt 5) gegen eine ECHTE
 * Postgres-Datenbank (gleiches Muster wie `consultation-completion.test.ts`/
 * `recommendation-engine.test.ts`).
 *
 * Rein logische Faelle (Formel v1, Provisionsberechnung inkl. Regressionstest
 * fuer den Doppelverrechnungs-Bugfix) sind bereits als DB-freie Unit-Tests in
 * `tests/unit/deals/financial-snapshot.test.ts` und
 * `tests/unit/pricing/commission.test.ts` abgedeckt und werden hier NICHT
 * wiederholt -- dieser Test deckt die END-TO-END-Orchestrierung
 * (Session-/Produkt-Aufloesung, atomare Transaktion, Fehlerpfade,
 * Mandantentrennung) ab.
 *
 * Ohne DATABASE_URL wird die gesamte Suite uebersprungen statt fehlzuschlagen.
 */

import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runWithTenantContext } from "@/server/tenant/context";
import { closeDeal } from "@/server/deals/service";
import { publishCommissionModelVersion } from "@/server/admin/commission-admin";
import {
  computeCommissionAmountMinor,
  type CommissionModelVersionRow,
} from "@/server/pricing/commission";
import {
  DealAlreadyExistsForSessionError,
  DealConsultationSessionNotFoundError,
  DealProductVersionNotFoundError,
  DealRequiresItemsError,
  DealSessionNotClosableError,
} from "@/server/deals/errors";

const hasDatabaseUrl = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDatabaseUrl)("closeDeal() (Integrationstest, echte Postgres-DB)", () => {
  const rawClient = new PrismaClient();
  const suffix = randomUUID().slice(0, 8);
  const FROM = new Date("2026-01-01T00:00:00Z");
  const SESSION_AT = new Date("2026-03-01T00:00:00Z");
  // Hinweis: closeDeal() verwendet intern new Date() als closedAt (nicht
  // injizierbar) -- alle Gueltigkeitsfenster (validFrom=FROM, validTo=null)
  // schliessen daher automatisch auch den tatsaechlichen Testausfuehrungs-
  // zeitpunkt ein, unabhaengig davon, wann die Suite laeuft.

  afterAll(async () => {
    // Bewusst kein deleteMany fuer deal_financial_snapshots (append-only,
    // siehe DB-Trigger deal_financial_snapshots_append_only) -- Testisolation
    // per randomUUID-Suffix, analog allen anderen Integrationstests.
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
    return { tenantId: tenant.id, storeId: store.id, employeeId: employee.id };
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

  async function createSession(
    tenantId: string,
    storeId: string,
    employeeId: string,
    questionnaireVersionId: string,
    status: "IN_PROGRESS" | "COMPLETED" | "ABANDONED" = "IN_PROGRESS",
  ) {
    const session = await rawClient.consultationSession.create({
      data: {
        tenantId,
        storeId,
        employeeId,
        questionnaireVersionId,
        consultationType: "NEW_CONTRACT",
        status,
        startedAt: SESSION_AT,
        endedAt: status === "IN_PROGRESS" ? null : new Date("2026-03-01T00:20:00Z"),
      },
    });
    return session.id;
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
    monthlyPriceMinor: number,
    oneTimePriceMinor: number,
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
        oneTimePriceMinor,
      },
    });
    return { productId: product.id, productVersionId: version.id };
  }

  async function createProductCostVersion(
    tenantId: string,
    productId: string,
    hardwareCostMinor: number,
  ) {
    await rawClient.productCostVersion.create({
      data: {
        tenantId,
        productId,
        versionNumber: 1,
        status: "ACTIVE",
        validFrom: FROM,
        validTo: null,
        currency: "EUR",
        hardwarePurchaseCostMinor: hardwareCostMinor,
        subsidyCostMinor: 0,
        otherDirectCostMinor: 0,
      },
    });
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
    // Phase 10 AP6: Rueckgabe der IDs, damit Tests die tatsaechlich
    // aufgeloeste CommissionModelVersion gegen DealItem.commissionModelVersionId
    // verifizieren koennen (bestehende Aufrufer ignorieren den Rueckgabewert
    // unveraendert, rein additive Erweiterung).
    return { commissionModelId: model.id, commissionModelVersionId: version.id };
  }

  /** Phase 10 AP6: fuer publishCommissionModelVersion() (Audit-FK auf User). */
  async function createUser(tenantId: string, key: string) {
    const user = await rawClient.user.create({
      data: { tenantId, email: `${key}-${suffix}@example-synthetic.test`, isSynthetic: true },
    });
    return user.id;
  }

  function asEmployee<T>(tenantId: string, employeeId: string, fn: () => Promise<T>): Promise<T> {
    return runWithTenantContext(
      { tenantId, userId: randomUUID(), employeeId, roles: [], managementScope: null },
      fn,
    );
  }

  let tenantAId: string;
  let storeAId: string;
  let employeeAId: string;
  let questionnaireVersionAId: string;
  let productAId: string;
  let productVersionAId: string;
  let commissionModelAId: string;
  let commissionModelVersionAId: string;

  let tenantBId: string;
  let employeeBId: string;
  let productVersionBId: string; // gehoert Tenant B, fuer den Cross-Tenant-Zugriffstest

  beforeAll(async () => {
    const a = await createTenant("deals-a");
    tenantAId = a.tenantId;
    storeAId = a.storeId;
    employeeAId = a.employeeId;
    questionnaireVersionAId = await createQuestionnaireVersion(tenantAId, "deals-a-fragebogen");

    const providerId = await createProvider("deals-a");
    const categoryId = await createCategory(tenantAId, "deals-a");
    const productVersion = await createProductVersion(
      tenantAId,
      categoryId,
      providerId,
      "deals-a-tarif",
      1_000, // monatlich
      5_000, // einmalig
    );
    productAId = productVersion.productId;
    productVersionAId = productVersion.productVersionId;
    await createProductCostVersion(tenantAId, productAId, 2_000);
    const commissionA = await createCommissionModelVersion(tenantAId, productAId, 300);
    commissionModelAId = commissionA.commissionModelId;
    commissionModelVersionAId = commissionA.commissionModelVersionId;

    const b = await createTenant("deals-b");
    tenantBId = b.tenantId;
    employeeBId = b.employeeId;
    const providerBId = await createProvider("deals-b");
    const categoryBId = await createCategory(tenantBId, "deals-b");
    const productVersionB = await createProductVersion(
      tenantBId,
      categoryBId,
      providerBId,
      "deals-b-tarif",
      500,
      2_000,
    );
    productVersionBId = productVersionB.productVersionId;
  });

  it("Erfolgreicher Abschluss: Deal + DealItem + DealFinancialSnapshot + genau ein DEAL_CLOSED-Event", async () => {
    const sessionId = await createSession(
      tenantAId,
      storeAId,
      employeeAId,
      questionnaireVersionAId,
    );

    const result = await asEmployee(tenantAId, employeeAId, () =>
      closeDeal({
        consultationSessionId: sessionId,
        items: [{ productVersionId: productVersionAId, quantity: 2 }],
      }),
    );

    // Umsatz: einmalig 5_000*2=10_000, monatlich 1_000*2=2_000.
    expect(result.oneTimeRevenueMinor).toBe(10_000);
    expect(result.monthlyRecurringRevenueMinor).toBe(2_000);
    expect(result.totalContractValueMinor).toBe(12_000);
    // Marge (v1): 10_000 - Kosten (2_000 Hardware * 2 = 4_000) = 6_000.
    expect(result.contributionMarginMinor).toBe(6_000);

    const dealItems = await rawClient.dealItem.findMany({ where: { dealId: result.dealId } });
    expect(dealItems).toHaveLength(1);
    expect(dealItems[0]!.quantity).toBe(2);

    const snapshot = await rawClient.dealFinancialSnapshot.findUnique({
      where: { tenantId_dealId: { tenantId: tenantAId, dealId: result.dealId } },
    });
    expect(snapshot).not.toBeNull();
    expect(snapshot!.contributionMarginFormulaVersion).toBe("v1");
    // Provision (FLAT, 300/Stueck einmalig, kein wiederkehrender Wert konfiguriert): 300*2=600.
    expect(snapshot!.commissionAmountMinor).toBe(600);

    const events = await rawClient.analyticsEvent.findMany({
      where: { eventType: "DEAL_CLOSED", tenantId: tenantAId },
    });
    const matching = events.filter(
      (e) =>
        e.payload !== null &&
        typeof e.payload === "object" &&
        (e.payload as Record<string, unknown>).dealId === result.dealId,
    );
    expect(matching).toHaveLength(1);
    expect(matching[0]!.storeId).toBe(storeAId);
    expect(matching[0]!.employeeId).toBe(employeeAId);
  });

  it("funktioniert sowohl fuer IN_PROGRESS als auch COMPLETED Sessions", async () => {
    const completedSessionId = await createSession(
      tenantAId,
      storeAId,
      employeeAId,
      questionnaireVersionAId,
      "COMPLETED",
    );

    const result = await asEmployee(tenantAId, employeeAId, () =>
      closeDeal({
        consultationSessionId: completedSessionId,
        items: [{ productVersionId: productVersionAId, quantity: 1 }],
      }),
    );
    expect(result.dealId).toBeTruthy();
  });

  it("ABANDONED Session: DealSessionNotClosableError, kein Deal wird angelegt", async () => {
    const abandonedSessionId = await createSession(
      tenantAId,
      storeAId,
      employeeAId,
      questionnaireVersionAId,
      "ABANDONED",
    );

    await expect(
      asEmployee(tenantAId, employeeAId, () =>
        closeDeal({
          consultationSessionId: abandonedSessionId,
          items: [{ productVersionId: productVersionAId, quantity: 1 }],
        }),
      ),
    ).rejects.toThrow(DealSessionNotClosableError);

    const deal = await rawClient.deal.findFirst({
      where: { consultationSessionId: abandonedSessionId },
    });
    expect(deal).toBeNull();
  });

  it("leeres items[]: DealRequiresItemsError", async () => {
    const sessionId = await createSession(
      tenantAId,
      storeAId,
      employeeAId,
      questionnaireVersionAId,
    );
    await expect(
      asEmployee(tenantAId, employeeAId, () =>
        closeDeal({ consultationSessionId: sessionId, items: [] }),
      ),
    ).rejects.toThrow(DealRequiresItemsError);
  });

  it("nicht existierende ConsultationSession: DealConsultationSessionNotFoundError", async () => {
    await expect(
      asEmployee(tenantAId, employeeAId, () =>
        closeDeal({
          consultationSessionId: randomUUID(),
          items: [{ productVersionId: productVersionAId, quantity: 1 }],
        }),
      ),
    ).rejects.toThrow(DealConsultationSessionNotFoundError);
  });

  it("nicht existierende productVersionId: DealProductVersionNotFoundError", async () => {
    const sessionId = await createSession(
      tenantAId,
      storeAId,
      employeeAId,
      questionnaireVersionAId,
    );
    await expect(
      asEmployee(tenantAId, employeeAId, () =>
        closeDeal({
          consultationSessionId: sessionId,
          items: [{ productVersionId: randomUUID(), quantity: 1 }],
        }),
      ),
    ).rejects.toThrow(DealProductVersionNotFoundError);
  });

  it("zweiter Abschlussversuch fuer dieselbe Session: DealAlreadyExistsForSessionError", async () => {
    const sessionId = await createSession(
      tenantAId,
      storeAId,
      employeeAId,
      questionnaireVersionAId,
    );
    await asEmployee(tenantAId, employeeAId, () =>
      closeDeal({
        consultationSessionId: sessionId,
        items: [{ productVersionId: productVersionAId, quantity: 1 }],
      }),
    );

    await expect(
      asEmployee(tenantAId, employeeAId, () =>
        closeDeal({
          consultationSessionId: sessionId,
          items: [{ productVersionId: productVersionAId, quantity: 1 }],
        }),
      ),
    ).rejects.toThrow(DealAlreadyExistsForSessionError);
  });

  it("gleichzeitiger Doppelabschluss (Race Condition): genau ein Aufruf gewinnt, der andere schlaegt mit DealAlreadyExistsForSessionError fehl, es entsteht nie mehr als ein Deal (AP12-Regressionstest fuer den DB-Unique-Constraint)", async () => {
    const sessionId = await createSession(
      tenantAId,
      storeAId,
      employeeAId,
      questionnaireVersionAId,
    );

    // Zwei nahezu gleichzeitige Aufrufe -- der App-Level-Precheck in
    // closeDeal() (der "existingDeal"-Check vor der Transaktion) kann diese
    // Race Condition allein nicht ausschliessen; erst der DB-Unique-
    // Constraint (deals_tenant_id_consultation_session_id_key, Migration
    // 20260817170000) garantiert, dass am Ende hoechstens ein Deal existiert.
    const results = await Promise.allSettled([
      asEmployee(tenantAId, employeeAId, () =>
        closeDeal({
          consultationSessionId: sessionId,
          items: [{ productVersionId: productVersionAId, quantity: 1 }],
        }),
      ),
      asEmployee(tenantAId, employeeAId, () =>
        closeDeal({
          consultationSessionId: sessionId,
          items: [{ productVersionId: productVersionAId, quantity: 1 }],
        }),
      ),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(
      DealAlreadyExistsForSessionError,
    );

    const deals = await rawClient.deal.findMany({
      where: { consultationSessionId: sessionId },
    });
    expect(deals).toHaveLength(1);
  });

  it("Mandantentrennung: eine ConsultationSession von Tenant A ist unter Tenant B nicht sichtbar", async () => {
    const sessionId = await createSession(
      tenantAId,
      storeAId,
      employeeAId,
      questionnaireVersionAId,
    );
    await expect(
      asEmployee(tenantBId, employeeBId, () =>
        closeDeal({
          consultationSessionId: sessionId,
          items: [{ productVersionId: productVersionAId, quantity: 1 }],
        }),
      ),
    ).rejects.toThrow(DealConsultationSessionNotFoundError);
  });

  it("Mandantentrennung: eine productVersionId von Tenant B ist unter Tenant A nicht aufloesbar (DealProductVersionNotFoundError statt Datenleck)", async () => {
    const sessionId = await createSession(
      tenantAId,
      storeAId,
      employeeAId,
      questionnaireVersionAId,
    );
    await expect(
      asEmployee(tenantAId, employeeAId, () =>
        closeDeal({
          consultationSessionId: sessionId,
          items: [{ productVersionId: productVersionBId, quantity: 1 }],
        }),
      ),
    ).rejects.toThrow(DealProductVersionNotFoundError);
  });

  it("optionale customerReferenceId ueberschreibt die Session-Kundenreferenz auf dem Deal", async () => {
    const customerReference = await rawClient.customerReference.create({
      data: { tenantId: tenantAId, storeId: storeAId, displayCode: `KD-${suffix}` },
    });
    const sessionId = await createSession(
      tenantAId,
      storeAId,
      employeeAId,
      questionnaireVersionAId,
    );

    const result = await asEmployee(tenantAId, employeeAId, () =>
      closeDeal({
        consultationSessionId: sessionId,
        items: [{ productVersionId: productVersionAId, quantity: 1 }],
        customerReferenceId: customerReference.id,
      }),
    );

    const deal = await rawClient.deal.findUnique({
      where: { tenantId_id: { tenantId: tenantAId, id: result.dealId } },
    });
    expect(deal!.customerReferenceId).toBe(customerReference.id);
  });

  it("append-only: UPDATE auf deal_financial_snapshots wird von der Datenbank abgelehnt", async () => {
    const sessionId = await createSession(
      tenantAId,
      storeAId,
      employeeAId,
      questionnaireVersionAId,
    );
    const result = await asEmployee(tenantAId, employeeAId, () =>
      closeDeal({
        consultationSessionId: sessionId,
        items: [{ productVersionId: productVersionAId, quantity: 1 }],
      }),
    );

    await expect(
      rawClient.dealFinancialSnapshot.update({
        where: { tenantId_dealId: { tenantId: tenantAId, dealId: result.dealId } },
        data: { contributionMarginMinor: 0 },
      }),
    ).rejects.toThrow();
  });

  // -------------------------------------------------------------------
  // Phase 10 AP6 -- Deal-Historisierung (DealItem.commissionModelVersionId),
  // siehe PHASE_10_IMPLEMENTATION_PLAN.md Abschnitt 14 Punkt 1, ChatGPT-GO
  // 2026-08-22.
  // -------------------------------------------------------------------

  it("closeDeal() setzt DealItem.commissionModelVersionId auf die zum closedAt aufgeloeste CommissionModelVersion", async () => {
    const sessionId = await createSession(
      tenantAId,
      storeAId,
      employeeAId,
      questionnaireVersionAId,
    );
    const result = await asEmployee(tenantAId, employeeAId, () =>
      closeDeal({
        consultationSessionId: sessionId,
        items: [{ productVersionId: productVersionAId, quantity: 1 }],
      }),
    );
    const dealItems = await rawClient.dealItem.findMany({ where: { dealId: result.dealId } });
    expect(dealItems).toHaveLength(1);
    expect(dealItems[0]!.commissionModelVersionId).toBe(commissionModelVersionAId);
  });

  it("Deal mit mehreren Items UNTERSCHIEDLICHER CommissionModelVersions -- jedes DealItem erhaelt seine EIGENE, korrekte Zuordnung (inkl. NULL fuer ein Produkt ohne Provisionsmodell)", async () => {
    // Zweites Produkt MIT eigener, anderer CommissionModelVersion.
    const providerC = await createProvider("deals-c");
    const categoryC = await createCategory(tenantAId, "deals-c");
    const productVersionC = await createProductVersion(
      tenantAId,
      categoryC,
      providerC,
      "deals-c-tarif",
      2_000,
      8_000,
    );
    const commissionC = await createCommissionModelVersion(
      tenantAId,
      productVersionC.productId,
      777,
    );

    // Drittes Produkt OHNE jedes Provisionsmodell -- commissionModelVersionId
    // muss dafuer NULL bleiben (fachlich "keine Provision", kein Fehler).
    const providerD = await createProvider("deals-d");
    const categoryD = await createCategory(tenantAId, "deals-d");
    const productVersionD = await createProductVersion(
      tenantAId,
      categoryD,
      providerD,
      "deals-d-tarif",
      1_500,
      4_000,
    );

    const sessionId = await createSession(
      tenantAId,
      storeAId,
      employeeAId,
      questionnaireVersionAId,
    );
    const result = await asEmployee(tenantAId, employeeAId, () =>
      closeDeal({
        consultationSessionId: sessionId,
        items: [
          { productVersionId: productVersionAId, quantity: 1 },
          { productVersionId: productVersionC.productVersionId, quantity: 1 },
          { productVersionId: productVersionD.productVersionId, quantity: 1 },
        ],
      }),
    );

    const dealItems = await rawClient.dealItem.findMany({ where: { dealId: result.dealId } });
    expect(dealItems).toHaveLength(3);
    const byProductVersion = new Map(dealItems.map((i) => [i.productVersionId, i]));
    expect(byProductVersion.get(productVersionAId)?.commissionModelVersionId).toBe(
      commissionModelVersionAId,
    );
    expect(byProductVersion.get(productVersionC.productVersionId)?.commissionModelVersionId).toBe(
      commissionC.commissionModelVersionId,
    );
    expect(byProductVersion.get(productVersionD.productVersionId)?.commissionModelVersionId).toBe(
      null,
    );
    // Bekraeftigt explizit, dass die Items unterschiedliche Versionen
    // referenzieren -- kein einzelnes, gemeinsames Skalarfeld auf dem Deal
    // koennte das abbilden (ChatGPTs Begruendung fuer commissionModelVersionId
    // auf DealItem statt DealFinancialSnapshot).
    expect(commissionC.commissionModelVersionId).not.toBe(commissionModelVersionAId);
  });

  it("ZENTRALER REGRESSIONSTEST (ChatGPT-Vorgabe AP6, 2026-08-22): ein SPAETERES Publish einer neuen CommissionModelVersion aendert die historische commissionModelVersionId eines bereits abgeschlossenen Deals NICHT", async () => {
    const actorUserId = await createUser(tenantAId, "publish-actor");

    const sessionId = await createSession(
      tenantAId,
      storeAId,
      employeeAId,
      questionnaireVersionAId,
    );
    const result = await asEmployee(tenantAId, employeeAId, () =>
      closeDeal({
        consultationSessionId: sessionId,
        items: [{ productVersionId: productVersionAId, quantity: 1 }],
      }),
    );
    const dealItemsBefore = await rawClient.dealItem.findMany({
      where: { dealId: result.dealId },
    });
    expect(dealItemsBefore[0]!.commissionModelVersionId).toBe(commissionModelVersionAId);

    // Neue DRAFT-Version DESSELBEN CommissionModel anlegen und veroeffentlichen
    // -- das MUSS die alte ACTIVE-Version (commissionModelVersionAId) auf
    // EXPIRED setzen, siehe publishCommissionModelVersion() (Phase 10 AP5).
    const newDraft = await rawClient.commissionModelVersion.create({
      data: {
        tenantId: tenantAId,
        commissionModelId: commissionModelAId,
        versionNumber: 2,
        status: "DRAFT",
        validFrom: new Date(),
        validTo: null,
        commissionType: "FLAT",
        currency: "EUR",
        commissionAmountMinor: 999,
      },
    });

    const publishResult = await runWithTenantContext(
      { tenantId: tenantAId, userId: actorUserId, roles: [], managementScope: null },
      () => publishCommissionModelVersion(commissionModelAId, newDraft.id),
    );
    expect(publishResult.previousActiveVersionId).toBe(commissionModelVersionAId);

    const oldVersionRow = await rawClient.commissionModelVersion.findUnique({
      where: { id: commissionModelVersionAId },
    });
    expect(oldVersionRow?.status).toBe("EXPIRED");

    // Die historische Referenz des BEREITS abgeschlossenen Deals darf durch
    // dieses Publish NICHT veraendert werden -- es gibt keinen UPDATE-Pfad
    // auf DealItem, der das koennte (kein Code, der dealItem.update()
    // aufruft, siehe deals/service.ts -- rein strukturell ausgeschlossen).
    const dealItemsAfter = await rawClient.dealItem.findMany({ where: { dealId: result.dealId } });
    expect(dealItemsAfter[0]!.commissionModelVersionId).toBe(commissionModelVersionAId);
    expect(dealItemsAfter[0]!.commissionModelVersionId).not.toBe(newDraft.id);

    // Ein NEUER Deal ab jetzt muss dagegen die NEUE ACTIVE-Version verwenden.
    const newSessionId = await createSession(
      tenantAId,
      storeAId,
      employeeAId,
      questionnaireVersionAId,
    );
    const newResult = await asEmployee(tenantAId, employeeAId, () =>
      closeDeal({
        consultationSessionId: newSessionId,
        items: [{ productVersionId: productVersionAId, quantity: 1 }],
      }),
    );
    const newDealItems = await rawClient.dealItem.findMany({
      where: { dealId: newResult.dealId },
    });
    expect(newDealItems[0]!.commissionModelVersionId).toBe(newDraft.id);
  });

  it("TIERED-CommissionModelVersion bleibt ueber die gespeicherte commissionModelVersionId reproduzierbar (nachtraeglich neu berechneter Betrag == im DealFinancialSnapshot gespeicherter Betrag)", async () => {
    const providerE = await createProvider("deals-e");
    const categoryE = await createCategory(tenantAId, "deals-e");
    const productVersionE = await createProductVersion(
      tenantAId,
      categoryE,
      providerE,
      "deals-e-tarif",
      0,
      3_000,
    );
    const modelE = await rawClient.commissionModel.create({
      data: { tenantId: tenantAId, productId: productVersionE.productId, name: "Provision-TIERED" },
    });
    const versionE = await rawClient.commissionModelVersion.create({
      data: {
        tenantId: tenantAId,
        commissionModelId: modelE.id,
        versionNumber: 1,
        status: "ACTIVE",
        validFrom: FROM,
        validTo: null,
        commissionType: "TIERED",
        currency: "EUR",
      },
    });
    await rawClient.commissionTier.create({
      data: {
        tenantId: tenantAId,
        commissionModelVersionId: versionE.id,
        thresholdMinor: 0,
        tierAmountMinor: 250,
        sortOrder: 0,
      },
    });

    const sessionId = await createSession(
      tenantAId,
      storeAId,
      employeeAId,
      questionnaireVersionAId,
    );
    const result = await asEmployee(tenantAId, employeeAId, () =>
      closeDeal({
        consultationSessionId: sessionId,
        items: [{ productVersionId: productVersionE.productVersionId, quantity: 1 }],
      }),
    );

    const dealItems = await rawClient.dealItem.findMany({ where: { dealId: result.dealId } });
    expect(dealItems[0]!.commissionModelVersionId).toBe(versionE.id);

    const snapshot = await rawClient.dealFinancialSnapshot.findUnique({
      where: { tenantId_dealId: { tenantId: tenantAId, dealId: result.dealId } },
    });
    expect(snapshot!.commissionAmountMinor).toBe(250);

    // Reproduzierbarkeit: die gespeicherte commissionModelVersionId erlaubt
    // es, die exakt gueltige Stufe erneut nachzuvollziehen -- OHNE auf die
    // (potenziell inzwischen ueberholte) "aktuell aktive" Version angewiesen
    // zu sein.
    const historicalVersion = await rawClient.commissionModelVersion.findUniqueOrThrow({
      where: { id: dealItems[0]!.commissionModelVersionId! },
    });
    const historicalTiers = await rawClient.commissionTier.findMany({
      where: { commissionModelVersionId: historicalVersion.id },
    });
    const reconstructedRow: CommissionModelVersionRow = {
      id: historicalVersion.id,
      productId: productVersionE.productId,
      validFrom: historicalVersion.validFrom,
      commissionType: historicalVersion.commissionType,
      commissionAmountMinor: historicalVersion.commissionAmountMinor,
      commissionPercentageBasisPoints: historicalVersion.commissionPercentageBasisPoints,
      recurringCommissionAmountMinor: historicalVersion.recurringCommissionAmountMinor,
      tiers: historicalTiers.map((t) => ({
        thresholdMinor: t.thresholdMinor,
        tierAmountMinor: t.tierAmountMinor,
        tierPercentageBasisPoints: t.tierPercentageBasisPoints,
      })),
    };
    const recomputed = computeCommissionAmountMinor(reconstructedRow, 3_000, null);
    expect(recomputed).toBe(snapshot!.commissionAmountMinor);
  });

  it(
    "ZENTRALER AP7-REPRODUZIERBARKEITSTEST (ChatGPT-Vorgabe, 2026-08-22): " +
      "Version 1 -> Deal schliessen -> Version 2 publishen -> Version 1 UNVERAENDERT " +
      "rekonstruieren -> gespeicherte Provision exakt reproduzieren, OHNE die aktuell " +
      "ACTIVE-Version zu benoetigen",
    async () => {
      const actorUserId = await createUser(tenantAId, "ap7-repro-actor");
      const providerF = await createProvider("deals-f");
      const categoryF = await createCategory(tenantAId, "deals-f");
      const productVersionF = await createProductVersion(
        tenantAId,
        categoryF,
        providerF,
        "deals-f-tarif",
        0,
        1_500,
      );
      const commissionF = await createCommissionModelVersion(
        tenantAId,
        productVersionF.productId,
        400,
      );

      // Version 1 -> Deal schliessen.
      const sessionId = await createSession(
        tenantAId,
        storeAId,
        employeeAId,
        questionnaireVersionAId,
      );
      const result = await asEmployee(tenantAId, employeeAId, () =>
        closeDeal({
          consultationSessionId: sessionId,
          items: [{ productVersionId: productVersionF.productVersionId, quantity: 1 }],
        }),
      );

      const dealItems = await rawClient.dealItem.findMany({ where: { dealId: result.dealId } });
      expect(dealItems[0]!.commissionModelVersionId).toBe(commissionF.commissionModelVersionId);

      const snapshot = await rawClient.dealFinancialSnapshot.findUnique({
        where: { tenantId_dealId: { tenantId: tenantAId, dealId: result.dealId } },
      });
      expect(snapshot!.commissionAmountMinor).toBe(400);

      // Version 2 anlegen und publishen -- das setzt Version 1 auf EXPIRED.
      const newDraft = await rawClient.commissionModelVersion.create({
        data: {
          tenantId: tenantAId,
          commissionModelId: commissionF.commissionModelId,
          versionNumber: 2,
          status: "DRAFT",
          validFrom: new Date(),
          validTo: null,
          commissionType: "FLAT",
          currency: "EUR",
          commissionAmountMinor: 777,
        },
      });
      await runWithTenantContext(
        { tenantId: tenantAId, userId: actorUserId, roles: [], managementScope: null },
        () => publishCommissionModelVersion(commissionF.commissionModelId, newDraft.id),
      );

      // Version 1 rekonstruieren -- AUSSCHLIESSLICH ueber die auf dem DealItem
      // gespeicherte commissionModelVersionId, NICHT ueber eine Abfrage nach
      // der "aktuell aktiven" Version (die ist jetzt Version 2).
      const historicalVersion = await rawClient.commissionModelVersion.findUniqueOrThrow({
        where: { id: dealItems[0]!.commissionModelVersionId! },
      });
      expect(historicalVersion.id).toBe(commissionF.commissionModelVersionId);
      expect(historicalVersion.id).not.toBe(newDraft.id);
      // Beweis, dass die rekonstruierte Version NICHT mehr die aktuell aktive
      // ist -- die Reproduzierbarkeit haengt also strukturell nicht vom
      // aktuellen ACTIVE-Status ab.
      expect(historicalVersion.status).toBe("EXPIRED");

      const reconstructedRow: CommissionModelVersionRow = {
        id: historicalVersion.id,
        productId: productVersionF.productId,
        validFrom: historicalVersion.validFrom,
        commissionType: historicalVersion.commissionType,
        commissionAmountMinor: historicalVersion.commissionAmountMinor,
        commissionPercentageBasisPoints: historicalVersion.commissionPercentageBasisPoints,
        recurringCommissionAmountMinor: historicalVersion.recurringCommissionAmountMinor,
        tiers: [],
      };
      // FLAT-Berechnung analog computeDealFinancialSnapshot(): die
      // einmalige Provision ist der dritte Parameter (commissionAmountMinor
      // der historischen Version), quantity ist hier 1.
      const recomputed = computeCommissionAmountMinor(
        reconstructedRow,
        1_500,
        reconstructedRow.commissionAmountMinor,
      );
      expect(recomputed).toBe(snapshot!.commissionAmountMinor);
      expect(recomputed).toBe(400);
    },
  );
});
