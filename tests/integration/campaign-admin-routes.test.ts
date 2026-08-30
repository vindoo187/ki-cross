/**
 * Phase 13 AP3 -- Integrationstest fuer die HTTP-Routen
 * `GET/POST /api/admin/campaigns` und
 * `GET/POST /api/admin/campaigns/[id]/versions` (siehe
 * PHASE_13_IMPLEMENTATION_PLAN.md Abschnitt 3, ChatGPT-GO 2026-08-24).
 *
 * Die eigentliche Fachlogik (`createCampaign()`/`createDraftCampaignVersion()`/
 * `listCampaigns()`/`getCampaignVersionHistory()`, scopeId-Tenant-Bindung,
 * Concurrency, Condition-Validierung) ist bereits vollstaendig in
 * `tests/integration/campaign-admin.test.ts` (AP2) getestet -- dieser Test
 * deckt AUSSCHLIESSLICH die duenne Route-Huelle ab: RBAC-Durchsetzung
 * (`config.campaigns.view`/`.edit`), korrekte HTTP-Statuscode-/Body-
 * Abbildung und Cross-Tenant-/IDOR-Schutz auf HTTP-Ebene -- analog
 * `tests/integration/goal-admin-routes.test.ts` (Phase 11 AP3).
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
  GET as listCampaignsRoute,
  POST as createCampaignRoute,
} from "@/app/api/admin/campaigns/route";
import {
  GET as listCampaignVersionsRoute,
  POST as createCampaignVersionRoute,
} from "@/app/api/admin/campaigns/[id]/versions/route";

const hasDatabaseUrl = Boolean(process.env.DATABASE_URL);
process.env.DEV_AUTH_SECRET ??= "ap3-campaign-admin-routes-test-secret-not-for-prod";

describe.skipIf(!hasDatabaseUrl)("Phase 13 AP3: HTTP-Routen /api/admin/campaigns", () => {
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

  function campaignInput(overrides: Record<string, unknown> = {}) {
    // Fixer, nicht-numerischer Key (Praezedenz: campaign-admin.test.ts) --
    // KEIN randomUUID()-Hex-Suffix: ein rein numerischer Zufalls-Slice kann
    // den PHONE_REGEX-Heuristik-Check in contact-data-guard.ts ausloesen
    // (Wert "sieht wie eine Telefonnummer aus"), sobald der Campaign-Key im
    // AuditLog.metadata landet (CI #120, flaky ~3.6% der Laeufe). Jeder Test
    // erstellt ohnehin einen frischen Tenant, ein fixer Key reicht.
    return { key: "c", name: "Testkampagne", ...overrides };
  }

  function tenantVersionInput(tenantId: string, overrides: Record<string, unknown> = {}) {
    return { scopeType: "TENANT", scopeId: tenantId, ...overrides };
  }

  // -------------------------------------------------------------------
  // Kein Session-Cookie -> 401 (Authentifizierung VOR jedem Tenant-/
  // DB-Zugriff, siehe withRequestTenantContext()/AuthenticationError ->
  // http-errors.ts). Analog goal-admin-routes.test.ts.
  // -------------------------------------------------------------------

  it("GET /api/admin/campaigns ohne Session-Cookie -> 401", async () => {
    const response = await listCampaignsRoute(
      new NextRequest("http://localhost/api/admin/campaigns"),
    );
    expect(response.status).toBe(401);
  });

  it("POST /api/admin/campaigns ohne Session-Cookie -> 401", async () => {
    const response = await createCampaignRoute(
      new NextRequest("http://localhost/api/admin/campaigns", {
        method: "POST",
        body: JSON.stringify(campaignInput()),
      }),
    );
    expect(response.status).toBe(401);
  });

  it("GET .../versions ohne Session-Cookie -> 401", async () => {
    const someId = randomUUID();
    const response = await listCampaignVersionsRoute(
      new NextRequest(`http://localhost/api/admin/campaigns/${someId}/versions`),
      routeParams({ id: someId }),
    );
    expect(response.status).toBe(401);
  });

  it("POST .../versions ohne Session-Cookie -> 401", async () => {
    const someId = randomUUID();
    const response = await createCampaignVersionRoute(
      new NextRequest(`http://localhost/api/admin/campaigns/${someId}/versions`, {
        method: "POST",
        body: JSON.stringify(tenantVersionInput(randomUUID())),
      }),
      routeParams({ id: someId }),
    );
    expect(response.status).toBe(401);
  });

  // -------------------------------------------------------------------
  // POST /api/admin/campaigns
  // -------------------------------------------------------------------

  it("POST /api/admin/campaigns ohne config.campaigns.edit -> 403", async () => {
    const tenantId = await createTenant("http-403-post");
    const userId = await createUser(tenantId, "actor");
    const token = createSessionToken({
      ...baseSessionPayload(tenantId, userId),
      configPermissions: ["config.campaigns.view"],
    });
    const response = await createCampaignRoute(
      requestWithCookie("http://localhost/api/admin/campaigns", token, {
        method: "POST",
        body: JSON.stringify(campaignInput()),
      }),
    );
    expect(response.status).toBe(403);
  });

  it("POST /api/admin/campaigns mit gueltiger Eingabe -> 201 mit CampaignSummary", async () => {
    const tenantId = await createTenant("http-201-post");
    const userId = await createUser(tenantId, "actor");
    const token = createSessionToken({
      ...baseSessionPayload(tenantId, userId),
      configPermissions: ["config.campaigns.edit"],
    });
    const response = await createCampaignRoute(
      requestWithCookie("http://localhost/api/admin/campaigns", token, {
        method: "POST",
        body: JSON.stringify(campaignInput({ key: "summer-sale", name: "Sommeraktion" })),
      }),
    );
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.campaign.key).toBe("summer-sale");
    expect(body.campaign.versions).toEqual([]);
  });

  it("POST /api/admin/campaigns mit strukturell ungueltigem Body (fehlendes key) -> 400", async () => {
    const tenantId = await createTenant("http-400-post");
    const userId = await createUser(tenantId, "actor");
    const token = createSessionToken({
      ...baseSessionPayload(tenantId, userId),
      configPermissions: ["config.campaigns.edit"],
    });
    const response = await createCampaignRoute(
      requestWithCookie("http://localhost/api/admin/campaigns", token, {
        method: "POST",
        body: JSON.stringify({ name: "Ohne Key" }),
      }),
    );
    expect(response.status).toBe(400);
  });

  it("POST /api/admin/campaigns mit bereits vergebenem key -> 409", async () => {
    const tenantId = await createTenant("http-409-dup");
    const userId = await createUser(tenantId, "actor");
    const token = createSessionToken({
      ...baseSessionPayload(tenantId, userId),
      configPermissions: ["config.campaigns.edit"],
    });
    const input = campaignInput({ key: "dup-key" });
    const first = await createCampaignRoute(
      requestWithCookie("http://localhost/api/admin/campaigns", token, {
        method: "POST",
        body: JSON.stringify(input),
      }),
    );
    expect(first.status).toBe(201);
    const second = await createCampaignRoute(
      requestWithCookie("http://localhost/api/admin/campaigns", token, {
        method: "POST",
        body: JSON.stringify(input),
      }),
    );
    expect(second.status).toBe(409);
  });

  // -------------------------------------------------------------------
  // GET /api/admin/campaigns
  // -------------------------------------------------------------------

  it("GET /api/admin/campaigns mit config.campaigns.view -> 200 mit Liste", async () => {
    const tenantId = await createTenant("http-200-list");
    const userId = await createUser(tenantId, "actor");
    const editToken = createSessionToken({
      ...baseSessionPayload(tenantId, userId),
      configPermissions: ["config.campaigns.edit"],
    });
    await createCampaignRoute(
      requestWithCookie("http://localhost/api/admin/campaigns", editToken, {
        method: "POST",
        body: JSON.stringify(campaignInput()),
      }),
    );
    const viewToken = createSessionToken({
      ...baseSessionPayload(tenantId, userId),
      configPermissions: ["config.campaigns.view"],
    });
    const response = await listCampaignsRoute(
      requestWithCookie("http://localhost/api/admin/campaigns", viewToken),
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.campaigns.length).toBeGreaterThanOrEqual(1);
  });

  it("GET /api/admin/campaigns ohne config.campaigns.view -> 403", async () => {
    const tenantId = await createTenant("http-403-list");
    const userId = await createUser(tenantId, "actor");
    const token = createSessionToken({
      ...baseSessionPayload(tenantId, userId),
      configPermissions: [],
    });
    const response = await listCampaignsRoute(
      requestWithCookie("http://localhost/api/admin/campaigns", token),
    );
    expect(response.status).toBe(403);
  });

  // -------------------------------------------------------------------
  // GET/POST /api/admin/campaigns/[id]/versions
  // -------------------------------------------------------------------

  it("POST .../versions ohne config.campaigns.edit -> 403", async () => {
    const tenantId = await createTenant("http-403-version");
    const userId = await createUser(tenantId, "actor");
    const editToken = createSessionToken({
      ...baseSessionPayload(tenantId, userId),
      configPermissions: ["config.campaigns.edit"],
    });
    const createResponse = await createCampaignRoute(
      requestWithCookie("http://localhost/api/admin/campaigns", editToken, {
        method: "POST",
        body: JSON.stringify(campaignInput()),
      }),
    );
    const { campaign } = await createResponse.json();

    const viewToken = createSessionToken({
      ...baseSessionPayload(tenantId, userId),
      configPermissions: ["config.campaigns.view"],
    });
    const response = await createCampaignVersionRoute(
      requestWithCookie(`http://localhost/api/admin/campaigns/${campaign.id}/versions`, viewToken, {
        method: "POST",
        body: JSON.stringify(tenantVersionInput(tenantId)),
      }),
      routeParams({ id: campaign.id }),
    );
    expect(response.status).toBe(403);
  });

  it("POST .../versions mit strukturell ungueltigem Body (fehlendes scopeType) -> 400", async () => {
    const tenantId = await createTenant("http-400-version");
    const userId = await createUser(tenantId, "actor");
    const editToken = createSessionToken({
      ...baseSessionPayload(tenantId, userId),
      configPermissions: ["config.campaigns.edit"],
    });
    const createResponse = await createCampaignRoute(
      requestWithCookie("http://localhost/api/admin/campaigns", editToken, {
        method: "POST",
        body: JSON.stringify(campaignInput()),
      }),
    );
    const { campaign } = await createResponse.json();

    const response = await createCampaignVersionRoute(
      requestWithCookie(`http://localhost/api/admin/campaigns/${campaign.id}/versions`, editToken, {
        method: "POST",
        body: JSON.stringify({ scopeId: tenantId }),
      }),
      routeParams({ id: campaign.id }),
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
      configPermissions: ["config.campaigns.edit"],
    });
    const createResponse = await createCampaignRoute(
      requestWithCookie("http://localhost/api/admin/campaigns", editToken, {
        method: "POST",
        body: JSON.stringify(campaignInput()),
      }),
    );
    const { campaign } = await createResponse.json();

    const response = await createCampaignVersionRoute(
      requestWithCookie(`http://localhost/api/admin/campaigns/${campaign.id}/versions`, editToken, {
        method: "POST",
        body: JSON.stringify({ scopeType: "STORE", scopeId: foreignStoreId }),
      }),
      routeParams({ id: campaign.id }),
    );
    expect(response.status).toBe(422);
    const versionCount = await rawClient.campaignVersion.count({
      where: { campaignId: campaign.id },
    });
    expect(versionCount).toBe(0);
  });

  it("POST .../versions mit gueltiger TENANT-Eingabe -> 201, GET .../versions listet die Version", async () => {
    const tenantId = await createTenant("http-201-version");
    const userId = await createUser(tenantId, "actor");
    const editToken = createSessionToken({
      ...baseSessionPayload(tenantId, userId),
      configPermissions: ["config.campaigns.edit"],
    });
    const createResponse = await createCampaignRoute(
      requestWithCookie("http://localhost/api/admin/campaigns", editToken, {
        method: "POST",
        body: JSON.stringify(campaignInput()),
      }),
    );
    const { campaign } = await createResponse.json();

    const versionResponse = await createCampaignVersionRoute(
      requestWithCookie(`http://localhost/api/admin/campaigns/${campaign.id}/versions`, editToken, {
        method: "POST",
        body: JSON.stringify(tenantVersionInput(tenantId)),
      }),
      routeParams({ id: campaign.id }),
    );
    expect(versionResponse.status).toBe(201);
    const versionBody = await versionResponse.json();
    expect(versionBody.version.versionNumber).toBe(1);
    expect(versionBody.version.status).toBe("DRAFT");

    const viewToken = createSessionToken({
      ...baseSessionPayload(tenantId, userId),
      configPermissions: ["config.campaigns.view"],
    });
    const listResponse = await listCampaignVersionsRoute(
      requestWithCookie(`http://localhost/api/admin/campaigns/${campaign.id}/versions`, viewToken),
      routeParams({ id: campaign.id }),
    );
    expect(listResponse.status).toBe(200);
    const listBody = await listResponse.json();
    expect(listBody.versions.length).toBe(1);
  });

  it("GET .../versions fuer eine campaignId aus FREMDEM Mandanten -> 404 (kein Cross-Tenant-Leck)", async () => {
    const tenantA = await createTenant("http-404-get-a");
    const tenantB = await createTenant("http-404-get-b");
    const userB = await createUser(tenantB, "actor");
    const editTokenB = createSessionToken({
      ...baseSessionPayload(tenantB, userB),
      configPermissions: ["config.campaigns.edit"],
    });
    const createResponse = await createCampaignRoute(
      requestWithCookie("http://localhost/api/admin/campaigns", editTokenB, {
        method: "POST",
        body: JSON.stringify(campaignInput()),
      }),
    );
    const { campaign } = await createResponse.json();

    const userA = await createUser(tenantA, "actor");
    const viewTokenA = createSessionToken({
      ...baseSessionPayload(tenantA, userA),
      configPermissions: ["config.campaigns.view"],
    });
    const response = await listCampaignVersionsRoute(
      requestWithCookie(`http://localhost/api/admin/campaigns/${campaign.id}/versions`, viewTokenA),
      routeParams({ id: campaign.id }),
    );
    expect(response.status).toBe(404);
  });

  it("POST .../versions fuer eine campaignId aus FREMDEM Mandanten -> 404 (kein Cross-Tenant-Leck)", async () => {
    const tenantA = await createTenant("http-404-post-a");
    const tenantB = await createTenant("http-404-post-b");
    const userB = await createUser(tenantB, "actor");
    const editTokenB = createSessionToken({
      ...baseSessionPayload(tenantB, userB),
      configPermissions: ["config.campaigns.edit"],
    });
    const createResponse = await createCampaignRoute(
      requestWithCookie("http://localhost/api/admin/campaigns", editTokenB, {
        method: "POST",
        body: JSON.stringify(campaignInput()),
      }),
    );
    const { campaign } = await createResponse.json();

    const userA = await createUser(tenantA, "actor");
    const editTokenA = createSessionToken({
      ...baseSessionPayload(tenantA, userA),
      configPermissions: ["config.campaigns.edit"],
    });
    const response = await createCampaignVersionRoute(
      requestWithCookie(
        `http://localhost/api/admin/campaigns/${campaign.id}/versions`,
        editTokenA,
        {
          method: "POST",
          body: JSON.stringify(tenantVersionInput(tenantA)),
        },
      ),
      routeParams({ id: campaign.id }),
    );
    expect(response.status).toBe(404);
  });
});
