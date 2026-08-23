import { NextResponse, type NextRequest } from "next/server";
import { withRequestTenantContext } from "@/server/auth/request-context";
import { withErrorMapping } from "@/server/consultation-ui/http-errors";
import { recordRecommendationOutcomeBodySchema } from "@/server/consultation-ui/schemas";
import { recordRecommendationOutcome } from "@/server/recommendation/outcome";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * Speichert die Mitarbeiter-Entscheidung (Annehmen/Ablehnen/Zurueckstellen)
 * fuer ein einzelnes RecommendationItem (AP7, siehe
 * PHASE_5_IMPLEMENTATION_PLAN.md Abschnitt 8). `id` ist die
 * `recommendationItemId`, nicht die Session-Id -- siehe Routenpfad.
 * Fachliche Validierung (REJECTED verlangt rejectionReasonId, Doppel-
 * Entscheid etc.) uebernimmt vollstaendig `recordRecommendationOutcome()`;
 * diese Route mappt nur bekannte Fehler ueber `withErrorMapping()`/
 * `mapKnownErrorToResponse()` auf HTTP-Antworten (siehe dort, u. a.
 * `RecommendationOutcomeAlreadyExistsError` -> 409 mit `decidedAt`).
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  return withErrorMapping(() =>
    withRequestTenantContext(request, async () => {
      const { id } = await params;
      const body = await request.json().catch(() => null);
      const parsed = recordRecommendationOutcomeBodySchema.safeParse(body);
      if (!parsed.success) {
        return NextResponse.json(
          { error: "InvalidRequest", message: "Ungueltige Anfrage.", issues: parsed.error.issues },
          { status: 400 },
        );
      }

      const result = await recordRecommendationOutcome({
        recommendationItemId: id,
        outcome: parsed.data.outcome,
        rejectionReasonId: parsed.data.rejectionReasonId,
      });
      return NextResponse.json({ outcome: result }, { status: 201 });
    }),
  );
}
