/**
 * `GET`/`PATCH` `/api/admin/playbooks/[id]/versions/[versionId]` (Phase 14
 * AP3, siehe PHASE_14_IMPLEMENTATION_PLAN.md Abschnitt 3, ChatGPT-GO
 * 2026-08-31). Analog `GET`/`PATCH`
 * `/api/admin/campaigns/[id]/versions/[versionId]` (Phase 13 AP6).
 *
 * `GET`: Detailansicht einer `PlaybookVersion` inkl. Skalarfelder
 * (`scopeType`/`scopeId`/`description`) und `sections[]`.
 *
 * `PATCH`: Feld-CRUD -- partielles Update EINER bestehenden DRAFT-Version
 * (serverseitige Sperre: Versuch auf einer nicht-DRAFT-Version -> 409,
 * ungueltige `scopeId` -> 422, siehe `updatePlaybookVersionFields()`,
 * `src/server/admin/playbook-admin.ts`). `sections`, falls angegeben,
 * ERSETZT die GESAMTE bestehende Section-Liste (Delete-All-Then-Recreate,
 * identisches Muster wie `conditions` bei Campaign -- KEIN separater
 * `/sections`-Subpfad; der urspruengliche Plan-Entwurf
 * (PHASE_14_IMPLEMENTATION_PLAN.md Abschnitt 3, AP3-Aufzaehlung) nannte
 * einen solchen Subpfad, ChatGPTs tatsaechliche AP2-Abnahme 2026-08-31
 * bestaetigte aber explizit das Whole-Replace-Design von
 * `updatePlaybookVersionFields({ sections })` ohne eigene
 * Section-CRUD-Funktionen -- diese Route folgt daher der abgenommenen
 * Service-Schicht, nicht dem frueheren Plantext; siehe Statusbericht an
 * ChatGPT). Erfordert `config.playbooks.edit`.
 *
 * `GET` erfordert `config.playbooks.view` (Configuration-RBAC, Phase 14
 * AP1).
 */

import { NextResponse, type NextRequest } from "next/server";
import { withRequestTenantContext } from "@/server/auth/request-context";
import { withErrorMapping } from "@/server/consultation-ui/http-errors";
import { requireConfigPermission } from "@/server/authz/config-permissions";
import { updatePlaybookVersionFieldsSchema } from "@/server/admin/playbook-schemas";
import {
  getPlaybookVersionDetail,
  updatePlaybookVersionFields,
} from "@/server/admin/playbook-admin";

interface RouteParams {
  params: Promise<{ id: string; versionId: string }>;
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  return withErrorMapping(() =>
    withRequestTenantContext(request, async (session) => {
      requireConfigPermission(session, "config.playbooks.view");
      const { id, versionId } = await params;
      const version = await getPlaybookVersionDetail(id, versionId);
      return NextResponse.json({ version }, { status: 200 });
    }),
  );
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  return withErrorMapping(() =>
    withRequestTenantContext(request, async (session) => {
      requireConfigPermission(session, "config.playbooks.edit");
      const { id, versionId } = await params;
      const body = await request.json().catch(() => null);
      const parsed = updatePlaybookVersionFieldsSchema.safeParse(body);
      if (!parsed.success) {
        return NextResponse.json(
          { error: "InvalidRequest", message: "Ungueltige Anfrage.", issues: parsed.error.issues },
          { status: 400 },
        );
      }
      const version = await updatePlaybookVersionFields(id, versionId, parsed.data);
      return NextResponse.json({ version }, { status: 200 });
    }),
  );
}
