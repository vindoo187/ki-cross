/**
 * Uebersetzt bekannte Fehlerklassen der Fragen-/Empfehlungs-Engine sowie des
 * Auth-Mechanismus in strukturierte HTTP-Fehlerantworten.
 *
 * Enthaelt bewusst KEINE neue Fachlogik -- nur Transport/Mapping, wie in
 * PHASE_5_IMPLEMENTATION_PLAN.md Abschnitt 2.2 Punkt 1 gefordert
 * ("keine neue fachliche Logik, nur Transport/Validierung/Fehler-Mapping").
 */

import { NextResponse } from "next/server";
import {
  QuestionEngineError,
  ConsultationSessionNotFoundError,
  QuestionNotFoundError,
  InvalidAnswerError,
  StaleAnswerVersionError,
  QuestionnaireRunNotModifiableError,
  IncompleteQuestionnaireError,
  QuestionNotVisibleError,
  AnswerAlreadyExistsError,
  NoActiveQuestionnaireVersionError,
  ConsultationAlreadyCompletedError,
  QuestionnaireVersionInvalidError,
} from "../questionnaire/errors";
import {
  RecommendationEngineError,
  SessionNotEvaluableError,
  InsufficientAnswerDataError,
  RuleSetNotConfiguredError,
  NoValidProductVersionError,
  RecommendationItemNotFoundError,
  RecommendationOutcomeAlreadyExistsError,
  RejectionReasonRequiredError,
  RejectionReasonNotApplicableError,
  RejectionReasonNotFoundError,
  SalesOpportunityNotFoundError,
  InvalidOpportunityStatusTransitionError,
} from "../recommendation/errors";
import { AuthenticationError } from "../auth/errors";
import { MissingTenantContextError } from "../tenant/context";
import {
  DealEngineError,
  DealConsultationSessionNotFoundError,
  DealSessionNotClosableError,
  DealRequiresItemsError,
  DealProductVersionNotFoundError,
  DealAlreadyExistsForSessionError,
} from "../deals/errors";
import { ManagementAccessDeniedError } from "../analytics/management-authz";
import { ConfigAccessDeniedError } from "../authz/config-permissions";
import {
  AdminQuestionNotFoundError,
  InvalidQuestionInputError,
  QuestionnaireNotFoundError,
  QuestionnaireVersionNotDraftError,
  QuestionnaireVersionNotFoundError,
  RollbackSourceNotEligibleError,
} from "../admin/question-admin-errors";
import {
  CopySourceRuleSetVersionNotFoundError,
  RuleSetNotFoundError,
  RuleSetVersionNotFoundError,
} from "../admin/rule-admin-errors";

interface ErrorBody {
  error: string;
  message: string;
  [key: string]: unknown;
}

/**
 * Ordnet eine bekannte Fehlerinstanz einer HTTP-Antwort zu. Liefert `null`,
 * falls der Fehler nicht bekannt ist -- der Aufrufer muss diesen Fall dann
 * selbst behandeln (z. B. erneut werfen, damit er nicht verschluckt wird).
 */
export function mapKnownErrorToResponse(error: unknown): NextResponse<ErrorBody> | null {
  // Auth
  if (error instanceof AuthenticationError) {
    return NextResponse.json(
      { error: error.name, message: error.message },
      { status: error.name === "InvalidDevLoginCandidateError" ? 401 : 401 },
    );
  }
  if (error instanceof MissingTenantContextError) {
    return NextResponse.json(
      { error: "MissingTenantContext", message: error.message },
      { status: 401 },
    );
  }

  // Fragen-Engine: 404
  if (
    error instanceof ConsultationSessionNotFoundError ||
    error instanceof QuestionNotFoundError ||
    error instanceof NoActiveQuestionnaireVersionError
  ) {
    return NextResponse.json({ error: error.name, message: error.message }, { status: 404 });
  }

  // Fragen-Engine: 409 (Konflikt/Zustand)
  if (
    error instanceof StaleAnswerVersionError ||
    error instanceof QuestionnaireRunNotModifiableError ||
    error instanceof AnswerAlreadyExistsError
  ) {
    return NextResponse.json(
      { error: error.name, message: error.message, ...extraFields(error) },
      { status: 409 },
    );
  }

  // AP10 -- Abbruchversuch (abandonConsultation()) einer bereits per
  // completeConsultation() abgeschlossenen Sitzung: 409, idempotenz-
  // freundliche Anzeige statt Fehler (siehe extraFields()), analog zu
  // RecommendationOutcomeAlreadyExistsError.
  if (error instanceof ConsultationAlreadyCompletedError) {
    return NextResponse.json(
      { error: error.name, message: error.message, ...extraFields(error) },
      { status: 409 },
    );
  }

  // Fragen-Engine: 422 (fachlich ungueltige Eingabe)
  if (
    error instanceof InvalidAnswerError ||
    error instanceof IncompleteQuestionnaireError ||
    error instanceof QuestionNotVisibleError
  ) {
    return NextResponse.json(
      { error: error.name, message: error.message, ...extraFields(error) },
      { status: 422 },
    );
  }

  // Question-Management-API (Phase 8 AP4): 422 -- validateQuestionnaireVersion()
  // (seit Phase 3A, wiederverwendet fuer validate()/publish()) hat strukturelle
  // Verstoesse gefunden. `issues` enthaelt ALLE gefundenen Verstoesse, nicht
  // nur den ersten (siehe questionnaire/errors.ts). MUSS vor dem generischen
  // `QuestionEngineError` -> 400-Fallback direkt darunter stehen, da
  // `QuestionnaireVersionInvalidError` von `QuestionEngineError` erbt und
  // sonst dort abgefangen wuerde (CI #41 Root Cause 1 -- 400 statt 422).
  if (error instanceof QuestionnaireVersionInvalidError) {
    return NextResponse.json(
      { error: error.name, message: error.message, issues: error.issues },
      { status: 422 },
    );
  }

  // Fragen-Engine: alle uebrigen bekannten Fehler -> 400
  if (error instanceof QuestionEngineError) {
    return NextResponse.json({ error: error.name, message: error.message }, { status: 400 });
  }

  // Empfehlungs-Engine: 404/409/422 je nach Ursache
  if (error instanceof SessionNotEvaluableError) {
    return NextResponse.json({ error: error.name, message: error.message }, { status: 409 });
  }
  if (
    error instanceof InsufficientAnswerDataError ||
    error instanceof RuleSetNotConfiguredError ||
    error instanceof NoValidProductVersionError
  ) {
    return NextResponse.json({ error: error.name, message: error.message }, { status: 422 });
  }

  // Empfehlungs-Ausgang (AP5/AP7, Plan Abschnitt 8): 404
  if (
    error instanceof RecommendationItemNotFoundError ||
    error instanceof RejectionReasonNotFoundError
  ) {
    return NextResponse.json({ error: error.name, message: error.message }, { status: 404 });
  }

  // Empfehlungs-Ausgang: 409 -- bereits entschieden (idempotenz-freundliche Anzeige statt Fehler, siehe extraFields()).
  if (error instanceof RecommendationOutcomeAlreadyExistsError) {
    return NextResponse.json(
      { error: error.name, message: error.message, ...extraFields(error) },
      { status: 409 },
    );
  }

  // Empfehlungs-Ausgang: 422 -- fachlich ungueltige rejectionReasonId-Kombination.
  if (
    error instanceof RejectionReasonRequiredError ||
    error instanceof RejectionReasonNotApplicableError
  ) {
    return NextResponse.json({ error: error.name, message: error.message }, { status: 422 });
  }

  // SalesOpportunity-Statusaktualisierung (AP8, Plan Abschnitt 9): 404
  if (error instanceof SalesOpportunityNotFoundError) {
    return NextResponse.json({ error: error.name, message: error.message }, { status: 404 });
  }

  // SalesOpportunity-Statusaktualisierung: 409 -- unerlaubter Uebergang laut ALLOWED_TRANSITIONS.
  if (error instanceof InvalidOpportunityStatusTransitionError) {
    return NextResponse.json(
      { error: error.name, message: error.message, ...extraFields(error) },
      { status: 409 },
    );
  }

  if (error instanceof RecommendationEngineError) {
    return NextResponse.json({ error: error.name, message: error.message }, { status: 400 });
  }

  // Deal-Erfassung (Phase 6 AP3/AP4): 404 -- referenzierte Session/ProductVersion existiert nicht.
  if (
    error instanceof DealConsultationSessionNotFoundError ||
    error instanceof DealProductVersionNotFoundError
  ) {
    return NextResponse.json({ error: error.name, message: error.message }, { status: 404 });
  }

  // Deal-Erfassung: 409 -- Zustandskonflikt (Session nicht abschlussfaehig, oder bereits ein Deal vorhanden).
  if (
    error instanceof DealSessionNotClosableError ||
    error instanceof DealAlreadyExistsForSessionError
  ) {
    return NextResponse.json({ error: error.name, message: error.message }, { status: 409 });
  }

  // Deal-Erfassung: 422 -- fachlich ungueltige Eingabe (keine DealItems).
  if (error instanceof DealRequiresItemsError) {
    return NextResponse.json({ error: error.name, message: error.message }, { status: 422 });
  }

  if (error instanceof DealEngineError) {
    return NextResponse.json({ error: error.name, message: error.message }, { status: 400 });
  }

  // Management-Analytics-Autorisierung (Phase 7 AP2/AP3): 403 -- bewusst NICHT
  // 404/leeres Ergebnis, damit ein echtes "0 Datensaetze im erlaubten Scope"
  // nicht mit "kein Zugriff" verwechselt werden kann (siehe management-authz.ts).
  if (error instanceof ManagementAccessDeniedError) {
    return NextResponse.json({ error: error.name, message: error.message }, { status: 403 });
  }

  // Configuration-RBAC (Phase 8 AP2): 403 -- deny-by-default, keine
  // Autorisierung aus der Rolle allein, siehe config-permissions.ts.
  if (error instanceof ConfigAccessDeniedError) {
    return NextResponse.json({ error: error.name, message: error.message }, { status: 403 });
  }

  // Question-Management-API (Phase 8 AP3): 404 -- Questionnaire/Version/Frage
  // nicht gefunden (inkl. Tenant-Isolation ueber den gescopten `db`-Client:
  // eine fremde-Mandant-ID liefert hier ebenfalls 0 Treffer -> 404).
  if (
    error instanceof QuestionnaireNotFoundError ||
    error instanceof QuestionnaireVersionNotFoundError ||
    error instanceof AdminQuestionNotFoundError
  ) {
    return NextResponse.json({ error: error.name, message: error.message }, { status: 404 });
  }

  // Question-Management-API: 409 -- Versuch, eine nicht-DRAFT-Version zu
  // mutieren (serverseitige Sperre, Plan Abschnitt 6).
  if (error instanceof QuestionnaireVersionNotDraftError) {
    return NextResponse.json({ error: error.name, message: error.message }, { status: 409 });
  }

  // Question-Management-API (Phase 8 AP5): 409 -- Rollback-Quelle ist noch
  // eine DRAFT-Version (dafuer existiert bereits createDraftVersion() mit
  // copyFromVersionId), siehe question-admin-errors.ts.
  if (error instanceof RollbackSourceNotEligibleError) {
    return NextResponse.json({ error: error.name, message: error.message }, { status: 409 });
  }

  // Question-Management-API: 422 -- fachlich ungueltige Eingabe.
  if (error instanceof InvalidQuestionInputError) {
    return NextResponse.json(
      { error: error.name, message: error.message, issues: error.issues },
      { status: 422 },
    );
  }

  // Rule-Management-API (Phase 9 AP2): 404 -- RuleSet/Version (inkl.
  // Kopiervorlage) nicht gefunden (auch hier: fremde-Mandant-ID liefert
  // ueber den gescopten `db`-Client 0 Treffer -> 404, analog Phase 8).
  if (
    error instanceof RuleSetNotFoundError ||
    error instanceof RuleSetVersionNotFoundError ||
    error instanceof CopySourceRuleSetVersionNotFoundError
  ) {
    return NextResponse.json({ error: error.name, message: error.message }, { status: 404 });
  }

  return null;
}

/** Zusaetzliche, fuer die UI relevante Felder bestimmter Fehlerklassen (z. B. missingQuestionIds). */
function extraFields(error: unknown): Record<string, unknown> {
  if (error instanceof IncompleteQuestionnaireError) {
    return { missingQuestionIds: error.missingQuestionIds };
  }
  if (error instanceof InvalidAnswerError) {
    return { issues: error.issues };
  }
  if (error instanceof RecommendationOutcomeAlreadyExistsError) {
    return { decidedAt: error.decidedAt ? error.decidedAt.toISOString() : null };
  }
  if (error instanceof InvalidOpportunityStatusTransitionError) {
    return { currentStatus: error.currentStatus, requestedStatus: error.requestedStatus };
  }
  if (error instanceof ConsultationAlreadyCompletedError) {
    return { completedAt: error.completedAt.toISOString() };
  }
  return {};
}

/**
 * Gemeinsamer Ausfuehrungs-Wrapper fuer Route Handler: fuehrt `fn` aus und
 * bildet dabei geworfene bekannte Fehler auf strukturierte HTTP-Antworten ab
 * (siehe `mapKnownErrorToResponse`). Unbekannte Fehler werden bewusst erneut
 * geworfen (nicht verschluckt), damit Next.js seine Standard-500-Behandlung
 * uebernimmt und der Fehler in den Server-Logs sichtbar bleibt.
 */
export async function withErrorMapping(fn: () => Promise<NextResponse>): Promise<NextResponse> {
  try {
    return await fn();
  } catch (error) {
    const mapped = mapKnownErrorToResponse(error);
    if (mapped) {
      return mapped;
    }
    throw error;
  }
}
