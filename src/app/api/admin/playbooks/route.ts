/**
 * `GET /api/admin/playbooks` (Liste aller `Playbook`s des Tenant, je mit
 * vollstaendiger `PlaybookVersion`-Historie) und `POST /api/admin/playbooks`
 * (legt ein neues `Playbook` an -- ohne Version, siehe
 * `playbook-schemas.ts`-Modulkommentar). Phase 14 AP3, siehe
 * PHASE_14_IMPLEMENTATION_PLAN.md Abschnitt 3, ChatGPT-GO 2026-08-31. Duenne
 * Transport-Schicht -- Fachlogik ausschliesslich in `listPlaybooks()`/
 * `createPlaybook()` (`src/server/admin/playbook-admin.ts`).
 *
 * Sicherheitsreihenfolge (identisches Prinzip wie Phase 13 AP3):
 * Auth -> Tenant -> Permission -> Mutation -> Audit.
 * `withRequestTenantContext()` deckt Auth+Tenant ab (Session-Cookie ->
 * `TenantContext`), `requireConfigPermission()` die Permission-Stufe.
 * `tenantId` und `createdByUserId` werden AUSSCHLIESSLICH aus dem
 * Server-Session-Kontext gelesen (`getTenantId()`/
 * `getTenantContext().userId` in `playbook-admin.ts`), niemals aus dem
 * Request-Body. Der Audit-Eintrag entsteht atomar innerhalb der
 * `createPlaybook()`-Transaktion.
 *
 * Zugriff erfordert `config.playbooks.view` (GET) bzw. `config.playbooks.edit`
 * (POST) -- Configuration-RBAC, additiv seit Phase 14 AP1.
 */

import { NextResponse, type NextRequest } from "next/server";
import { withRequestTenantContext } from "@/server/auth/request-context";
import { withErrorMapping } from "@/server/consultation-ui/http-errors";
import { requireConfigPermission } from "@/server/authz/config-permissions";
import { createPlaybookSchema } from "@/server/admin/playbook-schemas";
import { listPlaybooks, createPlaybook } from "@/server/admin/playbook-admin";

export async function GET(request: NextRequest) {
  return withErrorMapping(() =>
    withRequestTenantContext(request, async (session) => {
      requireConfigPermission(session, "config.playbooks.view");
      const playbooks = await listPlaybooks();
      return NextResponse.json({ playbooks }, { status: 200 });
    }),
  );
}

export async function POST(request: NextRequest) {
  return withErrorMapping(() =>
    withRequestTenantContext(request, async (session) => {
      requireConfigPermission(session, "config.playbooks.edit");
      const body = await request.json().catch(() => null);
      const parsed = createPlaybookSchema.safeParse(body);
      if (!parsed.success) {
        return NextResponse.json(
          { error: "InvalidRequest", message: "Ungueltige Anfrage.", issues: parsed.error.issues },
          { status: 400 },
        );
      }
      const playbook = await createPlaybook(parsed.data);
      return NextResponse.json({ playbook }, { status: 201 });
    }),
  );
}
