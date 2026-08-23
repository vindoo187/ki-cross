/**
 * Zod-Validierung fuer die JSON-Felder `AnalyticsEvent.payload` und
 * `AuditLog.metadata` (Phase 2B, Korrekturpunkt "Zod-Validierung fuer
 * JSON-Felder").
 *
 * Diese Felder sind bewusst generisch (`Json?`) im Schema hinterlegt, weil
 * die konkrete Payload-Form pro `eventType`/`action` von den Fach-Engines
 * (Fragen-Engine, Empfehlungs-Engine, ...) definiert wird - deren Bau laut
 * ausdruecklicher Stop-Anweisung (Phase 1 + ChatGPT-Abnahme) in dieser
 * Phase NICHT begonnen werden darf. Statt einzelne, moeglicherweise falsche
 * Payload-Formen fuer 13 Event-Typen zu erfinden, erzwingt dieses Modul
 * daher eine Struktur- und PII-Grenze, die fuer JEDE zukuenftige konkrete
 * Payload-Form gueltig bleibt:
 *
 * - nur flache/verschachtelte Objekte aus IDs, Enums, Zahlen, Booleans,
 *   Datumsstrings und kurzen Arrays davon (kein beliebig tiefes Nesting,
 *   keine Funktionen/Symbole - das gibt JSON ohnehin nicht her),
 * - keine Schluessel/Werte, die wie direkte Kontaktdaten oder Freitext
 *   aussehen (siehe contact-data-guard.ts).
 *
 * Sobald eine Fach-Engine eine speziellere Payload-Form fuer einen
 * bestimmten `eventType`/`action` braucht, sollte dafuer ein zusaetzliches,
 * spezifischeres Schema ergaenzt werden (z. B. per `z.discriminatedUnion`
 * auf `eventType`) - dieses generische Schema bleibt dabei als
 * Sicherheitsnetz (`.superRefine`) bestehen.
 */

import { z } from "zod";
import { assertNoContactData, findContactDataIssues } from "./contact-data-guard";

const MAX_NESTING_DEPTH = 3;
const MAX_OBJECT_KEYS = 40;
const MAX_ARRAY_LENGTH = 50;

// Primitive, "sichere" JSON-Werte: IDs, Enums, Zahlen, Booleans, ISO-Daten.
const jsonPrimitiveSchema = z.union([z.string().max(200), z.number(), z.boolean(), z.null()]);

type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

function buildDepthLimitedSchema(depth: number): z.ZodType<Json> {
  if (depth >= MAX_NESTING_DEPTH) {
    return jsonPrimitiveSchema as z.ZodType<Json>;
  }
  const child = z.lazy(() => buildDepthLimitedSchema(depth + 1));
  return z.union([
    jsonPrimitiveSchema,
    z.array(child).max(MAX_ARRAY_LENGTH),
    z.record(z.string(), child).refine((obj) => Object.keys(obj).length <= MAX_OBJECT_KEYS, {
      message: `Objekt hat mehr als ${MAX_OBJECT_KEYS} Schluessel`,
    }),
  ]) as z.ZodType<Json>;
}

/**
 * Generisches "sicheres JSON"-Schema: begrenzte Verschachtelungstiefe,
 * begrenzte Groesse, keine Kontaktdaten/Freitext (siehe Modul-Kommentar).
 * Wird sowohl fuer `AnalyticsEvent.payload` als auch `AuditLog.metadata`
 * verwendet.
 */
export const safeJsonPayloadSchema = buildDepthLimitedSchema(0).superRefine((value, ctx) => {
  for (const issue of findContactDataIssues(value)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: issue });
  }
});

export const analyticsEventPayloadSchema = safeJsonPayloadSchema;
export const auditLogMetadataSchema = safeJsonPayloadSchema;

/**
 * Validiert `payload` fuer ein `AnalyticsEvent` mit gegebenem `eventType`.
 * Wirft bei Regelverstoss einen Fehler mit lesbarer Fehlermeldung
 * (inklusive `eventType` im Kontext).
 */
export function parseAnalyticsEventPayload(eventType: string, payload: unknown): Json | null {
  if (payload === null || payload === undefined) {
    return null;
  }
  const result = analyticsEventPayloadSchema.safeParse(payload);
  if (!result.success) {
    throw new Error(
      `Ungueltiges AnalyticsEvent.payload fuer eventType="${eventType}": ` +
        result.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; "),
    );
  }
  return result.data;
}

/**
 * Validiert `metadata` fuer einen `AuditLog`-Eintrag mit gegebener `action`.
 * Wirft bei Regelverstoss einen Fehler mit lesbarer Fehlermeldung
 * (inklusive `action` im Kontext).
 */
export function parseAuditLogMetadata(action: string, metadata: unknown): Json | null {
  if (metadata === null || metadata === undefined) {
    return null;
  }
  const result = auditLogMetadataSchema.safeParse(metadata);
  if (!result.success) {
    throw new Error(
      `Ungueltiges AuditLog.metadata fuer action="${action}": ` +
        result.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; "),
    );
  }
  return result.data;
}

// Re-Export fuer Aufrufer, die die reine PII-Pruefung isoliert nutzen wollen
// (z. B. bei manueller $queryRaw-Nutzung ausserhalb des gescopten Clients).
export { assertNoContactData };
