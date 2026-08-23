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
 *
 * Phase 12 AP3-Ergaenzung (ChatGPT-GO 2026-08-23, siehe PHASE_12_
 * IMPLEMENTATION_PLAN.md Abschnitt 4 + Chat-Verlauf "GO fuer AP3"): der
 * Freitext-KI-Suggestion-State (`suggestions`, keyed by `questionId`) lebt
 * bewusst als EIGENER `useState` HIER in `QuestionFlow`, nicht im
 * `FlowState`-Reducer -- ChatGPTs Vorgabe "keine neue Persistenz fuer
 * Suggestion-State" bedeutet rein clientseitiges, ephemeres React-State ohne
 * eigenes Datenmodell, das den bestehenden Frage-/Antwort-Reducer nicht
 * verkompliziert. Uebernehmen ("Accept") ruft exakt dieselbe `commitAnswer()`
 * auf, die auch normale manuelle Eingaben verwendet -- ChatGPT-Vorgabe
 * "Uebernehmen/Aendern muss ausschliesslich ueber den bestehenden
 * saveAnswer()-Pfad laufen" ist damit strukturell erzwungen (kein zweiter
 * Code-Pfad moeglich). "Aendern" befuellt NICHT automatisch beim Eintreffen
 * des Vorschlags das Fragefeld (ChatGPT-Vorgabe), sondern erst nach
 * explizitem Klick auf "Aendern" -- danach uebernimmt exakt derselbe,
 * bereits gerenderte `QuestionRenderer`/`onCommit()`-Pfad das eigentliche
 * Speichern (kein separates Formular, keine neue Debounce-/Versionslogik).
 * Ein Vorschlag verschwindet NUR bei tatsaechlichem `SAVE_SUCCESS` fuer die
 * jeweilige `questionId` (innerhalb `if (response.ok)` in
 * `commitAnswerForQuestion`) -- bei Validierungs-/Konflikt-/Netzwerkfehlern
 * bleibt er unveraendert bestehen (ChatGPT-Vorgabe: "bei einem Fehler beim
 * normalen Speichern darf der KI-Vorschlag nicht stillschweigend als
 * bestaetigt gelten"). "Verwerfen" loescht nur lokalen State, loest niemals
 * eine `CustomerAnswer`-Mutation aus.
 *
 * Phase 12 AP4-Ergaenzung (ChatGPT-GO 2026-08-23): jede der drei
 * Mitarbeiter-Entscheidungen (Uebernehmen/Aendern/Verwerfen) loest
 * zusaetzlich einen GENUIN EIGENEN, "fire and forget"-Request an
 * `.../ai-extraction/outcome` aus (`trackSuggestionOutcome()`) -- NIEMALS
 * Teil des `saveAnswer()`/`changeAnswer()`-Requests selbst (siehe
 * `recordAiSuggestionOutcome()`-Kommentar in `service.ts` fuer die
 * Begruendung der strukturellen Trennung). Bei Uebernehmen/Aendern erfolgt
 * dieser Aufruf ERST NACHDEM der eigentliche Speichervorgang bereits
 * erfolgreich war (innerhalb desselben `if (response.ok)`-Zweigs, der auch
 * `clearSuggestion()` ausloest) -- ein Fehlschlagen des Tracking-Aufrufs
 * (per `try/catch` verschluckt) kann daher niemals die bereits committete
 * Antwort beeinflussen. Bei Verwerfen (kein Speichervorgang) erfolgt er
 * sofort.
 */

import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type {
  AnswerWriteResult,
  CompleteQuestionnaireResult,
  QuestionnaireState,
} from "@/server/questionnaire/service";
import type { AnswerValueInput } from "@/server/questionnaire/types";
import type { AiExtractionCandidate } from "@/server/ai-extraction/types";
import { candidateToAnswerValueInput } from "@/lib/ai-suggestion-format";
import { ProgressBar } from "./ProgressBar";
import { QuestionNavigator } from "./QuestionNavigator";
import { QuestionRenderer } from "./QuestionRenderer";
import { SavingIndicator, ConflictBanner, OfflineBanner } from "./StatusBanners";
import { AiSuggestionCard, AiExtractionForm } from "./AiSuggestionPanel";

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

// Fix 7 (ChatGPT-Konsultation 2026-08-11): Auto-Weiterspringen zur naechsten
// Frage nach erfolgreichem Speichern -- ausdruecklich NUR fuer Antworttypen,
// bei denen ein einzelner Commit tatsaechlich eine vollstaendig
// abgeschlossene Entscheidung darstellt (ein Klick = eine fertige Antwort,
// kein Debouncing, siehe QuestionInputs.tsx). MULTIPLE_CHOICE ist bewusst
// ausgeschlossen, da dort mehrere Werte nacheinander ausgewaehlt werden
// koennen -- ein Auto-Advance nach dem ersten Checkbox-Klick wuerde die
// Auswahl weiterer Optionen verhindern. SHORT_TEXT/INTEGER/DECIMAL sind
// ebenfalls ausgeschlossen, da ein debounced Save nach einer Tippschreibpause
// nicht zwingend bedeutet, dass der Mitarbeiter mit der Frage fertig ist.
const AUTO_ADVANCE_ANSWER_TYPES = new Set(["BOOLEAN", "SINGLE_CHOICE", "DATE"]);

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
      // Auto-Advance nutzt bewusst die bereits vom Server berechnete
      // `progress.nextQuestionId` (erste unbeantwortete sichtbare Frage in
      // sortOrder, siehe path.ts) statt selbst im Frontend die naechste
      // Frage zu bestimmen -- der sichtbare Pfad kann sich durch die gerade
      // gespeicherte Antwort komplett veraendert haben.
      const previousActiveQuestion = state.questionnaire.visibleQuestions.find(
        (q) => q.questionId === state.activeQuestionId,
      );
      const shouldAutoAdvance =
        previousActiveQuestion != null &&
        AUTO_ADVANCE_ANSWER_TYPES.has(previousActiveQuestion.answerType) &&
        action.state.progress.nextQuestionId != null &&
        action.state.progress.nextQuestionId !== state.activeQuestionId;
      const nextActive = shouldAutoAdvance
        ? action.state.progress.nextQuestionId
        : stillVisible
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
  /**
   * Server-ermittelt (Permission UND Tenant-Feature-Flag, siehe
   * `isAiExtractionAvailable()`) -- steuert AUSSCHLIESSLICH, ob das
   * Freitext-KI-Panel ueberhaupt gerendert wird. Kein Client-seitiger
   * Ersatz fuer die serverseitige Pruefung in der Route selbst (die bleibt
   * die alleinige Sicherheitsinstanz). Optional mit Default `false`
   * (Feature-Flag-Konvention "default aus", siehe `consultation-
   * permissions.ts`) -- damit muessen bestehende AP12-Komponententests, die
   * `QuestionFlow` ohne dieses AP3-Prop rendern, nicht angepasst werden.
   */
  aiExtractionAvailable?: boolean;
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

export function QuestionFlow({ initialState, aiExtractionAvailable = false }: QuestionFlowProps) {
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

  // Phase 12 AP3: ephemerer KI-Vorschlags-State, keyed by questionId (siehe
  // Modulkommentar oben). Kein Reducer-Case, bewusst kein neues Datenmodell.
  const [suggestions, setSuggestions] = useState<Record<string, AiExtractionCandidate>>({});
  const [freeText, setFreeText] = useState("");
  const [extractionSubmitting, setExtractionSubmitting] = useState(false);
  const [extractionError, setExtractionError] = useState<string | null>(null);
  // "Aendern"-Modus: nur fuer GENAU eine Frage gleichzeitig aktiv, das
  // Fragefeld selbst zeigt in diesem Fall `editingSuggestionValue` statt
  // `activeQuestion.currentAnswer` an (siehe `value`-Berechnung unten).
  const [editingSuggestionQuestionId, setEditingSuggestionQuestionId] = useState<string | null>(
    null,
  );
  const [editingSuggestionValue, setEditingSuggestionValue] = useState<AnswerValueInput | null>(
    null,
  );
  // Phase 12 AP4: markiert, dass der aktuell (bzw. zuletzt) fuer diese Frage
  // laufende Speichervorgang durch "Uebernehmen" ausgeloest wurde -- als Ref
  // (nicht State), damit ein Fehlschlag+Retry (siehe `OfflineBanner`) die
  // Zuordnung nicht verliert. Wird NUR bei tatsaechlichem Erfolg wieder
  // geloescht (siehe `commitAnswerForQuestion`) -- ein "Aendern"-Klick auf
  // dieselbe Frage raeumt sie ebenfalls auf (siehe `startEditingSuggestion`),
  // um eine Fehlzuordnung nach einem gescheiterten Uebernehmen-Versuch zu
  // vermeiden.
  const acceptingSuggestionRef = useRef<string | null>(null);

  function clearSuggestion(questionId: string) {
    setSuggestions((prev) => {
      if (!(questionId in prev)) {
        return prev;
      }
      const next = { ...prev };
      delete next[questionId];
      return next;
    });
    setEditingSuggestionQuestionId((current) => (current === questionId ? null : current));
    setEditingSuggestionValue((current) =>
      editingSuggestionQuestionId === questionId ? null : current,
    );
    if (acceptingSuggestionRef.current === questionId) {
      acceptingSuggestionRef.current = null;
    }
  }

  // Phase 12 AP4: "fire and forget" -- ein Fehlschlag hier darf die UI
  // niemals beeintraechtigen (siehe Modulkommentar oben).
  async function trackSuggestionOutcome(
    questionId: string,
    outcome: "accepted" | "rejected",
    changed: boolean,
  ) {
    try {
      await fetch(`/api/consultation/sessions/${sessionId}/ai-extraction/outcome`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          outcome === "accepted" ? { questionId, outcome, changed } : { questionId, outcome },
        ),
      });
    } catch {
      // Bewusst stillschweigend, siehe Modulkommentar.
    }
  }

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

  // Fix 1 (ChatGPT-Konsultation 2026-08-06): Text-/Zahlenfelder sperren sich
  // waehrend eines laufenden Speichervorgangs nicht mehr (siehe
  // QuestionInputs.tsx), der Nutzer kann also weitertippen. Damit dabei
  // niemals ein zweiter, ueberlappender Request mit einer bereits veralteten
  // `expectedAnswerVersion` an den Server geht -- und damit eine aeltere
  // Serverantwort niemals eine neuere Eingabe ueberschreibt -- werden Saves
  // pro Frage serialisiert: laeuft fuer die aktive Frage bereits ein Save,
  // wird der neueste Wert nur gemerkt (`queuedEditRef`) und automatisch
  // nachgesendet, sobald der laufende Request abgeschlossen ist (mit der dann
  // aktuellen, vom Server zurueckgegebenen Version).
  const inFlightQuestionIdRef = useRef<string | null>(null);
  const queuedEditRef = useRef<{ questionId: string; value: AnswerValueInput } | null>(null);

  async function commitAnswer(value: AnswerValueInput) {
    if (!activeQuestion) {
      return;
    }
    const questionId = activeQuestion.questionId;

    if (inFlightQuestionIdRef.current === questionId) {
      queuedEditRef.current = { questionId, value };
      return;
    }

    await commitAnswerForQuestion(questionId, value, activeQuestion.currentAnswerVersion);
  }

  async function commitAnswerForQuestion(
    questionId: string,
    value: AnswerValueInput,
    expectedAnswerVersion: number | null,
  ) {
    inFlightQuestionIdRef.current = questionId;
    dispatch({ type: "SAVE_START", value });
    try {
      const isChange = expectedAnswerVersion !== null;
      const response = await fetch(`/api/consultation/sessions/${sessionId}/answers`, {
        method: isChange ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          isChange ? { questionId, value, expectedAnswerVersion } : { questionId, value },
        ),
      });

      if (response.ok) {
        const body = (await response.json()) as {
          writeResult: AnswerWriteResult;
          state: QuestionnaireState;
        };
        dispatch({ type: "SAVE_SUCCESS", state: body.state, writeResult: body.writeResult });
        inFlightQuestionIdRef.current = null;

        // Phase 12 AP4: NUR wenn dieser erfolgreiche Save tatsaechlich durch
        // eine explizite Vorschlags-Interaktion ausgeloest wurde (Uebernehmen
        // ueber `acceptingSuggestionRef`, Aendern ueber den zum Aufrufzeitpunkt
        // aktiven `editingSuggestionQuestionId`) wird ein AI_SUGGESTION_ACCEPTED-
        // Tracking-Event gesendet. Eine ganz normale manuelle Antwort auf eine
        // Frage mit zufaellig noch offenem, aber nie angeklicktem Vorschlag
        // loest bewusst KEIN Tracking-Event aus.
        const isAcceptOrigin = acceptingSuggestionRef.current === questionId;
        const isEditOrigin = !isAcceptOrigin && editingSuggestionQuestionId === questionId;
        if (isAcceptOrigin || isEditOrigin) {
          void trackSuggestionOutcome(questionId, "accepted", isEditOrigin);
        }

        // Phase 12 AP3: ein evtl. offener KI-Vorschlag fuer GENAU diese Frage
        // gilt ab jetzt als erledigt -- unabhaengig davon, ob der Save ueber
        // "Uebernehmen"/"Aendern" oder eine ganz normale manuelle Eingabe
        // ausgeloest wurde (die Frage ist ohnehin beantwortet, ein weiterhin
        // angezeigter Vorschlag waere irrefuehrend). Bewusst NUR im
        // Erfolgsfall (`response.ok`) -- siehe Modulkommentar oben.
        clearSuggestion(questionId);

        const queued = queuedEditRef.current;
        if (queued && queued.questionId === questionId) {
          queuedEditRef.current = null;
          const freshQuestion = body.state.visibleQuestions.find(
            (q) => q.questionId === questionId,
          );
          // Frage evtl. durch den Speichervorgang nicht mehr sichtbar (Pfad
          // hat sich geaendert) -- dann wird der nachgeholte Wert bewusst
          // NICHT mehr gesendet.
          if (freshQuestion) {
            await commitAnswerForQuestion(
              questionId,
              queued.value,
              freshQuestion.currentAnswerVersion,
            );
          }
        }
        return;
      }

      inFlightQuestionIdRef.current = null;
      const errorBody = await parseErrorBody(response);
      if (response.status === 422 && errorBody.issues) {
        dispatch({ type: "SAVE_VALIDATION_ERROR", issues: errorBody.issues });
      } else if (response.status === 409) {
        dispatch({ type: "SAVE_VERSION_CONFLICT", message: errorBody.message });
      } else {
        dispatch({ type: "SAVE_NETWORK_ERROR", message: errorBody.message });
      }
    } catch {
      inFlightQuestionIdRef.current = null;
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

  // Phase 12 AP3: Freitext an die AP2-Route senden. Sendet AUSSCHLIESSLICH
  // `freeText` (kein eigener Fragenkatalog vom Client, ChatGPT-Vorgabe).
  async function requestSuggestions() {
    if (freeText.trim() === "") {
      return;
    }
    setExtractionSubmitting(true);
    setExtractionError(null);
    try {
      const response = await fetch(`/api/consultation/sessions/${sessionId}/ai-extraction`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ freeText }),
      });
      if (response.ok) {
        const body = (await response.json()) as { candidates: AiExtractionCandidate[] };
        setSuggestions((prev) => {
          const next = { ...prev };
          for (const candidate of body.candidates) {
            next[candidate.questionId] = candidate;
          }
          return next;
        });
        setFreeText("");
        setExtractionSubmitting(false);
        return;
      }
      const errorBody = await parseErrorBody(response);
      setExtractionSubmitting(false);
      setExtractionError(errorBody.message);
    } catch {
      setExtractionSubmitting(false);
      setExtractionError("Verbindung zum Server fehlgeschlagen.");
    }
  }

  // "Uebernehmen": ruft bewusst dieselbe `commitAnswer()` auf, die auch
  // normale manuelle Eingaben verwendet -- kein zweiter Speicherpfad.
  // `acceptingSuggestionRef` markiert den Ursprung fuer das AP4-Tracking
  // (siehe `commitAnswerForQuestion`); wird nur bei Erfolg wieder geloescht,
  // damit ein Netzwerkfehler+Retry (`OfflineBanner`) die Zuordnung behaelt.
  function acceptSuggestion(candidate: AiExtractionCandidate) {
    acceptingSuggestionRef.current = candidate.questionId;
    commitAnswer(candidateToAnswerValueInput(candidate));
  }

  // "Aendern": befuellt NICHT selbst etwas automatisch -- setzt nur den
  // Anzeigewert des bereits gerenderten Fragefelds, das eigentliche
  // Speichern uebernimmt der Mitarbeiter durch seine eigene Interaktion mit
  // diesem Feld (identischer `onCommit()`-Pfad wie bei jeder normalen
  // Eingabe).
  function startEditingSuggestion(candidate: AiExtractionCandidate) {
    // AP4: raeumt eine evtl. verwaiste "Uebernehmen"-Zuordnung fuer dieselbe
    // Frage auf (z. B. nach einem gescheiterten Uebernehmen-Versuch), damit
    // der anschliessende Aendern-Save nicht faelschlich als "Uebernehmen"
    // getrackt wird.
    if (acceptingSuggestionRef.current === candidate.questionId) {
      acceptingSuggestionRef.current = null;
    }
    setEditingSuggestionQuestionId(candidate.questionId);
    setEditingSuggestionValue(candidateToAnswerValueInput(candidate));
  }

  function cancelEditingSuggestion() {
    setEditingSuggestionQuestionId(null);
    setEditingSuggestionValue(null);
  }

  // "Verwerfen": ausschliesslich lokaler State, keine CustomerAnswer-Mutation.
  // AP4: loest -- NUR falls tatsaechlich ein Vorschlag fuer diese Frage
  // offen war -- ein AI_SUGGESTION_REJECTED-Tracking-Event aus.
  function dismissSuggestion(questionId: string) {
    if (questionId in suggestions) {
      void trackSuggestionOutcome(questionId, "rejected", false);
    }
    clearSuggestion(questionId);
  }

  function selectQuestion(questionId: string) {
    cancelEditingSuggestion();
    dispatch({ type: "SELECT_QUESTION", questionId });
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

  // Phase 12 AP3: nur fuer die aktuell aktive Frage gerendert -- "separat am
  // jeweiligen Fragefeld" (ChatGPT-Vorgabe).
  const activeSuggestion = activeQuestion ? (suggestions[activeQuestion.questionId] ?? null) : null;
  const isEditingActiveSuggestion =
    activeQuestion != null && editingSuggestionQuestionId === activeQuestion.questionId;
  const otherPendingSuggestions = Object.values(suggestions)
    .filter((candidate) => candidate.questionId !== activeQuestionId)
    .map((candidate) => {
      const question = questionnaire.visibleQuestions.find(
        (q) => q.questionId === candidate.questionId,
      );
      return question ? { questionId: candidate.questionId, label: question.label } : null;
    })
    .filter((entry): entry is { questionId: string; label: string } => entry != null);

  return (
    <div className="question-flow">
      <ProgressBar progress={questionnaire.progress} />

      {aiExtractionAvailable && (
        <AiExtractionForm
          freeText={freeText}
          onFreeTextChange={setFreeText}
          onSubmit={requestSuggestions}
          submitting={extractionSubmitting}
          errorMessage={extractionError}
          otherPendingSuggestions={otherPendingSuggestions}
          onJumpToQuestion={selectQuestion}
        />
      )}

      <div className="question-flow__body">
        <QuestionNavigator
          questions={questionnaire.visibleQuestions}
          activeQuestionId={activeQuestionId}
          onSelect={selectQuestion}
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
                    : isEditingActiveSuggestion && editingSuggestionValue
                      ? editingSuggestionValue
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
              {activeSuggestion && (
                <AiSuggestionCard
                  candidate={activeSuggestion}
                  question={activeQuestion}
                  isEditing={isEditingActiveSuggestion}
                  onAccept={() => acceptSuggestion(activeSuggestion)}
                  onEdit={() => startEditingSuggestion(activeSuggestion)}
                  onCancelEdit={cancelEditingSuggestion}
                  onDismiss={() => dismissSuggestion(activeSuggestion.questionId)}
                />
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
