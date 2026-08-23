/**
 * Integrationstest fuer `buildVisibleQuestionContext()` (Phase 12 AP1,
 * ChatGPT-Schicht 2 "Visible-Question Context") gegen eine ECHTE Postgres-
 * Datenbank (gleiches Muster wie `tests/integration/questionnaire-engine.test.ts`).
 * Deckt die zwei ChatGPT-Filterregeln ab: `SHORT_TEXT`-Fragen sind
 * ausgeschlossen (Entscheidung 4), bereits beantwortete Fragen sind
 * ausgeschlossen (Entscheidung 3) -- reine Wiederverwendung von
 * `loadQuestionnaireState()`, daher bewusst kein erneuter Test der
 * darunterliegenden Sichtbarkeitslogik selbst (siehe
 * `questionnaire-engine.test.ts`).
 *
 * Ohne DATABASE_URL wird die gesamte Suite uebersprungen statt fehlzuschlagen.
 */

import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runWithTenantContext } from "@/server/tenant/context";
import { saveAnswer, startQuestionnaire } from "@/server/questionnaire/service";
import { buildVisibleQuestionContext } from "@/server/ai-extraction/visible-question-context";

const hasDatabaseUrl = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDatabaseUrl)(
  "buildVisibleQuestionContext() (Integrationstest, echte Postgres-DB)",
  () => {
    const rawClient = new PrismaClient();
    const suffix = randomUUID().slice(0, 8);

    let tenantId: string;
    let storeId: string;
    let employeeId: string;
    let boolQuestionId: string;

    beforeAll(async () => {
      const tenant = await rawClient.tenant.create({
        data: { key: `ai-ext-${suffix}`, name: "Test AI-Extraction", isSynthetic: true },
      });
      tenantId = tenant.id;
      const company = await rawClient.company.create({
        data: { tenantId, key: `company-${suffix}`, name: "Company" },
      });
      const store = await rawClient.store.create({
        data: { tenantId, companyId: company.id, key: `store-${suffix}`, name: "Store" },
      });
      storeId = store.id;
      const user = await rawClient.user.create({
        data: { tenantId, email: `${suffix}@example-synthetic.test`, isSynthetic: true },
      });
      const employee = await rawClient.employee.create({
        data: { tenantId, storeId, userId: user.id, displayName: "MA Test" },
      });
      employeeId = employee.id;

      const questionnaire = await rawClient.questionnaire.create({
        data: { tenantId, key: `ai-ext-fragebogen-${suffix}` },
      });
      const version = await rawClient.questionnaireVersion.create({
        data: {
          tenantId,
          questionnaireId: questionnaire.id,
          label: "V1",
          validFrom: new Date("2026-01-01T00:00:00Z"),
          status: "ACTIVE",
        },
      });

      const boolQuestion = await rawClient.question.create({
        data: { tenantId, questionnaireVersionId: version.id, key: "hat_bedarf", sortOrder: 1 },
      });
      boolQuestionId = boolQuestion.id;
      await rawClient.questionVersion.create({
        data: {
          tenantId,
          questionId: boolQuestion.id,
          label: "Haben Sie Bedarf?",
          answerType: "BOOLEAN",
          isRequired: false,
          validFrom: new Date("2026-01-01T00:00:00Z"),
          status: "ACTIVE",
        },
      });

      const shortTextQuestion = await rawClient.question.create({
        data: { tenantId, questionnaireVersionId: version.id, key: "notiz", sortOrder: 2 },
      });
      await rawClient.questionVersion.create({
        data: {
          tenantId,
          questionId: shortTextQuestion.id,
          label: "Freitext-Notiz",
          answerType: "SHORT_TEXT",
          isRequired: false,
          validFrom: new Date("2026-01-01T00:00:00Z"),
          status: "ACTIVE",
        },
      });

      const integerQuestion = await rawClient.question.create({
        data: { tenantId, questionnaireVersionId: version.id, key: "anzahl", sortOrder: 3 },
      });
      await rawClient.questionVersion.create({
        data: {
          tenantId,
          questionId: integerQuestion.id,
          label: "Wie viele?",
          answerType: "INTEGER",
          isRequired: false,
          minValue: 1,
          maxValue: 5,
          validFrom: new Date("2026-01-01T00:00:00Z"),
          status: "ACTIVE",
        },
      });
    });

    afterAll(async () => {
      // Bewusst kein deleteMany -- append-only-Tabellen (siehe
      // questionnaire-engine.test.ts-Kommentar), CI nutzt einen ephemeren
      // DB-Container pro Lauf.
      await rawClient.$disconnect();
    });

    function asTenant<T>(fn: () => Promise<T>): Promise<T> {
      return runWithTenantContext(
        { tenantId, userId: randomUUID(), roles: [], managementScope: null },
        fn,
      );
    }

    it("schliesst SHORT_TEXT-Fragen und bereits beantwortete Fragen aus", async () => {
      const state = await asTenant(() =>
        startQuestionnaire({
          questionnaireKey: `ai-ext-fragebogen-${suffix}`,
          storeId,
          employeeId,
          consultationType: "NEW_CONTRACT",
          at: new Date("2026-03-01T00:00:00Z"),
        }),
      );

      // Vor jeder Antwort: alle drei nicht-SHORT_TEXT... nein, alle DREI
      // Fragen sind sichtbar, aber nur BOOLEAN+INTEGER sind erlaubte
      // KI-Ziele (SHORT_TEXT wird immer ausgeschlossen).
      const contextBefore = await asTenant(() =>
        buildVisibleQuestionContext(state.consultationSessionId),
      );
      expect(contextBefore.map((q) => q.answerType).sort()).toEqual(["BOOLEAN", "INTEGER"]);
      expect(contextBefore.some((q) => q.questionId === boolQuestionId)).toBe(true);

      // Nach Beantwortung der BOOLEAN-Frage: nur noch INTEGER ist Kandidat.
      await asTenant(() =>
        saveAnswer({
          consultationSessionId: state.consultationSessionId,
          questionId: boolQuestionId,
          value: { booleanValue: true },
        }),
      );
      const contextAfter = await asTenant(() =>
        buildVisibleQuestionContext(state.consultationSessionId),
      );
      expect(contextAfter.map((q) => q.answerType)).toEqual(["INTEGER"]);
      expect(contextAfter.some((q) => q.questionId === boolQuestionId)).toBe(false);
    });
  },
);
