/**
 * Integrationstest fuer `POST /api/consultation/sessions/[id]/ai-extraction`
 * (Phase 12 AP2, ChatGPT-GO 2026-08-23). Deckt die von ChatGPT verbindlich
 * geforderte Sicherheitsreihenfolge ab: 401 ohne Session, 403 bei fehlender
 * Permission ODER deaktiviertem Tenant-Feature-Flag (nicht unterscheidbar,
 * siehe `ai-extraction/errors.ts`), 404 fuer nicht-existente Session UND fuer
 * eine Session eines ANDEREN Mitarbeiters/Mandanten (IDOR-Schutz, bewusst
 * derselbe Fehler wie "nicht gefunden" -- kein Leck ueber unterschiedliche
 * Fehlermeldungen), 409 fuer eine nicht mehr laufende Session, 200 mit
 * validierten Kandidaten im Erfolgsfall.
 *
 * Fixture-Muster analog `tests/integration/ai-extraction-visible-context.test.ts`
 * (AP1) + Routen-Testmuster analog `tests/integration/goal-admin-routes.test.ts`
 * (AP3). Ohne DATABASE_URL wird die gesamte Suite uebersprungen statt
 * fehlzuschlagen.
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
import { runWithTenantContext } from "@/server/tenant/context";
import { startQuestionnaire } from "@/server/questionnaire/service";
import { POST as aiExtractionRoute } from "@/app/api/consultation/sessions/[id]/ai-extraction/route";

const hasDatabaseUrl = Boolean(process.env.DATABASE_URL);
process.env.DEV_AUTH_SECRET ??= "ap2-ai-extraction-route-test-secret-not-for-prod";

describe.skipIf(!hasDatabaseUrl)(
  "Phase 12 AP2: POST /api/consultation/sessions/[id]/ai-extraction",
  () => {
    const rawClient = new PrismaClient();
    const suffix = randomUUID().slice(0, 8);

    afterAll(async () => {
      await rawClient.$disconnect();
    });

    interface TenantFixture {
      tenantId: string;
      storeId: string;
      employeeId: string;
      questionnaireKey: string;
    }

    /**
     * Legt einen vollstaendigen Mandanten mit einem Fragebogen (eine
     * BOOLEAN-Frage, deterministisch per Stichwort "roaming" vom
     * MockExtractionProvider erkennbar) an. `enableAiExtraction` steuert
     * `Tenant.aiExtractionEnabled`.
     */
    async function createTenantFixture(
      key: string,
      enableAiExtraction: boolean,
    ): Promise<TenantFixture> {
      const tenant = await rawClient.tenant.create({
        data: {
          key: `ai-ext-route-${key}-${suffix}`,
          name: `Test ${key}`,
          isSynthetic: true,
          aiExtractionEnabled: enableAiExtraction,
        },
      });
      const company = await rawClient.company.create({
        data: { tenantId: tenant.id, key: `company-${key}-${suffix}`, name: "Company" },
      });
      const store = await rawClient.store.create({
        data: {
          tenantId: tenant.id,
          companyId: company.id,
          key: `store-${key}-${suffix}`,
          name: "Store",
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
        data: { tenantId: tenant.id, storeId: store.id, userId: user.id, displayName: "MA Test" },
      });

      const questionnaireKey = `ai-ext-route-fragebogen-${key}-${suffix}`;
      const questionnaire = await rawClient.questionnaire.create({
        data: { tenantId: tenant.id, key: questionnaireKey },
      });
      const version = await rawClient.questionnaireVersion.create({
        data: {
          tenantId: tenant.id,
          questionnaireId: questionnaire.id,
          label: "V1",
          validFrom: new Date("2026-01-01T00:00:00Z"),
          status: "ACTIVE",
        },
      });
      const boolQuestion = await rawClient.question.create({
        data: {
          tenantId: tenant.id,
          questionnaireVersionId: version.id,
          key: "hat_roaming",
          sortOrder: 1,
        },
      });
      await rawClient.questionVersion.create({
        data: {
          tenantId: tenant.id,
          questionId: boolQuestion.id,
          label: "EU-Roaming gewuenscht",
          answerType: "BOOLEAN",
          isRequired: false,
          validFrom: new Date("2026-01-01T00:00:00Z"),
          status: "ACTIVE",
        },
      });

      return {
        tenantId: tenant.id,
        storeId: store.id,
        employeeId: employee.id,
        questionnaireKey,
      };
    }

    function asTenant<T>(tenantId: string, employeeId: string, fn: () => Promise<T>): Promise<T> {
      return runWithTenantContext(
        { tenantId, userId: randomUUID(), employeeId, roles: [], managementScope: null },
        fn,
      );
    }

    async function startSession(fixture: TenantFixture): Promise<string> {
      const state = await asTenant(fixture.tenantId, fixture.employeeId, () =>
        startQuestionnaire({
          questionnaireKey: fixture.questionnaireKey,
          storeId: fixture.storeId,
          employeeId: fixture.employeeId,
          consultationType: "NEW_CONTRACT",
          at: new Date("2026-03-01T00:00:00Z"),
        }),
      );
      return state.consultationSessionId;
    }

    function baseSessionPayload(fixture: TenantFixture): Omit<SessionPayload, "issuedAt"> {
      return {
        tenantId: fixture.tenantId,
        userId: randomUUID(),
        employeeId: fixture.employeeId,
        storeId: fixture.storeId,
        displayName: "Test",
        roles: [],
        managementScope: null,
        configPermissions: [],
        consultationPermissions: [],
      };
    }

    function requestWithCookie(
      sessionId: string,
      token: string,
      freeText = "Kunde moechte roaming.",
    ) {
      return new NextRequest(
        `http://localhost/api/consultation/sessions/${sessionId}/ai-extraction`,
        {
          method: "POST",
          body: JSON.stringify({ freeText }),
          headers: new Headers({ cookie: `${SESSION_COOKIE_NAME}=${token}` }),
        },
      );
    }

    function routeParams(sessionId: string) {
      return { params: Promise.resolve({ id: sessionId }) };
    }

    it("ohne Session-Cookie -> 401", async () => {
      const someId = randomUUID();
      const response = await aiExtractionRoute(
        new NextRequest(`http://localhost/api/consultation/sessions/${someId}/ai-extraction`, {
          method: "POST",
          body: JSON.stringify({ freeText: "x" }),
        }),
        routeParams(someId),
      );
      expect(response.status).toBe(401);
    });

    it("ungueltiger Body (fehlendes freeText) -> 400", async () => {
      const fixture = await createTenantFixture("body", true);
      const sessionId = await startSession(fixture);
      const token = createSessionToken({
        ...baseSessionPayload(fixture),
        consultationPermissions: ["consultation.ai_extraction.use"],
      });
      const response = await aiExtractionRoute(
        new NextRequest(`http://localhost/api/consultation/sessions/${sessionId}/ai-extraction`, {
          method: "POST",
          body: JSON.stringify({}),
          headers: new Headers({ cookie: `${SESSION_COOKIE_NAME}=${token}` }),
        }),
        routeParams(sessionId),
      );
      expect(response.status).toBe(400);
    });

    it("fehlende consultation.ai_extraction.use-Permission (Tenant-Flag AN) -> 403", async () => {
      const fixture = await createTenantFixture("no-perm", true);
      const sessionId = await startSession(fixture);
      const token = createSessionToken({
        ...baseSessionPayload(fixture),
        consultationPermissions: [],
      });
      const response = await aiExtractionRoute(
        requestWithCookie(sessionId, token),
        routeParams(sessionId),
      );
      expect(response.status).toBe(403);
      const body = await response.json();
      expect(body.error).toBe("AiExtractionNotAvailableError");
    });

    it("Tenant-Feature-Flag AUS trotz vorhandener Permission -> 403 (identischer Fehler wie fehlende Permission)", async () => {
      const fixture = await createTenantFixture("flag-off", false);
      const sessionId = await startSession(fixture);
      const token = createSessionToken({
        ...baseSessionPayload(fixture),
        consultationPermissions: ["consultation.ai_extraction.use"],
      });
      const response = await aiExtractionRoute(
        requestWithCookie(sessionId, token),
        routeParams(sessionId),
      );
      expect(response.status).toBe(403);
      const body = await response.json();
      expect(body.error).toBe("AiExtractionNotAvailableError");
    });

    it("gueltige Anfrage (Permission + Feature-Flag + eigene Session) -> 200 mit validierten Kandidaten", async () => {
      const fixture = await createTenantFixture("happy", true);
      const sessionId = await startSession(fixture);
      const token = createSessionToken({
        ...baseSessionPayload(fixture),
        consultationPermissions: ["consultation.ai_extraction.use"],
      });
      const response = await aiExtractionRoute(
        requestWithCookie(sessionId, token, "Der Kunde moechte unbedingt EU-Roaming."),
        routeParams(sessionId),
      );
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.candidates).toEqual([
        expect.objectContaining({ answerType: "BOOLEAN", booleanValue: true }),
      ]);
    });

    it("nicht existierende Session -> 404", async () => {
      const fixture = await createTenantFixture("missing", true);
      const token = createSessionToken({
        ...baseSessionPayload(fixture),
        consultationPermissions: ["consultation.ai_extraction.use"],
      });
      const missingId = randomUUID();
      const response = await aiExtractionRoute(
        requestWithCookie(missingId, token),
        routeParams(missingId),
      );
      expect(response.status).toBe(404);
    });

    it("Session eines ANDEREN Mitarbeiters desselben Mandanten -> 404 (identisch zu 'nicht gefunden', kein IDOR-Leck)", async () => {
      const fixture = await createTenantFixture("other-employee", true);
      const sessionId = await startSession(fixture);

      // Zweiter Mitarbeiter im selben Mandanten, OHNE Bezug zur Session.
      const otherUser = await rawClient.user.create({
        data: {
          tenantId: fixture.tenantId,
          email: `other-emp-${suffix}@example-synthetic.test`,
          isSynthetic: true,
        },
      });
      const otherEmployee = await rawClient.employee.create({
        data: {
          tenantId: fixture.tenantId,
          storeId: fixture.storeId,
          userId: otherUser.id,
          displayName: "Anderer MA",
        },
      });

      const token = createSessionToken({
        ...baseSessionPayload(fixture),
        employeeId: otherEmployee.id,
        consultationPermissions: ["consultation.ai_extraction.use"],
      });
      const response = await aiExtractionRoute(
        requestWithCookie(sessionId, token),
        routeParams(sessionId),
      );
      expect(response.status).toBe(404);
    });

    it("Session eines ANDEREN Mandanten -> 404 (identisch zu 'nicht gefunden', Tenant-Isolation)", async () => {
      const fixtureA = await createTenantFixture("tenant-a", true);
      const fixtureB = await createTenantFixture("tenant-b", true);
      const sessionIdA = await startSession(fixtureA);

      const token = createSessionToken({
        ...baseSessionPayload(fixtureB),
        consultationPermissions: ["consultation.ai_extraction.use"],
      });
      const response = await aiExtractionRoute(
        requestWithCookie(sessionIdA, token),
        routeParams(sessionIdA),
      );
      expect(response.status).toBe(404);
    });

    it("nicht mehr laufende Session (COMPLETED) -> 409", async () => {
      const fixture = await createTenantFixture("completed", true);
      const sessionId = await startSession(fixture);
      await rawClient.consultationSession.update({
        where: { id: sessionId },
        data: { status: "COMPLETED", endedAt: new Date("2026-03-01T01:00:00Z") },
      });

      const token = createSessionToken({
        ...baseSessionPayload(fixture),
        consultationPermissions: ["consultation.ai_extraction.use"],
      });
      const response = await aiExtractionRoute(
        requestWithCookie(sessionId, token),
        routeParams(sessionId),
      );
      expect(response.status).toBe(409);
    });
  },
);
