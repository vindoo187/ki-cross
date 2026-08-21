/**
 * Fehlerklassen der Commission-Management-API (Phase 10 AP1, siehe
 * PHASE_10_IMPLEMENTATION_PLAN.md Abschnitt 3). Eigene, von
 * `rule-admin-errors.ts`/`question-admin-errors.ts` getrennte
 * Fehlerhierarchie -- analoges Muster, aber eine eigene Klasse, weil die
 * drei Fachadministrations-Domaenen (Fragen/Regeln/Provisionsmodelle)
 * bewusst nicht gekoppelt werden sollen (gleiches Trennungsprinzip wie
 * bereits zwischen Questionnaire- und Rule-Fehlern seit Phase 3B/9).
 */

export class CommissionAdminError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

/** Ein referenziertes `CommissionModel` existiert nicht (oder gehoert zu einem anderen Mandanten -- tenant-scoped `db`). */
export class CommissionModelNotFoundError extends CommissionAdminError {
  constructor(commissionModelId: string) {
    super(`CommissionModel "${commissionModelId}" wurde nicht gefunden.`);
  }
}

/** Eine referenzierte `CommissionModelVersion` existiert nicht oder gehoert nicht zum angegebenen `CommissionModel`. */
export class CommissionModelVersionNotFoundError extends CommissionAdminError {
  constructor(commissionModelId: string, versionId: string) {
    super(
      `CommissionModelVersion "${versionId}" wurde fuer CommissionModel "${commissionModelId}" nicht gefunden.`,
    );
  }
}

/**
 * Die als `copyFromVersionId` angegebene Kopiervorlage existiert nicht
 * (analog `CopySourceRuleSetVersionNotFoundError` aus Phase 9 AP2 --
 * `copyFromVersionId` bezieht sich auf eine konkrete Version, unabhaengig
 * vom Ziel-`CommissionModel`-Kontext).
 */
export class CopySourceCommissionModelVersionNotFoundError extends CommissionAdminError {
  constructor(versionId: string) {
    super(`CommissionModelVersion "${versionId}" (Kopiervorlage) wurde nicht gefunden.`);
  }
}

/**
 * Versuch, eine `CommissionModelVersion` zu mutieren, die nicht (mehr) im
 * Status DRAFT ist -- serverseitige Sperre analog
 * `RuleSetVersionNotDraftError` (Phase 9)/`QuestionnaireVersionNotDraftError`
 * (Phase 8). Aenderungen an einer bereits veroeffentlichten Version
 * erfordern eine neue DRAFT-Version (`createDraftCommissionModelVersion({
 * copyFromVersionId })`, AP2).
 */
export class CommissionModelVersionNotDraftError extends CommissionAdminError {
  constructor(versionId: string, status: string) {
    super(
      `CommissionModelVersion "${versionId}" kann nicht veraendert werden (Status: ${status}). ` +
        `Nur Versionen im Status DRAFT sind mutierbar -- Aenderungen an veroeffentlichten Versionen ` +
        `erfordern eine neue DRAFT-Version.`,
    );
  }
}

/**
 * `validateCommissionModelVersion()` (Phase 10 AP4, siehe
 * PHASE_10_IMPLEMENTATION_PLAN.md Abschnitt 6) hat fachliche Verstoesse
 * gefunden. `issues` enthaelt ALLE gefundenen Verstoesse, nicht nur den
 * ersten -- analog `RuleSetVersionInvalidError`/
 * `QuestionnaireVersionInvalidError`.
 */
export class CommissionModelVersionInvalidError extends CommissionAdminError {
  constructor(
    public readonly commissionModelVersionId: string,
    public readonly issues: string[],
  ) {
    super(
      `CommissionModelVersion "${commissionModelVersionId}" ist nicht gueltig: ${issues.join("; ")}`,
    );
  }
}

/**
 * Rollback wurde mit einer `sourceVersionId` im Status DRAFT aufgerufen --
 * Rollback ist nur von bereits veroeffentlichten Versionen (ACTIVE/EXPIRED/
 * ARCHIVED) aus moeglich, analog `RollbackSourceNotEligibleError` (Phase 8/9).
 */
export class CommissionRollbackSourceNotEligibleError extends CommissionAdminError {
  constructor(versionId: string) {
    super(
      `CommissionModelVersion "${versionId}" kann nicht als Rollback-Quelle verwendet werden ` +
        `(Status DRAFT). Rollback ist nur von bereits veroeffentlichten Versionen ` +
        `(ACTIVE/EXPIRED/ARCHIVED) aus moeglich.`,
    );
  }
}

/**
 * Ein ECHT paralleler Publish-Versuch fuer DASSELBE `CommissionModel` ist
 * mit der Datenbank-EXCLUDE-Constraint `commission_model_versions_no_overlap`
 * kollidiert (Phase 10 AP5, Publish-Scope ist PRO CommissionModel, nicht
 * mandantenweit -- siehe PHASE_10_IMPLEMENTATION_PLAN.md Abschnitt 0/7,
 * bewusster Unterschied zu Phase 9). Dieser Fehler ist NUR die fachliche
 * API-Uebersetzung eines erwartbaren Concurrency-Konflikts (der Verlierer
 * eines echten Wettlaufs innerhalb desselben CommissionModel) in eine
 * saubere 409-Antwort, statt eines rohen, unuebersetzten Datenbankfehlers.
 */
export class CommissionModelVersionPublishConflictError extends CommissionAdminError {
  constructor(versionId: string) {
    super(
      `CommissionModelVersion "${versionId}" konnte nicht veroeffentlicht werden, weil zeitgleich ` +
        `bereits eine andere Version DESSELBEN CommissionModel veroeffentlicht wurde ` +
        `(Publish-Konflikt bei paralleler Bearbeitung). Bitte die Version erneut oeffnen ` +
        `und den Publish-Vorgang wiederholen.`,
    );
  }
}

/**
 * Eine referenzierte `CommissionTier`-Zeile (Phase 10 AP4, TIERED-Design)
 * existiert nicht innerhalb der angegebenen `CommissionModelVersion`.
 */
export class CommissionTierNotFoundError extends CommissionAdminError {
  constructor(tierId: string, versionId: string) {
    super(
      `CommissionTier "${tierId}" wurde in CommissionModelVersion "${versionId}" nicht gefunden.`,
    );
  }
}
