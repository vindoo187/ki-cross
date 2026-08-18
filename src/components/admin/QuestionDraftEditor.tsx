"use client";

/**
 * Fragen-Editor fuer eine DRAFT-`QuestionnaireVersion` (Phase 8 AP6, siehe
 * PHASE_8_IMPLEMENTATION_PLAN.md Abschnitt 9). Liste bestehender Fragen mit
 * Bearbeiten-/Entfernen-Aktion sowie ein Formular zum Hinzufuegen einer
 * neuen Frage. Ruft ausschliesslich die bestehenden AP3-Routen
 * (`POST/PATCH/DELETE .../questions`) auf -- keine eigene Fachlogik/
 * Validierung ausser der reinen Formular-Struktur (die fachliche Pruefung
 * uebernimmt weiterhin ausschliesslich `validateQuestionnaireVersion()`
 * ueber `VersionActionsBar`, AP4).
 *
 * Bewusst schlicht gehalten (kein Drag&Drop, kein WYSIWYG) -- ChatGPT-Auflage
 * AP6: einfache Formularfelder analog dem bisherigen Phase-6-Prinzip.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { QuestionDetail } from "@/server/admin/question-admin";

const ANSWER_TYPES = [
  "SINGLE_CHOICE",
  "MULTIPLE_CHOICE",
  "BOOLEAN",
  "INTEGER",
  "DECIMAL",
  "SHORT_TEXT",
  "DATE",
] as const;

const NEED_TYPES = [
  "PARTNER_CARD",
  "FAMILY",
  "YOUNG",
  "DSL",
  "FIBER",
  "STREAMING",
  "ACCESSORY",
  "DEVICE_PROTECTION",
  "OTHER",
] as const;

const OPERATORS = [
  "EQUALS",
  "NOT_EQUALS",
  "GREATER_THAN",
  "GREATER_THAN_OR_EQUAL",
  "LESS_THAN",
  "LESS_THAN_OR_EQUAL",
  "IN",
  "NOT_IN",
  "CONTAINS",
  "IS_ANSWERED",
  "IS_NOT_ANSWERED",
] as const;

function needsOptions(answerType: string): boolean {
  return answerType === "SINGLE_CHOICE" || answerType === "MULTIPLE_CHOICE";
}

interface OptionRow {
  key: string;
  label: string;
  sortOrder: number;
}

interface ConditionRow {
  targetQuestionId: string;
  operator: (typeof OPERATORS)[number];
  comparisonValue: string;
  combinator: "AND" | "OR";
}

interface FormState {
  key: string;
  needType: string;
  sortOrder: number;
  label: string;
  answerType: (typeof ANSWER_TYPES)[number];
  isRequired: boolean;
  minValue: string;
  maxValue: string;
  maxLength: string;
  minSelections: string;
  maxSelections: string;
  answerOptions: OptionRow[];
  visibilityConditions: ConditionRow[];
}

function emptyForm(nextSortOrder: number): FormState {
  return {
    key: "",
    needType: "",
    sortOrder: nextSortOrder,
    label: "",
    answerType: "BOOLEAN",
    isRequired: false,
    minValue: "",
    maxValue: "",
    maxLength: "",
    minSelections: "",
    maxSelections: "",
    answerOptions: [],
    visibilityConditions: [],
  };
}

function formToPayload(form: FormState) {
  return {
    key: form.key,
    needType: form.needType || null,
    sortOrder: form.sortOrder,
    label: form.label,
    answerType: form.answerType,
    isRequired: form.isRequired,
    minValue: form.minValue || null,
    maxValue: form.maxValue || null,
    maxLength: form.maxLength ? Number(form.maxLength) : null,
    minSelections: form.minSelections ? Number(form.minSelections) : null,
    maxSelections: form.maxSelections ? Number(form.maxSelections) : null,
    answerOptions: needsOptions(form.answerType) ? form.answerOptions : [],
    visibilityConditions: form.visibilityConditions,
  };
}

async function parseErrorMessage(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { message?: string; issues?: unknown };
    return body.message ?? "Unbekannter Fehler.";
  } catch {
    return "Unbekannter Fehler.";
  }
}

interface QuestionFormFieldsProps {
  form: FormState;
  setForm: (updater: (prev: FormState) => FormState) => void;
  otherQuestions: { id: string; label: string }[];
}

function QuestionFormFields({ form, setForm, otherQuestions }: QuestionFormFieldsProps) {
  return (
    <div className="admin-questions__form-grid">
      <label>
        Schluessel
        <input
          value={form.key}
          onChange={(e) => setForm((p) => ({ ...p, key: e.target.value }))}
          required
        />
      </label>
      <label>
        Bedarfsart
        <select
          value={form.needType}
          onChange={(e) => setForm((p) => ({ ...p, needType: e.target.value }))}
        >
          <option value="">(keine)</option>
          {NEED_TYPES.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </label>
      <label>
        Reihenfolge
        <input
          type="number"
          value={form.sortOrder}
          onChange={(e) => setForm((p) => ({ ...p, sortOrder: Number(e.target.value) }))}
        />
      </label>
      <label className="admin-questions__form-field--wide">
        Fragetext
        <input
          value={form.label}
          onChange={(e) => setForm((p) => ({ ...p, label: e.target.value }))}
          required
        />
      </label>
      <label>
        Antworttyp
        <select
          value={form.answerType}
          onChange={(e) =>
            setForm((p) => ({ ...p, answerType: e.target.value as FormState["answerType"] }))
          }
        >
          {ANSWER_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </label>
      <label className="admin-questions__form-checkbox">
        <input
          type="checkbox"
          checked={form.isRequired}
          onChange={(e) => setForm((p) => ({ ...p, isRequired: e.target.checked }))}
        />
        Pflichtfrage
      </label>

      {(form.answerType === "INTEGER" || form.answerType === "DECIMAL") && (
        <>
          <label>
            Min. Wert
            <input
              value={form.minValue}
              onChange={(e) => setForm((p) => ({ ...p, minValue: e.target.value }))}
            />
          </label>
          <label>
            Max. Wert
            <input
              value={form.maxValue}
              onChange={(e) => setForm((p) => ({ ...p, maxValue: e.target.value }))}
            />
          </label>
        </>
      )}
      {form.answerType === "SHORT_TEXT" && (
        <label>
          Max. Laenge
          <input
            type="number"
            value={form.maxLength}
            onChange={(e) => setForm((p) => ({ ...p, maxLength: e.target.value }))}
          />
        </label>
      )}
      {form.answerType === "MULTIPLE_CHOICE" && (
        <>
          <label>
            Min. Auswahl
            <input
              type="number"
              value={form.minSelections}
              onChange={(e) => setForm((p) => ({ ...p, minSelections: e.target.value }))}
            />
          </label>
          <label>
            Max. Auswahl
            <input
              type="number"
              value={form.maxSelections}
              onChange={(e) => setForm((p) => ({ ...p, maxSelections: e.target.value }))}
            />
          </label>
        </>
      )}

      {needsOptions(form.answerType) && (
        <div className="admin-questions__form-field--wide">
          <p className="admin-questions__subheading">Antwortoptionen</p>
          {form.answerOptions.map((opt, index) => (
            <div key={index} className="admin-questions__option-row">
              <input
                placeholder="Schluessel"
                value={opt.key}
                onChange={(e) =>
                  setForm((p) => ({
                    ...p,
                    answerOptions: p.answerOptions.map((o, i) =>
                      i === index ? { ...o, key: e.target.value } : o,
                    ),
                  }))
                }
              />
              <input
                placeholder="Text"
                value={opt.label}
                onChange={(e) =>
                  setForm((p) => ({
                    ...p,
                    answerOptions: p.answerOptions.map((o, i) =>
                      i === index ? { ...o, label: e.target.value } : o,
                    ),
                  }))
                }
              />
              <button
                type="button"
                onClick={() =>
                  setForm((p) => ({
                    ...p,
                    answerOptions: p.answerOptions.filter((_, i) => i !== index),
                  }))
                }
              >
                Entfernen
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={() =>
              setForm((p) => ({
                ...p,
                answerOptions: [
                  ...p.answerOptions,
                  { key: "", label: "", sortOrder: p.answerOptions.length + 1 },
                ],
              }))
            }
          >
            Option hinzufuegen
          </button>
        </div>
      )}

      {otherQuestions.length > 0 && (
        <div className="admin-questions__form-field--wide">
          <p className="admin-questions__subheading">Sichtbarkeitsregeln</p>
          {form.visibilityConditions.map((cond, index) => (
            <div key={index} className="admin-questions__condition-row">
              <select
                value={cond.targetQuestionId}
                onChange={(e) =>
                  setForm((p) => ({
                    ...p,
                    visibilityConditions: p.visibilityConditions.map((c, i) =>
                      i === index ? { ...c, targetQuestionId: e.target.value } : c,
                    ),
                  }))
                }
              >
                <option value="">Zielfrage waehlen</option>
                {otherQuestions.map((q) => (
                  <option key={q.id} value={q.id}>
                    {q.label}
                  </option>
                ))}
              </select>
              <select
                value={cond.operator}
                onChange={(e) =>
                  setForm((p) => ({
                    ...p,
                    visibilityConditions: p.visibilityConditions.map((c, i) =>
                      i === index
                        ? { ...c, operator: e.target.value as ConditionRow["operator"] }
                        : c,
                    ),
                  }))
                }
              >
                {OPERATORS.map((op) => (
                  <option key={op} value={op}>
                    {op}
                  </option>
                ))}
              </select>
              <input
                placeholder="Vergleichswert"
                value={cond.comparisonValue}
                onChange={(e) =>
                  setForm((p) => ({
                    ...p,
                    visibilityConditions: p.visibilityConditions.map((c, i) =>
                      i === index ? { ...c, comparisonValue: e.target.value } : c,
                    ),
                  }))
                }
              />
              <select
                value={cond.combinator}
                onChange={(e) =>
                  setForm((p) => ({
                    ...p,
                    visibilityConditions: p.visibilityConditions.map((c, i) =>
                      i === index
                        ? { ...c, combinator: e.target.value as ConditionRow["combinator"] }
                        : c,
                    ),
                  }))
                }
              >
                <option value="AND">UND</option>
                <option value="OR">ODER</option>
              </select>
              <button
                type="button"
                onClick={() =>
                  setForm((p) => ({
                    ...p,
                    visibilityConditions: p.visibilityConditions.filter((_, i) => i !== index),
                  }))
                }
              >
                Entfernen
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={() =>
              setForm((p) => ({
                ...p,
                visibilityConditions: [
                  ...p.visibilityConditions,
                  {
                    targetQuestionId: "",
                    operator: "EQUALS",
                    comparisonValue: "",
                    combinator: "AND",
                  },
                ],
              }))
            }
          >
            Regel hinzufuegen
          </button>
        </div>
      )}
    </div>
  );
}

interface QuestionDraftEditorProps {
  questionnaireId: string;
  versionId: string;
  questions: QuestionDetail[];
  readOnly: boolean;
}

export function QuestionDraftEditor({
  questionnaireId,
  versionId,
  questions,
  readOnly,
}: QuestionDraftEditorProps) {
  const router = useRouter();
  const basePath = `/api/admin/questionnaires/${questionnaireId}/versions/${versionId}`;

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<FormState | null>(null);
  const [addForm, setAddForm] = useState<FormState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function startEdit(q: QuestionDetail) {
    setEditingId(q.id);
    setEditForm({
      key: q.key,
      needType: q.needType ?? "",
      sortOrder: q.sortOrder,
      label: q.label,
      answerType: q.answerType as FormState["answerType"],
      isRequired: q.isRequired,
      minValue: q.minValue ?? "",
      maxValue: q.maxValue ?? "",
      maxLength: q.maxLength != null ? String(q.maxLength) : "",
      minSelections: q.minSelections != null ? String(q.minSelections) : "",
      maxSelections: q.maxSelections != null ? String(q.maxSelections) : "",
      answerOptions: q.answerOptions.map((o) => ({
        key: o.key,
        label: o.label,
        sortOrder: o.sortOrder,
      })),
      visibilityConditions: q.visibilityConditions.map((c) => ({
        targetQuestionId: c.targetQuestionId,
        operator: c.operator as ConditionRow["operator"],
        comparisonValue: c.comparisonValue,
        combinator: c.combinator as ConditionRow["combinator"],
      })),
    });
    setError(null);
  }

  async function saveEdit(questionId: string) {
    if (!editForm) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`${basePath}/questions/${questionId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formToPayload(editForm)),
      });
      if (response.ok) {
        setEditingId(null);
        setEditForm(null);
        router.refresh();
        return;
      }
      setError(await parseErrorMessage(response));
    } finally {
      setBusy(false);
    }
  }

  async function removeQuestion(questionId: string) {
    if (!window.confirm("Diese Frage wirklich entfernen?")) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`${basePath}/questions/${questionId}`, { method: "DELETE" });
      if (response.ok || response.status === 204) {
        router.refresh();
        return;
      }
      setError(await parseErrorMessage(response));
    } finally {
      setBusy(false);
    }
  }

  async function submitAdd() {
    if (!addForm) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`${basePath}/questions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formToPayload(addForm)),
      });
      if (response.ok) {
        setAddForm(null);
        router.refresh();
        return;
      }
      setError(await parseErrorMessage(response));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="admin-questions__editor">
      {error && <p className="admin-questions__error">{error}</p>}

      <ul className="admin-questions__questions">
        {questions.map((q) => {
          const others = questions
            .filter((other) => other.id !== q.id)
            .map((other) => ({ id: other.id, label: other.label }));
          return (
            <li key={q.id} className="admin-questions__question">
              {editingId === q.id && editForm ? (
                <div className="admin-questions__question-edit">
                  <QuestionFormFields
                    form={editForm}
                    setForm={(updater) => setEditForm((prev) => (prev ? updater(prev) : prev))}
                    otherQuestions={others}
                  />
                  <div className="admin-questions__form-actions">
                    <button type="button" onClick={() => saveEdit(q.id)} disabled={busy}>
                      Speichern
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setEditingId(null);
                        setEditForm(null);
                      }}
                      disabled={busy}
                    >
                      Abbrechen
                    </button>
                  </div>
                </div>
              ) : (
                <div className="admin-questions__question-view">
                  <strong>{q.label}</strong>{" "}
                  <span className="admin-questions__question-meta">
                    ({q.answerType}
                    {q.isRequired ? ", Pflichtfrage" : ""})
                  </span>
                  {q.answerOptions.length > 0 && (
                    <ul className="admin-questions__option-list">
                      {q.answerOptions.map((o) => (
                        <li key={o.id}>{o.label}</li>
                      ))}
                    </ul>
                  )}
                  {!readOnly && (
                    <div className="admin-questions__form-actions">
                      <button type="button" onClick={() => startEdit(q)} disabled={busy}>
                        Bearbeiten
                      </button>
                      <button type="button" onClick={() => removeQuestion(q.id)} disabled={busy}>
                        Entfernen
                      </button>
                    </div>
                  )}
                </div>
              )}
            </li>
          );
        })}
        {questions.length === 0 && (
          <li className="admin-questions__empty">Noch keine Fragen in diesem Entwurf.</li>
        )}
      </ul>

      {!readOnly && (
        <div className="admin-questions__add-form">
          {addForm ? (
            <>
              <p className="admin-questions__subheading">Neue Frage</p>
              <QuestionFormFields
                form={addForm}
                setForm={(updater) => setAddForm((prev) => (prev ? updater(prev) : prev))}
                otherQuestions={questions.map((q) => ({ id: q.id, label: q.label }))}
              />
              <div className="admin-questions__form-actions">
                <button type="button" onClick={submitAdd} disabled={busy}>
                  Frage hinzufuegen
                </button>
                <button type="button" onClick={() => setAddForm(null)} disabled={busy}>
                  Abbrechen
                </button>
              </div>
            </>
          ) : (
            <button type="button" onClick={() => setAddForm(emptyForm(questions.length + 1))}>
              Neue Frage hinzufuegen
            </button>
          )}
        </div>
      )}
    </section>
  );
}
