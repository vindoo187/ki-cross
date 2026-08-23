/**
 * `/admin/commissions` (Phase 10 AP8, siehe PHASE_10_IMPLEMENTATION_PLAN.md
 * Abschnitt 9, ChatGPT-GO 2026-08-22). Provisionsmodell-Einstiegsseite --
 * listet alle `CommissionModel`s dieses Mandanten mit ihren Versionen
 * (Status-Badges), analog `/admin/rules/page.tsx` (Phase 9 AP8) /
 * `/admin/questions/page.tsx` (Phase 8 AP6).
 *
 * Server Component -- laedt Session + Daten serverseitig. Autorisierung
 * ausschliesslich ueber
 * `requireConfigPermission(session, "config.commissions.view")` -- exakt
 * dieselbe Funktion, die auch `GET /api/admin/commission-models`
 * verwendet (einzige Quelle der Wahrheit fuer diese Pruefung). Diese
 * Seite trifft KEINE eigene Berechtigungsentscheidung -- bei fehlender
 * Permission wirft `requireConfigPermission()` `ConfigAccessDeniedError`,
 * was hier zu einer generischen "Kein Zugriff"-Anzeige fuehrt.
 *
 * WICHTIGER UNTERSCHIED zu `/admin/rules` (ChatGPTs AP8-Leitplanke,
 * 2026-08-22): der Publish-Scope von `CommissionModelVersion` ist PRO
 * `CommissionModel`, NICHT mandantenweit -- diese Seite darf daher NICHT
 * den mandantenweiten Warnhinweis aus der Regelverwaltung uebernehmen.
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
import { listCommissionModels } from "@/server/admin/commission-admin";
import { CreateDraftCommissionModelVersionButton } from "@/components/admin/CreateDraftCommissionModelVersionButton";

export const dynamic = "force-dynamic";

const STATUS_LABELS: Record<string, string> = {
  DRAFT: "Entwurf",
  ACTIVE: "Aktiv",
  EXPIRED: "Abgelaufen",
  ARCHIVED: "Archiviert",
};

export default async function AdminCommissionsPage() {
  const session = await getOptionalServerSession();
  if (!session) {
    redirect("/login");
  }

  try {
    const commissionModels = await withServerSessionTenantContext(async (s) => {
      requireConfigPermission(s, "config.commissions.view");
      return listCommissionModels();
    });
    const canEdit = session.configPermissions.includes("config.commissions.edit");

    return (
      <main className="admin-questions">
        <h1>Provisionsmodelle</h1>
        <p className="admin-questions__hint">Angemeldet als {session.displayName}.</p>
        <p className="admin-questions__hint admin-commissions__publish-note">
          Hinweis: Veroeffentlichen betrifft ausschliesslich das jeweilige Provisionsmodell --
          andere Provisionsmodelle desselben Mandanten bleiben davon unberuehrt.
        </p>

        {commissionModels.length === 0 && (
          <p className="admin-questions__empty">Keine Provisionsmodelle vorhanden.</p>
        )}

        <ul className="admin-questions__list">
          {commissionModels.map((cm) => {
            // Analog Phase 9 AP8 (ChatGPT-Auflage nach AP9-E2E-Befund
            // 2026-08-19): explizit nur die ACTIVE-Version als Kopiervorlage
            // verwenden, kein Fallback auf eine beliebige historische
            // Version. Gibt es keine ACTIVE-Version, erzeugt der Button
            // bewusst einen Entwurf mit Standardwerten (FLAT/EUR/0), statt
            // eine falsche Quelle zu waehlen.
            const activeVersion = cm.versions.find((version) => version.status === "ACTIVE");
            return (
              <li key={cm.id} className="admin-questions__item">
                <h2>{cm.name}</h2>
                <ul className="admin-questions__versions">
                  {cm.versions.map((v) => (
                    <li key={v.id}>
                      <Link
                        href={`/admin/commissions/${cm.id}/versions/${v.id}`}
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
                  {cm.versions.length === 0 && (
                    <li className="admin-questions__empty">Keine Versionen vorhanden.</li>
                  )}
                </ul>
                {canEdit && (
                  <CreateDraftCommissionModelVersionButton
                    commissionModelId={cm.id}
                    copyFromVersionId={activeVersion?.id}
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
          <p>Fuer dieses Konto ist die Provisionsmodell-Verwaltung nicht freigeschaltet.</p>
        </main>
      );
    }
    throw error;
  }
}
