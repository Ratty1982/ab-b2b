/**
 * Internal stock overview. Warehouse Avail comes from the 231PO3NEW import.
 * Amazon FBA stays on AutopartLocationStock and is never added to sellable stock.
 * This module only reads stock. It does not import, adjust, or write stock back.
 */
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/infra/database/client";
import { AUTOPART_PRODUCT_KIND_LABEL, classifyAutopartProduct } from "@/domain/autopart-product";
import { autopartConditionLabel } from "@/domain/autopart-product-condition";
import {
  FBA_LOCATION_CODE,
  FBA_STOCK_LABEL,
  WAREHOUSE_STOCK_LABEL,
  fbaLocationForImport,
  totalOwnedStock,
} from "@/domain/fba-stock";
import { resolvePlanningSupplier } from "@/domain/purchasing-planner";
import { sellableQuantityFromAvail, skuMatchKey, warehouseDisplayName } from "@/domain/stock";
import {
  STOCK_VALUE_HELP,
  configuredReorderPoint,
  fbaImportHealth,
  overviewLineValues,
  overviewSellableQty,
  overviewStatusLabel,
  overviewStockStatus,
  overviewUnavailableQty,
  warehouseImportHealth,
  type OverviewStockStatus,
  type OverviewValueTotals,
} from "@/domain/stock-overview";
import { loadFbaFreshness } from "@/server/purchasing/fba-stock";
import { stockFreshness } from "@/server/stock/service";
import { requirePurchasingAccess } from "@/server/rbac/guards";

const UK_FBA_CODE = fbaLocationForImport("UK")?.locationCode ?? FBA_LOCATION_CODE;
const PAGE_SIZE = 50;
const EXPORT_LIMIT = 20000;

const querySchema = z.object({
  q: z.string().max(120).optional().nullable(),
  position: z.enum(["all", "in", "low", "out", "unknown", "incoming", "fba"]).optional().nullable(),
  catalogue: z.enum(["all", "catalogue", "external"]).optional().nullable(),
  feed: z.enum(["current", "historic", "all"]).optional().nullable(),
  brand: z.string().max(80).optional().nullable(),
  warehouse: z.string().max(80).optional().nullable(),
  supplier: z.string().max(80).optional().nullable(),
  sort: z
    .enum([
      "recent",
      "sku",
      "name",
      "brand",
      "physical",
      "sellable",
      "avail",
      "incoming",
      "updated",
    ])
    .optional()
    .nullable(),
  page: z.number().int().positive().optional().nullable(),
});

export type StockOverviewQuery = z.infer<typeof querySchema>;

const detailSchema = z.object({
  sku: z.string().trim().min(1).max(120),
});

function overviewWhere(
  input: StockOverviewQuery,
  lowIds: string[],
): {
  where: import("@prisma/client").Prisma.AutopartProductWhereInput;
  page: number;
  sort: NonNullable<StockOverviewQuery["sort"]>;
} {
  const q = input.q?.trim() ?? "";
  const position = input.position ?? "all";
  const catalogue = input.catalogue ?? "all";
  const feed = input.feed ?? "current";
  const sort = input.sort ?? "recent";
  const brand = input.brand?.trim() ?? "";
  const warehouse = input.warehouse?.trim() ?? "";
  const supplier = input.supplier?.trim() ?? "";
  const catalogueVariantFilter =
    (brand && brand !== "unlinked") || warehouse
      ? {
          ...(brand && brand !== "unlinked" ? { product: { brandId: brand } } : {}),
          ...(warehouse ? { inventory: { some: { warehouseId: warehouse } } } : {}),
        }
      : null;
  const feedWhere =
    feed === "historic"
      ? { presentInLatestFeed: false }
      : feed === "all"
        ? {}
        : { presentInLatestFeed: true };
  const confirmedWhere =
    position === "in" || position === "low" || position === "out"
      ? { presentInLatestFeed: true }
      : {};
  return {
    page: input.page ?? 1,
    sort,
    where: {
      AND: [feedWhere, confirmedWhere],
      ...(q
        ? {
            OR: [
              { sku: { contains: q, mode: "insensitive" } },
              { description: { contains: q, mode: "insensitive" } },
              { matchKey: { contains: q.toUpperCase() } },
              { groupCode: { contains: q, mode: "insensitive" } },
              { catalogueVariant: { sku: { contains: q, mode: "insensitive" } } },
              { catalogueVariant: { barcode: { contains: q, mode: "insensitive" } } },
              { catalogueVariant: { product: { name: { contains: q, mode: "insensitive" } } } },
              {
                catalogueVariant: {
                  product: { brand: { name: { contains: q, mode: "insensitive" } } },
                },
              },
            ],
          }
        : {}),
      ...(catalogue === "catalogue" ? { catalogueVariantId: { not: null } } : {}),
      ...(catalogue === "external" ? { catalogueVariantId: null } : {}),
      ...(catalogueVariantFilter ? { catalogueVariant: catalogueVariantFilter } : {}),
      ...(brand === "unlinked" ? { catalogueVariantId: null } : {}),
      ...(supplier === "unassigned"
        ? { productSuppliers: { none: { active: true, supplier: { active: true } } } }
        : supplier
          ? {
              productSuppliers: {
                some: { supplierId: supplier, active: true, supplier: { active: true } },
              },
            }
          : {}),
      ...(position === "in"
        ? { availQty: { gt: 0 }, ...(lowIds.length > 0 ? { id: { notIn: lowIds } } : {}) }
        : {}),
      ...(position === "low" ? { id: { in: lowIds }, availQty: { gt: 0 } } : {}),
      ...(position === "out" ? { availQty: { lte: 0 } } : {}),
      ...(position === "unknown" ? { presentInLatestFeed: false } : {}),
      ...(position === "incoming" ? { incomingQty: { gt: 0 } } : {}),
      ...(position === "fba"
        ? { locationStocks: { some: { locationCode: UK_FBA_CODE, availableQty: { gt: 0 } } } }
        : {}),
    },
  };
}

function orderBy(sort: NonNullable<StockOverviewQuery["sort"]>) {
  if (sort === "sku") return [{ sku: "asc" as const }];
  if (sort === "name") return [{ description: "asc" as const }, { sku: "asc" as const }];
  if (sort === "brand") {
    return [
      { catalogueVariant: { product: { brand: { name: "asc" as const } } } },
      { sku: "asc" as const },
    ];
  }
  if (sort === "physical") return [{ physicalQty: "desc" as const }, { sku: "asc" as const }];
  if (sort === "sellable" || sort === "avail")
    return [{ availQty: "desc" as const }, { sku: "asc" as const }];
  if (sort === "incoming") return [{ incomingQty: "desc" as const }, { sku: "asc" as const }];
  if (sort === "updated") return [{ lastSeenAt: "desc" as const }, { sku: "asc" as const }];
  return [{ lastSeenAt: "desc" as const }, { sku: "asc" as const }];
}

const rowInclude = {
  purchasingSettings: { select: { safetyStockQty: true, supplierName: true } },
  productSuppliers: {
    where: { active: true },
    select: {
      isPreferred: true,
      active: true,
      unitCost: true,
      supplier: { select: { id: true, name: true, active: true } },
    },
  },
  catalogueVariant: {
    select: {
      sku: true,
      barcode: true,
      inventory: {
        select: {
          qtyOnHand: true,
          qtyReserved: true,
          warehouse: { select: { code: true, name: true } },
        },
      },
      purchasingSettings: { select: { safetyStockQty: true, supplierName: true } },
      product: { select: { name: true, brand: { select: { id: true, name: true } } } },
    },
  },
  locationStocks: {
    where: { locationCode: UK_FBA_CODE },
    select: { availableQty: true, locationCode: true },
  },
} as const;

type OverviewRow = {
  sku: string;
  productName: string | null;
  brandName: string | null;
  catalogueSku: string | null;
  ean: string | null;
  description: string | null;
  groupCode: string | null;
  conditionCode: string | null;
  conditionLabel: string | null;
  kind: string;
  kindLabel: string;
  inCatalogue: boolean;
  catalogueLabel: string;
  presentInLatestFeed: boolean;
  availQty: number;
  incomingQty: number | null;
  physicalQty: number | null;
  reservedQty: number | null;
  unavailableQty: number | null;
  sellableQty: number | null;
  reorderPoint: number | null;
  fbaQty: number;
  ownedQty: number;
  warehouseName: string | null;
  supplierName: string | null;
  supplierLabel: string;
  unitCost: string | null;
  unitCostSource: string;
  stockValue: string | null;
  sellableValue: string | null;
  stockStatus: OverviewStockStatus;
  statusLabel: string;
  lastSeenAt: string;
};

function reservedFrom(row: {
  catalogueVariant: { inventory: { qtyReserved: number }[] } | null;
}): number | null {
  if (!row.catalogueVariant) return null;
  return row.catalogueVariant.inventory.reduce((sum, item) => sum + item.qtyReserved, 0);
}

function decimalText(value: { toFixed(digits: number): string } | null | undefined): string | null {
  if (value == null) return null;
  return value.toFixed(4);
}

function supplierView(
  links: {
    isPreferred: boolean;
    active: boolean;
    unitCost: { toFixed(digits: number): string } | null;
    supplier: { id: string; name: string; active: boolean };
  }[],
) {
  const relations = links.map((link) => ({
    id: link.supplier.id,
    supplierId: link.supplier.id,
    supplierName: link.supplier.name,
    supplierActive: link.supplier.active,
    active: link.active,
    isPreferred: link.isPreferred,
    unitCost: decimalText(link.unitCost),
  }));
  const plan = resolvePlanningSupplier(relations);
  return {
    state: plan.state,
    supplierName: plan.relation?.supplierName ?? null,
    supplierUnitCost: plan.relation?.unitCost ?? null,
  };
}

function presentRow(row: {
  sku: string;
  description: string | null;
  groupCode: string | null;
  conditionCode: string | null;
  catalogueVariantId: string | null;
  presentInLatestFeed: boolean;
  availQty: number;
  incomingQty: number | null;
  physicalQty: number | null;
  latestCost: { toFixed(digits: number): string } | null;
  lastSeenAt: Date;
  purchasingSettings: { safetyStockQty: number | null; supplierName: string | null } | null;
  productSuppliers: {
    isPreferred: boolean;
    active: boolean;
    unitCost: { toFixed(digits: number): string } | null;
    supplier: { id: string; name: string; active: boolean };
  }[];
  catalogueVariant: {
    sku: string;
    barcode: string | null;
    inventory: {
      qtyOnHand: number;
      qtyReserved: number;
      warehouse: { code: string; name: string };
    }[];
    purchasingSettings: { safetyStockQty: number | null; supplierName: string | null } | null;
    product: { name: string; brand: { id: string; name: string } };
  } | null;
  locationStocks: { availableQty: number; locationCode: string }[];
}): OverviewRow {
  const kind = classifyAutopartProduct({
    hasCatalogueVariant: Boolean(row.catalogueVariantId),
    presentInLatestFeed: row.presentInLatestFeed,
  });
  const linked = Boolean(row.catalogueVariant);
  const warehouse = sellableQuantityFromAvail(row.availQty);
  const fbaQty = row.locationStocks
    .filter((location) => location.locationCode === UK_FBA_CODE)
    .reduce((sum, location) => sum + location.availableQty, 0);
  const reservedQty = reservedFrom(row);
  const reorderPoint = configuredReorderPoint(
    row.catalogueVariant?.purchasingSettings?.safetyStockQty,
    row.purchasingSettings?.safetyStockQty,
  );
  const stockStatus = overviewStockStatus({
    presentInLatestFeed: row.presentInLatestFeed,
    availQty: row.availQty,
    reorderPoint,
  });
  const warehouses = [
    ...new Set(
      (row.catalogueVariant?.inventory ?? [])
        .map((item) => warehouseDisplayName(item.warehouse.code, item.warehouse.name))
        .filter(Boolean),
    ),
  ];
  const supplier = supplierView(row.productSuppliers);
  const values = overviewLineValues({
    physicalQty: row.physicalQty,
    sellableQty: overviewSellableQty(linked, row.availQty, reservedQty),
    supplierUnitCost: supplier.supplierUnitCost,
    latestCost: decimalText(row.latestCost),
  });
  const supplierLabel =
    supplier.state === "ASSIGNED" && supplier.supplierName
      ? supplier.supplierName
      : supplier.state === "AMBIGUOUS"
        ? "Multiple suppliers"
        : "Unassigned";
  return {
    sku: row.sku,
    productName: row.catalogueVariant?.product.name ?? row.description,
    brandName: row.catalogueVariant?.product.brand.name ?? null,
    catalogueSku: row.catalogueVariant?.sku ?? null,
    ean: row.catalogueVariant?.barcode ?? null,
    description: row.description,
    groupCode: row.groupCode,
    conditionCode: row.conditionCode,
    conditionLabel: autopartConditionLabel(row.conditionCode),
    kind,
    kindLabel: AUTOPART_PRODUCT_KIND_LABEL[kind],
    inCatalogue: kind === "CATALOGUE",
    catalogueLabel: linked ? "Linked" : "Not linked to catalogue",
    presentInLatestFeed: row.presentInLatestFeed,
    availQty: warehouse,
    incomingQty: row.incomingQty,
    physicalQty: row.physicalQty,
    reservedQty,
    unavailableQty: overviewUnavailableQty(linked, reservedQty),
    sellableQty: overviewSellableQty(linked, row.availQty, reservedQty),
    reorderPoint,
    fbaQty,
    ownedQty: totalOwnedStock(warehouse, fbaQty),
    warehouseName: warehouses.length > 0 ? warehouses.join(", ") : null,
    supplierName: supplier.supplierName,
    supplierLabel,
    unitCost: values.unitCost,
    unitCostSource: values.source,
    stockValue: values.physicalValue,
    sellableValue: values.sellableValue,
    stockStatus,
    statusLabel: overviewStatusLabel(stockStatus),
    lastSeenAt: row.lastSeenAt.toISOString(),
  };
}

/**
 * Parts at or below a stored safety-stock quantity. No fixed quantity band.
 * Variant safety stock wins, including when it is the only configured value.
 * Starts from the settings tables so the product master is not scanned.
 */
function lowStockIdQuery() {
  return Prisma.sql`
    SELECT p.id
    FROM "VariantPurchasingSettings" vps
    INNER JOIN "AutopartProduct" p ON p."catalogueVariantId" = vps."variantId"
    WHERE p."availQty" > 0
      AND vps."safetyStockQty" IS NOT NULL
      AND p."availQty" <= vps."safetyStockQty"
    UNION
    SELECT p.id
    FROM "AutopartProductPurchasingSettings" aps
    INNER JOIN "AutopartProduct" p ON p.id = aps."autopartProductId"
    LEFT JOIN "VariantPurchasingSettings" vps ON vps."variantId" = p."catalogueVariantId"
    WHERE p."availQty" > 0
      AND vps."safetyStockQty" IS NULL
      AND aps."safetyStockQty" IS NOT NULL
      AND p."availQty" <= aps."safetyStockQty"
  `;
}

async function lowStockProductIds(): Promise<string[]> {
  const rows = await prisma.$queryRaw<Array<{ id: string }>>(lowStockIdQuery());
  return rows.map((row) => row.id);
}

/** Summary card count. Limited to the current feed, which is what the card displays. */
async function currentFeedLowStockCount(): Promise<number> {
  const rows = await prisma.$queryRaw<Array<{ count: number }>>(Prisma.sql`
    SELECT COUNT(*)::int AS count
    FROM "AutopartProduct" feed
    WHERE feed."presentInLatestFeed" = true
      AND feed.id IN (${lowStockIdQuery()})
  `);
  return Number(rows[0]?.count ?? 0);
}

async function catalogueSellableUnits(): Promise<number> {
  const rows = await prisma.$queryRaw<Array<{ sellable: number | bigint }>>`
    SELECT COALESCE(SUM(GREATEST(0, p."availQty" - COALESCE(inv.reserved, 0))), 0)::int AS sellable
    FROM "AutopartProduct" p
    LEFT JOIN (
      SELECT "variantId", SUM("qtyReserved")::int AS reserved
      FROM "Inventory"
      GROUP BY "variantId"
    ) inv ON inv."variantId" = p."catalogueVariantId"
    WHERE p."presentInLatestFeed" = true
      AND p."catalogueVariantId" IS NOT NULL
  `;
  return Number(rows[0]?.sellable ?? 0);
}

async function positionSummary(lowPartNumbers: number) {
  const current = { presentInLatestFeed: true };
  const fba = { locationCode: UK_FBA_CODE };
  const [feed, physical, out, sellableUnits, reserved, fbaUnits, fbaSkus, linked] =
    await Promise.all([
      prisma.autopartProduct.aggregate({
        where: current,
        _count: true,
        _sum: { incomingQty: true },
      }),
      prisma.autopartProduct.aggregate({
        where: { ...current, physicalQty: { not: null } },
        _count: true,
        _sum: { physicalQty: true },
      }),
      prisma.autopartProduct.count({ where: { ...current, availQty: { lte: 0 } } }),
      catalogueSellableUnits(),
      prisma.inventory.aggregate({
        where: { variant: { autopartProduct: { is: { presentInLatestFeed: true } } } },
        _sum: { qtyReserved: true },
      }),
      prisma.autopartLocationStock.aggregate({ where: fba, _sum: { availableQty: true } }),
      prisma.autopartLocationStock.count({ where: { ...fba, availableQty: { gt: 0 } } }),
      prisma.autopartProduct.count({ where: { ...current, catalogueVariantId: { not: null } } }),
    ]);
  const physicalKnown = physical._count;
  return {
    partNumbers: feed._count,
    physicalUnits: physicalKnown > 0 ? (physical._sum.physicalQty ?? 0) : null,
    physicalKnown,
    unavailableUnits: reserved._sum.qtyReserved ?? 0,
    sellableUnits,
    lowPartNumbers,
    outPartNumbers: out,
    incomingUnits: feed._sum.incomingQty ?? 0,
    catalogueLinked: linked,
    fbaUnits: fbaUnits._sum.availableQty ?? 0,
    fbaSkus,
    warehouseLabel: WAREHOUSE_STOCK_LABEL,
    fbaLabel: FBA_STOCK_LABEL,
  };
}

async function loadImportStatus(lowFba: {
  updatedAt: string | null;
  stale: boolean;
  fileName: string | null;
  staleAfterDays: number;
}) {
  const [running, latest, freshness, lastChange] = await Promise.all([
    prisma.stockSyncRun.findFirst({
      where: { status: "RUNNING", mode: "live" },
      orderBy: { startedAt: "desc" },
      select: { startedAt: true, status: true },
    }),
    prisma.stockSyncRun.findFirst({
      where: { mode: "live", status: { not: "RUNNING" } },
      orderBy: { startedAt: "desc" },
      select: {
        status: true,
        completedAt: true,
        startedAt: true,
        errorSummary: true,
        rowsRead: true,
        updated: true,
      },
    }),
    stockFreshness(),
    prisma.stockSyncChange.findFirst({
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    }),
  ]);
  const latestStatus = running ? "RUNNING" : (latest?.status ?? null);
  const health = warehouseImportHealth({
    running: Boolean(running),
    latestStatus,
    hasSuccessfulImport: Boolean(freshness.lastSuccessAt),
    stale: freshness.stale,
  });
  const lastUpdated = running?.startedAt ?? latest?.completedAt ?? latest?.startedAt ?? null;
  return {
    health,
    lastSuccessfulImportAt: freshness.lastSuccessAt?.toISOString() ?? null,
    lastSuccessfulUpdateAt: lastChange?.createdAt.toISOString() ?? null,
    lastUpdatedAt: lastUpdated?.toISOString() ?? null,
    latestStatus,
    latestError: latest?.errorSummary ?? null,
    rowsRead: latest?.rowsRead ?? null,
    updatedCount: latest?.updated ?? null,
    stale: freshness.stale,
    staleHours: freshness.staleHours,
    fbaHealth: fbaImportHealth({ importedAt: lowFba.updatedAt, stale: lowFba.stale }),
    fbaUpdatedAt: lowFba.updatedAt,
    fbaFileName: lowFba.fileName,
    fbaStaleAfterDays: lowFba.staleAfterDays,
  };
}

async function brandOptions() {
  return prisma.brand.findMany({
    where: { products: { some: { variants: { some: { autopartProduct: { isNot: null } } } } } },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
    take: 200,
  });
}

async function warehouseOptions() {
  const rows = await prisma.warehouse.findMany({
    where: { inventory: { some: { variant: { autopartProduct: { isNot: null } } } } },
    select: { id: true, code: true, name: true },
    orderBy: { name: "asc" },
    take: 50,
  });
  return rows.map((warehouse) => ({
    ...warehouse,
    name: warehouseDisplayName(warehouse.code, warehouse.name),
  }));
}

async function supplierOptions() {
  return prisma.supplier.findMany({
    where: {
      active: true,
      products: { some: { active: true, autopartProduct: { isNot: null } } },
    },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
    take: 300,
  });
}

function likeContains(value: string): string {
  return `%${value.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
}

/** Same predicates as overviewWhere, kept in SQL so totals are one aggregate. */
function valuationPredicates(input: StockOverviewQuery, lowIds: string[]): Prisma.Sql[] {
  const q = input.q?.trim() ?? "";
  const position = input.position ?? "all";
  const catalogue = input.catalogue ?? "all";
  const feed = input.feed ?? "current";
  const brand = input.brand?.trim() ?? "";
  const warehouse = input.warehouse?.trim() ?? "";
  const supplier = input.supplier?.trim() ?? "";
  const parts: Prisma.Sql[] = [];
  if (feed === "historic") parts.push(Prisma.sql`p."presentInLatestFeed" = false`);
  else if (feed === "current") parts.push(Prisma.sql`p."presentInLatestFeed" = true`);
  if (position === "in" || position === "low" || position === "out") {
    parts.push(Prisma.sql`p."presentInLatestFeed" = true`);
  }
  if (position === "unknown") parts.push(Prisma.sql`p."presentInLatestFeed" = false`);
  if (catalogue === "catalogue") parts.push(Prisma.sql`p."catalogueVariantId" IS NOT NULL`);
  if (catalogue === "external" || brand === "unlinked") {
    parts.push(Prisma.sql`p."catalogueVariantId" IS NULL`);
  }
  if (brand && brand !== "unlinked") {
    parts.push(Prisma.sql`
      EXISTS (
        SELECT 1 FROM "ProductVariant" v
        INNER JOIN "Product" pr ON pr.id = v."productId"
        WHERE v.id = p."catalogueVariantId" AND pr."brandId" = ${brand}
      )
    `);
  }
  if (warehouse) {
    parts.push(Prisma.sql`
      EXISTS (
        SELECT 1 FROM "Inventory" i
        WHERE i."variantId" = p."catalogueVariantId" AND i."warehouseId" = ${warehouse}
      )
    `);
  }
  if (supplier === "unassigned") {
    parts.push(Prisma.sql`
      NOT EXISTS (
        SELECT 1 FROM "ProductSupplier" ps
        INNER JOIN "Supplier" su ON su.id = ps."supplierId"
        WHERE ps."autopartProductId" = p.id AND ps.active = true AND su.active = true
      )
    `);
  } else if (supplier) {
    parts.push(Prisma.sql`
      EXISTS (
        SELECT 1 FROM "ProductSupplier" ps
        INNER JOIN "Supplier" su ON su.id = ps."supplierId"
        WHERE ps."autopartProductId" = p.id
          AND ps."supplierId" = ${supplier}
          AND ps.active = true
          AND su.active = true
      )
    `);
  }
  if (position === "in" || position === "low") parts.push(Prisma.sql`p."availQty" > 0`);
  if (position === "in" && lowIds.length > 0) parts.push(Prisma.sql`NOT (p.id = ANY(${lowIds}))`);
  if (position === "low") {
    parts.push(lowIds.length > 0 ? Prisma.sql`p.id = ANY(${lowIds})` : Prisma.sql`FALSE`);
  }
  if (position === "out") parts.push(Prisma.sql`p."availQty" <= 0`);
  if (position === "incoming") parts.push(Prisma.sql`p."incomingQty" > 0`);
  if (position === "fba") {
    parts.push(Prisma.sql`
      EXISTS (
        SELECT 1 FROM "AutopartLocationStock" loc
        WHERE loc."autopartProductId" = p.id
          AND loc."locationCode" = ${UK_FBA_CODE}
          AND loc."availableQty" > 0
      )
    `);
  }
  if (q) {
    const like = likeContains(q);
    const matchLike = likeContains(q.toUpperCase());
    const escape = "\\";
    parts.push(Prisma.sql`(
      p.sku ILIKE ${like} ESCAPE ${escape}
      OR COALESCE(p.description, '') ILIKE ${like} ESCAPE ${escape}
      OR p."matchKey" LIKE ${matchLike} ESCAPE ${escape}
      OR COALESCE(p."groupCode", '') ILIKE ${like} ESCAPE ${escape}
      OR EXISTS (
        SELECT 1 FROM "ProductVariant" v
        LEFT JOIN "Product" pr ON pr.id = v."productId"
        LEFT JOIN "Brand" b ON b.id = pr."brandId"
        WHERE v.id = p."catalogueVariantId"
          AND (
            v.sku ILIKE ${like} ESCAPE ${escape}
            OR COALESCE(v.barcode, '') ILIKE ${like} ESCAPE ${escape}
            OR pr.name ILIKE ${like} ESCAPE ${escape}
            OR b.name ILIKE ${like} ESCAPE ${escape}
          )
      )
    )`);
  }
  return parts;
}

function gbpTotal(value: { toFixed(digits: number): string } | string | null): string | null {
  if (value == null) return null;
  if (typeof value !== "string") return value.toFixed(2);
  const negative = value.startsWith("-");
  const digits = negative ? value.slice(1) : value;
  const [whole, frac = ""] = digits.split(".");
  return `${negative ? "-" : ""}${whole}.${frac.padEnd(2, "0").slice(0, 2)}`;
}

/**
 * One aggregate for the filtered set. Supplier links are collapsed before the
 * product row is valued, so several suppliers cannot duplicate quantity or value.
 * FBA location stock is not read. Missing costs stay out of the money totals.
 */
async function filteredValuation(
  input: StockOverviewQuery,
  lowIds: string[],
): Promise<OverviewValueTotals> {
  const predicates = valuationPredicates(input, lowIds);
  const whereSql =
    predicates.length > 0 ? Prisma.sql`WHERE ${Prisma.join(predicates, " AND ")}` : Prisma.empty;
  const rows = await prisma.$queryRaw<
    Array<{
      products: number;
      missingCost: number;
      valuedPhysical: number;
      valuedSellable: number;
      physicalValue: { toFixed(digits: number): string } | string | null;
      sellableValue: { toFixed(digits: number): string } | string | null;
    }>
  >(Prisma.sql`
    WITH supplier_choice AS (
      SELECT
        ps."autopartProductId" AS product_id,
        COUNT(*) FILTER (WHERE ps."isPreferred")::int AS pref_count,
        COUNT(*)::int AS usable_count,
        MAX(ps."unitCost") FILTER (WHERE ps."isPreferred") AS pref_cost,
        MAX(ps."unitCost") AS only_cost
      FROM "ProductSupplier" ps
      INNER JOIN "Supplier" su ON su.id = ps."supplierId"
      WHERE ps.active = true
        AND su.active = true
        AND ps."autopartProductId" IS NOT NULL
      GROUP BY ps."autopartProductId"
    ),
    reserved AS (
      SELECT "variantId", SUM("qtyReserved")::int AS reserved
      FROM "Inventory"
      GROUP BY "variantId"
    ),
    base AS (
      SELECT
        p."physicalQty",
        CASE
          WHEN COALESCE(s.pref_count, 0) = 1 THEN s.pref_cost
          WHEN COALESCE(s.pref_count, 0) = 0 AND COALESCE(s.usable_count, 0) = 1 THEN s.only_cost
          ELSE NULL
        END AS supplier_cost,
        p."latestCost",
        CASE
          WHEN p."catalogueVariantId" IS NULL THEN NULL
          ELSE GREATEST(0, p."availQty" - GREATEST(0, COALESCE(inv.reserved, 0)))
        END AS sellable_qty
      FROM "AutopartProduct" p
      LEFT JOIN supplier_choice s ON s.product_id = p.id
      LEFT JOIN reserved inv ON inv."variantId" = p."catalogueVariantId"
      ${whereSql}
    ),
    priced AS (
      SELECT
        "physicalQty",
        sellable_qty,
        CASE
          WHEN supplier_cost IS NOT NULL AND supplier_cost > 0 THEN supplier_cost
          WHEN "latestCost" IS NOT NULL AND "latestCost" > 0 THEN "latestCost"
          ELSE NULL
        END AS unit_cost
      FROM base
    ),
    lines AS (
      SELECT
        unit_cost,
        CASE
          WHEN unit_cost IS NULL OR "physicalQty" IS NULL THEN NULL
          WHEN "physicalQty" <= 0 THEN 0::numeric
          ELSE ROUND(("physicalQty"::numeric) * unit_cost, 2)
        END AS physical_line,
        CASE
          WHEN unit_cost IS NULL OR sellable_qty IS NULL THEN NULL
          WHEN sellable_qty <= 0 THEN 0::numeric
          ELSE ROUND((sellable_qty::numeric) * unit_cost, 2)
        END AS sellable_line
      FROM priced
    )
    SELECT
      COUNT(*)::int AS products,
      COUNT(*) FILTER (WHERE unit_cost IS NULL)::int AS "missingCost",
      COUNT(physical_line)::int AS "valuedPhysical",
      COUNT(sellable_line)::int AS "valuedSellable",
      SUM(physical_line) AS "physicalValue",
      SUM(sellable_line) AS "sellableValue"
    FROM lines
  `);
  const row = rows[0];
  return {
    physicalValue: gbpTotal(row?.physicalValue ?? null),
    sellableValue: gbpTotal(row?.sellableValue ?? null),
    missingCost: Number(row?.missingCost ?? 0),
    products: Number(row?.products ?? 0),
    valuedPhysical: Number(row?.valuedPhysical ?? 0),
    valuedSellable: Number(row?.valuedSellable ?? 0),
  };
}

export async function getStockOverview(actorUserId: string, raw: unknown) {
  await requirePurchasingAccess(actorUserId);
  const input = querySchema.parse(raw ?? {});
  const position = input.position ?? "all";
  const lowIds = position === "low" || position === "in" ? await lowStockProductIds() : [];
  const { where, page, sort } = overviewWhere(input, lowIds);
  const [total, rows, lowPartNumbers, fba] = await Promise.all([
    prisma.autopartProduct.count({ where }),
    prisma.autopartProduct.findMany({
      where,
      include: rowInclude,
      orderBy: orderBy(sort),
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    currentFeedLowStockCount(),
    loadFbaFreshness(),
  ]);
  const [summary, valuation, importStatus, brands, warehouses, suppliers] = await Promise.all([
    positionSummary(lowPartNumbers),
    filteredValuation(input, lowIds),
    loadImportStatus(fba),
    brandOptions(),
    warehouseOptions(),
    supplierOptions(),
  ]);
  return {
    summary,
    valuation: {
      ...valuation,
      definition: STOCK_VALUE_HELP,
      scope:
        "Totals cover every part number matching the current filters, not only this page. Products without a unit cost are excluded from the money totals.",
    },
    importStatus,
    brands,
    warehouses,
    suppliers,
    total,
    page,
    pageSize: PAGE_SIZE,
    items: rows.map(presentRow),
  };
}

function csvCell(value: string | number | null | undefined): string {
  const raw = value == null ? "" : String(value);
  const safe = /^[=+\-@]/.test(raw) ? `'${raw}` : raw;
  return `"${safe.replaceAll('"', '""')}"`;
}

export async function exportStockOverviewCsv(actorUserId: string, raw: unknown) {
  await requirePurchasingAccess(actorUserId);
  const input = querySchema.parse(raw ?? {});
  const position = input.position ?? "all";
  const lowIds = position === "low" || position === "in" ? await lowStockProductIds() : [];
  const { where, sort } = overviewWhere(input, lowIds);
  const total = await prisma.autopartProduct.count({ where });
  const rows = await prisma.autopartProduct.findMany({
    where,
    include: rowInclude,
    orderBy: orderBy(sort),
    take: EXPORT_LIMIT,
  });
  const header = [
    "Part number",
    "Product name",
    "Brand",
    "SKU",
    "EAN",
    "Physical",
    "Unavailable",
    "Sellable",
    "Status",
    "Last update",
    "Catalogue",
    "Supplier",
    "Warehouse",
    "Incoming",
    "Warehouse Avail",
    "FBA UK",
    "Unit cost",
    "Stock value",
  ];
  const lines = rows.map((row) => {
    const item = presentRow(row);
    return [
      item.sku,
      item.productName,
      item.brandName,
      item.catalogueSku ?? item.sku,
      item.ean,
      item.physicalQty,
      item.unavailableQty,
      item.sellableQty,
      item.statusLabel,
      item.lastSeenAt,
      item.catalogueLabel,
      item.supplierLabel,
      item.warehouseName,
      item.incomingQty,
      item.availQty,
      item.fbaQty,
      item.unitCost ?? "Cost unavailable",
      item.unitCostSource === "MISSING" ? "Cost unavailable" : (item.stockValue ?? "—"),
    ]
      .map(csvCell)
      .join(",");
  });
  return {
    filename: "stock-overview.csv",
    csv: [header.map(csvCell).join(","), ...lines].join("\n"),
    total,
    truncated: total > rows.length,
    exported: rows.length,
  };
}

function decimalQty(value: { toString(): string } | number | null | undefined): number | null {
  if (value == null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export async function getStockPartDetail(actorUserId: string, raw: unknown) {
  await requirePurchasingAccess(actorUserId);
  const { sku } = detailSchema.parse(raw ?? {});
  const row = await prisma.autopartProduct.findUnique({
    where: { matchKey: skuMatchKey(sku) },
    include: {
      ...rowInclude,
      locationStocks: {
        select: { availableQty: true, locationCode: true, sourceBranch: true },
      },
    },
  });
  if (!row) return null;
  const item = presentRow(row);
  const [changes, usage] = await Promise.all([
    row.catalogueVariantId
      ? prisma.stockSyncChange.findMany({
          where: { variantId: row.catalogueVariantId },
          orderBy: { createdAt: "asc" },
          take: 120,
          select: { createdAt: true, newQty: true },
        })
      : Promise.resolve([]),
    prisma.autopartProductUsageSnapshot.findMany({
      where: { sku: row.sku },
      orderBy: { businessDate: "asc" },
      take: 120,
      select: { businessDate: true, physicalStk: true, stk: true },
    }),
  ]);
  const syncPoints = changes.map((change) => ({
    at: change.createdAt.toISOString(),
    qty: change.newQty,
  }));
  const usagePoints = usage.flatMap((snapshot) => {
    const qty = decimalQty(snapshot.physicalStk) ?? decimalQty(snapshot.stk);
    if (qty == null) return [];
    return [{ at: snapshot.businessDate.toISOString(), qty }];
  });
  const history =
    syncPoints.length > 0
      ? {
          available: true as const,
          source: "Imported quantity changes" as const,
          points: syncPoints,
        }
      : usagePoints.length > 0
        ? {
            available: true as const,
            source: "Physical stock snapshots" as const,
            points: usagePoints,
          }
        : { available: false as const, source: null, points: [] as { at: string; qty: number }[] };
  const lastSuccessfulUpdateAt =
    syncPoints.length > 0 ? syncPoints[syncPoints.length - 1]!.at : null;
  const warehouseLocations = (row.catalogueVariant?.inventory ?? []).map((entry) => ({
    name: warehouseDisplayName(entry.warehouse.code, entry.warehouse.name),
    code: entry.warehouse.code,
    qty: sellableQuantityFromAvail(entry.qtyOnHand),
    kind: "warehouse" as const,
  }));
  const otherLocations = row.locationStocks.map((location) => ({
    name: location.locationCode === UK_FBA_CODE ? FBA_STOCK_LABEL : location.locationCode,
    code: location.locationCode,
    qty: location.availableQty,
    kind: "location" as const,
  }));
  return {
    ...item,
    expectedArrivalAt: null as string | null,
    locations: [...warehouseLocations, ...otherLocations],
    history,
    lastSuccessfulUpdateAt,
    currentQty: item.availQty,
  };
}
