/**
 * Fehlerklassen der Fragen-Engine (Phase 3A). Jede Klasse entspricht einem
 * eigenen, im Service-Interface dokumentierten Fehlercode (siehe
 * docs/QUESTION_ENGINE.md, Abschnitt Fehlercodes), damit Aufrufer gezielt
 * per `instanceof` unterscheiden koennen statt Fehlermeldungstexte zu parsen.
 */

export class QuestionEngineError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

/** Keine zeitlich gueltige, ACTIVE QuestionnaireVersion fuer den angefragten Zeitpunkt gefunden. */
export class NoActiveQuestionnaireVersionError extends QuestionEngineError {
  constructor(questionnaireKey: string, atTime: Date) {
    super(
      `Keine gueltige, aktive QuestionnaireVersion fuer Fragebogen "${questionnaireKey}" zum Zeitpunkt ${atTime.toISOString()} gefunden.`,
    );
  }
}

/** Eine referenzierte ConsultationSession existiert nicht (oder gehoert zu einem anderen Mandanten). */
export class ConsultationSessionNotFoundError extends QuestionEngineError {
  constructor(consultationSessionId: string) {
    super(`ConsultationSession "${consultationSessionId}" wurde nicht gefunden.`);
  }
}

/** Eine referenzierte Frage(-Version) existiert nicht innerhalb der geladenen QuestionnaireVersion. */
export class QuestionNotFoundError extends QuestionEngineError {
  constructor(questionId: string) {
    super(`Frage "${questionId}" ist in dieser Fragebogen-Version nicht vorhanden.`);
  }
}

/**
 * Eine gespeicherte Antwort verletzt die Validierungsregeln ihres AnswerType
 * (siehe answer-validation.ts). `issues` enthaelt alle gefundenen Verstoesse,
 * nicht nur den ersten.
 */
export class InvalidAnswerError extends QuestionEngineError {
  constructor(
    public readonly questionVersionId: string,
    public readonly issues: string[],
  ) {
    super(`Ungueltige Antwort fuer QuestionVersion "${questionVersionId}": ${issues.join("; ")}`);
  }
}

/**
 * Compare-And-Swap-Konflikt: Die uebergebene `expectedAnswerVersion` stimmt
 * nicht (mehr) mit der aktuell aktiven Antwortversion ueberein - z. B. weil
 * zwischenzeitlich ein anderer Request dieselbe Antwort geaendert hat.
 */
export class StaleAnswerVersionError extends QuestionEngineError {
  constructor(questionVersionId: string, expectedAnswerVersion: number) {
    super(
      `Antwortaenderung fuer QuestionVersion "${questionVersionId}" abgelehnt: erwartete Antwortversion ${expectedAnswerVersion} ist nicht mehr aktuell (Compare-And-Swap-Konflikt).`,
    );
  }
}

/** Eine referenzierte QuestionVersion definiert widerspruechliche Sichtbarkeits-Kombinatoren (gemischte AND/OR-Gruppe). */
export class MixedCombinatorError extends QuestionEngineError {
  constructor(questionVersionId: string) {
    super(
      `QuestionVersion "${questionVersionId}" hat Sichtbarkeitsbedingungen mit gemischten Kombinatoren (AND und OR gleichzeitig) - Phase 3A unterstuetzt nur eine einheitliche Ebene pro Frage.`,
    );
  }
}

/** Der Sichtbarkeits-Abhaengigkeitsgraph einer QuestionnaireVersion enthaelt einen Zyklus. */
export class VisibilityCycleError extends QuestionEngineError {
  constructor(cycleQuestionIds: string[]) {
    super(
      `Zyklus in den Sichtbarkeitsbedingungen entdeckt (nicht deterministisch aufloesbar): ${cycleQuestionIds.join(" -> ")}`,
    );
  }
}

/** Versuch, eine bereits abgeschlossene oder abgebrochene Fragebogen-Sitzung weiter zu bearbeiten. */
export class QuestionnaireRunNotModifiableError extends QuestionEngineError {
  constructor(consultationSessionId: string, status: string) {
    super(
      `Fragebogen-Sitzung "${consultationSessionId}" kann nicht mehr veraendert werden (Status: ${status}).`,
    );
  }
}

/** Eine Pflichtfrage im aktuell sichtbaren Pfad ist unbeantwortet - Abschluss nicht moeglich. */
export class IncompleteQuestionnaireError extends QuestionEngineError {
  constructor(public readonly missingQuestionIds: string[]) {
    super(
      `Fragebogen kann nicht abgeschlossen werden: ${missingQuestionIds.length} sichtbare Pflichtfrage(n) unbeantwortet (${missingQuestionIds.join(", ")}).`,
    );
  }
}

/**
 * Eine Antwort wurde fuer eine Frage versucht, die im aktuell sichtbaren Pfad
 * NICHT sichtbar ist (siehe Anforderung "Frage ist im aktuellen Pfad
 * sichtbar" in PHASE_3A_STARTPROMPT.md, Abschnitt 5).
 */
export class QuestionNotVisibleError extends QuestionEngineError {
  constructor(questionId: string) {
    super(
      `Frage "${questionId}" ist im aktuell sichtbaren Fragenpfad dieser Beratung nicht sichtbar und kann daher nicht beantwortet werden.`,
    );
  }
}

/**
 * Eine `QuestionnaireVersion` verletzt mindestens eine kritische
 * Validierungsregel aus PHASE_3A_STARTPROMPT.md, Abschnitt 8, und darf daher
 * nicht veroeffentlicht/aktiv verwendet werden. `issues` enthaelt ALLE
 * gefundenen Verstoesse, nicht nur den ersten (analog zu InvalidAnswerError).
 */
export class QuestionnaireVersionInvalidError extends QuestionEngineError {
  constructor(
    public readonly questionnaireVersionId: string,
    public readonly issues: string[],
  ) {
    super(
      `QuestionnaireVersion "${questionnaireVersionId}" ist nicht gueltig: ${issues.join("; ")}`,
    );
  }
}

/**
 * Versuch, eine `QuestionnaireVersion` inhaltlich zu veraendern, die nicht
 * (mehr) im Status DRAFT ist (siehe "bereits in Beratungen verwendete
 * veroeffentlichte Version darf nicht nachtraeglich inhaltlich veraendert
 * werden", PHASE_3A_STARTPROMPT.md Abschnitt 8).
 */
export class QuestionnaireVersionNotEditableError extends QuestionEngineError {
  constructor(questionnaireVersionId: string, status: string) {
    super(
      `QuestionnaireVersion "${questionnaireVersionId}" kann nicht mehr inhaltlich veraendert werden (Status: ${status}). Nur Versionen im Status DRAFT sind editierbar.`,
    );
  }
}

/**
 * Versuch, `saveAnswer()` fuer eine Frage aufzurufen, die in dieser Beratung
 * bereits eine aktive Antwort hat. `saveAnswer()` ist bewusst nur fuer die
 * ERSTE Antwort einer Frage gedacht (siehe PHASE_3A_STARTPROMPT.md, Abschnitt
 * 11 "Idempotenz und Nebenlaeufigkeit") - fuer Aenderungen an einer
 * vorhandenen Antwort ist `changeAnswer()` (mit CAS ueber `answerVersion`) zu
 * verwenden. Dient zugleich als Absicherung gegen einen Doppel-Request-Race
 * (Datenbank-Unique-Index `customer_answers_one_active_per_question`).
 */
export class AnswerAlreadyExistsError extends QuestionEngineError {
  constructor(questionVersionId: string) {
    super(
      `Fuer QuestionVersion "${questionVersionId}" existiert in dieser Beratung bereits eine aktive Antwort. Verwende changeAnswer(), um eine vorhandene Antwort zu aendern.`,
    );
  }
}

/**
 * Versuch, `abandonConsultation()` (AP10, siehe PHASE_5_IMPLEMENTATION_PLAN.md
 * Abschnitt 10 + Projektleiter-Entscheidung zum manuellen Abbruchflow) fuer
 * eine ConsultationSession aufzurufen, fuer die bereits ein
 * `CONSULTATION_COMPLETED`-Analytics-Event existiert. `CONSULTATION_COMPLETED`
 * und `CONSULTATION_ABANDONED` schliessen sich gegenseitig aus -- die
 * Mandatentrennung erfolgt bewusst ueber die bereits geschriebenen
 * terminalen Analytics-Events, nicht ueber ein neues Lifecycle-Feld (siehe
 * Modulkommentar in `completion.ts`/`abandonment.ts`).
 */
export class ConsultationAlreadyCompletedError extends QuestionEngineError {
  constructor(
    consultationSessionId: string,
    public readonly completedAt: Date,
  ) {
    super(
      `ConsultationSession "${consultationSessionId}" wurde bereits am ${completedAt.toISOString()} abgeschlossen (CONSULTATION_COMPLETED) und kann daher nicht mehr abgebrochen werden.`,
    );
  }
}
