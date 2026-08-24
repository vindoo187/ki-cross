import { z } from "zod";

/**
 * Phase 13 AP2 -- Zod-Schemas fuer die Campaign-Admin-API (siehe
 * PHASE_13_IMPLEMENTATION_PLAN.md Abschnitt 3, ChatGPT-GO 2026-08-24 mit
 * 10 verbindlichen Leitplanken). Analog `commission-schemas.ts` (Phase 10)
 * fuer den Draft/Publish-Lifecycle (`CampaignVersion` ist PRO `Campaign`
 * gescoped, nicht mandantenweit -- identischer Publish-Scope wie
 * `CommissionModelVersion`) und `rule-schemas.ts` (Phase 9) fuer die
 * `CampaignCondition`-Struktur (identisches Feld-Layout wie
 * `EligibilityRuleCondition`, siehe `prisma/schema.prisma`-Kommentar bei
 * `CampaignCondition`).
 *
 * `scopeType`/`scopeId`: nur `TENANT`/`STORE` (siehe `CampaignScopeType`,
 * Phase 13 AP1) -- `scopeId` ist bewusst KEIN Fremdschluessel (polymorph),
 * die serverseitige Tenant-Bindungspruefung uebernimmt
 * `validateScopeId()` in `campaign-admin.ts` (analog `goal-admin.ts`,
 * Phase 11 AP3), NICHT dieses Schema.
 */

const campaignScopeTypeSchema = z.enum(["TENANT", "STORE"]);

const visibilityOperatorSchema = z.enum([
  "EQUALS",
  "NOT_EQUALS",
  "GREATER_THAN",
  "GREATER_THAN_OR_EQUAL",
  "LESS_THAN",
  "LESS_THAN_OR_EQUAL",
  "IN",
  "NOT_IN",
  "CONTAINS",
  "IS_ANSWERED",
  "IS_NOT_ANSWERED",
]);

const conditionSourceTypeSchema = z.enum(["ANSWER", "PRODUCT_ATTRIBUTE", "SESSION_ATTRIBUTE"]);

/**
 * `questionId`/`attributeKey` sind hier BEIDE optional/nullable -- welches
 * Feld je nach `sourceType` tatsaechlich gesetzt sein muss, ist fachliche
 * Validierung (`assertValidConditionSource()` in `campaign-admin.ts`),
 * keine Struktur-Validierung -- identisches Prinzip wie
 * `ruleConditionSchema` (Phase 9 AP3).
 */
export const campaignConditionSchema = z.object({
  groupIndex: z.number().int().min(0),
  sourceType: conditionSourceTypeSchema,
  questionId: z.string().uuid().nullable().optional(),
  attributeKey: z.string().min(1).max(200).nullable().optional(),
  operator: visibilityOperatorSchema,
  comparisonValue: z.string().min(1).max(500),
});
export type CampaignConditionInput = z.infer<typeof campaignConditionSchema>;

/**
 * Eingabe fuer `createCampaign()` -- legt die fachliche Identitaet einer
 * `Campaign` an (nur `key`/`name`, siehe `prisma/schema.prisma`). Eine
 * `Campaign` ohne Version ist fachlich sinnlos, aber strukturell erlaubt --
 * analog `CommissionModel` (Phase 10), das ebenfalls unabhaengig von seinen
 * Versionen angelegt wird.
 */
export const createCampaignSchema = z.object({
  key: z.string().min(1).max(200),
  name: z.string().min(1).max(200),
});
export type CreateCampaignInput = z.infer<typeof createCampaignSchema>;

/**
 * Eingabe fuer `createDraftCampaignVersion()`. `copyFromVersionId` (falls
 * gesetzt) muss zu DERSELBEN `campaignId` gehoeren (per-Entity-Publish-
 * Scope, analog `commission-schemas.ts`) -- deckt sowohl den normalen
 * "neue Version basierend auf letzter Version"-Flow als auch Rollback ab
 * (Rollback = `createDraftCampaignVersion({ copyFromVersionId: <alte
 * Version> })`, keine eigene `rollback*()`-Funktion noetig, da
 * `CampaignVersion.versionNumber` bereits die Historie ordnet).
 *
 * `conditions` ist ABSICHTLICH `optional()` (nicht `.default([])`) --
 * `createDraftCampaignVersion()` unterscheidet zwei Faelle (siehe
 * `campaign-admin.ts`):
 * - `conditions` explizit angegeben (auch `[]`): wird 1:1 uebernommen,
 *   `copyFromVersionId`s eigene Bedingungen werden dabei NICHT kopiert
 *   (normaler "neue Version mit Aenderungen"-Flow, analog Commission:
 *   Aufrufer-Werte gewinnen).
 * - `conditions` weggelassen (`undefined`) UND `copyFromVersionId` gesetzt:
 *   die Bedingungen der Kopiervorlage werden serverseitig deep-kopiert
 *   (reiner Rollback-/"Basis uebernehmen"-Flow, analog
 *   `copyRuleSetVersionContents()`, Phase 8/9).
 * - beides weggelassen: leere Bedingungsliste (Campaign ohne Bedingungen =
 *   immer aktiv innerhalb ihres Gueltigkeitszeitraums, faellt bei Publish
 *   nicht durch -- bewusste fachliche Entscheidung, kein Bug).
 */
export const createDraftCampaignVersionSchema = z.object({
  scopeType: campaignScopeTypeSchema,
  scopeId: z.string().uuid(),
  description: z.string().max(2000).nullable().optional(),
  conditions: z.array(campaignConditionSchema).optional(),
  copyFromVersionId: z.string().uuid().optional(),
});
export type CreateDraftCampaignVersionInput = z.infer<typeof createDraftCampaignVersionSchema>;

/**
 * Partielles Update EINER bestehenden DRAFT-`CampaignVersion` (analog
 * `updateCommissionModelVersionFields()`, Phase 10 AP3). `conditions`,
 * falls angegeben, ERSETZT die GESAMTE bestehende Bedingungsliste (Delete-
 * All-Then-Recreate, identisches Muster wie
 * `updateEligibilityRuleInDraft()`, Phase 9 AP3) -- kein granulares
 * Einzel-Patch pro Bedingung, da die Reihenfolge/Gruppierung
 * (`groupIndex`) ohnehin als Ganzes neu gedacht werden muss.
 */
export const updateCampaignVersionFieldsSchema = z.object({
  scopeType: campaignScopeTypeSchema.optional(),
  scopeId: z.string().uuid().optional(),
  description: z.string().max(2000).nullable().optional(),
  conditions: z.array(campaignConditionSchema).optional(),
});
export type UpdateCampaignVersionFieldsInput = z.infer<typeof updateCampaignVersionFieldsSchema>;
