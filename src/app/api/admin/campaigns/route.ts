/**
 * `GET /api/admin/campaigns` (Liste aller `Campaign`s des Tenant, je mit
 * vollstaendiger `CampaignVersion`-Historie) und `POST /api/admin/campaigns`
 * (legt eine neue `Campaign` an -- ohne Version, siehe
 * `campaign-schemas.ts`-Modulkommentar). Phase 13 AP3, siehe
 * PHASE_13_IMPLEMENTATION_PLAN.md Abschnitt 3, ChatGPT-GO 2026-08-24. Duenne
 * Transport-Schicht -- Fachlogik ausschliesslich in `listCampaigns()`/
 * `createCampaign()` (`src/server/admin/campaign-admin.ts`).
 *
 * Sicherheitsreihenfolge (identisches Prinzip wie Phase 11 AP3, ChatGPTs
 * ausdrueckliche AP3-Vorgabe 2026-08-24): Auth -> Tenant -> Permission ->
 * Mutation -> Audit. `withRequestTenantContext()` deckt Auth+Tenant ab
 * (Session-Cookie -> `TenantContext`), `requireConfigPermission()` die
 * Permission-Stufe. `tenantId` und `createdByUserId` werden AUSSCHLIESSLICH
 * aus dem Server-Session-Kontext gelesen (`getTenantId()`/
 * `getTenantContext().userId` in `campaign-admin.ts`), niemals aus dem
 * Request-Body. Der Audit-Eintrag entsteht atomar innerhalb der
 * `createCampaign()`-Transaktion.
 *
 * Zugriff erfordert `config.campaigns.view` (GET) bzw. `config.campaigns.edit`
 * (POST) -- Configuration-RBAC, additiv seit Phase 13 AP1.
 */

import { NextResponse, type NextRequest } from "next/server";
import { withRequestTenantContext } from "@/server/auth/request-context";
import { withErrorMapping } from "@/server/consultation-ui/http-errors";
import { requireConfigPermission } from "@/server/authz/config-permissions";
import { createCampaignSchema } from "@/server/admin/campaign-schemas";
import { listCampaigns, createCampaign } from "@/server/admin/campaign-admin";

export async function GET(request: NextRequest) {
  return withErrorMapping(() =>
    withRequestTenantContext(request, async (session) => {
      requireConfigPermission(session, "config.campaigns.view");
      const campaigns = await listCampaigns();
      return NextResponse.json({ campaigns }, { status: 200 });
    }),
  );
}

export async function POST(request: NextRequest) {
  return withErrorMapping(() =>
    withRequestTenantContext(request, async (session) => {
      requireConfigPermission(session, "config.campaigns.edit");
      const body = await request.json().catch(() => null);
      const parsed = createCampaignSchema.safeParse(body);
      if (!parsed.success) {
        return NextResponse.json(
          { error: "InvalidRequest", message: "Ungueltige Anfrage.", issues: parsed.error.issues },
          { status: 400 },
        );
      }
      const campaign = await createCampaign(parsed.data);
      return NextResponse.json({ campaign }, { status: 201 });
    }),
  );
}
