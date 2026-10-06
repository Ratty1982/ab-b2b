/**
 * Autopart 216V import — daily outstanding backorder snapshots.
 * Does not create companies or catalogue products. Does not touch 231PO3NEW.
 */

import { createHash } from "node:crypto";
import type { AutopartBackorderChangeStatus, Prisma } from "@prisma/client";
import { prisma } from "@/infra/database/client";
import { AuthError, requirePurchasingAccess, requireSystemPermission } from "@/server/rbac/guards";
import { hasPermission } from "@/server/rbac/access";
import { recordAuditEvent } from "@/server/audit/record";
import { skuMatchKey } from "@/domain/stock";
import { todayLondonDateOnly } from "@/domain/sales-history-period";
import {
  compare216vQty,
  isAutopart216vReport,
  isStrongEmpty216vReport,
  parseAutopart216vReport,
  type Autopart216vRow,
} from "@/domain/autopart-216v";

function fileHash(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function utcDateOnly(iso: string): Date {
  return new Date(`${iso}T00:00:00.000Z`);
}

async function mapAccounts(codes: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(codes.map((c) => c.trim().toUpperCase()).filter(Boolean))];
  const out = new Map<string, string>();
  if (!unique.length) return out;
  const companies = await prisma.company.findMany({
    where: { autopartCustomerCode: { in: unique, mode: "insensitive" } },
    select: { id: true, autopartCustomerCode: true },
  });
  for (const c of companies) {
    if (c.autopartCustomerCode) out.set(c.autopartCustomerCode.trim().toUpperCase(), c.id);
  }
  const missing = unique.filter((c) => !out.has(c));
  if (missing.length) {
    const aliases = await prisma.autopartCustomerAccountAlias.findMany({
      where: { alias: { in: missing } },
      select: { alias: true, companyId: true },
    });
    for (const a of aliases) out.set(a.alias.trim().toUpperCase(), a.companyId);
  }
  return out;
}

async function mapProducts(matchKeys: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(matchKeys.filter(Boolean))];
  const out = new Map<string, string>();
  if (!unique.length) return out;
  const products = await prisma.autopartProduct.findMany({
    where: { matchKey: { in: unique } },
    select: { id: true, matchKey: true },
  });
  for (const p of products) out.set(p.matchKey, p.id);
  return out;
}

export async function confirmAutopart216vImport(
  actorUserId: string | null,
  raw: { text: string; filename?: string; source?: "MANUAL" | "EMAIL" | "SCHEDULE"; receivedAt?: Date },
) {
  if (actorUserId) {
    const profile = await requirePurchasingAccess(actorUserId);
    if (raw.source === "MANUAL" && !hasPermission(profile, "purchasing.manage")) {
      throw new AuthError("Purchasing manage permission required", "FORBIDDEN", 403);
    }
  }
  if (!isAutopart216vReport(raw.text, raw.filename)) {
    throw new AuthError("File does not look like an Autopart 216V report", "VALIDATION", 400);
  }
  const parsed = parseAutopart216vReport(raw.text);
  if (!parsed.headerFound) {
    throw new AuthError("216V header not recognised", "VALIDATION", 400);
  }
  if (parsed.rows.length === 0 && !isStrongEmpty216vReport(raw.text)) {
    throw new AuthError(
      "Empty file is not a strongly identified 216V report — previous backorders were not cleared",
      "VALIDATION",
      400,
    );
  }

  const hash = fileHash(raw.text);
  const existing = await prisma.autopartBackorderSnapshot.findUnique({
    where: { fileHash: hash },
    select: { id: true, status: true },
  });
  if (existing?.status === "COMMITTED") {
    return { id: existing.id, duplicate: true as const, status: "COMMITTED" as const };
  }

  const previous = await prisma.autopartBackorderSnapshot.findFirst({
    where: { status: "COMMITTED" },
    orderBy: { importedAt: "desc" },
    include: { lines: true },
  });
  const previousByKey = new Map(previous?.lines.filter((l) => l.changeStatus !== "CLEARED").map((l) => [l.identityKey, l]) ?? []);
  const firstSeenByKey = new Map<string, Date>();
  if (previous) {
    for (const line of previous.lines) {
      if (line.changeStatus === "CLEARED") continue;
      if (!firstSeenByKey.has(line.identityKey)) firstSeenByKey.set(line.identityKey, line.firstSeenAt);
    }
  }

  const accounts = await mapAccounts(parsed.rows.map((r) => r.customerAccount));
  const products = await mapProducts(parsed.rows.map((r) => r.partMatchKey));
  const now = new Date();
  const businessDate = utcDateOnly(todayLondonDateOnly(now));

  const outstandingRows = parsed.rows;
  const seenKeys = new Set(outstandingRows.map((r) => r.identityKey));
  const clearedFromPrevious = [...previousByKey.values()].filter((l) => !seenKeys.has(l.identityKey));

  const lineData: Prisma.AutopartBackorderLineCreateManySnapshotInput[] = [];

  function pack(row: Autopart216vRow, status: AutopartBackorderChangeStatus, previousQty: string | null) {
    const firstSeen = firstSeenByKey.get(row.identityKey) ?? now;
    const changed = status !== "UNCHANGED";
    lineData.push({
      identityKey: row.identityKey,
      orderNumber: row.orderNumber,
      customerAccount: row.customerAccount,
      customerNameSnapshot: row.customerName,
      customerOrderRef: row.customerOrderRef,
      partNumber: row.partNumber,
      partMatchKey: row.partMatchKey || skuMatchKey(row.partNumber),
      descriptionSnapshot: row.description,
      outstandingQty: row.outstandingQty,
      unitValue: row.unitValue,
      outstandingValue: row.outstandingValue,
      changeStatus: status,
      previousQty,
      firstSeenAt: firstSeen,
      lastSeenAt: now,
      lastChangedAt: changed ? now : (previousByKey.get(row.identityKey)?.lastChangedAt ?? now),
      lineNumberInFile: row.lineNumber,
      companyId: accounts.get(row.customerAccount.trim().toUpperCase()) ?? null,
      autopartProductId: products.get(row.partMatchKey) ?? null,
    });
  }

  for (const row of outstandingRows) {
    const prev = previousByKey.get(row.identityKey);
    const status = compare216vQty(prev ? prev.outstandingQty.toString() : null, row.outstandingQty);
    pack(row, status, prev ? prev.outstandingQty.toString() : null);
  }
  for (const prev of clearedFromPrevious) {
    lineData.push({
      identityKey: prev.identityKey,
      orderNumber: prev.orderNumber,
      customerAccount: prev.customerAccount,
      customerNameSnapshot: prev.customerNameSnapshot,
      customerOrderRef: prev.customerOrderRef,
      partNumber: prev.partNumber,
      partMatchKey: prev.partMatchKey,
      descriptionSnapshot: prev.descriptionSnapshot,
      outstandingQty: 0,
      unitValue: prev.unitValue,
      outstandingValue: 0,
      changeStatus: "CLEARED",
      previousQty: prev.outstandingQty,
      firstSeenAt: prev.firstSeenAt,
      lastSeenAt: now,
      lastChangedAt: now,
      lineNumberInFile: prev.lineNumberInFile,
      companyId: prev.companyId,
      autopartProductId: prev.autopartProductId,
    });
  }

  const outstanding = lineData.filter((l) => l.changeStatus !== "CLEARED");
  const snapshot = await prisma.autopartBackorderSnapshot.create({
    data: {
      status: "COMMITTED",
      filename: raw.filename ?? "216V.csv",
      fileHash: hash,
      source: raw.source ?? "MANUAL",
      businessDate,
      receivedAt: raw.receivedAt ?? now,
      lineCount: parsed.rows.length,
      outstandingLineCount: outstanding.length,
      orderCount: parsed.orderCount,
      accountCount: parsed.accountCount,
      skuCount: parsed.skuCount,
      outstandingQty: parsed.outstandingQty || 0,
      outstandingValue: parsed.outstandingValue || 0,
      emptyValid: parsed.rows.length === 0,
      previousSnapshotId: previous?.id ?? null,
      createdById: actorUserId,
      diagnostics: {
        errors: parsed.errors,
        emptyCleared: parsed.rows.length === 0,
        clearedCount: clearedFromPrevious.length,
        newCount: outstanding.filter((l) => l.changeStatus === "NEW").length,
      },
      lines: { createMany: { data: lineData } },
    },
  });

  await prisma.autopartBackorderFeedSettings.upsert({
    where: { id: "default" },
    create: { id: "default", lastSuccessAt: now, lastPolledAt: now, configured: true },
    update: { lastSuccessAt: now },
  });

  await recordAuditEvent({
    action: parsed.rows.length === 0 ? "purchasing.backorders.empty_snapshot" : "purchasing.backorders.imported",
    entityType: "AutopartBackorderSnapshot",
    entityId: snapshot.id,
    actorUserId: actorUserId ?? null,
    metadata: {
      filename: raw.filename ?? null,
      source: raw.source ?? "MANUAL",
      lines: parsed.rows.length,
      cleared: clearedFromPrevious.length,
      emptyValid: parsed.rows.length === 0,
    },
  });

  return { id: snapshot.id, duplicate: false as const, status: "COMMITTED" as const, emptyValid: parsed.rows.length === 0 };
}

export async function previewAutopart216vImport(actorUserId: string, raw: { text: string; filename?: string }) {
  await requirePurchasingAccess(actorUserId);
  if (!isAutopart216vReport(raw.text)) {
    throw new AuthError("File does not look like an Autopart 216V report", "VALIDATION", 400);
  }
  const parsed = parseAutopart216vReport(raw.text);
  return {
    headerFound: parsed.headerFound,
    errors: parsed.errors,
    lines: parsed.rows.length,
    orders: parsed.orderCount,
    accounts: parsed.accountCount,
    skus: parsed.skuCount,
    outstandingQty: parsed.outstandingQty,
    outstandingValue: parsed.outstandingValue,
    emptyValid: parsed.rows.length === 0 && isStrongEmpty216vReport(raw.text),
    sample: parsed.rows.slice(0, 20).map((r) => ({
      orderNumber: r.orderNumber,
      account: r.customerAccount,
      name: r.customerName,
      sku: r.partNumber,
      qty: r.outstandingQty,
      value: r.outstandingValue,
    })),
  };
}

export async function requireBackorderManage(actorUserId: string) {
  await requireSystemPermission(actorUserId, "purchasing.manage");
}
