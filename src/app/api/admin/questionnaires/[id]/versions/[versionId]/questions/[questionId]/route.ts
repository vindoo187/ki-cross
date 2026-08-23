/**
 * `PATCH`/`DELETE` `/api/admin/questionnaires/[id]/versions/[versionId]/questions/[questionId]`
 * (Phase 8 AP3, siehe PHASE_8_IMPLEMENTATION_PLAN.md Abschnitt 6).
 * Bearbeitet bzw. entfernt eine Frage in einer DRAFT-Version. Serverseitige
 * Sperre: Versuch auf einer nicht-DRAFT-Version -> 409
 * (`updateQuestionInDraft()`/`removeQuestionFromDraft()`,
 * `src/server/admin/question-admin.ts`).
 *
 * Erfordert `config.questions.edit` (Configuration-RBAC, Phase 8 AP2).
 */

import { NextResponse, type NextRequest } from "next/server";
import { withRequestTenantContext } from "@/server/auth/request-context";
import { withErrorMapping } from "@/server/consultation-ui/http-errors";
import { requireConfigPermission } from "@/server/authz/config-permissions";
import { updateQuestionSchema } from "@/server/admin/schemas";
import { removeQuestionFromDraft, updateQuestionInDraft } from "@/server/admin/question-admin";

interface RouteParams {
  params: Promise<{ id: string; versionId: string; questionId: string }>;
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  return withErrorMapping(() =>
    withRequestTenantContext(request, async (session) => {
      requireConfigPermission(session, "config.questions.edit");
      const { id, versionId, questionId } = await params;
      const body = await request.json().catch(() => null);
      const parsed = updateQuestionSchema.safeParse(body);
      if (!parsed.success) {
        return NextResponse.json(
          { error: "InvalidRequest", message: "Ungueltige Anfrage.", issues: parsed.error.issues },
          { status: 400 },
        );
      }
      const question = await updateQuestionInDraft(id, versionId, questionId, parsed.data);
      return NextResponse.json({ question }, { status: 200 });
    }),
  );
}

export async function DELETE(request: NextRequest, { params }: RouteParams) {
  return withErrorMapping(() =>
    withRequestTenantContext(request, async (session) => {
      requireConfigPermission(session, "config.questions.edit");
      const { id, versionId, questionId } = await params;
      await removeQuestionFromDraft(id, versionId, questionId);
      return new NextResponse(null, { status: 204 });
    }),
  );
}
