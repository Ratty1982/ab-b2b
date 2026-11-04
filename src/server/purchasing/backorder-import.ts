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
import {
  parseManual216vReportDate,
  pickCurrent216vSnapshot,
  previous216vSnapshot,
  resolveAutopart216vReportDate,
  suggestManual216vReportDate,
} from "@/domain/autopart-216v-report-date";
import { listCommitted216vSnapshots } from "@/server/purchasing/backorder-chronology";
import {
  compare216vQty,
  decodeAutopart216vBytes,
  isAutopart216vReport,
  isCommitted216vSnapshotHash,
  isStrongEmpty216vReport,
  matchAutopart216vAcrossSnapshots,
  parseAutopart216vReport,
  type Autopart216vRow,
} from "@/domain/autopart-216v";

export type Autopart216vImportOutcome = {
  id: string;
  duplicate: boolean;
  status: "COMMITTED";
  emptyValid: boolean;
  filename: string | null;
  fileHash: string;
  orderCount: number;
  lineCount: number;
  accountCount: number;
  outstandingQty: string;
  outstandingValue: string;
  /** True when this file is the current outstanding position after chronology ranking. */
  becameCurrent: boolean;
  /** Observed calendar date. A weekend date is not a verified reporting day. */
  reportDate: string;
  reportDateReview: "WEEKEND_DATE_UNVERIFIED" | null;
  reportDateSource?: string;
  /** Present when duplicate=true — content hash matched an existing COMMITTED snapshot. */
  duplicateOfFilename?: string | null;
  duplicateMessage?: string;
};

function fileHashOf(input: { bytes: Buffer | null; text: string }): string {
  return createHash("sha256")
    .update(input.bytes ?? input.text)
    .digest("hex");
}

function read216vUpload(raw: { text?: string; bytesBase64?: string }): {
  text: string;
  bytes: Buffer | null;
} {
  if (raw.bytesBase64) {
    const bytes = Buffer.from(raw.bytesBase64, "base64");
    return { text: decodeAutopart216vBytes(bytes).text, bytes };
  }
  return { text: raw.text ?? "", bytes: null };
}

function qtyString(value: { toString(): string } | number | null | undefined): string {
  const n = Number(value ?? 0);
  return Number.isInteger(n) ? String(n) : String(n);
}

async function rememberImportError(message: string) {
  await prisma.autopartBackorderFeedSettings
    .upsert({
      where: { id: "default" },
      create: { id: "default", lastError: message },
      update: { lastError: message },
    })
    .catch(() => undefined);
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

function duplicateContentMessage(input: {
  uploadedFilename?: string | null;
  existingFilename: string | null;
  reportDate: string;
  fileHash: string;
}): string {
  const existingName = input.existingFilename?.trim() || "an earlier 216V snapshot";
  const uploaded = input.uploadedFilename?.trim();
  const nameNote =
    uploaded && uploaded !== existingName
      ? ` Your file was named ${uploaded}; the matching snapshot is stored as ${existingName}.`
      : "";
  return (
    `Already imported (${existingName}, report ${input.reportDate}). ` +
    `This rejection is based on identical file content (SHA-256 ${input.fileHash.slice(0, 12)}…), not the filename or report date.` +
    nameNote +
    ` Choosing a different report date cannot create a second snapshot. The previous outstanding position was left unchanged.`
  );
}

export async function confirmAutopart216vImport(
  actorUserId: string | null,
  raw: {
    text?: string;
    bytesBase64?: string;
    filename?: string;
    source?: "MANUAL" | "EMAIL" | "SCHEDULE";
    receivedAt?: Date;
    /** Required for MANUAL. Ignored for email/schedule. Date alone never bypasses content-hash duplicates. */
    confirmedReportDate?: string | null;
    /** Required for MANUAL when the confirmed date would not become the current position. */
    allowHistoricalImport?: boolean;
  },
): Promise<Autopart216vImportOutcome> {
  if (actorUserId) {
    const profile = await requirePurchasingAccess(actorUserId);
    if (raw.source === "MANUAL" && !hasPermission(profile, "purchasing.backorders.manage")) {
      throw new AuthError("Purchasing manage permission required", "FORBIDDEN", 403);
    }
  }
  const upload = read216vUpload(raw);
  const reject = async (message: string): Promise<never> => {
    await rememberImportError(message);
    throw new AuthError(message, "VALIDATION", 400);
  };
  if (!isAutopart216vReport(upload.text, raw.filename)) {
    await reject(
      "File does not look like an Autopart 216V report. The previous snapshot was not replaced.",
    );
  }
  const parsed = parseAutopart216vReport(upload.text);
  if (!parsed.headerFound) {
    await reject("216V header not recognised. The previous snapshot was not replaced.");
  }
  if (parsed.rows.length === 0 && !isStrongEmpty216vReport(upload.text)) {
    const detail = parsed.errors[0] ?? "no readable data rows";
    await reject(
      `216V header was found but no data rows could be read (${detail}). The previous snapshot was not replaced.`,
    );
  }
  if (parsed.errors.length > 0) {
    await reject(
      `216V file was not imported. ${parsed.errors.length} row(s) could not be read, so the previous snapshot was left unchanged. ${parsed.errors.slice(0, 3).join(" ")}`,
    );
  }

  const isManual = raw.source === "MANUAL";
  let confirmedReportDate: string | null = null;
  if (isManual) {
    confirmedReportDate = parseManual216vReportDate(raw.confirmedReportDate);
    if (!confirmedReportDate) {
      await reject(
        "Confirm the 216V report date (YYYY-MM-DD) before importing. The CSV has no reporting date. The previous snapshot was not replaced.",
      );
    }
  }

  const hash = fileHashOf(upload);
  const existing = await prisma.autopartBackorderSnapshot.findUnique({
    where: { fileHash: hash },
    select: {
      id: true,
      status: true,
      filename: true,
      fileHash: true,
      businessDate: true,
      receivedAt: true,
      importedAt: true,
      emptyValid: true,
      orderCount: true,
      lineCount: true,
      accountCount: true,
      outstandingQty: true,
      outstandingValue: true,
    },
  });
  if (
    existing?.status === "COMMITTED" &&
    isCommitted216vSnapshotHash(hash, new Set([existing.fileHash]))
  ) {
    const currentId = pickCurrent216vSnapshot(await listCommitted216vSnapshots())?.id ?? null;
    const existingReport = resolveAutopart216vReportDate(existing);
    const duplicateMessage = duplicateContentMessage({
      uploadedFilename: raw.filename ?? null,
      existingFilename: existing.filename,
      reportDate: existingReport.iso,
      fileHash: existing.fileHash,
    });
    await rememberImportError(duplicateMessage);
    return {
      id: existing.id,
      duplicate: true,
      status: "COMMITTED",
      emptyValid: existing.emptyValid,
      filename: existing.filename,
      fileHash: existing.fileHash,
      orderCount: existing.orderCount,
      lineCount: existing.lineCount,
      accountCount: existing.accountCount,
      outstandingQty: qtyString(existing.outstandingQty),
      outstandingValue: Number(existing.outstandingValue).toFixed(2),
      becameCurrent: currentId === existing.id,
      reportDate: existingReport.iso,
      reportDateReview: existingReport.review,
      reportDateSource: existingReport.source,
      duplicateOfFilename: existing.filename,
      duplicateMessage,
    };
  }

  const accounts = await mapAccounts(parsed.rows.map((r) => r.customerAccount));
  const products = await mapProducts(parsed.rows.map((r) => r.partMatchKey));
  const now = new Date();
  const receivedAt = raw.receivedAt ?? now;
  const report = resolveAutopart216vReportDate({
    filename: raw.filename ?? null,
    receivedAt: isManual ? null : (raw.receivedAt ?? null),
    importedAt: now,
    confirmedReportDate,
  });
  const businessDate = utcDateOnly(report.iso);
  const headers = await listCommitted216vSnapshots();
  const incoming = {
    id: "incoming",
    filename: raw.filename ?? "216V.csv",
    businessDate,
    receivedAt,
    importedAt: now,
  };
  const becameCurrent = pickCurrent216vSnapshot([...headers, incoming])?.id === incoming.id;
  if (isManual && !becameCurrent && !raw.allowHistoricalImport) {
    const current = pickCurrent216vSnapshot(headers);
    const currentReport = current ? resolveAutopart216vReportDate(current).iso : null;
    await reject(
      `Report date ${report.iso} would not replace the current outstanding position` +
        (currentReport ? ` (${current?.filename ?? "current snapshot"}, report ${currentReport})` : "") +
        `. Confirm historical import to save it without changing today's backorders. The previous snapshot was not replaced.`,
    );
  }
  const previousHeader = previous216vSnapshot(headers, incoming);
  const previous = previousHeader
    ? await prisma.autopartBackorderSnapshot.findUnique({
        where: { id: previousHeader.id },
        include: { lines: true },
      })
    : null;
  const previousOutstanding = (previous?.lines ?? []).filter((l) => l.changeStatus !== "CLEARED");
  const matched = matchAutopart216vAcrossSnapshots(previousOutstanding, parsed.rows);

  const lineData: Prisma.AutopartBackorderLineCreateManySnapshotInput[] = [];

  function pack(input: {
    row: Autopart216vRow;
    identityKey: string;
    status: AutopartBackorderChangeStatus;
    previousQty: string | null;
    firstSeenAt: Date;
    lastChangedAt: Date;
  }) {
    lineData.push({
      identityKey: input.identityKey,
      orderNumber: input.row.orderNumber,
      customerAccount: input.row.customerAccount,
      customerNameSnapshot: input.row.customerName,
      customerOrderRef: input.row.customerOrderRef,
      partNumber: input.row.partNumber,
      partMatchKey: input.row.partMatchKey || skuMatchKey(input.row.partNumber),
      descriptionSnapshot: input.row.description,
      outstandingQty: input.row.outstandingQty,
      unitValue: input.row.unitValue,
      outstandingValue: input.row.outstandingValue,
      changeStatus: input.status,
      previousQty: input.previousQty,
      firstSeenAt: input.firstSeenAt,
      lastSeenAt: now,
      lastChangedAt: input.lastChangedAt,
      lineNumberInFile: input.row.lineNumber,
      companyId: accounts.get(input.row.customerAccount.trim().toUpperCase()) ?? null,
      autopartProductId: products.get(input.row.partMatchKey) ?? null,
    });
  }

  for (const pair of matched.matches) {
    const prevQty = pair.previous.outstandingQty.toString();
    const status = compare216vQty(prevQty, pair.next.outstandingQty);
    pack({
      row: pair.next,
      identityKey: pair.continuedIdentityKey,
      status,
      previousQty: prevQty,
      firstSeenAt: pair.previous.firstSeenAt,
      lastChangedAt: status === "UNCHANGED" ? pair.previous.lastChangedAt : now,
    });
  }
  for (const row of matched.unmatchedNext) {
    pack({
      row,
      identityKey: row.identityKey,
      status: "NEW",
      previousQty: null,
      firstSeenAt: now,
      lastChangedAt: now,
    });
  }
  for (const prev of matched.unmatchedPrevious) {
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
      receivedAt,
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
        clearedCount: matched.unmatchedPrevious.length,
        newCount: outstanding.filter((l) => l.changeStatus === "NEW").length,
        identityAmbiguities: matched.ambiguities,
        reportDate: report.iso,
        reportDateSource: report.source,
        reportDateVerified: report.verifiedWorkingDay,
        reportDateReview: report.review,
        filenameDate: report.filenameDate,
        confirmedReportDate: confirmedReportDate,
        becameCurrent,
        allowHistoricalImport: Boolean(raw.allowHistoricalImport),
      },
      lines: { createMany: { data: lineData } },
    },
  });

  await prisma.autopartBackorderFeedSettings.upsert({
    where: { id: "default" },
    create: {
      id: "default",
      lastSuccessAt: now,
      configured: true,
      lastError: null,
    },
    update: { lastSuccessAt: now, lastError: null },
  });

  const actor =
    actorUserId == null
      ? null
      : await prisma.user.findUnique({
          where: { id: actorUserId },
          select: { id: true, email: true, name: true },
        });

  await recordAuditEvent({
    action:
      parsed.rows.length === 0
        ? "purchasing.backorders.empty_snapshot"
        : "purchasing.backorders.imported",
    entityType: "AutopartBackorderSnapshot",
    entityId: snapshot.id,
    actorUserId: actorUserId ?? null,
    metadata: {
      filename: raw.filename ?? null,
      source: raw.source ?? "MANUAL",
      lines: parsed.rows.length,
      cleared: matched.unmatchedPrevious.length,
      emptyValid: parsed.rows.length === 0,
      identityAmbiguities: matched.ambiguities.length,
      reportDate: report.iso,
      reportDateSource: report.source,
      reportDateVerified: report.verifiedWorkingDay,
      reportDateReview: report.review,
      confirmedReportDate: confirmedReportDate,
      filenameDate: report.filenameDate,
      becameCurrent,
      allowHistoricalImport: Boolean(raw.allowHistoricalImport),
      administratorUserId: actor?.id ?? actorUserId ?? null,
      administratorEmail: actor?.email ?? null,
      administratorName: actor?.name ?? null,
    },
  });

  return {
    id: snapshot.id,
    duplicate: false,
    status: "COMMITTED",
    emptyValid: parsed.rows.length === 0,
    filename: snapshot.filename,
    fileHash: hash,
    orderCount: parsed.orderCount,
    lineCount: parsed.rows.length,
    accountCount: parsed.accountCount,
    outstandingQty: parsed.outstandingQty,
    outstandingValue: parsed.outstandingValue,
    becameCurrent,
    reportDate: report.iso,
    reportDateReview: report.review,
    reportDateSource: report.source,
  };
}

export async function previewAutopart216vImport(
  actorUserId: string,
  raw: { text?: string; bytesBase64?: string; filename?: string },
) {
  const profile = await requirePurchasingAccess(actorUserId);
  if (!hasPermission(profile, "purchasing.backorders.view")) {
    throw new AuthError("Purchasing access required", "PURCHASING_FORBIDDEN", 403);
  }
  const upload = read216vUpload(raw);
  if (!isAutopart216vReport(upload.text, raw.filename)) {
    throw new AuthError("File does not look like an Autopart 216V report", "VALIDATION", 400);
  }
  const parsed = parseAutopart216vReport(upload.text);
  return {
    headerFound: parsed.headerFound,
    errors: parsed.errors,
    lines: parsed.rows.length,
    orders: parsed.orderCount,
    accounts: parsed.accountCount,
    skus: parsed.skuCount,
    outstandingQty: parsed.outstandingQty,
    outstandingValue: parsed.outstandingValue,
    emptyValid: parsed.rows.length === 0 && isStrongEmpty216vReport(upload.text),
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
  await requireSystemPermission(actorUserId, "purchasing.backorders.manage");
}
