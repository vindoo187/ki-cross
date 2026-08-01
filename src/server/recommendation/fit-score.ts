/**
 * customerFitScore (Int, 0-100), siehe PHASE_3B_IMPLEMENTATION_PLAN.md
 * Abschnitt 3.3/3.6: gewichteter Anteil der getroffenen EligibilityRules
 * (nach `fitWeight`), gerundet via round_half_up. Bewusst float-frei ueber
 * exakte BigInt-Arithmetik implementiert: round_half_up(a/b) =
 * floor((2a+b)/(2b)) fuer a,b >= 0, statt `Math.floor(x + 0.5)`, um
 * Float-Rundungsfehler bei der Score-Berechnung kategorisch auszuschliessen
 * (siehe Modellierungsregel zu Geld-/Score-Feldern in prisma/schema.prisma).
 *
 * Sonderfall "no_weighted_eligibility_rules": wenn keine EligibilityRule ein
 * `fitWeight > 0` traegt, gibt es keine Grundlage fuer eine
 * Differenzierung - der Score wird neutral auf 100 gesetzt (kein Abzug ohne
 * Information), statt durch 0 zu teilen.
 */

import type { EligibilityRuleMatch } from "./eligibility";

/** round_half_up(numerator / denominator) als exakte Integer-Rundung (BigInt, kein Float). */
export function roundHalfUpFraction(numerator: bigint, denominator: bigint): number {
  if (denominator <= 0n) {
    throw new Error("roundHalfUpFraction: denominator muss > 0 sein.");
  }
  if (numerator < 0n) {
    throw new Error("roundHalfUpFraction: numerator darf nicht negativ sein.");
  }
  const rounded = (2n * numerator + denominator) / (2n * denominator);
  return Number(rounded);
}

/**
 * Berechnet customerFitScore aus den EligibilityRule-Treffern eines
 * ProductCandidateInput. `fitWeight` wird als nicht-negativ vorausgesetzt
 * (Regel-Autoring-Konvention, kein DB-CHECK).
 */
export function computeCustomerFitScore(matches: EligibilityRuleMatch[]): number {
  const totalWeight = matches.reduce((sum, m) => sum + BigInt(Math.max(0, m.rule.fitWeight)), 0n);
  if (totalWeight <= 0n) {
    // no_weighted_eligibility_rules: keine Differenzierung moeglich.
    return 100;
  }
  const matchedWeight = matches
    .filter((m) => m.matched)
    .reduce((sum, m) => sum + BigInt(Math.max(0, m.rule.fitWeight)), 0n);
  const score = roundHalfUpFraction(matchedWeight * 100n, totalWeight);
  return Math.min(100, Math.max(0, score));
}
