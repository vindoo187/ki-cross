/**
 * Integrationstests fuer `consultation-ui/abandonment.ts::abandonConsultation()`
 * (AP10, siehe PHASE_5_IMPLEMENTATION_PLAN.md Abschnitt 10 + Projektleiter-
 * Entscheidung zum manuellen Abbruchflow vom 2026-08-03) gegen eine ECHTE
 * Postgres-Datenbank -- gleiches Muster wie
 * `consultation-completion.test.ts`.
 *
 * `ConsultationSession`-Fixtures werden bewusst DIREKT per Raw-Client
 * angelegt (kein Fragebogen-Durchlauf noetig) -- `abandonConsultation()`
 * interessiert sich nur fuer die bereits existierende Sitzung und
 * vorhandene terminale Analytics-Events, nicht fuer den Entstehungsweg der
 * Sitzung.
 *
 * Ohne DATABASE_URL wird die gesamte Suite uebersprungen statt fehlzuschlagen.
 */

import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runWithTenantContext } from "@/server/tenant/context";
import { abandonConsultation } from "@/server/consultation-ui/abandonment";
import { completeConsultation } from "@/server/consultation-ui/completion";
import {
  ConsultationAlreadyCompletedError,
  ConsultationSessionNotFoundError,
} from "@/server/questionnaire/errors";

const hasDatabaseUrl = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDatabaseUrl)(
  "abandonConsultation() (Integrationstest, echte Postgres-DB)",
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
      return runWithTenantContext({ tenantId, userId: randomUUID(), employeeId, roles: [] }, fn);
    }

    let tenantAId: string;
    let storeAId: string;
    let employeeAId: string;
    let questionnaireVersionAId: string;

    let tenantBId: string;
    let employeeBId: string;

    beforeAll(async () => {
      const a = await createTenant("abandon-a");
      tenantAId = a.tenantId;
      storeAId = a.storeId;
      employeeAId = a.employeeId;
      questionnaireVersionAId = await createQuestionnaireVersion(tenantAId, "abandon-a-fragebogen");

      const b = await createTenant("abandon-b");
      tenantBId = b.tenantId;
      employeeBId = b.employeeId;
    });

    it("erste Ausfuehrung: schreibt genau ein CONSULTATION_ABANDONED-Analytics-Event, alreadyAbandoned=false", async () => {
      const sessionId = await createSession(
        tenantAId,
        storeAId,
        employeeAId,
        questionnaireVersionAId,
      );

      const result = await asEmployee(tenantAId, employeeAId, () => abandonConsultation(sessionId));

      expect(result.consultationSessionId).toBe(sessionId);
      expect(result.alreadyAbandoned).toBe(false);

      const events = await rawClient.analyticsEvent.findMany({
        where: { eventType: "CONSULTATION_ABANDONED", tenantId: tenantAId },
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

    it("optionaler reasonCode wird korrekt in den Event-Payload geschrieben", async () => {
      const sessionId = await createSession(
        tenantAId,
        storeAId,
        employeeAId,
        questionnaireVersionAId,
      );

      await asEmployee(tenantAId, employeeAId, () =>
        abandonConsultation(sessionId, "CUSTOMER_HAS_NO_TIME"),
      );

      const event = await rawClient.analyticsEvent.findFirst({
        where: {
          eventType: "CONSULTATION_ABANDONED",
          tenantId: tenantAId,
          payload: { path: ["consultationSessionId"], equals: sessionId },
        },
      });
      expect(event).not.toBeNull();
      expect((event!.payload as Record<string, unknown>).reasonCode).toBe("CUSTOMER_HAS_NO_TIME");
    });

    it("wiederholte Ausfuehrung: schreibt kein zweites Event, alreadyAbandoned=true (Idempotenz, auch bei Doppelklick)", async () => {
      const sessionId = await createSession(
        tenantAId,
        storeAId,
        employeeAId,
        questionnaireVersionAId,
      );

      const first = await asEmployee(tenantAId, employeeAId, () => abandonConsultation(sessionId));
      expect(first.alreadyAbandoned).toBe(false);

      const second = await asEmployee(tenantAId, employeeAId, () => abandonConsultation(sessionId));
      expect(second.alreadyAbandoned).toBe(true);

      const events = await rawClient.analyticsEvent.findMany({
        where: { eventType: "CONSULTATION_ABANDONED", tenantId: tenantAId },
      });
      const matching = events.filter(
        (e) =>
          e.payload !== null &&
          typeof e.payload === "object" &&
          (e.payload as Record<string, unknown>).consultationSessionId === sessionId,
      );
      expect(matching).toHaveLength(1);
    });

    it("bereits per completeConsultation() abgeschlossene Sitzung: wirft ConsultationAlreadyCompletedError, kein Event wird geschrieben", async () => {
      const sessionId = await createSession(
        tenantAId,
        storeAId,
        employeeAId,
        questionnaireVersionAId,
      );

      await asEmployee(tenantAId, employeeAId, () => completeConsultation(sessionId));

      await expect(
        asEmployee(tenantAId, employeeAId, () => abandonConsultation(sessionId)),
      ).rejects.toThrow(ConsultationAlreadyCompletedError);

      const abandonedEvents = await rawClient.analyticsEvent.findMany({
        where: {
          eventType: "CONSULTATION_ABANDONED",
          tenantId: tenantAId,
          payload: { path: ["consultationSessionId"], equals: sessionId },
        },
      });
      expect(abandonedEvents).toHaveLength(0);
    });

    it("nicht existierende ConsultationSession wirft ConsultationSessionNotFoundError", async () => {
      await expect(
        asEmployee(tenantAId, employeeAId, () => abandonConsultation(randomUUID())),
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
        asEmployee(tenantBId, employeeBId, () => abandonConsultation(sessionId)),
      ).rejects.toThrow(ConsultationSessionNotFoundError);
    });
  },
);
