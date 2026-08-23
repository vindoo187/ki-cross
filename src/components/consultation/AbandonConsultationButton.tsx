"use client";

/**
 * "Beratung abbrechen"-Button (AP10, siehe Projektleiter-Entscheidung zum
 * manuellen Abbruchflow vom 2026-08-03). Bewusst als eingebettetes,
 * NICHT-modales Panel umgesetzt -- analog zu `OutcomeDialog` (AP7): ein
 * echtes `<dialog>`-Modal wuerde den uebrigen Beratungskontext verdecken.
 *
 * Verbindliche Semantik laut Projektleiter-Entscheidung:
 * - Button waehrend einer aktiven Beratung erreichbar (Sichtbarkeits-Gate
 *   `status === "IN_PROGRESS"` liegt bei den aufrufenden Seiten, nicht hier
 *   -- diese Komponente ist reine Interaktion).
 * - Vor dem eigentlichen Abbruch erscheint eine Bestaetigung (zweistufig:
 *   erst Klick auf "Beratung abbrechen" oeffnet das Bestaetigungspanel, erst
 *   der zweite Klick auf "Abbruch bestaetigen" sendet den Request).
 * - Optionaler strukturierter Abbruchgrund (Radiobuttons, kein Freitext,
 *   analog zur Ablehnungsgrund-Auswahl in `OutcomeDialog`) -- Auswahl ist
 *   NICHT verpflichtend, "Abbruch bestaetigen" ist auch ohne Auswahl aktiv.
 * - Ein 409 (`ConsultationAlreadyCompletedError`, z. B. weil die Sitzung
 *   zwischenzeitlich per `CompleteConsultationButton` abgeschlossen wurde)
 *   wird als fachliche Meldung dargestellt, nicht als technischer Fehler.
 * - Nach erfolgreichem Abbruch (inkl. idempotentem Doppelklick-Fall,
 *   `alreadyAbandoned: true`) fuehrt die UI aus dem aktiven Beratungsflow
 *   heraus (`router.push("/consultation")`, analog zu
 *   `CompleteConsultationButton`).
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { ConsultationAbandonReasonCode } from "@/server/consultation-ui/abandonment";

const REASON_OPTIONS: { code: ConsultationAbandonReasonCode; label: string }[] = [
  { code: "CUSTOMER_DOES_NOT_WANT_TO_CONTINUE", label: "Kunde moechte nicht fortfahren" },
  { code: "CUSTOMER_HAS_NO_TIME", label: "Kunde hat keine Zeit" },
  { code: "TECHNICAL_ISSUE", label: "Technischer Abbruch" },
  { code: "OTHER", label: "Sonstiger Grund" },
];

interface AbandonConsultationButtonProps {
  consultationSessionId: string;
}

async function parseErrorBody(response: Response): Promise<{ message: string }> {
  try {
    const body = (await response.json()) as { message?: string };
    return { message: body.message ?? "Unbekannter Fehler." };
  } catch {
    return { message: "Unbekannter Fehler." };
  }
}

export function AbandonConsultationButton({
  consultationSessionId,
}: AbandonConsultationButtonProps) {
  const router = useRouter();
  const [mode, setMode] = useState<"idle" | "confirming">("idle");
  const [reasonCode, setReasonCode] = useState<ConsultationAbandonReasonCode | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function handleConfirm() {
    setStatus("loading");
    setErrorMessage(null);
    try {
      const response = await fetch(
        `/api/consultation/sessions/${consultationSessionId}/summary/abandon`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(reasonCode ? { reasonCode } : {}),
        },
      );
      if (response.ok) {
        router.push("/consultation");
        return;
      }
      const body = await parseErrorBody(response);
      setErrorMessage(
        response.status === 409
          ? "Diese Beratung wurde bereits abgeschlossen und kann daher nicht mehr abgebrochen werden."
          : body.message,
      );
      setStatus("error");
    } catch {
      setErrorMessage("Verbindung zum Server fehlgeschlagen.");
      setStatus("error");
    }
  }

  if (mode === "idle") {
    return (
      <div className="abandon-consultation">
        <button type="button" onClick={() => setMode("confirming")} disabled={status === "loading"}>
          Beratung abbrechen
        </button>
        {status === "error" && errorMessage && (
          <p role="alert" className="abandon-consultation__error">
            {errorMessage}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="abandon-consultation abandon-consultation--confirming">
      <p className="abandon-consultation__confirm-label">
        Beratung wirklich abbrechen? Bereits erfasste Antworten und Empfehlungen bleiben erhalten,
        eine Wiederaufnahme ist jedoch nicht moeglich -- es muss eine neue Beratung gestartet
        werden.
      </p>

      <p className="abandon-consultation__reason-label">Abbruchgrund (optional):</p>
      <ul className="abandon-consultation__reason-list">
        {REASON_OPTIONS.map((option) => (
          <li key={option.code} className="abandon-consultation__reason-option">
            <label>
              <input
                type="radio"
                name={`abandon-reason-${consultationSessionId}`}
                value={option.code}
                checked={reasonCode === option.code}
                onChange={() => setReasonCode(option.code)}
              />
              {option.label}
            </label>
          </li>
        ))}
      </ul>

      <div className="abandon-consultation__actions">
        <button type="button" onClick={() => void handleConfirm()} disabled={status === "loading"}>
          {status === "loading" ? "Wird abgebrochen…" : "Abbruch bestaetigen"}
        </button>
        <button
          type="button"
          onClick={() => {
            setMode("idle");
            setReasonCode(null);
            setErrorMessage(null);
            setStatus("idle");
          }}
          disabled={status === "loading"}
        >
          Zurueck
        </button>
      </div>

      {status === "error" && errorMessage && (
        <p role="alert" className="abandon-consultation__error">
          {errorMessage}
        </p>
      )}
    </div>
  );
}
