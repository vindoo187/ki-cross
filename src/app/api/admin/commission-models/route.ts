/**
 * `GET /api/admin/commission-models` (Phase 10 AP2, siehe
 * PHASE_10_IMPLEMENTATION_PLAN.md Abschnitt 4). Duenne Transport-Schicht --
 * Fachlogik ausschliesslich in `listCommissionModels()`
 * (`src/server/admin/commission-admin.ts`).
 *
 * Zugriff erfordert `config.commissions.view` (Configuration-RBAC, Phase 10
 * AP1) -- serverseitig geprueft, UI-Schutz allein reicht nicht (analog
 * Phase 8/9).
 */

import { NextResponse, type NextRequest } from "next/server";
import { withRequestTenantContext } from "@/server/auth/request-context";
import { withErrorMapping } from "@/server/consultation-ui/http-errors";
import { requireConfigPermission } from "@/server/authz/config-permissions";
import { listCommissionModels } from "@/server/admin/commission-admin";

export async function GET(request: NextRequest) {
  return withErrorMapping(() =>
    withRequestTenantContext(request, async (session) => {
      requireConfigPermission(session, "config.commissions.view");
      const commissionModels = await listCommissionModels();
      return NextResponse.json({ commissionModels }, { status: 200 });
    }),
  );
}
