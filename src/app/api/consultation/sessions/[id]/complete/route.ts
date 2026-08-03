import { NextResponse, type NextRequest } from "next/server";
import { withRequestTenantContext } from "@/server/auth/request-context";
import { withErrorMapping } from "@/server/consultation-ui/http-errors";
import { completeQuestionnaire } from "@/server/questionnaire/service";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * Schliesst eine Fragebogen-Sitzung ab (`completeQuestionnaire()`). Wirft
 * `IncompleteQuestionnaireError` (-> 422 mit `missingQuestionIds`), falls noch
 * sichtbare Pflichtfragen unbeantwortet sind, oder
 * `QuestionnaireRunNotModifiableError` (-> 409), falls die Sitzung nicht mehr
 * im Status IN_PROGRESS ist.
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  return withErrorMapping(() =>
    withRequestTenantContext(request, async () => {
      const { id } = await params;
      const result = await completeQuestionnaire(id);
      return NextResponse.json(result);
    }),
  );
}
