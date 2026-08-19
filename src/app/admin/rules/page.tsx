/**
 * `/admin/rules` (Phase 9 AP8, siehe PHASE_9_IMPLEMENTATION_PLAN.md
 * Abschnitt 9). Regelverwaltung-Einstiegsseite -- listet alle `RuleSet`s
 * dieses Mandanten mit ihren Versionen (Status-Badges), analog
 * `/admin/questions/page.tsx` (Phase 8 AP6).
 *
 * Server Component -- laedt Session + Daten serverseitig. Autorisierung
 * ausschliesslich ueber `requireConfigPermission(session, "config.rules.view")`
 * -- exakt dieselbe Funktion, die auch `GET /api/admin/rule-sets` verwendet
 * (einzige Quelle der Wahrheit fuer diese Pruefung). Diese Seite trifft
 * KEINE eigene Berechtigungsentscheidung -- bei fehlender Permission wirft
 * `requireConfigPermission()` `ConfigAccessDeniedError`, was hier zu einer
 * generischen "Kein Zugriff"-Anzeige fuehrt.
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
import { listRuleSets } from "@/server/admin/rule-admin";
import { CreateDraftRuleSetVersionButton } from "@/components/admin/CreateDraftRuleSetVersionButton";

export const dynamic = "force-dynamic";

const STATUS_LABELS: Record<string, string> = {
  DRAFT: "Entwurf",
  ACTIVE: "Aktiv",
  EXPIRED: "Abgelaufen",
  ARCHIVED: "Archiviert",
};

export default async function AdminRulesPage() {
  const session = await getOptionalServerSession();
  if (!session) {
    redirect("/login");
  }

  try {
    const ruleSets = await withServerSessionTenantContext(async (s) => {
      requireConfigPermission(s, "config.rules.view");
      return listRuleSets();
    });
    const canEdit = session.configPermissions.includes("config.rules.edit");

    return (
      <main className="admin-questions">
        <h1>Regelverwaltung</h1>
        <p className="admin-questions__hint">Angemeldet als {session.displayName}.</p>
        <p className="admin-questions__hint admin-rules__publish-warning">
          Hinweis: Die aktive Regelkonfiguration gilt mandantenweit -- unabhaengig davon, zu welchem
          RuleSet die aktuell aktive Version gehoert, ersetzt ein Publish sie.
        </p>

        {ruleSets.length === 0 && (
          <p className="admin-questions__empty">Keine RuleSets vorhanden.</p>
        )}

        <ul className="admin-questions__list">
          {ruleSets.map((rs) => {
            // ChatGPT-Auflage (AP9-E2E-Befund 2026-08-19): explizit nur die
            // ACTIVE-Version als Kopiervorlage verwenden -- kein Fallback auf
            // eine beliebige (z. B. neueste/erste) historische Version. Gibt
            // es keine ACTIVE-Version, bleibt copyFromVersionId undefined und
            // der Button erzeugt bewusst einen leeren Entwurf (bisheriges
            // Verhalten), statt eine falsche Quelle zu waehlen.
            const activeVersion = rs.versions.find((version) => version.status === "ACTIVE");
            return (
              <li key={rs.id} className="admin-questions__item">
                <h2>{rs.key}</h2>
                <ul className="admin-questions__versions">
                  {rs.versions.map((v) => (
                    <li key={v.id}>
                      <Link
                        href={`/admin/rules/${rs.id}/versions/${v.id}`}
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
                          {v.validTo
                            ? ` bis ${new Date(v.validTo).toLocaleDateString("de-DE")}`
                            : ""}
                        </span>
                      </Link>
                    </li>
                  ))}
                  {rs.versions.length === 0 && (
                    <li className="admin-questions__empty">Keine Versionen vorhanden.</li>
                  )}
                </ul>
                {canEdit && (
                  <CreateDraftRuleSetVersionButton
                    ruleSetId={rs.id}
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
          <p>Fuer dieses Konto ist die Regelverwaltung nicht freigeschaltet.</p>
        </main>
      );
    }
    throw error;
  }
}
