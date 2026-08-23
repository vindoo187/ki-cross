/**
 * Analytics-Dashboard `/analytics` (Phase 6 AP8, siehe
 * PHASE_6_IMPLEMENTATION_PLAN.md Abschnitt 3.4). Server Component -- laedt
 * das bereits server-seitig komponierte `AnalyticsDashboardView`
 * (`buildAnalyticsDashboardView()`, siehe `dashboard-view.ts`) und delegiert
 * die reine Darstellung an `AnalyticsDashboardContent` (Phase 6 AP12
 * Hardening: aus dieser Datei extrahiert, damit die Darstellung isoliert
 * komponententestbar ist).
 *
 * Zugriff: wie `/consultation` nur "eingeloggt" (kein RBAC, siehe
 * bestehender, dokumentierter Stop-Punkt aus Phase 5) -- jeder
 * authentifizierte Mitarbeiter sieht das Dashboard fuer seinen Mandanten.
 * Zeigt bewusst KEINE Provisions-/Margendaten (siehe Modulkommentar in
 * `dashboard-view.ts`).
 */

import { redirect } from "next/navigation";
import {
  getOptionalServerSession,
  withServerSessionTenantContext,
} from "@/server/auth/server-context";
import {
  buildAnalyticsDashboardView,
  type AnalyticsPeriodKey,
} from "@/server/analytics/dashboard-view";
import { AnalyticsDashboardContent } from "@/components/analytics/AnalyticsDashboardContent";

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<{ period?: string; storeId?: string }>;
}

function isPeriodKey(value: string | undefined): value is AnalyticsPeriodKey {
  return value === "week" || value === "month";
}

export default async function AnalyticsDashboardPage({ searchParams }: PageProps) {
  const session = await getOptionalServerSession();
  if (!session) {
    redirect("/login");
  }

  const params = await searchParams;
  const period: AnalyticsPeriodKey = isPeriodKey(params.period) ? params.period : "week";
  const storeId = params.storeId && params.storeId.length > 0 ? params.storeId : undefined;

  const view = await withServerSessionTenantContext(() =>
    buildAnalyticsDashboardView({ period, storeId }),
  );

  return (
    <AnalyticsDashboardContent view={view} displayName={session.displayName} period={period} />
  );
}
