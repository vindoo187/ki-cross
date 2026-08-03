"use client";

/**
 * Client-seitiger Fragebogen-Arbeitsplatz (AP4). Orchestriert genau EINE
 * aktive Frage zur Zeit (siehe PHASE_5_IMPLEMENTATION_PLAN.md Abschnitt 3:
 * "aktuelle Frage/Fragengruppe" + `QuestionNavigator` zum Zurueckspringen).
 * Der initiale Ladezustand wird bereits von der Server Component
 * (`src/app/consultation/[sessionId]/page.tsx`) via `loadQuestionnaireState()`
 * abgedeckt (siehe Plan Abschnitt 4: "Server Components fuer den initialen
 * Ladezustand") -- dieser Reducer startet daher direkt im Zustand `ready`.
 *
 * Reducer-Zustaende gemaess Plan Abschnitt 4 (AP4-relevanter Ausschnitt):
 * `ready`, `dirty`, `saving`, `saved`, `validationError`, `versionConflict`,
 * `networkError`, plus zwei pragmatische Ergaenzungen fuer den Abschluss-
 * Schritt (`completing`, `sessionCompleted`) -- Implementierungsdetail, kein
 * Abweichen von der Grundsatzentscheidung. `pathComplete` wird bewusst NICHT
 * als eigener Reducer-Zustand gefuehrt, sondern direkt aus
 * `questionnaire.progress.canComplete` abgeleitet (kann parallel zu jedem
 * anderen Zustand gelten). `evaluating`/`recommendationReady`/
 * `noEvaluableRecommendation` gehoeren zu AP6 (Empfehlungs-UI) und werden
 * hier nicht behandelt.
 *
 * AP9-Ergaenzung (siehe Plan Abschnitt 5, Schritt 10): der
 * `sessionCompleted`-Zustand verlinkt zusaetzlich auf
 * `/consultation/[sessionId]/summary` -- die natuerliche Zielseite nach
 * Abschluss des Fragebogens.
 *
 * Kernprinzip aus Plan Abschnitt 4: nach JEDEM Speichern wird der vom Server
 * zurueckgegebene, autoritative `QuestionnaireState` uebernommen (inkl.
 * `hiddenQuestionIds`-Effekt) -- es wird nie clientseitig angenommen, welche
 * Fragen sichtbar sind.
 */

import { useEffect, useMemo, useReducer, useRef } from "react";
import { useRouter } from "next/navigation";
import type {
  AnswerWriteResult,
  CompleteQuestionnaireResult,
  QuestionnaireState,
} from "@/server/questionnaire/service";
import type { AnswerValueInput } from "@/server/questionnaire/types";
import { ProgressBar } from "./ProgressBar";
import { QuestionNavigator } from "./QuestionNavigator";
import { QuestionRenderer } from "./QuestionRenderer";
import { SavingIndicator, ConflictBanner, OfflineBanner } from "./StatusBanners";

type Phase =
  | "ready"
  | "dirty"
  | "saving"
  | "saved"
  | "validationError"
  | "versionConflict"
  | "networkError"
  | "completing"
  | "sessionCompleted";

interface FlowState {
  phase: Phase;
  questionnaire: QuestionnaireState;
  activeQuestionId: string | null;
  errorMessage: string | null;
  validationIssues: string[] | null;
  pendingValue: AnswerValueInput | null;
  completedResult: CompleteQuestionnaireResult | null;
}

type Action =
  | { type: "SELECT_QUESTION"; questionId: string }
  | { type: "LOCAL_EDIT" }
  | { type: "SAVE_START"; value: AnswerValueInput }
  | { type: "SAVE_SUCCESS"; state: QuestionnaireState; writeResult: AnswerWriteResult }
  | { type: "SAVE_VALIDATION_ERROR"; issues: string[] }
  | { type: "SAVE_VERSION_CONFLICT"; message: string }
  | { type: "SAVE_NETWORK_ERROR"; message: string }
  | { type: "RELOAD_SUCCESS"; state: QuestionnaireState }
  | { type: "COMPLETE_START" }
  | { type: "COMPLETE_SUCCESS"; result: CompleteQuestionnaireResult }
  | { type: "COMPLETE_ERROR"; message: string };

function firstQuestionIdToShow(state: QuestionnaireState): string | null {
  return state.progress.nextQuestionId ?? state.visibleQuestions[0]?.questionId ?? null;
}

function reducer(state: FlowState, action: Action): FlowState {
  switch (action.type) {
    case "SELECT_QUESTION":
      return { ...state, activeQuestionId: action.questionId, phase: "ready", errorMessage: null };
    case "LOCAL_EDIT":
      return state.phase === "saving" ? state : { ...state, phase: "dirty" };
    case "SAVE_START":
      return { ...state, phase: "saving", pendingValue: action.value, errorMessage: null };
    case "SAVE_SUCCESS": {
      const stillVisible = action.state.visibleQuestions.some(
        (q) => q.questionId === state.activeQuestionId,
      );
      const nextActive = stillVisible
        ? state.activeQuestionId
        : firstQuestionIdToShow(action.state);
      return {
        ...state,
        phase: "saved",
        questionnaire: action.state,
        activeQuestionId: nextActive,
        pendingValue: null,
        errorMessage: null,
        validationIssues: null,
      };
    }
    case "SAVE_VALIDATION_ERROR":
      return { ...state, phase: "validationError", validationIssues: action.issues };
    case "SAVE_VERSION_CONFLICT":
      return { ...state, phase: "versionConflict", errorMessage: action.message };
    case "SAVE_NETWORK_ERROR":
      return { ...state, phase: "networkError", errorMessage: action.message };
    case "RELOAD_SUCCESS":
      return {
        ...state,
        phase: "ready",
        questionnaire: action.state,
        pendingValue: null,
        errorMessage: null,
        validationIssues: null,
      };
    case "COMPLETE_START":
      return { ...state, phase: "completing", errorMessage: null };
    case "COMPLETE_SUCCESS":
      return { ...state, phase: "sessionCompleted", completedResult: action.result };
    case "COMPLETE_ERROR":
      return { ...state, phase: "ready", errorMessage: action.message };
    default:
      return state;
  }
}

interface QuestionFlowProps {
  initialState: QuestionnaireState;
}

async function parseErrorBody(
  response: Response,
): Promise<{ error: string; message: string; issues?: string[] }> {
  try {
    const body = await response.json();
    return {
      error: typeof body?.error === "string" ? body.error : "UnknownError",
      message: typeof body?.message === "string" ? body.message : `HTTP ${response.status}`,
      issues: Array.isArray(body?.issues) ? body.issues : undefined,
    };
  } catch {
    return { error: "UnknownError", message: `HTTP ${response.status}` };
  }
}

export function QuestionFlow({ initialState }: QuestionFlowProps) {
  const router = useRouter();
  const [state, dispatch] = useReducer(reducer, {
    phase: "ready",
    questionnaire: initialState,
    activeQuestionId: firstQuestionIdToShow(initialState),
    errorMessage: null,
    validationIssues: null,
    pendingValue: null,
    completedResult: null,
  } satisfies FlowState);

  const { questionnaire, activeQuestionId, phase } = state;
  const sessionId = questionnaire.consultationSessionId;

  const activeQuestion = useMemo(
    () => questionnaire.visibleQuestions.find((q) => q.questionId === activeQuestionId) ?? null,
    [questionnaire.visibleQuestions, activeQuestionId],
  );

  // Fokus-Management (AP11, Plan Abschnitt 11): nach jedem erfolgreichen
  // Speichern wandert der Fokus kontrolliert zur naechsten offenen Frage --
  // weder bleibt er auf dem (ggf. nicht mehr sichtbaren) alten Feld haengen,
  // noch springt er unkontrolliert zum Seitenanfang zurueck. Die Ueberschrift
  // der aktiven Frage ist dafuer das stabile, immer vorhandene Fokusziel.
  const activeQuestionHeadingRef = useRef<HTMLHeadingElement | null>(null);
  useEffect(() => {
    if (phase === "saved") {
      activeQuestionHeadingRef.current?.focus();
    }
  }, [phase, activeQuestionId]);

  // `beforeunload`-Warnung nur im `dirty`-Zustand (siehe Plan Abschnitt 4).
  useEffect(() => {
    if (phase !== "dirty") {
      return;
    }
    function handler(event: BeforeUnloadEvent) {
      event.preventDefault();
      event.returnValue = "";
    }
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [phase]);

  async function commitAnswer(value: AnswerValueInput) {
    if (!activeQuestion) {
      return;
    }
    dispatch({ type: "SAVE_START", value });
    try {
      const isChange = activeQuestion.currentAnswerVersion !== null;
      const response = await fetch(`/api/consultation/sessions/${sessionId}/answers`, {
        method: isChange ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          isChange
            ? {
                questionId: activeQuestion.questionId,
                value,
                expectedAnswerVersion: activeQuestion.currentAnswerVersion,
              }
            : { questionId: activeQuestion.questionId, value },
        ),
      });

      if (response.ok) {
        const body = (await response.json()) as {
          writeResult: AnswerWriteResult;
          state: QuestionnaireState;
        };
        dispatch({ type: "SAVE_SUCCESS", state: body.state, writeResult: body.writeResult });
        return;
      }

      const errorBody = await parseErrorBody(response);
      if (response.status === 422 && errorBody.issues) {
        dispatch({ type: "SAVE_VALIDATION_ERROR", issues: errorBody.issues });
      } else if (response.status === 409) {
        dispatch({ type: "SAVE_VERSION_CONFLICT", message: errorBody.message });
      } else {
        dispatch({ type: "SAVE_NETWORK_ERROR", message: errorBody.message });
      }
    } catch {
      dispatch({ type: "SAVE_NETWORK_ERROR", message: "Verbindung zum Server fehlgeschlagen." });
    }
  }

  async function reloadState() {
    try {
      const response = await fetch(`/api/consultation/sessions/${sessionId}`);
      if (!response.ok) {
        const errorBody = await parseErrorBody(response);
        dispatch({ type: "SAVE_NETWORK_ERROR", message: errorBody.message });
        return;
      }
      const freshState = (await response.json()) as QuestionnaireState;
      dispatch({ type: "RELOAD_SUCCESS", state: freshState });
    } catch {
      dispatch({ type: "SAVE_NETWORK_ERROR", message: "Verbindung zum Server fehlgeschlagen." });
    }
  }

  async function completeQuestionnaire() {
    dispatch({ type: "COMPLETE_START" });
    try {
      const response = await fetch(`/api/consultation/sessions/${sessionId}/complete`, {
        method: "POST",
      });
      if (response.ok) {
        const result = (await response.json()) as CompleteQuestionnaireResult;
        dispatch({ type: "COMPLETE_SUCCESS", result });
        return;
      }
      const errorBody = await parseErrorBody(response);
      dispatch({ type: "COMPLETE_ERROR", message: errorBody.message });
    } catch {
      dispatch({ type: "COMPLETE_ERROR", message: "Verbindung zum Server fehlgeschlagen." });
    }
  }

  if (phase === "sessionCompleted" && state.completedResult) {
    return (
      <div className="question-flow question-flow--completed">
        <h2>Fragebogen abgeschlossen</h2>
        <p>
          Alle Pflichtfragen wurden beantwortet und die Beratung wurde um{" "}
          {new Date(state.completedResult.endedAt).toLocaleString("de-DE")} abgeschlossen. Die
          Empfehlungsauswertung ist ein separater Schritt.
        </p>
        <button type="button" onClick={() => router.push(`/consultation/${sessionId}/summary`)}>
          Zur Zusammenfassung
        </button>
        <button
          type="button"
          onClick={() => router.push(`/consultation/${sessionId}/recommendation`)}
        >
          Zur Empfehlung
        </button>
        <button type="button" onClick={() => router.push("/consultation")}>
          Zurueck zur Uebersicht
        </button>
      </div>
    );
  }

  const savingIndicatorStatus =
    phase === "saving" ? "saving" : phase === "saved" ? "saved" : "idle";

  return (
    <div className="question-flow">
      <ProgressBar progress={questionnaire.progress} />

      <div className="question-flow__body">
        <QuestionNavigator
          questions={questionnaire.visibleQuestions}
          activeQuestionId={activeQuestionId}
          onSelect={(questionId) => dispatch({ type: "SELECT_QUESTION", questionId })}
        />

        <div className="question-flow__main">
          {phase === "versionConflict" && <ConflictBanner onReload={reloadState} />}
          {phase === "networkError" && (
            <OfflineBanner
              onRetry={() => state.pendingValue && commitAnswer(state.pendingValue)}
              retrying={false}
            />
          )}

          {activeQuestion ? (
            <section className="question-card">
              <h2 className="question-card__label" ref={activeQuestionHeadingRef} tabIndex={-1}>
                {activeQuestion.label}
                {activeQuestion.isRequired && <span aria-label="Pflichtfrage"> *</span>}
              </h2>
              <QuestionRenderer
                question={activeQuestion}
                value={
                  state.pendingValue &&
                  (phase === "saving" ||
                    phase === "validationError" ||
                    phase === "versionConflict" ||
                    phase === "networkError")
                    ? state.pendingValue
                    : activeQuestion.currentAnswer
                }
                onCommit={commitAnswer}
                onLocalEdit={() => dispatch({ type: "LOCAL_EDIT" })}
                disabled={phase === "saving"}
              />
              <SavingIndicator status={savingIndicatorStatus} />
              {phase === "validationError" && state.validationIssues && (
                <ul className="question-card__errors" role="alert">
                  {state.validationIssues.map((issue) => (
                    <li key={issue}>{issue}</li>
                  ))}
                </ul>
              )}
            </section>
          ) : (
            <p>Keine weiteren sichtbaren Fragen.</p>
          )}

          {questionnaire.progress.canComplete && (
            <div className="question-flow__complete-banner">
              <p>
                Alle Pflichtfragen sind beantwortet -- der Fragebogen kann abgeschlossen werden.
              </p>
              <button
                type="button"
                onClick={completeQuestionnaire}
                disabled={phase === "completing"}
              >
                {phase === "completing" ? "Wird abgeschlossen…" : "Fragebogen abschliessen"}
              </button>
              {state.errorMessage && phase === "ready" && (
                <p className="question-flow__complete-error" role="alert">
                  {state.errorMessage}
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
