/**
 * Zusammenfassungsseite `/consultation/[sessionId]/summary` (AP9, siehe
 * PHASE_5_IMPLEMENTATION_PLAN.md Abschnitt 5, Schritt 10 + Abschnitt 3).
 * Server Component: laedt das bereits vollstaendig server-seitig komponierte
 * `ConsultationSessionSummaryView` (`buildConsultationSessionSummaryView()`,
 * siehe `view-models.ts`) -- reine Anzeige, keine eigene Ladelogik hier.
 *
 * Wie bei `/consultation/[sessionId]` und `/consultation/[sessionId]/recommendation`:
 * ein `ConsultationSessionNotFoundError` (fremder Mandant/falsche ID) wird
 * bewusst NICHT hier abgefangen -- Next.js' Standard-Fehlerseite reicht fuer
 * diesen internen Pilotbetrieb (Plan Abschnitt 15). Funktioniert unveraendert
 * auch fuer noch `IN_PROGRESS`-Sessions (kein Status-Gate) -- die
 * Zusammenfassung ist eine reine Lesekomposition, kein Abschluss-Gate.
 *
 * AP10-Ergaenzung (siehe Plan Abschnitt 10, Zeile "Sitzung/Beratung
 * beendet"): der bisherige reine `<Link>` "Zurueck zur Uebersicht" ist durch
 * `CompleteConsultationButton` ersetzt -- der Klick schreibt zuerst das
 * `CONSULTATION_COMPLETED`-Analytics-Event (`completeConsultation()`, siehe
 * `completion.ts`) und navigiert danach zur Uebersicht. Idempotent, daher
 * kein Risiko durch mehrfachen Aufruf der Seite/des Buttons.
 *
 * AP10-Ergaenzung 2 (Projektleiter-Entscheidung zum manuellen Abbruchflow):
 * `AbandonConsultationButton` wird zusaetzlich gezeigt, solange
 * `summary.status === "IN_PROGRESS"` -- fuer bereits abgeschlossene
 * Sitzungen ist ein Abbruch fachlich sinnlos (`abandonConsultation()` wuerde
 * ohnehin `ConsultationAlreadyCompletedError`/409 liefern, das Gate hier
 * vermeidet nur die unnoetige Anzeige).
 */

import { redirect } from "next/navigation";
import {
  getOptionalServerSession,
  withServerSessionTenantContext,
} from "@/server/auth/server-context";
import {
  buildConsultationSessionSummaryView,
  getConsultationSidebarData,
} from "@/server/consultation-ui/view-models";
import { ErrorBoundary } from "@/components/consultation/ErrorBoundary";
import { SessionSummaryView } from "@/components/consultation/SessionSummaryView";
import { CompleteConsultationButton } from "@/components/consultation/CompleteConsultationButton";
import { AbandonConsultationButton } from "@/components/consultation/AbandonConsultationButton";
import { ConsultationSidebar } from "@/components/consultation/ConsultationSidebar";

export const dynamic = "force-dynamic";

interface PageParams {
  params: Promise<{ sessionId: string }>;
}

export default async function ConsultationSummaryPage({ params }: PageParams) {
  const session = await getOptionalServerSession();
  if (!session) {
    redirect("/login");
  }

  const { sessionId } = await params;
  const { summary, sidebarData } = await withServerSessionTenantContext(async () => {
    const [summaryView, sidebar] = await Promise.all([
      buildConsultationSessionSummaryView(sessionId),
      getConsultationSidebarData(sessionId),
    ]);
    return { summary: summaryView, sidebarData: sidebar };
  });

  return (
    <div className="consultation-workspace__body">
      <main className="consultation-workspace__main">
        <ErrorBoundary>
          <h2>Zusammenfassung</h2>
          <SessionSummaryView summary={summary} />
          <CompleteConsultationButton consultationSessionId={sessionId} />
          {summary.status === "IN_PROGRESS" && (
            <AbandonConsultationButton consultationSessionId={sessionId} />
          )}
        </ErrorBoundary>
      </main>
      <ConsultationSidebar data={sidebarData} />
    </div>
  );
}
