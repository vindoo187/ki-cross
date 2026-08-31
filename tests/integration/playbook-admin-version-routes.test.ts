/**
 * Phase 14 AP3 -- Integrationstest fuer die HTTP-Routen
 * `GET/PATCH /api/admin/playbooks/[id]/versions/[versionId]`,
 * `POST .../validate` und `POST .../publish` (siehe
 * PHASE_14_IMPLEMENTATION_PLAN.md Abschnitt 3, ChatGPT-GO 2026-08-31).
 *
 * Die eigentliche Fachlogik (`updatePlaybookVersionFields()`/
 * `validatePlaybookVersion()`/`publishPlaybookVersion()`, inkl. des
 * now-nach-Lock-Regressionstests) ist bereits vollstaendig in
 * `tests/integration/playbook-admin.test.ts` (AP2) abgedeckt -- dieser
 * Test deckt AUSSCHLIESSLICH die duenne Route-Huelle ab: RBAC-Durchsetzung
 * (`config.playbooks.view`/`.edit`/`.publish`), korrekte HTTP-Statuscode-/
 * Body-Abbildung und Cross-Tenant-/IDOR-Schutz auf HTTP-Ebene -- analog
 * `campaign-admin-version-routes.test.ts` (Phase 13 AP6).
 *
 * Kein separater `.../sections`-Subpfad (siehe Doc-Kommentar in
 * `src/app/api/admin/playbooks/[id]/versions/[versionId]/route.ts`):
 * `sections` wird ausschliesslich ueber `PATCH .../versions/[versionId]`
 * als GESAMTE Liste ersetzt -- diese Datei testet daher `sections` als
 * Teil des PATCH-Bodys, nicht ueber eine eigene Route.
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
import { POST as createPlaybookRoute } from "@/app/api/admin/playbooks/route";
import { POST as createPlaybookVersionRoute } from "@/app/api/admin/playbooks/[id]/versions/route";
import {
  GET as getPlaybookVersionRoute,
  PATCH as patchPlaybookVersionRoute,
} from "@/app/api/admin/playbooks/[id]/versions/[versionId]/route";
import { POST as validatePlaybookVersionRoute } from "@/app/api/admin/playbooks/[id]/versions/[versionId]/validate/route";
import { POST as publishPlaybookVersionRoute } from "@/app/api/admin/playbooks/[id]/versions/[versionId]/publish/route";

const hasDatabaseUrl = Boolean(process.env.DATABASE_URL);
process.env.DEV_AUTH_SECRET ??= "ap3-playbook-admin-version-routes-test-secret-not-for-prod";

describe.skipIf(!hasDatabaseUrl)(
  "Phase 14 AP3: HTTP-Routen /api/admin/playbooks/[id]/versions/[versionId]",
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

    function playbookInput(overrides: Record<string, unknown> = {}) {
      // Fixer, nicht-numerischer Key (Praezedenz: campaign-admin-version-
      // routes.test.ts, CI #120 contact-data-guard-Lehre).
      return { key: "p", name: "Testplaybook", ...overrides };
    }

    function sectionInput(overrides: Record<string, unknown> = {}) {
      return {
        sectionType: "OBJECTION_HANDLING",
        title: "Einwand: Zu teuer",
        content: "Verweise auf den langfristigen Mehrwert.",
        ...overrides,
      };
    }

    /** Legt Playbook + eine DRAFT-TENANT-Version an, liefert beide IDs. */
    async function createPlaybookWithDraftVersion(tenantId: string, editToken: string) {
      const playbookResponse = await createPlaybookRoute(
        requestWithCookie("http://localhost/api/admin/playbooks", editToken, {
          method: "POST",
          body: JSON.stringify(playbookInput()),
        }),
      );
      const { playbook } = await playbookResponse.json();

      const versionResponse = await createPlaybookVersionRoute(
        requestWithCookie(
          `http://localhost/api/admin/playbooks/${playbook.id}/versions`,
          editToken,
          {
            method: "POST",
            body: JSON.stringify({ scopeType: "TENANT", scopeId: tenantId }),
          },
        ),
        routeParams({ id: playbook.id }),
      );
      const { version } = await versionResponse.json();
      return { playbookId: playbook.id as string, versionId: version.id as string };
    }

    function basePath(playbookId: string, versionId: string) {
      return `http://localhost/api/admin/playbooks/${playbookId}/versions/${versionId}`;
    }

    // -----------------------------------------------------------------
    // 401 -- kein Session-Cookie
    // -----------------------------------------------------------------

    it("GET .../versions/[versionId] ohne Session-Cookie -> 401", async () => {
      const id = randomUUID();
      const response = await getPlaybookVersionRoute(
        new NextRequest(basePath(id, id)),
        routeParams({ id, versionId: id }),
      );
      expect(response.status).toBe(401);
    });

    it("PATCH .../versions/[versionId] ohne Session-Cookie -> 401", async () => {
      const id = randomUUID();
      const response = await patchPlaybookVersionRoute(
        new NextRequest(basePath(id, id), { method: "PATCH", body: JSON.stringify({}) }),
        routeParams({ id, versionId: id }),
      );
      expect(response.status).toBe(401);
    });

    it("POST .../validate ohne Session-Cookie -> 401", async () => {
      const id = randomUUID();
      const response = await validatePlaybookVersionRoute(
        new NextRequest(`${basePath(id, id)}/validate`, { method: "POST" }),
        routeParams({ id, versionId: id }),
      );
      expect(response.status).toBe(401);
    });

    it("POST .../publish ohne Session-Cookie -> 401", async () => {
      const id = randomUUID();
      const response = await publishPlaybookVersionRoute(
        new NextRequest(`${basePath(id, id)}/publish`, { method: "POST" }),
        routeParams({ id, versionId: id }),
      );
      expect(response.status).toBe(401);
    });

    // -----------------------------------------------------------------
    // GET .../versions/[versionId]
    // -----------------------------------------------------------------

    it("GET .../versions/[versionId] mit config.playbooks.view -> 200 mit Detail inkl. sections", async () => {
      const tenantId = await createTenant("http-200-get");
      const userId = await createUser(tenantId, "actor");
      const editToken = createSessionToken({
        ...baseSessionPayload(tenantId, userId),
        configPermissions: ["config.playbooks.edit"],
      });
      const { playbookId, versionId } = await createPlaybookWithDraftVersion(tenantId, editToken);

      const viewToken = createSessionToken({
        ...baseSessionPayload(tenantId, userId),
        configPermissions: ["config.playbooks.view"],
      });
      const response = await getPlaybookVersionRoute(
        requestWithCookie(basePath(playbookId, versionId), viewToken),
        routeParams({ id: playbookId, versionId }),
      );
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.version.id).toBe(versionId);
      expect(body.version.sections).toEqual([]);
    });

    it("GET .../versions/[versionId] ohne config.playbooks.view -> 403", async () => {
      const tenantId = await createTenant("http-403-get");
      const userId = await createUser(tenantId, "actor");
      const editToken = createSessionToken({
        ...baseSessionPayload(tenantId, userId),
        configPermissions: ["config.playbooks.edit"],
      });
      const { playbookId, versionId } = await createPlaybookWithDraftVersion(tenantId, editToken);

      const noPermToken = createSessionToken({
        ...baseSessionPayload(tenantId, userId),
        configPermissions: [],
      });
      const response = await getPlaybookVersionRoute(
        requestWithCookie(basePath(playbookId, versionId), noPermToken),
        routeParams({ id: playbookId, versionId }),
      );
      expect(response.status).toBe(403);
    });

    it("GET .../versions/[versionId] fuer eine playbookId aus FREMDEM Mandanten -> 404 (kein Cross-Tenant-Leck)", async () => {
      const tenantA = await createTenant("http-404-get-a");
      const tenantB = await createTenant("http-404-get-b");
      const userB = await createUser(tenantB, "actor");
      const editTokenB = createSessionToken({
        ...baseSessionPayload(tenantB, userB),
        configPermissions: ["config.playbooks.edit"],
      });
      const { playbookId, versionId } = await createPlaybookWithDraftVersion(tenantB, editTokenB);

      const userA = await createUser(tenantA, "actor");
      const viewTokenA = createSessionToken({
        ...baseSessionPayload(tenantA, userA),
        configPermissions: ["config.playbooks.view"],
      });
      const response = await getPlaybookVersionRoute(
        requestWithCookie(basePath(playbookId, versionId), viewTokenA),
        routeParams({ id: playbookId, versionId }),
      );
      expect(response.status).toBe(404);
    });

    // -----------------------------------------------------------------
    // PATCH .../versions/[versionId]
    // -----------------------------------------------------------------

    it("PATCH .../versions/[versionId] ohne config.playbooks.edit -> 403", async () => {
      const tenantId = await createTenant("http-403-patch");
      const userId = await createUser(tenantId, "actor");
      const editToken = createSessionToken({
        ...baseSessionPayload(tenantId, userId),
        configPermissions: ["config.playbooks.edit"],
      });
      const { playbookId, versionId } = await createPlaybookWithDraftVersion(tenantId, editToken);

      const viewToken = createSessionToken({
        ...baseSessionPayload(tenantId, userId),
        configPermissions: ["config.playbooks.view"],
      });
      const response = await patchPlaybookVersionRoute(
        requestWithCookie(basePath(playbookId, versionId), viewToken, {
          method: "PATCH",
          body: JSON.stringify({ description: "geaendert" }),
        }),
        routeParams({ id: playbookId, versionId }),
      );
      expect(response.status).toBe(403);
    });

    it("PATCH .../versions/[versionId] mit gueltigem Patch (description + sections) -> 200", async () => {
      const tenantId = await createTenant("http-200-patch");
      const userId = await createUser(tenantId, "actor");
      const editToken = createSessionToken({
        ...baseSessionPayload(tenantId, userId),
        configPermissions: ["config.playbooks.edit"],
      });
      const { playbookId, versionId } = await createPlaybookWithDraftVersion(tenantId, editToken);

      const response = await patchPlaybookVersionRoute(
        requestWithCookie(basePath(playbookId, versionId), editToken, {
          method: "PATCH",
          body: JSON.stringify({
            description: "Einwandbehandlung v1",
            sections: [sectionInput()],
          }),
        }),
        routeParams({ id: playbookId, versionId }),
      );
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.version.description).toBe("Einwandbehandlung v1");
      expect(body.version.sections).toHaveLength(1);
      expect(body.version.sections[0].sectionType).toBe("OBJECTION_HANDLING");
    });

    it("PATCH .../versions/[versionId] mit strukturell ungueltiger Section (leerer title) -> 400", async () => {
      const tenantId = await createTenant("http-400-section");
      const userId = await createUser(tenantId, "actor");
      const editToken = createSessionToken({
        ...baseSessionPayload(tenantId, userId),
        configPermissions: ["config.playbooks.edit"],
      });
      const { playbookId, versionId } = await createPlaybookWithDraftVersion(tenantId, editToken);

      const response = await patchPlaybookVersionRoute(
        requestWithCookie(basePath(playbookId, versionId), editToken, {
          method: "PATCH",
          body: JSON.stringify({
            sections: [sectionInput({ title: "" })],
          }),
        }),
        routeParams({ id: playbookId, versionId }),
      );
      expect(response.status).toBe(400);
    });

    it("PATCH .../versions/[versionId] fuer eine bereits ACTIVE Version -> 409", async () => {
      const tenantId = await createTenant("http-409-patch");
      const userId = await createUser(tenantId, "actor");
      const editToken = createSessionToken({
        ...baseSessionPayload(tenantId, userId),
        configPermissions: ["config.playbooks.edit", "config.playbooks.publish"],
      });
      const { playbookId, versionId } = await createPlaybookWithDraftVersion(tenantId, editToken);
      const publishResponse = await publishPlaybookVersionRoute(
        requestWithCookie(`${basePath(playbookId, versionId)}/publish`, editToken, {
          method: "POST",
        }),
        routeParams({ id: playbookId, versionId }),
      );
      expect(publishResponse.status).toBe(200);

      const response = await patchPlaybookVersionRoute(
        requestWithCookie(basePath(playbookId, versionId), editToken, {
          method: "PATCH",
          body: JSON.stringify({ description: "darf nicht mehr gehen" }),
        }),
        routeParams({ id: playbookId, versionId }),
      );
      expect(response.status).toBe(409);
    });

    // -----------------------------------------------------------------
    // POST .../validate
    // -----------------------------------------------------------------

    it("POST .../validate fuer eine Version ohne Sections -> 200 mit valid:true (leere Section-Liste ist gueltig)", async () => {
      const tenantId = await createTenant("http-200-validate");
      const userId = await createUser(tenantId, "actor");
      const editToken = createSessionToken({
        ...baseSessionPayload(tenantId, userId),
        configPermissions: ["config.playbooks.edit"],
      });
      const { playbookId, versionId } = await createPlaybookWithDraftVersion(tenantId, editToken);

      const response = await validatePlaybookVersionRoute(
        requestWithCookie(`${basePath(playbookId, versionId)}/validate`, editToken, {
          method: "POST",
        }),
        routeParams({ id: playbookId, versionId }),
      );
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.valid).toBe(true);
    });

    it("POST .../validate fuer eine playbookId aus FREMDEM Mandanten -> 404 (kein Cross-Tenant-Leck)", async () => {
      const tenantA = await createTenant("http-404-validate-a");
      const tenantB = await createTenant("http-404-validate-b");
      const userB = await createUser(tenantB, "actor");
      const editTokenB = createSessionToken({
        ...baseSessionPayload(tenantB, userB),
        configPermissions: ["config.playbooks.edit"],
      });
      const { playbookId, versionId } = await createPlaybookWithDraftVersion(tenantB, editTokenB);

      const userA = await createUser(tenantA, "actor");
      const editTokenA = createSessionToken({
        ...baseSessionPayload(tenantA, userA),
        configPermissions: ["config.playbooks.edit"],
      });
      const response = await validatePlaybookVersionRoute(
        requestWithCookie(`${basePath(playbookId, versionId)}/validate`, editTokenA, {
          method: "POST",
        }),
        routeParams({ id: playbookId, versionId }),
      );
      expect(response.status).toBe(404);
    });

    // -----------------------------------------------------------------
    // POST .../publish
    // -----------------------------------------------------------------

    it("POST .../publish ohne config.playbooks.publish -> 403", async () => {
      const tenantId = await createTenant("http-403-publish");
      const userId = await createUser(tenantId, "actor");
      const editToken = createSessionToken({
        ...baseSessionPayload(tenantId, userId),
        configPermissions: ["config.playbooks.edit"],
      });
      const { playbookId, versionId } = await createPlaybookWithDraftVersion(tenantId, editToken);

      const response = await publishPlaybookVersionRoute(
        requestWithCookie(`${basePath(playbookId, versionId)}/publish`, editToken, {
          method: "POST",
        }),
        routeParams({ id: playbookId, versionId }),
      );
      expect(response.status).toBe(403);
    });

    it("POST .../publish mit config.playbooks.publish -> 200, Version wird ACTIVE", async () => {
      const tenantId = await createTenant("http-200-publish");
      const userId = await createUser(tenantId, "actor");
      const editToken = createSessionToken({
        ...baseSessionPayload(tenantId, userId),
        configPermissions: ["config.playbooks.edit", "config.playbooks.publish"],
      });
      const { playbookId, versionId } = await createPlaybookWithDraftVersion(tenantId, editToken);

      const response = await publishPlaybookVersionRoute(
        requestWithCookie(`${basePath(playbookId, versionId)}/publish`, editToken, {
          method: "POST",
        }),
        routeParams({ id: playbookId, versionId }),
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
        configPermissions: ["config.playbooks.edit", "config.playbooks.publish"],
      });
      const { playbookId, versionId } = await createPlaybookWithDraftVersion(tenantId, editToken);
      await publishPlaybookVersionRoute(
        requestWithCookie(`${basePath(playbookId, versionId)}/publish`, editToken, {
          method: "POST",
        }),
        routeParams({ id: playbookId, versionId }),
      );

      const response = await publishPlaybookVersionRoute(
        requestWithCookie(`${basePath(playbookId, versionId)}/publish`, editToken, {
          method: "POST",
        }),
        routeParams({ id: playbookId, versionId }),
      );
      expect(response.status).toBe(409);
    });

    it("POST .../publish fuer eine Version mit strukturell ungueltiger Section (nur Whitespace-content) -> 422", async () => {
      const tenantId = await createTenant("http-422-publish");
      const userId = await createUser(tenantId, "actor");
      const editToken = createSessionToken({
        ...baseSessionPayload(tenantId, userId),
        configPermissions: ["config.playbooks.edit", "config.playbooks.publish"],
      });
      const { playbookId, versionId } = await createPlaybookWithDraftVersion(tenantId, editToken);

      // PATCH mit gueltigem, nicht-leerem content (Zod min(1) erlaubt " ",
      // nur validatePlaybookVersion()'s Trim-Defense-in-Depth erkennt
      // Whitespace-only als fachlich ungueltig -- siehe playbook-admin.ts).
      await patchPlaybookVersionRoute(
        requestWithCookie(basePath(playbookId, versionId), editToken, {
          method: "PATCH",
          body: JSON.stringify({ sections: [sectionInput({ content: " " })] }),
        }),
        routeParams({ id: playbookId, versionId }),
      );

      const response = await publishPlaybookVersionRoute(
        requestWithCookie(`${basePath(playbookId, versionId)}/publish`, editToken, {
          method: "POST",
        }),
        routeParams({ id: playbookId, versionId }),
      );
      expect(response.status).toBe(422);
      const body = await response.json();
      expect(Array.isArray(body.issues)).toBe(true);
      expect(body.issues.length).toBeGreaterThanOrEqual(1);
    });
  },
);
