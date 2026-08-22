/**
 * `GET /api/admin/goals/scope-options?scopeType=...` -- liefert die
 * Picker-Optionen (`{id, name}[]`) fuer den Scope-Auswahl-Schritt der
 * Goal-Admin-UI (Phase 11 AP6, siehe PHASE_11_IMPLEMENTATION_PLAN.md
 * Abschnitt 9, ChatGPT-GO 2026-08-22 nach AP6-Discovery). Duenne
 * Transport-Schicht -- Fachlogik ausschliesslich in
 * `listGoalScopeOptions()` (`src/server/admin/goal-scope-options.ts`).
 *
 * Zugriff erfordert `config.goals.view` -- identische Berechtigungsstufe
 * wie `GET /api/admin/goals` (der Picker ist Teil desselben
 * Formular-Workflows, keine eigene, staerkere/schwaechere Berechtigung
 * noetig). Reine Anzeigefunktion -- KEINE Sicherheitsentscheidung (siehe
 * Modulkommentar `goal-scope-options.ts`): `validateScopeId()` bleibt die
 * alleinige Durchsetzung beim eigentlichen `POST /api/admin/goals`.
 */

import { NextResponse, type NextRequest } from "next/server";
import { withRequestTenantContext } from "@/server/auth/request-context";
import { withErrorMapping } from "@/server/consultation-ui/http-errors";
import { requireConfigPermission } from "@/server/authz/config-permissions";
import { listGoalScopeOptions, type GoalScopeType } from "@/server/admin/goal-scope-options";

const VALID_SCOPE_TYPES: readonly GoalScopeType[] = ["TENANT", "COMPANY", "STORE", "EMPLOYEE"];

function isGoalScopeType(value: string | null): value is GoalScopeType {
  return value != null && (VALID_SCOPE_TYPES as readonly string[]).includes(value);
}

export async function GET(request: NextRequest) {
  return withErrorMapping(() =>
    withRequestTenantContext(request, async (session) => {
      requireConfigPermission(session, "config.goals.view");
      const scopeType = request.nextUrl.searchParams.get("scopeType");
      if (!isGoalScopeType(scopeType)) {
        return NextResponse.json(
          {
            error: "InvalidRequest",
            message: `Ungueltiger oder fehlender scopeType-Query-Parameter (erlaubt: ${VALID_SCOPE_TYPES.join(", ")}).`,
          },
          { status: 400 },
        );
      }
      const options = await listGoalScopeOptions(scopeType);
      return NextResponse.json({ options }, { status: 200 });
    }),
  );
}
