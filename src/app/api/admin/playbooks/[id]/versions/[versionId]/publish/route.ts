/**
 * `POST /api/admin/playbooks/[id]/versions/[versionId]/publish` (Phase 14
 * AP3, siehe PHASE_14_IMPLEMENTATION_PLAN.md Abschnitt 3, ChatGPT-GO
 * 2026-08-31).
 *
 * Veroeffentlicht eine DRAFT-`PlaybookVersion` (setzt sie auf ACTIVE,
 * expiret die bisherige ACTIVE-Version DESSELBEN `Playbook`) -- siehe
 * `publishPlaybookVersion()`, `src/server/admin/playbook-admin.ts`, fuer die
 * vollstaendige Transaktions-/Concurrency-Logik (Playbook-Row-Lock,
 * updateMany-count-Guard, EXCLUDE-Constraint-Backstop
 * `playbook_versions_no_overlap`, `now` erst nach Lock-Erwerb bestimmt --
 * Phase-13-AP10-Lektion).
 *
 * Antworten:
 * - 200: Publish erfolgreich, `version` (ACTIVE) + `previousActiveVersionId`.
 * - 404: `Playbook`/`PlaybookVersion` nicht gefunden (oder fremder
 *   Mandant, strukturell ununterscheidbar).
 * - 409: Version nicht (mehr) DRAFT ODER echter Publish-Konflikt (siehe
 *   `PlaybookVersionNotDraftError`/`PlaybookVersionPublishConflictError`).
 * - 422: `validatePlaybookVersion()` hat fachliche Verstoesse gefunden
 *   (`issues`).
 *
 * Erfordert `config.playbooks.publish` (Configuration-RBAC, Phase 14 AP1)
 * -- bewusst eine eigene, staerkere Berechtigung als `config.playbooks.edit`
 * (Feld-CRUD), analog Phase 8-13.
 */

import { NextResponse, type NextRequest } from "next/server";
import { withRequestTenantContext } from "@/server/auth/request-context";
import { withErrorMapping } from "@/server/consultation-ui/http-errors";
import { requireConfigPermission } from "@/server/authz/config-permissions";
import { publishPlaybookVersion } from "@/server/admin/playbook-admin";

interface RouteParams {
  params: Promise<{ id: string; versionId: string }>;
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  return withErrorMapping(() =>
    withRequestTenantContext(request, async (session) => {
      requireConfigPermission(session, "config.playbooks.publish");
      const { id, versionId } = await params;
      const result = await publishPlaybookVersion(id, versionId);
      return NextResponse.json(result, { status: 200 });
    }),
  );
}
