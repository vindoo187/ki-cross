/**
 * Fehlerklassen der Playbook-Management-API (Phase 14 AP2, siehe
 * PHASE_14_IMPLEMENTATION_PLAN.md Abschnitt 3). Eigene, von
 * `campaign-admin-errors.ts`/`commission-admin-errors.ts`/
 * `goal-admin-errors.ts` getrennte Fehlerhierarchie -- analoges Muster,
 * bewusst nicht gekoppelt (gleiches Trennungsprinzip wie zwischen allen
 * bisherigen Fachadministrations-Domaenen).
 */

export class PlaybookAdminError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

/** Ein referenziertes `Playbook` existiert nicht (oder gehoert zu einem anderen Mandanten -- tenant-scoped `db`). */
export class PlaybookNotFoundError extends PlaybookAdminError {
  constructor(playbookId: string) {
    super(`Playbook "${playbookId}" wurde nicht gefunden.`);
  }
}

/**
 * `key` eines neuen `Playbook` kollidiert mit einem bereits bestehenden
 * `Playbook` desselben Mandanten (DB-UNIQUE-Constraint
 * `playbooks_tenant_id_key_key`, siehe Migration
 * `20260831180000_playbook_management`).
 */
export class PlaybookKeyAlreadyExistsError extends PlaybookAdminError {
  constructor(key: string) {
    super(`Playbook mit key "${key}" existiert bereits fuer diesen Mandanten.`);
  }
}

/** Eine referenzierte `PlaybookVersion` existiert nicht oder gehoert nicht zum angegebenen `Playbook`. */
export class PlaybookVersionNotFoundError extends PlaybookAdminError {
  constructor(playbookId: string, versionId: string) {
    super(`PlaybookVersion "${versionId}" wurde fuer Playbook "${playbookId}" nicht gefunden.`);
  }
}

/**
 * Die als `copyFromVersionId` angegebene Kopiervorlage existiert nicht
 * (analog `CopySourceCampaignVersionNotFoundError`, Phase 13 AP2) --
 * `copyFromVersionId` muss zu DEMSELBEN `Playbook` gehoeren (per-Entity-
 * Publish-Scope, siehe `playbook-admin.ts` Modulkommentar).
 */
export class CopySourcePlaybookVersionNotFoundError extends PlaybookAdminError {
  constructor(versionId: string) {
    super(`PlaybookVersion "${versionId}" (Kopiervorlage) wurde nicht gefunden.`);
  }
}

/**
 * Versuch, eine `PlaybookVersion` zu mutieren, die nicht (mehr) im Status
 * DRAFT ist -- serverseitige Sperre analog
 * `CampaignVersionNotDraftError`/`CommissionModelVersionNotDraftError`.
 * Aenderungen an einer bereits veroeffentlichten Version erfordern eine
 * neue DRAFT-Version (`createDraftPlaybookVersion({ copyFromVersionId })`).
 */
export class PlaybookVersionNotDraftError extends PlaybookAdminError {
  constructor(versionId: string, status: string) {
    super(
      `PlaybookVersion "${versionId}" kann nicht veraendert werden (Status: ${status}). ` +
        `Nur Versionen im Status DRAFT sind mutierbar -- Aenderungen an veroeffentlichten Versionen ` +
        `erfordern eine neue DRAFT-Version.`,
    );
  }
}

/**
 * `scopeId` ist fuer den angegebenen `scopeType` nicht gueltig -- die
 * referenzierte Entitaet existiert nicht oder gehoert nicht zum aktuellen
 * Mandanten (analog `CampaignScopeInvalidError`/`GoalScopeInvalidError`).
 * Wird von `validateScopeId()` geworfen, VOR jeder Mutation (kein
 * Audit-Eintrag bleibt bei ungueltigem Scope zurueck).
 */
export class PlaybookScopeInvalidError extends PlaybookAdminError {
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
 * Serverseitige Struktur-Validierung der `PlaybookSection`-Eintraege einer
 * Version (nicht-leere `title`/`content` nach Trim -- Defense-in-Depth
 * ueber die Zod-`min(1)`-Pruefung hinaus, die Whitespace-only-Strings
 * NICHT ablehnt) hat fachliche Verstoesse gefunden. `issues` enthaelt ALLE
 * gefundenen Verstoesse, nicht nur den ersten. Bewusst KEINE
 * Content-Scanning-/Prompt-Injection-Heuristik hier (ChatGPT-Vorgabe AP1,
 * siehe `playbook-schemas.ts`-Modulkommentar) -- reine Strukturpruefung.
 */
export class PlaybookVersionInvalidError extends PlaybookAdminError {
  constructor(
    public readonly playbookVersionId: string,
    public readonly issues: string[],
  ) {
    super(`PlaybookVersion "${playbookVersionId}" ist nicht gueltig: ${issues.join("; ")}`);
  }
}

/**
 * Ein ECHT paralleler Publish-Versuch fuer DASSELBE `Playbook` ist mit der
 * Datenbank-EXCLUDE-Constraint `playbook_versions_no_overlap` kollidiert
 * (Publish-Scope ist PRO Playbook, nicht mandantenweit -- analog
 * `CampaignVersionPublishConflictError`). Nur die fachliche
 * API-Uebersetzung eines erwartbaren Concurrency-Konflikts in eine saubere
 * 409-Antwort, statt eines rohen, unuebersetzten Datenbankfehlers.
 */
export class PlaybookVersionPublishConflictError extends PlaybookAdminError {
  constructor(versionId: string) {
    super(
      `PlaybookVersion "${versionId}" konnte nicht veroeffentlicht werden, weil zeitgleich bereits ` +
        `eine andere Version DESSELBEN Playbooks veroeffentlicht wurde (Publish-Konflikt bei ` +
        `paralleler Bearbeitung). Bitte die Version erneut oeffnen und den Publish-Vorgang wiederholen.`,
    );
  }
}
