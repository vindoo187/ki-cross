/**
 * `GET /api/admin/playbooks/scope-options?scopeType=...` -- liefert die
 * Picker-Optionen (`{id, name}[]`) fuer den Scope-Auswahl-Schritt der
 * Playbook-Admin-UI (Phase 14 AP6, siehe
 * project_ki_cross_phase14_ap5_status.md, ChatGPT-GO 2026-08-31). Duenne
 * Transport-Schicht -- Fachlogik ausschliesslich in
 * `listPlaybookScopeOptions()` (`src/server/admin/playbook-scope-options.ts`).
 * Analog `GET /api/admin/campaigns/scope-options` (Phase 13 AP6).
 *
 * Zugriff erfordert `config.playbooks.view` -- identische Berechtigungsstufe
 * wie `GET /api/admin/playbooks` (der Picker ist Teil desselben
 * Formular-Workflows, keine eigene, staerkere/schwaechere Berechtigung
 * noetig). Reine Anzeigefunktion -- KEINE Sicherheitsentscheidung:
 * `validateScopeId()` bleibt die alleinige Durchsetzung beim eigentlichen
 * `POST`/`PATCH` gegen `/api/admin/playbooks/...`.
 */

import { NextResponse, type NextRequest } from "next/server";
import { withRequestTenantContext } from "@/server/auth/request-context";
import { withErrorMapping } from "@/server/consultation-ui/http-errors";
import { requireConfigPermission } from "@/server/authz/config-permissions";
import {
  listPlaybookScopeOptions,
  type PlaybookScopeType,
} from "@/server/admin/playbook-scope-options";

const VALID_SCOPE_TYPES: readonly PlaybookScopeType[] = ["TENANT", "STORE"];

function isPlaybookScopeType(value: string | null): value is PlaybookScopeType {
  return value != null && (VALID_SCOPE_TYPES as readonly string[]).includes(value);
}

export async function GET(request: NextRequest) {
  return withErrorMapping(() =>
    withRequestTenantContext(request, async (session) => {
      requireConfigPermission(session, "config.playbooks.view");
      const scopeType = request.nextUrl.searchParams.get("scopeType");
      if (!isPlaybookScopeType(scopeType)) {
        return NextResponse.json(
          {
            error: "InvalidRequest",
            message: `Ungueltiger oder fehlender scopeType-Query-Parameter (erlaubt: ${VALID_SCOPE_TYPES.join(", ")}).`,
          },
          { status: 400 },
        );
      }
      const options = await listPlaybookScopeOptions(scopeType);
      return NextResponse.json({ options }, { status: 200 });
    }),
  );
}
