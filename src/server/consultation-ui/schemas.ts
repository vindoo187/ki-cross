/**
 * Zod-Validierungsschemata fuer die duenne API-Schicht (AP2). Spiegeln
 * ausschliesslich die bestehenden Eingabetypen der Fragen-Engine
 * (`src/server/questionnaire/types.ts`) wider -- keine neue fachliche Logik,
 * nur Transportvalidierung (siehe PHASE_5_IMPLEMENTATION_PLAN.md Abschnitt
 * 2.2 Punkt 1).
 *
 * `storeId`/`employeeId` sind bewusst NICHT Teil dieser Schemata: sie kommen
 * ausschliesslich aus dem serverseitig verifizierten Session-Payload
 * (`src/server/auth/request-context.ts`), nie aus Client-Eingaben -- ein
 * Mitarbeiter darf keine fremde employeeId/storeId im Body unterschieben.
 */

import { z } from "zod";

/** Spiegelt `AnswerValueInput` (questionnaire/types.ts) 1:1. */
export const answerValueSchema = z
  .object({
    integerValue: z.number().int().nullable().optional(),
    decimalValue: z.string().nullable().optional(),
    booleanValue: z.boolean().nullable().optional(),
    dateValue: z.string().nullable().optional(),
    choiceValues: z.array(z.string()).optional(),
    freeTextValue: z.string().nullable().optional(),
  })
  .strict();

/** Body von `POST /api/consultation/sessions`. */
export const startQuestionnaireBodySchema = z
  .object({
    questionnaireKey: z.string().min(1),
    customerReferenceId: z.string().nullable().optional(),
    consultationType: z.enum(["NEW_CONTRACT", "RENEWAL"]),
  })
  .strict();

/** Body von `POST /api/consultation/sessions/[id]/answers`. */
export const saveAnswerBodySchema = z
  .object({
    questionId: z.string().uuid(),
    value: answerValueSchema,
  })
  .strict();

/** Body von `PATCH /api/consultation/sessions/[id]/answers`. */
export const changeAnswerBodySchema = z
  .object({
    questionId: z.string().uuid(),
    value: answerValueSchema,
    expectedAnswerVersion: z.number().int(),
  })
  .strict();

/**
 * Body von `POST /api/consultation/recommendation-items/[id]/outcome` (AP7,
 * siehe PHASE_5_IMPLEMENTATION_PLAN.md Abschnitt 8). Spiegelt
 * `RecordRecommendationOutcomeInput` (`src/server/recommendation/outcome.ts`)
 * 1:1 -- `rejectionReasonId` bewusst nur `optional()`/`nullable()`, die
 * eigentliche Pflicht-bei-REJECTED-Regel prueft `recordRecommendationOutcome()`
 * selbst (keine Duplizierung von Fachlogik in der Zod-Schicht).
 */
export const recordRecommendationOutcomeBodySchema = z
  .object({
    outcome: z.enum(["ACCEPTED", "REJECTED", "DEFERRED"]),
    rejectionReasonId: z.string().uuid().nullable().optional(),
  })
  .strict();

/**
 * Body von `PATCH /api/consultation/sales-opportunities/[id]` (AP8, siehe
 * PHASE_5_IMPLEMENTATION_PLAN.md Abschnitt 9). Spiegelt
 * `UpdateSalesOpportunityStatusInput` (`src/server/recommendation/opportunity-status.ts`)
 * 1:1 -- `OPEN` bewusst NICHT im Enum: `ALLOWED_TRANSITIONS`
 * (`opportunity-status.ts`) erlaubt `OPEN` nie als Zielstatus, sondern nur
 * als automatisch durch `evaluate()` gesetzten Ausgangsstatus. Die konkrete
 * Erlaubtheit eines Uebergangs (abhaengig vom jeweils aktuellen Status)
 * prueft weiterhin ausschliesslich `updateSalesOpportunityStatus()` selbst
 * (keine Duplizierung von Fachlogik in der Zod-Schicht).
 */
export const updateSalesOpportunityStatusBodySchema = z
  .object({
    status: z.enum(["OFFERED", "ACCEPTED", "DECLINED", "DEFERRED"]),
  })
  .strict();

/**
 * Body von `POST /api/consultation/sessions/[id]/summary/abandon` (AP10,
 * siehe Projektleiter-Entscheidung zum manuellen Abbruchflow). Spiegelt
 * `ConsultationAbandonReasonCode` (`src/server/consultation-ui/abandonment.ts`)
 * 1:1 -- `reasonCode` ist bewusst optional (kein verpflichtender Grund) und
 * der Body als Ganzes optional (leerer/fehlender Body = kein Grund
 * angegeben), damit `AbandonConsultationButton.tsx` auch ohne gewaehlten
 * Grund `POST` ohne Body senden kann.
 */
export const abandonConsultationBodySchema = z
  .object({
    reasonCode: z
      .enum([
        "CUSTOMER_DOES_NOT_WANT_TO_CONTINUE",
        "CUSTOMER_HAS_NO_TIME",
        "TECHNICAL_ISSUE",
        "OTHER",
      ])
      .optional(),
  })
  .strict()
  .nullable()
  .optional();

/**
 * Body von `POST /api/consultation/sessions/[id]/deals` (Phase 6 AP4, siehe
 * PHASE_6_IMPLEMENTATION_PLAN.md Abschnitt 3.1). Spiegelt `CloseDealInput`
 * (`src/server/deals/service.ts`) 1:1 -- `consultationSessionId` selbst kommt
 * aus dem Routen-Parameter `[id]`, nicht aus dem Body. `items.min(1)` ist
 * bewusste Fruehvalidierung (schnelles 400 statt Rundreise durch den
 * Service); `closeDeal()` prueft dieselbe Regel eigenstaendig noch einmal
 * (`DealRequiresItemsError`) als Sicherheitsnetz fuer alle Aufrufer, nicht
 * nur diese Route.
 */
export const closeDealBodySchema = z
  .object({
    items: z
      .array(
        z
          .object({
            productVersionId: z.string().uuid(),
            quantity: z.number().int().positive(),
          })
          .strict(),
      )
      .min(1),
    customerReferenceId: z.string().uuid().nullable().optional(),
  })
  .strict();
