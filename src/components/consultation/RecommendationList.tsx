/**
 * Liste aller empfehlbaren Tarife einer Session (AP6, siehe
 * PHASE_5_IMPLEMENTATION_PLAN.md Abschnitt 7). `items` ist bereits
 * serverseitig auf `eligibilityPassed === true` gefiltert und nach
 * `priorityRank` sortiert (siehe
 * `buildConsultationRecommendationView()`/`loadRecommendationResult()` --
 * die Sortierung kommt unveraendert aus `service.ts`, `orderBy: { priorityRank: "asc" }`).
 */

import type {
  ConsultationRecommendationItemView,
  RejectionReasonOption,
} from "@/server/consultation-ui/view-models";
import { RecommendationCard } from "./RecommendationCard";

interface RecommendationListProps {
  items: ConsultationRecommendationItemView[];
  rejectionReasons: RejectionReasonOption[];
}

export function RecommendationList({ items, rejectionReasons }: RecommendationListProps) {
  if (items.length === 0) {
    return (
      <p className="recommendation-list__empty">
        Fuer die aktuellen Angaben ist kein passender Tarif verfuegbar.
      </p>
    );
  }

  return (
    <ul className="recommendation-list">
      {items.map((item) => (
        <RecommendationCard key={item.id} item={item} rejectionReasons={rejectionReasons} />
      ))}
    </ul>
  );
}
