/**
 * Phase 11 AP3 -- Integrationstest fuer die HTTP-Routen
 * `GET/POST /api/admin/goals`, `GET /api/admin/goals/[id]` und
 * `GET/POST /api/admin/goals/[id]/versions` (siehe
 * PHASE_11_IMPLEMENTATION_PLAN.md Abschnitt 3, ChatGPT-GO 2026-08-22).
 *
 * Die eigentliche Fachlogik (`createGoal()`/`createGoalVersion()`/
 * `listGoals()`/`getGoalDetail()`, Kardinalitaet, scopeId-Tenant-Bindung,
 * Concurrency) ist bereits vollstaendig in
 * `tests/integration/goal-admin.test.ts` (AP2) getestet -- dieser Test
 * deckt AUSSCHLIESSLICH die duenne Route-Huelle ab: RBAC-Durchsetzung
 * (`config.goals.view`/`.edit`), korrekte HTTP-Statuscode-/Body-Abbildung
 * und die Verdrahtung von `goal-validator.ts` (metrikspezifische Zielwert-/
 * Currency-Pruefung VOR der Mutation) -- analog
 * `commission-admin-validate-route.test.ts` (Phase 10 AP8).
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
import { GET as listGoalsRoute, POST as createGoalRoute } from "@/app/api/admin/goals/route";
import { GET as getGoalDetailRoute } from "@/app/api/admin/goals/[id]/route";
import {
  GET as listGoalVersionsRoute,
  POST as createGoalVersionRoute,
} from "@/app/api/admin/goals/[id]/versions/route";

const hasDatabaseUrl = Boolean(process.env.DATABASE_URL);
process.env.DEV_AUTH_SECRET ??= "ap3-goal-admin-routes-test-secret-not-for-prod";

describe.skipIf(!hasDatabaseUrl)("Phase 11 AP3: HTTP-Routen /api/admin/goals", () => {
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

  function tenantGoalInput(tenantId: string, overrides: Record<string, unknown> = {}) {
    return {
      scopeType: "TENANT",
      scopeId: tenantId,
      metricKey: "DEALS_CLOSED",
      periodType: "MONTH",
      periodStart: "2026-08-01T00:00:00.000Z",
      targetCount: 25,
      ...overrides,
    };
  }

  // -------------------------------------------------------------------
  // AP9: kein Session-Cookie -> 401 (Authentifizierung VOR jedem Tenant-/
  // DB-Zugriff, siehe withRequestTenantContext()/AuthenticationError ->
  // http-errors.ts). Analog tests/integration/question-admin.test.ts.
  // Bewusst getrennt von den 403-Faellen unten (dort ist die Session
  // gueltig, es fehlt lediglich die Permission).
  // -------------------------------------------------------------------

  it("GET /api/admin/goals ohne Session-Cookie -> 401", async () => {
    const response = await listGoalsRoute(new NextRequest("http://localhost/api/admin/goals"));
    expect(response.status).toBe(401);
  });

  it("POST /api/admin/goals ohne Session-Cookie -> 401", async () => {
    const response = await createGoalRoute(
      new NextRequest("http://localhost/api/admin/goals", {
        method: "POST",
        body: JSON.stringify(tenantGoalInput(randomUUID())),
      }),
    );
    expect(response.status).toBe(401);
  });

  it("GET /api/admin/goals/[id] ohne Session-Cookie -> 401", async () => {
    const someId = randomUUID();
    const response = await getGoalDetailRoute(
      new NextRequest(`http://localhost/api/admin/goals/${someId}`),
      routeParams({ id: someId }),
    );
    expect(response.status).toBe(401);
  });

  it("GET .../versions ohne Session-Cookie -> 401", async () => {
    const someId = randomUUID();
    const response = await listGoalVersionsRoute(
      new NextRequest(`http://localhost/api/admin/goals/${someId}/versions`),
      routeParams({ id: someId }),
    );
    expect(response.status).toBe(401);
  });

  it("POST .../versions ohne Session-Cookie -> 401", async () => {
    const someId = randomUUID();
    const response = await createGoalVersionRoute(
      new NextRequest(`http://localhost/api/admin/goals/${someId}/versions`, {
        method: "POST",
        body: JSON.stringify({ targetCount: 30 }),
      }),
      routeParams({ id: someId }),
    );
    expect(response.status).toBe(401);
  });

  // -------------------------------------------------------------------
  // POST /api/admin/goals
  // -------------------------------------------------------------------

  it("POST /api/admin/goals ohne config.goals.edit -> 403", async () => {
    const tenantId = await createTenant("http-403-post");
    const userId = await createUser(tenantId, "actor");
    const token = createSessionToken({
      ...baseSessionPayload(tenantId, userId),
      configPermissions: ["config.goals.view"],
    });
    const response = await createGoalRoute(
      requestWithCookie("http://localhost/api/admin/goals", token, {
        method: "POST",
        body: JSON.stringify(tenantGoalInput(tenantId)),
      }),
    );
    expect(response.status).toBe(403);
  });

  it("POST /api/admin/goals mit gueltiger TENANT-Eingabe -> 201 mit GoalDetail", async () => {
    const tenantId = await createTenant("http-201-post");
    const userId = await createUser(tenantId, "actor");
    const token = createSessionToken({
      ...baseSessionPayload(tenantId, userId),
      configPermissions: ["config.goals.edit"],
    });
    const response = await createGoalRoute(
      requestWithCookie("http://localhost/api/admin/goals", token, {
        method: "POST",
        body: JSON.stringify(tenantGoalInput(tenantId)),
      }),
    );
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.goal.scopeType).toBe("TENANT");
    expect(body.goal.currentVersion.targetCount).toBe(25);
  });

  it("POST /api/admin/goals mit strukturell ungueltigem Body (fehlendes scopeType) -> 400", async () => {
    const tenantId = await createTenant("http-400-post");
    const userId = await createUser(tenantId, "actor");
    const token = createSessionToken({
      ...baseSessionPayload(tenantId, userId),
      configPermissions: ["config.goals.edit"],
    });
    const response = await createGoalRoute(
      requestWithCookie("http://localhost/api/admin/goals", token, {
        method: "POST",
        body: JSON.stringify({}),
      }),
    );
    expect(response.status).toBe(400);
  });

  it("POST /api/admin/goals mit falschem Zielwert-Feld fuer metricKey (goal-validator.ts) -> 422 {issues:[...]}", async () => {
    const tenantId = await createTenant("http-422-metric");
    const userId = await createUser(tenantId, "actor");
    const token = createSessionToken({
      ...baseSessionPayload(tenantId, userId),
      configPermissions: ["config.goals.edit"],
    });
    // DEALS_CLOSED, aber targetAmountMinor statt targetCount gesetzt.
    const response = await createGoalRoute(
      requestWithCookie("http://localhost/api/admin/goals", token, {
        method: "POST",
        body: JSON.stringify(
          tenantGoalInput(tenantId, { targetCount: undefined, targetAmountMinor: 5000 }),
        ),
      }),
    );
    expect(response.status).toBe(422);
    const body = await response.json();
    expect(Array.isArray(body.issues)).toBe(true);
    expect(body.issues.length).toBeGreaterThan(0);
  });

  it("POST /api/admin/goals mit REVENUE ohne currency (goal-validator.ts) -> 422", async () => {
    const tenantId = await createTenant("http-422-currency");
    const userId = await createUser(tenantId, "actor");
    const token = createSessionToken({
      ...baseSessionPayload(tenantId, userId),
      configPermissions: ["config.goals.edit"],
    });
    const response = await createGoalRoute(
      requestWithCookie("http://localhost/api/admin/goals", token, {
        method: "POST",
        body: JSON.stringify(
          tenantGoalInput(tenantId, {
            metricKey: "REVENUE",
            targetCount: undefined,
            targetAmountMinor: 500000,
          }),
        ),
      }),
    );
    expect(response.status).toBe(422);
    const body = await response.json();
    expect(body.issues.some((i: string) => i.includes("currency"))).toBe(true);
  });

  it("POST /api/admin/goals mit unbekannter COMPANY-scopeId (goal-admin.ts::validateScopeId) -> 422, kein Goal angelegt", async () => {
    const tenantId = await createTenant("http-422-scope");
    const userId = await createUser(tenantId, "actor");
    const token = createSessionToken({
      ...baseSessionPayload(tenantId, userId),
      configPermissions: ["config.goals.edit"],
    });
    const response = await createGoalRoute(
      requestWithCookie("http://localhost/api/admin/goals", token, {
        method: "POST",
        body: JSON.stringify(
          tenantGoalInput(tenantId, { scopeType: "COMPANY", scopeId: randomUUID() }),
        ),
      }),
    );
    expect(response.status).toBe(422);
    const goalCount = await rawClient.goal.count({ where: { tenantId } });
    expect(goalCount).toBe(0);
  });

  it("POST /api/admin/goals mit identischer Scope/Metrik/Periode-Identitaet ein zweites Mal -> 409", async () => {
    const tenantId = await createTenant("http-409-dup");
    const userId = await createUser(tenantId, "actor");
    const token = createSessionToken({
      ...baseSessionPayload(tenantId, userId),
      configPermissions: ["config.goals.edit"],
    });
    const input = tenantGoalInput(tenantId);
    const first = await createGoalRoute(
      requestWithCookie("http://localhost/api/admin/goals", token, {
        method: "POST",
        body: JSON.stringify(input),
      }),
    );
    expect(first.status).toBe(201);
    const second = await createGoalRoute(
      requestWithCookie("http://localhost/api/admin/goals", token, {
        method: "POST",
        body: JSON.stringify(input),
      }),
    );
    expect(second.status).toBe(409);
  });

  // -------------------------------------------------------------------
  // GET /api/admin/goals, GET /api/admin/goals/[id]
  // -------------------------------------------------------------------

  it("GET /api/admin/goals mit config.goals.view -> 200 mit Liste", async () => {
    const tenantId = await createTenant("http-200-list");
    const userId = await createUser(tenantId, "actor");
    const editToken = createSessionToken({
      ...baseSessionPayload(tenantId, userId),
      configPermissions: ["config.goals.edit"],
    });
    await createGoalRoute(
      requestWithCookie("http://localhost/api/admin/goals", editToken, {
        method: "POST",
        body: JSON.stringify(tenantGoalInput(tenantId)),
      }),
    );
    const viewToken = createSessionToken({
      ...baseSessionPayload(tenantId, userId),
      configPermissions: ["config.goals.view"],
    });
    const response = await listGoalsRoute(
      requestWithCookie("http://localhost/api/admin/goals", viewToken),
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.goals.length).toBeGreaterThanOrEqual(1);
  });

  it("GET /api/admin/goals/[id] mit id aus FREMDEM Mandanten -> 404 (kein Cross-Tenant-Leck)", async () => {
    const tenantA = await createTenant("http-404-a");
    const tenantB = await createTenant("http-404-b");
    const userB = await createUser(tenantB, "actor");
    const editTokenB = createSessionToken({
      ...baseSessionPayload(tenantB, userB),
      configPermissions: ["config.goals.edit"],
    });
    const createResponse = await createGoalRoute(
      requestWithCookie("http://localhost/api/admin/goals", editTokenB, {
        method: "POST",
        body: JSON.stringify(tenantGoalInput(tenantB)),
      }),
    );
    const { goal } = await createResponse.json();

    const userA = await createUser(tenantA, "actor");
    const viewTokenA = createSessionToken({
      ...baseSessionPayload(tenantA, userA),
      configPermissions: ["config.goals.view"],
    });
    const response = await getGoalDetailRoute(
      requestWithCookie(`http://localhost/api/admin/goals/${goal.id}`, viewTokenA),
      routeParams({ id: goal.id }),
    );
    expect(response.status).toBe(404);
  });

  // -------------------------------------------------------------------
  // GET/POST /api/admin/goals/[id]/versions
  // -------------------------------------------------------------------

  it("POST .../versions ohne config.goals.edit -> 403", async () => {
    const tenantId = await createTenant("http-403-version");
    const userId = await createUser(tenantId, "actor");
    const editToken = createSessionToken({
      ...baseSessionPayload(tenantId, userId),
      configPermissions: ["config.goals.edit"],
    });
    const createResponse = await createGoalRoute(
      requestWithCookie("http://localhost/api/admin/goals", editToken, {
        method: "POST",
        body: JSON.stringify(tenantGoalInput(tenantId)),
      }),
    );
    const { goal } = await createResponse.json();

    const viewToken = createSessionToken({
      ...baseSessionPayload(tenantId, userId),
      configPermissions: ["config.goals.view"],
    });
    const response = await createGoalVersionRoute(
      requestWithCookie(`http://localhost/api/admin/goals/${goal.id}/versions`, viewToken, {
        method: "POST",
        body: JSON.stringify({ targetCount: 30 }),
      }),
      routeParams({ id: goal.id }),
    );
    expect(response.status).toBe(403);
  });

  it("POST .../versions mit falschem Zielwert-Feld (metricKey aus dem geladenen Goal) -> 422", async () => {
    const tenantId = await createTenant("http-422-version");
    const userId = await createUser(tenantId, "actor");
    const editToken = createSessionToken({
      ...baseSessionPayload(tenantId, userId),
      configPermissions: ["config.goals.edit"],
    });
    // Goal ist DEALS_CLOSED (targetCount) -- Version-Input liefert stattdessen targetAmountMinor.
    const createResponse = await createGoalRoute(
      requestWithCookie("http://localhost/api/admin/goals", editToken, {
        method: "POST",
        body: JSON.stringify(tenantGoalInput(tenantId)),
      }),
    );
    const { goal } = await createResponse.json();

    const response = await createGoalVersionRoute(
      requestWithCookie(`http://localhost/api/admin/goals/${goal.id}/versions`, editToken, {
        method: "POST",
        body: JSON.stringify({ targetAmountMinor: 5000 }),
      }),
      routeParams({ id: goal.id }),
    );
    expect(response.status).toBe(422);
    const body = await response.json();
    expect(Array.isArray(body.issues)).toBe(true);
  });

  it("POST .../versions mit passendem Zielwert-Feld -> 201, GET .../versions listet beide Versionen", async () => {
    const tenantId = await createTenant("http-201-version");
    const userId = await createUser(tenantId, "actor");
    const editToken = createSessionToken({
      ...baseSessionPayload(tenantId, userId),
      configPermissions: ["config.goals.edit"],
    });
    const createResponse = await createGoalRoute(
      requestWithCookie("http://localhost/api/admin/goals", editToken, {
        method: "POST",
        body: JSON.stringify(tenantGoalInput(tenantId)),
      }),
    );
    const { goal } = await createResponse.json();

    const versionResponse = await createGoalVersionRoute(
      requestWithCookie(`http://localhost/api/admin/goals/${goal.id}/versions`, editToken, {
        method: "POST",
        body: JSON.stringify({ targetCount: 40 }),
      }),
      routeParams({ id: goal.id }),
    );
    expect(versionResponse.status).toBe(201);
    const versionBody = await versionResponse.json();
    expect(versionBody.version.versionNumber).toBe(2);
    expect(versionBody.version.targetCount).toBe(40);

    const viewToken = createSessionToken({
      ...baseSessionPayload(tenantId, userId),
      configPermissions: ["config.goals.view"],
    });
    const listResponse = await listGoalVersionsRoute(
      requestWithCookie(`http://localhost/api/admin/goals/${goal.id}/versions`, viewToken),
      routeParams({ id: goal.id }),
    );
    expect(listResponse.status).toBe(200);
    const listBody = await listResponse.json();
    expect(listBody.versions.length).toBe(2);
    expect(listBody.versions[0].versionNumber).toBe(2); // neueste zuerst
  });

  it("POST .../versions fuer eine goalId aus FREMDEM Mandanten -> 404 (kein Cross-Tenant-Leck)", async () => {
    const tenantA = await createTenant("http-404-version-a");
    const tenantB = await createTenant("http-404-version-b");
    const userB = await createUser(tenantB, "actor");
    const editTokenB = createSessionToken({
      ...baseSessionPayload(tenantB, userB),
      configPermissions: ["config.goals.edit"],
    });
    const createResponse = await createGoalRoute(
      requestWithCookie("http://localhost/api/admin/goals", editTokenB, {
        method: "POST",
        body: JSON.stringify(tenantGoalInput(tenantB)),
      }),
    );
    const { goal } = await createResponse.json();

    const userA = await createUser(tenantA, "actor");
    const editTokenA = createSessionToken({
      ...baseSessionPayload(tenantA, userA),
      configPermissions: ["config.goals.edit"],
    });
    const response = await createGoalVersionRoute(
      requestWithCookie(`http://localhost/api/admin/goals/${goal.id}/versions`, editTokenA, {
        method: "POST",
        body: JSON.stringify({ targetCount: 30 }),
      }),
      routeParams({ id: goal.id }),
    );
    expect(response.status).toBe(404);
  });
});
