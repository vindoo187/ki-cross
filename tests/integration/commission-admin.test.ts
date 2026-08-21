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
  updateCommissionModelVersionFields,
} from "@/server/admin/commission-admin";
import {
  CommissionModelNotFoundError,
  CommissionModelVersionInvalidError,
  CommissionModelVersionNotDraftError,
  CommissionModelVersionNotFoundError,
} from "@/server/admin/commission-admin-errors";
import { GET as listCommissionModelsRoute } from "@/app/api/admin/commission-models/route";
import { POST as createDraftCommissionModelVersionRoute } from "@/app/api/admin/commission-models/[id]/versions/route";
import {
  GET as getCommissionModelVersionDetailRoute,
  PATCH as patchCommissionModelVersionRoute,
} from "@/app/api/admin/commission-models/[id]/versions/[versionId]/route";

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
  // 1b. Feld-CRUD (AP3)
  // -------------------------------------------------------------------
  describe("1b. Feld-CRUD (AP3) -- updateCommissionModelVersionFields()", () => {
    it("aendert nur die uebergebenen Felder (partielles Update, currency)", async () => {
      const tenantId = await createTenant("ap3-partial");
      const actorUserId = await createUser(tenantId, "actor");
      const productId = await createProduct(tenantId, "p");
      const { commissionModelId, versionId } = await createCommissionModelWithVersion(
        tenantId,
        productId,
        "cm",
        { status: "DRAFT" },
      );
      const detail = await runWithTenantContext(
        { tenantId, userId: actorUserId, roles: [], managementScope: null },
        () => updateCommissionModelVersionFields(commissionModelId, versionId, { currency: "CHF" }),
      );
      expect(detail.currency).toBe("CHF");
      expect(detail.commissionType).toBe("FLAT");
      expect(detail.commissionAmountMinor).toBe(1_500);
    });

    it("gegen eine nicht-DRAFT-Version -> CommissionModelVersionNotDraftError", async () => {
      const tenantId = await createTenant("ap3-not-draft");
      const actorUserId = await createUser(tenantId, "actor");
      const productId = await createProduct(tenantId, "p");
      const { commissionModelId, versionId } = await createCommissionModelWithVersion(
        tenantId,
        productId,
        "cm",
        { status: "ACTIVE" },
      );
      await expect(
        runWithTenantContext(
          { tenantId, userId: actorUserId, roles: [], managementScope: null },
          () =>
            updateCommissionModelVersionFields(commissionModelId, versionId, { currency: "CHF" }),
        ),
      ).rejects.toThrow(CommissionModelVersionNotDraftError);
    });

    it("commissionType -> PERCENTAGE, wenn commissionAmountMinor aus der bestehenden Version noch gesetzt ist -> CommissionModelVersionInvalidError (Merge-Pruefung, nicht nur Patch-lokal)", async () => {
      const tenantId = await createTenant("ap3-invalid-merge");
      const actorUserId = await createUser(tenantId, "actor");
      const productId = await createProduct(tenantId, "p");
      const { commissionModelId, versionId } = await createCommissionModelWithVersion(
        tenantId,
        productId,
        "cm",
        { status: "DRAFT", commissionType: "FLAT", commissionAmountMinor: 1_000 },
      );
      // Patch enthaelt NUR commissionType -- commissionAmountMinor bleibt aus
      // dem bestehenden Datensatz bestehen und muss dennoch als Verstoss
      // erkannt werden.
      await expect(
        runWithTenantContext(
          { tenantId, userId: actorUserId, roles: [], managementScope: null },
          () =>
            updateCommissionModelVersionFields(commissionModelId, versionId, {
              commissionType: "PERCENTAGE",
            }),
        ),
      ).rejects.toThrow(CommissionModelVersionInvalidError);
    });

    it("commissionType PERCENTAGE + amount/recurringAmount im selben Patch auf null -> Erfolg", async () => {
      const tenantId = await createTenant("ap3-valid-percentage");
      const actorUserId = await createUser(tenantId, "actor");
      const productId = await createProduct(tenantId, "p");
      const { commissionModelId, versionId } = await createCommissionModelWithVersion(
        tenantId,
        productId,
        "cm",
        { status: "DRAFT", commissionType: "FLAT", commissionAmountMinor: 1_000 },
      );
      const detail = await runWithTenantContext(
        { tenantId, userId: actorUserId, roles: [], managementScope: null },
        () =>
          updateCommissionModelVersionFields(commissionModelId, versionId, {
            commissionType: "PERCENTAGE",
            commissionAmountMinor: null,
            commissionPercentageBasisPoints: 500,
          }),
      );
      expect(detail.commissionType).toBe("PERCENTAGE");
      expect(detail.commissionAmountMinor).toBeNull();
      expect(detail.commissionPercentageBasisPoints).toBe(500);
    });

    it("commissionType FLAT mit gleichzeitig gesetztem commissionPercentageBasisPoints -> CommissionModelVersionInvalidError", async () => {
      const tenantId = await createTenant("ap3-invalid-flat-pct");
      const actorUserId = await createUser(tenantId, "actor");
      const productId = await createProduct(tenantId, "p");
      const { commissionModelId, versionId } = await createCommissionModelWithVersion(
        tenantId,
        productId,
        "cm",
        { status: "DRAFT" },
      );
      await expect(
        runWithTenantContext(
          { tenantId, userId: actorUserId, roles: [], managementScope: null },
          () =>
            updateCommissionModelVersionFields(commissionModelId, versionId, {
              commissionPercentageBasisPoints: 250,
            }),
        ),
      ).rejects.toThrow(CommissionModelVersionInvalidError);
    });

    it("commissionType FLAT: commissionAmountMinor UND recurringCommissionAmountMinor GLEICHZEITIG gesetzt ist ERLAUBT (bewusst NICHT exklusiv, siehe computeCommissionAmountMinor()-Kommentar)", async () => {
      const tenantId = await createTenant("ap3-flat-both-amounts");
      const actorUserId = await createUser(tenantId, "actor");
      const productId = await createProduct(tenantId, "p");
      const { commissionModelId, versionId } = await createCommissionModelWithVersion(
        tenantId,
        productId,
        "cm",
        { status: "DRAFT", commissionType: "FLAT", commissionAmountMinor: 1_000 },
      );
      const detail = await runWithTenantContext(
        { tenantId, userId: actorUserId, roles: [], managementScope: null },
        () =>
          updateCommissionModelVersionFields(commissionModelId, versionId, {
            recurringCommissionAmountMinor: 300,
          }),
      );
      expect(detail.commissionAmountMinor).toBe(1_000);
      expect(detail.recurringCommissionAmountMinor).toBe(300);
    });

    it("gegen fremdes CommissionModel (versionId gehoert nicht zu commissionModelId) -> CommissionModelVersionNotFoundError", async () => {
      const tenantId = await createTenant("ap3-wrong-model");
      const actorUserId = await createUser(tenantId, "actor");
      const productA = await createProduct(tenantId, "pa");
      const productB = await createProduct(tenantId, "pb");
      const { commissionModelId: modelA } = await createCommissionModelWithVersion(
        tenantId,
        productA,
        "cm-a",
        { status: "DRAFT" },
      );
      const { versionId: versionB } = await createCommissionModelWithVersion(
        tenantId,
        productB,
        "cm-b",
        { status: "DRAFT" },
      );
      await expect(
        runWithTenantContext(
          { tenantId, userId: actorUserId, roles: [], managementScope: null },
          () => updateCommissionModelVersionFields(modelA, versionB, { currency: "CHF" }),
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

    it("PATCH .../versions/:versionId ohne config.commissions.edit -> 403", async () => {
      const tenantId = await createTenant("http-403-patch");
      const actorUserId = await createUser(tenantId, "actor");
      const productId = await createProduct(tenantId, "p");
      const { commissionModelId, versionId } = await createCommissionModelWithVersion(
        tenantId,
        productId,
        "cm",
        { status: "DRAFT" },
      );
      const token = createSessionToken({
        ...baseSessionPayload(tenantId, actorUserId),
        configPermissions: ["config.commissions.view"],
      });
      const response = await patchCommissionModelVersionRoute(
        requestWithCookie(
          `http://localhost/api/admin/commission-models/${commissionModelId}/versions/${versionId}`,
          token,
          { method: "PATCH", body: JSON.stringify({ currency: "CHF" }) },
        ),
        routeParams({ id: commissionModelId, versionId }),
      );
      expect(response.status).toBe(403);
    });

    it("PATCH .../versions/:versionId mit config.commissions.edit -> 200 mit aktualisiertem Detail", async () => {
      const tenantId = await createTenant("http-200-patch");
      const actorUserId = await createUser(tenantId, "actor");
      const productId = await createProduct(tenantId, "p");
      const { commissionModelId, versionId } = await createCommissionModelWithVersion(
        tenantId,
        productId,
        "cm",
        { status: "DRAFT" },
      );
      const token = createSessionToken({
        ...baseSessionPayload(tenantId, actorUserId),
        configPermissions: ["config.commissions.edit"],
      });
      const response = await patchCommissionModelVersionRoute(
        requestWithCookie(
          `http://localhost/api/admin/commission-models/${commissionModelId}/versions/${versionId}`,
          token,
          { method: "PATCH", body: JSON.stringify({ currency: "CHF" }) },
        ),
        routeParams({ id: commissionModelId, versionId }),
      );
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.version.currency).toBe("CHF");
    });

    it("PATCH .../versions/:versionId gegen eine ACTIVE-Version -> 409", async () => {
      const tenantId = await createTenant("http-409-patch");
      const actorUserId = await createUser(tenantId, "actor");
      const productId = await createProduct(tenantId, "p");
      const { commissionModelId, versionId } = await createCommissionModelWithVersion(
        tenantId,
        productId,
        "cm",
        { status: "ACTIVE" },
      );
      const token = createSessionToken({
        ...baseSessionPayload(tenantId, actorUserId),
        configPermissions: ["config.commissions.edit"],
      });
      const response = await patchCommissionModelVersionRoute(
        requestWithCookie(
          `http://localhost/api/admin/commission-models/${commissionModelId}/versions/${versionId}`,
          token,
          { method: "PATCH", body: JSON.stringify({ currency: "CHF" }) },
        ),
        routeParams({ id: commissionModelId, versionId }),
      );
      expect(response.status).toBe(409);
    });

    it("PATCH .../versions/:versionId mit Amount/Percentage-Verstoss -> 422", async () => {
      const tenantId = await createTenant("http-422-patch");
      const actorUserId = await createUser(tenantId, "actor");
      const productId = await createProduct(tenantId, "p");
      const { commissionModelId, versionId } = await createCommissionModelWithVersion(
        tenantId,
        productId,
        "cm",
        { status: "DRAFT", commissionType: "FLAT", commissionAmountMinor: 1_000 },
      );
      const token = createSessionToken({
        ...baseSessionPayload(tenantId, actorUserId),
        configPermissions: ["config.commissions.edit"],
      });
      const response = await patchCommissionModelVersionRoute(
        requestWithCookie(
          `http://localhost/api/admin/commission-models/${commissionModelId}/versions/${versionId}`,
          token,
          { method: "PATCH", body: JSON.stringify({ commissionType: "PERCENTAGE" }) },
        ),
        routeParams({ id: commissionModelId, versionId }),
      );
      expect(response.status).toBe(422);
    });

    it("PATCH .../versions/:versionId mit ungueltigem Body (falscher Typ) -> 400", async () => {
      const tenantId = await createTenant("http-400-patch");
      const actorUserId = await createUser(tenantId, "actor");
      const productId = await createProduct(tenantId, "p");
      const { commissionModelId, versionId } = await createCommissionModelWithVersion(
        tenantId,
        productId,
        "cm",
        { status: "DRAFT" },
      );
      const token = createSessionToken({
        ...baseSessionPayload(tenantId, actorUserId),
        configPermissions: ["config.commissions.edit"],
      });
      const response = await patchCommissionModelVersionRoute(
        requestWithCookie(
          `http://localhost/api/admin/commission-models/${commissionModelId}/versions/${versionId}`,
          token,
          { method: "PATCH", body: JSON.stringify({ currency: "TOOLONG" }) },
        ),
        routeParams({ id: commissionModelId, versionId }),
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

    it("updateCommissionModelVersionFields() schreibt einen AuditLog-Eintrag (action UPDATE, changedFields nur die Feldnamen)", async () => {
      const tenantId = await createTenant("audit-update");
      const actorUserId = await createUser(tenantId, "actor");
      const productId = await createProduct(tenantId, "p");
      const { commissionModelId, versionId } = await createCommissionModelWithVersion(
        tenantId,
        productId,
        "cm",
        { status: "DRAFT" },
      );
      await runWithTenantContext(
        { tenantId, userId: actorUserId, roles: [], managementScope: null },
        () => updateCommissionModelVersionFields(commissionModelId, versionId, { currency: "CHF" }),
      );
      const auditEntries = await rawClient.auditLog.findMany({
        where: {
          tenantId,
          entityType: "CommissionModelVersion",
          entityId: versionId,
          action: "UPDATE",
        },
      });
      expect(auditEntries).toHaveLength(1);
      expect(auditEntries[0]?.actorUserId).toBe(actorUserId);
      expect(auditEntries[0]?.metadata).toMatchObject({ changedFields: ["currency"] });
    });

    it("updateCommissionModelVersionFields() OHNE tatsaechliche Feldaenderungen (leerer Patch) schreibt KEINEN AuditLog-Eintrag", async () => {
      const tenantId = await createTenant("audit-empty-patch");
      const actorUserId = await createUser(tenantId, "actor");
      const productId = await createProduct(tenantId, "p");
      const { commissionModelId, versionId } = await createCommissionModelWithVersion(
        tenantId,
        productId,
        "cm",
        { status: "DRAFT" },
      );
      await runWithTenantContext(
        { tenantId, userId: actorUserId, roles: [], managementScope: null },
        () => updateCommissionModelVersionFields(commissionModelId, versionId, {}),
      );
      const auditEntries = await rawClient.auditLog.findMany({
        where: {
          tenantId,
          entityType: "CommissionModelVersion",
          entityId: versionId,
          action: "UPDATE",
        },
      });
      expect(auditEntries).toHaveLength(0);
    });
  });
});
