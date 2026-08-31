/**
 * `GET /api/admin/playbooks/[id]/versions` (vollstaendige
 * `PlaybookVersion`-Historie EINES `Playbook`, alle Status, neueste zuerst)
 * und `POST /api/admin/playbooks/[id]/versions` (legt eine neue DRAFT-
 * Version an -- `copyFromVersionId`, falls gesetzt, muss zu DEMSELBEN
 * `Playbook` gehoeren, per-Entity-Publish-Scope, siehe
 * `playbook-admin.ts`-Modulkommentar). Phase 14 AP3, siehe
 * PHASE_14_IMPLEMENTATION_PLAN.md Abschnitt 3, ChatGPT-GO 2026-08-31. Duenne
 * Transport-Schicht -- Fachlogik ausschliesslich in
 * `getPlaybookVersionHistory()`/`createDraftPlaybookVersion()`
 * (`src/server/admin/playbook-admin.ts`).
 *
 * `id` aus einem fremden Mandanten liefert ueber den tenant-gescopten
 * `db`-Client strukturell 0 Treffer -> `PlaybookNotFoundError` -> 404 (kein
 * Cross-Tenant-Leck ueber blosse `playbookId`-Kenntnis, siehe
 * `http-errors.ts`). `scopeType`/`scopeId` werden serverseitig durch
 * `validateScopeId()` (`playbook-admin.ts`) gegen den aktuellen Tenant
 * geprueft -- niemals dem Client vertrauen (ChatGPTs ausdrueckliche
 * AP3-Vorgabe, analog Phase 13 AP3).
 *
 * Zugriff erfordert `config.playbooks.view` (GET) bzw.
 * `config.playbooks.edit` (POST) -- Configuration-RBAC, Phase 14 AP1.
 */

import { NextResponse, type NextRequest } from "next/server";
import { withRequestTenantContext } from "@/server/auth/request-context";
import { withErrorMapping } from "@/server/consultation-ui/http-errors";
import { requireConfigPermission } from "@/server/authz/config-permissions";
import { createDraftPlaybookVersionSchema } from "@/server/admin/playbook-schemas";
import {
  getPlaybookVersionHistory,
  createDraftPlaybookVersion,
} from "@/server/admin/playbook-admin";

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  return withErrorMapping(() =>
    withRequestTenantContext(request, async (session) => {
      requireConfigPermission(session, "config.playbooks.view");
      const { id } = await params;
      const versions = await getPlaybookVersionHistory(id);
      return NextResponse.json({ versions }, { status: 200 });
    }),
  );
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  return withErrorMapping(() =>
    withRequestTenantContext(request, async (session) => {
      requireConfigPermission(session, "config.playbooks.edit");
      const { id } = await params;
      const body = await request.json().catch(() => null);
      const parsed = createDraftPlaybookVersionSchema.safeParse(body);
      if (!parsed.success) {
        return NextResponse.json(
          { error: "InvalidRequest", message: "Ungueltige Anfrage.", issues: parsed.error.issues },
          { status: 400 },
        );
      }
      const version = await createDraftPlaybookVersion(id, parsed.data);
      return NextResponse.json({ version }, { status: 201 });
    }),
  );
}
