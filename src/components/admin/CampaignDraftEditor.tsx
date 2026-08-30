"use client";

/**
 * Editor fuer eine DRAFT-`CampaignVersion` (Phase 13 AP6, siehe
 * PHASE_13_IMPLEMENTATION_PLAN.md Abschnitt 3, ChatGPT-GO 2026-08-30).
 * Zwei Abschnitte, EIN gemeinsames Speichern-Formular (anders als
 * `CommissionDraftEditor.tsx`, das Skalarfelder und Tier-CRUD getrennt
 * behandelt -- `CampaignVersion` hat KEINE Kind-Entitaet mit eigenem
 * Lifecycle, `CampaignCondition` wird stattdessen als GANZE Liste beim
 * Speichern mitgeschickt, identisches Prinzip wie `updateCampaignVersionFields()`
 * Delete-All-Then-Recreate, siehe `campaign-schemas.ts`-Modulkommentar):
 * (1) Scope (`scopeType`/`scopeId`, ueber `campaign-scope-options.ts`
 * bezogen) + Beschreibung, (2) Bedingungen (`ConditionsEditor`, adaptiert
 * aus `RuleDraftEditor.tsx`, Phase 9 AP8, aber auf die drei fuer
 * `CampaignCondition` zulaessigen `sourceType`s beschraenkt -- KEIN
 * `CAMPAIGN_ACTIVE`, siehe `campaign-schemas.ts::conditionSourceTypeSchema`
 * und `campaign-admin.ts::validateCampaignVersion()`, die CAMPAIGN_ACTIVE
 * fuer CampaignCondition serverseitig explizit ablehnt).
 *
 * Ruft ausschliesslich die bestehende AP6-Route (`PATCH
 * .../versions/[versionId]`) auf -- keine eigene Fachlogik/Validierung
 * ausser der reinen Formular-Struktur (die fachliche Pruefung uebernimmt
 * weiterhin ausschliesslich `validateCampaignVersion()` ueber
 * `CampaignVersionActionsBar`).
 */

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { CampaignVersionDetail, CampaignConditionDetail } from "@/server/admin/campaign-admin";

const SCOPE_TYPES = ["TENANT", "STORE"] as const;
type ScopeType = (typeof SCOPE_TYPES)[number];

const SCOPE_TYPE_LABELS: Record<ScopeType, string> = {
  TENANT: "Mandant (gesamter Tenant)",
  STORE: "Filiale",
};

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

// ---------------------------------------------------------------------------
// Bedingungen -- adaptiert aus RuleDraftEditor.tsx (Phase 9 AP8), auf die
// drei fuer CampaignCondition zulaessigen sourceTypes beschraenkt.
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

function conditionFromDetail(c: CampaignConditionDetail): ConditionFormRow {
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
  readOnly: boolean;
}

function ConditionsEditor({ conditions, setConditions, readOnly }: ConditionsEditorProps) {
  return (
    <div className="admin-questions__form-field--wide">
      <p className="admin-questions__subheading">Bedingungen</p>
      {conditions.map((c, index) => (
        <div key={index} className="admin-questions__condition-row">
          <input
            type="number"
            title="Gruppe (UND innerhalb einer Gruppe, ODER zwischen Gruppen)"
            value={c.groupIndex}
            disabled={readOnly}
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
            disabled={readOnly}
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
              disabled={readOnly}
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
              disabled={readOnly}
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
            disabled={readOnly}
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
            disabled={readOnly}
            onChange={(e) =>
              setConditions((prev) =>
                prev.map((row, i) =>
                  i === index ? { ...row, comparisonValue: e.target.value } : row,
                ),
              )
            }
          />
          {!readOnly && (
            <button
              type="button"
              onClick={() => setConditions((prev) => prev.filter((_, i) => i !== index))}
            >
              Entfernen
            </button>
          )}
        </div>
      ))}
      {!readOnly && (
        <button
          type="button"
          onClick={() => setConditions((prev) => [...prev, emptyCondition(prev.length)])}
        >
          Bedingung hinzufuegen
        </button>
      )}
      {conditions.length === 0 && (
        <p className="admin-questions__empty">
          Keine Bedingungen -- diese Kampagne gilt als immer aktiv innerhalb ihres
          Gueltigkeitszeitraums.
        </p>
      )}
    </div>
  );
}

async function parseErrorMessage(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { message?: string; issues?: unknown };
    if (Array.isArray(body.issues) && body.issues.length > 0) {
      return (body.issues as string[]).join(" ");
    }
    return body.message ?? "Unbekannter Fehler.";
  } catch {
    return "Unbekannter Fehler.";
  }
}

interface ScopeOption {
  id: string;
  name: string;
}

interface CampaignDraftEditorProps {
  campaignId: string;
  versionId: string;
  version: CampaignVersionDetail;
  readOnly: boolean;
}

export function CampaignDraftEditor({
  campaignId,
  versionId,
  version,
  readOnly,
}: CampaignDraftEditorProps) {
  const router = useRouter();
  const basePath = `/api/admin/campaigns/${campaignId}/versions/${versionId}`;

  const [scopeType, setScopeType] = useState<ScopeType>(version.scopeType as ScopeType);
  const [scopeId, setScopeId] = useState(version.scopeId);
  const [scopeOptions, setScopeOptions] = useState<ScopeOption[]>([]);
  const [scopeOptionsLoading, setScopeOptionsLoading] = useState(false);
  const [description, setDescription] = useState(version.description ?? "");
  const [conditions, setConditions] = useState<ConditionFormRow[]>(
    version.conditions.map(conditionFromDetail),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedOk, setSavedOk] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setScopeOptionsLoading(true);
    fetch(`/api/admin/campaigns/scope-options?scopeType=${scopeType}`)
      .then((r) => r.json())
      .then((body: { options?: ScopeOption[] }) => {
        if (cancelled) return;
        const options = body.options ?? [];
        setScopeOptions(options);
        if (scopeType === "TENANT" && options[0]) {
          setScopeId(options[0].id);
        }
      })
      .finally(() => {
        if (!cancelled) setScopeOptionsLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopeType]);

  async function handleSave() {
    setBusy(true);
    setError(null);
    setSavedOk(false);
    try {
      const response = await fetch(basePath, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scopeType,
          scopeId,
          description: description === "" ? null : description,
          conditions: conditions.map(conditionToPayload),
        }),
      });
      if (response.ok) {
        setSavedOk(true);
        router.refresh();
        return;
      }
      setError(await parseErrorMessage(response));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="admin-questions__editor admin-campaigns__editor">
      <h2>Kampagnen-Entwurf</h2>
      {error && <p className="admin-questions__error">{error}</p>}
      {savedOk && <p className="admin-questions__valid-ok">Entwurf gespeichert.</p>}

      <div className="admin-questions__form-grid">
        <label>
          Scope-Typ
          <select
            value={scopeType}
            disabled={readOnly}
            onChange={(e) => setScopeType(e.target.value as ScopeType)}
          >
            {SCOPE_TYPES.map((t) => (
              <option key={t} value={t}>
                {SCOPE_TYPE_LABELS[t]}
              </option>
            ))}
          </select>
        </label>

        <label>
          {SCOPE_TYPE_LABELS[scopeType]}
          {scopeType === "TENANT" ? (
            <input type="text" value={scopeOptions[0]?.name ?? ""} disabled readOnly />
          ) : (
            <select
              value={scopeId}
              disabled={readOnly || scopeOptionsLoading}
              onChange={(e) => setScopeId(e.target.value)}
            >
              <option value="">-- bitte waehlen --</option>
              {scopeOptions.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.name}
                </option>
              ))}
            </select>
          )}
        </label>

        <label className="admin-questions__form-field--wide">
          Beschreibung
          <input
            value={description}
            disabled={readOnly}
            onChange={(e) => setDescription(e.target.value)}
          />
        </label>

        <ConditionsEditor
          conditions={conditions}
          setConditions={setConditions}
          readOnly={readOnly}
        />
      </div>

      {!readOnly && (
        <div className="admin-questions__form-actions">
          <button type="button" onClick={handleSave} disabled={busy || !scopeId}>
            Entwurf speichern
          </button>
        </div>
      )}
    </section>
  );
}
