/**
 * `POST /api/admin/questionnaires/[id]/versions` (Phase 8 AP3, siehe
 * PHASE_8_IMPLEMENTATION_PLAN.md Abschnitt 6). Legt eine neue DRAFT-Version
 * an -- leer oder als tiefe Kopie einer bestehenden Version
 * (`copyFromVersionId`). Fachlogik ausschliesslich in `createDraftVersion()`
 * (`src/server/admin/question-admin.ts`).
 *
 * `GET /api/admin/questionnaires/[id]/versions` (Phase 8 AP5, siehe
 * PHASE_8_IMPLEMENTATION_PLAN.md Abschnitt 8). Vollstaendige Versionshistorie
 * eines Questionnaire (alle Status, neueste zuerst) -- Grundlage fuer die
 * Versionshistorie-Ansicht mit Rollback-Aktion (AP6).
 *
 * Erfordert `config.questions.view` (GET) bzw. `config.questions.edit`
 * (POST) -- Configuration-RBAC, Phase 8 AP2.
 */

import { NextResponse, type NextRequest } from "next/server";
import { withRequestTenantContext } from "@/server/auth/request-context";
import { withErrorMapping } from "@/server/consultation-ui/http-errors";
import { requireConfigPermission } from "@/server/authz/config-permissions";
import { createDraftVersionSchema } from "@/server/admin/schemas";
import { createDraftVersion, getQuestionnaireVersionHistory } from "@/server/admin/question-admin";

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  return withErrorMapping(() =>
    withRequestTenantContext(request, async (session) => {
      requireConfigPermission(session, "config.questions.view");
      const { id } = await params;
      const versions = await getQuestionnaireVersionHistory(id);
      return NextResponse.json({ versions }, { status: 200 });
    }),
  );
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  return withErrorMapping(() =>
    withRequestTenantContext(request, async (session) => {
      requireConfigPermission(session, "config.questions.edit");
      const { id } = await params;
      const body = await request.json().catch(() => null);
      const parsed = createDraftVersionSchema.safeParse(body);
      if (!parsed.success) {
        return NextResponse.json(
          { error: "InvalidRequest", message: "Ungueltige Anfrage.", issues: parsed.error.issues },
          { status: 400 },
        );
      }
      const version = await createDraftVersion(id, parsed.data);
      return NextResponse.json({ version }, { status: 201 });
    }),
  );
}
