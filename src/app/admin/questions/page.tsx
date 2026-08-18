/**
 * `/admin/questions` (Phase 8 AP6, siehe PHASE_8_IMPLEMENTATION_PLAN.md
 * Abschnitt 9). Fragenverwaltung-Einstiegsseite -- listet alle
 * `Questionnaire`s dieses Mandanten mit ihren Versionen (Status-Badges).
 *
 * Server Component -- laedt Session + Daten serverseitig, analog
 * `/analytics/management/page.tsx`. Autorisierung ausschliesslich ueber
 * `requireConfigPermission(session, "config.questions.view")` -- exakt
 * dieselbe Funktion, die auch `GET /api/admin/questionnaires` verwendet
 * (einzige Quelle der Wahrheit fuer diese Pruefung, siehe Modulkommentar in
 * `config-permissions.ts`). Diese Seite trifft KEINE eigene
 * Berechtigungsentscheidung -- bei fehlender Permission wirft
 * `requireConfigPermission()` `ConfigAccessDeniedError`, was hier zu einer
 * generischen "Kein Zugriff"-Anzeige fuehrt (analog Management-Analytics).
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
import { listQuestionnaires } from "@/server/admin/question-admin";
import { CreateDraftVersionButton } from "@/components/admin/CreateDraftVersionButton";

export const dynamic = "force-dynamic";

const STATUS_LABELS: Record<string, string> = {
  DRAFT: "Entwurf",
  ACTIVE: "Aktiv",
  EXPIRED: "Abgelaufen",
  ARCHIVED: "Archiviert",
};

export default async function AdminQuestionsPage() {
  const session = await getOptionalServerSession();
  if (!session) {
    redirect("/login");
  }

  try {
    const questionnaires = await withServerSessionTenantContext(async (s) => {
      requireConfigPermission(s, "config.questions.view");
      return listQuestionnaires();
    });
    const canEdit = session.configPermissions.includes("config.questions.edit");

    return (
      <main className="admin-questions">
        <h1>Fragenverwaltung</h1>
        <p className="admin-questions__hint">Angemeldet als {session.displayName}.</p>

        {questionnaires.length === 0 && (
          <p className="admin-questions__empty">Keine Fragebogen vorhanden.</p>
        )}

        <ul className="admin-questions__list">
          {questionnaires.map((q) => (
            <li key={q.id} className="admin-questions__item">
              <h2>{q.key}</h2>
              <ul className="admin-questions__versions">
                {q.versions.map((v) => (
                  <li key={v.id}>
                    <Link
                      href={`/admin/questions/${q.id}/versions/${v.id}`}
                      className="admin-questions__version-link"
                    >
                      <span>{v.label}</span>
                      <span
                        className={`admin-questions__badge admin-questions__badge--${v.status}`}
                      >
                        {STATUS_LABELS[v.status] ?? v.status}
                      </span>
                      <span className="admin-questions__version-meta">
                        seit {new Date(v.validFrom).toLocaleDateString("de-DE")}
                        {v.validTo ? ` bis ${new Date(v.validTo).toLocaleDateString("de-DE")}` : ""}
                      </span>
                    </Link>
                  </li>
                ))}
                {q.versions.length === 0 && (
                  <li className="admin-questions__empty">Keine Versionen vorhanden.</li>
                )}
              </ul>
              {canEdit && (
                <CreateDraftVersionButton questionnaireId={q.id} label="Neuen Entwurf erstellen" />
              )}
            </li>
          ))}
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
          <p>Fuer dieses Konto ist die Fragenverwaltung nicht freigeschaltet.</p>
        </main>
      );
    }
    throw error;
  }
}
