"use client";

/**
 * Versionshistorie mit Rollback-Aktion (Phase 8 AP6, siehe
 * PHASE_8_IMPLEMENTATION_PLAN.md Abschnitt 9). Zeigt alle Versionen eines
 * Questionnaire (`GET .../versions`, AP5) und bietet fuer bereits
 * veroeffentlichte Versionen (ACTIVE/EXPIRED/ARCHIVED) einen
 * Rollback-Button, der `POST .../rollback` aufruft (`rollbackToVersion()`)
 * -- erzeugt einen neuen Entwurf als Tiefkopie, KEIN direkter
 * Statuswechsel. Nach erfolgreichem Rollback Weiterleitung auf die neue
 * DRAFT-Version.
 *
 * DRAFT-Versionen erhalten bewusst KEINEN Rollback-Button (Rollback aus
 * einem Entwurf ist unzulaessig, siehe `RollbackSourceNotEligibleError` in
 * `question-admin-errors.ts`) -- stattdessen kann eine DRAFT-Version direkt
 * geoeffnet werden.
 */

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { QuestionnaireVersionSummary } from "@/server/admin/question-admin";

const STATUS_LABELS: Record<string, string> = {
  DRAFT: "Entwurf",
  ACTIVE: "Aktiv",
  EXPIRED: "Abgelaufen",
  ARCHIVED: "Archiviert",
};

interface VersionHistoryPanelProps {
  questionnaireId: string;
  currentVersionId: string;
  history: QuestionnaireVersionSummary[];
  canEdit: boolean;
}

export function VersionHistoryPanel({
  questionnaireId,
  currentVersionId,
  history,
  canEdit,
}: VersionHistoryPanelProps) {
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
        `/api/admin/questionnaires/${questionnaireId}/versions/${versionId}/rollback`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        },
      );
      if (response.ok) {
        const body = (await response.json()) as { version: { id: string } };
        router.push(`/admin/questions/${questionnaireId}/versions/${body.version.id}`);
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
            <Link href={`/admin/questions/${questionnaireId}/versions/${v.id}`}>
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
