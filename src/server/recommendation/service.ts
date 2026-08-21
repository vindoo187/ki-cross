/**
 * Orchestrierungsschicht der Empfehlungs-Engine (Phase 3B): verbindet die
 * reinen, DB-freien Kernmodule (`conditions.ts`, `eligibility.ts`,
 * `exclusion.ts`, `fit-score.ts`, `prioritization.ts`, `cross-selling.ts`,
 * `tie-break.ts`, `fingerprint.ts`, `sales-opportunity.ts`,
 * `attribute-registry.ts`) mit dem mandantengescopten Prisma-Client (`db`,
 * siehe `src/server/db/client.ts`). Siehe PHASE_3B_IMPLEMENTATION_PLAN.md
 * Abschnitt 5 ("evaluate()") und Abschnitt 7 ("Transaktionsgrenzen").
 *
 * Zwei oeffentliche Einstiegspunkte:
 *   - evaluate(consultationSessionId): fuehrt eine NEUE Auswertung durch (nur
 *     fuer Sessions mit status = IN_PROGRESS), idempotent ueber
 *     evaluationFingerprint (Fast-Path-SELECT vor jeder Transaktion).
 *   - getLatestRecommendation(consultationSessionId): reiner Lesezugriff
 *     (jeder Session-Status), liefert die zuletzt erzeugte Recommendation
 *     oder null.
 *
 * WICHTIGE DESIGN-ENTSCHEIDUNGEN (siehe docs/RECOMMENDATION_ENGINE.md /
 * docs/OPEN_DECISIONS.md fuer die ausformulierte Fassung):
 *
 * - Fingerprint-`answerId` ist bewusst die STABILE `questionId`, NICHT die
 *   `CustomerAnswer.id`: `changeAnswer()` (Fragen-Engine) legt bei jeder
 *   Aenderung eine neue `CustomerAnswer`-Zeile (neue UUID) an, selbst wenn
 *   sich der effektive Wert nicht aendert. Wuerde man `CustomerAnswer.id`
 *   verwenden, aenderte sich der Fingerprint bei jedem `changeAnswer()`-Aufruf
 *   unabhaengig vom tatsaechlichen Wert - das wuerde die Fingerprint-basierte
 *   Idempotenz aushebeln.
 * - CommissionModelVersion-Aufloesung: `CommissionModel` hat keinen
 *   Schema-Unique-Constraint auf `productId` - theoretisch koennten fuer ein
 *   Produkt mehrere CommissionModel-Zeilen mit je einer ACTIVE Version
 *   gleichzeitig existieren. Fuer deterministische, reproduzierbare Ergebnisse
 *   waehlt der Resolver in diesem Fall je `productId` die Version mit der
 *   juengsten `validFrom` (bei exakter Zeitgleichheit zusaetzlich die groesste
 *   `id`) -- Phase 10 AP2 (ChatGPT-GO 2026-08-21), siehe
 *   `buildResolveCommission`. Ersetzt den vormaligen rein technischen
 *   "kleinste id gewinnt"-Tie-Breaker aus Phase 3B/6.
 * - `SalesOpportunity`-Erzeugung aus einem RecommendationCrossSellingSignal
 *   ist ein SEPARATER, von der Schreib-Transaktion ENTKOPPELTER Schritt (siehe
 *   sales-opportunity.ts) und laeuft AUSSCHLIESSLICH auf dem Pfad einer
 *   tatsaechlich NEU geschriebenen Recommendation - NICHT bei einem
 *   Fast-Path-Cache-Hit und NICHT bei einer P2002-Recovery -, um doppelte
 *   (mutable) SalesOpportunity-Zeilen bei wiederholten idempotenten
 *   evaluate()-Aufrufen mit unveraendertem Fingerprint zu vermeiden.
 * - "Auswertbare Session": wiederverwendet `computeVisiblePath()`/
 *   `computeProgress()` aus `../questionnaire/path.ts` direkt (kein Redesign),
 *   die Lade-Helfer (`loadQuestionNodesAtTime`/`loadActiveAnswers`) sind hier
 *   jedoch eigenstaendig implementiert, da die Fragen-Engine ihre analogen
 *   Funktionen nicht exportiert.
 *
 * BEKANNTES RESTRISIKO: dass `db.$transaction(...)` das Tenant-Scoping
 * innerhalb des `tx`-Callbacks weiterreicht, ist Standardverhalten von Prisma
 * Client Extensions, konnte in dieser Sandbox mangels Datenbankzugriff aber
 * NICHT gegen einen echten Client verifiziert werden - nur in CI.
 *
 * SANDBOX-VERIFIKATIONSLUECKE (rein tooling-bedingt, siehe Abschlussbericht):
 * `@prisma/client` besitzt in dieser Offline-Sandbox keine aufloesbaren
 * Typdeklarationen (`prisma generate` kann hier nicht gegen die echte
 * Prisma-Registry laufen). Dadurch meldet `tsc --noEmit` in dieser Datei
 * zusaetzliche TS7016/TS7006/TS18046-Fehler - exakt dieselbe bereits
 * dokumentierte Fehlerklasse wie in `db/client.ts` und
 * `questionnaire/service.ts`, verifizierbar ausschliesslich in CI.
 */

import type { ConsultationSession } from "@prisma/client";
import { Prisma } from "@prisma/client";
import { db } from "../db/client";
import type { ScopedPrismaClient } from "../tenant/scoped-client";
import { getTenantId } from "../tenant/context";
import { computeProgress, computeVisiblePath } from "../questionnaire/path";
import { ConsultationSessionNotFoundError } from "../questionnaire/errors";
import type {
  AnswerType,
  AnsweredValue,
  LogicalCombinator,
  QuestionNode,
  VisibilityConditionInput,
  VisibilityOperator,
} from "../questionnaire/types";
import { evaluateEligibilityRuleMatches, computeEligibilityResult } from "./eligibility";
import { computeCustomerFitScore } from "./fit-score";
import { evaluateExclusionRules } from "./exclusion";
import { evaluatePrioritizationRules } from "./prioritization";
import { evaluateCrossSellingRules } from "./cross-selling";
import type { CrossSellingEvaluationContext } from "./cross-selling";
import { assignPriorityRanks } from "./tie-break";
import type { RankableItem } from "./tie-break";
import { computeEvaluationFingerprint } from "./fingerprint";
import type {
  FingerprintAnswerInput,
  FingerprintInput,
  FingerprintProductInput,
} from "./fingerprint";
import { buildSalesOpportunityFromSignal } from "./sales-opportunity";
import {
  InsufficientAnswerDataError,
  NoValidProductVersionError,
  RecommendationConsistencyError,
  RuleSetNotConfiguredError,
  SessionNotEvaluableError,
} from "./errors";
// Phase 6 AP3: loadActiveCommissionModelVersions()/buildResolveCommission()
// wurden nach src/server/pricing/commission.ts VERSCHOBEN (Verhalten
// unveraendert), damit die Deal-Erfassung (Phase 6) dieselbe
// Aufloesungsquelle nutzt statt sie zu duplizieren. Siehe dortigen
// Modulkommentar sowie PHASE_6_IMPLEMENTATION_PLAN.md Abschnitt 8.1 Punkt 2.
import { loadActiveCommissionModelVersions, buildResolveCommission } from "../pricing/commission";
import {
  RECOMMENDATION_ALGORITHM_VERSION,
  type ConditionInput,
  type ConditionSourceType,
  type CrossSellingRuleInput,
  type EligibilityRuleInput,
  type ExclusionRuleInput,
  type NeedType,
  type ProductCandidateInput,
  type PrioritizationRuleInput,
  type RationaleEntry,
} from "./types";

// ---------------------------------------------------------------------------
// Query-Client-Typ (siehe questionnaire/service.ts fuer die ausfuehrliche
// Begruendung gegen einen Union-Typ - CI #5).
// ---------------------------------------------------------------------------

type ScopedTransactionClient = Parameters<Parameters<ScopedPrismaClient["$transaction"]>[0]>[0];
type QueryClient = ScopedTransactionClient;

// ---------------------------------------------------------------------------
// Lade-Helfer: Fragen/Antworten (spiegelt questionnaire/service.ts, siehe
// Modulkommentar - dort nicht exportiert)
// ---------------------------------------------------------------------------

async function loadQuestionNodesAtTime(
  client: QueryClient,
  questionnaireVersionId: string,
  atTime: Date,
): Promise<QuestionNode[]> {
  const questions = await client.question.findMany({
    where: { questionnaireVersionId },
    orderBy: { sortOrder: "asc" },
    include: {
      versions: {
        where: {
          status: { in: ["ACTIVE", "EXPIRED"] },
          validFrom: { lte: atTime },
          OR: [{ validTo: null }, { validTo: { gt: atTime } }],
        },
        include: { visibilityConditions: true },
      },
    },
  });

  const nodes: QuestionNode[] = [];
  for (const q of questions) {
    const version = q.versions[0];
    if (!version) continue; // siehe question_versions_no_overlap-Constraint
    nodes.push({
      questionId: q.id,
      sortOrder: q.sortOrder,
      activeVersion: {
        id: version.id,
        answerType: version.answerType as AnswerType,
        isRequired: version.isRequired,
        answerOptions: [],
      },
      visibilityConditions: version.visibilityConditions.map((c): VisibilityConditionInput => ({
        id: c.id,
        targetQuestionId: c.targetQuestionId,
        operator: c.operator as VisibilityOperator,
        comparisonValue: c.comparisonValue,
        combinator: c.combinator as LogicalCombinator,
      })),
    });
  }
  return nodes;
}

interface RawAnswerRow {
  id: string;
  answerType: AnswerType;
  integerValue: number | null;
  decimalValue: Prisma.Decimal | null;
  booleanValue: boolean | null;
  dateValue: Date | null;
  choiceValues: string[];
}

async function loadActiveAnswers(
  client: QueryClient,
  consultationSessionId: string,
): Promise<{
  answers: Map<string, AnsweredValue>;
  answerIdByQuestionId: Map<string, string>;
  rawByQuestionId: Map<string, RawAnswerRow>;
}> {
  const rows = await client.customerAnswer.findMany({
    where: { consultationSessionId, isActive: true },
    include: { questionVersion: { select: { questionId: true } } },
  });

  const answers = new Map<string, AnsweredValue>();
  const answerIdByQuestionId = new Map<string, string>();
  const rawByQuestionId = new Map<string, RawAnswerRow>();
  for (const row of rows) {
    const questionId: string | undefined = row.questionVersion?.questionId;
    if (!questionId) continue; // siehe onDelete: Restrict auf QuestionVersion
    answers.set(questionId, {
      answerType: row.answerType as AnswerType,
      // Aktive CustomerAnswer-Zeilen repraesentieren immer eine gesetzte
      // Antwort (siehe questionnaire/service.ts mapAnswerRowToAnsweredValue).
      isAnswered: true,
      integerValue: row.integerValue ?? undefined,
      decimalValue: row.decimalValue !== null ? row.decimalValue.toString() : undefined,
      booleanValue: row.booleanValue ?? undefined,
      dateValue: row.dateValue ? row.dateValue.toISOString() : undefined,
      choiceValues: row.choiceValues,
    });
    answerIdByQuestionId.set(questionId, row.id);
    rawByQuestionId.set(questionId, {
      id: row.id,
      answerType: row.answerType as AnswerType,
      integerValue: row.integerValue,
      decimalValue: row.decimalValue,
      booleanValue: row.booleanValue,
      dateValue: row.dateValue,
      choiceValues: row.choiceValues,
    });
  }
  return { answers, answerIdByQuestionId, rawByQuestionId };
}

async function requireSession(consultationSessionId: string): Promise<ConsultationSession> {
  const session = await db.consultationSession.findUnique({ where: { id: consultationSessionId } });
  if (!session) {
    throw new ConsultationSessionNotFoundError(consultationSessionId);
  }
  return session;
}

/**
 * Auswertbar sind Sessions mit Status `IN_PROGRESS` (regulaerer Ablauf waehrend
 * der Beratung) UND `COMPLETED` (AP14/CI#22-Fix, mit ChatGPT abgestimmt):
 * `completeQuestionnaire()` (siehe `questionnaire/service.ts`) setzt den
 * Session-Status bereits auf `COMPLETED`, BEVOR im vorgesehenen Ablauf
 * "Empfehlung auswerten" ueberhaupt geklickt wird -- ohne diese Erweiterung
 * konnte `evaluate()` im regulaeren Happy-Path nie erfolgreich sein (siehe
 * CI-Lauf #22, tests/e2e/happy-path.spec.ts). `ABANDONED` bleibt bewusst
 * gesperrt. Ausdruecklich als POSITIVE Whitelist formuliert (nicht als
 * `!== "ABANDONED"`), damit spaeter ergaenzte Statuswerte standardmaessig
 * gesperrt bleiben, bis sie hier bewusst freigegeben werden (ChatGPT-Vorgabe).
 */
function assertSessionEvaluable(session: { id: string; status: string }): void {
  if (session.status !== "IN_PROGRESS" && session.status !== "COMPLETED") {
    throw new SessionNotEvaluableError(session.id, session.status);
  }
}

/** Session-Attribute (SESSION_ATTRIBUTE_DEFINITIONS) werden direkt aus der ConsultationSession abgeleitet, nicht aus Antworten. */
function buildSessionAttributes(session: ConsultationSession): Map<string, string> {
  return new Map([["consultationType", session.consultationType]]);
}

// ---------------------------------------------------------------------------
// Lade-Helfer: RuleSetVersion + Regeln (Abschnitt 3.3 - 3.4)
// ---------------------------------------------------------------------------

async function loadActiveRuleSetVersion(
  client: QueryClient,
  atTime: Date,
): Promise<{ id: string } | null> {
  return client.ruleSetVersion.findFirst({
    where: {
      status: "ACTIVE",
      validFrom: { lte: atTime },
      OR: [{ validTo: null }, { validTo: { gt: atTime } }],
    },
  });
}

function mapCondition(c: {
  id: string;
  groupIndex: number;
  sourceType: string;
  questionId: string | null;
  attributeKey: string | null;
  operator: string;
  comparisonValue: string;
}): ConditionInput {
  return {
    id: c.id,
    groupIndex: c.groupIndex,
    sourceType: c.sourceType as ConditionSourceType,
    questionId: c.questionId,
    attributeKey: c.attributeKey,
    operator: c.operator as VisibilityOperator,
    comparisonValue: c.comparisonValue,
  };
}

async function loadEligibilityRules(
  client: QueryClient,
  ruleSetVersionId: string,
): Promise<EligibilityRuleInput[]> {
  const rows = await client.eligibilityRule.findMany({
    where: { ruleSetVersionId, isActive: true },
    include: { conditions: true },
  });
  return rows.map((r) => ({
    id: r.id,
    key: r.key,
    isRequired: r.isRequired,
    fitWeight: r.fitWeight,
    conditions: r.conditions.map(mapCondition),
  }));
}

async function loadExclusionRules(
  client: QueryClient,
  ruleSetVersionId: string,
): Promise<ExclusionRuleInput[]> {
  const rows = await client.exclusionRule.findMany({
    where: { ruleSetVersionId, isActive: true },
    include: { conditions: true },
  });
  return rows.map((r) => ({
    id: r.id,
    key: r.key,
    reasonCode: r.reasonCode,
    justificationParams: r.justificationParams,
    conditions: r.conditions.map(mapCondition),
  }));
}

async function loadPrioritizationRules(
  client: QueryClient,
  ruleSetVersionId: string,
): Promise<PrioritizationRuleInput[]> {
  const rows = await client.prioritizationRule.findMany({
    where: { ruleSetVersionId, isActive: true },
    include: { conditions: true },
  });
  return rows.map((r) => ({
    id: r.id,
    key: r.key,
    weight: r.weight,
    commissionRequired: r.commissionRequired,
    conditions: r.conditions.map(mapCondition),
  }));
}

async function loadCrossSellingRules(
  client: QueryClient,
  ruleSetVersionId: string,
): Promise<CrossSellingRuleInput[]> {
  const rows = await client.crossSellingRule.findMany({
    where: { ruleSetVersionId, isActive: true },
    include: { conditions: true },
  });
  return rows.map((r) => ({
    id: r.id,
    key: r.key,
    needType: r.needType as NeedType,
    priority: r.priority,
    reasonCode: r.reasonCode,
    justificationParams: null,
    suggestedProductVersionId: r.suggestedProductVersionId,
    conditions: r.conditions.map(mapCondition),
  }));
}

// ---------------------------------------------------------------------------
// Lade-Helfer: ProductVersion-Kandidaten + Provisionsaufloesung
// ---------------------------------------------------------------------------

async function loadProductCandidates(
  client: QueryClient,
  atTime: Date,
): Promise<ProductCandidateInput[]> {
  const rows = await client.productVersion.findMany({
    where: {
      status: "ACTIVE",
      validFrom: { lte: atTime },
      OR: [{ validTo: null }, { validTo: { gt: atTime } }],
    },
    include: {
      tariffAttributes: true,
      product: { select: { id: true, categoryId: true } },
    },
  });

  return rows.map((v) => ({
    productVersionId: v.id,
    productId: v.product.id,
    categoryId: v.product.categoryId,
    monthlyPriceMinor: v.monthlyPriceMinor ?? null,
    attributes: new Map(v.tariffAttributes.map((a) => [a.attributeKey, a.attributeValue])),
  }));
}

// ---------------------------------------------------------------------------
// Ergebnis-DTOs
// ---------------------------------------------------------------------------

export interface RecommendationItemResult {
  id: string;
  productVersionId: string;
  eligibilityPassed: boolean;
  exclusionReasonCodes: string[];
  customerFitScore: number;
  businessPriorityScore: number;
  priorityRank: number;
  rationales: {
    factorKey: string;
    factorValue: string;
    commissionModelVersionId: string | null;
    commissionValueMinor: number | null;
  }[];
}

export interface RecommendationCrossSellingSignalResult {
  id: string;
  needType: NeedType;
  reasonCode: string;
  justificationParams: unknown;
  priority: number;
  suggestedProductVersionId: string | null;
}

export interface RecommendationResult {
  id: string;
  consultationSessionId: string;
  ruleSetVersionId: string;
  algorithmVersion: number;
  evaluationFingerprint: string;
  generatedAt: string;
  items: RecommendationItemResult[];
  crossSellingSignals: RecommendationCrossSellingSignalResult[];
}

async function loadRecommendationResult(
  client: QueryClient,
  recommendationId: string,
): Promise<RecommendationResult> {
  const row = await client.recommendation.findUniqueOrThrow({
    where: { id: recommendationId },
    include: {
      items: { include: { rationale: true }, orderBy: { priorityRank: "asc" } },
      crossSellingSignals: true,
    },
  });

  return {
    id: row.id,
    consultationSessionId: row.consultationSessionId,
    ruleSetVersionId: row.ruleSetVersionId,
    algorithmVersion: row.algorithmVersion,
    evaluationFingerprint: row.evaluationFingerprint,
    generatedAt: row.generatedAt.toISOString(),
    items: row.items.map((item): RecommendationItemResult => ({
      id: item.id,
      productVersionId: item.productVersionId,
      eligibilityPassed: item.eligibilityPassed,
      exclusionReasonCodes: item.exclusionReasonCodes,
      customerFitScore: item.customerFitScore,
      businessPriorityScore: item.businessPriorityScore,
      priorityRank: item.priorityRank,
      rationales: item.rationale.map((r) => ({
        factorKey: r.factorKey,
        factorValue: r.factorValue,
        commissionModelVersionId: r.commissionModelVersionId,
        commissionValueMinor: r.commissionValueMinor,
      })),
    })),
    crossSellingSignals: row.crossSellingSignals.map(
      (s): RecommendationCrossSellingSignalResult => ({
        id: s.id,
        needType: s.needType as NeedType,
        reasonCode: s.reasonCode,
        justificationParams: s.justificationParams,
        priority: s.priority,
        suggestedProductVersionId: s.suggestedProductVersionId,
      }),
    ),
  };
}

// ---------------------------------------------------------------------------
// evaluate()
// ---------------------------------------------------------------------------

interface EvaluatedProductItem extends RankableItem {
  eligibilityPassed: boolean;
  exclusionReasonCodes: string[];
  rationales: RationaleEntry[];
}

/** value === null/undefined -> Prisma.DbNull (Json?-Feld explizit auf NULL setzen), sonst als InputJsonValue durchreichen. */
function toInputJson(value: unknown): Prisma.InputJsonValue | typeof Prisma.DbNull {
  return value === null || value === undefined ? Prisma.DbNull : (value as Prisma.InputJsonValue);
}

async function createSalesOpportunitiesForSignals(
  tenantId: string,
  consultationSessionId: string,
  signals: { id: string; reasonCode: string; justificationParams: unknown; priority: number }[],
): Promise<void> {
  for (const signal of signals) {
    const input = buildSalesOpportunityFromSignal(signal);
    await db.salesOpportunity.create({
      data: {
        tenantId,
        consultationSessionId,
        detectedNeedId: input.detectedNeedId,
        triggerSignalId: input.triggerSignalId,
        reasonCode: input.reasonCode,
        justificationParams: toInputJson(input.justificationParams),
        priority: input.priority,
      },
    });
  }
}

/**
 * Fuehrt eine NEUE Auswertung fuer eine ConsultationSession durch (nur
 * status = IN_PROGRESS). Idempotent ueber evaluationFingerprint: ein
 * wiederholter Aufruf mit unveraendertem Auswertungs-Input liefert dieselbe
 * Recommendation zurueck, ohne eine neue Zeile anzulegen (siehe
 * fingerprint.ts / Modulkommentar).
 */
export async function evaluate(consultationSessionId: string): Promise<RecommendationResult> {
  const tenantId = getTenantId();

  const session = await requireSession(consultationSessionId);
  assertSessionEvaluable(session);

  // Phase 9 AP9 (Kern-Testfall, ChatGPT-Vorgabe 2026-08-18): die drei
  // zeitabhaengigen Konfigurationsquellen haben UNTERSCHIEDLICHE Semantik --
  // vorher wurde hierfuer einheitlich `session.startedAt` verwendet, was fuer
  // RuleSetVersion FALSCH war (siehe Git-Historie dieser Zeile) und dazu
  // fuehrte, dass eine erneute Auswertung derselben Session nach einem
  // Publish einer neuen RuleSetVersion weiterhin die zum Session-Start
  // aktive (ggf. laengst EXPIRED) Version verwendete, statt der aktuell
  // aktiven -- ein Widerspruch zur Architekturentscheidung "RuleSet-Version
  // = pro Evaluation aktueller Snapshot" (im Unterschied zu
  // "Questionnaire-Version = Session-Pinning").
  //
  //   questionnaireAt -- Fragenstand (Text/Struktur) bleibt auf den
  //                      Session-Start gepinnt: eine laufende Beratung soll
  //                      sich rueckwirkend nicht in den gestellten Fragen
  //                      aendern.
  //   ruleSetAt       -- JETZT (aktueller Auswertungszeitpunkt): jede
  //                      evaluate()-Auswertung verwendet die zu diesem
  //                      Zeitpunkt aktuell ACTIVE RuleSetVersion, nicht die
  //                      zum Session-Start aktive. `Recommendation`
  //                      speichert die tatsaechlich verwendete
  //                      `ruleSetVersionId` weiterhin unveraenderlich
  //                      (append-only) je Auswertung.
  //   commercialAt    -- ProductVersion- und CommissionModelVersion-
  //                      Aufloesung bleiben BEWUSST auf den Session-Start
  //                      gepinnt (fachliche Entscheidung, NICHT durch Phase 9
  //                      geaendert): eine automatische, stillschweigende
  //                      Umstellung auf ein neues Preis-/Provisionsmodell
  //                      waehrend einer laufenden Beratung koennte deren
  //                      Preis-/Provisionsstabilitaet beeintraechtigen. Eine
  //                      moegliche Umstellung auf Evaluation-Zeit ist eine
  //                      eigenstaendige fachliche Entscheidung und bewusst
  //                      zurueckgestellt (siehe docs/DECISION_LOG.md,
  //                      Abschnitt "Phase 9 AP9").
  const questionnaireAt: Date = session.startedAt;
  const ruleSetAt: Date = new Date();
  const commercialAt: Date = session.startedAt;

  const nodes = await loadQuestionNodesAtTime(db, session.questionnaireVersionId, questionnaireAt);
  const { answers, answerIdByQuestionId, rawByQuestionId } = await loadActiveAnswers(
    db,
    session.id,
  );

  const visiblePath = computeVisiblePath(nodes, answers);
  const progress = computeProgress(visiblePath);
  if (!progress.canComplete) {
    throw new InsufficientAnswerDataError(progress.missingRequiredQuestionIds);
  }

  const ruleSetVersion = await loadActiveRuleSetVersion(db, ruleSetAt);
  if (!ruleSetVersion) {
    throw new RuleSetNotConfiguredError(tenantId, ruleSetAt);
  }

  const [eligibilityRules, exclusionRules, prioritizationRules, crossSellingRules] =
    await Promise.all([
      loadEligibilityRules(db, ruleSetVersion.id),
      loadExclusionRules(db, ruleSetVersion.id),
      loadPrioritizationRules(db, ruleSetVersion.id),
      loadCrossSellingRules(db, ruleSetVersion.id),
    ]);

  const productCandidates = await loadProductCandidates(db, commercialAt);
  if (productCandidates.length === 0) {
    throw new NoValidProductVersionError(tenantId, commercialAt);
  }

  const commissionRows = await loadActiveCommissionModelVersions(db, commercialAt);
  const resolveCommission = buildResolveCommission(commissionRows);

  const sessionAttributes = buildSessionAttributes(session);

  const evaluatedItems: EvaluatedProductItem[] = productCandidates.map((candidate) => {
    const evalContext = {
      answersByQuestionId: answers,
      productAttributes: candidate.attributes,
      sessionAttributes,
    };

    const eligibilityMatches = evaluateEligibilityRuleMatches(eligibilityRules, evalContext);
    const eligibilityResult = computeEligibilityResult(eligibilityMatches);
    const customerFitScore = computeCustomerFitScore(eligibilityMatches);
    const exclusionResult = evaluateExclusionRules(exclusionRules, evalContext);
    const prioritizationResult = evaluatePrioritizationRules(
      prioritizationRules,
      candidate.productId,
      evalContext,
      resolveCommission,
    );

    const eligibilityPassed =
      eligibilityResult.eligibilityPassed && exclusionResult.exclusionReasonCodes.length === 0;

    return {
      productVersionId: candidate.productVersionId,
      monthlyPriceMinor: candidate.monthlyPriceMinor,
      businessPriorityScore: prioritizationResult.businessPriorityScore,
      customerFitScore,
      eligibilityPassed,
      exclusionReasonCodes: exclusionResult.exclusionReasonCodes,
      rationales: [
        ...eligibilityResult.rationales,
        ...exclusionResult.rationales,
        ...prioritizationResult.rationales,
      ],
    };
  });

  const rankedItems = assignPriorityRanks(evaluatedItems);

  const crossSellingContext: CrossSellingEvaluationContext = {
    answersByQuestionId: answers,
    answerIdByQuestionId,
    sessionAttributes,
  };
  const crossSellingSignals = evaluateCrossSellingRules(
    crossSellingRules,
    ruleSetVersion.id,
    crossSellingContext,
  );

  // Fingerprint-answerId ist bewusst die stabile questionId (Map-Key), NICHT
  // CustomerAnswer.id - siehe Modulkommentar ("Fingerprint-answerId").
  const fingerprintAnswers: FingerprintAnswerInput[] = [...rawByQuestionId.entries()].map(
    ([questionId, row]) => ({
      answerId: questionId,
      answerType: row.answerType,
      booleanValue: row.booleanValue,
      integerValue: row.integerValue,
      decimalValue: row.decimalValue !== null ? row.decimalValue.toString() : null,
      dateValue: row.dateValue ? row.dateValue.toISOString() : null,
      choiceValues: row.choiceValues,
    }),
  );
  const fingerprintProductInputs: FingerprintProductInput[] = productCandidates.map((c) => ({
    productVersionId: c.productVersionId,
    attributes: c.attributes,
  }));

  const fingerprintInput: FingerprintInput = {
    algorithmVersion: RECOMMENDATION_ALGORITHM_VERSION,
    tenantId,
    sessionId: session.id,
    questionnaireVersionId: session.questionnaireVersionId,
    ruleSetVersionId: ruleSetVersion.id,
    answers: fingerprintAnswers,
    productInputs: fingerprintProductInputs,
    sessionAttributes,
    // Tenant-weit zum Auswertungszeitpunkt gueltige Versionen (nicht nur die
    // deterministisch aufgeloeste Teilmenge), siehe fingerprint.ts.
    commissionModelVersionIds: commissionRows.map((r) => r.id),
  };
  const evaluationFingerprint = computeEvaluationFingerprint(fingerprintInput);

  // Fast-Path: existiert bereits eine Recommendation mit identischem
  // Fingerprint fuer diese Session, wird sie unveraendert zurueckgegeben -
  // KEINE erneute SalesOpportunity-Erzeugung auf diesem Pfad (siehe
  // Modulkommentar).
  const existing = await db.recommendation.findFirst({
    where: { consultationSessionId: session.id, evaluationFingerprint },
  });
  if (existing) {
    return loadRecommendationResult(db, existing.id);
  }

  const generatedAt = new Date();

  let writeResult: {
    recommendationId: string;
    createdSignals: {
      id: string;
      reasonCode: string;
      justificationParams: unknown;
      priority: number;
    }[];
  };
  try {
    writeResult = await db.$transaction(async (tx) => {
      const recommendation = await tx.recommendation.create({
        data: {
          tenantId,
          consultationSessionId: session.id,
          ruleSetVersionId: ruleSetVersion.id,
          algorithmVersion: RECOMMENDATION_ALGORITHM_VERSION,
          evaluationFingerprint,
          generatedAt,
        },
      });

      for (const item of rankedItems) {
        const createdItem = await tx.recommendationItem.create({
          data: {
            tenantId,
            recommendationId: recommendation.id,
            productVersionId: item.productVersionId,
            eligibilityPassed: item.eligibilityPassed,
            exclusionReasonCodes: item.exclusionReasonCodes,
            customerFitScore: item.customerFitScore,
            businessPriorityScore: item.businessPriorityScore,
            priorityRank: item.priorityRank,
          },
        });

        for (const rationale of item.rationales) {
          await tx.recommendationRationale.create({
            data: {
              tenantId,
              recommendationItemId: createdItem.id,
              factorKey: rationale.factorKey,
              factorValue: rationale.factorValue,
              weight: rationale.weight ?? null,
              commissionModelVersionId: rationale.commissionModelVersionId ?? null,
              commissionValueMinor: rationale.commissionValueMinor ?? null,
            },
          });
        }
      }

      const createdSignals: {
        id: string;
        reasonCode: string;
        justificationParams: unknown;
        priority: number;
      }[] = [];
      for (const signal of crossSellingSignals) {
        const createdSignal = await tx.recommendationCrossSellingSignal.create({
          data: {
            tenantId,
            recommendationId: recommendation.id,
            triggerRuleId: signal.triggerRuleId,
            triggerRuleSetVersionId: signal.triggerRuleSetVersionId,
            sourceAnswerId: signal.sourceAnswerId,
            needType: signal.needType,
            reasonCode: signal.reasonCode,
            justificationParams: toInputJson(signal.justificationParams),
            priority: signal.priority,
            suggestedProductVersionId: signal.suggestedProductVersionId,
          },
        });
        createdSignals.push({
          id: createdSignal.id,
          reasonCode: createdSignal.reasonCode,
          justificationParams: createdSignal.justificationParams,
          priority: createdSignal.priority,
        });
      }

      await tx.analyticsEvent.create({
        data: {
          tenantId,
          storeId: session.storeId,
          employeeId: session.employeeId,
          eventType: "RECOMMENDATION_GENERATED",
          occurredAt: generatedAt,
          payload: {
            consultationSessionId: session.id,
            recommendationId: recommendation.id,
            ruleSetVersionId: ruleSetVersion.id,
            itemCount: rankedItems.length,
            eligibleItemCount: rankedItems.filter((i) => i.eligibilityPassed).length,
            crossSellingSignalCount: createdSignals.length,
          },
        },
      });

      return { recommendationId: recommendation.id, createdSignals };
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      const recovered = await db.recommendation.findFirst({
        where: { consultationSessionId: session.id, evaluationFingerprint },
      });
      if (!recovered) {
        throw new RecommendationConsistencyError(session.id, evaluationFingerprint);
      }
      // Recovery-Pfad: KEINE erneute SalesOpportunity-Erzeugung (siehe
      // Modulkommentar) - die urspruenglich erfolgreiche, konkurrierende
      // Schreib-Transaktion hat dies bereits erledigt.
      return loadRecommendationResult(db, recovered.id);
    }
    throw err;
  }

  // Einzig hier (frisch geschriebene Recommendation) werden SalesOpportunity-
  // Zeilen aus den Cross-Selling-Signalen erzeugt - siehe Modulkommentar.
  await createSalesOpportunitiesForSignals(tenantId, session.id, writeResult.createdSignals);

  return loadRecommendationResult(db, writeResult.recommendationId);
}

// ---------------------------------------------------------------------------
// getLatestRecommendation() - reiner Lesezugriff
// ---------------------------------------------------------------------------

/** Reiner Lesezugriff: liefert die zuletzt erzeugte Recommendation einer Session (jeder Status) oder null, falls noch keine existiert. */
export async function getLatestRecommendation(
  consultationSessionId: string,
): Promise<RecommendationResult | null> {
  await requireSession(consultationSessionId);

  const latest = await db.recommendation.findFirst({
    where: { consultationSessionId },
    orderBy: [{ generatedAt: "desc" }, { id: "desc" }],
  });
  if (!latest) return null;

  return loadRecommendationResult(db, latest.id);
}
