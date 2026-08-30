/**
 * `GET`/`PATCH` `/api/admin/campaigns/[id]/versions/[versionId]` (Phase 13
 * AP6, siehe PHASE_13_IMPLEMENTATION_PLAN.md Abschnitt 3, ChatGPT-GO
 * 2026-08-30). Analog `GET`/`PATCH`
 * `/api/admin/commission-models/[id]/versions/[versionId]` (Phase 10 AP3).
 *
 * `GET`: Detailansicht einer `CampaignVersion` inkl. Skalarfelder
 * (`scopeType`/`scopeId`/`description`) und `conditions[]`.
 *
 * `PATCH`: Feld-CRUD -- partielles Update EINER bestehenden DRAFT-Version
 * (serverseitige Sperre: Versuch auf einer nicht-DRAFT-Version -> 409,
 * ungueltige `scopeId` -> 422, siehe `updateCampaignVersionFields()`,
 * `src/server/admin/campaign-admin.ts`). `conditions`, falls angegeben,
 * ERSETZT die GESAMTE bestehende Bedingungsliste. Erfordert
 * `config.campaigns.edit`.
 *
 * `GET` erfordert `config.campaigns.view` (Configuration-RBAC, Phase 13
 * AP1).
 */

import { NextResponse, type NextRequest } from "next/server";
import { withRequestTenantContext } from "@/server/auth/request-context";
import { withErrorMapping } from "@/server/consultation-ui/http-errors";
import { requireConfigPermission } from "@/server/authz/config-permissions";
import { updateCampaignVersionFieldsSchema } from "@/server/admin/campaign-schemas";
import {
  getCampaignVersionDetail,
  updateCampaignVersionFields,
} from "@/server/admin/campaign-admin";

interface RouteParams {
  params: Promise<{ id: string; versionId: string }>;
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  return withErrorMapping(() =>
    withRequestTenantContext(request, async (session) => {
      requireConfigPermission(session, "config.campaigns.view");
      const { id, versionId } = await params;
      const version = await getCampaignVersionDetail(id, versionId);
      return NextResponse.json({ version }, { status: 200 });
    }),
  );
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  return withErrorMapping(() =>
    withRequestTenantContext(request, async (session) => {
      requireConfigPermission(session, "config.campaigns.edit");
      const { id, versionId } = await params;
      const body = await request.json().catch(() => null);
      const parsed = updateCampaignVersionFieldsSchema.safeParse(body);
      if (!parsed.success) {
        return NextResponse.json(
          { error: "InvalidRequest", message: "Ungueltige Anfrage.", issues: parsed.error.issues },
          { status: 400 },
        );
      }
      const version = await updateCampaignVersionFields(id, versionId, parsed.data);
      return NextResponse.json({ version }, { status: 200 });
    }),
  );
}
