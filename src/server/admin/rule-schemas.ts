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

/**
 * Phase 9 AP6 -- Eingabe fuer `POST /api/admin/rule-sets/:id/versions/:versionId/rollback`
 * (siehe PHASE_9_IMPLEMENTATION_PLAN.md Abschnitt 8). Eigenes, kleines
 * Schema statt Wiederverwendung von `rollbackVersionSchema`
 * (`src/server/admin/schemas.ts`, Phase 8) -- gleiches Trennungsprinzip wie
 * bei den Fehlerklassen (siehe rule-admin-errors.ts Modulkommentar).
 */
export const rollbackRuleSetVersionSchema = z.object({
  label: z.string().min(1).max(200).optional(),
});
export type RollbackRuleSetVersionInput = z.infer<typeof rollbackRuleSetVersionSchema>;

// ---------------------------------------------------------------------------
// Phase 9 AP3 -- Rule-CRUD fuer den flachen Condition-Baum (siehe
// PHASE_9_IMPLEMENTATION_PLAN.md Abschnitt 5). Identische Condition-Struktur
// fuer alle vier Regeltypen (siehe prisma/schema.prisma Modulkommentar bei
// `EligibilityRuleCondition`) -- ein gemeinsames Schema statt vier fast
// identischer.
// ---------------------------------------------------------------------------

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
 * Validierung (AP4, `validateDraftRuleSetVersion()`), keine Struktur-
 * Validierung. AP3 nimmt beide Felder strukturell entgegen, ohne die
 * Kombination zu pruefen (identisches Prinzip wie bei
 * `VisibilityCondition` in Phase 8).
 */
export const ruleConditionSchema = z.object({
  groupIndex: z.number().int().min(0),
  sourceType: conditionSourceTypeSchema,
  questionId: z.string().uuid().nullable().optional(),
  attributeKey: z.string().min(1).max(200).nullable().optional(),
  operator: visibilityOperatorSchema,
  comparisonValue: z.string().min(1).max(500),
});
export type RuleConditionInput = z.infer<typeof ruleConditionSchema>;

export const createEligibilityRuleSchema = z.object({
  key: z.string().min(1).max(100),
  description: z.string().min(1).max(1000),
  isRequired: z.boolean(),
  fitWeight: z.number().int(),
  isActive: z.boolean().default(true),
  conditions: z.array(ruleConditionSchema),
});
export type CreateEligibilityRuleInput = z.infer<typeof createEligibilityRuleSchema>;

export const updateEligibilityRuleSchema = createEligibilityRuleSchema.partial();
export type UpdateEligibilityRuleInput = z.infer<typeof updateEligibilityRuleSchema>;

export const createExclusionRuleSchema = z.object({
  key: z.string().min(1).max(100),
  reasonCode: z.string().min(1).max(100),
  description: z.string().min(1).max(1000),
  isActive: z.boolean().default(true),
  conditions: z.array(ruleConditionSchema),
});
export type CreateExclusionRuleInput = z.infer<typeof createExclusionRuleSchema>;

export const updateExclusionRuleSchema = createExclusionRuleSchema.partial();
export type UpdateExclusionRuleInput = z.infer<typeof updateExclusionRuleSchema>;

export const createPrioritizationRuleSchema = z.object({
  key: z.string().min(1).max(100),
  description: z.string().min(1).max(1000),
  weight: z.number().int(),
  commissionRequired: z.boolean().default(false),
  isActive: z.boolean().default(true),
  conditions: z.array(ruleConditionSchema),
});
export type CreatePrioritizationRuleInput = z.infer<typeof createPrioritizationRuleSchema>;

export const updatePrioritizationRuleSchema = createPrioritizationRuleSchema.partial();
export type UpdatePrioritizationRuleInput = z.infer<typeof updatePrioritizationRuleSchema>;

const needTypeSchema = z.enum([
  "PARTNER_CARD",
  "FAMILY",
  "YOUNG",
  "DSL",
  "FIBER",
  "STREAMING",
  "ACCESSORY",
  "DEVICE_PROTECTION",
  "OTHER",
]);

export const createCrossSellingRuleSchema = z.object({
  key: z.string().min(1).max(100),
  description: z.string().min(1).max(1000),
  needType: needTypeSchema,
  priority: z.number().int(),
  reasonCode: z.string().min(1).max(100),
  suggestedProductVersionId: z.string().uuid().nullable().optional(),
  isActive: z.boolean().default(true),
  conditions: z.array(ruleConditionSchema),
});
export type CreateCrossSellingRuleInput = z.infer<typeof createCrossSellingRuleSchema>;

export const updateCrossSellingRuleSchema = createCrossSellingRuleSchema.partial();
export type UpdateCrossSellingRuleInput = z.infer<typeof updateCrossSellingRuleSchema>;
