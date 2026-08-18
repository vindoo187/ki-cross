import { z } from "zod";

/**
 * Phase 9 AP2 -- Eingabe fuer `POST /api/admin/rule-sets/:id/versions`
 * (siehe PHASE_9_IMPLEMENTATION_PLAN.md Abschnitt 4). Analog
 * `createDraftVersionSchema` (`src/server/admin/schemas.ts`, Phase 8 AP3),
 * aber `copyFromVersionId` darf hier bewusst auf eine `RuleSetVersion` eines
 * ANDEREN `RuleSet` desselben Mandanten zeigen (mandantenweiter ACTIVE-Scope,
 * siehe PHASE_9_DISCOVERY.md) -- keine Einschraenkung auf das Ziel-`RuleSet`
 * in diesem Schema, die Pruefung "existiert im Mandanten" uebernimmt
 * `createDraftRuleSetVersion()` (`src/server/admin/rule-admin.ts`).
 */
export const createDraftRuleSetVersionSchema = z.object({
  label: z.string().min(1).max(200),
  copyFromVersionId: z.string().uuid().optional(),
});
export type CreateDraftRuleSetVersionInput = z.infer<typeof createDraftRuleSetVersionSchema>;
