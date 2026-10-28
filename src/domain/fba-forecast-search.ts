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

/**
 * Highest non-null net first. Null (no scanned sales for that window) ranks below
 * every number, including zero and negatives. Never returns NaN.
 */
export function compareSalesNetDesc(a: number | null, b: number | null): number {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  if (a === b) return 0;
  return b > a ? 1 : -1;
}

export type CustomerSalesSortRow = {
  sku: string;
  customerSales: { d30: number | null; d90: number | null; d365: number | null };
};

/** 30-day net, then 90-day, then 365-day, then SKU. Safe when any window is null. */
export function compareCustomerSalesRows(a: CustomerSalesSortRow, b: CustomerSalesSortRow): number {
  const d30 = compareSalesNetDesc(a.customerSales.d30, b.customerSales.d30);
  if (d30 !== 0) return d30;
  const d90 = compareSalesNetDesc(a.customerSales.d90, b.customerSales.d90);
  if (d90 !== 0) return d90;
  const d365 = compareSalesNetDesc(a.customerSales.d365, b.customerSales.d365);
  if (d365 !== 0) return d365;
  return a.sku.localeCompare(b.sku);
}
