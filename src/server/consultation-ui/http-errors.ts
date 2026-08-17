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
