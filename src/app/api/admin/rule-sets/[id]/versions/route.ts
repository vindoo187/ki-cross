/**
 * `POST /api/admin/rule-sets/[id]/versions` (Phase 9 AP2, siehe
 * PHASE_9_IMPLEMENTATION_PLAN.md Abschnitt 4). Legt eine neue DRAFT-Version
 * an -- leer oder als tiefe Kopie einer bestehenden Version
 * (`copyFromVersionId`, darf zu einem ANDEREN `RuleSet` desselben Mandanten
 * gehoeren -- siehe `src/server/admin/rule-admin.ts` Modulkommentar).
 * Fachlogik ausschliesslich in `createDraftRuleSetVersion()`.
 *
 * `GET /api/admin/rule-sets/[id]/versions` (Phase 9 AP6, siehe
 * PHASE_9_IMPLEMENTATION_PLAN.md Abschnitt 8). Vollstaendige Versionshistorie
 * eines `RuleSet` (alle Status, neueste zuerst) -- Grundlage fuer die
 * Versionshistorie-Ansicht mit Rollback-Aktion (AP8).
 *
 * Erfordert `config.rules.view` (GET) bzw. `config.rules.edit` (POST) --
 * Configuration-RBAC, Phase 9 AP1.
 */

import { NextResponse, type NextRequest } from "next/server";
import { withRequestTenantContext } from "@/server/auth/request-context";
import { withErrorMapping } from "@/server/consultation-ui/http-errors";
import { requireConfigPermission } from "@/server/authz/config-permissions";
import { createDraftRuleSetVersionSchema } from "@/server/admin/rule-schemas";
import { createDraftRuleSetVersion, getRuleSetVersionHistory } from "@/server/admin/rule-admin";

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  return withErrorMapping(() =>
    withRequestTenantContext(request, async (session) => {
      requireConfigPermission(session, "config.rules.view");
      const { id } = await params;
      const versions = await getRuleSetVersionHistory(id);
      return NextResponse.json({ versions }, { status: 200 });
    }),
  );
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  return withErrorMapping(() =>
    withRequestTenantContext(request, async (session) => {
      requireConfigPermission(session, "config.rules.edit");
      const { id } = await params;
      const body = await request.json().catch(() => null);
      const parsed = createDraftRuleSetVersionSchema.safeParse(body);
      if (!parsed.success) {
        return NextResponse.json(
          { error: "InvalidRequest", message: "Ungueltige Anfrage.", issues: parsed.error.issues },
          { status: 400 },
        );
      }
      const version = await createDraftRuleSetVersion(id, parsed.data);
      return NextResponse.json({ version }, { status: 201 });
    }),
  );
}
