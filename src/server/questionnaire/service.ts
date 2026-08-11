/**
 * Orchestrierungsschicht der Fragen-Engine (Phase 3A): verbindet die reinen,
 * DB-freien Kernmodule (`visibility.ts`, `answer-validation.ts`, `path.ts`,
 * `status.ts`, `decimal.ts`) mit dem mandantengescopten Prisma-Client (`db`,
 * siehe `src/server/db/client.ts`).
 *
 * Deckt die in PHASE_3A_STARTPROMPT.md Abschnitt 10 geforderten neun
 * technischen Operationen ab:
 *   1. gueltigen Fragebogen fuer eine Beratung starten      -> startQuestionnaire
 *   2. aktuellen Befragungszustand laden                    -> loadQuestionnaireState
 *   3. naechste Frage ermitteln                              -> Teil von loadQuestionnaireState/getProgress (progress.nextQuestionId)
 *   4. Antwort speichern                                     -> saveAnswer
 *   5. vorhandene Antwort aendern                             -> changeAnswer
 *   6. sichtbaren Fragenpfad neu berechnen                    -> recalculateVisiblePath
 *   7. Fortschritt abrufen                                    -> getProgress
 *   8. Fragebogen abschliessen                                -> completeQuestionnaire
 *   9. QuestionnaireVersion technisch validieren               -> validateQuestionnaireVersion
 * (plus assertQuestionnaireVersionIsEditable als kleine, wiederverwendbare
 * Wache fuer eine spaetere Autoren-Oberflaeche - siehe QuestionnaireVersionNotEditableError.)
 *
 * WICHTIGE DESIGN-ENTSCHEIDUNGEN (siehe docs/QUESTION_ENGINE.md fuer die
 * ausformulierte Fassung):
 *
 * - Reproduzierbarkeit: Fuer eine BESTEHENDE ConsultationSession wird jede
 *   QuestionVersion IMMER anhand von `session.startedAt` aufgeloest (nicht
 *   "jetzt"), damit "gleiche Version + gleiche Antworten -> gleicher
 *   sichtbarer Pfad" gilt, selbst wenn zwischenzeitlich neue QuestionVersionen
 *   veroeffentlicht wurden. Nur `startQuestionnaire()` selbst loest die
 *   QuestionnaireVersion anhand von "jetzt"/einem expliziten `at`-Parameter auf.
 * - `startQuestionnaire()` erzeugt die `ConsultationSession`-Zeile selbst
 *   (kein separater Anlage-Service existiert), da der DB-Trigger
 *   `forbid_questionnaire_version_change()` `questionnaireVersionId` bereits
 *   beim INSERT korrekt gesetzt haben muss (spaetere Korrektur unmoeglich).
 * - Symmetrische Pfad-Neuberechnung: sowohl `saveAnswer()` als auch
 *   `changeAnswer()` berechnen `pathVorher`/`pathNachher` und deaktivieren
 *   (`isActive = false`) alle dadurch neu verdeckten, aber beantworteten
 *   Fragen (append-only - keine Antwort wird hart geloescht).
 * - Eine leere Eingabe bei `changeAnswer()` loescht die aktive Antwort
 *   (deaktiviert die vorhandene Zeile, legt aber KEINE neue an) - danach gilt
 *   die Frage wieder als unbeantwortet. `saveAnswer()` verlangt dagegen immer
 *   mindestens ein gesetztes Wertfeld (siehe AnswerAlreadyExistsError-Kommentar).
 * - Keine Wiedereroeffnung abgeschlossener Sitzungen: jede Schreiboperation
 *   auf einer Sitzung mit `status !== "IN_PROGRESS"` wirft
 *   `QuestionnaireRunNotModifiableError` (konservativ, siehe
 *   PHASE_3A_STARTPROMPT.md Abschnitt 7).
 *
 * BEKANNTES RESTRISIKO (siehe Abschlussbericht): dass `db.$transaction(...)`
 * das Tenant-Scoping-Extension auch innerhalb des `tx`-Callbacks weiterreicht,
 * ist Standardverhalten von Prisma Client Extensions, konnte in dieser Sandbox
 * mangels Datenbankzugriff aber NICHT gegen einen echten Client verifiziert
 * werden - nur in CI.
 *
 * SANDBOX-VERIFIKATIONSLUECKE (rein tooling-bedingt, siehe Abschlussbericht):
 * `@prisma/client` besitzt in dieser Offline-Sandbox keine aufloesbaren
 * Typdeklarationen (`prisma generate` kann hier nicht gegen die echte
 * Prisma-Registry laufen). Dadurch meldet `tsc --noEmit` in dieser Datei
 * zusaetzliche TS7016/TS7006/TS18046-Fehler (Import von `Prisma`/
 * `ConsultationSession`, `Prisma.QuestionGetPayload`/`CustomerAnswerGetPayload`,
 * `db.$transaction`-Callback-Inferenz, `instanceof Prisma.PrismaClientKnownRequestError`)
 * - exakt dieselbe bereits dokumentierte Fehlerklasse wie in `db/client.ts`,
 * `scoped-client.ts` und `prisma/seed.ts`. ESLint (`no-explicit-any`) ist
 * davon NICHT betroffen und laeuft hier sauber durch; die vollstaendige
 * Typkorrektheit dieser Datei kann erst in CI (mit echten Prisma-Typen)
 * verifiziert werden.
 */

import type { ConsultationSession } from "@prisma/client";
import { Prisma } from "@prisma/client";
import { db } from "../db/client";
import type { ScopedPrismaClient } from "../tenant/scoped-client";
import { getTenantId } from "../tenant/context";
import { compareDecimalStrings } from "./decimal";
import {
  AnswerAlreadyExistsError,
  ConsultationSessionNotFoundError,
  IncompleteQuestionnaireError,
  InvalidAnswerError,
  NoActiveQuestionnaireVersionError,
  QuestionNotFoundError,
  QuestionNotVisibleError,
  QuestionnaireRunNotModifiableError,
  QuestionnaireVersionInvalidError,
  QuestionnaireVersionNotEditableError,
  StaleAnswerVersionError,
} from "./errors";
import { computeProgress, computeVisiblePath, findNewlyHiddenAnsweredQuestionIds } from "./path";
import type { QuestionnaireProgress, VisibleQuestionSummary } from "./path";
import { deriveQuestionnaireRunStatus } from "./status";
import { hasAnswerValue, validateAnswerInput } from "./answer-validation";
import {
  isOperatorSupportedForAnswerType,
  splitComparisonList,
  validateVisibilityGraph,
} from "./visibility";
import type {
  AnswerType,
  AnswerValueInput,
  AnsweredValue,
  QuestionNode,
  QuestionVersionConstraints,
  QuestionnaireRunStatus,
  VisibilityConditionInput,
} from "./types";

// ---------------------------------------------------------------------------
// Interne Hilfstypen: erweitern die reinen Typen aus types.ts um Felder, die
// fuer Sichtbarkeits-/Validierungslogik nicht noetig sind, aber fuer die
// Orchestrierung (Anzeige, Validierungsmeldungen) gebraucht werden.
// ---------------------------------------------------------------------------

interface QuestionVersionRowConstraints extends QuestionVersionConstraints {
  label: string;
}

interface QuestionNodeWithLabel extends QuestionNode {
  activeVersion: QuestionVersionRowConstraints;
}

/**
 * Gemeinsamer Typ fuer alle DB-Zugriffsfunktionen dieser Datei.
 *
 * WICHTIG (mit ChatGPT/Projektleiter abgestimmt, siehe CI-Fehler-Analyse
 * nach CI #5): NICHT als Union `ScopedPrismaClient | Prisma.TransactionClient`
 * definieren - eine Union zweier strukturell unterschiedlicher Prisma-
 * Client-Typen laesst sich von TypeScript nicht zuverlaessig auf die
 * ueberladenen Modell-Delegate-Methoden (`findMany`, `create`, ...) abbilden
 * ("not callable" / "Excessive stack depth comparing types" in CI, wo echte
 * Prisma-Typen vorliegen - siehe SANDBOX-VERIFIKATIONSLUECKE oben).
 *
 * Stattdessen wird NUR der Transaktions-Client-Typ direkt aus der
 * Tenant-Scoping-Extension selbst abgeleitet (der Typ des `tx`-Parameters in
 * `db.$transaction(async (tx) => ...)`). Der volle `ScopedPrismaClient` (also
 * `db` selbst) ist strukturell ein Subtyp/kompatibel zuweisbar zu diesem Typ,
 * da er dieselben Modell-Delegates besitzt und lediglich zusaetzliche
 * Methoden wie `$transaction` anbietet - daher kann `db` weiterhin ueberall
 * dort uebergeben werden, wo `QueryClient` erwartet wird, ohne separate
 * Union oder Casts.
 */
type ScopedTransactionClient = Parameters<Parameters<ScopedPrismaClient["$transaction"]>[0]>[0];
type QueryClient = ScopedTransactionClient;

/** Prisma-Payload-Form einer Frage inkl. der (zeit-/status-gefilterten) QuestionVersion(en) mit AnswerOptions und VisibilityConditions. */
type QuestionRow = Prisma.QuestionGetPayload<{
  include: {
    versions: {
      include: {
        answerOptions: true;
        visibilityConditions: true;
      };
    };
  };
}>;

type QuestionVersionRow = QuestionRow["versions"][number];

/** Prisma-Payload-Form einer aktiven CustomerAnswer-Zeile inkl. der referenzierten `questionId`. */
type RawAnswerRow = Prisma.CustomerAnswerGetPayload<{
  include: { questionVersion: { select: { questionId: true } } };
}>;

// ---------------------------------------------------------------------------
// Oeffentliche DTOs
// ---------------------------------------------------------------------------

export interface QuestionForAnswering {
  questionId: string;
  questionVersionId: string;
  label: string;
  answerType: AnswerType;
  isRequired: boolean;
  sortOrder: number;
  answerOptions: { key: string; label: string }[];
  minValue: string | null;
  maxValue: string | null;
  maxLength: number | null;
  minSelections: number | null;
  maxSelections: number | null;
  /** Aktuell aktive Antwort dieser Frage in dieser Beratung, oder null falls unbeantwortet. */
  currentAnswer: AnswerValueInput | null;
  /** Aktuelle `answerVersion` fuer optimistic locking via `changeAnswer()`, oder null falls unbeantwortet. */
  currentAnswerVersion: number | null;
}

export interface QuestionnaireState {
  consultationSessionId: string;
  questionnaireVersionId: string;
  status: QuestionnaireRunStatus;
  /** Sichtbare Fragen im aktuellen Pfad, sortiert nach sortOrder. */
  visibleQuestions: QuestionForAnswering[];
  progress: QuestionnaireProgress;
}

export interface StartQuestionnaireInput {
  questionnaireKey: string;
  storeId: string;
  employeeId: string;
  customerReferenceId?: string | null;
  consultationType: "NEW_CONTRACT" | "RENEWAL";
  /** Referenzzeitpunkt fuer die QuestionnaireVersion-Auswahl; Default: jetzt. */
  at?: Date;
}

export interface SaveAnswerInput {
  consultationSessionId: string;
  questionId: string;
  value: AnswerValueInput;
}

export interface ChangeAnswerInput {
  consultationSessionId: string;
  questionId: string;
  value: AnswerValueInput;
  /** Die vom Aufrufer zuletzt gesehene `answerVersion` (Compare-And-Swap). */
  expectedAnswerVersion: number;
}

export interface AnswerWriteResult {
  /** Neue answerVersion nach dem Schreiben, oder null, wenn die Antwort dadurch geloescht wurde (leere Eingabe bei changeAnswer). */
  answerVersion: number | null;
  /** Fragen, die durch diese Aenderung neu verdeckt und deren Antworten deaktiviert wurden. */
  hiddenQuestionIds: string[];
}

export interface CompleteQuestionnaireResult {
  consultationSessionId: string;
  status: "COMPLETED";
  endedAt: string;
  progress: QuestionnaireProgress;
}

// ---------------------------------------------------------------------------
// Interne Ladefunktionen (DB -> reine Typen)
// ---------------------------------------------------------------------------

function buildNodeFromQuestionAndVersion(
  q: Pick<QuestionRow, "id" | "sortOrder">,
  version: QuestionVersionRow,
): QuestionNodeWithLabel {
  return {
    questionId: q.id,
    sortOrder: q.sortOrder,
    activeVersion: {
      id: version.id,
      label: version.label,
      answerType: version.answerType as AnswerType,
      isRequired: version.isRequired,
      minValue:
        version.minValue !== null && version.minValue !== undefined
          ? version.minValue.toString()
          : null,
      maxValue:
        version.maxValue !== null && version.maxValue !== undefined
          ? version.maxValue.toString()
          : null,
      maxLength: version.maxLength ?? null,
      minSelections: version.minSelections ?? null,
      maxSelections: version.maxSelections ?? null,
      answerOptions: version.answerOptions.map((o) => ({ key: o.key, label: o.label })),
    },
    visibilityConditions: version.visibilityConditions.map((c) => ({
      id: c.id,
      targetQuestionId: c.targetQuestionId,
      operator: c.operator as VisibilityConditionInput["operator"],
      comparisonValue: c.comparisonValue,
      combinator: c.combinator as VisibilityConditionInput["combinator"],
    })),
  };
}

/**
 * Laedt alle Fragen einer QuestionnaireVersion mit jeweils GENAU der
 * QuestionVersion, die zum Zeitpunkt `atTime` gueltig+veroeffentlicht war
 * (status ACTIVE/EXPIRED, validFrom <= atTime < validTo). Fragen ohne
 * passende Version zu diesem Zeitpunkt werden uebersprungen (koennen fuer
 * eine bereits laufende Beratung praktisch nicht vorkommen, siehe
 * `question_versions_no_overlap`-Exclusion-Constraint).
 */
async function loadQuestionNodesAtTime(
  client: QueryClient,
  questionnaireVersionId: string,
  atTime: Date,
): Promise<QuestionNodeWithLabel[]> {
  const questions: QuestionRow[] = await client.question.findMany({
    where: { questionnaireVersionId },
    orderBy: { sortOrder: "asc" },
    include: {
      versions: {
        where: {
          status: { in: ["ACTIVE", "EXPIRED"] },
          validFrom: { lte: atTime },
          OR: [{ validTo: null }, { validTo: { gt: atTime } }],
        },
        include: {
          answerOptions: { orderBy: { sortOrder: "asc" } },
          visibilityConditions: true,
        },
      },
    },
  });

  const nodes: QuestionNodeWithLabel[] = [];
  for (const q of questions) {
    const version = q.versions[0];
    if (!version) continue;
    nodes.push(buildNodeFromQuestionAndVersion(q, version));
  }
  return nodes;
}

/**
 * Laedt fuer JEDE Frage einer QuestionnaireVersion eine REPRAESENTATIVE,
 * nicht archivierte QuestionVersion (neuestes validFrom) - unabhaengig von
 * einem konkreten Zeitpunkt. Nur fuer `validateQuestionnaireVersion()`
 * gedacht (statische Vorab-Pruefung vor Veroeffentlichung, bei der i. d. R.
 * noch keine QuestionVersion ACTIVE ist).
 */
async function loadRepresentativeQuestionNodesForValidation(
  client: QueryClient,
  questionnaireVersionId: string,
): Promise<{ nodes: QuestionNodeWithLabel[]; questionsWithoutVersion: string[] }> {
  const questions: QuestionRow[] = await client.question.findMany({
    where: { questionnaireVersionId },
    orderBy: { sortOrder: "asc" },
    include: {
      versions: {
        where: { status: { in: ["DRAFT", "ACTIVE", "EXPIRED"] } },
        include: {
          answerOptions: { orderBy: { sortOrder: "asc" } },
          visibilityConditions: true,
        },
        orderBy: [{ validFrom: "desc" }, { createdAt: "desc" }],
      },
    },
  });

  const nodes: QuestionNodeWithLabel[] = [];
  const questionsWithoutVersion: string[] = [];
  for (const q of questions) {
    const version = q.versions[0];
    if (!version) {
      questionsWithoutVersion.push(q.id);
      continue;
    }
    nodes.push(buildNodeFromQuestionAndVersion(q, version));
  }
  return { nodes, questionsWithoutVersion };
}

/**
 * Formatiert ein DB-Datum als reines Kalenderdatum (YYYY-MM-DD, UTC-basiert,
 * keine lokale Zeitzonenumrechnung). Wird ausschliesslich fuer den Rueckweg
 * zu `DateInput` (natives `<input type="date">`) benoetigt -- dieses Feld
 * akzeptiert zwingend nur dieses Format, ein voller ISO-Zeitstempel
 * (`toISOString()`) fuehrt dazu, dass die Auswahl nach jedem Speichern als
 * leer angezeigt wird (Bugfix, siehe ChatGPT-Konsultation 2026-08-06).
 */
function toDateOnlyString(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function mapAnswerRowToAnsweredValue(row: RawAnswerRow): AnsweredValue {
  return {
    answerType: row.answerType,
    // Aktive CustomerAnswer-Zeilen repraesentieren laut Design (siehe
    // saveAnswer/changeAnswer) immer eine gesetzte Antwort - eine "leere"
    // aktive Zeile wird nie angelegt (changeAnswer mit leerer Eingabe
    // deaktiviert die Zeile stattdessen ersatzlos).
    isAnswered: true,
    integerValue: row.integerValue ?? undefined,
    decimalValue: row.decimalValue !== null ? row.decimalValue.toString() : undefined,
    booleanValue: row.booleanValue ?? undefined,
    dateValue: row.dateValue ? row.dateValue.toISOString() : undefined,
    choiceValues: row.choiceValues,
  };
}

function rawRowToAnswerValueInput(row: RawAnswerRow): AnswerValueInput {
  return {
    integerValue: row.integerValue ?? undefined,
    decimalValue: row.decimalValue !== null ? row.decimalValue.toString() : undefined,
    booleanValue: row.booleanValue ?? undefined,
    dateValue: row.dateValue ? toDateOnlyString(row.dateValue) : undefined,
    choiceValues: row.choiceValues,
    freeTextValue: row.freeTextValue ?? undefined,
  };
}

/** Laedt alle aktiven Antworten einer Beratung, indiziert nach `questionId` (nicht `questionVersionId`). */
async function loadActiveAnswers(
  client: QueryClient,
  consultationSessionId: string,
): Promise<{ answers: Map<string, AnsweredValue>; rawByQuestionId: Map<string, RawAnswerRow> }> {
  const rows: RawAnswerRow[] = await client.customerAnswer.findMany({
    where: { consultationSessionId, isActive: true },
    include: { questionVersion: { select: { questionId: true } } },
  });

  const answers = new Map<string, AnsweredValue>();
  const rawByQuestionId = new Map<string, RawAnswerRow>();
  for (const row of rows) {
    const questionId: string | undefined = row.questionVersion?.questionId;
    if (!questionId) continue; // sollte wegen onDelete: Restrict auf QuestionVersion praktisch nie vorkommen.
    answers.set(questionId, mapAnswerRowToAnsweredValue(row));
    rawByQuestionId.set(questionId, row);
  }
  return { answers, rawByQuestionId };
}

function assertSessionModifiable(session: { id: string; status: string }): void {
  if (session.status !== "IN_PROGRESS") {
    throw new QuestionnaireRunNotModifiableError(session.id, session.status);
  }
}

function visibleIdSet(path: VisibleQuestionSummary[]): Set<string> {
  return new Set(path.map((p) => p.questionId));
}

/** Hat sich die MENGE der sichtbaren Fragen veraendert (nicht nur ihr Beantwortungsstatus)? */
function pathVisibilityChanged(
  before: VisibleQuestionSummary[],
  after: VisibleQuestionSummary[],
): boolean {
  const b = visibleIdSet(before);
  const a = visibleIdSet(after);
  if (b.size !== a.size) return true;
  for (const id of b) if (!a.has(id)) return true;
  return false;
}

function buildCustomerAnswerCreateData(
  tenantId: string,
  consultationSessionId: string,
  questionVersionId: string,
  answerType: AnswerType,
  input: AnswerValueInput,
  answerVersion: number,
  answeredAt: Date,
) {
  return {
    tenantId,
    consultationSessionId,
    questionVersionId,
    answerType,
    integerValue: input.integerValue ?? null,
    decimalValue: input.decimalValue ?? null,
    booleanValue: input.booleanValue ?? null,
    dateValue: input.dateValue ? new Date(input.dateValue) : null,
    choiceValues: input.choiceValues ?? [],
    freeTextValue: input.freeTextValue ?? null,
    isActive: true,
    answerVersion,
    answeredAt,
  };
}

async function deactivateAnswersForQuestions(
  client: QueryClient,
  nodes: QuestionNode[],
  consultationSessionId: string,
  questionIds: string[],
): Promise<void> {
  if (questionIds.length === 0) return;
  const versionIds = questionIds
    .map((qId) => nodes.find((n) => n.questionId === qId)?.activeVersion.id)
    .filter((id): id is string => Boolean(id));
  if (versionIds.length === 0) return;
  await client.customerAnswer.updateMany({
    where: { consultationSessionId, questionVersionId: { in: versionIds }, isActive: true },
    data: { isActive: false },
  });
}

async function buildState(
  client: QueryClient,
  session: ConsultationSession,
): Promise<QuestionnaireState> {
  const atTime: Date = session.startedAt;
  const nodes = await loadQuestionNodesAtTime(client, session.questionnaireVersionId, atTime);
  const { answers, rawByQuestionId } = await loadActiveAnswers(client, session.id);
  const visiblePath = computeVisiblePath(nodes, answers);
  const visibleIds = visibleIdSet(visiblePath);
  const progress = computeProgress(visiblePath);

  const latestActiveAnswerAnsweredAt =
    rawByQuestionId.size > 0
      ? ([...rawByQuestionId.values()]
          .map((r) => r.answeredAt.toISOString())
          .sort()
          .at(-1) ?? null)
      : null;

  const status = deriveQuestionnaireRunStatus(
    { status: session.status, endedAt: session.endedAt ? session.endedAt.toISOString() : null },
    latestActiveAnswerAnsweredAt,
  );

  const visibleQuestions: QuestionForAnswering[] = nodes
    .filter((n) => visibleIds.has(n.questionId))
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((n) => {
      const raw = rawByQuestionId.get(n.questionId);
      return {
        questionId: n.questionId,
        questionVersionId: n.activeVersion.id,
        label: n.activeVersion.label,
        answerType: n.activeVersion.answerType,
        isRequired: n.activeVersion.isRequired,
        sortOrder: n.sortOrder,
        answerOptions: n.activeVersion.answerOptions,
        minValue: n.activeVersion.minValue ?? null,
        maxValue: n.activeVersion.maxValue ?? null,
        maxLength: n.activeVersion.maxLength ?? null,
        minSelections: n.activeVersion.minSelections ?? null,
        maxSelections: n.activeVersion.maxSelections ?? null,
        currentAnswer: raw ? rawRowToAnswerValueInput(raw) : null,
        currentAnswerVersion: raw ? raw.answerVersion : null,
      };
    });

  return {
    consultationSessionId: session.id,
    questionnaireVersionId: session.questionnaireVersionId,
    status,
    visibleQuestions,
    progress,
  };
}

async function requireSession(consultationSessionId: string): Promise<ConsultationSession> {
  const session = await db.consultationSession.findUnique({ where: { id: consultationSessionId } });
  if (!session) {
    throw new ConsultationSessionNotFoundError(consultationSessionId);
  }
  return session;
}

// ---------------------------------------------------------------------------
// 1. Fragebogen starten
// ---------------------------------------------------------------------------

export async function startQuestionnaire(
  input: StartQuestionnaireInput,
): Promise<QuestionnaireState> {
  const atTime = input.at ?? new Date();
  const tenantId = getTenantId();

  return db.$transaction(async (tx) => {
    const questionnaire = await tx.questionnaire.findFirst({
      where: { key: input.questionnaireKey },
    });
    if (!questionnaire) {
      throw new NoActiveQuestionnaireVersionError(input.questionnaireKey, atTime);
    }

    const version = await tx.questionnaireVersion.findFirst({
      where: {
        questionnaireId: questionnaire.id,
        status: "ACTIVE",
        validFrom: { lte: atTime },
        OR: [{ validTo: null }, { validTo: { gt: atTime } }],
      },
      orderBy: { validFrom: "desc" },
    });
    if (!version) {
      throw new NoActiveQuestionnaireVersionError(input.questionnaireKey, atTime);
    }

    const session = await tx.consultationSession.create({
      data: {
        tenantId,
        storeId: input.storeId,
        employeeId: input.employeeId,
        customerReferenceId: input.customerReferenceId ?? null,
        questionnaireVersionId: version.id,
        consultationType: input.consultationType,
        status: "IN_PROGRESS",
        startedAt: atTime,
      },
    });

    await tx.analyticsEvent.create({
      data: {
        tenantId,
        storeId: input.storeId,
        employeeId: input.employeeId,
        eventType: "QUESTIONNAIRE_STARTED",
        occurredAt: atTime,
        payload: { consultationSessionId: session.id, questionnaireVersionId: version.id },
      },
    });

    return buildState(tx, session);
  });
}

// ---------------------------------------------------------------------------
// 2. Befragungszustand laden (inkl. naechster Frage via progress.nextQuestionId)
// ---------------------------------------------------------------------------

export async function loadQuestionnaireState(
  consultationSessionId: string,
): Promise<QuestionnaireState> {
  const session = await requireSession(consultationSessionId);
  return buildState(db, session);
}

// ---------------------------------------------------------------------------
// 4./5. Antwort speichern / aendern
// ---------------------------------------------------------------------------

export async function saveAnswer(input: SaveAnswerInput): Promise<AnswerWriteResult> {
  const session = await requireSession(input.consultationSessionId);
  assertSessionModifiable(session);
  const tenantId = getTenantId();

  const atTime: Date = session.startedAt;
  const nodes = await loadQuestionNodesAtTime(db, session.questionnaireVersionId, atTime);
  const node = nodes.find((n) => n.questionId === input.questionId);
  if (!node) {
    throw new QuestionNotFoundError(input.questionId);
  }

  const { answers: answersBefore } = await loadActiveAnswers(db, session.id);
  const pathBefore = computeVisiblePath(nodes, answersBefore);
  if (!pathBefore.some((p) => p.questionId === input.questionId)) {
    throw new QuestionNotVisibleError(input.questionId);
  }

  validateAnswerInput(node.activeVersion, input.value);
  if (!hasAnswerValue(input.value)) {
    throw new InvalidAnswerError(node.activeVersion.id, [
      "saveAnswer erfordert mindestens ein gesetztes Wertfeld. Zum Loeschen einer vorhandenen Antwort siehe changeAnswer() mit leerer Eingabe.",
    ]);
  }

  const now = new Date();

  const hiddenQuestionIds = await db.$transaction(async (tx) => {
    try {
      await tx.customerAnswer.create({
        data: buildCustomerAnswerCreateData(
          tenantId,
          session.id,
          node.activeVersion.id,
          node.activeVersion.answerType,
          input.value,
          1,
          now,
        ),
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        throw new AnswerAlreadyExistsError(node.activeVersion.id);
      }
      throw err;
    }

    const { answers: answersAfter } = await loadActiveAnswers(tx, session.id);
    const pathAfter = computeVisiblePath(nodes, answersAfter);
    const hidden = findNewlyHiddenAnsweredQuestionIds(pathBefore, pathAfter);
    await deactivateAnswersForQuestions(tx, nodes, session.id, hidden);

    await tx.analyticsEvent.create({
      data: {
        tenantId,
        storeId: session.storeId,
        employeeId: session.employeeId,
        eventType: "QUESTION_ANSWERED",
        occurredAt: now,
        payload: {
          consultationSessionId: session.id,
          questionnaireVersionId: session.questionnaireVersionId,
          questionId: input.questionId,
        },
      },
    });

    if (pathVisibilityChanged(pathBefore, pathAfter)) {
      await tx.analyticsEvent.create({
        data: {
          tenantId,
          storeId: session.storeId,
          employeeId: session.employeeId,
          eventType: "PATH_RECALCULATED",
          occurredAt: now,
          payload: {
            consultationSessionId: session.id,
            questionnaireVersionId: session.questionnaireVersionId,
            hiddenQuestionCount: hidden.length,
          },
        },
      });
    }

    return hidden;
  });

  return { answerVersion: 1, hiddenQuestionIds };
}

export async function changeAnswer(input: ChangeAnswerInput): Promise<AnswerWriteResult> {
  const session = await requireSession(input.consultationSessionId);
  assertSessionModifiable(session);
  const tenantId = getTenantId();

  const atTime: Date = session.startedAt;
  const nodes = await loadQuestionNodesAtTime(db, session.questionnaireVersionId, atTime);
  const node = nodes.find((n) => n.questionId === input.questionId);
  if (!node) {
    throw new QuestionNotFoundError(input.questionId);
  }

  const { answers: answersBefore } = await loadActiveAnswers(db, session.id);
  const pathBefore = computeVisiblePath(nodes, answersBefore);
  if (!pathBefore.some((p) => p.questionId === input.questionId)) {
    throw new QuestionNotVisibleError(input.questionId);
  }

  validateAnswerInput(node.activeVersion, input.value);

  const now = new Date();
  const willHaveValue = hasAnswerValue(input.value);
  const newAnswerVersion = input.expectedAnswerVersion + 1;

  const hiddenQuestionIds = await db.$transaction(async (tx) => {
    const deactivated = await tx.customerAnswer.updateMany({
      where: {
        consultationSessionId: session.id,
        questionVersionId: node.activeVersion.id,
        isActive: true,
        answerVersion: input.expectedAnswerVersion,
      },
      data: { isActive: false },
    });
    if (deactivated.count !== 1) {
      throw new StaleAnswerVersionError(node.activeVersion.id, input.expectedAnswerVersion);
    }

    if (willHaveValue) {
      await tx.customerAnswer.create({
        data: buildCustomerAnswerCreateData(
          tenantId,
          session.id,
          node.activeVersion.id,
          node.activeVersion.answerType,
          input.value,
          newAnswerVersion,
          now,
        ),
      });
    }

    const { answers: answersAfter } = await loadActiveAnswers(tx, session.id);
    const pathAfter = computeVisiblePath(nodes, answersAfter);
    const hidden = findNewlyHiddenAnsweredQuestionIds(pathBefore, pathAfter);
    await deactivateAnswersForQuestions(tx, nodes, session.id, hidden);

    await tx.analyticsEvent.create({
      data: {
        tenantId,
        storeId: session.storeId,
        employeeId: session.employeeId,
        eventType: "ANSWER_CHANGED",
        occurredAt: now,
        payload: {
          consultationSessionId: session.id,
          questionnaireVersionId: session.questionnaireVersionId,
          questionId: input.questionId,
        },
      },
    });

    if (pathVisibilityChanged(pathBefore, pathAfter)) {
      await tx.analyticsEvent.create({
        data: {
          tenantId,
          storeId: session.storeId,
          employeeId: session.employeeId,
          eventType: "PATH_RECALCULATED",
          occurredAt: now,
          payload: {
            consultationSessionId: session.id,
            questionnaireVersionId: session.questionnaireVersionId,
            hiddenQuestionCount: hidden.length,
          },
        },
      });
    }

    return hidden;
  });

  return {
    answerVersion: willHaveValue ? newAnswerVersion : null,
    hiddenQuestionIds,
  };
}

// ---------------------------------------------------------------------------
// 6. Sichtbaren Fragenpfad neu berechnen (reiner Lesezugriff, keine Seiteneffekte)
// ---------------------------------------------------------------------------

export async function recalculateVisiblePath(
  consultationSessionId: string,
): Promise<VisibleQuestionSummary[]> {
  const session = await requireSession(consultationSessionId);
  const atTime: Date = session.startedAt;
  const nodes = await loadQuestionNodesAtTime(db, session.questionnaireVersionId, atTime);
  const { answers } = await loadActiveAnswers(db, session.id);
  return computeVisiblePath(nodes, answers);
}

// ---------------------------------------------------------------------------
// 7. Fortschritt abrufen
// ---------------------------------------------------------------------------

export async function getProgress(consultationSessionId: string): Promise<QuestionnaireProgress> {
  const state = await loadQuestionnaireState(consultationSessionId);
  return state.progress;
}

// ---------------------------------------------------------------------------
// 8. Fragebogen abschliessen
// ---------------------------------------------------------------------------

export async function completeQuestionnaire(
  consultationSessionId: string,
): Promise<CompleteQuestionnaireResult> {
  const session = await requireSession(consultationSessionId);
  assertSessionModifiable(session);
  const tenantId = getTenantId();

  const atTime: Date = session.startedAt;
  const nodes = await loadQuestionNodesAtTime(db, session.questionnaireVersionId, atTime);
  const { answers } = await loadActiveAnswers(db, session.id);
  const visiblePath = computeVisiblePath(nodes, answers);
  const progress = computeProgress(visiblePath);

  if (!progress.canComplete) {
    throw new IncompleteQuestionnaireError(progress.missingRequiredQuestionIds);
  }

  const now = new Date();

  await db.$transaction(async (tx) => {
    const updated = await tx.consultationSession.updateMany({
      where: { id: session.id, status: "IN_PROGRESS" },
      data: { status: "COMPLETED", endedAt: now },
    });
    if (updated.count !== 1) {
      throw new QuestionnaireRunNotModifiableError(
        session.id,
        "nicht mehr IN_PROGRESS (parallel veraendert)",
      );
    }

    await tx.analyticsEvent.create({
      data: {
        tenantId,
        storeId: session.storeId,
        employeeId: session.employeeId,
        eventType: "QUESTIONNAIRE_COMPLETED",
        occurredAt: now,
        payload: {
          consultationSessionId: session.id,
          questionnaireVersionId: session.questionnaireVersionId,
          answeredVisibleQuestions: progress.answeredVisibleQuestions,
          totalVisibleQuestions: progress.totalVisibleQuestions,
        },
      },
    });

    await tx.auditLog.create({
      data: {
        tenantId,
        action: "UPDATE",
        entityType: "ConsultationSession",
        entityId: session.id,
        metadata: {
          event: "QUESTIONNAIRE_COMPLETED",
          questionnaireVersionId: session.questionnaireVersionId,
          employeeId: session.employeeId,
          totalVisibleQuestions: progress.totalVisibleQuestions,
          answeredVisibleQuestions: progress.answeredVisibleQuestions,
        },
      },
    });
  });

  return {
    consultationSessionId: session.id,
    status: "COMPLETED",
    endedAt: now.toISOString(),
    progress,
  };
}

// ---------------------------------------------------------------------------
// 9. QuestionnaireVersion technisch validieren (Vorab-Pruefung vor Veroeffentlichung)
// ---------------------------------------------------------------------------

/**
 * Prueft eine QuestionnaireVersion gegen alle 13 in PHASE_3A_STARTPROMPT.md
 * Abschnitt 8 geforderten strukturellen Regeln. Sammelt ALLE gefundenen
 * Verstoesse (analog zu `InvalidAnswerError`), mit EINER Ausnahme: die
 * strukturellen Graph-Pruefungen aus `validateVisibilityGraph()` (fremde
 * Zielfrage / gemischte Kombinatoren / Zyklen) werfen bereits beim ersten
 * gefundenen Problem - deren Meldung wird 1:1 uebernommen, statt die
 * Graph-Traversierung fuer eine vollstaendige Fehlerliste umzubauen.
 */
export async function validateQuestionnaireVersion(questionnaireVersionId: string): Promise<void> {
  const issues: string[] = [];

  const { nodes, questionsWithoutVersion } = await loadRepresentativeQuestionNodesForValidation(
    db,
    questionnaireVersionId,
  );

  for (const questionId of questionsWithoutVersion) {
    issues.push(`Frage "${questionId}" hat keine gueltige (nicht archivierte) QuestionVersion.`);
  }

  // Check: keine Fragen vorhanden
  if (nodes.length === 0) {
    issues.push("QuestionnaireVersion enthaelt keine Fragen.");
  }

  // Check: doppelte oder ungueltige Reihenfolge
  const seenSortOrders = new Set<number>();
  for (const node of nodes) {
    const so = node.sortOrder;
    if (!Number.isInteger(so) || so < 1) {
      issues.push(
        `Frage "${node.questionId}": ungueltige sortOrder "${so}" (muss eine positive ganze Zahl sein).`,
      );
    }
    if (seenSortOrders.has(so)) {
      issues.push(`sortOrder "${so}" ist mehrfach vergeben (u. a. Frage "${node.questionId}").`);
    }
    seenSortOrders.add(so);
  }

  const byQuestionId = new Map(nodes.map((n) => [n.questionId, n]));
  const unreachableQuestionIds = new Set<string>();

  for (const node of nodes) {
    const v = node.activeVersion;

    // Check: fehlende AnswerOptions bei Auswahlfragen
    if (
      (v.answerType === "SINGLE_CHOICE" || v.answerType === "MULTIPLE_CHOICE") &&
      v.answerOptions.length === 0
    ) {
      issues.push(`Frage "${node.questionId}" (${v.answerType}) hat keine AnswerOptions.`);
    }

    // Check: ungueltige Mindest-/Hoechstwerte
    const supportsMinMax = v.answerType === "INTEGER" || v.answerType === "DECIMAL";
    if (
      !supportsMinMax &&
      (v.minValue !== null || v.maxValue !== null) &&
      v.minValue !== undefined
    ) {
      issues.push(
        `Frage "${node.questionId}" (${v.answerType}) darf keine minValue/maxValue haben.`,
      );
    }
    if (supportsMinMax && v.minValue && v.maxValue) {
      if (compareDecimalStrings(v.minValue, v.maxValue) > 0) {
        issues.push(
          `Frage "${node.questionId}": minValue (${v.minValue}) > maxValue (${v.maxValue}).`,
        );
      }
    }

    // Check: ungueltige Textlaengen
    if (v.answerType !== "SHORT_TEXT" && v.maxLength !== null && v.maxLength !== undefined) {
      issues.push(`Frage "${node.questionId}" (${v.answerType}) darf kein maxLength haben.`);
    }
    if (
      v.answerType === "SHORT_TEXT" &&
      v.maxLength !== null &&
      v.maxLength !== undefined &&
      (!Number.isInteger(v.maxLength) || v.maxLength <= 0)
    ) {
      issues.push(`Frage "${node.questionId}": maxLength muss eine positive ganze Zahl sein.`);
    }

    // Check: ungueltige Mindest-/Hoechstauswahl
    if (
      v.answerType !== "MULTIPLE_CHOICE" &&
      ((v.minSelections !== null && v.minSelections !== undefined) ||
        (v.maxSelections !== null && v.maxSelections !== undefined))
    ) {
      issues.push(
        `Frage "${node.questionId}" (${v.answerType}) darf keine minSelections/maxSelections haben.`,
      );
    }
    if (v.answerType === "MULTIPLE_CHOICE") {
      const optionCount = v.answerOptions.length;
      if (v.minSelections !== null && v.minSelections !== undefined) {
        if (!Number.isInteger(v.minSelections) || v.minSelections < 0) {
          issues.push(
            `Frage "${node.questionId}": minSelections muss eine nicht-negative ganze Zahl sein.`,
          );
        }
        if (v.minSelections > optionCount) {
          issues.push(
            `Frage "${node.questionId}": minSelections (${v.minSelections}) uebersteigt Anzahl AnswerOptions (${optionCount}).`,
          );
        }
      }
      if (v.maxSelections !== null && v.maxSelections !== undefined) {
        if (!Number.isInteger(v.maxSelections) || v.maxSelections < 1) {
          issues.push(
            `Frage "${node.questionId}": maxSelections muss eine positive ganze Zahl sein.`,
          );
        }
        if (v.maxSelections > optionCount) {
          issues.push(
            `Frage "${node.questionId}": maxSelections (${v.maxSelections}) uebersteigt Anzahl AnswerOptions (${optionCount}).`,
          );
        }
      }
      if (
        v.minSelections !== null &&
        v.minSelections !== undefined &&
        v.maxSelections !== null &&
        v.maxSelections !== undefined &&
        v.minSelections > v.maxSelections
      ) {
        issues.push(`Frage "${node.questionId}": minSelections > maxSelections.`);
      }
    }

    // Checks: fremde/ungueltige Zielfrage, unpassender Operator, ungueltige AnswerOption, Freitext als Ziel
    for (const cond of node.visibilityConditions) {
      const target = byQuestionId.get(cond.targetQuestionId);
      if (!target) {
        issues.push(
          `Frage "${node.questionId}": Bedingung verweist auf fragebogen-fremde/unbekannte Zielfrage "${cond.targetQuestionId}".`,
        );
        continue;
      }
      const targetType = target.activeVersion.answerType;
      if (!isOperatorSupportedForAnswerType(cond.operator, targetType)) {
        issues.push(
          `Frage "${node.questionId}": Operator "${cond.operator}" ist fuer Zielfrage "${cond.targetQuestionId}" (Typ ${targetType}) nicht zulaessig` +
            (targetType === "SHORT_TEXT"
              ? " (Freitext darf nicht als Bedingungsziel dienen)."
              : "."),
        );
      }
      if (
        (targetType === "SINGLE_CHOICE" || targetType === "MULTIPLE_CHOICE") &&
        (["EQUALS", "NOT_EQUALS", "IN", "NOT_IN", "CONTAINS"] as const).includes(
          cond.operator as never,
        )
      ) {
        const validKeys = new Set(target.activeVersion.answerOptions.map((o) => o.key));
        const referenced = splitComparisonList(cond.comparisonValue);
        const invalid = referenced.filter((r) => !validKeys.has(r));
        if (invalid.length > 0) {
          issues.push(
            `Frage "${node.questionId}": Bedingung verweist auf ungueltige AnswerOption(en) "${invalid.join(", ")}" der Zielfrage "${cond.targetQuestionId}".`,
          );
        }
      }
    }

    // Check: statisch erkennbare Widersprueche innerhalb einer AND-Gruppe (nicht erreichbare Frage)
    if (
      node.visibilityConditions.length > 0 &&
      node.visibilityConditions[0]?.combinator === "AND"
    ) {
      const byTarget = new Map<string, VisibilityConditionInput[]>();
      for (const cond of node.visibilityConditions) {
        const list = byTarget.get(cond.targetQuestionId) ?? [];
        list.push(cond);
        byTarget.set(cond.targetQuestionId, list);
      }
      for (const [targetId, conds] of byTarget) {
        const equalsValues = new Set(
          conds.filter((c) => c.operator === "EQUALS").map((c) => c.comparisonValue.trim()),
        );
        if (equalsValues.size > 1) {
          issues.push(
            `Frage "${node.questionId}" ist statisch unerreichbar: widerspruechliche EQUALS-Bedingungen auf Zielfrage "${targetId}" (${[...equalsValues].join(", ")}).`,
          );
          unreachableQuestionIds.add(node.questionId);
        }
        const hasIsAnswered = conds.some((c) => c.operator === "IS_ANSWERED");
        const hasIsNotAnswered = conds.some((c) => c.operator === "IS_NOT_ANSWERED");
        if (hasIsAnswered && hasIsNotAnswered) {
          issues.push(
            `Frage "${node.questionId}" ist statisch unerreichbar: IS_ANSWERED und IS_NOT_ANSWERED gleichzeitig auf Zielfrage "${targetId}".`,
          );
          unreachableQuestionIds.add(node.questionId);
        }
      }
    }
  }

  // Check: fremde Zielfrage / gemischte Kombinatoren / Zyklen (Gesamtgraph)
  try {
    validateVisibilityGraph(nodes);
  } catch (err) {
    issues.push(err instanceof Error ? err.message : String(err));
  }

  // Check: Pflichtfrage, die durch fehlerhafte Konfiguration niemals beantwortbar waere
  for (const node of nodes) {
    if (node.activeVersion.isRequired && unreachableQuestionIds.has(node.questionId)) {
      issues.push(
        `Frage "${node.questionId}" ist Pflichtfrage, aber durch widerspruechliche Sichtbarkeitsbedingungen niemals erreichbar/beantwortbar.`,
      );
    }
  }

  if (issues.length > 0) {
    throw new QuestionnaireVersionInvalidError(questionnaireVersionId, issues);
  }
}

/**
 * Wache fuer eine spaetere Autoren-Oberflaeche (nicht Teil des Phase-3A-Umfangs):
 * wirft, wenn versucht wird, eine bereits nicht mehr im Status DRAFT
 * befindliche QuestionnaireVersion inhaltlich zu veraendern.
 */
export async function assertQuestionnaireVersionIsEditable(
  questionnaireVersionId: string,
): Promise<void> {
  const version = await db.questionnaireVersion.findUnique({
    where: { id: questionnaireVersionId },
  });
  if (!version) {
    throw new QuestionnaireVersionInvalidError(questionnaireVersionId, [
      "QuestionnaireVersion nicht gefunden.",
    ]);
  }
  if (version.status !== "DRAFT") {
    throw new QuestionnaireVersionNotEditableError(questionnaireVersionId, version.status);
  }
}
