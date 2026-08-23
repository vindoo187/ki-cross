/**
 * `POST /api/admin/questionnaires/[id]/versions/[versionId]/rollback`
 * (Phase 8 AP5, siehe PHASE_8_IMPLEMENTATION_PLAN.md Abschnitt 8). Erzeugt
 * eine neue DRAFT-Version als Tiefkopie der angegebenen (bereits
 * veroeffentlichten) historischen Version -- KEIN direkter Statuswechsel der
 * alten Version. Die neue DRAFT-Version durchlaeuft anschliessend regulaer
 * den bestehenden Validate-/Publish-Workflow aus AP4 (separate Requests
 * gegen `.../validate` bzw. `.../publish`). Fachlogik ausschliesslich in
 * `rollbackToVersion()` (`src/server/admin/question-admin.ts`).
 *
 * Erfordert `config.questions.edit` (Configuration-RBAC, Phase 8 AP2) --
 * Rollback ist fachlich eine Entwurfserstellung, kein Publish-Vorgang, daher
 * bewusst NICHT `config.questions.publish`.
 */

import { NextResponse, type NextRequest } from "next/server";
import { withRequestTenantContext } from "@/server/auth/request-context";
import { withErrorMapping } from "@/server/consultation-ui/http-errors";
import { requireConfigPermission } from "@/server/authz/config-permissions";
import { rollbackVersionSchema } from "@/server/admin/schemas";
import { rollbackToVersion } from "@/server/admin/question-admin";

interface RouteParams {
  params: Promise<{ id: string; versionId: string }>;
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  return withErrorMapping(() =>
    withRequestTenantContext(request, async (session) => {
      requireConfigPermission(session, "config.questions.edit");
      const { id, versionId } = await params;
      const body = await request.json().catch(() => ({}));
      const parsed = rollbackVersionSchema.safeParse(body ?? {});
      if (!parsed.success) {
        return NextResponse.json(
          { error: "InvalidRequest", message: "Ungueltige Anfrage.", issues: parsed.error.issues },
          { status: 400 },
        );
      }
      const version = await rollbackToVersion(id, versionId, parsed.data.label);
      return NextResponse.json({ version }, { status: 201 });
    }),
  );
}
