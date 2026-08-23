/**
 * `/admin/goals` (Phase 11 AP6, siehe PHASE_11_IMPLEMENTATION_PLAN.md
 * Abschnitt 9, ChatGPT-GO 2026-08-22 nach AP6-Discovery). Ziele-Einstiegsseite
 * -- listet alle `Goal`s dieses Mandanten mit ihrer aktuellen `GoalVersion`,
 * strukturell angelehnt an `/admin/commissions/page.tsx` (Phase 10 AP8) /
 * `/admin/rules/page.tsx` (Phase 9 AP8), aber OHNE Status-Badges (Goals
 * haben kein `status`-Feld, siehe `goal-admin.ts`-Modulkommentar).
 *
 * Server Component -- laedt Session + Daten serverseitig. Autorisierung
 * ausschliesslich ueber `requireConfigPermission(session, "config.goals.view")`
 * -- exakt dieselbe Funktion, die auch `GET /api/admin/goals` verwendet
 * (einzige Quelle der Wahrheit fuer diese Pruefung). Diese Seite trifft
 * KEINE eigene Berechtigungsentscheidung -- bei fehlender Permission wirft
 * `requireConfigPermission()` `ConfigAccessDeniedError`, was hier zu einer
 * generischen "Kein Zugriff"-Anzeige fuehrt.
 *
 * NAMENS-AUFLOESUNG der `scopeId`s: `listGoals()` (goal-admin.ts, AP2)
 * liefert bewusst nur die rohe `scopeId` (keine Aenderung an der bereits
 * abgenommenen AP2-Datei fuer AP6). Diese Seite loest die angezeigten Namen
 * daher selbst auf -- ueber `listGoalScopeOptions()` (AP6,
 * `goal-scope-options.ts`), HOECHSTENS EINMAL pro tatsaechlich
 * vorkommendem `scopeType` (nicht pro Goal) -- reine Anzeige-Konvenienz,
 * keine Sicherheitsentscheidung (siehe Modulkommentar dort).
 */

import Link from "next/link";
import { redirect } from "next/navigation";
import {
  getOptionalServerSession,
  withServerSessionTenantContext,
} from "@/server/auth/server-context";
import {
  requireConfigPermission,
  ConfigAccessDeniedError,
} from "@/server/authz/config-permissions";
import { listGoals } from "@/server/admin/goal-admin";
import { listGoalScopeOptions, type GoalScopeType } from "@/server/admin/goal-scope-options";
import { CreateGoalButton } from "@/components/admin/CreateGoalButton";
import { GOAL_METRIC_LABELS, formatGoalScopeLabel, formatGoalTargetValue } from "@/lib/goal-format";

export const dynamic = "force-dynamic";

const SCOPE_TYPES: readonly GoalScopeType[] = ["TENANT", "COMPANY", "STORE", "EMPLOYEE"];

export default async function AdminGoalsPage() {
  const session = await getOptionalServerSession();
  if (!session) {
    redirect("/login");
  }

  try {
    const { goals, scopeNamesByType } = await withServerSessionTenantContext(async (s) => {
      requireConfigPermission(s, "config.goals.view");
      const goalRows = await listGoals();

      const presentScopeTypes = new Set(goalRows.map((g) => g.scopeType));
      const namesByType = new Map<string, Map<string, string>>();
      for (const scopeType of SCOPE_TYPES) {
        if (!presentScopeTypes.has(scopeType)) continue;
        const options = await listGoalScopeOptions(scopeType);
        namesByType.set(scopeType, new Map(options.map((o) => [o.id, o.name])));
      }

      return { goals: goalRows, scopeNamesByType: namesByType };
    });
    const canEdit = session.configPermissions.includes("config.goals.edit");

    return (
      <main className="admin-questions">
        <h1>Ziele</h1>
        <p className="admin-questions__hint">Angemeldet als {session.displayName}.</p>
        <p className="admin-questions__hint admin-goals__hint">
          Jedes Ziel hat genau eine aktuelle Version (die zuletzt erfasste Zielkorrektur). Es gibt
          keinen Entwurfs- oder Veroeffentlichungs-Status -- eine neue Version wirkt sofort.
        </p>

        {canEdit && <CreateGoalButton />}

        {goals.length === 0 && <p className="admin-questions__empty">Keine Ziele vorhanden.</p>}

        <ul className="admin-questions__list">
          {goals.map((goal) => {
            const scopeName = scopeNamesByType.get(goal.scopeType)?.get(goal.scopeId);
            return (
              <li key={goal.id} className="admin-questions__item">
                <h2>
                  <Link href={`/admin/goals/${goal.id}`}>
                    {GOAL_METRIC_LABELS[goal.metricKey] ?? goal.metricKey} --{" "}
                    {formatGoalScopeLabel(goal.scopeType, goal.scopeId, scopeName)}
                  </Link>
                </h2>
                <p className="admin-questions__version-meta">
                  {goal.periodType} ab {new Date(goal.periodStart).toLocaleDateString("de-DE")} --
                  Ziel: {formatGoalTargetValue(goal.metricKey, goal.currentVersion, goal.currency)}{" "}
                  (Version {goal.currentVersion.versionNumber})
                </p>
              </li>
            );
          })}
        </ul>

        <p className="admin-questions__back">
          <Link href="/consultation">Zurueck zur Beratung</Link>
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
    throw error;
  }
}
