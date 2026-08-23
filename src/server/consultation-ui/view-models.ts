/**
 * Duenne, rein lesende Adapter-Schicht fuer die Beratungs-UI (AP4/AP6).
 * Enthaelt AUSSCHLIESSLICH Komposition/Uebersetzung bestehender Daten --
 * keine neue Fachlogik (siehe PHASE_5_IMPLEMENTATION_PLAN.md Abschnitt 3,
 * Modulkommentar zu `src/server/consultation-ui/`). Nutzt den
 * mandantengescopten Client (`db`), muss also innerhalb eines
 * `TenantContext` aufgerufen werden.
 */

import type { NeedType, OpportunityStatus, RecommendationOutcomeType } from "@prisma/client";
import { db } from "../db/client";
import { getLatestRecommendation, type RecommendationResult } from "../recommendation/service";
import { loadQuestionnaireState } from "../questionnaire/service";
import type { QuestionnaireRunStatus } from "../questionnaire/types";
import { translateRationale } from "./rationale-translation";
import { formatAnswerValue } from "./answer-formatting";

export interface ActiveQuestionnaireSummary {
  questionnaireKey: string;
  /** `QuestionnaireVersion.label` -- `Questionnaire` selbst hat kein eigenes Anzeigefeld. */
  label: string;
}

/**
 * Listet alle Fragebogen, fuer die aktuell (Standard: jetzt) eine gueltige,
 * ACTIVE `QuestionnaireVersion` existiert -- Grundlage fuer die
 * Fragebogen-Auswahl auf der Einstiegsseite. Da pro `Questionnaire` zu jedem
 * Zeitpunkt hoechstens eine ACTIVE Version existieren kann (siehe
 * PostgreSQL-Exclusion-Constraint aus Phase 3A), ist die Map-Deduplizierung
 * hier rein defensiv.
 */
export async function listActiveQuestionnaires(
  atTime: Date = new Date(),
): Promise<ActiveQuestionnaireSummary[]> {
  const versions = await db.questionnaireVersion.findMany({
    where: {
      status: "ACTIVE",
      validFrom: { lte: atTime },
      OR: [{ validTo: null }, { validTo: { gt: atTime } }],
    },
    include: { questionnaire: { select: { key: true } } },
    orderBy: { validFrom: "desc" },
  });

  const byKey = new Map<string, ActiveQuestionnaireSummary>();
  for (const version of versions) {
    if (!byKey.has(version.questionnaire.key)) {
      byKey.set(version.questionnaire.key, {
        questionnaireKey: version.questionnaire.key,
        label: version.label,
      });
    }
  }
  return [...byKey.values()];
}

export interface InProgressSessionSummary {
  id: string;
  questionnaireKey: string;
  questionnaireLabel: string;
  consultationType: "NEW_CONTRACT" | "RENEWAL";
  /** ISO-8601 (UTC). */
  startedAt: string;
}

/**
 * Listet die noch nicht abgeschlossenen (`status = IN_PROGRESS`) Beratungs-
 * Sitzungen eines Mitarbeiters -- Grundlage fuer "laufende Beratung
 * fortsetzen" auf der Einstiegsseite. Bewusst nach `employeeId` gefiltert
 * (nicht nur `tenantId`): ohne Rollenpruefung (siehe Stop-Punkt 1) soll ein
 * Mitarbeiter zumindest auf der Uebersichtsseite nur die eigenen laufenden
 * Sitzungen sehen, auch wenn ein direkter Link auf eine fremde Sitzungs-ID
 * (mangels RBAC) aktuell nicht zusaetzlich blockiert wird.
 */
export async function listInProgressSessionsForEmployee(
  employeeId: string,
): Promise<InProgressSessionSummary[]> {
  const sessions = await db.consultationSession.findMany({
    where: { employeeId, status: "IN_PROGRESS" },
    include: { questionnaireVersion: { include: { questionnaire: { select: { key: true } } } } },
    orderBy: { startedAt: "desc" },
  });

  return sessions.map((session) => ({
    id: session.id,
    questionnaireKey: session.questionnaireVersion.questionnaire.key,
    questionnaireLabel: session.questionnaireVersion.label,
    consultationType: session.consultationType as "NEW_CONTRACT" | "RENEWAL",
    startedAt: session.startedAt.toISOString(),
  }));
}

// ---------------------------------------------------------------------------
// AP6 -- Empfehlungs-/Begruendungs-UI (PHASE_5_IMPLEMENTATION_PLAN.md
// Abschnitt 7 + Abschnitt 16, Punkt 6)
// ---------------------------------------------------------------------------

export interface ProductVersionSummary {
  id: string;
  /** `Product.name` -- `ProductVersion` selbst hat keine eigene Bezeichnung. */
  productName: string;
  /** ISO-4217, z. B. "EUR" (`ProductVersion.currency`). */
  currency: string;
  monthlyPriceMinor: number | null;
  oneTimePriceMinor: number | null;
  contractMonths: number | null;
  /** Ausschliesslich in `TariffAttribute` gespeicherte Eigenschaften -- keine abgeleiteten/erfundenen Werte. */
  attributes: { key: string; value: string }[];
}

const FALLBACK_PRODUCT_VERSION_SUMMARY: Omit<ProductVersionSummary, "id"> = {
  productName: "Unbekannter Tarif",
  currency: "EUR",
  monthlyPriceMinor: null,
  oneTimePriceMinor: null,
  contractMonths: null,
  attributes: [],
};

/**
 * Einfacher Lookup ueber `productVersionId` (Plan Abschnitt 7: "noch zu
 * ergaenzender einfacher Lookup, keine neue Fachlogik"). Der Fallback greift
 * praktisch nie (FK-Integritaet zwischen `RecommendationItem.productVersionId`
 * und `ProductVersion.id`), ist aber bewusst defensiv statt eines
 * ungefangenen Fehlers -- analog zum Fallback-Muster in
 * `rationale-translation.ts`.
 */
async function loadProductVersionSummaries(
  productVersionIds: string[],
): Promise<Map<string, ProductVersionSummary>> {
  if (productVersionIds.length === 0) {
    return new Map();
  }
  const rows = await db.productVersion.findMany({
    where: { id: { in: productVersionIds } },
    include: { product: { select: { name: true } }, tariffAttributes: true },
  });

  const byId = new Map<string, ProductVersionSummary>();
  for (const row of rows) {
    byId.set(row.id, {
      id: row.id,
      productName: row.product.name,
      currency: row.currency,
      monthlyPriceMinor: row.monthlyPriceMinor,
      oneTimePriceMinor: row.oneTimePriceMinor,
      contractMonths: row.contractMonths,
      attributes: row.tariffAttributes.map((a) => ({
        key: a.attributeKey,
        value: a.attributeValue,
      })),
    });
  }

  for (const id of productVersionIds) {
    if (!byId.has(id)) {
      console.warn(
        `[consultation-ui] ProductVersion "${id}" nicht gefunden (referenziert von einer Recommendation) -- Fallback-Anzeige wird verwendet.`,
      );
      byId.set(id, { id, ...FALLBACK_PRODUCT_VERSION_SUMMARY });
    }
  }
  return byId;
}

export type CustomerFitCategory = "hoch" | "mittel" | "niedrig";

/**
 * Grobe Kategorisierung des 0-100-Scores fuer die Mitarbeiter-UI (Plan
 * Abschnitt 7: "customerFitScore sichtbar als grobe Kategorie ... statt
 * Rohzahl"). Schwellenwerte sind eine dokumentierte Implementierungs-
 * Annahme (>=70 hoch, 40-69 mittel, <40 niedrig), keine Fachvorgabe aus der
 * Empfehlungs-Engine.
 */
function bandCustomerFitScore(score: number): CustomerFitCategory {
  if (score >= 70) return "hoch";
  if (score >= 40) return "mittel";
  return "niedrig";
}

const CUSTOMER_FIT_LABELS: Record<CustomerFitCategory, string> = {
  hoch: "Hohe Eignung",
  mittel: "Mittlere Eignung",
  niedrig: "Niedrige Eignung",
};

export interface ConsultationRecommendationItemView {
  id: string;
  priorityRank: number;
  product: ProductVersionSummary;
  customerFitCategory: CustomerFitCategory;
  customerFitLabel: string;
  /** Uebersetzte Texte zu erfuellten (`matched`) Eignungskriterien -- eigener Abschnitt in der Begruendungsansicht (Plan Abschnitt 7). */
  positiveEligibilityReasons: string[];
  /**
   * Uebersetzte Texte zu NICHT erfuellten, aber nicht ausschlaggebenden
   * (`isRequired = false`) Eignungskriterien. Kommt nur bei Items vor, die
   * trotzdem `eligibilityPassed` sind (weiche Kriterien fliessen nur in
   * `customerFitScore` ein, siehe `eligibility.ts`) -- daher bewusst ein
   * eigener, von "Ausschlussgruenden" getrennter Abschnitt (keine
   * Vermischung, Plan Abschnitt 7).
   */
  unmetSoftEligibilityCriteria: string[];
  /** `null`, solange fuer dieses Item noch kein RecommendationOutcome existiert (Plan Abschnitt 8, AP7). */
  outcome: RecommendationOutcomeSummary | null;
}

export interface ConsultationRecommendationView {
  id: string;
  consultationSessionId: string;
  /** ISO-8601 (UTC). */
  generatedAt: string;
  items: ConsultationRecommendationItemView[];
  /** Aktive, mandantengepflegte Ablehnungsgruende fuer `OutcomeDialog` (Plan Abschnitt 8, AP7). */
  rejectionReasons: RejectionReasonOption[];
  /** Cross-Selling-Hinweise samt SalesOpportunity-Status fuer `CrossSellingBanner` (Plan Abschnitt 9, AP8). */
  crossSellingSignals: ConsultationCrossSellingSignalView[];
}

/**
 * Baut das Mitarbeiter-facing Empfehlungs-Read-Model aus einem bereits
 * geladenen `RecommendationResult` (Plan Abschnitt 7). Reine Komposition:
 * `RecommendationResult` wird nicht veraendert, nur gefiltert/uebersetzt.
 *
 * Bewusste Filterungen (Plan Abschnitt 2.2/7, keine neue Fachlogik, nur
 * UI-Sichtbarkeit):
 * - Nur `eligibilityPassed === true` Items erscheinen in der Hauptliste.
 *   `evaluate()` persistiert bewusst ALLE Kandidaten (auch ungeeignete) als
 *   `RecommendationItem`-Zeilen (siehe `service.ts::evaluate()`); die
 *   Mitarbeiter-Hauptansicht soll aber nur tatsaechlich empfehlbare Tarife
 *   zeigen (kein Sinn, ungeeignete Tarife samt Ausschlussgruenden aktiv zu
 *   bewerben).
 * - Nur `eligibility:*`-Rationale-Eintraege werden uebersetzt/angezeigt.
 *   `prioritization:*` und `commission_model_unresolved` transportieren
 *   `businessPriorityScore`-/Provisions-Herkunft und werden gemaess Plan
 *   Abschnitt 7 ("businessPriorityScore und Provisions-/Margendaten werden
 *   NICHT in der Mitarbeiter-UI angezeigt") vollstaendig herausgefiltert,
 *   nicht nur unuebersetzt gelassen.
 */
export async function buildConsultationRecommendationView(
  recommendation: RecommendationResult,
): Promise<ConsultationRecommendationView> {
  const eligibleItems = recommendation.items.filter((item) => item.eligibilityPassed);
  const suggestedProductVersionIds = recommendation.crossSellingSignals
    .map((signal) => signal.suggestedProductVersionId)
    .filter((id): id is string => id != null);
  const productVersionIds = [
    ...new Set([
      ...eligibleItems.map((item) => item.productVersionId),
      ...suggestedProductVersionIds,
    ]),
  ];
  const [productSummaries, outcomesByItemId, rejectionReasons, opportunitiesBySignalId] =
    await Promise.all([
      loadProductVersionSummaries(productVersionIds),
      loadOutcomesByItemIds(eligibleItems.map((item) => item.id)),
      loadActiveRejectionReasons(),
      loadSalesOpportunitiesBySignalIds(recommendation.crossSellingSignals.map((s) => s.id)),
    ]);

  const items: ConsultationRecommendationItemView[] = eligibleItems.map((item) => {
    const positiveEligibilityReasons: string[] = [];
    const unmetSoftEligibilityCriteria: string[] = [];
    for (const rationale of item.rationales) {
      if (!rationale.factorKey.startsWith("eligibility:")) {
        continue;
      }
      const text = translateRationale(rationale.factorKey, rationale.factorValue);
      if (rationale.factorValue === "matched") {
        positiveEligibilityReasons.push(text);
      } else {
        unmetSoftEligibilityCriteria.push(text);
      }
    }

    const customerFitCategory = bandCustomerFitScore(item.customerFitScore);

    return {
      id: item.id,
      priorityRank: item.priorityRank,
      product: productSummaries.get(item.productVersionId) ?? {
        id: item.productVersionId,
        ...FALLBACK_PRODUCT_VERSION_SUMMARY,
      },
      customerFitCategory,
      customerFitLabel: CUSTOMER_FIT_LABELS[customerFitCategory],
      positiveEligibilityReasons,
      unmetSoftEligibilityCriteria,
      outcome: outcomesByItemId.get(item.id) ?? null,
    };
  });

  const crossSellingSignals: ConsultationCrossSellingSignalView[] =
    recommendation.crossSellingSignals.map((signal) => ({
      id: signal.id,
      needType: signal.needType,
      needLabel: NEED_TYPE_LABELS[signal.needType] ?? signal.needType,
      reasonText: translateRationale(`cross_selling:${signal.reasonCode}`, signal.needType),
      priority: signal.priority,
      suggestedProduct: signal.suggestedProductVersionId
        ? (productSummaries.get(signal.suggestedProductVersionId) ?? {
            id: signal.suggestedProductVersionId,
            ...FALLBACK_PRODUCT_VERSION_SUMMARY,
          })
        : null,
      opportunity: opportunitiesBySignalId.get(signal.id) ?? null,
    }));

  return {
    id: recommendation.id,
    consultationSessionId: recommendation.consultationSessionId,
    generatedAt: recommendation.generatedAt,
    items,
    rejectionReasons,
    crossSellingSignals,
  };
}

// ---------------------------------------------------------------------------
// AP7 -- Ablehnungs-/Aenderungsflow-UI (PHASE_5_IMPLEMENTATION_PLAN.md
// Abschnitt 8 + Abschnitt 16, Punkt 7)
// ---------------------------------------------------------------------------

export interface RecommendationOutcomeSummary {
  outcome: RecommendationOutcomeType;
  /** ISO-8601 (UTC). */
  decidedAt: string;
}

/**
 * Einfacher Lookup bereits gespeicherter `RecommendationOutcome`-Zeilen fuer
 * eine Menge von `RecommendationItem`-IDs (Plan Abschnitt 8: die UI muss pro
 * Karte wissen, ob bereits entschieden wurde, um Annehmen/Ablehnen/
 * Zurueckstellen durch eine "bereits entschieden am ..."-Anzeige zu
 * ersetzen). `RecommendationItemResult` (`service.ts`, Kernlogik aus Phase
 * 3B) enthaelt dieses Feld bewusst NICHT -- Aenderungen an dieser Kernlogik
 * sind laut Plan Abschnitt 6 untersagt, daher hier als separater, rein
 * lesender Adapter-Lookup (analog `loadProductVersionSummaries()`), nicht
 * als Erweiterung von `RecommendationItemResult`.
 */
async function loadOutcomesByItemIds(
  recommendationItemIds: string[],
): Promise<Map<string, RecommendationOutcomeSummary>> {
  if (recommendationItemIds.length === 0) {
    return new Map();
  }
  const rows = await db.recommendationOutcome.findMany({
    where: { recommendationItemId: { in: recommendationItemIds } },
  });
  const byItemId = new Map<string, RecommendationOutcomeSummary>();
  for (const row of rows) {
    byItemId.set(row.recommendationItemId, {
      outcome: row.outcome,
      decidedAt: row.decidedAt.toISOString(),
    });
  }
  return byItemId;
}

export interface RejectionReasonOption {
  id: string;
  key: string;
  label: string;
}

/**
 * Listet die aktiven, mandantengepflegten Ablehnungsgruende (Plan Abschnitt
 * 8: "strukturierte Ablehnungsgruende aus RejectionReason ... isActive-
 * gefiltert"). Einfacher Lookup, keine neue Fachlogik.
 */
async function loadActiveRejectionReasons(): Promise<RejectionReasonOption[]> {
  const rows = await db.rejectionReason.findMany({
    where: { isActive: true },
    orderBy: { label: "asc" },
  });
  return rows.map((row) => ({ id: row.id, key: row.key, label: row.label }));
}

/**
 * Reiner Status-Lookup fuer den "Angaben aendern"-Button (Plan Abschnitt 8:
 * nur sichtbar/aktiv, solange die Sitzung noch `IN_PROGRESS` ist). Bewusst
 * NUR das Statusfeld, nicht die vollstaendige `loadQuestionnaireState()`
 * (die zusaetzlich alle Fragen/Antworten laedt -- hier nicht benoetigt und
 * unnoetig teuer fuer eine reine Sichtbarkeitsentscheidung).
 */
export async function loadConsultationSessionStatus(
  consultationSessionId: string,
): Promise<"IN_PROGRESS" | "COMPLETED" | "ABANDONED" | null> {
  const session = await db.consultationSession.findUnique({
    where: { id: consultationSessionId },
    select: { status: true },
  });
  return session?.status ?? null;
}

// ---------------------------------------------------------------------------
// AP8 -- Cross-Selling-UI (PHASE_5_IMPLEMENTATION_PLAN.md Abschnitt 9 +
// Abschnitt 16, Punkt 8)
// ---------------------------------------------------------------------------

/** Deutsche Anzeigenamen fuer `NeedType` (fester, im Prisma-Schema enumerierter Wertebereich -- kein tenant-gepflegter Schluessel wie bei factorKey/reasonCode). */
const NEED_TYPE_LABELS: Record<NeedType, string> = {
  PARTNER_CARD: "Partnerkarte",
  FAMILY: "Familie",
  YOUNG: "Junge Kunden",
  DSL: "DSL",
  FIBER: "Glasfaser",
  STREAMING: "Streaming",
  ACCESSORY: "Zubehoer",
  DEVICE_PROTECTION: "Geraeteschutz",
  OTHER: "Sonstiges",
};

export interface SalesOpportunityStatusSummary {
  id: string;
  status: OpportunityStatus;
  /** ISO-8601 (UTC) oder `null`, solange noch kein `OFFERED` gesetzt wurde. */
  offeredAt: string | null;
  /** ISO-8601 (UTC) oder `null`, solange noch kein terminaler Zustand (ACCEPTED/DECLINED) erreicht wurde. */
  resolvedAt: string | null;
}

export interface ConsultationCrossSellingSignalView {
  /** `RecommendationCrossSellingSignal.id` -- nur zur React-`key`-Nutzung, kein Schreibziel (Signal ist append-only, siehe service.ts). */
  id: string;
  needType: NeedType;
  needLabel: string;
  /** Uebersetzter `reasonCode` (siehe `rationale-translation.ts`, `cross_selling:`-Praefix). */
  reasonText: string;
  priority: number;
  suggestedProduct: ProductVersionSummary | null;
  /**
   * `null` nur im praktisch nicht auftretenden Randfall, dass die
   * SalesOpportunity-Erzeugung nach der Recommendation-Transaktion
   * fehlgeschlagen ist (siehe service.ts::evaluate(), Kommentar "Einzig
   * hier..."). `OpportunityCard` zeigt dann einen Hinweis statt Buttons.
   */
  opportunity: SalesOpportunityStatusSummary | null;
}

/**
 * Einfacher Lookup der zu einer Menge von `RecommendationCrossSellingSignal`-
 * IDs gehoerigen `SalesOpportunity`-Zeilen ueber `triggerSignalId` (siehe
 * `sales-opportunity.ts::buildSalesOpportunityFromSignal()`). Analog
 * `loadOutcomesByItemIds()` -- reiner lesender Adapter, keine neue Fachlogik.
 */
async function loadSalesOpportunitiesBySignalIds(
  signalIds: string[],
): Promise<Map<string, SalesOpportunityStatusSummary>> {
  if (signalIds.length === 0) {
    return new Map();
  }
  const rows = await db.salesOpportunity.findMany({
    where: { triggerSignalId: { in: signalIds } },
  });
  const bySignalId = new Map<string, SalesOpportunityStatusSummary>();
  for (const row of rows) {
    if (row.triggerSignalId == null) {
      continue;
    }
    bySignalId.set(row.triggerSignalId, {
      id: row.id,
      status: row.status,
      offeredAt: row.offeredAt ? row.offeredAt.toISOString() : null,
      resolvedAt: row.resolvedAt ? row.resolvedAt.toISOString() : null,
    });
  }
  return bySignalId;
}

// ---------------------------------------------------------------------------
// AP9 -- Zusammenfassungsseite (PHASE_5_IMPLEMENTATION_PLAN.md Abschnitt 5,
// Schritt 10 + Abschnitt 16, Punkt 9)
// ---------------------------------------------------------------------------

export interface AnsweredQuestionSummary {
  questionId: string;
  label: string;
  /**
   * Menschenlesbare Anzeige des aktuell aktiven Antwortwerts (Auswahl-Keys
   * bereits auf `AnswerOption.label` aufgeloest, Datum lokalisiert). "Nicht
   * beantwortet" sowohl fuer nie beantwortete als auch fuer durch spaetere
   * Aenderungen deaktivierte Fragen (`currentAnswer === null`, siehe
   * `QuestionForAnswering`) -- reine Anzeigelogik, keine neue Fachlogik.
   */
  formattedValue: string;
}

export interface DealItemSummary {
  productVersionId: string;
  productName: string;
  quantity: number;
}

/**
 * Read-Model eines bereits abgeschlossenen Deals (Phase 6 AP5). Enthaelt
 * BEWUSST NICHT `commissionAmountMinor`/`contributionMarginMinor` (interne
 * Provisions-/Margendaten) -- analog zur bestehenden Regel "businessPriorityScore
 * und Provisions-/Margendaten werden NICHT in der Mitarbeiter-UI angezeigt"
 * (siehe Modulkommentar zu `buildConsultationRecommendationView()`). Nur
 * kundenbezogene Umsatzzahlen sind fuer den Mitarbeiter relevant/sichtbar.
 */
export interface DealSummary {
  id: string;
  /** ISO-8601 (UTC). */
  closedAt: string;
  currency: string;
  items: DealItemSummary[];
  monthlyRecurringRevenueMinor: number;
  oneTimeRevenueMinor: number;
  totalContractValueMinor: number;
}

/**
 * Kandidat fuer die Deal-Erfassungsmaske: ein ProductVersion aus einer
 * ANGENOMMENEN (`RecommendationOutcome.outcome === "ACCEPTED"`) Empfehlung
 * dieser Sitzung (Plan Abschnitt 3.1: "Vorauswahl aus RecommendationOutcome-
 * Eintraegen mit ACCEPTED"). Reine Vorschlagsliste -- der Mitarbeiter
 * bestaetigt Menge/Produkt im Formular, `closeDeal()` selbst validiert die
 * tatsaechlich gesendeten `productVersionId`s unabhaengig davon erneut.
 */
export interface DealClosureCandidateItem {
  productVersionId: string;
  productName: string;
  currency: string;
  monthlyPriceMinor: number | null;
  oneTimePriceMinor: number | null;
}

/**
 * Laedt den (hoechstens einen, siehe `DealAlreadyExistsForSessionError`)
 * Deal einer Sitzung samt Positionen. Reiner lesender Adapter, analog
 * `loadOutcomesByItemIds()`/`loadSalesOpportunitiesBySignalIds()`.
 */
async function loadDealForSession(consultationSessionId: string): Promise<DealSummary | null> {
  const deal = await db.deal.findFirst({
    where: { consultationSessionId },
    include: {
      items: { include: { productVersion: { include: { product: { select: { name: true } } } } } },
      financialSnapshot: true,
    },
  });
  if (!deal || !deal.financialSnapshot) {
    return null;
  }
  return {
    id: deal.id,
    closedAt: deal.closedAt.toISOString(),
    currency: deal.currency,
    items: deal.items.map((item) => ({
      productVersionId: item.productVersionId,
      productName: item.productVersion.product.name,
      quantity: item.quantity,
    })),
    monthlyRecurringRevenueMinor: deal.financialSnapshot.monthlyRecurringRevenueMinor,
    oneTimeRevenueMinor: deal.financialSnapshot.oneTimeRevenueMinor,
    totalContractValueMinor: deal.financialSnapshot.totalContractValueMinor,
  };
}

export interface ConsultationSessionSummaryView {
  consultationSessionId: string;
  status: QuestionnaireRunStatus;
  answeredQuestions: AnsweredQuestionSummary[];
  /** `null`, solange fuer diese Sitzung noch keine Recommendation erzeugt wurde. */
  recommendation: ConsultationRecommendationView | null;
  /** `null`, solange fuer diese Sitzung noch kein Deal erfasst wurde (Phase 6 AP5). */
  deal: DealSummary | null;
  /**
   * Vorschlagsliste fuer die Deal-Erfassungsmaske (Phase 6 AP5) -- leer,
   * solange `deal` bereits gesetzt ist (ein zweiter Abschluss ist in Phase 6
   * nicht vorgesehen, siehe `DealAlreadyExistsForSessionError`) oder noch
   * keine ANGENOMMENEN Empfehlungen vorliegen.
   */
  dealClosureCandidates: DealClosureCandidateItem[];
}

/**
 * Baut das Mitarbeiter-facing Zusammenfassungs-Read-Model (Plan Abschnitt
 * 2.2 Punkt 5, Abschnitt 5 Schritt 10): reine Komposition aus bereits
 * vorhandenen Bausteinen, keine neue Fachlogik.
 * - `loadQuestionnaireState()` liefert Status + alle sichtbaren Fragen samt
 *   aktueller Antwort (funktioniert unveraendert auch fuer bereits
 *   `COMPLETED`-Sessions, siehe `requireSession()` in
 *   `questionnaire/service.ts` -- keine Status-Einschraenkung dort).
 * - `getLatestRecommendation()` + das bereits bestehende (AP6/AP8)
 *   `buildConsultationRecommendationView()` liefern Empfehlung, Outcomes und
 *   Cross-Selling-Signale in einem Aufwasch -- keine Duplizierung dieser
 *   Logik.
 * - Die Formatierung der Antwortwerte selbst steckt bewusst NICHT hier,
 *   sondern in `answer-formatting.ts` (`formatAnswerValue()`) -- analog zu
 *   `rationale-translation.ts`: eigenstaendiges, DB-freies Modul fuer
 *   direkte Unit-Testbarkeit ohne Tenant-Kontext/Prisma-Mock.
 *
 * Schreibt bewusst NICHTS (insbesondere kein `CONSULTATION_COMPLETED`-
 * Analytics-Event) -- das ist laut Plan Abschnitt 16 Aufgabe von AP10, nicht
 * dieser rein lesenden Komposition.
 */
export async function buildConsultationSessionSummaryView(
  consultationSessionId: string,
): Promise<ConsultationSessionSummaryView> {
  const [questionnaireState, recommendation, deal] = await Promise.all([
    loadQuestionnaireState(consultationSessionId),
    getLatestRecommendation(consultationSessionId),
    loadDealForSession(consultationSessionId),
  ]);

  const recommendationView = recommendation
    ? await buildConsultationRecommendationView(recommendation)
    : null;

  // Phase 6 AP5: Vorauswahl fuer die Deal-Erfassungsmaske aus angenommenen
  // Empfehlungen -- nur relevant, solange noch kein Deal existiert (siehe
  // Modulkommentar zu `dealClosureCandidates`).
  const dealClosureCandidates: DealClosureCandidateItem[] =
    deal || !recommendationView
      ? []
      : recommendationView.items
          .filter((item) => item.outcome?.outcome === "ACCEPTED")
          .map((item) => ({
            productVersionId: item.product.id,
            productName: item.product.productName,
            currency: item.product.currency,
            monthlyPriceMinor: item.product.monthlyPriceMinor,
            oneTimePriceMinor: item.product.oneTimePriceMinor,
          }));

  return {
    consultationSessionId,
    status: questionnaireState.status,
    answeredQuestions: questionnaireState.visibleQuestions.map((question) => ({
      questionId: question.questionId,
      label: question.label,
      formattedValue: formatAnswerValue(question),
    })),
    recommendation: recommendationView,
    deal,
    dealClosureCandidates,
  };
}
