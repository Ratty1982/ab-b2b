import type { StockIssueKind, StockStatus, StockSyncStatus } from "@prisma/client";
import { Prisma } from "@prisma/client";
import { prisma } from "@/infra/database/client";
import { recordAuditEvent } from "@/server/audit/record";
import { AuthError, requireAnySystemPermission } from "@/server/rbac/guards";
import { hasPermission } from "@/server/rbac/access";
import {
  AUTOPART_FEED_SOURCE,
  AUTOPART_WAREHOUSE_CODE,
  AUTOPART_WAREHOUSE_NAME,
  catalogueMatchSummary,
  customerAvailabilityForStock,
  describeStockQtyChange,
  internalStatusFromSellable,
  isStockStale,
  NOT_IN_AB_CATALOGUE_REASON,
  sellableQuantityFromAvail,
  skuMatchKey,
  stockAttentionSummary,
  stockAvailabilityTransitionLabel,
  stockSyncOutcome,
  summariseStockQtyChanges,
  type VariantStock,
} from "@/domain/stock";
import { classifyStockRows, parseAutopart231Po3New } from "@/domain/stock-parse";
import { dueStockWindow, shouldThrottleFailedAttempt, nextSyncDisplay } from "@/domain/stock-schedule";
import { autopartConfigured, loadAutopartStockConfig, publicAutopartStatus } from "@/server/stock/config";
import { fetchAutopartFeed } from "@/server/stock/fetch";
import { releaseStockSyncLock, tryAcquireStockSyncLock } from "@/server/stock/lock";
import type { PublicAvailability } from "@/domain/availability";
import type { InboundStockEmail } from "@/server/stock/imap";
import { randomUUID, timingSafeEqual } from "node:crypto";

const ISSUE_CAP = 400;
const UPSERT_CHUNK = 200;
const UNMATCHED_UPSERT_CHUNK = 500;
const CHANGE_LIST_DEFAULT = 50;
const WOULD_CHANGE_CAP = 80;

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

type VariantRow = {
  id: string;
  sku: string;
  name: string | null;
  isDefault: boolean;
  productId: string;
  productName: string;
};

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
    const variants = await prisma.productVariant.findMany({
      select: { id: true, sku: true, name: true, isDefault: true, productId: true, product: { select: { name: true } } },
    });
    const bySku = variantMap(
      variants.map((row) => ({
        id: row.id,
        sku: row.sku,
        name: row.name,
        isDefault: row.isDefault,
        productId: row.productId,
        productName: row.product.name,
      })),
    );
    const warehouse = await ensureAutopartWarehouse();

    type ApplyRow = {
      variantId: string;
      productId: string;
      sku: string;
      productName: string;
      variantLabel: string | null;
      avail: number;
      raw: string;
    };
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
    const unmatchedFeed: Array<{ sku: string; description: string | null; availRaw: string | null }> = [];
    const matchedFeedSkus: string[] = [];

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
        unmatchedFeed.push({
          sku: row.row.sku,
          description: row.row.description,
          availRaw: row.row.availRaw,
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
      matchedFeedSkus.push(row.row.sku, hits[0]!.sku);
      const hit = hits[0]!;
      toApply.push({
        variantId: hit.id,
        productId: hit.productId,
        sku: hit.sku,
        productName: hit.productName,
        variantLabel: !hit.isDefault && hit.name ? hit.name : null,
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
    type ChangeDraft = ApplyRow & { previousQty: number; newQty: number; previousAvailability: string; newAvailability: string };
    const changeDrafts: ChangeDraft[] = [];
    for (const row of toApply) {
      const sellable = sellableQuantityFromAvail(row.avail);
      const prev = existingQty.has(row.variantId) ? existingQty.get(row.variantId)! : 0;
      const described = describeStockQtyChange(prev, sellable);
      if (!described) {
        unchanged += 1;
        continue;
      }
      updated += 1;
      changeDrafts.push({
        ...row,
        previousQty: described.previousQty,
        newQty: described.newQty,
        previousAvailability: described.previousAvailability,
        newAvailability: described.newAvailability,
      });
    }
    const writes = input.dryRun ? [] : toApply;

    if (!input.dryRun) {
      const changeByVariant = new Map(changeDrafts.map((row) => [row.variantId, row]));
      for (let i = 0; i < writes.length; i += UPSERT_CHUNK) {
        const chunk = writes.slice(i, i + UPSERT_CHUNK);
        const changedChunk = chunk.map((row) => changeByVariant.get(row.variantId)).filter(Boolean) as ChangeDraft[];
        await prisma.$transaction([
          ...chunk.map((row) => {
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
          ...(changedChunk.length
            ? [
                prisma.stockSyncChange.createMany({
                  data: changedChunk.map((row) => ({
                    runId: run.id,
                    variantId: row.variantId,
                    productId: row.productId,
                    skuSnapshot: row.sku,
                    productNameSnapshot: row.productName,
                    variantLabelSnapshot: row.variantLabel,
                    previousQty: row.previousQty,
                    newQty: row.newQty,
                    previousAvailability: row.previousAvailability,
                    newAvailability: row.newAvailability,
                  })),
                }),
              ]
            : []),
        ]);
      }

      await upsertUnmatchedCurrentState(unmatchedFeed, run.id, now);
      const matchedKeys = [...new Set(matchedFeedSkus.filter(Boolean))];
      if (matchedKeys.length) {
        await prisma.stockFeedUnmatched.deleteMany({ where: { sku: { in: matchedKeys } } });
      }
    }

    const finalStatus = stockSyncOutcome({
      rowsRead: parsed.rows.length,
      invalid,
      duplicates,
    }) as StockSyncStatus;
    const errorSummary = stockAttentionSummary(invalid, duplicates);
    const summary = catalogueMatchSummary({ matched, unmatched, invalid, duplicates });

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
      errorSummary,
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
      summary,
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
      summary,
      errorSummary,
      wouldChanges: changeDrafts.slice(0, WOULD_CHANGE_CAP).map(serializeWouldChange),
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

async function upsertUnmatchedCurrentState(
  rows: Array<{ sku: string; description: string | null; availRaw: string | null }>,
  runId: string,
  now: Date,
) {
  const unique = new Map<string, { sku: string; description: string | null; availRaw: string | null }>();
  for (const row of rows) {
    if (!row.sku) continue;
    unique.set(row.sku, row);
  }
  const list = [...unique.values()];
  if (!list.length) return;
  const reason = NOT_IN_AB_CATALOGUE_REASON;
  for (let i = 0; i < list.length; i += UNMATCHED_UPSERT_CHUNK) {
    const chunk = list.slice(i, i + UNMATCHED_UPSERT_CHUNK);
    const values = Prisma.join(
      chunk.map(
        (row) =>
          Prisma.sql`(${row.sku}, ${row.description}, ${row.availRaw}, ${now}, ${now}, ${runId}, 1, ${reason})`,
      ),
    );
    await prisma.$executeRaw`
      INSERT INTO "StockFeedUnmatched" ("sku", "description", "lastAvailRaw", "firstSeenAt", "lastSeenAt", "lastRunId", "occurrenceCount", "reason")
      VALUES ${values}
      ON CONFLICT ("sku") DO UPDATE SET
        "description" = EXCLUDED."description",
        "lastAvailRaw" = EXCLUDED."lastAvailRaw",
        "lastSeenAt" = EXCLUDED."lastSeenAt",
        "lastRunId" = EXCLUDED."lastRunId",
        "occurrenceCount" = "StockFeedUnmatched"."occurrenceCount" + 1,
        "reason" = EXCLUDED."reason"
    `;
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
  emails?: InboundStockEmail[];
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
      ...(input.emails ? { emails: input.emails } : {}),
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
  emails?: InboundStockEmail[];
}) {
  const now = input.now ?? new Date();
  const due = dueStockWindow(now);
  await prisma.stockScheduleState.upsert({
    where: { id: "singleton" },
    create: { id: "singleton", lastTickAt: now, lastDueKey: due.key },
    update: { lastTickAt: now, lastDueKey: due.key },
  });

  const empty = {
    skipped: true as const,
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
    windowKey: due.key,
    windowHour: due.hour,
  };

  let windowRow = await prisma.stockScheduleWindow.findUnique({ where: { key: due.key } });
  if (windowRow?.status === "COMPLETE") {
    return { ...empty, status: "SKIPPED" as const, windowStatus: "COMPLETE" as const, errorSummary: `Already imported ${due.key} Europe/London` };
  }
  if (
    windowRow?.status === "FAILED" &&
    shouldThrottleFailedAttempt(windowRow.lastAttemptAt, now)
  ) {
    return {
      ...empty,
      status: "FAILED" as const,
      windowStatus: "FAILED" as const,
      errorSummary: windowRow.lastError,
    };
  }

  const previousStatus = windowRow?.status ?? null;

  try {
    windowRow = await prisma.stockScheduleWindow.upsert({
      where: { key: due.key },
      create: {
        key: due.key,
        businessDate: due.businessDate,
        hour: due.hour,
        status: "OPEN",
        lastAttemptAt: now,
      },
      update: { lastAttemptAt: now },
    });
    if (!previousStatus || previousStatus === "OPEN") {
      logStockEvent("AUTOPART_WINDOW_DUE", { windowKey: due.key, hour: due.hour });
    }

    const result = await runConfiguredStockSync({
      dryRun: input.dryRun,
      trigger: input.trigger ?? "schedule",
      ...(input.emails ? { emails: input.emails } : {}),
    });

    const feedStatus = "feedStatus" in result ? result.feedStatus : "imported";
    if (feedStatus === "empty" || result.status === "WAITING_FOR_EMAIL") {
      if (previousStatus !== "WAITING_EMAIL") {
        logStockEvent("AUTOPART_WAITING_FOR_EMAIL", { windowKey: due.key });
      }
      await prisma.stockScheduleWindow.updateMany({
        where: { key: due.key, status: { not: "COMPLETE" } },
        data: { status: "WAITING_EMAIL", lastError: result.errorSummary ?? "Waiting for 231PO3NEW", lastAttemptAt: now },
      });
      return {
        ...empty,
        skipped: true as const,
        status: "WAITING_FOR_EMAIL" as const,
        windowStatus: "WAITING_EMAIL" as const,
        errorSummary: result.errorSummary ?? "Waiting for 231PO3NEW",
      };
    }

    logStockEvent("AUTOPART_SCHEDULED_SYNC_STARTED", { windowKey: due.key });

    if (feedStatus === "imap_error" || feedStatus === "not_configured" || result.status === "FAILED") {
      const message = result.errorSummary ?? "Scheduled Autopart sync failed";
      logStockEvent("AUTOPART_SCHEDULED_SYNC_FAILED", { windowKey: due.key, error: message });
      await prisma.stockScheduleWindow.updateMany({
        where: { key: due.key, status: { not: "COMPLETE" } },
        data: {
          status: "FAILED",
          lastError: message,
          lastAttemptAt: now,
          lastRunId: "runId" in result ? result.runId : null,
        },
      });
      return {
        skipped: false as const,
        windowKey: due.key,
        windowHour: due.hour,
        windowStatus: "FAILED" as const,
        ...result,
        status: "FAILED" as const,
        errorSummary: message,
      };
    }

    if (!input.dryRun && (result.status === "SUCCESS" || result.status === "PARTIAL")) {
      await prisma.stockScheduleWindow.update({
        where: { key: due.key },
        data: {
          status: "COMPLETE",
          completedAt: now,
          lastError: null,
          lastAttemptAt: now,
          lastRunId: result.runId,
        },
      });
      logStockEvent("AUTOPART_SCHEDULED_SYNC_COMPLETED", {
        windowKey: due.key,
        runId: result.runId,
        status: result.status,
      });
      return { skipped: false as const, windowKey: due.key, windowHour: due.hour, windowStatus: "COMPLETE" as const, ...result };
    }

    return { skipped: false as const, windowKey: due.key, windowHour: due.hour, windowStatus: windowRow.status, ...result };
  } catch (error) {
    if (error instanceof AuthError && error.code === "CONFLICT") {
      return {
        ...empty,
        status: "SKIPPED" as const,
        windowStatus: previousStatus ?? "OPEN",
        errorSummary: "A stock sync is already running",
      };
    }
    throw error;
  }
}

function logStockEvent(event: string, extra: Record<string, unknown> = {}) {
  console.info("[ab:stock-sync]", { event, ...extra });
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
  const [issues, changeRows] = await Promise.all([
    prisma.stockSyncIssue.findMany({
      where: { runId: id, kind: { not: "UNMATCHED" } },
      orderBy: { createdAt: "asc" },
      take: ISSUE_CAP,
    }),
    prisma.stockSyncChange.findMany({
      where: { runId: id },
      select: {
        previousQty: true,
        newQty: true,
        previousAvailability: true,
        newAvailability: true,
      },
    }),
  ]);
  const changeStats = summariseStockQtyChanges(
    changeRows.map((item) => ({
      previousQty: item.previousQty,
      newQty: item.newQty,
      previousAvailability: item.previousAvailability as "in" | "low" | "out",
      newAvailability: item.newAvailability as "in" | "low" | "out",
    })),
  );
  const changes = await listStockSyncChanges(actorUserId, { runId: id, page: 1, pageSize: CHANGE_LIST_DEFAULT });
  return {
    ...serializeRun(row),
    issues,
    changeStats: { total: changeRows.length, ...changeStats },
    changes,
  };
}

export async function listStockSyncChanges(
  actorUserId: string,
  input: { runId: string; q?: string; page?: number; pageSize?: number },
) {
  await requireInternalStockView(actorUserId);
  const q = input.q?.trim() ?? "";
  const pageSize = Math.min(100, Math.max(10, input.pageSize ?? CHANGE_LIST_DEFAULT));
  const page = Math.max(1, input.page ?? 1);
  const where = {
    runId: input.runId,
    ...(q
      ? {
          OR: [
            { skuSnapshot: { contains: q, mode: "insensitive" as const } },
            { productNameSnapshot: { contains: q, mode: "insensitive" as const } },
          ],
        }
      : {}),
  };
  const [total, rows] = await Promise.all([
    prisma.stockSyncChange.count({ where }),
    prisma.stockSyncChange.findMany({
      where,
      orderBy: [{ createdAt: "asc" }, { skuSnapshot: "asc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);
  return {
    total,
    page,
    pageSize,
    q,
    items: rows.map(serializeChangeRow),
  };
}

export async function listUnmatchedStockSkus(
  actorUserId: string,
  input?: { q?: string; page?: number; pageSize?: number; lastRunId?: string },
) {
  await requireInternalStockView(actorUserId);
  const q = input?.q?.trim() ?? "";
  const pageSize = Math.min(100, Math.max(10, input?.pageSize ?? 50));
  const page = Math.max(1, input?.page ?? 1);
  const where = {
    ...(input?.lastRunId ? { lastRunId: input.lastRunId } : {}),
    ...(q
      ? {
          OR: [
            { sku: { contains: q, mode: "insensitive" as const } },
            { description: { contains: q, mode: "insensitive" as const } },
          ],
        }
      : {}),
  };
  const [total, rows] = await Promise.all([
    prisma.stockFeedUnmatched.count({ where }),
    prisma.stockFeedUnmatched.findMany({
      where,
      orderBy: { lastSeenAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);
  return {
    total,
    page,
    pageSize,
    q,
    items: rows.map((row) => ({
      sku: row.sku,
      description: row.description,
      avail: row.lastAvailRaw,
      reason: row.reason,
      firstSeenAt: row.firstSeenAt.toISOString(),
      lastSeenAt: row.lastSeenAt.toISOString(),
      lastRunId: row.lastRunId,
      occurrenceCount: row.occurrenceCount,
    })),
  };
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
  const now = new Date();
  const due = dueStockWindow(now);
  const [scheduleState, dueWindow] = await Promise.all([
    prisma.stockScheduleState.findUnique({ where: { id: "singleton" } }),
    prisma.stockScheduleWindow.findUnique({ where: { key: due.key } }),
  ]);
  const dueComplete = dueWindow?.status === "COMPLETE";
  const next = nextSyncDisplay(now, dueComplete);
  const windowStatus = dueWindow?.status ?? "PENDING";
  const currentWindowLabel =
    windowStatus === "WAITING_EMAIL"
      ? `${due.label} · Waiting for 231PO3NEW`
      : windowStatus === "COMPLETE"
        ? `${due.label} · Complete`
        : windowStatus === "FAILED"
          ? `${due.label} · Failed`
          : `${due.label} · ${windowStatus === "OPEN" ? "Due" : "Pending"}`;
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
    scheduler: {
      enabled: base.schedulerEnabled,
      mode: base.schedulerEnabled ? "automatic" : "disabled",
      lastTickAt: scheduleState?.lastTickAt?.toISOString() ?? null,
      startedAt: scheduleState?.startedAt?.toISOString() ?? null,
      currentWindow: {
        key: due.key,
        hour: due.hour,
        label: due.label,
        status: windowStatus,
        display: currentWindowLabel,
        lastError: dueWindow?.lastError ?? null,
        lastAttemptAt: dueWindow?.lastAttemptAt?.toISOString() ?? null,
      },
      nextSync: next,
      lastScheduledAttemptAt: dueWindow?.lastAttemptAt?.toISOString() ?? null,
    },
  };
}

function serializeWouldChange(row: {
  sku: string;
  productName: string;
  variantLabel: string | null;
  productId: string;
  previousQty: number;
  newQty: number;
  previousAvailability: string;
  newAvailability: string;
}) {
  return serializeChangeView({
    skuSnapshot: row.sku,
    productNameSnapshot: row.productName,
    variantLabelSnapshot: row.variantLabel,
    productId: row.productId,
    previousQty: row.previousQty,
    newQty: row.newQty,
    previousAvailability: row.previousAvailability,
    newAvailability: row.newAvailability,
    createdAt: null,
    id: null,
  });
}

function serializeChangeRow(row: {
  id: string;
  productId: string | null;
  skuSnapshot: string;
  productNameSnapshot: string;
  variantLabelSnapshot: string | null;
  previousQty: number;
  newQty: number;
  previousAvailability: string;
  newAvailability: string;
  createdAt: Date;
}) {
  return serializeChangeView({
    id: row.id,
    productId: row.productId,
    skuSnapshot: row.skuSnapshot,
    productNameSnapshot: row.productNameSnapshot,
    variantLabelSnapshot: row.variantLabelSnapshot,
    previousQty: row.previousQty,
    newQty: row.newQty,
    previousAvailability: row.previousAvailability,
    newAvailability: row.newAvailability,
    createdAt: row.createdAt.toISOString(),
  });
}

function serializeChangeView(row: {
  id: string | null;
  productId: string | null;
  skuSnapshot: string;
  productNameSnapshot: string;
  variantLabelSnapshot: string | null;
  previousQty: number;
  newQty: number;
  previousAvailability: string;
  newAvailability: string;
  createdAt: string | null;
}) {
  const previousAvailability = row.previousAvailability as "in" | "low" | "out";
  const newAvailability = row.newAvailability as "in" | "low" | "out";
  return {
    id: row.id,
    productId: row.productId,
    sku: row.skuSnapshot,
    productName: row.productNameSnapshot,
    variantLabel: row.variantLabelSnapshot,
    previousQty: row.previousQty,
    newQty: row.newQty,
    quantityChange: row.newQty - row.previousQty,
    previousAvailability,
    newAvailability,
    availabilityChange: stockAvailabilityTransitionLabel(previousAvailability, newAvailability),
    createdAt: row.createdAt,
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
    summary: catalogueMatchSummary({
      matched: row.matched,
      unmatched: row.unmatched,
      invalid: row.invalid,
      duplicates: row.duplicates,
    }),
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
