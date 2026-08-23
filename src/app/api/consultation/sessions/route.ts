import { NextResponse, type NextRequest } from "next/server";
import { withRequestTenantContext } from "@/server/auth/request-context";
import { withErrorMapping } from "@/server/consultation-ui/http-errors";
import { startQuestionnaireBodySchema } from "@/server/consultation-ui/schemas";
import { startQuestionnaire } from "@/server/questionnaire/service";

/**
 * Startet eine neue Fragebogen-Sitzung fuer die eingeloggte Mitarbeiter-
 * Session. `storeId`/`employeeId` kommen ausschliesslich aus dem verifizierten
 * Session-Payload, nie aus dem Request-Body (siehe schemas.ts Modulkommentar).
 * Ruft ausschliesslich `startQuestionnaire()` 1:1 auf -- keine neue fachliche
 * Logik (siehe PHASE_5_IMPLEMENTATION_PLAN.md Abschnitt 2.2 Punkt 1).
 */
export async function POST(request: NextRequest) {
  return withErrorMapping(() =>
    withRequestTenantContext(request, async (session) => {
      const body = await request.json().catch(() => null);
      const parsed = startQuestionnaireBodySchema.safeParse(body);
      if (!parsed.success) {
        return NextResponse.json(
          { error: "InvalidRequest", message: "Ungueltige Anfrage.", issues: parsed.error.issues },
          { status: 400 },
        );
      }

      const state = await startQuestionnaire({
        questionnaireKey: parsed.data.questionnaireKey,
        storeId: session.storeId,
        employeeId: session.employeeId,
        customerReferenceId: parsed.data.customerReferenceId ?? null,
        consultationType: parsed.data.consultationType,
      });
      return NextResponse.json(state, { status: 201 });
    }),
  );
}
