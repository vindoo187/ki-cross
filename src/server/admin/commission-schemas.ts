import { z } from "zod";

/**
 * Phase 10 AP1/AP2 -- Zod-Schemas fuer die Commission-Admin-API (siehe
 * PHASE_10_IMPLEMENTATION_PLAN.md Abschnitt 3/4). Analog
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
 * WICHTIGER STRUKTUR-UNTERSCHIED zu `RuleSetVersion`/`QuestionnaireVersion`
 * (bewusste Entscheidung, AP2): `CommissionModelVersion` hat KEIN `label`-Feld
 * (siehe prisma/schema.prisma) -- die fachlichen Werte
 * (`commissionType`/`currency`/Betraege) liegen direkt AUF der Version-Zeile
 * selbst, nicht in Kind-Tabellen wie bei Rules/Questions. `commissionType`
 * und `currency` sind DB-seitig NOT NULL, muessen also bei JEDER
 * Draft-Erstellung mitgegeben werden (auch wenn `copyFromVersionId` gesetzt
 * ist -- die Werte des Aufrufers gewinnen; ein UI wuerde die
 * Quellversions-Werte typischerweise vorab per `getCommissionModelVersionDetail()`
 * laden und in das Formular vorbefuellen, analog jedem normalen "Kopieren"-Flow).
 * `TIERED` ist hier bewusst NOCH NICHT erlaubt (`commissionTypeSchema` unten)
 * -- Validator und `CommissionTier`-CRUD kommen erst in AP4, ein DRAFT mit
 * `commissionType: "TIERED"` waere bis dahin strukturell unbefuellbar.
 */
const commissionTypeSchema = z.enum(["FLAT", "PERCENTAGE"]);

export const createDraftCommissionModelVersionSchema = z.object({
  commissionType: commissionTypeSchema,
  currency: z.string().length(3),
  commissionAmountMinor: z.number().int().nonnegative().nullable().optional(),
  commissionPercentageBasisPoints: z.number().int().min(0).max(10000).nullable().optional(),
  recurringCommissionAmountMinor: z.number().int().nonnegative().nullable().optional(),
  copyFromVersionId: z.string().uuid().optional(),
});
export type CreateDraftCommissionModelVersionInput = z.infer<
  typeof createDraftCommissionModelVersionSchema
>;

/**
 * Rollback-Eingabe (AP-Pendant zu `rollbackRuleSetVersionSchema`). Bewusst
 * leer -- `CommissionModelVersion` hat kein `label`-Feld, das ein Rollback
 * ueberschreiben koennte. Platzhalter fuer eine spaetere AP, sobald
 * `rollbackCommissionModelVersion()` existiert (im aktuellen Plan nicht als
 * eigene AP vorgesehen; `createDraftCommissionModelVersion()` mit
 * `copyFromVersionId` auf eine historische Version deckt denselben Bedarf ab).
 */
export const rollbackCommissionModelVersionSchema = z.object({});
export type RollbackCommissionModelVersionInput = z.infer<
  typeof rollbackCommissionModelVersionSchema
>;
