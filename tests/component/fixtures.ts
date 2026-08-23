/**
 * Gemeinsame Test-Fixtures fuer Komponententests (AP12). Baut ausschliesslich
 * synthetische Objekte in Speicher -- KEIN Datenbankzugriff, KEINE echten
 * Kunden-/Mitarbeiterdaten (siehe PRIVACY_AND_SECURITY.md, bindende
 * Synthetic-Data-Only-Vorgabe gilt sinngemaess auch fuer UI-Fixtures).
 *
 * Jede `buildX()`-Funktion liefert ein minimal-gueltiges Objekt mit
 * sinnvollen Defaults und erlaubt gezielte Ueberschreibung einzelner Felder
 * per `overrides`, um in den eigentlichen Tests nur die jeweils relevanten
 * Abweichungen sichtbar zu machen.
 */
import type { QuestionForAnswering, QuestionnaireState } from "@/server/questionnaire/service";
import type { QuestionnaireProgress } from "@/server/questionnaire/path";
import type { AiExtractionCandidate } from "@/server/ai-extraction/types";
import type {
  ConsultationRecommendationItemView,
  ConsultationRecommendationView,
  ConsultationCrossSellingSignalView,
  ConsultationSessionSummaryView,
  DealClosureCandidateItem,
  DealSummary,
  ProductVersionSummary,
  RejectionReasonOption,
  SalesOpportunityStatusSummary,
} from "@/server/consultation-ui/view-models";

export function buildProgress(
  overrides: Partial<QuestionnaireProgress> = {},
): QuestionnaireProgress {
  return {
    totalVisibleQuestions: 3,
    answeredVisibleQuestions: 1,
    requiredVisibleQuestions: 2,
    answeredRequiredVisibleQuestions: 1,
    percentComplete: 33,
    nextQuestionId: "question-2",
    missingRequiredQuestionIds: ["question-2"],
    canComplete: false,
    ...overrides,
  };
}

export function buildQuestion(overrides: Partial<QuestionForAnswering> = {}): QuestionForAnswering {
  return {
    questionId: "question-1",
    questionVersionId: "question-version-1",
    label: "Wie viele Personen nutzen den Anschluss?",
    answerType: "SINGLE_CHOICE",
    isRequired: true,
    sortOrder: 1,
    answerOptions: [
      { key: "one", label: "Eine Person" },
      { key: "family", label: "Familie" },
    ],
    minValue: null,
    maxValue: null,
    maxLength: null,
    minSelections: null,
    maxSelections: null,
    currentAnswer: null,
    currentAnswerVersion: null,
    ...overrides,
  };
}

export function buildQuestionnaireState(
  overrides: Partial<QuestionnaireState> = {},
): QuestionnaireState {
  return {
    consultationSessionId: "session-1",
    questionnaireVersionId: "questionnaire-version-1",
    status: "IN_PROGRESS",
    visibleQuestions: [buildQuestion()],
    progress: buildProgress(),
    ...overrides,
  };
}

export function buildProduct(
  overrides: Partial<ProductVersionSummary> = {},
): ProductVersionSummary {
  return {
    id: "product-version-1",
    productName: "Fiber 250",
    currency: "EUR",
    monthlyPriceMinor: 3990,
    oneTimePriceMinor: null,
    contractMonths: 24,
    attributes: [{ key: "Bandbreite", value: "250 MBit/s" }],
    ...overrides,
  };
}

export function buildRecommendationItem(
  overrides: Partial<ConsultationRecommendationItemView> = {},
): ConsultationRecommendationItemView {
  return {
    id: "recommendation-item-1",
    priorityRank: 1,
    product: buildProduct(),
    customerFitCategory: "hoch",
    customerFitLabel: "Hohe Passgenauigkeit",
    positiveEligibilityReasons: ["Haushaltsgroesse passt zum Tarif"],
    unmetSoftEligibilityCriteria: [],
    outcome: null,
    ...overrides,
  };
}

export function buildRejectionReason(
  overrides: Partial<RejectionReasonOption> = {},
): RejectionReasonOption {
  return {
    id: "rejection-reason-1",
    key: "TOO_EXPENSIVE",
    label: "Zu teuer",
    ...overrides,
  };
}

export function buildOpportunityStatus(
  overrides: Partial<SalesOpportunityStatusSummary> = {},
): SalesOpportunityStatusSummary {
  return {
    id: "opportunity-1",
    status: "OPEN",
    offeredAt: null,
    resolvedAt: null,
    ...overrides,
  };
}

export function buildCrossSellingSignal(
  overrides: Partial<ConsultationCrossSellingSignalView> = {},
): ConsultationCrossSellingSignalView {
  return {
    id: "signal-1",
    needType: "STREAMING",
    needLabel: "Streaming-Bedarf erkannt",
    reasonText: "Kunde nutzt mehrere Streaming-Dienste parallel.",
    priority: 1,
    suggestedProduct: buildProduct({ id: "product-version-2", productName: "Streaming-Paket" }),
    opportunity: buildOpportunityStatus(),
    ...overrides,
  };
}

export function buildRecommendationView(
  overrides: Partial<ConsultationRecommendationView> = {},
): ConsultationRecommendationView {
  return {
    id: "recommendation-1",
    consultationSessionId: "session-1",
    generatedAt: "2026-08-01T10:00:00.000Z",
    items: [buildRecommendationItem()],
    rejectionReasons: [buildRejectionReason()],
    crossSellingSignals: [],
    ...overrides,
  };
}

export function buildDealClosureCandidate(
  overrides: Partial<DealClosureCandidateItem> = {},
): DealClosureCandidateItem {
  return {
    productVersionId: "product-version-1",
    productName: "Fiber 250",
    currency: "EUR",
    monthlyPriceMinor: 3990,
    oneTimePriceMinor: null,
    ...overrides,
  };
}

export function buildDealSummary(overrides: Partial<DealSummary> = {}): DealSummary {
  return {
    id: "deal-1",
    closedAt: "2026-08-01T10:00:00.000Z",
    currency: "EUR",
    items: [{ productVersionId: "product-version-1", productName: "Fiber 250", quantity: 1 }],
    monthlyRecurringRevenueMinor: 3990,
    oneTimeRevenueMinor: 0,
    totalContractValueMinor: 3990,
    ...overrides,
  };
}

export function buildAiExtractionCandidate(
  overrides: Partial<AiExtractionCandidate> = {},
): AiExtractionCandidate {
  return {
    questionId: "question-1",
    answerType: "SINGLE_CHOICE",
    choiceValues: ["family"],
    ...overrides,
  };
}

export function buildSessionSummary(
  overrides: Partial<ConsultationSessionSummaryView> = {},
): ConsultationSessionSummaryView {
  return {
    consultationSessionId: "session-1",
    status: "COMPLETED",
    answeredQuestions: [
      {
        questionId: "question-1",
        label: "Wie viele Personen nutzen den Anschluss?",
        formattedValue: "Familie",
      },
    ],
    recommendation: buildRecommendationView(),
    deal: null,
    dealClosureCandidates: [],
    ...overrides,
  };
}
