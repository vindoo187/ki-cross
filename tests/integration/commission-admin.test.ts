/**
 * Phase 10 AP2 -- Integrationstests fuer die CommissionModel-/Version-
 * Management-API (siehe PHASE_10_IMPLEMENTATION_PLAN.md Abschnitt 4). Testet
 * sowohl die Service-Schicht (`src/server/admin/commission-admin.ts`, direkt
 * innerhalb `runWithTenantContext()`) als auch die volle HTTP-Kette (Route-
 * Handler mit echtem signiertem Session-Cookie), gegen ECHTE Postgres-
 * Fixtures (kein `vi.mock`, Codebase-Konvention, siehe
 * tests/integration/rule-admin.test.ts).
 *
 * ZENTRALER STRUKTUR-UNTERSCHIED zu `tests/integration/rule-admin.test.ts`
 * (Phase 9 AP2): `CommissionModelVersion` ist PRO `CommissionModel` gescoped
 * (Phase-8-Muster, siehe PHASE_10_DISCOVERY.md Abschnitt 1) -- anders als bei
 * `RuleSetVersion` (mandantenweiter Scope) darf `copyFromVersionId` HIER
 * NICHT zu einem ANDEREN `CommissionModel` gehoeren. Ein entsprechender
 * Versuch liefert `CommissionModelVersionNotFoundError`, nicht etwa Erfolg --
 * das genaue Gegenteil des "zentralen AP2-Testfalls" aus rule-admin.test.ts.
 *
 * Ohne DATABASE_URL wird die gesamte Suite uebersprungen statt fehlzuschlagen.
 */

import { randomUUID } from "node:crypto";
import { PrismaClient, type CommissionType, type VersionStatus } from "@prisma/client";
import { NextRequest } from "next/server";
import { afterAll, describe, expect, it } from "vitest";
import { runWithTenantContext } from "@/server/tenant/context";
import {
  createSessionToken,
  SESSION_COOKIE_NAME,
  type SessionPayload,
} from "@/server/auth/session";
import {
  createDraftCommissionModelVersion,
  getCommissionModelVersionDetail,
  listCommissionModels,
} from "@/server/admin/commission-admin";
import {
  CommissionModelNotFoundError,
  CommissionModelVersionNotFoundError,
} from "@/server/admin/commission-admin-errors";
import { GET as listCommissionModelsRoute } from "@/app/api/admin/commission-models/route";
import { POST as createDraftCommissionModelVersionRoute } from "@/app/api/admin/commission-models/[id]/versions/route";
import { GET as getCommissionModelVersionDetailRoute } from "@/app/api/admin/commission-models/[id]/versions/[versionId]/route";

const hasDatabaseUrl = Boolean(process.env.DATABASE_URL);
process.env.DEV_AUTH_SECRET ??= "ap2-commission-admin-test-secret-not-for-prod";

describe.skipIf(!hasDatabaseUrl)("Phase 10 AP2: CommissionModel-/Version-Management API", () => {
  const rawClient = new PrismaClient();
  const suffix = randomUUID().slice(0, 8);

  afterAll(async () => {
    await rawClient.$disconnect();
  });

  function baseSessionPayload(tenantId: string, userId: string): Omit<SessionPayload, "issuedAt"> {
    return {
      tenantId,
      userId,
      employeeId: randomUUID(),
      storeId: randomUUID(),
      displayName: "Test",
      roles: [],
      managementScope: null,
      configPermissions: [],
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

  /**
   * `Provider.key` ist GLOBAL eindeutig (kein `tenantId`-Bezug, anders als
   * `ProductCategory`/`Product`) -- viele Testfaelle rufen `createProduct()`
   * mit demselben kurzen `key` (z. B. "p") in JEWEILS eigenen Tenants auf.
   * Der gemeinsame Datei-`suffix` allein reicht daher NICHT aus, um
   * Provider-Key-Kollisionen ueber alle Testfaelle hinweg zu vermeiden --
   * zusaetzlich ein frischer Per-Call-Suffix (CI #65-Fix).
   */
  async function createProvider(key: string) {
    const provider = await rawClient.provider.create({
      data: {
        key: `provider-${key}-${suffix}-${randomUUID().slice(0, 8)}`,
        name: `Provider ${key}`,
        isSynthetic: true,
      },
    });
    return provider.id;
  }

  async function createCategory(tenantId: string, key: string) {
    const category = await rawClient.productCategory.create({
      data: { tenantId, key: `category-${key}-${suffix}`, name: `Kategorie ${key}` },
    });
    return category.id;
  }

  async function createProduct(tenantId: string, key: string) {
    const providerId = await createProvider(key);
    const categoryId = await createCategory(tenantId, key);
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
    return product.id;
  }

  async function createEmptyCommissionModel(tenantId: string, productId: string, key: string) {
    const commissionModel = await rawClient.commissionModel.create({
      data: { tenantId, productId, name: `Modell ${key}` },
    });
    return commissionModel.id;
  }

  async function createCommissionModelWithVersion(
    tenantId: string,
    productId: string,
    key: string,
    overrides: Partial<{
      status: VersionStatus;
      validFrom: Date;
      validTo: Date | null;
      commissionType: CommissionType;
      currency: string;
      commissionAmountMinor: number | null;
    }> = {},
  ) {
    const commissionModelId = await createEmptyCommissionModel(tenantId, productId, key);
    const version = await rawClient.commissionModelVersion.create({
      data: {
        tenantId,
        commissionModelId,
        versionNumber: 1,
        status: overrides.status ?? "ACTIVE",
        validFrom: overrides.validFrom ?? new Date("2026-01-01T00:00:00Z"),
        validTo: overrides.validTo ?? null,
        commissionType: overrides.commissionType ?? "FLAT",
        currency: overrides.currency ?? "EUR",
        commissionAmountMinor: overrides.commissionAmountMinor ?? 1_500,
      },
    });
    return { commissionModelId, versionId: version.id };
  }

  function requestWithCookie(
    url: string,
    token: string,
    init?: { method?: string; body?: string },
  ) {
    return new NextRequest(url, {
      method: init?.method,
      body: init?.body,
      headers: new Headers({ cookie: `${SESSION_COOKIE_NAME}=${token}` }),
    });
  }

  function routeParams<T extends Record<string, string>>(value: T) {
    return { params: Promise.resolve(value) };
  }

  const draftInput = {
    commissionType: "FLAT" as const,
    currency: "EUR",
    commissionAmountMinor: 2_000,
  };

  // -------------------------------------------------------------------
  // 1. Service-Schicht
  // -------------------------------------------------------------------
  describe("1. Service-Schicht", () => {
    it("listCommissionModels() liefert Modelle inkl. Versionen+Status", async () => {
      const tenantId = await createTenant("svc-list");
      const productId = await createProduct(tenantId, "p");
      await createCommissionModelWithVersion(tenantId, productId, "cm");
      const result = await runWithTenantContext(
        { tenantId, userId: randomUUID(), roles: [], managementScope: null },
        () => listCommissionModels(),
      );
      expect(result.length).toBeGreaterThanOrEqual(1);
      expect(result[0]?.versions[0]?.status).toBe("ACTIVE");
    });

    it("getCommissionModelVersionDetail() liefert alle Skalarfelder korrekt", async () => {
      const tenantId = await createTenant("svc-detail");
      const productId = await createProduct(tenantId, "p");
      const { commissionModelId, versionId } = await createCommissionModelWithVersion(
        tenantId,
        productId,
        "cm",
        { commissionType: "PERCENTAGE", commissionAmountMinor: null },
      );
      const detail = await runWithTenantContext(
        { tenantId, userId: randomUUID(), roles: [], managementScope: null },
        () => getCommissionModelVersionDetail(commissionModelId, versionId),
      );
      expect(detail.commissionType).toBe("PERCENTAGE");
      expect(detail.currency).toBe("EUR");
      expect(detail.status).toBe("ACTIVE");
    });

    it("getCommissionModelVersionDetail() mit fremder commissionModelId -> CommissionModelNotFoundError", async () => {
      const tenantId = await createTenant("svc-cmnf");
      const productId = await createProduct(tenantId, "p");
      const { versionId } = await createCommissionModelWithVersion(tenantId, productId, "cm");
      await expect(
        runWithTenantContext(
          { tenantId, userId: randomUUID(), roles: [], managementScope: null },
          () => getCommissionModelVersionDetail(randomUUID(), versionId),
        ),
      ).rejects.toThrow(CommissionModelNotFoundError);
    });

    it("getCommissionModelVersionDetail() mit versionId aus ANDEREM CommissionModel -> CommissionModelVersionNotFoundError", async () => {
      const tenantId = await createTenant("svc-vnf");
      const productA = await createProduct(tenantId, "pa");
      const productB = await createProduct(tenantId, "pb");
      const { commissionModelId: modelA } = await createCommissionModelWithVersion(
        tenantId,
        productA,
        "cm-a",
      );
      const { versionId: versionB } = await createCommissionModelWithVersion(
        tenantId,
        productB,
        "cm-b",
      );
      await expect(
        runWithTenantContext(
          { tenantId, userId: randomUUID(), roles: [], managementScope: null },
          () => getCommissionModelVersionDetail(modelA, versionB),
        ),
      ).rejects.toThrow(CommissionModelVersionNotFoundError);
    });

    it("createDraftCommissionModelVersion() ohne copyFromVersionId legt DRAFT mit versionNumber 1 an (erstes Modell)", async () => {
      const tenantId = await createTenant("svc-empty");
      const actorUserId = await createUser(tenantId, "actor");
      const productId = await createProduct(tenantId, "p");
      const commissionModelId = await createEmptyCommissionModel(tenantId, productId, "cm");
      const detail = await runWithTenantContext(
        { tenantId, userId: actorUserId, roles: [], managementScope: null },
        () => createDraftCommissionModelVersion(commissionModelId, draftInput),
      );
      expect(detail.status).toBe("DRAFT");
      expect(detail.versionNumber).toBe(1);
      expect(detail.commissionAmountMinor).toBe(2_000);
    });

    it("createDraftCommissionModelVersion() erhoeht versionNumber bei einer zweiten Version", async () => {
      const tenantId = await createTenant("svc-versionnum");
      const actorUserId = await createUser(tenantId, "actor");
      const productId = await createProduct(tenantId, "p");
      const { commissionModelId } = await createCommissionModelWithVersion(
        tenantId,
        productId,
        "cm",
      );
      const detail = await runWithTenantContext(
        { tenantId, userId: actorUserId, roles: [], managementScope: null },
        () => createDraftCommissionModelVersion(commissionModelId, draftInput),
      );
      expect(detail.versionNumber).toBe(2);
    });

    it("createDraftCommissionModelVersion() mit copyFromVersionId DESSELBEN CommissionModel funktioniert", async () => {
      const tenantId = await createTenant("svc-copy-same");
      const actorUserId = await createUser(tenantId, "actor");
      const productId = await createProduct(tenantId, "p");
      const { commissionModelId, versionId } = await createCommissionModelWithVersion(
        tenantId,
        productId,
        "cm",
      );
      const detail = await runWithTenantContext(
        { tenantId, userId: actorUserId, roles: [], managementScope: null },
        () =>
          createDraftCommissionModelVersion(commissionModelId, {
            ...draftInput,
            copyFromVersionId: versionId,
          }),
      );
      expect(detail.status).toBe("DRAFT");
      expect(detail.commissionModelId).toBe(commissionModelId);
    });

    it("createDraftCommissionModelVersion() mit copyFromVersionId eines ANDEREN CommissionModel -> CommissionModelVersionNotFoundError (per-Entity-Scope, Gegenteil von Phase 9 AP2)", async () => {
      const tenantId = await createTenant("svc-copy-cross");
      const actorUserId = await createUser(tenantId, "actor");
      const productA = await createProduct(tenantId, "pa");
      const productB = await createProduct(tenantId, "pb");
      const { versionId: sourceVersionId } = await createCommissionModelWithVersion(
        tenantId,
        productA,
        "cm-source",
      );
      const targetCommissionModelId = await createEmptyCommissionModel(
        tenantId,
        productB,
        "cm-target",
      );
      await expect(
        runWithTenantContext(
          { tenantId, userId: actorUserId, roles: [], managementScope: null },
          () =>
            createDraftCommissionModelVersion(targetCommissionModelId, {
              ...draftInput,
              copyFromVersionId: sourceVersionId,
            }),
        ),
      ).rejects.toThrow(CommissionModelVersionNotFoundError);
    });

    it("createDraftCommissionModelVersion() mit nicht existierender copyFromVersionId -> CommissionModelVersionNotFoundError", async () => {
      const tenantId = await createTenant("svc-copy-missing");
      const actorUserId = await createUser(tenantId, "actor");
      const productId = await createProduct(tenantId, "p");
      const commissionModelId = await createEmptyCommissionModel(tenantId, productId, "cm");
      await expect(
        runWithTenantContext(
          { tenantId, userId: actorUserId, roles: [], managementScope: null },
          () =>
            createDraftCommissionModelVersion(commissionModelId, {
              ...draftInput,
              copyFromVersionId: randomUUID(),
            }),
        ),
      ).rejects.toThrow(CommissionModelVersionNotFoundError);
    });

    it("createDraftCommissionModelVersion() mit copyFromVersionId aus FREMDEM Mandanten -> CommissionModelVersionNotFoundError (Tenant-Isolation)", async () => {
      const tenantA = await createTenant("svc-tenant-a");
      const tenantB = await createTenant("svc-tenant-b");
      const actorA = await createUser(tenantA, "actor-a");
      const productB = await createProduct(tenantB, "pb");
      const { versionId: foreignVersionId } = await createCommissionModelWithVersion(
        tenantB,
        productB,
        "cm",
      );
      const productA = await createProduct(tenantA, "pa");
      const commissionModelId = await createEmptyCommissionModel(tenantA, productA, "cm");
      await expect(
        runWithTenantContext(
          { tenantId: tenantA, userId: actorA, roles: [], managementScope: null },
          () =>
            createDraftCommissionModelVersion(commissionModelId, {
              ...draftInput,
              copyFromVersionId: foreignVersionId,
            }),
        ),
      ).rejects.toThrow(CommissionModelVersionNotFoundError);
    });
  });

  // -------------------------------------------------------------------
  // 2. HTTP-Kette
  // -------------------------------------------------------------------
  describe("2. HTTP-Kette", () => {
    it("GET /api/admin/commission-models ohne config.commissions.view -> 403", async () => {
      const tenantId = await createTenant("http-403-list");
      const actorUserId = await createUser(tenantId, "actor");
      const token = createSessionToken(baseSessionPayload(tenantId, actorUserId));
      const response = await listCommissionModelsRoute(
        requestWithCookie("http://localhost/api/admin/commission-models", token),
      );
      expect(response.status).toBe(403);
    });

    it("GET /api/admin/commission-models mit config.commissions.view -> 200 mit Liste", async () => {
      const tenantId = await createTenant("http-200-list");
      const actorUserId = await createUser(tenantId, "actor");
      const productId = await createProduct(tenantId, "p");
      await createCommissionModelWithVersion(tenantId, productId, "cm");
      const token = createSessionToken({
        ...baseSessionPayload(tenantId, actorUserId),
        configPermissions: ["config.commissions.view"],
      });
      const response = await listCommissionModelsRoute(
        requestWithCookie("http://localhost/api/admin/commission-models", token),
      );
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.commissionModels.length).toBeGreaterThanOrEqual(1);
    });

    it("GET .../versions/:versionId mit config.commissions.view -> 200 mit Detail", async () => {
      const tenantId = await createTenant("http-200-detail");
      const actorUserId = await createUser(tenantId, "actor");
      const productId = await createProduct(tenantId, "p");
      const { commissionModelId, versionId } = await createCommissionModelWithVersion(
        tenantId,
        productId,
        "cm",
      );
      const token = createSessionToken({
        ...baseSessionPayload(tenantId, actorUserId),
        configPermissions: ["config.commissions.view"],
      });
      const response = await getCommissionModelVersionDetailRoute(
        requestWithCookie(
          `http://localhost/api/admin/commission-models/${commissionModelId}/versions/${versionId}`,
          token,
        ),
        routeParams({ id: commissionModelId, versionId }),
      );
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.version.commissionType).toBe("FLAT");
    });

    it("POST .../versions ohne config.commissions.edit -> 403", async () => {
      const tenantId = await createTenant("http-403-post");
      const actorUserId = await createUser(tenantId, "actor");
      const productId = await createProduct(tenantId, "p");
      const commissionModelId = await createEmptyCommissionModel(tenantId, productId, "cm");
      const token = createSessionToken({
        ...baseSessionPayload(tenantId, actorUserId),
        configPermissions: ["config.commissions.view"],
      });
      const response = await createDraftCommissionModelVersionRoute(
        requestWithCookie(
          `http://localhost/api/admin/commission-models/${commissionModelId}/versions`,
          token,
          { method: "POST", body: JSON.stringify(draftInput) },
        ),
        routeParams({ id: commissionModelId }),
      );
      expect(response.status).toBe(403);
    });

    it("POST .../versions mit config.commissions.edit -> 201", async () => {
      const tenantId = await createTenant("http-201-create");
      const actorUserId = await createUser(tenantId, "actor");
      const productId = await createProduct(tenantId, "p");
      const commissionModelId = await createEmptyCommissionModel(tenantId, productId, "cm");
      const token = createSessionToken({
        ...baseSessionPayload(tenantId, actorUserId),
        configPermissions: ["config.commissions.edit"],
      });
      const response = await createDraftCommissionModelVersionRoute(
        requestWithCookie(
          `http://localhost/api/admin/commission-models/${commissionModelId}/versions`,
          token,
          { method: "POST", body: JSON.stringify(draftInput) },
        ),
        routeParams({ id: commissionModelId }),
      );
      expect(response.status).toBe(201);
      const body = await response.json();
      expect(body.version.status).toBe("DRAFT");
      expect(body.version.commissionAmountMinor).toBe(2_000);
    });

    it("POST .../versions mit ungueltigem Body (fehlendes commissionType/currency) -> 400", async () => {
      const tenantId = await createTenant("http-400-post");
      const actorUserId = await createUser(tenantId, "actor");
      const productId = await createProduct(tenantId, "p");
      const commissionModelId = await createEmptyCommissionModel(tenantId, productId, "cm");
      const token = createSessionToken({
        ...baseSessionPayload(tenantId, actorUserId),
        configPermissions: ["config.commissions.edit"],
      });
      const response = await createDraftCommissionModelVersionRoute(
        requestWithCookie(
          `http://localhost/api/admin/commission-models/${commissionModelId}/versions`,
          token,
          { method: "POST", body: JSON.stringify({}) },
        ),
        routeParams({ id: commissionModelId }),
      );
      expect(response.status).toBe(400);
    });
  });

  // -------------------------------------------------------------------
  // 3. Auditierung (Phase 10 AP2, von Anfang an eingebaut)
  // -------------------------------------------------------------------
  describe("3. Auditierung", () => {
    it("createDraftCommissionModelVersion() schreibt einen AuditLog-Eintrag (action CREATE, entityType CommissionModelVersion)", async () => {
      const tenantId = await createTenant("audit-create");
      const actorUserId = await createUser(tenantId, "actor");
      const productId = await createProduct(tenantId, "p");
      const commissionModelId = await createEmptyCommissionModel(tenantId, productId, "cm");
      const detail = await runWithTenantContext(
        { tenantId, userId: actorUserId, roles: [], managementScope: null },
        () => createDraftCommissionModelVersion(commissionModelId, draftInput),
      );
      const auditEntries = await rawClient.auditLog.findMany({
        where: { tenantId, entityType: "CommissionModelVersion", entityId: detail.id },
      });
      expect(auditEntries).toHaveLength(1);
      expect(auditEntries[0]?.action).toBe("CREATE");
      expect(auditEntries[0]?.actorUserId).toBe(actorUserId);
    });
  });
});
