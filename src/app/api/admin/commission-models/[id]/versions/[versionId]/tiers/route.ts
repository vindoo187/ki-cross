/**
 * `POST /api/admin/commission-models/[id]/versions/[versionId]/tiers`
 * (Phase 10 AP4, siehe PHASE_10_IMPLEMENTATION_PLAN.md Abschnitt 6,
 * ChatGPT-GO 2026-08-21). Legt eine neue `CommissionTier`-Stufe fuer eine
 * DRAFT-Version an (nur zulaessig, wenn `commissionType` der Version
 * TIERED ist -- siehe `createCommissionTier()`,
 * `src/server/admin/commission-admin.ts`).
 *
 * Erfordert `config.commissions.edit` (Configuration-RBAC, Phase 10 AP1).
 * `GET` (Listen-Endpunkt) ist bewusst NICHT vorgesehen -- die Stufen sind
 * bereits Teil der `CommissionModelVersionDetail`-Antwort von
 * `GET .../versions/[versionId]` (`tiers`-Feld, siehe dortiger
 * Modulkommentar).
 */

import { NextResponse, type NextRequest } from "next/server";
import { withRequestTenantContext } from "@/server/auth/request-context";
import { withErrorMapping } from "@/server/consultation-ui/http-errors";
import { requireConfigPermission } from "@/server/authz/config-permissions";
import { createCommissionTierSchema } from "@/server/admin/commission-schemas";
import { createCommissionTier } from "@/server/admin/commission-admin";

interface RouteParams {
  params: Promise<{ id: string; versionId: string }>;
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  return withErrorMapping(() =>
    withRequestTenantContext(request, async (session) => {
      requireConfigPermission(session, "config.commissions.edit");
      const { id, versionId } = await params;
      const body = await request.json().catch(() => null);
      const parsed = createCommissionTierSchema.safeParse(body);
      if (!parsed.success) {
        return NextResponse.json(
          { error: "InvalidRequest", message: "Ungueltige Anfrage.", issues: parsed.error.issues },
          { status: 400 },
        );
      }
      const tier = await createCommissionTier(id, versionId, parsed.data);
      return NextResponse.json({ tier }, { status: 201 });
    }),
  );
}
