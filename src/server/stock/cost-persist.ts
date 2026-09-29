/**
 * Bulk Latest Cost + usage persistence from 231PO3NEW stock sync.
 *
 * Stock (Avail) remains the operational authority and is applied separately.
 * Commercial cost diagnostics must never fail a healthy stock run.
 */
import { createHash, randomBytes } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/infra/database/client";
import { moneyToString, parseMoney } from "@/domain/money";
import { londonBusinessDate, londonCivilTime } from "@/domain/stock-schedule";
import type { StagedStockRow } from "@/domain/stock-parse-types";
import { skuMatchKey } from "@/domain/stock";

const CHUNK = 400;

export type CostPersistStats = {
  costRowsParsed: number;
  costPositionsUpdated: number;
  costPositionsCreated: number;
  costChangesDetected: number;
  costSnapshotsUpserted: number;
  usageSnapshotsUpserted: number;
  invalidCostRows: number;
  missingCostRows: number;
};

export type CostPersistInput = {
  rows: StagedStockRow[];
  /** matchKey → variantId for catalogue hits */
  variantByMatchKey: Map<string, string>;
  runId: string;
  observedAt: Date;
  dryRun: boolean;
};

function cuidLike(): string {
  return `c${randomBytes(12).toString("hex")}`;
}

function businessDateUtcMidnight(observedAt: Date): { isoDate: string; date: Date } {
  const civil = londonCivilTime(observedAt);
  const isoDate = londonBusinessDate(civil);
  // Store civil London date as UTC midnight of that YYYY-MM-DD (no timezone shift of the label).
  return { isoDate, date: new Date(`${isoDate}T00:00:00.000Z`) };
}

function costsEqual(a: string, b: string): boolean {
  const ma = parseMoney(a);
  const mb = parseMoney(b);
  if (!ma || !mb) return a === b;
  return ma.minor === mb.minor;
}

function dec(value: string | null | undefined): Prisma.Decimal | null {
  if (value == null || value === "") return null;
  return new Prisma.Decimal(value);
}

export async function persistAutopartProductCommercial(
  input: CostPersistInput,
): Promise<CostPersistStats> {
  const stats: CostPersistStats = {
    costRowsParsed: 0,
    costPositionsUpdated: 0,
    costPositionsCreated: 0,
    costChangesDetected: 0,
    costSnapshotsUpserted: 0,
    usageSnapshotsUpserted: 0,
    invalidCostRows: 0,
    missingCostRows: 0,
  };

  const { isoDate: _iso, date: businessDate } = businessDateUtcMidnight(input.observedAt);
  void _iso;

  type CostRow = {
    sku: string;
    matchKey: string;
    variantId: string | null;
    cost: string;
    usage: StagedStockRow["usage"];
  };
  const costRows: CostRow[] = [];

  for (const row of input.rows) {
    if (!row.sku) continue;
    if (!row.latestCost) {
      // Delimited CSV uploads have no cost — skip commercial path silently.
      continue;
    }
    stats.costRowsParsed += 1;
    if (!row.latestCost.ok) {
      if (row.latestCost.reason === "missing") stats.missingCostRows += 1;
      else stats.invalidCostRows += 1;
      continue;
    }
    costRows.push({
      sku: row.sku,
      matchKey: row.matchKey,
      variantId: input.variantByMatchKey.get(row.matchKey) ?? null,
      cost: row.latestCost.value,
      usage: row.usage,
    });
  }

  if (!costRows.length || input.dryRun) return stats;

  // Deduplicate by matchKey — last row wins (same as stock duplicate handling prefers last).
  const byKey = new Map<string, CostRow>();
  for (const row of costRows) byKey.set(row.matchKey, row);
  const unique = [...byKey.values()];
  const skus = unique.map((r) => r.sku);

  const existing = await prisma.autopartProductCostPosition.findMany({
    where: { sku: { in: skus } },
    select: {
      id: true,
      sku: true,
      productVariantId: true,
      latestCost: true,
      previousCost: true,
      firstObservedAt: true,
      lastChangedAt: true,
    },
  });
  const existingBySku = new Map(existing.map((e) => [skuMatchKey(e.sku), e]));

  const toCreate: Prisma.AutopartProductCostPositionCreateManyInput[] = [];
  const toUpdate: Array<{
    id: string;
    latestCost: string;
    previousCost: string | null;
    lastChangedAt: Date | null;
    productVariantId: string | null;
  }> = [];

  for (const row of unique) {
    const prev = existingBySku.get(row.matchKey);
    if (!prev) {
      toCreate.push({
        id: cuidLike(),
        sku: row.sku,
        productVariantId: row.variantId,
        latestCost: new Prisma.Decimal(row.cost),
        previousCost: null,
        firstObservedAt: input.observedAt,
        lastObservedAt: input.observedAt,
        lastChangedAt: input.observedAt,
        sourceImportedAt: input.observedAt,
        sourceSyncRunId: input.runId,
      });
      stats.costPositionsCreated += 1;
      // First observation is not a "change" — only subsequent different costs count.
      continue;
    }
    const prevCost = moneyToString(parseMoney(String(prev.latestCost))!, 4);
    const changed = !costsEqual(prevCost, row.cost);
    if (changed) stats.costChangesDetected += 1;
    toUpdate.push({
      id: prev.id,
      latestCost: row.cost,
      previousCost: changed ? prevCost : prev.previousCost != null ? moneyToString(parseMoney(String(prev.previousCost))!, 4) : null,
      lastChangedAt: changed ? input.observedAt : prev.lastChangedAt,
      productVariantId: row.variantId ?? prev.productVariantId,
    });
    stats.costPositionsUpdated += 1;
  }

  for (let i = 0; i < toCreate.length; i += CHUNK) {
    const chunk = toCreate.slice(i, i + CHUNK);
    await prisma.autopartProductCostPosition.createMany({ data: chunk, skipDuplicates: true });
  }

  for (let i = 0; i < toUpdate.length; i += CHUNK) {
    const chunk = toUpdate.slice(i, i + CHUNK);
    await prisma.$transaction(
      chunk.map((row) =>
        prisma.autopartProductCostPosition.update({
          where: { id: row.id },
          data: {
            latestCost: new Prisma.Decimal(row.latestCost),
            previousCost: row.previousCost != null ? new Prisma.Decimal(row.previousCost) : null,
            lastObservedAt: input.observedAt,
            lastChangedAt: row.lastChangedAt,
            productVariantId: row.productVariantId,
            sourceImportedAt: input.observedAt,
            sourceSyncRunId: input.runId,
          },
        }),
      ),
    );
  }

  // Daily cost snapshots — one row per SKU per London business date (latest poll wins).
  for (let i = 0; i < unique.length; i += CHUNK) {
    const chunk = unique.slice(i, i + CHUNK);
    await prisma.$transaction(
      chunk.map((row) =>
        prisma.autopartProductCostSnapshot.upsert({
          where: {
            sku_businessDate: { sku: row.sku, businessDate },
          },
          create: {
            id: cuidLike(),
            sku: row.sku,
            productVariantId: row.variantId,
            businessDate,
            latestCost: new Prisma.Decimal(row.cost),
            sourceImportedAt: input.observedAt,
            sourceSyncRunId: input.runId,
          },
          update: {
            latestCost: new Prisma.Decimal(row.cost),
            productVariantId: row.variantId,
            sourceImportedAt: input.observedAt,
            sourceSyncRunId: input.runId,
          },
        }),
      ),
    );
    stats.costSnapshotsUpserted += chunk.length;
  }

  // Usage snapshots — always upsert known Stk/Pick/Physical; Ryr/Curr/Mth when present.
  for (let i = 0; i < unique.length; i += CHUNK) {
    const chunk = unique.slice(i, i + CHUNK);
    await prisma.$transaction(
      chunk.map((row) => {
        const u = row.usage;
        const mth = u?.mth ?? [];
        return prisma.autopartProductUsageSnapshot.upsert({
          where: {
            sku_businessDate: { sku: row.sku, businessDate },
          },
          create: {
            id: cuidLike(),
            sku: row.sku,
            productVariantId: row.variantId,
            businessDate,
            stk: dec(u?.stk),
            pickQty: dec(u?.pickQty),
            physicalStk: dec(u?.physicalStk),
            ryr: dec(u?.ryr),
            curr: dec(u?.curr),
            mth1: dec(mth[0] ?? null),
            mth2: dec(mth[1] ?? null),
            mth3: dec(mth[2] ?? null),
            mth4: dec(mth[3] ?? null),
            mth5: dec(mth[4] ?? null),
            mth6: dec(mth[5] ?? null),
            mth7: dec(mth[6] ?? null),
            mth8: dec(mth[7] ?? null),
            mth9: dec(mth[8] ?? null),
            mth10: dec(mth[9] ?? null),
            mth11: dec(mth[10] ?? null),
            mth12: dec(mth[11] ?? null),
            sourceImportedAt: input.observedAt,
            sourceSyncRunId: input.runId,
          },
          update: {
            productVariantId: row.variantId,
            stk: dec(u?.stk),
            pickQty: dec(u?.pickQty),
            physicalStk: dec(u?.physicalStk),
            ryr: dec(u?.ryr),
            curr: dec(u?.curr),
            mth1: dec(mth[0] ?? null),
            mth2: dec(mth[1] ?? null),
            mth3: dec(mth[2] ?? null),
            mth4: dec(mth[3] ?? null),
            mth5: dec(mth[4] ?? null),
            mth6: dec(mth[5] ?? null),
            mth7: dec(mth[6] ?? null),
            mth8: dec(mth[7] ?? null),
            mth9: dec(mth[8] ?? null),
            mth10: dec(mth[9] ?? null),
            mth11: dec(mth[10] ?? null),
            mth12: dec(mth[11] ?? null),
            sourceImportedAt: input.observedAt,
            sourceSyncRunId: input.runId,
          },
        });
      }),
    );
    stats.usageSnapshotsUpserted += chunk.length;
  }

  return stats;
}

/** Stable fingerprint for tests — not used in production path. */
export function hashCostStats(stats: CostPersistStats): string {
  return createHash("sha256").update(JSON.stringify(stats)).digest("hex").slice(0, 12);
}
