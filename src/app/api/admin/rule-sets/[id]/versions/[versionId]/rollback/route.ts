/**
 * `POST /api/admin/rule-sets/[id]/versions/[versionId]/rollback` (Phase 9
 * AP6, siehe PHASE_9_IMPLEMENTATION_PLAN.md Abschnitt 8). Erzeugt eine neue
 * DRAFT-Version als vollstaendige Tiefkopie einer historischen (ACTIVE/
 * EXPIRED/ARCHIVED) `RuleSetVersion` DESSELBEN `RuleSet` -- KEIN direkter
 * Statuswechsel der Quelle. Die neue DRAFT-Version durchlaeuft anschliessend
 * regulaer den bestehenden Validate-/Publish-Workflow aus AP4/AP5 (separate
 * Requests gegen `.../validate` bzw. `.../publish`) -- keine zweite
 * Publish-Implementierung. Fachlogik ausschliesslich in
 * `rollbackToRuleSetVersion()` (`src/server/admin/rule-admin.ts`), inkl. der
 * Ablehnung von Cross-RuleSet-Rollback (`RuleSetVersionNotFoundError`, weil
 * `requireRuleSetVersion()` ruleSetId-scoped ist).
 *
 * Erfordert `config.rules.edit` (Configuration-RBAC, Phase 9 AP1) --
 * Rollback ist fachlich eine Entwurfserstellung, kein Publish-Vorgang, daher
 * bewusst NICHT `config.rules.publish`.
 */

import { NextResponse, type NextRequest } from "next/server";
import { withRequestTenantContext } from "@/server/auth/request-context";
import { withErrorMapping } from "@/server/consultation-ui/http-errors";
import { requireConfigPermission } from "@/server/authz/config-permissions";
import { rollbackRuleSetVersionSchema } from "@/server/admin/rule-schemas";
import { rollbackToRuleSetVersion } from "@/server/admin/rule-admin";

interface RouteParams {
  params: Promise<{ id: string; versionId: string }>;
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  return withErrorMapping(() =>
    withRequestTenantContext(request, async (session) => {
      requireConfigPermission(session, "config.rules.edit");
      const { id, versionId } = await params;
      const body = await request.json().catch(() => ({}));
      const parsed = rollbackRuleSetVersionSchema.safeParse(body ?? {});
      if (!parsed.success) {
        return NextResponse.json(
          { error: "InvalidRequest", message: "Ungueltige Anfrage.", issues: parsed.error.issues },
          { status: 400 },
        );
      }
      const version = await rollbackToRuleSetVersion(id, versionId, parsed.data.label);
      return NextResponse.json({ version }, { status: 201 });
    }),
  );
}
