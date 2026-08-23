"use client";

/**
 * Versionshistorie mit Rollback-Aktion fuer ein `RuleSet` (Phase 9 AP8,
 * siehe PHASE_9_IMPLEMENTATION_PLAN.md Abschnitt 9). Analog
 * `VersionHistoryPanel.tsx` (Phase 8 AP6): zeigt alle Versionen dieses
 * `RuleSet` (`GET .../versions`, AP6) und bietet fuer bereits
 * veroeffentlichte Versionen (ACTIVE/EXPIRED/ARCHIVED) einen
 * Rollback-Button (`POST .../rollback`, AP6) -- erzeugt einen neuen Entwurf
 * als Tiefkopie DESSELBEN `RuleSet`, KEIN direkter Statuswechsel.
 *
 * DRAFT-Versionen erhalten bewusst KEINEN Rollback-Button (Rollback aus
 * einem Entwurf ist unzulaessig, siehe `RollbackSourceNotEligibleError` in
 * `rule-admin-errors.ts`) -- eine DRAFT-Version kann stattdessen direkt
 * geoeffnet werden.
 */

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { RuleSetVersionSummary } from "@/server/admin/rule-admin";

const STATUS_LABELS: Record<string, string> = {
  DRAFT: "Entwurf",
  ACTIVE: "Aktiv",
  EXPIRED: "Abgelaufen",
  ARCHIVED: "Archiviert",
};

interface RuleVersionHistoryPanelProps {
  ruleSetId: string;
  currentVersionId: string;
  history: RuleSetVersionSummary[];
  canEdit: boolean;
}

export function RuleVersionHistoryPanel({
  ruleSetId,
  currentVersionId,
  history,
  canEdit,
}: RuleVersionHistoryPanelProps) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleRollback(versionId: string) {
    if (
      !window.confirm("Rollback erstellt einen neuen Entwurf als Kopie dieser Version. Fortfahren?")
    ) {
      return;
    }
    setBusyId(versionId);
    setError(null);
    try {
      const response = await fetch(
        `/api/admin/rule-sets/${ruleSetId}/versions/${versionId}/rollback`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        },
      );
      if (response.ok) {
        const body = (await response.json()) as { version: { id: string } };
        router.push(`/admin/rules/${ruleSetId}/versions/${body.version.id}`);
        return;
      }
      const body = (await response.json().catch(() => ({}))) as { message?: string };
      setError(body.message ?? "Rollback fehlgeschlagen.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section className="admin-questions__history">
      <h2>Versionshistorie</h2>
      {error && <p className="admin-questions__error">{error}</p>}
      <ul className="admin-questions__history-list">
        {history.map((v) => (
          <li key={v.id} className="admin-questions__history-item">
            <Link href={`/admin/rules/${ruleSetId}/versions/${v.id}`}>
              <span>{v.label}</span>
              <span className={`admin-questions__badge admin-questions__badge--${v.status}`}>
                {STATUS_LABELS[v.status] ?? v.status}
              </span>
            </Link>
            <span className="admin-questions__version-meta">
              seit {new Date(v.validFrom).toLocaleDateString("de-DE")}
              {v.validTo ? ` bis ${new Date(v.validTo).toLocaleDateString("de-DE")}` : ""}
            </span>
            {canEdit && v.status !== "DRAFT" && v.id !== currentVersionId && (
              <button
                type="button"
                onClick={() => handleRollback(v.id)}
                disabled={busyId !== null}
                className="admin-questions__rollback-button"
              >
                Rollback
              </button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
