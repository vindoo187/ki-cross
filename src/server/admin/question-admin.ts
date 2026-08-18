/**
 * Question-Management-Service (Phase 8 AP3, Draft-Ebene) -- siehe
 * PHASE_8_IMPLEMENTATION_PLAN.md Abschnitt 6.
 *
 * DESIGN-ENTSCHEIDUNGEN:
 *
 * - Verwendet ausschliesslich den tenant-gescopten `db`-Client
 *   (`src/server/tenant/scoped-client.ts`). Jede Query wird dadurch
 *   automatisch um die `tenantId` des aktuellen `TenantContext` ergaenzt --
 *   eine per Request-Body/-Pfad mitgegebene `questionnaireId`/`versionId`/
 *   `questionId` aus einem FREMDEN Mandanten kann dadurch strukturell NICHT
 *   adressiert werden (0 Treffer -> `*NotFoundError`), selbst bei
 *   manipulierten IDs (Plan Abschnitt 6, "Tenant-Isolation"-Anforderung).
 *   Kein zusaetzlicher manueller `tenantId`-Check noetig.
 *
 * - "DRAFT-only Mutation" (Plan Abschnitt 6): JEDE mutierende Funktion prueft
 *   zuerst `requireDraftVersion()` -- eine `QuestionnaireVersion` mit Status
 *   ACTIVE/EXPIRED/ARCHIVED wirft `QuestionnaireVersionNotDraftError` (409),
 *   MUTIERT ABER NIE. Historie wird dadurch nie nachtraeglich veraendert;
 *   Aenderungen an veroeffentlichten Versionen laufen ausschliesslich ueber
 *   eine neue DRAFT-Version (`createDraftVersion()` mit `copyFromVersionId`,
 *   AP4/AP5 fuer den Publish-Workflow selbst).
 *
 * - Solange eine `QuestionnaireVersion` DRAFT ist, wird pro `Question` GENAU
 *   EINE `QuestionVersion`-Zeile (Status DRAFT) gefuehrt und bei Edits IN
 *   PLACE aktualisiert (kein Anlegen neuer Zeilen waehrend des Entwurfs) --
 *   das haelt den Entwurfsprozess einfach. Erst der Publish-Vorgang (AP4)
 *   flippt diese Zeile(n) auf ACTIVE. AnswerOptions/VisibilityConditions
 *   werden bei jedem Update vollstaendig ersetzt (delete+recreate), da beide
 *   Mengen klein sind und ein partielles Merge unnoetige Komplexitaet waere.
 *
 * - `requireConfigPermission("config.questions.edit")` wird bewusst NICHT
 *   hier, sondern in der Route-Schicht aufgerufen (siehe
 *   src/app/api/admin/questionnaires/**), analog zum bestehenden Muster
 *   `resolveAuthorizedStoreFilter()` (Phase 7): Autorisierung ist
 *   Transport-/Zugriffsschicht, nicht Fachlogik. Diese Datei geht davon aus,
 *   dass die aufrufende Route die Berechtigung bereits geprueft hat.
 *
 * - Keine Validierung der fachlichen Konsistenz (AnswerOptions nur bei
 *   Choice-Typen, min/max-Grenzen, Sichtbarkeits-Graph etc.) an dieser
 *   Stelle -- das uebernimmt vollstaendig `validateQuestionnaireVersion()`
 *   (`src/server/questionnaire/service.ts`, bereits seit Phase 3A vorhanden)
 *   vor jedem `publish()` (AP4). Ein Entwurf darf zwischenzeitlich
 *   unvollstaendig/inkonsistent sein.
 */

import { Prisma } from "@prisma/client";
import { db } from "../db/client";
import { getTenantId } from "../tenant/context";
import type { ScopedPrismaClient } from "../tenant/scoped-client";
import {
  AdminQuestionNotFoundError,
  QuestionnaireNotFoundError,
  QuestionnaireVersionNotDraftError,
  QuestionnaireVersionNotFoundError,
} from "./question-admin-errors";
import type { CreateDraftVersionInput, CreateQuestionInput, UpdateQuestionInput } from "./schemas";

type ScopedTransactionClient = Parameters<Parameters<ScopedPrismaClient["$transaction"]>[0]>[0];
type QueryClient = ScopedTransactionClient;

// ---------------------------------------------------------------------------
// Oeffentliche DTOs
// ---------------------------------------------------------------------------

export interface QuestionnaireVersionSummary {
  id: string;
  label: string;
  status: string;
  validFrom: string;
  validTo: string | null;
}

export interface QuestionnaireSummary {
  id: string;
  key: string;
  versions: QuestionnaireVersionSummary[];
}

export interface AnswerOptionDetail {
  id: string;
  key: string;
  label: string;
  sortOrder: number;
}

export interface VisibilityConditionDetail {
  id: string;
  targetQuestionId: string;
  operator: string;
  comparisonValue: string;
  combinator: string;
}

export interface QuestionDetail {
  id: string;
  key: string;
  needType: string | null;
  sortOrder: number;
  questionVersionId: string;
  label: string;
  answerType: string;
  isRequired: boolean;
  minValue: string | null;
  maxValue: string | null;
  maxLength: number | null;
  minSelections: number | null;
  maxSelections: number | null;
  status: string;
  answerOptions: AnswerOptionDetail[];
  visibilityConditions: VisibilityConditionDetail[];
}

export interface QuestionnaireVersionDetail {
  id: string;
  questionnaireId: string;
  label: string;
  status: string;
  validFrom: string;
  validTo: string | null;
  questions: QuestionDetail[];
}

// ---------------------------------------------------------------------------
// Interne Ladefunktionen
// ---------------------------------------------------------------------------

type QuestionRow = Prisma.QuestionGetPayload<{
  include: {
    versions: {
      include: { answerOptions: true; visibilityConditions: true };
    };
  };
}>;

/**
 * Liefert fuer jede Frage genau die "aktuelle" `QuestionVersion` -- bei einer
 * DRAFT-`QuestionnaireVersion` ist das die (einzige) DRAFT-Zeile; bei einer
 * bereits veroeffentlichten Version (nur lesend relevant, z. B.
 * `getQuestionnaireVersionDetail()` fuer eine ACTIVE-Version) die neueste
 * nicht-archivierte Zeile, analog zu
 * `loadRepresentativeQuestionNodesForValidation()` in
 * `src/server/questionnaire/service.ts`.
 */
function pickCurrentVersion(q: QuestionRow): QuestionRow["versions"][number] | undefined {
  const draft = q.versions.find((v) => v.status === "DRAFT");
  if (draft) return draft;
  return [...q.versions]
    .filter((v) => v.status !== "ARCHIVED")
    .sort((a, b) => b.validFrom.getTime() - a.validFrom.getTime())[0];
}

function toQuestionDetail(q: QuestionRow): QuestionDetail | null {
  const version = pickCurrentVersion(q);
  if (!version) return null;
  return {
    id: q.id,
    key: q.key,
    needType: q.needType ?? null,
    sortOrder: q.sortOrder,
    questionVersionId: version.id,
    label: version.label,
    answerType: version.answerType,
    isRequired: version.isRequired,
    minValue: version.minValue !== null ? version.minValue.toString() : null,
    maxValue: version.maxValue !== null ? version.maxValue.toString() : null,
    maxLength: version.maxLength ?? null,
    minSelections: version.minSelections ?? null,
    maxSelections: version.maxSelections ?? null,
    status: version.status,
    answerOptions: version.answerOptions
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((o) => ({ id: o.id, key: o.key, label: o.label, sortOrder: o.sortOrder })),
    visibilityConditions: version.visibilityConditions.map((c) => ({
      id: c.id,
      targetQuestionId: c.targetQuestionId,
      operator: c.operator,
      comparisonValue: c.comparisonValue,
      combinator: c.combinator,
    })),
  };
}

async function requireQuestionnaire(client: QueryClient, questionnaireId: string) {
  const questionnaire = await client.questionnaire.findUnique({
    where: { id: questionnaireId },
  });
  if (!questionnaire) {
    throw new QuestionnaireNotFoundError(questionnaireId);
  }
  return questionnaire;
}

/** Laedt eine `QuestionnaireVersion` und prueft, dass sie zum angegebenen `Questionnaire` gehoert. */
async function requireVersion(client: QueryClient, questionnaireId: string, versionId: string) {
  const version = await client.questionnaireVersion.findUnique({ where: { id: versionId } });
  if (!version || version.questionnaireId !== questionnaireId) {
    throw new QuestionnaireVersionNotFoundError(questionnaireId, versionId);
  }
  return version;
}

/** Wie `requireVersion()`, prueft zusaetzlich Status DRAFT (409 sonst) -- fuer alle mutierenden Operationen. */
async function requireDraftVersion(
  client: QueryClient,
  questionnaireId: string,
  versionId: string,
) {
  const version = await requireVersion(client, questionnaireId, versionId);
  if (version.status !== "DRAFT") {
    throw new QuestionnaireVersionNotDraftError(versionId, version.status);
  }
  return version;
}

async function loadQuestionRows(client: QueryClient, questionnaireVersionId: string) {
  return client.question.findMany({
    where: { questionnaireVersionId },
    orderBy: { sortOrder: "asc" },
    include: {
      versions: {
        where: { status: { in: ["DRAFT", "ACTIVE", "EXPIRED"] } },
        include: {
          answerOptions: { orderBy: { sortOrder: "asc" } },
          visibilityConditions: true,
        },
      },
    },
  }) as Promise<QuestionRow[]>;
}

// ---------------------------------------------------------------------------
// 1. Fragebogen-Liste
// ---------------------------------------------------------------------------

export async function listQuestionnaires(): Promise<QuestionnaireSummary[]> {
  const rows = await db.questionnaire.findMany({
    orderBy: { key: "asc" },
    include: { versions: { orderBy: { validFrom: "desc" } } },
  });
  return rows.map((q) => ({
    id: q.id,
    key: q.key,
    versions: q.versions.map((v) => ({
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

export async function getQuestionnaireVersionDetail(
  questionnaireId: string,
  versionId: string,
): Promise<QuestionnaireVersionDetail> {
  await requireQuestionnaire(db, questionnaireId);
  const version = await requireVersion(db, questionnaireId, versionId);
  const questionRows = await loadQuestionRows(db, versionId);

  return {
    id: version.id,
    questionnaireId: version.questionnaireId,
    label: version.label,
    status: version.status,
    validFrom: version.validFrom.toISOString(),
    validTo: version.validTo ? version.validTo.toISOString() : null,
    questions: questionRows
      .map((q) => toQuestionDetail(q))
      .filter((q): q is QuestionDetail => q !== null),
  };
}

// ---------------------------------------------------------------------------
// 3. Neue DRAFT-Version anlegen (leer oder als Kopie)
// ---------------------------------------------------------------------------

export async function createDraftVersion(
  questionnaireId: string,
  input: CreateDraftVersionInput,
): Promise<QuestionnaireVersionDetail> {
  await requireQuestionnaire(db, questionnaireId);
  const tenantId = getTenantId();

  let sourceQuestions: QuestionRow[] = [];
  if (input.copyFromVersionId) {
    await requireVersion(db, questionnaireId, input.copyFromVersionId);
    sourceQuestions = await loadQuestionRows(db, input.copyFromVersionId);
  }

  const now = new Date();

  const newVersionId = await db.$transaction(async (tx) => {
    const newVersion = await tx.questionnaireVersion.create({
      data: {
        tenantId,
        questionnaireId,
        label: input.label,
        status: "DRAFT",
        validFrom: now,
        validTo: null,
      },
    });

    for (const q of sourceQuestions) {
      const sourceVersion = pickCurrentVersion(q);
      if (!sourceVersion) continue;

      const newQuestion = await tx.question.create({
        data: {
          tenantId,
          questionnaireVersionId: newVersion.id,
          key: q.key,
          needType: q.needType,
          sortOrder: q.sortOrder,
        },
      });

      await tx.questionVersion.create({
        data: {
          tenantId,
          questionId: newQuestion.id,
          label: sourceVersion.label,
          answerType: sourceVersion.answerType,
          isRequired: sourceVersion.isRequired,
          minValue: sourceVersion.minValue,
          maxValue: sourceVersion.maxValue,
          maxLength: sourceVersion.maxLength,
          minSelections: sourceVersion.minSelections,
          maxSelections: sourceVersion.maxSelections,
          status: "DRAFT",
          validFrom: now,
          validTo: null,
          answerOptions: {
            create: sourceVersion.answerOptions.map((o) => ({
              tenantId,
              key: o.key,
              label: o.label,
              sortOrder: o.sortOrder,
            })),
          },
        },
      });
    }

    // Zweiter Durchlauf fuer VisibilityConditions: targetQuestionId muss auf
    // die NEUEN Question-IDs dieser Kopie zeigen, nicht auf die Quellfragen
    // -- daher erst nach Anlage ALLER neuen Questions aufloesbar.
    if (sourceQuestions.length > 0) {
      const idMap = new Map<string, string>(); // alte questionId -> neue questionId
      const newQuestions = await tx.question.findMany({
        where: { questionnaireVersionId: newVersion.id },
        include: { versions: { where: { status: "DRAFT" } } },
      });
      // Reihenfolge von sourceQuestions und newQuestions ist durch dieselbe
      // sortOrder-Sortierung + Anlagereihenfolge deckungsgleich; robuster ist
      // ein Mapping ueber `key` (pro QuestionnaireVersion nicht notwendig
      // eindeutig erzwungen, aber in der Praxis eindeutig -- Fallback: erste
      // unbenutzte passende Frage).
      const usedNewIds = new Set<string>();
      for (const sourceQuestion of sourceQuestions) {
        const match = newQuestions.find(
          (nq) => nq.key === sourceQuestion.key && !usedNewIds.has(nq.id),
        );
        if (match) {
          idMap.set(sourceQuestion.id, match.id);
          usedNewIds.add(match.id);
        }
      }

      for (const sourceQuestion of sourceQuestions) {
        const sourceVersion = pickCurrentVersion(sourceQuestion);
        if (!sourceVersion || sourceVersion.visibilityConditions.length === 0) continue;
        const newQuestionId = idMap.get(sourceQuestion.id);
        const newQuestionVersion = newQuestions.find((nq) => nq.id === newQuestionId)?.versions[0];
        if (!newQuestionId || !newQuestionVersion) continue;

        for (const cond of sourceVersion.visibilityConditions) {
          const newTargetId = idMap.get(cond.targetQuestionId);
          if (!newTargetId) continue; // Zielfrage lag ausserhalb der kopierten Menge (sollte nicht vorkommen).
          await tx.visibilityCondition.create({
            data: {
              tenantId,
              questionVersionId: newQuestionVersion.id,
              targetQuestionId: newTargetId,
              operator: cond.operator,
              comparisonValue: cond.comparisonValue,
              combinator: cond.combinator,
            },
          });
        }
      }
    }

    return newVersion.id;
  });

  return getQuestionnaireVersionDetail(questionnaireId, newVersionId);
}

// ---------------------------------------------------------------------------
// 4. Frage zu einer DRAFT-Version hinzufuegen
// ---------------------------------------------------------------------------

export async function addQuestionToDraft(
  questionnaireId: string,
  versionId: string,
  input: CreateQuestionInput,
): Promise<QuestionDetail> {
  await requireQuestionnaire(db, questionnaireId);
  await requireDraftVersion(db, questionnaireId, versionId);
  const tenantId = getTenantId();

  const questionId = await db.$transaction(async (tx) => {
    const question = await tx.question.create({
      data: {
        tenantId,
        questionnaireVersionId: versionId,
        key: input.key,
        needType: input.needType ?? null,
        sortOrder: input.sortOrder,
      },
    });

    await tx.questionVersion.create({
      data: {
        tenantId,
        questionId: question.id,
        label: input.label,
        answerType: input.answerType,
        isRequired: input.isRequired,
        minValue: input.minValue ?? null,
        maxValue: input.maxValue ?? null,
        maxLength: input.maxLength ?? null,
        minSelections: input.minSelections ?? null,
        maxSelections: input.maxSelections ?? null,
        status: "DRAFT",
        validFrom: new Date(),
        validTo: null,
        answerOptions: {
          create: input.answerOptions.map((o) => ({
            tenantId,
            key: o.key,
            label: o.label,
            sortOrder: o.sortOrder,
          })),
        },
        visibilityConditions: {
          create: input.visibilityConditions.map((c) => ({
            tenantId,
            targetQuestionId: c.targetQuestionId,
            operator: c.operator,
            comparisonValue: c.comparisonValue,
            combinator: c.combinator,
          })),
        },
      },
    });

    return question.id;
  });

  const row = (await db.question.findUnique({
    where: { id: questionId },
    include: {
      versions: {
        where: { status: "DRAFT" },
        include: { answerOptions: { orderBy: { sortOrder: "asc" } }, visibilityConditions: true },
      },
    },
  })) as QuestionRow | null;

  const detail = row ? toQuestionDetail(row) : null;
  if (!detail) {
    throw new AdminQuestionNotFoundError(questionId, versionId);
  }
  return detail;
}

// ---------------------------------------------------------------------------
// 5. Frage in einer DRAFT-Version bearbeiten
// ---------------------------------------------------------------------------

export async function updateQuestionInDraft(
  questionnaireId: string,
  versionId: string,
  questionId: string,
  patch: UpdateQuestionInput,
): Promise<QuestionDetail> {
  await requireQuestionnaire(db, questionnaireId);
  await requireDraftVersion(db, questionnaireId, versionId);
  const tenantId = getTenantId();

  const question = await db.question.findUnique({
    where: { id: questionId },
    include: { versions: { where: { status: "DRAFT" } } },
  });
  if (!question || question.questionnaireVersionId !== versionId) {
    throw new AdminQuestionNotFoundError(questionId, versionId);
  }
  const currentVersion = question.versions[0];
  if (!currentVersion) {
    throw new AdminQuestionNotFoundError(questionId, versionId);
  }

  await db.$transaction(async (tx) => {
    if (patch.key !== undefined || patch.needType !== undefined || patch.sortOrder !== undefined) {
      await tx.question.update({
        where: { id: questionId },
        data: {
          ...(patch.key !== undefined ? { key: patch.key } : {}),
          ...(patch.needType !== undefined ? { needType: patch.needType } : {}),
          ...(patch.sortOrder !== undefined ? { sortOrder: patch.sortOrder } : {}),
        },
      });
    }

    const versionFieldsChanged =
      patch.label !== undefined ||
      patch.answerType !== undefined ||
      patch.isRequired !== undefined ||
      patch.minValue !== undefined ||
      patch.maxValue !== undefined ||
      patch.maxLength !== undefined ||
      patch.minSelections !== undefined ||
      patch.maxSelections !== undefined;

    if (versionFieldsChanged) {
      await tx.questionVersion.update({
        where: { id: currentVersion.id },
        data: {
          ...(patch.label !== undefined ? { label: patch.label } : {}),
          ...(patch.answerType !== undefined ? { answerType: patch.answerType } : {}),
          ...(patch.isRequired !== undefined ? { isRequired: patch.isRequired } : {}),
          ...(patch.minValue !== undefined ? { minValue: patch.minValue } : {}),
          ...(patch.maxValue !== undefined ? { maxValue: patch.maxValue } : {}),
          ...(patch.maxLength !== undefined ? { maxLength: patch.maxLength } : {}),
          ...(patch.minSelections !== undefined ? { minSelections: patch.minSelections } : {}),
          ...(patch.maxSelections !== undefined ? { maxSelections: patch.maxSelections } : {}),
        },
      });
    }

    if (patch.answerOptions !== undefined) {
      await tx.answerOption.deleteMany({ where: { questionVersionId: currentVersion.id } });
      if (patch.answerOptions.length > 0) {
        await tx.answerOption.createMany({
          data: patch.answerOptions.map((o) => ({
            tenantId,
            questionVersionId: currentVersion.id,
            key: o.key,
            label: o.label,
            sortOrder: o.sortOrder,
          })),
        });
      }
    }

    if (patch.visibilityConditions !== undefined) {
      await tx.visibilityCondition.deleteMany({ where: { questionVersionId: currentVersion.id } });
      if (patch.visibilityConditions.length > 0) {
        await tx.visibilityCondition.createMany({
          data: patch.visibilityConditions.map((c) => ({
            tenantId,
            questionVersionId: currentVersion.id,
            targetQuestionId: c.targetQuestionId,
            operator: c.operator,
            comparisonValue: c.comparisonValue,
            combinator: c.combinator,
          })),
        });
      }
    }
  });

  const row = (await db.question.findUnique({
    where: { id: questionId },
    include: {
      versions: {
        where: { status: "DRAFT" },
        include: { answerOptions: { orderBy: { sortOrder: "asc" } }, visibilityConditions: true },
      },
    },
  })) as QuestionRow | null;
  const detail = row ? toQuestionDetail(row) : null;
  if (!detail) {
    throw new AdminQuestionNotFoundError(questionId, versionId);
  }
  return detail;
}

// ---------------------------------------------------------------------------
// 6. Frage aus einer DRAFT-Version entfernen
// ---------------------------------------------------------------------------

export async function removeQuestionFromDraft(
  questionnaireId: string,
  versionId: string,
  questionId: string,
): Promise<void> {
  await requireQuestionnaire(db, questionnaireId);
  await requireDraftVersion(db, questionnaireId, versionId);

  const question = await db.question.findUnique({ where: { id: questionId } });
  if (!question || question.questionnaireVersionId !== versionId) {
    throw new AdminQuestionNotFoundError(questionId, versionId);
  }

  await db.$transaction(async (tx) => {
    // VisibilityConditions, die AUF diese Frage zeigen (aus anderen Fragen
    // derselben Version), muessen zuerst entfernt werden (onDelete: Restrict
    // auf VisibilityCondition.targetQuestion).
    await tx.visibilityCondition.deleteMany({ where: { targetQuestionId: questionId } });
    const versions = await tx.questionVersion.findMany({ where: { questionId } });
    for (const v of versions) {
      await tx.visibilityCondition.deleteMany({ where: { questionVersionId: v.id } });
      await tx.answerOption.deleteMany({ where: { questionVersionId: v.id } });
    }
    await tx.questionVersion.deleteMany({ where: { questionId } });
    await tx.question.delete({ where: { id: questionId } });
  });
}
