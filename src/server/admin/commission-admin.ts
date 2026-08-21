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
 * AP1 lieferte das Grundgeruest: oeffentliche DTOs und die tenant-gescopten
 * Ladefunktionen (`requireCommissionModel()`, `requireCommissionModelVersion()`,
 * `requireDraftCommissionModelVersion()`). AP2 (siehe
 * PHASE_10_IMPLEMENTATION_PLAN.md Abschnitt 4) ergaenzt die eigentliche
 * CommissionModel-/Version-Management-API: `listCommissionModels()`,
 * `getCommissionModelVersionDetail()`, `createDraftCommissionModelVersion()`.
 * Das Feld-CRUD (FLAT/PERCENTAGE/TIERED, `CommissionTier`) folgt in AP3/AP4,
 * Publish/Aktivierung in AP5 -- `createDraftCommissionModelVersion()` legt
 * daher NIE eine Version mit Status ACTIVE an.
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
 *
 * KARDINALITAET (ChatGPT-Leitplanke AP2, 2026-08-21): mehrere
 * `CommissionModel`s pro Produkt bleiben bewusst zulaessig, KEIN
 * Unique-Constraint auf `productId` -- diese Datei erzwingt keine 1:1-
 * Beziehung und warnt/blockt nicht beim Anlegen eines zweiten
 * `CommissionModel` fuer ein bereits belegtes Produkt (das ist Aufgabe der
 * Admin-UI in AP8: bestehendes Modell anzeigen und zur Wiederverwendung
 * anbieten, keine Server-seitige Sperre). Die fachliche Aufloesung bei der
 * Provisionsberechnung nutzt den deterministischen Tie-Breaker in
 * `src/server/pricing/commission.ts::buildResolveCommission()`
 * (`validFrom DESC, id DESC`).
 */

import { db } from "../db/client";
import { getTenantContext, getTenantId } from "../tenant/context";
import type { ScopedPrismaClient } from "../tenant/scoped-client";
import {
  CommissionModelNotFoundError,
  CommissionModelVersionInvalidError,
  CommissionModelVersionNotDraftError,
  CommissionModelVersionNotFoundError,
} from "./commission-admin-errors";
import type {
  CreateDraftCommissionModelVersionInput,
  UpdateCommissionModelVersionFieldsInput,
} from "./commission-schemas";

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

type CommissionModelVersionRow = {
  id: string;
  commissionModelId: string;
  versionNumber: number;
  status: string;
  validFrom: Date;
  validTo: Date | null;
  commissionType: string;
  currency: string;
  commissionAmountMinor: number | null;
  commissionPercentageBasisPoints: number | null;
  recurringCommissionAmountMinor: number | null;
};

function toVersionSummary(v: CommissionModelVersionRow): CommissionModelVersionSummary {
  return {
    id: v.id,
    versionNumber: v.versionNumber,
    status: v.status,
    validFrom: v.validFrom.toISOString(),
    validTo: v.validTo ? v.validTo.toISOString() : null,
  };
}

function toVersionDetail(v: CommissionModelVersionRow): CommissionModelVersionDetail {
  return {
    id: v.id,
    commissionModelId: v.commissionModelId,
    versionNumber: v.versionNumber,
    status: v.status,
    validFrom: v.validFrom.toISOString(),
    validTo: v.validTo ? v.validTo.toISOString() : null,
    commissionType: v.commissionType,
    currency: v.currency,
    commissionAmountMinor: v.commissionAmountMinor,
    commissionPercentageBasisPoints: v.commissionPercentageBasisPoints,
    recurringCommissionAmountMinor: v.recurringCommissionAmountMinor,
  };
}

// ---------------------------------------------------------------------------
// 1. CommissionModel-Liste (mit allen Versionen, Historie)
// ---------------------------------------------------------------------------

export async function listCommissionModels(): Promise<CommissionModelSummary[]> {
  const rows = await db.commissionModel.findMany({
    orderBy: { name: "asc" },
    include: { versions: { orderBy: { validFrom: "desc" } } },
  });
  return rows.map((m) => ({
    id: m.id,
    productId: m.productId,
    name: m.name,
    versions: m.versions.map(toVersionSummary),
  }));
}

/** Vollstaendige Versionshistorie EINES `CommissionModel` (alle Status, neueste zuerst). */
export async function getCommissionModelVersionHistory(
  commissionModelId: string,
): Promise<CommissionModelVersionSummary[]> {
  await requireCommissionModel(db, commissionModelId);
  const versions = await db.commissionModelVersion.findMany({
    where: { commissionModelId },
    orderBy: { validFrom: "desc" },
  });
  return versions.map(toVersionSummary);
}

// ---------------------------------------------------------------------------
// 2. Versions-Detailansicht
// ---------------------------------------------------------------------------

export async function getCommissionModelVersionDetail(
  commissionModelId: string,
  versionId: string,
): Promise<CommissionModelVersionDetail> {
  await requireCommissionModel(db, commissionModelId);
  const version = await requireCommissionModelVersion(db, commissionModelId, versionId);
  return toVersionDetail(version);
}

// ---------------------------------------------------------------------------
// 3. Neue DRAFT-Version anlegen (leer oder als Kopie)
// ---------------------------------------------------------------------------

/**
 * `copyFromVersionId` (falls gesetzt) muss zu DEMSELBEN `commissionModelId`
 * gehoeren (per-Entity-Publish-Scope, siehe Modulkommentar) -- anders als bei
 * `createDraftRuleSetVersion()` (Phase 9, mandantenweiter Scope) gibt es hier
 * keine Cross-Model-Kopiervorlage. Die tatsaechlichen Feldwerte (commissionType/
 * currency/Betraege) kommen immer aus `input` (siehe commission-schemas.ts
 * Modulkommentar) -- `copyFromVersionId` dient hier primaer der Audit-
 * Nachvollziehbarkeit ("basiert auf Version X") und der Zugehoerigkeitspruefung,
 * nicht einem automatischen Feld-Copy.
 */
export async function createDraftCommissionModelVersion(
  commissionModelId: string,
  input: CreateDraftCommissionModelVersionInput,
): Promise<CommissionModelVersionDetail> {
  await requireCommissionModel(db, commissionModelId);
  const tenantId = getTenantId();
  const actorUserId = getTenantContext().userId;

  if (input.copyFromVersionId) {
    await requireCommissionModelVersion(db, commissionModelId, input.copyFromVersionId);
  }

  const now = new Date();

  const newVersionId = await db.$transaction(async (tx) => {
    const lastVersion = await tx.commissionModelVersion.findFirst({
      where: { commissionModelId },
      orderBy: { versionNumber: "desc" },
      select: { versionNumber: true },
    });
    const nextVersionNumber = (lastVersion?.versionNumber ?? 0) + 1;

    const newVersion = await tx.commissionModelVersion.create({
      data: {
        tenantId,
        commissionModelId,
        versionNumber: nextVersionNumber,
        status: "DRAFT",
        validFrom: now,
        validTo: null,
        commissionType: input.commissionType,
        currency: input.currency,
        commissionAmountMinor: input.commissionAmountMinor ?? null,
        commissionPercentageBasisPoints: input.commissionPercentageBasisPoints ?? null,
        recurringCommissionAmountMinor: input.recurringCommissionAmountMinor ?? null,
      },
    });

    // Phase 10 AP7 haerten wir die Audit-Vollstaendigkeit gegen die
    // tatsaechlichen Mutationspfade ab (analog Phase 8 AP7/Phase 9 AP7) --
    // hier bereits im selben Transaktionsschritt wie die Mutation protokolliert,
    // schlaegt die Transaktion spaeter fehl, wird auch dieser Eintrag
    // zurueckgerollt.
    await tx.auditLog.create({
      data: {
        tenantId,
        actorUserId,
        action: "CREATE",
        entityType: "CommissionModelVersion",
        entityId: newVersion.id,
        metadata: {
          commissionModelId,
          copyFromVersionId: input.copyFromVersionId ?? null,
          versionNumber: nextVersionNumber,
        },
      },
    });

    return newVersion.id;
  });

  return getCommissionModelVersionDetail(commissionModelId, newVersionId);
}

// ---------------------------------------------------------------------------
// 4. Feld-CRUD: Skalarfelder einer DRAFT-Version aendern (AP3)
// ---------------------------------------------------------------------------

/**
 * Partielles Update der Skalarfelder EINER bestehenden DRAFT-
 * `CommissionModelVersion` (`commissionType`, `currency`,
 * `commissionAmountMinor`, `commissionPercentageBasisPoints`,
 * `recurringCommissionAmountMinor`) -- analog `updateQuestionInDraft()`
 * (Phase 8 AP3): nur uebergebene Felder werden geaendert, Audit im selben
 * Transaktionsschritt, `changedFields` im Audit-Metadata enthaelt bewusst
 * nur die NAMEN der geaenderten Felder (Muster aus Phase 8 AP7).
 *
 * AMOUNT/PERCENTAGE-EXKLUSIVITAET (ChatGPT-Leitplanke AP3, 2026-08-21,
 * analog der spaeteren TIERED-Entscheidung `tierAmountMinor` XOR
 * `tierPercentageBasisPoints` pro `CommissionTier`-Zeile): bei
 * `commissionType: "PERCENTAGE"` duerfen `commissionAmountMinor` UND
 * `recurringCommissionAmountMinor` nicht gesetzt sein; bei `"FLAT"` darf
 * `commissionPercentageBasisPoints` nicht gesetzt sein. Diese Pruefung
 * erfolgt auf dem ZUSAMMENGEFUEHRTEN Ergebniszustand (bestehende Version +
 * `patch`), NICHT nur auf den im Patch enthaltenen Feldern -- ein Patch mit
 * nur `{ commissionType: "PERCENTAGE" }` muss z. B. auch dann fehlschlagen,
 * wenn `commissionAmountMinor` aus einer frueheren Mutation noch gesetzt
 * ist. `commissionAmountMinor` (einmalig) und `recurringCommissionAmountMinor`
 * (wiederkehrend) sind bei FLAT AUSDRUECKLICH NICHT gegenseitig exklusiv
 * (siehe `computeCommissionAmountMinor()`-Modulkommentar in
 * `src/server/pricing/commission.ts`: die Deal-Erfassung braucht bei FLAT
 * ggf. beide Betraege gleichzeitig).
 */
export async function updateCommissionModelVersionFields(
  commissionModelId: string,
  versionId: string,
  patch: UpdateCommissionModelVersionFieldsInput,
): Promise<CommissionModelVersionDetail> {
  await requireCommissionModel(db, commissionModelId);
  const current = await requireDraftCommissionModelVersion(db, commissionModelId, versionId);
  const tenantId = getTenantId();
  const actorUserId = getTenantContext().userId;

  const resultingType = patch.commissionType ?? current.commissionType;
  const resultingAmount =
    patch.commissionAmountMinor !== undefined
      ? patch.commissionAmountMinor
      : current.commissionAmountMinor;
  const resultingRecurringAmount =
    patch.recurringCommissionAmountMinor !== undefined
      ? patch.recurringCommissionAmountMinor
      : current.recurringCommissionAmountMinor;
  const resultingPercentage =
    patch.commissionPercentageBasisPoints !== undefined
      ? patch.commissionPercentageBasisPoints
      : current.commissionPercentageBasisPoints;

  const issues: string[] = [];
  if (resultingType === "FLAT" && resultingPercentage != null) {
    issues.push(
      "commissionPercentageBasisPoints muss bei commissionType FLAT null bzw. nicht gesetzt sein.",
    );
  }
  if (
    resultingType === "PERCENTAGE" &&
    (resultingAmount != null || resultingRecurringAmount != null)
  ) {
    issues.push(
      "commissionAmountMinor und recurringCommissionAmountMinor muessen bei commissionType " +
        "PERCENTAGE null bzw. nicht gesetzt sein.",
    );
  }
  if (issues.length > 0) {
    throw new CommissionModelVersionInvalidError(versionId, issues);
  }

  const hasVersionFieldChanges =
    patch.commissionType !== undefined ||
    patch.currency !== undefined ||
    patch.commissionAmountMinor !== undefined ||
    patch.commissionPercentageBasisPoints !== undefined ||
    patch.recurringCommissionAmountMinor !== undefined;

  if (hasVersionFieldChanges) {
    await db.$transaction(async (tx) => {
      await tx.commissionModelVersion.update({
        where: { id: versionId },
        data: {
          ...(patch.commissionType !== undefined ? { commissionType: patch.commissionType } : {}),
          ...(patch.currency !== undefined ? { currency: patch.currency } : {}),
          ...(patch.commissionAmountMinor !== undefined
            ? { commissionAmountMinor: patch.commissionAmountMinor }
            : {}),
          ...(patch.commissionPercentageBasisPoints !== undefined
            ? { commissionPercentageBasisPoints: patch.commissionPercentageBasisPoints }
            : {}),
          ...(patch.recurringCommissionAmountMinor !== undefined
            ? { recurringCommissionAmountMinor: patch.recurringCommissionAmountMinor }
            : {}),
        },
      });

      // Phase 10 AP3 (analog Phase 8 AP7-Auflage): Audit im selben
      // Transaktionsschritt wie die Mutation, Metadata enthaelt nur die
      // NAMEN der geaenderten Felder, keine vollstaendige Kopie der neuen
      // Werte.
      await tx.auditLog.create({
        data: {
          tenantId,
          actorUserId,
          action: "UPDATE",
          entityType: "CommissionModelVersion",
          entityId: versionId,
          metadata: {
            commissionModelId,
            changedFields: Object.keys(patch),
          },
        },
      });
    });
  }

  return getCommissionModelVersionDetail(commissionModelId, versionId);
}

// Re-Export der internen Ladefunktionen unter einem Namespace-Objekt fuer
// AP3+ (vermeidet Umbenennung/Re-Import-Kollisionen mit gleichnamigen
// Helfern in rule-admin.ts/question-admin.ts, falls beide Module einmal im
// selben Aufrufkontext importiert werden).
export const commissionAdminInternal = {
  requireCommissionModel,
  requireCommissionModelVersion,
  requireDraftCommissionModelVersion,
};
