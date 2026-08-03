"use client";

/**
 * Client-Komponente auf `/consultation/[sessionId]/summary`: markiert die
 * Beratung als abgeschlossen (AP10, `CONSULTATION_COMPLETED`, siehe
 * PHASE_5_IMPLEMENTATION_PLAN.md Abschnitt 10) ueber
 * `POST /api/consultation/sessions/[id]/summary/complete` und navigiert bei
 * Erfolg zurueck zur Uebersicht (`/consultation`). Ersetzt den zuvor reinen
 * `<Link>` "Zurueck zur Uebersicht" -- die Navigation ist jetzt an das
 * Abschluss-Ereignis gekoppelt, analog zum "Neue Beratung starten"-Muster in
 * `StartConsultationForm.tsx`.
 *
 * `completeConsultation()` ist idempotent (siehe `completion.ts`) -- ein
 * erneuter Klick (Doppelklick, erneuter Seitenaufruf) schreibt kein zweites
 * Event, daher ist hier keine zusaetzliche Client-seitige Absicherung
 * dagegen noetig.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";

interface CompleteConsultationButtonProps {
  consultationSessionId: string;
}

export function CompleteConsultationButton({
  consultationSessionId,
}: CompleteConsultationButtonProps) {
  const router = useRouter();
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function handleClick() {
    setStatus("loading");
    setErrorMessage(null);
    try {
      const response = await fetch(
        `/api/consultation/sessions/${consultationSessionId}/summary/complete`,
        { method: "POST" },
      );
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        setErrorMessage(
          typeof body?.message === "string"
            ? body.message
            : "Beratung konnte nicht abgeschlossen werden.",
        );
        setStatus("error");
        return;
      }
      router.push("/consultation");
    } catch {
      setErrorMessage("Verbindung zum Server fehlgeschlagen.");
      setStatus("error");
    }
  }

  return (
    <div className="complete-consultation">
      <button type="button" onClick={handleClick} disabled={status === "loading"}>
        {status === "loading" ? "Wird abgeschlossen…" : "Beratung abschliessen"}
      </button>
      {status === "error" && errorMessage && (
        <p role="alert" className="complete-consultation__error">
          {errorMessage}
        </p>
      )}
    </div>
  );
}
