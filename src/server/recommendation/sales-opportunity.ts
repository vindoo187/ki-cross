/**
 * SalesOpportunity-Erstellung, insbesondere aus einem
 * RecommendationCrossSellingSignal (PHASE_3B_IMPLEMENTATION_PLAN.md
 * Abschnitt 3.4 Korrekturpunkt 1). `SalesOpportunity` bleibt bewusst
 * mutabel (kein append-only-Trigger) und ist ein SEPARATER, von der
 * Auswertungs-Transaktion entkoppelter Schritt (siehe service.ts /
 * Abschnitt 7 "Transaktionsgrenzen").
 *
 * WICHTIG (siehe prisma/schema.prisma, Modell SalesOpportunity):
 * `detectedNeedId` ist optional und UNABHAENGIG von `triggerSignalId` - der
 * Phase-3B-Regelfall (Cross-Selling-Signal-gesteuerte Opportunity) legt gar
 * KEINE `DetectedNeed`-Zeile an, sondern setzt `triggerSignalId`,
 * `reasonCode`, `justificationParams` und `priority` direkt auf der
 * SalesOpportunity (siehe scripts/verify_migration_pglite.mjs). `source`
 * existiert NUR auf `DetectedNeed`, nicht auf `SalesOpportunity` selbst.
 *
 * Die Service-Layer-Invariante (kein DB-CHECK moeglich, siehe
 * SalesOpportunitySourceMismatchError in errors.ts) ist daher NUR
 * anwendbar, wenn eine SalesOpportunity tatsaechlich ueber `detectedNeedId`
 * mit einer `DetectedNeed`-Zeile verknuepft ist (legacy-/manueller Pfad):
 * dann muss `DetectedNeed.source = RULE_BASED` mit gesetzter
 * `triggerSignalId` einhergehen, und `source = EMPLOYEE_MARKED` mit
 * `triggerSignalId = null`. Ohne verknuepfte DetectedNeed-Zeile
 * (`detectedNeedId = null`, wie im Cross-Selling-Regelfall) ist die
 * Invariante nicht anwendbar - es gibt kein `source`-Feld, gegen das
 * geprueft werden koennte.
 */

import { SalesOpportunitySourceMismatchError } from "./errors";

export type DetectedNeedSource = "RULE_BASED" | "EMPLOYEE_MARKED";

export interface SalesOpportunityInput {
  detectedNeedId: string | null;
  /** Nur gesetzt, wenn `detectedNeedId` eine tatsaechliche DetectedNeed-Zeile referenziert. */
  detectedNeedSource: DetectedNeedSource | null;
  triggerSignalId: string | null;
  reasonCode: string | null;
  justificationParams: unknown;
  priority: number | null;
}

/**
 * Prueft die Source/triggerSignalId-Invariante, wirft
 * SalesOpportunitySourceMismatchError bei Verletzung. No-op, wenn keine
 * DetectedNeed-Zeile verknuepft ist (detectedNeedId/detectedNeedSource = null).
 */
export function assertSalesOpportunitySourceConsistency(input: SalesOpportunityInput): void {
  if (input.detectedNeedId == null || input.detectedNeedSource == null) return;

  const hasTrigger = input.triggerSignalId != null;
  if (input.detectedNeedSource === "RULE_BASED" && !hasTrigger) {
    throw new SalesOpportunitySourceMismatchError(
      input.detectedNeedId,
      input.detectedNeedSource,
      input.triggerSignalId,
    );
  }
  if (input.detectedNeedSource === "EMPLOYEE_MARKED" && hasTrigger) {
    throw new SalesOpportunitySourceMismatchError(
      input.detectedNeedId,
      input.detectedNeedSource,
      input.triggerSignalId,
    );
  }
}

/**
 * Baut den Input fuer eine SalesOpportunity aus einem persistierten
 * RecommendationCrossSellingSignal (Phase-3B-Regelfall) - OHNE
 * DetectedNeed-Verknuepfung, `triggerSignalId` direkt gesetzt.
 */
export function buildSalesOpportunityFromSignal(signal: {
  id: string;
  reasonCode: string;
  justificationParams: unknown;
  priority: number;
}): SalesOpportunityInput {
  const input: SalesOpportunityInput = {
    detectedNeedId: null,
    detectedNeedSource: null,
    triggerSignalId: signal.id,
    reasonCode: signal.reasonCode,
    justificationParams: signal.justificationParams,
    priority: signal.priority,
  };
  assertSalesOpportunitySourceConsistency(input);
  return input;
}

/**
 * Baut den Input fuer eine ueber eine bestehende, EMPLOYEE_MARKED
 * DetectedNeed-Zeile manuell markierte SalesOpportunity (legacy-/manueller
 * Pfad, kein CrossSellingSignal).
 */
export function buildSalesOpportunityFromEmployeeMarkedNeed(
  detectedNeedId: string,
  fields: { reasonCode?: string | null; justificationParams?: unknown; priority?: number | null },
): SalesOpportunityInput {
  const input: SalesOpportunityInput = {
    detectedNeedId,
    detectedNeedSource: "EMPLOYEE_MARKED",
    triggerSignalId: null,
    reasonCode: fields.reasonCode ?? null,
    justificationParams: fields.justificationParams ?? null,
    priority: fields.priority ?? null,
  };
  assertSalesOpportunitySourceConsistency(input);
  return input;
}
