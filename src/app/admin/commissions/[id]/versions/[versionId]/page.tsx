/**
 * `/admin/commissions/[id]/versions/[versionId]` (Phase 10 AP8, siehe
 * PHASE_10_IMPLEMENTATION_PLAN.md Abschnitt 9, ChatGPT-GO 2026-08-22).
 * Detailansicht einer `CommissionModelVersion`: Skalarfelder
 * (FLAT/PERCENTAGE/TIERED) + `CommissionTier`-Stufen bei TIERED, bei
 * `DRAFT` editierbar (`CommissionDraftEditor`) inkl.
 * Validieren-/Veroeffentlichen-Aktionen (`CommissionVersionActionsBar`),
 * bei ACTIVE/EXPIRED/ARCHIVED read-only.
 *
 * Analog `/admin/rules/[id]/versions/[versionId]/page.tsx` (Phase 9 AP8).
 * Server Component fuer den initialen Ladevorgang (Session +
 * `requireConfigPermission()` + Service-Aufrufe direkt). Alle nachfolgenden
 * MUTATIONEN laufen aus den Client-Komponenten heraus ausschliesslich ueber
 * `fetch()` gegen die echten `/api/admin/commission-models/...`-Routen --
 * die Seite selbst fuehrt keine eigene Mutations- oder Statuslogik aus
 * (ChatGPT-Leitplanke: die API bleibt die einzige Sicherheits- und
 * Geschaeftslogikgrenze).
 *
 * Anders als bei RuleSet/Questionnaire besitzt `CommissionModelVersion`
 * KEIN eigenes `rollback`-Route-Pendant (siehe `commission-schemas.ts`
 * Modulkommentar zu `rollbackCommissionModelVersionSchema`) -- die
 * Versionshistorie ist daher rein lesend (KEINE Aktions-Buttons pro
 * Historieneintrag). "Neuen Entwurf aus dieser Version erstellen" deckt
 * denselben Bedarf ab und ist NUR auf dieser Detailseite (fuer die aktuell
 * betrachtete, nicht-DRAFT Version) verfuegbar, analog Rules/Questions.
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
  getCommissionModelVersionDetail,
  getCommissionModelVersionHistory,
} from "@/server/admin/commission-admin";
import {
  CommissionModelNotFoundError,
  CommissionModelVersionNotFoundError,
} from "@/server/admin/commission-admin-errors";
import { CommissionDraftEditor } from "@/components/admin/CommissionDraftEditor";
import { CommissionVersionActionsBar } from "@/components/admin/CommissionVersionActionsBar";
import { CommissionVersionHistoryPanel } from "@/components/admin/CommissionVersionHistoryPanel";
import { CreateDraftCommissionModelVersionButton } from "@/components/admin/CreateDraftCommissionModelVersionButton";

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

export default async function AdminCommissionModelVersionPage({ params }: PageProps) {
  const session = await getOptionalServerSession();
  if (!session) {
    redirect("/login");
  }
  const { id: commissionModelId, versionId } = await params;

  try {
    const { version, history } = await withServerSessionTenantContext(async (s) => {
      requireConfigPermission(s, "config.commissions.view");
      const [version, history] = await Promise.all([
        getCommissionModelVersionDetail(commissionModelId, versionId),
        getCommissionModelVersionHistory(commissionModelId),
      ]);
      return { version, history };
    });

    const canEdit = session.configPermissions.includes("config.commissions.edit");
    const canPublish = session.configPermissions.includes("config.commissions.publish");
    const isDraft = version.status === "DRAFT";

    return (
      <main className="admin-questions admin-questions--detail">
        <p className="admin-questions__breadcrumb">
          <Link href="/admin/commissions">Provisionsmodelle</Link>
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
              <CommissionVersionActionsBar
                commissionModelId={commissionModelId}
                versionId={versionId}
                canPublish={canPublish}
              />
            ) : (
              <p className="admin-questions__hint">
                Keine Bearbeitungsberechtigung -- nur Ansicht moeglich.
              </p>
            )}
            <CommissionDraftEditor
              commissionModelId={commissionModelId}
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
                <CreateDraftCommissionModelVersionButton
                  commissionModelId={commissionModelId}
                  copyFromVersionId={versionId}
                  label="Neuen Entwurf aus dieser Version erstellen"
                />
              )}
            </section>
            <CommissionDraftEditor
              commissionModelId={commissionModelId}
              versionId={versionId}
              version={version}
              readOnly
            />
          </>
        )}

        <CommissionVersionHistoryPanel
          commissionModelId={commissionModelId}
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
          <p>Fuer dieses Konto ist die Provisionsmodell-Verwaltung nicht freigeschaltet.</p>
        </main>
      );
    }
    if (
      error instanceof CommissionModelNotFoundError ||
      error instanceof CommissionModelVersionNotFoundError
    ) {
      notFound();
    }
    throw error;
  }
}
