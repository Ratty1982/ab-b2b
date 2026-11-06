/**
 * Confirm-before-apply manual 231PO3NEW upload.
 * Preview uses the same parser + classify path as live apply; apply requires the
 * exact previewed file hash and rejects expired/consumed/stale-baseline previews.
 *
 * If Autopart inventory changes between preview and confirm (e.g. a scheduled
 * sync), confirmation is refused so the operator must re-preview against current stock.
 */

import { createHash } from "node:crypto";
import { z } from "zod";
import { prisma } from "@/infra/database/client";
import { recordAuditEvent } from "@/server/audit/record";
import { AuthError, requireAnySystemPermission } from "@/server/rbac/guards";
import { decodeStockFeedBase64, decodeStockFeedBytes } from "@/domain/stock-feed-decode";
import { classifyStockRows, parseAutopart231Po3New } from "@/domain/stock-parse";
import { detect231Po3ReportKind } from "@/domain/stock-parse-native";
import { AUTOPART_FEED_SOURCE, skuMatchKey } from "@/domain/stock";
import { applyStockFeed } from "@/server/stock/service";

const PREVIEW_TTL_MS = 30 * 60 * 1000;

export type PreviewInventoryBaselineRow = {
  variantId: string;
  /** null = no Inventory row (unconfirmed). */
  qtyOnHand: number | null;
  manualOverrideQty: number | null;
  updatedAt: string | null;
};

export type ManualUploadPreviewSummary = {
  filename: string;
  fileHash: string;
  byteLength: number;
  encoding: string;
  reportKind: string;
  rowsRead: number;
  matched: number;
  unmatched: number;
  invalid: number;
  duplicates: number;
  wouldUpdate: number;
  unchanged: number;
  newlyConfirmed: number;
  zeroConfirmations: number;
  proposedSample: Array<{
    sku: string;
    productName: string | null;
    previousQty: number | null;
    newQty: number;
    kind:
      | "new_confirm"
      | "increase"
      | "decrease"
      | "unchanged"
      | "external"
      | "invalid"
      | "duplicate"
      | "conflict";
  }>;
  proposedTotal: number;
  /** Catalogue variants the preview reasoned about — used to re-validate on confirm. */
  inventoryBaseline: PreviewInventoryBaselineRow[];
  inventoryBaselineHash: string;
};

async function requireUploadActor(actorUserId: string) {
  const profile = await requireAnySystemPermission(actorUserId, [
    "products.import",
    "products.edit",
    "purchasing.stock.manage",
    "admin.access",
  ]);
  if (profile.actorType === "TRADE") {
    throw new AuthError("Trade users cannot upload Autopart stock files", "FORBIDDEN", 403);
  }
  return profile;
}

function fileHash(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

export function inventoryBaselineFingerprint(rows: PreviewInventoryBaselineRow[]): string {
  const normalized = [...rows]
    .sort((a, b) => a.variantId.localeCompare(b.variantId))
    .map(
      (r) =>
        `${r.variantId}:${r.qtyOnHand ?? "∅"}:${r.manualOverrideQty ?? "∅"}:${r.updatedAt ?? "∅"}`,
    )
    .join("|");
  return createHash("sha256").update(normalized, "utf8").digest("hex");
}

export async function loadPreviewInventoryBaseline(
  variantIds: string[],
): Promise<PreviewInventoryBaselineRow[]> {
  const unique = [...new Set(variantIds)].sort();
  if (!unique.length) return [];
  const warehouse = await prisma.warehouse.findUnique({ where: { code: "AUTOPART" } });
  if (!warehouse) {
    return unique.map((variantId) => ({
      variantId,
      qtyOnHand: null,
      manualOverrideQty: null,
      updatedAt: null,
    }));
  }
  const inventory = await prisma.inventory.findMany({
    where: { warehouseId: warehouse.id, variantId: { in: unique } },
    select: {
      variantId: true,
      qtyOnHand: true,
      manualOverrideQty: true,
      updatedAt: true,
    },
  });
  const byVariant = new Map(inventory.map((row) => [row.variantId, row]));
  return unique.map((variantId) => {
    const row = byVariant.get(variantId);
    if (!row) {
      return {
        variantId,
        qtyOnHand: null,
        manualOverrideQty: null,
        updatedAt: null,
      };
    }
    return {
      variantId,
      qtyOnHand: row.qtyOnHand,
      manualOverrideQty: row.manualOverrideQty ?? null,
      updatedAt: row.updatedAt.toISOString(),
    };
  });
}

const previewSchema = z.object({
  filename: z.string().trim().min(1).max(240),
  /** Prefer base64 for encoding-safe upload; text is accepted for backwards compatibility. */
  base64: z.string().min(8).optional(),
  text: z.string().optional(),
});

export async function previewManualStockUpload(actorUserId: string, raw: unknown) {
  await requireUploadActor(actorUserId);
  const input = previewSchema.parse(raw);
  const decoded = input.base64
    ? decodeStockFeedBase64(input.base64)
    : decodeStockFeedBytes(Buffer.from(String(input.text ?? ""), "utf8"));
  const kind = detect231Po3ReportKind(decoded.text);
  if (kind !== "231PO3NEW") {
    throw new AuthError(
      kind === "LEGACY_231PO3"
        ? "This looks like a legacy 231PO3 report without Avail. Upload a 231PO3NEW file."
        : "Not a valid 231PO3NEW Autopart stock report.",
      "VALIDATION",
      400,
    );
  }

  const parsed = parseAutopart231Po3New(decoded.text, decoded.byteLength);
  if ("code" in parsed) {
    throw new AuthError(parsed.message, "VALIDATION", 400);
  }

  const classified = classifyStockRows(parsed.rows);
  const variants = await prisma.productVariant.findMany({
    select: { id: true, sku: true, productId: true, product: { select: { name: true } } },
  });
  const bySku = new Map<string, typeof variants>();
  for (const v of variants) {
    const key = skuMatchKey(v.sku);
    const list = bySku.get(key) ?? [];
    list.push(v);
    bySku.set(key, list);
  }
  const warehouse = await prisma.warehouse.findUnique({ where: { code: "AUTOPART" } });
  const inventory = warehouse
    ? await prisma.inventory.findMany({
        where: { warehouseId: warehouse.id },
        select: { variantId: true, qtyOnHand: true },
      })
    : [];
  const qtyByVariant = new Map(inventory.map((row) => [row.variantId, row.qtyOnHand]));

  let matched = 0;
  let unmatched = 0;
  let invalid = 0;
  let duplicates = 0;
  let wouldUpdate = 0;
  let unchanged = 0;
  let newlyConfirmed = 0;
  let zeroConfirmations = 0;
  const matchedVariantIds: string[] = [];
  const proposed: ManualUploadPreviewSummary["proposedSample"] = [];

  for (const row of classified) {
    if (row.kind === "missing_sku" || row.kind === "invalid") {
      invalid += 1;
      proposed.push({
        sku: row.row.sku || "(blank)",
        productName: row.row.description,
        previousQty: null,
        newQty: 0,
        kind: "invalid",
      });
      continue;
    }
    if (row.kind === "duplicate") {
      duplicates += 1;
      const dupAvail = row.row.avail.ok ? row.row.avail.value : 0;
      proposed.push({
        sku: row.row.sku,
        productName: row.row.description,
        previousQty: null,
        newQty: dupAvail,
        kind: "duplicate",
      });
      continue;
    }
    const hits = bySku.get(row.row.matchKey) ?? [];
    if (hits.length === 0) {
      unmatched += 1;
      proposed.push({
        sku: row.row.sku,
        productName: row.row.description,
        previousQty: null,
        newQty: row.avail,
        kind: "external",
      });
      continue;
    }
    if (hits.length > 1) {
      proposed.push({
        sku: row.row.sku,
        productName: row.row.description,
        previousQty: null,
        newQty: row.avail,
        kind: "conflict",
      });
      continue;
    }
    matched += 1;
    const hit = hits[0]!;
    matchedVariantIds.push(hit.id);
    const had = qtyByVariant.has(hit.id);
    const prev = had ? qtyByVariant.get(hit.id)! : null;
    if (!had) {
      newlyConfirmed += 1;
      if (row.avail === 0) zeroConfirmations += 1;
      proposed.push({
        sku: hit.sku,
        productName: hit.product.name,
        previousQty: null,
        newQty: row.avail,
        kind: "new_confirm",
      });
    } else if (prev === row.avail) {
      unchanged += 1;
      proposed.push({
        sku: hit.sku,
        productName: hit.product.name,
        previousQty: prev,
        newQty: row.avail,
        kind: "unchanged",
      });
    } else {
      wouldUpdate += 1;
      proposed.push({
        sku: hit.sku,
        productName: hit.product.name,
        previousQty: prev,
        newQty: row.avail,
        kind: row.avail > (prev ?? 0) ? "increase" : "decrease",
      });
    }
  }

  const inventoryBaseline = await loadPreviewInventoryBaseline(matchedVariantIds);
  const inventoryBaselineHash = inventoryBaselineFingerprint(inventoryBaseline);
  const hash = fileHash(decoded.text);
  const expiresAt = new Date(Date.now() + PREVIEW_TTL_MS);
  const summary: ManualUploadPreviewSummary = {
    filename: input.filename,
    fileHash: hash,
    byteLength: decoded.byteLength,
    encoding: decoded.encoding,
    reportKind: kind,
    rowsRead: parsed.rows.length,
    matched,
    unmatched,
    invalid,
    duplicates,
    wouldUpdate,
    unchanged,
    newlyConfirmed,
    zeroConfirmations,
    proposedSample: proposed
      .filter((row) => row.kind === "new_confirm" || row.kind === "increase" || row.kind === "decrease")
      .slice(0, 100),
    proposedTotal: proposed.length,
    inventoryBaseline,
    inventoryBaselineHash,
  };

  const preview = await prisma.stockSyncPreview.create({
    data: {
      fileHash: hash,
      filename: input.filename,
      byteLength: decoded.byteLength,
      encoding: decoded.encoding,
      actorUserId,
      summaryJson: summary,
      fileText: decoded.text,
      expiresAt,
    },
  });

  await recordAuditEvent({
    action: "stock.sync.preview_created",
    entityType: "StockSyncPreview",
    entityId: preview.id,
    actorUserId,
    metadata: {
      filename: input.filename,
      fileHash: hash,
      rowsRead: parsed.rows.length,
      matched,
      newlyConfirmed,
      encoding: decoded.encoding,
      inventoryBaselineHash,
    },
  });

  return {
    previewId: preview.id,
    expiresAt: expiresAt.toISOString(),
    ...summary,
  };
}

const confirmSchema = z.object({
  previewId: z.string().cuid(),
  fileHash: z.string().regex(/^[a-f0-9]{64}$/i),
});

function readStoredBaseline(summaryJson: unknown): {
  rows: PreviewInventoryBaselineRow[];
  hash: string | null;
} {
  if (!summaryJson || typeof summaryJson !== "object") {
    return { rows: [], hash: null };
  }
  const summary = summaryJson as Partial<ManualUploadPreviewSummary>;
  const rows = Array.isArray(summary.inventoryBaseline) ? summary.inventoryBaseline : [];
  const hash =
    typeof summary.inventoryBaselineHash === "string" ? summary.inventoryBaselineHash : null;
  return { rows, hash };
}

/**
 * Ensures the operator's preview still matches live Autopart inventory.
 * Rejects when a scheduled/IMAP sync (or any other write) changed matched stock.
 */
export async function assertPreviewInventoryBaselineFresh(input: {
  previewCreatedAt: Date;
  summaryJson: unknown;
}): Promise<void> {
  const stored = readStoredBaseline(input.summaryJson);
  const variantIds = stored.rows.map((row) => row.variantId);
  const live = await loadPreviewInventoryBaseline(variantIds);
  const liveHash = inventoryBaselineFingerprint(live);
  const expectedHash = stored.hash ?? inventoryBaselineFingerprint(stored.rows);

  if (liveHash !== expectedHash) {
    throw new AuthError(
      "Stock changed since this preview (likely a scheduled Autopart sync). Upload and preview the file again before confirming.",
      "CONFLICT",
      409,
    );
  }

  // Defensive: a live sync completed after preview that touched any of these variants.
  if (variantIds.length) {
    const intervening = await prisma.stockSyncChange.findFirst({
      where: {
        variantId: { in: variantIds },
        createdAt: { gt: input.previewCreatedAt },
        run: {
          status: { in: ["SUCCESS", "PARTIAL"] },
          mode: { not: "dry-run" },
        },
      },
      select: { id: true, runId: true },
    });
    if (intervening) {
      throw new AuthError(
        "A stock sync updated catalogue inventory after this preview. Upload and preview the file again before confirming.",
        "CONFLICT",
        409,
      );
    }
  }
}

export async function confirmManualStockUpload(actorUserId: string, raw: unknown) {
  await requireUploadActor(actorUserId);
  const input = confirmSchema.parse(raw);
  const preview = await prisma.stockSyncPreview.findUnique({ where: { id: input.previewId } });
  if (!preview) throw new AuthError("Preview not found", "NOT_FOUND", 404);
  if (preview.actorUserId !== actorUserId) {
    throw new AuthError("This preview belongs to another operator", "FORBIDDEN", 403);
  }
  if (preview.consumedAt) {
    throw new AuthError("This preview was already applied", "CONFLICT", 409);
  }
  if (preview.expiresAt.getTime() < Date.now()) {
    throw new AuthError("Preview expired — upload and preview the file again", "VALIDATION", 400);
  }
  if (preview.fileHash.toLowerCase() !== input.fileHash.toLowerCase()) {
    throw new AuthError("File hash does not match the previewed file", "VALIDATION", 400);
  }

  await assertPreviewInventoryBaselineFresh({
    previewCreatedAt: preview.createdAt,
    summaryJson: preview.summaryJson,
  });

  const result = await applyStockFeed({
    text: preview.fileText,
    bytes: preview.byteLength,
    dryRun: false,
    trigger: "manual",
    actorUserId,
    sourceLabel: `${AUTOPART_FEED_SOURCE}:upload:${preview.filename}`,
  });

  await prisma.stockSyncPreview.update({
    where: { id: preview.id },
    data: {
      consumedAt: new Date(),
      consumedRunId: "runId" in result ? result.runId : null,
    },
  });

  await recordAuditEvent({
    action: "stock.sync.preview_confirmed",
    entityType: "StockSyncPreview",
    entityId: preview.id,
    actorUserId,
    metadata: {
      filename: preview.filename,
      fileHash: preview.fileHash,
      runId: "runId" in result ? result.runId : null,
      status: result.status,
    },
  });

  return result;
}
