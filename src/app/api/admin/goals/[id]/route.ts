/**
 * `GET /api/admin/goals/[id]` (Detailansicht eines `Goal` inkl. vollstaendiger
 * `GoalVersion`-Historie). Phase 11 AP3, siehe
 * PHASE_11_IMPLEMENTATION_PLAN.md Abschnitt 3. Duenne Transport-Schicht --
 * Fachlogik ausschliesslich in `getGoalDetail()` (`goal-admin.ts`).
 *
 * Zugriff erfordert `config.goals.view`. Eine `id` aus einem fremden
 * Mandanten liefert ueber den tenant-gescopten `db`-Client strukturell 0
 * Treffer -> `GoalNotFoundError` -> 404 (kein Cross-Tenant-Leck ueber blosse
 * `goalId`-Kenntnis, siehe `http-errors.ts`).
 */

import { NextResponse, type NextRequest } from "next/server";
import { withRequestTenantContext } from "@/server/auth/request-context";
import { withErrorMapping } from "@/server/consultation-ui/http-errors";
import { requireConfigPermission } from "@/server/authz/config-permissions";
import { getGoalDetail } from "@/server/admin/goal-admin";

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  return withErrorMapping(() =>
    withRequestTenantContext(request, async (session) => {
      requireConfigPermission(session, "config.goals.view");
      const { id } = await params;
      const goal = await getGoalDetail(id);
      return NextResponse.json({ goal }, { status: 200 });
    }),
  );
}
