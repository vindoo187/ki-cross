/**
 * `/admin/playbooks/[id]/versions/[versionId]` (Phase 14 AP6, siehe
 * project_ki_cross_phase14_ap5_status.md, ChatGPT-GO 2026-08-31).
 * Detailansicht einer `PlaybookVersion`: Scope + Beschreibung + Sections,
 * bei `DRAFT` editierbar (`PlaybookDraftEditor`) inkl. Validieren-/
 * Veroeffentlichen-Aktionen (`PlaybookVersionActionsBar`), bei
 * ACTIVE/EXPIRED/ARCHIVED read-only.
 *
 * Analog `/admin/campaigns/[id]/versions/[versionId]/page.tsx` (Phase 13
 * AP6). Server Component fuer den initialen Ladevorgang (Session +
 * `requireConfigPermission()` + Service-Aufrufe direkt). Alle nachfolgenden
 * MUTATIONEN laufen aus den Client-Komponenten heraus ausschliesslich ueber
 * `fetch()` gegen die echten `/api/admin/playbooks/...`-Routen -- die Seite
 * selbst fuehrt keine eigene Mutations- oder Statuslogik aus.
 *
 * Anders als bei RuleSet/Questionnaire besitzt `PlaybookVersion` KEIN
 * eigenes `rollback`-Route-Pendant (siehe `playbook-schemas.ts`
 * Modulkommentar) -- die Versionshistorie ist daher rein lesend (KEINE
 * Aktions-Buttons pro Historieneintrag). "Neuen Entwurf aus dieser Version
 * erstellen" deckt denselben Bedarf ab und ist NUR auf dieser Detailseite
 * (fuer die aktuell betrachtete, nicht-DRAFT Version) verfuegbar, analog
 * Kampagnen/Provisionsmodellen.
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
import { getPlaybookVersionDetail, getPlaybookVersionHistory } from "@/server/admin/playbook-admin";
import {
  PlaybookNotFoundError,
  PlaybookVersionNotFoundError,
} from "@/server/admin/playbook-admin-errors";
import { PlaybookDraftEditor } from "@/components/admin/PlaybookDraftEditor";
import { PlaybookVersionActionsBar } from "@/components/admin/PlaybookVersionActionsBar";
import { PlaybookVersionHistoryPanel } from "@/components/admin/PlaybookVersionHistoryPanel";
import { CreateDraftPlaybookVersionButton } from "@/components/admin/CreateDraftPlaybookVersionButton";

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

export default async function AdminPlaybookVersionPage({ params }: PageProps) {
  const session = await getOptionalServerSession();
  if (!session) {
    redirect("/login");
  }
  const { id: playbookId, versionId } = await params;

  try {
    const { version, history } = await withServerSessionTenantContext(async (s) => {
      requireConfigPermission(s, "config.playbooks.view");
      const [version, history] = await Promise.all([
        getPlaybookVersionDetail(playbookId, versionId),
        getPlaybookVersionHistory(playbookId),
      ]);
      return { version, history };
    });

    const canEdit = session.configPermissions.includes("config.playbooks.edit");
    const canPublish = session.configPermissions.includes("config.playbooks.publish");
    const isDraft = version.status === "DRAFT";

    return (
      <main className="admin-questions admin-questions--detail">
        <p className="admin-questions__breadcrumb">
          <Link href="/admin/playbooks">Playbooks</Link>
        </p>
        <h1>
          Version {version.versionNumber}{" "}
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
              <PlaybookVersionActionsBar
                playbookId={playbookId}
                versionId={versionId}
                canPublish={canPublish}
              />
            ) : (
              <p className="admin-questions__hint">
                Keine Bearbeitungsberechtigung -- nur Ansicht moeglich.
              </p>
            )}
            <PlaybookDraftEditor
              playbookId={playbookId}
              versionId={versionId}
              version={version}
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
                <CreateDraftPlaybookVersionButton
                  playbookId={playbookId}
                  copyFromVersionId={versionId}
                  defaultTenantId={session.tenantId}
                  label="Neuen Entwurf aus dieser Version erstellen"
                />
              )}
            </section>
            <PlaybookDraftEditor
              playbookId={playbookId}
              versionId={versionId}
              version={version}
              readOnly
            />
          </>
        )}

        <PlaybookVersionHistoryPanel
          playbookId={playbookId}
          currentVersionId={versionId}
          history={history}
        />
      </main>
    );
  } catch (error) {
    if (error instanceof ConfigAccessDeniedError) {
      return (
        <main className="admin-questions admin-questions--denied">
          <h1>Kein Zugriff</h1>
          <p>Fuer dieses Konto ist die Playbook-Verwaltung nicht freigeschaltet.</p>
        </main>
      );
    }
    if (error instanceof PlaybookNotFoundError || error instanceof PlaybookVersionNotFoundError) {
      notFound();
    }
    throw error;
  }
}
