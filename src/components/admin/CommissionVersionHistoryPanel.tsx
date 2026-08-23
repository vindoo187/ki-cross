"use client";

/**
 * Versionshistorie fuer ein `CommissionModel` (Phase 10 AP8, siehe
 * PHASE_10_IMPLEMENTATION_PLAN.md Abschnitt 9, ChatGPT-GO 2026-08-22).
 * Analog `RuleVersionHistoryPanel.tsx` (Phase 9 AP8) /
 * `VersionHistoryPanel.tsx` (Phase 8 AP6), mit EINEM Unterschied: KEIN
 * Rollback-Button pro Zeile. `CommissionModelVersion` hat kein eigenes
 * `rollback`-Route-Pendant (siehe `commission-schemas.ts`
 * Modulkommentar zu `rollbackCommissionModelVersionSchema` -- "im
 * aktuellen Plan nicht als eigene AP vorgesehen") -- "Neuen Entwurf aus
 * dieser Version erstellen" auf der Detailseite selbst deckt denselben
 * Bedarf ab (siehe `CreateDraftCommissionModelVersionButton.tsx`). Dieses
 * Panel ist daher bewusst rein lesend, wie von ChatGPT im AP8-GO
 * gefordert ("Historische Versionen read-only").
 */

import Link from "next/link";
import type { CommissionModelVersionSummary } from "@/server/admin/commission-admin";

const STATUS_LABELS: Record<string, string> = {
  DRAFT: "Entwurf",
  ACTIVE: "Aktiv",
  EXPIRED: "Abgelaufen",
  ARCHIVED: "Archiviert",
};

interface CommissionVersionHistoryPanelProps {
  commissionModelId: string;
  currentVersionId: string;
  history: CommissionModelVersionSummary[];
}

export function CommissionVersionHistoryPanel({
  commissionModelId,
  currentVersionId,
  history,
}: CommissionVersionHistoryPanelProps) {
  return (
    <section className="admin-questions__history">
      <h2>Versionshistorie</h2>
      <ul className="admin-questions__history-list">
        {history.map((v) => (
          <li key={v.id} className="admin-questions__history-item">
            <Link
              href={`/admin/commissions/${commissionModelId}/versions/${v.id}`}
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
