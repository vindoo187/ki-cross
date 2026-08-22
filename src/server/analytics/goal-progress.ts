import type { GoalPeriodType } from "@prisma/client";

/**
 * Phase 11 AP4 (Ziel-vs.-Ist-Berechnung, siehe PHASE_11_IMPLEMENTATION_PLAN.md
 * Abschnitt 3, ChatGPT-GO 2026-08-22). Schritt 1: `getCalendarPeriodBounds()`
 * -- die EINZIGE Stelle, die aus `Goal.periodType`/`Goal.periodStart` das
 * (bewusst nicht gespeicherte) `periodEnd` ableitet.
 *
 * WICHTIG (ChatGPT-Praezisierung nach AP3.5, 2026-08-22): Die Berechnung
 * erfolgt DETERMINISTISCH IN UTC -- explizit NICHT nach dem Muster von
 * `dashboard-view.ts::resolvePeriodRange()`, das lokale `Date`-Getter/
 * -Konstruktoren nutzt (also die Laufzeit-Zeitzone des Node-Prozesses).
 * Grund: sonst koennte dasselbe Goal je nach Deployment-Umgebung
 * unterschiedliche Grenzen erzeugen -- fuer ein revisionsfaehiges
 * Zielsystem inakzeptabel. `resolvePeriodRange()` wird NICHT rueckwirkend
 * umgebaut (separater Scope), sondern bewusst NICHT wiederverwendet.
 *
 * Rueckgabe ist ein halboffenes Intervall `[periodStart, periodEnd)` --
 * identisch zur bestehenden `{ gte: from, lt: to }`-Konvention in
 * `kpis.ts` (AP3.5 hat die Kompatibilitaet bereits bestaetigt, siehe
 * PHASE_11_IMPLEMENTATION_PLAN.md Abschnitt 3 AP3.5).
 *
 * Nimmt `periodStart` UNVERAENDERT als Eingabe entgegen (kein Runden/
 * Snapping auf Kalendergrenzen). Eine Ausrichtungspruefung (z. B. "MONTH
 * erfordert periodStart = 1. des Monats um 00:00 UTC") ist NICHT Teil
 * dieser Funktion und aktuell auch nicht in `goal-validator.ts` (AP3)
 * vorhanden -- offene Beobachtung, kein Blocker fuer diesen Schritt.
 */

export interface CalendarPeriodBounds {
  periodStart: Date;
  /** Exklusiv -- siehe Modulkommentar, `[periodStart, periodEnd)`. */
  periodEnd: Date;
}

/**
 * Leitet deterministisch (UTC-Kalendermonatsarithmetik ueber `Date.UTC()`
 * mit den `getUTC*()`-Feldern von `periodStart`, keine lokale Zeitzone) das
 * Ende einer Zielperiode aus Periodentyp + -start ab.
 */
export function getCalendarPeriodBounds(
  periodType: GoalPeriodType,
  periodStart: Date,
): CalendarPeriodBounds {
  const monthsToAdd = periodLengthInMonths(periodType);
  const periodEnd = new Date(
    Date.UTC(
      periodStart.getUTCFullYear(),
      periodStart.getUTCMonth() + monthsToAdd,
      periodStart.getUTCDate(),
      periodStart.getUTCHours(),
      periodStart.getUTCMinutes(),
      periodStart.getUTCSeconds(),
      periodStart.getUTCMilliseconds(),
    ),
  );
  return { periodStart, periodEnd };
}

function periodLengthInMonths(periodType: GoalPeriodType): number {
  switch (periodType) {
    case "MONTH":
      return 1;
    case "QUARTER":
      return 3;
    case "YEAR":
      return 12;
    default: {
      const exhaustiveCheck: never = periodType;
      throw new Error(`Unbekannter GoalPeriodType: ${String(exhaustiveCheck)}`);
    }
  }
}
