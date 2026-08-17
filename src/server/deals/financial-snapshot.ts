/**
 * Berechnung des DealFinancialSnapshot (Phase 6 AP3, siehe
 * PHASE_6_IMPLEMENTATION_PLAN.md Abschnitt 12.3 fuer die verbindliche,
 * mit ChatGPT abgestimmte Formel-Version v1).
 *
 * Formula Version "v1" (wortwoertlich wie mit ChatGPT abgestimmt):
 *
 *   contributionMarginMinor =
 *       oneTimeRevenueMinor
 *     - hardwarePurchaseCostMinor
 *     - subsidyCostMinor
 *     - discountCostMinor        // immer 0 in v1, siehe unten
 *     - otherDirectCostMinor
 *
 * NUR der einmalige Umsatz/die einmaligen Kosten fliessen in v1 in den
 * Deckungsbeitrag ein. `monthlyRecurringRevenueMinor` wird separat
 * ausgewiesen, NICHT ueber eine angenommene Vertragslaufzeit in den
 * v1-Deckungsbeitrag eingerechnet (das waere ein "Expected Contract
 * Contribution" -- explizit einer spaeteren Formel-Version vorbehalten).
 *
 * `discountCostMinor` ist in v1 IMMER 0 -- keine manuelle Rabatt-Eingabe
 * durch den Mitarbeiter (ChatGPT-Vorgabe: ein frei eingebbares Kostenfeld
 * ohne definierte Quelle wuerde die KPI-Grundlage manipulierbar machen).
 * Eine echte Rabattfunktion mit definiertem Ursprung ist Formel-Version v2
 * vorbehalten.
 *
 * `totalContractValueMinor` (Schema-Feld) wird fuer v1 als reine Summe aus
 * einmaligem und (einem Monat) wiederkehrendem Umsatz interpretiert
 * (oneTimeRevenueMinor + monthlyRecurringRevenueMinor) -- NICHT als
 * projizierter Lebenszeitwert ueber die Vertragslaufzeit, konsistent mit
 * der ChatGPT-Vorgabe, in v1 keine Laufzeit-Projektion vorzunehmen.
 *
 * Provisionen (`commissionAmountMinor`/`expectedRecurringCommissionMinor`)
 * werden unabhaengig von der Margen-Formel ueber die wiederverwendete
 * Commission-Resolution (`src/server/pricing/commission.ts`) berechnet und
 * hier nur aufsummiert.
 */

import {
  computeCommissionAmountMinor,
  type CommissionModelVersionRow,
} from "../pricing/commission";

export interface DealItemPricing {
  productVersionId: string;
  productId: string;
  quantity: number;
  monthlyPriceMinor: number | null;
  oneTimePriceMinor: number | null;
}

export interface ProductCostRow {
  hardwarePurchaseCostMinor: number | null;
  subsidyCostMinor: number | null;
  otherDirectCostMinor: number | null;
}

export const CONTRIBUTION_MARGIN_FORMULA_VERSION = "v1";

export interface DealFinancialSnapshotResult {
  monthlyRecurringRevenueMinor: number;
  totalContractValueMinor: number;
  oneTimeRevenueMinor: number;
  commissionAmountMinor: number;
  expectedRecurringCommissionMinor: number;
  hardwarePurchaseCostMinor: number;
  subsidyCostMinor: number;
  discountCostMinor: number;
  otherDirectCostMinor: number;
  contributionMarginMinor: number;
  contributionMarginFormulaVersion: string;
}

/**
 * Reine Berechnungsfunktion (kein DB-Zugriff) -- nimmt bereits aufgeloeste
 * Preis-/Kosten-/Provisionsdaten je DealItem entgegen und aggregiert sie zu
 * einem DealFinancialSnapshot gemaess Formel v1.
 *
 * @param items DealItems mit aufgeloesten ProductVersion-Preisen.
 * @param costsByProductId ProductCostVersion-Zeile je `productId` (fehlender
 *   Eintrag wird als "keine Kostendaten" = 0 behandelt, kein Fehler -- nicht
 *   jedes Produkt muss zwingend eine ProductCostVersion besitzen).
 * @param commissionByProductId Aufgeloeste CommissionModelVersion je
 *   `productId` (analog `buildResolveCommission()`-Ergebnis), `null` falls
 *   fuer das Produkt kein aktives Provisionsmodell existiert.
 */
export function computeDealFinancialSnapshot(
  items: DealItemPricing[],
  costsByProductId: Map<string, ProductCostRow>,
  commissionByProductId: Map<string, CommissionModelVersionRow | null>,
): DealFinancialSnapshotResult {
  let monthlyRecurringRevenueMinor = 0;
  let oneTimeRevenueMinor = 0;
  let hardwarePurchaseCostMinor = 0;
  let subsidyCostMinor = 0;
  let otherDirectCostMinor = 0;
  let commissionAmountMinor = 0;
  let expectedRecurringCommissionMinor = 0;

  for (const item of items) {
    const itemMonthlyRevenue = (item.monthlyPriceMinor ?? 0) * item.quantity;
    const itemOneTimeRevenue = (item.oneTimePriceMinor ?? 0) * item.quantity;
    monthlyRecurringRevenueMinor += itemMonthlyRevenue;
    oneTimeRevenueMinor += itemOneTimeRevenue;

    const cost = costsByProductId.get(item.productId);
    if (cost) {
      hardwarePurchaseCostMinor += (cost.hardwarePurchaseCostMinor ?? 0) * item.quantity;
      subsidyCostMinor += (cost.subsidyCostMinor ?? 0) * item.quantity;
      otherDirectCostMinor += (cost.otherDirectCostMinor ?? 0) * item.quantity;
    }

    const commissionRow = commissionByProductId.get(item.productId) ?? null;
    if (commissionRow) {
      // Bewusst auf Basis der Stueckpreise (nicht itemOneTimeRevenue/
      // itemMonthlyRevenue, die bereits mit quantity skaliert sind) berechnet
      // und ERST DANACH einmalig mit quantity skaliert -- sonst wuerde bei
      // PERCENTAGE-Provisionsmodellen quantity doppelt eingerechnet (einmal
      // ueber die bereits skalierte Basis, einmal ueber die aeussere
      // Multiplikation). Bugfix waehrend AP3-Review, siehe PHASE_6_
      // IMPLEMENTATION_PLAN.md.
      const oneTimeCommissionPerUnit = computeCommissionAmountMinor(
        commissionRow,
        item.oneTimePriceMinor ?? 0,
        commissionRow.commissionAmountMinor,
      );
      const recurringCommissionPerUnit = computeCommissionAmountMinor(
        commissionRow,
        item.monthlyPriceMinor ?? 0,
        commissionRow.recurringCommissionAmountMinor,
      );
      commissionAmountMinor += (oneTimeCommissionPerUnit ?? 0) * item.quantity;
      expectedRecurringCommissionMinor += (recurringCommissionPerUnit ?? 0) * item.quantity;
    }
  }

  // v1: discountCostMinor ist immer 0 (siehe Modulkommentar).
  const discountCostMinor = 0;

  const contributionMarginMinor =
    oneTimeRevenueMinor -
    hardwarePurchaseCostMinor -
    subsidyCostMinor -
    discountCostMinor -
    otherDirectCostMinor;

  const totalContractValueMinor = oneTimeRevenueMinor + monthlyRecurringRevenueMinor;

  return {
    monthlyRecurringRevenueMinor,
    totalContractValueMinor,
    oneTimeRevenueMinor,
    commissionAmountMinor,
    expectedRecurringCommissionMinor,
    hardwarePurchaseCostMinor,
    subsidyCostMinor,
    discountCostMinor,
    otherDirectCostMinor,
    contributionMarginMinor,
    contributionMarginFormulaVersion: CONTRIBUTION_MARGIN_FORMULA_VERSION,
  };
}
