"use client";

/**
 * Client-Komponente auf `/consultation`: startet eine neue Beratungssitzung
 * ueber `POST /api/consultation/sessions` und leitet bei Erfolg zur neuen
 * Sitzung weiter (siehe PHASE_5_IMPLEMENTATION_PLAN.md Abschnitt 5, Schritt
 * 2). `storeId`/`employeeId` werden serverseitig aus der Session ermittelt,
 * hier NICHT abgefragt (siehe schemas.ts Modulkommentar).
 */

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import type { ActiveQuestionnaireSummary } from "@/server/consultation-ui/view-models";

interface StartConsultationFormProps {
  questionnaires: ActiveQuestionnaireSummary[];
}

export function StartConsultationForm({ questionnaires }: StartConsultationFormProps) {
  const router = useRouter();
  const [questionnaireKey, setQuestionnaireKey] = useState(
    questionnaires[0]?.questionnaireKey ?? "",
  );
  const [consultationType, setConsultationType] = useState<"NEW_CONTRACT" | "RENEWAL">(
    "NEW_CONTRACT",
  );
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!questionnaireKey) {
      return;
    }
    setStatus("loading");
    setErrorMessage(null);
    try {
      const response = await fetch("/api/consultation/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ questionnaireKey, consultationType }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        setErrorMessage(
          typeof body?.message === "string"
            ? body.message
            : "Beratung konnte nicht gestartet werden.",
        );
        setStatus("error");
        return;
      }
      const state = (await response.json()) as { consultationSessionId: string };
      router.push(`/consultation/${state.consultationSessionId}`);
    } catch {
      setErrorMessage("Verbindung zum Server fehlgeschlagen.");
      setStatus("error");
    }
  }

  if (questionnaires.length === 0) {
    return <p>Kein aktiver Fragebogen verfuegbar. Bitte Fragebogen-Verwaltung pruefen.</p>;
  }

  return (
    <form className="start-consultation-form" onSubmit={handleSubmit}>
      {questionnaires.length > 1 && (
        <label className="start-consultation-form__field">
          <span>Fragebogen</span>
          <select
            value={questionnaireKey}
            onChange={(event) => setQuestionnaireKey(event.target.value)}
          >
            {questionnaires.map((q) => (
              <option key={q.questionnaireKey} value={q.questionnaireKey}>
                {q.label}
              </option>
            ))}
          </select>
        </label>
      )}

      <label className="start-consultation-form__field">
        <span>Art der Beratung</span>
        <select
          value={consultationType}
          onChange={(event) =>
            setConsultationType(event.target.value as "NEW_CONTRACT" | "RENEWAL")
          }
        >
          <option value="NEW_CONTRACT">Neuvertrag</option>
          <option value="RENEWAL">Vertragsverlaengerung</option>
        </select>
      </label>

      <button type="submit" disabled={status === "loading"}>
        {status === "loading" ? "Startet…" : "Neue Beratung starten"}
      </button>

      {status === "error" && errorMessage && (
        <p role="alert" className="start-consultation-form__error">
          {errorMessage}
        </p>
      )}
    </form>
  );
}
