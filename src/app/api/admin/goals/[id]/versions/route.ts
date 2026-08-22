/**
 * `GET /api/admin/goals/[id]/versions` (vollstaendige `GoalVersion`-Historie
 * eines `Goal`, neueste zuerst) und `POST /api/admin/goals/[id]/versions`
 * (haengt eine neue `GoalVersion` -- Zielwert-Korrektur -- an, concurrency-
 * sicher per Row-Lock). Phase 11 AP3, siehe
 * PHASE_11_IMPLEMENTATION_PLAN.md Abschnitt 3, ChatGPT-GO 2026-08-22.
 * Duenne Transport-Schicht -- Fachlogik ausschliesslich in
 * `listGoalVersions()`/`getGoalDetail()`/`createGoalVersion()`
 * (`goal-admin.ts`) und `validateCreateGoalVersionInput()`
 * (`goal-validator.ts`).
 *
 * `CreateGoalVersionInput` traegt (anders als `CreateGoalInput`) KEIN
 * `metricKey` -- das gehoert zur unveraenderlichen `Goal`-Identitaet (siehe
 * `goal-schemas.ts`-Modulkommentar). Diese Route laedt daher zuerst das
 * `Goal` (`getGoalDetail()`, liefert zugleich die 404-Pruefung ueber den
 * tenant-gescopten `db`-Client), entnimmt dessen `metricKey` und validiert
 * die Versions-Eingabe DAGEGEN -- exakt das in `goal-validator.ts`
 * dokumentierte Muster ("Der Aufrufer muss `metricKey` selbst aus dem
 * uebergeordneten `Goal` ermitteln").
 *
 * Zugriff erfordert `config.goals.view` (GET) bzw. `config.goals.edit`
 * (POST).
 */

import { NextResponse, type NextRequest } from "next/server";
import { withRequestTenantContext } from "@/server/auth/request-context";
import { withErrorMapping } from "@/server/consultation-ui/http-errors";
import { requireConfigPermission } from "@/server/authz/config-permissions";
import { createGoalVersionSchema } from "@/server/admin/goal-schemas";
import { validateCreateGoalVersionInput } from "@/server/admin/goal-validator";
import { listGoalVersions, getGoalDetail, createGoalVersion } from "@/server/admin/goal-admin";

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  return withErrorMapping(() =>
    withRequestTenantContext(request, async (session) => {
      requireConfigPermission(session, "config.goals.view");
      const { id } = await params;
      const versions = await listGoalVersions(id);
      return NextResponse.json({ versions }, { status: 200 });
    }),
  );
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  return withErrorMapping(() =>
    withRequestTenantContext(request, async (session) => {
      requireConfigPermission(session, "config.goals.edit");
      const { id } = await params;
      const body = await request.json().catch(() => null);
      const parsed = createGoalVersionSchema.safeParse(body);
      if (!parsed.success) {
        return NextResponse.json(
          { error: "InvalidRequest", message: "Ungueltige Anfrage.", issues: parsed.error.issues },
          { status: 400 },
        );
      }
      // metricKey gehoert zur Goal-Identitaet, nicht zur GoalVersion-Eingabe
      // (siehe Modulkommentar) -- wirft GoalNotFoundError (404), falls `id`
      // nicht (mehr) zum aktuellen Mandanten gehoert.
      const goal = await getGoalDetail(id);
      validateCreateGoalVersionInput(goal.metricKey, parsed.data);
      const version = await createGoalVersion(id, parsed.data);
      return NextResponse.json({ version }, { status: 201 });
    }),
  );
}
