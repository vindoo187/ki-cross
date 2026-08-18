/**
 * `/admin/questions/[id]/versions/[versionId]` (Phase 8 AP6, siehe
 * PHASE_8_IMPLEMENTATION_PLAN.md Abschnitt 9). Detailansicht einer
 * `QuestionnaireVersion`: Fragenliste, bei `DRAFT` editierbar
 * (`QuestionDraftEditor`) inkl. Validieren-/Veroeffentlichen-Aktionen
 * (`VersionActionsBar`), bei ACTIVE/EXPIRED/ARCHIVED read-only.
 * Versionshistorie mit Rollback-Aktion (`VersionHistoryPanel`).
 *
 * Server Component fuer den initialen Ladevorgang (Session +
 * `requireConfigPermission()` + Service-Aufrufe direkt, analog
 * `/admin/questions/page.tsx`). Alle nachfolgenden MUTATIONEN laufen aus den
 * Client-Komponenten heraus ausschliesslich ueber `fetch()` gegen die
 * echten `/api/admin/questionnaires/...`-Routen -- die Seite selbst fuehrt
 * keine eigene Mutations- oder Statuslogik aus (ChatGPT-Leitplanke AP6: die
 * API bleibt die einzige Sicherheits- und Geschaeftslogikgrenze).
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
import {
  getQuestionnaireVersionDetail,
  getQuestionnaireVersionHistory,
} from "@/server/admin/question-admin";
import {
  QuestionnaireNotFoundError,
  QuestionnaireVersionNotFoundError,
} from "@/server/admin/question-admin-errors";
import { QuestionDraftEditor } from "@/components/admin/QuestionDraftEditor";
import { VersionActionsBar } from "@/components/admin/VersionActionsBar";
import { VersionHistoryPanel } from "@/components/admin/VersionHistoryPanel";
import { CreateDraftVersionButton } from "@/components/admin/CreateDraftVersionButton";

export const dynamic = "force-dynamic";

const STATUS_LABELS: Record<string, string> = {
  DRAFT: "Entwurf",
  ACTIVE: "Aktiv",
  EXPIRED: "Abgelaufen",
  ARCHIVED: "Archiviert",
};

interface PageProps {
  params: Promise<{ id: string; versionId: string }>;
}

export default async function AdminQuestionnaireVersionPage({ params }: PageProps) {
  const session = await getOptionalServerSession();
  if (!session) {
    redirect("/login");
  }
  const { id: questionnaireId, versionId } = await params;

  try {
    const { version, history } = await withServerSessionTenantContext(async (s) => {
      requireConfigPermission(s, "config.questions.view");
      const [version, history] = await Promise.all([
        getQuestionnaireVersionDetail(questionnaireId, versionId),
        getQuestionnaireVersionHistory(questionnaireId),
      ]);
      return { version, history };
    });

    const canEdit = session.configPermissions.includes("config.questions.edit");
    const canPublish = session.configPermissions.includes("config.questions.publish");
    const isDraft = version.status === "DRAFT";

    return (
      <main className="admin-questions admin-questions--detail">
        <p className="admin-questions__breadcrumb">
          <Link href="/admin/questions">Fragenverwaltung</Link>
        </p>
        <h1>
          {version.label}{" "}
          <span className={`admin-questions__badge admin-questions__badge--${version.status}`}>
            {STATUS_LABELS[version.status] ?? version.status}
          </span>
        </h1>
        <p className="admin-questions__hint">
          seit {new Date(version.validFrom).toLocaleString("de-DE")}
          {version.validTo ? ` bis ${new Date(version.validTo).toLocaleString("de-DE")}` : ""}
        </p>

        {isDraft ? (
          <>
            {canEdit ? (
              <VersionActionsBar
                questionnaireId={questionnaireId}
                versionId={versionId}
                canPublish={canPublish}
              />
            ) : (
              <p className="admin-questions__hint">
                Keine Bearbeitungsberechtigung -- nur Ansicht moeglich.
              </p>
            )}
            <QuestionDraftEditor
              questionnaireId={questionnaireId}
              versionId={versionId}
              questions={version.questions}
              readOnly={!canEdit}
            />
          </>
        ) : (
          <>
            <section className="admin-questions__readonly">
              <p className="admin-questions__hint">
                Diese Version ist nicht mehr im Entwurf und daher schreibgeschuetzt. Aenderungen
                erfordern einen neuen Entwurf.
              </p>
              {canEdit && (
                <CreateDraftVersionButton
                  questionnaireId={questionnaireId}
                  copyFromVersionId={versionId}
                  label="Neuen Entwurf aus dieser Version erstellen"
                />
              )}
            </section>
            <ul className="admin-questions__questions admin-questions__questions--readonly">
              {version.questions.map((q) => (
                <li key={q.id} className="admin-questions__question">
                  <strong>{q.label}</strong>{" "}
                  <span className="admin-questions__question-meta">
                    ({q.answerType}
                    {q.isRequired ? ", Pflichtfrage" : ""})
                  </span>
                  {q.answerOptions.length > 0 && (
                    <ul className="admin-questions__option-list">
                      {q.answerOptions.map((o) => (
                        <li key={o.id}>{o.label}</li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
              {version.questions.length === 0 && (
                <li className="admin-questions__empty">Keine Fragen in dieser Version.</li>
              )}
            </ul>
          </>
        )}

        <VersionHistoryPanel
          questionnaireId={questionnaireId}
          currentVersionId={versionId}
          history={history}
          canEdit={canEdit}
        />
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
    if (
      error instanceof QuestionnaireNotFoundError ||
      error instanceof QuestionnaireVersionNotFoundError
    ) {
      notFound();
    }
    throw error;
  }
}
