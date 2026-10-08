/**
 * Manual Amazon FBA stock import.
 * OPTIMUS Avail is stored as location FBA. SS warehouse Avail, Incoming, cost,
 * condition, group, and supplier links are not written.
 */
import { createHash } from "node:crypto";
import { z } from "zod";
import { prisma } from "@/infra/database/client";
import { hasPermission } from "@/server/rbac/access";
import { AuthError, requirePurchasingAccess } from "@/server/rbac/guards";
import { recordAuditEvent } from "@/server/audit/record";
import { skuMatchKey } from "@/domain/stock";
import {
  FBA_LOCATION_CODE,
  FBA_SOURCE_BRANCH,
  FBA_STOCK_LABEL,
  FBA_STOCK_STALE_AFTER_DAYS,
  assessFbaStockFile,
  buildFbaPreviewProducts,
  fbaLocationForImport,
  fbaStockIsStale,
  planFbaSnapshot,
  type FbaFileAssessment,
  type FbaImportTotals,
} from "@/domain/fba-stock";
import { formatOperationalDateTime } from "@/lib/datetime";

/** This importer writes UK FBA only. Other countries stay on their own location codes. */
const UK_FBA_LOCATION_CODE = fbaLocationForImport("UK")?.locationCode ?? FBA_LOCATION_CODE;

const FILE_NAME_MAX = 200;

function requirePurchasingManage(actorUserId: string) {
  return requirePurchasingAccess(actorUserId).then((profile) => {
    if (!hasPermission(profile, "purchasing.manage")) {
      throw new AuthError("purchasing.manage is required", "FORBIDDEN", 403);
    }
    return profile;
  });
}

export function fbaFileHash(text: string): string {
  const normalised = text.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  return createHash("sha256").update(normalised).digest("hex");
}

function fileNameOf(raw: string): string {
  const name = raw.trim().slice(0, FILE_NAME_MAX);
  return name || "fba-stock.csv";
}

export type FbaFreshness = {
  updatedAt: string | null;
  updatedLabel: string;
  stale: boolean;
  staleAfterDays: number;
  fileName: string | null;
};

export async function loadFbaFreshness(now = new Date()): Promise<FbaFreshness> {
  const latest = await prisma.autopartFbaStockImport.findFirst({
    where: { status: "SUCCESS" },
    orderBy: { importedAt: "desc" },
    select: { importedAt: true, fileName: true },
  });
  return {
    updatedAt: latest?.importedAt.toISOString() ?? null,
    updatedLabel: latest ? (formatOperationalDateTime(latest.importedAt) ?? "Not imported") : "Not imported",
    stale: fbaStockIsStale(latest?.importedAt ?? null, now),
    staleAfterDays: FBA_STOCK_STALE_AFTER_DAYS,
    fileName: latest?.fileName ?? null,
  };
}

export async function loadCurrentFbaQtyByMatchKey(): Promise<Map<string, number>> {
  const rows = await prisma.autopartLocationStock.findMany({
    where: { locationCode: UK_FBA_LOCATION_CODE },
    select: { availableQty: true, autopartProduct: { select: { matchKey: true } } },
  });
  const qty = new Map<string, number>();
  for (const row of rows) qty.set(row.autopartProduct.matchKey, row.availableQty);
  return qty;
}

async function previousQtyMap(): Promise<Map<string, number>> {
  const rows = await prisma.autopartLocationStock.findMany({
    where: { locationCode: UK_FBA_LOCATION_CODE },
    select: { availableQty: true, autopartProduct: { select: { matchKey: true } } },
  });
  return new Map(rows.map((row) => [row.autopartProduct.matchKey, row.availableQty]));
}

function assertAssessed(text: string): Extract<FbaFileAssessment, { ok: true }> {
  const assessed = assessFbaStockFile(text);
  if (!assessed.ok) throw new AuthError(assessed.message, "VALIDATION", 400);
  return assessed;
}

async function snapshotContext(assessed: Extract<FbaFileAssessment, { ok: true }>) {
  const keys = assessed.rows.map((row) => row.matchKey);
  const [products, previousQty] = await Promise.all([
    keys.length
      ? prisma.autopartProduct.findMany({
          where: { matchKey: { in: keys } },
          select: {
            matchKey: true,
            description: true,
            availQty: true,
            groupCode: true,
            conditionCode: true,
          },
        })
      : Promise.resolve([]),
    previousQtyMap(),
  ]);
  return { products, previousQty };
}

function totalsFor(
  assessed: Extract<FbaFileAssessment, { ok: true }>,
  products: Array<{ matchKey: string }>,
  previousQty: Map<string, number>,
): FbaImportTotals {
  return planFbaSnapshot({
    rows: assessed.rows,
    existingProductKeys: new Set(products.map((row) => row.matchKey)),
    previousQty,
    completeSnapshot: assessed.completeSnapshot,
    rowsRead: assessed.rowsRead,
    invalidRows: assessed.invalidRows,
    duplicateSkus: assessed.duplicateSkus,
    warnings: assessed.warnings,
  });
}

const uploadInput = z.object({
  fileName: z.string().optional().nullable(),
  text: z.string().min(1),
});

export async function previewFbaStockImport(actorUserId: string, raw: unknown) {
  await requirePurchasingManage(actorUserId);
  const input = uploadInput.parse(raw);
  const assessed = assertAssessed(input.text);
  const { products, previousQty } = await snapshotContext(assessed);
  const totals = totalsFor(assessed, products, previousQty);
  const lines = buildFbaPreviewProducts({
    rows: assessed.rows,
    existing: new Map(
      products.map((row) => [
        row.matchKey,
        {
          description: row.description,
          warehouseQty: row.availQty,
          groupCode: row.groupCode,
          conditionCode: row.conditionCode,
        },
      ]),
    ),
    previousQty,
  });
  const hash = fbaFileHash(input.text);
  const existing = await prisma.autopartFbaStockImport.findUnique({ where: { fileHash: hash }, select: { id: true } });
  return {
    fileName: fileNameOf(input.fileName ?? ""),
    sourceLabel: assessed.sourceLabel,
    sourceBranch: assessed.sourceBranch,
    duplicate: Boolean(existing),
    completeSnapshot: assessed.completeSnapshot,
    ...totals,
    invalidRowDetails: assessed.invalidRowDetails,
    duplicateRowDetails: assessed.duplicateRowDetails,
    quoteDiagnostics: assessed.quoteDiagnostics,
    newProductRows: lines.newProducts,
    stockedProducts: lines.stockedProducts,
  };
}

async function ensureProducts(
  rows: Extract<FbaFileAssessment, { ok: true }>["rows"],
): Promise<Map<string, { id: string; created: boolean }>> {
  const out = new Map<string, { id: string; created: boolean }>();
  const existing = await prisma.autopartProduct.findMany({
    where: { matchKey: { in: rows.map((row) => row.matchKey) } },
    select: { id: true, matchKey: true },
  });
  for (const row of existing) out.set(row.matchKey, { id: row.id, created: false });
  const missing = rows.filter((row) => !out.has(row.matchKey));
  for (const row of missing) {
    const variants = await prisma.productVariant.findMany({
      where: { sku: { equals: row.sku, mode: "insensitive" } },
      select: { id: true },
    });
    let catalogueVariantId: string | null = null;
    if (variants.length === 1) {
      const taken = await prisma.autopartProduct.findFirst({
        where: { catalogueVariantId: variants[0]!.id },
        select: { id: true },
      });
      if (!taken) catalogueVariantId = variants[0]!.id;
    }
    const now = new Date();
    const created = await prisma.autopartProduct.create({
      data: {
        sku: row.sku,
        matchKey: row.matchKey,
        description: row.description,
        availQty: 0,
        incomingQty: null,
        latestCost: null,
        conditionCode: null,
        groupCode: null,
        presentInLatestFeed: false,
        catalogueVariantId,
        firstSeenAt: now,
        lastSeenAt: now,
      },
      select: { id: true, matchKey: true },
    });
    out.set(created.matchKey, { id: created.id, created: true });
  }
  return out;
}

export async function importFbaStock(actorUserId: string, raw: unknown) {
  await requirePurchasingManage(actorUserId);
  const input = uploadInput.parse(raw);
  const fileName = fileNameOf(input.fileName ?? "");
  const hash = fbaFileHash(input.text);
  const duplicate = await prisma.autopartFbaStockImport.findUnique({ where: { fileHash: hash } });
  if (duplicate) {
    return {
      status: "DUPLICATE" as const,
      message: "Already imported. This file content was imported before.",
      fileName: duplicate.fileName,
      importedAt: duplicate.importedAt.toISOString(),
      productsProcessed: duplicate.productsProcessed,
      productsWithStock: duplicate.productsWithStock,
      totalUnits: duplicate.totalUnits,
      changedQuantities: duplicate.changedQuantities,
      newProducts: duplicate.newProducts,
      zeroStock: duplicate.zeroStock,
      warnings: duplicate.warnings,
    };
  }
  const assessed = assertAssessed(input.text);
  const context = await snapshotContext(assessed);
  const totals = totalsFor(assessed, context.products, context.previousQty);
  const products = await ensureProducts(assessed.rows);
  const now = new Date();
  const fileKeys = new Set(assessed.rows.map((row) => row.matchKey));
  for (const row of assessed.rows) {
    const product = products.get(row.matchKey);
    if (!product) continue;
    await prisma.autopartLocationStock.upsert({
      where: {
        autopartProductId_locationCode: {
          autopartProductId: product.id,
          locationCode: UK_FBA_LOCATION_CODE,
        },
      },
      create: {
        autopartProductId: product.id,
        locationCode: UK_FBA_LOCATION_CODE,
        availableQty: row.availQty,
        sourceBranch: FBA_SOURCE_BRANCH,
        sourceFileName: fileName,
        sourceImportedAt: now,
      },
      update: {
        availableQty: row.availQty,
        sourceBranch: FBA_SOURCE_BRANCH,
        sourceFileName: fileName,
        sourceImportedAt: now,
      },
    });
  }
  if (assessed.completeSnapshot) {
    const current = await prisma.autopartLocationStock.findMany({
      where: { locationCode: UK_FBA_LOCATION_CODE },
      select: { id: true, autopartProduct: { select: { matchKey: true } } },
    });
    const absentIds = current.filter((row) => !fileKeys.has(row.autopartProduct.matchKey)).map((row) => row.id);
    if (absentIds.length) {
      await prisma.autopartLocationStock.updateMany({
        where: { id: { in: absentIds } },
        data: { availableQty: 0, sourceFileName: fileName, sourceImportedAt: now, sourceBranch: FBA_SOURCE_BRANCH },
      });
    }
  }
  const saved = await prisma.autopartFbaStockImport.create({
    data: {
      fileName,
      fileHash: hash,
      status: "SUCCESS",
      actorUserId,
      importedAt: now,
      productsProcessed: totals.productsProcessed,
      matchedExisting: totals.matchedExisting,
      newProducts: totals.newProducts,
      productsWithStock: totals.productsWithStock,
      totalUnits: totals.totalUnits,
      changedQuantities: totals.changedQuantities,
      zeroStock: totals.zeroStock,
      absentZeroed: totals.absentZeroed,
      invalidRows: totals.invalidRows,
      duplicateSkus: totals.duplicateSkus,
      completeSnapshot: assessed.completeSnapshot,
      sourceBranch: FBA_SOURCE_BRANCH,
      warnings: totals.warnings,
    },
  });
  await prisma.autopartLocationStock.updateMany({
    where: { sourceImportedAt: now, locationCode: UK_FBA_LOCATION_CODE, importId: null },
    data: { importId: saved.id },
  });
  await recordAuditEvent({
    action: "purchasing.fba_stock.import",
    entityType: "AutopartFbaStockImport",
    entityId: saved.id,
    actorUserId,
    metadata: {
      fileName,
      sourceBranch: FBA_SOURCE_BRANCH,
      productsProcessed: totals.productsProcessed,
      totalUnits: totals.totalUnits,
      completeSnapshot: assessed.completeSnapshot,
    },
  });
  const actor = await prisma.user.findUnique({
    where: { id: actorUserId },
    select: { name: true, email: true },
  });
  return {
    status: "IMPORTED" as const,
    message: `${FBA_STOCK_LABEL} stock updated`,
    id: saved.id,
    fileName,
    importedAt: saved.importedAt.toISOString(),
    importedBy: actor?.name || actor?.email || "Unknown user",
    sourceLabel: assessed.sourceLabel,
    ...totals,
  };
}

export async function listFbaStockImports(actorUserId: string) {
  await requirePurchasingAccess(actorUserId);
  const rows = await prisma.autopartFbaStockImport.findMany({
    orderBy: { importedAt: "desc" },
    take: 12,
  });
  const actors = await prisma.user.findMany({
    where: { id: { in: rows.map((row) => row.actorUserId).filter((id): id is string => Boolean(id)) } },
    select: { id: true, name: true, email: true },
  });
  const names = new Map(actors.map((user) => [user.id, user.name || user.email]));
  return rows.map((row) => ({
    id: row.id,
    fileName: row.fileName,
    status: row.status,
    importedAt: row.importedAt.toISOString(),
    importedBy: row.actorUserId ? (names.get(row.actorUserId) ?? "Unknown user") : "Unknown user",
    productsProcessed: row.productsProcessed,
    productsWithStock: row.productsWithStock,
    totalUnits: row.totalUnits,
    changedQuantities: row.changedQuantities,
    newProducts: row.newProducts,
    zeroStock: row.zeroStock,
    absentZeroed: row.absentZeroed,
    warnings: row.warnings,
  }));
}

export async function fbaQtyForMatchKey(matchKey: string): Promise<number> {
  const row = await prisma.autopartLocationStock.findFirst({
    where: {
      locationCode: UK_FBA_LOCATION_CODE,
      autopartProduct: { matchKey: skuMatchKey(matchKey) },
    },
    select: { availableQty: true },
  });
  return row?.availableQty ?? 0;
}
