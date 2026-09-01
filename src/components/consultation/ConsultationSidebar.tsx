/**
 * Sidebar der Beratungsarbeitsplatz-UI (Phase 15 AP1, siehe
 * PHASE_15_DISCOVERY.md + project_ki_cross_phase15_ap1_bestandspruefung.md).
 * Server Component -- reine Anzeige eines bereits fertig komponierten
 * `ConsultationSidebarData`-Read-Models, keine eigene Datenbeschaffung, keine
 * Seiteneffekte (analog `RecommendationList`/`SessionSummaryView`).
 *
 * WICHTIG (verbindliche ChatGPT-Vorgabe "Weg 1"): wird von JEDER der drei
 * `page.tsx`-Dateien unter `/consultation/[sessionId]` selbst gerendert
 * (nicht vom gemeinsamen `layout.tsx`) -- Freshness/Security haben Vorrang
 * vor Duplikat-Vermeidung, siehe Modulkommentar zu
 * `getConsultationSidebarData()` in `consultation-ui/view-models.ts`. Die
 * Navigation zwischen den drei Unterseiten liegt bewusst NICHT hier, sondern
 * im gemeinsamen `layout.tsx` (`ConsultationNav`) -- diese Komponente zeigt
 * ausschliesslich Kontext (Sitzungsstatus, eigene Ziele).
 *
 * Zeigt AUSSCHLIESSLICH bereits fuer die Mitarbeiter-Sicht freigegebene
 * Daten -- keine Provisions-/Margendaten, kein `businessPriorityScore`
 * (bestehende, seit Phase 6 gueltige Regel, siehe Modulkommentar zu
 * `buildConsultationRecommendationView()`).
 */

import { GOAL_METRIC_LABELS, formatGoalMetricValue } from "@/lib/goal-format";
import type { ConsultationSidebarData } from "@/server/consultation-ui/view-models";

const SESSION_STATUS_LABELS: Record<string, string> = {
  IN_PROGRESS: "Laufend",
  COMPLETED: "Abgeschlossen",
  ABANDONED: "Abgebrochen",
};

interface ConsultationSidebarProps {
  data: ConsultationSidebarData;
}

export function ConsultationSidebar({ data }: ConsultationSidebarProps) {
  return (
    <aside className="consultation-sidebar" aria-label="Beratungsuebersicht">
      <div className="consultation-sidebar__status">
        <h3>Sitzungsstatus</h3>
        <p>
          {data.sessionStatus
            ? (SESSION_STATUS_LABELS[data.sessionStatus] ?? data.sessionStatus)
            : "Unbekannt"}
        </p>
      </div>

      <div className="consultation-sidebar__goals">
        <h3>Eigene Ziele</h3>
        {data.activeGoals.length === 0 ? (
          <p className="consultation-sidebar__empty">Kein aktives Ziel in diesem Zeitraum.</p>
        ) : (
          <ul className="consultation-sidebar__goal-list">
            {data.activeGoals.map((goal) => (
              <li key={`${goal.metricKey}-${goal.scopeLabel}`}>
                <span className="consultation-sidebar__goal-metric">
                  {GOAL_METRIC_LABELS[goal.metricKey] ?? goal.metricKey}
                </span>
                <span className="consultation-sidebar__goal-value">
                  {formatGoalMetricValue(goal.metricKey, goal.actual, goal.currency)} /{" "}
                  {formatGoalMetricValue(goal.metricKey, goal.target, goal.currency)}
                  {goal.achievementRate != null &&
                    ` (${new Intl.NumberFormat("de-DE", { style: "percent", maximumFractionDigits: 0 }).format(goal.achievementRate)})`}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </aside>
  );
}
