/**
 * Phase 14 AP3 -- Integrationstest fuer die HTTP-Routen
 * `GET/POST /api/admin/playbooks` und
 * `GET/POST /api/admin/playbooks/[id]/versions` (siehe
 * PHASE_14_IMPLEMENTATION_PLAN.md Abschnitt 3, ChatGPT-GO 2026-08-31).
 *
 * Die eigentliche Fachlogik (`createPlaybook()`/`createDraftPlaybookVersion()`/
 * `listPlaybooks()`/`getPlaybookVersionHistory()`, scopeId-Tenant-Bindung,
 * Concurrency) ist bereits vollstaendig in
 * `tests/integration/playbook-admin.test.ts` (AP2) getestet -- dieser Test
 * deckt AUSSCHLIESSLICH die duenne Route-Huelle ab: RBAC-Durchsetzung
 * (`config.playbooks.view`/`.edit`), korrekte HTTP-Statuscode-/Body-
 * Abbildung und Cross-Tenant-/IDOR-Schutz auf HTTP-Ebene -- analog
 * `tests/integration/campaign-admin-routes.test.ts` (Phase 13 AP3).
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
import {
  GET as listPlaybooksRoute,
  POST as createPlaybookRoute,
} from "@/app/api/admin/playbooks/route";
import {
  GET as listPlaybookVersionsRoute,
  POST as createPlaybookVersionRoute,
} from "@/app/api/admin/playbooks/[id]/versions/route";

const hasDatabaseUrl = Boolean(process.env.DATABASE_URL);
process.env.DEV_AUTH_SECRET ??= "ap3-playbook-admin-routes-test-secret-not-for-prod";

describe.skipIf(!hasDatabaseUrl)("Phase 14 AP3: HTTP-Routen /api/admin/playbooks", () => {
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
      consultationPermissions: [],
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

  function playbookInput(overrides: Record<string, unknown> = {}) {
    // Fixer, nicht-numerischer Key (Praezedenz: campaign-admin-routes.test.ts,
    // CI #120 contact-data-guard-Lehre) -- kein randomUUID()-Hex-Suffix.
    return { key: "p", name: "Testplaybook", ...overrides };
  }

  function tenantVersionInput(tenantId: string, overrides: Record<string, unknown> = {}) {
    return { scopeType: "TENANT", scopeId: tenantId, ...overrides };
  }

  // -------------------------------------------------------------------
  // Kein Session-Cookie -> 401 (Authentifizierung VOR jedem Tenant-/
  // DB-Zugriff, siehe withRequestTenantContext()/AuthenticationError ->
  // http-errors.ts). Analog campaign-admin-routes.test.ts.
  // -------------------------------------------------------------------

  it("GET /api/admin/playbooks ohne Session-Cookie -> 401", async () => {
    const response = await listPlaybooksRoute(
      new NextRequest("http://localhost/api/admin/playbooks"),
    );
    expect(response.status).toBe(401);
  });

  it("POST /api/admin/playbooks ohne Session-Cookie -> 401", async () => {
    const response = await createPlaybookRoute(
      new NextRequest("http://localhost/api/admin/playbooks", {
        method: "POST",
        body: JSON.stringify(playbookInput()),
      }),
    );
    expect(response.status).toBe(401);
  });

  it("GET .../versions ohne Session-Cookie -> 401", async () => {
    const someId = randomUUID();
    const response = await listPlaybookVersionsRoute(
      new NextRequest(`http://localhost/api/admin/playbooks/${someId}/versions`),
      routeParams({ id: someId }),
    );
    expect(response.status).toBe(401);
  });

  it("POST .../versions ohne Session-Cookie -> 401", async () => {
    const someId = randomUUID();
    const response = await createPlaybookVersionRoute(
      new NextRequest(`http://localhost/api/admin/playbooks/${someId}/versions`, {
        method: "POST",
        body: JSON.stringify(tenantVersionInput(randomUUID())),
      }),
      routeParams({ id: someId }),
    );
    expect(response.status).toBe(401);
  });

  // -------------------------------------------------------------------
  // POST /api/admin/playbooks
  // -------------------------------------------------------------------

  it("POST /api/admin/playbooks ohne config.playbooks.edit -> 403", async () => {
    const tenantId = await createTenant("http-403-post");
    const userId = await createUser(tenantId, "actor");
    const token = createSessionToken({
      ...baseSessionPayload(tenantId, userId),
      configPermissions: ["config.playbooks.view"],
    });
    const response = await createPlaybookRoute(
      requestWithCookie("http://localhost/api/admin/playbooks", token, {
        method: "POST",
        body: JSON.stringify(playbookInput()),
      }),
    );
    expect(response.status).toBe(403);
  });

  it("POST /api/admin/playbooks mit gueltiger Eingabe -> 201 mit PlaybookSummary", async () => {
    const tenantId = await createTenant("http-201-post");
    const userId = await createUser(tenantId, "actor");
    const token = createSessionToken({
      ...baseSessionPayload(tenantId, userId),
      configPermissions: ["config.playbooks.edit"],
    });
    const response = await createPlaybookRoute(
      requestWithCookie("http://localhost/api/admin/playbooks", token, {
        method: "POST",
        body: JSON.stringify(
          playbookInput({ key: "einwandbehandlung", name: "Einwandbehandlung" }),
        ),
      }),
    );
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.playbook.key).toBe("einwandbehandlung");
    expect(body.playbook.versions).toEqual([]);
  });

  it("POST /api/admin/playbooks mit strukturell ungueltigem Body (fehlendes key) -> 400", async () => {
    const tenantId = await createTenant("http-400-post");
    const userId = await createUser(tenantId, "actor");
    const token = createSessionToken({
      ...baseSessionPayload(tenantId, userId),
      configPermissions: ["config.playbooks.edit"],
    });
    const response = await createPlaybookRoute(
      requestWithCookie("http://localhost/api/admin/playbooks", token, {
        method: "POST",
        body: JSON.stringify({ name: "Ohne Key" }),
      }),
    );
    expect(response.status).toBe(400);
  });

  it("POST /api/admin/playbooks mit bereits vergebenem key -> 409", async () => {
    const tenantId = await createTenant("http-409-dup");
    const userId = await createUser(tenantId, "actor");
    const token = createSessionToken({
      ...baseSessionPayload(tenantId, userId),
      configPermissions: ["config.playbooks.edit"],
    });
    const input = playbookInput({ key: "dup-key" });
    const first = await createPlaybookRoute(
      requestWithCookie("http://localhost/api/admin/playbooks", token, {
        method: "POST",
        body: JSON.stringify(input),
      }),
    );
    expect(first.status).toBe(201);
    const second = await createPlaybookRoute(
      requestWithCookie("http://localhost/api/admin/playbooks", token, {
        method: "POST",
        body: JSON.stringify(input),
      }),
    );
    expect(second.status).toBe(409);
  });

  // -------------------------------------------------------------------
  // GET /api/admin/playbooks
  // -------------------------------------------------------------------

  it("GET /api/admin/playbooks mit config.playbooks.view -> 200 mit Liste", async () => {
    const tenantId = await createTenant("http-200-list");
    const userId = await createUser(tenantId, "actor");
    const editToken = createSessionToken({
      ...baseSessionPayload(tenantId, userId),
      configPermissions: ["config.playbooks.edit"],
    });
    await createPlaybookRoute(
      requestWithCookie("http://localhost/api/admin/playbooks", editToken, {
        method: "POST",
        body: JSON.stringify(playbookInput()),
      }),
    );
    const viewToken = createSessionToken({
      ...baseSessionPayload(tenantId, userId),
      configPermissions: ["config.playbooks.view"],
    });
    const response = await listPlaybooksRoute(
      requestWithCookie("http://localhost/api/admin/playbooks", viewToken),
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.playbooks.length).toBeGreaterThanOrEqual(1);
  });

  it("GET /api/admin/playbooks ohne config.playbooks.view -> 403", async () => {
    const tenantId = await createTenant("http-403-list");
    const userId = await createUser(tenantId, "actor");
    const token = createSessionToken({
      ...baseSessionPayload(tenantId, userId),
      configPermissions: [],
    });
    const response = await listPlaybooksRoute(
      requestWithCookie("http://localhost/api/admin/playbooks", token),
    );
    expect(response.status).toBe(403);
  });

  // -------------------------------------------------------------------
  // GET/POST /api/admin/playbooks/[id]/versions
  // -------------------------------------------------------------------

  it("POST .../versions ohne config.playbooks.edit -> 403", async () => {
    const tenantId = await createTenant("http-403-version");
    const userId = await createUser(tenantId, "actor");
    const editToken = createSessionToken({
      ...baseSessionPayload(tenantId, userId),
      configPermissions: ["config.playbooks.edit"],
    });
    const createResponse = await createPlaybookRoute(
      requestWithCookie("http://localhost/api/admin/playbooks", editToken, {
        method: "POST",
        body: JSON.stringify(playbookInput()),
      }),
    );
    const { playbook } = await createResponse.json();

    const viewToken = createSessionToken({
      ...baseSessionPayload(tenantId, userId),
      configPermissions: ["config.playbooks.view"],
    });
    const response = await createPlaybookVersionRoute(
      requestWithCookie(`http://localhost/api/admin/playbooks/${playbook.id}/versions`, viewToken, {
        method: "POST",
        body: JSON.stringify(tenantVersionInput(tenantId)),
      }),
      routeParams({ id: playbook.id }),
    );
    expect(response.status).toBe(403);
  });

  it("POST .../versions mit strukturell ungueltigem Body (fehlendes scopeType) -> 400", async () => {
    const tenantId = await createTenant("http-400-version");
    const userId = await createUser(tenantId, "actor");
    const editToken = createSessionToken({
      ...baseSessionPayload(tenantId, userId),
      configPermissions: ["config.playbooks.edit"],
    });
    const createResponse = await createPlaybookRoute(
      requestWithCookie("http://localhost/api/admin/playbooks", editToken, {
        method: "POST",
        body: JSON.stringify(playbookInput()),
      }),
    );
    const { playbook } = await createResponse.json();

    const response = await createPlaybookVersionRoute(
      requestWithCookie(`http://localhost/api/admin/playbooks/${playbook.id}/versions`, editToken, {
        method: "POST",
        body: JSON.stringify({ scopeId: tenantId }),
      }),
      routeParams({ id: playbook.id }),
    );
    expect(response.status).toBe(400);
  });

  it("POST .../versions mit STORE-scopeId eines FREMDEN Mandanten -> 422 (IDOR-Schutz, kein Vertrauen auf Client-scopeId)", async () => {
    const tenantId = await createTenant("http-422-idor");
    const otherTenantId = await createTenant("http-422-idor-other");
    const userId = await createUser(tenantId, "actor");
    const otherCompanyId = await createCompany(otherTenantId, "co");
    const foreignStoreId = await createStore(otherTenantId, otherCompanyId, "s1");
    const editToken = createSessionToken({
      ...baseSessionPayload(tenantId, userId),
      configPermissions: ["config.playbooks.edit"],
    });
    const createResponse = await createPlaybookRoute(
      requestWithCookie("http://localhost/api/admin/playbooks", editToken, {
        method: "POST",
        body: JSON.stringify(playbookInput()),
      }),
    );
    const { playbook } = await createResponse.json();

    const response = await createPlaybookVersionRoute(
      requestWithCookie(`http://localhost/api/admin/playbooks/${playbook.id}/versions`, editToken, {
        method: "POST",
        body: JSON.stringify({ scopeType: "STORE", scopeId: foreignStoreId }),
      }),
      routeParams({ id: playbook.id }),
    );
    expect(response.status).toBe(422);
    const versionCount = await rawClient.playbookVersion.count({
      where: { playbookId: playbook.id },
    });
    expect(versionCount).toBe(0);
  });

  it("POST .../versions mit gueltiger TENANT-Eingabe -> 201, GET .../versions listet die Version", async () => {
    const tenantId = await createTenant("http-201-version");
    const userId = await createUser(tenantId, "actor");
    const editToken = createSessionToken({
      ...baseSessionPayload(tenantId, userId),
      configPermissions: ["config.playbooks.edit"],
    });
    const createResponse = await createPlaybookRoute(
      requestWithCookie("http://localhost/api/admin/playbooks", editToken, {
        method: "POST",
        body: JSON.stringify(playbookInput()),
      }),
    );
    const { playbook } = await createResponse.json();

    const versionResponse = await createPlaybookVersionRoute(
      requestWithCookie(`http://localhost/api/admin/playbooks/${playbook.id}/versions`, editToken, {
        method: "POST",
        body: JSON.stringify(tenantVersionInput(tenantId)),
      }),
      routeParams({ id: playbook.id }),
    );
    expect(versionResponse.status).toBe(201);
    const versionBody = await versionResponse.json();
    expect(versionBody.version.versionNumber).toBe(1);
    expect(versionBody.version.status).toBe("DRAFT");

    const viewToken = createSessionToken({
      ...baseSessionPayload(tenantId, userId),
      configPermissions: ["config.playbooks.view"],
    });
    const listResponse = await listPlaybookVersionsRoute(
      requestWithCookie(`http://localhost/api/admin/playbooks/${playbook.id}/versions`, viewToken),
      routeParams({ id: playbook.id }),
    );
    expect(listResponse.status).toBe(200);
    const listBody = await listResponse.json();
    expect(listBody.versions.length).toBe(1);
  });

  it("GET .../versions fuer eine playbookId aus FREMDEM Mandanten -> 404 (kein Cross-Tenant-Leck)", async () => {
    const tenantA = await createTenant("http-404-get-a");
    const tenantB = await createTenant("http-404-get-b");
    const userB = await createUser(tenantB, "actor");
    const editTokenB = createSessionToken({
      ...baseSessionPayload(tenantB, userB),
      configPermissions: ["config.playbooks.edit"],
    });
    const createResponse = await createPlaybookRoute(
      requestWithCookie("http://localhost/api/admin/playbooks", editTokenB, {
        method: "POST",
        body: JSON.stringify(playbookInput()),
      }),
    );
    const { playbook } = await createResponse.json();

    const userA = await createUser(tenantA, "actor");
    const viewTokenA = createSessionToken({
      ...baseSessionPayload(tenantA, userA),
      configPermissions: ["config.playbooks.view"],
    });
    const response = await listPlaybookVersionsRoute(
      requestWithCookie(`http://localhost/api/admin/playbooks/${playbook.id}/versions`, viewTokenA),
      routeParams({ id: playbook.id }),
    );
    expect(response.status).toBe(404);
  });

  it("POST .../versions fuer eine playbookId aus FREMDEM Mandanten -> 404 (kein Cross-Tenant-Leck)", async () => {
    const tenantA = await createTenant("http-404-post-a");
    const tenantB = await createTenant("http-404-post-b");
    const userB = await createUser(tenantB, "actor");
    const editTokenB = createSessionToken({
      ...baseSessionPayload(tenantB, userB),
      configPermissions: ["config.playbooks.edit"],
    });
    const createResponse = await createPlaybookRoute(
      requestWithCookie("http://localhost/api/admin/playbooks", editTokenB, {
        method: "POST",
        body: JSON.stringify(playbookInput()),
      }),
    );
    const { playbook } = await createResponse.json();

    const userA = await createUser(tenantA, "actor");
    const editTokenA = createSessionToken({
      ...baseSessionPayload(tenantA, userA),
      configPermissions: ["config.playbooks.edit"],
    });
    const response = await createPlaybookVersionRoute(
      requestWithCookie(
        `http://localhost/api/admin/playbooks/${playbook.id}/versions`,
        editTokenA,
        {
          method: "POST",
          body: JSON.stringify(tenantVersionInput(tenantA)),
        },
      ),
      routeParams({ id: playbook.id }),
    );
    expect(response.status).toBe(404);
  });
});
