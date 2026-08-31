/**
 * `POST /api/admin/playbooks/[id]/versions/[versionId]/validate` (Phase 14
 * AP3, siehe PHASE_14_IMPLEMENTATION_PLAN.md Abschnitt 3, ChatGPT-GO
 * 2026-08-31). Duenne Transport-Schicht -- fuehrt die bereits seit AP2
 * bestehende Struktur-Validierung (`validatePlaybookVersion()`,
 * `src/server/admin/playbook-admin.ts`) gegen eine Version aus und liefert
 * bei Erfolg `{ valid: true }`, bei Verstoessen eine strukturierte
 * Fehlerliste (422, siehe http-errors.ts). Analog
 * `POST .../campaigns/[id]/versions/[versionId]/validate` (Phase 13 AP6).
 *
 * Rein lesend -- keine Statusbeschraenkung (auch bereits veroeffentlichte
 * Versionen koennen zu Regressionszwecken erneut geprueft werden), daher
 * `config.playbooks.edit` statt `.publish` (Teil des Entwurfs-Workflows,
 * identisches Prinzip wie bei Campaigns/Rules/Commissions). Diese Route
 * enthaelt KEINE eigene Validierungslogik -- ruft ausschliesslich die
 * bereits bestehende, unveraenderte `validatePlaybookVersion()` auf (bewusst
 * KEINE Content-Scanning-/Prompt-Injection-Heuristik, siehe
 * `playbook-schemas.ts`-Modulkommentar -- diese Route zieht keine
 * Retrieval- oder Prompt-Logik vor, ChatGPT-Vorgabe AP3).
 */

import { NextResponse, type NextRequest } from "next/server";
import { withRequestTenantContext } from "@/server/auth/request-context";
import { withErrorMapping } from "@/server/consultation-ui/http-errors";
import { requireConfigPermission } from "@/server/authz/config-permissions";
import { validatePlaybookVersion } from "@/server/admin/playbook-admin";

interface RouteParams {
  params: Promise<{ id: string; versionId: string }>;
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  return withErrorMapping(() =>
    withRequestTenantContext(request, async (session) => {
      requireConfigPermission(session, "config.playbooks.edit");
      const { id, versionId } = await params;
      const result = await validatePlaybookVersion(id, versionId);
      return NextResponse.json(result, { status: 200 });
    }),
  );
}
