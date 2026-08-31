/**
 * `/admin/playbooks` (Phase 14 AP6, siehe project_ki_cross_phase14_ap5_status.md,
 * ChatGPT-GO 2026-08-31). Playbook-Einstiegsseite -- listet alle
 * `Playbook`s dieses Mandanten mit ihren Versionen (Status-Badges), analog
 * `/admin/campaigns/page.tsx` (Phase 13 AP6).
 *
 * Server Component -- laedt Session + Daten serverseitig. Autorisierung
 * ausschliesslich ueber `requireConfigPermission(session, "config.playbooks.view")`
 * -- exakt dieselbe Funktion, die auch `GET /api/admin/playbooks` verwendet
 * (einzige Quelle der Wahrheit fuer diese Pruefung). Diese Seite trifft
 * KEINE eigene Berechtigungsentscheidung -- bei fehlender Permission wirft
 * `requireConfigPermission()` `ConfigAccessDeniedError`, was hier zu einer
 * generischen "Kein Zugriff"-Anzeige fuehrt.
 *
 * WICHTIGER UNTERSCHIED zu `/admin/rules` (identisches Prinzip wie bei
 * Kampagnen/Provisionsmodellen): der Publish-Scope von `PlaybookVersion`
 * ist PRO `Playbook`, NICHT mandantenweit -- diese Seite darf daher NICHT
 * den mandantenweiten Warnhinweis aus der Regelverwaltung uebernehmen.
 *
 * `session.tenantId` wird als `defaultTenantId`-Prop an
 * `CreateDraftPlaybookVersionButton` durchgereicht (Default-Scope beim
 * allerersten Entwurf eines Playbooks ohne Kopiervorlage, siehe dortigen
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
import { listPlaybooks } from "@/server/admin/playbook-admin";
import { CreatePlaybookButton } from "@/components/admin/CreatePlaybookButton";
import { CreateDraftPlaybookVersionButton } from "@/components/admin/CreateDraftPlaybookVersionButton";

export const dynamic = "force-dynamic";

const STATUS_LABELS: Record<string, string> = {
  DRAFT: "Entwurf",
  ACTIVE: "Aktiv",
  EXPIRED: "Abgelaufen",
  ARCHIVED: "Archiviert",
};

export default async function AdminPlaybooksPage() {
  const session = await getOptionalServerSession();
  if (!session) {
    redirect("/login");
  }

  try {
    const playbooks = await withServerSessionTenantContext(async (s) => {
      requireConfigPermission(s, "config.playbooks.view");
      return listPlaybooks();
    });
    const canEdit = session.configPermissions.includes("config.playbooks.edit");

    return (
      <main className="admin-questions">
        <h1>Playbooks</h1>
        <p className="admin-questions__hint">Angemeldet als {session.displayName}.</p>
        <p className="admin-questions__hint admin-playbooks__publish-note">
          Hinweis: Veroeffentlichen betrifft ausschliesslich das jeweilige Playbook -- andere
          Playbooks desselben Mandanten bleiben davon unberuehrt.
        </p>

        {canEdit && <CreatePlaybookButton />}

        {playbooks.length === 0 && (
          <p className="admin-questions__empty">Keine Playbooks vorhanden.</p>
        )}

        <ul className="admin-questions__list">
          {playbooks.map((playbook) => {
            // Analog Phase 13 AP6 (Kampagnen): explizit nur die
            // ACTIVE-Version als Kopiervorlage verwenden, kein Fallback auf
            // eine beliebige historische Version.
            const activeVersion = playbook.versions.find((v) => v.status === "ACTIVE");
            return (
              <li key={playbook.id} className="admin-questions__item">
                <h2>{playbook.name}</h2>
                <ul className="admin-questions__versions">
                  {playbook.versions.map((v) => (
                    <li key={v.id}>
                      <Link
                        href={`/admin/playbooks/${playbook.id}/versions/${v.id}`}
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
                  {playbook.versions.length === 0 && (
                    <li className="admin-questions__empty">Keine Versionen vorhanden.</li>
                  )}
                </ul>
                {canEdit && (
                  <CreateDraftPlaybookVersionButton
                    playbookId={playbook.id}
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
          <p>Fuer dieses Konto ist die Playbook-Verwaltung nicht freigeschaltet.</p>
        </main>
      );
    }
    throw error;
  }
}
