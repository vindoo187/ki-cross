/**
 * Zusammenfassungsansicht `/consultation/[sessionId]/summary` (AP9, siehe
 * PHASE_5_IMPLEMENTATION_PLAN.md Abschnitt 5, Schritt 10 + Abschnitt 16,
 * Punkt 9). Reiner Anzeige-Wrapper um das bereits server-seitig komponierte
 * `ConsultationSessionSummaryView` (`buildConsultationSessionSummaryView()`,
 * siehe `view-models.ts`) -- diese Komponente filtert/laedt nichts
 * zusaetzlich.
 *
 * Empfehlungs-/Cross-Selling-Abschnitt nutzt bewusst dieselben, bereits in
 * AP6/AP8 gebauten Komponenten (`RecommendationList`/`CrossSellingBanner`)
 * statt einer neuen, rein lesenden Variante: der Annehmen-/Ablehnen-/
 * Zurueckstellen-Flow (AP7) bleibt unveraendert nutzbar, unabhaengig vom
 * Sitzungsstatus (die Empfehlungsseite selbst funktioniert laut ihrem
 * Modulkommentar bereits heute auch fuer `COMPLETED`-Sessions) -- die
 * Zusammenfassungsseite ist eine zusaetzliche Uebersicht, keine
 * eingeschraenkte Kopie.
 *
 * Fix 6 (ChatGPT-Konsultation 2026-08-07): urspruenglich als eigenstaendiger
 * "Antworten ansehen"-Button/-Route geplant (Nutzerwunsch: nach Klick auf
 * "Fragebogen abschliessen" fehlte ein erkennbarer Weg, die eigenen
 * Antworten nochmal einzusehen). Bei der Umsetzung stellte sich heraus, dass
 * genau das bereits diese Seite leistet -- "Ihre Angaben" zeigt alle
 * sichtbaren Fragen samt Antwort als reine, nicht editierbare `dl`-Liste,
 * ohne jegliche Eingabeelemente, unveraendert auch fuer COMPLETED/ABANDONED
 * (siehe Modulkommentar oben). Eine zusaetzliche Route waere daher reine
 * Funktionsduplikation gewesen; ChatGPT hat dem kleineren Ersatzvorschlag
 * zugestimmt: statt einer neuen Route nur ein erklaerender Hinweistext, der
 * ausdruecklich fuer den Mitarbeiter klarstellt, dass diese Ansicht bei
 * COMPLETED/ABANDONED bewusst nur zum Ansehen dient (die eigentliche
 * Unveraenderlichkeit wird ohnehin serverseitig ueber
 * `assertSessionModifiable()` erzwungen, dieser Text ist reine UX-Klarheit).
 * Bewusst ein explizites `=== "COMPLETED"`/`=== "ABANDONED"` statt eines
 * pauschalen `!== "IN_PROGRESS"`, damit ein spaeter hinzukommender Status
 * (z.B. `NEEDS_REVIEW`) nicht automatisch einen unpassenden Hinweistext
 * erhaelt.
 */

import type { ConsultationSessionSummaryView as SessionSummaryData } from "@/server/consultation-ui/view-models";
import { RecommendationList } from "./RecommendationList";
import { CrossSellingBanner } from "./CrossSellingBanner";

interface SessionSummaryViewProps {
  summary: SessionSummaryData;
}

function ReadOnlyNotice({ status }: { status: SessionSummaryData["status"] }) {
  if (status === "COMPLETED") {
    return (
      <p className="session-summary__readonly-notice" role="status">
        Fragebogen abgeschlossen -- nur Ansicht. Ihre Antworten koennen nicht mehr geaendert werden.
      </p>
    );
  }
  if (status === "ABANDONED") {
    return (
      <p className="session-summary__readonly-notice" role="status">
        Beratung abgebrochen -- nur Ansicht. Die erfassten Antworten koennen nicht mehr geaendert
        werden.
      </p>
    );
  }
  return null;
}

export function SessionSummaryView({ summary }: SessionSummaryViewProps) {
  return (
    <div className="session-summary">
      <section className="session-summary__section">
        <h3 className="session-summary__heading">Ihre Angaben</h3>
        <ReadOnlyNotice status={summary.status} />
        {summary.answeredQuestions.length === 0 ? (
          <p className="session-summary__empty">Keine Fragen beantwortet.</p>
        ) : (
          <dl className="session-summary__answers">
            {summary.answeredQuestions.map((question) => (
              <div key={question.questionId} className="session-summary__answer">
                <dt>{question.label}</dt>
                <dd>{question.formattedValue}</dd>
              </div>
            ))}
          </dl>
        )}
      </section>

      <section className="session-summary__section">
        <h3 className="session-summary__heading">Empfehlung</h3>
        {summary.recommendation ? (
          <>
            <RecommendationList
              items={summary.recommendation.items}
              rejectionReasons={summary.recommendation.rejectionReasons}
            />
            <CrossSellingBanner signals={summary.recommendation.crossSellingSignals} />
          </>
        ) : (
          <p className="session-summary__empty">
            Fuer diese Sitzung liegt noch keine Empfehlung vor.
          </p>
        )}
      </section>
    </div>
  );
}
