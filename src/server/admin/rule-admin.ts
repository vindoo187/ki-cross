/**
 * RuleSet-Management-Service (Phase 9 AP2, Versionsverwaltung) -- siehe
 * PHASE_9_IMPLEMENTATION_PLAN.md Abschnitt 4.
 *
 * DESIGN-ENTSCHEIDUNGEN (analog Phase 8 `question-admin.ts`, mit einer
 * zentralen Abweichung -- siehe unten):
 *
 * - Verwendet ausschliesslich den tenant-gescopten `db`-Client
 *   (`src/server/tenant/scoped-client.ts`). Jede Query wird dadurch
 *   automatisch um die `tenantId` des aktuellen `TenantContext` ergaenzt --
 *   eine per Request-Body/-Pfad mitgegebene `ruleSetId`/`versionId` aus
 *   einem FREMDEN Mandanten kann dadurch strukturell NICHT adressiert werden
 *   (0 Treffer -> `*NotFoundError`), selbst bei manipulierten IDs.
 *
 * - **Zentrale Abweichung von Phase 8 (ChatGPT-GO 2026-08-18, siehe
 *   PHASE_9_IMPLEMENTATION_PLAN.md Abschnitt 4):** `copyFromVersionId` in
 *   `createDraftRuleSetVersion()` darf zu einem ANDEREN `RuleSet` desselben
 *   Mandanten gehoeren als das Ziel-`RuleSet` -- Grund ist der mandantenweite
 *   (nicht pro-`RuleSet`) ACTIVE-Scope von `RuleSetVersion`
 *   (`PHASE_9_DISCOVERY.md` Abschnitt 1): "die aktuell aktive
 *   Regelkonfiguration des Mandanten" kann zu jedem beliebigen `RuleSet`
 *   gehoeren, und ein neuer Entwurf unter einem BELIEBIGEN `RuleSet` soll
 *   sie als Ausgangspunkt uebernehmen koennen. Die Kopiervorlage wird daher
 *   NICHT ueber `requireRuleSetVersion()` (das prueft `ruleSetId`-
 *   Zugehoerigkeit), sondern ueber eine eigene, ruleSetId-unabhaengige
 *   Ladefunktion aufgeloest (weiterhin tenant-gescopt -- Tenant-Isolation
 *   bleibt uneingeschraenkt bestehen).
 *
 * - Kein "DRAFT-only Mutation"-Guard in AP2: diese Datei mutiert ausschliesslich
 *   durch ANLEGEN einer neuen `RuleSetVersion` (immer im Status DRAFT) --
 *   es gibt hier (anders als bei `updateQuestionInDraft()`) keine Funktion,
 *   die eine BESTEHENDE Version inhaltlich veraendert. Dieser Guard kommt
 *   erst mit der Rule-CRUD-Schicht (AP3).
 *
 * - `requireConfigPermission("config.rules.*")` wird bewusst NICHT hier,
 *   sondern in der Route-Schicht aufgerufen (siehe
 *   src/app/api/admin/rule-sets/**), identisches Muster wie Phase 8.
 *
 * - Beim Deep-Copy (`copyRuleSetVersionContents()`) werden fuer alle vier
 *   Regeltypen FLACHE `createMany()`-Aufrufe fuer die Conditions verwendet
 *   (nicht verschachtelte `create` unter der Relation) -- composite
 *   Tenant-FKs akzeptieren `tenantId` in einem verschachtelten
 *   Relations-Create nicht (CI #39, Phase 8, hier erneut angewendet gemaess
 *   ChatGPT-Hinweis zu AP2: "Beim Deep-Copy wieder auf die zusammengesetzten
 *   Tenant-FKs achten").
 */

import { db } from "../db/client";
import { getTenantContext, getTenantId } from "../tenant/context";
import type { ScopedPrismaClient } from "../tenant/scoped-client";
import {
  AdminRuleNotFoundError,
  CopySourceRuleSetVersionNotFoundError,
  RuleSetNotFoundError,
  RuleSetVersionNotDraftError,
  RuleSetVersionNotFoundError,
} from "./rule-admin-errors";
import type {
  CreateCrossSellingRuleInput,
  CreateDraftRuleSetVersionInput,
  CreateEligibilityRuleInput,
  CreateExclusionRuleInput,
  CreatePrioritizationRuleInput,
  UpdateCrossSellingRuleInput,
  UpdateEligibilityRuleInput,
  UpdateExclusionRuleInput,
  UpdatePrioritizationRuleInput,
} from "./rule-schemas";

type ScopedTransactionClient = Parameters<Parameters<ScopedPrismaClient["$transaction"]>[0]>[0];
type QueryClient = ScopedTransactionClient;

// ---------------------------------------------------------------------------
// Oeffentliche DTOs
// ---------------------------------------------------------------------------

export interface RuleConditionDetail {
  id: string;
  groupIndex: number;
  sourceType: string;
  questionId: string | null;
  attributeKey: string | null;
  operator: string;
  comparisonValue: string;
}

export interface EligibilityRuleDetail {
  id: string;
  key: string;
  description: string;
  isRequired: boolean;
  fitWeight: number;
  isActive: boolean;
  conditions: RuleConditionDetail[];
}

export interface ExclusionRuleDetail {
  id: string;
  key: string;
  reasonCode: string;
  description: string;
  isActive: boolean;
  conditions: RuleConditionDetail[];
}

export interface PrioritizationRuleDetail {
  id: string;
  key: string;
  description: string;
  weight: number;
  commissionRequired: boolean;
  isActive: boolean;
  conditions: RuleConditionDetail[];
}

export interface CrossSellingRuleDetail {
  id: string;
  key: string;
  description: string;
  needType: string;
  priority: number;
  reasonCode: string;
  suggestedProductVersionId: string | null;
  isActive: boolean;
  conditions: RuleConditionDetail[];
}

export interface RuleSetVersionSummary {
  id: string;
  label: string;
  status: string;
  validFrom: string;
  validTo: string | null;
}

export interface RuleSetSummary {
  id: string;
  key: string;
  versions: RuleSetVersionSummary[];
}

export interface RuleSetVersionDetail {
  id: string;
  ruleSetId: string;
  label: string;
  status: string;
  validFrom: string;
  validTo: string | null;
  eligibilityRules: EligibilityRuleDetail[];
  exclusionRules: ExclusionRuleDetail[];
  prioritizationRules: PrioritizationRuleDetail[];
  crossSellingRules: CrossSellingRuleDetail[];
}

// ---------------------------------------------------------------------------
// Interne Ladefunktionen
// ---------------------------------------------------------------------------

function toConditionDetail(c: {
  id: string;
  groupIndex: number;
  sourceType: string;
  questionId: string | null;
  attributeKey: string | null;
  operator: string;
  comparisonValue: string;
}): RuleConditionDetail {
  return {
    id: c.id,
    groupIndex: c.groupIndex,
    sourceType: c.sourceType,
    questionId: c.questionId,
    attributeKey: c.attributeKey,
    operator: c.operator,
    comparisonValue: c.comparisonValue,
  };
}

async function requireRuleSet(client: QueryClient, ruleSetId: string) {
  const ruleSet = await client.ruleSet.findUnique({ where: { id: ruleSetId } });
  if (!ruleSet) {
    throw new RuleSetNotFoundError(ruleSetId);
  }
  return ruleSet;
}

/** Laedt eine `RuleSetVersion` und prueft, dass sie zum angegebenen `RuleSet` gehoert. */
async function requireRuleSetVersion(client: QueryClient, ruleSetId: string, versionId: string) {
  const version = await client.ruleSetVersion.findUnique({ where: { id: versionId } });
  if (!version || version.ruleSetId !== ruleSetId) {
    throw new RuleSetVersionNotFoundError(ruleSetId, versionId);
  }
  return version;
}

/**
 * Wie `requireRuleSetVersion()`, prueft zusaetzlich Status DRAFT (409 sonst)
 * -- fuer alle mutierenden Rule-CRUD-Operationen (AP3, ChatGPT-Auflage
 * 2026-08-18: "DRAFT-only fuer saemtliche Mutationen").
 */
async function requireDraftRuleSetVersion(
  client: QueryClient,
  ruleSetId: string,
  versionId: string,
) {
  const version = await requireRuleSetVersion(client, ruleSetId, versionId);
  if (version.status !== "DRAFT") {
    throw new RuleSetVersionNotDraftError(versionId, version.status);
  }
  return version;
}

/**
 * Laedt eine `RuleSetVersion` OHNE `ruleSetId`-Zugehoerigkeitspruefung --
 * ausschliesslich fuer `copyFromVersionId` in `createDraftRuleSetVersion()`
 * (siehe Modulkommentar, "Zentrale Abweichung von Phase 8"). Tenant-Isolation
 * bleibt unveraendert durch den gescopten `client` gewaehrleistet.
 */
async function requireAnyRuleSetVersionInTenant(client: QueryClient, versionId: string) {
  const version = await client.ruleSetVersion.findUnique({ where: { id: versionId } });
  if (!version) {
    throw new CopySourceRuleSetVersionNotFoundError(versionId);
  }
  return version;
}

async function loadRuleSetVersionDetail(
  client: QueryClient,
  version: {
    id: string;
    ruleSetId: string;
    label: string;
    status: string;
    validFrom: Date;
    validTo: Date | null;
  },
): Promise<RuleSetVersionDetail> {
  const [eligibilityRules, exclusionRules, prioritizationRules, crossSellingRules] =
    await Promise.all([
      client.eligibilityRule.findMany({
        where: { ruleSetVersionId: version.id },
        orderBy: { key: "asc" },
        include: { conditions: true },
      }),
      client.exclusionRule.findMany({
        where: { ruleSetVersionId: version.id },
        orderBy: { key: "asc" },
        include: { conditions: true },
      }),
      client.prioritizationRule.findMany({
        where: { ruleSetVersionId: version.id },
        orderBy: { key: "asc" },
        include: { conditions: true },
      }),
      client.crossSellingRule.findMany({
        where: { ruleSetVersionId: version.id },
        orderBy: { key: "asc" },
        include: { conditions: true },
      }),
    ]);

  return {
    id: version.id,
    ruleSetId: version.ruleSetId,
    label: version.label,
    status: version.status,
    validFrom: version.validFrom.toISOString(),
    validTo: version.validTo ? version.validTo.toISOString() : null,
    eligibilityRules: eligibilityRules.map((r) => ({
      id: r.id,
      key: r.key,
      description: r.description,
      isRequired: r.isRequired,
      fitWeight: r.fitWeight,
      isActive: r.isActive,
      conditions: r.conditions.map(toConditionDetail),
    })),
    exclusionRules: exclusionRules.map((r) => ({
      id: r.id,
      key: r.key,
      reasonCode: r.reasonCode,
      description: r.description,
      isActive: r.isActive,
      conditions: r.conditions.map(toConditionDetail),
    })),
    prioritizationRules: prioritizationRules.map((r) => ({
      id: r.id,
      key: r.key,
      description: r.description,
      weight: r.weight,
      commissionRequired: r.commissionRequired,
      isActive: r.isActive,
      conditions: r.conditions.map(toConditionDetail),
    })),
    crossSellingRules: crossSellingRules.map((r) => ({
      id: r.id,
      key: r.key,
      description: r.description,
      needType: r.needType,
      priority: r.priority,
      reasonCode: r.reasonCode,
      suggestedProductVersionId: r.suggestedProductVersionId,
      isActive: r.isActive,
      conditions: r.conditions.map(toConditionDetail),
    })),
  };
}

// ---------------------------------------------------------------------------
// 1. RuleSet-Liste
// ---------------------------------------------------------------------------

export async function listRuleSets(): Promise<RuleSetSummary[]> {
  const rows = await db.ruleSet.findMany({
    orderBy: { key: "asc" },
    include: { versions: { orderBy: { validFrom: "desc" } } },
  });
  return rows.map((rs) => ({
    id: rs.id,
    key: rs.key,
    versions: rs.versions.map((v) => ({
      id: v.id,
      label: v.label,
      status: v.status,
      validFrom: v.validFrom.toISOString(),
      validTo: v.validTo ? v.validTo.toISOString() : null,
    })),
  }));
}

// ---------------------------------------------------------------------------
// 2. Versions-Detailansicht
// ---------------------------------------------------------------------------

export async function getRuleSetVersionDetail(
  ruleSetId: string,
  versionId: string,
): Promise<RuleSetVersionDetail> {
  await requireRuleSet(db, ruleSetId);
  const version = await requireRuleSetVersion(db, ruleSetId, versionId);
  return loadRuleSetVersionDetail(db, version);
}

// ---------------------------------------------------------------------------
// 3. Neue DRAFT-Version anlegen (leer oder als Kopie -- ggf. RuleSet-uebergreifend)
// ---------------------------------------------------------------------------

/**
 * Tiefkopie aller vier Regeltypen (samt Conditions) einer Quellversion in
 * eine bereits angelegte (leere) `RuleSetVersion`. Die Quellversion kann zu
 * einem ANDEREN `RuleSet` gehoeren als die Zielversion (siehe
 * Modulkommentar) -- das ist unerheblich fuer die Kopie selbst, da nur
 * `ruleSetVersionId` auf die neue Zeile umgehaengt wird.
 * `suggestedProductVersionId` bei `CrossSellingRule` wird unveraendert
 * uebernommen (verweist auf eine `ProductVersion`, nicht auf etwas
 * Kopiertes).
 */
async function copyRuleSetVersionContents(
  tx: ScopedTransactionClient,
  tenantId: string,
  sourceVersionId: string,
  newVersionId: string,
): Promise<{ ruleCount: number }> {
  let ruleCount = 0;

  const eligibilityRules = await tx.eligibilityRule.findMany({
    where: { ruleSetVersionId: sourceVersionId },
    include: { conditions: true },
  });
  for (const rule of eligibilityRules) {
    const newRule = await tx.eligibilityRule.create({
      data: {
        tenantId,
        ruleSetVersionId: newVersionId,
        key: rule.key,
        description: rule.description,
        legacyExpression: rule.legacyExpression,
        isRequired: rule.isRequired,
        fitWeight: rule.fitWeight,
        isActive: rule.isActive,
      },
    });
    if (rule.conditions.length > 0) {
      await tx.eligibilityRuleCondition.createMany({
        data: rule.conditions.map((c) => ({
          tenantId,
          eligibilityRuleId: newRule.id,
          groupIndex: c.groupIndex,
          sourceType: c.sourceType,
          questionId: c.questionId,
          attributeKey: c.attributeKey,
          operator: c.operator,
          comparisonValue: c.comparisonValue,
        })),
      });
    }
    ruleCount += 1;
  }

  const exclusionRules = await tx.exclusionRule.findMany({
    where: { ruleSetVersionId: sourceVersionId },
    include: { conditions: true },
  });
  for (const rule of exclusionRules) {
    const newRule = await tx.exclusionRule.create({
      data: {
        tenantId,
        ruleSetVersionId: newVersionId,
        key: rule.key,
        reasonCode: rule.reasonCode,
        description: rule.description,
        legacyExpression: rule.legacyExpression,
        justificationParams: rule.justificationParams ?? undefined,
        isActive: rule.isActive,
      },
    });
    if (rule.conditions.length > 0) {
      await tx.exclusionRuleCondition.createMany({
        data: rule.conditions.map((c) => ({
          tenantId,
          exclusionRuleId: newRule.id,
          groupIndex: c.groupIndex,
          sourceType: c.sourceType,
          questionId: c.questionId,
          attributeKey: c.attributeKey,
          operator: c.operator,
          comparisonValue: c.comparisonValue,
        })),
      });
    }
    ruleCount += 1;
  }

  const prioritizationRules = await tx.prioritizationRule.findMany({
    where: { ruleSetVersionId: sourceVersionId },
    include: { conditions: true },
  });
  for (const rule of prioritizationRules) {
    const newRule = await tx.prioritizationRule.create({
      data: {
        tenantId,
        ruleSetVersionId: newVersionId,
        key: rule.key,
        description: rule.description,
        weight: rule.weight,
        legacyExpression: rule.legacyExpression,
        commissionRequired: rule.commissionRequired,
        isActive: rule.isActive,
      },
    });
    if (rule.conditions.length > 0) {
      await tx.prioritizationRuleCondition.createMany({
        data: rule.conditions.map((c) => ({
          tenantId,
          prioritizationRuleId: newRule.id,
          groupIndex: c.groupIndex,
          sourceType: c.sourceType,
          questionId: c.questionId,
          attributeKey: c.attributeKey,
          operator: c.operator,
          comparisonValue: c.comparisonValue,
        })),
      });
    }
    ruleCount += 1;
  }

  const crossSellingRules = await tx.crossSellingRule.findMany({
    where: { ruleSetVersionId: sourceVersionId },
    include: { conditions: true },
  });
  for (const rule of crossSellingRules) {
    const newRule = await tx.crossSellingRule.create({
      data: {
        tenantId,
        ruleSetVersionId: newVersionId,
        key: rule.key,
        description: rule.description,
        needType: rule.needType,
        priority: rule.priority,
        reasonCode: rule.reasonCode,
        suggestedProductVersionId: rule.suggestedProductVersionId,
        isActive: rule.isActive,
      },
    });
    if (rule.conditions.length > 0) {
      await tx.crossSellingRuleCondition.createMany({
        data: rule.conditions.map((c) => ({
          tenantId,
          crossSellingRuleId: newRule.id,
          groupIndex: c.groupIndex,
          sourceType: c.sourceType,
          questionId: c.questionId,
          attributeKey: c.attributeKey,
          operator: c.operator,
          comparisonValue: c.comparisonValue,
        })),
      });
    }
    ruleCount += 1;
  }

  return { ruleCount };
}

export async function createDraftRuleSetVersion(
  ruleSetId: string,
  input: CreateDraftRuleSetVersionInput,
): Promise<RuleSetVersionDetail> {
  await requireRuleSet(db, ruleSetId);
  const tenantId = getTenantId();
  const actorUserId = getTenantContext().userId;

  let sourceVersionId: string | null = null;
  if (input.copyFromVersionId) {
    // Bewusst KEIN requireRuleSetVersion(db, ruleSetId, ...) -- die
    // Kopiervorlage darf zu einem anderen RuleSet gehoeren, siehe
    // Modulkommentar. requireAnyRuleSetVersionInTenant() prueft weiterhin
    // Tenant-Zugehoerigkeit ueber den gescopten Client.
    const sourceVersion = await requireAnyRuleSetVersionInTenant(db, input.copyFromVersionId);
    sourceVersionId = sourceVersion.id;
  }

  const now = new Date();

  const newVersionId = await db.$transaction(async (tx) => {
    const newVersion = await tx.ruleSetVersion.create({
      data: {
        tenantId,
        ruleSetId,
        label: input.label,
        status: "DRAFT",
        validFrom: now,
        validTo: null,
      },
    });

    const { ruleCount } = sourceVersionId
      ? await copyRuleSetVersionContents(tx, tenantId, sourceVersionId, newVersion.id)
      : { ruleCount: 0 };

    // Phase 9 AP2 (analog Phase 8 AP7-Auflage, hier von Anfang an
    // eingebaut statt nachtraeglich): jeder Config-Write muss auditiert
    // sein, im selben Transaktionsschritt wie die Mutation.
    await tx.auditLog.create({
      data: {
        tenantId,
        actorUserId,
        action: "CREATE",
        entityType: "RuleSetVersion",
        entityId: newVersion.id,
        metadata: {
          ruleSetId,
          copyFromVersionId: sourceVersionId,
          ruleCount,
        },
      },
    });

    return newVersion.id;
  });

  return getRuleSetVersionDetail(ruleSetId, newVersionId);
}

// ---------------------------------------------------------------------------
// 4. Rule-CRUD fuer den flachen Condition-Baum (Phase 9 AP3, siehe
//    PHASE_9_IMPLEMENTATION_PLAN.md Abschnitt 5). Vier fast identische
//    Bloecke -- ein Block je Regeltyp, analog `addQuestionToDraft()`/
//    `updateQuestionInDraft()`/`removeQuestionFromDraft()` aus Phase 8
//    `question-admin.ts`. DRAFT-only (`requireDraftRuleSetVersion()`),
//    Audit im selben Transaktionsschritt wie jede Mutation, Conditions
//    werden bei Update vollstaendig ersetzt (delete+recreate, identisches
//    Prinzip wie AnswerOptions/VisibilityConditions in Phase 8).
// ---------------------------------------------------------------------------

// --- 4.1 EligibilityRule ----------------------------------------------------

export async function addEligibilityRuleToDraft(
  ruleSetId: string,
  versionId: string,
  input: CreateEligibilityRuleInput,
): Promise<EligibilityRuleDetail> {
  await requireRuleSet(db, ruleSetId);
  await requireDraftRuleSetVersion(db, ruleSetId, versionId);
  const tenantId = getTenantId();
  const actorUserId = getTenantContext().userId;

  const ruleId = await db.$transaction(async (tx) => {
    const rule = await tx.eligibilityRule.create({
      data: {
        tenantId,
        ruleSetVersionId: versionId,
        key: input.key,
        description: input.description,
        isRequired: input.isRequired,
        fitWeight: input.fitWeight,
        isActive: input.isActive,
      },
    });
    if (input.conditions.length > 0) {
      await tx.eligibilityRuleCondition.createMany({
        data: input.conditions.map((c) => ({
          tenantId,
          eligibilityRuleId: rule.id,
          groupIndex: c.groupIndex,
          sourceType: c.sourceType,
          questionId: c.questionId ?? null,
          attributeKey: c.attributeKey ?? null,
          operator: c.operator,
          comparisonValue: c.comparisonValue,
        })),
      });
    }
    await tx.auditLog.create({
      data: {
        tenantId,
        actorUserId,
        action: "CREATE",
        entityType: "EligibilityRule",
        entityId: rule.id,
        metadata: { ruleSetId, ruleSetVersionId: versionId, key: input.key },
      },
    });
    return rule.id;
  });

  return loadEligibilityRuleDetail(ruleId, versionId);
}

export async function updateEligibilityRuleInDraft(
  ruleSetId: string,
  versionId: string,
  ruleId: string,
  patch: UpdateEligibilityRuleInput,
): Promise<EligibilityRuleDetail> {
  await requireRuleSet(db, ruleSetId);
  await requireDraftRuleSetVersion(db, ruleSetId, versionId);
  const tenantId = getTenantId();
  const actorUserId = getTenantContext().userId;

  const existing = await db.eligibilityRule.findUnique({ where: { id: ruleId } });
  if (!existing || existing.ruleSetVersionId !== versionId) {
    throw new AdminRuleNotFoundError("EligibilityRule", ruleId, versionId);
  }

  await db.$transaction(async (tx) => {
    const fieldsChanged =
      patch.key !== undefined ||
      patch.description !== undefined ||
      patch.isRequired !== undefined ||
      patch.fitWeight !== undefined ||
      patch.isActive !== undefined;
    if (fieldsChanged) {
      await tx.eligibilityRule.update({
        where: { id: ruleId },
        data: {
          ...(patch.key !== undefined ? { key: patch.key } : {}),
          ...(patch.description !== undefined ? { description: patch.description } : {}),
          ...(patch.isRequired !== undefined ? { isRequired: patch.isRequired } : {}),
          ...(patch.fitWeight !== undefined ? { fitWeight: patch.fitWeight } : {}),
          ...(patch.isActive !== undefined ? { isActive: patch.isActive } : {}),
        },
      });
    }
    if (patch.conditions !== undefined) {
      await tx.eligibilityRuleCondition.deleteMany({ where: { eligibilityRuleId: ruleId } });
      if (patch.conditions.length > 0) {
        await tx.eligibilityRuleCondition.createMany({
          data: patch.conditions.map((c) => ({
            tenantId,
            eligibilityRuleId: ruleId,
            groupIndex: c.groupIndex,
            sourceType: c.sourceType,
            questionId: c.questionId ?? null,
            attributeKey: c.attributeKey ?? null,
            operator: c.operator,
            comparisonValue: c.comparisonValue,
          })),
        });
      }
    }
    await tx.auditLog.create({
      data: {
        tenantId,
        actorUserId,
        action: "UPDATE",
        entityType: "EligibilityRule",
        entityId: ruleId,
        metadata: { ruleSetId, ruleSetVersionId: versionId, changedFields: Object.keys(patch) },
      },
    });
  });

  return loadEligibilityRuleDetail(ruleId, versionId);
}

export async function removeEligibilityRuleFromDraft(
  ruleSetId: string,
  versionId: string,
  ruleId: string,
): Promise<void> {
  await requireRuleSet(db, ruleSetId);
  await requireDraftRuleSetVersion(db, ruleSetId, versionId);
  const tenantId = getTenantId();
  const actorUserId = getTenantContext().userId;

  const existing = await db.eligibilityRule.findUnique({ where: { id: ruleId } });
  if (!existing || existing.ruleSetVersionId !== versionId) {
    throw new AdminRuleNotFoundError("EligibilityRule", ruleId, versionId);
  }
  const ruleKey = existing.key;

  await db.$transaction(async (tx) => {
    await tx.eligibilityRuleCondition.deleteMany({ where: { eligibilityRuleId: ruleId } });
    await tx.eligibilityRule.delete({ where: { id: ruleId } });
    await tx.auditLog.create({
      data: {
        tenantId,
        actorUserId,
        action: "DELETE",
        entityType: "EligibilityRule",
        entityId: ruleId,
        metadata: {
          ruleSetId,
          ruleSetVersionId: versionId,
          key: ruleKey,
          reason: "removed_from_draft",
        },
      },
    });
  });
}

async function loadEligibilityRuleDetail(
  ruleId: string,
  versionId: string,
): Promise<EligibilityRuleDetail> {
  const row = await db.eligibilityRule.findUnique({
    where: { id: ruleId },
    include: { conditions: true },
  });
  if (!row) {
    throw new AdminRuleNotFoundError("EligibilityRule", ruleId, versionId);
  }
  return {
    id: row.id,
    key: row.key,
    description: row.description,
    isRequired: row.isRequired,
    fitWeight: row.fitWeight,
    isActive: row.isActive,
    conditions: row.conditions.map(toConditionDetail),
  };
}

// --- 4.2 ExclusionRule -------------------------------------------------------

export async function addExclusionRuleToDraft(
  ruleSetId: string,
  versionId: string,
  input: CreateExclusionRuleInput,
): Promise<ExclusionRuleDetail> {
  await requireRuleSet(db, ruleSetId);
  await requireDraftRuleSetVersion(db, ruleSetId, versionId);
  const tenantId = getTenantId();
  const actorUserId = getTenantContext().userId;

  const ruleId = await db.$transaction(async (tx) => {
    const rule = await tx.exclusionRule.create({
      data: {
        tenantId,
        ruleSetVersionId: versionId,
        key: input.key,
        reasonCode: input.reasonCode,
        description: input.description,
        isActive: input.isActive,
      },
    });
    if (input.conditions.length > 0) {
      await tx.exclusionRuleCondition.createMany({
        data: input.conditions.map((c) => ({
          tenantId,
          exclusionRuleId: rule.id,
          groupIndex: c.groupIndex,
          sourceType: c.sourceType,
          questionId: c.questionId ?? null,
          attributeKey: c.attributeKey ?? null,
          operator: c.operator,
          comparisonValue: c.comparisonValue,
        })),
      });
    }
    await tx.auditLog.create({
      data: {
        tenantId,
        actorUserId,
        action: "CREATE",
        entityType: "ExclusionRule",
        entityId: rule.id,
        metadata: { ruleSetId, ruleSetVersionId: versionId, key: input.key },
      },
    });
    return rule.id;
  });

  return loadExclusionRuleDetail(ruleId, versionId);
}

export async function updateExclusionRuleInDraft(
  ruleSetId: string,
  versionId: string,
  ruleId: string,
  patch: UpdateExclusionRuleInput,
): Promise<ExclusionRuleDetail> {
  await requireRuleSet(db, ruleSetId);
  await requireDraftRuleSetVersion(db, ruleSetId, versionId);
  const tenantId = getTenantId();
  const actorUserId = getTenantContext().userId;

  const existing = await db.exclusionRule.findUnique({ where: { id: ruleId } });
  if (!existing || existing.ruleSetVersionId !== versionId) {
    throw new AdminRuleNotFoundError("ExclusionRule", ruleId, versionId);
  }

  await db.$transaction(async (tx) => {
    const fieldsChanged =
      patch.key !== undefined ||
      patch.reasonCode !== undefined ||
      patch.description !== undefined ||
      patch.isActive !== undefined;
    if (fieldsChanged) {
      await tx.exclusionRule.update({
        where: { id: ruleId },
        data: {
          ...(patch.key !== undefined ? { key: patch.key } : {}),
          ...(patch.reasonCode !== undefined ? { reasonCode: patch.reasonCode } : {}),
          ...(patch.description !== undefined ? { description: patch.description } : {}),
          ...(patch.isActive !== undefined ? { isActive: patch.isActive } : {}),
        },
      });
    }
    if (patch.conditions !== undefined) {
      await tx.exclusionRuleCondition.deleteMany({ where: { exclusionRuleId: ruleId } });
      if (patch.conditions.length > 0) {
        await tx.exclusionRuleCondition.createMany({
          data: patch.conditions.map((c) => ({
            tenantId,
            exclusionRuleId: ruleId,
            groupIndex: c.groupIndex,
            sourceType: c.sourceType,
            questionId: c.questionId ?? null,
            attributeKey: c.attributeKey ?? null,
            operator: c.operator,
            comparisonValue: c.comparisonValue,
          })),
        });
      }
    }
    await tx.auditLog.create({
      data: {
        tenantId,
        actorUserId,
        action: "UPDATE",
        entityType: "ExclusionRule",
        entityId: ruleId,
        metadata: { ruleSetId, ruleSetVersionId: versionId, changedFields: Object.keys(patch) },
      },
    });
  });

  return loadExclusionRuleDetail(ruleId, versionId);
}

export async function removeExclusionRuleFromDraft(
  ruleSetId: string,
  versionId: string,
  ruleId: string,
): Promise<void> {
  await requireRuleSet(db, ruleSetId);
  await requireDraftRuleSetVersion(db, ruleSetId, versionId);
  const tenantId = getTenantId();
  const actorUserId = getTenantContext().userId;

  const existing = await db.exclusionRule.findUnique({ where: { id: ruleId } });
  if (!existing || existing.ruleSetVersionId !== versionId) {
    throw new AdminRuleNotFoundError("ExclusionRule", ruleId, versionId);
  }
  const ruleKey = existing.key;

  await db.$transaction(async (tx) => {
    await tx.exclusionRuleCondition.deleteMany({ where: { exclusionRuleId: ruleId } });
    await tx.exclusionRule.delete({ where: { id: ruleId } });
    await tx.auditLog.create({
      data: {
        tenantId,
        actorUserId,
        action: "DELETE",
        entityType: "ExclusionRule",
        entityId: ruleId,
        metadata: {
          ruleSetId,
          ruleSetVersionId: versionId,
          key: ruleKey,
          reason: "removed_from_draft",
        },
      },
    });
  });
}

async function loadExclusionRuleDetail(
  ruleId: string,
  versionId: string,
): Promise<ExclusionRuleDetail> {
  const row = await db.exclusionRule.findUnique({
    where: { id: ruleId },
    include: { conditions: true },
  });
  if (!row) {
    throw new AdminRuleNotFoundError("ExclusionRule", ruleId, versionId);
  }
  return {
    id: row.id,
    key: row.key,
    reasonCode: row.reasonCode,
    description: row.description,
    isActive: row.isActive,
    conditions: row.conditions.map(toConditionDetail),
  };
}

// --- 4.3 PrioritizationRule ---------------------------------------------------

export async function addPrioritizationRuleToDraft(
  ruleSetId: string,
  versionId: string,
  input: CreatePrioritizationRuleInput,
): Promise<PrioritizationRuleDetail> {
  await requireRuleSet(db, ruleSetId);
  await requireDraftRuleSetVersion(db, ruleSetId, versionId);
  const tenantId = getTenantId();
  const actorUserId = getTenantContext().userId;

  const ruleId = await db.$transaction(async (tx) => {
    const rule = await tx.prioritizationRule.create({
      data: {
        tenantId,
        ruleSetVersionId: versionId,
        key: input.key,
        description: input.description,
        weight: input.weight,
        commissionRequired: input.commissionRequired,
        isActive: input.isActive,
      },
    });
    if (input.conditions.length > 0) {
      await tx.prioritizationRuleCondition.createMany({
        data: input.conditions.map((c) => ({
          tenantId,
          prioritizationRuleId: rule.id,
          groupIndex: c.groupIndex,
          sourceType: c.sourceType,
          questionId: c.questionId ?? null,
          attributeKey: c.attributeKey ?? null,
          operator: c.operator,
          comparisonValue: c.comparisonValue,
        })),
      });
    }
    await tx.auditLog.create({
      data: {
        tenantId,
        actorUserId,
        action: "CREATE",
        entityType: "PrioritizationRule",
        entityId: rule.id,
        metadata: { ruleSetId, ruleSetVersionId: versionId, key: input.key },
      },
    });
    return rule.id;
  });

  return loadPrioritizationRuleDetail(ruleId, versionId);
}

export async function updatePrioritizationRuleInDraft(
  ruleSetId: string,
  versionId: string,
  ruleId: string,
  patch: UpdatePrioritizationRuleInput,
): Promise<PrioritizationRuleDetail> {
  await requireRuleSet(db, ruleSetId);
  await requireDraftRuleSetVersion(db, ruleSetId, versionId);
  const tenantId = getTenantId();
  const actorUserId = getTenantContext().userId;

  const existing = await db.prioritizationRule.findUnique({ where: { id: ruleId } });
  if (!existing || existing.ruleSetVersionId !== versionId) {
    throw new AdminRuleNotFoundError("PrioritizationRule", ruleId, versionId);
  }

  await db.$transaction(async (tx) => {
    const fieldsChanged =
      patch.key !== undefined ||
      patch.description !== undefined ||
      patch.weight !== undefined ||
      patch.commissionRequired !== undefined ||
      patch.isActive !== undefined;
    if (fieldsChanged) {
      await tx.prioritizationRule.update({
        where: { id: ruleId },
        data: {
          ...(patch.key !== undefined ? { key: patch.key } : {}),
          ...(patch.description !== undefined ? { description: patch.description } : {}),
          ...(patch.weight !== undefined ? { weight: patch.weight } : {}),
          ...(patch.commissionRequired !== undefined
            ? { commissionRequired: patch.commissionRequired }
            : {}),
          ...(patch.isActive !== undefined ? { isActive: patch.isActive } : {}),
        },
      });
    }
    if (patch.conditions !== undefined) {
      await tx.prioritizationRuleCondition.deleteMany({ where: { prioritizationRuleId: ruleId } });
      if (patch.conditions.length > 0) {
        await tx.prioritizationRuleCondition.createMany({
          data: patch.conditions.map((c) => ({
            tenantId,
            prioritizationRuleId: ruleId,
            groupIndex: c.groupIndex,
            sourceType: c.sourceType,
            questionId: c.questionId ?? null,
            attributeKey: c.attributeKey ?? null,
            operator: c.operator,
            comparisonValue: c.comparisonValue,
          })),
        });
      }
    }
    await tx.auditLog.create({
      data: {
        tenantId,
        actorUserId,
        action: "UPDATE",
        entityType: "PrioritizationRule",
        entityId: ruleId,
        metadata: { ruleSetId, ruleSetVersionId: versionId, changedFields: Object.keys(patch) },
      },
    });
  });

  return loadPrioritizationRuleDetail(ruleId, versionId);
}

export async function removePrioritizationRuleFromDraft(
  ruleSetId: string,
  versionId: string,
  ruleId: string,
): Promise<void> {
  await requireRuleSet(db, ruleSetId);
  await requireDraftRuleSetVersion(db, ruleSetId, versionId);
  const tenantId = getTenantId();
  const actorUserId = getTenantContext().userId;

  const existing = await db.prioritizationRule.findUnique({ where: { id: ruleId } });
  if (!existing || existing.ruleSetVersionId !== versionId) {
    throw new AdminRuleNotFoundError("PrioritizationRule", ruleId, versionId);
  }
  const ruleKey = existing.key;

  await db.$transaction(async (tx) => {
    await tx.prioritizationRuleCondition.deleteMany({ where: { prioritizationRuleId: ruleId } });
    await tx.prioritizationRule.delete({ where: { id: ruleId } });
    await tx.auditLog.create({
      data: {
        tenantId,
        actorUserId,
        action: "DELETE",
        entityType: "PrioritizationRule",
        entityId: ruleId,
        metadata: {
          ruleSetId,
          ruleSetVersionId: versionId,
          key: ruleKey,
          reason: "removed_from_draft",
        },
      },
    });
  });
}

async function loadPrioritizationRuleDetail(
  ruleId: string,
  versionId: string,
): Promise<PrioritizationRuleDetail> {
  const row = await db.prioritizationRule.findUnique({
    where: { id: ruleId },
    include: { conditions: true },
  });
  if (!row) {
    throw new AdminRuleNotFoundError("PrioritizationRule", ruleId, versionId);
  }
  return {
    id: row.id,
    key: row.key,
    description: row.description,
    weight: row.weight,
    commissionRequired: row.commissionRequired,
    isActive: row.isActive,
    conditions: row.conditions.map(toConditionDetail),
  };
}

// --- 4.4 CrossSellingRule ------------------------------------------------------

export async function addCrossSellingRuleToDraft(
  ruleSetId: string,
  versionId: string,
  input: CreateCrossSellingRuleInput,
): Promise<CrossSellingRuleDetail> {
  await requireRuleSet(db, ruleSetId);
  await requireDraftRuleSetVersion(db, ruleSetId, versionId);
  const tenantId = getTenantId();
  const actorUserId = getTenantContext().userId;

  const ruleId = await db.$transaction(async (tx) => {
    const rule = await tx.crossSellingRule.create({
      data: {
        tenantId,
        ruleSetVersionId: versionId,
        key: input.key,
        description: input.description,
        needType: input.needType,
        priority: input.priority,
        reasonCode: input.reasonCode,
        suggestedProductVersionId: input.suggestedProductVersionId ?? null,
        isActive: input.isActive,
      },
    });
    if (input.conditions.length > 0) {
      await tx.crossSellingRuleCondition.createMany({
        data: input.conditions.map((c) => ({
          tenantId,
          crossSellingRuleId: rule.id,
          groupIndex: c.groupIndex,
          sourceType: c.sourceType,
          questionId: c.questionId ?? null,
          attributeKey: c.attributeKey ?? null,
          operator: c.operator,
          comparisonValue: c.comparisonValue,
        })),
      });
    }
    await tx.auditLog.create({
      data: {
        tenantId,
        actorUserId,
        action: "CREATE",
        entityType: "CrossSellingRule",
        entityId: rule.id,
        metadata: { ruleSetId, ruleSetVersionId: versionId, key: input.key },
      },
    });
    return rule.id;
  });

  return loadCrossSellingRuleDetail(ruleId, versionId);
}

export async function updateCrossSellingRuleInDraft(
  ruleSetId: string,
  versionId: string,
  ruleId: string,
  patch: UpdateCrossSellingRuleInput,
): Promise<CrossSellingRuleDetail> {
  await requireRuleSet(db, ruleSetId);
  await requireDraftRuleSetVersion(db, ruleSetId, versionId);
  const tenantId = getTenantId();
  const actorUserId = getTenantContext().userId;

  const existing = await db.crossSellingRule.findUnique({ where: { id: ruleId } });
  if (!existing || existing.ruleSetVersionId !== versionId) {
    throw new AdminRuleNotFoundError("CrossSellingRule", ruleId, versionId);
  }

  await db.$transaction(async (tx) => {
    const fieldsChanged =
      patch.key !== undefined ||
      patch.description !== undefined ||
      patch.needType !== undefined ||
      patch.priority !== undefined ||
      patch.reasonCode !== undefined ||
      patch.suggestedProductVersionId !== undefined ||
      patch.isActive !== undefined;
    if (fieldsChanged) {
      await tx.crossSellingRule.update({
        where: { id: ruleId },
        data: {
          ...(patch.key !== undefined ? { key: patch.key } : {}),
          ...(patch.description !== undefined ? { description: patch.description } : {}),
          ...(patch.needType !== undefined ? { needType: patch.needType } : {}),
          ...(patch.priority !== undefined ? { priority: patch.priority } : {}),
          ...(patch.reasonCode !== undefined ? { reasonCode: patch.reasonCode } : {}),
          ...(patch.suggestedProductVersionId !== undefined
            ? { suggestedProductVersionId: patch.suggestedProductVersionId }
            : {}),
          ...(patch.isActive !== undefined ? { isActive: patch.isActive } : {}),
        },
      });
    }
    if (patch.conditions !== undefined) {
      await tx.crossSellingRuleCondition.deleteMany({ where: { crossSellingRuleId: ruleId } });
      if (patch.conditions.length > 0) {
        await tx.crossSellingRuleCondition.createMany({
          data: patch.conditions.map((c) => ({
            tenantId,
            crossSellingRuleId: ruleId,
            groupIndex: c.groupIndex,
            sourceType: c.sourceType,
            questionId: c.questionId ?? null,
            attributeKey: c.attributeKey ?? null,
            operator: c.operator,
            comparisonValue: c.comparisonValue,
          })),
        });
      }
    }
    await tx.auditLog.create({
      data: {
        tenantId,
        actorUserId,
        action: "UPDATE",
        entityType: "CrossSellingRule",
        entityId: ruleId,
        metadata: { ruleSetId, ruleSetVersionId: versionId, changedFields: Object.keys(patch) },
      },
    });
  });

  return loadCrossSellingRuleDetail(ruleId, versionId);
}

export async function removeCrossSellingRuleFromDraft(
  ruleSetId: string,
  versionId: string,
  ruleId: string,
): Promise<void> {
  await requireRuleSet(db, ruleSetId);
  await requireDraftRuleSetVersion(db, ruleSetId, versionId);
  const tenantId = getTenantId();
  const actorUserId = getTenantContext().userId;

  const existing = await db.crossSellingRule.findUnique({ where: { id: ruleId } });
  if (!existing || existing.ruleSetVersionId !== versionId) {
    throw new AdminRuleNotFoundError("CrossSellingRule", ruleId, versionId);
  }
  const ruleKey = existing.key;

  await db.$transaction(async (tx) => {
    await tx.crossSellingRuleCondition.deleteMany({ where: { crossSellingRuleId: ruleId } });
    await tx.crossSellingRule.delete({ where: { id: ruleId } });
    await tx.auditLog.create({
      data: {
        tenantId,
        actorUserId,
        action: "DELETE",
        entityType: "CrossSellingRule",
        entityId: ruleId,
        metadata: {
          ruleSetId,
          ruleSetVersionId: versionId,
          key: ruleKey,
          reason: "removed_from_draft",
        },
      },
    });
  });
}

async function loadCrossSellingRuleDetail(
  ruleId: string,
  versionId: string,
): Promise<CrossSellingRuleDetail> {
  const row = await db.crossSellingRule.findUnique({
    where: { id: ruleId },
    include: { conditions: true },
  });
  if (!row) {
    throw new AdminRuleNotFoundError("CrossSellingRule", ruleId, versionId);
  }
  return {
    id: row.id,
    key: row.key,
    description: row.description,
    needType: row.needType,
    priority: row.priority,
    reasonCode: row.reasonCode,
    suggestedProductVersionId: row.suggestedProductVersionId,
    isActive: row.isActive,
    conditions: row.conditions.map(toConditionDetail),
  };
}
