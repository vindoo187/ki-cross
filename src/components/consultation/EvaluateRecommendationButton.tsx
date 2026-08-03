"use client";

/**
 * Loest die Empfehlungsauswertung aus (Plan Abschnitt 5, Schritt 6:
 * `POST /api/consultation/sessions/[id]/recommendation` -> `evaluate()`).
 * Wird auf `/consultation/[sessionId]/recommendation` gezeigt, solange noch
 * keine `Recommendation` fuer die Session existiert (`getLatestRecommendation()`
 * liefert `null`). Nach Erfolg: `router.refresh()` laedt die Server
 * Component neu, die dann `getLatestRecommendation()` erneut aufruft --
 * kein eigener Client-State fuer das Ergebnis noetig (Plan Abschnitt 4:
 * "kein paralleler Schattenzustand").
 */

import { useState } from "react";
import { useRouter } from "next/navigation";

async function parseErrorBody(response: Response): Promise<{ message: string }> {
  try {
    const body = (await response.json()) as { message?: string };
    return { message: body.message ?? "Unbekannter Fehler." };
  } catch {
    return { message: "Unbekannter Fehler." };
  }
}

interface EvaluateRecommendationButtonProps {
  sessionId: string;
}

export function EvaluateRecommendationButton({ sessionId }: EvaluateRecommendationButtonProps) {
  const router = useRouter();
  const [status, setStatus] = useState<"idle" | "evaluating" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function evaluate() {
    setStatus("evaluating");
    setErrorMessage(null);
    try {
      const response = await fetch(`/api/consultation/sessions/${sessionId}/recommendation`, {
        method: "POST",
      });
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
    <div className="evaluate-recommendation">
      <p>Fuer diese Beratung liegt noch keine Empfehlung vor.</p>
      <button type="button" onClick={evaluate} disabled={status === "evaluating"}>
        {status === "evaluating" ? "Wertet aus…" : "Empfehlung auswerten"}
      </button>
      {status === "error" && errorMessage && (
        <p className="evaluate-recommendation__error">{errorMessage}</p>
      )}
    </div>
  );
}
