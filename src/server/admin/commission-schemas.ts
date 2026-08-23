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
 * `TIERED` war bis AP3 bewusst NICHT erlaubt (`commissionTypeSchema` unten) --
 * seit AP4 vollstaendig implementiert (`CommissionTier`-CRUD weiter unten,
 * `validateCommissionModelVersion()` in `commission-validator.ts`,
 * TIERED-Berechnung in `src/server/pricing/commission.ts`). Bei TIERED
 * bleiben ALLE drei Skalarfelder (`commissionAmountMinor`,
 * `commissionPercentageBasisPoints`, `recurringCommissionAmountMinor`) auf
 * der Version-Zeile selbst null -- die eigentlichen Werte liegen
 * ausschliesslich in den `CommissionTier`-Kind-Zeilen (siehe
 * `updateCommissionModelVersionFields()`-Modulkommentar in
 * `commission-admin.ts`).
 */
const commissionTypeSchema = z.enum(["FLAT", "PERCENTAGE", "TIERED"]);

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
 * Feld-CRUD (Phase 10 AP3, siehe PHASE_10_IMPLEMENTATION_PLAN.md
 * Abschnitt 5) -- partielles Update der Skalarfelder EINER bestehenden
 * DRAFT-`CommissionModelVersion` (analog `updateQuestionSchema` aus Phase 8
 * AP3: `.partial()` auf denselben Feldern wie bei der Draft-Erstellung,
 * `copyFromVersionId` ausgenommen -- das ist kein mutierbares Feld einer
 * bestehenden Version).
 *
 * Alle Felder sind einzeln optional (partielles Update: nur uebergebene
 * Felder werden geaendert, `updateCommissionModelVersionFields()` in
 * `commission-admin.ts` prueft NACH dem Zusammenfuehren mit dem
 * bestehenden Stand die fachliche Amount/Percentage-Exklusivitaet, die
 * dieses Schema allein nicht pruefen kann, da ein Patch z. B. nur
 * `commissionType` ohne die Betragsfelder enthalten darf).
 */
export const updateCommissionModelVersionFieldsSchema = z.object({
  commissionType: commissionTypeSchema.optional(),
  currency: z.string().length(3).optional(),
  commissionAmountMinor: z.number().int().nonnegative().nullable().optional(),
  commissionPercentageBasisPoints: z.number().int().min(0).max(10000).nullable().optional(),
  recurringCommissionAmountMinor: z.number().int().nonnegative().nullable().optional(),
});
export type UpdateCommissionModelVersionFieldsInput = z.infer<
  typeof updateCommissionModelVersionFieldsSchema
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

/**
 * `CommissionTier`-CRUD (Phase 10 AP4, siehe
 * PHASE_10_IMPLEMENTATION_PLAN.md Abschnitt 6, ChatGPT-GO 2026-08-21 mit
 * Praezisierungen). Jede Stufe gehoert zu genau einer DRAFT-
 * `CommissionModelVersion` und ist entweder Fix (`tierAmountMinor`) ODER
 * Prozent (`tierPercentageBasisPoints`) -- die exklusive ODER-Bedingung
 * (genau eines von beiden gesetzt) wird sowohl DB-seitig (CHECK-Constraint
 * `commission_tiers_amount_xor_percentage_check`) als auch anwendungsseitig
 * geprueft (`createCommissionTier()`/`updateCommissionTier()` in
 * `commission-admin.ts`, ZUSAMMENGEFUEHRTER Zustand analog AP3), da ein
 * Zod-Schema allein bei PARTIELLEN Updates (`updateCommissionTierSchema`)
 * diese wechselseitige Abhaengigkeit nicht pruefen kann.
 *
 * `thresholdMinor` (>= 0, inklusive Untergrenze) und `sortOrder` sind je
 * Version zusaetzlich DB-seitig UNIQUE (keine doppelten Werte) -- ebenfalls
 * bewusst redundant anwendungsseitig NICHT re-geprueft (anders als beim
 * Amount/Percentage-Fall gibt es hier keine sinnvolle Vor-Ort-Fehlermeldung
 * ohne einen zusaetzlichen DB-Read; der P2002-Unique-Constraint-Fehler wird
 * stattdessen in `http-errors.ts` in eine 409-Antwort uebersetzt).
 */
export const createCommissionTierSchema = z.object({
  thresholdMinor: z.number().int().nonnegative(),
  tierAmountMinor: z.number().int().nonnegative().nullable().optional(),
  tierPercentageBasisPoints: z.number().int().min(0).max(10000).nullable().optional(),
  sortOrder: z.number().int(),
});
export type CreateCommissionTierInput = z.infer<typeof createCommissionTierSchema>;

export const updateCommissionTierSchema = z.object({
  thresholdMinor: z.number().int().nonnegative().optional(),
  tierAmountMinor: z.number().int().nonnegative().nullable().optional(),
  tierPercentageBasisPoints: z.number().int().min(0).max(10000).nullable().optional(),
  sortOrder: z.number().int().optional(),
});
export type UpdateCommissionTierInput = z.infer<typeof updateCommissionTierSchema>;
