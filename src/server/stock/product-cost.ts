/**
 * Internal Autopart product cost intelligence queries.
 * NEVER expose these DTOs on trade portal / public catalogue serializers.
 */
import { prisma } from "@/infra/database/client";
import { AuthError, requireAnySystemPermission } from "@/server/rbac/guards";
import { moneyToString, parseMoney, type Money } from "@/domain/money";

export type ProductCostChange = {
  absolute: string;
  percent: string | null;
  direction: "up" | "down" | "flat";
};

export type ProductCostPositionDto = {
  sku: string;
  productVariantId: string | null;
  latestCost: string;
  previousCost: string | null;
  change: ProductCostChange | null;
  firstObservedAt: string;
  lastObservedAt: string;
  lastChangedAt: string | null;
  sourceImportedAt: string;
  sourceSyncRunId: string | null;
};

export type ProductCostHistoryPoint = {
  businessDate: string;
  latestCost: string;
  changeFromPrevious: string | null;
};

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

function moneyFromDecimal(value: unknown): Money {
  const m = parseMoney(String(value));
  if (!m) throw new Error(`Invalid stored cost: ${String(value)}`);
  return m;
}

function formatCost(value: unknown): string {
  return moneyToString(moneyFromDecimal(value), 4);
}

function computeChange(current: Money, previous: Money | null): ProductCostChange | null {
  if (!previous) return null;
  const delta = current.minor - previous.minor;
  const direction: ProductCostChange["direction"] =
    delta > 0n ? "up" : delta < 0n ? "down" : "flat";
  const abs = delta < 0n ? -delta : delta;
  const absolute = moneyToString({ minor: delta }, 4);
  let percent: string | null = null;
  if (previous.minor !== 0n) {
    // percent to 2dp using integer math: (delta * 10000 / previous) / 100
    const bps = (delta * 10000n) / previous.minor;
    const sign = bps < 0n ? "-" : bps > 0n ? "+" : "";
    const absBps = bps < 0n ? -bps : bps;
    const whole = absBps / 100n;
    const frac = (absBps % 100n).toString().padStart(2, "0");
    percent = `${sign}${whole.toString()}.${frac}`;
  }
  void abs;
  return { absolute, percent, direction };
}

function toPositionDto(row: {
  sku: string;
  productVariantId: string | null;
  latestCost: unknown;
  previousCost: unknown;
  firstObservedAt: Date;
  lastObservedAt: Date;
  lastChangedAt: Date | null;
  sourceImportedAt: Date;
  sourceSyncRunId: string | null;
}): ProductCostPositionDto {
  const latest = moneyFromDecimal(row.latestCost);
  const previous = row.previousCost != null ? moneyFromDecimal(row.previousCost) : null;
  return {
    sku: row.sku,
    productVariantId: row.productVariantId,
    latestCost: moneyToString(latest, 4),
    previousCost: previous ? moneyToString(previous, 4) : null,
    change: computeChange(latest, previous),
    firstObservedAt: row.firstObservedAt.toISOString(),
    lastObservedAt: row.lastObservedAt.toISOString(),
    lastChangedAt: row.lastChangedAt?.toISOString() ?? null,
    sourceImportedAt: row.sourceImportedAt.toISOString(),
    sourceSyncRunId: row.sourceSyncRunId,
  };
}

export async function getProductCostPositionByVariantId(
  actorUserId: string,
  variantId: string,
): Promise<ProductCostPositionDto | null> {
  await requireCostView(actorUserId);
  const row = await prisma.autopartProductCostPosition.findFirst({
    where: { productVariantId: variantId },
  });
  if (!row) {
    const variant = await prisma.productVariant.findUnique({
      where: { id: variantId },
      select: { sku: true },
    });
    if (!variant) return null;
    const bySku = await prisma.autopartProductCostPosition.findUnique({
      where: { sku: variant.sku },
    });
    return bySku ? toPositionDto(bySku) : null;
  }
  return toPositionDto(row);
}

export async function getProductCostPositionBySku(
  actorUserId: string,
  sku: string,
): Promise<ProductCostPositionDto | null> {
  await requireCostView(actorUserId);
  const row = await prisma.autopartProductCostPosition.findUnique({ where: { sku } });
  return row ? toPositionDto(row) : null;
}

export type CostHistoryRange = "30d" | "90d" | "12m" | "all";

function rangeStart(range: CostHistoryRange, now: Date): Date | null {
  if (range === "all") return null;
  const d = new Date(now);
  if (range === "30d") d.setUTCDate(d.getUTCDate() - 30);
  else if (range === "90d") d.setUTCDate(d.getUTCDate() - 90);
  else d.setUTCFullYear(d.getUTCFullYear() - 1);
  return d;
}

export async function getProductCostHistoryByVariantId(
  actorUserId: string,
  variantId: string,
  range: CostHistoryRange = "90d",
): Promise<{ points: ProductCostHistoryPoint[]; emptyReason: string | null }> {
  await requireCostView(actorUserId);
  const variant = await prisma.productVariant.findUnique({
    where: { id: variantId },
    select: { id: true, sku: true },
  });
  if (!variant) return { points: [], emptyReason: "Product variant not found" };

  const since = rangeStart(range, new Date());
  const rows = await prisma.autopartProductCostSnapshot.findMany({
    where: {
      OR: [{ productVariantId: variant.id }, { sku: variant.sku }],
      ...(since ? { businessDate: { gte: since } } : {}),
    },
    orderBy: { businessDate: "asc" },
    select: { businessDate: true, latestCost: true, sku: true },
  });

  // Deduplicate if both sku and variantId matched overlapping rows.
  const byDate = new Map<string, string>();
  for (const row of rows) {
    const key = row.businessDate.toISOString().slice(0, 10);
    byDate.set(key, formatCost(row.latestCost));
  }
  const dates = [...byDate.keys()].sort();
  const points: ProductCostHistoryPoint[] = [];
  let prev: Money | null = null;
  for (const date of dates) {
    const costStr = byDate.get(date)!;
    const cost = parseMoney(costStr)!;
    let changeFromPrevious: string | null = null;
    if (prev) {
      const ch = computeChange(cost, prev);
      changeFromPrevious = ch && ch.direction !== "flat" ? ch.absolute : null;
    }
    points.push({ businessDate: date, latestCost: costStr, changeFromPrevious });
    prev = cost;
  }

  if (!points.length) {
    return { points: [], emptyReason: "No Autopart cost history yet for this product" };
  }
  return { points, emptyReason: null };
}

export async function listRecentCostChanges(
  actorUserId: string,
  opts?: { since?: Date; limit?: number },
): Promise<
  Array<{
    sku: string;
    productVariantId: string | null;
    latestCost: string;
    previousCost: string | null;
    change: ProductCostChange | null;
    lastChangedAt: string;
  }>
> {
  await requireCostView(actorUserId);
  const limit = Math.min(Math.max(opts?.limit ?? 50, 1), 200);
  const rows = await prisma.autopartProductCostPosition.findMany({
    where: {
      lastChangedAt: { not: null, ...(opts?.since ? { gte: opts.since } : {}) },
    },
    orderBy: { lastChangedAt: "desc" },
    take: limit,
  });
  return rows.map((row) => {
    const dto = toPositionDto(row);
    return {
      sku: dto.sku,
      productVariantId: dto.productVariantId,
      latestCost: dto.latestCost,
      previousCost: dto.previousCost,
      change: dto.change,
      lastChangedAt: dto.lastChangedAt!,
    };
  });
}
