/**
 * Einzelne Empfehlungskarte (AP6/AP7, siehe PHASE_5_IMPLEMENTATION_PLAN.md
 * Abschnitt 7 + Abschnitt 8). Zeigt bewusst WEDER `businessPriorityScore`
 * NOCH Provisions-/Margendaten an (Plan Abschnitt 7).
 *
 * Der Annehmen-/Ablehnen-/Zurueckstellen-Flow (AP7, `OutcomeDialog`) haengt
 * an `item.outcome`/`item.id` und den mandantengepflegten
 * `rejectionReasons` (aus `ConsultationRecommendationView`, siehe
 * `src/server/consultation-ui/view-models.ts`).
 */

import type {
  ConsultationRecommendationItemView,
  RejectionReasonOption,
} from "@/server/consultation-ui/view-models";
import { RationaleDrawer } from "./RationaleDrawer";
import { OutcomeDialog } from "./OutcomeDialog";

interface RecommendationCardProps {
  item: ConsultationRecommendationItemView;
  rejectionReasons: RejectionReasonOption[];
}

function formatMinorAmount(amountMinor: number, currency: string): string {
  return new Intl.NumberFormat("de-DE", { style: "currency", currency }).format(amountMinor / 100);
}

export function RecommendationCard({ item, rejectionReasons }: RecommendationCardProps) {
  const { product } = item;

  return (
    <li className="recommendation-card">
      <div className="recommendation-card__header">
        <span className="recommendation-card__rank">#{item.priorityRank}</span>
        <h3 className="recommendation-card__title">{product.productName}</h3>
        <span
          className={`recommendation-card__fit recommendation-card__fit--${item.customerFitCategory}`}
        >
          {item.customerFitLabel}
        </span>
      </div>

      <dl className="recommendation-card__prices">
        {product.monthlyPriceMinor !== null && (
          <div className="recommendation-card__price">
            <dt>Monatlich</dt>
            <dd>{formatMinorAmount(product.monthlyPriceMinor, product.currency)}</dd>
          </div>
        )}
        {product.oneTimePriceMinor !== null && (
          <div className="recommendation-card__price">
            <dt>Einmalig</dt>
            <dd>{formatMinorAmount(product.oneTimePriceMinor, product.currency)}</dd>
          </div>
        )}
        {product.contractMonths !== null && (
          <div className="recommendation-card__price">
            <dt>Laufzeit</dt>
            <dd>{product.contractMonths} Monate</dd>
          </div>
        )}
      </dl>

      {product.attributes.length > 0 && (
        <ul className="recommendation-card__attributes">
          {product.attributes.map((attribute) => (
            <li key={attribute.key}>
              {attribute.key}: {attribute.value}
            </li>
          ))}
        </ul>
      )}

      <RationaleDrawer
        positiveEligibilityReasons={item.positiveEligibilityReasons}
        unmetSoftEligibilityCriteria={item.unmetSoftEligibilityCriteria}
      />

      <OutcomeDialog
        recommendationItemId={item.id}
        outcome={item.outcome}
        rejectionReasons={rejectionReasons}
      />
    </li>
  );
}
