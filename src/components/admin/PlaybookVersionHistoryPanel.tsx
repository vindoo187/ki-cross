"use client";

/**
 * Versionshistorie fuer ein `Playbook` (Phase 14 AP6, siehe
 * project_ki_cross_phase14_ap5_status.md, ChatGPT-GO 2026-08-31). Analog
 * `CampaignVersionHistoryPanel.tsx` (Phase 13 AP6): rein lesend, KEIN
 * Rollback-Button pro Zeile -- `PlaybookVersion` hat (wie
 * `CampaignVersion`) kein eigenes `rollback`-Route-Pendant (siehe
 * `playbook-schemas.ts`-Modulkommentar zu
 * `createDraftPlaybookVersionSchema`). "Neuen Entwurf aus dieser Version
 * erstellen" (`CreateDraftPlaybookVersionButton` mit `copyFromVersionId`)
 * auf der Detailseite selbst deckt denselben Bedarf ab, identisches
 * Prinzip wie bei Kampagnen/Provisionsmodellen.
 */

import Link from "next/link";
import type { PlaybookVersionSummary } from "@/server/admin/playbook-admin";

const STATUS_LABELS: Record<string, string> = {
  DRAFT: "Entwurf",
  ACTIVE: "Aktiv",
  EXPIRED: "Abgelaufen",
  ARCHIVED: "Archiviert",
};

interface PlaybookVersionHistoryPanelProps {
  playbookId: string;
  currentVersionId: string;
  history: PlaybookVersionSummary[];
}

export function PlaybookVersionHistoryPanel({
  playbookId,
  currentVersionId,
  history,
}: PlaybookVersionHistoryPanelProps) {
  return (
    <section className="admin-questions__history">
      <h2>Versionshistorie</h2>
      <ul className="admin-questions__history-list">
        {history.map((v) => (
          <li key={v.id} className="admin-questions__history-item">
            <Link
              href={`/admin/playbooks/${playbookId}/versions/${v.id}`}
              aria-current={v.id === currentVersionId ? "page" : undefined}
            >
              <span>Version {v.versionNumber}</span>
              <span className={`admin-questions__badge admin-questions__badge--${v.status}`}>
                {STATUS_LABELS[v.status] ?? v.status}
              </span>
            </Link>
            <span className="admin-questions__version-meta">
              seit {new Date(v.validFrom).toLocaleDateString("de-DE")}
              {v.validTo ? ` bis ${new Date(v.validTo).toLocaleDateString("de-DE")}` : ""}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
