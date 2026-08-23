/**
 * AP10 -- markiert den Abschluss einer Beratungssitzung (`CONSULTATION_COMPLETED`,
 * siehe PHASE_5_IMPLEMENTATION_PLAN.md Abschnitt 10 + Abschnitt 16 Punkt 10).
 *
 * Ausdruecklich ein eigenstaendiges Ereignis, zu unterscheiden von
 * `QUESTIONNAIRE_COMPLETED` (`completeQuestionnaire()`, siehe
 * `questionnaire/service.ts`): jenes markiert nur den Abschluss des
 * Fragebogens selbst, dieses hier markiert laut Plan Abschnitt 10
 * ("Sitzung/Beratung beendet") den Abschluss der GESAMTEN Beratung (inkl.
 * Empfehlung/Outcome-Entscheidungen) -- ausgeloest durch den "Beratung
 * abschliessen"-Button auf der Zusammenfassungsseite
 * (`CompleteConsultationButton.tsx`), nicht durch blossen Seitenaufruf.
 *
 * Bewusst KEIN neuer `ConsultationSession`-Statuswert und keine Wiederver-
 * wendung von `endedAt`: dieses Feld wird bereits von `completeQuestionnaire()`
 * gesetzt (siehe `questionnaire/service.ts`) und wuerde beide Ereignisse
 * vermischen. Idempotenz laeuft stattdessen ueber eine Payload-Abfrage auf
 * bereits geschriebene `CONSULTATION_COMPLETED`-Events fuer dieselbe
 * `consultationSessionId` (analog im Zweck zur Fingerprint-Idempotenz der
 * Empfehlungs-Engine, nur ohne DB-Unique-Index -- ein zusaetzlicher
 * Unique-Index auf einem `Json?`-Feld waere eine eigens abzustimmende
 * Schemaaenderung). Ein wiederholter Aufruf (Doppelklick, erneuter
 * Button-Klick nach Zurueck-Navigation) schreibt daher kein zweites Event,
 * sondern liefert `alreadyCompleted: true` zurueck -- kein Fehler.
 *
 * Funktioniert unabhaengig vom `ConsultationSession.status`
 * (`IN_PROGRESS`/`COMPLETED`/`ABANDONED`), analog zu
 * `buildConsultationSessionSummaryView()` (`view-models.ts`): die
 * Zusammenfassungsseite ist bereits heute status-unabhaengig aufrufbar,
 * diese Funktion uebernimmt dieselbe Regel fuer den Abschluss-Event.
 *
 * Analytics-Schreibvorgang laeuft, dem bestehenden Muster aus
 * `outcome.ts`/`opportunity-status.ts` folgend, INNERHALB einer Transaktion
 * (hier: Idempotenz-Check + Schreiben zusammen, um ein Doppel-Request-Race
 * zu vermeiden).
 *
 * SANDBOX-VERIFIKATIONSLUECKE (rein tooling-bedingt): siehe Modulkommentar in
 * `questionnaire/service.ts` -- identische Fehlerklasse, nur in CI gegen
 * einen echten `@prisma/client` verifizierbar.
 */

import { db } from "../db/client";
import { getTenantId } from "../tenant/context";
import { ConsultationSessionNotFoundError } from "../questionnaire/errors";

const EVENT_TYPE = "CONSULTATION_COMPLETED";

export interface CompleteConsultationResult {
  consultationSessionId: string;
  /** true, wenn fuer diese Sitzung bereits zuvor ein CONSULTATION_COMPLETED-Event existierte (kein neues Event geschrieben). */
  alreadyCompleted: boolean;
}

/**
 * Markiert eine Beratungssitzung als abgeschlossen (schreibt genau einmal pro
 * Sitzung ein `CONSULTATION_COMPLETED`-Analytics-Event).
 *
 * @throws {ConsultationSessionNotFoundError} Sitzung existiert nicht (oder gehoert einem anderen Mandanten).
 */
export async function completeConsultation(
  consultationSessionId: string,
): Promise<CompleteConsultationResult> {
  const tenantId = getTenantId();

  const session = await db.consultationSession.findUnique({
    where: { id: consultationSessionId },
  });
  if (!session) {
    throw new ConsultationSessionNotFoundError(consultationSessionId);
  }

  const alreadyCompleted = await db.$transaction(async (tx) => {
    const existing = await tx.analyticsEvent.findFirst({
      where: {
        eventType: EVENT_TYPE,
        payload: { path: ["consultationSessionId"], equals: consultationSessionId },
      },
    });
    if (existing) {
      return true;
    }

    await tx.analyticsEvent.create({
      data: {
        tenantId,
        storeId: session.storeId,
        employeeId: session.employeeId,
        eventType: EVENT_TYPE,
        occurredAt: new Date(),
        payload: { consultationSessionId },
      },
    });
    return false;
  });

  return { consultationSessionId, alreadyCompleted };
}
