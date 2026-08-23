/**
 * `GET /api/admin/questionnaires` (Phase 8 AP3, siehe
 * PHASE_8_IMPLEMENTATION_PLAN.md Abschnitt 6). Duenne Transport-Schicht --
 * Fachlogik liegt ausschliesslich in `listQuestionnaires()`
 * (`src/server/admin/question-admin.ts`).
 *
 * Zugriff erfordert `config.questions.view` (Configuration-RBAC, Phase 8
 * AP2) -- serverseitig geprueft, UI-Schutz allein reicht nicht (ChatGPT-
 * Auflage zu AP3).
 */

import { NextResponse, type NextRequest } from "next/server";
import { withRequestTenantContext } from "@/server/auth/request-context";
import { withErrorMapping } from "@/server/consultation-ui/http-errors";
import { requireConfigPermission } from "@/server/authz/config-permissions";
import { listQuestionnaires } from "@/server/admin/question-admin";

export async function GET(request: NextRequest) {
  return withErrorMapping(() =>
    withRequestTenantContext(request, async (session) => {
      requireConfigPermission(session, "config.questions.view");
      const questionnaires = await listQuestionnaires();
      return NextResponse.json({ questionnaires }, { status: 200 });
    }),
  );
}
