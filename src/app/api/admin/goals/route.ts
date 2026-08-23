/**
 * `GET /api/admin/goals` (Liste aller `Goal`s des Tenant, je mit aktueller
 * `GoalVersion`) und `POST /api/admin/goals` (legt ein neues `Goal` + dessen
 * erste `GoalVersion` atomar an). Phase 11 AP3, siehe
 * PHASE_11_IMPLEMENTATION_PLAN.md Abschnitt 3, ChatGPT-GO 2026-08-22. Duenne
 * Transport-Schicht -- Fachlogik ausschliesslich in `listGoals()`/
 * `createGoal()` (`src/server/admin/goal-admin.ts`) und
 * `validateCreateGoalInput()` (`src/server/admin/goal-validator.ts`).
 *
 * Sicherheitsreihenfolge (ChatGPTs ausdrueckliche AP3-Vorgabe, 2026-08-22):
 * Auth -> Tenant/Ownership -> Permission -> Mutation -> Audit.
 * `withRequestTenantContext()` deckt Auth+Tenant ab (Session-Cookie ->
 * `TenantContext`), `requireConfigPermission()` die Permission-Stufe.
 * "Ownership" (gehoert eine referenzierte `scopeId`/`goalId` wirklich zum
 * aktuellen Mandanten) wird strukturell durch den tenant-gescopten `db`-
 * Client in `goal-admin.ts` erzwungen, NICHT hier -- `tenantId` und
 * `actorUserId` werden AUSSCHLIESSLICH aus dem Server-Session-Kontext
 * gelesen (`getTenantId()`/`getTenantContext().userId` in `goal-admin.ts`),
 * niemals aus dem Request-Body (ChatGPTs ausdrueckliches API-Security-Guard
 * fuer AP3: "Niemals: tenantId aus Request, createdByUserId aus Request").
 * Der Audit-Eintrag entsteht atomar innerhalb der `createGoal()`-Transaktion.
 *
 * Zugriff erfordert `config.goals.view` (GET) bzw. `config.goals.edit`
 * (POST) -- Configuration-RBAC, additiv seit Phase 11 AP1.
 */

import { NextResponse, type NextRequest } from "next/server";
import { withRequestTenantContext } from "@/server/auth/request-context";
import { withErrorMapping } from "@/server/consultation-ui/http-errors";
import { requireConfigPermission } from "@/server/authz/config-permissions";
import { createGoalSchema } from "@/server/admin/goal-schemas";
import { validateCreateGoalInput } from "@/server/admin/goal-validator";
import { listGoals, createGoal } from "@/server/admin/goal-admin";

export async function GET(request: NextRequest) {
  return withErrorMapping(() =>
    withRequestTenantContext(request, async (session) => {
      requireConfigPermission(session, "config.goals.view");
      const goals = await listGoals();
      return NextResponse.json({ goals }, { status: 200 });
    }),
  );
}

export async function POST(request: NextRequest) {
  return withErrorMapping(() =>
    withRequestTenantContext(request, async (session) => {
      requireConfigPermission(session, "config.goals.edit");
      const body = await request.json().catch(() => null);
      const parsed = createGoalSchema.safeParse(body);
      if (!parsed.success) {
        return NextResponse.json(
          { error: "InvalidRequest", message: "Ungueltige Anfrage.", issues: parsed.error.issues },
          { status: 400 },
        );
      }
      // Metrikspezifische Zielwert-/Currency-Zuordnung -- NICHT Teil von
      // createGoalSchema (nur strukturelle/metrikunabhaengige Pruefung,
      // siehe goal-schemas.ts-Modulkommentar). Wirft GoalTargetValueInvalidError
      // (422, http-errors.ts) bei Verstoss -- keine Mutation/kein Audit-Eintrag.
      validateCreateGoalInput(parsed.data);
      const goal = await createGoal(parsed.data);
      return NextResponse.json({ goal }, { status: 201 });
    }),
  );
}
