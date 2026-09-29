/**
 * Customer portal Purchase History — factual historic Autopart trade-account metrics.
 *
 * Data-source boundary (intentional):
 * - Authoritative metrics come from AutopartSalesLine / AutopartSalesDocument only.
 * - AB Order / OrderItem rows are NOT merged here. Future AB-order inclusion must
 *   use a non-overlapping boundary (e.g. AB orders after last import cutoff, or
 *   explicit source tagging) so the same commercial event is never counted twice
 *   if it later also appears in an Autopart historic import.
 *
 * Credits (CREDIT document type) reduce net units/spend. They never increment
 * purchaseCount (distinct INVOICE document references only).
 */
import { z } from "zod";
import { prisma } from "@/infra/database/client";
import { AuthError, requireCompanyPermission } from "@/server/rbac/guards";
import { requireTradePortalCompany } from "@/server/portal/dashboard";
import { moneyToString, moneyZero, parseMoney } from "@/domain/money";
import {
  PUBLIC_AVAILABILITY_LABEL,
  type PublicAvailability,
} from "@/domain/availability";
import { isEffectiveBackorderAllowed } from "@/domain/backorder";
import { isOrderableByStockPolicy } from "@/domain/ordering";
import {
  addDaysIso,
  dateOnlyIsoFromDate,
  lastNDaysRange,
  todayLondonDateOnly,
} from "@/domain/sales-history-period";
import { loadStockByVariantIds } from "@/server/stock/service";
import { getGlobalBackorderPolicy } from "@/server/ordering/settings";
import { trustedSellableForOrdering } from "@/server/ordering/policy";

export type PurchaseHistorySort =
  | "RECENT"
  | "MOST_PURCHASED"
  | "MOST_FREQUENT"
  | "HIGHEST_SPEND"
  | "NAME_AZ"
  | "NAME_ZA";

export type PurchaseHistoryPurchasedWindow =
  | "ANY"
  | "LAST_30"
  | "LAST_90"
  | "LAST_180"
  | "LAST_365"
  | "CUSTOM";

export type PurchaseHistoryAvailabilityFilter =
  | "ALL"
  | "AVAILABLE"
  | "LOW_STOCK"
  | "BACKORDER"
  | "HISTORIC_ONLY";

export type PurchaseHistoryQuickFilter =
  | "FREQUENT"
  | "RECENT"
  | "AVAILABLE_NOW"
  | "HISTORIC_ONLY";

/** Deterministic: ≥3 distinct invoice purchases. */
export const FREQUENT_PURCHASE_MIN_COUNT = 3;
/** Bought Recently quick filter: reliable last purchase within this many days. */
export const BOUGHT_RECENTLY_DAYS = 90;

const listSchema = z.object({
  q: z.string().max(200).optional(),
  brandId: z.string().cuid().optional().nullable(),
  categoryId: z.string().cuid().optional().nullable(),
  purchased: z
    .enum(["ANY", "LAST_30", "LAST_90", "LAST_180", "LAST_365", "CUSTOM"])
    .optional(),
  purchasedFrom: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .nullable(),
  purchasedTo: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .nullable(),
  availability: z
    .enum(["ALL", "AVAILABLE", "LOW_STOCK", "BACKORDER", "HISTORIC_ONLY"])
    .optional(),
  /** Legacy portal filter — mapped onto availability. */
  filter: z.enum(["ALL", "AVAILABLE", "UNAVAILABLE"]).optional(),
  sort: z
    .enum(["RECENT", "MOST_PURCHASED", "MOST_FREQUENT", "HIGHEST_SPEND", "NAME_AZ", "NAME_ZA"])
    .optional(),
  quick: z.enum(["FREQUENT", "RECENT", "AVAILABLE_NOW", "HISTORIC_ONLY"]).optional().nullable(),
  page: z.number().int().min(1).max(10_000).optional(),
  pageSize: z.number().int().min(1).max(100).optional(),
  /** Rejected if present — company scope is session-only. */
  companyId: z.string().optional(),
});

const insightSchema = z.object({
  sku: z.string().min(1).max(120),
  companyId: z.string().optional(),
});

type LineRow = {
  sku: string;
  units: { toString(): string } | number;
  salesNet: { toString(): string } | number;
  descriptionSnapshot: string | null;
  documentType: string;
  documentReference: string;
  document: { documentDate: Date | null } | null;
};

type SkuAgg = {
  sku: string;
  historicDescription: string | null;
  netUnits: number;
  netSpendMinor: bigint;
  invoiceRefs: Set<string>;
  /** All dated invoice event dates (YYYY-MM-DD), unique per invoice ref (latest date if multi-line). */
  invoiceDatesByRef: Map<string, string>;
  creditDatesByRef: Map<string, string>;
  firstPurchasedDate: string | null;
  lastPurchasedDate: string | null;
};

function dateOnlyIso(d: Date): string {
  return dateOnlyIsoFromDate(d);
}

function monthKeyFromIso(iso: string): string {
  return iso.slice(0, 7);
}

function monthLabelUk(monthKey: string): string {
  const [y, m] = monthKey.split("-").map(Number);
  const dt = new Date(Date.UTC(y!, (m ?? 1) - 1, 1));
  return new Intl.DateTimeFormat("en-GB", { month: "short", year: "numeric", timeZone: "UTC" }).format(
    dt,
  );
}

/** Inclusive calendar-date window in Europe/London YYYY-MM-DD. LAST_N is last N days including today. */
export function purchaseHistoryWindowRange(
  purchased: PurchaseHistoryPurchasedWindow,
  from: string | null | undefined,
  to: string | null | undefined,
  today: string,
): { from: string; to: string } | null {
  if (purchased === "ANY" || !purchased) return null;
  if (purchased === "CUSTOM") {
    if (!from && !to) return null;
    return { from: from ?? "0001-01-01", to: to ?? "9999-12-31" };
  }
  const days =
    purchased === "LAST_30"
      ? 30
      : purchased === "LAST_90"
        ? 90
        : purchased === "LAST_180"
          ? 180
          : 365;
  return lastNDaysRange(today, days);
}

function lineDocumentDateIso(line: LineRow): string | null {
  return line.document?.documentDate ? dateOnlyIso(line.document.documentDate) : null;
}

function linesInPurchasedWindow(
  lines: LineRow[],
  range: { from: string; to: string } | null,
): LineRow[] {
  if (!range) return lines;
  return lines.filter((line) => {
    const d = lineDocumentDateIso(line);
    return d != null && d >= range.from && d <= range.to;
  });
}

function moneyFromMinor(minor: bigint): string {
  return moneyToString({ minor }, 2);
}

function buildSkuAggregates(
  lines: LineRow[],
  range?: { from: string; to: string } | null,
): Map<string, SkuAgg> {
  const bySku = new Map<string, SkuAgg>();
  for (const line of linesInPurchasedWindow(lines, range ?? null)) {
    const key = line.sku.trim().toUpperCase();
    let agg = bySku.get(key);
    if (!agg) {
      agg = {
        sku: line.sku.trim(),
        historicDescription: line.descriptionSnapshot?.trim() || null,
        netUnits: 0,
        netSpendMinor: 0n,
        invoiceRefs: new Set(),
        invoiceDatesByRef: new Map(),
        creditDatesByRef: new Map(),
        firstPurchasedDate: null,
        lastPurchasedDate: null,
      };
      bySku.set(key, agg);
    }
    if (!agg.historicDescription && line.descriptionSnapshot?.trim()) {
      agg.historicDescription = line.descriptionSnapshot.trim();
    }
    agg.netUnits += Number(line.units ?? 0);
    const spend = parseMoney(String(line.salesNet ?? 0)) ?? moneyZero();
    agg.netSpendMinor += spend.minor;

    const dateIso = line.document?.documentDate
      ? dateOnlyIso(line.document.documentDate)
      : null;
    if (line.documentType === "INVOICE") {
      agg.invoiceRefs.add(line.documentReference);
      if (dateIso) {
        const prev = agg.invoiceDatesByRef.get(line.documentReference);
        if (!prev || dateIso > prev) agg.invoiceDatesByRef.set(line.documentReference, dateIso);
        if (!agg.firstPurchasedDate || dateIso < agg.firstPurchasedDate) {
          agg.firstPurchasedDate = dateIso;
        }
        if (!agg.lastPurchasedDate || dateIso > agg.lastPurchasedDate) {
          agg.lastPurchasedDate = dateIso;
        }
      }
    } else if (line.documentType === "CREDIT" && dateIso) {
      const prev = agg.creditDatesByRef.get(line.documentReference);
      if (!prev || dateIso > prev) agg.creditDatesByRef.set(line.documentReference, dateIso);
    }
  }
  return bySku;
}

async function assertPortalPurchaseAccess(userId: string) {
  const { company } = await requireTradePortalCompany(userId);
  await requireCompanyPermission(userId, company.id, "orders.view");
  return company;
}

function rejectSpoofedCompany(raw: { companyId?: string | null | undefined }) {
  if (raw.companyId != null && String(raw.companyId).length > 0) {
    throw new AuthError("companyId cannot be supplied by the client", "FORBIDDEN", 403);
  }
}

export type PurchaseHistoryAvailabilityBand = PublicAvailability | "historic";

function resolveAvailabilityPresentation(input: {
  hasCatalogueProduct: boolean;
  tradeOrderable: boolean;
  stockBand: PublicAvailability | null;
}): { band: PurchaseHistoryAvailabilityBand; label: string } {
  if (!input.hasCatalogueProduct || !input.tradeOrderable) {
    return { band: "historic", label: "Historic Only" };
  }
  if (input.stockBand) {
    return { band: input.stockBand, label: PUBLIC_AVAILABILITY_LABEL[input.stockBand] };
  }
  // Catalogue product exists but stock unknown — still orderable via backorder defaults often;
  // surface a neutral in-catalogue state without inventing stock.
  return { band: "in", label: "Available to order" };
}

export async function listPortalPurchaseHistory(userId: string, raw: unknown) {
  const input = listSchema.parse(raw ?? {});
  rejectSpoofedCompany(input);
  const company = await assertPortalPurchaseAccess(userId);
  const today = todayLondonDateOnly();
  const page = input.page ?? 1;
  const pageSize = input.pageSize ?? 25;
  const sort = (input.sort ?? "RECENT") as PurchaseHistorySort;
  const q = input.q?.trim() ?? "";
  const purchased = (input.purchased ?? "ANY") as PurchaseHistoryPurchasedWindow;
  let availability = (input.availability ?? "ALL") as PurchaseHistoryAvailabilityFilter;
  if (input.filter === "AVAILABLE") availability = "AVAILABLE";
  if (input.filter === "UNAVAILABLE") availability = "HISTORIC_ONLY";
  const dateRange = purchaseHistoryWindowRange(
    purchased,
    input.purchasedFrom,
    input.purchasedTo,
    today,
  );

  const lines = await prisma.autopartSalesLine.findMany({
    where: {
      companyId: company.id,
      ...(dateRange
        ? {
            document: {
              is: {
                documentDate: {
                  gte: new Date(`${dateRange.from}T00:00:00.000Z`),
                  lte: new Date(`${dateRange.to}T23:59:59.999Z`),
                },
              },
            },
          }
        : {}),
    },
    select: {
      sku: true,
      units: true,
      salesNet: true,
      descriptionSnapshot: true,
      documentType: true,
      documentReference: true,
      document: { select: { documentDate: true } },
    },
  });

  const bySku = buildSkuAggregates(lines, dateRange);

  const skus = [...bySku.keys()];
  const variants = skus.length
    ? await prisma.productVariant.findMany({
        where: {
          OR: skus.map((sku) => ({ sku: { equals: sku, mode: "insensitive" as const } })),
        },
        select: {
          id: true,
          sku: true,
          backorderPolicy: true,
          product: {
            select: {
              id: true,
              name: true,
              slug: true,
              isActive: true,
              isTradeVisible: true,
              status: true,
              brandId: true,
              categoryId: true,
              brand: { select: { id: true, name: true } },
              category: { select: { id: true, name: true } },
            },
          },
        },
      })
    : [];
  const variantBySku = new Map(variants.map((v) => [v.sku.trim().toUpperCase(), v]));
  const globalPolicy = await getGlobalBackorderPolicy();
  const stockMap = await loadStockByVariantIds(variants.map((v) => v.id));

  type Enriched = {
    sku: string;
    name: string;
    historicDescription: string | null;
    brandId: string | null;
    brandName: string | null;
    categoryId: string | null;
    categoryName: string | null;
    productId: string | null;
    productSlug: string | null;
    variantId: string | null;
    purchaseCount: number;
    netUnits: number;
    netSpend: string;
    netSpendMinor: bigint;
    lastPurchasedDate: string | null;
    firstPurchasedDate: string | null;
    availabilityBand: PurchaseHistoryAvailabilityBand;
    availabilityLabel: string;
    canBuyAgain: boolean;
    currentlyAvailable: boolean;
    action: "BUY_AGAIN" | "VIEW_PRODUCT" | "HISTORIC_PRODUCT";
    invoiceRefs: Set<string>;
  };

  const brandOptions = new Map<string, string>();
  const categoryOptions = new Map<string, string>();

  let items: Enriched[] = [];
  for (const [key, agg] of bySku) {
    const v = variantBySku.get(key);
    const product = v?.product;
    const catalogueOk = Boolean(
      product && product.isActive && product.isTradeVisible && product.status === "ACTIVE",
    );
    const stock = v ? stockMap.get(v.id) : undefined;
    const rawSellable = stock?.sellableQty ?? 0;
    const stale = stock?.stale ?? true;
    const backorderPolicy = stock?.backorderPolicy ?? globalPolicy;
    const orderableByStock = v
      ? isOrderableByStockPolicy(
          {
            sellableQty: rawSellable,
            stale,
            availability: stock?.availability ?? null,
          },
          backorderPolicy,
        )
      : false;
    // Buy Again: current catalogue product + stock/backorder orderability.
    const canBuyAgain = catalogueOk && orderableByStock;
    const stockBand = stock?.availability ?? null;
    // Availability filter "Available to order" = catalogue + orderable (incl. backorder).
    const avail = resolveAvailabilityPresentation({
      hasCatalogueProduct: Boolean(product),
      tradeOrderable: catalogueOk,
      stockBand: catalogueOk
        ? stockBand ??
          (isEffectiveBackorderAllowed(backorderPolicy) &&
          trustedSellableForOrdering({ sellableQty: rawSellable, stale }) <= 0
            ? "backorder"
            : stockBand)
        : null,
    });

    if (product?.brand) brandOptions.set(product.brand.id, product.brand.name);
    if (product?.category) categoryOptions.set(product.category.id, product.category.name);

    const displayName =
      product?.name ??
      agg.historicDescription ??
      agg.sku;

    let action: Enriched["action"] = "HISTORIC_PRODUCT";
    if (canBuyAgain) action = "BUY_AGAIN";
    else if (product && product.isTradeVisible) action = "VIEW_PRODUCT";

    items.push({
      sku: agg.sku,
      name: displayName,
      historicDescription: agg.historicDescription,
      brandId: product?.brandId ?? null,
      brandName: product?.brand?.name ?? null,
      categoryId: product?.categoryId ?? null,
      categoryName: product?.category?.name ?? null,
      productId: product?.id ?? null,
      productSlug: product?.slug ?? null,
      variantId: v?.id ?? null,
      purchaseCount: agg.invoiceRefs.size,
      netUnits: agg.netUnits,
      netSpend: moneyFromMinor(agg.netSpendMinor),
      netSpendMinor: agg.netSpendMinor,
      lastPurchasedDate: agg.lastPurchasedDate,
      firstPurchasedDate: agg.firstPurchasedDate,
      availabilityBand: avail.band,
      availabilityLabel: avail.label,
      canBuyAgain,
      currentlyAvailable: canBuyAgain,
      action,
      invoiceRefs: agg.invoiceRefs,
    });
  }

  // Filters
  if (q) {
    const qq = q.toLowerCase();
    items = items.filter(
      (i) =>
        i.sku.toLowerCase().includes(qq) ||
        i.name.toLowerCase().includes(qq) ||
        (i.historicDescription?.toLowerCase().includes(qq) ?? false),
    );
  }
  if (input.brandId) items = items.filter((i) => i.brandId === input.brandId);
  if (input.categoryId) items = items.filter((i) => i.categoryId === input.categoryId);

  if (availability === "AVAILABLE") {
    items = items.filter((i) => i.canBuyAgain);
  } else if (availability === "LOW_STOCK") {
    items = items.filter((i) => i.availabilityBand === "low");
  } else if (availability === "BACKORDER") {
    items = items.filter((i) => i.availabilityBand === "backorder" || i.availabilityBand === "partial");
  } else if (availability === "HISTORIC_ONLY") {
    items = items.filter((i) => i.availabilityBand === "historic" || i.action === "HISTORIC_PRODUCT");
  }

  if (input.quick === "FREQUENT") {
    items = items.filter((i) => i.purchaseCount >= FREQUENT_PURCHASE_MIN_COUNT);
  } else if (input.quick === "RECENT") {
    const cutoff = addDaysIso(today, -(BOUGHT_RECENTLY_DAYS - 1));
    items = items.filter(
      (i) => i.lastPurchasedDate != null && i.lastPurchasedDate >= cutoff,
    );
  } else if (input.quick === "AVAILABLE_NOW") {
    items = items.filter((i) => i.canBuyAgain);
  } else if (input.quick === "HISTORIC_ONLY") {
    items = items.filter((i) => i.action === "HISTORIC_PRODUCT");
  }

  items.sort((a, b) => {
    switch (sort) {
      case "MOST_PURCHASED":
        if (b.netUnits !== a.netUnits) return b.netUnits - a.netUnits;
        return a.sku.localeCompare(b.sku);
      case "MOST_FREQUENT":
        if (b.purchaseCount !== a.purchaseCount) return b.purchaseCount - a.purchaseCount;
        return a.sku.localeCompare(b.sku);
      case "HIGHEST_SPEND":
        if (b.netSpendMinor !== a.netSpendMinor) {
          return b.netSpendMinor > a.netSpendMinor ? 1 : -1;
        }
        return a.sku.localeCompare(b.sku);
      case "NAME_AZ":
        return a.name.localeCompare(b.name, "en-GB");
      case "NAME_ZA":
        return b.name.localeCompare(a.name, "en-GB");
      case "RECENT":
      default: {
        if (a.lastPurchasedDate && b.lastPurchasedDate) {
          const c = b.lastPurchasedDate.localeCompare(a.lastPurchasedDate);
          if (c !== 0) return c;
        } else if (a.lastPurchasedDate) return -1;
        else if (b.lastPurchasedDate) return 1;
        return a.sku.localeCompare(b.sku);
      }
    }
  });

  const total = items.length;
  let summaryUnits = 0;
  let summarySpend = 0n;
  const summaryInvoiceRefs = new Set<string>();
  for (const item of items) {
    summaryUnits += item.netUnits;
    summarySpend += item.netSpendMinor;
    for (const ref of item.invoiceRefs) summaryInvoiceRefs.add(ref);
  }

  const start = (page - 1) * pageSize;
  const pageItems = items.slice(start, start + pageSize).map(
    ({ netSpendMinor: _m, invoiceRefs: _r, ...rest }) => rest,
  );

  return {
    summary: {
      productsPurchased: total,
      purchaseTransactions: summaryInvoiceRefs.size,
      historicNetSpend: moneyFromMinor(summarySpend),
      unitsPurchased: summaryUnits,
    },
    filterOptions: {
      brands: [...brandOptions.entries()]
        .map(([id, name]) => ({ id, name }))
        .sort((a, b) => a.name.localeCompare(b.name, "en-GB")),
      categories: [...categoryOptions.entries()]
        .map(([id, name]) => ({ id, name }))
        .sort((a, b) => a.name.localeCompare(b.name, "en-GB")),
    },
    items: pageItems,
    page,
    pageSize,
    total,
    dataSource:
      "Historic trade-account purchases (imported). Automotive Brands B2B orders are not merged into these totals.",
    note: "Purchase history includes transactions from your existing Automotive Brands trade account.",
  };
}

/**
 * Backward-compatible shim used by existing tests / callers.
 * Maps legacy filter onto the new purchase-history list.
 */
export async function listPortalHistoricPurchases(
  userId: string,
  raw?: { q?: string; filter?: "ALL" | "AVAILABLE" | "UNAVAILABLE" },
) {
  const result = await listPortalPurchaseHistory(userId, {
    q: raw?.q,
    filter: raw?.filter ?? "ALL",
    page: 1,
    pageSize: 100,
    sort: "RECENT",
  });
  return {
    items: result.items.map((i) => ({
      sku: i.sku,
      name: i.name,
      productId: i.productId,
      productSlug: i.productSlug,
      variantId: i.variantId,
      netUnits: i.netUnits,
      netSpend: i.netSpend,
      lineCount: i.purchaseCount,
      lastPurchasedDate: i.lastPurchasedDate,
      currentlyAvailable: i.currentlyAvailable,
      canBuyAgain: i.canBuyAgain,
    })),
    total: result.total,
  };
}

function periodTotals(
  lines: LineRow[],
  skuUpper: string,
  from: string,
  to: string,
): { units: number; spendMinor: bigint; invoiceRefs: Set<string> } {
  const invoiceRefs = new Set<string>();
  let units = 0;
  let spendMinor = 0n;
  for (const line of lines) {
    if (line.sku.trim().toUpperCase() !== skuUpper) continue;
    const d = line.document?.documentDate ? dateOnlyIso(line.document.documentDate) : null;
    if (!d || d < from || d > to) continue;
    units += Number(line.units ?? 0);
    spendMinor += (parseMoney(String(line.salesNet ?? 0)) ?? moneyZero()).minor;
    if (line.documentType === "INVOICE") invoiceRefs.add(line.documentReference);
  }
  return { units, spendMinor, invoiceRefs };
}

export async function getPortalPurchaseProductInsight(userId: string, raw: unknown) {
  const input = insightSchema.parse(raw);
  rejectSpoofedCompany(input);
  const company = await assertPortalPurchaseAccess(userId);
  const skuUpper = input.sku.trim().toUpperCase();

  const lines = await prisma.autopartSalesLine.findMany({
    where: {
      companyId: company.id,
      sku: { equals: input.sku.trim(), mode: "insensitive" },
    },
    select: {
      sku: true,
      units: true,
      salesNet: true,
      descriptionSnapshot: true,
      documentType: true,
      documentReference: true,
      document: { select: { documentDate: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  if (!lines.length) {
    throw new AuthError("No purchase history for this product", "NOT_FOUND", 404);
  }

  const bySku = buildSkuAggregates(lines);
  const agg = bySku.get(skuUpper)!;
  const variant = await prisma.productVariant.findFirst({
    where: { sku: { equals: input.sku.trim(), mode: "insensitive" } },
    select: {
      id: true,
      sku: true,
      backorderPolicy: true,
      product: {
        select: {
          id: true,
          name: true,
          slug: true,
          isActive: true,
          isTradeVisible: true,
          status: true,
          brand: { select: { name: true } },
        },
      },
    },
  });

  const globalPolicy = await getGlobalBackorderPolicy();
  const stockMap = variant ? await loadStockByVariantIds([variant.id]) : new Map();
  const stock = variant ? stockMap.get(variant.id) : undefined;
  const catalogueOk = Boolean(
    variant?.product &&
      variant.product.isActive &&
      variant.product.isTradeVisible &&
      variant.product.status === "ACTIVE",
  );
  const orderable = variant
    ? isOrderableByStockPolicy(
        {
          sellableQty: stock?.sellableQty ?? 0,
          stale: stock?.stale ?? true,
          availability: stock?.availability ?? null,
        },
        stock?.backorderPolicy ?? globalPolicy,
      )
    : false;
  const canBuyAgain = catalogueOk && orderable;
  const avail = resolveAvailabilityPresentation({
    hasCatalogueProduct: Boolean(variant?.product),
    tradeOrderable: catalogueOk,
    stockBand: stock?.availability ?? null,
  });

  // Monthly aggregation — dated lines only (credits in their own dated month).
  const monthMap = new Map<string, { units: number; spendMinor: bigint; invoiceRefs: Set<string> }>();
  for (const line of lines) {
    const d = line.document?.documentDate ? dateOnlyIso(line.document.documentDate) : null;
    if (!d) continue;
    const key = monthKeyFromIso(d);
    let row = monthMap.get(key);
    if (!row) {
      row = { units: 0, spendMinor: 0n, invoiceRefs: new Set() };
      monthMap.set(key, row);
    }
    row.units += Number(line.units ?? 0);
    row.spendMinor += (parseMoney(String(line.salesNet ?? 0)) ?? moneyZero()).minor;
    if (line.documentType === "INVOICE") row.invoiceRefs.add(line.documentReference);
  }
  const monthly = [...monthMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([monthKey, row]) => ({
      monthKey,
      label: monthLabelUk(monthKey),
      units: row.units,
      spend: moneyFromMinor(row.spendMinor),
      invoiceCount: row.invoiceRefs.size,
    }));

  const purchaseCount = agg.invoiceRefs.size;
  const avgQty =
    purchaseCount > 0 ? Math.round((agg.netUnits / purchaseCount) * 1000) / 1000 : null;
  const avgSpend =
    purchaseCount > 0
      ? moneyFromMinor(agg.netSpendMinor / BigInt(purchaseCount))
      : null;

  const datedInvoiceDates = [...agg.invoiceDatesByRef.values()].sort();
  let averageDaysBetweenPurchases: number | null = null;
  if (datedInvoiceDates.length >= 2) {
    let totalGap = 0;
    for (let i = 1; i < datedInvoiceDates.length; i++) {
      const a = new Date(`${datedInvoiceDates[i - 1]}T12:00:00.000Z`).getTime();
      const b = new Date(`${datedInvoiceDates[i]}T12:00:00.000Z`).getTime();
      totalGap += (b - a) / (1000 * 60 * 60 * 24);
    }
    averageDaysBetweenPurchases = Math.round(totalGap / (datedInvoiceDates.length - 1));
  }

  const today = todayLondonDateOnly();
  const last12From = addDaysIso(today, -364);
  const prev12From = addDaysIso(today, -729);
  const prev12To = addDaysIso(today, -365);
  const last90From = addDaysIso(today, -89);
  const prev90From = addDaysIso(today, -179);
  const prev90To = addDaysIso(today, -90);

  const last12 = periodTotals(lines, skuUpper, last12From, today);
  const prev12 = periodTotals(lines, skuUpper, prev12From, prev12To);
  const last90 = periodTotals(lines, skuUpper, last90From, today);
  const prev90 = periodTotals(lines, skuUpper, prev90From, prev90To);

  function compare(
    current: { units: number; spendMinor: bigint; invoiceRefs: Set<string> },
    previous: { units: number; spendMinor: bigint; invoiceRefs: Set<string> },
  ) {
    const hasCurrent =
      current.invoiceRefs.size > 0 || current.units !== 0 || current.spendMinor !== 0n;
    const hasPrevious =
      previous.invoiceRefs.size > 0 || previous.units !== 0 || previous.spendMinor !== 0n;
    if (!hasCurrent && !hasPrevious) return null;
    if (!hasPrevious && hasCurrent) {
      return {
        unitsChangePct: null as number | null,
        spendChangePct: null as number | null,
        direction: "NEW" as const,
        label: "New activity",
      };
    }
    if (!hasCurrent) return null;
    const unitsPct =
      previous.units === 0
        ? null
        : Math.round(((current.units - previous.units) / Math.abs(previous.units)) * 1000) / 10;
    const spendPct =
      previous.spendMinor === 0n
        ? null
        : Math.round(
            (Number(current.spendMinor - previous.spendMinor) /
              Number(
                previous.spendMinor < 0n ? -previous.spendMinor : previous.spendMinor,
              )) *
              1000,
          ) / 10;
    let direction: "INCREASING" | "STABLE" | "DECREASING" | "NEW" = "STABLE";
    const basis = unitsPct ?? spendPct;
    if (basis == null) direction = "STABLE";
    else if (basis > 5) direction = "INCREASING";
    else if (basis < -5) direction = "DECREASING";
    return {
      unitsChangePct: unitsPct,
      spendChangePct: spendPct,
      direction,
      label:
        direction === "INCREASING"
          ? "Purchase volume up vs previous period"
          : direction === "DECREASING"
            ? "Purchase volume down vs previous period"
            : "Purchase volume stable vs previous period",
    };
  }

  const comparison12 = compare(last12, prev12);
  const comparison90 = compare(last90, prev90);

  return {
    sku: agg.sku,
    name: variant?.product.name ?? agg.historicDescription ?? agg.sku,
    historicDescription: agg.historicDescription,
    brandName: variant?.product.brand?.name ?? null,
    productId: variant?.product.id ?? null,
    productSlug: variant?.product.slug ?? null,
    variantId: variant?.id ?? null,
    canBuyAgain,
    action: canBuyAgain
      ? ("BUY_AGAIN" as const)
      : variant?.product?.isTradeVisible
        ? ("VIEW_PRODUCT" as const)
        : ("HISTORIC_PRODUCT" as const),
    availabilityBand: avail.band,
    availabilityLabel: avail.label,
    hasDatedHistory: datedInvoiceDates.length > 0,
    metrics: {
      totalNetUnits: agg.netUnits,
      historicNetSpend: moneyFromMinor(agg.netSpendMinor),
      purchaseCount,
      lastPurchased: agg.lastPurchasedDate,
      firstKnownPurchase: agg.firstPurchasedDate,
      averageQuantityPerPurchase: avgQty,
      averageHistoricSpendPerPurchase: avgSpend,
      averageDaysBetweenPurchases,
      last12Months: {
        purchases: last12.invoiceRefs.size,
        units: last12.units,
        spend: moneyFromMinor(last12.spendMinor),
      },
      comparison12Months: comparison12,
      comparison90Days: comparison90,
    },
    monthly,
    undatedNote:
      datedInvoiceDates.length === 0
        ? "Not enough dated purchase history is available for this product."
        : null,
  };
}
