"use client";

/**
 * Editor fuer eine DRAFT-`CommissionModelVersion` (Phase 10 AP8, siehe
 * PHASE_10_IMPLEMENTATION_PLAN.md Abschnitt 9, ChatGPT-GO 2026-08-22).
 * Zwei Abschnitte: (1) Skalarfelder (`commissionType`/`currency`/Betraege,
 * ein einzelnes Formular mit einem Speichern-Button, ruft `PATCH
 * .../versions/[versionId]` auf, AP3), (2) bei `commissionType === "TIERED"`
 * zusaetzlich eine Stufenverwaltung (`CommissionTier`-CRUD, ruft `POST`/
 * `PATCH`/`DELETE .../tiers` auf, AP4). Ruft ausschliesslich die
 * bestehenden API-Routen auf -- keine eigene Fachlogik/Validierung ausser
 * der reinen Formular-Struktur (die fachliche Pruefung uebernimmt weiterhin
 * ausschliesslich `validateCommissionModelVersion()` ueber
 * `CommissionVersionActionsBar`, AP4/AP8).
 *
 * Bewusst schlicht gehalten (kein Drag&Drop, keine Live-Vorschau der
 * Provisionsberechnung) -- analog `QuestionDraftEditor.tsx` (Phase 8 AP6):
 * einfache Formularfelder.
 */

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type {
  CommissionModelVersionDetail,
  CommissionTierDetail,
} from "@/server/admin/commission-admin";

const COMMISSION_TYPES = ["FLAT", "PERCENTAGE", "TIERED"] as const;

interface ScalarFormState {
  commissionType: (typeof COMMISSION_TYPES)[number];
  currency: string;
  commissionAmountMinor: string;
  commissionPercentageBasisPoints: string;
  recurringCommissionAmountMinor: string;
}

function scalarFormFromVersion(version: CommissionModelVersionDetail): ScalarFormState {
  return {
    commissionType: version.commissionType as ScalarFormState["commissionType"],
    currency: version.currency,
    commissionAmountMinor:
      version.commissionAmountMinor != null ? String(version.commissionAmountMinor) : "",
    commissionPercentageBasisPoints:
      version.commissionPercentageBasisPoints != null
        ? String(version.commissionPercentageBasisPoints)
        : "",
    recurringCommissionAmountMinor:
      version.recurringCommissionAmountMinor != null
        ? String(version.recurringCommissionAmountMinor)
        : "",
  };
}

function scalarFormToPayload(form: ScalarFormState) {
  return {
    commissionType: form.commissionType,
    currency: form.currency,
    commissionAmountMinor:
      form.commissionType === "TIERED" || form.commissionAmountMinor === ""
        ? null
        : Number(form.commissionAmountMinor),
    commissionPercentageBasisPoints:
      form.commissionType !== "PERCENTAGE" || form.commissionPercentageBasisPoints === ""
        ? null
        : Number(form.commissionPercentageBasisPoints),
    recurringCommissionAmountMinor:
      form.commissionType === "TIERED" || form.recurringCommissionAmountMinor === ""
        ? null
        : Number(form.recurringCommissionAmountMinor),
  };
}

interface TierFormState {
  thresholdMinor: string;
  amountKind: "amount" | "percentage";
  amountValue: string;
  sortOrder: string;
}

function emptyTierForm(nextSortOrder: number): TierFormState {
  return {
    thresholdMinor: "",
    amountKind: "amount",
    amountValue: "",
    sortOrder: String(nextSortOrder),
  };
}

function tierFormFromDetail(t: CommissionTierDetail): TierFormState {
  return {
    thresholdMinor: String(t.thresholdMinor),
    amountKind: t.tierAmountMinor != null ? "amount" : "percentage",
    amountValue: String(t.tierAmountMinor ?? t.tierPercentageBasisPoints ?? ""),
    sortOrder: String(t.sortOrder),
  };
}

function tierFormToPayload(form: TierFormState) {
  return {
    thresholdMinor: Number(form.thresholdMinor),
    tierAmountMinor: form.amountKind === "amount" ? Number(form.amountValue) : null,
    tierPercentageBasisPoints: form.amountKind === "percentage" ? Number(form.amountValue) : null,
    sortOrder: Number(form.sortOrder),
  };
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

interface CommissionDraftEditorProps {
  commissionModelId: string;
  versionId: string;
  version: CommissionModelVersionDetail;
  readOnly: boolean;
}

export function CommissionDraftEditor({
  commissionModelId,
  versionId,
  version,
  readOnly,
}: CommissionDraftEditorProps) {
  const router = useRouter();
  const basePath = `/api/admin/commission-models/${commissionModelId}/versions/${versionId}`;

  const [scalarForm, setScalarForm] = useState<ScalarFormState>(() =>
    scalarFormFromVersion(version),
  );
  const [scalarBusy, setScalarBusy] = useState(false);
  const [scalarError, setScalarError] = useState<string | null>(null);

  // Nach erfolgreichem Speichern (router.refresh() liefert eine aktualisierte
  // `version`-Prop mit denselben Werten, die soeben gespeichert wurden) --
  // synchronisiert das Formular, ohne laufende Bearbeitung an einer ANDEREN
  // Version zu ueberschreiben (Effekt feuert nur bei tatsaechlicher
  // Wertaenderung, siehe Dependency-Liste).
  useEffect(() => {
    setScalarForm(scalarFormFromVersion(version));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    version.id,
    version.commissionType,
    version.currency,
    version.commissionAmountMinor,
    version.commissionPercentageBasisPoints,
    version.recurringCommissionAmountMinor,
  ]);

  async function saveScalarFields() {
    setScalarBusy(true);
    setScalarError(null);
    try {
      const response = await fetch(basePath, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(scalarFormToPayload(scalarForm)),
      });
      if (response.ok) {
        router.refresh();
        return;
      }
      setScalarError(await parseErrorMessage(response));
    } finally {
      setScalarBusy(false);
    }
  }

  const [editingTierId, setEditingTierId] = useState<string | null>(null);
  const [editTierForm, setEditTierForm] = useState<TierFormState | null>(null);
  const [addTierForm, setAddTierForm] = useState<TierFormState | null>(null);
  const [tierBusy, setTierBusy] = useState(false);
  const [tierError, setTierError] = useState<string | null>(null);

  function startEditTier(t: CommissionTierDetail) {
    setEditingTierId(t.id);
    setEditTierForm(tierFormFromDetail(t));
    setTierError(null);
  }

  async function saveTier(tierId: string) {
    if (!editTierForm) return;
    setTierBusy(true);
    setTierError(null);
    try {
      const response = await fetch(`${basePath}/tiers/${tierId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(tierFormToPayload(editTierForm)),
      });
      if (response.ok) {
        setEditingTierId(null);
        setEditTierForm(null);
        router.refresh();
        return;
      }
      setTierError(await parseErrorMessage(response));
    } finally {
      setTierBusy(false);
    }
  }

  async function removeTier(tierId: string) {
    if (!window.confirm("Diese Stufe wirklich entfernen?")) return;
    setTierBusy(true);
    setTierError(null);
    try {
      const response = await fetch(`${basePath}/tiers/${tierId}`, { method: "DELETE" });
      if (response.ok || response.status === 204) {
        router.refresh();
        return;
      }
      setTierError(await parseErrorMessage(response));
    } finally {
      setTierBusy(false);
    }
  }

  async function submitAddTier() {
    if (!addTierForm) return;
    setTierBusy(true);
    setTierError(null);
    try {
      const response = await fetch(`${basePath}/tiers`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(tierFormToPayload(addTierForm)),
      });
      if (response.ok) {
        setAddTierForm(null);
        router.refresh();
        return;
      }
      setTierError(await parseErrorMessage(response));
    } finally {
      setTierBusy(false);
    }
  }

  const isTiered = scalarForm.commissionType === "TIERED";

  return (
    <section className="admin-questions__editor">
      <p className="admin-questions__subheading">Provisionsart</p>
      {scalarError && <p className="admin-questions__error">{scalarError}</p>}
      <div className="admin-questions__form-grid">
        <label>
          Provisionsart
          <select
            value={scalarForm.commissionType}
            disabled={readOnly}
            onChange={(e) =>
              setScalarForm((p) => ({
                ...p,
                commissionType: e.target.value as ScalarFormState["commissionType"],
              }))
            }
          >
            {COMMISSION_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>
        <label>
          Waehrung
          <input
            value={scalarForm.currency}
            disabled={readOnly}
            maxLength={3}
            onChange={(e) =>
              setScalarForm((p) => ({ ...p, currency: e.target.value.toUpperCase() }))
            }
          />
        </label>

        {scalarForm.commissionType === "FLAT" && (
          <>
            <label>
              Provision einmalig (Minor-Einheit)
              <input
                type="number"
                value={scalarForm.commissionAmountMinor}
                disabled={readOnly}
                onChange={(e) =>
                  setScalarForm((p) => ({ ...p, commissionAmountMinor: e.target.value }))
                }
              />
            </label>
            <label>
              Provision wiederkehrend (Minor-Einheit)
              <input
                type="number"
                value={scalarForm.recurringCommissionAmountMinor}
                disabled={readOnly}
                onChange={(e) =>
                  setScalarForm((p) => ({ ...p, recurringCommissionAmountMinor: e.target.value }))
                }
              />
            </label>
          </>
        )}

        {scalarForm.commissionType === "PERCENTAGE" && (
          <label>
            Provisionssatz (Basispunkte, 10000 = 100%)
            <input
              type="number"
              value={scalarForm.commissionPercentageBasisPoints}
              disabled={readOnly}
              onChange={(e) =>
                setScalarForm((p) => ({ ...p, commissionPercentageBasisPoints: e.target.value }))
              }
            />
          </label>
        )}

        {isTiered && (
          <p className="admin-questions__hint admin-questions__form-field--wide">
            Bei Provisionsart TIERED liegen die Werte ausschliesslich in den Stufen unten -- die
            Felder oben bleiben leer.
          </p>
        )}
      </div>

      {!readOnly && (
        <div className="admin-questions__form-actions">
          <button type="button" onClick={saveScalarFields} disabled={scalarBusy}>
            Speichern
          </button>
        </div>
      )}

      {isTiered && (
        <section className="admin-rules__section">
          <p className="admin-questions__subheading">Provisionsstufen</p>
          {tierError && <p className="admin-questions__error">{tierError}</p>}

          <ul
            className="admin-questions__option-list"
            style={{ paddingLeft: 0, listStyle: "none" }}
          >
            {version.tiers
              .slice()
              .sort((a, b) => a.sortOrder - b.sortOrder)
              .map((t) => (
                <li key={t.id} className="admin-questions__question">
                  {editingTierId === t.id && editTierForm ? (
                    <div className="admin-questions__condition-row">
                      <label>
                        Schwelle
                        <input
                          type="number"
                          value={editTierForm.thresholdMinor}
                          onChange={(e) =>
                            setEditTierForm((p) =>
                              p ? { ...p, thresholdMinor: e.target.value } : p,
                            )
                          }
                        />
                      </label>
                      <select
                        value={editTierForm.amountKind}
                        onChange={(e) =>
                          setEditTierForm((p) =>
                            p
                              ? { ...p, amountKind: e.target.value as TierFormState["amountKind"] }
                              : p,
                          )
                        }
                      >
                        <option value="amount">Fixbetrag</option>
                        <option value="percentage">Prozent (Basispunkte)</option>
                      </select>
                      <input
                        type="number"
                        value={editTierForm.amountValue}
                        onChange={(e) =>
                          setEditTierForm((p) => (p ? { ...p, amountValue: e.target.value } : p))
                        }
                      />
                      <label>
                        Reihenfolge
                        <input
                          type="number"
                          value={editTierForm.sortOrder}
                          onChange={(e) =>
                            setEditTierForm((p) => (p ? { ...p, sortOrder: e.target.value } : p))
                          }
                        />
                      </label>
                      <button type="button" onClick={() => saveTier(t.id)} disabled={tierBusy}>
                        Speichern
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setEditingTierId(null);
                          setEditTierForm(null);
                        }}
                        disabled={tierBusy}
                      >
                        Abbrechen
                      </button>
                    </div>
                  ) : (
                    <div>
                      <strong>ab {t.thresholdMinor}</strong>{" "}
                      <span className="admin-questions__question-meta">
                        {t.tierAmountMinor != null
                          ? `Fixbetrag ${t.tierAmountMinor}`
                          : `${t.tierPercentageBasisPoints} Basispunkte`}{" "}
                        (Reihenfolge {t.sortOrder})
                      </span>
                      {!readOnly && (
                        <div className="admin-questions__form-actions">
                          <button
                            type="button"
                            onClick={() => startEditTier(t)}
                            disabled={tierBusy}
                          >
                            Bearbeiten
                          </button>
                          <button
                            type="button"
                            onClick={() => removeTier(t.id)}
                            disabled={tierBusy}
                          >
                            Entfernen
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </li>
              ))}
            {version.tiers.length === 0 && (
              <li className="admin-questions__empty">Noch keine Stufen in dieser Version.</li>
            )}
          </ul>

          {!readOnly && (
            <div className="admin-questions__add-form">
              {addTierForm ? (
                <>
                  <p className="admin-questions__subheading">Neue Stufe</p>
                  <div className="admin-questions__condition-row">
                    <label>
                      Schwelle
                      <input
                        type="number"
                        value={addTierForm.thresholdMinor}
                        onChange={(e) =>
                          setAddTierForm((p) => (p ? { ...p, thresholdMinor: e.target.value } : p))
                        }
                      />
                    </label>
                    <select
                      value={addTierForm.amountKind}
                      onChange={(e) =>
                        setAddTierForm((p) =>
                          p
                            ? { ...p, amountKind: e.target.value as TierFormState["amountKind"] }
                            : p,
                        )
                      }
                    >
                      <option value="amount">Fixbetrag</option>
                      <option value="percentage">Prozent (Basispunkte)</option>
                    </select>
                    <input
                      type="number"
                      value={addTierForm.amountValue}
                      onChange={(e) =>
                        setAddTierForm((p) => (p ? { ...p, amountValue: e.target.value } : p))
                      }
                    />
                    <label>
                      Reihenfolge
                      <input
                        type="number"
                        value={addTierForm.sortOrder}
                        onChange={(e) =>
                          setAddTierForm((p) => (p ? { ...p, sortOrder: e.target.value } : p))
                        }
                      />
                    </label>
                  </div>
                  <div className="admin-questions__form-actions">
                    <button type="button" onClick={submitAddTier} disabled={tierBusy}>
                      Stufe hinzufuegen
                    </button>
                    <button type="button" onClick={() => setAddTierForm(null)} disabled={tierBusy}>
                      Abbrechen
                    </button>
                  </div>
                </>
              ) : (
                <button
                  type="button"
                  onClick={() => setAddTierForm(emptyTierForm(version.tiers.length))}
                >
                  Neue Stufe hinzufuegen
                </button>
              )}
            </div>
          )}
        </section>
      )}
    </section>
  );
}
