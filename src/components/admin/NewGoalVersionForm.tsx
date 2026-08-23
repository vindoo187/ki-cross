"use client";

/**
 * Formular fuer "Neue Zielkorrektur erfassen" (Phase 11 AP6, siehe
 * PHASE_11_IMPLEMENTATION_PLAN.md Abschnitt 9, ChatGPT-GO 2026-08-22).
 * Zeigt AUSSCHLIESSLICH das zur `metricKey` des Goal passende Zielwert-Feld
 * (kein Scope-/Metrik-/Periodenfeld -- diese gehoeren zur unveraenderlichen
 * Goal-Identitaet, siehe `goal-schemas.ts`-Modulkommentar) und ruft direkt
 * `POST /api/admin/goals/[id]/versions` auf.
 *
 * BEWUSST KEIN Entwurfsstadium: die neue `GoalVersion` wirkt SOFORT nach
 * dem Absenden (wird automatisch die aktuelle Version ueber die hoechste
 * `versionNumber`, siehe `getCurrentGoalVersion()` in `goal-admin.ts`) --
 * der Sicherheitshinweis im Formular macht das fuer den Admin explizit
 * sichtbar (ChatGPTs ausdrueckliche AP6-Vorgabe).
 */

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { GoalTargetValueFields } from "./GoalTargetValueFields";

interface NewGoalVersionFormProps {
  goalId: string;
  metricKey: string;
}

export function NewGoalVersionForm({ goalId, metricKey }: NewGoalVersionFormProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [targetCount, setTargetCount] = useState("");
  const [targetAmountMajor, setTargetAmountMajor] = useState("");
  const [targetPercentage, setTargetPercentage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const payload: Record<string, unknown> = {};
      if (metricKey === "DEALS_CLOSED") {
        payload.targetCount = targetCount === "" ? null : Number(targetCount);
      } else if (metricKey === "REVENUE") {
        payload.targetAmountMinor =
          targetAmountMajor === "" ? null : Math.round(Number(targetAmountMajor) * 100);
      } else if (metricKey === "CLOSE_RATE") {
        payload.targetPercentageBasisPoints =
          targetPercentage === "" ? null : Math.round(Number(targetPercentage) * 100);
      }

      const response = await fetch(`/api/admin/goals/${goalId}/versions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (response.ok) {
        setOpen(false);
        setTargetCount("");
        setTargetAmountMajor("");
        setTargetPercentage("");
        router.refresh();
        return;
      }
      const body = (await response.json().catch(() => ({}))) as {
        message?: string;
        issues?: Array<{ message: string }>;
      };
      setError(
        body.issues?.map((i) => i.message).join("; ") ??
          body.message ??
          "Zielkorrektur konnte nicht erfasst werden.",
      );
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="admin-goals__create-button">
        Neue Zielkorrektur erfassen
      </button>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="admin-goals__form">
      <h2>Neue Zielkorrektur erfassen</h2>
      <p className="admin-questions__hint">
        Wirkt sofort als neue aktuelle Version -- alte Werte bleiben unveraendert in der Historie
        erhalten.
      </p>

      <GoalTargetValueFields
        metricKey={metricKey}
        targetCount={targetCount}
        onTargetCountChange={setTargetCount}
        targetAmountMajor={targetAmountMajor}
        onTargetAmountMajorChange={setTargetAmountMajor}
        currency=""
        onCurrencyChange={() => {}}
        includeCurrency={false}
        targetPercentage={targetPercentage}
        onTargetPercentageChange={setTargetPercentage}
      />

      {error && <p className="admin-questions__error">{error}</p>}

      <div className="admin-goals__form-actions">
        <button type="submit" disabled={busy}>
          Zielkorrektur speichern
        </button>
        <button type="button" onClick={() => setOpen(false)} disabled={busy}>
          Abbrechen
        </button>
      </div>
    </form>
  );
}
