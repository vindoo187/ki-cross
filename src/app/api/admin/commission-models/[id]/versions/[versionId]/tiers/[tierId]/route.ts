/**
 * `PATCH`/`DELETE`
 * `/api/admin/commission-models/[id]/versions/[versionId]/tiers/[tierId]`
 * (Phase 10 AP4, siehe PHASE_10_IMPLEMENTATION_PLAN.md Abschnitt 6).
 *
 * `PATCH`: partielles Update einer bestehenden `CommissionTier`-Zeile
 * (Amount/Percentage-XOR wird auf dem ZUSAMMENGEFUEHRTEN Ergebniszustand
 * geprueft, siehe `updateCommissionTier()`,
 * `src/server/admin/commission-admin.ts`).
 *
 * `DELETE`: entfernt eine `CommissionTier`-Zeile vollstaendig (bewusst
 * kein Append-only-Muster hier -- siehe `deleteCommissionTier()`-
 * Modulkommentar: nur innerhalb einer noch nicht veroeffentlichten
 * DRAFT-Version moeglich).
 *
 * Beide Operationen nur auf DRAFT-Versionen zulaessig (409 sonst).
 * Erfordert `config.commissions.edit`.
 */

import { NextResponse, type NextRequest } from "next/server";
import { withRequestTenantContext } from "@/server/auth/request-context";
import { withErrorMapping } from "@/server/consultation-ui/http-errors";
import { requireConfigPermission } from "@/server/authz/config-permissions";
import { updateCommissionTierSchema } from "@/server/admin/commission-schemas";
import { deleteCommissionTier, updateCommissionTier } from "@/server/admin/commission-admin";

interface RouteParams {
  params: Promise<{ id: string; versionId: string; tierId: string }>;
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  return withErrorMapping(() =>
    withRequestTenantContext(request, async (session) => {
      requireConfigPermission(session, "config.commissions.edit");
      const { id, versionId, tierId } = await params;
      const body = await request.json().catch(() => null);
      const parsed = updateCommissionTierSchema.safeParse(body);
      if (!parsed.success) {
        return NextResponse.json(
          { error: "InvalidRequest", message: "Ungueltige Anfrage.", issues: parsed.error.issues },
          { status: 400 },
        );
      }
      const tier = await updateCommissionTier(id, versionId, tierId, parsed.data);
      return NextResponse.json({ tier }, { status: 200 });
    }),
  );
}

export async function DELETE(request: NextRequest, { params }: RouteParams) {
  return withErrorMapping(() =>
    withRequestTenantContext(request, async (session) => {
      requireConfigPermission(session, "config.commissions.edit");
      const { id, versionId, tierId } = await params;
      await deleteCommissionTier(id, versionId, tierId);
      return new NextResponse(null, { status: 204 });
    }),
  );
}
