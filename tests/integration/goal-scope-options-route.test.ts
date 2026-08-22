/**
 * Integrationstest fuer `GET /api/admin/goals/scope-options` (Phase 11 AP6,
 * siehe PHASE_11_IMPLEMENTATION_PLAN.md Abschnitt 9, ChatGPT-GO 2026-08-22
 * nach AP6-Discovery).
 *
 * Die eigentliche Fachlogik (`listGoalScopeOptions()`) ist bereits
 * vollstaendig in `tests/integration/goal-scope-options.test.ts` getestet --
 * dieser Test deckt AUSSCHLIESSLICH die duenne Route-Huelle ab: RBAC
 * (`config.goals.view`), Query-Parameter-Validierung (`scopeType`) und
 * korrekte HTTP-Statuscode-/Body-Abbildung -- analog
 * `goal-admin-routes.test.ts` (AP3).
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
import { GET as scopeOptionsRoute } from "@/app/api/admin/goals/scope-options/route";

const hasDatabaseUrl = Boolean(process.env.DATABASE_URL);
process.env.DEV_AUTH_SECRET ??= "ap6-goal-scope-options-route-test-secret-not-for-prod";

describe.skipIf(!hasDatabaseUrl)(
  "Phase 11 AP6: HTTP-Route GET /api/admin/goals/scope-options",
  () => {
    const rawClient = new PrismaClient();
    const suffix = randomUUID().slice(0, 8);

    afterAll(async () => {
      await rawClient.$disconnect();
    });

    function baseSessionPayload(
      tenantId: string,
      userId: string,
    ): Omit<SessionPayload, "issuedAt"> {
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

    async function createTenant(key: string, name?: string) {
      const tenant = await rawClient.tenant.create({
        data: { key: `${key}-${suffix}`, name: name ?? `Test ${key}`, isSynthetic: true },
      });
      return tenant.id;
    }

    async function createUser(tenantId: string, key: string) {
      const user = await rawClient.user.create({
        data: { tenantId, email: `${key}-${suffix}@example-synthetic.test`, isSynthetic: true },
      });
      return user.id;
    }

    async function createCompany(tenantId: string, key: string, name: string) {
      const company = await rawClient.company.create({
        data: { tenantId, key: `${key}-${suffix}`, name },
      });
      return company.id;
    }

    function requestWithCookie(url: string, token: string) {
      return new NextRequest(url, {
        headers: new Headers({ cookie: `${SESSION_COOKIE_NAME}=${token}` }),
      });
    }

    it("AP9: kein Session-Cookie -> 401", async () => {
      const response = await scopeOptionsRoute(
        new NextRequest("http://localhost/api/admin/goals/scope-options?scopeType=TENANT"),
      );
      expect(response.status).toBe(401);
    });

    it("ohne config.goals.view -> 403", async () => {
      const tenantId = await createTenant("http-403");
      const userId = await createUser(tenantId, "actor");
      const token = createSessionToken({
        ...baseSessionPayload(tenantId, userId),
        configPermissions: [],
      });
      const response = await scopeOptionsRoute(
        requestWithCookie(
          "http://localhost/api/admin/goals/scope-options?scopeType=COMPANY",
          token,
        ),
      );
      expect(response.status).toBe(403);
    });

    it("mit ungueltigem scopeType -> 400", async () => {
      const tenantId = await createTenant("http-400");
      const userId = await createUser(tenantId, "actor");
      const token = createSessionToken({
        ...baseSessionPayload(tenantId, userId),
        configPermissions: ["config.goals.view"],
      });
      const response = await scopeOptionsRoute(
        requestWithCookie(
          "http://localhost/api/admin/goals/scope-options?scopeType=NOT_A_TYPE",
          token,
        ),
      );
      expect(response.status).toBe(400);
    });

    it("ohne scopeType-Parameter -> 400", async () => {
      const tenantId = await createTenant("http-400-missing");
      const userId = await createUser(tenantId, "actor");
      const token = createSessionToken({
        ...baseSessionPayload(tenantId, userId),
        configPermissions: ["config.goals.view"],
      });
      const response = await scopeOptionsRoute(
        requestWithCookie("http://localhost/api/admin/goals/scope-options", token),
      );
      expect(response.status).toBe(400);
    });

    it("scopeType=TENANT mit config.goals.view -> 200 mit genau einer Option (der eigene Mandant)", async () => {
      const tenantId = await createTenant("http-200-tenant", "Meine Firma GmbH");
      const userId = await createUser(tenantId, "actor");
      const token = createSessionToken({
        ...baseSessionPayload(tenantId, userId),
        configPermissions: ["config.goals.view"],
      });
      const response = await scopeOptionsRoute(
        requestWithCookie("http://localhost/api/admin/goals/scope-options?scopeType=TENANT", token),
      );
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.options).toEqual([{ id: tenantId, name: "Meine Firma GmbH" }]);
    });

    it("scopeType=COMPANY liefert nur Companies DES EIGENEN Mandanten (kein Cross-Tenant-Leck)", async () => {
      const tenantA = await createTenant("http-200-company-a");
      const tenantB = await createTenant("http-200-company-b");
      await createCompany(tenantA, "company-a", "Firma A");
      await createCompany(tenantB, "company-b", "Firma B");

      const userA = await createUser(tenantA, "actor");
      const token = createSessionToken({
        ...baseSessionPayload(tenantA, userA),
        configPermissions: ["config.goals.view"],
      });
      const response = await scopeOptionsRoute(
        requestWithCookie(
          "http://localhost/api/admin/goals/scope-options?scopeType=COMPANY",
          token,
        ),
      );
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.options).toHaveLength(1);
      expect(body.options[0].name).toBe("Firma A");
    });
  },
);
