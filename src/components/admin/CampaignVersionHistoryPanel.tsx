"use client";

/**
 * Versionshistorie fuer eine `Campaign` (Phase 13 AP6, siehe
 * PHASE_13_IMPLEMENTATION_PLAN.md Abschnitt 3, ChatGPT-GO 2026-08-30).
 * Analog `CommissionVersionHistoryPanel.tsx` (Phase 10 AP8): rein lesend,
 * KEIN Rollback-Button pro Zeile -- `CampaignVersion` hat (wie
 * `CommissionModelVersion`) kein eigenes `rollback`-Route-Pendant (siehe
 * `campaign-schemas.ts`-Modulkommentar zu `createDraftCampaignVersionSchema`:
 * "keine eigene rollback*()-Funktion noetig"). "Neuen Entwurf aus dieser
 * Version erstellen" (`CreateDraftCampaignVersionButton` mit
 * `copyFromVersionId`) auf der Detailseite selbst deckt denselben Bedarf
 * ab, identisches Prinzip wie bei Commission-Modellen.
 */

import Link from "next/link";
import type { CampaignVersionSummary } from "@/server/admin/campaign-admin";

const STATUS_LABELS: Record<string, string> = {
  DRAFT: "Entwurf",
  ACTIVE: "Aktiv",
  EXPIRED: "Abgelaufen",
  ARCHIVED: "Archiviert",
};

interface CampaignVersionHistoryPanelProps {
  campaignId: string;
  currentVersionId: string;
  history: CampaignVersionSummary[];
}

export function CampaignVersionHistoryPanel({
  campaignId,
  currentVersionId,
  history,
}: CampaignVersionHistoryPanelProps) {
  return (
    <section className="admin-questions__history">
      <h2>Versionshistorie</h2>
      <ul className="admin-questions__history-list">
        {history.map((v) => (
          <li key={v.id} className="admin-questions__history-item">
            <Link
              href={`/admin/campaigns/${campaignId}/versions/${v.id}`}
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
