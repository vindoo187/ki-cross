/**
 * `POST /api/admin/campaigns/[id]/versions/[versionId]/validate` (Phase 13
 * AP6, siehe PHASE_13_IMPLEMENTATION_PLAN.md Abschnitt 3, ChatGPT-GO
 * 2026-08-30). Duenne Transport-Schicht -- fuehrt die bereits seit AP2
 * bestehende vollstaendige fachliche Validierung (`validateCampaignVersion()`,
 * `src/server/admin/campaign-admin.ts`) gegen eine Version aus und liefert
 * bei Erfolg `{ valid: true }`, bei Verstoessen eine strukturierte
 * Fehlerliste (422, siehe http-errors.ts). Analog
 * `POST .../commission-models/[id]/versions/[versionId]/validate` (Phase 10
 * AP8) bzw. `POST .../rule-sets/[id]/versions/[versionId]/validate` (Phase 9
 * AP4).
 *
 * Rein lesend -- keine Statusbeschraenkung (auch bereits veroeffentlichte
 * Versionen koennen zu Regressionszwecken erneut geprueft werden), daher
 * `config.campaigns.edit` statt `.publish` (Teil des Entwurfs-Workflows,
 * identisches Prinzip wie bei Rules/Commissions). Diese Route enthaelt KEINE
 * eigene Validierungslogik -- ruft ausschliesslich die bereits bestehende,
 * unveraenderte `validateCampaignVersion()` auf.
 */

import { NextResponse, type NextRequest } from "next/server";
import { withRequestTenantContext } from "@/server/auth/request-context";
import { withErrorMapping } from "@/server/consultation-ui/http-errors";
import { requireConfigPermission } from "@/server/authz/config-permissions";
import { validateCampaignVersion } from "@/server/admin/campaign-admin";

interface RouteParams {
  params: Promise<{ id: string; versionId: string }>;
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  return withErrorMapping(() =>
    withRequestTenantContext(request, async (session) => {
      requireConfigPermission(session, "config.campaigns.edit");
      const { id, versionId } = await params;
      const result = await validateCampaignVersion(id, versionId);
      return NextResponse.json(result, { status: 200 });
    }),
  );
}
