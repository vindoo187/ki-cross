/**
 * Commission-Management-Service (Phase 10 AP1 -- Grundgeruest, siehe
 * PHASE_10_IMPLEMENTATION_PLAN.md Abschnitt 3). Analog `rule-admin.ts`
 * (Phase 9)/`question-admin.ts` (Phase 8), aber mit dem Publish-Scope-
 * Unterschied aus PHASE_10_DISCOVERY.md Abschnitt 1: `CommissionModelVersion`
 * ist PRO `CommissionModel` gescoped (wie Phase 8s `QuestionnaireVersion`),
 * NICHT mandantenweit wie Phase 9s `RuleSetVersion` -- `copyFromVersionId`
 * bezieht sich daher immer auf eine Version DESSELBEN `CommissionModel`,
 * es gibt (anders als bei `rule-admin.ts`) keine
 * `requireAnyCommissionModelVersionInTenant()`-Abweichung.
 *
 * AP1 liefert bewusst nur das Grundgeruest: oeffentliche DTOs und die
 * tenant-gescopten Ladefunktionen (`requireCommissionModel()`,
 * `requireCommissionModelVersion()`, `requireDraftCommissionModelVersion()`).
 * Die eigentliche CommissionModel-/Version-Management-API (Liste, Detail,
 * Draft-Erstellung inkl. Kardinalitaets-Tie-Breaker) folgt in AP2, das
 * Feld-CRUD (FLAT/PERCENTAGE/TIERED) in AP3/AP4, Publish in AP5.
 *
 * Verwendet ausschliesslich den tenant-gescopten `db`-Client
 * (`src/server/tenant/scoped-client.ts`) -- identisches Isolationsmuster wie
 * `rule-admin.ts`/`question-admin.ts`: eine per Request-Pfad mitgegebene
 * `commissionModelId`/`versionId` aus einem FREMDEN Mandanten kann dadurch
 * strukturell NICHT adressiert werden (0 Treffer -> `*NotFoundError`).
 *
 * `requireConfigPermission("config.commissions.*")` wird bewusst NICHT
 * hier, sondern in der Route-Schicht aufgerufen (AP2+), identisches Muster
 * wie Phase 8/9.
 */

import type { ScopedPrismaClient } from "../tenant/scoped-client";
import {
  CommissionModelNotFoundError,
  CommissionModelVersionNotDraftError,
  CommissionModelVersionNotFoundError,
} from "./commission-admin-errors";

type ScopedTransactionClient = Parameters<Parameters<ScopedPrismaClient["$transaction"]>[0]>[0];
type QueryClient = ScopedTransactionClient;

// ---------------------------------------------------------------------------
// Oeffentliche DTOs
// ---------------------------------------------------------------------------

export interface CommissionModelVersionSummary {
  id: string;
  versionNumber: number;
  status: string;
  validFrom: string;
  validTo: string | null;
}

export interface CommissionModelSummary {
  id: string;
  productId: string;
  name: string;
  versions: CommissionModelVersionSummary[];
}

export interface CommissionModelVersionDetail {
  id: string;
  commissionModelId: string;
  versionNumber: number;
  status: string;
  validFrom: string;
  validTo: string | null;
  commissionType: string;
  currency: string;
  commissionAmountMinor: number | null;
  commissionPercentageBasisPoints: number | null;
  recurringCommissionAmountMinor: number | null;
}

// ---------------------------------------------------------------------------
// Interne Ladefunktionen
// ---------------------------------------------------------------------------

/** Laedt ein `CommissionModel` (tenant-gescopt via `client`). */
async function requireCommissionModel(client: QueryClient, commissionModelId: string) {
  const commissionModel = await client.commissionModel.findUnique({
    where: { id: commissionModelId },
  });
  if (!commissionModel) {
    throw new CommissionModelNotFoundError(commissionModelId);
  }
  return commissionModel;
}

/** Laedt eine `CommissionModelVersion` und prueft, dass sie zum angegebenen `CommissionModel` gehoert. */
async function requireCommissionModelVersion(
  client: QueryClient,
  commissionModelId: string,
  versionId: string,
) {
  const version = await client.commissionModelVersion.findUnique({ where: { id: versionId } });
  if (!version || version.commissionModelId !== commissionModelId) {
    throw new CommissionModelVersionNotFoundError(commissionModelId, versionId);
  }
  return version;
}

/**
 * Wie `requireCommissionModelVersion()`, prueft zusaetzlich Status DRAFT
 * (409 sonst) -- fuer alle mutierenden Commission-Feld-CRUD-Operationen
 * (AP3+, analog `requireDraftRuleSetVersion()` aus Phase 9 AP3).
 */
async function requireDraftCommissionModelVersion(
  client: QueryClient,
  commissionModelId: string,
  versionId: string,
) {
  const version = await requireCommissionModelVersion(client, commissionModelId, versionId);
  if (version.status !== "DRAFT") {
    throw new CommissionModelVersionNotDraftError(versionId, version.status);
  }
  return version;
}

// Re-Export der internen Ladefunktionen unter einem Namespace-Objekt fuer
// AP2+ (vermeidet Umbenennung/Re-Import-Kollisionen mit gleichnamigen
// Helfern in rule-admin.ts/question-admin.ts, falls beide Module einmal im
// selben Aufrufkontext importiert werden).
export const commissionAdminInternal = {
  requireCommissionModel,
  requireCommissionModelVersion,
  requireDraftCommissionModelVersion,
};
