/**
 * Haupt-Beratungsarbeitsplatz `/consultation/[sessionId]` (AP4, siehe
 * PHASE_5_IMPLEMENTATION_PLAN.md Abschnitt 3 + 5, Schritt 3). Server
 * Component: laedt `loadQuestionnaireState()` innerhalb des Tenant-Kontexts
 * der Session und rendert den Client-Orchestrator `QuestionFlow`. Ein
 * `ConsultationSessionNotFoundError` (fremder Mandant, falsche ID, oder eine
 * andere Fehlerklasse) wird bewusst NICHT hier abgefangen -- Next.js'
 * Standard-Fehlerseite reicht fuer diesen internen Pilotbetrieb aus (siehe
 * Plan Abschnitt 15, kein eigenes 404-Design gefordert).
 *
 * AP10-Ergaenzung (siehe Projektleiter-Entscheidung zum manuellen
 * Abbruchflow): `AbandonConsultationButton` ist hier zusaetzlich zur
 * Summary-Seite eingebunden, da der Button laut Entscheidung "waehrend einer
 * aktiven Beratung erreichbar" sein muss -- nicht erst nach Erreichen der
 * Zusammenfassung. `state.status` (aus `loadQuestionnaireState()`) steuert
 * das Sichtbarkeits-Gate, keine zusaetzliche DB-Anfrage noetig.
 *
 * Phase 12 AP3-Ergaenzung (ChatGPT-GO 2026-08-23): `aiExtractionAvailable`
 * wird HIER (nicht im Client) ermittelt -- `session.consultationPermissions`
 * kommt aus dem bereits verifizierten Session-Payload,
 * `isAiExtractionAvailableForCurrentTenant()` (AP2/AP3, `ai-extraction/
 * service.ts`) fragt zusaetzlich das Tenant-Feature-Flag ab, exakt dieselbe
 * Bedingung wie in der `/ai-extraction`-Route selbst. Reine
 * Darstellungsentscheidung (Panel ueberhaupt anzeigen) -- ersetzt NICHT die
 * serverseitige Pruefung der Route.
 */

import { redirect } from "next/navigation";
import {
  getOptionalServerSession,
  withServerSessionTenantContext,
} from "@/server/auth/server-context";
import { loadQuestionnaireState } from "@/server/questionnaire/service";
import { isAiExtractionAvailableForCurrentTenant } from "@/server/ai-extraction/service";
import { ErrorBoundary } from "@/components/consultation/ErrorBoundary";
import { QuestionFlow } from "@/components/consultation/QuestionFlow";
import { AbandonConsultationButton } from "@/components/consultation/AbandonConsultationButton";

export const dynamic = "force-dynamic";

interface PageParams {
  params: Promise<{ sessionId: string }>;
}

export default async function ConsultationSessionPage({ params }: PageParams) {
  const session = await getOptionalServerSession();
  if (!session) {
    redirect("/login");
  }

  const { sessionId } = await params;
  const { state, aiExtractionAvailable } = await withServerSessionTenantContext(async (s) => {
    const questionnaireState = await loadQuestionnaireState(sessionId);
    const available = await isAiExtractionAvailableForCurrentTenant(
      s.consultationPermissions.includes("consultation.ai_extraction.use"),
    );
    return { state: questionnaireState, aiExtractionAvailable: available };
  });

  return (
    <main className="consultation-workspace">
      <ErrorBoundary>
        <QuestionFlow initialState={state} aiExtractionAvailable={aiExtractionAvailable} />
        {state.status === "IN_PROGRESS" && (
          <AbandonConsultationButton consultationSessionId={sessionId} />
        )}
      </ErrorBoundary>
    </main>
  );
}
