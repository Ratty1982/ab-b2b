/**
 * Product Cost Intelligence history helpers.
 *
 * Daily AutopartProductCostSnapshot rows may repeat the same Latest Cost across
 * consecutive business dates. UI/history should expose DISTINCT COST MOVEMENTS only.
 */

export type DailyCostObservation = {
  businessDate: string; // YYYY-MM-DD
  latestCost: string;
};

export type DistinctCostMovement = {
  /** Date the distinct cost first appeared (chart X for this segment). */
  businessDate: string;
  firstObservedDate: string;
  lastObservedDate: string;
  latestCost: string;
  /** Absolute money delta vs previous distinct cost; null for the first segment. */
  changeFromPrevious: string | null;
};

/**
 * Collapse consecutive same-cost daily observations into distinct movements.
 * Does not invent transitions — only groups identical runs.
 */
export function collapseDistinctCostMovements(
  daily: DailyCostObservation[],
): DistinctCostMovement[] {
  const sorted = [...daily].sort((a, b) => a.businessDate.localeCompare(b.businessDate));
  const out: DistinctCostMovement[] = [];
  for (const row of sorted) {
    const cost = row.latestCost.trim();
    if (!cost || !row.businessDate) continue;
    const last = out[out.length - 1];
    if (last && last.latestCost === cost) {
      last.lastObservedDate = row.businessDate;
      continue;
    }
    out.push({
      businessDate: row.businessDate,
      firstObservedDate: row.businessDate,
      lastObservedDate: row.businessDate,
      latestCost: cost,
      changeFromPrevious: null, // filled by caller with money arithmetic when needed
    });
  }
  return out;
}

/** Chart only when there are at least two distinct cost values (a real movement). */
export function shouldRenderCostHistoryChart(movements: DistinctCostMovement[]): boolean {
  if (movements.length < 2) return false;
  const costs = new Set(movements.map((m) => m.latestCost));
  return costs.size >= 2;
}

export function productCostAccordionDefaultOpen(): boolean {
  return false;
}
