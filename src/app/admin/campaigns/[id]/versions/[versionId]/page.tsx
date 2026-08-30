/**
 * `/admin/campaigns/[id]/versions/[versionId]` (Phase 13 AP6, siehe
 * PHASE_13_IMPLEMENTATION_PLAN.md Abschnitt 3, ChatGPT-GO 2026-08-30).
 * Detailansicht einer `CampaignVersion`: Scope + Beschreibung + Bedingungen,
 * bei `DRAFT` editierbar (`CampaignDraftEditor`) inkl. Validieren-/
 * Veroeffentlichen-Aktionen (`CampaignVersionActionsBar`), bei
 * ACTIVE/EXPIRED/ARCHIVED read-only.
 *
 * Analog `/admin/commissions/[id]/versions/[versionId]/page.tsx` (Phase 10
 * AP8). Server Component fuer den initialen Ladevorgang (Session +
 * `requireConfigPermission()` + Service-Aufrufe direkt). Alle nachfolgenden
 * MUTATIONEN laufen aus den Client-Komponenten heraus ausschliesslich ueber
 * `fetch()` gegen die echten `/api/admin/campaigns/...`-Routen -- die Seite
 * selbst fuehrt keine eigene Mutations- oder Statuslogik aus.
 *
 * Anders als bei RuleSet/Questionnaire besitzt `CampaignVersion` KEIN
 * eigenes `rollback`-Route-Pendant (siehe `campaign-schemas.ts`
 * Modulkommentar) -- die Versionshistorie ist daher rein lesend (KEINE
 * Aktions-Buttons pro Historieneintrag). "Neuen Entwurf aus dieser Version
 * erstellen" deckt denselben Bedarf ab und ist NUR auf dieser Detailseite
 * (fuer die aktuell betrachtete, nicht-DRAFT Version) verfuegbar, analog
 * Commission-Modellen.
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
import { getCampaignVersionDetail, getCampaignVersionHistory } from "@/server/admin/campaign-admin";
import {
  CampaignNotFoundError,
  CampaignVersionNotFoundError,
} from "@/server/admin/campaign-admin-errors";
import { CampaignDraftEditor } from "@/components/admin/CampaignDraftEditor";
import { CampaignVersionActionsBar } from "@/components/admin/CampaignVersionActionsBar";
import { CampaignVersionHistoryPanel } from "@/components/admin/CampaignVersionHistoryPanel";
import { CreateDraftCampaignVersionButton } from "@/components/admin/CreateDraftCampaignVersionButton";

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

export default async function AdminCampaignVersionPage({ params }: PageProps) {
  const session = await getOptionalServerSession();
  if (!session) {
    redirect("/login");
  }
  const { id: campaignId, versionId } = await params;

  try {
    const { version, history } = await withServerSessionTenantContext(async (s) => {
      requireConfigPermission(s, "config.campaigns.view");
      const [version, history] = await Promise.all([
        getCampaignVersionDetail(campaignId, versionId),
        getCampaignVersionHistory(campaignId),
      ]);
      return { version, history };
    });

    const canEdit = session.configPermissions.includes("config.campaigns.edit");
    const canPublish = session.configPermissions.includes("config.campaigns.publish");
    const isDraft = version.status === "DRAFT";

    return (
      <main className="admin-questions admin-questions--detail">
        <p className="admin-questions__breadcrumb">
          <Link href="/admin/campaigns">Kampagnen</Link>
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
              <CampaignVersionActionsBar
                campaignId={campaignId}
                versionId={versionId}
                canPublish={canPublish}
              />
            ) : (
              <p className="admin-questions__hint">
                Keine Bearbeitungsberechtigung -- nur Ansicht moeglich.
              </p>
            )}
            <CampaignDraftEditor
              campaignId={campaignId}
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
                <CreateDraftCampaignVersionButton
                  campaignId={campaignId}
                  copyFromVersionId={versionId}
                  defaultTenantId={session.tenantId}
                  label="Neuen Entwurf aus dieser Version erstellen"
                />
              )}
            </section>
            <CampaignDraftEditor
              campaignId={campaignId}
              versionId={versionId}
              version={version}
              readOnly
            />
          </>
        )}

        <CampaignVersionHistoryPanel
          campaignId={campaignId}
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
          <p>Fuer dieses Konto ist die Kampagnen-Verwaltung nicht freigeschaltet.</p>
        </main>
      );
    }
    if (error instanceof CampaignNotFoundError || error instanceof CampaignVersionNotFoundError) {
      notFound();
    }
    throw error;
  }
}
