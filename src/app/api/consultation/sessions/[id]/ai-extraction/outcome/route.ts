import { NextResponse, type NextRequest } from "next/server";
import { withRequestTenantContext } from "@/server/auth/request-context";
import { withErrorMapping } from "@/server/consultation-ui/http-errors";
import { aiExtractionOutcomeBodySchema } from "@/server/ai-extraction/schemas";
import { recordAiSuggestionOutcome } from "@/server/ai-extraction/service";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * Phase 12 AP4 (ChatGPT-GO 2026-08-23). Rein additive, von der eigentlichen
 * Antwort-Speicherung (`.../answers`) UNABHAENGIGE Route -- zeichnet
 * ausschliesslich die Mitarbeiter-Entscheidung ueber einen KI-Vorschlag als
 * `AnalyticsEvent` auf (siehe `recordAiSuggestionOutcome()`-Kommentar in
 * `service.ts` fuer die vollstaendige Begruendung der strukturellen
 * Trennung). Der Client ruft diese Route bewusst als GENUIN EIGENEN Request
 * auf -- bei Uebernehmen/Aendern NACH dem bereits erfolgreichen
 * `saveAnswer()`/`changeAnswer()`-Aufruf, bei Verwerfen unmittelbar (ohne
 * vorherigen Speichervorgang).
 *
 * `id` (Session-ID) kommt AUSSCHLIESSLICH aus dem URL-Parameter,
 * `employeeId`/`tenantId` AUSSCHLIESSLICH aus dem durch
 * `withRequestTenantContext()` verifizierten Session-Payload.
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  return withErrorMapping(() =>
    withRequestTenantContext(request, async (session) => {
      const { id } = await params;
      const body = await request.json().catch(() => null);
      const parsed = aiExtractionOutcomeBodySchema.safeParse(body);
      if (!parsed.success) {
        return NextResponse.json(
          { error: "InvalidRequest", message: "Ungueltige Anfrage.", issues: parsed.error.issues },
          { status: 400 },
        );
      }

      await recordAiSuggestionOutcome({
        consultationSessionId: id,
        employeeId: session.employeeId,
        hasPermission: session.consultationPermissions.includes("consultation.ai_extraction.use"),
        questionId: parsed.data.questionId,
        outcome: parsed.data.outcome,
        changed: parsed.data.outcome === "accepted" ? parsed.data.changed : false,
      });
      return NextResponse.json({ ok: true }, { status: 202 });
    }),
  );
}
