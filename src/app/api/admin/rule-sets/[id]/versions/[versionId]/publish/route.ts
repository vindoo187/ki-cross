/**
 * `POST /api/admin/rule-sets/[id]/versions/[versionId]/publish` (Phase 9
 * AP5, siehe PHASE_9_IMPLEMENTATION_PLAN.md Abschnitt 7). Validiert erneut
 * serverseitig (niemals nur auf Client-Validierung vertrauen) und fuehrt
 * bei Erfolg die atomare Publish-Transaktion aus `publishRuleSetVersion()`
 * aus -- bisherige mandantenweite ACTIVE-Version (aus einem BELIEBIGEN
 * RuleSet) wird EXPIRED, der Ziel-Draft wird ACTIVE, Audit -- alles in
 * einer DB-Transaktion (siehe Modulkommentar in rule-admin.ts).
 *
 * Erfordert `config.rules.publish` -- bewusst GETRENNT von `.edit` (analog
 * Phase 8 AP4): ein `config_editor` kann Entwuerfe bauen, aber nicht live
 * schalten.
 */

import { NextResponse, type NextRequest } from "next/server";
import { withRequestTenantContext } from "@/server/auth/request-context";
import { withErrorMapping } from "@/server/consultation-ui/http-errors";
import { requireConfigPermission } from "@/server/authz/config-permissions";
import { publishRuleSetVersion } from "@/server/admin/rule-admin";

interface RouteParams {
  params: Promise<{ id: string; versionId: string }>;
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  return withErrorMapping(() =>
    withRequestTenantContext(request, async (session) => {
      requireConfigPermission(session, "config.rules.publish");
      const { id, versionId } = await params;
      const result = await publishRuleSetVersion(id, versionId);
      return NextResponse.json(result, { status: 200 });
    }),
  );
}
