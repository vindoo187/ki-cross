/**
 * `POST /api/admin/commission-models/[id]/versions` (Phase 10 AP2, siehe
 * PHASE_10_IMPLEMENTATION_PLAN.md Abschnitt 4). Legt eine neue DRAFT-Version
 * an -- `copyFromVersionId` (falls gesetzt) muss zu DEMSELBEN
 * `CommissionModel` gehoeren (per-Entity-Publish-Scope, siehe
 * `src/server/admin/commission-admin.ts` Modulkommentar -- anders als bei
 * Phase 9s `RuleSetVersion`). Fachlogik ausschliesslich in
 * `createDraftCommissionModelVersion()`.
 *
 * `GET /api/admin/commission-models/[id]/versions`. Vollstaendige
 * Versionshistorie eines `CommissionModel` (alle Status, neueste zuerst).
 *
 * Erfordert `config.commissions.view` (GET) bzw. `config.commissions.edit`
 * (POST) -- Configuration-RBAC, Phase 10 AP1.
 */

import { NextResponse, type NextRequest } from "next/server";
import { withRequestTenantContext } from "@/server/auth/request-context";
import { withErrorMapping } from "@/server/consultation-ui/http-errors";
import { requireConfigPermission } from "@/server/authz/config-permissions";
import { createDraftCommissionModelVersionSchema } from "@/server/admin/commission-schemas";
import {
  createDraftCommissionModelVersion,
  getCommissionModelVersionHistory,
} from "@/server/admin/commission-admin";

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  return withErrorMapping(() =>
    withRequestTenantContext(request, async (session) => {
      requireConfigPermission(session, "config.commissions.view");
      const { id } = await params;
      const versions = await getCommissionModelVersionHistory(id);
      return NextResponse.json({ versions }, { status: 200 });
    }),
  );
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  return withErrorMapping(() =>
    withRequestTenantContext(request, async (session) => {
      requireConfigPermission(session, "config.commissions.edit");
      const { id } = await params;
      const body = await request.json().catch(() => null);
      const parsed = createDraftCommissionModelVersionSchema.safeParse(body);
      if (!parsed.success) {
        return NextResponse.json(
          { error: "InvalidRequest", message: "Ungueltige Anfrage.", issues: parsed.error.issues },
          { status: 400 },
        );
      }
      const version = await createDraftCommissionModelVersion(id, parsed.data);
      return NextResponse.json({ version }, { status: 201 });
    }),
  );
}
