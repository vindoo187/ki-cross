/**
 * Integrationstest fuer
 * `POST /api/consultation/sessions/[id]/ai-extraction/outcome` (Phase 12
 * AP4, ChatGPT-GO 2026-08-23). Fixture-/Testmuster bewusst analog
 * `tests/integration/ai-extraction-route.test.ts` (AP2) -- deckt dieselbe
 * Sicherheitsreihenfolge ab (401/400/403/404), zusaetzlich die
 * AP4-spezifischen Invarianten: korrektes `AnalyticsEvent` (eventType +
 * Payload) im Erfolgsfall, und die strukturelle Atomaritaets-Garantie --
 * dieser Endpunkt schreibt NIEMALS eine `CustomerAnswer`-Zeile (die
 * `customer_answers`-Tabelle bleibt durch diesen Aufruf unveraendert).
 *
 * Ohne DATABASE_URL wird die gesamte Suite uebersprungen statt
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
import { POST as outcomeRoute } from "@/app/api/consultation/sessions/[id]/ai-extraction/outcome/route";

const hasDatabaseUrl = Boolean(process.env.DATABASE_URL);
process.env.DEV_AUTH_SECRET ??= "ap4-ai-extraction-outcome-route-test-secret-not-for-prod";

describe.skipIf(!hasDatabaseUrl)(
  "Phase 12 AP4: POST /api/consultation/sessions/[id]/ai-extraction/outcome",
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
      questionId: string;
    }

    async function createTenantFixture(
      key: string,
      enableAiExtraction: boolean,
    ): Promise<TenantFixture> {
      const tenant = await rawClient.tenant.create({
        data: {
          key: `ai-ext-outcome-${key}-${suffix}`,
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

      const questionnaireKey = `ai-ext-outcome-fragebogen-${key}-${suffix}`;
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
        questionId: boolQuestion.id,
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

    function requestWithCookie(sessionId: string, token: string, body: unknown) {
      return new NextRequest(
        `http://localhost/api/consultation/sessions/${sessionId}/ai-extraction/outcome`,
        {
          method: "POST",
          body: JSON.stringify(body),
          headers: new Headers({ cookie: `${SESSION_COOKIE_NAME}=${token}` }),
        },
      );
    }

    function routeParams(sessionId: string) {
      return { params: Promise.resolve({ id: sessionId }) };
    }

    it("ohne Session-Cookie -> 401", async () => {
      const someId = randomUUID();
      const response = await outcomeRoute(
        new NextRequest(
          `http://localhost/api/consultation/sessions/${someId}/ai-extraction/outcome`,
          {
            method: "POST",
            body: JSON.stringify({ questionId: "q", outcome: "rejected" }),
          },
        ),
        routeParams(someId),
      );
      expect(response.status).toBe(401);
    });

    it("ungueltiger Body (outcome='accepted' ohne 'changed') -> 400", async () => {
      const fixture = await createTenantFixture("body", true);
      const sessionId = await startSession(fixture);
      const token = createSessionToken({
        ...baseSessionPayload(fixture),
        consultationPermissions: ["consultation.ai_extraction.use"],
      });
      const response = await outcomeRoute(
        requestWithCookie(sessionId, token, {
          questionId: fixture.questionId,
          outcome: "accepted",
        }),
        routeParams(sessionId),
      );
      expect(response.status).toBe(400);
    });

    it("fehlende consultation.ai_extraction.use-Permission -> 403", async () => {
      const fixture = await createTenantFixture("no-perm", true);
      const sessionId = await startSession(fixture);
      const token = createSessionToken({
        ...baseSessionPayload(fixture),
        consultationPermissions: [],
      });
      const response = await outcomeRoute(
        requestWithCookie(sessionId, token, {
          questionId: fixture.questionId,
          outcome: "rejected",
        }),
        routeParams(sessionId),
      );
      expect(response.status).toBe(403);
    });

    it("Tenant-Feature-Flag AUS -> 403", async () => {
      const fixture = await createTenantFixture("flag-off", false);
      const sessionId = await startSession(fixture);
      const token = createSessionToken({
        ...baseSessionPayload(fixture),
        consultationPermissions: ["consultation.ai_extraction.use"],
      });
      const response = await outcomeRoute(
        requestWithCookie(sessionId, token, {
          questionId: fixture.questionId,
          outcome: "rejected",
        }),
        routeParams(sessionId),
      );
      expect(response.status).toBe(403);
    });

    it("nicht existierende Session -> 404", async () => {
      const fixture = await createTenantFixture("missing", true);
      const token = createSessionToken({
        ...baseSessionPayload(fixture),
        consultationPermissions: ["consultation.ai_extraction.use"],
      });
      const missingId = randomUUID();
      const response = await outcomeRoute(
        requestWithCookie(missingId, token, { questionId: "q", outcome: "rejected" }),
        routeParams(missingId),
      );
      expect(response.status).toBe(404);
    });

    it("Session eines ANDEREN Mandanten -> 404 (kein IDOR-Leck)", async () => {
      const fixtureA = await createTenantFixture("tenant-a", true);
      const fixtureB = await createTenantFixture("tenant-b", true);
      const sessionIdA = await startSession(fixtureA);

      const token = createSessionToken({
        ...baseSessionPayload(fixtureB),
        consultationPermissions: ["consultation.ai_extraction.use"],
      });
      const response = await outcomeRoute(
        requestWithCookie(sessionIdA, token, {
          questionId: fixtureA.questionId,
          outcome: "rejected",
        }),
        routeParams(sessionIdA),
      );
      expect(response.status).toBe(404);
    });

    it("outcome='rejected' (Verwerfen) -> 202 + AI_SUGGESTION_REJECTED-Event ohne 'changed'-Feld, KEINE CustomerAnswer geschrieben", async () => {
      const fixture = await createTenantFixture("rejected", true);
      const sessionId = await startSession(fixture);
      const token = createSessionToken({
        ...baseSessionPayload(fixture),
        consultationPermissions: ["consultation.ai_extraction.use"],
      });
      const answersBefore = await rawClient.customerAnswer.count({
        where: { consultationSessionId: sessionId },
      });

      const response = await outcomeRoute(
        requestWithCookie(sessionId, token, {
          questionId: fixture.questionId,
          outcome: "rejected",
        }),
        routeParams(sessionId),
      );
      expect(response.status).toBe(202);

      const answersAfter = await rawClient.customerAnswer.count({
        where: { consultationSessionId: sessionId },
      });
      expect(answersAfter).toBe(answersBefore);

      const events = await rawClient.analyticsEvent.findMany({
        where: { tenantId: fixture.tenantId, eventType: "AI_SUGGESTION_REJECTED" },
      });
      expect(events).toHaveLength(1);
      expect(events[0]?.payload).toEqual({
        consultationSessionId: sessionId,
        questionId: fixture.questionId,
      });
    });

    it("outcome='accepted', changed=false (Uebernehmen) -> 202 + AI_SUGGESTION_ACCEPTED-Event mit changed=false", async () => {
      const fixture = await createTenantFixture("accepted-plain", true);
      const sessionId = await startSession(fixture);
      const token = createSessionToken({
        ...baseSessionPayload(fixture),
        consultationPermissions: ["consultation.ai_extraction.use"],
      });

      const response = await outcomeRoute(
        requestWithCookie(sessionId, token, {
          questionId: fixture.questionId,
          outcome: "accepted",
          changed: false,
        }),
        routeParams(sessionId),
      );
      expect(response.status).toBe(202);

      const events = await rawClient.analyticsEvent.findMany({
        where: { tenantId: fixture.tenantId, eventType: "AI_SUGGESTION_ACCEPTED" },
      });
      expect(events).toHaveLength(1);
      expect(events[0]?.payload).toEqual({
        consultationSessionId: sessionId,
        questionId: fixture.questionId,
        changed: false,
      });
    });

    it("outcome='accepted', changed=true (Aendern) -> 202 + AI_SUGGESTION_ACCEPTED-Event mit changed=true", async () => {
      const fixture = await createTenantFixture("accepted-changed", true);
      const sessionId = await startSession(fixture);
      const token = createSessionToken({
        ...baseSessionPayload(fixture),
        consultationPermissions: ["consultation.ai_extraction.use"],
      });

      const response = await outcomeRoute(
        requestWithCookie(sessionId, token, {
          questionId: fixture.questionId,
          outcome: "accepted",
          changed: true,
        }),
        routeParams(sessionId),
      );
      expect(response.status).toBe(202);

      const events = await rawClient.analyticsEvent.findMany({
        where: { tenantId: fixture.tenantId, eventType: "AI_SUGGESTION_ACCEPTED" },
      });
      expect(events).toHaveLength(1);
      expect(events[0]?.payload).toEqual({
        consultationSessionId: sessionId,
        questionId: fixture.questionId,
        changed: true,
      });
    });
  },
);
