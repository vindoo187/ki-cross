/**
 * `GET /api/admin/commission-models/[id]/versions/[versionId]` (Phase 10
 * AP2, siehe PHASE_10_IMPLEMENTATION_PLAN.md Abschnitt 4). Detailansicht
 * einer `CommissionModelVersion` inkl. aller Skalarfelder (`commissionType`/
 * `currency`/Betraege) -- `CommissionTier`-Zeilen folgen erst in AP4.
 *
 * Erfordert `config.commissions.view` (Configuration-RBAC, Phase 10 AP1).
 */

import { NextResponse, type NextRequest } from "next/server";
import { withRequestTenantContext } from "@/server/auth/request-context";
import { withErrorMapping } from "@/server/consultation-ui/http-errors";
import { requireConfigPermission } from "@/server/authz/config-permissions";
import { getCommissionModelVersionDetail } from "@/server/admin/commission-admin";

interface RouteParams {
  params: Promise<{ id: string; versionId: string }>;
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  return withErrorMapping(() =>
    withRequestTenantContext(request, async (session) => {
      requireConfigPermission(session, "config.commissions.view");
      const { id, versionId } = await params;
      const version = await getCommissionModelVersionDetail(id, versionId);
      return NextResponse.json({ version }, { status: 200 });
    }),
  );
}
