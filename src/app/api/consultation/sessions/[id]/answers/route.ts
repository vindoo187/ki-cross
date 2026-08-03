import { NextResponse, type NextRequest } from "next/server";
import { withRequestTenantContext } from "@/server/auth/request-context";
import { withErrorMapping } from "@/server/consultation-ui/http-errors";
import { changeAnswerBodySchema, saveAnswerBodySchema } from "@/server/consultation-ui/schemas";
import { changeAnswer, loadQuestionnaireState, saveAnswer } from "@/server/questionnaire/service";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * Speichert die ERSTE Antwort auf eine Frage (`saveAnswer()`). Liefert direkt
 * den aktualisierten `QuestionnaireState` mit zurueck (siehe
 * PHASE_5_IMPLEMENTATION_PLAN.md Abschnitt 3, Punkt 4 -- spart der UI einen
 * Extra-Request pro Antwort).
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  return withErrorMapping(() =>
    withRequestTenantContext(request, async () => {
      const { id } = await params;
      const body = await request.json().catch(() => null);
      const parsed = saveAnswerBodySchema.safeParse(body);
      if (!parsed.success) {
        return NextResponse.json(
          { error: "InvalidRequest", message: "Ungueltige Anfrage.", issues: parsed.error.issues },
          { status: 400 },
        );
      }

      const writeResult = await saveAnswer({
        consultationSessionId: id,
        questionId: parsed.data.questionId,
        value: parsed.data.value,
      });
      const state = await loadQuestionnaireState(id);
      return NextResponse.json({ writeResult, state }, { status: 201 });
    }),
  );
}

/**
 * Aendert eine vorhandene Antwort ueber Compare-And-Swap
 * (`expectedAnswerVersion`, siehe `changeAnswer()`). Eine leere `value` loescht
 * die aktive Antwort (bestehendes Service-Verhalten, hier nicht neu erfunden).
 * Liefert ebenfalls den aktualisierten `QuestionnaireState` direkt mit zurueck.
 */
export async function PATCH(request: NextRequest, { params }: RouteParams) {
  return withErrorMapping(() =>
    withRequestTenantContext(request, async () => {
      const { id } = await params;
      const body = await request.json().catch(() => null);
      const parsed = changeAnswerBodySchema.safeParse(body);
      if (!parsed.success) {
        return NextResponse.json(
          { error: "InvalidRequest", message: "Ungueltige Anfrage.", issues: parsed.error.issues },
          { status: 400 },
        );
      }

      const writeResult = await changeAnswer({
        consultationSessionId: id,
        questionId: parsed.data.questionId,
        value: parsed.data.value,
        expectedAnswerVersion: parsed.data.expectedAnswerVersion,
      });
      const state = await loadQuestionnaireState(id);
      return NextResponse.json({ writeResult, state });
    }),
  );
}
