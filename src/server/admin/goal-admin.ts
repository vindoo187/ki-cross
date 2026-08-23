/**
 * Goal-Management-Service (Phase 11 AP2, siehe
 * PHASE_11_IMPLEMENTATION_PLAN.md Abschnitt 3, ChatGPT finales GO
 * 2026-08-22). Analog `commission-admin.ts` (Phase 10)/`rule-admin.ts`
 * (Phase 9)/`question-admin.ts` (Phase 8), aber mit einem grundlegend
 * anderen Versionierungsmuster (siehe `prisma/schema.prisma`-Modulkommentar
 * zu `Goal`/`GoalVersion`, ChatGPTs finale Plan-Korrektur):
 *
 * - KEIN Draft->Publish->ACTIVE/EXPIRED-Lebenszyklus. `Goal` ist die
 *   unveraenderliche fachliche IDENTITAET (Tenant+Scope+Metrik+Periodentyp+
 *   Periodenstart), `GoalVersion` traegt den konkreten Zielwert und ist
 *   append-only historisiert (kein `status`-Feld, kein Update-/Delete-Pfad).
 * - Die "aktuelle" Version eines Goal ist IMMER die mit der hoechsten
 *   `versionNumber` -- ausschliesslich ueber `getCurrentGoalVersion()`
 *   ermittelt (zentrale Resolver-Funktion, ChatGPTs ausdrueckliche Auflage:
 *   "keine andere Stelle darf selbstaendig 'irgendeine' GoalVersion
 *   auswaehlen"). Jede zukuenftige AP (Analytics-Vergleich AP4,
 *   Sichtbarkeits-Layer AP5, Admin-UI AP6, ...) MUSS diese Funktion nutzen,
 *   nie eine eigene `ORDER BY versionNumber DESC`-Query.
 * - `Goal` selbst hat keinen Update-Pfad: Korrekturen am Zielwert erfolgen
 *   ausschliesslich ueber `createGoalVersion()` (neue Zeile, alte bleibt
 *   unveraendert bestehen -- Audit/Reproduzierbarkeit/historische Reports).
 *
 * KARDINALITAET (verbindliche Plan-Vorgabe, Abschnitt 1 Punkt 3): pro
 * Tenant+Scope+Metrik+Periodentyp+Periodenstart ist genau EIN Goal zulaessig
 * (DB-UNIQUE-Constraint `goals_scope_metric_period_key`). `createGoal()`
 * uebersetzt eine Verletzung in `GoalAlreadyExistsError` (409) statt eines
 * rohen P2002-Fehlers -- analoges Muster wie
 * `CommissionModelVersionInvalidError`-P2002-Uebersetzung.
 *
 * SCOPE-ID-TENANT-BINDUNG (ChatGPTs ausdrueckliche Sicherheitsauflage bei
 * der finalen Plan-Freigabe, Abschnitt 1 Punkt 7): `scopeId` ist bewusst
 * KEIN Fremdschluessel (polymorph je nach `scopeType`, siehe
 * Migrationskommentar) -- die Zugehoerigkeit zum aktuellen Mandanten wird
 * daher HIER, serverseitig, vor jeder `Goal`-Mutation geprueft
 * (`validateScopeId()` unten):
 *   - TENANT  -> scopeId MUSS exakt der aktuellen tenantId entsprechen.
 *   - COMPANY -> Company mit dieser id MUSS im aktuellen Tenant existieren.
 *   - STORE   -> Store mit dieser id MUSS im aktuellen Tenant existieren.
 *   - EMPLOYEE-> Employee mit dieser id MUSS im aktuellen Tenant existieren.
 * Die COMPANY/STORE/EMPLOYEE-Pruefungen nutzen bewusst den tenant-gescopten
 * `db`-Client (`src/server/tenant/scoped-client.ts`): dessen Prisma-Client-
 * Extension mischt die `tenantId` des aktuellen `TenantContext` automatisch
 * in JEDES `where` -- ein `findUnique({ where: { id: scopeId } })` auf
 * `Company`/`Store`/`Employee` liefert daher strukturell NUR dann eine
 * Zeile, wenn diese tatsaechlich zum aktuellen Mandanten gehoert. Eine
 * `scopeId` aus einem FREMDEN Mandanten kann dadurch nicht adressiert
 * werden (0 Treffer -> `GoalScopeInvalidError`).
 *
 * CONCURRENCY-SICHERE VERSIONNUMBER-VERGABE (ChatGPTs zusaetzliche Auflage
 * bei der finalen Plan-Freigabe, analog dem in Phase 10 AP9 gefundenen
 * Race-Condition-Bug bei `createDraftCommissionModelVersion()`):
 * `createGoalVersion()` sperrt als ERSTE Operation seiner Transaktion die
 * betroffene `goals`-Zeile (`SELECT ... FOR UPDATE`), BEVOR
 * `MAX(versionNumber)` gelesen wird -- exakt dasselbe Muster wie der
 * CommissionModel-Row-Lock in `commission-admin.ts`. Ohne diesen Lock
 * wuerden zwei parallele `createGoalVersion()`-Aufrufe fuer DASSELBE Goal
 * unter READ COMMITTED denselben `MAX(versionNumber)` lesen, bevor einer der
 * beiden committet -- die zweite Transaktion wuerde am UNIQUE-Constraint
 * `goal_versions_tenant_id_goal_id_version_number_key` mit P2002 scheitern,
 * statt sauber die naechste freie Nummer zu erhalten. `createGoal()`
 * braucht diesen Lock NICHT, da dort immer versionNumber=1 fuer ein
 * brandneues Goal angelegt wird (kein Vorgaenger, dessen MAX() racen
 * koennte) -- die Kardinalitaets-UNIQUE-Constraint auf `goals` selbst
 * schuetzt bereits vor einem parallelen Doppel-Anlegen desselben Goal.
 *
 * Verwendet ausschliesslich den tenant-gescopten `db`-Client -- identisches
 * Isolationsmuster wie `commission-admin.ts`/`rule-admin.ts`/
 * `question-admin.ts`: eine per Aufrufer mitgegebene `goalId` aus einem
 * FREMDEN Mandanten kann dadurch strukturell NICHT adressiert werden (0
 * Treffer -> `GoalNotFoundError`).
 *
 * `requireConfigPermission("config.goals.*")` wird bewusst NICHT hier,
 * sondern in der Route-Schicht aufgerufen (AP3+), identisches Muster wie
 * Phase 8/9/10.
 *
 * AUDIT-METADATA / PII-SCANNER (ChatGPT-Auflage Phase 11 AP8, 2026-08-22,
 * ausdruecklich zu dokumentieren): `AuditLog.metadata` fuer `Goal`/
 * `GoalVersion` darf NIEMALS Datums-/Zeitstempel-Strings enthalten (z. B.
 * `periodStart.toISOString()`). Der generische PII-Scanner
 * (`src/server/validation/contact-data-guard.ts`) erkennt Ziffernfolgen
 * ab 7 zusammenhaengenden Ziffern (mit optionalen Trennzeichen) als
 * vermeintliche Telefonnummer -- ein ISO-8601-Zeitstempel wie
 * "2026-01-01T00:00:00.000Z" matcht dieses Muster faelschlich (CI-#85-Fund
 * in AP2, siehe project_ki_cross_phase11_plan_go.md). Zulaessig sind
 * ausschliesslich: UUIDs (vom Scanner explizit als technische ID
 * whitelisted), Enum-Strings (`scopeType`/`metricKey`/`periodType`) und
 * Zahlen (`versionNumber` u. ae. -- werden vom String-Scanner ohnehin nicht
 * inspiziert). Ein benoetigtes Datum gehoert NIE ins Audit-Metadata,
 * sondern wird ueber `entityId` + Tabellen-Lookup nachgeschlagen.
 *
 * DATENSCHUTZ (ChatGPT-Bestaetigung 2026-08-22, siehe
 * project_ki_cross_phase11_plan_go.md): `scopeType: "EMPLOYEE"`-Goals und
 * `createdByUserId` sind keine neue Datenschutzkategorie, bewegen sich aber
 * innerhalb bereits bestehender personenbezogener Verknuepfungen. Diese
 * Datei erzwingt ausschliesslich die TENANT-Bindung von `scopeId` -- die
 * fachliche SICHTBARKEITS-Einschraenkung ("ein Mitarbeiter darf nur sein
 * eigenes Goal sehen") ist NICHT Teil dieser Datei, sondern Aufgabe von AP5
 * (Sichtbarkeits-/RBAC-Integration, siehe Modulkommentar zu
 * `resolveAuthorizedStoreFilter()` in `management-authz.ts` fuer das
 * analoge Muster aus Phase 7). `createdByUserId` bleibt reine Audit-/
 * Provenance-Information und ist KEIN Sichtbarkeitskriterium.
 */

import { Prisma } from "@prisma/client";
import { db } from "../db/client";
import { getTenantContext, getTenantId } from "../tenant/context";
import type { ScopedPrismaClient } from "../tenant/scoped-client";
import {
  GoalAlreadyExistsError,
  GoalNotFoundError,
  GoalScopeInvalidError,
  GoalVersionNotFoundError,
} from "./goal-admin-errors";
import type { CreateGoalInput, CreateGoalVersionInput } from "./goal-schemas";

type ScopedTransactionClient = Parameters<Parameters<ScopedPrismaClient["$transaction"]>[0]>[0];
type QueryClient = ScopedTransactionClient;

type GoalScopeType = CreateGoalInput["scopeType"];

// ---------------------------------------------------------------------------
// Oeffentliche DTOs
// ---------------------------------------------------------------------------

export interface GoalVersionSummary {
  id: string;
  goalId: string;
  versionNumber: number;
  targetAmountMinor: number | null;
  targetCount: number | null;
  targetPercentageBasisPoints: number | null;
  createdAt: string;
  createdByUserId: string | null;
}

export interface GoalSummary {
  id: string;
  scopeType: string;
  scopeId: string;
  metricKey: string;
  periodType: string;
  periodStart: string;
  currency: string | null;
  createdAt: string;
  /** Immer ueber `getCurrentGoalVersion()`-aequivalente Logik ermittelt (hoechste versionNumber). */
  currentVersion: GoalVersionSummary;
}

export interface GoalDetail extends GoalSummary {
  /** ALLE Versionen dieses Goal, absteigend nach versionNumber (neueste zuerst) -- vollstaendige Historie. */
  versions: GoalVersionSummary[];
}

// ---------------------------------------------------------------------------
// Interne Ladefunktionen
// ---------------------------------------------------------------------------

/** Laedt ein `Goal` (tenant-gescopt via `client`). */
async function requireGoal(client: QueryClient, goalId: string) {
  const goal = await client.goal.findUnique({ where: { id: goalId } });
  if (!goal) {
    throw new GoalNotFoundError(goalId);
  }
  return goal;
}

/**
 * Prueft die serverseitige Tenant-Bindung von `scopeId` fuer den
 * angegebenen `scopeType` (siehe Modulkommentar oben). Wirft
 * `GoalScopeInvalidError`, falls die Zuordnung nicht gueltig ist.
 */
async function validateScopeId(
  client: QueryClient,
  tenantId: string,
  scopeType: GoalScopeType,
  scopeId: string,
): Promise<void> {
  switch (scopeType) {
    case "TENANT": {
      if (scopeId !== tenantId) {
        throw new GoalScopeInvalidError(scopeType, scopeId);
      }
      return;
    }
    case "COMPANY": {
      const company = await client.company.findUnique({ where: { id: scopeId } });
      if (!company) {
        throw new GoalScopeInvalidError(scopeType, scopeId);
      }
      return;
    }
    case "STORE": {
      const store = await client.store.findUnique({ where: { id: scopeId } });
      if (!store) {
        throw new GoalScopeInvalidError(scopeType, scopeId);
      }
      return;
    }
    case "EMPLOYEE": {
      const employee = await client.employee.findUnique({ where: { id: scopeId } });
      if (!employee) {
        throw new GoalScopeInvalidError(scopeType, scopeId);
      }
      return;
    }
    default: {
      const exhaustiveCheck: never = scopeType;
      throw new Error(`Unbekannter GoalScopeType: ${String(exhaustiveCheck)}`);
    }
  }
}

type GoalRow = {
  id: string;
  scopeType: string;
  scopeId: string;
  metricKey: string;
  periodType: string;
  periodStart: Date;
  currency: string | null;
  createdAt: Date;
};

type GoalVersionRow = {
  id: string;
  goalId: string;
  versionNumber: number;
  targetAmountMinor: number | null;
  targetCount: number | null;
  targetPercentageBasisPoints: number | null;
  createdAt: Date;
  createdByUserId: string | null;
};

function toVersionSummary(v: GoalVersionRow): GoalVersionSummary {
  return {
    id: v.id,
    goalId: v.goalId,
    versionNumber: v.versionNumber,
    targetAmountMinor: v.targetAmountMinor,
    targetCount: v.targetCount,
    targetPercentageBasisPoints: v.targetPercentageBasisPoints,
    createdAt: v.createdAt.toISOString(),
    createdByUserId: v.createdByUserId,
  };
}

function toGoalSummary(g: GoalRow, currentVersion: GoalVersionRow): GoalSummary {
  return {
    id: g.id,
    scopeType: g.scopeType,
    scopeId: g.scopeId,
    metricKey: g.metricKey,
    periodType: g.periodType,
    periodStart: g.periodStart.toISOString(),
    currency: g.currency,
    createdAt: g.createdAt.toISOString(),
    currentVersion: toVersionSummary(currentVersion),
  };
}

/**
 * Laedt ALLE `GoalVersion`-Zeilen eines Goal, absteigend nach
 * `versionNumber` (neueste zuerst -- `versions[0]` ist damit immer die
 * aktuelle Version, siehe `getCurrentGoalVersion()`).
 */
async function loadGoalVersionsDesc(
  client: QueryClient,
  goalId: string,
): Promise<GoalVersionRow[]> {
  return client.goalVersion.findMany({
    where: { goalId },
    orderBy: { versionNumber: "desc" },
  });
}

// ---------------------------------------------------------------------------
// 1. getCurrentGoalVersion() -- zentrale Resolver-Funktion (ChatGPT-Auflage)
// ---------------------------------------------------------------------------

/**
 * EINZIGE zulaessige Quelle fuer die "aktuelle" Version eines Goal (hoechste
 * `versionNumber`). Jede zukuenftige AP, die den aktuellen Zielwert eines
 * Goal braucht (Analytics-Vergleich AP4, Sichtbarkeits-Layer AP5, Admin-UI
 * AP6), MUSS diese Funktion aufrufen -- niemals eine eigene
 * `ORDER BY versionNumber DESC`-Query (ChatGPTs ausdrueckliche Auflage bei
 * der finalen Plan-Freigabe, 2026-08-22).
 */
export async function getCurrentGoalVersion(goalId: string): Promise<GoalVersionSummary> {
  await requireGoal(db, goalId);
  const versions = await loadGoalVersionsDesc(db, goalId);
  const current = versions[0];
  if (!current) {
    // Strukturell unerwartet: createGoal() legt Goal + GoalVersion(1) immer
    // atomar in derselben Transaktion an (siehe Modulkommentar).
    throw new GoalVersionNotFoundError(goalId);
  }
  return toVersionSummary(current);
}

// ---------------------------------------------------------------------------
// 2. Goal-Liste und Detailansicht
// ---------------------------------------------------------------------------

export async function listGoals(): Promise<GoalSummary[]> {
  const rows = await db.goal.findMany({
    orderBy: { createdAt: "desc" },
    include: { versions: { orderBy: { versionNumber: "desc" }, take: 1 } },
  });
  return rows.map((g: GoalRow & { versions: GoalVersionRow[] }) => {
    const current = g.versions[0];
    if (!current) {
      // Siehe getCurrentGoalVersion()-Kommentar: strukturell unerwartet.
      throw new GoalVersionNotFoundError(g.id);
    }
    return toGoalSummary(g, current);
  });
}

export async function getGoalDetail(goalId: string): Promise<GoalDetail> {
  const goal = await requireGoal(db, goalId);
  const versions = await loadGoalVersionsDesc(db, goalId);
  const current = versions[0];
  if (!current) {
    throw new GoalVersionNotFoundError(goalId);
  }
  return {
    ...toGoalSummary(goal, current),
    versions: versions.map(toVersionSummary),
  };
}

/**
 * Vollstaendige Versionshistorie eines `Goal`, absteigend nach
 * `versionNumber` (neueste zuerst) -- fuer die Route-Schicht (AP3,
 * `GET /api/admin/goals/[id]/versions`). Wirft `GoalNotFoundError`, falls
 * `goalId` nicht (mehr) zum aktuellen Mandanten gehoert (0 Treffer ueber den
 * tenant-gescopten `db`-Client, siehe Modulkommentar).
 */
export async function listGoalVersions(goalId: string): Promise<GoalVersionSummary[]> {
  await requireGoal(db, goalId);
  const versions = await loadGoalVersionsDesc(db, goalId);
  return versions.map(toVersionSummary);
}

// ---------------------------------------------------------------------------
// 3. Goal anlegen (Identitaet + erste GoalVersion, atomar)
// ---------------------------------------------------------------------------

/**
 * Legt ein neues `Goal` (fachliche Identitaet) UND dessen erste
 * `GoalVersion` (versionNumber 1, der uebergebene Zielwert) atomar in
 * derselben Transaktion an. Ein "leeres" Goal ohne jede GoalVersion ist
 * fachlich nicht sinnvoll (siehe Discovery) und wird durch dieses Muster
 * strukturell ausgeschlossen.
 *
 * Reihenfolge: `validateScopeId()` (Lesezugriff, siehe Modulkommentar) MUSS
 * VOR der Transaktion erfolgen -- ein ungueltiger Scope darf keine
 * Transaktion eroeffnen und darf keinen Audit-Eintrag hinterlassen (ChatGPTs
 * ausdrueckliche AP2-Auflage: "bei einem ungueltigen Scope darf keine
 * Goal-/GoalVersion-Mutation und kein Audit-Eintrag zurueckbleiben").
 */
export async function createGoal(input: CreateGoalInput): Promise<GoalDetail> {
  const tenantId = getTenantId();
  const actorUserId = getTenantContext().userId;

  await validateScopeId(db, tenantId, input.scopeType, input.scopeId);

  let goalId: string;
  try {
    goalId = await db.$transaction(async (tx) => {
      const goal = await tx.goal.create({
        data: {
          tenantId,
          scopeType: input.scopeType,
          scopeId: input.scopeId,
          metricKey: input.metricKey,
          periodType: input.periodType,
          periodStart: input.periodStart,
          currency: input.currency ?? null,
        },
      });

      await tx.auditLog.create({
        data: {
          tenantId,
          actorUserId,
          action: "CREATE",
          entityType: "Goal",
          entityId: goal.id,
          metadata: {
            scopeType: input.scopeType,
            scopeId: input.scopeId,
            metricKey: input.metricKey,
            periodType: input.periodType,
          },
        },
      });

      const version = await tx.goalVersion.create({
        data: {
          tenantId,
          goalId: goal.id,
          versionNumber: 1,
          targetAmountMinor: input.targetAmountMinor ?? null,
          targetCount: input.targetCount ?? null,
          targetPercentageBasisPoints: input.targetPercentageBasisPoints ?? null,
          createdByUserId: actorUserId,
        },
      });

      await tx.auditLog.create({
        data: {
          tenantId,
          actorUserId,
          action: "CREATE",
          entityType: "GoalVersion",
          entityId: version.id,
          metadata: { goalId: goal.id, versionNumber: 1 },
        },
      });

      return goal.id;
    });
  } catch (err) {
    // Uebersetzt die DB-UNIQUE-Constraint goals_scope_metric_period_key
    // (siehe Migration 20260822100000_goal_model) in eine saubere
    // 409-Antwort statt eines rohen P2002-Fehlers -- analog dem etablierten
    // Muster in commission-admin.ts.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      throw new GoalAlreadyExistsError(
        input.scopeType,
        input.scopeId,
        input.metricKey,
        input.periodType,
        input.periodStart.toISOString(),
      );
    }
    throw err;
  }

  return getGoalDetail(goalId);
}

// ---------------------------------------------------------------------------
// 4. Neue GoalVersion anlegen (Korrektur, concurrency-sicher)
// ---------------------------------------------------------------------------

/**
 * Haengt eine neue `GoalVersion` (Korrektur-Zielwert) an ein bestehendes
 * `Goal` an -- die bisherige aktuelle Version bleibt UNVERAENDERT bestehen
 * (append-only Historisierung, kein Update-/Delete-Pfad fuer `GoalVersion`).
 * Concurrency-sichere `versionNumber`-Vergabe per Row-Lock auf die
 * betroffene `goals`-Zeile (siehe Modulkommentar oben, ChatGPTs
 * Zusatzauflage bei der finalen Plan-Freigabe, analog dem
 * Phase-10-AP9-Fix).
 */
export async function createGoalVersion(
  goalId: string,
  input: CreateGoalVersionInput,
): Promise<GoalVersionSummary> {
  await requireGoal(db, goalId);
  const tenantId = getTenantId();
  const actorUserId = getTenantContext().userId;

  const newVersionId = await db.$transaction(async (tx) => {
    // Row-Lock auf das Goal -- MUSS die erste Operation dieser Transaktion
    // sein (siehe ausfuehrlichen Kommentar im Modulkopf, identisches Muster
    // wie der CommissionModel-Row-Lock in
    // commission-admin.ts::createDraftCommissionModelVersion()). Serialisiert
    // NUR Vorgaenge fuer DIESES Goal -- parallele GoalVersion-Erstellungen
    // fuer UNTERSCHIEDLICHE Goals bleiben unabhaengig voneinander moeglich.
    await tx.$queryRaw`SELECT id FROM goals WHERE id = ${goalId}::uuid AND tenant_id = ${tenantId}::uuid FOR UPDATE`;

    const lastVersion = await tx.goalVersion.findFirst({
      where: { goalId },
      orderBy: { versionNumber: "desc" },
      select: { versionNumber: true },
    });
    const nextVersionNumber = (lastVersion?.versionNumber ?? 0) + 1;

    const newVersion = await tx.goalVersion.create({
      data: {
        tenantId,
        goalId,
        versionNumber: nextVersionNumber,
        targetAmountMinor: input.targetAmountMinor ?? null,
        targetCount: input.targetCount ?? null,
        targetPercentageBasisPoints: input.targetPercentageBasisPoints ?? null,
        createdByUserId: actorUserId,
      },
    });

    await tx.auditLog.create({
      data: {
        tenantId,
        actorUserId,
        action: "CREATE",
        entityType: "GoalVersion",
        entityId: newVersion.id,
        metadata: { goalId, versionNumber: nextVersionNumber },
      },
    });

    return newVersion.id;
  });

  const created = await db.goalVersion.findUniqueOrThrow({ where: { id: newVersionId } });
  return toVersionSummary(created);
}

// Re-Export der internen Ladefunktionen unter einem Namespace-Objekt (Muster
// aus commission-admin.ts) fuer AP3+ (Route-Schicht/Validator).
export const goalAdminInternal = {
  requireGoal,
  validateScopeId,
  loadGoalVersionsDesc,
};
