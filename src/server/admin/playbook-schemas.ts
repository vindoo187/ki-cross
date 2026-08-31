import { z } from "zod";

/**
 * Phase 14 AP2 -- Zod-Schemas fuer die Playbook-Admin-API (siehe
 * PHASE_14_IMPLEMENTATION_PLAN.md Abschnitt 3, ChatGPT-GO 2026-08-31 fuer
 * AP2 mit den in "Ein Punkt, den ich fuer AP2 ausdruecklich festhalten
 * wuerde" genannten Vorgaben, siehe
 * project_ki_cross_phase14_ap1_status.md). Analog `campaign-schemas.ts`
 * (Phase 13) fuer den Draft/Publish-Lifecycle (`PlaybookVersion` ist PRO
 * `Playbook` gescoped, identischer Publish-Scope wie `CampaignVersion`).
 *
 * `scopeType`/`scopeId`: nur `TENANT`/`STORE` (siehe `PlaybookScopeType`,
 * Phase 14 AP1) -- `scopeId` ist bewusst KEIN Fremdschluessel (polymorph),
 * die serverseitige Tenant-Bindungspruefung uebernimmt
 * `validateScopeId()` in `playbook-admin.ts` (analog `campaign-admin.ts`/
 * `goal-admin.ts`), NICHT dieses Schema.
 *
 * Groessenlimits (title/content/Array-Felder) sind bewusste
 * Basis-Eingabehygiene (analog `comparisonValue`/`description`-Limits in
 * `campaign-schemas.ts`), KEIN Ersatz fuer die strukturelle
 * Sicherheitsabsicherung aus AP5 (ChatGPT-Vorgabe: keine Content-Scanning-
 * Heuristik hier oder spaeter -- `content` bleibt technisch immer Daten,
 * nie Systeminstruktion, unabhaengig von diesen Laengengrenzen). Die
 * Grenzen dienen ausschliesslich der Begrenzung offensichtlich
 * unplausibler Eingaben (Speicher-/DB-Hygiene), nicht der
 * Prompt-Injection-Abwehr.
 */

const playbookScopeTypeSchema = z.enum(["TENANT", "STORE"]);

const playbookSectionTypeSchema = z.enum([
  "CONVERSATION_GUIDANCE",
  "ARGUMENTATION",
  "OBJECTION_HANDLING",
  "PRODUCT_ARGUMENT",
  "CUSTOMER_SITUATION",
  "CLOSING",
  "UPSELL_CROSS_SELL",
  "NO_GO",
  "TONALITY",
  "GENERAL_PRINCIPLE",
]);

/** Ein einzelnes Tag/Topic/Situation-/Produkt-Key-Element der Retrieval-Metadaten (AP4 nutzt diese spaeter, hier nur Struktur). */
const playbookTagSchema = z.string().min(1).max(100);

/**
 * `relatedTopics`/`relatedProductKeys`/`relatedSituations`/`tags` sind
 * freie, unvalidierte Metadaten-Tags (KEINE Fremdschluessel -- es gibt
 * z.B. keinen `Product.key`, siehe `prisma/schema.prisma::Product`).
 * Die fachliche Auswertung/Zuordnung ist Aufgabe der Retrieval-
 * Selektionsfunktion (AP4), NICHT dieser Datei (ChatGPT-Vorgabe AP1:
 * "Retrieval darf keine versteckte Business-Logik werden" -- diese Datei
 * speichert nur Struktur, trifft keine Relevanzentscheidung).
 */
export const playbookSectionSchema = z.object({
  sectionType: playbookSectionTypeSchema,
  title: z.string().min(1).max(200),
  content: z.string().min(1).max(20000),
  relatedTopics: z.array(playbookTagSchema).max(30).default([]),
  relatedProductKeys: z.array(playbookTagSchema).max(30).default([]),
  relatedSituations: z.array(playbookTagSchema).max(30).default([]),
  priority: z.number().int().min(0).max(1000).nullable().optional(),
  tags: z.array(playbookTagSchema).max(30).default([]),
  active: z.boolean().default(true),
});
export type PlaybookSectionInput = z.infer<typeof playbookSectionSchema>;

/**
 * Eingabe fuer `createPlaybook()` -- legt die fachliche Identitaet eines
 * `Playbook` an (nur `key`/`name`, siehe `prisma/schema.prisma`). Ein
 * `Playbook` ohne Version ist fachlich sinnlos, aber strukturell erlaubt --
 * analog `CreateCampaignInput`.
 */
export const createPlaybookSchema = z.object({
  key: z.string().min(1).max(200),
  name: z.string().min(1).max(200),
});
export type CreatePlaybookInput = z.infer<typeof createPlaybookSchema>;

/**
 * Eingabe fuer `createDraftPlaybookVersion()`. `copyFromVersionId` (falls
 * gesetzt) muss zu DERSELBEN `playbookId` gehoeren (per-Entity-Publish-
 * Scope, analog `campaign-schemas.ts`).
 *
 * `sections` ist ABSICHTLICH `optional()` (nicht `.default([])`) --
 * `createDraftPlaybookVersion()` unterscheidet zwei Faelle (siehe
 * `playbook-admin.ts`, identisches Prinzip wie
 * `createDraftCampaignVersionSchema`):
 * - `sections` explizit angegeben (auch `[]`): wird 1:1 uebernommen,
 *   `copyFromVersionId`s eigene Sections werden dabei NICHT kopiert.
 * - `sections` weggelassen (`undefined`) UND `copyFromVersionId` gesetzt:
 *   die Sections der Kopiervorlage werden serverseitig deep-kopiert
 *   (Rollback-/"Basis uebernehmen"-Flow).
 * - beides weggelassen: leere Section-Liste (Playbook-Version ohne Inhalt
 *   ist strukturell gueltig, fachlich aber ohne Nutzen -- bewusst erlaubt,
 *   analog Campaign ohne Bedingungen).
 */
export const createDraftPlaybookVersionSchema = z.object({
  scopeType: playbookScopeTypeSchema,
  scopeId: z.string().uuid(),
  description: z.string().max(2000).nullable().optional(),
  sections: z.array(playbookSectionSchema).optional(),
  copyFromVersionId: z.string().uuid().optional(),
});
export type CreateDraftPlaybookVersionInput = z.infer<typeof createDraftPlaybookVersionSchema>;

/**
 * Partielles Update EINER bestehenden DRAFT-`PlaybookVersion` (analog
 * `updateCampaignVersionFieldsSchema`). `sections`, falls angegeben,
 * ERSETZT die GESAMTE bestehende Section-Liste (Delete-All-Then-Recreate,
 * identisches Muster wie `CampaignCondition`) -- kein granulares
 * Einzel-Patch pro Section.
 */
export const updatePlaybookVersionFieldsSchema = z.object({
  scopeType: playbookScopeTypeSchema.optional(),
  scopeId: z.string().uuid().optional(),
  description: z.string().max(2000).nullable().optional(),
  sections: z.array(playbookSectionSchema).optional(),
});
export type UpdatePlaybookVersionFieldsInput = z.infer<typeof updatePlaybookVersionFieldsSchema>;
