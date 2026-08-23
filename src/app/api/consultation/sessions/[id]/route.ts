import { NextResponse, type NextRequest } from "next/server";
import { withRequestTenantContext } from "@/server/auth/request-context";
import { withErrorMapping } from "@/server/consultation-ui/http-errors";
import { loadQuestionnaireState } from "@/server/questionnaire/service";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * Laedt den aktuellen Befragungszustand (sichtbare Fragen, aktuelle
 * Antworten, Fortschritt) einer ConsultationSession. Ruft ausschliesslich
 * `loadQuestionnaireState()` 1:1 auf. Die Mandantentrennung erfolgt ueber
 * `withRequestTenantContext()`/`withTenantScope()` -- eine Session eines
 * anderen Mandanten liefert (durch das Tenant-Scoping auf DB-Ebene)
 * `ConsultationSessionNotFoundError` -> 404, nicht 403 (kein Leck ueber den
 * Statuscode, ob die ID ueberhaupt existiert).
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  return withErrorMapping(() =>
    withRequestTenantContext(request, async () => {
      const { id } = await params;
      const state = await loadQuestionnaireState(id);
      return NextResponse.json(state);
    }),
  );
}
