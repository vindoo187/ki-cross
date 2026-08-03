"use client";

/**
 * Cross-Selling-Opportunity-Karte (AP8, siehe PHASE_5_IMPLEMENTATION_PLAN.md
 * Abschnitt 9). Analog zu `OutcomeDialog` (AP7): eingebettetes Panel, KEIN
 * Modal. Zeigt Bedarf/Grund aus dem zugehoerigen
 * `RecommendationCrossSellingSignal` (`needLabel`/`reasonText`, bereits
 * server-seitig in `buildConsultationRecommendationView()` uebersetzt --
 * siehe `view-models.ts`), sowie den aktuellen `SalesOpportunity`-Status.
 *
 * Mitarbeiter markiert den naechsten Status ueber
 * `PATCH /api/consultation/sales-opportunities/[id]`. Die hier gezeigten
 * Buttons je Status spiegeln NUR die Praesentationsschicht der in
 * `opportunity-status.ts` dokumentierten `ALLOWED_TRANSITIONS` -- die
 * eigentliche Durchsetzung bleibt ausschliesslich serverseitig
 * (`InvalidOpportunityStatusTransitionError`, z. B. bei einem veralteten,
 * bereits in einem anderen Tab weiterbewegten Status).
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { ConsultationCrossSellingSignalView } from "@/server/consultation-ui/view-models";

const STATUS_LABELS: Record<string, string> = {
  OPEN: "Offen",
  OFFERED: "Angeboten",
  ACCEPTED: "Angenommen",
  DECLINED: "Abgelehnt",
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

interface OpportunityCardProps {
  signal: ConsultationCrossSellingSignalView;
}

export function OpportunityCard({ signal }: OpportunityCardProps) {
  const router = useRouter();
  const [status, setStatus] = useState<"idle" | "submitting" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function submitStatus(nextStatus: "OFFERED" | "ACCEPTED" | "DECLINED" | "DEFERRED") {
    if (!signal.opportunity) {
      return;
    }
    setStatus("submitting");
    setErrorMessage(null);
    try {
      const response = await fetch(
        `/api/consultation/sales-opportunities/${signal.opportunity.id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: nextStatus }),
        },
      );
      if (response.ok) {
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

  return (
    <li className="opportunity-card">
      <p className="opportunity-card__need">{signal.needLabel}</p>
      <p className="opportunity-card__reason">{signal.reasonText}</p>
      {signal.suggestedProduct && (
        <p className="opportunity-card__product">
          Empfohlen: {signal.suggestedProduct.productName}
        </p>
      )}

      {!signal.opportunity ? (
        <p className="opportunity-card__missing">Kein Angebotsstatus verfuegbar.</p>
      ) : signal.opportunity.status === "ACCEPTED" || signal.opportunity.status === "DECLINED" ? (
        <p className="opportunity-card__decided">
          {STATUS_LABELS[signal.opportunity.status]}
          {signal.opportunity.resolvedAt
            ? ` am ${formatDateTime(signal.opportunity.resolvedAt)}`
            : ""}
        </p>
      ) : (
        <div className="opportunity-card__actions">
          <p className="opportunity-card__status">
            Status: {STATUS_LABELS[signal.opportunity.status]}
          </p>
          {signal.opportunity.status === "OPEN" && (
            <button
              type="button"
              onClick={() => void submitStatus("OFFERED")}
              disabled={status === "submitting"}
            >
              Anbieten
            </button>
          )}
          {signal.opportunity.status === "OFFERED" && (
            <>
              <button
                type="button"
                onClick={() => void submitStatus("ACCEPTED")}
                disabled={status === "submitting"}
              >
                Angenommen
              </button>
              <button
                type="button"
                onClick={() => void submitStatus("DECLINED")}
                disabled={status === "submitting"}
              >
                Abgelehnt
              </button>
              <button
                type="button"
                onClick={() => void submitStatus("DEFERRED")}
                disabled={status === "submitting"}
              >
                Zurueckstellen
              </button>
            </>
          )}
          {signal.opportunity.status === "DEFERRED" && (
            <button
              type="button"
              onClick={() => void submitStatus("OFFERED")}
              disabled={status === "submitting"}
            >
              Erneut anbieten
            </button>
          )}
        </div>
      )}

      {status === "error" && errorMessage && (
        <p className="opportunity-card__error">{errorMessage}</p>
      )}
    </li>
  );
}
