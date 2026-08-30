/**
 * `/admin/campaigns` (Phase 13 AP6, siehe PHASE_13_IMPLEMENTATION_PLAN.md
 * Abschnitt 3, ChatGPT-GO 2026-08-30). Kampagnen-Einstiegsseite -- listet
 * alle `Campaign`s dieses Mandanten mit ihren Versionen (Status-Badges),
 * analog `/admin/commissions/page.tsx` (Phase 10 AP8).
 *
 * Server Component -- laedt Session + Daten serverseitig. Autorisierung
 * ausschliesslich ueber `requireConfigPermission(session, "config.campaigns.view")`
 * -- exakt dieselbe Funktion, die auch `GET /api/admin/campaigns` verwendet
 * (einzige Quelle der Wahrheit fuer diese Pruefung). Diese Seite trifft
 * KEINE eigene Berechtigungsentscheidung -- bei fehlender Permission wirft
 * `requireConfigPermission()` `ConfigAccessDeniedError`, was hier zu einer
 * generischen "Kein Zugriff"-Anzeige fuehrt.
 *
 * WICHTIGER UNTERSCHIED zu `/admin/rules` (identisches Prinzip wie bei
 * Commission-Modellen, Phase 10 AP8): der Publish-Scope von
 * `CampaignVersion` ist PRO `Campaign`, NICHT mandantenweit -- diese Seite
 * darf daher NICHT den mandantenweiten Warnhinweis aus der Regelverwaltung
 * uebernehmen.
 *
 * `session.tenantId` wird als `defaultTenantId`-Prop an
 * `CreateDraftCampaignVersionButton` durchgereicht (Default-Scope beim
 * allerersten Entwurf einer Campaign ohne Kopiervorlage, siehe dortigen
 * Modulkommentar).
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
import { listCampaigns } from "@/server/admin/campaign-admin";
import { CreateCampaignButton } from "@/components/admin/CreateCampaignButton";
import { CreateDraftCampaignVersionButton } from "@/components/admin/CreateDraftCampaignVersionButton";

export const dynamic = "force-dynamic";

const STATUS_LABELS: Record<string, string> = {
  DRAFT: "Entwurf",
  ACTIVE: "Aktiv",
  EXPIRED: "Abgelaufen",
  ARCHIVED: "Archiviert",
};

export default async function AdminCampaignsPage() {
  const session = await getOptionalServerSession();
  if (!session) {
    redirect("/login");
  }

  try {
    const campaigns = await withServerSessionTenantContext(async (s) => {
      requireConfigPermission(s, "config.campaigns.view");
      return listCampaigns();
    });
    const canEdit = session.configPermissions.includes("config.campaigns.edit");

    return (
      <main className="admin-questions">
        <h1>Kampagnen</h1>
        <p className="admin-questions__hint">Angemeldet als {session.displayName}.</p>
        <p className="admin-questions__hint admin-campaigns__publish-note">
          Hinweis: Veroeffentlichen betrifft ausschliesslich die jeweilige Kampagne -- andere
          Kampagnen desselben Mandanten bleiben davon unberuehrt.
        </p>

        {canEdit && <CreateCampaignButton />}

        {campaigns.length === 0 && (
          <p className="admin-questions__empty">Keine Kampagnen vorhanden.</p>
        )}

        <ul className="admin-questions__list">
          {campaigns.map((campaign) => {
            // Analog Phase 10 AP8 (Commission-Modelle): explizit nur die
            // ACTIVE-Version als Kopiervorlage verwenden, kein Fallback auf
            // eine beliebige historische Version.
            const activeVersion = campaign.versions.find((v) => v.status === "ACTIVE");
            return (
              <li key={campaign.id} className="admin-questions__item">
                <h2>{campaign.name}</h2>
                <ul className="admin-questions__versions">
                  {campaign.versions.map((v) => (
                    <li key={v.id}>
                      <Link
                        href={`/admin/campaigns/${campaign.id}/versions/${v.id}`}
                        className="admin-questions__version-link"
                      >
                        <span>Version {v.versionNumber}</span>
                        <span
                          className={`admin-questions__badge admin-questions__badge--${v.status}`}
                        >
                          {STATUS_LABELS[v.status] ?? v.status}
                        </span>
                        <span className="admin-questions__version-meta">
                          seit {new Date(v.validFrom).toLocaleDateString("de-DE")}
                          {v.validTo
                            ? ` bis ${new Date(v.validTo).toLocaleDateString("de-DE")}`
                            : ""}
                        </span>
                      </Link>
                    </li>
                  ))}
                  {campaign.versions.length === 0 && (
                    <li className="admin-questions__empty">Keine Versionen vorhanden.</li>
                  )}
                </ul>
                {canEdit && (
                  <CreateDraftCampaignVersionButton
                    campaignId={campaign.id}
                    copyFromVersionId={activeVersion?.id}
                    defaultTenantId={session.tenantId}
                    label="Neuen Entwurf erstellen"
                  />
                )}
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
          <p>Fuer dieses Konto ist die Kampagnen-Verwaltung nicht freigeschaltet.</p>
        </main>
      );
    }
    throw error;
  }
}
