"use client";

/**
 * Erstellt eine neue DRAFT-Version (Phase 8 AP6, siehe
 * PHASE_8_IMPLEMENTATION_PLAN.md Abschnitt 9) -- entweder leer oder als
 * Kopie einer bestehenden Version (`copyFromVersionId`, AP3
 * `createDraftVersion()`). Ruft ausschliesslich `POST .../versions` auf.
 * Nach Erfolg Weiterleitung auf die neue DRAFT-Version.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";

interface CreateDraftVersionButtonProps {
  questionnaireId: string;
  copyFromVersionId?: string;
  label: string;
}

export function CreateDraftVersionButton({
  questionnaireId,
  copyFromVersionId,
  label,
}: CreateDraftVersionButtonProps) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    const versionLabel = window.prompt("Bezeichnung fuer den neuen Entwurf:", "Neuer Entwurf");
    if (!versionLabel) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/admin/questionnaires/${questionnaireId}/versions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: versionLabel, copyFromVersionId }),
      });
      if (response.ok) {
        const body = (await response.json()) as { version: { id: string } };
        router.push(`/admin/questions/${questionnaireId}/versions/${body.version.id}`);
        return;
      }
      const body = (await response.json().catch(() => ({}))) as { message?: string };
      setError(body.message ?? "Entwurf konnte nicht erstellt werden.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <button type="button" onClick={handleClick} disabled={busy}>
        {label}
      </button>
      {error && <p className="admin-questions__error">{error}</p>}
    </div>
  );
}
