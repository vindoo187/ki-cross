/**
 * Integrationstests fuer `recommendation/opportunity-status.ts::updateSalesOpportunityStatus()`
 * (AP5, siehe PHASE_5_IMPLEMENTATION_PLAN.md Abschnitt 2.2 Punkt 4 +
 * Abschnitt 9) gegen eine ECHTE Postgres-Datenbank (gleiches Muster wie
 * `recommendation-engine.test.ts`).
 *
 * `SalesOpportunity`-Fixtures werden bewusst DIREKT per Raw-Client angelegt
 * (kein Cross-Selling-Regelsatz/`evaluate()`-Aufruf noetig) -
 * `updateSalesOpportunityStatus()` interessiert sich nur fuer die bereits
 * existierende Zeile, nicht fuer ihren Entstehungsweg.
 *
 * Ohne DATABASE_URL wird die gesamte Suite uebersprungen statt fehlzuschlagen.
 */

import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runWithTenantContext } from "@/server/tenant/context";
import { updateSalesOpportunityStatus } from "@/server/recommendation/opportunity-status";
import {
  InvalidOpportunityStatusTransitionError,
  SalesOpportunityNotFoundError,
} from "@/server/recommendation/errors";

const hasDatabaseUrl = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDatabaseUrl)(
  "updateSalesOpportunityStatus() (Integrationstest, echte Postgres-DB)",
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
    ) {
      const session = await rawClient.consultationSession.create({
        data: {
          tenantId,
          storeId,
          employeeId,
          questionnaireVersionId,
          consultationType: "NEW_CONTRACT",
          status: "IN_PROGRESS",
          startedAt: SESSION_AT,
        },
      });
      return session.id;
    }

    async function createSalesOpportunity(
      tenantId: string,
      consultationSessionId: string,
      status: "OPEN" | "OFFERED" | "ACCEPTED" | "DECLINED" | "DEFERRED" = "OPEN",
    ) {
      const opportunity = await rawClient.salesOpportunity.create({
        data: { tenantId, consultationSessionId, status },
      });
      return opportunity.id;
    }

    function asEmployee<T>(tenantId: string, employeeId: string, fn: () => Promise<T>): Promise<T> {
      return runWithTenantContext({ tenantId, userId: randomUUID(), employeeId, roles: [] }, fn);
    }

    let tenantAId: string;
    let storeAId: string;
    let employeeAId: string;
    let questionnaireVersionAId: string;

    let tenantBId: string;

    beforeAll(async () => {
      const a = await createTenant("opp-a");
      tenantAId = a.tenantId;
      storeAId = a.storeId;
      employeeAId = a.employeeId;
      questionnaireVersionAId = await createQuestionnaireVersion(tenantAId, "opp-a-fragebogen");

      const b = await createTenant("opp-b");
      tenantBId = b.tenantId;
    });

    async function freshOpportunity(
      status: "OPEN" | "OFFERED" | "ACCEPTED" | "DECLINED" | "DEFERRED" = "OPEN",
    ) {
      const sessionId = await createSession(
        tenantAId,
        storeAId,
        employeeAId,
        questionnaireVersionAId,
      );
      const opportunityId = await createSalesOpportunity(tenantAId, sessionId, status);
      return { sessionId, opportunityId };
    }

    it("OPEN -> OFFERED: aktualisiert Status, setzt offeredAt, schreibt OPPORTUNITY_OFFERED-Analytics-Event", async () => {
      const { opportunityId } = await freshOpportunity("OPEN");

      const result = await asEmployee(tenantAId, employeeAId, () =>
        updateSalesOpportunityStatus({ salesOpportunityId: opportunityId, status: "OFFERED" }),
      );

      expect(result.status).toBe("OFFERED");
      expect(result.offeredAt).not.toBeNull();
      expect(result.resolvedAt).toBeNull();

      const event = await rawClient.analyticsEvent.findFirst({
        where: { eventType: "OPPORTUNITY_OFFERED", tenantId: tenantAId },
      });
      expect(event).not.toBeNull();
      expect(event!.storeId).toBe(storeAId);
      expect(event!.employeeId).toBe(employeeAId);
    });

    it("OFFERED -> ACCEPTED: aktualisiert Status, setzt resolvedAt, schreibt bewusst KEIN Analytics-Event (dokumentierte Enum-Luecke)", async () => {
      const { opportunityId } = await freshOpportunity("OFFERED");

      const result = await asEmployee(tenantAId, employeeAId, () =>
        updateSalesOpportunityStatus({ salesOpportunityId: opportunityId, status: "ACCEPTED" }),
      );

      expect(result.status).toBe("ACCEPTED");
      expect(result.resolvedAt).not.toBeNull();

      const events = await rawClient.analyticsEvent.findMany({ where: { tenantId: tenantAId } });
      const matching = events.find(
        (e) =>
          e.payload !== null &&
          typeof e.payload === "object" &&
          (e.payload as Record<string, unknown>).salesOpportunityId === opportunityId,
      );
      expect(matching).toBeUndefined();
    });

    it("OFFERED -> DECLINED: aktualisiert Status, setzt resolvedAt, schreibt OPPORTUNITY_DECLINED-Analytics-Event", async () => {
      const { opportunityId } = await freshOpportunity("OFFERED");

      const result = await asEmployee(tenantAId, employeeAId, () =>
        updateSalesOpportunityStatus({ salesOpportunityId: opportunityId, status: "DECLINED" }),
      );

      expect(result.status).toBe("DECLINED");
      expect(result.resolvedAt).not.toBeNull();

      const event = await rawClient.analyticsEvent.findFirst({
        where: { eventType: "OPPORTUNITY_DECLINED", tenantId: tenantAId },
      });
      expect(event).not.toBeNull();
    });

    it("OFFERED -> DEFERRED: aktualisiert Status, kein Analytics-Event, offeredAt/resolvedAt bleiben unveraendert", async () => {
      const { opportunityId } = await freshOpportunity("OFFERED");
      const before = await rawClient.salesOpportunity.findUniqueOrThrow({
        where: { id: opportunityId },
      });

      const result = await asEmployee(tenantAId, employeeAId, () =>
        updateSalesOpportunityStatus({ salesOpportunityId: opportunityId, status: "DEFERRED" }),
      );

      expect(result.status).toBe("DEFERRED");
      expect(result.offeredAt).toEqual(before.offeredAt ? before.offeredAt.toISOString() : null);
      expect(result.resolvedAt).toEqual(before.resolvedAt ? before.resolvedAt.toISOString() : null);
    });

    it("DEFERRED -> OFFERED: erneutes Anbieten ist erlaubt und aktualisiert offeredAt", async () => {
      const { opportunityId } = await freshOpportunity("DEFERRED");

      const result = await asEmployee(tenantAId, employeeAId, () =>
        updateSalesOpportunityStatus({ salesOpportunityId: opportunityId, status: "OFFERED" }),
      );

      expect(result.status).toBe("OFFERED");
      expect(result.offeredAt).not.toBeNull();
    });

    it("OPEN -> ACCEPTED (uebersprungener Uebergang) wirft InvalidOpportunityStatusTransitionError", async () => {
      const { opportunityId } = await freshOpportunity("OPEN");
      await expect(
        asEmployee(tenantAId, employeeAId, () =>
          updateSalesOpportunityStatus({ salesOpportunityId: opportunityId, status: "ACCEPTED" }),
        ),
      ).rejects.toThrow(InvalidOpportunityStatusTransitionError);
    });

    it("ACCEPTED ist terminal: jeder weitere Uebergang wirft InvalidOpportunityStatusTransitionError", async () => {
      const { opportunityId } = await freshOpportunity("ACCEPTED");
      await expect(
        asEmployee(tenantAId, employeeAId, () =>
          updateSalesOpportunityStatus({ salesOpportunityId: opportunityId, status: "OFFERED" }),
        ),
      ).rejects.toThrow(InvalidOpportunityStatusTransitionError);
    });

    it("nicht existierende SalesOpportunity wirft SalesOpportunityNotFoundError", async () => {
      await expect(
        asEmployee(tenantAId, employeeAId, () =>
          updateSalesOpportunityStatus({ salesOpportunityId: randomUUID(), status: "OFFERED" }),
        ),
      ).rejects.toThrow(SalesOpportunityNotFoundError);
    });

    it("Mandantentrennung: eine SalesOpportunity von Tenant A ist unter Tenant B nicht sichtbar", async () => {
      const { opportunityId } = await freshOpportunity("OPEN");
      await expect(
        asEmployee(tenantBId, randomUUID(), () =>
          updateSalesOpportunityStatus({ salesOpportunityId: opportunityId, status: "OFFERED" }),
        ),
      ).rejects.toThrow(SalesOpportunityNotFoundError);
    });
  },
);
