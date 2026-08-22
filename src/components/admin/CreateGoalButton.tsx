"use client";

/**
 * Formular zum Anlegen eines neuen `Goal` (Phase 11 AP6, siehe
 * PHASE_11_IMPLEMENTATION_PLAN.md Abschnitt 9, ChatGPT-GO 2026-08-22 nach
 * AP6-Discovery). Bewusst KEIN "Entwurf erstellen dann bearbeiten"-Muster
 * wie bei Commission/Rules -- ein einziges Formular, das direkt beim
 * Absenden `POST /api/admin/goals` aufruft (Goal hat kein Entwurfsstadium,
 * siehe `goal-admin.ts`-Modulkommentar).
 *
 * Scope-Picker: laedt die Optionen fuer den jeweils gewaehlten `scopeType`
 * ueber `GET /api/admin/goals/scope-options` (AP6, `goal-scope-options.ts`)
 * -- reine Anzeige-/Auswahlkonvenienz. Bei `scopeType: "TENANT"` gibt es
 * genau eine Option (der eigene Mandant), die automatisch vorbelegt und
 * nicht editierbar ist. Die fachliche Sicherheitspruefung der gesendeten
 * `scopeId` bleibt ausschliesslich `validateScopeId()` (`goal-admin.ts`)
 * vorbehalten -- ein manipulierter Wert wird dort abgefangen, nicht hier.
 *
 * Die Backend-Logik (`goal-validator.ts`) bleibt alleinige Autoritaet fuer
 * die metrikspezifische Zielwert-/Currency-Zuordnung -- dieses Formular
 * dupliziert diese Regeln nicht, sondern zeigt nur die zur gewaehlten
 * Metrik passenden Felder (reine UI-Konsistenz, siehe
 * `GoalTargetValueFields.tsx`-Modulkommentar).
 */

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { GoalTargetValueFields } from "./GoalTargetValueFields";
import { GOAL_SCOPE_TYPE_LABELS, GOAL_PERIOD_TYPE_LABELS } from "@/lib/goal-format";

const SCOPE_TYPES = ["TENANT", "COMPANY", "STORE", "EMPLOYEE"] as const;
const PERIOD_TYPES = ["MONTH", "QUARTER", "YEAR"] as const;

interface ScopeOption {
  id: string;
  name: string;
}

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

export function CreateGoalButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [scopeType, setScopeType] = useState<(typeof SCOPE_TYPES)[number]>("STORE");
  const [scopeOptions, setScopeOptions] = useState<ScopeOption[]>([]);
  const [scopeId, setScopeId] = useState("");
  const [scopeOptionsLoading, setScopeOptionsLoading] = useState(false);
  const [metricKey, setMetricKey] = useState("DEALS_CLOSED");
  const [periodType, setPeriodType] = useState<(typeof PERIOD_TYPES)[number]>("MONTH");
  const [periodStart, setPeriodStart] = useState(todayIsoDate());
  const [targetCount, setTargetCount] = useState("");
  const [targetAmountMajor, setTargetAmountMajor] = useState("");
  const [currency, setCurrency] = useState("EUR");
  const [targetPercentage, setTargetPercentage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setScopeOptionsLoading(true);
    setScopeId("");
    fetch(`/api/admin/goals/scope-options?scopeType=${scopeType}`)
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
  }, [open, scopeType]);

  function resetForm() {
    setScopeType("STORE");
    setScopeId("");
    setMetricKey("DEALS_CLOSED");
    setPeriodType("MONTH");
    setPeriodStart(todayIsoDate());
    setTargetCount("");
    setTargetAmountMajor("");
    setCurrency("EUR");
    setTargetPercentage("");
    setError(null);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!scopeId) {
      setError("Bitte einen Scope auswaehlen.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const payload: Record<string, unknown> = {
        scopeType,
        scopeId,
        metricKey,
        periodType,
        periodStart,
      };
      if (metricKey === "DEALS_CLOSED") {
        payload.targetCount = targetCount === "" ? null : Number(targetCount);
      } else if (metricKey === "REVENUE") {
        payload.targetAmountMinor =
          targetAmountMajor === "" ? null : Math.round(Number(targetAmountMajor) * 100);
        payload.currency = currency;
      } else if (metricKey === "CLOSE_RATE") {
        payload.targetPercentageBasisPoints =
          targetPercentage === "" ? null : Math.round(Number(targetPercentage) * 100);
      }

      const response = await fetch("/api/admin/goals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (response.ok) {
        const body = (await response.json()) as { goal: { id: string } };
        setOpen(false);
        resetForm();
        router.push(`/admin/goals/${body.goal.id}`);
        router.refresh();
        return;
      }
      const body = (await response.json().catch(() => ({}))) as {
        message?: string;
        issues?: Array<{ message: string }>;
      };
      setError(
        body.issues?.map((i) => i.message).join("; ") ??
          body.message ??
          "Ziel konnte nicht angelegt werden.",
      );
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="admin-goals__create-button">
        Neues Ziel anlegen
      </button>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="admin-goals__form">
      <h2>Neues Ziel anlegen</h2>

      <label className="admin-goals__field">
        Scope-Typ
        <select
          value={scopeType}
          onChange={(e) => setScopeType(e.target.value as (typeof SCOPE_TYPES)[number])}
        >
          {SCOPE_TYPES.map((type) => (
            <option key={type} value={type}>
              {GOAL_SCOPE_TYPE_LABELS[type]}
            </option>
          ))}
        </select>
      </label>

      <label className="admin-goals__field">
        {GOAL_SCOPE_TYPE_LABELS[scopeType]}
        {scopeType === "TENANT" ? (
          <input type="text" value={scopeOptions[0]?.name ?? ""} disabled readOnly />
        ) : (
          <select
            value={scopeId}
            onChange={(e) => setScopeId(e.target.value)}
            disabled={scopeOptionsLoading}
            required
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

      <GoalTargetValueFields
        metricKey={metricKey}
        onMetricKeyChange={setMetricKey}
        targetCount={targetCount}
        onTargetCountChange={setTargetCount}
        targetAmountMajor={targetAmountMajor}
        onTargetAmountMajorChange={setTargetAmountMajor}
        currency={currency}
        onCurrencyChange={setCurrency}
        includeCurrency
        targetPercentage={targetPercentage}
        onTargetPercentageChange={setTargetPercentage}
      />

      <label className="admin-goals__field">
        Periodentyp
        <select
          value={periodType}
          onChange={(e) => setPeriodType(e.target.value as (typeof PERIOD_TYPES)[number])}
        >
          {PERIOD_TYPES.map((type) => (
            <option key={type} value={type}>
              {GOAL_PERIOD_TYPE_LABELS[type]}
            </option>
          ))}
        </select>
      </label>

      <label className="admin-goals__field">
        Periodenbeginn
        <input
          type="date"
          value={periodStart}
          onChange={(e) => setPeriodStart(e.target.value)}
          required
        />
      </label>

      {error && <p className="admin-questions__error">{error}</p>}

      <div className="admin-goals__form-actions">
        <button type="submit" disabled={busy}>
          Ziel anlegen
        </button>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            resetForm();
          }}
          disabled={busy}
        >
          Abbrechen
        </button>
      </div>
    </form>
  );
}
