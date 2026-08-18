/**
 * `/admin/rules/[id]/versions/[versionId]` (Phase 9 AP8, siehe
 * PHASE_9_IMPLEMENTATION_PLAN.md Abschnitt 9). Detailansicht einer
 * `RuleSetVersion`: alle vier Regeltypen, bei `DRAFT` editierbar
 * (`RuleDraftEditor`) inkl. Validieren-/Veroeffentlichen-Aktionen
 * (`RuleVersionActionsBar`), bei ACTIVE/EXPIRED/ARCHIVED read-only.
 * Versionshistorie mit Rollback-Aktion (`RuleVersionHistoryPanel`).
 *
 * Analog `/admin/questions/[id]/versions/[versionId]/page.tsx` (Phase 8
 * AP6). Server Component fuer den initialen Ladevorgang (Session +
 * `requireConfigPermission()` + Service-Aufrufe direkt). Alle nachfolgenden
 * MUTATIONEN laufen aus den Client-Komponenten heraus ausschliesslich ueber
 * `fetch()` gegen die echten `/api/admin/rule-sets/...`-Routen -- die Seite
 * selbst fuehrt keine eigene Mutations- oder Statuslogik aus (ChatGPT-
 * Leitplanke: die API bleibt die einzige Sicherheits- und
 * Geschaeftslogikgrenze).
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
import { getRuleSetVersionDetail, getRuleSetVersionHistory } from "@/server/admin/rule-admin";
import {
  RuleSetNotFoundError,
  RuleSetVersionNotFoundError,
} from "@/server/admin/rule-admin-errors";
import { RuleDraftEditor } from "@/components/admin/RuleDraftEditor";
import { RuleVersionActionsBar } from "@/components/admin/RuleVersionActionsBar";
import { RuleVersionHistoryPanel } from "@/components/admin/RuleVersionHistoryPanel";
import { CreateDraftRuleSetVersionButton } from "@/components/admin/CreateDraftRuleSetVersionButton";

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

export default async function AdminRuleSetVersionPage({ params }: PageProps) {
  const session = await getOptionalServerSession();
  if (!session) {
    redirect("/login");
  }
  const { id: ruleSetId, versionId } = await params;

  try {
    const { version, history } = await withServerSessionTenantContext(async (s) => {
      requireConfigPermission(s, "config.rules.view");
      const [version, history] = await Promise.all([
        getRuleSetVersionDetail(ruleSetId, versionId),
        getRuleSetVersionHistory(ruleSetId),
      ]);
      return { version, history };
    });

    const canEdit = session.configPermissions.includes("config.rules.edit");
    const canPublish = session.configPermissions.includes("config.rules.publish");
    const isDraft = version.status === "DRAFT";
    const totalRuleCount =
      version.eligibilityRules.length +
      version.exclusionRules.length +
      version.prioritizationRules.length +
      version.crossSellingRules.length;

    return (
      <main className="admin-questions admin-questions--detail">
        <p className="admin-questions__breadcrumb">
          <Link href="/admin/rules">Regelverwaltung</Link>
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
              <RuleVersionActionsBar
                ruleSetId={ruleSetId}
                versionId={versionId}
                canPublish={canPublish}
              />
            ) : (
              <p className="admin-questions__hint">
                Keine Bearbeitungsberechtigung -- nur Ansicht moeglich.
              </p>
            )}
            <RuleDraftEditor
              ruleSetId={ruleSetId}
              versionId={versionId}
              eligibilityRules={version.eligibilityRules}
              exclusionRules={version.exclusionRules}
              prioritizationRules={version.prioritizationRules}
              crossSellingRules={version.crossSellingRules}
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
                <CreateDraftRuleSetVersionButton
                  ruleSetId={ruleSetId}
                  copyFromVersionId={versionId}
                  label="Neuen Entwurf aus dieser Version erstellen"
                />
              )}
            </section>
            <RuleDraftEditor
              ruleSetId={ruleSetId}
              versionId={versionId}
              eligibilityRules={version.eligibilityRules}
              exclusionRules={version.exclusionRules}
              prioritizationRules={version.prioritizationRules}
              crossSellingRules={version.crossSellingRules}
              readOnly
            />
            {totalRuleCount === 0 && (
              <p className="admin-questions__empty">Keine Regeln in dieser Version.</p>
            )}
          </>
        )}

        <RuleVersionHistoryPanel
          ruleSetId={ruleSetId}
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
          <p>Fuer dieses Konto ist die Regelverwaltung nicht freigeschaltet.</p>
        </main>
      );
    }
    if (error instanceof RuleSetNotFoundError || error instanceof RuleSetVersionNotFoundError) {
      notFound();
    }
    throw error;
  }
}
