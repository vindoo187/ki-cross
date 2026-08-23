/**
 * Empfehlungsuebersicht `/consultation/[sessionId]/recommendation` (AP6,
 * siehe PHASE_5_IMPLEMENTATION_PLAN.md Abschnitt 3 + 5, Schritt 7). Server
 * Component: laedt `getLatestRecommendation()` (reiner Lesezugriff,
 * funktioniert auch fuer bereits `COMPLETED`-Sessions) und baut daraus das
 * Mitarbeiter-facing Read-Model `ConsultationRecommendationView`
 * (`buildConsultationRecommendationView()`). Existiert noch keine
 * Recommendation, zeigt die Seite den Ausloese-Button
 * (`EvaluateRecommendationButton`) statt eines leeren Zustands.
 *
 * Wie bei `/consultation/[sessionId]`: ein `ConsultationSessionNotFoundError`
 * (fremder Mandant/falsche ID) wird bewusst NICHT hier abgefangen -- Next.js'
 * Standard-Fehlerseite reicht fuer diesen internen Pilotbetrieb (Plan
 * Abschnitt 15).
 *
 * AP8-Ergaenzung (siehe Plan Abschnitt 9): `CrossSellingBanner` wird
 * zusaetzlich unterhalb der `RecommendationList` gerendert, gespeist aus
 * `view.crossSellingSignals` (bereits Teil desselben View-Models, keine
 * zweite Server-Anfrage).
 *
 * AP10-Ergaenzung (siehe Projektleiter-Entscheidung zum manuellen
 * Abbruchflow): `AbandonConsultationButton` ist -- wie bereits
 * `canChangeAnswers` -- an `sessionStatus === "IN_PROGRESS"` gekoppelt,
 * keine zusaetzliche DB-Anfrage noetig (derselbe bereits geladene Status).
 */

import Link from "next/link";
import { redirect } from "next/navigation";
import {
  getOptionalServerSession,
  withServerSessionTenantContext,
} from "@/server/auth/server-context";
import { getLatestRecommendation } from "@/server/recommendation/service";
import {
  buildConsultationRecommendationView,
  loadConsultationSessionStatus,
  type ConsultationRecommendationView,
} from "@/server/consultation-ui/view-models";
import { ErrorBoundary } from "@/components/consultation/ErrorBoundary";
import { RecommendationList } from "@/components/consultation/RecommendationList";
import { CrossSellingBanner } from "@/components/consultation/CrossSellingBanner";
import { EvaluateRecommendationButton } from "@/components/consultation/EvaluateRecommendationButton";
import { AbandonConsultationButton } from "@/components/consultation/AbandonConsultationButton";

export const dynamic = "force-dynamic";

interface PageParams {
  params: Promise<{ sessionId: string }>;
}

export default async function ConsultationRecommendationPage({ params }: PageParams) {
  const session = await getOptionalServerSession();
  if (!session) {
    redirect("/login");
  }

  const { sessionId } = await params;
  // Muss innerhalb DESSELBEN withServerSessionTenantContext()-Aufrufs
  // passieren: der TenantContext gilt nur waehrend der Ausfuehrung von `fn`
  // (AsyncLocalStorage), buildConsultationRecommendationView() und
  // loadConsultationSessionStatus() greifen beide selbst wieder auf den
  // mandantengescopten `db`-Client zu.
  const { view, sessionStatus } = await withServerSessionTenantContext(async () => {
    const [recommendation, status] = await Promise.all([
      getLatestRecommendation(sessionId),
      loadConsultationSessionStatus(sessionId),
    ]);
    const builtView: ConsultationRecommendationView | null = recommendation
      ? await buildConsultationRecommendationView(recommendation)
      : null;
    return { view: builtView, sessionStatus: status };
  });

  // "Angaben aendern" fuehrt zurueck in den Fragenfluss dieser Session -- nur
  // sinnvoll/erlaubt, solange die Sitzung noch IN_PROGRESS ist (Plan
  // Abschnitt 8, Stop-Punkt 2: nach Abschluss bedeutet "Aendern"
  // organisatorisch eine neue Beratung, kein Wiederoeffnen dieser Sitzung).
  const canChangeAnswers = sessionStatus === "IN_PROGRESS";

  return (
    <main className="consultation-workspace">
      <ErrorBoundary>
        <h2>Empfehlung</h2>
        {canChangeAnswers && (
          <p>
            <Link href={`/consultation/${sessionId}`}>Angaben aendern</Link>
          </p>
        )}
        {view ? (
          <>
            <RecommendationList items={view.items} rejectionReasons={view.rejectionReasons} />
            <CrossSellingBanner signals={view.crossSellingSignals} />
          </>
        ) : (
          <EvaluateRecommendationButton sessionId={sessionId} />
        )}
        {sessionStatus === "IN_PROGRESS" && (
          <AbandonConsultationButton consultationSessionId={sessionId} />
        )}
      </ErrorBoundary>
    </main>
  );
}
