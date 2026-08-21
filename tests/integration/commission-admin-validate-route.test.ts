/**
 * Phase 10 AP8 -- Integrationstest fuer die HTTP-Route
 * `POST /api/admin/commission-models/[id]/versions/[versionId]/validate`
 * (siehe PHASE_10_IMPLEMENTATION_PLAN.md Abschnitt 9, ChatGPT-GO 2026-08-22).
 *
 * Die eigentliche Validierungslogik (`validateCommissionModelVersion()`,
 * AP4) ist bereits vollstaendig in
 * `tests/integration/commission-admin.test.ts` Abschnitt "5. Validator
 * (AP4)" getestet -- dieser Test deckt AUSSCHLIESSLICH die duenne
 * Route-Huelle ab: RBAC-Durchsetzung (`config.commissions.edit`) sowie die
 * korrekte HTTP-Statuscode-/Body-Abbildung (200/{valid:true} vs.
 * 422/{issues:[...]}), analog `tests/integration/rule-admin-validate.test.ts`
 * Abschnitt "HTTP-Kette" (Phase 9 AP4).
 *
 * Ohne DATABASE_URL wird die gesamte Suite uebersprungen statt fehlzuschlagen.
 */

import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { NextRequest } from "next/server";
import { afterAll, describe, expect, it } from "vitest";
import {
  createSessionToken,
  SESSION_COOKIE_NAME,
  type SessionPayload,
} from "@/server/auth/session";
import { POST as validateCommissionModelVersionRoute } from "@/app/api/admin/commission-models/[id]/versions/[versionId]/validate/route";

const hasDatabaseUrl = Boolean(process.env.DATABASE_URL);
process.env.DEV_AUTH_SECRET ??= "ap8-commission-admin-validate-route-test-secret-not-for-prod";

describe.skipIf(!hasDatabaseUrl)(
  "Phase 10 AP8: HTTP-Route .../validate (Commission Models)",
  () => {
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
      };
    }

    async function createTenant(key: string) {
      const tenant = await rawClient.tenant.create({
        data: { key: `${key}-${suffix}`, name: `Test ${key}`, isSynthetic: true },
      });
      return tenant.id;
    }

    async function createProduct(tenantId: string, key: string) {
      const provider = await rawClient.provider.create({
        data: {
          key: `provider-${key}-${suffix}-${randomUUID().slice(0, 8)}`,
          name: `Provider ${key}`,
          isSynthetic: true,
        },
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
      return product.id;
    }

    async function createDraftCommissionModelVersionRaw(
      tenantId: string,
      productId: string,
      key: string,
      overrides: Partial<{ commissionAmountMinor: number | null }> = {},
    ) {
      const commissionModel = await rawClient.commissionModel.create({
        data: { tenantId, productId, name: `Modell ${key}` },
      });
      const version = await rawClient.commissionModelVersion.create({
        data: {
          tenantId,
          commissionModelId: commissionModel.id,
          versionNumber: 1,
          status: "DRAFT",
          validFrom: new Date(),
          validTo: null,
          commissionType: "FLAT",
          currency: "EUR",
          commissionAmountMinor:
            overrides.commissionAmountMinor !== undefined ? overrides.commissionAmountMinor : 1_500,
        },
      });
      return { commissionModelId: commissionModel.id, versionId: version.id };
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

    it("POST .../validate ohne config.commissions.edit -> 403", async () => {
      const tenantId = await createTenant("http-403");
      const productId = await createProduct(tenantId, "p");
      const { commissionModelId, versionId } = await createDraftCommissionModelVersionRaw(
        tenantId,
        productId,
        "cm",
      );
      const token = createSessionToken({
        ...baseSessionPayload(tenantId),
        configPermissions: ["config.commissions.view"],
      });
      const response = await validateCommissionModelVersionRoute(
        requestWithCookie(
          `http://localhost/api/admin/commission-models/${commissionModelId}/versions/${versionId}/validate`,
          token,
        ),
        routeParams({ id: commissionModelId, versionId }),
      );
      expect(response.status).toBe(403);
    });

    it("POST .../validate fuer ungueltigen Draft (commissionAmountMinor fehlt bei FLAT) -> 422 {issues:[...]}", async () => {
      const tenantId = await createTenant("http-422");
      const productId = await createProduct(tenantId, "p");
      const { commissionModelId, versionId } = await createDraftCommissionModelVersionRaw(
        tenantId,
        productId,
        "cm",
        { commissionAmountMinor: null },
      );
      const token = createSessionToken({
        ...baseSessionPayload(tenantId),
        configPermissions: ["config.commissions.edit"],
      });
      const response = await validateCommissionModelVersionRoute(
        requestWithCookie(
          `http://localhost/api/admin/commission-models/${commissionModelId}/versions/${versionId}/validate`,
          token,
        ),
        routeParams({ id: commissionModelId, versionId }),
      );
      expect(response.status).toBe(422);
      const body = await response.json();
      expect(Array.isArray(body.issues)).toBe(true);
      expect(body.issues.length).toBeGreaterThan(0);
    });

    it("POST .../validate fuer gueltigen Draft -> 200 {valid: true}", async () => {
      const tenantId = await createTenant("http-200");
      const productId = await createProduct(tenantId, "p");
      const { commissionModelId, versionId } = await createDraftCommissionModelVersionRaw(
        tenantId,
        productId,
        "cm",
      );
      const token = createSessionToken({
        ...baseSessionPayload(tenantId),
        configPermissions: ["config.commissions.edit"],
      });
      const response = await validateCommissionModelVersionRoute(
        requestWithCookie(
          `http://localhost/api/admin/commission-models/${commissionModelId}/versions/${versionId}/validate`,
          token,
        ),
        routeParams({ id: commissionModelId, versionId }),
      );
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body).toEqual({ valid: true });
    });

    it("POST .../validate mit commissionModelId aus FREMDEM Mandanten -> 404", async () => {
      const tenantA = await createTenant("http-cross-a");
      const tenantB = await createTenant("http-cross-b");
      const productIdB = await createProduct(tenantB, "p");
      const { commissionModelId, versionId } = await createDraftCommissionModelVersionRaw(
        tenantB,
        productIdB,
        "cm",
      );
      const token = createSessionToken({
        ...baseSessionPayload(tenantA),
        configPermissions: ["config.commissions.edit"],
      });
      const response = await validateCommissionModelVersionRoute(
        requestWithCookie(
          `http://localhost/api/admin/commission-models/${commissionModelId}/versions/${versionId}/validate`,
          token,
        ),
        routeParams({ id: commissionModelId, versionId }),
      );
      expect(response.status).toBe(404);
    });
  },
);
