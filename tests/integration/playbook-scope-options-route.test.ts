/**
 * Integrationstest fuer `GET /api/admin/playbooks/scope-options` (Phase 14
 * AP6, siehe project_ki_cross_phase14_ap5_status.md, ChatGPT-GO
 * 2026-08-31).
 *
 * Die eigentliche Fachlogik (`listPlaybookScopeOptions()`) ist bewusst
 * NICHT in einer separaten Service-Testdatei dupliziert -- diese Datei
 * deckt sowohl die Fachlogik als auch die duenne Route-Huelle in EINEM
 * Test ab (identisches Muster wie der scope-options-Teil von
 * `campaign-admin-version-routes.test.ts`, Phase 13 AP6): RBAC
 * (`config.playbooks.view`), Query-Parameter-Validierung (`scopeType`),
 * korrekte HTTP-Statuscode-/Body-Abbildung und Cross-Tenant-Isolation
 * (`STORE`-Picker liefert nur Stores DES EIGENEN Mandanten).
 *
 * `GET/PATCH .../versions/[versionId]`, `.../validate` und `.../publish`
 * sind bereits vollstaendig in `playbook-admin-version-routes.test.ts`
 * (AP3) HTTP-getestet -- diese Datei deckt AUSSCHLIESSLICH die in AP6 neu
 * hinzugekommene `scope-options`-Route ab.
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
import { GET as scopeOptionsRoute } from "@/app/api/admin/playbooks/scope-options/route";

const hasDatabaseUrl = Boolean(process.env.DATABASE_URL);
process.env.DEV_AUTH_SECRET ??= "ap6-playbook-scope-options-route-test-secret-not-for-prod";

describe.skipIf(!hasDatabaseUrl)(
  "Phase 14 AP6: HTTP-Route GET /api/admin/playbooks/scope-options",
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
        consultationPermissions: [],
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

    async function createCompany(tenantId: string, key: string) {
      const company = await rawClient.company.create({
        data: { tenantId, key: `${key}-${suffix}`, name: `Company ${key}` },
      });
      return company.id;
    }

    async function createStore(tenantId: string, companyId: string, key: string, name: string) {
      const store = await rawClient.store.create({
        data: { tenantId, companyId, key: `${key}-${suffix}`, name },
      });
      return store.id;
    }

    function requestWithCookie(url: string, token: string) {
      return new NextRequest(url, {
        headers: new Headers({ cookie: `${SESSION_COOKIE_NAME}=${token}` }),
      });
    }

    it("kein Session-Cookie -> 401", async () => {
      const response = await scopeOptionsRoute(
        new NextRequest("http://localhost/api/admin/playbooks/scope-options?scopeType=TENANT"),
      );
      expect(response.status).toBe(401);
    });

    it("ohne config.playbooks.view -> 403", async () => {
      const tenantId = await createTenant("http-403");
      const userId = await createUser(tenantId, "actor");
      const token = createSessionToken({
        ...baseSessionPayload(tenantId, userId),
        configPermissions: [],
      });
      const response = await scopeOptionsRoute(
        requestWithCookie(
          "http://localhost/api/admin/playbooks/scope-options?scopeType=TENANT",
          token,
        ),
      );
      expect(response.status).toBe(403);
    });

    it("mit ungueltigem scopeType (z.B. COMPANY, bei Playbooks nicht vorgesehen) -> 400", async () => {
      const tenantId = await createTenant("http-400");
      const userId = await createUser(tenantId, "actor");
      const token = createSessionToken({
        ...baseSessionPayload(tenantId, userId),
        configPermissions: ["config.playbooks.view"],
      });
      const response = await scopeOptionsRoute(
        requestWithCookie(
          "http://localhost/api/admin/playbooks/scope-options?scopeType=COMPANY",
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
        configPermissions: ["config.playbooks.view"],
      });
      const response = await scopeOptionsRoute(
        requestWithCookie("http://localhost/api/admin/playbooks/scope-options", token),
      );
      expect(response.status).toBe(400);
    });

    it("scopeType=TENANT -> 200 mit genau einer Option (der eigene Mandant)", async () => {
      const tenantId = await createTenant("http-200-tenant", "Meine Firma GmbH");
      const userId = await createUser(tenantId, "actor");
      const token = createSessionToken({
        ...baseSessionPayload(tenantId, userId),
        configPermissions: ["config.playbooks.view"],
      });
      const response = await scopeOptionsRoute(
        requestWithCookie(
          "http://localhost/api/admin/playbooks/scope-options?scopeType=TENANT",
          token,
        ),
      );
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.options).toEqual([{ id: tenantId, name: "Meine Firma GmbH" }]);
    });

    it("scopeType=STORE liefert nur Stores DES EIGENEN Mandanten (kein Cross-Tenant-Leck)", async () => {
      const tenantA = await createTenant("http-200-store-a");
      const tenantB = await createTenant("http-200-store-b");
      const companyA = await createCompany(tenantA, "company-a");
      const companyB = await createCompany(tenantB, "company-b");
      await createStore(tenantA, companyA, "store-a", "Filiale A");
      await createStore(tenantB, companyB, "store-b", "Filiale B");

      const userA = await createUser(tenantA, "actor");
      const token = createSessionToken({
        ...baseSessionPayload(tenantA, userA),
        configPermissions: ["config.playbooks.view"],
      });
      const response = await scopeOptionsRoute(
        requestWithCookie(
          "http://localhost/api/admin/playbooks/scope-options?scopeType=STORE",
          token,
        ),
      );
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.options).toHaveLength(1);
      expect(body.options[0].name).toBe("Filiale A");
    });
  },
);
