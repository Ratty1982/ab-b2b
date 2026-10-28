/** Overview sales-activity choices. Omitted from the URL means the last 365 days. */
export const FBA_SALES_ACTIVITIES = ["365", "90", "30", "all"] as const;
export type FbaSalesActivity = (typeof FBA_SALES_ACTIVITIES)[number];

export const FBA_FORECAST_SORTS = ["priority", "cover", "velocity", "suggested", "sales"] as const;
export type FbaForecastSort = (typeof FBA_FORECAST_SORTS)[number];

export function isFbaSalesActivity(value: unknown): value is FbaSalesActivity {
  return value === "365" || value === "90" || value === "30" || value === "all";
}

/** A missing or 365-day choice stays out of the URL. Shorter windows and the full catalogue are stored. */
export function salesActivitySearchValue(
  activity: FbaSalesActivity,
): "90" | "30" | "all" | undefined {
  if (activity === "365") return undefined;
  return activity;
}

export function defaultFbaForecastSort(activity: FbaSalesActivity): FbaForecastSort {
  return activity === "all" ? "priority" : "sales";
}
