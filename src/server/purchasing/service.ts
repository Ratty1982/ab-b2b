/**
 * Purchasing Intelligence — decision support. Never creates Autopart POs.
 */
import { z } from "zod";
import { prisma } from "@/infra/database/client";
import { hasPermission } from "@/server/rbac/access";
import { AuthError, requirePurchasingAccess, requireSystemPermission } from "@/server/rbac/guards";
import { AUTOPART_WAREHOUSE_CODE, skuMatchKey } from "@/domain/stock";
import {
  AUTOPART_PRODUCT_KIND_LABEL,
  type AutopartProductKind,
} from "@/domain/autopart-product";
import { stockFreshness } from "@/server/stock/service";
import { loadCurrentFbaQtyByMatchKey, loadFbaFreshness } from "@/server/purchasing/fba-stock";
import { loadCoverageIndex, verificationForBrandSlug } from "@/server/purchasing/sales-history-coverage";
import { trendDirectionBySku } from "@/server/purchasing/sales-trend";
import { SALES_HISTORY_VERIFICATION_LABEL } from "@/domain/sales-history-coverage";
import { autopartConditionLabel } from "@/domain/autopart-product-condition";
import { FBA_LOCATION_CODE, totalOwnedStock } from "@/domain/fba-stock";
import { formatOperationalDateTime, formatOrDash } from "@/lib/datetime";
import { addDaysIso, dateOnlyIsoFromDate, todayLondonDateOnly } from "@/domain/sales-history-period";
import { recordAuditEvent } from "@/server/audit/record";
import {
  DEFAULT_PURCHASING_SETTINGS,
  EMPTY_VARIANT_PURCHASING,
  FORECAST_CONFIDENCE_LABEL,
  PURCHASING_STATUS_LABEL,
  buildForecastConfidenceCopy,
  buildWhyCopy,
  demandComponentAvailability,
  detectUnusualDemand,
  estimatedStockoutDate,
  forecastConfidenceWarning,
  leadTimeDemandUnits,
  parseVerifiedSalesHistoryFrom,
  periodDemand,
  projectedWeeksOfCover,
  reorderPointUnits,
  resolveDemandTrend,
  resolveForecastConfidence,
  resolvePurchasingStatus,
  resolveRecommendedWeeklyDemand,
  salesHistoryCoverageDays,
  seasonalComparisonAvailable,
  stockValueAtLatestCost,
  suggestedPurchaseQty,
  suggestedPurchaseValue,
  weeksOfCover,
  type DemandRates,
  type ForecastConfidence,
  type PurchasingStatus,
  type PurchasingSystemSettings,
  type VariantPurchasingParams,
} from "@/domain/purchasing-forecast";
import {
  clipRangeToVerified,
  coverageDaysForPeriod,
  demandSourcesForSku,
  latestSalesUpdatedAt,
  loadPurchasingDemandMaps,
  unitsFor,
  weeklyNetUnitsForSku,
} from "@/server/purchasing/demand";
import { moneyToString } from "@/domain/money";
import { outstandingBackorderUnitsBySku } from "@/server/purchasing/backorders";
import {
  PLANNER_RECOMMENDATIONS,
  PLANNER_RECOMMENDATION_LABEL,
  PURCHASING_COST_SOURCE_LABEL,
  backorderCoverage,
  classifyPlannerRecommendation,
  comparePlannerPriority,
  demandConfidenceSufficient,
  estimatedLineValue,
  isActionableRecommendation,
  matchesPlannerOperationalFilters,
  plannerPurchaseQty,
  resolvePlanningSupplier,
  resolvePurchasingCost,
  summarizeSupplierPlan,
  type PlanningSupplierState,
} from "@/domain/purchasing-planner";
import { resolveSupplierConstraints } from "@/domain/purchasing-supplier";
import {
  getProductSuppliersForSku,
  getSupplierDetail,
  listActiveSupplierOptions,
  listSuppliers,
  loadSupplierAssignments,
  type SupplierAssignment,
} from "@/server/purchasing/suppliers";

const SETTINGS_ID = "singleton";

function num(value: { toString(): string } | number | null | undefined, fallback: number): number {
  if (value == null) return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function optionalNum(value: { toString(): string } | number | null | undefined): number | null {
  if (value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export async function loadPurchasingSettings(): Promise<PurchasingSystemSettings> {
  const row = await prisma.purchasingSettings.upsert({
    where: { id: SETTINGS_ID },
    create: { id: SETTINGS_ID },
    update: {},
  });
  return {
    defaultTargetCoverWeeks: num(row.defaultTargetCoverWeeks, DEFAULT_PURCHASING_SETTINGS.defaultTargetCoverWeeks),
    defaultSafetyStockQty: row.defaultSafetyStockQty,
    criticalCoverWeeks: num(row.criticalCoverWeeks, DEFAULT_PURCHASING_SETTINGS.criticalCoverWeeks),
    watchCoverWeeks: num(row.watchCoverWeeks, DEFAULT_PURCHASING_SETTINGS.watchCoverWeeks),
    overstockCoverWeeks: num(row.overstockCoverWeeks, DEFAULT_PURCHASING_SETTINGS.overstockCoverWeeks),
    verifiedSalesHistoryFrom: row.verifiedSalesHistoryFrom
      ? dateOnlyIsoFromDate(row.verifiedSalesHistoryFrom)
      : null,
  };
}

type CatalogueRow = {
  variantId: string;
  sku: string;
  name: string;
  brand: string;
  brandSlug: string;
  availableQty: number;
  incomingQty: number;
  latestCost: string | null;
  purchasing: VariantPurchasingParams;
  plannedQty: number | null;
  note: string | null;
  productKind: AutopartProductKind;
  productKindLabel: string;
  autopartProductId: string | null;
  supplier: RowSupplier;
};

/** Planning supplier for a row — from ProductSupplier relationships only, never inferred. */
export type RowSupplier = {
  state: PlanningSupplierState;
  activeCount: number;
  relationId: string | null;
  supplierId: string | null;
  supplierName: string | null;
  supplierCode: string | null;
  supplierSku: string | null;
  unitCost: string | null;
  minimumOrderValue: string | null;
  currency: string | null;
  leadTimeSource: "RELATIONSHIP" | "SUPPLIER_DEFAULT" | "SKU_SETTINGS" | "NONE";
};

const NO_SUPPLIER: RowSupplier = {
  state: "NONE",
  activeCount: 0,
  relationId: null,
  supplierId: null,
  supplierName: null,
  supplierCode: null,
  supplierSku: null,
  unitCost: null,
  minimumOrderValue: null,
  currency: null,
  leadTimeSource: "NONE",
};

/**
 * Apply ProductSupplier relationships to a row. Constraint precedence:
 * relationship → supplier default lead time → existing SKU purchasing settings.
 */
function applySupplierAssignment(row: CatalogueRow, assignments: Map<string, SupplierAssignment[]>): CatalogueRow {
  const relations = assignments.get(skuMatchKey(row.sku)) ?? [];
  const plan = resolvePlanningSupplier(relations);
  const rel = plan.relation;
  const constraints = resolveSupplierConstraints({
    relation: rel,
    supplierDefaultLeadTimeDays: rel?.supplierDefaultLeadTimeDays ?? null,
    sku: row.purchasing,
  });
  return {
    ...row,
    purchasing: {
      ...row.purchasing,
      supplierName: rel?.supplierName ?? row.purchasing.supplierName,
      supplierSku: rel ? rel.supplierSku : row.purchasing.supplierSku,
      leadTimeDays: constraints.leadTimeDays,
      minimumOrderQty: constraints.minimumOrderQty,
      orderMultiple: constraints.orderMultiple,
    },
    supplier: {
      state: plan.state,
      activeCount: plan.activeCount,
      relationId: rel?.id ?? null,
      supplierId: rel?.supplierId ?? null,
      supplierName: rel?.supplierName ?? null,
      supplierCode: rel?.supplierCode ?? null,
      supplierSku: rel?.supplierSku ?? null,
      unitCost: rel?.unitCost ?? null,
      minimumOrderValue: rel?.supplierMinimumOrderValue ?? null,
      currency: rel?.supplierCurrency ?? null,
      leadTimeSource: constraints.leadTimeSource,
    },
  };
}

function purchasingFromSettings(
  p:
    | {
        supplierName: string | null;
        supplierSku: string | null;
        leadTimeDays: number | null;
        minimumOrderQty: number | null;
        orderMultiple: number | null;
        safetyStockQty: number | null;
        targetCoverWeeks: { toString(): string } | number | null;
      }
    | null
    | undefined,
): VariantPurchasingParams {
  if (!p) return EMPTY_VARIANT_PURCHASING;
  return {
    supplierName: p.supplierName,
    supplierSku: p.supplierSku,
    leadTimeDays: p.leadTimeDays,
    minimumOrderQty: p.minimumOrderQty,
    orderMultiple: p.orderMultiple,
    safetyStockQty: p.safetyStockQty,
    targetCoverWeeks: optionalNum(p.targetCoverWeeks),
  };
}

async function loadCatalogueRows(): Promise<CatalogueRow[]> {
  const warehouse = await prisma.warehouse.findUnique({ where: { code: AUTOPART_WAREHOUSE_CODE } });
  const [variants, externals] = await Promise.all([
    prisma.productVariant.findMany({
      where: { isActive: true, product: { isActive: true } },
      select: {
        id: true,
        sku: true,
        name: true,
        product: { select: { name: true, brand: { select: { name: true, slug: true } } } },
        inventory: warehouse
          ? { where: { warehouseId: warehouse.id }, select: { qtyOnHand: true, incomingQty: true } }
          : { select: { qtyOnHand: true, incomingQty: true } },
        purchasingSettings: true,
        purchasingPlanLine: true,
        autopartCostPosition: { select: { latestCost: true } },
      },
    }),
    prisma.autopartProduct.findMany({
      where: { presentInLatestFeed: true, catalogueVariantId: null },
      include: { purchasingSettings: true, purchasingPlanLine: true },
    }),
  ]);
  const catalogueKeys = new Set(variants.map((v) => skuMatchKey(v.sku)));
  const variantRows: CatalogueRow[] = variants.map((v) => {
    const inv = v.inventory[0];
    return {
      variantId: v.id,
      sku: v.sku,
      name: v.name ? `${v.product.name} — ${v.name}` : v.product.name,
      brand: v.product.brand.name,
      brandSlug: v.product.brand.slug,
      availableQty: inv?.qtyOnHand ?? 0,
      incomingQty: inv?.incomingQty ?? 0,
      latestCost: v.autopartCostPosition ? String(v.autopartCostPosition.latestCost) : null,
      purchasing: purchasingFromSettings(v.purchasingSettings),
      plannedQty: v.purchasingPlanLine?.plannedQty ?? null,
      note: v.purchasingPlanLine?.note ?? null,
      productKind: "CATALOGUE",
      productKindLabel: AUTOPART_PRODUCT_KIND_LABEL.CATALOGUE,
      autopartProductId: null,
      supplier: NO_SUPPLIER,
    };
  });
  const externalRows: CatalogueRow[] = externals
    .filter((p) => !catalogueKeys.has(p.matchKey))
    .map((p) => ({
      variantId: p.id,
      sku: p.sku,
      name: p.description?.trim() || p.sku,
      brand: "External",
      brandSlug: "external",
      availableQty: p.availQty,
      incomingQty: p.incomingQty ?? 0,
      latestCost: p.latestCost ? String(p.latestCost) : null,
      purchasing: purchasingFromSettings(p.purchasingSettings),
      plannedQty: p.purchasingPlanLine?.plannedQty ?? null,
      note: p.purchasingPlanLine?.note ?? null,
      productKind: "EXTERNAL",
      productKindLabel: AUTOPART_PRODUCT_KIND_LABEL.EXTERNAL,
      autopartProductId: p.id,
      supplier: NO_SUPPLIER,
    }));
  const held = await prisma.autopartLocationStock.findMany({
    where: {
      locationCode: FBA_LOCATION_CODE,
      availableQty: { gt: 0 },
      autopartProduct: { catalogueVariantId: null },
    },
    include: { autopartProduct: { include: { purchasingSettings: true, purchasingPlanLine: true } } },
  });
  const seen = new Set([...catalogueKeys, ...externalRows.map((row) => skuMatchKey(row.sku))]);
  const fbaOnlyRows: CatalogueRow[] = [];
  for (const heldRow of held) {
    const product = heldRow.autopartProduct;
    if (seen.has(product.matchKey)) continue;
    seen.add(product.matchKey);
    fbaOnlyRows.push({
      variantId: product.id,
      sku: product.sku,
      name: product.description?.trim() || product.sku,
      brand: "External",
      brandSlug: "external",
      availableQty: product.availQty,
      incomingQty: product.incomingQty ?? 0,
      latestCost: product.latestCost ? String(product.latestCost) : null,
      purchasing: purchasingFromSettings(product.purchasingSettings),
      plannedQty: product.purchasingPlanLine?.plannedQty ?? null,
      note: product.purchasingPlanLine?.note ?? null,
      productKind: "EXTERNAL",
      productKindLabel: AUTOPART_PRODUCT_KIND_LABEL.EXTERNAL,
      autopartProductId: product.id,
      supplier: NO_SUPPLIER,
    });
  }
  return [...variantRows, ...externalRows, ...fbaOnlyRows];
}

function buildRates(
  sku: string,
  maps: Awaited<ReturnType<typeof loadPurchasingDemandMaps>>,
): DemandRates {
  const historyFrom = maps.historyFrom;
  const today = maps.windows.today;
  const cover = (range: { from: string; to: string }, requested: number) =>
    coverageDaysForPeriod(range.from, range.to, historyFrom, today);
  return {
    last7: periodDemand(unitsFor(maps.u7, sku), 7, cover(maps.windows.last7, 7)),
    last30: periodDemand(unitsFor(maps.u30, sku), 30, cover(maps.windows.last30, 30)),
    last90: periodDemand(unitsFor(maps.u90, sku), 90, cover(maps.windows.last90, 90)),
    last365: periodDemand(unitsFor(maps.u365, sku), 365, cover(maps.windows.last365, 365)),
    previous30: periodDemand(unitsFor(maps.prev30, sku), 30, cover(maps.windows.previous30, 30)),
    previous90: periodDemand(unitsFor(maps.prev90, sku), 90, cover(maps.windows.previous90, 90)),
    samePeriodLastYear: periodDemand(
      unitsFor(maps.spy, sku),
      30,
      cover(maps.windows.samePeriodLastYear, 30),
    ),
  };
}

function forecastSku(
  row: CatalogueRow,
  maps: Awaited<ReturnType<typeof loadPurchasingDemandMaps>>,
  settings: PurchasingSystemSettings,
  stockStale: boolean,
  fbaQty = 0,
) {
  const verified = Boolean(maps.historyFrom);
  const rates = buildRates(row.sku, maps);
  const demand = resolveRecommendedWeeklyDemand(rates, verified);
  const trend = resolveDemandTrend(rates.last30, rates.previous30);
  const unusual = detectUnusualDemand(rates.last7.netUnits, rates.last90.weeklyRate);
  const targetCoverWeeks = row.purchasing.targetCoverWeeks ?? settings.defaultTargetCoverWeeks;
  const safetyStockQty = row.purchasing.safetyStockQty ?? settings.defaultSafetyStockQty;
  const leadDemand = leadTimeDemandUnits(demand.recommendedWeekly, row.purchasing.leadTimeDays);
  const reorder = reorderPointUnits(leadDemand, safetyStockQty);
  const purchase = suggestedPurchaseQty({
    availableQty: row.availableQty,
    incomingQty: row.incomingQty,
    recommendedWeekly: demand.recommendedWeekly,
    targetCoverWeeks,
    safetyStockQty,
    minimumOrderQty: row.purchasing.minimumOrderQty,
    orderMultiple: row.purchasing.orderMultiple,
  });
  const cover = weeksOfCover(row.availableQty, demand.recommendedWeekly);
  const projectedCover = projectedWeeksOfCover(row.availableQty, row.incomingQty, demand.recommendedWeekly);
  const runout = estimatedStockoutDate({
    today: maps.windows.today,
    availableQty: row.availableQty,
    recommendedWeekly: demand.recommendedWeekly,
  });
  const coverageDays = salesHistoryCoverageDays(maps.historyFrom, maps.windows.today);
  const confidence = resolveForecastConfidence(coverageDays, verified);
  const status = resolvePurchasingStatus({
    availableQty: row.availableQty,
    incomingQty: row.incomingQty,
    weeksCover: cover,
    suggestedQty: purchase.suggestedQty,
    reorderPoint: reorder,
    settings,
    recommendedWeekly: demand.recommendedWeekly,
    stockStale,
    estimatedStockoutDate: runout,
    today: maps.windows.today,
    ...(verified ? { salesHistoryCoverageDays: coverageDays } : {}),
  });
  const value = suggestedPurchaseValue(purchase.suggestedQty, row.latestCost);
  const availValue = stockValueAtLatestCost(row.availableQty, row.latestCost);
  const incomingValue = stockValueAtLatestCost(row.incomingQty, row.latestCost);
  const seasonalAvailable = seasonalComparisonAvailable(rates.samePeriodLastYear, verified);
  return {
    variantId: row.variantId,
    sku: row.sku,
    name: row.name,
    brand: row.brand,
    brandSlug: row.brandSlug,
    availableQty: row.availableQty,
    fbaQty,
    totalStock: totalOwnedStock(row.availableQty, fbaQty),
    incomingQty: row.incomingQty,
    latestCost: row.latestCost,
    purchasing: row.purchasing,
    plannedQty: row.plannedQty,
    note: row.note,
    rates,
    recommendedWeekly: demand.recommendedWeekly,
    demandBasis: demand.basis,
    demandReason: demand.reason,
    trend: trend.trend,
    trendReason: trend.reason,
    unusual,
    targetCoverWeeks,
    safetyStockQty,
    leadTimeDemand: leadDemand,
    reorderPoint: reorder,
    weeksCover: cover,
    projectedCover,
    estimatedStockoutDate: runout,
    purchase,
    status: status.status,
    statusReason: status.reason,
    suggestedValue: value.value ? moneyToString(value.value, 2) : null,
    costAvailable: value.costAvailable,
    availableStockValue: availValue ? moneyToString(availValue, 2) : null,
    incomingStockValue: incomingValue ? moneyToString(incomingValue, 2) : null,
    productKind: row.productKind,
    productKindLabel: row.productKindLabel,
    autopartProductId: row.autopartProductId,
    supplier: row.supplier,
    lastSale: maps.lastSale.get(row.sku.toUpperCase()) ?? null,
    salesHistoryCoverageDays: coverageDays,
    salesHistoryFrom: maps.historyFrom,
    salesHistoryTo: verified ? maps.windows.today : null,
    salesHistoryVerified: verified,
    forecastConfidence: confidence,
    forecastConfidenceLabel: FORECAST_CONFIDENCE_LABEL[confidence],
    forecastConfidenceCopy: buildForecastConfidenceCopy({
      confidence,
      coverageDays,
      verifiedFrom: maps.historyFrom,
      today: maps.windows.today,
    }),
    forecastConfidenceWarning: forecastConfidenceWarning({
      confidence,
      status: status.status,
      suggestedQty: purchase.suggestedQty,
    }),
    demandComponents: {
      last30: demandComponentAvailability(rates.last30, verified),
      last90: demandComponentAvailability(rates.last90, verified),
      last365: demandComponentAvailability(rates.last365, verified),
      seasonalAvailable,
    },
    why: buildWhyCopy({
      weeksCover: cover,
      incomingQty: row.incomingQty,
      suggestedQty: purchase.suggestedQty,
      targetCoverWeeks,
    }),
  };
}

export type PurchasingSkuRow = ReturnType<typeof forecastSku>;

const listInput = z.object({
  status: z.string().optional().nullable(),
  brand: z.string().optional().nullable(),
  supplier: z.string().optional().nullable(),
  trend: z.string().optional().nullable(),
  incoming: z.enum(["any", "yes", "no"]).optional().nullable(),
  productType: z.enum(["all", "catalogue", "external"]).optional().nullable(),
  q: z.string().optional().nullable(),
  sort: z
    .enum(["cover", "suggestedValue", "demand", "stockout", "incoming", "overstock"])
    .optional()
    .nullable(),
  page: z.number().int().positive().optional().nullable(),
  pageSize: z.number().int().positive().max(200).optional().nullable(),
});

function applyFilters(rows: PurchasingSkuRow[], input: z.infer<typeof listInput>) {
  const q = input.q?.trim().toLowerCase() ?? "";
  let out = rows;
  if (input.status) out = out.filter((r) => r.status === input.status);
  if (input.brand) out = out.filter((r) => r.brandSlug === input.brand);
  if (input.supplier) {
    out = out.filter((r) => (r.purchasing.supplierName ?? "").toLowerCase() === input.supplier!.toLowerCase());
  }
  if (input.trend) out = out.filter((r) => r.trend === input.trend);
  if (input.incoming === "yes") out = out.filter((r) => r.incomingQty > 0);
  if (input.incoming === "no") out = out.filter((r) => r.incomingQty <= 0);
  if (input.productType === "catalogue") out = out.filter((r) => r.productKind === "CATALOGUE");
  if (input.productType === "external") out = out.filter((r) => r.productKind === "EXTERNAL");
  if (q) {
    out = out.filter(
      (r) => r.sku.toLowerCase().includes(q) || r.name.toLowerCase().includes(q) || r.brand.toLowerCase().includes(q),
    );
  }
  const sort = input.sort ?? "cover";
  out = [...out].sort((a, b) => {
    if (sort === "suggestedValue") return Number(b.suggestedValue ?? -1) - Number(a.suggestedValue ?? -1);
    if (sort === "demand") return (b.recommendedWeekly ?? -1) - (a.recommendedWeekly ?? -1);
    if (sort === "stockout") {
      return (a.estimatedStockoutDate ?? "9999").localeCompare(b.estimatedStockoutDate ?? "9999");
    }
    if (sort === "incoming") return b.incomingQty - a.incomingQty;
    if (sort === "overstock") return (b.weeksCover ?? -1) - (a.weeksCover ?? -1);
    const ac = a.weeksCover ?? Number.POSITIVE_INFINITY;
    const bc = b.weeksCover ?? Number.POSITIVE_INFINITY;
    return ac - bc;
  });
  return out;
}

async function freshnessLabels() {
  const [stock, salesAt] = await Promise.all([stockFreshness(), latestSalesUpdatedAt()]);
  return {
    stockUpdated: formatOrDash(formatOperationalDateTime(stock.lastSuccessAt)),
    salesUpdated: formatOrDash(formatOperationalDateTime(salesAt)),
    stockStale: stock.stale,
  };
}

export async function getPurchasingDashboard(actorUserId: string) {
  const [{ workspace, rows: plannerRows }, supplierOptions] = await Promise.all([
    loadPlannerRows(actorUserId, 90),
    listActiveSupplierOptions(),
  ]);
  const rows = workspace.rows;
  const groups = supplierGroups(plannerRows, supplierOptions);
  const plannedAll = planSummary(plannerRows, null);
  const supplierPlanning = {
    suppliersRequiringAttention: groups.groups.filter(
      (g) => g.summary.productsToConsider > 0 || g.summary.backordersAtRisk > 0,
    ).length,
    orderNow: plannerRows.filter((r) => r.recommendation === "ORDER_NOW").length,
    backordersAtRisk: plannerRows.filter((r) => r.recommendation === "BACKORDERS_AT_RISK").length,
    estimatedValue: plannedAll.knownValue,
    estimatedValueMissingCostLines: plannedAll.missingCostLines,
    productsMissingSupplier: plannerRows.filter((r) => r.suggestedQty > 0 && r.supplier.state === "NONE").length,
    productsMissingCost: plannerRows.filter((r) => r.suggestedQty > 0 && r.costMissing).length,
    topSuppliers: groups.groups
      .filter((g) => g.summary.productsToConsider > 0 || g.summary.backordersAtRisk > 0)
      .slice(0, 8),
  };
  const coverage = coverageSummary(workspace.maps);
  const count = (status: PurchasingStatus) => rows.filter((r) => r.status === status).length;
  const confidenceCount = (level: ForecastConfidence) =>
    rows.filter((r) => r.forecastConfidence === level).length;
  const orderNow = rows.filter((r) => r.status === "CRITICAL" || r.status === "REORDER").slice(0, 8);
  let suggestedValueTotal = 0;
  let missingCost = 0;
  for (const row of rows) {
    if (row.purchase.suggestedQty <= 0) continue;
    if (row.suggestedValue == null) missingCost += 1;
    else suggestedValueTotal += Number(row.suggestedValue);
  }
  return {
    freshness: workspace.freshness,
    settings: workspace.settings,
    canManage: workspace.canManage,
    supplierPlanning,
    metrics: {
      needingOrder: count("CRITICAL") + count("REORDER"),
      critical: count("CRITICAL"),
      incomingCovers: count("INCOMING_COVERS_REQUIREMENT"),
      watch: count("WATCH"),
      overstock: count("OVERSTOCK"),
      suggestedPurchaseValue: suggestedValueTotal ? suggestedValueTotal.toFixed(2) : null,
      suggestedValueMissingCost: missingCost,
    },
    forecastCoverage: {
      ...coverage,
      counts: {
        UNVERIFIED: confidenceCount("UNVERIFIED"),
        STRONG: confidenceCount("STRONG"),
        GOOD: confidenceCount("GOOD"),
        BUILDING: confidenceCount("BUILDING"),
        LOW: confidenceCount("LOW"),
        VERY_LOW: confidenceCount("VERY_LOW"),
      },
    },
    orderNow,
    runningLow: rows.filter((r) => r.status === "WATCH").slice(0, 8),
    incomingStock: rows.filter((r) => r.status === "INCOMING_COVERS_REQUIREMENT").slice(0, 8),
    demandIncreasing: rows.filter((r) => r.trend === "INCREASING" || r.trend === "STRONGLY_INCREASING").slice(0, 8),
    overstock: rows.filter((r) => r.status === "OVERSTOCK").slice(0, 8),
    noRecentSales: rows.filter((r) => r.status === "NO_RECENT_DEMAND").slice(0, 8),
    unusualDemand: rows.filter((r) => r.unusual.unusual).slice(0, 8),
  };
}

function withHistoryVerification<T extends { brandSlug: string }>(
  row: T,
  coverage: Awaited<ReturnType<typeof loadCoverageIndex>>,
  today: string,
) {
  const history = verificationForBrandSlug(coverage, row.brandSlug, today);
  return {
    ...row,
    historyVerification: history.status,
    historyVerificationLabel: SALES_HISTORY_VERIFICATION_LABEL[history.status],
    verifiedCoverageFrom: history.verifiedCoverageFrom,
    verifiedCoverageTo: history.verifiedCoverageTo,
  };
}

async function filteredForecastRows(actorUserId: string, raw: unknown) {
  const input = listInput.parse(raw ?? {});
  const workspace = await loadWorkspace(actorUserId);
  const [backorders, coverage] = await Promise.all([outstandingBackorderUnitsBySku(), loadCoverageIndex()]);
  const rows = applyFilters(workspace.rows, input).map((row) =>
    withHistoryVerification(
      {
        ...row,
        customerBackorderUnits: backorders.get(skuMatchKey(row.sku)) ?? 0,
      },
      coverage,
      workspace.maps.windows.today,
    ),
  );
  return { input, workspace, rows };
}

export async function listPurchasingForecast(actorUserId: string, raw: unknown) {
  const { input, workspace, rows: all } = await filteredForecastRows(actorUserId, raw);
  const pageSize = input.pageSize ?? 50;
  const page = input.page ?? 1;
  return {
    freshness: workspace.freshness,
    settings: workspace.settings,
    canManage: workspace.canManage,
    brands: workspace.brands,
    suppliers: workspace.suppliers,
    forecastCoverage: coverageSummary(workspace.maps),
    ...paginate(all, page, pageSize),
  };
}

export async function getPurchasingSku(actorUserId: string, sku: string) {
  const workspace = await loadWorkspace(actorUserId);
  const row = workspace.catalogue.find((r) => r.sku.toUpperCase() === sku.toUpperCase());
  if (!row) throw new AuthError("SKU not found", "NOT_FOUND", 404);
  const forecast = forecastSku(
    row,
    workspace.maps,
    workspace.settings,
    workspace.freshness.stockStale,
    workspace.fbaQty.get(skuMatchKey(row.sku)) ?? 0,
  );
  const chartRange = clipRangeToVerified(
    { from: addDaysIso(workspace.maps.windows.today, -364), to: workspace.maps.windows.today },
    workspace.maps.historyFrom,
  );
  const sourceRange = clipRangeToVerified(workspace.maps.windows.last90, workspace.maps.historyFrom);
  const [chart, sources, backorders] = await Promise.all([
    chartRange
      ? weeklyNetUnitsForSku(row.sku, chartRange.from, chartRange.to)
      : Promise.resolve([]),
    sourceRange ? demandSourcesForSku(row.sku, sourceRange) : Promise.resolve([]),
    outstandingBackorderUnitsBySku(),
  ]);
  const customerBackorderUnits = backorders.get(skuMatchKey(row.sku)) ?? 0;
  const coverage = await loadCoverageIndex();
  const history = withHistoryVerification(forecast, coverage, workspace.maps.windows.today);
  return {
    freshness: workspace.freshness,
    settings: workspace.settings,
    canManage: workspace.canManage,
    forecast: history,
    chart,
    sources,
    customerBackorderUnits,
    customerBackorderNote:
      customerBackorderUnits > 0 ? `Customer Backorders: ${customerBackorderUnits} units` : null,
    customerBackorderExplanation:
      customerBackorderUnits > 0 ? `Outstanding customer backorders: ${customerBackorderUnits}` : null,
  };
}

function coverageSummary(maps: Awaited<ReturnType<typeof loadPurchasingDemandMaps>>) {
  const verifiedFrom = maps.historyFrom;
  const verified = Boolean(verifiedFrom);
  const coverageDays = salesHistoryCoverageDays(verifiedFrom, maps.windows.today);
  return {
    coverageDays,
    historyFrom: verifiedFrom,
    verified,
    verifiedFrom,
    verifiedTo: verified ? maps.windows.today : null,
    confidence: resolveForecastConfidence(coverageDays, verified),
  };
}

async function loadWorkspace(actorUserId: string) {
  const profile = await requirePurchasingAccess(actorUserId);
  const settings = await loadPurchasingSettings();
  const [maps, rawCatalogue, fresh, assignments, fbaQty, fbaFreshness] = await Promise.all([
    loadPurchasingDemandMaps(settings.verifiedSalesHistoryFrom),
    loadCatalogueRows(),
    freshnessLabels(),
    loadSupplierAssignments(),
    loadCurrentFbaQtyByMatchKey(),
    loadFbaFreshness(),
  ]);
  const catalogue = rawCatalogue.map((row) => applySupplierAssignment(row, assignments));
  const rows = catalogue.map((row) =>
    forecastSku(row, maps, settings, fresh.stockStale, fbaQty.get(skuMatchKey(row.sku)) ?? 0),
  );
  return {
    canManage: hasPermission(profile, "purchasing.manage"),
    settings,
    maps,
    catalogue,
    fbaQty,
    freshness: {
      ...fresh,
      fbaUpdated: fbaFreshness.updatedLabel,
      fbaStale: fbaFreshness.stale,
      fbaUpdatedAt: fbaFreshness.updatedAt,
    },
    rows,
    brands: [...new Set(catalogue.map((r) => r.brandSlug))].sort(),
    suppliers: [
      ...new Set(catalogue.map((r) => r.purchasing.supplierName).filter((s): s is string => Boolean(s))),
    ].sort(),
  };
}

function paginate<T>(rows: T[], page: number, pageSize: number) {
  const start = (page - 1) * pageSize;
  return { total: rows.length, page, pageSize, rows: rows.slice(start, start + pageSize) };
}

const plannerInput = listInput.extend({
  horizonDays: z.number().int().min(7).max(365).optional().nullable(),
  /** Supplier id, or "unassigned" for products with no planning supplier. */
  supplierId: z.string().optional().nullable(),
  recommendation: z.enum(PLANNER_RECOMMENDATIONS).optional().nullable(),
  backordersOnly: z.boolean().optional().nullable(),
  incomingOnly: z.boolean().optional().nullable(),
  missingCost: z.boolean().optional().nullable(),
  missingSupplier: z.boolean().optional().nullable(),
  demand: z.enum(["sufficient", "limited"]).optional().nullable(),
  plannerSort: z.enum(["priority", "value", "backorders", "cover"]).optional().nullable(),
});

type PlannerInput = z.infer<typeof plannerInput>;

/** Build a supplier-aware planner row on top of the existing forecast row. */
function buildPlannerRow(row: PurchasingSkuRow, backorderUnits: number, stockStale: boolean, horizonDays: number) {
  const calc = plannerPurchaseQty({
    availableQty: row.availableQty,
    incomingQty: row.incomingQty,
    backorderUnits,
    recommendedWeekly: row.recommendedWeekly,
    targetCoverWeeks: row.targetCoverWeeks,
    safetyStockQty: row.safetyStockQty,
    leadTimeDays: row.purchasing.leadTimeDays,
    minimumOrderQty: row.purchasing.minimumOrderQty,
    orderMultiple: row.purchasing.orderMultiple,
  });
  const coverage = backorderCoverage({
    backorderUnits,
    availableQty: row.availableQty,
    incomingQty: row.incomingQty,
  });
  const cost = resolvePurchasingCost({ supplierUnitCost: row.supplier.unitCost, latestCost: row.latestCost });
  const confidenceSufficient = demandConfidenceSufficient({
    verified: row.salesHistoryVerified,
    confidence: row.forecastConfidence,
  });
  const rec = classifyPlannerRecommendation({
    stockStale,
    recommendedWeekly: row.recommendedWeekly,
    confidenceSufficient,
    forecastStatus: row.status,
    suggestedQty: calc.suggestedQty,
    requirementBeforeIncoming: calc.requirementBeforeIncoming,
    backorderCoverage: coverage.coverage,
    supplierState: row.supplier.state,
    incomingQty: row.incomingQty,
  });
  const estimatedValue = calc.suggestedQty > 0 ? estimatedLineValue(calc.suggestedQty, cost.cost) : null;
  return {
    ...row,
    horizonDemand: row.recommendedWeekly == null ? null : Math.ceil(row.recommendedWeekly * (horizonDays / 7)),
    targetStock: row.purchase.targetStock,
    backorderUnits,
    backorderCoverage: coverage.coverage,
    backorderShortfall: coverage.shortfall,
    plan: calc,
    suggestedQty: calc.suggestedQty,
    purchasingCost: cost.cost,
    costSource: cost.source,
    costSourceLabel: PURCHASING_COST_SOURCE_LABEL[cost.source],
    costMissing: cost.cost == null,
    estimatedValue,
    confidenceSufficient,
    recommendation: rec.recommendation,
    recommendationLabel: PLANNER_RECOMMENDATION_LABEL[rec.recommendation],
    recommendationReason: rec.reason,
    actionable: isActionableRecommendation(rec.recommendation),
  };
}

export type PlannerRow = ReturnType<typeof buildPlannerRow>;

async function loadPlannerRows(actorUserId: string, horizonDays: number) {
  const workspace = await loadWorkspace(actorUserId);
  const backorders = await outstandingBackorderUnitsBySku();
  const rows = workspace.rows.map((row) =>
    buildPlannerRow(row, backorders.get(skuMatchKey(row.sku)) ?? 0, workspace.freshness.stockStale, horizonDays),
  );
  return { workspace, rows };
}

function matchesSupplier(row: PlannerRow, supplierId: string | null | undefined) {
  return matchesPlannerOperationalFilters(
    {
      supplierId: row.supplier.supplierId,
      supplierState: row.supplier.state,
      recommendation: row.recommendation,
      backorderUnits: row.backorderUnits,
      incomingQty: row.incomingQty,
      costMissing: row.costMissing,
      confidenceSufficient: row.confidenceSufficient,
    },
    { supplierId },
  );
}

function applyPlannerFilters(rows: PlannerRow[], input: PlannerInput): PlannerRow[] {
  const q = input.q?.trim().toLowerCase() ?? "";
  let out = rows.filter((r) =>
    matchesPlannerOperationalFilters(
      {
        supplierId: r.supplier.supplierId,
        supplierState: r.supplier.state,
        recommendation: r.recommendation,
        backorderUnits: r.backorderUnits,
        incomingQty: r.incomingQty,
        costMissing: r.costMissing,
        confidenceSufficient: r.confidenceSufficient,
      },
      {
        supplierId: input.supplierId,
        recommendation: input.recommendation,
        backordersOnly: input.backordersOnly,
        incomingOnly: input.incomingOnly,
        incoming: input.incoming,
        missingCost: input.missingCost,
        missingSupplier: input.missingSupplier,
        demand: input.demand,
      },
    ),
  );
  if (input.status) out = out.filter((r) => r.status === input.status);
  if (input.brand) out = out.filter((r) => r.brandSlug === input.brand);
  if (input.productType === "catalogue") out = out.filter((r) => r.productKind === "CATALOGUE");
  if (input.productType === "external") out = out.filter((r) => r.productKind === "EXTERNAL");
  if (q) {
    out = out.filter(
      (r) =>
        r.sku.toLowerCase().includes(q) ||
        r.name.toLowerCase().includes(q) ||
        r.brand.toLowerCase().includes(q) ||
        (r.supplier.supplierSku ?? "").toLowerCase().includes(q),
    );
  }
  const sort = input.plannerSort ?? "priority";
  return [...out].sort((a, b) => {
    if (sort === "value") {
      const v = Number(b.estimatedValue ?? -1) - Number(a.estimatedValue ?? -1);
      if (v !== 0) return v;
    } else if (sort === "backorders") {
      const s = b.backorderShortfall - a.backorderShortfall || b.backorderUnits - a.backorderUnits;
      if (s !== 0) return s;
    } else if (sort === "cover") {
      const c = (a.weeksCover ?? Number.POSITIVE_INFINITY) - (b.weeksCover ?? Number.POSITIVE_INFINITY);
      if (c !== 0 && Number.isFinite(c)) return c;
    }
    return comparePlannerPriority(a, b);
  });
}

function planSummary(rows: PlannerRow[], minimumOrderValue: string | null) {
  return summarizeSupplierPlan(
    rows.map((r) => ({
      recommendation: r.recommendation,
      suggestedQty: r.suggestedQty,
      estimatedValue: r.estimatedValue,
      costMissing: r.costMissing,
    })),
    minimumOrderValue,
  );
}

/** Per-supplier planning totals over all planner rows (planning supplier = preferred/only active). */
function supplierGroups(rows: PlannerRow[], suppliers: Awaited<ReturnType<typeof listActiveSupplierOptions>>) {
  const bySupplier = new Map<string, PlannerRow[]>();
  const unassigned: PlannerRow[] = [];
  for (const row of rows) {
    if (!row.supplier.supplierId) {
      unassigned.push(row);
      continue;
    }
    const list = bySupplier.get(row.supplier.supplierId) ?? [];
    list.push(row);
    bySupplier.set(row.supplier.supplierId, list);
  }
  const groups = suppliers.map((s) => ({
    supplierId: s.id,
    supplierName: s.name,
    supplierCode: s.code,
    currency: s.currency,
    products: (bySupplier.get(s.id) ?? []).length,
    summary: planSummary(bySupplier.get(s.id) ?? [], s.minimumOrderValue),
  }));
  groups.sort(
    (a, b) =>
      b.summary.backordersAtRisk - a.summary.backordersAtRisk ||
      b.summary.orderNow - a.summary.orderNow ||
      b.summary.productsToConsider - a.summary.productsToConsider ||
      a.supplierName.localeCompare(b.supplierName),
  );
  const unassignedActionable = unassigned.filter((r) => r.suggestedQty > 0);
  return {
    groups,
    unassigned: {
      products: unassigned.length,
      summary: planSummary(unassigned, null),
      missingSupplierActions: unassignedActionable.length,
    },
  };
}

const overstockInput = listInput.extend({
  quiet: z.enum(["all", "overstock", "30", "90", "180"]).optional().nullable(),
});

export async function listPurchasePlanner(actorUserId: string, raw: unknown) {
  const input = plannerInput.parse(raw ?? {});
  const horizonDays = input.horizonDays ?? 90;
  const [{ workspace, rows }, supplierOptions] = await Promise.all([
    loadPlannerRows(actorUserId, horizonDays),
    listActiveSupplierOptions(),
  ]);
  const filtered = applyPlannerFilters(rows, input);
  const pageSize = input.pageSize ?? 50;
  const page = input.page ?? 1;
  const selectedSupplier =
    input.supplierId && input.supplierId !== "unassigned"
      ? (supplierOptions.find((s) => s.id === input.supplierId) ?? null)
      : null;
  const supplierRows = input.supplierId ? rows.filter((r) => matchesSupplier(r, input.supplierId)) : null;
  const groups = supplierGroups(rows, supplierOptions);
  return {
    freshness: workspace.freshness,
    settings: workspace.settings,
    canManage: workspace.canManage,
    brands: workspace.brands,
    suppliers: workspace.suppliers,
    supplierOptions,
    horizonDays,
    forecastCoverage: coverageSummary(workspace.maps),
    supplierSummary: supplierRows
      ? {
          supplierId: input.supplierId!,
          supplierName: selectedSupplier?.name ?? (input.supplierId === "unassigned" ? "Unassigned supplier" : "Unknown supplier"),
          currency: selectedSupplier?.currency ?? "GBP",
          ...planSummary(supplierRows, selectedSupplier?.minimumOrderValue ?? null),
        }
      : null,
    supplierGroups: input.supplierId ? null : groups,
    ...paginate(filtered, page, pageSize),
  };
}

/** Planner view of one SKU (internal product detail). */
export async function getPlannerRowForSku(actorUserId: string, sku: string) {
  const { rows } = await loadPlannerRows(actorUserId, 90);
  const key = skuMatchKey(sku);
  return rows.find((r) => skuMatchKey(r.sku) === key) ?? null;
}

/** Internal product detail purchasing panel. purchasing.view only — never public/trade. */
export async function getProductPurchasingPanel(actorUserId: string, raw: unknown) {
  const input = z.object({ sku: z.string().trim().min(1) }).parse(raw);
  const [suppliers, row, fbaFreshness] = await Promise.all([
    getProductSuppliersForSku(actorUserId, input),
    getPlannerRowForSku(actorUserId, input.sku),
    loadFbaFreshness(),
  ]);
  return {
    ...suppliers,
    planner: row
      ? {
          availableQty: row.availableQty,
          fbaQty: row.fbaQty,
          totalStock: row.totalStock,
          fbaUpdated: fbaFreshness.updatedLabel,
          fbaStale: fbaFreshness.stale,
          incomingQty: row.incomingQty,
          backorderUnits: row.backorderUnits,
          backorderShortfall: row.backorderShortfall,
          leadTimeDays: row.purchasing.leadTimeDays,
          minimumOrderQty: row.purchasing.minimumOrderQty,
          orderMultiple: row.purchasing.orderMultiple,
          purchasingCost: row.purchasingCost,
          costSourceLabel: row.costSourceLabel,
          suggestedQty: row.suggestedQty,
          estimatedValue: row.estimatedValue,
          recommendation: row.recommendation,
          recommendationLabel: row.recommendationLabel,
          recommendationReason: row.recommendationReason,
          forecastConfidenceLabel: row.forecastConfidenceLabel,
        }
      : null,
  };
}

/** Suppliers list with real planning figures (no figures invented when cost/demand is missing). */
export async function listSuppliersWorkspace(actorUserId: string, raw: unknown) {
  const base = await listSuppliers(actorUserId, raw);
  const { rows } = await loadPlannerRows(actorUserId, 90);
  const bySupplier = new Map<string, PlannerRow[]>();
  for (const row of rows) {
    if (!row.supplier.supplierId) continue;
    const list = bySupplier.get(row.supplier.supplierId) ?? [];
    list.push(row);
    bySupplier.set(row.supplier.supplierId, list);
  }
  const unassigned = rows.filter((r) => !r.supplier.supplierId);
  return {
    ...base,
    suppliers: base.suppliers.map((s) => ({
      ...s,
      planning: planSummary(bySupplier.get(s.id) ?? [], s.defaultMinimumOrderValue),
    })),
    unassigned: {
      products: unassigned.length,
      productsRequiringAction: unassigned.filter((r) => r.suggestedQty > 0).length,
      backordersAtRisk: unassigned.filter((r) => r.recommendation === "BACKORDERS_AT_RISK").length,
    },
  };
}

/** Supplier detail with each product's current planner recommendation. */
export async function getSupplierWorkspace(actorUserId: string, raw: unknown) {
  const detail = await getSupplierDetail(actorUserId, raw);
  const { rows } = await loadPlannerRows(actorUserId, 90);
  const byKey = new Map(rows.map((r) => [skuMatchKey(r.sku), r]));
  const planningRows = rows.filter((r) => r.supplier.supplierId === detail.supplier.id);
  return {
    ...detail,
    planning: planSummary(planningRows, detail.supplier.defaultMinimumOrderValue),
    products: detail.products.map((p) => {
      const row = byKey.get(p.matchKey);
      return {
        ...p,
        planningSupplierIsThis: row?.supplier.supplierId === detail.supplier.id,
        recommendation: row?.recommendation ?? null,
        recommendationLabel: row?.recommendationLabel ?? null,
        recommendationReason: row?.recommendationReason ?? null,
        suggestedQty: row?.suggestedQty ?? null,
        estimatedValue: row?.estimatedValue ?? null,
      };
    }),
  };
}

function daysSinceSale(lastSale: string | null, today: string): number | null {
  if (!lastSale) return null;
  return Math.max(
    0,
    Math.floor((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${lastSale}T00:00:00Z`)) / 86_400_000),
  );
}

export async function listOverstock(actorUserId: string, raw: unknown) {
  const input = overstockInput.parse(raw ?? {});
  const workspace = await loadWorkspace(actorUserId);
  const today = workspace.maps.windows.today;
  const quiet = input.quiet ?? "all";
  const filtered = applyFilters(workspace.rows, { ...input, sort: input.sort ?? "overstock" })
    .map((row) => ({
      ...row,
      daysSinceSale: daysSinceSale(row.lastSale, today),
    }))
    .filter((row) => {
      if (row.availableQty <= 0 && row.status !== "OVERSTOCK") return false;
      if (quiet === "overstock") return row.status === "OVERSTOCK";
      if (quiet === "30") return row.rates.last30.netUnits === 0 || (row.daysSinceSale != null && row.daysSinceSale >= 30) || row.daysSinceSale == null;
      if (quiet === "90") return row.rates.last90.netUnits === 0 || (row.daysSinceSale != null && row.daysSinceSale >= 90) || row.daysSinceSale == null;
      if (quiet === "180") return (row.daysSinceSale != null && row.daysSinceSale >= 180) || row.daysSinceSale == null;
      return (
        row.status === "OVERSTOCK" ||
        row.status === "NO_RECENT_DEMAND" ||
        row.rates.last30.netUnits === 0 ||
        row.daysSinceSale == null ||
        row.daysSinceSale >= 30
      );
    });
  const pageSize = input.pageSize ?? 50;
  const page = input.page ?? 1;
  return {
    freshness: workspace.freshness,
    settings: workspace.settings,
    canManage: workspace.canManage,
    brands: workspace.brands,
    suppliers: workspace.suppliers,
    quiet,
    forecastCoverage: coverageSummary(workspace.maps),
    ...paginate(filtered, page, pageSize),
  };
}

const settingsInput = z.object({
  defaultTargetCoverWeeks: z.number().positive().max(104),
  defaultSafetyStockQty: z.number().int().min(0).max(1_000_000),
  criticalCoverWeeks: z.number().positive().max(52),
  watchCoverWeeks: z.number().positive().max(104),
  overstockCoverWeeks: z.number().positive().max(520),
  verifiedSalesHistoryFrom: z.string().nullable().optional(),
});

export async function updatePurchasingSettings(actorUserId: string, raw: unknown) {
  await requireSystemPermission(actorUserId, "purchasing.manage");
  const input = settingsInput.parse(raw);
  const before = await loadPurchasingSettings();
  let nextVerifiedFrom = before.verifiedSalesHistoryFrom;
  if (input.verifiedSalesHistoryFrom !== undefined) {
    const parsedFrom = parseVerifiedSalesHistoryFrom(
      input.verifiedSalesHistoryFrom,
      todayLondonDateOnly(),
    );
    if (!parsedFrom.ok) throw new AuthError(parsedFrom.error, "VALIDATION", 400);
    nextVerifiedFrom = parsedFrom.value;
  }
  const verifiedDate = nextVerifiedFrom ? new Date(`${nextVerifiedFrom}T00:00:00.000Z`) : null;
  const row = await prisma.purchasingSettings.upsert({
    where: { id: SETTINGS_ID },
    create: {
      id: SETTINGS_ID,
      defaultTargetCoverWeeks: input.defaultTargetCoverWeeks,
      defaultSafetyStockQty: input.defaultSafetyStockQty,
      criticalCoverWeeks: input.criticalCoverWeeks,
      watchCoverWeeks: input.watchCoverWeeks,
      overstockCoverWeeks: input.overstockCoverWeeks,
      verifiedSalesHistoryFrom: verifiedDate,
      updatedByUserId: actorUserId,
    },
    update: {
      defaultTargetCoverWeeks: input.defaultTargetCoverWeeks,
      defaultSafetyStockQty: input.defaultSafetyStockQty,
      criticalCoverWeeks: input.criticalCoverWeeks,
      watchCoverWeeks: input.watchCoverWeeks,
      overstockCoverWeeks: input.overstockCoverWeeks,
      verifiedSalesHistoryFrom: verifiedDate,
      updatedByUserId: actorUserId,
    },
  });
  const after = {
    defaultTargetCoverWeeks: num(row.defaultTargetCoverWeeks, input.defaultTargetCoverWeeks),
    defaultSafetyStockQty: row.defaultSafetyStockQty,
    criticalCoverWeeks: num(row.criticalCoverWeeks, input.criticalCoverWeeks),
    watchCoverWeeks: num(row.watchCoverWeeks, input.watchCoverWeeks),
    overstockCoverWeeks: num(row.overstockCoverWeeks, input.overstockCoverWeeks),
    verifiedSalesHistoryFrom: row.verifiedSalesHistoryFrom
      ? dateOnlyIsoFromDate(row.verifiedSalesHistoryFrom)
      : null,
  };
  await recordAuditEvent({
    action: "purchasing.settings.update",
    entityType: "PurchasingSettings",
    entityId: SETTINGS_ID,
    actorUserId,
    before,
    after,
  });
  return after;
}

const skuSettingsInput = z.object({
  sku: z.string().min(1),
  supplierName: z.string().trim().max(120).nullable().optional(),
  supplierSku: z.string().trim().max(80).nullable().optional(),
  leadTimeDays: z.number().int().min(0).max(365).nullable().optional(),
  minimumOrderQty: z.number().int().min(0).max(1_000_000).nullable().optional(),
  orderMultiple: z.number().int().min(0).max(1_000_000).nullable().optional(),
  safetyStockQty: z.number().int().min(0).max(1_000_000).nullable().optional(),
  targetCoverWeeks: z.number().min(0).max(104).nullable().optional(),
});

export async function updateSkuPurchasingSettings(actorUserId: string, raw: unknown) {
  await requireSystemPermission(actorUserId, "purchasing.manage");
  const input = skuSettingsInput.parse(raw);
  const variant = await prisma.productVariant.findFirst({ where: { sku: { equals: input.sku, mode: "insensitive" } } });
  const data = {
    supplierName: input.supplierName ?? null,
    supplierSku: input.supplierSku ?? null,
    leadTimeDays: input.leadTimeDays ?? null,
    minimumOrderQty: input.minimumOrderQty ?? null,
    orderMultiple: input.orderMultiple ?? null,
    safetyStockQty: input.safetyStockQty ?? null,
    targetCoverWeeks: input.targetCoverWeeks ?? null,
    updatedByUserId: actorUserId,
  };
  if (variant) {
    const before = await prisma.variantPurchasingSettings.findUnique({ where: { variantId: variant.id } });
    await prisma.variantPurchasingSettings.upsert({
      where: { variantId: variant.id },
      create: { variantId: variant.id, ...data },
      update: data,
    });
    await recordAuditEvent({
      action: "purchasing.sku.settings.update",
      entityType: "VariantPurchasingSettings",
      entityId: variant.id,
      actorUserId,
      metadata: { sku: variant.sku },
      before: before ?? null,
      after: data,
    });
    return getPurchasingSku(actorUserId, variant.sku);
  }
  const autopart = await prisma.autopartProduct.findUnique({
    where: { matchKey: skuMatchKey(input.sku) },
  });
  if (!autopart) throw new AuthError("SKU not found", "NOT_FOUND", 404);
  const before = await prisma.autopartProductPurchasingSettings.findUnique({
    where: { autopartProductId: autopart.id },
  });
  await prisma.autopartProductPurchasingSettings.upsert({
    where: { autopartProductId: autopart.id },
    create: { autopartProductId: autopart.id, ...data },
    update: data,
  });
  await recordAuditEvent({
    action: "purchasing.sku.settings.update",
    entityType: "AutopartProductPurchasingSettings",
    entityId: autopart.id,
    actorUserId,
    metadata: { sku: autopart.sku },
    before: before ?? null,
    after: data,
  });
  return getPurchasingSku(actorUserId, autopart.sku);
}

const planInput = z.object({
  sku: z.string().min(1),
  plannedQty: z.number().int().min(0).max(10_000_000).nullable().optional(),
  note: z.string().max(2000).nullable().optional(),
});

export async function updatePurchasingPlan(actorUserId: string, raw: unknown) {
  await requireSystemPermission(actorUserId, "purchasing.manage");
  const input = planInput.parse(raw);
  const variant = await prisma.productVariant.findFirst({ where: { sku: { equals: input.sku, mode: "insensitive" } } });
  if (variant) {
    const before = await prisma.purchasingPlanLine.findUnique({ where: { variantId: variant.id } });
    await prisma.purchasingPlanLine.upsert({
      where: { variantId: variant.id },
      create: {
        variantId: variant.id,
        plannedQty: input.plannedQty ?? null,
        note: input.note ?? null,
        updatedByUserId: actorUserId,
      },
      update: {
        ...(input.plannedQty !== undefined ? { plannedQty: input.plannedQty } : {}),
        ...(input.note !== undefined ? { note: input.note } : {}),
        updatedByUserId: actorUserId,
      },
    });
    await recordAuditEvent({
      action: input.note !== undefined && input.plannedQty === undefined ? "purchasing.note.update" : "purchasing.plan.update",
      entityType: "PurchasingPlanLine",
      entityId: variant.id,
      actorUserId,
      metadata: { sku: variant.sku },
      before: before ?? null,
      after: { plannedQty: input.plannedQty, note: input.note },
    });
    return getPurchasingSku(actorUserId, variant.sku);
  }
  const autopart = await prisma.autopartProduct.findUnique({
    where: { matchKey: skuMatchKey(input.sku) },
  });
  if (!autopart) throw new AuthError("SKU not found", "NOT_FOUND", 404);
  const before = await prisma.autopartPurchasingPlanLine.findUnique({
    where: { autopartProductId: autopart.id },
  });
  await prisma.autopartPurchasingPlanLine.upsert({
    where: { autopartProductId: autopart.id },
    create: {
      autopartProductId: autopart.id,
      plannedQty: input.plannedQty ?? null,
      note: input.note ?? null,
      updatedByUserId: actorUserId,
    },
    update: {
      ...(input.plannedQty !== undefined ? { plannedQty: input.plannedQty } : {}),
      ...(input.note !== undefined ? { note: input.note } : {}),
      updatedByUserId: actorUserId,
    },
  });
  await recordAuditEvent({
    action: input.note !== undefined && input.plannedQty === undefined ? "purchasing.note.update" : "purchasing.plan.update",
    entityType: "AutopartPurchasingPlanLine",
    entityId: autopart.id,
    actorUserId,
    metadata: { sku: autopart.sku },
    before: before ?? null,
    after: { plannedQty: input.plannedQty, note: input.note },
  });
  return getPurchasingSku(actorUserId, autopart.sku);
}

function forecastExportFilename(brand: string | null | undefined, today: string): string {
  const slug = (brand ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return slug ? `stock-forecast-${slug}-${today}.csv` : `stock-forecast-${today}.csv`;
}

export async function exportStockForecastCsv(actorUserId: string, raw: unknown) {
  const { input, workspace, rows } = await filteredForecastRows(actorUserId, raw);
  const keys = rows.map((row) => skuMatchKey(row.sku));
  const [conditions, directions] = await Promise.all([
    keys.length
      ? prisma.autopartProduct.findMany({
          where: { matchKey: { in: keys } },
          select: { matchKey: true, conditionCode: true },
        })
      : Promise.resolve([]),
    trendDirectionBySku(rows.map((row) => row.sku), workspace.maps.windows.today),
  ]);
  const conditionByKey = new Map(conditions.map((row) => [row.matchKey, autopartConditionLabel(row.conditionCode) ?? ""]));
  const header = [
    "Product",
    "SKU",
    "Brand",
    "Product Type",
    "Supplier",
    "Product Condition",
    "Warehouse Stock",
    "FBA Stock",
    "Total Stock",
    "Incoming",
    "Customer Backorders",
    "7d Sales",
    "30d Sales",
    "90d Sales",
    "365d Sales",
    "Average / Week",
    "Current Cover",
    "Lead Time Days",
    "Estimated Runout",
    "Suggested Order",
    "Latest Cost GBP",
    "Suggested Value GBP",
    "Trend Direction",
    "Sales History Confidence",
    "Verified Coverage From",
    "Verified Coverage To",
    "Status",
  ];
  const lines = [
    header.join(","),
    ...rows.map((row) =>
      [
        csv(row.name),
        csv(row.sku),
        csv(row.brand),
        csv(row.productKindLabel),
        csv(row.purchasing.supplierName ?? row.supplier.supplierName),
        csv(conditionByKey.get(skuMatchKey(row.sku)) ?? ""),
        row.availableQty,
        row.fbaQty,
        row.totalStock,
        row.incomingQty,
        row.customerBackorderUnits,
        row.rates.last7.netUnits,
        row.rates.last30.netUnits,
        row.rates.last90.netUnits,
        row.rates.last365.netUnits,
        row.recommendedWeekly ?? "",
        row.weeksCover ?? "",
        row.purchasing.leadTimeDays ?? "",
        row.estimatedStockoutDate ?? "",
        row.purchase.suggestedQty,
        row.latestCost ?? "",
        row.suggestedValue ?? "",
        csv(directions.get(skuMatchKey(row.sku)) ?? "Insufficient history"),
        csv(row.historyVerificationLabel),
        row.verifiedCoverageFrom ?? "",
        row.verifiedCoverageTo ?? "",
        csv(PURCHASING_STATUS_LABEL[row.status]),
      ].join(","),
    ),
  ];
  return {
    filename: forecastExportFilename(input.brand, workspace.maps.windows.today),
    csv: lines.join("\n"),
    rowCount: rows.length,
  };
}

export async function exportPurchasePlannerCsv(actorUserId: string, raw: unknown) {
  const input = plannerInput.parse(raw ?? {});
  const { rows: plannerRows } = await loadPlannerRows(actorUserId, input.horizonDays ?? 90);
  const rows = applyPlannerFilters(plannerRows, input);
  const header = [
    "Supplier",
    "Supplier SKU",
    "SKU",
    "Description",
    "Product Type",
    "Brand",
    "Warehouse Stock",
    "FBA Stock",
    "Total Stock",
    "Incoming",
    "30 Day Units",
    "90 Day Units",
    "Recommended Weekly Demand",
    "Lead Time Days",
    "Safety Stock",
    "Target Cover Weeks",
    "Suggested Qty",
    "Planned Qty",
    "Latest Cost",
    "Estimated Value",
    "Forecast Confidence",
    "Sales History Coverage Days",
    "30d Coverage",
    "90d Coverage",
    "365d Coverage",
    "Seasonal Comparison Available",
    "Purchasing Note",
    "Recommendation",
    "Recommendation Reason",
    "Customer Backorders",
    "Uncovered Backorders",
    "Planner Suggested Qty",
    "Purchasing Cost",
    "Cost Source",
    "Planner Estimated Value",
  ];
  const lines = [
    header.join(","),
    ...rows.map((row) =>
      [
        csv(
          row.supplier.state === "NONE"
            ? "NO SUPPLIER"
            : row.supplier.state === "AMBIGUOUS"
              ? "Ambiguous"
              : row.supplier.supplierName,
        ),
        csv(row.supplier.supplierSku),
        csv(row.sku),
        csv(row.name),
        csv(row.productKindLabel),
        csv(row.brand),
        row.availableQty,
        row.fbaQty,
        row.totalStock,
        row.incomingQty,
        row.rates.last30.netUnits,
        row.rates.last90.netUnits,
        row.recommendedWeekly ?? "",
        row.purchasing.leadTimeDays ?? "",
        row.safetyStockQty,
        row.targetCoverWeeks,
        row.purchase.suggestedQty,
        row.plannedQty ?? "",
        row.latestCost ?? "",
        row.suggestedValue ?? "",
        csv(row.forecastConfidenceLabel),
        row.salesHistoryCoverageDays,
        row.demandComponents.last30,
        row.demandComponents.last90,
        row.demandComponents.last365,
        row.demandComponents.seasonalAvailable ? "yes" : "no",
        csv(row.note),
        csv(row.recommendationLabel),
        csv(row.recommendationReason),
        row.backorderUnits,
        row.backorderShortfall,
        row.suggestedQty,
        row.purchasingCost ?? "",
        csv(row.costSourceLabel),
        row.estimatedValue ?? "",
      ].join(","),
    ),
  ];
  return {
    filename: `purchase-planner-${todayLondonDateOnly()}.csv`,
    csv: lines.join("\n"),
    disclaimer:
      "Human purchasing worksheet. Not an Autopart purchase-order import. Purchase orders are created and owned in Autopart.",
  };
}

function csv(value: string | null | undefined): string {
  const s = value ?? "";
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export { PURCHASING_STATUS_LABEL };
