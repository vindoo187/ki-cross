/**
 * Deal-Erfassung (Phase 6 AP3, siehe PHASE_6_IMPLEMENTATION_PLAN.md
 * Abschnitt 3.1 + Abschnitt 12.1 "closeDeal() als zentrale transaktionale
 * Business-Operation", ChatGPT-Leitplanke aus dem Plan-Review).
 *
 * `closeDeal()` ist der EINZIGE Schreibpfad, ueber den ein Abschluss erfasst
 * wird: Deal + DealItems + DealFinancialSnapshot + `DEAL_CLOSED`-Event
 * werden ATOMAR in einer Transaktion geschrieben, analog dem bestehenden
 * Muster aus `outcome.ts`/`completion.ts` (Analytics-Schreibvorgang
 * innerhalb derselben Transaktion wie der Fachdatensatz).
 *
 * Bewusst EIN Deal pro ConsultationSession (siehe
 * DealAlreadyExistsForSessionError) -- kein Nachtragen weiterer Positionen
 * zu einem bereits geschlossenen Deal in Phase 6 (kein CRM-Auftragsprozess,
 * ChatGPT-Vorgabe "Out of Scope").
 *
 * Provisions-/Kostendaten werden zum `closedAt`-Zeitpunkt EINMALIG
 * aufgeloest und in den (append-only, DB-Trigger-geschuetzten)
 * DealFinancialSnapshot geschrieben -- spaetere Aenderungen an
 * CommissionModel/ProductCostVersion beeinflussen einen bereits
 * geschriebenen Snapshot dadurch nie (historische Stabilitaet, ChatGPT-
 * Vorgabe im Plan-Review).
 *
 * SANDBOX-VERIFIKATIONSLUECKE (rein tooling-bedingt): siehe Modulkommentar
 * in questionnaire/service.ts -- identische Fehlerklasse, nur in CI gegen
 * einen echten @prisma/client verifizierbar.
 */

import { Prisma } from "@prisma/client";
import { db } from "../db/client";
import { getTenantId } from "../tenant/context";
import {
  DealConsultationSessionNotFoundError,
  DealSessionNotClosableError,
  DealRequiresItemsError,
  DealProductVersionNotFoundError,
  DealAlreadyExistsForSessionError,
} from "./errors";
import { computeDealFinancialSnapshot, type ProductCostRow } from "./financial-snapshot";
import { loadActiveCommissionModelVersions, buildResolveCommission } from "../pricing/commission";

const EVENT_TYPE = "DEAL_CLOSED";

/** Wie assertSessionEvaluable() (recommendation/service.ts): positive Whitelist, ABANDONED bleibt gesperrt. */
function assertSessionClosable(session: { id: string; status: string }): void {
  if (session.status !== "IN_PROGRESS" && session.status !== "COMPLETED") {
    throw new DealSessionNotClosableError(session.id, session.status);
  }
}

export interface CloseDealItemInput {
  productVersionId: string;
  quantity: number;
}

export interface CloseDealInput {
  consultationSessionId: string;
  items: CloseDealItemInput[];
  /**
   * Optionale Kundenreferenz zum Abschlusszeitpunkt (Plan Abschnitt 3.1:
   * `closeDeal(consultationSessionId, items[], customerReferenceId?)`).
   * Ueberschreibt NICHT die ConsultationSession selbst -- nur der neu
   * angelegte Deal erhaelt diesen Wert. Faellt auf `session.customerReferenceId`
   * zurueck, falls nicht explizit angegeben (z. B. Beratung wurde ohne
   * Kundenreferenz gestartet, der Abschluss selbst erfordert aber eine).
   * Existenzpruefung erfolgt wie bei `startQuestionnaire()`
   * (questionnaire/service.ts) NICHT im Service, sondern ueber den
   * DB-Fremdschluessel (Tenant-Scoping-Extension) -- identisches, bereits
   * etabliertes Muster.
   */
  customerReferenceId?: string | null;
}

export interface CloseDealResult {
  dealId: string;
  consultationSessionId: string;
  monthlyRecurringRevenueMinor: number;
  oneTimeRevenueMinor: number;
  totalContractValueMinor: number;
  contributionMarginMinor: number;
}

export async function closeDeal(input: CloseDealInput): Promise<CloseDealResult> {
  const tenantId = getTenantId();

  if (input.items.length === 0) {
    throw new DealRequiresItemsError();
  }

  const session = await db.consultationSession.findUnique({
    where: { id: input.consultationSessionId },
  });
  if (!session) {
    throw new DealConsultationSessionNotFoundError(input.consultationSessionId);
  }
  assertSessionClosable(session);

  const existingDeal = await db.deal.findFirst({
    where: { consultationSessionId: input.consultationSessionId },
  });
  if (existingDeal) {
    throw new DealAlreadyExistsForSessionError(input.consultationSessionId);
  }

  const productVersionIds = [...new Set(input.items.map((i) => i.productVersionId))];
  const productVersions = await db.productVersion.findMany({
    where: { id: { in: productVersionIds } },
    select: {
      id: true,
      productId: true,
      currency: true,
      monthlyPriceMinor: true,
      oneTimePriceMinor: true,
    },
  });
  const productVersionById = new Map(productVersions.map((v) => [v.id, v]));
  for (const id of productVersionIds) {
    if (!productVersionById.has(id)) {
      throw new DealProductVersionNotFoundError(id);
    }
  }

  const closedAt = new Date();
  const productIds = [...new Set(productVersions.map((v) => v.productId))];

  // Kostendaten: aktive ProductCostVersion je Produkt zum Abschlusszeitpunkt.
  // Fehlt eine ProductCostVersion fuer ein Produkt, wird das NICHT als
  // Fehler behandelt (nicht jedes Produkt muss zwingend Kostendaten
  // besitzen) -- computeDealFinancialSnapshot() behandelt einen fehlenden
  // Eintrag als "keine Kosten" (0), siehe dortigen Modulkommentar.
  const costVersions = await db.productCostVersion.findMany({
    where: {
      productId: { in: productIds },
      status: "ACTIVE",
      validFrom: { lte: closedAt },
      OR: [{ validTo: null }, { validTo: { gt: closedAt } }],
    },
  });
  const costsByProductId = new Map<string, ProductCostRow>(
    costVersions.map((c) => [
      c.productId,
      {
        hardwarePurchaseCostMinor: c.hardwarePurchaseCostMinor,
        subsidyCostMinor: c.subsidyCostMinor,
        otherDirectCostMinor: c.otherDirectCostMinor,
      },
    ]),
  );

  // Provisionsdaten: dieselbe Aufloesungsquelle wie die Empfehlungs-Engine
  // (src/server/pricing/commission.ts), hier zum Abschlusszeitpunkt statt
  // zum Empfehlungszeitpunkt aufgeloest.
  const commissionRows = await loadActiveCommissionModelVersions(db, closedAt);
  const resolveCommission = buildResolveCommission(commissionRows);
  const commissionRowByProductId = new Map(
    productIds.map((productId) => {
      const resolution = resolveCommission(productId);
      const row = resolution
        ? (commissionRows.find((r) => r.id === resolution.commissionModelVersionId) ?? null)
        : null;
      return [productId, row];
    }),
  );

  const dealItemsPricing = input.items.map((item) => {
    const version = productVersionById.get(item.productVersionId);
    if (!version) throw new DealProductVersionNotFoundError(item.productVersionId);
    return {
      productVersionId: item.productVersionId,
      productId: version.productId,
      quantity: item.quantity,
      monthlyPriceMinor: version.monthlyPriceMinor,
      oneTimePriceMinor: version.oneTimePriceMinor,
    };
  });

  const snapshot = computeDealFinancialSnapshot(
    dealItemsPricing,
    costsByProductId,
    commissionRowByProductId,
  );

  const currency = productVersions[0]?.currency ?? "EUR";

  let deal;
  try {
    deal = await db.$transaction(async (tx) => {
      const createdDeal = await tx.deal.create({
        data: {
          tenantId,
          consultationSessionId: session.id,
          storeId: session.storeId,
          employeeId: session.employeeId,
          customerReferenceId:
            input.customerReferenceId !== undefined
              ? input.customerReferenceId
              : (session.customerReferenceId ?? null),
          currency,
          closedAt,
        },
      });

      await tx.dealItem.createMany({
        data: input.items.map((item) => ({
          tenantId,
          dealId: createdDeal.id,
          productVersionId: item.productVersionId,
          quantity: item.quantity,
        })),
      });

      await tx.dealFinancialSnapshot.create({
        data: {
          tenantId,
          dealId: createdDeal.id,
          currency,
          monthlyRecurringRevenueMinor: snapshot.monthlyRecurringRevenueMinor,
          totalContractValueMinor: snapshot.totalContractValueMinor,
          oneTimeRevenueMinor: snapshot.oneTimeRevenueMinor,
          commissionAmountMinor: snapshot.commissionAmountMinor,
          expectedRecurringCommissionMinor: snapshot.expectedRecurringCommissionMinor,
          hardwarePurchaseCostMinor: snapshot.hardwarePurchaseCostMinor,
          subsidyCostMinor: snapshot.subsidyCostMinor,
          discountCostMinor: snapshot.discountCostMinor,
          otherDirectCostMinor: snapshot.otherDirectCostMinor,
          contributionMarginMinor: snapshot.contributionMarginMinor,
          contributionMarginFormulaVersion: snapshot.contributionMarginFormulaVersion,
          capturedAt: closedAt,
        },
      });

      await tx.analyticsEvent.create({
        data: {
          tenantId,
          storeId: session.storeId,
          employeeId: session.employeeId,
          eventType: EVENT_TYPE,
          occurredAt: closedAt,
          payload: {
            consultationSessionId: session.id,
            dealId: createdDeal.id,
            productVersionIds: input.items.map((i) => i.productVersionId),
            totalMonthlyValueMinor: snapshot.monthlyRecurringRevenueMinor,
          },
        },
      });

      return createdDeal;
    });
  } catch (err) {
    // Defense-in-depth gegen die Race Condition, die der App-Level-Precheck
    // (oben, `existingDeal`) allein nicht ausschliessen kann: zwei nahezu
    // gleichzeitige closeDeal()-Aufrufe fuer dieselbe Session koennten
    // beide den Precheck passieren, bevor eine der beiden Transaktionen
    // committet. Der DB-Unique-Constraint (tenantId, consultationSessionId,
    // siehe Migration 20260817170000) faengt das ab; hier wird der daraus
    // resultierende P2002 in denselben fachlichen Fehler wie der Precheck
    // uebersetzt (analog outcome.ts).
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      throw new DealAlreadyExistsForSessionError(input.consultationSessionId);
    }
    throw err;
  }

  return {
    dealId: deal.id,
    consultationSessionId: session.id,
    monthlyRecurringRevenueMinor: snapshot.monthlyRecurringRevenueMinor,
    oneTimeRevenueMinor: snapshot.oneTimeRevenueMinor,
    totalContractValueMinor: snapshot.totalContractValueMinor,
    contributionMarginMinor: snapshot.contributionMarginMinor,
  };
}
