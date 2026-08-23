/**
 * `POST /api/admin/rule-sets/[id]/versions/[versionId]/prioritization-rules`
 * (Phase 9 AP3, siehe PHASE_9_IMPLEMENTATION_PLAN.md Abschnitt 5). Fuegt
 * eine `PrioritizationRule` inkl. Conditions zu einer DRAFT-Version hinzu.
 *
 * Erfordert `config.rules.edit` (Configuration-RBAC, Phase 9 AP1).
 */

import { NextResponse, type NextRequest } from "next/server";
import { withRequestTenantContext } from "@/server/auth/request-context";
import { withErrorMapping } from "@/server/consultation-ui/http-errors";
import { requireConfigPermission } from "@/server/authz/config-permissions";
import { createPrioritizationRuleSchema } from "@/server/admin/rule-schemas";
import { addPrioritizationRuleToDraft } from "@/server/admin/rule-admin";

interface RouteParams {
  params: Promise<{ id: string; versionId: string }>;
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  return withErrorMapping(() =>
    withRequestTenantContext(request, async (session) => {
      requireConfigPermission(session, "config.rules.edit");
      const { id, versionId } = await params;
      const body = await request.json().catch(() => null);
      const parsed = createPrioritizationRuleSchema.safeParse(body);
      if (!parsed.success) {
        return NextResponse.json(
          { error: "InvalidRequest", message: "Ungueltige Anfrage.", issues: parsed.error.issues },
          { status: 400 },
        );
      }
      const rule = await addPrioritizationRuleToDraft(id, versionId, parsed.data);
      return NextResponse.json({ rule }, { status: 201 });
    }),
  );
}
