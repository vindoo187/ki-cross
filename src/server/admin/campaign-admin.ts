/**
 * Campaign-Management-Service (Phase 13 AP2, siehe
 * PHASE_13_IMPLEMENTATION_PLAN.md Abschnitt 3, ChatGPT-GO 2026-08-24 mit
 * 10 verbindlichen Leitplanken). Analog `commission-admin.ts` (Phase 10)
 * fuer den Draft/Publish-Lifecycle -- `CampaignVersion` ist PRO `Campaign`
 * gescoped (nicht mandantenweit wie Phase 9s `RuleSetVersion`), identisches
 * Publish-Scope-Muster wie `CommissionModelVersion` (EXCLUDE-Constraint
 * `campaign_versions_no_overlap`, siehe Migration `20260731000000_init`,
 * bereits seit dem Phase-2-Skelett vorhanden, in AP1 unveraendert
 * bestaetigt).
 *
 * `CampaignCondition` (Phase 13 AP1, ChatGPT-Detailentscheidung Punkt 1)
 * hat dieselbe Feldstruktur wie `EligibilityRuleCondition`
 * (`groupIndex`/`sourceType`/`questionId`/`attributeKey`/`operator`/
 * `comparisonValue`) -- diese Datei uebernimmt daher das Validierungs-
 * /CRUD-Muster aus `rule-admin.ts` (Phase 9): Bedingungen werden bei jedem
 * Update als GANZES ersetzt (Delete-All-Then-Recreate), keine granulare
 * Einzel-Patch-API pro Bedingung.
 *
 * `scopeId` ist bewusst KEIN Fremdschluessel (polymorph je nach
 * `scopeType: TENANT | STORE`, siehe `CampaignScopeType`, AP1) --
 * `validateScopeId()` unten prueft die serverseitige Tenant-Bindung, analog
 * `goal-admin.ts::validateScopeId()` (Phase 11 AP3):
 *   - TENANT -> scopeId MUSS exakt der aktuellen tenantId entsprechen.
 *   - STORE  -> Store MUSS existieren UND (durch den tenant-gescopten
 *     `db`-Client automatisch erzwungen) zum aktuellen Mandanten gehoeren.
 * `validateScopeId()` wird VOR jeder Mutation aufgerufen (Lesezugriff) --
 * bei ungueltigem Scope bleibt keine Mutation/kein Audit-Eintrag zurueck.
 *
 * AP4 (Rule-Engine-Integration, `CAMPAIGN_ACTIVE` in `ConditionSourceType`)
 * ist AUSDRUECKLICH NICHT Teil dieser Datei (ChatGPT-Leitplanke AP2, Punkt
 * 8) -- `CampaignCondition` beschreibt hier nur "wann ist DIESE Campaign
 * aktiv" (identische Semantik wie `EligibilityRuleCondition`), keine
 * Verknuepfung zur Empfehlungs-Engine. Ebenso ist Analytics (AP7,
 * `RecommendationCampaignSignal`) nicht Teil dieser Datei (Leitplanke
 * Punkt 9).
 *
 * Verwendet ausschliesslich den tenant-gescopten `db`-Client
 * (`src/server/tenant/scoped-client.ts`) -- eine per Request-Pfad
 * mitgegebene `campaignId`/`versionId`/`scopeId` aus einem FREMDEN
 * Mandanten kann dadurch strukturell NICHT adressiert werden (0 Treffer ->
 * `*NotFoundError`/`CampaignScopeInvalidError`).
 *
 * `requireConfigPermission("config.campaigns.*")` wird bewusst NICHT hier,
 * sondern in der Route-Schicht aufgerufen (AP3), identisches Muster wie
 * Phase 8-11.
 */

import { Prisma } from "@prisma/client";
import { db } from "../db/client";
import { getTenantContext, getTenantId } from "../tenant/context";
import type { ScopedPrismaClient } from "../tenant/scoped-client";
import { assertValidConditionSource } from "../recommendation/conditions";
import { assertOperatorAllowedForAttribute } from "../recommendation/attribute-registry";
import type { AnswerType, ConditionSourceType, VisibilityOperator } from "../recommendation/types";
import { isOperatorSupportedForAnswerType, splitComparisonList } from "../questionnaire/visibility";
import {
  CampaignKeyAlreadyExistsError,
  CampaignNotFoundError,
  CampaignScopeInvalidError,
  CampaignVersionInvalidError,
  CampaignVersionNotDraftError,
  CampaignVersionNotFoundError,
  CampaignVersionPublishConflictError,
  CopySourceCampaignVersionNotFoundError,
} from "./campaign-admin-errors";
import type {
  CampaignConditionInput,
  CreateCampaignInput,
  CreateDraftCampaignVersionInput,
  UpdateCampaignVersionFieldsInput,
} from "./campaign-schemas";

type ScopedTransactionClient = Parameters<Parameters<ScopedPrismaClient["$transaction"]>[0]>[0];
type QueryClient = ScopedTransactionClient;
type CampaignScopeType = "TENANT" | "STORE";

// ---------------------------------------------------------------------------
// Oeffentliche DTOs
// ---------------------------------------------------------------------------

export interface CampaignConditionDetail {
  id: string;
  groupIndex: number;
  sourceType: string;
  questionId: string | null;
  attributeKey: string | null;
  operator: string;
  comparisonValue: string;
}

export interface CampaignVersionSummary {
  id: string;
  versionNumber: number;
  status: string;
  scopeType: string;
  scopeId: string;
  validFrom: string;
  validTo: string | null;
}

export interface CampaignVersionDetail extends CampaignVersionSummary {
  campaignId: string;
  description: string | null;
  createdByUserId: string | null;
  conditions: CampaignConditionDetail[];
}

export interface CampaignSummary {
  id: string;
  key: string;
  name: string;
  versions: CampaignVersionSummary[];
}

// ---------------------------------------------------------------------------
// Interne Ladefunktionen
// ---------------------------------------------------------------------------

/** Laedt eine `Campaign` (tenant-gescopt via `client`). */
async function requireCampaign(client: QueryClient, campaignId: string) {
  const campaign = await client.campaign.findUnique({ where: { id: campaignId } });
  if (!campaign) {
    throw new CampaignNotFoundError(campaignId);
  }
  return campaign;
}

/** Laedt eine `CampaignVersion` und prueft, dass sie zur angegebenen `Campaign` gehoert. */
async function requireCampaignVersion(client: QueryClient, campaignId: string, versionId: string) {
  const version = await client.campaignVersion.findUnique({ where: { id: versionId } });
  if (!version || version.campaignId !== campaignId) {
    throw new CampaignVersionNotFoundError(campaignId, versionId);
  }
  return version;
}

/**
 * Wie `requireCampaignVersion()`, prueft zusaetzlich Status DRAFT (409
 * sonst) -- fuer alle mutierenden Campaign-Operationen (analog
 * `requireDraftCommissionModelVersion()`).
 */
async function requireDraftCampaignVersion(
  client: QueryClient,
  campaignId: string,
  versionId: string,
) {
  const version = await requireCampaignVersion(client, campaignId, versionId);
  if (version.status !== "DRAFT") {
    throw new CampaignVersionNotDraftError(versionId, version.status);
  }
  return version;
}

/**
 * Prueft die serverseitige Tenant-Bindung von `scopeId` fuer den
 * angegebenen `scopeType` (siehe Modulkommentar). Wirft
 * `CampaignScopeInvalidError`, falls die Zuordnung nicht gueltig ist. Reiner
 * Lesezugriff -- MUSS vor jeder Mutation aufgerufen werden, bevor eine
 * Transaktion eroeffnet wird (kein Zwischenzustand bei ungueltigem Scope).
 */
async function validateScopeId(
  client: QueryClient,
  tenantId: string,
  scopeType: CampaignScopeType,
  scopeId: string,
): Promise<void> {
  switch (scopeType) {
    case "TENANT": {
      if (scopeId !== tenantId) {
        throw new CampaignScopeInvalidError(scopeType, scopeId);
      }
      return;
    }
    case "STORE": {
      const store = await client.store.findUnique({ where: { id: scopeId } });
      if (!store) {
        throw new CampaignScopeInvalidError(scopeType, scopeId);
      }
      return;
    }
    default: {
      const exhaustiveCheck: never = scopeType;
      throw new CampaignScopeInvalidError(exhaustiveCheck, scopeId);
    }
  }
}

type CampaignVersionRow = {
  id: string;
  campaignId: string;
  versionNumber: number;
  status: string;
  scopeType: string;
  scopeId: string;
  validFrom: Date;
  validTo: Date | null;
  description: string | null;
  createdByUserId: string | null;
};

type CampaignConditionRow = {
  id: string;
  groupIndex: number;
  sourceType: string;
  questionId: string | null;
  attributeKey: string | null;
  operator: string;
  comparisonValue: string;
};

function toConditionDetail(c: CampaignConditionRow): CampaignConditionDetail {
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

function toVersionSummary(v: CampaignVersionRow): CampaignVersionSummary {
  return {
    id: v.id,
    versionNumber: v.versionNumber,
    status: v.status,
    scopeType: v.scopeType,
    scopeId: v.scopeId,
    validFrom: v.validFrom.toISOString(),
    validTo: v.validTo ? v.validTo.toISOString() : null,
  };
}

function toVersionDetail(
  v: CampaignVersionRow,
  conditions: CampaignConditionDetail[],
): CampaignVersionDetail {
  return {
    ...toVersionSummary(v),
    campaignId: v.campaignId,
    description: v.description,
    createdByUserId: v.createdByUserId,
    conditions,
  };
}

/** Laedt alle `CampaignCondition`-Zeilen EINER Version, aufsteigend nach `groupIndex`. */
async function loadCampaignConditions(
  client: QueryClient,
  campaignVersionId: string,
): Promise<CampaignConditionDetail[]> {
  const rows = await client.campaignCondition.findMany({
    where: { campaignVersionId },
    orderBy: [{ groupIndex: "asc" }, { id: "asc" }],
  });
  return rows.map(toConditionDetail);
}

// ---------------------------------------------------------------------------
// 1. Campaign-Liste (mit allen Versionen, Historie) + Anlegen
// ---------------------------------------------------------------------------

export async function listCampaigns(): Promise<CampaignSummary[]> {
  const rows = await db.campaign.findMany({
    orderBy: { name: "asc" },
    include: { versions: { orderBy: { versionNumber: "desc" } } },
  });
  return rows.map((c) => ({
    id: c.id,
    key: c.key,
    name: c.name,
    versions: c.versions.map(toVersionSummary),
  }));
}

/**
 * Legt die fachliche Identitaet einer neuen `Campaign` an (`key`/`name`,
 * ohne Version). `key` ist je Mandant eindeutig
 * (`campaigns_tenant_id_key_key`, siehe Migration `20260731000000_init`).
 */
export async function createCampaign(input: CreateCampaignInput): Promise<CampaignSummary> {
  const tenantId = getTenantId();
  const actorUserId = getTenantContext().userId;

  let campaignId: string;
  try {
    campaignId = await db.$transaction(async (tx) => {
      const created = await tx.campaign.create({
        data: { tenantId, key: input.key, name: input.name },
      });
      await tx.auditLog.create({
        data: {
          tenantId,
          actorUserId,
          action: "CREATE",
          entityType: "Campaign",
          entityId: created.id,
          metadata: { key: input.key },
        },
      });
      return created.id;
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      throw new CampaignKeyAlreadyExistsError(input.key);
    }
    throw err;
  }

  return { id: campaignId, key: input.key, name: input.name, versions: [] };
}

/** Vollstaendige Versionshistorie EINER `Campaign` (alle Status, neueste zuerst). */
export async function getCampaignVersionHistory(
  campaignId: string,
): Promise<CampaignVersionSummary[]> {
  await requireCampaign(db, campaignId);
  const versions = await db.campaignVersion.findMany({
    where: { campaignId },
    orderBy: { versionNumber: "desc" },
  });
  return versions.map(toVersionSummary);
}

// ---------------------------------------------------------------------------
// 2. Versions-Detailansicht
// ---------------------------------------------------------------------------

export async function getCampaignVersionDetail(
  campaignId: string,
  versionId: string,
): Promise<CampaignVersionDetail> {
  await requireCampaign(db, campaignId);
  const version = await requireCampaignVersion(db, campaignId, versionId);
  const conditions = await loadCampaignConditions(db, versionId);
  return toVersionDetail(version, conditions);
}

// ---------------------------------------------------------------------------
// 3. Neue DRAFT-Version anlegen (leer, mit Bedingungen, oder als Kopie)
// ---------------------------------------------------------------------------

/**
 * `copyFromVersionId` (falls gesetzt) muss zu DERSELBEN `campaignId`
 * gehoeren (per-Entity-Publish-Scope, analog
 * `createDraftCommissionModelVersion()`). Bedingungs-Uebernahme siehe
 * `createDraftCampaignVersionSchema`-Modulkommentar (`campaign-schemas.ts`):
 * explizit angegebene `conditions` gewinnen immer; erst wenn `conditions`
 * weggelassen wurde UND `copyFromVersionId` gesetzt ist, werden die
 * Bedingungen der Kopiervorlage serverseitig deep-kopiert (Rollback-Flow).
 *
 * Concurrency-sichere `versionNumber`-Vergabe per Campaign-Row-Lock
 * (identisches Muster wie `createDraftCommissionModelVersion()`, Phase 10
 * AP9-Fix-Lehre): MUSS die erste Operation der Transaktion sein, sonst
 * koennen zwei parallele Aufrufe fuer DIESELBE Campaign denselben
 * `MAX(versionNumber)` lesen, bevor einer committet.
 */
export async function createDraftCampaignVersion(
  campaignId: string,
  input: CreateDraftCampaignVersionInput,
): Promise<CampaignVersionDetail> {
  await requireCampaign(db, campaignId);
  const tenantId = getTenantId();
  const actorUserId = getTenantContext().userId;

  await validateScopeId(db, tenantId, input.scopeType, input.scopeId);

  let sourceConditions: CampaignConditionDetail[] = [];
  if (input.copyFromVersionId) {
    const sourceVersion = await db.campaignVersion.findUnique({
      where: { id: input.copyFromVersionId },
    });
    if (!sourceVersion || sourceVersion.campaignId !== campaignId) {
      throw new CopySourceCampaignVersionNotFoundError(input.copyFromVersionId);
    }
    if (input.conditions === undefined) {
      sourceConditions = await loadCampaignConditions(db, input.copyFromVersionId);
    }
  }

  const resolvedConditions: CampaignConditionInput[] =
    input.conditions !== undefined
      ? input.conditions
      : sourceConditions.map((c) => ({
          groupIndex: c.groupIndex,
          sourceType: c.sourceType as ConditionSourceType,
          questionId: c.questionId,
          attributeKey: c.attributeKey,
          operator: c.operator as VisibilityOperator,
          comparisonValue: c.comparisonValue,
        }));

  const now = new Date();

  const newVersionId = await db.$transaction(async (tx) => {
    // Schritt 0: Campaign-Row-Lock, siehe Funktionskommentar oben -- MUSS
    // die erste Operation dieser Transaktion sein.
    await tx.$queryRaw`SELECT id FROM campaigns WHERE id = ${campaignId}::uuid AND tenant_id = ${tenantId}::uuid FOR UPDATE`;

    const lastVersion = await tx.campaignVersion.findFirst({
      where: { campaignId },
      orderBy: { versionNumber: "desc" },
      select: { versionNumber: true },
    });
    const nextVersionNumber = (lastVersion?.versionNumber ?? 0) + 1;

    const newVersion = await tx.campaignVersion.create({
      data: {
        tenantId,
        campaignId,
        versionNumber: nextVersionNumber,
        status: "DRAFT",
        scopeType: input.scopeType,
        scopeId: input.scopeId,
        validFrom: now,
        validTo: null,
        description: input.description ?? null,
        createdByUserId: actorUserId,
      },
    });

    if (resolvedConditions.length > 0) {
      await tx.campaignCondition.createMany({
        data: resolvedConditions.map((c) => ({
          tenantId,
          campaignVersionId: newVersion.id,
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
        entityType: "CampaignVersion",
        entityId: newVersion.id,
        metadata: {
          campaignId,
          copyFromVersionId: input.copyFromVersionId ?? null,
          versionNumber: nextVersionNumber,
          conditionCount: resolvedConditions.length,
        },
      },
    });

    return newVersion.id;
  });

  return getCampaignVersionDetail(campaignId, newVersionId);
}

// ---------------------------------------------------------------------------
// 4. Feld-CRUD: Skalarfelder + Bedingungen einer DRAFT-Version aendern
// ---------------------------------------------------------------------------

/**
 * Partielles Update EINER bestehenden DRAFT-`CampaignVersion`. `scopeType`/
 * `scopeId` werden auf dem ZUSAMMENGEFUEHRTEN Ergebniszustand re-validiert
 * (falls eines von beiden im Patch enthalten ist -- ein Patch mit nur
 * `scopeId` muss weiterhin gegen den ggf. unveraenderten `scopeType`
 * geprueft werden). `conditions`, falls angegeben, ERSETZT die GESAMTE
 * bestehende Liste (siehe `campaign-schemas.ts`-Modulkommentar).
 */
export async function updateCampaignVersionFields(
  campaignId: string,
  versionId: string,
  patch: UpdateCampaignVersionFieldsInput,
): Promise<CampaignVersionDetail> {
  await requireCampaign(db, campaignId);
  const current = await requireDraftCampaignVersion(db, campaignId, versionId);
  const tenantId = getTenantId();
  const actorUserId = getTenantContext().userId;

  const resultingScopeType = (patch.scopeType ?? current.scopeType) as CampaignScopeType;
  const resultingScopeId = patch.scopeId ?? current.scopeId;
  if (patch.scopeType !== undefined || patch.scopeId !== undefined) {
    await validateScopeId(db, tenantId, resultingScopeType, resultingScopeId);
  }

  await db.$transaction(async (tx) => {
    const fieldsChanged =
      patch.scopeType !== undefined ||
      patch.scopeId !== undefined ||
      patch.description !== undefined;
    if (fieldsChanged) {
      await tx.campaignVersion.update({
        where: { id: versionId },
        data: {
          ...(patch.scopeType !== undefined ? { scopeType: patch.scopeType } : {}),
          ...(patch.scopeId !== undefined ? { scopeId: patch.scopeId } : {}),
          ...(patch.description !== undefined ? { description: patch.description } : {}),
        },
      });
    }

    if (patch.conditions !== undefined) {
      await tx.campaignCondition.deleteMany({ where: { campaignVersionId: versionId } });
      if (patch.conditions.length > 0) {
        await tx.campaignCondition.createMany({
          data: patch.conditions.map((c) => ({
            tenantId,
            campaignVersionId: versionId,
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
        entityType: "CampaignVersion",
        entityId: versionId,
        metadata: { campaignId, changedFields: Object.keys(patch) },
      },
    });
  });

  return getCampaignVersionDetail(campaignId, versionId);
}

// ---------------------------------------------------------------------------
// 5. Serverseitige Validierung (vor Publish)
// ---------------------------------------------------------------------------

/**
 * Laedt fuer jede Frage, die zu einer aktuell ACTIVE `QuestionnaireVersion`
 * dieses Mandanten gehoert, die jeweils neueste nicht-archivierte
 * `QuestionVersion` (DRAFT/ACTIVE/EXPIRED), indiziert nach `Question.id` --
 * eigene, modul-lokale Kopie von `rule-admin.ts::loadActiveQuestionAnswerTypeMap()`
 * (dort nicht exportiert, gleiches Trennungsprinzip wie bei den
 * Fehlerklassen: keine Kopplung zwischen den Fachadministrations-Domaenen).
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

/**
 * Strukturelle Validierung der `CampaignCondition`-Bedingungen EINER
 * Version -- identisches Prinzip wie `validateDraftRuleSetVersion()`
 * (Phase 9 AP4), aber ohne die dortigen RuleSet-spezifischen Pruefungen
 * (kein `description`-Pflichtfeld, kein `fitWeight`/`priority`,
 * fachlich sind `CampaignCondition`s die einzige zu pruefende Struktur).
 * Ein `Campaign` OHNE Bedingungen ist gueltig (siehe
 * `campaign-schemas.ts`-Modulkommentar). Wird von `publishCampaignVersion()`
 * VOR jeder Publish-Transaktion aufgerufen (serverseitige Revalidierung,
 * niemals nur auf eine vorherige Client-Validierung vertrauen).
 */
export async function validateCampaignVersion(
  campaignId: string,
  versionId: string,
): Promise<{ valid: true }> {
  await requireCampaign(db, campaignId);
  await requireCampaignVersion(db, campaignId, versionId);
  const conditions = await loadCampaignConditions(db, versionId);

  const issues: string[] = [];
  const activeQuestions = await loadActiveQuestionAnswerTypeMap(db);

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
      issues.push(`Bedingung: ${err instanceof Error ? err.message : String(err)}`);
      continue;
    }

    if (sourceType === "ANSWER") {
      const questionId = conditionInput.questionId as string;
      const question = activeQuestions.get(questionId);
      if (!question) {
        issues.push(
          `Bedingung verweist auf Frage "${questionId}", die nicht Teil einer aktuell aktiven Fragebogen-Version dieses Mandanten ist.`,
        );
        continue;
      }
      if (!isOperatorSupportedForAnswerType(operator, question.answerType)) {
        issues.push(
          `Operator "${operator}" ist fuer Frage "${questionId}" (Typ ${question.answerType}) nicht zulaessig.`,
        );
      }
      if (
        (question.answerType === "SINGLE_CHOICE" || question.answerType === "MULTIPLE_CHOICE") &&
        (["EQUALS", "NOT_EQUALS", "IN", "NOT_IN", "CONTAINS"] as const).includes(operator as never)
      ) {
        const referenced = splitComparisonList(conditionInput.comparisonValue);
        const invalid = referenced.filter((r) => !question.answerOptionKeys.has(r));
        if (invalid.length > 0) {
          issues.push(
            `Bedingung verweist auf ungueltige AnswerOption(en) "${invalid.join(", ")}" der Frage "${questionId}".`,
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
      issues.push(`Bedingung: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (issues.length > 0) {
    throw new CampaignVersionInvalidError(versionId, issues);
  }
  return { valid: true };
}

// ---------------------------------------------------------------------------
// 6. Publish (per-Campaign-Scope, analog publishCommissionModelVersion())
// ---------------------------------------------------------------------------

export interface PublishCampaignVersionResult {
  version: CampaignVersionDetail;
  /** ID der zuvor ACTIVE-Version DERSELBEN Campaign, die durch diesen Publish auf EXPIRED gesetzt wurde -- `null` beim allerersten Publish dieser Campaign. */
  previousActiveVersionId: string | null;
}

/**
 * Name des DB-EXCLUDE-Constraints (Migration `20260731000000_init`), der
 * strukturell garantiert, dass niemals zwei `CampaignVersion`s DERSELBEN
 * `Campaign` gleichzeitig ACTIVE/EXPIRED mit ueberlappendem
 * Gueltigkeitszeitraum sind (PRO Campaign gescopt, siehe AP1-Migrations-
 * Kommentar). Analog `COMMISSION_MODEL_VERSION_NO_OVERLAP_CONSTRAINT`.
 */
const CAMPAIGN_VERSION_NO_OVERLAP_CONSTRAINT = "campaign_versions_no_overlap";

/**
 * Uebersetzt NUR die bekannte, oben benannte EXCLUDE-Constraint-Verletzung
 * in einen fachlichen `CampaignVersionPublishConflictError` (409). Jeder
 * andere Fehler wird unveraendert weitergeworfen (ChatGPT-Vorgabe, analog
 * Phase 9/10: "keinen pauschalen PostgreSQL-/Prisma-Fehler auf 409
 * mappen"). Exportiert, damit dieses Mapping deterministisch per Unit-Test
 * mit synthetischen Prisma-Fehlerobjekten abgedeckt werden kann.
 */
export function translatePublishError(error: unknown, versionId: string): never {
  const message =
    error instanceof Prisma.PrismaClientKnownRequestError ||
    error instanceof Prisma.PrismaClientUnknownRequestError
      ? error.message
      : undefined;
  if (message?.includes(CAMPAIGN_VERSION_NO_OVERLAP_CONSTRAINT)) {
    throw new CampaignVersionPublishConflictError(versionId);
  }
  throw error;
}

/**
 * Veroeffentlicht eine DRAFT-`CampaignVersion` (setzt sie auf ACTIVE,
 * expiret die bisherige ACTIVE-Version DERSELBEN Campaign). Reihenfolge
 * (ChatGPT-Leitplanke AP2, Punkt 5: "Publish muss atomar mit allen
 * zugehoerigen Conditions erfolgen"):
 * 1. Serverseitige Revalidierung ueber `validateCampaignVersion()` VOR der
 *    Transaktion (rein lesend) -- ein Validierungsfehler darf keine
 *    Transaktion eroeffnen.
 * 2. Innerhalb EINER Transaktion:
 *    0. Campaign-Row-Lock (`SELECT id FROM campaigns WHERE id = $1 AND
 *       tenant_id = $2 FOR UPDATE`) -- MUSS die erste Operation sein.
 *    a. Bisherige ACTIVE-Version DERSELBEN Campaign (falls vorhanden)
 *       zuerst auf EXPIRED setzen (`validTo = now`) -- MUSS vor (b)
 *       passieren, sonst schlaegt die EXCLUDE-Constraint sofort fehl.
 *    b. Ziel-Draft ueber `updateMany({where: {id, status: "DRAFT"}})` auf
 *       ACTIVE setzen -- `count !== 1` wirft (paralleler Publish-Versuch
 *       DERSELBEN Version), rollt die GESAMTE Transaktion inkl. Schritt (a)
 *       zurueck. Die zugehoerigen `CampaignCondition`-Zeilen werden dabei
 *       NICHT separat mutiert -- sie sind bereits Teil der DRAFT-Version
 *       (angelegt/ersetzt ueber `createDraftCampaignVersion()`/
 *       `updateCampaignVersionFields()`) und werden durch den Status-
 *       Wechsel der Version implizit mit "veroeffentlicht" (Atomaritaet
 *       ergibt sich daraus, dass Version + Conditions in DERSELBEN
 *       Transaktion aktiviert bzw. bei Fehlschlag zurueckgerollt werden).
 *    c. `AuditLog`-Eintrag (ACTIVATE) in DERSELBEN Transaktion.
 */
export async function publishCampaignVersion(
  campaignId: string,
  versionId: string,
): Promise<PublishCampaignVersionResult> {
  await requireCampaign(db, campaignId);
  await requireDraftCampaignVersion(db, campaignId, versionId);

  // Serverseitige Revalidierung -- niemals nur auf eine vorherige
  // Client-Validierung vertrauen (identisches Prinzip wie Phase 8-10).
  await validateCampaignVersion(campaignId, versionId);

  const tenantId = getTenantId();
  const actorUserId = getTenantContext().userId;
  const now = new Date();

  let previousActiveVersionId: string | null;
  try {
    previousActiveVersionId = await db.$transaction(async (tx) => {
      // Schritt 0: Campaign-Row-Lock (siehe Funktionskommentar oben) --
      // MUSS die erste Operation dieser Transaktion sein. Serialisiert
      // alle Publish-Transaktionen DERSELBEN Campaign.
      await tx.$queryRaw`SELECT id FROM campaigns WHERE id = ${campaignId}::uuid AND tenant_id = ${tenantId}::uuid FOR UPDATE`;

      const previousActive = await tx.campaignVersion.findFirst({
        where: { campaignId, status: "ACTIVE", id: { not: versionId } },
      });
      if (previousActive) {
        await tx.campaignVersion.update({
          where: { id: previousActive.id },
          data: { status: "EXPIRED", validTo: now },
        });
      }

      const activated = await tx.campaignVersion.updateMany({
        where: { id: versionId, status: "DRAFT" },
        data: { status: "ACTIVE", validFrom: now, validTo: null },
      });
      if (activated.count !== 1) {
        // Wurde zwischen der Vorab-Pruefung oben und hier bereits von
        // einem parallelen Request veroeffentlicht -- ROLLBACK macht
        // Schritt (a) rueckgaengig, kein Zwischenzustand persistiert.
        throw new CampaignVersionNotDraftError(
          versionId,
          "bereits veroeffentlicht (paralleler Publish-Versuch)",
        );
      }

      await tx.auditLog.create({
        data: {
          tenantId,
          actorUserId,
          action: "ACTIVATE",
          entityType: "CampaignVersion",
          entityId: versionId,
          metadata: {
            campaignId,
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

  const version = await getCampaignVersionDetail(campaignId, versionId);
  return { version, previousActiveVersionId };
}

// Re-Export der internen Ladefunktionen fuer AP3+ (Route-Schicht) und
// Tests -- vermeidet Umbenennung/Re-Import-Kollisionen mit gleichnamigen
// Helfern in anderen *-admin.ts-Dateien.
export const campaignAdminInternal = {
  requireCampaign,
  requireCampaignVersion,
  requireDraftCampaignVersion,
  loadCampaignConditions,
};
