/**
 * `GET /api/admin/rule-sets/[id]/versions/[versionId]` (Phase 9 AP2, siehe
 * PHASE_9_IMPLEMENTATION_PLAN.md Abschnitt 4). Detailansicht einer Version
 * inkl. aller vier Regeltypen (Eligibility/Exclusion/Prioritization/
 * CrossSelling) + ihrer Conditions.
 *
 * Erfordert `config.rules.view` (Configuration-RBAC, Phase 9 AP1).
 */

import { NextResponse, type NextRequest } from "next/server";
import { withRequestTenantContext } from "@/server/auth/request-context";
import { withErrorMapping } from "@/server/consultation-ui/http-errors";
import { requireConfigPermission } from "@/server/authz/config-permissions";
import { getRuleSetVersionDetail } from "@/server/admin/rule-admin";

interface RouteParams {
  params: Promise<{ id: string; versionId: string }>;
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  return withErrorMapping(() =>
    withRequestTenantContext(request, async (session) => {
      requireConfigPermission(session, "config.rules.view");
      const { id, versionId } = await params;
      const version = await getRuleSetVersionDetail(id, versionId);
      return NextResponse.json({ version }, { status: 200 });
    }),
  );
}
