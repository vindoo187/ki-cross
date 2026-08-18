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
  CopySourceRuleSetVersionNotFoundError,
  RuleSetNotFoundError,
  RuleSetVersionNotFoundError,
} from "./rule-admin-errors";
import type { CreateDraftRuleSetVersionInput } from "./rule-schemas";

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
