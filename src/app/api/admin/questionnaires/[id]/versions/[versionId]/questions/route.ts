/**
 * `POST /api/admin/questionnaires/[id]/versions/[versionId]/questions`
 * (Phase 8 AP3, siehe PHASE_8_IMPLEMENTATION_PLAN.md Abschnitt 6). Fuegt
 * einer DRAFT-Version eine neue Frage hinzu (inkl. AnswerOptions/
 * VisibilityConditions als verschachtelte Payload). Serverseitige Sperre:
 * Versuch auf einer nicht-DRAFT-Version -> 409 (`addQuestionToDraft()`,
 * `src/server/admin/question-admin.ts`).
 *
 * Erfordert `config.questions.edit` (Configuration-RBAC, Phase 8 AP2).
 */

import { NextResponse, type NextRequest } from "next/server";
import { withRequestTenantContext } from "@/server/auth/request-context";
import { withErrorMapping } from "@/server/consultation-ui/http-errors";
import { requireConfigPermission } from "@/server/authz/config-permissions";
import { createQuestionSchema } from "@/server/admin/schemas";
import { addQuestionToDraft } from "@/server/admin/question-admin";

interface RouteParams {
  params: Promise<{ id: string; versionId: string }>;
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  return withErrorMapping(() =>
    withRequestTenantContext(request, async (session) => {
      requireConfigPermission(session, "config.questions.edit");
      const { id, versionId } = await params;
      const body = await request.json().catch(() => null);
      const parsed = createQuestionSchema.safeParse(body);
      if (!parsed.success) {
        return NextResponse.json(
          { error: "InvalidRequest", message: "Ungueltige Anfrage.", issues: parsed.error.issues },
          { status: 400 },
        );
      }
      const question = await addQuestionToDraft(id, versionId, parsed.data);
      return NextResponse.json({ question }, { status: 201 });
    }),
  );
}
