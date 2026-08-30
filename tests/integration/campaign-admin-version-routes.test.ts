/**
 * Phase 13 AP6 -- Integrationstest fuer die HTTP-Routen
 * `GET/PATCH /api/admin/campaigns/[id]/versions/[versionId]`,
 * `POST .../validate`, `POST .../publish` und
 * `GET /api/admin/campaigns/scope-options` (siehe
 * PHASE_13_IMPLEMENTATION_PLAN.md Abschnitt 3, ChatGPT-GO 2026-08-30).
 *
 * Die eigentliche Fachlogik (`updateCampaignVersionFields()`/
 * `validateCampaignVersion()`/`publishCampaignVersion()`) ist bereits
 * vollstaendig in `tests/integration/campaign-admin.test.ts` (AP2)
 * abgedeckt -- dieser Test deckt AUSSCHLIESSLICH die duenne Route-Huelle ab:
 * RBAC-Durchsetzung (`config.campaigns.view`/`.edit`/`.publish`), korrekte
 * HTTP-Statuscode-/Body-Abbildung und Cross-Tenant-/IDOR-Schutz auf
 * HTTP-Ebene -- analog `campaign-admin-routes.test.ts` (AP3) und
 * `goal-scope-options-route.test.ts` (Phase 11 AP6).
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
import { POST as createCampaignRoute } from "@/app/api/admin/campaigns/route";
import { POST as createCampaignVersionRoute } from "@/app/api/admin/campaigns/[id]/versions/route";
import {
  GET as getCampaignVersionRoute,
  PATCH as patchCampaignVersionRoute,
} from "@/app/api/admin/campaigns/[id]/versions/[versionId]/route";
import { POST as validateCampaignVersionRoute } from "@/app/api/admin/campaigns/[id]/versions/[versionId]/validate/route";
import { POST as publishCampaignVersionRoute } from "@/app/api/admin/campaigns/[id]/versions/[versionId]/publish/route";
import { GET as scopeOptionsRoute } from "@/app/api/admin/campaigns/scope-options/route";

const hasDatabaseUrl = Boolean(process.env.DATABASE_URL);
process.env.DEV_AUTH_SECRET ??= "ap6-campaign-admin-version-routes-test-secret-not-for-prod";

describe.skipIf(!hasDatabaseUrl)(
  "Phase 13 AP6: HTTP-Routen /api/admin/campaigns/[id]/versions/[versionId] + scope-options",
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

    /**
     * Legt eine ECHTE `Question`-Zeile an, deren `QuestionnaireVersion`
     * NICHT den Status ACTIVE hat (hier: DRAFT) -- analog
     * `createInactiveQuestion()` in `campaign-admin.test.ts` (AP2). Ein
     * genuin unbekannter `questionId` (`randomUUID()`) wuerde bereits an
     * der DB-FK `campaign_conditions_tenant_id_question_id_fkey`
     * scheitern (PrismaClientKnownRequestError P2003, kein 422) -- diese
     * Funktion liefert stattdessen eine FK-gueltige, aber fachlich
     * ungueltige Frage-ID fuer den 422-Validator-Pfad.
     */
    async function createInactiveQuestion(tenantId: string, key: string) {
      const questionnaire = await rawClient.questionnaire.create({
        data: { tenantId, key: `${key}-${suffix}` },
      });
      const questionnaireVersion = await rawClient.questionnaireVersion.create({
        data: {
          tenantId,
          questionnaireId: questionnaire.id,
          label: "v1",
          status: "DRAFT",
          validFrom: new Date("2026-01-01T00:00:00Z"),
          validTo: null,
        },
      });
      const question = await rawClient.question.create({
        data: {
          tenantId,
          questionnaireVersionId: questionnaireVersion.id,
          key: "q-inactive",
          sortOrder: 1,
        },
      });
      return { questionId: question.id };
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
      // Fixer, nicht-numerischer Key (Praezedenz: campaign-admin-routes.test.ts,
      // CI #120 contact-data-guard-Lehre) -- kein randomUUID()-Hex-Suffix.
      return { key: "c", name: "Testkampagne", ...overrides };
    }

    /** Legt Campaign + eine DRAFT-TENANT-Version an, liefert beide IDs. */
    async function createCampaignWithDraftVersion(tenantId: string, editToken: string) {
      const campaignResponse = await createCampaignRoute(
        requestWithCookie("http://localhost/api/admin/campaigns", editToken, {
          method: "POST",
          body: JSON.stringify(campaignInput()),
        }),
      );
      const { campaign } = await campaignResponse.json();

      const versionResponse = await createCampaignVersionRoute(
        requestWithCookie(
          `http://localhost/api/admin/campaigns/${campaign.id}/versions`,
          editToken,
          {
            method: "POST",
            body: JSON.stringify({ scopeType: "TENANT", scopeId: tenantId }),
          },
        ),
        routeParams({ id: campaign.id }),
      );
      const { version } = await versionResponse.json();
      return { campaignId: campaign.id as string, versionId: version.id as string };
    }

    function basePath(campaignId: string, versionId: string) {
      return `http://localhost/api/admin/campaigns/${campaignId}/versions/${versionId}`;
    }

    // -----------------------------------------------------------------
    // 401 -- kein Session-Cookie
    // -----------------------------------------------------------------

    it("GET .../versions/[versionId] ohne Session-Cookie -> 401", async () => {
      const id = randomUUID();
      const response = await getCampaignVersionRoute(
        new NextRequest(basePath(id, id)),
        routeParams({ id, versionId: id }),
      );
      expect(response.status).toBe(401);
    });

    it("PATCH .../versions/[versionId] ohne Session-Cookie -> 401", async () => {
      const id = randomUUID();
      const response = await patchCampaignVersionRoute(
        new NextRequest(basePath(id, id), { method: "PATCH", body: JSON.stringify({}) }),
        routeParams({ id, versionId: id }),
      );
      expect(response.status).toBe(401);
    });

    it("POST .../validate ohne Session-Cookie -> 401", async () => {
      const id = randomUUID();
      const response = await validateCampaignVersionRoute(
        new NextRequest(`${basePath(id, id)}/validate`, { method: "POST" }),
        routeParams({ id, versionId: id }),
      );
      expect(response.status).toBe(401);
    });

    it("POST .../publish ohne Session-Cookie -> 401", async () => {
      const id = randomUUID();
      const response = await publishCampaignVersionRoute(
        new NextRequest(`${basePath(id, id)}/publish`, { method: "POST" }),
        routeParams({ id, versionId: id }),
      );
      expect(response.status).toBe(401);
    });

    it("GET /api/admin/campaigns/scope-options ohne Session-Cookie -> 401", async () => {
      const response = await scopeOptionsRoute(
        new NextRequest("http://localhost/api/admin/campaigns/scope-options?scopeType=TENANT"),
      );
      expect(response.status).toBe(401);
    });

    // -----------------------------------------------------------------
    // GET .../versions/[versionId]
    // -----------------------------------------------------------------

    it("GET .../versions/[versionId] mit config.campaigns.view -> 200 mit Detail inkl. conditions", async () => {
      const tenantId = await createTenant("http-200-get");
      const userId = await createUser(tenantId, "actor");
      const editToken = createSessionToken({
        ...baseSessionPayload(tenantId, userId),
        configPermissions: ["config.campaigns.edit"],
      });
      const { campaignId, versionId } = await createCampaignWithDraftVersion(tenantId, editToken);

      const viewToken = createSessionToken({
        ...baseSessionPayload(tenantId, userId),
        configPermissions: ["config.campaigns.view"],
      });
      const response = await getCampaignVersionRoute(
        requestWithCookie(basePath(campaignId, versionId), viewToken),
        routeParams({ id: campaignId, versionId }),
      );
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.version.id).toBe(versionId);
      expect(body.version.conditions).toEqual([]);
    });

    it("GET .../versions/[versionId] ohne config.campaigns.view -> 403", async () => {
      const tenantId = await createTenant("http-403-get");
      const userId = await createUser(tenantId, "actor");
      const editToken = createSessionToken({
        ...baseSessionPayload(tenantId, userId),
        configPermissions: ["config.campaigns.edit"],
      });
      const { campaignId, versionId } = await createCampaignWithDraftVersion(tenantId, editToken);

      const noPermToken = createSessionToken({
        ...baseSessionPayload(tenantId, userId),
        configPermissions: [],
      });
      const response = await getCampaignVersionRoute(
        requestWithCookie(basePath(campaignId, versionId), noPermToken),
        routeParams({ id: campaignId, versionId }),
      );
      expect(response.status).toBe(403);
    });

    it("GET .../versions/[versionId] fuer eine campaignId aus FREMDEM Mandanten -> 404 (kein Cross-Tenant-Leck)", async () => {
      const tenantA = await createTenant("http-404-get-a");
      const tenantB = await createTenant("http-404-get-b");
      const userB = await createUser(tenantB, "actor");
      const editTokenB = createSessionToken({
        ...baseSessionPayload(tenantB, userB),
        configPermissions: ["config.campaigns.edit"],
      });
      const { campaignId, versionId } = await createCampaignWithDraftVersion(tenantB, editTokenB);

      const userA = await createUser(tenantA, "actor");
      const viewTokenA = createSessionToken({
        ...baseSessionPayload(tenantA, userA),
        configPermissions: ["config.campaigns.view"],
      });
      const response = await getCampaignVersionRoute(
        requestWithCookie(basePath(campaignId, versionId), viewTokenA),
        routeParams({ id: campaignId, versionId }),
      );
      expect(response.status).toBe(404);
    });

    // -----------------------------------------------------------------
    // PATCH .../versions/[versionId]
    // -----------------------------------------------------------------

    it("PATCH .../versions/[versionId] ohne config.campaigns.edit -> 403", async () => {
      const tenantId = await createTenant("http-403-patch");
      const userId = await createUser(tenantId, "actor");
      const editToken = createSessionToken({
        ...baseSessionPayload(tenantId, userId),
        configPermissions: ["config.campaigns.edit"],
      });
      const { campaignId, versionId } = await createCampaignWithDraftVersion(tenantId, editToken);

      const viewToken = createSessionToken({
        ...baseSessionPayload(tenantId, userId),
        configPermissions: ["config.campaigns.view"],
      });
      const response = await patchCampaignVersionRoute(
        requestWithCookie(basePath(campaignId, versionId), viewToken, {
          method: "PATCH",
          body: JSON.stringify({ description: "geaendert" }),
        }),
        routeParams({ id: campaignId, versionId }),
      );
      expect(response.status).toBe(403);
    });

    it("PATCH .../versions/[versionId] mit gueltigem Patch (description + conditions) -> 200", async () => {
      const tenantId = await createTenant("http-200-patch");
      const userId = await createUser(tenantId, "actor");
      const editToken = createSessionToken({
        ...baseSessionPayload(tenantId, userId),
        configPermissions: ["config.campaigns.edit"],
      });
      const { campaignId, versionId } = await createCampaignWithDraftVersion(tenantId, editToken);

      const response = await patchCampaignVersionRoute(
        requestWithCookie(basePath(campaignId, versionId), editToken, {
          method: "PATCH",
          body: JSON.stringify({
            description: "Sommeraktion 2026",
            conditions: [
              {
                groupIndex: 0,
                sourceType: "SESSION_ATTRIBUTE",
                attributeKey: "storeRegion",
                operator: "EQUALS",
                comparisonValue: "nord",
              },
            ],
          }),
        }),
        routeParams({ id: campaignId, versionId }),
      );
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.version.description).toBe("Sommeraktion 2026");
      expect(body.version.conditions).toHaveLength(1);
    });

    it("PATCH .../versions/[versionId] mit CAMPAIGN_ACTIVE als sourceType -> 400 (strukturell abgelehnt, kein zulaessiger Enum-Wert im Zod-Schema)", async () => {
      const tenantId = await createTenant("http-400-campaign-active");
      const userId = await createUser(tenantId, "actor");
      const editToken = createSessionToken({
        ...baseSessionPayload(tenantId, userId),
        configPermissions: ["config.campaigns.edit"],
      });
      const { campaignId, versionId } = await createCampaignWithDraftVersion(tenantId, editToken);

      const response = await patchCampaignVersionRoute(
        requestWithCookie(basePath(campaignId, versionId), editToken, {
          method: "PATCH",
          body: JSON.stringify({
            conditions: [
              {
                groupIndex: 0,
                sourceType: "CAMPAIGN_ACTIVE",
                attributeKey: "andereKampagne",
                operator: "IS_ANSWERED",
                comparisonValue: "true",
              },
            ],
          }),
        }),
        routeParams({ id: campaignId, versionId }),
      );
      expect(response.status).toBe(400);
    });

    it("PATCH .../versions/[versionId] fuer eine bereits ACTIVE Version -> 409", async () => {
      const tenantId = await createTenant("http-409-patch");
      const userId = await createUser(tenantId, "actor");
      const editToken = createSessionToken({
        ...baseSessionPayload(tenantId, userId),
        configPermissions: ["config.campaigns.edit", "config.campaigns.publish"],
      });
      const { campaignId, versionId } = await createCampaignWithDraftVersion(tenantId, editToken);
      const publishResponse = await publishCampaignVersionRoute(
        requestWithCookie(`${basePath(campaignId, versionId)}/publish`, editToken, {
          method: "POST",
        }),
        routeParams({ id: campaignId, versionId }),
      );
      expect(publishResponse.status).toBe(200);

      const response = await patchCampaignVersionRoute(
        requestWithCookie(basePath(campaignId, versionId), editToken, {
          method: "PATCH",
          body: JSON.stringify({ description: "darf nicht mehr gehen" }),
        }),
        routeParams({ id: campaignId, versionId }),
      );
      expect(response.status).toBe(409);
    });

    // -----------------------------------------------------------------
    // POST .../validate
    // -----------------------------------------------------------------

    it("POST .../validate fuer eine Version ohne Bedingungen -> 200 mit valid:true (leere Bedingungsliste ist gueltig)", async () => {
      const tenantId = await createTenant("http-200-validate");
      const userId = await createUser(tenantId, "actor");
      const editToken = createSessionToken({
        ...baseSessionPayload(tenantId, userId),
        configPermissions: ["config.campaigns.edit"],
      });
      const { campaignId, versionId } = await createCampaignWithDraftVersion(tenantId, editToken);

      const response = await validateCampaignVersionRoute(
        requestWithCookie(`${basePath(campaignId, versionId)}/validate`, editToken, {
          method: "POST",
        }),
        routeParams({ id: campaignId, versionId }),
      );
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.valid).toBe(true);
    });

    it("POST .../validate mit einer Bedingung, die auf eine nicht (mehr) aktive Frage verweist -> 422", async () => {
      const tenantId = await createTenant("http-422-validate");
      const userId = await createUser(tenantId, "actor");
      const editToken = createSessionToken({
        ...baseSessionPayload(tenantId, userId),
        configPermissions: ["config.campaigns.edit"],
      });
      const { campaignId, versionId } = await createCampaignWithDraftVersion(tenantId, editToken);
      const { questionId } = await createInactiveQuestion(tenantId, "q");

      const patchResponse = await patchCampaignVersionRoute(
        requestWithCookie(basePath(campaignId, versionId), editToken, {
          method: "PATCH",
          body: JSON.stringify({
            conditions: [
              {
                groupIndex: 0,
                sourceType: "ANSWER",
                questionId,
                operator: "EQUALS",
                comparisonValue: "ja",
              },
            ],
          }),
        }),
        routeParams({ id: campaignId, versionId }),
      );
      expect(patchResponse.status).toBe(200);

      const response = await validateCampaignVersionRoute(
        requestWithCookie(`${basePath(campaignId, versionId)}/validate`, editToken, {
          method: "POST",
        }),
        routeParams({ id: campaignId, versionId }),
      );
      expect(response.status).toBe(422);
    });

    // -----------------------------------------------------------------
    // POST .../publish
    // -----------------------------------------------------------------

    it("POST .../publish ohne config.campaigns.publish -> 403", async () => {
      const tenantId = await createTenant("http-403-publish");
      const userId = await createUser(tenantId, "actor");
      const editToken = createSessionToken({
        ...baseSessionPayload(tenantId, userId),
        configPermissions: ["config.campaigns.edit"],
      });
      const { campaignId, versionId } = await createCampaignWithDraftVersion(tenantId, editToken);

      const response = await publishCampaignVersionRoute(
        requestWithCookie(`${basePath(campaignId, versionId)}/publish`, editToken, {
          method: "POST",
        }),
        routeParams({ id: campaignId, versionId }),
      );
      expect(response.status).toBe(403);
    });

    it("POST .../publish mit config.campaigns.publish -> 200, Version wird ACTIVE", async () => {
      const tenantId = await createTenant("http-200-publish");
      const userId = await createUser(tenantId, "actor");
      const editToken = createSessionToken({
        ...baseSessionPayload(tenantId, userId),
        configPermissions: ["config.campaigns.edit", "config.campaigns.publish"],
      });
      const { campaignId, versionId } = await createCampaignWithDraftVersion(tenantId, editToken);

      const response = await publishCampaignVersionRoute(
        requestWithCookie(`${basePath(campaignId, versionId)}/publish`, editToken, {
          method: "POST",
        }),
        routeParams({ id: campaignId, versionId }),
      );
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.version.status).toBe("ACTIVE");
      expect(body.previousActiveVersionId).toBeNull();
    });

    it("POST .../publish fuer eine bereits ACTIVE Version -> 409 (kein Draft mehr)", async () => {
      const tenantId = await createTenant("http-409-publish");
      const userId = await createUser(tenantId, "actor");
      const editToken = createSessionToken({
        ...baseSessionPayload(tenantId, userId),
        configPermissions: ["config.campaigns.edit", "config.campaigns.publish"],
      });
      const { campaignId, versionId } = await createCampaignWithDraftVersion(tenantId, editToken);
      await publishCampaignVersionRoute(
        requestWithCookie(`${basePath(campaignId, versionId)}/publish`, editToken, {
          method: "POST",
        }),
        routeParams({ id: campaignId, versionId }),
      );

      const response = await publishCampaignVersionRoute(
        requestWithCookie(`${basePath(campaignId, versionId)}/publish`, editToken, {
          method: "POST",
        }),
        routeParams({ id: campaignId, versionId }),
      );
      expect(response.status).toBe(409);
    });

    // -----------------------------------------------------------------
    // GET /api/admin/campaigns/scope-options
    // -----------------------------------------------------------------

    it("scope-options: ohne config.campaigns.view -> 403", async () => {
      const tenantId = await createTenant("http-403-scope");
      const userId = await createUser(tenantId, "actor");
      const token = createSessionToken({
        ...baseSessionPayload(tenantId, userId),
        configPermissions: [],
      });
      const response = await scopeOptionsRoute(
        requestWithCookie(
          "http://localhost/api/admin/campaigns/scope-options?scopeType=TENANT",
          token,
        ),
      );
      expect(response.status).toBe(403);
    });

    it("scope-options: mit ungueltigem scopeType (z.B. COMPANY, bei Campaigns nicht vorgesehen) -> 400", async () => {
      const tenantId = await createTenant("http-400-scope");
      const userId = await createUser(tenantId, "actor");
      const token = createSessionToken({
        ...baseSessionPayload(tenantId, userId),
        configPermissions: ["config.campaigns.view"],
      });
      const response = await scopeOptionsRoute(
        requestWithCookie(
          "http://localhost/api/admin/campaigns/scope-options?scopeType=COMPANY",
          token,
        ),
      );
      expect(response.status).toBe(400);
    });

    it("scope-options: scopeType=TENANT -> 200 mit genau einer Option (der eigene Mandant)", async () => {
      const tenantId = await createTenant("http-200-scope-tenant", "Meine Kampagnenfirma GmbH");
      const userId = await createUser(tenantId, "actor");
      const token = createSessionToken({
        ...baseSessionPayload(tenantId, userId),
        configPermissions: ["config.campaigns.view"],
      });
      const response = await scopeOptionsRoute(
        requestWithCookie(
          "http://localhost/api/admin/campaigns/scope-options?scopeType=TENANT",
          token,
        ),
      );
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.options).toEqual([{ id: tenantId, name: "Meine Kampagnenfirma GmbH" }]);
    });
  },
);
