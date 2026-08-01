/**
 * Fehlerklassen der Empfehlungs-Engine (Phase 3B), analog zu
 * src/server/questionnaire/errors.ts: jede Klasse entspricht einem eigenen,
 * in PHASE_3B_IMPLEMENTATION_PLAN.md Abschnitt 8 dokumentierten Fehlercode,
 * damit Aufrufer gezielt per `instanceof` unterscheiden koennen statt
 * Fehlermeldungstexte zu parsen.
 */

export class RecommendationEngineError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

// ---------------------------------------------------------------------------
// evaluate() - Erstauswertung (siehe Implementierungsplan Abschnitt 5)
// ---------------------------------------------------------------------------

/** evaluate() wurde fuer eine Session mit Status != IN_PROGRESS aufgerufen. */
export class SessionNotEvaluableError extends RecommendationEngineError {
  constructor(consultationSessionId: string, status: string) {
    super(
      `ConsultationSession "${consultationSessionId}" kann nicht ausgewertet werden (Status: ${status}). evaluate() ist ausschliesslich fuer IN_PROGRESS-Sessions vorgesehen - verwende getLatestRecommendation() fuer einen reinen Lesezugriff.`,
    );
  }
}

/**
 * Sichtbare Pflichtfragen (gemaess computeVisiblePath()/computeProgress()
 * aus src/server/questionnaire/path.ts) sind unbeantwortet - Auswertung nicht
 * moeglich. `missingQuestionIds` sind stabile Frage-IDs, keine Freitextliste.
 */
export class InsufficientAnswerDataError extends RecommendationEngineError {
  constructor(public readonly missingQuestionIds: string[]) {
    super(
      `Session kann nicht ausgewertet werden: ${missingQuestionIds.length} sichtbare Pflichtfrage(n) unbeantwortet (${missingQuestionIds.join(", ")}).`,
    );
  }
}

/** Fuer den Tenant existiert zum Auswertungszeitpunkt keine (oder mehr als eine) ACTIVE RuleSetVersion. */
export class RuleSetNotConfiguredError extends RecommendationEngineError {
  constructor(tenantId: string, atTime: Date) {
    super(
      `Kein eindeutiges, gueltiges RuleSet fuer Tenant "${tenantId}" zum Zeitpunkt ${atTime.toISOString()} konfiguriert (erwartet: genau eine ACTIVE RuleSetVersion).`,
    );
  }
}

/** Zum Auswertungszeitpunkt existiert tenant-weit keine einzige gueltige ProductVersion. */
export class NoValidProductVersionError extends RecommendationEngineError {
  constructor(tenantId: string, atTime: Date) {
    super(
      `Keine gueltige ProductVersion fuer Tenant "${tenantId}" zum Zeitpunkt ${atTime.toISOString()} gefunden - Auswertung kann kein Ergebnis erzeugen.`,
    );
  }
}

/**
 * Eine PrioritizationRule mit commissionRequired=true konnte keine gueltige
 * CommissionModelVersion auf dem betroffenen Produkt aufloesen - die
 * GESAMTE Session-Auswertung wird kontrolliert abgebrochen (siehe
 * Implementierungsplan Abschnitt 3.8), es wird KEINE Recommendation
 * gespeichert.
 */
export class CommissionModelUnresolvedError extends RecommendationEngineError {
  constructor(
    public readonly prioritizationRuleKey: string,
    public readonly productId: string,
  ) {
    super(
      `PrioritizationRule "${prioritizationRuleKey}" verlangt eine aufloesbare CommissionModelVersion (commissionRequired=true), aber fuer Produkt "${productId}" ist zum Auswertungszeitpunkt keine gueltige Version auffindbar.`,
    );
  }
}

/**
 * Der Fingerprint-Fast-Path-SELECT (siehe Abschnitt 3.7) fand vor dem
 * Schreiben keinen Treffer, die anschliessende Transaktion schlug jedoch mit
 * P2002 auf dem Unique-Constraint [tenantId, consultationSessionId,
 * evaluationFingerprint] fehl UND die danach ausserhalb der Transaktion
 * erneut ausgefuehrte Recovery-Abfrage lieferte KEINEN Treffer. Das deutet
 * auf Datenkorruption oder einen Fingerprint-Bug hin und wird NIE
 * stillschweigend geschluckt.
 */
export class RecommendationConsistencyError extends RecommendationEngineError {
  constructor(consultationSessionId: string, evaluationFingerprint: string) {
    super(
      `Interner Konsistenzfehler: P2002 auf Recommendation-Fingerprint fuer Session "${consultationSessionId}" (Fingerprint ${evaluationFingerprint}), aber keine anschliessend auffindbare Zeile mit diesem Fingerprint. Moegliche Ursachen: Datenkorruption oder ein Fehler in der Fingerprint-Berechnung.`,
    );
  }
}

// ---------------------------------------------------------------------------
// Regel-Autoring-Validierung (attribute-registry.ts / conditions.ts,
// siehe Implementierungsplan Abschnitt 3.1)
// ---------------------------------------------------------------------------

/** attributeKey einer Condition ist nicht in der geschlossenen Attribute-Registry eingetragen. */
export class UnknownAttributeKeyError extends RecommendationEngineError {
  constructor(sourceType: string, attributeKey: string) {
    super(
      `Unbekannter attributeKey "${attributeKey}" fuer sourceType "${sourceType}" - kein Eintrag in der geschlossenen Attribute-Registry (attribute-registry.ts).`,
    );
  }
}

/** Der verwendete Operator ist fuer den valueType des referenzierten Attributs nicht erlaubt. */
export class InvalidOperatorForAttributeError extends RecommendationEngineError {
  constructor(sourceType: string, attributeKey: string, operator: string) {
    super(
      `Operator "${operator}" ist fuer Attribut "${attributeKey}" (sourceType "${sourceType}") nicht erlaubt.`,
    );
  }
}

/** comparisonValue laesst sich nicht gemaess dem valueType des referenzierten Attributs parsen. */
export class InvalidComparisonValueError extends RecommendationEngineError {
  constructor(attributeKey: string, comparisonValue: string, expectedType: string) {
    super(
      `Vergleichswert "${comparisonValue}" fuer Attribut "${attributeKey}" ist keine gueltige Auspraegung von ${expectedType}.`,
    );
  }
}

/**
 * Eine ConditionInput-Zeile verletzt die strukturelle Validierungsregel
 * "genau eines von questionId/attributeKey muss gesetzt sein, abhaengig von
 * sourceType" (Implementierungsplan Abschnitt 3.1).
 */
export class InvalidConditionSourceError extends RecommendationEngineError {
  constructor(conditionId: string, sourceType: string) {
    super(
      `Condition "${conditionId}" (sourceType "${sourceType}") hat ein ungueltiges Feld-Paar questionId/attributeKey gesetzt - genau eines der beiden muss abhaengig vom sourceType gesetzt sein.`,
    );
  }
}

// ---------------------------------------------------------------------------
// SalesOpportunity (sales-opportunity.ts, siehe Implementierungsplan
// Abschnitt 3.4 Korrekturpunkt 1)
// ---------------------------------------------------------------------------

/**
 * DetectedNeed.source = RULE_BASED ohne gesetzte triggerSignalId, oder
 * source = EMPLOYEE_MARKED mit gesetzter triggerSignalId - Service-Layer-
 * Invariante, da ein DB-CHECK hierfuer technisch nicht umsetzbar ist
 * (source liegt auf DetectedNeed, nicht auf SalesOpportunity).
 */
export class SalesOpportunitySourceMismatchError extends RecommendationEngineError {
  constructor(detectedNeedId: string, source: string, triggerSignalId: string | null) {
    super(
      `SalesOpportunity fuer DetectedNeed "${detectedNeedId}" (source=${source}) ist inkonsistent: triggerSignalId=${triggerSignalId ?? "null"}. RULE_BASED verlangt eine gesetzte triggerSignalId, EMPLOYEE_MARKED verlangt triggerSignalId=null.`,
    );
  }
}

/** Das referenzierte RecommendationCrossSellingSignal existiert nicht (oder gehoert zu einem anderen Mandanten/einer anderen Session). */
export class CrossSellingSignalNotFoundError extends RecommendationEngineError {
  constructor(signalId: string) {
    super(`RecommendationCrossSellingSignal "${signalId}" wurde nicht gefunden.`);
  }
}
