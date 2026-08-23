/**
 * Management-Analytics `/analytics/management` (Phase 7 AP4, siehe
 * PHASE_7_IMPLEMENTATION_PLAN.md Abschnitt 7). Server Component -- laedt das
 * bereits server-seitig komponierte `ManagementAnalyticsView`
 * (`buildManagementAnalyticsView()`, siehe `management-view.ts`) und delegiert
 * die reine Darstellung an `ManagementAnalyticsContent` (analog
 * `/analytics/page.tsx`).
 *
 * Autorisierung: ausschliesslich serverseitig ueber `session.managementScope`
 * (bereits beim Login aus `RoleAssignment`s aufgeloest, siehe
 * `management-scope.ts`) -> `buildManagementAnalyticsView()` ->
 * `resolveAuthorizedStoreFilter()`. Diese Seite selbst trifft KEINE eigene
 * Berechtigungsentscheidung -- bei `managementScope === null` wirft
 * `buildManagementAnalyticsView()` `ManagementAccessDeniedError`, was hier zu
 * einer generischen "Kein Zugriff"-Anzeige fuehrt (bewusst ohne jeden
 * Struktur- oder Datenhinweis, siehe Plan Abschnitt 7).
 */

import { redirect } from "next/navigation";
import {
  getOptionalServerSession,
  withServerSessionTenantContext,
} from "@/server/auth/server-context";
import {
  buildManagementAnalyticsView,
  type ManagementAnalyticsFilter,
} from "@/server/analytics/management-view";
import { ManagementAccessDeniedError } from "@/server/analytics/management-authz";
import { ManagementAnalyticsContent } from "@/components/analytics/ManagementAnalyticsContent";

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<{ period?: string; storeId?: string; employeeId?: string }>;
}

function isPeriodKey(value: string | undefined): value is ManagementAnalyticsFilter["period"] {
  return value === "week" || value === "month";
}

export default async function ManagementAnalyticsPage({ searchParams }: PageProps) {
  const session = await getOptionalServerSession();
  if (!session) {
    redirect("/login");
  }

  const params = await searchParams;
  const period: ManagementAnalyticsFilter["period"] = isPeriodKey(params.period)
    ? params.period
    : "week";
  const storeId = params.storeId && params.storeId.length > 0 ? params.storeId : undefined;
  const employeeId =
    params.employeeId && params.employeeId.length > 0 ? params.employeeId : undefined;

  try {
    const view = await withServerSessionTenantContext((s) =>
      buildManagementAnalyticsView(s.managementScope, { period, storeId, employeeId }),
    );

    return (
      <ManagementAnalyticsContent view={view} displayName={session.displayName} period={period} />
    );
  } catch (error) {
    if (error instanceof ManagementAccessDeniedError) {
      // Bewusst generisch -- kein Hinweis darauf, ob z. B. ein angefragter
      // storeId/employeeId existiert oder ausserhalb des Scopes liegt.
      return (
        <main className="analytics-dashboard management-dashboard management-dashboard--denied">
          <h1>Kein Zugriff</h1>
          <p>Fuer dieses Konto ist keine Management-Analytics-Ansicht freigeschaltet.</p>
        </main>
      );
    }
    throw error;
  }
}
