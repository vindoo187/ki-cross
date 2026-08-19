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

import { Prisma } from "@prisma/client";
import { db } from "../db/client";
import { getTenantContext, getTenantId } from "../tenant/context";
import type { ScopedPrismaClient } from "../tenant/scoped-client";
import { assertOperatorAllowedForAttribute } from "../recommendation/attribute-registry";
import { assertValidConditionSource } from "../recommendation/conditions";
import type { AnswerType, ConditionSourceType, VisibilityOperator } from "../recommendation/types";
import { isOperatorSupportedForAnswerType, splitComparisonList } from "../questionnaire/visibility";
import {
  AdminRuleNotFoundError,
  CopySourceRuleSetVersionNotFoundError,
  RollbackSourceNotEligibleError,
  RuleSetNotFoundError,
  RuleSetVersionInvalidError,
  RuleSetVersionNotDraftError,
  RuleSetVersionNotFoundError,
  RuleSetVersionPublishConflictError,
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

// ---------------------------------------------------------------------------
// 9. AP4 -- Serverseitiger Validator (Phase 9 AP4, siehe
//    PHASE_9_IMPLEMENTATION_PLAN.md Abschnitt 6). Rein lesend -- keine
//    Statusbeschraenkung (analog `validateDraftVersion()` in
//    question-admin.ts: auch bereits veroeffentlichte Versionen koennen zu
//    Regressionszwecken erneut geprueft werden), keine Mutation, kein
//    Publish.
//
// Vor-AP4-Code-Check (ChatGPT-Auflage 2026-08-18, "Validator und Runtime
// muessen dieselbe Mathematik haben"):
// - `PrioritizationRule.weight` wird in `prioritization.ts`
//   (`businessPriorityScore += rule.weight`) als reine Summe verwendet --
//   negative Werte werden mathematisch korrekt verarbeitet (mindern die
//   Summe), daher hier bewusst KEINE Nichtnegativ-Pruefung.
// - `EligibilityRule.fitWeight` wird in `fit-score.ts`
//   (`computeCustomerFitScore()`) dagegen laut Modulkommentar ausdruecklich
//   "als nicht-negativ vorausgesetzt" und per `Math.max(0, ...)` VOR jeder
//   Rechnung auf 0 abgeschnitten -- ein negativer Wert wuerde also
//   stillschweigend wirkungslos bleiben, statt (wie man annehmen koennte)
//   "gegen die Empfehlung zu sprechen". Um genau diese stille Divergenz
//   zwischen Regel-Autoring und tatsaechlicher Auswertung zu verhindern,
//   lehnt der Validator negative `fitWeight`-Werte ab (spiegelt die
//   bestehende Runtime-Semantik, erfindet keine neue).
// ---------------------------------------------------------------------------

/**
 * Fuehrt die vollstaendige fachliche Validierung einer `RuleSetVersion`
 * (beliebiger Status) aus. Sammelt ALLE gefundenen Verstoesse (analog
 * `validateQuestionnaireVersion()`, `src/server/questionnaire/service.ts`)
 * statt beim ersten Fehler abzubrechen und wirft bei mindestens einem Fund
 * `RuleSetVersionInvalidError` (bereits mit `issues: string[]`).
 *
 * Prueft je Regel/Condition:
 * - Struktur (`assertValidConditionSource()`, bestehend aus der
 *   Empfehlungs-Engine).
 * - ANSWER-Conditions: `questionId` muss zu einer Frage gehoeren, die in
 *   MINDESTENS EINER aktuell ACTIVE `QuestionnaireVersion` des Mandanten
 *   vorkommt (Vereinigung ueber alle `Questionnaire`s des Mandanten, siehe
 *   `loadActiveQuestionAnswerTypeMap()` -- `Questionnaire.key` ist in
 *   diesem Schema kein fixer Singleton, `POST
 *   /api/consultation/sessions` nimmt ihn als freien Parameter entgegen);
 *   Operator muss fuer den `AnswerType` der Frage zulaessig sein
 *   (`isOperatorSupportedForAnswerType()`, identisches Prinzip wie bei
 *   `VisibilityCondition`); bei SINGLE_CHOICE/MULTIPLE_CHOICE muessen
 *   referenzierte AnswerOption-Keys existieren.
 * - PRODUCT_ATTRIBUTE/SESSION_ATTRIBUTE-Conditions:
 *   `assertOperatorAllowedForAttribute()` (bestehend), zusaetzlich muss
 *   `comparisonValue` (bzw. jeder Wert bei IN/NOT_IN) gemaess dem
 *   `AttributeValueType` parsebar sein.
 * - `description` nicht leer (redundant zur Zod-Struktur-Validierung bei
 *   AP3, aber defensiv fuer per Deep-Copy uebernommene Altdaten).
 * - `EligibilityRule.fitWeight` nicht negativ (siehe Code-Check oben).
 * - `CrossSellingRule.priority` nicht negativ (ChatGPT-Entscheidung
 *   2026-08-18, siehe Plan Abschnitt 2.5).
 * - `ExclusionRule.reasonCode`-Eindeutigkeit je Version -- bereits durch
 *   den DB-UNIQUE-Constraint `exclusion_rules_tenant_id_rule_set_version_id_reason_code_key`
 *   strukturell ausgeschlossen; diese Pruefung ist bewusst redundant
 *   (verstaendlicher Validierungsfehler statt rohem DB-Fehler, falls der
 *   Constraint jemals entfaellt oder umgangen wird -- ChatGPT-Vorgabe
 *   2026-08-18).
 * - `CrossSellingRule.suggestedProductVersionId`, falls gesetzt: muss zu
 *   einer existierenden `ProductVersion` dieses Mandanten gehoeren --
 *   ebenfalls bereits durch die DB-FK abgesichert (`onDelete: SetNull`),
 *   hier defensiv erneut geprueft.
 * - Leerer Draft (keine einzige Regel in allen vier Typen).
 */
export async function validateDraftRuleSetVersion(
  ruleSetId: string,
  versionId: string,
): Promise<{ valid: true }> {
  await requireRuleSet(db, ruleSetId);
  const version = await requireRuleSetVersion(db, ruleSetId, versionId);
  const detail = await loadRuleSetVersionDetail(db, version);

  const issues: string[] = [];

  const totalRuleCount =
    detail.eligibilityRules.length +
    detail.exclusionRules.length +
    detail.prioritizationRules.length +
    detail.crossSellingRules.length;
  if (totalRuleCount === 0) {
    issues.push("RuleSetVersion enthaelt keine Regeln.");
  }

  const activeQuestions = await loadActiveQuestionAnswerTypeMap(db);

  function validateConditions(
    ruleLabel: string,
    ruleKey: string,
    conditions: RuleConditionDetail[],
  ): void {
    for (const condition of conditions) {
      const sourceType = condition.sourceType as ConditionSourceType;
      const operator = condition.operator as VisibilityOperator;
      const conditionInput = {
        id: condition.id,
        groupIndex: condition.groupIndex,
        sourceType,
        questionId: condition.questionId,
        attributeKey: condition.attributeKey,
        operator,
        comparisonValue: condition.comparisonValue,
      };

      try {
        assertValidConditionSource(conditionInput);
      } catch (err) {
        issues.push(
          `${ruleLabel} "${ruleKey}": ${err instanceof Error ? err.message : String(err)}`,
        );
        continue;
      }

      if (sourceType === "ANSWER") {
        const questionId = conditionInput.questionId as string;
        const question = activeQuestions.get(questionId);
        if (!question) {
          issues.push(
            `${ruleLabel} "${ruleKey}": Bedingung verweist auf Frage "${questionId}", die nicht Teil einer aktuell aktiven Fragebogen-Version dieses Mandanten ist.`,
          );
          continue;
        }
        if (!isOperatorSupportedForAnswerType(operator, question.answerType)) {
          issues.push(
            `${ruleLabel} "${ruleKey}": Operator "${operator}" ist fuer Frage "${questionId}" (Typ ${question.answerType}) nicht zulaessig.`,
          );
        }
        if (
          (question.answerType === "SINGLE_CHOICE" || question.answerType === "MULTIPLE_CHOICE") &&
          (["EQUALS", "NOT_EQUALS", "IN", "NOT_IN", "CONTAINS"] as const).includes(
            operator as never,
          )
        ) {
          const referenced = splitComparisonList(conditionInput.comparisonValue);
          const invalid = referenced.filter((r) => !question.answerOptionKeys.has(r));
          if (invalid.length > 0) {
            issues.push(
              `${ruleLabel} "${ruleKey}": Bedingung verweist auf ungueltige AnswerOption(en) "${invalid.join(", ")}" der Frage "${questionId}".`,
            );
          }
        }
        continue;
      }

      // PRODUCT_ATTRIBUTE | SESSION_ATTRIBUTE
      try {
        const definition = assertOperatorAllowedForAttribute(
          sourceType,
          conditionInput.attributeKey as string,
          operator,
        );
        if (operator !== "IS_ANSWERED" && operator !== "IS_NOT_ANSWERED") {
          const values =
            operator === "IN" || operator === "NOT_IN"
              ? splitComparisonList(conditionInput.comparisonValue)
              : [conditionInput.comparisonValue];
          for (const value of values) {
            definition.parse(value);
          }
        }
      } catch (err) {
        issues.push(
          `${ruleLabel} "${ruleKey}": ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }

  for (const rule of detail.eligibilityRules) {
    if (rule.description.trim().length === 0) {
      issues.push(`EligibilityRule "${rule.key}": description darf nicht leer sein.`);
    }
    if (rule.fitWeight < 0) {
      issues.push(
        `EligibilityRule "${rule.key}": fitWeight (${rule.fitWeight}) darf nicht negativ sein -- die Fit-Score-Berechnung (fit-score.ts) behandelt fitWeight als nichtnegative Groesse und wuerde einen negativen Wert stillschweigend auf 0 abschneiden.`,
      );
    }
    validateConditions("EligibilityRule", rule.key, rule.conditions);
  }

  const exclusionRuleKeysByReasonCode = new Map<string, string[]>();
  for (const rule of detail.exclusionRules) {
    if (rule.description.trim().length === 0) {
      issues.push(`ExclusionRule "${rule.key}": description darf nicht leer sein.`);
    }
    const keys = exclusionRuleKeysByReasonCode.get(rule.reasonCode) ?? [];
    keys.push(rule.key);
    exclusionRuleKeysByReasonCode.set(rule.reasonCode, keys);
    validateConditions("ExclusionRule", rule.key, rule.conditions);
  }
  for (const [reasonCode, keys] of exclusionRuleKeysByReasonCode) {
    if (keys.length > 1) {
      issues.push(
        `reasonCode "${reasonCode}" ist mehrfach vergeben (ExclusionRule(n): ${keys.join(", ")}) -- muss innerhalb einer RuleSetVersion eindeutig sein.`,
      );
    }
  }

  for (const rule of detail.prioritizationRules) {
    if (rule.description.trim().length === 0) {
      issues.push(`PrioritizationRule "${rule.key}": description darf nicht leer sein.`);
    }
    validateConditions("PrioritizationRule", rule.key, rule.conditions);
  }

  const referencedProductVersionIds = detail.crossSellingRules
    .map((rule) => rule.suggestedProductVersionId)
    .filter((id): id is string => id !== null);
  const existingProductVersionIds =
    referencedProductVersionIds.length > 0
      ? new Set(
          (
            await db.productVersion.findMany({
              where: { id: { in: referencedProductVersionIds } },
              select: { id: true },
            })
          ).map((p) => p.id),
        )
      : new Set<string>();

  for (const rule of detail.crossSellingRules) {
    if (rule.description.trim().length === 0) {
      issues.push(`CrossSellingRule "${rule.key}": description darf nicht leer sein.`);
    }
    if (rule.priority < 0) {
      issues.push(
        `CrossSellingRule "${rule.key}": priority (${rule.priority}) darf nicht negativ sein.`,
      );
    }
    if (
      rule.suggestedProductVersionId !== null &&
      !existingProductVersionIds.has(rule.suggestedProductVersionId)
    ) {
      issues.push(
        `CrossSellingRule "${rule.key}": suggestedProductVersionId "${rule.suggestedProductVersionId}" verweist auf keine existierende ProductVersion dieses Mandanten.`,
      );
    }
    validateConditions("CrossSellingRule", rule.key, rule.conditions);
  }

  if (issues.length > 0) {
    throw new RuleSetVersionInvalidError(versionId, issues);
  }
  return { valid: true };
}

/**
 * Laedt fuer jede Frage, die zu einer aktuell ACTIVE `QuestionnaireVersion`
 * dieses Mandanten gehoert (Vereinigung ueber ALLE `Questionnaire`s, siehe
 * Modulkommentar zu `validateDraftRuleSetVersion()`), die jeweils neueste
 * nicht-archivierte `QuestionVersion` (DRAFT/ACTIVE/EXPIRED), indiziert
 * nach `Question.id`. Fragen ohne gueltige `QuestionVersion` werden
 * uebersprungen -- das ist ein Fragebogen-Validierungsproblem
 * (`validateQuestionnaireVersion()`), nicht Aufgabe des Regel-Validators.
 */
async function loadActiveQuestionAnswerTypeMap(
  client: QueryClient,
): Promise<Map<string, { answerType: AnswerType; answerOptionKeys: ReadonlySet<string> }>> {
  const questions = await client.question.findMany({
    where: { questionnaireVersion: { status: "ACTIVE" } },
    include: {
      versions: {
        where: { status: { in: ["DRAFT", "ACTIVE", "EXPIRED"] } },
        include: { answerOptions: true },
        orderBy: [{ validFrom: "desc" }, { createdAt: "desc" }],
        take: 1,
      },
    },
  });

  const map = new Map<string, { answerType: AnswerType; answerOptionKeys: ReadonlySet<string> }>();
  for (const question of questions) {
    const version = question.versions[0];
    if (!version) continue;
    map.set(question.id, {
      answerType: version.answerType,
      answerOptionKeys: new Set(version.answerOptions.map((o) => o.key)),
    });
  }
  return map;
}

// ---------------------------------------------------------------------------
// 10. AP5 -- Publish-Workflow (Phase 9 AP5, siehe
//     PHASE_9_IMPLEMENTATION_PLAN.md Abschnitt 7). Analog
//     `publishDraftVersion()` (question-admin.ts, Phase 8 AP4) mit EINER
//     zentralen Abweichung, die ChatGPT als "kritischsten Teil der Phase"
//     bezeichnet hat (2026-08-18):
//
// MANDANTENWEITER ACTIVE-SCOPE (nicht pro-RuleSet): Die Invariante ist "pro
// Mandant existiert zu jedem Zeitpunkt hoechstens EINE ACTIVE
// RuleSetVersion" -- unabhaengig davon, zu welchem `RuleSet` sie gehoert
// (siehe PHASE_9_DISCOVERY.md Abschnitt 1, bereits in AP2 fuer
// `copyFromVersionId` beruecksichtigt). Der Publish eines Drafts aus
// RuleSet A muss daher die bisherige ACTIVE-Version eines BELIEBIGEN
// anderen RuleSets desselben Mandanten auf EXPIRED setzen -- die Suche
// nach `previousActive` filtert deshalb bewusst NICHT nach `ruleSetId`
// (einziger fachlicher Unterschied zu `publishDraftVersion()`, das dort
// gezielt nach `questionnaireId` filtert, weil die Questionnaire-ACTIVE-
// Uniqueness PRO Questionnaire gilt, siehe `questionnaire_versions_no_overlap`
// vs. `rule_set_versions_no_overlap`/`rule_set_versions_tenant_active_no_overlap`
// in prisma/schema.prisma).
//
// Transaktionsreihenfolge (identisch zu Phase 8, hier erneut angewendet,
// PLUS Schritt 2.0 -- siehe unten, ChatGPT-Befund 2026-08-19):
// 1. Serverseitige Revalidierung ueber `validateDraftRuleSetVersion()` VOR
//    der Transaktion (rein lesend) -- ein Validierungsfehler darf keine
//    Transaktion eroeffnen.
// 2. Innerhalb EINER Transaktion:
//    0. TENANT-ROW-LOCK (`SELECT ... FROM tenants WHERE id = $1 FOR UPDATE`,
//       siehe `RULE_SET_VERSION_ACTIVE_NO_OVERLAP_CONSTRAINT`-Kommentar
//       unten fuer den vollen Befund) -- serialisiert ALLE Publish-
//       Transaktionen desselben Mandanten, MUSS als erste Operation der
//       Transaktion stehen, vor Schritt (a).
//    a. Bisherige mandantenweite ACTIVE-Version (falls vorhanden, aus
//       EINEM BELIEBIGEN RuleSet) zuerst auf EXPIRED setzen (`validTo =
//       now`) -- MUSS vor (b) passieren, sonst schlaegt die EXCLUDE-
//       Constraint sofort fehl (zwei gleichzeitig offene ACTIVE-Zeitspannen
//       desselben Mandanten).
//    b. Ziel-Draft ueber `updateMany({where: {id, status: "DRAFT"}})` (nicht
//       `update()`) auf ACTIVE setzen -- schuetzt gegen einen parallelen
//       Publish-Versuch (Race Condition): `count !== 1` wirft, wodurch die
//       GESAMTE Transaktion inkl. Schritt (a) zurueckgerollt wird.
//    c. `AuditLog`-Eintrag (ACTIVATE) in DERSELBEN Transaktion.
//
// Anders als bei Questionnaire/Question gibt es hier KEINEN Schritt "Kind-
// Versionen aktivieren": die vier Regeltypen (EligibilityRule etc.) haben
// keinen eigenen Status -- nur die `RuleSetVersion` selbst wird versioniert.
// ---------------------------------------------------------------------------

export interface PublishRuleSetVersionResult {
  version: RuleSetVersionDetail;
  /** ID der zuvor ACTIVE-Version (aus EINEM BELIEBIGEN RuleSet dieses Mandanten), die durch diesen Publish auf EXPIRED gesetzt wurde -- `null` beim allerersten Publish des Mandanten. */
  previousActiveVersionId: string | null;
}

/**
 * Name des DB-EXCLUDE-Constraints (siehe Migration
 * `20260801130000_recommendation_engine/migration.sql`), der strukturell
 * garantiert, dass niemals zwei `RuleSetVersion`s desselben Mandanten
 * gleichzeitig ACTIVE sind -- auch nicht bei ECHTER Nebenlaeufigkeit
 * zwischen zwei VERSCHIEDENEN Drafts (der `updateMany`-count-Guard oben
 * schuetzt nur gegen den doppelten Publish DERSELBEN Version). Diese
 * Constraint ist in `schema.prisma` NICHT als `@@unique`/`@@index`
 * modelliert (raw SQL, GiST-Index) -- Prisma erkennt eine Verletzung daher
 * NICHT als bekannten Fehlercode (kein P2002), sondern wirft
 * `PrismaClientUnknownRequestError` mit dem rohen Postgres-Fehlertext.
 * Diese Konstante wird sowohl hier als auch (indirekt, per Instanceof) in
 * Tests referenziert.
 *
 * WICHTIGER NACHTRAG (ChatGPT-Befund, CI #53/#54, 2026-08-19): der
 * EXCLUDE-Constraint allein reicht NICHT als alleiniger Nebenlaeufigkeits-
 * Schutz, wenn zum Zeitpunkt des Publish noch KEINE vorherige ACTIVE-
 * Version existiert (`previousActive === null`). In diesem Fall gibt es
 * keine gemeinsame Zeile, auf die zwei parallele Publish-Transaktionen
 * sich synchronisieren -- beide `updateMany()`-Aufrufe auf ZWEI
 * VERSCHIEDENEN Draft-Zeilen koennen dann parallel erfolgreich committen,
 * bevor der GiST-Index die Ueberlappung erkennt (empirisch bestaetigt:
 * CI #53 zeigte 2 statt maximal 1 erfolgreichen Publish bei zwei echten
 * parallelen Aufrufen ohne vorherige ACTIVE-Version). Der
 * Diagnosetest in `tests/integration/rule-admin-publish.test.ts`
 * ("DIAGNOSE: EXCLUDE-Constraint ... existiert") bestaetigte, dass der
 * Constraint korrekt in CI vorhanden und definiert ist -- das Problem ist
 * also kein Migrations-/CI-Defekt, sondern eine echte Race-Condition-
 * Luecke. Fix: `publishRuleSetVersion()` sperrt jetzt zusaetzlich die
 * `tenants`-Zeile des aktuellen Mandanten (`SELECT ... FOR UPDATE`) als
 * ERSTE Operation der Transaktion -- diese Zeile existiert IMMER
 * (Voraussetzung fuer jeden aktiven `TenantContext`), anders als eine
 * vorherige ACTIVE-`RuleSetVersion`. Das serialisiert alle Publish-
 * Transaktionen desselben Mandanten vollstaendig, unabhaengig vom
 * jeweiligen `RuleSet`, und macht den EXCLUDE-Constraint zum reinen
 * Backstop (Verteidigung in der Tiefe) statt zum alleinigen Schutz.
 */
const RULE_SET_VERSION_ACTIVE_NO_OVERLAP_CONSTRAINT = "rule_set_versions_tenant_active_no_overlap";

/**
 * Uebersetzt NUR die bekannte, oben benannte EXCLUDE-Constraint-Verletzung
 * in einen fachlichen `RuleSetVersionPublishConflictError` (409). Jeder
 * andere Fehler wird unveraendert weitergeworfen -- ChatGPT-Vorgabe
 * 2026-08-18 (Phase 9 AP9): "keinen pauschalen PostgreSQL-/Prisma-Fehler
 * auf 409 mappen". Die Erkennung stuetzt sich bewusst NICHT auf einen
 * Prisma-Fehlercode (den gibt es fuer diese Constraint nicht, siehe oben),
 * sondern auf den Constraint-Namen in der Fehlermeldung -- das ist der
 * einzige stabile, spezifische Anker, den Prisma fuer einen von ihm nicht
 * modellierten DB-Constraint liefert.
 *
 * Exportiert (statt modul-privat), damit diese Mapping-Logik deterministisch
 * per Unit-Test mit synthetischen Prisma-Fehlerobjekten abgedeckt werden
 * kann -- ein echter EXCLUDE-Constraint-Konflikt laesst sich nicht
 * zuverlaessig/deterministisch ueber eine echte Nebenlaeufigkeitssituation
 * provozieren (siehe tests/integration/rule-admin-publish.test.ts, das den
 * echten Nebenlaeufigkeitsfall best-effort abdeckt, aber timing-abhaengig
 * ist).
 */
export function translatePublishError(error: unknown, versionId: string): never {
  const message =
    error instanceof Prisma.PrismaClientKnownRequestError ||
    error instanceof Prisma.PrismaClientUnknownRequestError
      ? error.message
      : undefined;
  if (message?.includes(RULE_SET_VERSION_ACTIVE_NO_OVERLAP_CONSTRAINT)) {
    throw new RuleSetVersionPublishConflictError(versionId);
  }
  throw error;
}

export async function publishRuleSetVersion(
  ruleSetId: string,
  versionId: string,
): Promise<PublishRuleSetVersionResult> {
  await requireRuleSet(db, ruleSetId);
  await requireDraftRuleSetVersion(db, ruleSetId, versionId);

  // Serverseitige Revalidierung -- niemals nur auf eine vorherige
  // Client-Validierung vertrauen (identisches Prinzip wie Phase 8 AP4).
  await validateDraftRuleSetVersion(ruleSetId, versionId);

  const tenantId = getTenantId();
  const actorUserId = getTenantContext().userId;
  const now = new Date();

  let previousActiveVersionId: string | null;
  try {
    previousActiveVersionId = await db.$transaction(async (tx) => {
      // Schritt 0: Tenant-Row-Lock (siehe RULE_SET_VERSION_ACTIVE_NO_OVERLAP_
      // CONSTRAINT-Kommentar oben, ChatGPT-Befund 2026-08-19) -- MUSS die
      // erste Operation dieser Transaktion sein. Serialisiert alle
      // Publish-Transaktionen desselben Mandanten (unabhaengig vom
      // jeweiligen RuleSet), da eine `tenants`-Zeile IMMER existiert --
      // anders als eine vorherige ACTIVE-RuleSetVersion, auf die sich zwei
      // parallele Publishes sonst nicht synchronisieren koennten. Rohes SQL
      // ist hier bewusst zulaessig: `Tenant` ist ein GLOBAL_MODEL (siehe
      // scoped-client.ts), die Tenant-Scoping-Regel fuer mandantengebundene
      // Modelle gilt dafuer nicht, und `tenantId` stammt bereits aus dem
      // validierten `TenantContext`.
      await tx.$queryRaw`SELECT id FROM tenants WHERE id = ${tenantId} FOR UPDATE`;

      // Mandantenweiter Scope: bewusst OHNE ruleSetId-Filter (siehe
      // Modulkommentar oben) -- der tenant-gescopte Client injiziert die
      // tenantId bereits automatisch.
      const previousActive = await tx.ruleSetVersion.findFirst({
        where: { status: "ACTIVE", id: { not: versionId } },
      });
      if (previousActive) {
        await tx.ruleSetVersion.update({
          where: { id: previousActive.id },
          data: { status: "EXPIRED", validTo: now },
        });
      }

      const activated = await tx.ruleSetVersion.updateMany({
        where: { id: versionId, status: "DRAFT" },
        data: { status: "ACTIVE", validFrom: now, validTo: null },
      });
      if (activated.count !== 1) {
        // Wurde zwischen der Vorab-Pruefung oben und hier bereits von einem
        // parallelen Request veroeffentlicht -- ROLLBACK macht Schritt (a)
        // rueckgaengig, kein Zwischenzustand persistiert.
        throw new RuleSetVersionNotDraftError(
          versionId,
          "bereits veroeffentlicht (paralleler Publish-Versuch)",
        );
      }

      await tx.auditLog.create({
        data: {
          tenantId,
          actorUserId,
          action: "ACTIVATE",
          entityType: "RuleSetVersion",
          entityId: versionId,
          metadata: {
            ruleSetId,
            previousActiveVersionId: previousActive ? previousActive.id : null,
          },
        },
      });

      return previousActive ? previousActive.id : null;
    });
  } catch (error) {
    // Faengt NUR den in translatePublishError() benannten, bekannten
    // EXCLUDE-Constraint-Konflikt ab und uebersetzt ihn in eine fachliche
    // 409-Antwort (siehe RuleSetVersionPublishConflictError-Kommentar) --
    // die gesamte Transaktion ist bei JEDEM Fehler (auch diesem) bereits
    // vollstaendig zurueckgerollt, bevor dieser catch-Block erreicht wird
    // (Prisma rollt eine `$transaction()`-Closure bei einem Wurf immer
    // vollstaendig zurueck). Alle anderen Fehler werden unveraendert
    // weitergeworfen.
    translatePublishError(error, versionId);
  }

  const version = await getRuleSetVersionDetail(ruleSetId, versionId);
  return { version, previousActiveVersionId };
}

// ---------------------------------------------------------------------------
// 11. AP6 -- Historie + Rollback (Phase 9 AP6, siehe
//     PHASE_9_IMPLEMENTATION_PLAN.md Abschnitt 8). Analog
//     `getQuestionnaireVersionHistory()`/`rollbackToVersion()`
//     (question-admin.ts, Phase 8 AP5) mit EINEM wichtigen Unterschied zu
//     AP2's `copyFromVersionId`: Rollback ist bewusst auf dasselbe `RuleSet`
//     beschraenkt (siehe Plan Abschnitt 2.3, "einer historischen ... Version
//     DESSELBEN RuleSet") -- anders als der mandantenweite Kopiermechanismus
//     aus AP2 (`createDraftRuleSetVersion({ copyFromVersionId })`), der
//     bewusst RuleSet-uebergreifend ist. `requireRuleSetVersion()` (nicht
//     die ruleSetId-unabhaengige `requireAnyRuleSetVersionInTenant()`)
//     erzwingt das strukturell: eine `sourceVersionId` aus einem ANDEREN
//     RuleSet liefert `RuleSetVersionNotFoundError` (404), Rollback schlaegt
//     fehl -- kein "Cross-RuleSet-Rollback" moeglich (ChatGPT-Vorgabe
//     2026-08-18, explizit als Regressionstest gefordert).
// ---------------------------------------------------------------------------

/**
 * Vollstaendige Versionshistorie eines `RuleSet` (alle Status, neueste
 * zuerst) -- rein lesend, keine Filterung nach Status. Grundlage fuer die
 * Versionshistorie-Ansicht in AP8.
 */
export async function getRuleSetVersionHistory(
  ruleSetId: string,
): Promise<RuleSetVersionSummary[]> {
  await requireRuleSet(db, ruleSetId);
  const versions = await db.ruleSetVersion.findMany({
    where: { ruleSetId },
    orderBy: { validFrom: "desc" },
  });
  return versions.map((v) => ({
    id: v.id,
    label: v.label,
    status: v.status,
    validFrom: v.validFrom.toISOString(),
    validTo: v.validTo ? v.validTo.toISOString() : null,
  }));
}

/**
 * Rollback: erzeugt eine neue `DRAFT`-Version als vollstaendige Tiefkopie
 * einer bereits veroeffentlichten historischen Version (`sourceVersionId`,
 * Status ACTIVE/EXPIRED/ARCHIVED -- DRAFT wird abgelehnt, siehe
 * `RollbackSourceNotEligibleError`) DESSELBEN `RuleSet`. Das ist KEIN
 * direkter Statuswechsel der alten Version zurueck auf ACTIVE, sondern
 * derselbe Tiefkopie-Mechanismus wie `createDraftRuleSetVersion({
 * copyFromVersionId })` (AP2, wiederverwendet ueber
 * `copyRuleSetVersionContents()`) -- die Historie wird dadurch an keiner
 * Stelle mutiert:
 *
 * - Die Quellversion (und alle ihre Regel-/Condition-Zeilen) bleibt
 *   UNVERAENDERT (kein UPDATE, kein DELETE).
 * - Die neue DRAFT-Version erhaelt eine EIGENE ID sowie komplett neue
 *   Regel-/Condition-Zeilen aller vier Typen (Tiefkopie).
 * - Die neue DRAFT-Version durchlaeuft anschliessend REGULAER den
 *   bestehenden Validate-/Publish-Workflow aus AP4/AP5 -- es gibt keine
 *   zweite/parallele Publish-Logik fuer Rollbacks.
 * - `AuditLog`-Eintrag (`action: "ROLLBACK"`) wird in DERSELBEN Transaktion
 *   wie die Tiefkopie geschrieben.
 *
 * Autorisierung: dieselbe wie jede andere Draft-Mutation
 * (`config.rules.edit`, siehe Route-Schicht) -- Rollback ist fachlich eine
 * Entwurfserstellung, kein Publish-Vorgang.
 *
 * Kein Session-Pinning betroffen (Leitplanke 2): diese Funktion mutiert
 * keine `ConsultationSession`-Zeile.
 */
export async function rollbackToRuleSetVersion(
  ruleSetId: string,
  sourceVersionId: string,
  label?: string,
): Promise<RuleSetVersionDetail> {
  await requireRuleSet(db, ruleSetId);
  const sourceVersion = await requireRuleSetVersion(db, ruleSetId, sourceVersionId);
  if (sourceVersion.status === "DRAFT") {
    throw new RollbackSourceNotEligibleError(sourceVersionId);
  }

  const tenantId = getTenantId();
  const actorUserId = getTenantContext().userId;
  const now = new Date();
  const resolvedLabel = label ?? `Rollback von "${sourceVersion.label}"`;

  const newVersionId = await db.$transaction(async (tx) => {
    const newVersion = await tx.ruleSetVersion.create({
      data: {
        tenantId,
        ruleSetId,
        label: resolvedLabel,
        status: "DRAFT",
        validFrom: now,
        validTo: null,
      },
    });

    const { ruleCount } = await copyRuleSetVersionContents(
      tx,
      tenantId,
      sourceVersionId,
      newVersion.id,
    );

    await tx.auditLog.create({
      data: {
        tenantId,
        actorUserId,
        action: "ROLLBACK",
        entityType: "RuleSetVersion",
        entityId: newVersion.id,
        metadata: {
          ruleSetId,
          sourceVersionId,
          sourceVersionStatus: sourceVersion.status,
          ruleCount,
        },
      },
    });

    return newVersion.id;
  });

  return getRuleSetVersionDetail(ruleSetId, newVersionId);
}
