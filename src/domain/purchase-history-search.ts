/**
 * Portal purchase-history URL search (`/portal/purchases?purchased=LAST_30`).
 * Names match the list API. Safe to import from the client (no Prisma).
 */
export type PurchaseHistoryUrlSearch = {
  purchased?: "ANY" | "LAST_30" | "LAST_90" | "LAST_180" | "LAST_365" | "CUSTOM";
  purchasedFrom?: string;
  purchasedTo?: string;
  q?: string;
  brandId?: string;
  categoryId?: string;
  availability?: "ALL" | "AVAILABLE" | "LOW_STOCK" | "BACKORDER" | "HISTORIC_ONLY";
  sort?: "RECENT" | "MOST_PURCHASED" | "MOST_FREQUENT" | "HIGHEST_SPEND" | "NAME_AZ" | "NAME_ZA";
  quick?: "FREQUENT" | "RECENT" | "AVAILABLE_NOW" | "HISTORIC_ONLY";
  page?: number;
};

const PURCHASED = new Set<NonNullable<PurchaseHistoryUrlSearch["purchased"]>>([
  "ANY",
  "LAST_30",
  "LAST_90",
  "LAST_180",
  "LAST_365",
  "CUSTOM",
]);
const AVAIL = new Set<NonNullable<PurchaseHistoryUrlSearch["availability"]>>([
  "ALL",
  "AVAILABLE",
  "LOW_STOCK",
  "BACKORDER",
  "HISTORIC_ONLY",
]);
const SORTS = new Set<NonNullable<PurchaseHistoryUrlSearch["sort"]>>([
  "RECENT",
  "MOST_PURCHASED",
  "MOST_FREQUENT",
  "HIGHEST_SPEND",
  "NAME_AZ",
  "NAME_ZA",
]);
const QUICKS = new Set<NonNullable<PurchaseHistoryUrlSearch["quick"]>>([
  "FREQUENT",
  "RECENT",
  "AVAILABLE_NOW",
  "HISTORIC_ONLY",
]);

function ymd(v: unknown): string | undefined {
  return typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined;
}

/** Parse `/portal/purchases` search. `companyId` is ignored (never trusted from the URL). */
export function parsePurchaseHistoryUrlSearch(
  search: Record<string, unknown>,
): PurchaseHistoryUrlSearch {
  const out: PurchaseHistoryUrlSearch = {};
  const purchased = search["purchased"];
  if (typeof purchased === "string" && PURCHASED.has(purchased as never)) {
    out.purchased = purchased as NonNullable<PurchaseHistoryUrlSearch["purchased"]>;
  }
  const from = ymd(search["purchasedFrom"]);
  const to = ymd(search["purchasedTo"]);
  if (from) out.purchasedFrom = from;
  if (to) out.purchasedTo = to;
  if (typeof search["q"] === "string" && search["q"].trim()) out.q = search["q"].trim().slice(0, 200);
  if (typeof search["brandId"] === "string" && search["brandId"]) out.brandId = search["brandId"];
  if (typeof search["categoryId"] === "string" && search["categoryId"]) {
    out.categoryId = search["categoryId"];
  }
  const availability = search["availability"];
  if (typeof availability === "string" && AVAIL.has(availability as never)) {
    out.availability = availability as NonNullable<PurchaseHistoryUrlSearch["availability"]>;
  }
  const sort = search["sort"];
  if (typeof sort === "string" && SORTS.has(sort as never)) {
    out.sort = sort as NonNullable<PurchaseHistoryUrlSearch["sort"]>;
  }
  const quick = search["quick"];
  if (typeof quick === "string" && QUICKS.has(quick as never)) {
    out.quick = quick as NonNullable<PurchaseHistoryUrlSearch["quick"]>;
  }
  const page = search["page"];
  const pageNum = typeof page === "number" ? page : typeof page === "string" ? Number(page) : NaN;
  if (Number.isInteger(pageNum) && pageNum >= 2) out.page = pageNum;
  return out;
}

/** Omit defaults so refresh/back URLs stay compact (`purchased=ANY` omitted). */
export function compactPurchaseHistoryUrlSearch(
  search: PurchaseHistoryUrlSearch,
): PurchaseHistoryUrlSearch {
  const out: PurchaseHistoryUrlSearch = {};
  if (search.purchased && search.purchased !== "ANY") out.purchased = search.purchased;
  if (search.purchased === "CUSTOM") {
    if (search.purchasedFrom) out.purchasedFrom = search.purchasedFrom;
    if (search.purchasedTo) out.purchasedTo = search.purchasedTo;
  }
  if (search.q?.trim()) out.q = search.q.trim();
  if (search.brandId) out.brandId = search.brandId;
  if (search.categoryId) out.categoryId = search.categoryId;
  if (search.availability && search.availability !== "ALL") out.availability = search.availability;
  if (search.sort && search.sort !== "RECENT") out.sort = search.sort;
  if (search.quick) out.quick = search.quick;
  if (search.page && search.page > 1) out.page = search.page;
  return out;
}
