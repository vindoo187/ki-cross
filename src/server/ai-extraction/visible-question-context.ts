/**
 * ChatGPT-Schicht 2 "Visible-Question Context" (Phase 12 AP1, siehe
 * PHASE_12_IMPLEMENTATION_PLAN.md Abschnitt 1 Punkt 8 + Abschnitt 2). Baut den
 * an die Extraktionskomponente uebergebenen, erlaubten Fragenkatalog
 * AUSSCHLIESSLICH aus bereits vorhandener Fragen-Engine-Logik
 * (`loadQuestionnaireState()`, Phase 3A) -- KEIN neuer Sichtbarkeits-Code.
 *
 * Harte Sicherheitsgrenze (ChatGPT, woertlich): "Die KI darf niemals selbst
 * bestimmen, welche Fragen sichtbar sind. Der Server berechnet zuerst den
 * aktuellen sichtbaren Fragenkatalog. Nur dieser Katalog darf an die
 * Extraktionskomponente gehen." -- diese Funktion IST diese serverseitige
 * Berechnung; die (noch zu bauende, AP2) API-Route darf den Fragenkatalog
 * niemals vom Client entgegennehmen.
 *
 * Zwei zusaetzliche Filter (ChatGPT-Entscheidungen 3+4, siehe
 * PHASE_12_IMPLEMENTATION_PLAN.md Abschnitt 1):
 * - NUR unbeantwortete Fragen sind KI-Kandidaten (kein Alt-Neu-Vorschlag bei
 *   bereits beantworteten Fragen -- eine bestehende `CustomerAnswer` wird nie
 *   angetastet).
 * - `SHORT_TEXT`-Fragen sind als KI-Ziel vollstaendig ausgeschlossen.
 */

import { loadQuestionnaireState } from "../questionnaire/service";
import type { AiExtractionVisibleQuestion } from "./types";

/**
 * Laedt den aktuellen Zustand der Beratung (`consultationSessionId`) und
 * filtert ihn auf den fuer die KI-Extraktion erlaubten Fragenkatalog. Wirft
 * `ConsultationSessionNotFoundError`, wenn die Session nicht existiert
 * (Fehlerklasse aus `../questionnaire/errors`, wird 1:1 durchgereicht --
 * dieselbe Fehlerbehandlung wie beim normalen Fragen-Flow).
 */
export async function buildVisibleQuestionContext(
  consultationSessionId: string,
): Promise<AiExtractionVisibleQuestion[]> {
  const state = await loadQuestionnaireState(consultationSessionId);

  return state.visibleQuestions
    .filter((q) => q.answerType !== "SHORT_TEXT")
    .filter((q) => q.currentAnswer === null)
    .map((q) => ({
      questionId: q.questionId,
      label: q.label,
      answerType: q.answerType as AiExtractionVisibleQuestion["answerType"],
      answerOptions: q.answerOptions,
      minValue: q.minValue,
      maxValue: q.maxValue,
      maxLength: q.maxLength,
      minSelections: q.minSelections,
      maxSelections: q.maxSelections,
    }));
}
