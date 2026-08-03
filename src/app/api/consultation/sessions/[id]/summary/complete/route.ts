import { NextResponse, type NextRequest } from "next/server";
import { withRequestTenantContext } from "@/server/auth/request-context";
import { withErrorMapping } from "@/server/consultation-ui/http-errors";
import { completeConsultation } from "@/server/consultation-ui/completion";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * Markiert eine Beratungssitzung als abgeschlossen (`CONSULTATION_COMPLETED`,
 * AP10, siehe PHASE_5_IMPLEMENTATION_PLAN.md Abschnitt 10). Ausgeloest durch
 * den "Beratung abschliessen"-Button auf der Zusammenfassungsseite
 * (`CompleteConsultationButton.tsx`) -- zu unterscheiden von
 * `POST /api/consultation/sessions/[id]/complete` (`completeQuestionnaire()`,
 * markiert nur den Fragebogen-Abschluss, nicht die gesamte Beratung).
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  return withErrorMapping(() =>
    withRequestTenantContext(request, async () => {
      const { id } = await params;
      const result = await completeConsultation(id);
      return NextResponse.json(result);
    }),
  );
}
