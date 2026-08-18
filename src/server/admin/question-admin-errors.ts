/**
 * Fehlerklassen der Question-Management-API (Phase 8 AP3, siehe
 * PHASE_8_IMPLEMENTATION_PLAN.md Abschnitt 6). Eigene, von
 * `src/server/questionnaire/errors.ts` (Konsultationsfluss) getrennte
 * Fehlerhierarchie, weil sich die Admin-Draft-CRUD-Schicht fachlich
 * unterscheidet (z. B. "Version ist kein DRAFT" ist hier ein 409, kein
 * Konsultationsfluss-Zustand). `QuestionnaireVersionNotEditableError` aus
 * dem Konsultationsfluss wird bewusst NICHT wiederverwendet, um die beiden
 * Domaenen nicht zu koppeln.
 */

export class QuestionAdminError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

/** Ein referenziertes `Questionnaire` existiert nicht (oder gehoert zu einem anderen Mandanten -- tenant-scoped `db`). */
export class QuestionnaireNotFoundError extends QuestionAdminError {
  constructor(questionnaireId: string) {
    super(`Questionnaire "${questionnaireId}" wurde nicht gefunden.`);
  }
}

/** Eine referenzierte `QuestionnaireVersion` existiert nicht oder gehoert nicht zum angegebenen `Questionnaire`. */
export class QuestionnaireVersionNotFoundError extends QuestionAdminError {
  constructor(questionnaireId: string, versionId: string) {
    super(
      `QuestionnaireVersion "${versionId}" wurde fuer Questionnaire "${questionnaireId}" nicht gefunden.`,
    );
  }
}

/**
 * Versuch, eine `QuestionnaireVersion` zu mutieren, die nicht (mehr) im
 * Status DRAFT ist -- serverseitige Sperre laut Plan Abschnitt 6 ("409
 * Conflict, nicht stillschweigend ignorieren"). Aenderungen an einer bereits
 * veroeffentlichten Version erfordern eine neue DRAFT-Version (AP4/AP5).
 */
export class QuestionnaireVersionNotDraftError extends QuestionAdminError {
  constructor(versionId: string, status: string) {
    super(
      `QuestionnaireVersion "${versionId}" kann nicht veraendert werden (Status: ${status}). ` +
        `Nur Versionen im Status DRAFT sind mutierbar -- Aenderungen an veroeffentlichten Versionen ` +
        `erfordern eine neue DRAFT-Version.`,
    );
  }
}

/** Eine referenzierte `Question` existiert nicht innerhalb der angegebenen `QuestionnaireVersion`. */
export class AdminQuestionNotFoundError extends QuestionAdminError {
  constructor(questionId: string, versionId: string) {
    super(`Frage "${questionId}" wurde in QuestionnaireVersion "${versionId}" nicht gefunden.`);
  }
}

/** Fachlich ungueltige Eingabe (z. B. AnswerOptions bei einem AnswerType ohne Optionen). Sammelt alle gefundenen Verstoesse. */
export class InvalidQuestionInputError extends QuestionAdminError {
  constructor(public readonly issues: string[]) {
    super(`Ungueltige Eingabe: ${issues.join("; ")}`);
  }
}

/**
 * Rollback (Phase 8 AP5) darf nur von einer bereits veroeffentlichten Version
 * (ACTIVE/EXPIRED/ARCHIVED) ausgehen -- fuer eine DRAFT-Quelle existiert
 * bereits `createDraftVersion({ copyFromVersionId })`, das dieselbe
 * Tiefkopie-Logik nutzt. Verhindert semantisch sinnlose "Rollbacks" auf einen
 * noch gar nicht veroeffentlichten Stand.
 */
export class RollbackSourceNotEligibleError extends QuestionAdminError {
  constructor(versionId: string) {
    super(
      `QuestionnaireVersion "${versionId}" kann nicht als Rollback-Quelle verwendet werden ` +
        `(Status DRAFT). Rollback ist nur von bereits veroeffentlichten Versionen ` +
        `(ACTIVE/EXPIRED/ARCHIVED) aus moeglich.`,
    );
  }
}
