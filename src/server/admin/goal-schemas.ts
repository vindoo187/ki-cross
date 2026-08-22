import { z } from "zod";

/**
 * Phase 11 AP2 -- Zod-Schemas fuer die Goal-Management-API (siehe
 * PHASE_11_IMPLEMENTATION_PLAN.md Abschnitt 3). Analog
 * `createDraftCommissionModelVersionSchema` (`commission-schemas.ts`, Phase
 * 10 AP1/AP2), aber fuer das grundlegend andere Goal/GoalVersion-Muster
 * (kein Draft/Publish-Workflow, siehe Modulkommentar in
 * `prisma/schema.prisma` und `goal-admin.ts`).
 *
 * WICHTIGE ABGRENZUNG zu `goal-validator.ts` (AP3, noch nicht implementiert):
 * Diese Datei prueft ausschliesslich STRUKTURELLE Eigenschaften (Typen,
 * Wertebereiche, das metrikunabhaengige "genau ein Zielwert"-XOR -- das
 * bereits DB-seitig per CHECK-Constraint erzwungen wird, hier zusaetzlich
 * fuer ein frueheres, klareres Fehlerbild). Die METRIK-SPEZIFISCHE Regel
 * (welcher der drei Zielwerte zum jeweiligen `metricKey` passt, z. B.
 * `targetAmountMinor` nur bei REVENUE) und die Currency-Pflicht bei REVENUE
 * sind ausdruecklich NICHT Teil dieser Schemas -- das ist laut Plan
 * (Abschnitt 3, AP3) Aufgabe von `goal-validator.ts`, das erst in AP3
 * entsteht und vor jedem `createGoal()`/`createGoalVersion()`-Aufruf aus der
 * (ebenfalls erst in AP3 entstehenden) Route-Schicht aufgerufen wird --
 * exakt das gleiche Muster wie die Trennung zwischen `commission-schemas.ts`
 * und `commission-validator.ts`.
 */

const goalScopeTypeSchema = z.enum(["TENANT", "COMPANY", "STORE", "EMPLOYEE"]);
const goalMetricKeySchema = z.enum(["DEALS_CLOSED", "REVENUE", "CLOSE_RATE"]);
const goalPeriodTypeSchema = z.enum(["MONTH", "QUARTER", "YEAR"]);

/**
 * Metrik-unabhaengiges XOR (siehe Modulkommentar oben): genau eines der drei
 * Zielwert-Felder darf gesetzt sein. Als eigenstaendige, wiederverwendbare
 * Funktion exportiert, damit sowohl `createGoalSchema` als auch
 * `createGoalVersionSchema` (unten) sie per `.superRefine()` nutzen koennen,
 * ohne Logik zu duplizieren.
 */
function checkTargetValueXor(
  values: {
    targetAmountMinor?: number | null;
    targetCount?: number | null;
    targetPercentageBasisPoints?: number | null;
  },
  ctx: z.RefinementCtx,
): void {
  const setCount = [
    values.targetAmountMinor,
    values.targetCount,
    values.targetPercentageBasisPoints,
  ].filter((v) => v != null).length;
  if (setCount !== 1) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message:
        "Genau eines von targetAmountMinor, targetCount oder targetPercentageBasisPoints muss " +
        "gesetzt sein (nie beides, nie keins).",
      path: ["targetAmountMinor"],
    });
  }
}

export const createGoalSchema = z
  .object({
    scopeType: goalScopeTypeSchema,
    scopeId: z.string().uuid(),
    metricKey: goalMetricKeySchema,
    periodType: goalPeriodTypeSchema,
    periodStart: z.coerce.date(),
    currency: z.string().length(3).nullable().optional(),
    targetAmountMinor: z.number().int().nonnegative().nullable().optional(),
    targetCount: z.number().int().nonnegative().nullable().optional(),
    targetPercentageBasisPoints: z.number().int().min(0).max(10000).nullable().optional(),
  })
  .superRefine(checkTargetValueXor);
export type CreateGoalInput = z.infer<typeof createGoalSchema>;

/**
 * Eingabe fuer `createGoalVersion()` -- eine neue, konzeptionell
 * unveraenderliche Korrektur-Version fuer ein BESTEHENDES Goal (siehe
 * `getCurrentGoalVersion()`-Modulkommentar in `goal-admin.ts`). Enthaelt
 * bewusst NICHT `scopeType`/`scopeId`/`metricKey`/`periodType`/
 * `periodStart`/`currency` -- diese Felder gehoeren zur Goal-Identitaet und
 * sind nach Anlage unveraenderlich (kein Update-Pfad fuer `Goal` selbst,
 * siehe Modulkommentar in `goal-admin.ts`).
 */
export const createGoalVersionSchema = z
  .object({
    targetAmountMinor: z.number().int().nonnegative().nullable().optional(),
    targetCount: z.number().int().nonnegative().nullable().optional(),
    targetPercentageBasisPoints: z.number().int().min(0).max(10000).nullable().optional(),
  })
  .superRefine(checkTargetValueXor);
export type CreateGoalVersionInput = z.infer<typeof createGoalVersionSchema>;
