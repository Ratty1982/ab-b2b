/**
 * Internal Autopart product master — persist from 231PO3NEW, list, link, intelligence join.
 * Does not create Product / ProductVariant / public catalogue rows.
 */
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/infra/database/client";
import { AuthError, requireAnySystemPermission, requireSystemPermission } from "@/server/rbac/guards";
import { hasPermission } from "@/server/rbac/access";
import { recordAuditEvent } from "@/server/audit/record";
import {
  AUTOPART_WAREHOUSE_CODE,
  internalStatusFromSellable,
  sellableQuantityFromAvail,
  skuMatchKey,
} from "@/domain/stock";
import {
  classifyAutopartProduct,
  formatInternalAvailLine,
  formatInternalIncomingLine,
  parsePhysicalStkCell,
  type AutopartProductKind,
  AUTOPART_PRODUCT_KIND_LABEL,
} from "@/domain/autopart-product";
import type { StagedStockRow } from "@/domain/stock-parse-types";
import { autopartConditionLabel } from "@/domain/autopart-product-condition";
import { lastNDaysRange, todayLondonDateOnly } from "@/domain/sales-history-period";
import { demandSourcesForSku, netUnitsForKeys, weeklyNetUnitsForSku } from "@/server/purchasing/demand";
import { randomBytes } from "node:crypto";

const UPSERT_CHUNK = 200;
const KEY_CHUNK = 500;

function newId(): string {
  return `ap_${randomBytes(12).toString("hex")}`;
}

export type AutopartPersistRow = {
  sku: string;
  matchKey: string;
  description: string | null;
  availQty: number;
  physicalQty: number | null;
  incoming: { kind: "set"; qty: number | null; raw: string } | { kind: "skip" } | { kind: "absent" };
  sourceAvailRaw: string;
  latestCost: string | null;
  catalogueVariantId: string | null;
  /** set writes the current code, including null when C is blank. absent leaves the previous code. */
  condition: { kind: "set"; code: string | null } | { kind: "absent" };
};

export function stagedRowToPersistRow(
  row: StagedStockRow,
  availQty: number,
  catalogueVariantId: string | null,
): AutopartPersistRow {
  const incomingField = row.incoming;
  const incoming =
    incomingField == null
      ? ({ kind: "absent" } as const)
      : incomingField.ok
        ? { kind: "set" as const, qty: incomingField.value, raw: incomingField.raw }
        : incomingField.reason === "blank"
          ? { kind: "set" as const, qty: null, raw: incomingField.raw }
          : ({ kind: "skip" } as const);
  const cost = row.latestCost?.ok ? row.latestCost.value : null;
  const physical = parsePhysicalStkCell(row.usage?.physicalStk ?? null);
  return {
    sku: row.sku,
    matchKey: row.matchKey,
    description: row.description,
    availQty,
    physicalQty: physical,
    incoming,
    sourceAvailRaw: row.availRaw,
    latestCost: cost,
    catalogueVariantId,
    condition: row.conditionAuthoritative
      ? { kind: "set", code: row.conditionCode?.trim() ? row.conditionCode.trim().toUpperCase() : null }
      : { kind: "absent" },
  };
}

export async function persistAutopartProducts(input: {
  rows: AutopartPersistRow[];
  runId: string;
  observedAt: Date;
  dryRun: boolean;
}): Promise<{ upserted: number }> {
  if (input.dryRun || !input.rows.length) return { upserted: 0 };

  await prisma.autopartProduct.updateMany({ data: { presentInLatestFeed: false } });

  const unique = new Map<string, AutopartPersistRow>();
  for (const row of input.rows) unique.set(row.matchKey, row);
  const list = [...unique.values()];
  const existing = new Map<
    string,
    { incomingQty: number | null; latestCost: Prisma.Decimal | null; physicalQty: number | null }
  >();
  for (let i = 0; i < list.length; i += KEY_CHUNK) {
    const chunk = list.slice(i, i + KEY_CHUNK);
    const rows = await prisma.autopartProduct.findMany({
      where: { matchKey: { in: chunk.map((r) => r.matchKey) } },
      select: { matchKey: true, incomingQty: true, latestCost: true, physicalQty: true },
    });
    for (const row of rows) {
      existing.set(row.matchKey, {
        incomingQty: row.incomingQty,
        latestCost: row.latestCost,
        physicalQty: row.physicalQty,
      });
    }
  }

  const now = input.observedAt;
  for (let i = 0; i < list.length; i += UPSERT_CHUNK) {
    const chunk = list.slice(i, i + UPSERT_CHUNK);
    await prisma.$transaction(
      chunk.map((row) => {
        const prev = existing.get(row.matchKey);
        const incomingQty =
          row.incoming.kind === "set"
            ? row.incoming.qty
            : row.incoming.kind === "skip"
              ? (prev?.incomingQty ?? null)
              : (prev?.incomingQty ?? null);
        const sourceIncomingRaw = row.incoming.kind === "set" ? row.incoming.raw : prev ? undefined : null;
        const latestCost =
          row.latestCost != null
            ? new Prisma.Decimal(row.latestCost)
            : (prev?.latestCost ?? null);
        const physicalQty = row.physicalQty ?? prev?.physicalQty ?? null;
        return prisma.autopartProduct.upsert({
          where: { matchKey: row.matchKey },
          create: {
            id: newId(),
            sku: row.sku,
            matchKey: row.matchKey,
            description: row.description,
            availQty: row.availQty,
            physicalQty,
            incomingQty,
            sourceAvailRaw: row.sourceAvailRaw,
            sourceIncomingRaw: row.incoming.kind === "set" ? row.incoming.raw : null,
            latestCost,
            ...(row.condition.kind === "set" ? { conditionCode: row.condition.code } : {}),
            sourceUpdatedAt: now,
            firstSeenAt: now,
            lastSeenAt: now,
            sourceSyncRunId: input.runId,
            presentInLatestFeed: true,
            catalogueVariantId: row.catalogueVariantId,
          },
          update: {
            sku: row.sku,
            ...(row.description != null ? { description: row.description } : {}),
            ...(row.condition.kind === "set" ? { conditionCode: row.condition.code } : {}),
            availQty: row.availQty,
            physicalQty,
            incomingQty,
            sourceAvailRaw: row.sourceAvailRaw,
            ...(sourceIncomingRaw !== undefined ? { sourceIncomingRaw } : {}),
            latestCost,
            sourceUpdatedAt: now,
            lastSeenAt: now,
            sourceSyncRunId: input.runId,
            presentInLatestFeed: true,
            catalogueVariantId: row.catalogueVariantId,
          },
        });
      }),
    );
  }

  const persistedSkus = [...new Set(list.map((r) => r.sku).filter(Boolean))];
  if (persistedSkus.length) {
    await prisma.stockFeedUnmatched.deleteMany({ where: { sku: { in: persistedSkus } } });
  }

  return { upserted: list.length };
}

export type IntelligenceStock = {
  matchKey: string;
  kind: AutopartProductKind;
  kindLabel: string;
  description: string | null;
  availQty: number | null;
  incomingQty: number | null;
  physicalQty: number | null;
  stale: boolean;
  availLine: string;
  incomingLine: string;
  catalogueVariantId: string | null;
  inCatalogue: boolean;
  historicOnly: boolean;
  /** Current 231PO3NEW condition. Null when the product has no condition. */
  conditionCode: string | null;
  conditionLabel: string | null;
};

export async function loadIntelligenceByMatchKeys(
  keys: string[],
  now = new Date(),
): Promise<Map<string, IntelligenceStock>> {
  const out = new Map<string, IntelligenceStock>();
  if (!keys.length) return out;
  const { stockFreshness } = await import("@/server/stock/service");
  const freshness = await stockFreshness(now);
  const uniqueKeys = [...new Set(keys.map((k) => k.trim().toUpperCase()).filter(Boolean))];
  const products = new Map<
    string,
    {
      description: string | null;
      availQty: number;
      incomingQty: number | null;
      physicalQty: number | null;
      presentInLatestFeed: boolean;
      catalogueVariantId: string | null;
      conditionCode: string | null;
    }
  >();
  for (let i = 0; i < uniqueKeys.length; i += KEY_CHUNK) {
    const chunk = uniqueKeys.slice(i, i + KEY_CHUNK);
    const rows = await prisma.autopartProduct.findMany({
      where: { matchKey: { in: chunk } },
      select: {
        matchKey: true,
        description: true,
        availQty: true,
        incomingQty: true,
        physicalQty: true,
        presentInLatestFeed: true,
        catalogueVariantId: true,
        conditionCode: true,
      },
    });
    for (const row of rows) products.set(row.matchKey, row);
  }

  const variantIds = [...products.values()].map((p) => p.catalogueVariantId).filter(Boolean) as string[];
  const invByVariant = new Map<string, { qtyOnHand: number; incomingQty: number | null }>();
  if (variantIds.length) {
    const warehouse = await prisma.warehouse.findUnique({ where: { code: AUTOPART_WAREHOUSE_CODE } });
    if (warehouse) {
      const inv = await prisma.inventory.findMany({
        where: { warehouseId: warehouse.id, variantId: { in: variantIds } },
        select: { variantId: true, qtyOnHand: true, incomingQty: true },
      });
      for (const row of inv) invByVariant.set(row.variantId, row);
    }
  }

  const missingKeys = uniqueKeys.filter((k) => !products.has(k));
  const variantByKey = new Map<string, string>();
  if (missingKeys.length) {
    for (let i = 0; i < missingKeys.length; i += KEY_CHUNK) {
      const chunk = missingKeys.slice(i, i + KEY_CHUNK);
      const variants = await prisma.productVariant.findMany({
        where: { OR: chunk.map((sku) => ({ sku: { equals: sku, mode: "insensitive" as const } })) },
        select: { id: true, sku: true },
      });
      for (const v of variants) variantByKey.set(skuMatchKey(v.sku), v.id);
    }
  }

  for (const key of uniqueKeys) {
    const product = products.get(key);
    const variantId = product?.catalogueVariantId ?? variantByKey.get(key) ?? null;
    const kind = classifyAutopartProduct({
      hasCatalogueVariant: Boolean(variantId),
      presentInLatestFeed: Boolean(product?.presentInLatestFeed),
    });
    const inv = variantId ? invByVariant.get(variantId) : undefined;
    const availQty =
      kind === "HISTORIC_ONLY"
        ? null
        : inv
          ? inv.qtyOnHand
          : product
            ? product.availQty
            : null;
    const incomingQty =
      kind === "HISTORIC_ONLY"
        ? null
        : inv
          ? (inv.incomingQty ?? 0)
          : product
            ? product.incomingQty
            : null;
    const stale = kind !== "HISTORIC_ONLY" && freshness.stale;
    out.set(key, {
      matchKey: key,
      kind,
      kindLabel: AUTOPART_PRODUCT_KIND_LABEL[kind],
      description: product?.description ?? null,
      availQty,
      incomingQty,
      physicalQty: product?.physicalQty ?? null,
      stale,
      availLine: formatInternalAvailLine({ kind, availQty, stale }),
      incomingLine: formatInternalIncomingLine({ kind, incomingQty, stale }),
      catalogueVariantId: variantId,
      inCatalogue: kind === "CATALOGUE",
      historicOnly: kind === "HISTORIC_ONLY",
      conditionCode: product?.conditionCode ?? null,
      conditionLabel: autopartConditionLabel(product?.conditionCode ?? null),
    });
  }
  return out;
}

async function requireInternalIntelligenceView(actorUserId: string) {
  const profile = await requireAnySystemPermission(actorUserId, [
    "inventory.view",
    "products.view",
    "purchasing.view",
    "sales_intelligence.view",
    "admin.access",
  ]);
  if (profile.actorType === "TRADE") {
    throw new AuthError("Trade users cannot inspect internal Autopart products", "FORBIDDEN", 403);
  }
  return profile;
}

const listInput = z.object({
  q: z.string().optional().nullable(),
  productType: z.enum(["all", "catalogue", "external"]).optional().nullable(),
  stockStatus: z.enum(["all", "in", "low", "out", "incoming"]).optional().nullable(),
  page: z.number().int().positive().optional().nullable(),
  pageSize: z.number().int().positive().max(100).optional().nullable(),
});

export async function listAutopartProducts(actorUserId: string, raw: unknown) {
  const profile = await requireInternalIntelligenceView(actorUserId);
  const canSeeCost =
    hasPermission(profile, "products.cost.view") || hasPermission(profile, "purchasing.view");
  const input = listInput.parse(raw ?? {});
  const page = input.page ?? 1;
  const pageSize = input.pageSize ?? 50;
  const q = input.q?.trim() ?? "";
  const type = input.productType ?? "all";
  const stock = input.stockStatus ?? "all";

  const where: Prisma.AutopartProductWhereInput = {
    ...(q
      ? {
          OR: [
            { sku: { contains: q, mode: "insensitive" } },
            { description: { contains: q, mode: "insensitive" } },
            { matchKey: { contains: q.toUpperCase() } },
          ],
        }
      : {}),
    ...(type === "catalogue" ? { catalogueVariantId: { not: null } } : {}),
    ...(type === "external" ? { catalogueVariantId: null, presentInLatestFeed: true } : {}),
    ...(stock === "in" ? { availQty: { gte: 21 } } : {}),
    ...(stock === "low" ? { availQty: { gte: 1, lte: 20 } } : {}),
    ...(stock === "out" ? { availQty: 0, presentInLatestFeed: true } : {}),
    ...(stock === "incoming" ? { incomingQty: { gt: 0 } } : {}),
  };

  const [total, rows] = await prisma.$transaction([
    prisma.autopartProduct.count({ where }),
    prisma.autopartProduct.findMany({
      where,
      orderBy: [{ lastSeenAt: "desc" }, { sku: "asc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);

  const { stockFreshness } = await import("@/server/stock/service");
  const freshness = await stockFreshness();
  const today = todayLondonDateOnly();
  const keys = rows.map((row) => row.matchKey);
  const [u30, u90, u365] = await Promise.all([
    netUnitsForKeys(keys, lastNDaysRange(today, 30)),
    netUnitsForKeys(keys, lastNDaysRange(today, 90)),
    netUnitsForKeys(keys, lastNDaysRange(today, 365)),
  ]);
  return {
    total,
    page,
    pageSize,
    stockStale: freshness.stale,
    items: rows.map((row) => {
      const kind = classifyAutopartProduct({
        hasCatalogueVariant: Boolean(row.catalogueVariantId),
        presentInLatestFeed: row.presentInLatestFeed,
      });
      const stale = kind !== "HISTORIC_ONLY" && freshness.stale;
      const match = row.matchKey;
      return {
        sku: row.sku,
        matchKey: row.matchKey,
        description: row.description,
        kind,
        kindLabel: AUTOPART_PRODUCT_KIND_LABEL[kind],
        availQty: row.availQty,
        physicalQty: row.physicalQty,
        incomingQty: row.incomingQty,
        latestCost: canSeeCost && row.latestCost ? String(row.latestCost) : null,
        lastSeenAt: row.lastSeenAt.toISOString(),
        sourceUpdatedAt: row.sourceUpdatedAt?.toISOString() ?? null,
        presentInLatestFeed: row.presentInLatestFeed,
        inCatalogue: kind === "CATALOGUE",
        stockStatus: internalStatusFromSellable(sellableQuantityFromAvail(row.availQty)),
        stale,
        availLine: formatInternalAvailLine({ kind, availQty: row.availQty, stale }),
        incomingLine: formatInternalIncomingLine({ kind, incomingQty: row.incomingQty, stale }),
        sales30: u30.get(match) ?? 0,
        sales90: u90.get(match) ?? 0,
        sales365: u365.get(match) ?? 0,
        conditionCode: row.conditionCode,
        conditionLabel: autopartConditionLabel(row.conditionCode),
      };
    }),
  };
}

export async function getAutopartProduct(actorUserId: string, sku: string) {
  const profile = await requireInternalIntelligenceView(actorUserId);
  const key = skuMatchKey(sku);
  const row = await prisma.autopartProduct.findUnique({
    where: { matchKey: key },
    include: { purchasingSettings: true, purchasingPlanLine: true },
  });
  if (!row) throw new AuthError("Autopart product not found", "NOT_FOUND", 404);
  const { stockFreshness } = await import("@/server/stock/service");
  const freshness = await stockFreshness();
  const kind = classifyAutopartProduct({
    hasCatalogueVariant: Boolean(row.catalogueVariantId),
    presentInLatestFeed: row.presentInLatestFeed,
  });
  const stale = kind !== "HISTORIC_ONLY" && freshness.stale;
  const canSeeCost = hasPermission(profile, "products.cost.view") || hasPermission(profile, "purchasing.view");
  const today = todayLondonDateOnly();
  const range90 = lastNDaysRange(today, 90);
  const [u30, u90, u365, topCustomers, weekly] = await Promise.all([
    netUnitsForKeys([key], lastNDaysRange(today, 30)),
    netUnitsForKeys([key], range90),
    netUnitsForKeys([key], lastNDaysRange(today, 365)),
    demandSourcesForSku(row.sku, lastNDaysRange(today, 365)),
    weeklyNetUnitsForSku(row.sku, range90.from, range90.to),
  ]);
  let forecast: {
    suggestedQty: number;
    forecastConfidence: string;
    forecastConfidenceLabel: string;
    recommendedWeekly: number | null;
  } | null = null;
  if (hasPermission(profile, "purchasing.view") && kind !== "HISTORIC_ONLY") {
    try {
      const purchasing = await import("@/server/purchasing/service");
      const skuForecast = await purchasing.getPurchasingSku(actorUserId, row.sku);
      forecast = {
        suggestedQty: skuForecast.forecast.purchase.suggestedQty,
        forecastConfidence: skuForecast.forecast.forecastConfidence,
        forecastConfidenceLabel: skuForecast.forecast.forecastConfidenceLabel,
        recommendedWeekly: skuForecast.forecast.recommendedWeekly,
      };
    } catch {
      forecast = null;
    }
  }
  return {
    sku: row.sku,
    description: row.description,
    kind,
    kindLabel: AUTOPART_PRODUCT_KIND_LABEL[kind],
    availQty: row.availQty,
    physicalQty: row.physicalQty,
    incomingQty: row.incomingQty,
    latestCost: canSeeCost && row.latestCost ? String(row.latestCost) : null,
    lastSeenAt: row.lastSeenAt.toISOString(),
    sourceUpdatedAt: row.sourceUpdatedAt?.toISOString() ?? null,
    presentInLatestFeed: row.presentInLatestFeed,
    catalogueVariantId: row.catalogueVariantId,
    conditionCode: row.conditionCode,
    conditionLabel: autopartConditionLabel(row.conditionCode),
    stale,
    availLine: formatInternalAvailLine({ kind, availQty: row.availQty, stale }),
    incomingLine: formatInternalIncomingLine({ kind, incomingQty: row.incomingQty, stale }),
    canLink: hasPermission(profile, "products.edit"),
    sales: {
      last30: u30.get(key) ?? 0,
      last90: u90.get(key) ?? 0,
      last365: u365.get(key) ?? 0,
      weeklyDemand: forecast?.recommendedWeekly ?? null,
      topCustomers,
      weekly,
    },
    purchasing: {
      supplierName: row.purchasingSettings?.supplierName ?? null,
      supplierSku: row.purchasingSettings?.supplierSku ?? null,
      leadTimeDays: row.purchasingSettings?.leadTimeDays ?? null,
      minimumOrderQty: row.purchasingSettings?.minimumOrderQty ?? null,
      orderMultiple: row.purchasingSettings?.orderMultiple ?? null,
      safetyStockQty: row.purchasingSettings?.safetyStockQty ?? null,
      targetCoverWeeks: row.purchasingSettings?.targetCoverWeeks
        ? Number(row.purchasingSettings.targetCoverWeeks)
        : null,
      plannedQty: row.purchasingPlanLine?.plannedQty ?? null,
      note: row.purchasingPlanLine?.note ?? null,
      suggestedQty: forecast?.suggestedQty ?? null,
      forecastConfidence: forecast?.forecastConfidence ?? null,
      forecastConfidenceLabel: forecast?.forecastConfidenceLabel ?? null,
    },
  };
}

export async function linkAutopartProductToVariant(
  actorUserId: string,
  raw: { sku: string; variantSku: string },
) {
  const profile = await requireSystemPermission(actorUserId, "products.edit");
  if (profile.actorType === "TRADE") {
    throw new AuthError("Trade users cannot link Autopart products", "FORBIDDEN", 403);
  }
  const product = await prisma.autopartProduct.findUnique({
    where: { matchKey: skuMatchKey(raw.sku) },
  });
  if (!product) throw new AuthError("Autopart product not found", "NOT_FOUND", 404);
  const variants = await prisma.productVariant.findMany({
    where: { sku: { equals: raw.variantSku.trim(), mode: "insensitive" } },
    select: { id: true, sku: true },
  });
  if (variants.length === 0) throw new AuthError("Catalogue SKU not found", "NOT_FOUND", 404);
  if (variants.length > 1) {
    throw new AuthError("Ambiguous catalogue SKU — will not link", "CONFLICT", 409);
  }
  const variant = variants[0]!;
  const taken = await prisma.autopartProduct.findFirst({
    where: { catalogueVariantId: variant.id, NOT: { id: product.id } },
  });
  if (taken) {
    throw new AuthError("That catalogue variant is already linked to another Autopart product", "CONFLICT", 409);
  }
  const updated = await prisma.autopartProduct.update({
    where: { id: product.id },
    data: { catalogueVariantId: variant.id },
  });
  await recordAuditEvent({
    action: "stock.autopart_product.linked",
    entityType: "AutopartProduct",
    entityId: updated.id,
    actorUserId,
    metadata: { sku: updated.sku, variantId: variant.id, variantSku: variant.sku },
  });
  return getAutopartProduct(actorUserId, updated.sku);
}
