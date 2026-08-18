/**
 * Phase 8 AP3 -- Integrationstests fuer die Question-Management-API
 * (Draft-CRUD, siehe PHASE_8_IMPLEMENTATION_PLAN.md Abschnitt 6). Testet
 * sowohl die Service-Schicht (`src/server/admin/question-admin.ts`, direkt
 * innerhalb `runWithTenantContext()`) als auch die volle HTTP-Kette
 * (Route-Handler mit echtem signiertem Session-Cookie), gegen ECHTE
 * Postgres-Fixtures (kein `vi.mock`, Codebase-Konvention, siehe
 * tests/integration/analytics-management-security.test.ts).
 *
 * Ohne DATABASE_URL wird die gesamte Suite uebersprungen statt fehlzuschlagen.
 */

import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { NextRequest } from "next/server";
import { afterAll, describe, expect, it } from "vitest";
import { runWithTenantContext } from "@/server/tenant/context";
import {
  createSessionToken,
  SESSION_COOKIE_NAME,
  type SessionPayload,
} from "@/server/auth/session";
import {
  addQuestionToDraft,
  createDraftVersion,
  getQuestionnaireVersionDetail,
  getQuestionnaireVersionHistory,
  listQuestionnaires,
  publishDraftVersion,
  removeQuestionFromDraft,
  rollbackToVersion,
  updateQuestionInDraft,
  validateDraftVersion,
} from "@/server/admin/question-admin";
import {
  AdminQuestionNotFoundError,
  QuestionnaireNotFoundError,
  QuestionnaireVersionNotDraftError,
  QuestionnaireVersionNotFoundError,
  RollbackSourceNotEligibleError,
} from "@/server/admin/question-admin-errors";
import { QuestionnaireVersionInvalidError } from "@/server/questionnaire/errors";
import { GET as listQuestionnairesRoute } from "@/app/api/admin/questionnaires/route";
import {
  GET as listVersionHistoryRoute,
  POST as createDraftVersionRoute,
} from "@/app/api/admin/questionnaires/[id]/versions/route";
import { GET as getVersionDetailRoute } from "@/app/api/admin/questionnaires/[id]/versions/[versionId]/route";
import { POST as addQuestionRoute } from "@/app/api/admin/questionnaires/[id]/versions/[versionId]/questions/route";
import {
  DELETE as deleteQuestionRoute,
  PATCH as patchQuestionRoute,
} from "@/app/api/admin/questionnaires/[id]/versions/[versionId]/questions/[questionId]/route";
import { POST as validateVersionRoute } from "@/app/api/admin/questionnaires/[id]/versions/[versionId]/validate/route";
import { POST as publishVersionRoute } from "@/app/api/admin/questionnaires/[id]/versions/[versionId]/publish/route";
import { POST as rollbackVersionRoute } from "@/app/api/admin/questionnaires/[id]/versions/[versionId]/rollback/route";

const hasDatabaseUrl = Boolean(process.env.DATABASE_URL);
process.env.DEV_AUTH_SECRET ??= "ap3-question-admin-test-secret-not-for-prod";

describe.skipIf(!hasDatabaseUrl)("Phase 8 AP3: Question Management API (Draft-CRUD)", () => {
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

  async function createQuestionnaireWithActiveVersion(tenantId: string, key: string) {
    const questionnaire = await rawClient.questionnaire.create({
      data: { tenantId, key: `${key}-${suffix}` },
    });
    const activeVersion = await rawClient.questionnaireVersion.create({
      data: {
        tenantId,
        questionnaireId: questionnaire.id,
        label: "v1",
        status: "ACTIVE",
        validFrom: new Date("2026-01-01T00:00:00Z"),
        validTo: null,
      },
    });
    const question = await rawClient.question.create({
      data: {
        tenantId,
        questionnaireVersionId: activeVersion.id,
        key: "q1",
        sortOrder: 1,
      },
    });
    const questionVersion = await rawClient.questionVersion.create({
      data: {
        tenantId,
        questionId: question.id,
        label: "Frage 1",
        answerType: "SINGLE_CHOICE",
        isRequired: true,
        status: "ACTIVE",
        validFrom: new Date("2026-01-01T00:00:00Z"),
        validTo: null,
      },
    });
    // Flache createMany()-Aufrufe statt verschachteltem `create` -- folgt
    // demselben Muster wie prisma/seed.ts (siehe dort `answerOption.createMany()`).
    await rawClient.answerOption.createMany({
      data: [
        { tenantId, questionVersionId: questionVersion.id, key: "ja", label: "Ja", sortOrder: 1 },
        {
          tenantId,
          questionVersionId: questionVersion.id,
          key: "nein",
          label: "Nein",
          sortOrder: 2,
        },
      ],
    });
    return { questionnaireId: questionnaire.id, activeVersionId: activeVersion.id };
  }

  /**
   * Legt einen ECHTEN `User`-Datensatz an. Fuer publishDraftVersion() noetig
   * (schreibt `AuditLog.actorUserId` mit `tenant_id, actor_user_id`-FK auf
   * `User` -- ein reiner `randomUUID()` ohne existierende User-Zeile verletzt
   * die Fremdschluessel-Constraint, CI #41 Root Cause 2). Alle anderen
   * Service-/HTTP-Aufrufe in dieser Suite, die keine AuditLog-Zeile
   * schreiben, verwenden weiterhin `randomUUID()` als `userId` (unveraendert).
   */
  async function createUser(tenantId: string, key: string) {
    const user = await rawClient.user.create({
      data: { tenantId, email: `${key}-${suffix}@example-synthetic.test`, isSynthetic: true },
    });
    return user.id;
  }

  async function createDraftQuestionnaireVersion(tenantId: string, key: string) {
    const questionnaire = await rawClient.questionnaire.create({
      data: { tenantId, key: `${key}-${suffix}` },
    });
    const draftVersion = await rawClient.questionnaireVersion.create({
      data: {
        tenantId,
        questionnaireId: questionnaire.id,
        label: "draft",
        status: "DRAFT",
        validFrom: new Date(),
        validTo: null,
      },
    });
    return { questionnaireId: questionnaire.id, draftVersionId: draftVersion.id };
  }

  /**
   * Legt eine ECHTE `ConsultationSession` an, gepinnt auf `versionId` --
   * fuer den AP5-Pinning-Test noetig (Company/Store/User/Employee sind
   * Pflicht-FKs, siehe schema.prisma `model ConsultationSession`).
   */
  async function createConsultationSessionPinnedTo(
    tenantId: string,
    versionId: string,
    key: string,
  ) {
    const company = await rawClient.company.create({
      data: { tenantId, key: `company-${key}-${suffix}`, name: `Company ${key}` },
    });
    const store = await rawClient.store.create({
      data: {
        tenantId,
        companyId: company.id,
        key: `store-${key}-${suffix}`,
        name: `Store ${key}`,
      },
    });
    const user = await rawClient.user.create({
      data: { tenantId, email: `${key}-${suffix}@example-synthetic.test`, isSynthetic: true },
    });
    const employee = await rawClient.employee.create({
      data: { tenantId, storeId: store.id, userId: user.id, displayName: `MA ${key}` },
    });
    const session = await rawClient.consultationSession.create({
      data: {
        tenantId,
        storeId: store.id,
        employeeId: employee.id,
        questionnaireVersionId: versionId,
        consultationType: "NEW_CONTRACT",
        status: "IN_PROGRESS",
        startedAt: new Date(),
      },
    });
    return session.id;
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

  // -------------------------------------------------------------------
  // 1. Service-Schicht (direkt innerhalb runWithTenantContext())
  // -------------------------------------------------------------------
  describe("1. Service-Schicht", () => {
    it("listQuestionnaires() liefert Fragebogen inkl. Versionen+Status", async () => {
      const tenantId = await createTenant("svc-list");
      await createQuestionnaireWithActiveVersion(tenantId, "qn");
      const result = await runWithTenantContext(
        { tenantId, userId: randomUUID(), roles: [], managementScope: null },
        () => listQuestionnaires(),
      );
      expect(result.length).toBeGreaterThanOrEqual(1);
      expect(result[0]?.versions[0]?.status).toBe("ACTIVE");
    });

    it("getQuestionnaireVersionDetail() liefert Fragen inkl. AnswerOptions", async () => {
      const tenantId = await createTenant("svc-detail");
      const { questionnaireId, activeVersionId } = await createQuestionnaireWithActiveVersion(
        tenantId,
        "qn",
      );
      const detail = await runWithTenantContext(
        { tenantId, userId: randomUUID(), roles: [], managementScope: null },
        () => getQuestionnaireVersionDetail(questionnaireId, activeVersionId),
      );
      expect(detail.questions).toHaveLength(1);
      expect(detail.questions[0]?.answerOptions).toHaveLength(2);
    });

    it("getQuestionnaireVersionDetail() mit fremder questionnaireId -> QuestionnaireNotFoundError", async () => {
      const tenantId = await createTenant("svc-qnf");
      const { activeVersionId } = await createQuestionnaireWithActiveVersion(tenantId, "qn");
      await expect(
        runWithTenantContext(
          { tenantId, userId: randomUUID(), roles: [], managementScope: null },
          () => getQuestionnaireVersionDetail(randomUUID(), activeVersionId),
        ),
      ).rejects.toThrow(QuestionnaireNotFoundError);
    });

    it("getQuestionnaireVersionDetail() mit versionId aus anderem Questionnaire -> QuestionnaireVersionNotFoundError", async () => {
      const tenantId = await createTenant("svc-vnf");
      const { questionnaireId } = await createQuestionnaireWithActiveVersion(tenantId, "qn-a");
      const { activeVersionId: otherVersionId } = await createQuestionnaireWithActiveVersion(
        tenantId,
        "qn-b",
      );
      await expect(
        runWithTenantContext(
          { tenantId, userId: randomUUID(), roles: [], managementScope: null },
          () => getQuestionnaireVersionDetail(questionnaireId, otherVersionId),
        ),
      ).rejects.toThrow(QuestionnaireVersionNotFoundError);
    });

    it("createDraftVersion() ohne copyFromVersionId legt eine leere DRAFT-Version an", async () => {
      const tenantId = await createTenant("svc-create-empty");
      const { questionnaireId } = await createQuestionnaireWithActiveVersion(tenantId, "qn");
      const actorUserId = await createUser(tenantId, "svc-create-empty-actor");
      const version = await runWithTenantContext(
        { tenantId, userId: actorUserId, roles: [], managementScope: null },
        () => createDraftVersion(questionnaireId, { label: "v2" }),
      );
      expect(version.status).toBe("DRAFT");
      expect(version.questions).toHaveLength(0);
    });

    it("createDraftVersion() mit copyFromVersionId kopiert Fragen inkl. AnswerOptions als neue Zeilen", async () => {
      const tenantId = await createTenant("svc-create-copy");
      const { questionnaireId, activeVersionId } = await createQuestionnaireWithActiveVersion(
        tenantId,
        "qn",
      );
      const actorUserId = await createUser(tenantId, "svc-create-copy-actor");
      const version = await runWithTenantContext(
        { tenantId, userId: actorUserId, roles: [], managementScope: null },
        () =>
          createDraftVersion(questionnaireId, { label: "v2", copyFromVersionId: activeVersionId }),
      );
      expect(version.status).toBe("DRAFT");
      expect(version.questions).toHaveLength(1);
      expect(version.questions[0]?.id).not.toBe(
        (
          await runWithTenantContext(
            { tenantId, userId: randomUUID(), roles: [], managementScope: null },
            () => getQuestionnaireVersionDetail(questionnaireId, activeVersionId),
          )
        ).questions[0]?.id,
      );
      expect(version.questions[0]?.answerOptions).toHaveLength(2);
      expect(version.questions[0]?.status).toBe("DRAFT");

      // Quellversion bleibt unveraendert (ACTIVE, unveraenderte Frage-ID).
      const source = await runWithTenantContext(
        { tenantId, userId: randomUUID(), roles: [], managementScope: null },
        () => getQuestionnaireVersionDetail(questionnaireId, activeVersionId),
      );
      expect(source.status).toBe("ACTIVE");
    });

    it("addQuestionToDraft() fuegt eine Frage inkl. AnswerOptions/VisibilityConditions hinzu", async () => {
      const tenantId = await createTenant("svc-add");
      const { questionnaireId, draftVersionId } = await createDraftQuestionnaireVersion(
        tenantId,
        "qn",
      );
      const actorUserId = await createUser(tenantId, "svc-add-actor");
      const question = await runWithTenantContext(
        { tenantId, userId: actorUserId, roles: [], managementScope: null },
        () =>
          addQuestionToDraft(questionnaireId, draftVersionId, {
            key: "neue-frage",
            sortOrder: 1,
            label: "Neue Frage",
            answerType: "BOOLEAN",
            isRequired: false,
            answerOptions: [],
            visibilityConditions: [],
          }),
      );
      expect(question.key).toBe("neue-frage");
      expect(question.status).toBe("DRAFT");
    });

    it("addQuestionToDraft() auf einer ACTIVE-Version -> QuestionnaireVersionNotDraftError (409-Sperre)", async () => {
      const tenantId = await createTenant("svc-add-locked");
      const { questionnaireId, activeVersionId } = await createQuestionnaireWithActiveVersion(
        tenantId,
        "qn",
      );
      await expect(
        runWithTenantContext(
          { tenantId, userId: randomUUID(), roles: [], managementScope: null },
          () =>
            addQuestionToDraft(questionnaireId, activeVersionId, {
              key: "x",
              sortOrder: 1,
              label: "X",
              answerType: "BOOLEAN",
              isRequired: false,
              answerOptions: [],
              visibilityConditions: [],
            }),
        ),
      ).rejects.toThrow(QuestionnaireVersionNotDraftError);
    });

    it("updateQuestionInDraft() aktualisiert Label/AnswerOptions einer DRAFT-Frage in place", async () => {
      const tenantId = await createTenant("svc-update");
      const { questionnaireId, draftVersionId } = await createDraftQuestionnaireVersion(
        tenantId,
        "qn",
      );
      const actorUserId = await createUser(tenantId, "svc-update-actor");
      const question = await runWithTenantContext(
        { tenantId, userId: actorUserId, roles: [], managementScope: null },
        () =>
          addQuestionToDraft(questionnaireId, draftVersionId, {
            key: "q",
            sortOrder: 1,
            label: "Alt",
            answerType: "SINGLE_CHOICE",
            isRequired: false,
            answerOptions: [{ key: "a", label: "A", sortOrder: 1 }],
            visibilityConditions: [],
          }),
      );
      const updated = await runWithTenantContext(
        { tenantId, userId: actorUserId, roles: [], managementScope: null },
        () =>
          updateQuestionInDraft(questionnaireId, draftVersionId, question.id, {
            label: "Neu",
            answerOptions: [
              { key: "a", label: "A", sortOrder: 1 },
              { key: "b", label: "B", sortOrder: 2 },
            ],
          }),
      );
      expect(updated.label).toBe("Neu");
      expect(updated.answerOptions).toHaveLength(2);
      // Gleiche QuestionVersion-Zeile (in place aktualisiert, keine neue Zeile).
      expect(updated.questionVersionId).toBe(question.questionVersionId);
    });

    it("updateQuestionInDraft() mit unbekannter questionId -> AdminQuestionNotFoundError", async () => {
      const tenantId = await createTenant("svc-update-nf");
      const { questionnaireId, draftVersionId } = await createDraftQuestionnaireVersion(
        tenantId,
        "qn",
      );
      await expect(
        runWithTenantContext(
          { tenantId, userId: randomUUID(), roles: [], managementScope: null },
          () =>
            updateQuestionInDraft(questionnaireId, draftVersionId, randomUUID(), { label: "X" }),
        ),
      ).rejects.toThrow(AdminQuestionNotFoundError);
    });

    it("removeQuestionFromDraft() entfernt eine Frage vollstaendig", async () => {
      const tenantId = await createTenant("svc-remove");
      const { questionnaireId, draftVersionId } = await createDraftQuestionnaireVersion(
        tenantId,
        "qn",
      );
      const actorUserId = await createUser(tenantId, "svc-remove-actor");
      const question = await runWithTenantContext(
        { tenantId, userId: actorUserId, roles: [], managementScope: null },
        () =>
          addQuestionToDraft(questionnaireId, draftVersionId, {
            key: "q",
            sortOrder: 1,
            label: "Frage",
            answerType: "BOOLEAN",
            isRequired: false,
            answerOptions: [],
            visibilityConditions: [],
          }),
      );
      await runWithTenantContext(
        { tenantId, userId: actorUserId, roles: [], managementScope: null },
        () => removeQuestionFromDraft(questionnaireId, draftVersionId, question.id),
      );
      const detail = await runWithTenantContext(
        { tenantId, userId: randomUUID(), roles: [], managementScope: null },
        () => getQuestionnaireVersionDetail(questionnaireId, draftVersionId),
      );
      expect(detail.questions).toHaveLength(0);
    });

    it("Tenant-Isolation: questionnaireId aus Tenant A ist in Tenant B nicht auffindbar (0 Treffer statt Cross-Tenant-Zugriff)", async () => {
      const tenantA = await createTenant("iso-a");
      const tenantB = await createTenant("iso-b");
      const { questionnaireId, activeVersionId } = await createQuestionnaireWithActiveVersion(
        tenantA,
        "qn",
      );
      await expect(
        runWithTenantContext(
          { tenantId: tenantB, userId: randomUUID(), roles: [], managementScope: null },
          () => getQuestionnaireVersionDetail(questionnaireId, activeVersionId),
        ),
      ).rejects.toThrow(QuestionnaireNotFoundError);
    });
  });

  // -------------------------------------------------------------------
  // 2. HTTP-Kette (echte Route-Handler, echtes signiertes Session-Cookie)
  // -------------------------------------------------------------------
  describe("2. HTTP-Kette (Config-RBAC + 409/404-Mapping)", () => {
    it("GET /api/admin/questionnaires ohne config.questions.view -> 403", async () => {
      const tenantId = await createTenant("http-view-denied");
      const token = createSessionToken(baseSessionPayload(tenantId));
      const response = await listQuestionnairesRoute(
        requestWithCookie("http://localhost/api/admin/questionnaires", token),
      );
      expect(response.status).toBe(403);
      const body = await response.json();
      expect(body.error).toBe("ConfigAccessDeniedError");
    });

    it("GET /api/admin/questionnaires mit config.questions.view -> 200", async () => {
      const tenantId = await createTenant("http-view-ok");
      await createQuestionnaireWithActiveVersion(tenantId, "qn");
      const token = createSessionToken({
        ...baseSessionPayload(tenantId),
        configPermissions: ["config.questions.view"],
      });
      const response = await listQuestionnairesRoute(
        requestWithCookie("http://localhost/api/admin/questionnaires", token),
      );
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(Array.isArray(body.questionnaires)).toBe(true);
    });

    it("kein Session-Cookie -> 401", async () => {
      const response = await listQuestionnairesRoute(
        new NextRequest("http://localhost/api/admin/questionnaires"),
      );
      expect(response.status).toBe(401);
    });

    it("POST .../versions ohne config.questions.edit (nur view) -> 403", async () => {
      const tenantId = await createTenant("http-edit-denied");
      const { questionnaireId } = await createQuestionnaireWithActiveVersion(tenantId, "qn");
      const token = createSessionToken({
        ...baseSessionPayload(tenantId),
        configPermissions: ["config.questions.view"],
      });
      const response = await createDraftVersionRoute(
        requestWithCookie(
          `http://localhost/api/admin/questionnaires/${questionnaireId}/versions`,
          token,
          { method: "POST", body: JSON.stringify({ label: "v2" }) },
        ),
        routeParams({ id: questionnaireId }),
      );
      expect(response.status).toBe(403);
    });

    it("POST .../versions mit config.questions.edit -> 201, neue DRAFT-Version", async () => {
      const tenantId = await createTenant("http-edit-ok");
      const { questionnaireId } = await createQuestionnaireWithActiveVersion(tenantId, "qn");
      // Echter User() noetig: createDraftVersion() schreibt seit AP7 AuditLog.actorUserId
      // mit FK auf User -- ein session.userId ohne existierende User-Zeile
      // verletzt die Fremdschluessel-Constraint (analog CI #41 Root Cause 2).
      const actorUserId = await createUser(tenantId, "http-edit-ok-actor");
      const token = createSessionToken({
        ...baseSessionPayload(tenantId),
        userId: actorUserId,
        configPermissions: ["config.questions.view", "config.questions.edit"],
      });
      const response = await createDraftVersionRoute(
        requestWithCookie(
          `http://localhost/api/admin/questionnaires/${questionnaireId}/versions`,
          token,
          { method: "POST", body: JSON.stringify({ label: "v2" }) },
        ),
        routeParams({ id: questionnaireId }),
      );
      expect(response.status).toBe(201);
      const body = await response.json();
      expect(body.version.status).toBe("DRAFT");
    });

    it("POST .../questions auf einer ACTIVE-Version -> 409 (serverseitige DRAFT-Sperre)", async () => {
      const tenantId = await createTenant("http-409");
      const { questionnaireId, activeVersionId } = await createQuestionnaireWithActiveVersion(
        tenantId,
        "qn",
      );
      const token = createSessionToken({
        ...baseSessionPayload(tenantId),
        configPermissions: ["config.questions.view", "config.questions.edit"],
      });
      const response = await addQuestionRoute(
        requestWithCookie(
          `http://localhost/api/admin/questionnaires/${questionnaireId}/versions/${activeVersionId}/questions`,
          token,
          {
            method: "POST",
            body: JSON.stringify({
              key: "x",
              sortOrder: 1,
              label: "X",
              answerType: "BOOLEAN",
              isRequired: false,
            }),
          },
        ),
        routeParams({ id: questionnaireId, versionId: activeVersionId }),
      );
      expect(response.status).toBe(409);
      const body = await response.json();
      expect(body.error).toBe("QuestionnaireVersionNotDraftError");
    });

    it("GET .../versions/[versionId] mit manipulierter fremder-Mandant-versionId -> 404 (Tenant-Isolation ueber gescopten Client)", async () => {
      const tenantA = await createTenant("http-iso-a");
      const tenantB = await createTenant("http-iso-b");
      const { questionnaireId: qA, activeVersionId: vA } =
        await createQuestionnaireWithActiveVersion(tenantA, "qn");
      await createQuestionnaireWithActiveVersion(tenantB, "qn");

      const tokenB = createSessionToken({
        ...baseSessionPayload(tenantB),
        configPermissions: ["config.questions.view"],
      });
      const response = await getVersionDetailRoute(
        requestWithCookie(`http://localhost/api/admin/questionnaires/${qA}/versions/${vA}`, tokenB),
        routeParams({ id: qA, versionId: vA }),
      );
      expect(response.status).toBe(404);
    });

    it("PATCH .../questions/[questionId] mit unbekannter questionId -> 404", async () => {
      const tenantId = await createTenant("http-patch-404");
      const { questionnaireId, draftVersionId } = await createDraftQuestionnaireVersion(
        tenantId,
        "qn",
      );
      const token = createSessionToken({
        ...baseSessionPayload(tenantId),
        configPermissions: ["config.questions.view", "config.questions.edit"],
      });
      const response = await patchQuestionRoute(
        requestWithCookie(
          `http://localhost/api/admin/questionnaires/${questionnaireId}/versions/${draftVersionId}/questions/${randomUUID()}`,
          token,
          { method: "PATCH", body: JSON.stringify({ label: "X" }) },
        ),
        routeParams({ id: questionnaireId, versionId: draftVersionId, questionId: randomUUID() }),
      );
      expect(response.status).toBe(404);
    });

    it("DELETE .../questions/[questionId] auf DRAFT-Version -> 204, danach in der Detailansicht nicht mehr vorhanden", async () => {
      const tenantId = await createTenant("http-delete");
      const { questionnaireId, draftVersionId } = await createDraftQuestionnaireVersion(
        tenantId,
        "qn",
      );
      // Echter User() noetig: addQuestionToDraft()/removeQuestionFromDraft()
      // schreiben seit AP7 AuditLog.actorUserId mit FK auf User.
      const actorUserId = await createUser(tenantId, "http-delete-actor");
      const editorToken = createSessionToken({
        ...baseSessionPayload(tenantId),
        userId: actorUserId,
        configPermissions: ["config.questions.view", "config.questions.edit"],
      });
      const created = await addQuestionRoute(
        requestWithCookie(
          `http://localhost/api/admin/questionnaires/${questionnaireId}/versions/${draftVersionId}/questions`,
          editorToken,
          {
            method: "POST",
            body: JSON.stringify({
              key: "q",
              sortOrder: 1,
              label: "Frage",
              answerType: "BOOLEAN",
              isRequired: false,
            }),
          },
        ),
        routeParams({ id: questionnaireId, versionId: draftVersionId }),
      );
      const { question } = await created.json();

      const deleteResponse = await deleteQuestionRoute(
        requestWithCookie(
          `http://localhost/api/admin/questionnaires/${questionnaireId}/versions/${draftVersionId}/questions/${question.id}`,
          editorToken,
          { method: "DELETE" },
        ),
        routeParams({ id: questionnaireId, versionId: draftVersionId, questionId: question.id }),
      );
      expect(deleteResponse.status).toBe(204);

      const detailResponse = await getVersionDetailRoute(
        requestWithCookie(
          `http://localhost/api/admin/questionnaires/${questionnaireId}/versions/${draftVersionId}`,
          editorToken,
        ),
        routeParams({ id: questionnaireId, versionId: draftVersionId }),
      );
      const { version } = await detailResponse.json();
      expect(version.questions).toHaveLength(0);
    });

    it("config_editor (view+edit, kein publish) darf mutieren -- publish-Berechtigung ist nicht Voraussetzung fuer AP3-Routen", async () => {
      const tenantId = await createTenant("http-editor-role");
      const { questionnaireId } = await createQuestionnaireWithActiveVersion(tenantId, "qn");
      // Echter User() noetig: createDraftVersion() schreibt seit AP7 AuditLog.actorUserId.
      const actorUserId = await createUser(tenantId, "http-editor-role-actor");
      const editorToken = createSessionToken({
        ...baseSessionPayload(tenantId),
        userId: actorUserId,
        configPermissions: ["config.questions.view", "config.questions.edit"],
      });
      const response = await createDraftVersionRoute(
        requestWithCookie(
          `http://localhost/api/admin/questionnaires/${questionnaireId}/versions`,
          editorToken,
          { method: "POST", body: JSON.stringify({ label: "v2" }) },
        ),
        routeParams({ id: questionnaireId }),
      );
      expect(response.status).toBe(201);
    });

    // -----------------------------------------------------------------
    // AP4 -- Validate & Publish (siehe PHASE_8_IMPLEMENTATION_PLAN.md
    // Abschnitt 7). Fixture-Helfer fuer einen publish-faehigen DRAFT
    // (mit genau einer gueltigen BOOLEAN-Frage, damit
    // validateQuestionnaireVersion() nicht wegen "keine Fragen" scheitert).
    // -----------------------------------------------------------------

    async function createPublishableDraft(tenantId: string, key: string) {
      const { questionnaireId, draftVersionId } = await createDraftQuestionnaireVersion(
        tenantId,
        key,
      );
      // Echter User() noetig: addQuestionToDraft() schreibt seit AP7
      // AuditLog.actorUserId mit FK auf User.
      const actorUserId = await createUser(tenantId, `${key}-fixture-actor`);
      await runWithTenantContext(
        { tenantId, userId: actorUserId, roles: [], managementScope: null },
        () =>
          addQuestionToDraft(questionnaireId, draftVersionId, {
            key: "q1",
            sortOrder: 1,
            label: "Frage 1",
            answerType: "BOOLEAN",
            isRequired: false,
            answerOptions: [],
            visibilityConditions: [],
          }),
      );
      return { questionnaireId, draftVersionId };
    }

    it("validateDraftVersion() liefert {valid:true} fuer einen vollstaendigen Entwurf", async () => {
      const tenantId = await createTenant("svc-validate-ok");
      const { questionnaireId, draftVersionId } = await createPublishableDraft(
        tenantId,
        "qn-validate-ok",
      );
      const result = await runWithTenantContext(
        { tenantId, userId: randomUUID(), roles: [], managementScope: null },
        () => validateDraftVersion(questionnaireId, draftVersionId),
      );
      expect(result).toEqual({ valid: true });
    });

    it("validateDraftVersion() eines leeren Entwurfs (keine Fragen) -> QuestionnaireVersionInvalidError mit issues[]", async () => {
      const tenantId = await createTenant("svc-validate-invalid");
      const { questionnaireId, draftVersionId } = await createDraftQuestionnaireVersion(
        tenantId,
        "qn-validate-invalid",
      );
      await expect(
        runWithTenantContext(
          { tenantId, userId: randomUUID(), roles: [], managementScope: null },
          () => validateDraftVersion(questionnaireId, draftVersionId),
        ),
      ).rejects.toThrow(QuestionnaireVersionInvalidError);
    });

    it("publishDraftVersion(): setzt bisherige ACTIVE-Version auf EXPIRED, neue auf ACTIVE, flippt QuestionVersions, schreibt AuditLog", async () => {
      const tenantId = await createTenant("svc-publish-ok");
      const { questionnaireId, activeVersionId } = await createQuestionnaireWithActiveVersion(
        tenantId,
        "qn",
      );
      // Entwurf DESSELBEN Questionnaire als Kopie der ACTIVE-Version (enthaelt
      // dadurch bereits eine gueltige Frage -- validateQuestionnaireVersion()
      // besteht ohne weitere Vorbereitung).
      const actorUserId = await createUser(tenantId, "svc-publish-ok-actor");
      const copiedDraft = await runWithTenantContext(
        { tenantId, userId: actorUserId, roles: [], managementScope: null },
        () =>
          createDraftVersion(questionnaireId, { label: "v2", copyFromVersionId: activeVersionId }),
      );

      const result = await runWithTenantContext(
        { tenantId, userId: actorUserId, roles: [], managementScope: null },
        () => publishDraftVersion(questionnaireId, copiedDraft.id),
      );

      expect(result.previousActiveVersionId).toBe(activeVersionId);
      expect(result.version.status).toBe("ACTIVE");
      expect(result.version.questions[0]?.status).toBe("ACTIVE");

      const oldVersion = await rawClient.questionnaireVersion.findUniqueOrThrow({
        where: { id: activeVersionId },
      });
      expect(oldVersion.status).toBe("EXPIRED");
      expect(oldVersion.validTo).not.toBeNull();

      // Seit AP7 existieren fuer diese QuestionnaireVersion ZWEI Audit-Eintraege:
      // CREATE (aus createDraftVersion(), oben) und ACTIVATE (aus publishDraftVersion()).
      // Beide sind erwuenscht und werden hier gezielt nach action gefiltert geprueft.
      const activateEntries = await rawClient.auditLog.findMany({
        where: {
          tenantId,
          entityType: "QuestionnaireVersion",
          entityId: copiedDraft.id,
          action: "ACTIVATE",
        },
      });
      expect(activateEntries).toHaveLength(1);
      expect(activateEntries[0]?.actorUserId).toBe(actorUserId);

      const createEntries = await rawClient.auditLog.findMany({
        where: {
          tenantId,
          entityType: "QuestionnaireVersion",
          entityId: copiedDraft.id,
          action: "CREATE",
        },
      });
      expect(createEntries).toHaveLength(1);
    });

    it("publishDraftVersion() auf einer bereits ACTIVE-Version -> QuestionnaireVersionNotDraftError (409)", async () => {
      const tenantId = await createTenant("svc-publish-not-draft");
      const { questionnaireId, activeVersionId } = await createQuestionnaireWithActiveVersion(
        tenantId,
        "qn",
      );
      await expect(
        runWithTenantContext(
          { tenantId, userId: randomUUID(), roles: [], managementScope: null },
          () => publishDraftVersion(questionnaireId, activeVersionId),
        ),
      ).rejects.toThrow(QuestionnaireVersionNotDraftError);
    });

    it("publishDraftVersion() eines fachlich ungueltigen Entwurfs -> QuestionnaireVersionInvalidError, KEINE Statusaenderung (Atomaritaet)", async () => {
      const tenantId = await createTenant("svc-publish-invalid");
      const { questionnaireId, draftVersionId } = await createDraftQuestionnaireVersion(
        tenantId,
        "qn-publish-invalid",
      );
      await expect(
        runWithTenantContext(
          { tenantId, userId: randomUUID(), roles: [], managementScope: null },
          () => publishDraftVersion(questionnaireId, draftVersionId),
        ),
      ).rejects.toThrow(QuestionnaireVersionInvalidError);

      const version = await rawClient.questionnaireVersion.findUniqueOrThrow({
        where: { id: draftVersionId },
      });
      expect(version.status).toBe("DRAFT");
      const auditEntries = await rawClient.auditLog.findMany({
        where: { tenantId, entityType: "QuestionnaireVersion", entityId: draftVersionId },
      });
      expect(auditEntries).toHaveLength(0);
    });

    it("HTTP: POST .../publish ohne config.questions.publish (nur edit) -> 403", async () => {
      const tenantId = await createTenant("http-publish-denied");
      const { questionnaireId, draftVersionId } = await createPublishableDraft(
        tenantId,
        "qn-http-publish-denied",
      );
      const token = createSessionToken({
        ...baseSessionPayload(tenantId),
        configPermissions: ["config.questions.view", "config.questions.edit"],
      });
      const response = await publishVersionRoute(
        requestWithCookie(
          `http://localhost/api/admin/questionnaires/${questionnaireId}/versions/${draftVersionId}/publish`,
          token,
          { method: "POST" },
        ),
        routeParams({ id: questionnaireId, versionId: draftVersionId }),
      );
      expect(response.status).toBe(403);
    });

    it("HTTP: POST .../publish mit config.questions.publish -> 200, Version ACTIVE", async () => {
      const tenantId = await createTenant("http-publish-ok");
      const { questionnaireId, draftVersionId } = await createPublishableDraft(
        tenantId,
        "qn-http-publish-ok",
      );
      // Echter User() noetig: publishDraftVersion() schreibt AuditLog.actorUserId
      // mit FK auf User -- ein session.userId ohne existierende User-Zeile
      // verletzt die Fremdschluessel-Constraint (CI #41 Root Cause 2).
      const actorUserId = await createUser(tenantId, "http-publish-ok-actor");
      const token = createSessionToken({
        ...baseSessionPayload(tenantId),
        userId: actorUserId,
        configPermissions: [
          "config.questions.view",
          "config.questions.edit",
          "config.questions.publish",
        ],
      });
      const response = await publishVersionRoute(
        requestWithCookie(
          `http://localhost/api/admin/questionnaires/${questionnaireId}/versions/${draftVersionId}/publish`,
          token,
          { method: "POST" },
        ),
        routeParams({ id: questionnaireId, versionId: draftVersionId }),
      );
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.version.status).toBe("ACTIVE");
      expect(body.previousActiveVersionId).toBeNull();
    });

    it("HTTP: POST .../validate eines leeren Entwurfs -> 422 mit strukturierter issues-Liste", async () => {
      const tenantId = await createTenant("http-validate-422");
      const { questionnaireId, draftVersionId } = await createDraftQuestionnaireVersion(
        tenantId,
        "qn-http-validate-422",
      );
      const token = createSessionToken({
        ...baseSessionPayload(tenantId),
        configPermissions: ["config.questions.view", "config.questions.edit"],
      });
      const response = await validateVersionRoute(
        requestWithCookie(
          `http://localhost/api/admin/questionnaires/${questionnaireId}/versions/${draftVersionId}/validate`,
          token,
          { method: "POST" },
        ),
        routeParams({ id: questionnaireId, versionId: draftVersionId }),
      );
      expect(response.status).toBe(422);
      const body = await response.json();
      expect(Array.isArray(body.issues)).toBe(true);
      expect(body.issues.length).toBeGreaterThan(0);
    });
  });

  // -------------------------------------------------------------------
  // 3. AP5 -- Versionshistorie & Rollback (siehe
  //    PHASE_8_IMPLEMENTATION_PLAN.md Abschnitt 8). Testet Service-Schicht
  //    (getQuestionnaireVersionHistory()/rollbackToVersion()), HTTP-Kette,
  //    und den geschaeftskritischen End-zu-Ende-Pinning-Test (ChatGPT-
  //    Beispiel woertlich uebernommen: Beratung bleibt auf ihrer gepinnten
  //    Version, auch nachdem Rollback+Publish eine neue ACTIVE-Version
  //    erzeugt haben).
  // -------------------------------------------------------------------
  describe("3. AP5: Versionshistorie & Rollback", () => {
    it("getQuestionnaireVersionHistory() liefert alle Versionen (neueste zuerst) unabhaengig vom Status", async () => {
      const tenantId = await createTenant("svc-history");
      const { questionnaireId, activeVersionId } = await createQuestionnaireWithActiveVersion(
        tenantId,
        "qn",
      );
      const actorUserId = await createUser(tenantId, "svc-history-actor");
      await runWithTenantContext(
        { tenantId, userId: actorUserId, roles: [], managementScope: null },
        () => createDraftVersion(questionnaireId, { label: "v2-draft" }),
      );
      const history = await runWithTenantContext(
        { tenantId, userId: randomUUID(), roles: [], managementScope: null },
        () => getQuestionnaireVersionHistory(questionnaireId),
      );
      expect(history).toHaveLength(2);
      const statuses = history.map((v) => v.status).sort();
      expect(statuses).toEqual(["ACTIVE", "DRAFT"]);
      expect(history.some((v) => v.id === activeVersionId)).toBe(true);
    });

    it("rollbackToVersion() von einer ACTIVE-Version erzeugt eine neue DRAFT-Version als Tiefkopie, Quelle bleibt unveraendert, AuditLog(ROLLBACK) geschrieben", async () => {
      const tenantId = await createTenant("svc-rollback-active");
      const { questionnaireId, activeVersionId } = await createQuestionnaireWithActiveVersion(
        tenantId,
        "qn",
      );
      const actorUserId = await createUser(tenantId, "svc-rollback-active-actor");

      const rollbackDraft = await runWithTenantContext(
        { tenantId, userId: actorUserId, roles: [], managementScope: null },
        () => rollbackToVersion(questionnaireId, activeVersionId),
      );

      expect(rollbackDraft.status).toBe("DRAFT");
      expect(rollbackDraft.id).not.toBe(activeVersionId);
      expect(rollbackDraft.questions).toHaveLength(1);
      expect(rollbackDraft.questions[0]?.status).toBe("DRAFT");

      // Quellversion (und ihre Frage-ID) bleibt UNVERAENDERT.
      const source = await rawClient.questionnaireVersion.findUniqueOrThrow({
        where: { id: activeVersionId },
      });
      expect(source.status).toBe("ACTIVE");
      const sourceQuestions = await rawClient.question.findMany({
        where: { questionnaireVersionId: activeVersionId },
      });
      expect(sourceQuestions[0]?.id).not.toBe(rollbackDraft.questions[0]?.id);

      const auditEntries = await rawClient.auditLog.findMany({
        where: { tenantId, entityType: "QuestionnaireVersion", entityId: rollbackDraft.id },
      });
      expect(auditEntries).toHaveLength(1);
      expect(auditEntries[0]?.action).toBe("ROLLBACK");
      expect(auditEntries[0]?.actorUserId).toBe(actorUserId);
      const metadata = auditEntries[0]?.metadata as Record<string, unknown>;
      expect(metadata.sourceVersionId).toBe(activeVersionId);
    });

    it("rollbackToVersion() von einer EXPIRED-Version funktioniert (historische, nicht mehr aktive Version)", async () => {
      const tenantId = await createTenant("svc-rollback-expired");
      const { questionnaireId, activeVersionId: v1Id } = await createQuestionnaireWithActiveVersion(
        tenantId,
        "qn",
      );
      // Zweite Version veroeffentlichen -> v1 wird EXPIRED.
      const actorUserId = await createUser(tenantId, "svc-rollback-expired-actor");
      const v2Draft = await runWithTenantContext(
        { tenantId, userId: actorUserId, roles: [], managementScope: null },
        () => createDraftVersion(questionnaireId, { label: "v2", copyFromVersionId: v1Id }),
      );
      await runWithTenantContext(
        { tenantId, userId: actorUserId, roles: [], managementScope: null },
        () => publishDraftVersion(questionnaireId, v2Draft.id),
      );
      const v1AfterExpiry = await rawClient.questionnaireVersion.findUniqueOrThrow({
        where: { id: v1Id },
      });
      expect(v1AfterExpiry.status).toBe("EXPIRED");

      // Rollback auf die jetzt EXPIRED v1.
      const rollbackDraft = await runWithTenantContext(
        { tenantId, userId: actorUserId, roles: [], managementScope: null },
        () => rollbackToVersion(questionnaireId, v1Id, "Rollback auf v1"),
      );
      expect(rollbackDraft.status).toBe("DRAFT");
      expect(rollbackDraft.label).toBe("Rollback auf v1");
      expect(rollbackDraft.questions).toHaveLength(1);

      // v1 bleibt EXPIRED (keine Mutation der Historie durch den Rollback selbst).
      const v1AfterRollback = await rawClient.questionnaireVersion.findUniqueOrThrow({
        where: { id: v1Id },
      });
      expect(v1AfterRollback.status).toBe("EXPIRED");
    });

    it("rollbackToVersion() von einer DRAFT-Version -> RollbackSourceNotEligibleError (409)", async () => {
      const tenantId = await createTenant("svc-rollback-draft-src");
      const { questionnaireId, draftVersionId } = await createDraftQuestionnaireVersion(
        tenantId,
        "qn",
      );
      await expect(
        runWithTenantContext(
          { tenantId, userId: randomUUID(), roles: [], managementScope: null },
          () => rollbackToVersion(questionnaireId, draftVersionId),
        ),
      ).rejects.toThrow(RollbackSourceNotEligibleError);
    });

    it("Rollback-DRAFT durchlaeuft regulaer den AP4-Publish-Pfad (keine zweite Publish-Logik)", async () => {
      const tenantId = await createTenant("svc-rollback-publish");
      const { questionnaireId, activeVersionId: v1Id } = await createQuestionnaireWithActiveVersion(
        tenantId,
        "qn",
      );
      const actorUserId = await createUser(tenantId, "svc-rollback-publish-actor");

      const rollbackDraft = await runWithTenantContext(
        { tenantId, userId: actorUserId, roles: [], managementScope: null },
        () => rollbackToVersion(questionnaireId, v1Id),
      );
      const publishResult = await runWithTenantContext(
        { tenantId, userId: actorUserId, roles: [], managementScope: null },
        () => publishDraftVersion(questionnaireId, rollbackDraft.id),
      );

      expect(publishResult.version.status).toBe("ACTIVE");
      expect(publishResult.previousActiveVersionId).toBe(v1Id);
      const v1AfterPublish = await rawClient.questionnaireVersion.findUniqueOrThrow({
        where: { id: v1Id },
      });
      expect(v1AfterPublish.status).toBe("EXPIRED");
    });

    it("GESCHAEFTSKRITISCH -- Pinning: laufende ConsultationSession bleibt auf ihrer Version, nachdem Rollback+Publish eine neue ACTIVE-Version erzeugt hat", async () => {
      const tenantId = await createTenant("pinning");
      const { questionnaireId, activeVersionId: v1Id } = await createQuestionnaireWithActiveVersion(
        tenantId,
        "qn",
      );

      // Beratung A startet auf der aktuell ACTIVE-Version (v1) -- gepinnt.
      const sessionAId = await createConsultationSessionPinnedTo(tenantId, v1Id, "beratung-a");

      const actorUserId = await createUser(tenantId, "pinning-actor");
      // Admin macht einen Rollback (hier: auf v1 selbst, um ohne weitere
      // Fixtures eine neue Version zu erzeugen) und veroeffentlicht sie ->
      // v2 wird die neue ACTIVE-Version, v1 wird EXPIRED.
      const rollbackDraft = await runWithTenantContext(
        { tenantId, userId: actorUserId, roles: [], managementScope: null },
        () => rollbackToVersion(questionnaireId, v1Id),
      );
      await runWithTenantContext(
        { tenantId, userId: actorUserId, roles: [], managementScope: null },
        () => publishDraftVersion(questionnaireId, rollbackDraft.id),
      );

      // Beratung A bleibt UNVERAENDERT auf v1 gepinnt -- publishDraftVersion()
      // fasst ConsultationSession-Zeilen an keiner Stelle an (Plan Abschnitt 3.4).
      const sessionAAfter = await rawClient.consultationSession.findUniqueOrThrow({
        where: { id: sessionAId },
      });
      expect(sessionAAfter.questionnaireVersionId).toBe(v1Id);

      // Eine NEUE Beratung B, die jetzt startet, wuerde die neue ACTIVE-Version
      // (den veroeffentlichten Rollback-Entwurf) erhalten.
      const sessionBId = await createConsultationSessionPinnedTo(
        tenantId,
        rollbackDraft.id,
        "beratung-b",
      );
      const sessionB = await rawClient.consultationSession.findUniqueOrThrow({
        where: { id: sessionBId },
      });
      expect(sessionB.questionnaireVersionId).toBe(rollbackDraft.id);
      expect(sessionB.questionnaireVersionId).not.toBe(sessionAAfter.questionnaireVersionId);

      // v1 (Beratung As Version) ist jetzt EXPIRED, aber die Beratung bleibt
      // trotzdem darauf gepinnt -- genau die geforderte Invariante.
      const v1Final = await rawClient.questionnaireVersion.findUniqueOrThrow({
        where: { id: v1Id },
      });
      expect(v1Final.status).toBe("EXPIRED");
    });

    it("HTTP: GET .../versions (Historie) mit config.questions.view -> 200, alle Versionen", async () => {
      const tenantId = await createTenant("http-history-ok");
      const { questionnaireId } = await createQuestionnaireWithActiveVersion(tenantId, "qn");
      const token = createSessionToken({
        ...baseSessionPayload(tenantId),
        configPermissions: ["config.questions.view"],
      });
      const response = await listVersionHistoryRoute(
        requestWithCookie(
          `http://localhost/api/admin/questionnaires/${questionnaireId}/versions`,
          token,
        ),
        routeParams({ id: questionnaireId }),
      );
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(Array.isArray(body.versions)).toBe(true);
      expect(body.versions.length).toBeGreaterThanOrEqual(1);
    });

    it("HTTP: POST .../rollback ohne config.questions.edit (nur view) -> 403", async () => {
      const tenantId = await createTenant("http-rollback-denied");
      const { questionnaireId, activeVersionId } = await createQuestionnaireWithActiveVersion(
        tenantId,
        "qn",
      );
      const token = createSessionToken({
        ...baseSessionPayload(tenantId),
        configPermissions: ["config.questions.view"],
      });
      const response = await rollbackVersionRoute(
        requestWithCookie(
          `http://localhost/api/admin/questionnaires/${questionnaireId}/versions/${activeVersionId}/rollback`,
          token,
          { method: "POST", body: JSON.stringify({}) },
        ),
        routeParams({ id: questionnaireId, versionId: activeVersionId }),
      );
      expect(response.status).toBe(403);
    });

    it("HTTP: POST .../rollback mit config.questions.edit -> 201, neue DRAFT-Version als Kopie", async () => {
      const tenantId = await createTenant("http-rollback-ok");
      const { questionnaireId, activeVersionId } = await createQuestionnaireWithActiveVersion(
        tenantId,
        "qn",
      );
      const actorUserId = await createUser(tenantId, "http-rollback-ok-actor");
      const token = createSessionToken({
        ...baseSessionPayload(tenantId),
        userId: actorUserId,
        configPermissions: ["config.questions.view", "config.questions.edit"],
      });
      const response = await rollbackVersionRoute(
        requestWithCookie(
          `http://localhost/api/admin/questionnaires/${questionnaireId}/versions/${activeVersionId}/rollback`,
          token,
          { method: "POST", body: JSON.stringify({ label: "Rollback-Test" }) },
        ),
        routeParams({ id: questionnaireId, versionId: activeVersionId }),
      );
      expect(response.status).toBe(201);
      const body = await response.json();
      expect(body.version.status).toBe("DRAFT");
      expect(body.version.label).toBe("Rollback-Test");
      expect(body.version.id).not.toBe(activeVersionId);
    });

    it("HTTP: POST .../rollback von einer DRAFT-Quelle -> 409", async () => {
      const tenantId = await createTenant("http-rollback-draft-src");
      const { questionnaireId, draftVersionId } = await createDraftQuestionnaireVersion(
        tenantId,
        "qn",
      );
      const token = createSessionToken({
        ...baseSessionPayload(tenantId),
        configPermissions: ["config.questions.view", "config.questions.edit"],
      });
      const response = await rollbackVersionRoute(
        requestWithCookie(
          `http://localhost/api/admin/questionnaires/${questionnaireId}/versions/${draftVersionId}/rollback`,
          token,
          { method: "POST", body: JSON.stringify({}) },
        ),
        routeParams({ id: questionnaireId, versionId: draftVersionId }),
      );
      expect(response.status).toBe(409);
      const body = await response.json();
      expect(body.error).toBe("RollbackSourceNotEligibleError");
    });

    it("Tenant-Isolation: rollbackToVersion() mit versionId aus fremdem Mandanten -> QuestionnaireVersionNotFoundError", async () => {
      const tenantA = await createTenant("iso-rollback-a");
      const tenantB = await createTenant("iso-rollback-b");
      const { questionnaireId: qA, activeVersionId: vA } =
        await createQuestionnaireWithActiveVersion(tenantA, "qn");
      await expect(
        runWithTenantContext(
          { tenantId: tenantB, userId: randomUUID(), roles: [], managementScope: null },
          () => rollbackToVersion(qA, vA),
        ),
      ).rejects.toThrow(QuestionnaireNotFoundError);
    });
  });

  // -------------------------------------------------------------------
  // 4. AP7 -- Audit-Vollstaendigkeit (siehe PHASE_8_IMPLEMENTATION_PLAN.md
  //    Abschnitt 9). ChatGPT-Befund: createDraftVersion()/addQuestionToDraft()/
  //    updateQuestionInDraft()/removeQuestionFromDraft() schrieben bislang
  //    KEIN AuditLog (im Gegensatz zu publishDraftVersion()/rollbackToVersion(),
  //    bereits durch AP4/AP5-Tests abgedeckt). Diese Suite prueft fuer jede
  //    der vier Funktionen: genau EIN erwarteter Audit-Eintrag mit korrekter
  //    action/entityType/entityId/actorUserId, sowie Atomaritaet (schlaegt
  //    ein spaeterer Schritt DERSELBEN Transaktion fehl, existiert auch der
  //    Audit-Eintrag nicht -- die Postgres-Transaktion rollt beides gemeinsam
  //    zurueck, da tx.auditLog.create() als letzter Schritt in derselben
  //    Transaktion wie die fachliche Mutation liegt).
  // -------------------------------------------------------------------
  describe("4. AP7: Audit-Vollstaendigkeit (Draft-CRUD)", () => {
    it("createDraftVersion() schreibt genau 1 AuditLog(CREATE, QuestionnaireVersion)", async () => {
      const tenantId = await createTenant("audit-create-version");
      const { questionnaireId } = await createQuestionnaireWithActiveVersion(tenantId, "qn");
      const actorUserId = await createUser(tenantId, "audit-create-version-actor");
      const version = await runWithTenantContext(
        { tenantId, userId: actorUserId, roles: [], managementScope: null },
        () => createDraftVersion(questionnaireId, { label: "v2" }),
      );
      const auditEntries = await rawClient.auditLog.findMany({
        where: { tenantId, entityType: "QuestionnaireVersion", entityId: version.id },
      });
      expect(auditEntries).toHaveLength(1);
      expect(auditEntries[0]?.action).toBe("CREATE");
      expect(auditEntries[0]?.actorUserId).toBe(actorUserId);
      const metadata = auditEntries[0]?.metadata as Record<string, unknown>;
      expect(metadata.questionnaireId).toBe(questionnaireId);
    });

    it("addQuestionToDraft() schreibt genau 1 AuditLog(CREATE, Question)", async () => {
      const tenantId = await createTenant("audit-create-question");
      const { questionnaireId, draftVersionId } = await createDraftQuestionnaireVersion(
        tenantId,
        "qn",
      );
      const actorUserId = await createUser(tenantId, "audit-create-question-actor");
      const question = await runWithTenantContext(
        { tenantId, userId: actorUserId, roles: [], managementScope: null },
        () =>
          addQuestionToDraft(questionnaireId, draftVersionId, {
            key: "neue-frage",
            sortOrder: 1,
            label: "Neue Frage",
            answerType: "BOOLEAN",
            isRequired: false,
            answerOptions: [],
            visibilityConditions: [],
          }),
      );
      const auditEntries = await rawClient.auditLog.findMany({
        where: { tenantId, entityType: "Question", entityId: question.id },
      });
      expect(auditEntries).toHaveLength(1);
      expect(auditEntries[0]?.action).toBe("CREATE");
      expect(auditEntries[0]?.actorUserId).toBe(actorUserId);
    });

    it("updateQuestionInDraft() schreibt genau 1 AuditLog(UPDATE, Question) mit geaenderten Feldern in metadata", async () => {
      const tenantId = await createTenant("audit-update-question");
      const { questionnaireId, draftVersionId } = await createDraftQuestionnaireVersion(
        tenantId,
        "qn",
      );
      const actorUserId = await createUser(tenantId, "audit-update-question-actor");
      const question = await runWithTenantContext(
        { tenantId, userId: actorUserId, roles: [], managementScope: null },
        () =>
          addQuestionToDraft(questionnaireId, draftVersionId, {
            key: "q",
            sortOrder: 1,
            label: "Alt",
            answerType: "BOOLEAN",
            isRequired: false,
            answerOptions: [],
            visibilityConditions: [],
          }),
      );
      await runWithTenantContext(
        { tenantId, userId: actorUserId, roles: [], managementScope: null },
        () => updateQuestionInDraft(questionnaireId, draftVersionId, question.id, { label: "Neu" }),
      );
      const auditEntries = await rawClient.auditLog.findMany({
        where: { tenantId, entityType: "Question", entityId: question.id, action: "UPDATE" },
      });
      expect(auditEntries).toHaveLength(1);
      expect(auditEntries[0]?.actorUserId).toBe(actorUserId);
      const metadata = auditEntries[0]?.metadata as Record<string, unknown>;
      expect(metadata.changedFields).toEqual(["label"]);
    });

    it("removeQuestionFromDraft() schreibt genau 1 AuditLog(DELETE, Question) -- neuer AuditAction-Wert (ChatGPT-Entscheidung 'Option A')", async () => {
      const tenantId = await createTenant("audit-delete-question");
      const { questionnaireId, draftVersionId } = await createDraftQuestionnaireVersion(
        tenantId,
        "qn",
      );
      const actorUserId = await createUser(tenantId, "audit-delete-question-actor");
      const question = await runWithTenantContext(
        { tenantId, userId: actorUserId, roles: [], managementScope: null },
        () =>
          addQuestionToDraft(questionnaireId, draftVersionId, {
            key: "q",
            sortOrder: 1,
            label: "Frage",
            answerType: "BOOLEAN",
            isRequired: false,
            answerOptions: [],
            visibilityConditions: [],
          }),
      );
      await runWithTenantContext(
        { tenantId, userId: actorUserId, roles: [], managementScope: null },
        () => removeQuestionFromDraft(questionnaireId, draftVersionId, question.id),
      );
      // Question-Zeile existiert nicht mehr, aber der Audit-Eintrag bleibt
      // (append-only, kein FK von AuditLog.entityId auf Question -- siehe
      // Modulkommentar audit_logs_append_only-Trigger, Phase 2B).
      const auditEntries = await rawClient.auditLog.findMany({
        where: { tenantId, entityType: "Question", entityId: question.id, action: "DELETE" },
      });
      expect(auditEntries).toHaveLength(1);
      expect(auditEntries[0]?.actorUserId).toBe(actorUserId);
      const metadata = auditEntries[0]?.metadata as Record<string, unknown>;
      expect(metadata.key).toBe("q");
      expect(metadata.reason).toBe("removed_from_draft");
    });

    it("Atomaritaet: addQuestionToDraft() mit ungueltiger VisibilityCondition (unbekannte targetQuestionId) -> FK-Fehler, KEINE Frage angelegt, KEIN Audit-Eintrag", async () => {
      const tenantId = await createTenant("audit-atomic-fk");
      const { questionnaireId, draftVersionId } = await createDraftQuestionnaireVersion(
        tenantId,
        "qn",
      );
      const actorUserId = await createUser(tenantId, "audit-atomic-fk-actor");
      await expect(
        runWithTenantContext(
          { tenantId, userId: actorUserId, roles: [], managementScope: null },
          () =>
            addQuestionToDraft(questionnaireId, draftVersionId, {
              key: "kaputte-frage",
              sortOrder: 1,
              label: "Kaputte Frage",
              answerType: "BOOLEAN",
              isRequired: false,
              answerOptions: [],
              visibilityConditions: [
                {
                  targetQuestionId: randomUUID(),
                  operator: "EQUALS",
                  comparisonValue: "true",
                  combinator: "AND",
                },
              ],
            }),
        ),
      ).rejects.toThrow();

      // Weder die Frage noch ein Audit-Eintrag duerfen die fehlgeschlagene
      // Transaktion ueberleben -- beides liegt in derselben tx.$transaction().
      const orphanedQuestions = await rawClient.question.findMany({
        where: { tenantId, questionnaireVersionId: draftVersionId, key: "kaputte-frage" },
      });
      expect(orphanedQuestions).toHaveLength(0);
      const auditEntries = await rawClient.auditLog.findMany({
        where: { tenantId, entityType: "Question", action: "CREATE" },
      });
      expect(auditEntries).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------
  // 5. AP8 -- Hardening (siehe PHASE_8_IMPLEMENTATION_PLAN.md Abschnitt 9
  //    und die Versionierungs-Invariante "niemals zwei ACTIVE-Versionen").
  //    Bei der Pruefung dieser Invariante wurde zunaechst faelschlich eine
  //    offene Race-Condition-Luecke vermutet (siehe ChatGPT-Konsultation
  //    2026-08-18) -- tatsaechlich verhindert dies bereits der seit der
  //    Init-Migration bestehende EXCLUDE-Constraint
  //    "questionnaire_versions_no_overlap" (siehe Kommentar bei
  //    QuestionnaireVersion in schema.prisma; ChatGPT-Entscheidung
  //    "Option B" -- kein zusaetzlicher Unique-Index noetig). Dieser Test
  //    reproduziert den DB-Lock-Wettlauf tatsaechlich (zwei parallele
  //    publishDraftVersion()-Aufrufe fuer zwei VERSCHIEDENE DRAFT-Versionen
  //    desselben Questionnaire) und beweist damit die Invariante End-zu-Ende,
  //    nicht nur per PGlite-Direkt-Insert (siehe verify_migration_pglite.mjs).
  // -------------------------------------------------------------------
  describe("5. AP8: Hardening (Versionierungs-Invarianten)", () => {
    it("zwei nahezu gleichzeitige publishDraftVersion()-Aufrufe fuer zwei verschiedene DRAFT-Versionen desselben Questionnaire: hoechstens eine wird ACTIVE", async () => {
      const tenantId = await createTenant("ap8-publish-race");
      const { questionnaireId } = await createQuestionnaireWithActiveVersion(tenantId, "qn");
      const actorUserId = await createUser(tenantId, "ap8-publish-race-actor");

      async function preparePublishableDraft(label: string) {
        const version = await runWithTenantContext(
          { tenantId, userId: actorUserId, roles: [], managementScope: null },
          () => createDraftVersion(questionnaireId, { label }),
        );
        await runWithTenantContext(
          { tenantId, userId: actorUserId, roles: [], managementScope: null },
          () =>
            addQuestionToDraft(questionnaireId, version.id, {
              key: `${label}-q1`,
              sortOrder: 1,
              label: "Frage 1",
              answerType: "BOOLEAN",
              isRequired: false,
              answerOptions: [],
              visibilityConditions: [],
            }),
        );
        return version.id;
      }

      const draftAId = await preparePublishableDraft("draft-a");
      const draftBId = await preparePublishableDraft("draft-b");

      const results = await Promise.allSettled([
        runWithTenantContext(
          { tenantId, userId: actorUserId, roles: [], managementScope: null },
          () => publishDraftVersion(questionnaireId, draftAId),
        ),
        runWithTenantContext(
          { tenantId, userId: actorUserId, roles: [], managementScope: null },
          () => publishDraftVersion(questionnaireId, draftBId),
        ),
      ]);

      const fulfilled = results.filter((r) => r.status === "fulfilled");
      const rejected = results.filter((r) => r.status === "rejected");
      // Mindestens einer der beiden konkurrierenden Publish-Versuche muss
      // erfolgreich sein (kein genereller Deadlock/Totalausfall) -- exakt
      // einer, ODER im (bei zwei CPU-Kernen theoretisch moeglichen, hier
      // nicht beobachteten) seriellen Fall beide, sofern Postgres sie
      // vollstaendig nacheinander abarbeitet. Die eigentliche Invariante
      // wird unten direkt gegen die DB geprueft, nicht ueber die Anzahl
      // der Promise-Ergebnisse.
      expect(fulfilled.length).toBeGreaterThanOrEqual(1);
      expect(fulfilled.length + rejected.length).toBe(2);

      // Die eigentliche Invariante: unabhaengig vom genauen Timing darf
      // NIE mehr als eine ACTIVE QuestionnaireVersion fuer dieses
      // Questionnaire existieren.
      const activeVersions = await rawClient.questionnaireVersion.findMany({
        where: { tenantId, questionnaireId, status: "ACTIVE" },
      });
      expect(activeVersions).toHaveLength(1);

      // Und: hoechstens ein ACTIVATE-Audit-Eintrag pro tatsaechlich
      // aktivierter Version -- ein fehlgeschlagener Publish-Versuch darf
      // keinen Audit-Eintrag hinterlassen (Atomaritaet, siehe AP7).
      const activateAudits = await rawClient.auditLog.findMany({
        where: {
          tenantId,
          entityType: "QuestionnaireVersion",
          action: "ACTIVATE",
          entityId: { in: [draftAId, draftBId] },
        },
      });
      expect(activateAudits).toHaveLength(fulfilled.length);
    });
  });
});
