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
 * AP4 (Analytics/Audit, ChatGPT-GO 2026-08-23): ergaenzt genau zwei
 * `AnalyticsEvent`-Schreibvorgaenge direkt in dieser Funktion --
 * AI_EXTRACTION_REQUESTED (nachdem alle Sicherheitspruefungen bestanden
 * sind, unmittelbar vor dem Providerzugriff) und AI_EXTRACTION_COMPLETED
 * (nach erfolgreicher Validierung). Beide Payloads enthalten AUSSCHLIESSLICH
 * technische Metadaten (Session-ID, Anzahl sichtbarer Fragen/Kandidaten,
 * Provider-Version) -- niemals `freeText`, den Prompt oder die
 * Provider-Rohantwort (siehe `contract.ts`-Modulkommentar zur
 * Datenschutz-Grenze, die durch diese Aenderung NICHT beruehrt wird: der
 * Freitext bleibt weiterhin ausschliesslich `extractionProvider.extract()`
 * zugaenglich). Beide Schreibvorgaenge sind bewusst in `try/catch`
 * eingefasst und schlucken Fehler (mit `console.error` fuer Beobachtbarkeit)
 * -- ein Fehler beim Schreiben eines Analytics-Events darf dem Mitarbeiter
 * niemals die eigentlichen (bereits ermittelten) KI-Vorschlaege vorenthalten.
 * Dies ist bewusst strenger als ChatGPTs woertliche Vorgabe (die explizit nur
 * die CustomerAnswer-Speicherung im Accept/Reject-Pfad nennt), aber
 * konsistent mit deren zugrundeliegendem Prinzip.
 *
 * Die Mitarbeiter-Entscheidung ueber einen einzelnen Vorschlag
 * (AI_SUGGESTION_ACCEPTED/REJECTED) wird NICHT hier, sondern in
 * `recordAiSuggestionOutcome()` (unten) geschrieben -- siehe dortigen
 * Kommentar, warum dies zwingend ein eigener, vom `saveAnswer()`-Pfad
 * strukturell getrennter Aufruf sein muss.
 */

import { db } from "../db/client";
import { getTenantId } from "../tenant/context";
import { QuestionnaireRunNotModifiableError } from "../questionnaire/errors";
import { ConsultationSessionNotFoundError } from "../questionnaire/errors";
import { isAiExtractionAvailable } from "../authz/consultation-permissions";
import { AiExtractionNotAvailableError } from "./errors";
import { buildVisibleQuestionContext } from "./visible-question-context";
import { validateExtractionCandidates } from "./extraction-validator";
import { MockExtractionProvider, MOCK_PROVIDER_VERSION } from "./providers/mock-provider";
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

/**
 * Schreibt ein `AnalyticsEvent` "best effort" -- siehe Modulkommentar oben
 * (AP4-Abschnitt) fuer die Begruendung, warum ein Fehler hier NIEMALS
 * propagiert werden darf. `void`-Aufrufer sind bewusst nicht noetig, die
 * Funktion selbst gibt bereits `Promise<void>` zurueck und wirft nie.
 */
async function recordAnalyticsEventBestEffort(
  data: Parameters<typeof db.analyticsEvent.create>[0]["data"],
): Promise<void> {
  try {
    await db.analyticsEvent.create({ data });
  } catch (error) {
    console.error("AnalyticsEvent konnte nicht geschrieben werden (Phase 12 AP4):", error);
  }
}

/**
 * Prueft die ChatGPT-Vorgabe "Permission UND Tenant-Feature-Flag" fuer die
 * aktuelle Tenant-Session (siehe `isAiExtractionAvailable()`-Kommentar).
 * EXPORTIERT (nicht nur intern in `requestAiExtraction()` verwendet), damit
 * Server Components (z. B. `/consultation/[sessionId]/page.tsx`, Phase 12
 * AP3) dieselbe Pruefung fuer eine rein DARSTELLUNGS-Entscheidung (Freitext-
 * KI-Panel ueberhaupt anzeigen?) wiederverwenden koennen, statt die
 * Tenant-Flag-Abfrage ein zweites Mal zu implementieren. Bleibt trotzdem
 * NICHT die alleinige Sicherheitsinstanz -- die Route prueft dieselbe
 * Bedingung serverseitig unabhaengig erneut, ein UI-Rendering-Entscheid
 * ersetzt niemals die tatsaechliche Autorisierungspruefung.
 */
export async function isAiExtractionAvailableForCurrentTenant(
  hasPermission: boolean,
): Promise<boolean> {
  const tenantId = getTenantId();
  const tenant = await db.tenant.findUnique({
    where: { id: tenantId },
    select: { aiExtractionEnabled: true },
  });
  const tenantFeatureEnabled = tenant?.aiExtractionEnabled ?? false;
  return isAiExtractionAvailable(hasPermission, tenantFeatureEnabled);
}

export async function requestAiExtraction(
  input: RequestAiExtractionInput,
): Promise<RequestAiExtractionResult> {
  if (!(await isAiExtractionAvailableForCurrentTenant(input.hasPermission))) {
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

  await recordAnalyticsEventBestEffort({
    tenantId: getTenantId(),
    storeId: session.storeId,
    employeeId: session.employeeId,
    eventType: "AI_EXTRACTION_REQUESTED",
    occurredAt: new Date(),
    payload: {
      consultationSessionId: session.id,
      visibleQuestionCount: visibleQuestions.length,
      providerVersion: MOCK_PROVIDER_VERSION,
    },
  });

  const rawCandidates = await extractionProvider.extract({
    freeText: input.freeText,
    visibleQuestions,
  });
  const { accepted } = validateExtractionCandidates(visibleQuestions, rawCandidates);

  await recordAnalyticsEventBestEffort({
    tenantId: getTenantId(),
    storeId: session.storeId,
    employeeId: session.employeeId,
    eventType: "AI_EXTRACTION_COMPLETED",
    occurredAt: new Date(),
    payload: {
      consultationSessionId: session.id,
      candidateCount: accepted.length,
      providerVersion: MOCK_PROVIDER_VERSION,
    },
  });

  return { candidates: accepted };
}

export type AiSuggestionOutcome = "accepted" | "rejected";

export interface RecordAiSuggestionOutcomeInput {
  consultationSessionId: string;
  /** `employeeId` aus dem authentifizierten Server-Session-Kontext, NIEMALS aus dem Request-Body/URL. */
  employeeId: string;
  /** Ob die Session die `consultation.ai_extraction.use`-Permission besitzt. */
  hasPermission: boolean;
  questionId: string;
  outcome: AiSuggestionOutcome;
  /**
   * Nur bei `outcome: "accepted"` von Bedeutung: `false` = Uebernehmen
   * (unveraendert), `true` = Aendern (Mitarbeiter hat den Vorschlagswert vor
   * dem Speichern angepasst). Bei `outcome: "rejected"` bedeutungslos, wird
   * ignoriert.
   */
  changed: boolean;
}

/**
 * Zeichnet die explizite Mitarbeiter-Entscheidung ueber einen einzelnen
 * KI-Vorschlag auf (Uebernehmen/Aendern -> AI_SUGGESTION_ACCEPTED,
 * Verwerfen -> AI_SUGGESTION_REJECTED, Phase 12 AP4).
 *
 * WICHTIG (Architekturentscheidung): Diese Funktion schreibt AUSSCHLIESSLICH
 * das `AnalyticsEvent` -- sie ruft NIEMALS `saveAnswer()`/`changeAnswer()`
 * auf und beruehrt keine `CustomerAnswer`-Zeile. Das ist kein Zufall: AP2/AP3
 * haben bewusst entschieden, dass Uebernehmen/Aendern ausschliesslich ueber
 * den bestehenden, UNVERAENDERTEN `saveAnswer()`/`changeAnswer()`-Pfad
 * laufen (client-seitig in `QuestionFlow.tsx`, siehe dortigen
 * Modulkommentar) -- ein Signal "diese Antwort stammt von einer
 * KI-Bestaetigung" darf in DIESEM Pfad nicht existieren, sonst waere die
 * AP2/AP3-Garantie "kein zweiter Code-Pfad fuer CustomerAnswer-Schreibungen"
 * verletzt. Der Client ruft diese Funktion daher als GENUIN SEPARATEN
 * HTTP-Request AUF, NACHDEM der eigentliche Antwort-Speichervorgang (bei
 * Uebernehmen/Aendern) bereits erfolgreich abgeschlossen ist (bzw. sofort bei
 * Verwerfen, wo gar kein Speichervorgang stattfindet). Dadurch kann ein
 * Fehler beim Schreiben dieses Analytics-Events -- strukturell, nicht nur per
 * try/catch -- NIEMALS die bereits committete CustomerAnswer-Speicherung
 * rueckgaengig machen oder zum Scheitern bringen (ChatGPTs AP4-Atomaritaets-
 * Vorgabe, "besonders wichtig beim Accept/Reject-Pfad").
 *
 * Prueft dieselbe Verfuegbarkeits- und Session-Ownership-Bedingung wie
 * `requestAiExtraction()` (Permission UND Tenant-Feature-Flag, fremde/
 * nicht existente Session -> identischer 404-Fehler), damit dieser Endpunkt
 * nicht als Nebenkanal fuer Informationen ueber fremde Sessions missbraucht
 * werden kann. Verzichtet BEWUSST auf die IN_PROGRESS-Statuspruefung von
 * `requestAiExtraction()`: dieser Aufruf mutiert nichts an der
 * Beratungssitzung selbst (reines Analytics-Ereignis ueber eine bereits
 * erfolgte UI-Interaktion), eine knapp nach Sitzungsabschluss eintreffende
 * Aufzeichnung waere fachlich unschaedlich und soll nicht kuenstlich
 * abgelehnt werden.
 */
export async function recordAiSuggestionOutcome(
  input: RecordAiSuggestionOutcomeInput,
): Promise<void> {
  if (!(await isAiExtractionAvailableForCurrentTenant(input.hasPermission))) {
    throw new AiExtractionNotAvailableError();
  }

  const session = await db.consultationSession.findUnique({
    where: { id: input.consultationSessionId },
  });
  if (!session || session.employeeId !== input.employeeId) {
    // Bewusst identischer Fehler fuer "nicht gefunden" UND "gehoert einem
    // anderen Mitarbeiter" -- siehe `requestAiExtraction()`-Kommentar oben.
    throw new ConsultationSessionNotFoundError(input.consultationSessionId);
  }

  await recordAnalyticsEventBestEffort({
    tenantId: getTenantId(),
    storeId: session.storeId,
    employeeId: session.employeeId,
    eventType: input.outcome === "accepted" ? "AI_SUGGESTION_ACCEPTED" : "AI_SUGGESTION_REJECTED",
    occurredAt: new Date(),
    payload:
      input.outcome === "accepted"
        ? {
            consultationSessionId: session.id,
            questionId: input.questionId,
            changed: input.changed,
          }
        : { consultationSessionId: session.id, questionId: input.questionId },
  });
}
