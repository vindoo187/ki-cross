/**
 * `POST` `/api/admin/commission-models/[id]/versions/[versionId]/publish`
 * (Phase 10 AP5, siehe PHASE_10_IMPLEMENTATION_PLAN.md Abschnitt 7,
 * ChatGPT-GO 2026-08-21).
 *
 * Veroeffentlicht eine DRAFT-`CommissionModelVersion` (setzt sie auf ACTIVE,
 * expiret die bisherige ACTIVE-Version DESSELBEN `CommissionModel`) --
 * siehe `publishCommissionModelVersion()`,
 * `src/server/admin/commission-admin.ts`, fuer die vollstaendige
 * Transaktions-/Concurrency-Logik (CommissionModel-Row-Lock,
 * updateMany-count-Guard, EXCLUDE-Constraint-Backstop).
 *
 * Antworten:
 * - 200: Publish erfolgreich, `version` (ACTIVE) + `previousActiveVersionId`.
 * - 404: `CommissionModel`/`CommissionModelVersion` nicht gefunden (oder
 *   fremder Mandant, strukturell ununterscheidbar).
 * - 409: Version nicht (mehr) DRAFT ODER echter Publish-Konflikt (siehe
 *   `CommissionModelVersionNotDraftError`/
 *   `CommissionModelVersionPublishConflictError`).
 * - 422: `validateCommissionModelVersion()` hat fachliche Verstoesse
 *   gefunden (`issues`).
 *
 * Erfordert `config.commissions.publish` (Configuration-RBAC, Phase 10
 * AP1) -- bewusst eine eigene, staerkere Berechtigung als
 * `config.commissions.edit` (Feld-CRUD), analog Phase 8/9.
 */

import { NextResponse, type NextRequest } from "next/server";
import { withRequestTenantContext } from "@/server/auth/request-context";
import { withErrorMapping } from "@/server/consultation-ui/http-errors";
import { requireConfigPermission } from "@/server/authz/config-permissions";
import { publishCommissionModelVersion } from "@/server/admin/commission-admin";

interface RouteParams {
  params: Promise<{ id: string; versionId: string }>;
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  return withErrorMapping(() =>
    withRequestTenantContext(request, async (session) => {
      requireConfigPermission(session, "config.commissions.publish");
      const { id, versionId } = await params;
      const result = await publishCommissionModelVersion(id, versionId);
      return NextResponse.json(result, { status: 200 });
    }),
  );
}
