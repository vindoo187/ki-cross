/**
 * Playbook-Management-Service (Phase 14 AP2, siehe
 * PHASE_14_IMPLEMENTATION_PLAN.md Abschnitt 3, ChatGPT-GO 2026-08-31 fuer
 * AP1 + AP2 mit den in "Ein Punkt, den ich fuer AP2 ausdruecklich
 * festhalten wuerde" genannten Vorgaben, siehe
 * project_ki_cross_phase14_ap1_status.md). Analog `campaign-admin.ts`
 * (Phase 13) fuer den Draft/Publish-Lifecycle -- `PlaybookVersion` ist PRO
 * `Playbook` gescoped (identisches Publish-Scope-Muster wie
 * `CampaignVersion`/`CommissionModelVersion`, EXCLUDE-Constraint
 * `playbook_versions_no_overlap`, siehe Migration
 * `20260831180000_playbook_management`).
 *
 * `PlaybookSection` (Phase 14 AP1) wird bei jedem Update als GANZES
 * ersetzt (Delete-All-Then-Recreate), keine granulare Einzel-Patch-API pro
 * Section -- identisches Muster wie `CampaignCondition`.
 *
 * `scopeId` ist bewusst KEIN Fremdschluessel (polymorph je nach
 * `scopeType: TENANT | STORE`, siehe `PlaybookScopeType`, AP1) --
 * `validateScopeId()` unten prueft die serverseitige Tenant-Bindung,
 * identisches Muster wie `campaign-admin.ts::validateScopeId()`:
 *   - TENANT -> scopeId MUSS exakt der aktuellen tenantId entsprechen.
 *   - STORE  -> Store MUSS existieren UND (durch den tenant-gescopten
 *     `db`-Client automatisch erzwungen) zum aktuellen Mandanten gehoeren.
 * `validateScopeId()` wird VOR jeder Mutation aufgerufen (Lesezugriff) --
 * bei ungueltigem Scope bleibt keine Mutation/kein Audit-Eintrag zurueck.
 *
 * Verwendet ausschliesslich den tenant-gescopten `db`-Client
 * (`src/server/tenant/scoped-client.ts`) -- eine per Request-Pfad
 * mitgegebene `playbookId`/`versionId`/`scopeId` aus einem FREMDEN
 * Mandanten kann dadurch strukturell NICHT adressiert werden (0 Treffer ->
 * `*NotFoundError`/`PlaybookScopeInvalidError`). Dies ist zugleich die
 * ChatGPT-Vorgabe "fremde Playbooks/Versionen duerfen keinen
 * unterscheidbaren Informationskanal erzeugen": ein fremdes Playbook
 * erzeugt strukturell denselben 404 wie ein nicht-existentes.
 *
 * `requireConfigPermission("config.playbooks.*")` wird bewusst NICHT hier,
 * sondern in der Route-Schicht aufgerufen (AP3), identisches Muster wie
 * Phase 8-13.
 *
 * AUSDRUECKLICH NICHT Teil dieser Datei (ChatGPT-Vorgabe AP2): jegliche
 * Retrieval-/KI-Logik (AP4), Prompt-/Kontextaufbau, oder
 * Content-Scanning-/Prompt-Injection-Heuristik (AP5, strukturell statt
 * heuristisch geloest -- siehe `playbook-schemas.ts`-Modulkommentar). Diese
 * Datei ist bewusst nur ein fachlicher CRUD-/Versionierungs-/Publish-
 * Service.
 */

import { Prisma } from "@prisma/client";
import { db } from "../db/client";
import { getTenantContext, getTenantId } from "../tenant/context";
import type { ScopedPrismaClient } from "../tenant/scoped-client";
import {
  CopySourcePlaybookVersionNotFoundError,
  PlaybookKeyAlreadyExistsError,
  PlaybookNotFoundError,
  PlaybookScopeInvalidError,
  PlaybookVersionInvalidError,
  PlaybookVersionNotDraftError,
  PlaybookVersionNotFoundError,
  PlaybookVersionPublishConflictError,
} from "./playbook-admin-errors";
import type {
  CreateDraftPlaybookVersionInput,
  CreatePlaybookInput,
  PlaybookSectionInput,
  UpdatePlaybookVersionFieldsInput,
} from "./playbook-schemas";

type ScopedTransactionClient = Parameters<Parameters<ScopedPrismaClient["$transaction"]>[0]>[0];
type QueryClient = ScopedTransactionClient;
type PlaybookScopeType = "TENANT" | "STORE";

// ---------------------------------------------------------------------------
// Oeffentliche DTOs
// ---------------------------------------------------------------------------

export interface PlaybookSectionDetail {
  id: string;
  sectionType: string;
  title: string;
  content: string;
  relatedTopics: string[];
  relatedProductKeys: string[];
  relatedSituations: string[];
  priority: number | null;
  tags: string[];
  active: boolean;
}

export interface PlaybookVersionSummary {
  id: string;
  versionNumber: number;
  status: string;
  scopeType: string;
  scopeId: string;
  validFrom: string;
  validTo: string | null;
}

export interface PlaybookVersionDetail extends PlaybookVersionSummary {
  playbookId: string;
  description: string | null;
  createdByUserId: string | null;
  sections: PlaybookSectionDetail[];
}

export interface PlaybookSummary {
  id: string;
  key: string;
  name: string;
  versions: PlaybookVersionSummary[];
}

// ---------------------------------------------------------------------------
// Interne Ladefunktionen
// ---------------------------------------------------------------------------

/** Laedt ein `Playbook` (tenant-gescopt via `client`). */
async function requirePlaybook(client: QueryClient, playbookId: string) {
  const playbook = await client.playbook.findUnique({ where: { id: playbookId } });
  if (!playbook) {
    throw new PlaybookNotFoundError(playbookId);
  }
  return playbook;
}

/** Laedt eine `PlaybookVersion` und prueft, dass sie zum angegebenen `Playbook` gehoert. */
async function requirePlaybookVersion(client: QueryClient, playbookId: string, versionId: string) {
  const version = await client.playbookVersion.findUnique({ where: { id: versionId } });
  if (!version || version.playbookId !== playbookId) {
    throw new PlaybookVersionNotFoundError(playbookId, versionId);
  }
  return version;
}

/**
 * Wie `requirePlaybookVersion()`, prueft zusaetzlich Status DRAFT (409
 * sonst) -- fuer alle mutierenden Playbook-Operationen (analog
 * `requireDraftCampaignVersion()`).
 */
async function requireDraftPlaybookVersion(
  client: QueryClient,
  playbookId: string,
  versionId: string,
) {
  const version = await requirePlaybookVersion(client, playbookId, versionId);
  if (version.status !== "DRAFT") {
    throw new PlaybookVersionNotDraftError(versionId, version.status);
  }
  return version;
}

/**
 * Prueft die serverseitige Tenant-Bindung von `scopeId` fuer den
 * angegebenen `scopeType` (siehe Modulkommentar). Wirft
 * `PlaybookScopeInvalidError`, falls die Zuordnung nicht gueltig ist. Reiner
 * Lesezugriff -- MUSS vor jeder Mutation aufgerufen werden, bevor eine
 * Transaktion eroeffnet wird (kein Zwischenzustand bei ungueltigem Scope).
 */
async function validateScopeId(
  client: QueryClient,
  tenantId: string,
  scopeType: PlaybookScopeType,
  scopeId: string,
): Promise<void> {
  switch (scopeType) {
    case "TENANT": {
      if (scopeId !== tenantId) {
        throw new PlaybookScopeInvalidError(scopeType, scopeId);
      }
      return;
    }
    case "STORE": {
      const store = await client.store.findUnique({ where: { id: scopeId } });
      if (!store) {
        throw new PlaybookScopeInvalidError(scopeType, scopeId);
      }
      return;
    }
    default: {
      const exhaustiveCheck: never = scopeType;
      throw new PlaybookScopeInvalidError(exhaustiveCheck, scopeId);
    }
  }
}

type PlaybookVersionRow = {
  id: string;
  playbookId: string;
  versionNumber: number;
  status: string;
  scopeType: string;
  scopeId: string;
  validFrom: Date;
  validTo: Date | null;
  description: string | null;
  createdByUserId: string | null;
};

type PlaybookSectionRow = {
  id: string;
  sectionType: string;
  title: string;
  content: string;
  relatedTopics: string[];
  relatedProductKeys: string[];
  relatedSituations: string[];
  priority: number | null;
  tags: string[];
  active: boolean;
};

function toSectionDetail(s: PlaybookSectionRow): PlaybookSectionDetail {
  return {
    id: s.id,
    sectionType: s.sectionType,
    title: s.title,
    content: s.content,
    relatedTopics: s.relatedTopics,
    relatedProductKeys: s.relatedProductKeys,
    relatedSituations: s.relatedSituations,
    priority: s.priority,
    tags: s.tags,
    active: s.active,
  };
}

function toVersionSummary(v: PlaybookVersionRow): PlaybookVersionSummary {
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
  v: PlaybookVersionRow,
  sections: PlaybookSectionDetail[],
): PlaybookVersionDetail {
  return {
    ...toVersionSummary(v),
    playbookId: v.playbookId,
    description: v.description,
    createdByUserId: v.createdByUserId,
    sections,
  };
}

/**
 * Laedt alle `PlaybookSection`-Zeilen EINER Version, stabil sortiert nach
 * Anlagereihenfolge (`createdAt` aufsteigend, dann `id` als deterministischer
 * Tie-Breaker). Bewusst NICHT nach `priority` sortiert -- `priority` ist
 * reine Retrieval-Metadatik fuer AP4 (siehe `playbook-schemas.ts`-
 * Modulkommentar), keine Anzeige-Reihenfolge, und ist optional/nullable
 * (uneinheitliche NULL-Platzierung je nach DB-Sortierrichtung waere hier
 * nur eine Fehlerquelle ohne fachlichen Nutzen).
 */
async function loadPlaybookSections(
  client: QueryClient,
  playbookVersionId: string,
): Promise<PlaybookSectionDetail[]> {
  const rows = await client.playbookSection.findMany({
    where: { playbookVersionId },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  return rows.map(toSectionDetail);
}

// ---------------------------------------------------------------------------
// 1. Playbook-Liste (mit allen Versionen, Historie) + Anlegen
// ---------------------------------------------------------------------------

export async function listPlaybooks(): Promise<PlaybookSummary[]> {
  const rows = await db.playbook.findMany({
    orderBy: { name: "asc" },
    include: { versions: { orderBy: { versionNumber: "desc" } } },
  });
  return rows.map((p) => ({
    id: p.id,
    key: p.key,
    name: p.name,
    versions: p.versions.map(toVersionSummary),
  }));
}

/**
 * Legt die fachliche Identitaet eines neuen `Playbook` an (`key`/`name`,
 * ohne Version). `key` ist je Mandant eindeutig
 * (`playbooks_tenant_id_key_key`, siehe Migration
 * `20260831180000_playbook_management`).
 */
export async function createPlaybook(input: CreatePlaybookInput): Promise<PlaybookSummary> {
  const tenantId = getTenantId();
  const actorUserId = getTenantContext().userId;

  let playbookId: string;
  try {
    playbookId = await db.$transaction(async (tx) => {
      const created = await tx.playbook.create({
        data: { tenantId, key: input.key, name: input.name },
      });
      await tx.auditLog.create({
        data: {
          tenantId,
          actorUserId,
          action: "CREATE",
          entityType: "Playbook",
          entityId: created.id,
          metadata: { key: input.key },
        },
      });
      return created.id;
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      throw new PlaybookKeyAlreadyExistsError(input.key);
    }
    throw err;
  }

  return { id: playbookId, key: input.key, name: input.name, versions: [] };
}

/** Vollstaendige Versionshistorie EINES `Playbook` (alle Status, neueste zuerst). */
export async function getPlaybookVersionHistory(
  playbookId: string,
): Promise<PlaybookVersionSummary[]> {
  await requirePlaybook(db, playbookId);
  const versions = await db.playbookVersion.findMany({
    where: { playbookId },
    orderBy: { versionNumber: "desc" },
  });
  return versions.map(toVersionSummary);
}

// ---------------------------------------------------------------------------
// 2. Versions-Detailansicht
// ---------------------------------------------------------------------------

export async function getPlaybookVersionDetail(
  playbookId: string,
  versionId: string,
): Promise<PlaybookVersionDetail> {
  await requirePlaybook(db, playbookId);
  const version = await requirePlaybookVersion(db, playbookId, versionId);
  const sections = await loadPlaybookSections(db, versionId);
  return toVersionDetail(version, sections);
}

// ---------------------------------------------------------------------------
// 3. Neue DRAFT-Version anlegen (leer, mit Sections, oder als Kopie)
// ---------------------------------------------------------------------------

/**
 * `copyFromVersionId` (falls gesetzt) muss zu DEMSELBEN `playbookId`
 * gehoeren (per-Entity-Publish-Scope, analog
 * `createDraftCampaignVersion()`). Section-Uebernahme siehe
 * `createDraftPlaybookVersionSchema`-Modulkommentar (`playbook-schemas.ts`):
 * explizit angegebene `sections` gewinnen immer; erst wenn `sections`
 * weggelassen wurde UND `copyFromVersionId` gesetzt ist, werden die
 * Sections der Kopiervorlage serverseitig deep-kopiert (Rollback-Flow).
 *
 * Draft-Versionen sind append-only (ChatGPT-Vorgabe AP2): eine neue Version
 * entsteht IMMER als neue Zeile (`versionNumber` inkrementiert), nie als
 * Ueberschreiben einer bestehenden -- Aenderungen an einer bereits
 * gespeicherten DRAFT-Version laufen ausschliesslich ueber
 * `updatePlaybookVersionFields()` (UPDATE derselben Zeile, siehe unten),
 * niemals ueber Wiederverwendung einer `versionNumber`.
 *
 * Concurrency-sichere `versionNumber`-Vergabe per Playbook-Row-Lock
 * (identisches Muster wie `createDraftCampaignVersion()`, Phase 10
 * AP9-Fix-Lehre): MUSS die erste Operation der Transaktion sein, sonst
 * koennen zwei parallele Aufrufe fuer DASSELBE Playbook denselben
 * `MAX(versionNumber)` lesen, bevor einer committet.
 */
export async function createDraftPlaybookVersion(
  playbookId: string,
  input: CreateDraftPlaybookVersionInput,
): Promise<PlaybookVersionDetail> {
  await requirePlaybook(db, playbookId);
  const tenantId = getTenantId();
  const actorUserId = getTenantContext().userId;

  await validateScopeId(db, tenantId, input.scopeType, input.scopeId);

  let sourceSections: PlaybookSectionDetail[] = [];
  if (input.copyFromVersionId) {
    const sourceVersion = await db.playbookVersion.findUnique({
      where: { id: input.copyFromVersionId },
    });
    if (!sourceVersion || sourceVersion.playbookId !== playbookId) {
      throw new CopySourcePlaybookVersionNotFoundError(input.copyFromVersionId);
    }
    if (input.sections === undefined) {
      sourceSections = await loadPlaybookSections(db, input.copyFromVersionId);
    }
  }

  const resolvedSections: PlaybookSectionInput[] =
    input.sections !== undefined
      ? input.sections
      : sourceSections.map((s) => ({
          sectionType: s.sectionType as PlaybookSectionInput["sectionType"],
          title: s.title,
          content: s.content,
          relatedTopics: s.relatedTopics,
          relatedProductKeys: s.relatedProductKeys,
          relatedSituations: s.relatedSituations,
          priority: s.priority,
          tags: s.tags,
          active: s.active,
        }));

  const now = new Date();

  const newVersionId = await db.$transaction(async (tx) => {
    // Schritt 0: Playbook-Row-Lock, siehe Funktionskommentar oben -- MUSS
    // die erste Operation dieser Transaktion sein.
    await tx.$queryRaw`SELECT id FROM playbooks WHERE id = ${playbookId}::uuid AND tenant_id = ${tenantId}::uuid FOR UPDATE`;

    const lastVersion = await tx.playbookVersion.findFirst({
      where: { playbookId },
      orderBy: { versionNumber: "desc" },
      select: { versionNumber: true },
    });
    const nextVersionNumber = (lastVersion?.versionNumber ?? 0) + 1;

    const newVersion = await tx.playbookVersion.create({
      data: {
        tenantId,
        playbookId,
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

    if (resolvedSections.length > 0) {
      await tx.playbookSection.createMany({
        data: resolvedSections.map((s) => ({
          tenantId,
          playbookVersionId: newVersion.id,
          sectionType: s.sectionType,
          title: s.title,
          content: s.content,
          relatedTopics: s.relatedTopics,
          relatedProductKeys: s.relatedProductKeys,
          relatedSituations: s.relatedSituations,
          priority: s.priority ?? null,
          tags: s.tags,
          active: s.active,
        })),
      });
    }

    await tx.auditLog.create({
      data: {
        tenantId,
        actorUserId,
        action: "CREATE",
        entityType: "PlaybookVersion",
        entityId: newVersion.id,
        metadata: {
          playbookId,
          copyFromVersionId: input.copyFromVersionId ?? null,
          versionNumber: nextVersionNumber,
          sectionCount: resolvedSections.length,
        },
      },
    });

    return newVersion.id;
  });

  return getPlaybookVersionDetail(playbookId, newVersionId);
}

// ---------------------------------------------------------------------------
// 4. Feld-CRUD: Skalarfelder + Sections einer DRAFT-Version aendern
// ---------------------------------------------------------------------------

/**
 * Partielles Update EINER bestehenden DRAFT-`PlaybookVersion`. `scopeType`/
 * `scopeId` werden auf dem ZUSAMMENGEFUEHRTEN Ergebniszustand re-validiert
 * (falls eines von beiden im Patch enthalten ist -- ein Patch mit nur
 * `scopeId` muss weiterhin gegen den ggf. unveraenderten `scopeType`
 * geprueft werden). `sections`, falls angegeben, ERSETZT die GESAMTE
 * bestehende Liste (siehe `playbook-schemas.ts`-Modulkommentar).
 */
export async function updatePlaybookVersionFields(
  playbookId: string,
  versionId: string,
  patch: UpdatePlaybookVersionFieldsInput,
): Promise<PlaybookVersionDetail> {
  await requirePlaybook(db, playbookId);
  const current = await requireDraftPlaybookVersion(db, playbookId, versionId);
  const tenantId = getTenantId();
  const actorUserId = getTenantContext().userId;

  const resultingScopeType = (patch.scopeType ?? current.scopeType) as PlaybookScopeType;
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
      await tx.playbookVersion.update({
        where: { id: versionId },
        data: {
          ...(patch.scopeType !== undefined ? { scopeType: patch.scopeType } : {}),
          ...(patch.scopeId !== undefined ? { scopeId: patch.scopeId } : {}),
          ...(patch.description !== undefined ? { description: patch.description } : {}),
        },
      });
    }

    if (patch.sections !== undefined) {
      await tx.playbookSection.deleteMany({ where: { playbookVersionId: versionId } });
      if (patch.sections.length > 0) {
        await tx.playbookSection.createMany({
          data: patch.sections.map((s) => ({
            tenantId,
            playbookVersionId: versionId,
            sectionType: s.sectionType,
            title: s.title,
            content: s.content,
            relatedTopics: s.relatedTopics,
            relatedProductKeys: s.relatedProductKeys,
            relatedSituations: s.relatedSituations,
            priority: s.priority ?? null,
            tags: s.tags,
            active: s.active,
          })),
        });
      }
    }

    await tx.auditLog.create({
      data: {
        tenantId,
        actorUserId,
        action: "UPDATE",
        entityType: "PlaybookVersion",
        entityId: versionId,
        metadata: { playbookId, changedFields: Object.keys(patch) },
      },
    });
  });

  return getPlaybookVersionDetail(playbookId, versionId);
}

// ---------------------------------------------------------------------------
// 5. Serverseitige Validierung (vor Publish)
// ---------------------------------------------------------------------------

/**
 * Strukturelle Validierung der `PlaybookSection`-Eintraege EINER Version --
 * analog `validateCampaignVersion()` (Phase 13 AP2), aber ohne dortige
 * Referenz-/Registry-Pruefungen: `PlaybookSection` referenziert keine
 * anderen validierten Entitaeten (`relatedTopics`/`relatedProductKeys`/
 * `relatedSituations`/`tags` sind freie Retrieval-Metadaten, siehe
 * `playbook-schemas.ts`-Modulkommentar -- ihre fachliche Bedeutung wird
 * erst von der Retrieval-Selektionsfunktion in AP4 ausgewertet, nicht
 * hier). Geprueft wird ausschliesslich Defense-in-Depth ueber die
 * Zod-Struktur hinaus: `title`/`content` duerfen nach Trim nicht leer sein
 * (Zod `min(1)` laesst Whitespace-only-Strings durch). Eine
 * `PlaybookVersion` OHNE Sections ist gueltig (analog Campaign ohne
 * Bedingungen). Wird von `publishPlaybookVersion()` VOR jeder
 * Publish-Transaktion aufgerufen (serverseitige Revalidierung, niemals nur
 * auf eine vorherige Client-Validierung vertrauen).
 *
 * Bewusst KEINE Content-Scanning-/Prompt-Injection-Heuristik hier
 * (ChatGPT-Vorgabe AP1/AP5, siehe Modulkommentar oben) -- `content` bleibt
 * unveraendert gespeichert, unabhaengig von seinem Inhalt.
 */
export async function validatePlaybookVersion(
  playbookId: string,
  versionId: string,
): Promise<{ valid: true }> {
  await requirePlaybook(db, playbookId);
  await requirePlaybookVersion(db, playbookId, versionId);
  const sections = await loadPlaybookSections(db, versionId);

  const issues: string[] = [];
  for (const section of sections) {
    if (section.title.trim().length === 0) {
      issues.push(`Section "${section.id}": title darf nicht leer (oder nur Leerzeichen) sein.`);
    }
    if (section.content.trim().length === 0) {
      issues.push(`Section "${section.id}": content darf nicht leer (oder nur Leerzeichen) sein.`);
    }
  }

  if (issues.length > 0) {
    throw new PlaybookVersionInvalidError(versionId, issues);
  }
  return { valid: true };
}

// ---------------------------------------------------------------------------
// 6. Publish (per-Playbook-Scope, analog publishCampaignVersion())
// ---------------------------------------------------------------------------

export interface PublishPlaybookVersionResult {
  version: PlaybookVersionDetail;
  /** ID der zuvor ACTIVE-Version DESSELBEN Playbooks, die durch diesen Publish auf EXPIRED gesetzt wurde -- `null` beim allerersten Publish dieses Playbooks. */
  previousActiveVersionId: string | null;
}

/**
 * Name des DB-EXCLUDE-Constraints (Migration
 * `20260831180000_playbook_management`), der strukturell garantiert, dass
 * niemals zwei `PlaybookVersion`s DESSELBEN `Playbook` gleichzeitig
 * ACTIVE/EXPIRED mit ueberlappendem Gueltigkeitszeitraum sind (PRO
 * Playbook gescoped, siehe AP1-Migrations-Kommentar). Analog
 * `CAMPAIGN_VERSION_NO_OVERLAP_CONSTRAINT`.
 */
const PLAYBOOK_VERSION_NO_OVERLAP_CONSTRAINT = "playbook_versions_no_overlap";

/**
 * Uebersetzt NUR die bekannte, oben benannte EXCLUDE-Constraint-Verletzung
 * in einen fachlichen `PlaybookVersionPublishConflictError` (409). Jeder
 * andere Fehler wird unveraendert weitergeworfen (analog Campaign/
 * Commission/RuleSet: "keinen pauschalen PostgreSQL-/Prisma-Fehler auf 409
 * mappen"). Exportiert, damit dieses Mapping deterministisch per Unit-Test
 * mit synthetischen Prisma-Fehlerobjekten abgedeckt werden kann.
 */
export function translatePublishError(error: unknown, versionId: string): never {
  const message =
    error instanceof Prisma.PrismaClientKnownRequestError ||
    error instanceof Prisma.PrismaClientUnknownRequestError
      ? error.message
      : undefined;
  if (message?.includes(PLAYBOOK_VERSION_NO_OVERLAP_CONSTRAINT)) {
    throw new PlaybookVersionPublishConflictError(versionId);
  }
  throw error;
}

/**
 * Veroeffentlicht eine DRAFT-`PlaybookVersion` (setzt sie auf ACTIVE,
 * expiret die bisherige ACTIVE-Version DESSELBEN Playbooks). Reihenfolge
 * (ChatGPT-Vorgabe AP2: "Publish atomar mit Audit", "now erst nach Erwerb
 * des Playbook-Row-Locks innerhalb der Transaktion bestimmen" -- direkte
 * Lehre aus dem Phase-13-AP10-Regressionsfund):
 * 1. Serverseitige Revalidierung ueber `validatePlaybookVersion()` VOR der
 *    Transaktion (rein lesend) -- ein Validierungsfehler darf keine
 *    Transaktion eroeffnen.
 * 2. Innerhalb EINER Transaktion:
 *    0. Playbook-Row-Lock (`SELECT id FROM playbooks WHERE id = $1 AND
 *       tenant_id = $2 FOR UPDATE`) -- MUSS die erste Operation sein.
 *    0b. `now = new Date()` wird ERST NACH erfolgreichem Erwerb dieses
 *       Locks bestimmt (Phase 13 AP10-Regressionsfund, siehe
 *       DECISION_LOG.md) -- NICHT davor. Bei einer vor dem Lock
 *       bestimmten Zeit kann eine durch den Lock blockierte, zweite
 *       Publish-Transaktion nach Freigabe des Locks einen FRUEHEREN
 *       Zeitstempel als das soeben (durch die erste Transaktion) gesetzte
 *       `validFrom` der jetzt ACTIVE-Version besitzen; der Versuch, diese
 *       Version mit `validTo = now(frueher)` zu expiren, erzeugt dann
 *       einen ungueltigen Bereich (`validFrom > validTo`,
 *       Postgres-Fehler 22000), den `translatePublishError()` nicht
 *       abfaengt. Da der Row-Lock die Transaktionen serialisiert, ist ein
 *       ERST NACH Lock-Erwerb bestimmter Zeitstempel dagegen garantiert
 *       monoton in Serialisierungsreihenfolge.
 *    a. Bisherige ACTIVE-Version DESSELBEN Playbooks (falls vorhanden)
 *       zuerst auf EXPIRED setzen (`validTo = now`) -- MUSS vor (b)
 *       passieren, sonst schlaegt die EXCLUDE-Constraint sofort fehl.
 *    b. Ziel-Draft ueber `updateMany({where: {id, status: "DRAFT"}})` auf
 *       ACTIVE setzen -- `count !== 1` wirft (paralleler Publish-Versuch
 *       DERSELBEN Version), rollt die GESAMTE Transaktion inkl. Schritt (a)
 *       zurueck. Die zugehoerigen `PlaybookSection`-Zeilen werden dabei
 *       NICHT separat mutiert -- sie sind bereits Teil der DRAFT-Version
 *       und werden durch den Status-Wechsel der Version implizit mit
 *       "veroeffentlicht" (Atomaritaet ergibt sich daraus, dass Version +
 *       Sections in DERSELBEN Transaktion aktiviert bzw. bei Fehlschlag
 *       zurueckgerollt werden).
 *    c. `AuditLog`-Eintrag (ACTIVATE) in DERSELBEN Transaktion.
 */
export async function publishPlaybookVersion(
  playbookId: string,
  versionId: string,
): Promise<PublishPlaybookVersionResult> {
  await requirePlaybook(db, playbookId);
  await requireDraftPlaybookVersion(db, playbookId, versionId);

  // Serverseitige Revalidierung -- niemals nur auf eine vorherige
  // Client-Validierung vertrauen (identisches Prinzip wie Phase 8-13).
  await validatePlaybookVersion(playbookId, versionId);

  const tenantId = getTenantId();
  const actorUserId = getTenantContext().userId;

  let previousActiveVersionId: string | null;
  try {
    previousActiveVersionId = await db.$transaction(async (tx) => {
      // Schritt 0: Playbook-Row-Lock (siehe Funktionskommentar oben) --
      // MUSS die erste Operation dieser Transaktion sein. Serialisiert
      // alle Publish-Transaktionen DESSELBEN Playbooks.
      await tx.$queryRaw`SELECT id FROM playbooks WHERE id = ${playbookId}::uuid AND tenant_id = ${tenantId}::uuid FOR UPDATE`;

      // Schritt 0b: `now` ERST NACH dem Lock-Erwerb bestimmen (siehe
      // Funktionskommentar oben, Phase 13 AP10-Regressionsfund) -- NICHT
      // davor, sonst kann eine durch den Lock blockierte Transaktion nach
      // Freigabe einen bereits ueberholten Zeitstempel verwenden.
      const now = new Date();

      const previousActive = await tx.playbookVersion.findFirst({
        where: { playbookId, status: "ACTIVE", id: { not: versionId } },
      });
      if (previousActive) {
        await tx.playbookVersion.update({
          where: { id: previousActive.id },
          data: { status: "EXPIRED", validTo: now },
        });
      }

      const activated = await tx.playbookVersion.updateMany({
        where: { id: versionId, status: "DRAFT" },
        data: { status: "ACTIVE", validFrom: now, validTo: null },
      });
      if (activated.count !== 1) {
        // Wurde zwischen der Vorab-Pruefung oben und hier bereits von
        // einem parallelen Request veroeffentlicht -- ROLLBACK macht
        // Schritt (a) rueckgaengig, kein Zwischenzustand persistiert.
        throw new PlaybookVersionNotDraftError(
          versionId,
          "bereits veroeffentlicht (paralleler Publish-Versuch)",
        );
      }

      await tx.auditLog.create({
        data: {
          tenantId,
          actorUserId,
          action: "ACTIVATE",
          entityType: "PlaybookVersion",
          entityId: versionId,
          metadata: {
            playbookId,
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

  const version = await getPlaybookVersionDetail(playbookId, versionId);
  return { version, previousActiveVersionId };
}

// Re-Export der internen Ladefunktionen fuer AP3+ (Route-Schicht) und
// Tests -- vermeidet Umbenennung/Re-Import-Kollisionen mit gleichnamigen
// Helfern in anderen *-admin.ts-Dateien.
export const playbookAdminInternal = {
  requirePlaybook,
  requirePlaybookVersion,
  requireDraftPlaybookVersion,
  loadPlaybookSections,
};
