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
  AdminRuleNotFoundError,
  CopySourceRuleSetVersionNotFoundError,
  RollbackSourceNotEligibleError as RuleRollbackSourceNotEligibleError,
  RuleSetNotFoundError,
  RuleSetVersionInvalidError,
  RuleSetVersionNotDraftError,
  RuleSetVersionNotFoundError,
  RuleSetVersionPublishConflictError,
} from "../admin/rule-admin-errors";
import {
  CommissionModelNotFoundError,
  CommissionModelVersionInvalidError,
  CommissionModelVersionNotDraftError,
  CommissionModelVersionNotFoundError,
  CommissionModelVersionPublishConflictError,
  CommissionRollbackSourceNotEligibleError,
  CommissionTierNotFoundError,
  CopySourceCommissionModelVersionNotFoundError,
} from "../admin/commission-admin-errors";
import {
  GoalAlreadyExistsError,
  GoalNotFoundError,
  GoalScopeInvalidError,
  GoalTargetValueInvalidError,
} from "../admin/goal-admin-errors";
import { AiExtractionNotAvailableError } from "../ai-extraction/errors";
import {
  CampaignKeyAlreadyExistsError,
  CampaignNotFoundError,
  CampaignScopeInvalidError,
  CampaignVersionInvalidError,
  CampaignVersionNotDraftError,
  CampaignVersionNotFoundError,
  CampaignVersionPublishConflictError,
  CopySourceCampaignVersionNotFoundError,
} from "../admin/campaign-admin-errors";
import {
  CopySourcePlaybookVersionNotFoundError,
  PlaybookKeyAlreadyExistsError,
  PlaybookNotFoundError,
  PlaybookScopeInvalidError,
  PlaybookVersionInvalidError,
  PlaybookVersionNotDraftError,
  PlaybookVersionNotFoundError,
  PlaybookVersionPublishConflictError,
} from "../admin/playbook-admin-errors";

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

  // Rule-Management-API (Phase 9 AP2/AP3): 404 -- RuleSet/Version (inkl.
  // Kopiervorlage) oder eine Regel (beliebiger Typ) nicht gefunden (auch
  // hier: fremde-Mandant-ID liefert ueber den gescopten `db`-Client 0
  // Treffer -> 404, analog Phase 8).
  if (
    error instanceof RuleSetNotFoundError ||
    error instanceof RuleSetVersionNotFoundError ||
    error instanceof CopySourceRuleSetVersionNotFoundError ||
    error instanceof AdminRuleNotFoundError
  ) {
    return NextResponse.json({ error: error.name, message: error.message }, { status: 404 });
  }

  // Rule-Management-API (Phase 9 AP3): 409 -- Versuch, eine nicht-DRAFT-
  // RuleSetVersion zu mutieren (serverseitige Sperre, ChatGPT-Auflage
  // 2026-08-18: "DRAFT-only fuer saemtliche Mutationen").
  if (error instanceof RuleSetVersionNotDraftError) {
    return NextResponse.json({ error: error.name, message: error.message }, { status: 409 });
  }

  // Rule-Management-API (Phase 9 AP6): 409 -- Rollback-Quelle ist noch eine
  // DRAFT-Version (dafuer existiert bereits createDraftRuleSetVersion() mit
  // copyFromVersionId), analog RollbackSourceNotEligibleError aus Phase 8.
  if (error instanceof RuleRollbackSourceNotEligibleError) {
    return NextResponse.json({ error: error.name, message: error.message }, { status: 409 });
  }

  // Rule-Management-API (Phase 9 AP9, ChatGPT-Vorgabe 2026-08-18): 409 --
  // echter Nebenlaeufigkeitskonflikt beim mandantenweiten Publish (der
  // Verlierer eines Wettlaufs zwischen zwei DRAFT-Versionen), siehe
  // RuleSetVersionPublishConflictError-Kommentar. Datenintegritaet ist
  // bereits durch die DB-EXCLUDE-Constraint garantiert -- dies ist nur die
  // saubere API-Uebersetzung des erwartbaren Konflikts.
  if (error instanceof RuleSetVersionPublishConflictError) {
    return NextResponse.json({ error: error.name, message: error.message }, { status: 409 });
  }

  // Rule-Management-API (Phase 9 AP4): 422 -- validateDraftRuleSetVersion()
  // hat fachliche Verstoesse gefunden. `issues` enthaelt ALLE gefundenen
  // Verstoesse, nicht nur den ersten (siehe rule-admin-errors.ts), analog
  // QuestionnaireVersionInvalidError oben.
  if (error instanceof RuleSetVersionInvalidError) {
    return NextResponse.json(
      { error: error.name, message: error.message, issues: error.issues },
      { status: 422 },
    );
  }

  // Commission-Management-API (Phase 10 AP2): 404 -- CommissionModel/Version
  // (inkl. Kopiervorlage) oder ein CommissionTier nicht gefunden (fremde
  // Mandant-ID liefert ueber den gescopten `db`-Client 0 Treffer -> 404,
  // analog Phase 8/9).
  if (
    error instanceof CommissionModelNotFoundError ||
    error instanceof CommissionModelVersionNotFoundError ||
    error instanceof CopySourceCommissionModelVersionNotFoundError ||
    error instanceof CommissionTierNotFoundError
  ) {
    return NextResponse.json({ error: error.name, message: error.message }, { status: 404 });
  }

  // Commission-Management-API: 409 -- Versuch, eine nicht-DRAFT-
  // CommissionModelVersion zu mutieren (serverseitige Sperre, analog
  // RuleSetVersionNotDraftError).
  if (error instanceof CommissionModelVersionNotDraftError) {
    return NextResponse.json({ error: error.name, message: error.message }, { status: 409 });
  }

  // Commission-Management-API (AP4+): 409 -- Rollback-Quelle ist noch eine
  // DRAFT-Version, analog RuleRollbackSourceNotEligibleError.
  if (error instanceof CommissionRollbackSourceNotEligibleError) {
    return NextResponse.json({ error: error.name, message: error.message }, { status: 409 });
  }

  // Commission-Management-API (AP5): 409 -- echter Nebenlaeufigkeitskonflikt
  // beim PRO-CommissionModel-Publish (siehe
  // CommissionModelVersionPublishConflictError-Kommentar), analog
  // RuleSetVersionPublishConflictError.
  if (error instanceof CommissionModelVersionPublishConflictError) {
    return NextResponse.json({ error: error.name, message: error.message }, { status: 409 });
  }

  // Commission-Management-API (AP4): 422 -- validateCommissionModelVersion()
  // hat fachliche Verstoesse gefunden. `issues` enthaelt ALLE gefundenen
  // Verstoesse, analog RuleSetVersionInvalidError.
  if (error instanceof CommissionModelVersionInvalidError) {
    return NextResponse.json(
      { error: error.name, message: error.message, issues: error.issues },
      { status: 422 },
    );
  }

  // Goal-Management-API (Phase 11 AP3): 404 -- Goal nicht gefunden (fremde
  // Mandant-ID liefert ueber den gescopten `db`-Client 0 Treffer -> 404,
  // analog Phase 8-10; blosse goalId-Kenntnis reicht nie fuer Cross-Tenant-
  // Zugriff).
  if (error instanceof GoalNotFoundError) {
    return NextResponse.json({ error: error.name, message: error.message }, { status: 404 });
  }

  // Goal-Management-API: 409 -- Kardinalitaetsverstoss (Uebersetzung des
  // rohen P2002-Fehlers auf goals_scope_metric_period_key), analog anderer
  // "bereits existiert"-Konflikte im System.
  if (error instanceof GoalAlreadyExistsError) {
    return NextResponse.json({ error: error.name, message: error.message }, { status: 409 });
  }

  // Goal-Management-API: 422 -- scopeId ist fuer den angegebenen scopeType
  // nicht gueltig (unbekannt oder gehoert zu einem anderen Mandanten, IDOR-
  // Schutz, siehe goal-admin.ts::validateScopeId()). Keine Mutation/kein
  // Audit-Eintrag bleibt dabei zurueck.
  if (error instanceof GoalScopeInvalidError) {
    return NextResponse.json({ error: error.name, message: error.message }, { status: 422 });
  }

  // Goal-Management-API (Phase 11 AP3): 422 -- validateCreateGoalInput()/
  // validateCreateGoalVersionInput() (goal-validator.ts) hat die
  // metrikspezifische Zielwert-/Currency-Zuordnung verletzt. `issues`
  // enthaelt ALLE gefundenen Verstoesse, analog CommissionModelVersionInvalidError.
  if (error instanceof GoalTargetValueInvalidError) {
    return NextResponse.json(
      { error: error.name, message: error.message, issues: error.issues },
      { status: 422 },
    );
  }

  // Campaign-Management-API (Phase 13 AP2): 404 -- Campaign/Version (inkl.
  // Kopiervorlage) nicht gefunden (fremde Mandant-ID liefert ueber den
  // gescopten `db`-Client 0 Treffer -> 404, analog Phase 8-11).
  if (
    error instanceof CampaignNotFoundError ||
    error instanceof CampaignVersionNotFoundError ||
    error instanceof CopySourceCampaignVersionNotFoundError
  ) {
    return NextResponse.json({ error: error.name, message: error.message }, { status: 404 });
  }

  // Campaign-Management-API: 409 -- `key` einer neuen Campaign kollidiert
  // mit einer bereits bestehenden Campaign desselben Mandanten.
  if (error instanceof CampaignKeyAlreadyExistsError) {
    return NextResponse.json({ error: error.name, message: error.message }, { status: 409 });
  }

  // Campaign-Management-API: 409 -- Versuch, eine nicht-DRAFT-
  // CampaignVersion zu mutieren, analog CommissionModelVersionNotDraftError.
  if (error instanceof CampaignVersionNotDraftError) {
    return NextResponse.json({ error: error.name, message: error.message }, { status: 409 });
  }

  // Campaign-Management-API: 409 -- echter Nebenlaeufigkeitskonflikt beim
  // PRO-Campaign-Publish, analog CommissionModelVersionPublishConflictError.
  if (error instanceof CampaignVersionPublishConflictError) {
    return NextResponse.json({ error: error.name, message: error.message }, { status: 409 });
  }

  // Campaign-Management-API: 422 -- scopeId ist fuer den angegebenen
  // scopeType nicht gueltig (unbekannt oder gehoert zu einem anderen
  // Mandanten, IDOR-Schutz, siehe campaign-admin.ts::validateScopeId()).
  // Keine Mutation/kein Audit-Eintrag bleibt dabei zurueck.
  if (error instanceof CampaignScopeInvalidError) {
    return NextResponse.json({ error: error.name, message: error.message }, { status: 422 });
  }

  // Campaign-Management-API: 422 -- validateCampaignVersion() hat
  // fachliche Verstoesse in den CampaignCondition-Bedingungen gefunden.
  // `issues` enthaelt ALLE gefundenen Verstoesse, analog
  // RuleSetVersionInvalidError/CommissionModelVersionInvalidError.
  if (error instanceof CampaignVersionInvalidError) {
    return NextResponse.json(
      { error: error.name, message: error.message, issues: error.issues },
      { status: 422 },
    );
  }

  // Playbook-Management-API (Phase 14 AP2): 404 -- Playbook/Version (inkl.
  // Kopiervorlage) nicht gefunden (fremde Mandant-ID liefert ueber den
  // gescopten `db`-Client 0 Treffer -> 404, analog Phase 8-13).
  if (
    error instanceof PlaybookNotFoundError ||
    error instanceof PlaybookVersionNotFoundError ||
    error instanceof CopySourcePlaybookVersionNotFoundError
  ) {
    return NextResponse.json({ error: error.name, message: error.message }, { status: 404 });
  }

  // Playbook-Management-API: 409 -- `key` eines neuen Playbook kollidiert
  // mit einem bereits bestehenden Playbook desselben Mandanten.
  if (error instanceof PlaybookKeyAlreadyExistsError) {
    return NextResponse.json({ error: error.name, message: error.message }, { status: 409 });
  }

  // Playbook-Management-API: 409 -- Versuch, eine nicht-DRAFT-
  // PlaybookVersion zu mutieren, analog CampaignVersionNotDraftError.
  if (error instanceof PlaybookVersionNotDraftError) {
    return NextResponse.json({ error: error.name, message: error.message }, { status: 409 });
  }

  // Playbook-Management-API: 409 -- echter Nebenlaeufigkeitskonflikt beim
  // PRO-Playbook-Publish, analog CampaignVersionPublishConflictError.
  if (error instanceof PlaybookVersionPublishConflictError) {
    return NextResponse.json({ error: error.name, message: error.message }, { status: 409 });
  }

  // Playbook-Management-API: 422 -- scopeId ist fuer den angegebenen
  // scopeType nicht gueltig (unbekannt oder gehoert zu einem anderen
  // Mandanten, IDOR-Schutz, siehe playbook-admin.ts::validateScopeId()).
  // Keine Mutation/kein Audit-Eintrag bleibt dabei zurueck.
  if (error instanceof PlaybookScopeInvalidError) {
    return NextResponse.json({ error: error.name, message: error.message }, { status: 422 });
  }

  // Playbook-Management-API: 422 -- validatePlaybookVersion() hat
  // strukturelle Verstoesse in den PlaybookSection-Eintraegen gefunden
  // (Whitespace-only title/content). `issues` enthaelt ALLE gefundenen
  // Verstoesse, analog CampaignVersionInvalidError. Bewusst KEINE
  // Content-Scanning-/Prompt-Injection-Pruefung hier (siehe
  // playbook-schemas.ts-Modulkommentar).
  if (error instanceof PlaybookVersionInvalidError) {
    return NextResponse.json(
      { error: error.name, message: error.message, issues: error.issues },
      { status: 422 },
    );
  }

  // Freitext-KI-Angebot (Phase 12 AP2): 403 -- Permission UND Tenant-Feature-
  // Flag zusammen entscheiden, ob KI-Extraktion verfuegbar ist (siehe
  // ai-extraction/errors.ts). Bewusst EIN Fehlerstatus fuer beide moeglichen
  // Ursachen (fehlende Permission ODER deaktiviertes Tenant-Feature), damit
  // die Route nicht erkennbar macht, welche der beiden Bedingungen fehlschlug.
  if (error instanceof AiExtractionNotAvailableError) {
    return NextResponse.json({ error: error.name, message: error.message }, { status: 403 });
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
