/**
 * Streamed, size-limited uploads for one customer's sales reports.
 * Files stay in private temporary storage. Preview never creates sales.
 * Confirm reads the same file and the same customer again.
 * This does not revive the retired global 561L/SLRB importer.
 */
import { createHash, randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import { once } from "node:events";
import { finished } from "node:stream/promises";
import type { CustomerSalesUploadRole } from "@prisma/client";
import { prisma } from "@/infra/database/client";
import { autopartImportMaxBytes } from "@/server/companies/autopart-master-import";
import { AuthError } from "@/server/rbac/guards";
import {
  confirmCustomerSalesHistory,
  loadCustomerSalesHistoryTarget,
  previewCustomerSalesHistory,
  requireHistoryImporter,
  type CustomerSalesHistoryPreview,
} from "@/server/companies/customer-sales-history-import";
import {
  confirmCustomerSalesImport,
  previewCustomerSalesImport,
  requireCustomerSalesImporter,
  type CustomerSalesPreview,
} from "@/server/companies/customer-sales-import";
import { streamFilterReport } from "@/server/companies/customer-sales-report-filter";

const UPLOAD_TTL_MS = 48 * 60 * 60 * 1000;
const STALE_PROCESSING_MS = 15 * 60 * 1000;
const PREVIEW_SAMPLE_LIMIT = 200;
const DEFAULT_SAMPLE_PAGE_SIZE = 25;

export type SavedCustomerSalesUpload = {
  uploadId: string;
  filename: string;
  bytes: number;
  sha256: string;
  role: CustomerSalesUploadRole;
  expiresAt: string;
};

type SamplePage = {
  samplePage: number;
  samplePageSize: number;
  samplePages: number;
};

export type CustomerSalesHistoryUploadPreview = CustomerSalesHistoryPreview & SamplePage & {
  rowsRead: number;
  matchingRows: number;
  otherCustomerRows: number;
  byteSize: number;
  sampleTruncated: boolean;
  upload561lId: string | null;
  uploadSlrbId: string | null;
};

export type CustomerSalesImportUploadPreview = CustomerSalesPreview & SamplePage & {
  rowsRead: number;
  matchingRows: number;
  otherCustomerRows: number;
  byteSize: number;
  sampleTruncated: boolean;
  uploadId: string;
};

export function customerSalesUploadRoot(): string {
  return process.env["CUSTOMER_SALES_UPLOAD_DIR"] || path.join(process.cwd(), "data", "customer-sales-uploads");
}

function assertInsideRoot(filePath: string): string {
  const root = path.resolve(customerSalesUploadRoot());
  const resolved = path.resolve(filePath);
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
    throw new AuthError("Upload path is not in private storage", "VALIDATION", 400);
  }
  return resolved;
}

function safeFilename(filename: string): string {
  const safe = filename.replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^\.+/, "").slice(0, 80);
  if (!safe) throw new AuthError("Filename is required", "VALIDATION", 400);
  return safe;
}

function sliceSample<T>(rows: T[], samplePage?: number, samplePageSize?: number) {
  const pageSize = Math.min(50, Math.max(1, Math.floor(samplePageSize ?? DEFAULT_SAMPLE_PAGE_SIZE)));
  const samplePages = Math.max(1, Math.ceil(rows.length / pageSize));
  const page = Math.min(samplePages, Math.max(1, Math.floor(samplePage ?? 1)));
  return {
    rows: rows.slice((page - 1) * pageSize, page * pageSize),
    samplePage: page,
    samplePageSize: pageSize,
    samplePages,
  };
}

async function hashStoredFile(filePath: string): Promise<string> {
  const hash = createHash("sha256");
  const stream = createReadStream(assertInsideRoot(filePath));
  for await (const chunk of stream) hash.update(chunk);
  return hash.digest("hex");
}

export async function deleteExpiredCustomerSalesUploads(limit = 20) {
  const expired = await prisma.customerSalesUpload.findMany({
    where: {
      expiresAt: { lt: new Date() },
      status: { in: ["STORED", "PREVIEWED", "COMMITTED", "FAILED"] },
    },
    take: limit,
    select: { id: true, storagePath: true },
  });
  for (const row of expired) {
    if (row.storagePath) {
      try {
        await rm(assertInsideRoot(row.storagePath), { force: true });
      } catch {
        // A path outside private storage is left untouched.
      }
    }
    await prisma.customerSalesUpload.update({ where: { id: row.id }, data: { status: "EXPIRED" } });
  }
}

async function requireUploadPermission(actorUserId: string, role: CustomerSalesUploadRole) {
  if (role === "ONGOING") await requireCustomerSalesImporter(actorUserId);
  else await requireHistoryImporter(actorUserId);
}

export async function saveCustomerSalesUpload(input: {
  actorUserId: string;
  companyId: string;
  filename: string;
  role: CustomerSalesUploadRole;
  body: ReadableStream<Uint8Array> | null;
  maxBytes?: number;
}): Promise<SavedCustomerSalesUpload> {
  await requireUploadPermission(input.actorUserId, input.role);
  const company = await prisma.company.findUnique({ where: { id: input.companyId }, select: { id: true } });
  if (!company) throw new AuthError("Customer not found", "NOT_FOUND", 404);
  if (!input.body) throw new AuthError("Upload body is empty", "VALIDATION", 400);
  const maxBytes = input.maxBytes ?? autopartImportMaxBytes();
  const filename = safeFilename(input.filename);
  await deleteExpiredCustomerSalesUploads().catch(() => undefined);
  await mkdir(customerSalesUploadRoot(), { recursive: true });
  const dest = assertInsideRoot(path.join(customerSalesUploadRoot(), `${randomUUID()}-${filename}`));
  const hash = createHash("sha256");
  const ws = createWriteStream(dest, { flags: "wx" });
  const reader = input.body.getReader();
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      bytes += value.byteLength;
      if (bytes > maxBytes) {
        await reader.cancel();
        throw new AuthError(
          `File is ${bytes.toLocaleString("en-GB")} bytes and the upload limit is ${maxBytes.toLocaleString("en-GB")} bytes. Choose a smaller report. No sales records were written.`,
          "VALIDATION",
          400,
        );
      }
      hash.update(value);
      if (!ws.write(value)) await once(ws, "drain");
    }
    if (bytes === 0) throw new AuthError("Upload body is empty", "VALIDATION", 400);
    ws.end();
    await finished(ws);
  } catch (error) {
    ws.destroy();
    await rm(dest, { force: true });
    throw error;
  }
  const sha256 = hash.digest("hex");
  const expiresAt = new Date(Date.now() + UPLOAD_TTL_MS);
  try {
    const saved = await prisma.customerSalesUpload.create({
      data: {
        companyId: company.id,
        createdById: input.actorUserId,
        role: input.role,
        status: "STORED",
        filename,
        storagePath: dest,
        byteSize: bytes,
        sha256,
        expiresAt,
      },
    });
    return {
      uploadId: saved.id,
      filename: saved.filename,
      bytes: saved.byteSize,
      sha256: saved.sha256,
      role: saved.role,
      expiresAt: saved.expiresAt.toISOString(),
    };
  } catch (error) {
    await rm(dest, { force: true });
    throw error;
  }
}

async function loadUpload(input: {
  actorUserId: string;
  uploadId: string;
  companyId: string;
  role: CustomerSalesUploadRole;
}) {
  await requireUploadPermission(input.actorUserId, input.role);
  const upload = await prisma.customerSalesUpload.findUnique({ where: { id: input.uploadId } });
  if (!upload) throw new AuthError("Upload was not found. Choose the report again.", "NOT_FOUND", 404);
  if (upload.companyId !== input.companyId) {
    throw new AuthError("This upload belongs to a different customer. No sales records were written.", "VALIDATION", 400);
  }
  if (upload.role !== input.role) {
    throw new AuthError("This upload is not the selected report type. No sales records were written.", "VALIDATION", 400);
  }
  if (upload.status === "PROCESSING" && upload.updatedAt.getTime() > Date.now() - STALE_PROCESSING_MS) {
    throw new AuthError(
      "This upload is already being imported. Wait for it to finish, then retry. No extra sales records were written.",
      "VALIDATION",
      409,
    );
  }
  if (upload.status === "EXPIRED" || upload.expiresAt.getTime() <= Date.now()) {
    throw new AuthError("This upload has expired. Upload the report again. No sales records were written.", "VALIDATION", 400);
  }
  if (!upload.storagePath) throw new AuthError("The uploaded report is no longer stored.", "VALIDATION", 400);
  const filePath = assertInsideRoot(upload.storagePath);
  try {
    await stat(filePath);
  } catch {
    throw new AuthError("The uploaded report is no longer stored. Upload it again.", "VALIDATION", 400);
  }
  const actual = await hashStoredFile(filePath);
  if (actual !== upload.sha256) {
    throw new AuthError(
      "Uploaded file hash does not match the stored file. No sales records were written.",
      "VALIDATION",
      409,
    );
  }
  return { ...upload, storagePath: filePath };
}

async function verifiedAccountCodes(companyId: string): Promise<string[]> {
  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: {
      autopartCustomerCode: true,
      autopartAccountAliases: { select: { alias: true } },
    },
  });
  return [company?.autopartCustomerCode ?? "", ...(company?.autopartAccountAliases.map((alias) => alias.alias) ?? [])]
    .map((code) => code.trim().toUpperCase())
    .filter(Boolean);
}

async function classify504Batch(companyId: string, rows: { raw: string; document: string; orderNumber: string }[]) {
  const orders = [...new Set(rows.map((row) => row.orderNumber.trim()).filter(Boolean))];
  const documents = [...new Set(rows.map((row) => row.document.trim()).filter(Boolean))];
  const ownedOrders = new Set(
    orders.length
      ? (
          await prisma.order.findMany({
            where: { companyId, orderNumber: { in: orders } },
            select: { orderNumber: true },
          })
        ).map((order) => order.orderNumber)
      : [],
  );
  const ownedDocuments = new Set(
    documents.length
      ? (
          await prisma.autopartSalesDocument.findMany({
            where: { companyId, documentReference: { in: documents } },
            select: { documentReference: true },
          })
        ).map((document) => document.documentReference)
      : [],
  );
  return rows.map((row) => {
    const orderNumber = row.orderNumber.trim();
    const document = row.document.trim();
    return Boolean((orderNumber && ownedOrders.has(orderNumber)) || (document && ownedDocuments.has(document)));
  });
}

function statsMessage(rowsRead: number, matchingRows: number, otherCustomerRows: number, byteSize: number) {
  return `Read ${rowsRead.toLocaleString("en-GB")} rows in ${byteSize.toLocaleString("en-GB")} bytes. ${matchingRows.toLocaleString("en-GB")} match this customer. ${otherCustomerRows.toLocaleString("en-GB")} belong to other customers and are not imported.`;
}

async function claimUploads(ids: string[]) {
  const staleBefore = new Date(Date.now() - STALE_PROCESSING_MS);
  const claimed: string[] = [];
  try {
    for (const id of ids) {
      const result = await prisma.customerSalesUpload.updateMany({
        where: {
          id,
          OR: [
            { status: { in: ["STORED", "PREVIEWED", "COMMITTED", "FAILED"] } },
            { status: "PROCESSING", updatedAt: { lt: staleBefore } },
          ],
        },
        data: { status: "PROCESSING" },
      });
      if (result.count !== 1) {
        throw new AuthError(
          "This upload is already being imported. Wait for it to finish, then retry. No extra sales records were written.",
          "VALIDATION",
          409,
        );
      }
      claimed.push(id);
    }
  } catch (error) {
    if (claimed.length) {
      await prisma.customerSalesUpload.updateMany({
        where: { id: { in: claimed } },
        data: { status: "PREVIEWED" },
      });
    }
    throw error;
  }
}

async function markUploads(ids: string[], status: "COMMITTED" | "FAILED" | "PREVIEWED") {
  if (!ids.length) return;
  await prisma.customerSalesUpload.updateMany({ where: { id: { in: ids } }, data: { status } });
}

export async function previewCustomerSalesHistoryUpload(
  actorUserId: string,
  input: {
    companyId: string;
    upload561lId?: string;
    uploadSlrbId?: string;
    samplePage?: number;
    samplePageSize?: number;
  },
): Promise<CustomerSalesHistoryUploadPreview> {
  if (!input.upload561lId && !input.uploadSlrbId) {
    throw new AuthError("Choose a 561L report, an SLRB report, or both.", "VALIDATION", 400);
  }
  const upload561l = input.upload561lId
    ? await loadUpload({ actorUserId, uploadId: input.upload561lId, companyId: input.companyId, role: "HISTORY_561L" })
    : null;
  const uploadSlrb = input.uploadSlrbId
    ? await loadUpload({ actorUserId, uploadId: input.uploadSlrbId, companyId: input.companyId, role: "HISTORY_SLRB" })
    : null;
  const target = await loadCustomerSalesHistoryTarget(input.companyId);
  const filtered561l = upload561l
    ? await streamFilterReport({ filePath: upload561l.storagePath, mode: "HISTORY_561L", accountCodes: target.codes })
    : null;
  const filteredSlrb = uploadSlrb
    ? await streamFilterReport({ filePath: uploadSlrb.storagePath, mode: "HISTORY_SLRB", accountCodes: target.codes })
    : null;
  const preview = await previewCustomerSalesHistory(
    actorUserId,
    {
      companyId: input.companyId,
      ...(filtered561l && upload561l ? { text561l: filtered561l.text, filename561l: upload561l.filename } : {}),
      ...(filteredSlrb && uploadSlrb ? { textSlrb: filteredSlrb.text, filenameSlrb: uploadSlrb.filename } : {}),
    },
    { bounded: true, sampleLimit: PREVIEW_SAMPLE_LIMIT },
  );
  const rowsRead = (filtered561l?.rowsRead ?? 0) + (filteredSlrb?.rowsRead ?? 0);
  const matchingRows = (filtered561l?.matchingRows ?? 0) + (filteredSlrb?.matchingRows ?? 0);
  const otherCustomerRows = (filtered561l?.otherCustomerRows ?? 0) + (filteredSlrb?.otherCustomerRows ?? 0);
  const byteSize = (upload561l?.byteSize ?? 0) + (uploadSlrb?.byteSize ?? 0);
  const outcomeCount = preview.counts.import + preview.counts.duplicate + preview.counts.ledger + preview.counts.rejected;
  const page = sliceSample(preview.rows, input.samplePage, input.samplePageSize);
  const previewIds = [upload561l?.id, uploadSlrb?.id].filter((id): id is string => Boolean(id));
  await prisma.customerSalesUpload.updateMany({
    where: { id: { in: previewIds }, status: { in: ["STORED", "FAILED", "PREVIEWED"] } },
    data: { status: "PREVIEWED" },
  });
  return {
    ...preview,
    rows: page.rows,
    message: [preview.message, statsMessage(rowsRead, matchingRows, otherCustomerRows, byteSize)].filter(Boolean).join(" "),
    rowsRead,
    matchingRows,
    otherCustomerRows,
    byteSize,
    samplePage: page.samplePage,
    samplePageSize: page.samplePageSize,
    samplePages: page.samplePages,
    sampleTruncated: outcomeCount > preview.rows.length,
    upload561lId: upload561l?.id ?? null,
    uploadSlrbId: uploadSlrb?.id ?? null,
  };
}

export async function confirmCustomerSalesHistoryUpload(
  actorUserId: string,
  input: { companyId: string; upload561lId?: string; uploadSlrbId?: string },
) {
  if (!input.upload561lId && !input.uploadSlrbId) {
    throw new AuthError("Choose a 561L report, an SLRB report, or both.", "VALIDATION", 400);
  }
  const upload561l = input.upload561lId
    ? await loadUpload({ actorUserId, uploadId: input.upload561lId, companyId: input.companyId, role: "HISTORY_561L" })
    : null;
  const uploadSlrb = input.uploadSlrbId
    ? await loadUpload({ actorUserId, uploadId: input.uploadSlrbId, companyId: input.companyId, role: "HISTORY_SLRB" })
    : null;
  const ids = [upload561l?.id, uploadSlrb?.id].filter((id): id is string => Boolean(id));
  await claimUploads(ids);
  try {
    const target = await loadCustomerSalesHistoryTarget(input.companyId);
    const filtered561l = upload561l
      ? await streamFilterReport({ filePath: upload561l.storagePath, mode: "HISTORY_561L", accountCodes: target.codes })
      : null;
    const filteredSlrb = uploadSlrb
      ? await streamFilterReport({ filePath: uploadSlrb.storagePath, mode: "HISTORY_SLRB", accountCodes: target.codes })
      : null;
    const result = await confirmCustomerSalesHistory(
      actorUserId,
      {
        companyId: input.companyId,
        ...(filtered561l && upload561l ? { text561l: filtered561l.text, filename561l: upload561l.filename } : {}),
        ...(filteredSlrb && uploadSlrb ? { textSlrb: filteredSlrb.text, filenameSlrb: uploadSlrb.filename } : {}),
      },
      {
        bounded: true,
        ...(upload561l ? { sourceSha256561l: upload561l.sha256 } : { sourceSha256561l: null }),
        ...(uploadSlrb ? { sourceSha256Slrb: uploadSlrb.sha256 } : { sourceSha256Slrb: null }),
        rowsRead: (filtered561l?.rowsRead ?? 0) + (filteredSlrb?.rowsRead ?? 0),
        otherCustomerRows: (filtered561l?.otherCustomerRows ?? 0) + (filteredSlrb?.otherCustomerRows ?? 0),
      },
    );
    await markUploads(ids, "COMMITTED");
    return {
      ...result,
      rowsRead: (filtered561l?.rowsRead ?? 0) + (filteredSlrb?.rowsRead ?? 0),
      matchingRows: (filtered561l?.matchingRows ?? 0) + (filteredSlrb?.matchingRows ?? 0),
      otherCustomerRows: (filtered561l?.otherCustomerRows ?? 0) + (filteredSlrb?.otherCustomerRows ?? 0),
      byteSize: (upload561l?.byteSize ?? 0) + (uploadSlrb?.byteSize ?? 0),
    };
  } catch (error) {
    await markUploads(ids, "FAILED");
    throw error;
  }
}

export async function previewCustomerSalesImportUpload(
  actorUserId: string,
  input: { companyId: string; accountCode: string; uploadId: string; samplePage?: number; samplePageSize?: number },
): Promise<CustomerSalesImportUploadPreview> {
  const upload = await loadUpload({
    actorUserId,
    uploadId: input.uploadId,
    companyId: input.companyId,
    role: "ONGOING",
  });
  if (upload.accountCode && upload.accountCode !== input.accountCode.trim().toUpperCase()) {
    throw new AuthError(
      "Preview must use the verified account already selected for this upload.",
      "VALIDATION",
      400,
    );
  }
  const filtered = await streamFilterReport({
    filePath: upload.storagePath,
    mode: "ONGOING",
    accountCodes: await verifiedAccountCodes(input.companyId),
    classify504Batch: (rows) => classify504Batch(input.companyId, rows),
  });
  const preview = await previewCustomerSalesImport(
    actorUserId,
    { companyId: input.companyId, accountCode: input.accountCode, text: filtered.text, filename: upload.filename },
    { bounded: true, sampleLimit: PREVIEW_SAMPLE_LIMIT },
  );
  const outcomeCount =
    preview.counts.import + preview.counts.update + preview.counts.duplicate + preview.counts.skipped + preview.counts.rejected;
  const page = sliceSample(preview.rows, input.samplePage, input.samplePageSize);
  await prisma.customerSalesUpload.update({
    where: { id: upload.id },
    data: { status: "PREVIEWED", accountCode: preview.accountCode },
  });
  const baseMessage = preview.message ?? "Preview shows proposed changes and does not create sales records.";
  return {
    ...preview,
    rows: page.rows,
    message: `${baseMessage} ${statsMessage(filtered.rowsRead, filtered.matchingRows, filtered.otherCustomerRows, upload.byteSize)}`,
    rowsRead: filtered.rowsRead,
    matchingRows: filtered.matchingRows,
    otherCustomerRows: filtered.otherCustomerRows,
    byteSize: upload.byteSize,
    samplePage: page.samplePage,
    samplePageSize: page.samplePageSize,
    samplePages: page.samplePages,
    sampleTruncated: outcomeCount > preview.rows.length,
    uploadId: upload.id,
  };
}

export async function confirmCustomerSalesImportUpload(
  actorUserId: string,
  input: { companyId: string; accountCode: string; uploadId: string },
) {
  const upload = await loadUpload({
    actorUserId,
    uploadId: input.uploadId,
    companyId: input.companyId,
    role: "ONGOING",
  });
  const selected = input.accountCode.trim().toUpperCase();
  if (upload.accountCode && upload.accountCode !== selected) {
    throw new AuthError(
      "Confirm import must use the same verified account as the preview. No sales records were written.",
      "VALIDATION",
      400,
    );
  }
  await claimUploads([upload.id]);
  try {
    const filtered = await streamFilterReport({
      filePath: upload.storagePath,
      mode: "ONGOING",
      accountCodes: await verifiedAccountCodes(input.companyId),
      classify504Batch: (rows) => classify504Batch(input.companyId, rows),
    });
    const result = await confirmCustomerSalesImport(
      actorUserId,
      { companyId: input.companyId, accountCode: selected, text: filtered.text, filename: upload.filename },
      { bounded: true },
    );
    await prisma.customerSalesUpload.update({
      where: { id: upload.id },
      data: { status: "COMMITTED", accountCode: selected },
    });
    return {
      ...result,
      rowsRead: filtered.rowsRead,
      matchingRows: filtered.matchingRows,
      otherCustomerRows: filtered.otherCustomerRows,
      byteSize: upload.byteSize,
    };
  } catch (error) {
    await markUploads([upload.id], "FAILED");
    throw error;
  }
}
