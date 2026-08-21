import { z } from "zod";

/**
 * Phase 10 AP1 -- Grundgeruest-Schemas fuer die Commission-Admin-API (siehe
 * PHASE_10_IMPLEMENTATION_PLAN.md Abschnitt 3). Analog
 * `createDraftRuleSetVersionSchema`/`rollbackRuleSetVersionSchema`
 * (`src/server/admin/rule-schemas.ts`, Phase 9 AP2), aber mit dem
 * Publish-Scope-Unterschied aus PHASE_10_DISCOVERY.md Abschnitt 1: anders
 * als bei `RuleSetVersion` (mandantenweiter ACTIVE-Scope) ist
 * `CommissionModelVersion` PRO `CommissionModel` gescoped (Phase-8-Muster).
 * `copyFromVersionId` darf sich daher NUR auf eine Version DESSELBEN
 * `CommissionModel` beziehen -- die serverseitige Pruefung dieser
 * Zugehoerigkeit uebernimmt `createDraftCommissionModelVersion()`
 * (`src/server/admin/commission-admin.ts`, AP2).
 *
 * Feld-CRUD-Schemas (FLAT/PERCENTAGE/TIERED, `CommissionTier`) folgen erst
 * in AP3/AP4 -- AP1 liefert bewusst nur das Grundgeruest fuer Version-
 * Anlage/Rollback, analog dem Umfang von `rule-schemas.ts` zum Zeitpunkt
 * von Phase 9 AP1.
 */
export const createDraftCommissionModelVersionSchema = z.object({
  label: z.string().min(1).max(200).optional(),
  copyFromVersionId: z.string().uuid().optional(),
});
export type CreateDraftCommissionModelVersionInput = z.infer<
  typeof createDraftCommissionModelVersionSchema
>;

/**
 * Rollback-Eingabe (AP-Pendant zu `rollbackRuleSetVersionSchema`). Wird ab
 * AP2 verwendet, sobald `rollbackCommissionModelVersion()` existiert --
 * bereits jetzt definiert, damit `commission-admin.ts` (AP2) das Schema
 * direkt importieren kann, ohne `commission-schemas.ts` erneut anzufassen.
 */
export const rollbackCommissionModelVersionSchema = z.object({
  label: z.string().min(1).max(200).optional(),
});
export type RollbackCommissionModelVersionInput = z.infer<
  typeof rollbackCommissionModelVersionSchema
>;
