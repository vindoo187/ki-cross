/**
 * `POST /api/admin/questionnaires/[id]/versions/[versionId]/validate`
 * (Phase 8 AP4, siehe PHASE_8_IMPLEMENTATION_PLAN.md Abschnitt 7). Fuehrt die
 * vollstaendige fachliche Validierung (`validateQuestionnaireVersion()`, seit
 * Phase 3A vorhanden) gegen eine Version aus und liefert bei Erfolg `{valid:
 * true}`, bei Verstoessen eine strukturierte Fehlerliste (422, siehe
 * http-errors.ts). Rein lesend -- keine Statusbeschraenkung (auch bereits
 * veroeffentlichte Versionen koennen zu Regressionszwecken erneut geprueft
 * werden), daher `config.questions.edit` statt `.publish` (Teil des
 * Entwurfs-Workflows, nicht der eigentlichen Veroeffentlichung).
 *
 * Erfordert `config.questions.edit` (Configuration-RBAC, Phase 8 AP2).
 */

import { NextResponse, type NextRequest } from "next/server";
import { withRequestTenantContext } from "@/server/auth/request-context";
import { withErrorMapping } from "@/server/consultation-ui/http-errors";
import { requireConfigPermission } from "@/server/authz/config-permissions";
import { validateDraftVersion } from "@/server/admin/question-admin";

interface RouteParams {
  params: Promise<{ id: string; versionId: string }>;
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  return withErrorMapping(() =>
    withRequestTenantContext(request, async (session) => {
      requireConfigPermission(session, "config.questions.edit");
      const { id, versionId } = await params;
      const result = await validateDraftVersion(id, versionId);
      return NextResponse.json(result, { status: 200 });
    }),
  );
}
