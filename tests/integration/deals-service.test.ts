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
    await rawClient.commissionModelVersion.create({
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
  }

  function asEmployee<T>(tenantId: string, employeeId: string, fn: () => Promise<T>): Promise<T> {
    return runWithTenantContext({ tenantId, userId: randomUUID(), employeeId, roles: [] }, fn);
  }

  let tenantAId: string;
  let storeAId: string;
  let employeeAId: string;
  let questionnaireVersionAId: string;
  let productAId: string;
  let productVersionAId: string;

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
    await createCommissionModelVersion(tenantAId, productAId, 300);

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
});
