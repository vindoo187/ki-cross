/**
 * AP10 -- markiert den manuellen Abbruch einer Beratungssitzung
 * (`CONSULTATION_ABANDONED`, siehe PHASE_5_IMPLEMENTATION_PLAN.md Abschnitt
 * 10 + Abschnitt 16 Punkt 10, sowie die Projektleiter-Entscheidung zum
 * manuellen Abbruchflow vom 2026-08-03).
 *
 * Projektleiter-Entscheidung (bindend): Ein Timeout-/Cron-/Background-Job-
 * Ausloeser wird in Phase 5 bewusst NICHT eingefuehrt (keine vorhandene
 * Infrastruktur, fachlich unscharf -- eine unterbrochene/lange offene
 * Beratung ist nicht automatisch abgebrochen). `CONSULTATION_ABANDONED`
 * entsteht ausschliesslich durch einen expliziten, bestaetigten Klick auf
 * den "Beratung abbrechen"-Button (`AbandonConsultationButton.tsx`). Ein
 * blosser Seitenwechsel, Tab-Schluss oder Netzwerkabbruch schreibt KEIN
 * Event. Timeout-Erkennung ist als spaetere Erweiterung dokumentiert, kein
 * Phase-5-Blocker.
 *
 * Analog zu `completeConsultation()` (`completion.ts`) bewusst KEIN neuer
 * `ConsultationSession`-Statuswert und kein Schreiben von `status`/`endedAt`
 * hier: obwohl `ConsultationStatus` im Schema bereits einen `ABANDONED`-Wert
 * kennt, soll AP10 laut Projektleiter-Entscheidung NICHT vorschnell ein
 * neues Lifecycle-Modell einfuehren. Die gegenseitige Ausschliesslichkeit
 * von `CONSULTATION_COMPLETED` und `CONSULTATION_ABANDONED` wird daher aus
 * den bereits geschriebenen TERMINALEN Analytics-Events abgeleitet (Payload-
 * Abfrage auf `consultationSessionId`, gleiches Muster wie die Idempotenz-
 * Abfrage in `completion.ts`). Offene Doku-Frage fuer eine spaetere Phase:
 * ob weitere Schreiboperationen (z. B. `saveAnswer()`/`changeAnswer()`)
 * ebenfalls gegen diesen terminalen Zustand abgesichert werden muessen --
 * hier bewusst nicht geloest, um keine neue Fachlogik ausserhalb von AP10
 * einzufuehren.
 *
 * Idempotenz: ein wiederholter Abbruch-Klick (Doppelklick, erneuter
 * Button-Klick) schreibt kein zweites Event, sondern liefert
 * `alreadyAbandoned: true` zurueck -- kein Fehler (identisches Muster zu
 * `completeConsultation()`).
 *
 * Konflikt: ist die Sitzung bereits per `CONSULTATION_COMPLETED` (mittels
 * `completeConsultation()`) abgeschlossen, wirft diese Funktion
 * `ConsultationAlreadyCompletedError` (409, siehe `http-errors.ts`) --
 * Abschluss ist laut Projektleiter-Entscheidung staerker als ein
 * nachtraeglicher Abbruchversuch.
 *
 * `reasonCode` ist optional und rein strukturiert (kein Freitext, siehe
 * Projektleiter-Entscheidung) -- vier feste Werte, analog zur bestehenden
 * `reasonCode`-Konvention in `recommendation/sales-opportunity.ts` (interner
 * String-Code, keine eigene DB-Tabelle noetig fuer diese kleine, feste
 * Auswahl -- anders als die tenant-gepflegte `RejectionReason`-Liste, die
 * fuer einen anderen, tenant-spezifisch konfigurierbaren Anwendungsfall
 * gedacht ist).
 *
 * Bestehende Antworten und Recommendations bleiben unveraendert erhalten
 * (kein Loeschen/Anonymisieren hier) -- reine Nachvollziehbarkeit laut
 * Projektleiter-Entscheidung.
 *
 * SANDBOX-VERIFIKATIONSLUECKE (rein tooling-bedingt): siehe Modulkommentar in
 * `questionnaire/service.ts` -- identische Fehlerklasse, nur in CI gegen
 * einen echten `@prisma/client` verifizierbar.
 */

import { db } from "../db/client";
import { getTenantId } from "../tenant/context";
import {
  ConsultationSessionNotFoundError,
  ConsultationAlreadyCompletedError,
} from "../questionnaire/errors";

const EVENT_TYPE = "CONSULTATION_ABANDONED";
const COMPLETED_EVENT_TYPE = "CONSULTATION_COMPLETED";

/**
 * Strukturierte, optionale Abbruchgruende (Projektleiter-Entscheidung) --
 * kein verpflichtendes Freitextfeld.
 */
export const CONSULTATION_ABANDON_REASON_CODES = [
  "CUSTOMER_DOES_NOT_WANT_TO_CONTINUE",
  "CUSTOMER_HAS_NO_TIME",
  "TECHNICAL_ISSUE",
  "OTHER",
] as const;

export type ConsultationAbandonReasonCode = (typeof CONSULTATION_ABANDON_REASON_CODES)[number];

export interface AbandonConsultationResult {
  consultationSessionId: string;
  /** true, wenn fuer diese Sitzung bereits zuvor ein CONSULTATION_ABANDONED-Event existierte (kein neues Event geschrieben). */
  alreadyAbandoned: boolean;
}

/**
 * Markiert eine Beratungssitzung als manuell abgebrochen (schreibt genau
 * einmal pro Sitzung ein `CONSULTATION_ABANDONED`-Analytics-Event).
 *
 * @throws {ConsultationSessionNotFoundError} Sitzung existiert nicht (oder gehoert einem anderen Mandanten).
 * @throws {ConsultationAlreadyCompletedError} Sitzung wurde bereits per completeConsultation() abgeschlossen.
 */
export async function abandonConsultation(
  consultationSessionId: string,
  reasonCode?: ConsultationAbandonReasonCode,
): Promise<AbandonConsultationResult> {
  const tenantId = getTenantId();

  const session = await db.consultationSession.findUnique({
    where: { id: consultationSessionId },
  });
  if (!session) {
    throw new ConsultationSessionNotFoundError(consultationSessionId);
  }

  const alreadyAbandoned = await db.$transaction(async (tx) => {
    const completedEvent = await tx.analyticsEvent.findFirst({
      where: {
        eventType: COMPLETED_EVENT_TYPE,
        payload: { path: ["consultationSessionId"], equals: consultationSessionId },
      },
    });
    if (completedEvent) {
      throw new ConsultationAlreadyCompletedError(consultationSessionId, completedEvent.occurredAt);
    }

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
        payload: reasonCode ? { consultationSessionId, reasonCode } : { consultationSessionId },
      },
    });
    return false;
  });

  return { consultationSessionId, alreadyAbandoned };
}
