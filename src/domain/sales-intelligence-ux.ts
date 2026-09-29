/**
 * Sales Intelligence presentation helpers (no calculation/engine changes).
 */

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

/** YYYY-MM-DD → "31 Aug 2026" (date-only, no timezone shift). */
export function formatDateOnlyLongUk(dateOnly: string | null | undefined): string {
  if (!dateOnly || !/^\d{4}-\d{2}-\d{2}$/.test(dateOnly)) return dateOnly || "—";
  const [ys, ms, ds] = dateOnly.split("-");
  const y = Number(ys);
  const m = Number(ms);
  const d = Number(ds);
  if (!y || !m || !d || m < 1 || m > 12) return dateOnly;
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

export function formatPeriodRangeLong(
  from: string | null | undefined,
  to: string | null | undefined,
): string {
  return `${formatDateOnlyLongUk(from)} – ${formatDateOnlyLongUk(to)}`;
}

export type MovementDirection = "up" | "down" | "flat";

export function movementDirection(change: number | string | null | undefined): MovementDirection {
  if (change == null || change === "") return "flat";
  const n = typeof change === "number" ? change : Number(change);
  if (!Number.isFinite(n) || n === 0) return "flat";
  return n > 0 ? "up" : "down";
}

/**
 * Factual credit movement copy for sales UX.
 * Credits are signed (typically negative); avoid dominant signed-credit %.
 */
export function creditMovementHint(
  selectedCredits: string | number,
  comparisonCredits: string | number,
): string | null {
  const sel = Number(selectedCredits);
  const cmp = Number(comparisonCredits);
  if (!Number.isFinite(sel) || !Number.isFinite(cmp)) return null;
  const delta = sel - cmp;
  if (delta === 0) return "No change vs comparison";
  const abs = Math.abs(delta);
  const formatted = new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
  }).format(abs);
  // More credits = selected more negative (or larger credit magnitude).
  if (delta < 0) return `${formatted} more credits than comparison`;
  return `${formatted} fewer credits than comparison`;
}

/** Clicking an active status card returns to All Changes. */
export function toggleGapStatusFilter(current: string, clicked: string): string {
  const cur = current || "ALL_CHANGES";
  if (cur === clicked) return "ALL_CHANGES";
  return clicked;
}

export type GapTableFilterState = {
  status?: string | null;
  compareBy?: string | null;
  brandId?: string | null;
  categoryId?: string | null;
  salesRepId?: string | null;
  q?: string | null;
  sort?: string | null;
};

export function hasActiveGapTableFilters(state: GapTableFilterState): boolean {
  const status = state.status ?? "ALL_CHANGES";
  const compareBy = state.compareBy ?? "UNITS";
  const sort = state.sort ?? "NET_DECREASE";
  return (
    status !== "ALL_CHANGES" ||
    compareBy !== "UNITS" ||
    Boolean(state.brandId) ||
    Boolean(state.categoryId) ||
    Boolean(state.salesRepId) ||
    Boolean(state.q?.trim()) ||
    sort !== "NET_DECREASE"
  );
}

/** Clears table filters only — preserves entity + period/compare. */
export function clearedGapTableFilters(): Required<
  Pick<GapTableFilterState, "status" | "compareBy" | "brandId" | "categoryId" | "salesRepId" | "q" | "sort">
> {
  return {
    status: "ALL_CHANGES",
    compareBy: "UNITS",
    brandId: null,
    categoryId: null,
    salesRepId: null,
    q: null,
    sort: "NET_DECREASE",
  };
}

export type EnquiryTableFilterState = {
  brandId?: string | null;
  categoryId?: string | null;
  salesRepId?: string | null;
  q?: string | null;
};

export function hasActiveEnquiryTableFilters(state: EnquiryTableFilterState): boolean {
  return (
    Boolean(state.brandId) ||
    Boolean(state.categoryId) ||
    Boolean(state.salesRepId) ||
    Boolean(state.q?.trim())
  );
}

export function clearedEnquiryTableFilters(): Required<EnquiryTableFilterState> {
  return {
    brandId: null,
    categoryId: null,
    salesRepId: null,
    q: null,
  };
}

/**
 * Hide suggestion list once an entity is selected unless the user is changing it.
 */
export function shouldShowEntitySuggestions(args: {
  entitySelected: boolean;
  changing: boolean;
  queryLength: number;
  hitCount: number;
}): boolean {
  if (args.hitCount === 0 || args.queryLength < 1) return false;
  if (args.entitySelected && !args.changing) return false;
  return true;
}

export function gapStatusLabel(status: string): string {
  if (status === "STOPPED") return "Stopped buying";
  if (status === "DECREASED") return "Decreased";
  if (status === "INCREASED") return "Increased";
  if (status === "NEW") return "New";
  if (status === "UNCHANGED") return "Unchanged";
  return status;
}

export function gapStatusHint(status: string, mode: "customers" | "products"): string {
  if (mode === "products") {
    if (status === "STOPPED") return "Customers who bought in comparison but not selected period";
    if (status === "DECREASED") return "Customers with lower purchase activity";
    if (status === "INCREASED") return "Customers with higher purchase activity";
    if (status === "NEW") return "Customers first buying in selected period";
    return "Customers with the same purchase activity";
  }
  if (status === "STOPPED") return "Products bought in comparison period but not selected period";
  if (status === "DECREASED") return "Products with lower purchase activity";
  if (status === "INCREASED") return "Products with higher purchase activity";
  if (status === "NEW") return "Products first bought in selected period";
  return "Products with the same purchase activity";
}
