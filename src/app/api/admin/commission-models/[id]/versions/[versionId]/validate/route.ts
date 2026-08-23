/**
 * `POST /api/admin/commission-models/[id]/versions/[versionId]/validate`
 * (Phase 10 AP8, siehe PHASE_10_IMPLEMENTATION_PLAN.md Abschnitt 9,
 * ChatGPT-GO 2026-08-22). Duenne Transport-Schicht -- fuehrt die bereits
 * seit AP4 bestehende vollstaendige fachliche Validierung
 * (`validateCommissionModelVersion()`, `commission-validator.ts`) gegen
 * eine Version aus und liefert bei Erfolg `{ valid: true }`, bei
 * Verstoessen eine strukturierte Fehlerliste (422, siehe http-errors.ts).
 * Analog `POST .../rule-sets/[id]/versions/[versionId]/validate` (Phase 9
 * AP4) bzw. der Questionnaire-Validate-Route (Phase 8 AP4).
 *
 * Rein lesend -- keine Statusbeschraenkung (auch bereits veroeffentlichte
 * Versionen koennen zu Regressionszwecken erneut geprueft werden), daher
 * `config.commissions.edit` statt `.publish` (Teil des Entwurfs-Workflows,
 * identisches Prinzip wie bei Rules/Questions). Diese Route enthaelt KEINE
 * eigene Validierungslogik -- ruft ausschliesslich die bereits seit AP4
 * bestehende, unveraenderte `validateCommissionModelVersion()` auf.
 */

import { NextResponse, type NextRequest } from "next/server";
import { withRequestTenantContext } from "@/server/auth/request-context";
import { withErrorMapping } from "@/server/consultation-ui/http-errors";
import { requireConfigPermission } from "@/server/authz/config-permissions";
import { validateCommissionModelVersion } from "@/server/admin/commission-validator";

interface RouteParams {
  params: Promise<{ id: string; versionId: string }>;
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  return withErrorMapping(() =>
    withRequestTenantContext(request, async (session) => {
      requireConfigPermission(session, "config.commissions.edit");
      const { id, versionId } = await params;
      const result = await validateCommissionModelVersion(id, versionId);
      return NextResponse.json(result, { status: 200 });
    }),
  );
}
