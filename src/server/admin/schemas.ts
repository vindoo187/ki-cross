/**
 * Zod-Schemas fuer die Question-Management-API (Phase 8 AP3). Reine
 * Request-Validierung -- die eigentliche fachliche Pruefung (z. B.
 * "AnswerOptions nur bei SINGLE_CHOICE/MULTIPLE_CHOICE zulaessig") bleibt in
 * `question-admin.ts` bzw. wird spaeter von `validateQuestionnaireVersion()`
 * (AP4) geprueft -- hier wird nur die STRUKTUR der Eingabe sichergestellt.
 */

import { z } from "zod";

const answerTypeSchema = z.enum([
  "SINGLE_CHOICE",
  "MULTIPLE_CHOICE",
  "BOOLEAN",
  "INTEGER",
  "DECIMAL",
  "SHORT_TEXT",
  "DATE",
]);

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

const logicalCombinatorSchema = z.enum(["AND", "OR"]);

const answerOptionInputSchema = z.object({
  key: z.string().min(1).max(100),
  label: z.string().min(1).max(500),
  sortOrder: z.number().int(),
});

const visibilityConditionInputSchema = z.object({
  targetQuestionId: z.string().uuid(),
  operator: visibilityOperatorSchema,
  comparisonValue: z.string().min(1).max(500),
  combinator: logicalCombinatorSchema,
});

/** Gemeinsame Feldmenge fuer `POST .../questions` (vollstaendig) und `PATCH .../questions/:id` (Teilmenge). */
const questionFieldsSchema = z.object({
  key: z.string().min(1).max(200),
  needType: needTypeSchema.nullable().optional(),
  sortOrder: z.number().int(),
  label: z.string().min(1).max(1000),
  answerType: answerTypeSchema,
  isRequired: z.boolean(),
  minValue: z.string().nullable().optional(),
  maxValue: z.string().nullable().optional(),
  maxLength: z.number().int().positive().nullable().optional(),
  minSelections: z.number().int().nonnegative().nullable().optional(),
  maxSelections: z.number().int().positive().nullable().optional(),
  answerOptions: z.array(answerOptionInputSchema).default([]),
  visibilityConditions: z.array(visibilityConditionInputSchema).default([]),
});

export const createQuestionSchema = questionFieldsSchema;
export type CreateQuestionInput = z.infer<typeof createQuestionSchema>;

/** Teilaktualisierung -- alle Felder optional, aber wenn `answerOptions`/`visibilityConditions` mitgeschickt werden, ersetzen sie die bestehende Menge vollstaendig (kein partielles Merge). */
export const updateQuestionSchema = questionFieldsSchema.partial();
export type UpdateQuestionInput = z.infer<typeof updateQuestionSchema>;

export const createDraftVersionSchema = z.object({
  label: z.string().min(1).max(200),
  /** Wenn gesetzt: tiefe Kopie aller Questions/QuestionVersions/AnswerOptions/VisibilityConditions dieser Quellversion in die neue DRAFT-Version. */
  copyFromVersionId: z.string().uuid().optional(),
});
export type CreateDraftVersionInput = z.infer<typeof createDraftVersionSchema>;
