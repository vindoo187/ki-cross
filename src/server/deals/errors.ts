/**
 * Fehlerklassen der Deal-Erfassung (Phase 6 AP3), analog zu
 * src/server/questionnaire/errors.ts und src/server/recommendation/errors.ts:
 * jede Klasse entspricht einem eigenen, in PHASE_6_IMPLEMENTATION_PLAN.md
 * dokumentierten Fehlercode, damit Aufrufer gezielt per `instanceof`
 * unterscheiden koennen statt Fehlermeldungstexte zu parsen.
 */

export class DealEngineError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

/** Eine referenzierte ConsultationSession existiert nicht (oder gehoert zu einem anderen Mandanten). */
export class DealConsultationSessionNotFoundError extends DealEngineError {
  constructor(consultationSessionId: string) {
    super(`ConsultationSession "${consultationSessionId}" wurde nicht gefunden.`);
  }
}

/**
 * closeDeal() wurde fuer eine Session mit nicht abschlussfaehigem Status
 * aufgerufen. Wie bei assertSessionEvaluable() (recommendation/service.ts)
 * bewusst als POSITIVE Whitelist formuliert: IN_PROGRESS (Abschluss waehrend
 * laufender Beratung) und COMPLETED (Abschluss nach Fragebogen-Ende, der
 * regulaere Fall auf der Zusammenfassungsseite). ABANDONED bleibt gesperrt.
 */
export class DealSessionNotClosableError extends DealEngineError {
  constructor(consultationSessionId: string, status: string) {
    super(
      `ConsultationSession "${consultationSessionId}" kann keinen Deal mehr erhalten (Status: ${status}). Erlaubt sind ausschliesslich IN_PROGRESS und COMPLETED.`,
    );
  }
}

/** closeDeal() wurde ohne mindestens ein DealItem aufgerufen. */
export class DealRequiresItemsError extends DealEngineError {
  constructor() {
    super("Ein Deal benoetigt mindestens ein DealItem.");
  }
}

/** Eine angegebene productVersionId existiert nicht (oder gehoert zu einem anderen Mandanten). */
export class DealProductVersionNotFoundError extends DealEngineError {
  constructor(productVersionId: string) {
    super(`ProductVersion "${productVersionId}" wurde nicht gefunden.`);
  }
}

/**
 * Fuer eine ConsultationSession existiert bereits ein Deal. Deal-Abschluss
 * ist bewusst ein Einmalvorgang pro Session (kein Nachtragen weiterer
 * Positionen zu einem bereits geschlossenen Deal in Phase 6, siehe Plan
 * Abschnitt "Out of Scope": kein CRM-Auftragsprozess).
 */
export class DealAlreadyExistsForSessionError extends DealEngineError {
  constructor(consultationSessionId: string) {
    super(
      `Fuer ConsultationSession "${consultationSessionId}" existiert bereits ein Deal. Ein zweiter Abschluss pro Sitzung ist in Phase 6 nicht vorgesehen.`,
    );
  }
}
