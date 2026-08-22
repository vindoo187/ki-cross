"use client";

/**
 * Gemeinsame Formularfelder fuer den metrikspezifischen Zielwert einer
 * `Goal`/`GoalVersion` (Phase 11 AP6, siehe PHASE_11_IMPLEMENTATION_PLAN.md
 * Abschnitt 9). Wird sowohl von `CreateGoalButton.tsx` (neues Goal, inkl.
 * Currency) als auch von `NewGoalVersionForm.tsx` (neue GoalVersion fuer ein
 * bestehendes Goal, OHNE Currency -- `currency` gehoert zur unveraenderlichen
 * Goal-Identitaet, siehe `goal-schemas.ts`-Modulkommentar) verwendet.
 *
 * Reine Formular-Darstellung -- KEINE Validierung/Umrechnung der fachlichen
 * Metrik-Zuordnung (das bleibt `goal-validator.ts` vorbehalten, siehe
 * Modulkommentar dort). `targetAmountMajor` wird bewusst als
 * Komma-/Punkt-Betrag in GANZEN Waehrungseinheiten angezeigt (z. B. "500.00"
 * fuer 50000 Minor-Einheiten) -- die Umrechnung `*100` erfolgt erst beim
 * Absenden im jeweiligen Formular, analog `CommissionDraftEditor.tsx`.
 * `targetPercentage` wird als Prozentwert (0-100) angezeigt, die Umrechnung
 * in Basispunkte (`*100`) erfolgt ebenfalls erst beim Absenden.
 */

const GOAL_METRIC_OPTIONS = [
  { value: "DEALS_CLOSED", label: "Abgeschlossene Deals" },
  { value: "REVENUE", label: "Umsatz" },
  { value: "CLOSE_RATE", label: "Abschlussquote" },
] as const;

interface GoalTargetValueFieldsProps {
  metricKey: string;
  onMetricKeyChange?: (value: string) => void;
  metricKeyDisabled?: boolean;
  targetCount: string;
  onTargetCountChange: (value: string) => void;
  targetAmountMajor: string;
  onTargetAmountMajorChange: (value: string) => void;
  currency: string;
  onCurrencyChange: (value: string) => void;
  includeCurrency: boolean;
  targetPercentage: string;
  onTargetPercentageChange: (value: string) => void;
}

export function GoalTargetValueFields({
  metricKey,
  onMetricKeyChange,
  metricKeyDisabled,
  targetCount,
  onTargetCountChange,
  targetAmountMajor,
  onTargetAmountMajorChange,
  currency,
  onCurrencyChange,
  includeCurrency,
  targetPercentage,
  onTargetPercentageChange,
}: GoalTargetValueFieldsProps) {
  return (
    <>
      {onMetricKeyChange && (
        <label className="admin-goals__field">
          Metrik
          <select
            value={metricKey}
            disabled={metricKeyDisabled}
            onChange={(e) => onMetricKeyChange(e.target.value)}
          >
            {GOAL_METRIC_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      )}

      {metricKey === "DEALS_CLOSED" && (
        <label className="admin-goals__field">
          Zielanzahl Deals
          <input
            type="number"
            min={0}
            step={1}
            value={targetCount}
            onChange={(e) => onTargetCountChange(e.target.value)}
            required
          />
        </label>
      )}

      {metricKey === "REVENUE" && (
        <>
          <label className="admin-goals__field">
            Zielumsatz
            <input
              type="number"
              min={0}
              step="0.01"
              value={targetAmountMajor}
              onChange={(e) => onTargetAmountMajorChange(e.target.value)}
              required
            />
          </label>
          {includeCurrency && (
            <label className="admin-goals__field">
              Waehrung
              <input
                type="text"
                maxLength={3}
                minLength={3}
                placeholder="EUR"
                value={currency}
                onChange={(e) => onCurrencyChange(e.target.value.toUpperCase())}
                required
              />
            </label>
          )}
        </>
      )}

      {metricKey === "CLOSE_RATE" && (
        <label className="admin-goals__field">
          Ziel-Abschlussquote (%)
          <input
            type="number"
            min={0}
            max={100}
            step="0.01"
            value={targetPercentage}
            onChange={(e) => onTargetPercentageChange(e.target.value)}
            required
          />
        </label>
      )}
    </>
  );
}
