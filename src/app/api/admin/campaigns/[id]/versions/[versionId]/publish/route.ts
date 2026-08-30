/**
 * `POST /api/admin/campaigns/[id]/versions/[versionId]/publish` (Phase 13
 * AP6, siehe PHASE_13_IMPLEMENTATION_PLAN.md Abschnitt 3, ChatGPT-GO
 * 2026-08-30).
 *
 * Veroeffentlicht eine DRAFT-`CampaignVersion` (setzt sie auf ACTIVE,
 * expiret die bisherige ACTIVE-Version DERSELBEN `Campaign`) -- siehe
 * `publishCampaignVersion()`, `src/server/admin/campaign-admin.ts`, fuer die
 * vollstaendige Transaktions-/Concurrency-Logik (Campaign-Row-Lock,
 * updateMany-count-Guard, EXCLUDE-Constraint-Backstop
 * `campaign_versions_no_overlap`).
 *
 * Antworten:
 * - 200: Publish erfolgreich, `version` (ACTIVE) + `previousActiveVersionId`.
 * - 404: `Campaign`/`CampaignVersion` nicht gefunden (oder fremder
 *   Mandant, strukturell ununterscheidbar).
 * - 409: Version nicht (mehr) DRAFT ODER echter Publish-Konflikt (siehe
 *   `CampaignVersionNotDraftError`/`CampaignVersionPublishConflictError`).
 * - 422: `validateCampaignVersion()` hat fachliche Verstoesse gefunden
 *   (`issues`).
 *
 * Erfordert `config.campaigns.publish` (Configuration-RBAC, Phase 13 AP1)
 * -- bewusst eine eigene, staerkere Berechtigung als `config.campaigns.edit`
 * (Feld-CRUD), analog Phase 8-11.
 */

import { NextResponse, type NextRequest } from "next/server";
import { withRequestTenantContext } from "@/server/auth/request-context";
import { withErrorMapping } from "@/server/consultation-ui/http-errors";
import { requireConfigPermission } from "@/server/authz/config-permissions";
import { publishCampaignVersion } from "@/server/admin/campaign-admin";

interface RouteParams {
  params: Promise<{ id: string; versionId: string }>;
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  return withErrorMapping(() =>
    withRequestTenantContext(request, async (session) => {
      requireConfigPermission(session, "config.campaigns.publish");
      const { id, versionId } = await params;
      const result = await publishCampaignVersion(id, versionId);
      return NextResponse.json(result, { status: 200 });
    }),
  );
}
