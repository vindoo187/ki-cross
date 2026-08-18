"use client";

/**
 * Regel-Editor fuer eine DRAFT-`RuleSetVersion`, alle vier Regeltypen
 * (Eligibility, Exclusion, Prioritization, Cross-Selling) -- Phase 9 AP8,
 * siehe PHASE_9_IMPLEMENTATION_PLAN.md Abschnitt 9. Analog
 * `QuestionDraftEditor.tsx` (Phase 8 AP6): bewusst als einfacher
 * strukturierter Formular-Editor gehalten, KEIN visueller Regelbaum
 * (ChatGPT-Auflage 2026-08-18). Ruft ausschliesslich die bestehenden
 * AP3-Routen (`POST/PATCH/DELETE .../{eligibility,exclusion,
 * prioritization,cross-selling}-rules`) auf -- keine eigene Fachlogik oder
 * Validierung ausser der reinen Formular-Struktur; die fachliche Pruefung
 * uebernimmt ausschliesslich `validateDraftRuleSetVersion()` (AP4) ueber
 * `RuleVersionActionsBar`.
 *
 * Die vier Regeltypen teilen sich eine identische Condition-Struktur
 * (`RuleConditionDetail`) -- ein gemeinsamer `RuleTypeSection<TExtra>`
 * (generisch ueber die je Typ unterschiedlichen Zusatzfelder) plus ein
 * gemeinsamer `ConditionsEditor` statt vier fast identischer ~250-Zeilen-
 * Bloecke (Prinzip aus `rule-schemas.ts`: "ein gemeinsames Schema statt vier
 * fast identischer", hier auf die UI uebertragen).
 *
 * `questionId` bei `sourceType: "ANSWER"` wird bewusst als einfaches
 * Freitextfeld (Frage-ID) gefuehrt statt eines domainuebergreifenden
 * Fragen-Pickers -- die Fragen-Domaene (Phase 8) und die Regel-Domaene
 * (Phase 9) bleiben UI-seitig entkoppelt, analog der bereits etablierten
 * Trennung auf Service-/Fehler-Ebene (siehe rule-admin-errors.ts
 * Modulkommentar). Die tatsaechliche Gueltigkeit der Frage-ID prueft
 * ausschliesslich der serverseitige Validator (AP4).
 */

import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import type {
  RuleConditionDetail,
  EligibilityRuleDetail,
  ExclusionRuleDetail,
  PrioritizationRuleDetail,
  CrossSellingRuleDetail,
} from "@/server/admin/rule-admin";

const SOURCE_TYPES = ["ANSWER", "PRODUCT_ATTRIBUTE", "SESSION_ATTRIBUTE"] as const;
type SourceType = (typeof SOURCE_TYPES)[number];

const SOURCE_TYPE_LABELS: Record<SourceType, string> = {
  ANSWER: "Antwort",
  PRODUCT_ATTRIBUTE: "Produktattribut",
  SESSION_ATTRIBUTE: "Sitzungsattribut",
};

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
type OperatorType = (typeof OPERATORS)[number];

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

// ---------------------------------------------------------------------------
// Conditions -- identisch fuer alle vier Regeltypen.
// ---------------------------------------------------------------------------

interface ConditionFormRow {
  groupIndex: number;
  sourceType: SourceType;
  questionId: string;
  attributeKey: string;
  operator: OperatorType;
  comparisonValue: string;
}

function emptyCondition(groupIndex: number): ConditionFormRow {
  return {
    groupIndex,
    sourceType: "SESSION_ATTRIBUTE",
    questionId: "",
    attributeKey: "",
    operator: "EQUALS",
    comparisonValue: "",
  };
}

function conditionFromDetail(c: RuleConditionDetail): ConditionFormRow {
  return {
    groupIndex: c.groupIndex,
    sourceType: c.sourceType as SourceType,
    questionId: c.questionId ?? "",
    attributeKey: c.attributeKey ?? "",
    operator: c.operator as OperatorType,
    comparisonValue: c.comparisonValue,
  };
}

function conditionToPayload(c: ConditionFormRow) {
  return {
    groupIndex: c.groupIndex,
    sourceType: c.sourceType,
    questionId: c.sourceType === "ANSWER" ? c.questionId || null : null,
    attributeKey: c.sourceType !== "ANSWER" ? c.attributeKey || null : null,
    operator: c.operator,
    comparisonValue: c.comparisonValue,
  };
}

interface ConditionsEditorProps {
  conditions: ConditionFormRow[];
  setConditions: (updater: (prev: ConditionFormRow[]) => ConditionFormRow[]) => void;
}

function ConditionsEditor({ conditions, setConditions }: ConditionsEditorProps) {
  return (
    <div className="admin-questions__form-field--wide">
      <p className="admin-questions__subheading">Bedingungen</p>
      {conditions.map((c, index) => (
        <div key={index} className="admin-questions__condition-row">
          <input
            type="number"
            title="Gruppe (UND innerhalb einer Gruppe, ODER zwischen Gruppen)"
            value={c.groupIndex}
            onChange={(e) =>
              setConditions((prev) =>
                prev.map((row, i) =>
                  i === index ? { ...row, groupIndex: Number(e.target.value) } : row,
                ),
              )
            }
          />
          <select
            value={c.sourceType}
            onChange={(e) =>
              setConditions((prev) =>
                prev.map((row, i) =>
                  i === index ? { ...row, sourceType: e.target.value as SourceType } : row,
                ),
              )
            }
          >
            {SOURCE_TYPES.map((t) => (
              <option key={t} value={t}>
                {SOURCE_TYPE_LABELS[t]}
              </option>
            ))}
          </select>
          {c.sourceType === "ANSWER" ? (
            <input
              placeholder="Frage-ID (siehe Fragenverwaltung)"
              value={c.questionId}
              onChange={(e) =>
                setConditions((prev) =>
                  prev.map((row, i) =>
                    i === index ? { ...row, questionId: e.target.value } : row,
                  ),
                )
              }
            />
          ) : (
            <input
              placeholder="Attribut-Schluessel"
              value={c.attributeKey}
              onChange={(e) =>
                setConditions((prev) =>
                  prev.map((row, i) =>
                    i === index ? { ...row, attributeKey: e.target.value } : row,
                  ),
                )
              }
            />
          )}
          <select
            value={c.operator}
            onChange={(e) =>
              setConditions((prev) =>
                prev.map((row, i) =>
                  i === index ? { ...row, operator: e.target.value as OperatorType } : row,
                ),
              )
            }
          >
            {OPERATORS.map((op) => (
              <option key={op} value={op}>
                {op}
              </option>
            ))}
          </select>
          <input
            placeholder="Vergleichswert (bei IN/NOT_IN: kommagetrennt)"
            value={c.comparisonValue}
            onChange={(e) =>
              setConditions((prev) =>
                prev.map((row, i) =>
                  i === index ? { ...row, comparisonValue: e.target.value } : row,
                ),
              )
            }
          />
          <button
            type="button"
            onClick={() => setConditions((prev) => prev.filter((_, i) => i !== index))}
          >
            Entfernen
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={() => setConditions((prev) => [...prev, emptyCondition(prev.length)])}
      >
        Bedingung hinzufuegen
      </button>
    </div>
  );
}

async function parseErrorMessage(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { message?: string; issues?: unknown };
    return body.message ?? "Unbekannter Fehler.";
  } catch {
    return "Unbekannter Fehler.";
  }
}

// ---------------------------------------------------------------------------
// Generischer Abschnitt fuer einen Regeltyp -- Basisfelder (key, description,
// isActive, conditions) sind identisch, `TExtra` traegt die je Typ
// unterschiedlichen Zusatzfelder (z. B. fitWeight, weight, priority/needType/
// reasonCode/suggestedProductVersionId).
// ---------------------------------------------------------------------------

interface BaseRuleDetail {
  id: string;
  key: string;
  description: string;
  isActive: boolean;
  conditions: RuleConditionDetail[];
}

interface RuleFormState<TExtra> {
  key: string;
  description: string;
  isActive: boolean;
  conditions: ConditionFormRow[];
  extra: TExtra;
}

interface RuleTypeSectionProps<TExtra, TDetail extends BaseRuleDetail> {
  title: string;
  basePath: string;
  rules: TDetail[];
  readOnly: boolean;
  emptyExtra: TExtra;
  extraFromRule: (rule: TDetail) => TExtra;
  extraPayload: (extra: TExtra) => Record<string, unknown>;
  renderExtraFields: (
    extra: TExtra,
    setExtra: (updater: (prev: TExtra) => TExtra) => void,
  ) => ReactNode;
  renderSummary: (rule: TDetail) => ReactNode;
}

function RuleTypeSection<TExtra, TDetail extends BaseRuleDetail>({
  title,
  basePath,
  rules,
  readOnly,
  emptyExtra,
  extraFromRule,
  extraPayload,
  renderExtraFields,
  renderSummary,
}: RuleTypeSectionProps<TExtra, TDetail>) {
  const router = useRouter();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<RuleFormState<TExtra> | null>(null);
  const [addForm, setAddForm] = useState<RuleFormState<TExtra> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function emptyForm(): RuleFormState<TExtra> {
    return { key: "", description: "", isActive: true, conditions: [], extra: emptyExtra };
  }

  function toPayload(form: RuleFormState<TExtra>) {
    return {
      key: form.key,
      description: form.description,
      isActive: form.isActive,
      conditions: form.conditions.map(conditionToPayload),
      ...extraPayload(form.extra),
    };
  }

  function startEdit(rule: TDetail) {
    setEditingId(rule.id);
    setEditForm({
      key: rule.key,
      description: rule.description,
      isActive: rule.isActive,
      conditions: rule.conditions.map(conditionFromDetail),
      extra: extraFromRule(rule),
    });
    setError(null);
  }

  async function saveEdit(ruleId: string) {
    if (!editForm) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`${basePath}/${ruleId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(toPayload(editForm)),
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

  async function removeRule(ruleId: string) {
    if (!window.confirm("Diese Regel wirklich entfernen?")) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`${basePath}/${ruleId}`, { method: "DELETE" });
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
      const response = await fetch(basePath, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(toPayload(addForm)),
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
    <section className="admin-questions__editor admin-rules__section">
      <h2>{title}</h2>
      {error && <p className="admin-questions__error">{error}</p>}

      <ul className="admin-questions__questions">
        {rules.map((rule) => (
          <li key={rule.id} className="admin-questions__question">
            {editingId === rule.id && editForm ? (
              <div className="admin-questions__question-edit">
                <div className="admin-questions__form-grid">
                  <label>
                    Schluessel
                    <input
                      value={editForm.key}
                      onChange={(e) => setEditForm((p) => (p ? { ...p, key: e.target.value } : p))}
                      required
                    />
                  </label>
                  <label className="admin-questions__form-field--wide">
                    Beschreibung
                    <input
                      value={editForm.description}
                      onChange={(e) =>
                        setEditForm((p) => (p ? { ...p, description: e.target.value } : p))
                      }
                      required
                    />
                  </label>
                  <label className="admin-questions__form-checkbox">
                    <input
                      type="checkbox"
                      checked={editForm.isActive}
                      onChange={(e) =>
                        setEditForm((p) => (p ? { ...p, isActive: e.target.checked } : p))
                      }
                    />
                    Aktiv
                  </label>
                  {renderExtraFields(editForm.extra, (updater) =>
                    setEditForm((p) => (p ? { ...p, extra: updater(p.extra) } : p)),
                  )}
                  <ConditionsEditor
                    conditions={editForm.conditions}
                    setConditions={(updater) =>
                      setEditForm((p) => (p ? { ...p, conditions: updater(p.conditions) } : p))
                    }
                  />
                </div>
                <div className="admin-questions__form-actions">
                  <button type="button" onClick={() => saveEdit(rule.id)} disabled={busy}>
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
                <strong>{rule.key}</strong> <span>{rule.description}</span>
                {renderSummary(rule)}
                {!rule.isActive && (
                  <span className="admin-questions__question-meta"> (inaktiv)</span>
                )}
                <span className="admin-questions__question-meta">
                  {" "}
                  ({rule.conditions.length} Bedingung{rule.conditions.length === 1 ? "" : "en"})
                </span>
                {!readOnly && (
                  <div className="admin-questions__form-actions">
                    <button type="button" onClick={() => startEdit(rule)} disabled={busy}>
                      Bearbeiten
                    </button>
                    <button type="button" onClick={() => removeRule(rule.id)} disabled={busy}>
                      Entfernen
                    </button>
                  </div>
                )}
              </div>
            )}
          </li>
        ))}
        {rules.length === 0 && (
          <li className="admin-questions__empty">
            Noch keine Regeln dieses Typs in diesem Entwurf.
          </li>
        )}
      </ul>

      {!readOnly && (
        <div className="admin-questions__add-form">
          {addForm ? (
            <>
              <p className="admin-questions__subheading">Neue Regel</p>
              <div className="admin-questions__form-grid">
                <label>
                  Schluessel
                  <input
                    value={addForm.key}
                    onChange={(e) => setAddForm((p) => (p ? { ...p, key: e.target.value } : p))}
                    required
                  />
                </label>
                <label className="admin-questions__form-field--wide">
                  Beschreibung
                  <input
                    value={addForm.description}
                    onChange={(e) =>
                      setAddForm((p) => (p ? { ...p, description: e.target.value } : p))
                    }
                    required
                  />
                </label>
                <label className="admin-questions__form-checkbox">
                  <input
                    type="checkbox"
                    checked={addForm.isActive}
                    onChange={(e) =>
                      setAddForm((p) => (p ? { ...p, isActive: e.target.checked } : p))
                    }
                  />
                  Aktiv
                </label>
                {renderExtraFields(addForm.extra, (updater) =>
                  setAddForm((p) => (p ? { ...p, extra: updater(p.extra) } : p)),
                )}
                <ConditionsEditor
                  conditions={addForm.conditions}
                  setConditions={(updater) =>
                    setAddForm((p) => (p ? { ...p, conditions: updater(p.conditions) } : p))
                  }
                />
              </div>
              <div className="admin-questions__form-actions">
                <button type="button" onClick={submitAdd} disabled={busy}>
                  Regel hinzufuegen
                </button>
                <button type="button" onClick={() => setAddForm(null)} disabled={busy}>
                  Abbrechen
                </button>
              </div>
            </>
          ) : (
            <button type="button" onClick={() => setAddForm(emptyForm())}>
              Neue Regel hinzufuegen
            </button>
          )}
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Die vier konkreten Regeltypen -- je ein duenner Wrapper um
// `RuleTypeSection<TExtra>` mit den typspezifischen Zusatzfeldern.
// ---------------------------------------------------------------------------

interface EligibilityExtra {
  isRequired: boolean;
  fitWeight: string;
}

function EligibilitySection({
  basePath,
  rules,
  readOnly,
}: {
  basePath: string;
  rules: EligibilityRuleDetail[];
  readOnly: boolean;
}) {
  return (
    <RuleTypeSection<EligibilityExtra, EligibilityRuleDetail>
      title="Eligibility-Regeln"
      basePath={basePath}
      rules={rules}
      readOnly={readOnly}
      emptyExtra={{ isRequired: false, fitWeight: "0" }}
      extraFromRule={(r) => ({ isRequired: r.isRequired, fitWeight: String(r.fitWeight) })}
      extraPayload={(extra) => ({
        isRequired: extra.isRequired,
        fitWeight: Number(extra.fitWeight) || 0,
      })}
      renderSummary={(r) => (
        <span className="admin-questions__question-meta">
          {" "}
          (fitWeight {r.fitWeight}
          {r.isRequired ? ", Pflicht" : ""})
        </span>
      )}
      renderExtraFields={(extra, setExtra) => (
        <>
          <label className="admin-questions__form-checkbox">
            <input
              type="checkbox"
              checked={extra.isRequired}
              onChange={(e) => setExtra((p) => ({ ...p, isRequired: e.target.checked }))}
            />
            Pflichtregel
          </label>
          <label>
            fitWeight (nicht-negativ)
            <input
              type="number"
              value={extra.fitWeight}
              onChange={(e) => setExtra((p) => ({ ...p, fitWeight: e.target.value }))}
            />
          </label>
        </>
      )}
    />
  );
}

interface ExclusionExtra {
  reasonCode: string;
}

function ExclusionSection({
  basePath,
  rules,
  readOnly,
}: {
  basePath: string;
  rules: ExclusionRuleDetail[];
  readOnly: boolean;
}) {
  return (
    <RuleTypeSection<ExclusionExtra, ExclusionRuleDetail>
      title="Exclusion-Regeln"
      basePath={basePath}
      rules={rules}
      readOnly={readOnly}
      emptyExtra={{ reasonCode: "" }}
      extraFromRule={(r) => ({ reasonCode: r.reasonCode })}
      extraPayload={(extra) => ({ reasonCode: extra.reasonCode })}
      renderSummary={(r) => (
        <span className="admin-questions__question-meta"> (Grund: {r.reasonCode})</span>
      )}
      renderExtraFields={(extra, setExtra) => (
        <label>
          Ausschlussgrund-Code
          <input
            value={extra.reasonCode}
            onChange={(e) => setExtra((p) => ({ ...p, reasonCode: e.target.value }))}
            required
          />
        </label>
      )}
    />
  );
}

interface PrioritizationExtra {
  weight: string;
  commissionRequired: boolean;
}

function PrioritizationSection({
  basePath,
  rules,
  readOnly,
}: {
  basePath: string;
  rules: PrioritizationRuleDetail[];
  readOnly: boolean;
}) {
  return (
    <RuleTypeSection<PrioritizationExtra, PrioritizationRuleDetail>
      title="Prioritization-Regeln"
      basePath={basePath}
      rules={rules}
      readOnly={readOnly}
      emptyExtra={{ weight: "0", commissionRequired: false }}
      extraFromRule={(r) => ({
        weight: String(r.weight),
        commissionRequired: r.commissionRequired,
      })}
      extraPayload={(extra) => ({
        weight: Number(extra.weight) || 0,
        commissionRequired: extra.commissionRequired,
      })}
      renderSummary={(r) => (
        <span className="admin-questions__question-meta">
          {" "}
          (weight {r.weight}
          {r.commissionRequired ? ", provisionspflichtig" : ""})
        </span>
      )}
      renderExtraFields={(extra, setExtra) => (
        <>
          <label>
            weight (darf negativ sein)
            <input
              type="number"
              value={extra.weight}
              onChange={(e) => setExtra((p) => ({ ...p, weight: e.target.value }))}
            />
          </label>
          <label className="admin-questions__form-checkbox">
            <input
              type="checkbox"
              checked={extra.commissionRequired}
              onChange={(e) => setExtra((p) => ({ ...p, commissionRequired: e.target.checked }))}
            />
            Provisionspflichtig
          </label>
        </>
      )}
    />
  );
}

interface CrossSellingExtra {
  needType: (typeof NEED_TYPES)[number];
  priority: string;
  reasonCode: string;
  suggestedProductVersionId: string;
}

function CrossSellingSection({
  basePath,
  rules,
  readOnly,
}: {
  basePath: string;
  rules: CrossSellingRuleDetail[];
  readOnly: boolean;
}) {
  return (
    <RuleTypeSection<CrossSellingExtra, CrossSellingRuleDetail>
      title="Cross-Selling-Regeln"
      basePath={basePath}
      rules={rules}
      readOnly={readOnly}
      emptyExtra={{
        needType: "OTHER",
        priority: "0",
        reasonCode: "",
        suggestedProductVersionId: "",
      }}
      extraFromRule={(r) => ({
        needType: r.needType as CrossSellingExtra["needType"],
        priority: String(r.priority),
        reasonCode: r.reasonCode,
        suggestedProductVersionId: r.suggestedProductVersionId ?? "",
      })}
      extraPayload={(extra) => ({
        needType: extra.needType,
        priority: Number(extra.priority) || 0,
        reasonCode: extra.reasonCode,
        suggestedProductVersionId: extra.suggestedProductVersionId || null,
      })}
      renderSummary={(r) => (
        <span className="admin-questions__question-meta">
          {" "}
          ({r.needType}, priority {r.priority}, Grund: {r.reasonCode})
        </span>
      )}
      renderExtraFields={(extra, setExtra) => (
        <>
          <label>
            Bedarfsart
            <select
              value={extra.needType}
              onChange={(e) =>
                setExtra((p) => ({
                  ...p,
                  needType: e.target.value as CrossSellingExtra["needType"],
                }))
              }
            >
              {NEED_TYPES.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
          <label>
            Prioritaet (nicht-negativ)
            <input
              type="number"
              value={extra.priority}
              onChange={(e) => setExtra((p) => ({ ...p, priority: e.target.value }))}
            />
          </label>
          <label>
            Empfehlungsgrund-Code
            <input
              value={extra.reasonCode}
              onChange={(e) => setExtra((p) => ({ ...p, reasonCode: e.target.value }))}
              required
            />
          </label>
          <label>
            Vorgeschlagene ProductVersion-ID (optional)
            <input
              value={extra.suggestedProductVersionId}
              onChange={(e) =>
                setExtra((p) => ({ ...p, suggestedProductVersionId: e.target.value }))
              }
            />
          </label>
        </>
      )}
    />
  );
}

// ---------------------------------------------------------------------------
// Oeffentliche Komponente -- rendert alle vier Abschnitte.
// ---------------------------------------------------------------------------

interface RuleDraftEditorProps {
  ruleSetId: string;
  versionId: string;
  eligibilityRules: EligibilityRuleDetail[];
  exclusionRules: ExclusionRuleDetail[];
  prioritizationRules: PrioritizationRuleDetail[];
  crossSellingRules: CrossSellingRuleDetail[];
  readOnly: boolean;
}

export function RuleDraftEditor({
  ruleSetId,
  versionId,
  eligibilityRules,
  exclusionRules,
  prioritizationRules,
  crossSellingRules,
  readOnly,
}: RuleDraftEditorProps) {
  const base = `/api/admin/rule-sets/${ruleSetId}/versions/${versionId}`;

  return (
    <div className="admin-rules__editor">
      <EligibilitySection
        basePath={`${base}/eligibility-rules`}
        rules={eligibilityRules}
        readOnly={readOnly}
      />
      <ExclusionSection
        basePath={`${base}/exclusion-rules`}
        rules={exclusionRules}
        readOnly={readOnly}
      />
      <PrioritizationSection
        basePath={`${base}/prioritization-rules`}
        rules={prioritizationRules}
        readOnly={readOnly}
      />
      <CrossSellingSection
        basePath={`${base}/cross-selling-rules`}
        rules={crossSellingRules}
        readOnly={readOnly}
      />
    </div>
  );
}
