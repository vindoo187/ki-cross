/**
 * `PATCH`/`DELETE`
 * `/api/admin/rule-sets/[id]/versions/[versionId]/exclusion-rules/[ruleId]`
 * (Phase 9 AP3, siehe PHASE_9_IMPLEMENTATION_PLAN.md Abschnitt 5). Bearbeitet
 * bzw. entfernt eine `ExclusionRule` in einer DRAFT-Version.
 *
 * Erfordert `config.rules.edit` (Configuration-RBAC, Phase 9 AP1).
 */

import { NextResponse, type NextRequest } from "next/server";
import { withRequestTenantContext } from "@/server/auth/request-context";
import { withErrorMapping } from "@/server/consultation-ui/http-errors";
import { requireConfigPermission } from "@/server/authz/config-permissions";
import { updateExclusionRuleSchema } from "@/server/admin/rule-schemas";
import {
  removeExclusionRuleFromDraft,
  updateExclusionRuleInDraft,
} from "@/server/admin/rule-admin";

interface RouteParams {
  params: Promise<{ id: string; versionId: string; ruleId: string }>;
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  return withErrorMapping(() =>
    withRequestTenantContext(request, async (session) => {
      requireConfigPermission(session, "config.rules.edit");
      const { id, versionId, ruleId } = await params;
      const body = await request.json().catch(() => null);
      const parsed = updateExclusionRuleSchema.safeParse(body);
      if (!parsed.success) {
        return NextResponse.json(
          { error: "InvalidRequest", message: "Ungueltige Anfrage.", issues: parsed.error.issues },
          { status: 400 },
        );
      }
      const rule = await updateExclusionRuleInDraft(id, versionId, ruleId, parsed.data);
      return NextResponse.json({ rule }, { status: 200 });
    }),
  );
}

export async function DELETE(request: NextRequest, { params }: RouteParams) {
  return withErrorMapping(() =>
    withRequestTenantContext(request, async (session) => {
      requireConfigPermission(session, "config.rules.edit");
      const { id, versionId, ruleId } = await params;
      await removeExclusionRuleFromDraft(id, versionId, ruleId);
      return new NextResponse(null, { status: 204 });
    }),
  );
}
