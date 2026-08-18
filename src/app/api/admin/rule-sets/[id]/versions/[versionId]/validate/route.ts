/**
 * `POST /api/admin/rule-sets/[id]/versions/[versionId]/validate` (Phase 9
 * AP4, siehe PHASE_9_IMPLEMENTATION_PLAN.md Abschnitt 6). Fuehrt die
 * vollstaendige fachliche Validierung (`validateDraftRuleSetVersion()`)
 * gegen eine Version aus und liefert bei Erfolg `{valid: true}`, bei
 * Verstoessen eine strukturierte Fehlerliste (422, siehe http-errors.ts).
 * Rein lesend -- keine Statusbeschraenkung (auch bereits veroeffentlichte
 * Versionen koennen zu Regressionszwecken erneut geprueft werden), daher
 * `config.rules.edit` statt `.publish` (Teil des Entwurfs-Workflows,
 * analog `validate`-Route der Fragen-Engine aus Phase 8 AP4).
 *
 * Erfordert `config.rules.edit` (Configuration-RBAC, Phase 9 AP1).
 */

import { NextResponse, type NextRequest } from "next/server";
import { withRequestTenantContext } from "@/server/auth/request-context";
import { withErrorMapping } from "@/server/consultation-ui/http-errors";
import { requireConfigPermission } from "@/server/authz/config-permissions";
import { validateDraftRuleSetVersion } from "@/server/admin/rule-admin";

interface RouteParams {
  params: Promise<{ id: string; versionId: string }>;
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  return withErrorMapping(() =>
    withRequestTenantContext(request, async (session) => {
      requireConfigPermission(session, "config.rules.edit");
      const { id, versionId } = await params;
      const result = await validateDraftRuleSetVersion(id, versionId);
      return NextResponse.json(result, { status: 200 });
    }),
  );
}
