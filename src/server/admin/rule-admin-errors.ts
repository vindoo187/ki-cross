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

/**
 * Versuch, eine `RuleSetVersion` zu mutieren, die nicht (mehr) im Status
 * DRAFT ist -- serverseitige Sperre (Phase 9 AP3, ChatGPT-Auflage
 * 2026-08-18: "DRAFT-only fuer saemtliche Mutationen"), analog
 * `QuestionnaireVersionNotDraftError` aus Phase 8. Aenderungen an einer
 * bereits veroeffentlichten Version erfordern eine neue DRAFT-Version
 * (AP2 `createDraftRuleSetVersion({ copyFromVersionId })`).
 */
export class RuleSetVersionNotDraftError extends RuleAdminError {
  constructor(versionId: string, status: string) {
    super(
      `RuleSetVersion "${versionId}" kann nicht veraendert werden (Status: ${status}). ` +
        `Nur Versionen im Status DRAFT sind mutierbar -- Aenderungen an veroeffentlichten Versionen ` +
        `erfordern eine neue DRAFT-Version.`,
    );
  }
}

/**
 * Eine referenzierte Regel (beliebiger Typ -- Eligibility/Exclusion/
 * Prioritization/CrossSelling) existiert nicht innerhalb der angegebenen
 * `RuleSetVersion`. `ruleTypeLabel` macht die Fehlermeldung je Regeltyp
 * unterscheidbar, ohne vier fast identische Fehlerklassen zu benoetigen.
 */
export class AdminRuleNotFoundError extends RuleAdminError {
  constructor(ruleTypeLabel: string, ruleId: string, versionId: string) {
    super(`${ruleTypeLabel} "${ruleId}" wurde in RuleSetVersion "${versionId}" nicht gefunden.`);
  }
}

/**
 * `validateDraftRuleSetVersion()` (Phase 9 AP4, siehe
 * PHASE_9_IMPLEMENTATION_PLAN.md Abschnitt 6) hat fachliche Verstoesse
 * gefunden. `issues` enthaelt ALLE gefundenen Verstoesse, nicht nur den
 * ersten -- analog `QuestionnaireVersionInvalidError`
 * (`src/server/questionnaire/errors.ts`, seit Phase 3A/8).
 */
export class RuleSetVersionInvalidError extends RuleAdminError {
  constructor(
    public readonly ruleSetVersionId: string,
    public readonly issues: string[],
  ) {
    super(`RuleSetVersion "${ruleSetVersionId}" ist nicht gueltig: ${issues.join("; ")}`);
  }
}

/**
 * Rollback (Phase 9 AP6, siehe PHASE_9_IMPLEMENTATION_PLAN.md Abschnitt 8)
 * wurde mit einer `sourceVersionId` im Status DRAFT aufgerufen -- Rollback
 * ist nur von bereits veroeffentlichten Versionen (ACTIVE/EXPIRED/ARCHIVED)
 * aus moeglich, analog `RollbackSourceNotEligibleError` aus Phase 8.
 */
export class RollbackSourceNotEligibleError extends RuleAdminError {
  constructor(versionId: string) {
    super(
      `RuleSetVersion "${versionId}" kann nicht als Rollback-Quelle verwendet werden ` +
        `(Status DRAFT). Rollback ist nur von bereits veroeffentlichten Versionen ` +
        `(ACTIVE/EXPIRED/ARCHIVED) aus moeglich.`,
    );
  }
}
