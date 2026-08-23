/**
 * `GET /api/admin/rule-sets` (Phase 9 AP2, siehe
 * PHASE_9_IMPLEMENTATION_PLAN.md Abschnitt 4). Duenne Transport-Schicht --
 * Fachlogik ausschliesslich in `listRuleSets()`
 * (`src/server/admin/rule-admin.ts`).
 *
 * Zugriff erfordert `config.rules.view` (Configuration-RBAC, Phase 9 AP1) --
 * serverseitig geprueft, UI-Schutz allein reicht nicht (analog Phase 8).
 */

import { NextResponse, type NextRequest } from "next/server";
import { withRequestTenantContext } from "@/server/auth/request-context";
import { withErrorMapping } from "@/server/consultation-ui/http-errors";
import { requireConfigPermission } from "@/server/authz/config-permissions";
import { listRuleSets } from "@/server/admin/rule-admin";

export async function GET(request: NextRequest) {
  return withErrorMapping(() =>
    withRequestTenantContext(request, async (session) => {
      requireConfigPermission(session, "config.rules.view");
      const ruleSets = await listRuleSets();
      return NextResponse.json({ ruleSets }, { status: 200 });
    }),
  );
}
