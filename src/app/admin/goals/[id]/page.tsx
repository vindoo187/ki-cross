/**
 * `/admin/goals/[id]` (Phase 11 AP6, siehe PHASE_11_IMPLEMENTATION_PLAN.md
 * Abschnitt 9, ChatGPT-GO 2026-08-22 nach AP6-Discovery). Detailansicht
 * eines `Goal`: Identitaet (Scope/Metrik/Periode, unveraenderlich) + volle
 * `GoalVersion`-Historie (neueste zuerst) + "Neue Zielkorrektur
 * erfassen"-Formular.
 *
 * ANDERS ALS `/admin/commissions/[id]/versions/[versionId]`/
 * `/admin/rules/[id]/versions/[versionId]` (Phase 9/10 AP8): KEIN
 * Status-Badge, KEIN Rollback-Button, KEIN separater DRAFT-Editor -- Goals
 * haben kein `status`-Feld und kein Draft/Publish-Konzept (siehe
 * `goal-admin.ts`-Modulkommentar, ChatGPTs ausdrueckliche AP6-Bestaetigung).
 * Jede `GoalVersion` ist ab ihrer Erstellung sofort wirksam; die "aktuelle"
 * ist immer die mit der hoechsten `versionNumber`.
 *
 * Server Component -- laedt Session + Daten serverseitig. Autorisierung
 * ausschliesslich ueber `requireConfigPermission(session, "config.goals.view")`.
 */

import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import {
  getOptionalServerSession,
  withServerSessionTenantContext,
} from "@/server/auth/server-context";
import {
  requireConfigPermission,
  ConfigAccessDeniedError,
} from "@/server/authz/config-permissions";
import { getGoalDetail } from "@/server/admin/goal-admin";
import { GoalNotFoundError } from "@/server/admin/goal-admin-errors";
import { listGoalScopeOptions } from "@/server/admin/goal-scope-options";
import { NewGoalVersionForm } from "@/components/admin/NewGoalVersionForm";
import {
  GOAL_METRIC_LABELS,
  GOAL_PERIOD_TYPE_LABELS,
  formatGoalScopeLabel,
  formatGoalTargetValue,
} from "@/lib/goal-format";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function AdminGoalDetailPage({ params }: PageProps) {
  const session = await getOptionalServerSession();
  if (!session) {
    redirect("/login");
  }
  const { id: goalId } = await params;

  try {
    const { goal, scopeName } = await withServerSessionTenantContext(async (s) => {
      requireConfigPermission(s, "config.goals.view");
      const goalDetail = await getGoalDetail(goalId);
      const options = await listGoalScopeOptions(
        goalDetail.scopeType as "TENANT" | "COMPANY" | "STORE" | "EMPLOYEE",
      );
      const name = options.find((o) => o.id === goalDetail.scopeId)?.name;
      return { goal: goalDetail, scopeName: name };
    });

    const canEdit = session.configPermissions.includes("config.goals.edit");

    return (
      <main className="admin-questions admin-questions--detail">
        <p className="admin-questions__breadcrumb">
          <Link href="/admin/goals">Ziele</Link>
        </p>
        <h1>{GOAL_METRIC_LABELS[goal.metricKey] ?? goal.metricKey}</h1>
        <p className="admin-questions__hint">
          {formatGoalScopeLabel(goal.scopeType, goal.scopeId, scopeName)} --{" "}
          {GOAL_PERIOD_TYPE_LABELS[goal.periodType] ?? goal.periodType} ab{" "}
          {new Date(goal.periodStart).toLocaleDateString("de-DE")}
        </p>
        <p className="admin-questions__hint">
          Aktuelle Version: {goal.currentVersion.versionNumber} -- Ziel:{" "}
          {formatGoalTargetValue(goal.metricKey, goal.currentVersion, goal.currency)}
        </p>

        {canEdit ? (
          <NewGoalVersionForm goalId={goal.id} metricKey={goal.metricKey} />
        ) : (
          <p className="admin-questions__hint">
            Keine Bearbeitungsberechtigung -- nur Ansicht moeglich.
          </p>
        )}

        <section className="admin-questions__history">
          <h2>Versionshistorie</h2>
          <ul className="admin-questions__history-list">
            {goal.versions.map((v) => (
              <li key={v.id} className="admin-questions__history-item">
                <span>Version {v.versionNumber}</span>
                <span>{formatGoalTargetValue(goal.metricKey, v, goal.currency)}</span>
                <span className="admin-questions__version-meta">
                  erfasst am {new Date(v.createdAt).toLocaleString("de-DE")}
                </span>
              </li>
            ))}
          </ul>
        </section>

        <p className="admin-questions__back">
          <Link href="/admin/goals">Zurueck zur Zieluebersicht</Link>
        </p>
      </main>
    );
  } catch (error) {
    if (error instanceof ConfigAccessDeniedError) {
      return (
        <main className="admin-questions admin-questions--denied">
          <h1>Kein Zugriff</h1>
          <p>Fuer dieses Konto ist die Zielverwaltung nicht freigeschaltet.</p>
        </main>
      );
    }
    if (error instanceof GoalNotFoundError) {
      notFound();
    }
    throw error;
  }
}
