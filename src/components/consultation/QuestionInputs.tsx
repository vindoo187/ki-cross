"use client";

/**
 * Sieben Eingabe-Unterkomponenten fuer `QuestionRenderer`, je eine pro
 * `AnswerType` (siehe PHASE_5_IMPLEMENTATION_PLAN.md Abschnitt 3). Jede
 * kapselt Eingabe + einfache Client-seitige Bedienbarkeit (Tastatur/Touch,
 * `inputmode`, 44x44px Mindestgroesse fuer Touch-Ziele, siehe Abschnitt 11).
 *
 * WICHTIG: Diese Komponenten validieren NICHT fachlich (z. B. min/max) --
 * das bleibt Aufgabe des Servers (`answer-validation.ts`). Sie fuehren
 * lediglich einfache Eingabe-Constraints aus (z. B. `type="number"`), damit
 * offensichtlich falsche Eingaben gar nicht erst entstehen. Serverseitige
 * `InvalidAnswerError`-Meldungen werden von `QuestionFlow` separat angezeigt.
 *
 * Diskrete Eingaben (Single/Multiple/Boolean/Date) rufen `onCommit` SOFORT
 * bei jeder Aenderung auf (kein Debouncing). Freitext-/Zahlenfelder debouncen
 * lokal (~500ms, Annahme aus Abschnitt 4 des Plans) und rufen `onCommit` erst
 * nach einer Tippschreibpause auf, um nicht bei jedem Tastendruck zu
 * speichern.
 *
 * Bugfix 2026-08-06 (ChatGPT-Konsultation, Fix 1): Freitext-/Zahlenfelder
 * werden waehrend eines laufenden Speichervorgangs NICHT mehr per
 * `disabled` gesperrt -- vorher konnte ein Nutzer, der kurz nach einer
 * Tippschreibpause weiterschrieb, mitten im Tippen auf ein gesperrtes Feld
 * treffen, solange der Server-Roundtrip noch lief. `disabled` wird fuer
 * diese drei Felder nur noch als `aria-busy` angezeigt (Screenreader-Hinweis,
 * blockiert aber keine Eingabe). Damit neuere Tastatureingaben niemals durch
 * die verspaetete Serverantwort eines AELTEREN Speichervorgangs ueberschrieben
 * werden, merkt sich jede Komponente per Ref, welcher Rohwert zuletzt
 * tatsaechlich gesendet wurde (`onFire`), und uebernimmt einen vom Server
 * zurueckgegebenen Wert nur dann in die Anzeige, wenn seit diesem letzten
 * Senden nichts Neueres eingetippt wurde (oder die Frage gewechselt hat).
 * Das eigentliche Ueberschreiben-vermeiden bei ueberlappenden Speichervorgaengen
 * (kein zweiter Request mit veralteter `expectedAnswerVersion`) uebernimmt
 * `QuestionFlow.tsx` durch Serialisierung/Nachsenden pro Frage.
 */

import { useEffect, useRef, useState } from "react";
import type { AnswerValueInput } from "@/server/questionnaire/types";
import type { QuestionForAnswering } from "@/server/questionnaire/service";

export interface QuestionInputProps {
  question: QuestionForAnswering;
  /** Zuletzt vom Server bestaetigter ODER lokal editierter Wert (Anzeige). */
  value: AnswerValueInput | null;
  /** Wird aufgerufen, sobald ein Wert gespeichert werden soll. */
  onCommit: (value: AnswerValueInput) => void;
  /**
   * Optional: wird bei Freitext-/Zahlenfeldern bei JEDEM Tastendruck sofort
   * aufgerufen (vor dem Debounce), damit `QuestionFlow` in den `dirty`-
   * Zustand wechseln kann (siehe Plan Abschnitt 4, `beforeunload`-Warnung).
   * Diskrete Eingaben speichern sofort und ueberspringen den `dirty`-Zustand
   * bewusst (kein sinnvolles Zeitfenster).
   */
  onLocalEdit?: () => void;
  /**
   * true waehrend ein Speichervorgang fuer diese Frage laeuft. Fuer
   * Single/Multiple/Boolean/Date weiterhin ein hartes `disabled` (kurzer,
   * unkritischer Klick-Roundtrip). Fuer Freitext-/Zahlenfelder nur noch
   * `aria-busy`, siehe Modul-Kommentar oben.
   */
  disabled: boolean;
}

// Fix 8 (ChatGPT-Konsultation 2026-08-11): 500ms -> 1000ms. Nutzerfeedback aus
// dem Testing: 500ms Denk-/Tippschreibpause reichten aus, um vorzeitig
// gefuehlt zu werden ("speichert zu frueh"), obwohl kein Datenverlust auftrat
// (siehe lastSentRawRef-Schutz oben). 1000ms bleibt weiterhin spuerbar
// reaktionsschnell, gibt aber mehr Luft fuer normale Pausen. Reine
// Konstantenaenderung, keine Architekturaenderung -- betrifft
// ShortTextInput/IntegerInput/DecimalInput; SingleChoiceInput/BooleanInput/
// DateInput/MultipleChoiceInput committen weiterhin ohne Debounce.
const DEBOUNCE_MS = 1000;

/**
 * Gemeinsamer Debounce-Hook fuer Freitext-/Zahlenfelder. `onFire` wird genau
 * dann aufgerufen, wenn der Debounce tatsaechlich abgelaufen ist und ein
 * Speichervorgang ausgeloest wird -- die aufrufende Komponente nutzt dies,
 * um sich den zuletzt gesendeten Rohwert zu merken (siehe Modul-Kommentar).
 */
function useDebouncedCommit(
  onCommit: (value: AnswerValueInput) => void,
  buildValue: (raw: string) => AnswerValueInput,
  onLocalEdit?: () => void,
  onFire?: (raw: string) => void,
) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, []);

  return (raw: string) => {
    onLocalEdit?.();
    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }
    timerRef.current = setTimeout(() => {
      onFire?.(raw);
      onCommit(buildValue(raw));
    }, DEBOUNCE_MS);
  };
}

export function SingleChoiceInput({ question, value, onCommit, disabled }: QuestionInputProps) {
  const selected = value?.choiceValues?.[0] ?? "";
  return (
    <div
      className="question-input question-input--choice"
      role="radiogroup"
      aria-label={question.label}
    >
      {question.answerOptions.map((option) => (
        <label key={option.key} className="question-input__option">
          <input
            type="radio"
            name={question.questionId}
            value={option.key}
            checked={selected === option.key}
            disabled={disabled}
            onChange={() => onCommit({ choiceValues: [option.key] })}
          />
          <span>{option.label}</span>
        </label>
      ))}
    </div>
  );
}

export function MultipleChoiceInput({ question, value, onCommit, disabled }: QuestionInputProps) {
  const selected = new Set(value?.choiceValues ?? []);

  function toggle(key: string) {
    const next = new Set(selected);
    if (next.has(key)) {
      next.delete(key);
    } else {
      next.add(key);
    }
    onCommit({ choiceValues: [...next] });
  }

  return (
    <div className="question-input question-input--choice" role="group" aria-label={question.label}>
      {question.answerOptions.map((option) => (
        <label key={option.key} className="question-input__option">
          <input
            type="checkbox"
            value={option.key}
            checked={selected.has(option.key)}
            disabled={disabled}
            onChange={() => toggle(option.key)}
          />
          <span>{option.label}</span>
        </label>
      ))}
    </div>
  );
}

export function BooleanInput({ question, value, onCommit, disabled }: QuestionInputProps) {
  const current = value?.booleanValue ?? null;
  return (
    <div
      className="question-input question-input--choice"
      role="radiogroup"
      aria-label={question.label}
    >
      <label className="question-input__option">
        <input
          type="radio"
          name={question.questionId}
          checked={current === true}
          disabled={disabled}
          onChange={() => onCommit({ booleanValue: true })}
        />
        <span>Ja</span>
      </label>
      <label className="question-input__option">
        <input
          type="radio"
          name={question.questionId}
          checked={current === false}
          disabled={disabled}
          onChange={() => onCommit({ booleanValue: false })}
        />
        <span>Nein</span>
      </label>
    </div>
  );
}

export function IntegerInput({
  question,
  value,
  onCommit,
  onLocalEdit,
  disabled,
}: QuestionInputProps) {
  const initialRaw = value?.integerValue != null ? String(value.integerValue) : "";
  const [raw, setRaw] = useState(initialRaw);
  const rawRef = useRef(initialRaw);
  const lastSentRawRef = useRef(initialRaw);
  const lastQuestionIdRef = useRef(question.questionId);
  const commitDebounced = useDebouncedCommit(
    onCommit,
    (r) => ({
      integerValue: r.trim() === "" ? null : Number.parseInt(r, 10),
    }),
    onLocalEdit,
    (sentRaw) => {
      lastSentRawRef.current = sentRaw;
    },
  );

  useEffect(() => {
    const incoming = value?.integerValue != null ? String(value.integerValue) : "";
    const questionChanged = lastQuestionIdRef.current !== question.questionId;
    const noNewerLocalEdit =
      incoming === lastSentRawRef.current && rawRef.current === lastSentRawRef.current;
    if (questionChanged || noNewerLocalEdit) {
      setRaw(incoming);
      rawRef.current = incoming;
      lastSentRawRef.current = incoming;
      lastQuestionIdRef.current = question.questionId;
    }
  }, [value?.integerValue, question.questionId]);

  return (
    <input
      className="question-input question-input--text"
      type="number"
      inputMode="numeric"
      step={1}
      min={question.minValue ?? undefined}
      max={question.maxValue ?? undefined}
      value={raw}
      aria-label={question.label}
      aria-busy={disabled || undefined}
      onChange={(event) => {
        setRaw(event.target.value);
        rawRef.current = event.target.value;
        commitDebounced(event.target.value);
      }}
    />
  );
}

export function DecimalInput({
  question,
  value,
  onCommit,
  onLocalEdit,
  disabled,
}: QuestionInputProps) {
  const initialRaw = value?.decimalValue ?? "";
  const [raw, setRaw] = useState(initialRaw);
  const rawRef = useRef(initialRaw);
  const lastSentRawRef = useRef(initialRaw);
  const lastQuestionIdRef = useRef(question.questionId);
  const commitDebounced = useDebouncedCommit(
    onCommit,
    (r) => ({
      decimalValue: r.trim() === "" ? null : r.trim(),
    }),
    onLocalEdit,
    (sentRaw) => {
      lastSentRawRef.current = sentRaw;
    },
  );

  useEffect(() => {
    const incoming = value?.decimalValue ?? "";
    const questionChanged = lastQuestionIdRef.current !== question.questionId;
    const noNewerLocalEdit =
      incoming === lastSentRawRef.current && rawRef.current === lastSentRawRef.current;
    if (questionChanged || noNewerLocalEdit) {
      setRaw(incoming);
      rawRef.current = incoming;
      lastSentRawRef.current = incoming;
      lastQuestionIdRef.current = question.questionId;
    }
  }, [value?.decimalValue, question.questionId]);

  return (
    <input
      className="question-input question-input--text"
      type="number"
      inputMode="decimal"
      step="any"
      min={question.minValue ?? undefined}
      max={question.maxValue ?? undefined}
      value={raw}
      aria-label={question.label}
      aria-busy={disabled || undefined}
      onChange={(event) => {
        setRaw(event.target.value);
        rawRef.current = event.target.value;
        commitDebounced(event.target.value);
      }}
    />
  );
}

export function ShortTextInput({
  question,
  value,
  onCommit,
  onLocalEdit,
  disabled,
}: QuestionInputProps) {
  const initialRaw = value?.freeTextValue ?? "";
  const [raw, setRaw] = useState(initialRaw);
  const rawRef = useRef(initialRaw);
  const lastSentRawRef = useRef(initialRaw);
  const lastQuestionIdRef = useRef(question.questionId);
  const commitDebounced = useDebouncedCommit(
    onCommit,
    (r) => ({
      freeTextValue: r.trim() === "" ? null : r,
    }),
    onLocalEdit,
    (sentRaw) => {
      lastSentRawRef.current = sentRaw;
    },
  );

  useEffect(() => {
    const incoming = value?.freeTextValue ?? "";
    const questionChanged = lastQuestionIdRef.current !== question.questionId;
    const noNewerLocalEdit =
      incoming === lastSentRawRef.current && rawRef.current === lastSentRawRef.current;
    if (questionChanged || noNewerLocalEdit) {
      setRaw(incoming);
      rawRef.current = incoming;
      lastSentRawRef.current = incoming;
      lastQuestionIdRef.current = question.questionId;
    }
  }, [value?.freeTextValue, question.questionId]);

  return (
    <input
      className="question-input question-input--text"
      type="text"
      inputMode="text"
      maxLength={question.maxLength ?? undefined}
      value={raw}
      aria-label={question.label}
      aria-busy={disabled || undefined}
      onChange={(event) => {
        setRaw(event.target.value);
        rawRef.current = event.target.value;
        commitDebounced(event.target.value);
      }}
    />
  );
}

export function DateInput({ question, value, onCommit, disabled }: QuestionInputProps) {
  const raw = value?.dateValue ?? "";
  return (
    <input
      className="question-input question-input--text"
      type="date"
      value={raw}
      disabled={disabled}
      aria-label={question.label}
      onChange={(event) =>
        onCommit({ dateValue: event.target.value === "" ? null : event.target.value })
      }
    />
  );
}
