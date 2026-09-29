/**
 * Catalogue-wide Cost Intelligence workspace.
 * Read-only. Reuses AutopartProductCostPosition + AutopartProductCostSnapshot.
 */
import { Prisma } from "@prisma/client";
import { prisma } from "@/infra/database/client";
import { AuthError, requireAnySystemPermission } from "@/server/rbac/guards";
import { buildCsv } from "@/domain/sales-intelligence";
import { moneyToString, parseMoney } from "@/domain/money";
import {
  classifyPositionMovement,
  computeCostChange,
  countDistinctCostMovements,
  dateInInclusiveRange,
  DEFAULT_PRICE_REVIEW_PCT,
  londonDateOnlyFromInstant,
  meetsMagnitude,
  movementLabel,
  parseCostIntelligenceSearch,
  resolveCostPeriodRange,
  resolveMagnitudeThreshold,
  type CostChangeDto,
  type CostIntelligenceSearch,
  type CostMovement,
  type CostSort,
} from "@/domain/cost-intelligence";

async function requireCostView(actorUserId: string) {
  const profile = await requireAnySystemPermission(actorUserId, [
    "products.cost.view",
    "admin.access",
  ]);
  if (profile.actorType === "TRADE") {
    throw new AuthError("Trade users cannot view Autopart product cost", "FORBIDDEN", 403);
  }
  return profile;
}

export type CostIntelligenceRow = {
  sku: string;
  productId: string | null;
  productVariantId: string | null;
  productName: string | null;
  brandName: string | null;
  brandId: string | null;
  categoryName: string | null;
  categoryId: string | null;
  previousCost: string | null;
  latestCost: string | null;
  change: CostChangeDto | null;
  movement: CostMovement;
  movementLabel: string;
  firstObservedAt: string | null;
  lastChangedAt: string | null;
  lastObservedAt: string | null;
  tradePrice: string | null;
  rrp: string | null;
  priceReview: boolean;
  movementCountInPeriod: number;
  inCatalogue: boolean;
};

function applyViewDefaults(search: CostIntelligenceSearch): CostIntelligenceSearch {
  const next = { ...search };
  if (search.view === "RECENT") {
    if (next.movement === "ALL") next.movement = "ALL";
    next.sort = next.sort === "LATEST_CHANGE" ? "LATEST_CHANGE" : next.sort;
  } else if (search.view === "INCREASES") {
    next.movement = "INCREASED";
    if (search.sort === "LATEST_CHANGE") next.sort = "PCT_INCREASE";
  } else if (search.view === "DECREASES") {
    next.movement = "DECREASED";
    if (search.sort === "LATEST_CHANGE") next.sort = "PCT_DECREASE";
  } else if (search.view === "PRICE_REVIEW") {
    if (next.magnitude === "ANY") next.magnitude = "PCT_5";
  } else if (search.view === "REPEATED") {
    // handled post-filter
  }
  return next;
}

type BuiltRow = CostIntelligenceRow & { _sortPct: number; _sortGbp: number; _sortChanged: number };

export type CostIntelligenceCounts = {
  withCost: number;
  increased: number;
  decreased: number;
  firstSeen: number;
  unchanged: number;
  noCost: number;
  repeated: number;
  priceReview: number;
};

async function buildRows(
  search: CostIntelligenceSearch,
): Promise<{
  rows: BuiltRow[];
  counts: CostIntelligenceCounts;
  brands: Array<{ id: string; name: string }>;
  categories: Array<{ id: string; name: string }>;
}> {
  const range = resolveCostPeriodRange(search.period, search.from ?? null, search.to ?? null);
  const threshold = resolveMagnitudeThreshold({
    magnitude: search.magnitude,
    minPct: search.minPct,
    minGbp: search.minGbp,
  });
  const reviewThreshold = resolveMagnitudeThreshold({
    magnitude: search.view === "PRICE_REVIEW" || search.magnitude === "PCT_5" ? "PCT_5" : search.magnitude,
    minPct:
      search.view === "PRICE_REVIEW" && search.magnitude === "ANY"
        ? String(DEFAULT_PRICE_REVIEW_PCT)
        : search.minPct,
    minGbp: search.minGbp,
  });

  const [positions, brands, categories, catalogueVariants] = await Promise.all([
    prisma.autopartProductCostPosition.findMany({
      select: {
        sku: true,
        productVariantId: true,
        latestCost: true,
        previousCost: true,
        firstObservedAt: true,
        lastObservedAt: true,
        lastChangedAt: true,
      },
    }),
    prisma.brand.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true },
      take: 2000,
    }),
    prisma.category.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true },
      take: 2000,
    }),
    prisma.productVariant.findMany({
      where: { isActive: true },
      select: {
        id: true,
        sku: true,
        tradePrice: true,
        rrp: true,
        product: {
          select: {
            id: true,
            name: true,
            isActive: true,
            brandId: true,
            categoryId: true,
            brand: { select: { id: true, name: true } },
            category: { select: { id: true, name: true } },
          },
        },
      },
    }),
  ]);

  const variantById = new Map(catalogueVariants.map((v) => [v.id, v]));
  const variantBySku = new Map(
    catalogueVariants.map((v) => [v.sku.trim().toUpperCase(), v]),
  );
  const positionSkuKeys = new Set(positions.map((p) => p.sku.trim().toUpperCase()));

  // Snapshot history for repeated movers (period-bounded)
  const snapshotWhere: Prisma.AutopartProductCostSnapshotWhereInput = {};
  if (range) {
    snapshotWhere.businessDate = {
      gte: new Date(`${range.from}T00:00:00.000Z`),
      lte: new Date(`${range.to}T00:00:00.000Z`),
    };
  }
  const snapshots = await prisma.autopartProductCostSnapshot.findMany({
    where: snapshotWhere,
    orderBy: [{ sku: "asc" }, { businessDate: "asc" }],
    select: { sku: true, businessDate: true, latestCost: true },
  });
  const costsBySku = new Map<string, string[]>();
  for (const s of snapshots) {
    const key = s.sku.trim().toUpperCase();
    const list = costsBySku.get(key) ?? [];
    list.push(String(s.latestCost));
    costsBySku.set(key, list);
  }
  const movementCountBySku = new Map<string, number>();
  for (const [key, costs] of costsBySku) {
    movementCountBySku.set(key, countDistinctCostMovements(costs));
  }

  const counts: CostIntelligenceCounts = {
    withCost: 0,
    increased: 0,
    decreased: 0,
    firstSeen: 0,
    unchanged: 0,
    noCost: 0,
    repeated: 0,
    priceReview: 0,
  };

  const built: BuiltRow[] = [];

  for (const pos of positions) {
    const skuKey = pos.sku.trim().toUpperCase();
    const variant =
      (pos.productVariantId ? variantById.get(pos.productVariantId) : null) ??
      variantBySku.get(skuKey) ??
      null;
    const inCatalogue = Boolean(variant);
    if (search.catalogue === "CATALOGUE" && !inCatalogue) continue;
    if (search.catalogue === "UNMATCHED" && inCatalogue) continue;

    if (search.brandId && variant?.product.brandId !== search.brandId) continue;
    if (search.categoryId && variant?.product.categoryId !== search.categoryId) continue;

    const latestParsed = parseMoney(String(pos.latestCost));
    if (!latestParsed) continue;
    const latestStr = moneyToString(latestParsed, 4);
    const previousParsed =
      pos.previousCost != null ? parseMoney(String(pos.previousCost)) : null;
    const previousStr = previousParsed ? moneyToString(previousParsed, 4) : null;
    const change = computeCostChange(latestParsed, previousParsed);
    const movement = classifyPositionMovement({
      previousCost: previousStr,
      latestCost: latestStr,
      firstObservedAt: pos.firstObservedAt,
      lastChangedAt: pos.lastChangedAt,
      range,
    });

    const firstIn = dateInInclusiveRange(
      londonDateOnlyFromInstant(pos.firstObservedAt),
      range,
    );
    const changedIn = pos.lastChangedAt
      ? dateInInclusiveRange(londonDateOnlyFromInstant(pos.lastChangedAt), range)
      : false;

    // Bounded periods: include products first-seen or changed in period, plus
    // products with prior observation whose distinct cost did not change (UNCHANGED).
    // Price Review / Repeated / explicit movement filters also need the wider set.
    const includeForWorkspace =
      !range ||
      firstIn ||
      changedIn ||
      movement === "UNCHANGED" ||
      search.view === "PRICE_REVIEW" ||
      search.view === "REPEATED" ||
      search.movement === "INCREASED" ||
      search.movement === "DECREASED" ||
      search.movement === "FIRST_SEEN" ||
      search.movement === "UNCHANGED";

    if (!includeForWorkspace) continue;

    counts.withCost += 1;
    if (movement === "INCREASED") counts.increased += 1;
    if (movement === "DECREASED") counts.decreased += 1;
    if (movement === "FIRST_SEEN") counts.firstSeen += 1;
    if (movement === "UNCHANGED") counts.unchanged += 1;

    const movementCount = movementCountBySku.get(skuKey) ?? 0;
    if (movementCount >= 2) counts.repeated += 1;

    const tradePrice =
      variant?.tradePrice != null
        ? moneyToString(parseMoney(String(variant.tradePrice))!, 4)
        : null;
    const rrp =
      variant?.rrp != null ? moneyToString(parseMoney(String(variant.rrp))!, 2) : null;

    const priceReview =
      Boolean(change && change.direction !== "flat") &&
      Boolean(tradePrice) &&
      inCatalogue &&
      (!range || changedIn) &&
      meetsMagnitude(change, {
        minPctBps:
          reviewThreshold.minPctBps ?? BigInt(DEFAULT_PRICE_REVIEW_PCT * 100),
        minGbpMinor: reviewThreshold.minGbpMinor,
      });
    if (priceReview) counts.priceReview += 1;

    if (search.q) {
      const qq = search.q.toLowerCase();
      const name = variant?.product.name?.toLowerCase() ?? "";
      if (!skuKey.toLowerCase().includes(qq) && !name.includes(qq)) continue;
    }

    if (search.view === "REPEATED" && movementCount < 2) continue;
    if (search.view === "PRICE_REVIEW" && !priceReview) continue;
    if (search.view === "RECENT" && !(changedIn || (firstIn && movement === "FIRST_SEEN"))) {
      continue;
    }
    if (search.view === "INCREASES" && movement !== "INCREASED") continue;
    if (search.view === "DECREASES" && movement !== "DECREASED") continue;

    const effectiveMovement = search.movement;
    if (effectiveMovement !== "ALL" && effectiveMovement !== "NO_COST") {
      if (movement !== effectiveMovement) continue;
    }

    if (
      (movement === "INCREASED" || movement === "DECREASED") &&
      !meetsMagnitude(change, threshold) &&
      search.view !== "PRICE_REVIEW"
    ) {
      if (search.magnitude !== "ANY") continue;
    }
    if (search.view === "PRICE_REVIEW" && search.magnitude !== "ANY") {
      if (!meetsMagnitude(change, threshold)) continue;
    }

    const absPct = change?.absPercent ? Number(change.absPercent) : 0;
    const gbpDelta = change ? Number(change.absolute) : 0;
    const changedMs = pos.lastChangedAt?.getTime() ?? 0;

    built.push({
      sku: pos.sku,
      productId: variant?.product.id ?? null,
      productVariantId: variant?.id ?? pos.productVariantId,
      productName: variant?.product.name ?? null,
      brandName: variant?.product.brand?.name ?? null,
      brandId: variant?.product.brandId ?? null,
      categoryName: variant?.product.category?.name ?? null,
      categoryId: variant?.product.categoryId ?? null,
      previousCost: previousStr,
      latestCost: latestStr,
      change,
      movement,
      movementLabel: movementLabel(movement),
      firstObservedAt: pos.firstObservedAt.toISOString(),
      lastChangedAt: pos.lastChangedAt?.toISOString() ?? null,
      lastObservedAt: pos.lastObservedAt.toISOString(),
      tradePrice,
      rrp,
      priceReview,
      movementCountInPeriod: movementCount,
      inCatalogue,
      _sortPct: absPct * (change?.direction === "down" ? -1 : 1),
      _sortGbp: gbpDelta,
      _sortChanged: changedMs,
    });
  }

  // No-cost catalogue products
  for (const v of catalogueVariants) {
    const key = v.sku.trim().toUpperCase();
    if (positionSkuKeys.has(key)) continue;
    if (search.catalogue === "UNMATCHED") continue;
    if (search.brandId && v.product.brandId !== search.brandId) continue;
    if (search.categoryId && v.product.categoryId !== search.categoryId) continue;
    if (search.q) {
      const qq = search.q.toLowerCase();
      if (!key.toLowerCase().includes(qq) && !v.product.name.toLowerCase().includes(qq)) {
        continue;
      }
    }
    counts.noCost += 1;
    const includeNoCost =
      search.movement === "NO_COST" ||
      (search.movement === "ALL" &&
        search.view === "ALL" &&
        false); // default All view excludes no-cost rows; use No Cost Data filter/card
    if (!includeNoCost) continue;

    built.push({
      sku: v.sku,
      productId: v.product.id,
      productVariantId: v.id,
      productName: v.product.name,
      brandName: v.product.brand?.name ?? null,
      brandId: v.product.brandId,
      categoryName: v.product.category?.name ?? null,
      categoryId: v.product.categoryId,
      previousCost: null,
      latestCost: null,
      change: null,
      movement: "NO_COST",
      movementLabel: movementLabel("NO_COST"),
      firstObservedAt: null,
      lastChangedAt: null,
      lastObservedAt: null,
      tradePrice:
        v.tradePrice != null ? moneyToString(parseMoney(String(v.tradePrice))!, 4) : null,
      rrp: v.rrp != null ? moneyToString(parseMoney(String(v.rrp))!, 2) : null,
      priceReview: false,
      movementCountInPeriod: 0,
      inCatalogue: true,
      _sortPct: 0,
      _sortGbp: 0,
      _sortChanged: 0,
    });
  }

  // When movement is NO_COST only keep those
  let filtered = built;
  if (search.movement === "NO_COST") {
    filtered = built.filter((r) => r.movement === "NO_COST");
  } else if (search.movement !== "ALL") {
    filtered = built.filter((r) => r.movement === search.movement);
  } else if (search.view === "ALL" && search.movement === "ALL") {
    // exclude no-cost from default ALL view unless explicitly filtered
    filtered = built.filter((r) => r.movement !== "NO_COST");
  }

  sortRows(filtered, search.sort);

  return {
    rows: filtered,
    counts,
    brands,
    categories,
  };
}

function sortRows(rows: BuiltRow[], sort: CostSort) {
  rows.sort((a, b) => {
    switch (sort) {
      case "PCT_INCREASE":
        return (b.change?.direction === "up" ? b._sortPct : -1) -
          (a.change?.direction === "up" ? a._sortPct : -1);
      case "PCT_DECREASE":
        return (a.change?.direction === "down" ? a._sortPct : 1) -
          (b.change?.direction === "down" ? b._sortPct : 1);
      case "GBP_INCREASE":
        return b._sortGbp - a._sortGbp;
      case "GBP_DECREASE":
        return a._sortGbp - b._sortGbp;
      case "NAME_AZ":
        return (a.productName ?? a.sku).localeCompare(b.productName ?? b.sku, "en-GB");
      case "SKU":
        return a.sku.localeCompare(b.sku, "en-GB");
      case "COST_HIGH":
        return Number(b.latestCost ?? -1) - Number(a.latestCost ?? -1);
      case "COST_LOW":
        return Number(a.latestCost ?? Number.MAX_VALUE) - Number(b.latestCost ?? Number.MAX_VALUE);
      case "LATEST_CHANGE":
      default:
        return b._sortChanged - a._sortChanged;
    }
  });
}

export async function getCostIntelligenceWorkspace(actorUserId: string, raw: unknown) {
  await requireCostView(actorUserId);
  const parsed = parseCostIntelligenceSearch(
    (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>,
  );
  const search = applyViewDefaults(parsed);
  const { rows, counts, brands, categories } = await buildRows(search);
  const total = rows.length;
  const start = (search.page - 1) * search.pageSize;
  const pageRows = rows.slice(start, start + search.pageSize).map((r) => {
    const { _sortPct, _sortGbp, _sortChanged, ...rest } = r;
    void _sortPct;
    void _sortGbp;
    void _sortChanged;
    return rest;
  });
  const range = resolveCostPeriodRange(search.period, search.from ?? null, search.to ?? null);

  return {
    search,
    period: range,
    counts,
    brands,
    categories,
    items: pageRows,
    page: search.page,
    pageSize: search.pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / search.pageSize)),
    defaultPriceReviewPct: DEFAULT_PRICE_REVIEW_PCT,
  };
}

export async function exportCostIntelligenceCsv(actorUserId: string, raw: unknown) {
  await requireCostView(actorUserId);
  const parsed = parseCostIntelligenceSearch(
    (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>,
  );
  // buildRows returns the full filtered set; pagination is applied only in the workspace getter.
  const { rows: all } = await buildRows(applyViewDefaults(parsed));
  const csv = buildCsv(
    [
      "SKU",
      "Product",
      "Brand",
      "Category",
      "Previous Cost",
      "Latest Cost",
      "Change GBP",
      "Change Percent",
      "Movement",
      "First Observed",
      "Last Changed",
      "Last Observed",
      "Base Trade Price",
      "RRP",
      "Price Review",
      "Movements In Period",
    ],
    all.map((r) => [
      r.sku,
      r.productName ?? "",
      r.brandName ?? "",
      r.categoryName ?? "",
      r.previousCost ?? "",
      r.latestCost ?? "",
      r.change?.absolute ?? "",
      r.change?.percent ?? "",
      r.movement,
      r.firstObservedAt ?? "",
      r.lastChangedAt ?? "",
      r.lastObservedAt ?? "",
      r.tradePrice ?? "",
      r.rrp ?? "",
      r.priceReview ? "YES" : "NO",
      String(r.movementCountInPeriod),
    ]),
  );
  const stamp = new Date().toISOString().slice(0, 10);
  return { filename: `cost-intelligence-${stamp}.csv`, csv };
}

/** Pure helpers exported for unit tests */
export const __costIntelligenceTest = {
  classifyPositionMovement,
  computeCostChange,
  meetsMagnitude,
  resolveMagnitudeThreshold,
  countDistinctCostMovements,
};
