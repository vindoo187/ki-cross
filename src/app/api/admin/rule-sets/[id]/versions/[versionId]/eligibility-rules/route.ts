/**
 * `POST /api/admin/rule-sets/[id]/versions/[versionId]/eligibility-rules`
 * (Phase 9 AP3, siehe PHASE_9_IMPLEMENTATION_PLAN.md Abschnitt 5). Fuegt
 * eine `EligibilityRule` inkl. Conditions zu einer DRAFT-Version hinzu.
 * Serverseitige Sperre: Versuch auf einer nicht-DRAFT-Version -> 409
 * (`addEligibilityRuleToDraft()`, `src/server/admin/rule-admin.ts`).
 *
 * Erfordert `config.rules.edit` (Configuration-RBAC, Phase 9 AP1).
 */

import { NextResponse, type NextRequest } from "next/server";
import { withRequestTenantContext } from "@/server/auth/request-context";
import { withErrorMapping } from "@/server/consultation-ui/http-errors";
import { requireConfigPermission } from "@/server/authz/config-permissions";
import { createEligibilityRuleSchema } from "@/server/admin/rule-schemas";
import { addEligibilityRuleToDraft } from "@/server/admin/rule-admin";

interface RouteParams {
  params: Promise<{ id: string; versionId: string }>;
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  return withErrorMapping(() =>
    withRequestTenantContext(request, async (session) => {
      requireConfigPermission(session, "config.rules.edit");
      const { id, versionId } = await params;
      const body = await request.json().catch(() => null);
      const parsed = createEligibilityRuleSchema.safeParse(body);
      if (!parsed.success) {
        return NextResponse.json(
          { error: "InvalidRequest", message: "Ungueltige Anfrage.", issues: parsed.error.issues },
          { status: 400 },
        );
      }
      const rule = await addEligibilityRuleToDraft(id, versionId, parsed.data);
      return NextResponse.json({ rule }, { status: 201 });
    }),
  );
}
