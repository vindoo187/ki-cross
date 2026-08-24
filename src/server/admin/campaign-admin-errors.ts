/**
 * Fehlerklassen der Campaign-Management-API (Phase 13 AP2, siehe
 * PHASE_13_IMPLEMENTATION_PLAN.md Abschnitt 3). Eigene, von
 * `commission-admin-errors.ts`/`rule-admin-errors.ts`/`goal-admin-errors.ts`
 * getrennte Fehlerhierarchie -- analoges Muster, bewusst nicht gekoppelt
 * (gleiches Trennungsprinzip wie zwischen allen bisherigen
 * Fachadministrations-Domaenen).
 */

export class CampaignAdminError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

/** Eine referenzierte `Campaign` existiert nicht (oder gehoert zu einem anderen Mandanten -- tenant-scoped `db`). */
export class CampaignNotFoundError extends CampaignAdminError {
  constructor(campaignId: string) {
    super(`Campaign "${campaignId}" wurde nicht gefunden.`);
  }
}

/**
 * `key` einer neuen `Campaign` kollidiert mit einer bereits bestehenden
 * `Campaign` desselben Mandanten (DB-UNIQUE-Constraint
 * `campaigns_tenant_id_key_key`, siehe Migration `20260731000000_init`).
 */
export class CampaignKeyAlreadyExistsError extends CampaignAdminError {
  constructor(key: string) {
    super(`Campaign mit key "${key}" existiert bereits fuer diesen Mandanten.`);
  }
}

/** Eine referenzierte `CampaignVersion` existiert nicht oder gehoert nicht zur angegebenen `Campaign`. */
export class CampaignVersionNotFoundError extends CampaignAdminError {
  constructor(campaignId: string, versionId: string) {
    super(`CampaignVersion "${versionId}" wurde fuer Campaign "${campaignId}" nicht gefunden.`);
  }
}

/**
 * Die als `copyFromVersionId` angegebene Kopiervorlage existiert nicht
 * (analog `CopySourceCommissionModelVersionNotFoundError`, Phase 10 AP2) --
 * `copyFromVersionId` muss zu DERSELBEN `Campaign` gehoeren (per-Entity-
 * Publish-Scope, siehe `campaign-admin.ts` Modulkommentar).
 */
export class CopySourceCampaignVersionNotFoundError extends CampaignAdminError {
  constructor(versionId: string) {
    super(`CampaignVersion "${versionId}" (Kopiervorlage) wurde nicht gefunden.`);
  }
}

/**
 * Versuch, eine `CampaignVersion` zu mutieren, die nicht (mehr) im Status
 * DRAFT ist -- serverseitige Sperre analog
 * `CommissionModelVersionNotDraftError`/`RuleSetVersionNotDraftError`.
 * Aenderungen an einer bereits veroeffentlichten Version erfordern eine
 * neue DRAFT-Version (`createDraftCampaignVersion({ copyFromVersionId })`).
 */
export class CampaignVersionNotDraftError extends CampaignAdminError {
  constructor(versionId: string, status: string) {
    super(
      `CampaignVersion "${versionId}" kann nicht veraendert werden (Status: ${status}). ` +
        `Nur Versionen im Status DRAFT sind mutierbar -- Aenderungen an veroeffentlichten Versionen ` +
        `erfordern eine neue DRAFT-Version.`,
    );
  }
}

/**
 * `scopeId` ist fuer den angegebenen `scopeType` nicht gueltig -- die
 * referenzierte Entitaet existiert nicht oder gehoert nicht zum aktuellen
 * Mandanten (analog `GoalScopeInvalidError`, Phase 11 AP3). Wird von
 * `validateScopeId()` geworfen, VOR jeder Mutation (kein Audit-Eintrag
 * bleibt bei ungueltigem Scope zurueck).
 */
export class CampaignScopeInvalidError extends CampaignAdminError {
  constructor(
    public readonly scopeType: string,
    public readonly scopeId: string,
  ) {
    super(
      `scopeId "${scopeId}" ist fuer scopeType "${scopeType}" nicht gueltig -- die referenzierte ` +
        `Entitaet existiert nicht oder gehoert nicht zum aktuellen Mandanten.`,
    );
  }
}

/**
 * Serverseitige Validierung (Struktur der `CampaignCondition`-Bedingungen,
 * analog `assertValidConditionSource()`/Operator-Zulaessigkeit aus
 * `rule-admin.ts::validateDraftRuleSetVersion()`) hat fachliche Verstoesse
 * gefunden. `issues` enthaelt ALLE gefundenen Verstoesse, nicht nur den
 * ersten.
 */
export class CampaignVersionInvalidError extends CampaignAdminError {
  constructor(
    public readonly campaignVersionId: string,
    public readonly issues: string[],
  ) {
    super(`CampaignVersion "${campaignVersionId}" ist nicht gueltig: ${issues.join("; ")}`);
  }
}

/**
 * Ein ECHT paralleler Publish-Versuch fuer DIESELBE `Campaign` ist mit der
 * Datenbank-EXCLUDE-Constraint `campaign_versions_no_overlap` kollidiert
 * (Publish-Scope ist PRO Campaign, nicht mandantenweit -- analog
 * `CommissionModelVersionPublishConflictError`, Phase 10 AP5). Nur die
 * fachliche API-Uebersetzung eines erwartbaren Concurrency-Konflikts in
 * eine saubere 409-Antwort, statt eines rohen, unuebersetzten
 * Datenbankfehlers.
 */
export class CampaignVersionPublishConflictError extends CampaignAdminError {
  constructor(versionId: string) {
    super(
      `CampaignVersion "${versionId}" konnte nicht veroeffentlicht werden, weil zeitgleich bereits ` +
        `eine andere Version DERSELBEN Campaign veroeffentlicht wurde (Publish-Konflikt bei ` +
        `paralleler Bearbeitung). Bitte die Version erneut oeffnen und den Publish-Vorgang wiederholen.`,
    );
  }
}
