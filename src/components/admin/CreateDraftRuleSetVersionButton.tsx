"use client";

/**
 * Erstellt eine neue DRAFT-`RuleSetVersion` (Phase 9 AP8, siehe
 * PHASE_9_IMPLEMENTATION_PLAN.md Abschnitt 9). Analog
 * `CreateDraftVersionButton.tsx` (Phase 8 AP6), aber `copyFromVersionId`
 * darf hier bewusst zu einem ANDEREN `RuleSet` desselben Mandanten gehoeren
 * (mandantenweiter ACTIVE-Scope, siehe `rule-admin.ts` Modulkommentar) --
 * die UI schraenkt das NICHT zusaetzlich ein, das entscheidet ausschliesslich
 * `createDraftRuleSetVersion()`. Ruft ausschliesslich `POST
 * /api/admin/rule-sets/:id/versions` auf. Nach Erfolg Weiterleitung auf die
 * neue DRAFT-Version.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";

interface CreateDraftRuleSetVersionButtonProps {
  ruleSetId: string;
  copyFromVersionId?: string;
  label: string;
}

export function CreateDraftRuleSetVersionButton({
  ruleSetId,
  copyFromVersionId,
  label,
}: CreateDraftRuleSetVersionButtonProps) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    const versionLabel = window.prompt("Bezeichnung fuer den neuen Entwurf:", "Neuer Entwurf");
    if (!versionLabel) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/admin/rule-sets/${ruleSetId}/versions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: versionLabel, copyFromVersionId }),
      });
      if (response.ok) {
        const body = (await response.json()) as { version: { id: string } };
        router.push(`/admin/rules/${ruleSetId}/versions/${body.version.id}`);
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
