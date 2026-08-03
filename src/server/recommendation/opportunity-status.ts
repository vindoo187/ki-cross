/**
 * Statusfunktion fuer `SalesOpportunity` (AP5, siehe
 * PHASE_5_IMPLEMENTATION_PLAN.md Abschnitt 2.2 Punkt 4 + Abschnitt 9).
 *
 * `SalesOpportunity`-Zeilen werden bereits automatisch durch `evaluate()`
 * (siehe `service.ts`, `createSalesOpportunitiesForSignals()`) mit
 * `status = OPEN` angelegt - diese Funktion ist der EINZIGE Schreibpfad, der
 * den Status danach aendert (Mitarbeiter markiert `OFFERED`/`ACCEPTED`/
 * `DECLINED`/`DEFERRED` in der UI, AP8).
 *
 * Erlaubte Uebergangsreihenfolge (Plan Abschnitt 9, Stop-Punkt 3 - mit
 * ChatGPT abgestimmt: "wie vorgeschlagen", siehe Abschnitt 15):
 *   OPEN     -> OFFERED
 *   OFFERED  -> ACCEPTED | DECLINED | DEFERRED
 *   DEFERRED -> OFFERED   (erneutes Anbieten nach Zurueckstellen)
 *   ACCEPTED -> (terminal, keine weiteren Uebergaenge)
 *   DECLINED -> (terminal, keine weiteren Uebergaenge)
 * Das Prisma-Schema selbst erzwingt keine Reihenfolge - diese Funktion ist
 * die einzige Durchsetzungsstelle. Jeder nicht aufgefuehrte Uebergang wirft
 * `InvalidOpportunityStatusTransitionError`.
 *
 * Zeitstempel: `offeredAt` wird bei jedem Uebergang NACH "OFFERED" gesetzt
 * (auch beim erneuten Anbieten aus DEFERRED - bewusst kein "nur beim ersten
 * Mal", da fuer die UI der zuletzt tatsaechliche Angebotszeitpunkt relevanter
 * ist als der erste). `resolvedAt` wird beim Erreichen eines der beiden
 * terminalen Zustaende (ACCEPTED/DECLINED) gesetzt und danach nie wieder
 * veraendert (kein Uebergang verlaesst diese Zustaende).
 *
 * Analytics: nur `OFFERED`/`DECLINED` haben ein passendes `AnalyticsEventType`-
 * Aequivalent (`OPPORTUNITY_OFFERED`/`OPPORTUNITY_DECLINED`, Plan Abschnitt
 * 10, "Empfehlung"-Zeile). Fuer `ACCEPTED`/`DEFERRED` existiert KEIN
 * Enum-Wert - dokumentierte, bewusste Luecke (analog zur DEFERRED-Luecke in
 * `outcome.ts`), kein Bug. Analytics-Schreiben laeuft, dem bestehenden Muster
 * folgend, INNERHALB derselben Transaktion wie die Statusaenderung.
 *
 * SANDBOX-VERIFIKATIONSLUECKE (rein tooling-bedingt): siehe Modulkommentar in
 * `service.ts` - identische Fehlerklasse, nur in CI gegen einen echten
 * `@prisma/client` verifizierbar.
 */

import type { OpportunityStatus } from "@prisma/client";
import { db } from "../db/client";
import { getTenantId } from "../tenant/context";
import { InvalidOpportunityStatusTransitionError, SalesOpportunityNotFoundError } from "./errors";

export interface UpdateSalesOpportunityStatusInput {
  salesOpportunityId: string;
  status: OpportunityStatus;
}

export interface SalesOpportunityStatusResult {
  id: string;
  consultationSessionId: string;
  status: OpportunityStatus;
  /** ISO-8601 oder null */
  offeredAt: string | null;
  /** ISO-8601 oder null */
  resolvedAt: string | null;
}

/** Siehe Modulkommentar: einzige Durchsetzungsstelle der Uebergangsreihenfolge. */
const ALLOWED_TRANSITIONS: Record<OpportunityStatus, OpportunityStatus[]> = {
  OPEN: ["OFFERED"],
  OFFERED: ["ACCEPTED", "DECLINED", "DEFERRED"],
  DEFERRED: ["OFFERED"],
  ACCEPTED: [],
  DECLINED: [],
};

/** Analytics-Zuordnung fuer Statuswechsel (Plan Abschnitt 10). ACCEPTED/DEFERRED bewusst ohne Eintrag - siehe Modulkommentar. */
const OPPORTUNITY_ANALYTICS_EVENT_TYPE: Partial<Record<OpportunityStatus, string>> = {
  OFFERED: "OPPORTUNITY_OFFERED",
  DECLINED: "OPPORTUNITY_DECLINED",
};

/**
 * Aktualisiert den Status einer `SalesOpportunity` gemaess der erlaubten
 * Uebergangsreihenfolge (siehe Modulkommentar).
 *
 * @throws {SalesOpportunityNotFoundError} Opportunity existiert nicht (oder gehoert einem anderen Mandanten).
 * @throws {InvalidOpportunityStatusTransitionError} Uebergang vom aktuellen zum angeforderten Status ist nicht erlaubt.
 */
export async function updateSalesOpportunityStatus(
  input: UpdateSalesOpportunityStatusInput,
): Promise<SalesOpportunityStatusResult> {
  const tenantId = getTenantId();

  const opportunity = await db.salesOpportunity.findUnique({
    where: { id: input.salesOpportunityId },
    include: { session: true },
  });
  if (!opportunity) {
    throw new SalesOpportunityNotFoundError(input.salesOpportunityId);
  }

  const allowedNextStatuses = ALLOWED_TRANSITIONS[opportunity.status] ?? [];
  if (!allowedNextStatuses.includes(input.status)) {
    throw new InvalidOpportunityStatusTransitionError(
      opportunity.id,
      opportunity.status,
      input.status,
    );
  }

  const now = new Date();
  const offeredAt = input.status === "OFFERED" ? now : opportunity.offeredAt;
  const resolvedAt =
    input.status === "ACCEPTED" || input.status === "DECLINED" ? now : opportunity.resolvedAt;
  const session = opportunity.session;

  const updated = await db.$transaction(async (tx) => {
    const result = await tx.salesOpportunity.update({
      where: { id: opportunity.id },
      data: { status: input.status, offeredAt, resolvedAt },
    });

    const analyticsEventType = OPPORTUNITY_ANALYTICS_EVENT_TYPE[input.status];
    if (analyticsEventType) {
      await tx.analyticsEvent.create({
        data: {
          tenantId,
          storeId: session.storeId,
          employeeId: session.employeeId,
          eventType: analyticsEventType,
          occurredAt: now,
          payload: {
            salesOpportunityId: opportunity.id,
            consultationSessionId: session.id,
            previousStatus: opportunity.status,
            newStatus: input.status,
          },
        },
      });
    }

    return result;
  });

  return {
    id: updated.id,
    consultationSessionId: updated.consultationSessionId,
    status: updated.status,
    offeredAt: updated.offeredAt ? updated.offeredAt.toISOString() : null,
    resolvedAt: updated.resolvedAt ? updated.resolvedAt.toISOString() : null,
  };
}
