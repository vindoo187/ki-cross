/**
 * Ableitung des Fragebogen-Laufstatus (`QuestionnaireRunStatus`) aus dem
 * bestehenden `ConsultationStatus` plus Zusatzinformation, statt eines
 * eigenen, redundant persistierten Status-Felds.
 *
 * Offene Design-Frage aus PHASE_3A_STARTPROMPT.md: der Prompt verlangt
 * konzeptionell Zustaende wie NOT_STARTED/NEEDS_REVIEW, das bestehende
 * `ConsultationStatus`-Enum (IN_PROGRESS/COMPLETED/ABANDONED) kennt diese
 * nicht. Entscheidung (siehe docs/DECISION_LOG.md): KEINE Schema-Aenderung -
 * `ConsultationStatus` wird 1:1 uebernommen (erfuellt "dieselbe Bedeutung"
 * fuer IN_PROGRESS/COMPLETED/ABANDONED), NEEDS_REVIEW wird stattdessen rein
 * abgeleitet erkannt (eine aktive Antwort wurde NACH dem Abschlusszeitpunkt
 * geaendert), um keine zweite, potenziell divergierende Wahrheitsquelle fuer
 * denselben Sachverhalt einzufuehren. NOT_STARTED ist kein Zustand einer
 * bereits existierenden ConsultationSession-Zeile (die Zeile entsteht erst
 * bei `startQuestionnaire()`, bereits MIT gesetzter, unveraenderlicher
 * questionnaireVersionId) und wird daher hier bewusst nicht abgebildet -
 * er ist nur vor dem ersten `startQuestionnaire()`-Aufruf "wahr" und dort
 * nie als persistierter Zustand beobachtbar.
 */

import type { QuestionnaireRunStatus } from "./types";

export interface SessionStatusInput {
  status: "IN_PROGRESS" | "COMPLETED" | "ABANDONED";
  /** ISO-8601, oder null solange die Sitzung noch laeuft. */
  endedAt: string | null;
}

/**
 * @param latestActiveAnswerAnsweredAt ISO-8601-Zeitstempel der zuletzt
 *   geaenderten AKTIVEN Antwort dieser Sitzung, oder null falls keine
 *   Antworten vorhanden sind.
 */
export function deriveQuestionnaireRunStatus(
  session: SessionStatusInput,
  latestActiveAnswerAnsweredAt: string | null,
): QuestionnaireRunStatus {
  if (session.status === "ABANDONED") return "ABANDONED";
  if (session.status === "IN_PROGRESS") return "IN_PROGRESS";

  // status === "COMPLETED"
  if (session.endedAt && latestActiveAnswerAnsweredAt) {
    if (Date.parse(latestActiveAnswerAnsweredAt) > Date.parse(session.endedAt)) {
      return "NEEDS_REVIEW";
    }
  }
  return "COMPLETED";
}
