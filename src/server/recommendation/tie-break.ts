/**
 * priorityRank-Vergabe (PHASE_3B_IMPLEMENTATION_PLAN.md Abschnitt 6):
 * businessPriorityScore DESC -> customerFitScore DESC ->
 * productVersion.monthlyPriceMinor ASC (NULL zuletzt) -> productVersionId
 * ASC. Wird ueber ALLE evaluierten ProductVersions angewandt (nicht nur
 * eligibilityPassed=true), siehe Abschnitt 3.6/5: fuer jede aktive
 * ProductVersion tenant-weit wird ein RecommendationItem persistiert.
 */

export interface RankableItem {
  productVersionId: string;
  monthlyPriceMinor: number | null;
  businessPriorityScore: number;
  customerFitScore: number;
}

export function assignPriorityRanks<T extends RankableItem>(
  items: T[],
): Array<T & { priorityRank: number }> {
  const sorted = [...items].sort((a, b) => {
    if (b.businessPriorityScore !== a.businessPriorityScore) {
      return b.businessPriorityScore - a.businessPriorityScore;
    }
    if (b.customerFitScore !== a.customerFitScore) {
      return b.customerFitScore - a.customerFitScore;
    }
    if (a.monthlyPriceMinor === null && b.monthlyPriceMinor !== null) return 1;
    if (a.monthlyPriceMinor !== null && b.monthlyPriceMinor === null) return -1;
    if (
      a.monthlyPriceMinor !== null &&
      b.monthlyPriceMinor !== null &&
      a.monthlyPriceMinor !== b.monthlyPriceMinor
    ) {
      return a.monthlyPriceMinor - b.monthlyPriceMinor;
    }
    return a.productVersionId.localeCompare(b.productVersionId);
  });

  return sorted.map((item, index) => ({ ...item, priorityRank: index + 1 }));
}
