/**
 * `GET /api/admin/campaigns/scope-options?scopeType=...` -- liefert die
 * Picker-Optionen (`{id, name}[]`) fuer den Scope-Auswahl-Schritt der
 * Campaign-Admin-UI (Phase 13 AP6, siehe PHASE_13_IMPLEMENTATION_PLAN.md
 * Abschnitt 3, ChatGPT-GO 2026-08-30). Duenne Transport-Schicht --
 * Fachlogik ausschliesslich in `listCampaignScopeOptions()`
 * (`src/server/admin/campaign-scope-options.ts`). Analog
 * `GET /api/admin/goals/scope-options` (Phase 11 AP6).
 *
 * Zugriff erfordert `config.campaigns.view` -- identische Berechtigungsstufe
 * wie `GET /api/admin/campaigns` (der Picker ist Teil desselben
 * Formular-Workflows, keine eigene, staerkere/schwaechere Berechtigung
 * noetig). Reine Anzeigefunktion -- KEINE Sicherheitsentscheidung:
 * `validateScopeId()` bleibt die alleinige Durchsetzung beim eigentlichen
 * `POST`/`PATCH` gegen `/api/admin/campaigns/...`.
 */

import { NextResponse, type NextRequest } from "next/server";
import { withRequestTenantContext } from "@/server/auth/request-context";
import { withErrorMapping } from "@/server/consultation-ui/http-errors";
import { requireConfigPermission } from "@/server/authz/config-permissions";
import {
  listCampaignScopeOptions,
  type CampaignScopeType,
} from "@/server/admin/campaign-scope-options";

const VALID_SCOPE_TYPES: readonly CampaignScopeType[] = ["TENANT", "STORE"];

function isCampaignScopeType(value: string | null): value is CampaignScopeType {
  return value != null && (VALID_SCOPE_TYPES as readonly string[]).includes(value);
}

export async function GET(request: NextRequest) {
  return withErrorMapping(() =>
    withRequestTenantContext(request, async (session) => {
      requireConfigPermission(session, "config.campaigns.view");
      const scopeType = request.nextUrl.searchParams.get("scopeType");
      if (!isCampaignScopeType(scopeType)) {
        return NextResponse.json(
          {
            error: "InvalidRequest",
            message: `Ungueltiger oder fehlender scopeType-Query-Parameter (erlaubt: ${VALID_SCOPE_TYPES.join(", ")}).`,
          },
          { status: 400 },
        );
      }
      const options = await listCampaignScopeOptions(scopeType);
      return NextResponse.json({ options }, { status: 200 });
    }),
  );
}
