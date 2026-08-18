/**
 * Fehlerklassen der Rule-Management-API (Phase 9 AP2, siehe
 * PHASE_9_IMPLEMENTATION_PLAN.md Abschnitt 4). Eigene, von
 * `src/server/admin/question-admin-errors.ts` getrennte Fehlerhierarchie --
 * analoges Muster, aber eine eigene Klasse, weil die beiden
 * Fachadministrations-Domaenen (Fragen vs. Regeln) bewusst nicht gekoppelt
 * werden sollen (gleiches Prinzip wie bei der Trennung
 * Questionnaire-Fehler/Rule-Fehler seit Phase 3B).
 */

export class RuleAdminError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

/** Ein referenziertes `RuleSet` existiert nicht (oder gehoert zu einem anderen Mandanten -- tenant-scoped `db`). */
export class RuleSetNotFoundError extends RuleAdminError {
  constructor(ruleSetId: string) {
    super(`RuleSet "${ruleSetId}" wurde nicht gefunden.`);
  }
}

/** Eine referenzierte `RuleSetVersion` existiert nicht oder gehoert nicht zum angegebenen `RuleSet`. */
export class RuleSetVersionNotFoundError extends RuleAdminError {
  constructor(ruleSetId: string, versionId: string) {
    super(`RuleSetVersion "${versionId}" wurde fuer RuleSet "${ruleSetId}" nicht gefunden.`);
  }
}

/**
 * Die als `copyFromVersionId` angegebene Kopiervorlage existiert nicht
 * (mandantenweit, nicht auf ein bestimmtes `RuleSet` beschraenkt --
 * `copyFromVersionId` darf laut PHASE_9_IMPLEMENTATION_PLAN.md Abschnitt 4
 * bewusst zu einem ANDEREN `RuleSet` als dem Ziel-`RuleSet` gehoeren, daher
 * eine eigene, vom `ruleSetId`-Kontext unabhaengige Fehlerklasse statt
 * `RuleSetVersionNotFoundError`).
 */
export class CopySourceRuleSetVersionNotFoundError extends RuleAdminError {
  constructor(versionId: string) {
    super(`RuleSetVersion "${versionId}" (Kopiervorlage) wurde nicht gefunden.`);
  }
}
