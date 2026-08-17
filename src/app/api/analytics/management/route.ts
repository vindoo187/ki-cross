/**
 * `GET /api/analytics/management` (Phase 7 AP3, siehe
 * PHASE_7_IMPLEMENTATION_PLAN.md Abschnitt 6). Duenne Transport-Schicht --
 * Fachlogik liegt ausschliesslich in `buildManagementAnalyticsView()`
 * (`src/server/analytics/management-view.ts`), die intern
 * `resolveAuthorizedStoreFilter()` als EINZIGE Quelle des Store-/
 * Mitarbeiter-Filters verwendet (Autorisierung-VOR-Aggregation). Diese Route
 * selbst konstruiert KEINEN eigenen Filter und trifft KEINE eigene
 * Berechtigungsentscheidung -- sie reicht `session.managementScope`
 * (serverseitig beim Login aufgeloest, siehe `management-scope.ts`)
 * unveraendert durch.
 *
 * `storeId`/`employeeId` kommen hier bewusst aus Query-Parametern (anders als
 * bei den `consultation-ui`-Routen) -- das ist der Anwendungsfall fuer den
 * IDOR-Schutz in `management-authz.ts`: ein angefragter Filter wird geprueft,
 * nie ungeprueft uebernommen.
 */

import { NextResponse, type NextRequest } from "next/server";
import { withRequestTenantContext } from "@/server/auth/request-context";
import { withErrorMapping } from "@/server/consultation-ui/http-errors";
import { managementAnalyticsQuerySchema } from "@/server/analytics/schemas";
import { buildManagementAnalyticsView } from "@/server/analytics/management-view";

export async function GET(request: NextRequest) {
  return withErrorMapping(() =>
    withRequestTenantContext(request, async (session) => {
      const rawQuery = Object.fromEntries(request.nextUrl.searchParams.entries());
      const parsed = managementAnalyticsQuerySchema.safeParse(rawQuery);
      if (!parsed.success) {
        return NextResponse.json(
          { error: "InvalidRequest", message: "Ungueltige Anfrage.", issues: parsed.error.issues },
          { status: 400 },
        );
      }

      const view = await buildManagementAnalyticsView(session.managementScope, {
        period: parsed.data.period,
        storeId: parsed.data.storeId,
        employeeId: parsed.data.employeeId,
      });

      return NextResponse.json(view, { status: 200 });
    }),
  );
}
