/**
 * Cross-Selling-Bereich der Empfehlungsseite (AP8, siehe
 * PHASE_5_IMPLEMENTATION_PLAN.md Abschnitt 9 + 16). Duenner Listen-Wrapper
 * um `OpportunityCard`, analog zu `RecommendationList`/`RecommendationCard`
 * (AP6). `signals` ist bereits server-seitig aus
 * `RecommendationResult.crossSellingSignals` gebaut
 * (`buildConsultationRecommendationView()`, siehe `view-models.ts`) -- diese
 * Komponente filtert/sortiert nichts zusaetzlich.
 *
 * Rendert bewusst NICHTS, wenn keine Signale vorliegen (kein leerer
 * Ueberschriften-/Rahmenblock ohne Inhalt) -- anders als
 * `RecommendationList`, deren Leerzustand ("kein passender Tarif") eine
 * eigenstaendige, fuer den Mitarbeiter relevante Aussage ist. Kein Cross-
 * Selling-Signal ist dagegen der haeufige Regelfall (nicht jede Beratung
 * loest einen erkannten Zusatzbedarf aus) und rechtfertigt keinen eigenen
 * Hinweistext.
 */

import type { ConsultationCrossSellingSignalView } from "@/server/consultation-ui/view-models";
import { OpportunityCard } from "./OpportunityCard";

interface CrossSellingBannerProps {
  signals: ConsultationCrossSellingSignalView[];
}

export function CrossSellingBanner({ signals }: CrossSellingBannerProps) {
  if (signals.length === 0) {
    return null;
  }

  return (
    <section className="cross-selling-banner">
      <h3 className="cross-selling-banner__heading">Erkannter Zusatzbedarf</h3>
      <ul className="cross-selling-banner__list">
        {signals.map((signal) => (
          <OpportunityCard key={signal.id} signal={signal} />
        ))}
      </ul>
    </section>
  );
}
