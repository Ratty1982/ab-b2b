/**
 * Internal stock overview. Warehouse Avail comes from the 231PO3NEW import.
 * Amazon FBA stays on AutopartLocationStock and is never added to B2B sellable stock.
 */
import { z } from "zod";
import { prisma } from "@/infra/database/client";
import { PUBLIC_STOCK_IN_THRESHOLD } from "@/domain/availability";
import { AUTOPART_PRODUCT_KIND_LABEL, classifyAutopartProduct } from "@/domain/autopart-product";
import { autopartConditionLabel } from "@/domain/autopart-product-condition";
import { FBA_LOCATION_CODE, FBA_STOCK_LABEL, WAREHOUSE_STOCK_LABEL, totalOwnedStock } from "@/domain/fba-stock";
import { internalStatusFromSellable, sellableQuantityFromAvail } from "@/domain/stock";
import { loadFbaFreshness } from "@/server/purchasing/fba-stock";
import { stockFreshness } from "@/server/stock/service";
import { requirePurchasingAccess } from "@/server/rbac/guards";

const PAGE_SIZE = 50;
const EXPORT_LIMIT = 5000;

const querySchema = z.object({
  q: z.string().max(120).optional().nullable(),
  position: z.enum(["all", "in", "low", "out", "incoming", "fba"]).optional().nullable(),
  catalogue: z.enum(["all", "catalogue", "external"]).optional().nullable(),
  feed: z.enum(["current", "historic", "all"]).optional().nullable(),
  sort: z.enum(["recent", "sku", "avail", "incoming"]).optional().nullable(),
  page: z.number().int().positive().optional().nullable(),
});

export type StockOverviewQuery = z.infer<typeof querySchema>;

function overviewWhere(input: StockOverviewQuery): {
  where: import("@prisma/client").Prisma.AutopartProductWhereInput;
  page: number;
  sort: NonNullable<StockOverviewQuery["sort"]>;
} {
  const q = input.q?.trim() ?? "";
  const position = input.position ?? "all";
  const catalogue = input.catalogue ?? "all";
  const feed = input.feed ?? "current";
  const sort = input.sort ?? "recent";
  return {
    page: input.page ?? 1,
    sort,
    where: {
      ...(feed === "historic" ? { presentInLatestFeed: false } : feed === "all" ? {} : { presentInLatestFeed: true }),
      ...(q
        ? {
            OR: [
              { sku: { contains: q, mode: "insensitive" } },
              { description: { contains: q, mode: "insensitive" } },
              { matchKey: { contains: q.toUpperCase() } },
              { groupCode: { contains: q, mode: "insensitive" } },
            ],
          }
        : {}),
      ...(catalogue === "catalogue" ? { catalogueVariantId: { not: null } } : {}),
      ...(catalogue === "external" ? { catalogueVariantId: null } : {}),
      ...(position === "in" ? { availQty: { gte: PUBLIC_STOCK_IN_THRESHOLD } } : {}),
      ...(position === "low" ? { availQty: { gte: 1, lt: PUBLIC_STOCK_IN_THRESHOLD } } : {}),
      ...(position === "out" ? { availQty: { lte: 0 } } : {}),
      ...(position === "incoming" ? { incomingQty: { gt: 0 } } : {}),
      ...(position === "fba"
        ? { locationStocks: { some: { locationCode: FBA_LOCATION_CODE, availableQty: { gt: 0 } } } }
        : {}),
    },
  };
}

function orderBy(sort: NonNullable<StockOverviewQuery["sort"]>) {
  if (sort === "sku") return [{ sku: "asc" as const }];
  if (sort === "avail") return [{ availQty: "desc" as const }, { sku: "asc" as const }];
  if (sort === "incoming") return [{ incomingQty: "desc" as const }, { sku: "asc" as const }];
  return [{ lastSeenAt: "desc" as const }, { sku: "asc" as const }];
}

const rowInclude = {
  catalogueVariant: {
    select: {
      inventory: { select: { qtyReserved: true } },
    },
  },
  locationStocks: {
    where: { locationCode: FBA_LOCATION_CODE },
    select: { availableQty: true },
  },
} as const;

type OverviewRow = {
  sku: string;
  description: string | null;
  groupCode: string | null;
  conditionCode: string | null;
  conditionLabel: string | null;
  kind: string;
  kindLabel: string;
  inCatalogue: boolean;
  presentInLatestFeed: boolean;
  availQty: number;
  incomingQty: number | null;
  physicalQty: number | null;
  reservedQty: number | null;
  sellableQty: number | null;
  fbaQty: number;
  ownedQty: number;
  stockStatus: ReturnType<typeof internalStatusFromSellable>;
  lastSeenAt: string;
};

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
  lastSeenAt: Date;
  catalogueVariant: { inventory: { qtyReserved: number }[] } | null;
  locationStocks: { availableQty: number }[];
}): OverviewRow {
  const kind = classifyAutopartProduct({
    hasCatalogueVariant: Boolean(row.catalogueVariantId),
    presentInLatestFeed: row.presentInLatestFeed,
  });
  const warehouse = sellableQuantityFromAvail(row.availQty);
  const fbaQty = row.locationStocks.reduce((sum, location) => sum + location.availableQty, 0);
  const linked = Boolean(row.catalogueVariant);
  const reservedQty = linked
    ? row.catalogueVariant!.inventory.reduce((sum, item) => sum + item.qtyReserved, 0)
    : null;
  const sellableQty = linked ? Math.max(0, warehouse - (reservedQty ?? 0)) : null;
  return {
    sku: row.sku,
    description: row.description,
    groupCode: row.groupCode,
    conditionCode: row.conditionCode,
    conditionLabel: autopartConditionLabel(row.conditionCode),
    kind,
    kindLabel: AUTOPART_PRODUCT_KIND_LABEL[kind],
    inCatalogue: kind === "CATALOGUE",
    presentInLatestFeed: row.presentInLatestFeed,
    availQty: warehouse,
    incomingQty: row.incomingQty,
    physicalQty: row.physicalQty,
    reservedQty,
    sellableQty,
    fbaQty,
    ownedQty: totalOwnedStock(warehouse, fbaQty),
    stockStatus: internalStatusFromSellable(warehouse),
    lastSeenAt: row.lastSeenAt.toISOString(),
  };
}

async function positionSummary() {
  const current = { presentInLatestFeed: true };
  const fba = { locationCode: FBA_LOCATION_CODE };
  const [feed, inStock, low, out, incoming, reserved, fbaUnits, fbaSkus, linked] = await Promise.all([
    prisma.autopartProduct.aggregate({ where: current, _count: true, _sum: { availQty: true, incomingQty: true } }),
    prisma.autopartProduct.count({ where: { ...current, availQty: { gte: PUBLIC_STOCK_IN_THRESHOLD } } }),
    prisma.autopartProduct.count({ where: { ...current, availQty: { gte: 1, lt: PUBLIC_STOCK_IN_THRESHOLD } } }),
    prisma.autopartProduct.count({ where: { ...current, availQty: { lte: 0 } } }),
    prisma.autopartProduct.count({ where: { ...current, incomingQty: { gt: 0 } } }),
    prisma.inventory.aggregate({ _sum: { qtyReserved: true } }),
    prisma.autopartLocationStock.aggregate({ where: fba, _sum: { availableQty: true } }),
    prisma.autopartLocationStock.count({ where: { ...fba, availableQty: { gt: 0 } } }),
    prisma.autopartProduct.count({ where: { ...current, catalogueVariantId: { not: null } } }),
  ]);
  return {
    feedSkus: feed._count,
    availUnits: feed._sum.availQty ?? 0,
    incomingUnits: feed._sum.incomingQty ?? 0,
    inSkus: inStock,
    lowSkus: low,
    outSkus: out,
    incomingSkus: incoming,
    reservedUnits: reserved._sum.qtyReserved ?? 0,
    fbaUnits: fbaUnits._sum.availableQty ?? 0,
    fbaSkus,
    catalogueLinked: linked,
    warehouseLabel: WAREHOUSE_STOCK_LABEL,
    fbaLabel: FBA_STOCK_LABEL,
  };
}

export async function getStockOverview(actorUserId: string, raw: unknown) {
  await requirePurchasingAccess(actorUserId);
  const input = querySchema.parse(raw ?? {});
  const { where, page, sort } = overviewWhere(input);
  const [total, rows, summary, warehouse, fba] = await Promise.all([
    prisma.autopartProduct.count({ where }),
    prisma.autopartProduct.findMany({
      where,
      include: rowInclude,
      orderBy: orderBy(sort),
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    positionSummary(),
    stockFreshness(),
    loadFbaFreshness(),
  ]);
  return {
    summary,
    total,
    page,
    pageSize: PAGE_SIZE,
    warehouse: {
      updatedAt: warehouse.lastSuccessAt?.toISOString() ?? null,
      stale: warehouse.stale,
    },
    fba: {
      updatedAt: fba.updatedAt,
      stale: fba.stale,
      fileName: fba.fileName,
      staleAfterDays: fba.staleAfterDays,
    },
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
  const { where, sort } = overviewWhere(input);
  const total = await prisma.autopartProduct.count({ where });
  const rows = await prisma.autopartProduct.findMany({
    where,
    include: rowInclude,
    orderBy: orderBy(sort),
    take: EXPORT_LIMIT,
  });
  const header = [
    "SKU",
    "Description",
    "Group",
    "Condition",
    "Catalogue",
    "Warehouse Avail",
    "Reserved",
    "B2B sellable",
    "Incoming",
    "Physical",
    "FBA",
    "Owned",
    "Last seen",
  ];
  const lines = rows.map((row) => {
    const item = presentRow(row);
    return [
      item.sku,
      item.description,
      item.groupCode,
      item.conditionLabel,
      item.inCatalogue ? "Catalogue" : "External",
      item.availQty,
      item.reservedQty,
      item.sellableQty,
      item.incomingQty,
      item.physicalQty,
      item.fbaQty,
      item.ownedQty,
      item.lastSeenAt,
    ].map(csvCell).join(",");
  });
  return {
    filename: "stock-overview.csv",
    csv: [header.map(csvCell).join(","), ...lines].join("\n"),
    total,
    truncated: total > rows.length,
    exported: rows.length,
  };
}
