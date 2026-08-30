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
 * Das Feld-CRUD (FLAT/PERCENTAGE in AP3, TIERED/`CommissionTier` in AP4:
 * `createCommissionTier()`/`updateCommissionTier()`/`deleteCommissionTier()`)
 * ist mit AP4 vollstaendig implementiert. Publish/Aktivierung
 * (`publishCommissionModelVersion()`, PRO-CommissionModel-Scope inkl.
 * CommissionModel-Row-Lock, siehe Abschnitt 5 unten) ist mit AP5
 * implementiert -- `createDraftCommissionModelVersion()` legt weiterhin NIE
 * eine Version mit Status ACTIVE an, das passiert ausschliesslich ueber
 * `publishCommissionModelVersion()`. Der Mengen-Invarianten-Check ueber alle
 * Stufen einer Version (mind. eine Stufe mit `thresholdMinor = 0` bei
 * TIERED) ist NICHT Teil dieser Datei, sondern von
 * `validateCommissionModelVersion()` (`commission-validator.ts`, AP4) --
 * wird von `publishCommissionModelVersion()` VOR jeder Publish-Transaktion
 * aufgerufen.
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

import { Prisma } from "@prisma/client";
import { db } from "../db/client";
import { getTenantContext, getTenantId } from "../tenant/context";
import type { ScopedPrismaClient } from "../tenant/scoped-client";
import {
  CommissionModelNotFoundError,
  CommissionModelVersionInvalidError,
  CommissionModelVersionNotDraftError,
  CommissionModelVersionNotFoundError,
  CommissionModelVersionPublishConflictError,
  CommissionTierNotFoundError,
} from "./commission-admin-errors";
import type {
  CreateCommissionTierInput,
  CreateDraftCommissionModelVersionInput,
  UpdateCommissionModelVersionFieldsInput,
  UpdateCommissionTierInput,
} from "./commission-schemas";
// AP5: `validateCommissionModelVersion()` lebt bewusst in einer eigenen
// Datei (commission-validator.ts, AP4) und importiert ihrerseits
// `commissionAdminInternal` aus DIESER Datei (siehe Re-Export am Dateiende)
// -- das ist ein zyklischer Modul-Import, der hier funktioniert, weil beide
// Seiten die importierten Bindungen ausschliesslich INNERHALB von
// Funktionskoerpern verwenden (nie beim Modul-Laden selbst). Dieses Muster
// ist bereits seit AP4 in CI verifiziert (commission-validator.ts wird dort
// bereits erfolgreich importiert/verwendet).
import { validateCommissionModelVersion } from "./commission-validator";

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
  /**
   * Phase 10 AP4: nur befuellt (nicht-leeres Array), wenn `commissionType`
   * TIERED ist -- bei FLAT/PERCENTAGE strukturell immer `[]`, da unter
   * diesen Versionen keine `CommissionTier`-Zeilen angelegt werden koennen
   * (siehe `createCommissionTier()`). Immer nach `sortOrder` aufsteigend
   * sortiert.
   */
  tiers: CommissionTierDetail[];
}

/** Phase 10 AP4 -- eine einzelne Stufe einer TIERED-`CommissionModelVersion`. */
export interface CommissionTierDetail {
  id: string;
  commissionModelVersionId: string;
  thresholdMinor: number;
  tierAmountMinor: number | null;
  tierPercentageBasisPoints: number | null;
  sortOrder: number;
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

function toVersionDetail(
  v: CommissionModelVersionRow,
  tiers: CommissionTierDetail[],
): CommissionModelVersionDetail {
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
    tiers,
  };
}

type CommissionTierRow = {
  id: string;
  commissionModelVersionId: string;
  thresholdMinor: number;
  tierAmountMinor: number | null;
  tierPercentageBasisPoints: number | null;
  sortOrder: number;
};

function toTierDetail(t: CommissionTierRow): CommissionTierDetail {
  return {
    id: t.id,
    commissionModelVersionId: t.commissionModelVersionId,
    thresholdMinor: t.thresholdMinor,
    tierAmountMinor: t.tierAmountMinor,
    tierPercentageBasisPoints: t.tierPercentageBasisPoints,
    sortOrder: t.sortOrder,
  };
}

/** Laedt alle `CommissionTier`-Zeilen EINER Version, aufsteigend nach `sortOrder`. */
async function loadCommissionTiers(
  client: QueryClient,
  commissionModelVersionId: string,
): Promise<CommissionTierDetail[]> {
  const rows = await client.commissionTier.findMany({
    where: { commissionModelVersionId },
    orderBy: { sortOrder: "asc" },
  });
  return rows.map(toTierDetail);
}

/** Laedt eine `CommissionTier`-Zeile und prueft, dass sie zur angegebenen Version gehoert. */
async function requireCommissionTier(
  client: QueryClient,
  commissionModelVersionId: string,
  tierId: string,
) {
  const tier = await client.commissionTier.findUnique({ where: { id: tierId } });
  if (!tier || tier.commissionModelVersionId !== commissionModelVersionId) {
    throw new CommissionTierNotFoundError(tierId, commissionModelVersionId);
  }
  return tier;
}

/**
 * Prueft die tierAmountMinor/tierPercentageBasisPoints-XOR-Bedingung auf dem
 * ZUSAMMENGEFUEHRTEN Ergebniszustand (analog dem Amount/Percentage-Muster
 * aus AP3) -- genau eines von beiden muss gesetzt sein, nie beides, nie
 * keins.
 */
function validateTierAmountExclusivity(
  resultingAmount: number | null,
  resultingPercentage: number | null,
): string[] {
  const hasAmount = resultingAmount != null;
  const hasPercentage = resultingPercentage != null;
  if (hasAmount === hasPercentage) {
    return [
      "Genau eines von tierAmountMinor oder tierPercentageBasisPoints muss gesetzt sein (nie beides, nie keins).",
    ];
  }
  return [];
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
  const tiers = await loadCommissionTiers(db, versionId);
  return toVersionDetail(version, tiers);
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
    // Schritt 0: CommissionModel-Row-Lock (identisches Muster wie
    // publishCommissionModelVersion(), AP5, siehe Kommentar dort) -- MUSS die
    // erste Operation dieser Transaktion sein. Ohne diesen Lock lesen zwei
    // parallele createDraftCommissionModelVersion()-Aufrufe fuer DASSELBE
    // CommissionModel unter READ COMMITTED denselben MAX(versionNumber),
    // bevor einer der beiden committet -- beide versuchen dann dieselbe
    // naechste versionNumber zu vergeben, die zweite Transaktion scheitert am
    // UNIQUE-Constraint (tenant_id, commission_model_id, version_number) mit
    // P2002 statt sauber die naechste freie Nummer zu erhalten (gefunden
    // durch den E2E-Concurrency-Test in Phase 10 AP9, CI #75; Root-Cause-
    // Bestaetigung + Fix-GO von ChatGPT, 2026-08-22). Der Lock serialisiert
    // NUR Vorgaenge fuer DIESES CommissionModel -- zwei parallele
    // Draft-Erstellungen fuer UNTERSCHIEDLICHE CommissionModels bleiben
    // unabhaengig voneinander moeglich (kein Tenant-weiter Lock, anders als
    // Phase 9s RuleSet-Serialisierung).
    await tx.$queryRaw`SELECT id FROM commission_models WHERE id = ${commissionModelId}::uuid AND tenant_id = ${tenantId}::uuid FOR UPDATE`;

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
 *
 * TIERED (AP4, ChatGPT-GO 2026-08-21): bei `commissionType: "TIERED"`
 * muessen ALLE DREI Skalarfelder (`commissionAmountMinor`,
 * `commissionPercentageBasisPoints`, `recurringCommissionAmountMinor`) null
 * bzw. nicht gesetzt sein -- die eigentlichen Werte liegen ausschliesslich
 * in den `CommissionTier`-Kind-Zeilen (`createCommissionTier()`/
 * `updateCommissionTier()`/`deleteCommissionTier()` weiter unten). Ob
 * mindestens eine Stufe mit `thresholdMinor = 0` existiert (Mengen-
 * Invariante, nicht auf Feld-Ebene pruefbar) ist NICHT Aufgabe dieser
 * Funktion, sondern von `validateCommissionModelVersion()`
 * (`commission-validator.ts`), da Publish (AP5) diese Pruefung vor jeder
 * Veroeffentlichung ohnehin durchlaufen muss.
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
  if (
    resultingType === "TIERED" &&
    (resultingAmount != null || resultingPercentage != null || resultingRecurringAmount != null)
  ) {
    issues.push(
      "commissionAmountMinor, commissionPercentageBasisPoints und " +
        "recurringCommissionAmountMinor muessen bei commissionType TIERED alle null bzw. " +
        "nicht gesetzt sein -- die Werte liegen bei TIERED ausschliesslich in den " +
        "CommissionTier-Kind-Zeilen.",
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

// ---------------------------------------------------------------------------
// 5. Tier-CRUD: CommissionTier-Zeilen einer DRAFT-Version (AP4)
// ---------------------------------------------------------------------------

/**
 * Legt eine neue `CommissionTier`-Stufe fuer eine bestehende DRAFT-
 * `CommissionModelVersion` an -- nur zulaessig, wenn `commissionType` der
 * Version bereits TIERED ist (fruehes, klares Fehlerbild statt einer
 * strukturell unbefuellbaren Zwischenmenge; die Mengen-Invariante
 * "mindestens eine Stufe mit thresholdMinor = 0" prueft weiterhin
 * `validateCommissionModelVersion()`, da sie sich erst nach dem Anlegen
 * ALLER Stufen einer Version beurteilen laesst). Audit im selben
 * Transaktionsschritt wie die Mutation (Muster aus AP2/AP3).
 */
export async function createCommissionTier(
  commissionModelId: string,
  versionId: string,
  input: CreateCommissionTierInput,
): Promise<CommissionTierDetail> {
  await requireCommissionModel(db, commissionModelId);
  const version = await requireDraftCommissionModelVersion(db, commissionModelId, versionId);
  const tenantId = getTenantId();
  const actorUserId = getTenantContext().userId;

  if (version.commissionType !== "TIERED") {
    throw new CommissionModelVersionInvalidError(versionId, [
      "CommissionTier-Zeilen koennen nur zu einer Version mit commissionType TIERED " +
        "hinzugefuegt werden.",
    ]);
  }

  const issues = validateTierAmountExclusivity(
    input.tierAmountMinor ?? null,
    input.tierPercentageBasisPoints ?? null,
  );
  if (issues.length > 0) {
    throw new CommissionModelVersionInvalidError(versionId, issues);
  }

  let tier;
  try {
    tier = await db.$transaction(async (tx) => {
      const created = await tx.commissionTier.create({
        data: {
          tenantId,
          commissionModelVersionId: versionId,
          thresholdMinor: input.thresholdMinor,
          tierAmountMinor: input.tierAmountMinor ?? null,
          tierPercentageBasisPoints: input.tierPercentageBasisPoints ?? null,
          sortOrder: input.sortOrder,
        },
      });

      await tx.auditLog.create({
        data: {
          tenantId,
          actorUserId,
          action: "CREATE",
          entityType: "CommissionTier",
          entityId: created.id,
          metadata: { commissionModelId, commissionModelVersionId: versionId },
        },
      });

      return created;
    });
  } catch (err) {
    // Uebersetzt die DB-UNIQUE-Constraints commission_tiers_..._threshold_minor_key
    // und commission_tiers_..._sort_order_key (siehe Migration
    // 20260821190000_commission_tiers) in eine saubere 422-Antwort statt eines
    // rohen P2002-Fehlers -- analog dem etablierten Muster in
    // deals/service.ts/recommendation/outcome.ts.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      throw new CommissionModelVersionInvalidError(versionId, [
        "Es existiert bereits eine CommissionTier-Zeile mit demselben thresholdMinor " +
          "oder sortOrder innerhalb dieser Version.",
      ]);
    }
    throw err;
  }

  return toTierDetail(tier);
}

/**
 * Partielles Update EINER bestehenden `CommissionTier`-Zeile (analog
 * `updateCommissionModelVersionFields()` aus AP3: Amount/Percentage-XOR
 * wird auf dem ZUSAMMENGEFUEHRTEN Ergebniszustand geprueft, nicht nur
 * patch-lokal). Nur auf DRAFT-Versionen zulaessig.
 */
export async function updateCommissionTier(
  commissionModelId: string,
  versionId: string,
  tierId: string,
  patch: UpdateCommissionTierInput,
): Promise<CommissionTierDetail> {
  await requireCommissionModel(db, commissionModelId);
  await requireDraftCommissionModelVersion(db, commissionModelId, versionId);
  const current = await requireCommissionTier(db, versionId, tierId);
  const tenantId = getTenantId();
  const actorUserId = getTenantContext().userId;

  const resultingAmount =
    patch.tierAmountMinor !== undefined ? patch.tierAmountMinor : current.tierAmountMinor;
  const resultingPercentage =
    patch.tierPercentageBasisPoints !== undefined
      ? patch.tierPercentageBasisPoints
      : current.tierPercentageBasisPoints;

  const issues = validateTierAmountExclusivity(resultingAmount, resultingPercentage);
  if (issues.length > 0) {
    throw new CommissionModelVersionInvalidError(versionId, issues);
  }

  const hasChanges =
    patch.thresholdMinor !== undefined ||
    patch.tierAmountMinor !== undefined ||
    patch.tierPercentageBasisPoints !== undefined ||
    patch.sortOrder !== undefined;

  if (hasChanges) {
    try {
      await db.$transaction(async (tx) => {
        await tx.commissionTier.update({
          where: { id: tierId },
          data: {
            ...(patch.thresholdMinor !== undefined ? { thresholdMinor: patch.thresholdMinor } : {}),
            ...(patch.tierAmountMinor !== undefined
              ? { tierAmountMinor: patch.tierAmountMinor }
              : {}),
            ...(patch.tierPercentageBasisPoints !== undefined
              ? { tierPercentageBasisPoints: patch.tierPercentageBasisPoints }
              : {}),
            ...(patch.sortOrder !== undefined ? { sortOrder: patch.sortOrder } : {}),
          },
        });

        await tx.auditLog.create({
          data: {
            tenantId,
            actorUserId,
            action: "UPDATE",
            entityType: "CommissionTier",
            entityId: tierId,
            metadata: {
              commissionModelId,
              commissionModelVersionId: versionId,
              changedFields: Object.keys(patch),
            },
          },
        });
      });
    } catch (err) {
      // Siehe P2002-Uebersetzungskommentar in createCommissionTier().
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        throw new CommissionModelVersionInvalidError(versionId, [
          "Es existiert bereits eine CommissionTier-Zeile mit demselben thresholdMinor " +
            "oder sortOrder innerhalb dieser Version.",
        ]);
      }
      throw err;
    }
  }

  const updated = await db.commissionTier.findUniqueOrThrow({ where: { id: tierId } });
  return toTierDetail(updated);
}

/**
 * Loescht EINE bestehende `CommissionTier`-Zeile -- anders als bei den
 * uebrigen Kern-Entitaeten (append-only-Philosophie) ist ein echtes Loeschen
 * hier bewusst zulaessig, da `CommissionTier`-Zeilen ausschliesslich
 * innerhalb einer noch NICHT veroeffentlichten DRAFT-Version existieren
 * (nach Publish ist die Version -- inkl. ihrer Stufen -- unveraenderlich,
 * ein Loeschen ist dann strukturell nicht mehr moeglich, da
 * `requireDraftCommissionModelVersion()` bereits vorher mit 409 blockt).
 */
export async function deleteCommissionTier(
  commissionModelId: string,
  versionId: string,
  tierId: string,
): Promise<void> {
  await requireCommissionModel(db, commissionModelId);
  await requireDraftCommissionModelVersion(db, commissionModelId, versionId);
  await requireCommissionTier(db, versionId, tierId);
  const tenantId = getTenantId();
  const actorUserId = getTenantContext().userId;

  await db.$transaction(async (tx) => {
    await tx.commissionTier.delete({ where: { id: tierId } });

    await tx.auditLog.create({
      data: {
        tenantId,
        actorUserId,
        action: "DELETE",
        entityType: "CommissionTier",
        entityId: tierId,
        metadata: { commissionModelId, commissionModelVersionId: versionId },
      },
    });
  });
}

// ---------------------------------------------------------------------------
// 5. Publish-Workflow (AP5, siehe PHASE_10_IMPLEMENTATION_PLAN.md Abschnitt 7,
//    ChatGPT-GO 2026-08-21). Analog `publishDraftVersion()`
//    (question-admin.ts, Phase 8 AP4) -- PRO-CommissionModel-Scope (nicht
//    mandantenweit wie Phase 9s `publishRuleSetVersion()`), siehe
//    Modulkommentar oben.
//
// LOCK-SCOPE (ChatGPTs explizite AP5-Vorgabe, staerker als der
// urspruengliche Plantext "kein Tenant-Row-Lock"/Phase-8-Muster): parallele
// Publishes DESSELBEN CommissionModel muessen sauber serialisiert werden --
// dafuer sperrt diese Funktion als ERSTE Operation der Transaktion die
// EINZELNE `commission_models`-Zeile (nicht die `tenants`-Zeile wie Phase 9,
// da der Scope hier feiner granular ist: pro CommissionModel, nicht
// mandantenweit). Diese Zeile existiert immer (Voraussetzung: `requireCommissionModel()`
// oben hat sie bereits gefunden), analog dem Tenant-Row-Lock-Prinzip aus
// Phase 9 AP5 (siehe `RULE_SET_VERSION_ACTIVE_NO_OVERLAP_CONSTRAINT`-Kommentar
// in rule-admin.ts fuer den vollen Befund, warum ein reiner
// EXCLUDE-Constraint bei fehlender vorheriger ACTIVE-Version allein nicht
// ausreicht). Der bestehende DB-EXCLUDE-Constraint
// `commission_model_versions_no_overlap` (siehe Migration
// `20260731000000_init`, bereits PRO CommissionModel gescopt) bleibt
// zusaetzlich als Backstop bestehen (Verteidigung in der Tiefe).
//
// Transaktionsreihenfolge:
// 1. Serverseitige Revalidierung ueber `validateCommissionModelVersion()` VOR
//    der Transaktion (rein lesend) -- ein Validierungsfehler darf keine
//    Transaktion eroeffnen.
// 2. Innerhalb EINER Transaktion:
//    0. CommissionModel-Row-Lock (`SELECT id FROM commission_models WHERE
//       id = $1 AND tenant_id = $2 FOR UPDATE`) -- MUSS die erste Operation
//       sein, vor Schritt (a).
//    0b. `now = new Date()` wird ERST NACH erfolgreichem Erwerb dieses Locks
//       bestimmt (Phase 13 AP10-Audit-Fund, analog zum dort behobenen
//       Campaign-Defekt, siehe DECISION_LOG.md) -- NICHT davor, sonst kann
//       eine durch den Lock blockierte, zweite Publish-Transaktion nach
//       Freigabe des Locks einen FRUEHEREN Zeitstempel als das soeben
//       gesetzte `validFrom` der jetzt ACTIVE-Version besitzen und beim
//       Expiren-Versuch einen ungueltigen Bereich (`validFrom > validTo`,
//       Postgres-Fehler 22000) erzeugen.
//    a. Bisherige ACTIVE-Version DESSELBEN CommissionModel (falls vorhanden)
//       zuerst auf EXPIRED setzen (`validTo = now`) -- MUSS vor (b)
//       passieren, sonst schlaegt die EXCLUDE-Constraint sofort fehl.
//    b. Ziel-Draft ueber `updateMany({where: {id, status: "DRAFT"}})` auf
//       ACTIVE setzen -- `count !== 1` wirft (paralleler Publish-Versuch
//       DERSELBEN Version), rollt die GESAMTE Transaktion inkl. Schritt (a)
//       zurueck.
//    c. `AuditLog`-Eintrag (ACTIVATE) in DERSELBEN Transaktion.
// ---------------------------------------------------------------------------

export interface PublishCommissionModelVersionResult {
  version: CommissionModelVersionDetail;
  /** ID der zuvor ACTIVE-Version DESSELBEN CommissionModel, die durch diesen Publish auf EXPIRED gesetzt wurde -- `null` beim allerersten Publish dieses CommissionModel. */
  previousActiveVersionId: string | null;
}

/**
 * Name des DB-EXCLUDE-Constraints (Migration `20260731000000_init`), der
 * strukturell garantiert, dass niemals zwei `CommissionModelVersion`s
 * DESSELBEN `CommissionModel` gleichzeitig ACTIVE/EXPIRED mit
 * ueberlappendem Gueltigkeitszeitraum sind (PRO CommissionModel gescopt,
 * nicht mandantenweit -- siehe `commission_model_versions_no_overlap` in
 * `prisma/schema.prisma`-Modulkommentar). Analog
 * `RULE_SET_VERSION_ACTIVE_NO_OVERLAP_CONSTRAINT` (Phase 9, rule-admin.ts).
 */
const COMMISSION_MODEL_VERSION_NO_OVERLAP_CONSTRAINT = "commission_model_versions_no_overlap";

/**
 * Uebersetzt NUR die bekannte, oben benannte EXCLUDE-Constraint-Verletzung
 * in einen fachlichen `CommissionModelVersionPublishConflictError` (409).
 * Jeder andere Fehler wird unveraendert weitergeworfen -- ChatGPT-Vorgabe
 * (Phase 9 AP9, hier identisch angewendet): "keinen pauschalen
 * PostgreSQL-/Prisma-Fehler auf 409 mappen". Exportiert (statt
 * modul-privat), damit diese Mapping-Logik deterministisch per Unit-Test
 * mit synthetischen Prisma-Fehlerobjekten abgedeckt werden kann -- analog
 * `translatePublishError()` aus rule-admin.ts.
 */
export function translatePublishError(error: unknown, versionId: string): never {
  const message =
    error instanceof Prisma.PrismaClientKnownRequestError ||
    error instanceof Prisma.PrismaClientUnknownRequestError
      ? error.message
      : undefined;
  if (message?.includes(COMMISSION_MODEL_VERSION_NO_OVERLAP_CONSTRAINT)) {
    throw new CommissionModelVersionPublishConflictError(versionId);
  }
  throw error;
}

export async function publishCommissionModelVersion(
  commissionModelId: string,
  versionId: string,
): Promise<PublishCommissionModelVersionResult> {
  await requireCommissionModel(db, commissionModelId);
  await requireDraftCommissionModelVersion(db, commissionModelId, versionId);

  // Serverseitige Revalidierung -- niemals nur auf eine vorherige
  // Client-Validierung vertrauen (identisches Prinzip wie Phase 8/9).
  await validateCommissionModelVersion(commissionModelId, versionId);

  const tenantId = getTenantId();
  const actorUserId = getTenantContext().userId;

  let previousActiveVersionId: string | null;
  try {
    previousActiveVersionId = await db.$transaction(async (tx) => {
      // Schritt 0: CommissionModel-Row-Lock (siehe Abschnittskommentar oben,
      // ChatGPT-Vorgabe AP5) -- MUSS die erste Operation dieser Transaktion
      // sein. Serialisiert alle Publish-Transaktionen DESSELBEN
      // CommissionModel. Rohes SQL ist hier zulaessig: `commissionModelId`
      // und `tenantId` stammen bereits aus dem validierten `TenantContext`
      // bzw. wurden oben ueber `requireCommissionModel()` (tenant-gescopt)
      // bestaetigt -- der zusaetzliche `tenant_id`-Filter im Raw-SQL ist
      // trotzdem bewusst gesetzt (anders als bei Phase 9s `tenants`-Zeile,
      // die ein GLOBAL_MODEL ist, ist `commission_models` mandantengebunden).
      await tx.$queryRaw`SELECT id FROM commission_models WHERE id = ${commissionModelId}::uuid AND tenant_id = ${tenantId}::uuid FOR UPDATE`;

      // Schritt 0b: `now` ERST NACH dem Lock-Erwerb bestimmen (siehe
      // Abschnittskommentar oben, Phase 13 AP10-Audit-Fund) -- NICHT davor.
      const now = new Date();

      // PRO-CommissionModel-Scope: bewusst MIT commissionModelId-Filter
      // (anders als Phase 9s mandantenweiter Scope) -- der tenant-gescopte
      // Client injiziert die tenantId bereits automatisch.
      const previousActive = await tx.commissionModelVersion.findFirst({
        where: { commissionModelId, status: "ACTIVE", id: { not: versionId } },
      });
      if (previousActive) {
        await tx.commissionModelVersion.update({
          where: { id: previousActive.id },
          data: { status: "EXPIRED", validTo: now },
        });
      }

      const activated = await tx.commissionModelVersion.updateMany({
        where: { id: versionId, status: "DRAFT" },
        data: { status: "ACTIVE", validFrom: now, validTo: null },
      });
      if (activated.count !== 1) {
        // Wurde zwischen der Vorab-Pruefung oben und hier bereits von einem
        // parallelen Request veroeffentlicht -- ROLLBACK macht Schritt (a)
        // rueckgaengig, kein Zwischenzustand persistiert.
        throw new CommissionModelVersionNotDraftError(
          versionId,
          "bereits veroeffentlicht (paralleler Publish-Versuch)",
        );
      }

      await tx.auditLog.create({
        data: {
          tenantId,
          actorUserId,
          action: "ACTIVATE",
          entityType: "CommissionModelVersion",
          entityId: versionId,
          metadata: {
            commissionModelId,
            previousActiveVersionId: previousActive ? previousActive.id : null,
          },
        },
      });

      return previousActive ? previousActive.id : null;
    });
  } catch (error) {
    // Faengt NUR den in translatePublishError() benannten, bekannten
    // EXCLUDE-Constraint-Konflikt ab und uebersetzt ihn in eine fachliche
    // 409-Antwort. Alle anderen Fehler werden unveraendert weitergeworfen.
    translatePublishError(error, versionId);
  }

  const version = await getCommissionModelVersionDetail(commissionModelId, versionId);
  return { version, previousActiveVersionId };
}

// Re-Export der internen Ladefunktionen unter einem Namespace-Objekt fuer
// AP3+ (vermeidet Umbenennung/Re-Import-Kollisionen mit gleichnamigen
// Helfern in rule-admin.ts/question-admin.ts, falls beide Module einmal im
// selben Aufrufkontext importiert werden).
export const commissionAdminInternal = {
  requireCommissionModel,
  requireCommissionModelVersion,
  requireDraftCommissionModelVersion,
  loadCommissionTiers,
};
