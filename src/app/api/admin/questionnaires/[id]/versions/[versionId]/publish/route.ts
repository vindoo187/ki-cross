/**
 * `POST /api/admin/questionnaires/[id]/versions/[versionId]/publish`
 * (Phase 8 AP4, siehe PHASE_8_IMPLEMENTATION_PLAN.md Abschnitt 7). Validiert
 * erneut serverseitig (niemals nur auf Client-Validierung vertrauen) und
 * fuehrt bei Erfolg die atomare Publish-Transaktion aus `publishDraftVersion()`
 * aus (bisherige ACTIVE-Version -> EXPIRED, neue Version -> ACTIVE, Audit --
 * alles in einer DB-Transaktion, siehe Modulkommentar in question-admin.ts).
 *
 * Erfordert `config.questions.publish` -- bewusst GETRENNT von `.edit`
 * (ChatGPT-Auflage, Plan Abschnitt 3.2/7): ein `config_editor` kann Entwuerfe
 * bauen, aber nicht live schalten.
 */

import { NextResponse, type NextRequest } from "next/server";
import { withRequestTenantContext } from "@/server/auth/request-context";
import { withErrorMapping } from "@/server/consultation-ui/http-errors";
import { requireConfigPermission } from "@/server/authz/config-permissions";
import { publishDraftVersion } from "@/server/admin/question-admin";

interface RouteParams {
  params: Promise<{ id: string; versionId: string }>;
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  return withErrorMapping(() =>
    withRequestTenantContext(request, async (session) => {
      requireConfigPermission(session, "config.questions.publish");
      const { id, versionId } = await params;
      const result = await publishDraftVersion(id, versionId);
      return NextResponse.json(result, { status: 200 });
    }),
  );
}
