/**
 * `GET /api/admin/campaigns/[id]/versions` (vollstaendige
 * `CampaignVersion`-Historie EINER `Campaign`, alle Status, neueste zuerst)
 * und `POST /api/admin/campaigns/[id]/versions` (legt eine neue DRAFT-
 * Version an -- `copyFromVersionId`, falls gesetzt, muss zu DERSELBEN
 * `Campaign` gehoeren, per-Entity-Publish-Scope, siehe
 * `campaign-admin.ts`-Modulkommentar). Phase 13 AP3, siehe
 * PHASE_13_IMPLEMENTATION_PLAN.md Abschnitt 3, ChatGPT-GO 2026-08-24. Duenne
 * Transport-Schicht -- Fachlogik ausschliesslich in
 * `getCampaignVersionHistory()`/`createDraftCampaignVersion()`
 * (`src/server/admin/campaign-admin.ts`).
 *
 * `id` aus einem fremden Mandanten liefert ueber den tenant-gescopten
 * `db`-Client strukturell 0 Treffer -> `CampaignNotFoundError` -> 404 (kein
 * Cross-Tenant-Leck ueber blosse `campaignId`-Kenntnis, siehe
 * `http-errors.ts`). `scopeType`/`scopeId` werden serverseitig durch
 * `validateScopeId()` (`campaign-admin.ts`) gegen den aktuellen Tenant
 * geprueft -- niemals dem Client vertrauen (ChatGPTs ausdrueckliche
 * AP3-Vorgabe 2026-08-24).
 *
 * Zugriff erfordert `config.campaigns.view` (GET) bzw.
 * `config.campaigns.edit` (POST) -- Configuration-RBAC, Phase 13 AP1.
 */

import { NextResponse, type NextRequest } from "next/server";
import { withRequestTenantContext } from "@/server/auth/request-context";
import { withErrorMapping } from "@/server/consultation-ui/http-errors";
import { requireConfigPermission } from "@/server/authz/config-permissions";
import { createDraftCampaignVersionSchema } from "@/server/admin/campaign-schemas";
import {
  getCampaignVersionHistory,
  createDraftCampaignVersion,
} from "@/server/admin/campaign-admin";

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  return withErrorMapping(() =>
    withRequestTenantContext(request, async (session) => {
      requireConfigPermission(session, "config.campaigns.view");
      const { id } = await params;
      const versions = await getCampaignVersionHistory(id);
      return NextResponse.json({ versions }, { status: 200 });
    }),
  );
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  return withErrorMapping(() =>
    withRequestTenantContext(request, async (session) => {
      requireConfigPermission(session, "config.campaigns.edit");
      const { id } = await params;
      const body = await request.json().catch(() => null);
      const parsed = createDraftCampaignVersionSchema.safeParse(body);
      if (!parsed.success) {
        return NextResponse.json(
          { error: "InvalidRequest", message: "Ungueltige Anfrage.", issues: parsed.error.issues },
          { status: 400 },
        );
      }
      const version = await createDraftCampaignVersion(id, parsed.data);
      return NextResponse.json({ version }, { status: 201 });
    }),
  );
}
