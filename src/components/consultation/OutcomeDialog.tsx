"use client";

/**
 * Ablehnungs-/Entscheidungsflow pro `RecommendationCard` (AP7, siehe
 * PHASE_5_IMPLEMENTATION_PLAN.md Abschnitt 8). Bewusst als eingebettetes,
 * NICHT-modales Panel umgesetzt (analog zu `RationaleDrawer`, AP6) -- ein
 * echtes `<dialog>`-Modal wuerde die uebrigen Empfehlungskarten verdecken,
 * was Plan Abschnitt 4.7 ("wichtige Aktionen ohne Verlust des
 * Gespraechskontexts erreichbar") widerspricht. Der Komponentenname
 * `OutcomeDialog` folgt trotzdem der Benennung aus Plan Abschnitt 3/16.
 *
 * Enthaelt bewusst KEIN Freitextfeld: `RecordRecommendationOutcomeInput`
 * (`src/server/recommendation/outcome.ts`) hat kein entsprechendes Feld --
 * eine bereits in AP5 bewusst nicht geschlossene Schema-/Doku-Luecke (siehe
 * Modulkommentar dort). Diese Komponente uebernimmt diese Entscheidung,
 * statt sie eigenmaechtig neu zu treffen.
 *
 * Jedes RecommendationItem kann genau EINMAL entschieden werden
 * (`RecommendationOutcome` ist append-only). Existiert bereits ein Outcome
 * (`item.outcome`, aus `view-models.ts`/`loadOutcomesByItemIds()`), zeigt
 * diese Komponente nur noch den bereits gespeicherten Stand -- keine
 * Buttons mehr. Ein 409 (`RecommendationOutcomeAlreadyExistsError`, z. B.
 * durch einen Doppel-Request bei Mehrfachklick) wird nicht als technischer
 * Fehler dargestellt, sondern loest `router.refresh()` aus, damit die Seite
 * den kanonischen, bereits gespeicherten Stand laedt (Plan Abschnitt 8).
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import type {
  RecommendationOutcomeSummary,
  RejectionReasonOption,
} from "@/server/consultation-ui/view-models";

const OUTCOME_LABELS: Record<RecommendationOutcomeSummary["outcome"], string> = {
  ACCEPTED: "Angenommen",
  REJECTED: "Abgelehnt",
  DEFERRED: "Zurueckgestellt",
};

function formatDateTime(iso: string): string {
  return new Intl.DateTimeFormat("de-DE", { dateStyle: "medium", timeStyle: "short" }).format(
    new Date(iso),
  );
}

async function parseErrorBody(response: Response): Promise<{ message: string }> {
  try {
    const body = (await response.json()) as { message?: string };
    return { message: body.message ?? "Unbekannter Fehler." };
  } catch {
    return { message: "Unbekannter Fehler." };
  }
}

interface OutcomeDialogProps {
  recommendationItemId: string;
  outcome: RecommendationOutcomeSummary | null;
  rejectionReasons: RejectionReasonOption[];
}

export function OutcomeDialog({
  recommendationItemId,
  outcome,
  rejectionReasons,
}: OutcomeDialogProps) {
  const router = useRouter();
  const [mode, setMode] = useState<"idle" | "choosingReason">("idle");
  const [selectedReasonId, setSelectedReasonId] = useState<string | null>(null);
  const [status, setStatus] = useState<"idle" | "submitting" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function submitOutcome(
    value: "ACCEPTED" | "REJECTED" | "DEFERRED",
    rejectionReasonId?: string,
  ) {
    setStatus("submitting");
    setErrorMessage(null);
    try {
      const response = await fetch(
        `/api/consultation/recommendation-items/${recommendationItemId}/outcome`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ outcome: value, rejectionReasonId: rejectionReasonId ?? null }),
        },
      );
      if (response.ok) {
        router.refresh();
        return;
      }
      if (response.status === 409) {
        // Bereits (z. B. durch Doppelklick) entschieden -- kanonischen Stand nachladen.
        router.refresh();
        return;
      }
      const body = await parseErrorBody(response);
      setStatus("error");
      setErrorMessage(body.message);
    } catch {
      setStatus("error");
      setErrorMessage("Verbindung zum Server fehlgeschlagen.");
    }
  }

  if (outcome) {
    return (
      <p className="outcome-dialog__decided">
        {OUTCOME_LABELS[outcome.outcome]} am {formatDateTime(outcome.decidedAt)}
      </p>
    );
  }

  return (
    <div className="outcome-dialog">
      {mode === "idle" && (
        <div className="outcome-dialog__actions">
          <button
            type="button"
            onClick={() => void submitOutcome("ACCEPTED")}
            disabled={status === "submitting"}
          >
            Annehmen
          </button>
          <button
            type="button"
            onClick={() => setMode("choosingReason")}
            disabled={status === "submitting"}
          >
            Ablehnen
          </button>
          <button
            type="button"
            onClick={() => void submitOutcome("DEFERRED")}
            disabled={status === "submitting"}
          >
            Zurueckstellen
          </button>
        </div>
      )}

      {mode === "choosingReason" && (
        <div className="outcome-dialog__reasons">
          <p className="outcome-dialog__reasons-label">Ablehnungsgrund waehlen:</p>
          {rejectionReasons.length === 0 ? (
            <p className="outcome-dialog__reasons-empty">
              Keine Ablehnungsgruende hinterlegt -- Ablehnung derzeit nicht moeglich.
            </p>
          ) : (
            <ul className="outcome-dialog__reasons-list">
              {rejectionReasons.map((reason) => (
                <li key={reason.id} className="outcome-dialog__reason-option">
                  <label>
                    <input
                      type="radio"
                      name={`rejection-reason-${recommendationItemId}`}
                      value={reason.id}
                      checked={selectedReasonId === reason.id}
                      onChange={() => setSelectedReasonId(reason.id)}
                    />
                    {reason.label}
                  </label>
                </li>
              ))}
            </ul>
          )}
          <div className="outcome-dialog__reasons-actions">
            <button
              type="button"
              onClick={() => selectedReasonId && void submitOutcome("REJECTED", selectedReasonId)}
              disabled={!selectedReasonId || status === "submitting"}
            >
              Ablehnung bestaetigen
            </button>
            <button
              type="button"
              onClick={() => {
                setMode("idle");
                setSelectedReasonId(null);
                setErrorMessage(null);
              }}
              disabled={status === "submitting"}
            >
              Abbrechen
            </button>
          </div>
        </div>
      )}

      {status === "error" && errorMessage && (
        <p className="outcome-dialog__error">{errorMessage}</p>
      )}
    </div>
  );
}
