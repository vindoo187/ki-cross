/**
 * Outcome-Schreibpfad fuer ein einzelnes RecommendationItem (AP5, siehe
 * PHASE_5_IMPLEMENTATION_PLAN.md Abschnitt 2.2 Punkt 3 + Abschnitt 8).
 *
 * Ein Mitarbeiter entscheidet pro `RecommendationItem` genau einmal
 * (`ACCEPTED`/`REJECTED`/`DEFERRED`) - `RecommendationOutcome` ist append-only
 * und durch `@@unique([tenantId, recommendationItemId])` sowie den DB-Trigger
 * `forbid_update_delete` (siehe Phase-3B-Migration) gegen nachtraegliche
 * Aenderung/Wiederholung geschuetzt. Ein wiederholter Versuch (z. B.
 * Doppel-Request-Race durch Mehrfachklick) liefert `RecommendationOutcomeAlreadyExistsError`
 * statt eines technischen P2002-Fehlers - die aufrufende UI-Schicht soll dies
 * als "bereits entschieden am {decidedAt}" darstellen (Plan Abschnitt 8).
 *
 * REJECTED verlangt eine aktive `rejectionReasonId` aus der tenant-gepflegten
 * `RejectionReason`-Liste (Pflichtangabe); alle anderen Outcomes duerfen
 * keine rejectionReasonId setzen. Ein Freitextfeld ist in
 * `docs/RECOMMENDATION_ENGINE.md` erwaehnt, existiert aber NICHT als Spalte
 * in `RecommendationOutcome` (Schema-Doku-Divergenz) - das ist eine
 * vorbestehende Luecke, die AP5 bewusst NICHT durch eine eigenmaechtige
 * Schemaaenderung schliesst (Schemaaenderungen erfordern eigene Abstimmung).
 *
 * Analytics: nur fuer ACCEPTED/REJECTED existiert ein passender
 * `AnalyticsEventType` (`RECOMMENDATION_ACCEPTED`/`RECOMMENDATION_REJECTED`,
 * siehe Plan Abschnitt 10). Fuer DEFERRED gibt es KEIN Enum-Aequivalent -
 * dies ist eine dokumentierte, bewusste Luecke, kein Bug. Der Analytics-
 * Schreibvorgang laeuft, dem bestehenden Muster aus `service.ts` folgend,
 * INNERHALB derselben Transaktion wie der Fachdatensatz (Plan Abschnitt 10:
 * "Phase 5 sollte diesem bestehenden Muster folgen, um konsistent zu
 * bleiben").
 *
 * `decidedByEmployeeId` kommt bewusst aus dem AKTUELLEN TenantContext (der
 * tatsaechlich entscheidende Mitarbeiter), nicht aus `ConsultationSession.employeeId`
 * (der urspruengliche Sitzungsinhaber) - das koennen unterschiedliche
 * Mitarbeiter sein. Die begleitende `AnalyticsEvent.storeId`/`employeeId`-
 * Zuordnung folgt dagegen der bestehenden Konvention aus
 * `questionnaire/service.ts` und richtet sich nach der `ConsultationSession`
 * (Sitzungs-Attribution), nicht nach dem aktuellen Akteur.
 *
 * SANDBOX-VERIFIKATIONSLUECKE (rein tooling-bedingt): siehe Modulkommentar in
 * `service.ts` - identische Fehlerklasse (TS7016/TS7006/TS18046), nur in CI
 * gegen einen echten `@prisma/client` verifizierbar.
 */

import type { AnalyticsEventType, RecommendationOutcomeType } from "@prisma/client";
import { Prisma } from "@prisma/client";
import { db } from "../db/client";
import { getTenantContext, getTenantId, MissingTenantContextError } from "../tenant/context";
import {
  RecommendationItemNotFoundError,
  RecommendationOutcomeAlreadyExistsError,
  RejectionReasonNotApplicableError,
  RejectionReasonNotFoundError,
  RejectionReasonRequiredError,
} from "./errors";

export interface RecordRecommendationOutcomeInput {
  recommendationItemId: string;
  outcome: RecommendationOutcomeType;
  /** Nur fuer outcome = "REJECTED" erlaubt/erforderlich, sonst muss das Feld weggelassen oder null sein. */
  rejectionReasonId?: string | null;
}

export interface RecommendationOutcomeResult {
  id: string;
  recommendationItemId: string;
  outcome: RecommendationOutcomeType;
  rejectionReasonId: string | null;
  decidedByEmployeeId: string;
  /** ISO-8601 */
  decidedAt: string;
  /** ISO-8601 */
  createdAt: string;
}

/**
 * Analytics-Zuordnung fuer den Outcome-Entscheid (Plan Abschnitt 10).
 * DEFERRED hat bewusst KEINEN Eintrag - siehe Modulkommentar.
 */
const OUTCOME_ANALYTICS_EVENT_TYPE: Partial<Record<RecommendationOutcomeType, AnalyticsEventType>> =
  {
    ACCEPTED: "RECOMMENDATION_ACCEPTED",
    REJECTED: "RECOMMENDATION_REJECTED",
  };

/**
 * Speichert die Mitarbeiter-Entscheidung (Annehmen/Ablehnen/Zurueckstellen)
 * fuer ein einzelnes `RecommendationItem`.
 *
 * @throws {RecommendationItemNotFoundError} Item existiert nicht (oder gehoert einem anderen Mandanten).
 * @throws {RejectionReasonRequiredError} outcome = "REJECTED" ohne rejectionReasonId.
 * @throws {RejectionReasonNotApplicableError} rejectionReasonId gesetzt, obwohl outcome != "REJECTED".
 * @throws {RejectionReasonNotFoundError} rejectionReasonId existiert nicht/gehoert anderem Mandanten/ist inaktiv.
 * @throws {RecommendationOutcomeAlreadyExistsError} fuer dieses Item existiert bereits ein Outcome.
 */
export async function recordRecommendationOutcome(
  input: RecordRecommendationOutcomeInput,
): Promise<RecommendationOutcomeResult> {
  const tenantId = getTenantId();
  const actorEmployeeId = getTenantContext().employeeId;
  if (!actorEmployeeId) {
    // Jede tatsaechlich authentifizierte Session traegt eine employeeId (siehe
    // request-context.ts / session.ts) - dies waere eine Verletzung dieser
    // Invariante, kein regulaerer fachlicher Fehlerfall.
    throw new MissingTenantContextError();
  }

  const item = await db.recommendationItem.findUnique({
    where: { id: input.recommendationItemId },
    include: { recommendation: { include: { session: true } } },
  });
  if (!item) {
    throw new RecommendationItemNotFoundError(input.recommendationItemId);
  }

  let rejectionReasonId: string | null = null;
  if (input.outcome === "REJECTED") {
    if (!input.rejectionReasonId) {
      throw new RejectionReasonRequiredError(input.recommendationItemId);
    }
    const reason = await db.rejectionReason.findUnique({
      where: { id: input.rejectionReasonId },
    });
    if (!reason || !reason.isActive) {
      throw new RejectionReasonNotFoundError(input.rejectionReasonId);
    }
    rejectionReasonId = reason.id;
  } else if (input.rejectionReasonId) {
    throw new RejectionReasonNotApplicableError(input.recommendationItemId, input.outcome);
  }

  const decidedAt = new Date();
  const session = item.recommendation.session;

  try {
    const created = await db.$transaction(async (tx) => {
      const outcome = await tx.recommendationOutcome.create({
        data: {
          tenantId,
          recommendationItemId: item.id,
          outcome: input.outcome,
          rejectionReasonId,
          decidedByEmployeeId: actorEmployeeId,
          decidedAt,
        },
      });

      const analyticsEventType = OUTCOME_ANALYTICS_EVENT_TYPE[input.outcome];
      if (analyticsEventType) {
        await tx.analyticsEvent.create({
          data: {
            tenantId,
            storeId: session.storeId,
            employeeId: session.employeeId,
            eventType: analyticsEventType,
            occurredAt: decidedAt,
            payload: {
              recommendationItemId: item.id,
              recommendationId: item.recommendationId,
              consultationSessionId: session.id,
              outcome: input.outcome,
              rejectionReasonId,
            },
          },
        });
      }

      return outcome;
    });

    return {
      id: created.id,
      recommendationItemId: created.recommendationItemId,
      outcome: created.outcome,
      rejectionReasonId: created.rejectionReasonId,
      decidedByEmployeeId: created.decidedByEmployeeId,
      decidedAt: created.decidedAt.toISOString(),
      createdAt: created.createdAt.toISOString(),
    };
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      const existing = await db.recommendationOutcome.findFirst({
        where: { recommendationItemId: item.id },
      });
      throw new RecommendationOutcomeAlreadyExistsError(item.id, existing?.decidedAt ?? null);
    }
    throw err;
  }
}
