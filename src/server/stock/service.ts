import type { StockIssueKind, StockStatus, StockSyncStatus } from "@prisma/client";
import { prisma } from "@/infra/database/client";
import { recordAuditEvent } from "@/server/audit/record";
import { AuthError, requireAnySystemPermission } from "@/server/rbac/guards";
import { hasPermission } from "@/server/rbac/access";
import {
  AUTOPART_FEED_SOURCE,
  AUTOPART_WAREHOUSE_CODE,
  AUTOPART_WAREHOUSE_NAME,
  customerAvailabilityForStock,
  internalStatusFromSellable,
  isStockStale,
  sellableQuantityFromAvail,
  skuMatchKey,
  type VariantStock,
} from "@/domain/stock";
import { classifyStockRows, parseAutopart231Po3New } from "@/domain/stock-parse";
import { evaluateScheduledStockWindow, scheduledWindowKey } from "@/domain/stock-schedule";
import { autopartConfigured, loadAutopartStockConfig, publicAutopartStatus } from "@/server/stock/config";
import { fetchAutopartFeed } from "@/server/stock/fetch";
import { releaseStockSyncLock, tryAcquireStockSyncLock } from "@/server/stock/lock";
import type { PublicAvailability } from "@/domain/availability";
import { randomUUID, timingSafeEqual } from "node:crypto";

const ISSUE_CAP = 400;
const UPSERT_CHUNK = 200;

export async function ensureAutopartWarehouse() {
  return prisma.warehouse.upsert({
    where: { code: AUTOPART_WAREHOUSE_CODE },
    create: { code: AUTOPART_WAREHOUSE_CODE, name: AUTOPART_WAREHOUSE_NAME, isDefault: true },
    update: { name: AUTOPART_WAREHOUSE_NAME },
  });
}

async function requireInternalStockView(actorUserId: string) {
  const profile = await requireAnySystemPermission(actorUserId, ["inventory.view", "products.view", "admin.access"]);
  if (profile.actorType === "TRADE") {
    throw new AuthError("Trade users cannot inspect internal stock administration", "FORBIDDEN", 403);
  }
  return profile;
}

async function requireStockSync(actorUserId: string) {
  const profile = await requireAnySystemPermission(actorUserId, ["products.import", "products.edit", "admin.access"]);
  if (profile.actorType === "TRADE") {
    throw new AuthError("Trade users cannot run Autopart stock sync", "FORBIDDEN", 403);
  }
  return profile;
}

export async function lastSuccessfulStockSyncAt(): Promise<Date | null> {
  const row = await prisma.stockSyncRun.findFirst({
    where: { status: { in: ["SUCCESS", "PARTIAL"] }, mode: "live" },
    orderBy: { completedAt: "desc" },
    select: { completedAt: true },
  });
  return row?.completedAt ?? null;
}

export async function stockFreshness(now = new Date()) {
  const lastSuccess = await lastSuccessfulStockSyncAt();
  const staleHours = loadAutopartStockConfig().staleHours;
  return {
    lastSuccessAt: lastSuccess,
    stale: isStockStale(lastSuccess, now, staleHours),
    staleHours,
  };
}

type VariantRow = { id: string; sku: string };

function variantMap(rows: VariantRow[]) {
  const map = new Map<string, VariantRow[]>();
  for (const row of rows) {
    const key = skuMatchKey(row.sku);
    const list = map.get(key) ?? [];
    list.push(row);
    map.set(key, list);
  }
  return map;
}

export async function applyStockFeed(input: {
  text: string;
  bytes?: number;
  dryRun: boolean;
  trigger: "manual" | "schedule" | "api";
  actorUserId?: string | null;
  sourceLabel?: string;
}) {
  const lockHolder = randomUUID();
  const locked = await tryAcquireStockSyncLock(lockHolder);
  if (!locked) {
    throw new AuthError("A stock sync is already running", "CONFLICT", 409);
  }
  const started = Date.now();
  const source = input.sourceLabel ?? AUTOPART_FEED_SOURCE;
  const run = await prisma.stockSyncRun.create({
    data: {
      source,
      mode: input.dryRun ? "dry-run" : "live",
      status: "RUNNING",
      trigger: input.trigger,
      actorUserId: input.actorUserId ?? null,
    },
  });

  try {
    const parsed = parseAutopart231Po3New(input.text, input.bytes);
    if ("code" in parsed) {
      await finishRun(run.id, {
        status: "FAILED",
        errorSummary: parsed.message,
        durationMs: Date.now() - started,
      });
      if (!input.dryRun && input.trigger === "manual") {
        await recordAuditEvent({
          action: "stock.sync.failed",
          entityType: "StockSyncRun",
          entityId: run.id,
          actorUserId: input.actorUserId ?? null,
          after: { reason: parsed.message },
        });
      }
      return { runId: run.id, status: "FAILED" as const, errorSummary: parsed.message, dryRun: input.dryRun };
    }

    const classified = classifyStockRows(parsed.rows);
    const variants = await prisma.productVariant.findMany({ select: { id: true, sku: true } });
    const bySku = variantMap(variants);
    const warehouse = await ensureAutopartWarehouse();

    type ApplyRow = { variantId: string; sku: string; avail: number; raw: string };
    const toApply: ApplyRow[] = [];
    const issues: Array<{
      kind: StockIssueKind;
      sku: string | null;
      description: string | null;
      availRaw: string | null;
      message: string;
      line: number | null;
    }> = [];

    let matched = 0;
    let unmatched = 0;
    let invalid = 0;
    let duplicates = 0;

    for (const row of classified) {
      if (row.kind === "missing_sku" || row.kind === "invalid") {
        invalid += 1;
        issues.push({
          kind: "INVALID",
          sku: row.row.sku || null,
          description: row.row.description,
          availRaw: row.row.availRaw,
          message: row.message,
          line: row.row.line,
        });
        continue;
      }
      if (row.kind === "duplicate") {
        duplicates += 1;
        issues.push({
          kind: "DUPLICATE",
          sku: row.row.sku,
          description: row.row.description,
          availRaw: row.row.availRaw,
          message: row.message,
          line: row.row.line,
        });
        continue;
      }
      const hits = bySku.get(row.row.matchKey) ?? [];
      if (hits.length === 0) {
        unmatched += 1;
        issues.push({
          kind: "UNMATCHED",
          sku: row.row.sku,
          description: row.row.description,
          availRaw: row.row.availRaw,
          message: "SKU does not exist in the catalogue",
          line: row.row.line,
        });
        continue;
      }
      if (hits.length > 1) {
        invalid += 1;
        issues.push({
          kind: "CONFLICT",
          sku: row.row.sku,
          description: row.row.description,
          availRaw: row.row.availRaw,
          message: "Ambiguous SKU match — no inventory updated",
          line: row.row.line,
        });
        continue;
      }
      matched += 1;
      toApply.push({
        variantId: hits[0]!.id,
        sku: hits[0]!.sku,
        avail: row.avail,
        raw: row.row.availRaw,
      });
    }

    const existing = await prisma.inventory.findMany({
      where: { warehouseId: warehouse.id, variantId: { in: toApply.map((row) => row.variantId) } },
      select: { variantId: true, qtyOnHand: true },
    });
    const existingQty = new Map(existing.map((row) => [row.variantId, row.qtyOnHand]));
    let updated = 0;
    let unchanged = 0;
    const now = new Date();
    const writes = toApply.filter((row) => {
      const sellable = sellableQuantityFromAvail(row.avail);
      const prev = existingQty.get(row.variantId);
      if (prev === sellable) {
        unchanged += 1;
        return !input.dryRun;
      }
      updated += 1;
      return !input.dryRun;
    });

    if (!input.dryRun) {
      for (let i = 0; i < writes.length; i += UPSERT_CHUNK) {
        const chunk = writes.slice(i, i + UPSERT_CHUNK);
        await prisma.$transaction(
          chunk.map((row) => {
            const sellable = sellableQuantityFromAvail(row.avail);
            const status = internalStatusFromSellable(sellable) as StockStatus;
            return prisma.inventory.upsert({
              where: { variantId_warehouseId: { variantId: row.variantId, warehouseId: warehouse.id } },
              create: {
                variantId: row.variantId,
                warehouseId: warehouse.id,
                qtyOnHand: sellable,
                qtyReserved: 0,
                status,
                externalSyncedAt: now,
                sourceAvailRaw: String(row.avail),
              },
              update: {
                qtyOnHand: sellable,
                status,
                externalSyncedAt: now,
                sourceAvailRaw: String(row.avail),
              },
            });
          }),
        );
      }

      const unmatchedRows = issues.filter((issue) => issue.kind === "UNMATCHED" && issue.sku);
      for (const issue of unmatchedRows) {
        const sku = issue.sku!;
        await prisma.stockFeedUnmatched.upsert({
          where: { sku },
          create: {
            sku,
            description: issue.description,
            lastAvailRaw: issue.availRaw,
            lastSeenAt: now,
            lastRunId: run.id,
            occurrenceCount: 1,
            reason: issue.message,
          },
          update: {
            description: issue.description,
            lastAvailRaw: issue.availRaw,
            lastSeenAt: now,
            lastRunId: run.id,
            occurrenceCount: { increment: 1 },
            reason: issue.message,
          },
        });
      }
    }

    const problemRows = invalid + unmatched + duplicates;
    const status: StockSyncStatus =
      problemRows === 0 ? "SUCCESS" : toApply.length > 0 || input.dryRun ? "PARTIAL" : "FAILED";
    // If every data row is a problem and nothing would apply, still PARTIAL when we parsed rows (not a wipe).
    const finalStatus: StockSyncStatus = parsed.rows.length === 0 ? "FAILED" : status === "FAILED" && parsed.rows.length ? "PARTIAL" : status;

    await prisma.stockSyncIssue.createMany({
      data: issues.slice(0, ISSUE_CAP).map((issue) => ({
        runId: run.id,
        kind: issue.kind,
        sku: issue.sku,
        description: issue.description,
        availRaw: issue.availRaw,
        message: issue.message,
        line: issue.line,
      })),
    });

    await finishRun(run.id, {
      status: finalStatus,
      rowsRead: parsed.rows.length,
      matched,
      updated: input.dryRun ? 0 : updated,
      unchanged,
      unmatched,
      invalid,
      duplicates,
      durationMs: Date.now() - started,
      errorSummary: problemRows ? `${problemRows} row(s) need attention` : null,
    });

    console.info("[ab:stock-sync]", {
      runId: run.id,
      source,
      dryRun: input.dryRun,
      durationMs: Date.now() - started,
      rowsRead: parsed.rows.length,
      matched,
      updated: input.dryRun ? 0 : updated,
      unmatched,
      invalid,
      duplicates,
      status: finalStatus,
    });

    if (!input.dryRun && input.trigger === "manual") {
      await recordAuditEvent({
        action: finalStatus === "FAILED" ? "stock.sync.failed" : "stock.sync.manual",
        entityType: "StockSyncRun",
        entityId: run.id,
        actorUserId: input.actorUserId ?? null,
        after: { status: finalStatus, matched, updated, unmatched, invalid },
      });
    }

    return {
      runId: run.id,
      status: finalStatus,
      dryRun: input.dryRun,
      source,
      rowsRead: parsed.rows.length,
      matched,
      wouldUpdate: updated,
      updated: input.dryRun ? 0 : updated,
      unchanged,
      unmatched,
      invalid,
      duplicates,
      errorSummary: problemRows ? `${problemRows} row(s) need attention` : null,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Stock sync failed";
    await finishRun(run.id, { status: "FAILED", errorSummary: message, durationMs: Date.now() - started });
    console.error("[ab:stock-sync]", { runId: run.id, error: message });
    if (input.trigger === "manual") {
      await recordAuditEvent({
        action: "stock.sync.failed",
        entityType: "StockSyncRun",
        entityId: run.id,
        actorUserId: input.actorUserId ?? null,
        after: { error: message },
      });
    }
    throw error;
  } finally {
    await releaseStockSyncLock(lockHolder);
  }
}

async function finishRun(
  id: string,
  data: {
    status: StockSyncStatus;
    rowsRead?: number;
    matched?: number;
    updated?: number;
    unchanged?: number;
    unmatched?: number;
    invalid?: number;
    duplicates?: number;
    errorSummary?: string | null;
    durationMs: number;
  },
) {
  await prisma.stockSyncRun.update({
    where: { id },
    data: {
      status: data.status,
      completedAt: new Date(),
      durationMs: data.durationMs,
      ...(data.rowsRead != null ? { rowsRead: data.rowsRead } : {}),
      ...(data.matched != null ? { matched: data.matched } : {}),
      ...(data.updated != null ? { updated: data.updated } : {}),
      ...(data.unchanged != null ? { unchanged: data.unchanged } : {}),
      ...(data.unmatched != null ? { unmatched: data.unmatched } : {}),
      ...(data.invalid != null ? { invalid: data.invalid } : {}),
      ...(data.duplicates != null ? { duplicates: data.duplicates } : {}),
      ...(data.errorSummary !== undefined ? { errorSummary: data.errorSummary } : {}),
    },
  });
}

export async function runConfiguredStockSync(input: {
  dryRun: boolean;
  trigger: "manual" | "schedule" | "api";
  actorUserId?: string | null;
}) {
  const config = loadAutopartStockConfig();
  const { loadImapRuntimeConfig } = await import("@/server/stock/settings");
  const imap = await loadImapRuntimeConfig();
  const useEmail = config.source === "email" || (config.source !== "ftp" && config.source !== "http" && config.source !== "file" && Boolean(imap));
  if (useEmail) {
    const { importFromImap } = await import("@/server/stock/poll");
    return importFromImap({
      dryRun: input.dryRun,
      trigger: input.trigger,
      ...(input.actorUserId !== undefined ? { actorUserId: input.actorUserId } : {}),
    });
  }
  const feed = await fetchAutopartFeed();
  return applyStockFeed({
    text: feed.text,
    bytes: feed.bytes,
    dryRun: input.dryRun,
    trigger: input.trigger,
    ...(input.actorUserId !== undefined ? { actorUserId: input.actorUserId } : {}),
    sourceLabel: `${AUTOPART_FEED_SOURCE}:${feed.sourceLabel}`,
  });
}

export async function runCronStockSync(secret: string | null, dryRun = false, now = new Date()) {
  const expected = process.env["AUTOPART_STOCK_CRON_SECRET"]?.trim();
  if (!expected) {
    throw new AuthError("AUTOPART_STOCK_CRON_SECRET is not configured", "CONFIG", 503);
  }
  if (!secret || !timingSafeEqualString(secret, expected)) {
    throw new AuthError("Unauthorised", "UNAUTHENTICATED", 401);
  }
  return runScheduledStockSync({ dryRun, trigger: "api", now });
}

export async function runScheduledStockSync(input: {
  dryRun: boolean;
  trigger?: "schedule" | "api";
  now?: Date;
}) {
  const now = input.now ?? new Date();
  const window = evaluateScheduledStockWindow(now);
  if (!window.active) {
    return {
      skipped: true as const,
      status: "SKIPPED" as const,
      dryRun: input.dryRun,
      runId: null as string | null,
      rowsRead: 0,
      matched: 0,
      wouldUpdate: 0,
      updated: 0,
      unchanged: 0,
      unmatched: 0,
      invalid: 0,
      duplicates: 0,
      errorSummary: window.reason,
      windowKey: null as string | null,
    };
  }
  if (!input.dryRun && (await scheduledWindowAlreadyImported(window.key, now))) {
    return {
      skipped: true as const,
      status: "SKIPPED" as const,
      dryRun: false,
      runId: null as string | null,
      rowsRead: 0,
      matched: 0,
      wouldUpdate: 0,
      updated: 0,
      unchanged: 0,
      unmatched: 0,
      invalid: 0,
      duplicates: 0,
      errorSummary: `Already imported ${window.key} Europe/London`,
      windowKey: window.key,
    };
  }
  const result = await runConfiguredStockSync({
    dryRun: input.dryRun,
    trigger: input.trigger ?? "api",
  });
  return { skipped: false as const, windowKey: window.key, ...result };
}

async function scheduledWindowAlreadyImported(key: string, now: Date): Promise<boolean> {
  const recent = await prisma.stockSyncRun.findMany({
    where: {
      trigger: { in: ["api", "schedule"] },
      mode: "live",
      status: { in: ["SUCCESS", "PARTIAL", "RUNNING"] },
      startedAt: { gte: new Date(now.getTime() - 4 * 60 * 60 * 1000) },
    },
    select: { startedAt: true },
    take: 20,
  });
  return recent.some((row) => scheduledWindowKey(row.startedAt) === key);
}

function timingSafeEqualString(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export async function runManualStockSync(actorUserId: string, input: { dryRun: boolean; csv?: string }) {
  await requireStockSync(actorUserId);
  if (input.csv && input.csv.trim()) {
    return applyStockFeed({
      text: input.csv,
      bytes: Buffer.byteLength(input.csv),
      dryRun: input.dryRun,
      trigger: "manual",
      actorUserId,
      sourceLabel: `${AUTOPART_FEED_SOURCE}:upload`,
    });
  }
  return runConfiguredStockSync({ dryRun: input.dryRun, trigger: "manual", actorUserId });
}

export async function listStockSyncRuns(actorUserId: string) {
  await requireInternalStockView(actorUserId);
  const rows = await prisma.stockSyncRun.findMany({
    orderBy: { startedAt: "desc" },
    take: 40,
  });
  return rows.map(serializeRun);
}

export async function getStockSyncRun(actorUserId: string, id: string) {
  await requireInternalStockView(actorUserId);
  const row = await prisma.stockSyncRun.findUnique({ where: { id } });
  if (!row) throw new AuthError("Sync run not found", "NOT_FOUND", 404);
  const issues = await prisma.stockSyncIssue.findMany({
    where: { runId: id },
    orderBy: { createdAt: "asc" },
    take: ISSUE_CAP,
  });
  return { ...serializeRun(row), issues };
}

export async function listUnmatchedStockSkus(actorUserId: string) {
  await requireInternalStockView(actorUserId);
  const rows = await prisma.stockFeedUnmatched.findMany({ orderBy: { lastSeenAt: "desc" }, take: 500 });
  return rows.map((row) => ({
    sku: row.sku,
    description: row.description,
    avail: row.lastAvailRaw,
    reason: row.reason,
    lastSeenAt: row.lastSeenAt.toISOString(),
    lastRunId: row.lastRunId,
    occurrenceCount: row.occurrenceCount,
  }));
}

export async function stockOperationsOverview(actorUserId: string) {
  await requireInternalStockView(actorUserId);
  const [lastAttempt, lastSuccess, running] = await Promise.all([
    prisma.stockSyncRun.findFirst({ orderBy: { startedAt: "desc" } }),
    prisma.stockSyncRun.findFirst({
      where: { status: { in: ["SUCCESS", "PARTIAL"] }, mode: "live" },
      orderBy: { completedAt: "desc" },
    }),
    prisma.stockSyncRun.findFirst({ where: { status: "RUNNING" } }),
  ]);
  const freshness = await stockFreshness();
  const { toPublicImapSettings } = await import("@/server/stock/settings");
  const imap = await toPublicImapSettings();
  const base = publicAutopartStatus();
  return {
    config: {
      ...base,
      configured: imap.configured || base.configured,
      sourceType: imap.configured || loadAutopartStockConfig().source === "email" ? "email" : base.sourceType,
    },
    imap,
    freshness: {
      stale: freshness.stale,
      lastSuccessAt: freshness.lastSuccessAt?.toISOString() ?? null,
      staleHours: freshness.staleHours,
    },
    lastAttempt: lastAttempt ? serializeRun(lastAttempt) : null,
    lastSuccess: lastSuccess ? serializeRun(lastSuccess) : null,
    running: Boolean(running),
  };
}

function serializeRun(row: {
  id: string;
  source: string;
  mode: string;
  status: StockSyncStatus;
  trigger: string;
  startedAt: Date;
  completedAt: Date | null;
  rowsRead: number;
  matched: number;
  updated: number;
  unchanged: number;
  unmatched: number;
  invalid: number;
  duplicates: number;
  errorSummary: string | null;
  durationMs: number | null;
}) {
  return {
    id: row.id,
    source: row.source,
    mode: row.mode,
    status: row.status,
    trigger: row.trigger,
    startedAt: row.startedAt.toISOString(),
    completedAt: row.completedAt?.toISOString() ?? null,
    rowsRead: row.rowsRead,
    matched: row.matched,
    updated: row.updated,
    unchanged: row.unchanged,
    unmatched: row.unmatched,
    invalid: row.invalid,
    duplicates: row.duplicates,
    errorSummary: row.errorSummary,
    durationMs: row.durationMs,
  };
}

export async function loadStockByVariantIds(variantIds: string[], now = new Date()): Promise<Map<string, VariantStock>> {
  const out = new Map<string, VariantStock>();
  if (!variantIds.length) return out;
  const warehouse = await prisma.warehouse.findUnique({ where: { code: AUTOPART_WAREHOUSE_CODE } });
  const freshness = await stockFreshness(now);
  const rows = warehouse
    ? await prisma.inventory.findMany({
        where: { warehouseId: warehouse.id, variantId: { in: variantIds } },
        include: { variant: { select: { sku: true } } },
      })
    : [];
  for (const row of rows) {
    const sellable = Math.max(0, row.qtyOnHand - row.qtyReserved);
    out.set(row.variantId, {
      variantId: row.variantId,
      sku: row.variant.sku,
      sellableQty: sellable,
      reservedQty: row.qtyReserved,
      availability: customerAvailabilityForStock({ sellableQty: sellable, stale: freshness.stale }),
      stale: freshness.stale,
      syncedAt: row.externalSyncedAt?.toISOString() ?? null,
      source: AUTOPART_FEED_SOURCE,
      sourceAvailRaw: row.sourceAvailRaw,
    });
  }
  return out;
}

export async function getVariantStock(variantId: string, now = new Date()): Promise<VariantStock | null> {
  const map = await loadStockByVariantIds([variantId], now);
  return map.get(variantId) ?? null;
}

export async function getVariantAvailability(variantId: string, now = new Date()): Promise<PublicAvailability | null> {
  const stock = await getVariantStock(variantId, now);
  return stock?.availability ?? null;
}

export function publicAvailabilityFromInventoryRows(
  rows: Array<{ qtyOnHand: number; qtyReserved?: number }>,
  stale: boolean,
): PublicAvailability | null {
  if (!rows.length) return null;
  const sellable = rows.reduce((sum, row) => sum + Math.max(0, row.qtyOnHand - (row.qtyReserved ?? 0)), 0);
  return customerAvailabilityForStock({ sellableQty: sellable, stale });
}

export async function getInternalVariantStock(actorUserId: string, variantId: string) {
  const profile = await requireInternalStockView(actorUserId);
  const stock = await getVariantStock(variantId);
  const canSeeQty = hasPermission(profile, "inventory.view") || hasPermission(profile, "admin.access");
  return {
    availability: stock?.availability ?? null,
    sellableQty: canSeeQty ? stock?.sellableQty ?? null : null,
    stale: stock?.stale ?? false,
    syncedAt: stock?.syncedAt ?? null,
    source: stock ? AUTOPART_FEED_SOURCE : null,
    sourceAvailRaw: canSeeQty ? stock?.sourceAvailRaw ?? null : null,
  };
}

export { autopartConfigured, publicAutopartStatus, loadAutopartStockConfig };

export async function getImapSettings(actorUserId: string) {
  const { getImapSettingsForActor } = await import("@/server/stock/settings");
  return getImapSettingsForActor(actorUserId);
}

export async function saveImapSettings(actorUserId: string, input: Record<string, unknown>) {
  const { updateImapSettings } = await import("@/server/stock/settings");
  return updateImapSettings(actorUserId, input);
}

export async function testImapConnectionAction(actorUserId: string) {
  await requireStockSync(actorUserId);
  const { testImapConnectionForOps } = await import("@/server/stock/poll");
  return testImapConnectionForOps();
}

export async function pollImapNow(actorUserId: string, dryRun: boolean) {
  await requireStockSync(actorUserId);
  const { importFromImap } = await import("@/server/stock/poll");
  return importFromImap({ dryRun, trigger: "manual", actorUserId });
}
