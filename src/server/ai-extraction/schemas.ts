import { z } from "zod";

/**
 * Body von `POST /api/consultation/sessions/[id]/ai-extraction` (Phase 12
 * AP2, siehe PHASE_12_IMPLEMENTATION_PLAN.md Abschnitt 4). Der Client
 * uebergibt AUSSCHLIESSLICH den Freitext -- niemals einen eigenen
 * Fragenkatalog (`visibleQuestions` o. ae.), siehe ChatGPT-Vorgabe
 * 2026-08-23: "Der Client darf keinen eigenen Fragenkatalog an die
 * KI-Route uebergeben." Der sichtbare Fragenkatalog wird ausschliesslich
 * serverseitig ueber `buildVisibleQuestionContext()`
 * (`visible-question-context.ts`, wiederum `computeVisiblePath()`) ermittelt.
 *
 * `max(4000)` ist eine bewusst grobe Eingabe-Hygiene-Grenze (analog
 * `saveAnswerBodySchema`/`closeDealBodySchema` -- fruehe 400-Ablehnung statt
 * Rundreise durch den Provider) -- KEIN Ersatz fuer die spaetere,
 * eigenstaendige Kosten-/Timeout-Kontrolle (ChatGPT-Schicht 9
 * "Failure/Timeout/Cost Controls", nicht Teil von AP2).
 */
export const aiExtractionBodySchema = z
  .object({
    freeText: z.string().trim().min(1).max(4000),
  })
  .strict();

/**
 * Body von `POST /api/consultation/sessions/[id]/ai-extraction/outcome`
 * (Phase 12 AP4, ChatGPT-GO 2026-08-23). Zeichnet die explizite
 * Mitarbeiter-Entscheidung ueber einen einzelnen KI-Vorschlag auf (siehe
 * `service.ts::recordAiSuggestionOutcome()`-Kommentar). `changed` ist nur
 * bei `outcome: "accepted"` erlaubt/erforderlich -- ein `changed`-Feld bei
 * `outcome: "rejected"` waere bedeutungslos (kein Speichervorgang fand
 * statt) und wird durch `.strict()` je Variante bewusst abgelehnt statt
 * stillschweigend ignoriert.
 */
export const aiExtractionOutcomeBodySchema = z.discriminatedUnion("outcome", [
  z
    .object({
      questionId: z.string().trim().min(1),
      outcome: z.literal("accepted"),
      changed: z.boolean(),
    })
    .strict(),
  z
    .object({
      questionId: z.string().trim().min(1),
      outcome: z.literal("rejected"),
    })
    .strict(),
]);
