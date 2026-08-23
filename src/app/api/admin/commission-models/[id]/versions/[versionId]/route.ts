/**
 * `GET`/`PATCH` `/api/admin/commission-models/[id]/versions/[versionId]`
 * (Phase 10 AP2/AP3, siehe PHASE_10_IMPLEMENTATION_PLAN.md Abschnitt 4/5).
 *
 * `GET`: Detailansicht einer `CommissionModelVersion` inkl. aller
 * Skalarfelder (`commissionType`/`currency`/Betraege) --
 * `CommissionTier`-Zeilen folgen erst in AP4.
 *
 * `PATCH`: Feld-CRUD -- partielles Update der Skalarfelder EINER
 * bestehenden DRAFT-Version (serverseitige Sperre: Versuch auf einer
 * nicht-DRAFT-Version -> 409, Amount/Percentage-Exklusivitaetsverstoss ->
 * 422, siehe `updateCommissionModelVersionFields()`,
 * `src/server/admin/commission-admin.ts`). Erfordert
 * `config.commissions.edit`.
 *
 * `GET` erfordert `config.commissions.view` (Configuration-RBAC, Phase 10
 * AP1).
 */

import { NextResponse, type NextRequest } from "next/server";
import { withRequestTenantContext } from "@/server/auth/request-context";
import { withErrorMapping } from "@/server/consultation-ui/http-errors";
import { requireConfigPermission } from "@/server/authz/config-permissions";
import { updateCommissionModelVersionFieldsSchema } from "@/server/admin/commission-schemas";
import {
  getCommissionModelVersionDetail,
  updateCommissionModelVersionFields,
} from "@/server/admin/commission-admin";

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

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  return withErrorMapping(() =>
    withRequestTenantContext(request, async (session) => {
      requireConfigPermission(session, "config.commissions.edit");
      const { id, versionId } = await params;
      const body = await request.json().catch(() => null);
      const parsed = updateCommissionModelVersionFieldsSchema.safeParse(body);
      if (!parsed.success) {
        return NextResponse.json(
          { error: "InvalidRequest", message: "Ungueltige Anfrage.", issues: parsed.error.issues },
          { status: 400 },
        );
      }
      const version = await updateCommissionModelVersionFields(id, versionId, parsed.data);
      return NextResponse.json({ version }, { status: 200 });
    }),
  );
}
