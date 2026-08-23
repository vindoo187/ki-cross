/**
 * Orchestrierungsschicht fuer die Freitext-KI-Extraktion (Phase 12 AP2,
 * ChatGPT-GO 2026-08-23, siehe PHASE_12_IMPLEMENTATION_PLAN.md Abschnitt 4
 * + Chat-Verlauf "GO fuer AP2" mit den elf verbindlichen Leitplanken).
 * Verbindet die in AP1 gebauten reinen Bausteine (Visible-Question-Context,
 * MockExtractionProvider, Validator, Permission-/Feature-Flag-Logik) zu
 * EINER Funktion, die die Route (`route.ts`) 1:1 aufruft -- keine
 * Fachlogik in der Route selbst (gleiches Prinzip wie
 * `consultation-ui/http-errors.ts`-Modulkommentar: "keine neue fachliche
 * Logik in der API-Schicht").
 *
 * Sicherheitsreihenfolge (wortgleich ChatGPTs Vorgabe): Auth -> Tenant ->
 * Session-Ownership -> Permission -> Feature-Flag -> sichtbarer
 * Fragenkontext -> Extraction -> Validation -> Response.
 * - Auth/Tenant: bereits durch `withRequestTenantContext()` in der Route
 *   sichergestellt, BEVOR diese Funktion ueberhaupt aufgerufen wird.
 * - Permission/Feature-Flag: ZUERST geprueft (billig, kein DB-Zugriff auf
 *   die Session noetig) -- `isAiExtractionAvailable()` verknuepft beide
 *   Bedingungen per UND, ein einziger, absichtlich unspezifischer Fehler
 *   (`AiExtractionNotAvailableError`) fuer beide Ausfallgruende (siehe
 *   `errors.ts`-Kommentar).
 * - Session-Ownership: DANACH geprueft. `session.employeeId` (aus der
 *   ConsultationSession-Zeile) MUSS mit der `employeeId` aus dem
 *   authentifizierten Server-Kontext uebereinstimmen -- eine fremde Session
 *   (egal ob nicht existent, anderer Mandant [ueber den gescopten
 *   `db`-Client bereits strukturell ausgeschlossen] oder anderer
 *   Mitarbeiter desselben Mandanten) wirft in JEDEM Fall exakt denselben
 *   `ConsultationSessionNotFoundError` -> 404 (kein Leck ueber
 *   unterschiedliche Fehlermeldungen, ChatGPT-Vorgabe woertlich: "Fremde
 *   Session bzw. fremder Tenant darf nicht durch unterschiedliche
 *   Fehlermeldungen als existent erkennbar werden").
 * - `assertSessionModifiable()`-analoge Statuspruefung (IN_PROGRESS):
 *   zusaetzliche, ueber ChatGPTs explizite Vorgabe hinausgehende
 *   Verteidigungslinie, konsistent mit dem bestehenden Muster in
 *   `questionnaire/service.ts` (`saveAnswer()`/`changeAnswer()`/
 *   `completeQuestionnaire()` verweigern alle Mutation auf nicht mehr
 *   laufenden Sitzungen) -- eine KI-Anfrage auf eine bereits
 *   abgeschlossene/abgebrochene Beratung ist fachlich sinnlos.
 * - Sichtbarer Fragenkontext: ausschliesslich `buildVisibleQuestionContext()`
 *   (AP1, wiederum `computeVisiblePath()`) -- die KI bestimmt niemals selbst,
 *   welche Fragen sichtbar sind.
 * - Extraction: ausschliesslich `MockExtractionProvider` (AP1-AP4, siehe
 *   `providers/mock-provider.ts`-Modulkommentar) -- ein echter externer
 *   Provider ist AP5 und erfordert ein separates GO.
 * - Validation: `validateExtractionCandidates()` (AP1) -- kann NIEMALS
 *   selbst eine `CustomerAnswer` erzeugen (reine Funktion ohne DB-Zugriff).
 * - Response: NUR die akzeptierten Kandidaten (`accepted`), keine
 *   Persistierung (Schicht 5 "Suggestion State" bleibt laut Plan
 *   client-seitig, siehe PHASE_12_IMPLEMENTATION_PLAN.md Abschnitt 1
 *   Punkt 5) -- verworfene Kandidaten (`rejected`) werden bewusst NICHT in
 *   der Response zurueckgegeben (Plan Abschnitt 4, AP2: "Response mit
 *   validierten Kandidaten").
 *
 * Noch NICHT Teil von AP2 (spaetere APs laut Plan): kein `AnalyticsEvent`
 * (AP4), keine `CustomerAnswer`-Schreiboperation (AP3/AP6, ausschliesslich
 * ueber den bestehenden, unveraenderten `saveAnswer()`-Pfad nach expliziter
 * Mitarbeiterbestaetigung).
 */

import { db } from "../db/client";
import { getTenantId } from "../tenant/context";
import { QuestionnaireRunNotModifiableError } from "../questionnaire/errors";
import { ConsultationSessionNotFoundError } from "../questionnaire/errors";
import { isAiExtractionAvailable } from "../authz/consultation-permissions";
import { AiExtractionNotAvailableError } from "./errors";
import { buildVisibleQuestionContext } from "./visible-question-context";
import { validateExtractionCandidates } from "./extraction-validator";
import { MockExtractionProvider } from "./providers/mock-provider";
import type { AiExtractionCandidate } from "./types";

/**
 * EINZIGE in AP1-AP4 verwendete `AiExtractionProvider`-Implementierung
 * (siehe `mock-provider.ts`-Modulkommentar) -- als Modul-Singleton
 * instanziiert, da sie zustandslos ist (keine Konfiguration, kein
 * DB-/Netzwerkzugriff).
 */
const extractionProvider = new MockExtractionProvider();

export interface RequestAiExtractionInput {
  consultationSessionId: string;
  /** `employeeId` aus dem authentifizierten Server-Session-Kontext, NIEMALS aus dem Request-Body/URL. */
  employeeId: string;
  /** Ob die Session die `consultation.ai_extraction.use`-Permission besitzt (siehe `session.consultationPermissions`). */
  hasPermission: boolean;
  freeText: string;
}

export interface RequestAiExtractionResult {
  candidates: AiExtractionCandidate[];
}

export async function requestAiExtraction(
  input: RequestAiExtractionInput,
): Promise<RequestAiExtractionResult> {
  const tenantId = getTenantId();

  const tenant = await db.tenant.findUnique({
    where: { id: tenantId },
    select: { aiExtractionEnabled: true },
  });
  const tenantFeatureEnabled = tenant?.aiExtractionEnabled ?? false;

  if (!isAiExtractionAvailable(input.hasPermission, tenantFeatureEnabled)) {
    throw new AiExtractionNotAvailableError();
  }

  const session = await db.consultationSession.findUnique({
    where: { id: input.consultationSessionId },
  });
  if (!session || session.employeeId !== input.employeeId) {
    // Bewusst identischer Fehler fuer "nicht gefunden" UND "gehoert einem
    // anderen Mitarbeiter" -- siehe Modulkommentar oben.
    throw new ConsultationSessionNotFoundError(input.consultationSessionId);
  }
  if (session.status !== "IN_PROGRESS") {
    throw new QuestionnaireRunNotModifiableError(session.id, session.status);
  }

  const visibleQuestions = await buildVisibleQuestionContext(session.id);
  const rawCandidates = await extractionProvider.extract({
    freeText: input.freeText,
    visibleQuestions,
  });
  const { accepted } = validateExtractionCandidates(visibleQuestions, rawCandidates);

  return { candidates: accepted };
}
