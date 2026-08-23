/**
 * `GET /api/admin/questionnaires/[id]/versions/[versionId]` (Phase 8 AP3,
 * siehe PHASE_8_IMPLEMENTATION_PLAN.md Abschnitt 6). Detailansicht einer
 * Version inkl. aller Fragen/AnswerOptions/VisibilityConditions.
 *
 * Erfordert `config.questions.view` (Configuration-RBAC, Phase 8 AP2).
 */

import { NextResponse, type NextRequest } from "next/server";
import { withRequestTenantContext } from "@/server/auth/request-context";
import { withErrorMapping } from "@/server/consultation-ui/http-errors";
import { requireConfigPermission } from "@/server/authz/config-permissions";
import { getQuestionnaireVersionDetail } from "@/server/admin/question-admin";

interface RouteParams {
  params: Promise<{ id: string; versionId: string }>;
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  return withErrorMapping(() =>
    withRequestTenantContext(request, async (session) => {
      requireConfigPermission(session, "config.questions.view");
      const { id, versionId } = await params;
      const version = await getQuestionnaireVersionDetail(id, versionId);
      return NextResponse.json({ version }, { status: 200 });
    }),
  );
}
