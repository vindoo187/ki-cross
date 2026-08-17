/**
 * Integrationstests fuer `consultation-ui/completion.ts::completeConsultation()`
 * (AP10, siehe PHASE_5_IMPLEMENTATION_PLAN.md Abschnitt 10 + Abschnitt 16
 * Punkt 10) gegen eine ECHTE Postgres-Datenbank (gleiches Muster wie
 * `sales-opportunity-status.test.ts`).
 *
 * `ConsultationSession`-Fixtures werden bewusst DIREKT per Raw-Client
 * angelegt (kein Fragebogen-Durchlauf noetig) -- `completeConsultation()`
 * interessiert sich nur fuer die bereits existierende Sitzung, nicht fuer
 * ihren Entstehungsweg.
 *
 * Ohne DATABASE_URL wird die gesamte Suite uebersprungen statt fehlzuschlagen.
 */

import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runWithTenantContext } from "@/server/tenant/context";
import { completeConsultation } from "@/server/consultation-ui/completion";
import { ConsultationSessionNotFoundError } from "@/server/questionnaire/errors";

const hasDatabaseUrl = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDatabaseUrl)(
  "completeConsultation() (Integrationstest, echte Postgres-DB)",
  () => {
    const rawClient = new PrismaClient();
    const suffix = randomUUID().slice(0, 8);
    const FROM = new Date("2026-01-01T00:00:00Z");
    const SESSION_AT = new Date("2026-03-01T00:00:00Z");

    afterAll(async () => {
      await rawClient.$disconnect();
    });

    async function createTenant(key: string) {
      const tenant = await rawClient.tenant.create({
        data: { key: `${key}-${suffix}`, name: `Test ${key}`, isSynthetic: true },
      });
      const company = await rawClient.company.create({
        data: { tenantId: tenant.id, key: `company-${key}-${suffix}`, name: `Company ${key}` },
      });
      const store = await rawClient.store.create({
        data: {
          tenantId: tenant.id,
          companyId: company.id,
          key: `store-${key}-${suffix}`,
          name: `Store ${key}`,
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
        data: { tenantId: tenant.id, storeId: store.id, userId: user.id, displayName: `MA ${key}` },
      });
      return { tenantId: tenant.id, storeId: store.id, employeeId: employee.id };
    }

    async function createQuestionnaireVersion(tenantId: string, key: string) {
      const questionnaire = await rawClient.questionnaire.create({
        data: { tenantId, key: `${key}-${suffix}` },
      });
      const version = await rawClient.questionnaireVersion.create({
        data: {
          tenantId,
          questionnaireId: questionnaire.id,
          label: "V1",
          validFrom: FROM,
          validTo: null,
          status: "ACTIVE",
        },
      });
      return version.id;
    }

    async function createSession(
      tenantId: string,
      storeId: string,
      employeeId: string,
      questionnaireVersionId: string,
      status: "IN_PROGRESS" | "COMPLETED" | "ABANDONED" = "IN_PROGRESS",
    ) {
      const session = await rawClient.consultationSession.create({
        data: {
          tenantId,
          storeId,
          employeeId,
          questionnaireVersionId,
          consultationType: "NEW_CONTRACT",
          status,
          startedAt: SESSION_AT,
          endedAt: status === "IN_PROGRESS" ? null : new Date("2026-03-01T00:30:00Z"),
        },
      });
      return session.id;
    }

    function asEmployee<T>(tenantId: string, employeeId: string, fn: () => Promise<T>): Promise<T> {
      return runWithTenantContext(
        { tenantId, userId: randomUUID(), employeeId, roles: [], managementScope: null },
        fn,
      );
    }

    let tenantAId: string;
    let storeAId: string;
    let employeeAId: string;
    let questionnaireVersionAId: string;

    let tenantBId: string;
    let employeeBId: string;

    beforeAll(async () => {
      const a = await createTenant("complete-a");
      tenantAId = a.tenantId;
      storeAId = a.storeId;
      employeeAId = a.employeeId;
      questionnaireVersionAId = await createQuestionnaireVersion(
        tenantAId,
        "complete-a-fragebogen",
      );

      const b = await createTenant("complete-b");
      tenantBId = b.tenantId;
      employeeBId = b.employeeId;
    });

    it("erste Ausfuehrung: schreibt genau ein CONSULTATION_COMPLETED-Analytics-Event, alreadyCompleted=false", async () => {
      const sessionId = await createSession(
        tenantAId,
        storeAId,
        employeeAId,
        questionnaireVersionAId,
      );

      const result = await asEmployee(tenantAId, employeeAId, () =>
        completeConsultation(sessionId),
      );

      expect(result.consultationSessionId).toBe(sessionId);
      expect(result.alreadyCompleted).toBe(false);

      const events = await rawClient.analyticsEvent.findMany({
        where: { eventType: "CONSULTATION_COMPLETED", tenantId: tenantAId },
      });
      const matching = events.filter(
        (e) =>
          e.payload !== null &&
          typeof e.payload === "object" &&
          (e.payload as Record<string, unknown>).consultationSessionId === sessionId,
      );
      expect(matching).toHaveLength(1);
      expect(matching[0]!.storeId).toBe(storeAId);
      expect(matching[0]!.employeeId).toBe(employeeAId);
    });

    it("wiederholte Ausfuehrung: schreibt kein zweites Event, alreadyCompleted=true", async () => {
      const sessionId = await createSession(
        tenantAId,
        storeAId,
        employeeAId,
        questionnaireVersionAId,
      );

      const first = await asEmployee(tenantAId, employeeAId, () => completeConsultation(sessionId));
      expect(first.alreadyCompleted).toBe(false);

      const second = await asEmployee(tenantAId, employeeAId, () =>
        completeConsultation(sessionId),
      );
      expect(second.alreadyCompleted).toBe(true);

      const events = await rawClient.analyticsEvent.findMany({
        where: { eventType: "CONSULTATION_COMPLETED", tenantId: tenantAId },
      });
      const matching = events.filter(
        (e) =>
          e.payload !== null &&
          typeof e.payload === "object" &&
          (e.payload as Record<string, unknown>).consultationSessionId === sessionId,
      );
      expect(matching).toHaveLength(1);
    });

    it("funktioniert unabhaengig vom Sitzungsstatus (hier: bereits COMPLETED durch completeQuestionnaire())", async () => {
      const sessionId = await createSession(
        tenantAId,
        storeAId,
        employeeAId,
        questionnaireVersionAId,
        "COMPLETED",
      );

      const result = await asEmployee(tenantAId, employeeAId, () =>
        completeConsultation(sessionId),
      );

      expect(result.alreadyCompleted).toBe(false);
      const event = await rawClient.analyticsEvent.findFirst({
        where: {
          eventType: "CONSULTATION_COMPLETED",
          tenantId: tenantAId,
          payload: { path: ["consultationSessionId"], equals: sessionId },
        },
      });
      expect(event).not.toBeNull();
    });

    it("nicht existierende ConsultationSession wirft ConsultationSessionNotFoundError", async () => {
      await expect(
        asEmployee(tenantAId, employeeAId, () => completeConsultation(randomUUID())),
      ).rejects.toThrow(ConsultationSessionNotFoundError);
    });

    it("Mandantentrennung: eine ConsultationSession von Tenant A ist unter Tenant B nicht sichtbar", async () => {
      const sessionId = await createSession(
        tenantAId,
        storeAId,
        employeeAId,
        questionnaireVersionAId,
      );

      await expect(
        asEmployee(tenantBId, employeeBId, () => completeConsultation(sessionId)),
      ).rejects.toThrow(ConsultationSessionNotFoundError);
    });
  },
);
