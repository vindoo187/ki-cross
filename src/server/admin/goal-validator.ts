/**
 * Serverseitiger Validator fuer die metrikspezifische Zielwert-/Currency-
 * Zuordnung bei `Goal`/`GoalVersion` (Phase 11 AP3, siehe
 * PHASE_11_IMPLEMENTATION_PLAN.md Abschnitt 2/3, ChatGPT-GO 2026-08-22).
 * Analog `commission-validator.ts` (Phase 10 AP4), aber mit einem
 * grundlegenden Unterschied: `commission-validator.ts` prueft eine bereits
 * PERSISTIERTE `CommissionModelVersion` (laedt sie per `versionId` aus der
 * DB), waehrend dieser Validator auf dem noch nicht persistierten
 * `CreateGoalInput`/`CreateGoalVersionInput` arbeitet -- `Goal` kennt kein
 * Draft-Stadium, das erst spaeter validiert/veroeffentlicht wird (siehe
 * Modulkommentar `goal-admin.ts`). Wird daher gemaess dem in
 * `goal-schemas.ts` dokumentierten Muster ausschliesslich aus der
 * ROUTE-SCHICHT (AP3, `src/app/api/admin/goals/**`) aufgerufen, VOR jedem
 * `createGoal()`/`createGoalVersion()`-Aufruf -- niemals aus `goal-admin.ts`
 * selbst (klare Trennung: Struktur/PII in `goal-schemas.ts`, DB-Mutation in
 * `goal-admin.ts`, fachliche Metrik-Konsistenz hier).
 *
 * WARUM DIESE PRUEFUNG NICHT PER DB-CHECK ABBILDBAR IST: die Zuordnung
 * "welches Zielwert-Feld passt zu `metricKey`" ist eine CROSS-TABLE-Regel
 * (`Goal.metricKey` vs. `GoalVersion`-Spalten) -- ein einzeiliger
 * PostgreSQL-CHECK-Constraint kann nur Spalten DERSELBEN Zeile vergleichen
 * (siehe Kommentar zu `goal_versions_target_value_xor_check` in der
 * Migration `20260822100000_goal_model`, identisches Prinzip wie bei
 * `CommissionModelVersion`/`CommissionTier`). Die DB erzwingt daher nur die
 * METRIK-UNABHAENGIGE Basis-Invariante ("genau eines der drei Felder ist
 * gesetzt", bereits in `goal-schemas.ts::checkTargetValueXor()` gespiegelt);
 * DIESER Validator ist die EINZIGE Stelle im System, die zusaetzlich prueft,
 * ob es das RICHTIGE der drei Felder ist.
 *
 * Metrik -> erlaubtes Zielwert-Feld (ChatGPT-Vorgabe, 2026-08-22, verbindlich):
 *   DEALS_CLOSED -> targetCount                    (targetAmountMinor/targetPercentageBasisPoints verboten)
 *   REVENUE      -> targetAmountMinor + currency    (targetCount/targetPercentageBasisPoints verboten)
 *   CLOSE_RATE   -> targetPercentageBasisPoints     (targetAmountMinor/targetCount verboten)
 *
 * CURRENCY-REGEL (ChatGPT-Vorgabe, 2026-08-22): bei REVENUE zwingend gesetzt
 * (3-stelliger Code), bei DEALS_CLOSED/CLOSE_RATE zwingend NULL -- keine
 * implizite Waehrungsumrechnung, keine Vermischung. Es wird bewusst KEINE
 * neue Currency-Infrastruktur eingefuehrt (kein ISO-4217-Registry o. Ae.) --
 * dieselbe simple "3-stelliger String"-Konvention wie
 * `commission-schemas.ts`/`commission-validator.ts` wird wiederverwendet
 * (ChatGPTs ausdrueckliche Auflage: "bestehende Waehrungslogik
 * wiederverwenden, statt eine zweite Currency-Regel zu erfinden").
 *
 * `currency` ist ausschliesslich Teil von `CreateGoalInput` (Goal-Ebene,
 * unveraenderlich nach Anlage) -- `CreateGoalVersionInput` hat kein
 * `currency`-Feld (siehe `goal-schemas.ts`-Modulkommentar) und wird daher
 * hier auch nicht gegen die Currency-Regel geprueft, nur gegen die
 * Zielwert-Zuordnung.
 */

import { GoalTargetValueInvalidError } from "./goal-admin-errors";
import type { CreateGoalInput, CreateGoalVersionInput } from "./goal-schemas";

interface TargetValueFields {
  targetAmountMinor?: number | null;
  targetCount?: number | null;
  targetPercentageBasisPoints?: number | null;
}

/**
 * Prueft, ob die gesetzten Zielwert-Felder zur `metricKey` passen (siehe
 * Modulkommentar, Metrik-Zuordnungstabelle). Liefert ALLE gefundenen
 * Verstoesse (nicht nur den ersten) als String-Array -- leeres Array
 * bedeutet gueltig. Rein synchron/pure, keine DB-Zugriffe.
 */
function collectTargetValueIssues(metricKey: string, values: TargetValueFields): string[] {
  const { targetAmountMinor, targetCount, targetPercentageBasisPoints } = values;
  const issues: string[] = [];

  switch (metricKey) {
    case "DEALS_CLOSED": {
      if (targetCount == null) {
        issues.push('Metrik "DEALS_CLOSED" erfordert targetCount.');
      }
      if (targetAmountMinor != null) {
        issues.push('Metrik "DEALS_CLOSED" erlaubt targetAmountMinor nicht (muss null sein).');
      }
      if (targetPercentageBasisPoints != null) {
        issues.push(
          'Metrik "DEALS_CLOSED" erlaubt targetPercentageBasisPoints nicht (muss null sein).',
        );
      }
      break;
    }
    case "REVENUE": {
      if (targetAmountMinor == null) {
        issues.push('Metrik "REVENUE" erfordert targetAmountMinor.');
      }
      if (targetCount != null) {
        issues.push('Metrik "REVENUE" erlaubt targetCount nicht (muss null sein).');
      }
      if (targetPercentageBasisPoints != null) {
        issues.push('Metrik "REVENUE" erlaubt targetPercentageBasisPoints nicht (muss null sein).');
      }
      break;
    }
    case "CLOSE_RATE": {
      if (targetPercentageBasisPoints == null) {
        issues.push('Metrik "CLOSE_RATE" erfordert targetPercentageBasisPoints.');
      }
      if (targetAmountMinor != null) {
        issues.push('Metrik "CLOSE_RATE" erlaubt targetAmountMinor nicht (muss null sein).');
      }
      if (targetCount != null) {
        issues.push('Metrik "CLOSE_RATE" erlaubt targetCount nicht (muss null sein).');
      }
      break;
    }
    default: {
      // Defense-in-Depth: `metricKey` ist hier bewusst als `string` typisiert
      // (nicht als literal Union), da `validateCreateGoalVersionInput()` den
      // Wert dynamisch aus dem geladenen `Goal` erhaelt (siehe unten) --
      // strukturell sollte dieser Zweig nie erreicht werden (DB-Enum
      // `GoalMetricKey` kennt nur die drei obigen Werte).
      issues.push(`Unbekannter GoalMetricKey: "${metricKey}".`);
    }
  }

  return issues;
}

/**
 * Prueft die Currency-Regel (siehe Modulkommentar): REVENUE zwingend
 * gesetzt (3-stelliger Code, bereits per Zod strukturell geprueft, siehe
 * `goal-schemas.ts`), DEALS_CLOSED/CLOSE_RATE zwingend null.
 */
function collectCurrencyIssues(metricKey: string, currency: string | null): string[] {
  const issues: string[] = [];
  if (metricKey === "REVENUE") {
    if (currency == null) {
      issues.push('Metrik "REVENUE" erfordert eine currency (3-stelliger Waehrungscode).');
    }
  } else if (currency != null) {
    issues.push(`Metrik "${metricKey}" erlaubt keine currency (muss null sein).`);
  }
  return issues;
}

/**
 * Validiert die Eingabe fuer `createGoal()` VOR dem Aufruf (Metrik-
 * Zielwert-Zuordnung + Currency-Regel gemeinsam, da `CreateGoalInput` beide
 * Felder traegt). Wirft `GoalTargetValueInvalidError` mit ALLEN gefundenen
 * Verstoessen, falls ungueltig. Bei Erfolg `{ valid: true }` (identische
 * Rueckgabeform wie `validateCommissionModelVersion()`).
 */
export function validateCreateGoalInput(input: CreateGoalInput): { valid: true } {
  const issues = [
    ...collectTargetValueIssues(input.metricKey, input),
    ...collectCurrencyIssues(input.metricKey, input.currency ?? null),
  ];
  if (issues.length > 0) {
    throw new GoalTargetValueInvalidError(issues);
  }
  return { valid: true };
}

/**
 * Validiert die Eingabe fuer `createGoalVersion()` VOR dem Aufruf --
 * ausschliesslich die Zielwert-Zuordnung, da `CreateGoalVersionInput` kein
 * `currency`-Feld hat (Currency ist Goal-Ebene, unveraenderlich, siehe
 * Modulkommentar). Der Aufrufer (Route-Schicht) muss `metricKey` selbst aus
 * dem uebergeordneten `Goal` ermitteln, z. B. via `getGoalDetail(goalId)`
 * (`goal-admin.ts`) -- dieser Validator selbst laedt bewusst keine Daten.
 */
export function validateCreateGoalVersionInput(
  metricKey: string,
  input: CreateGoalVersionInput,
): { valid: true } {
  const issues = collectTargetValueIssues(metricKey, input);
  if (issues.length > 0) {
    throw new GoalTargetValueInvalidError(issues);
  }
  return { valid: true };
}
