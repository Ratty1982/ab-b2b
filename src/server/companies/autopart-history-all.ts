/**
 * One 561L-ALL file and one SLRB-ALL file.
 * Original bytes are hashed before decoding and stored under the private import directory.
 * Verified accounts update customer sales documents. Other accounts are staged.
 * A later file lists historical documents it no longer contains. Those rows stay until
 * an operator retires that exact list. Ongoing 504/TRM documents are never in that list.
 */
import { createHash, randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { once } from "node:events";
import { finished } from "node:stream/promises";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { parseInvAndLn } from "@/domain/autopart-561l";
import {
  fingerprintAutopartFile,
  forEachAutopartCsvRecord,
  type AutopartCsvRecord,
} from "@/domain/autopart-csv-stream";
import {
  classifyHistoricAccount,
  minorToMoney,
  moneyToMinor,
  type HistoricAccountDirectory,
  type HistoricAccountTarget,
} from "@/domain/historic-all-file";
import { describeDatabaseUrl } from "@/domain/customer-data-reset";
import { describeHistoricEnvironment, describeHistoricStorage } from "@/domain/historic-runtime";
import {
  claimHistoricImport,
  continueHistoricImportProcess,
  recoverAbandonedHistoricImports,
  finishHistoricImport,
  HistoricImportFenced,
  readOwnedFence,
  releaseHistoricImportProcess,
  reserveHistoricImportProcess,
  updateOwnedHistoricImport,
  withHistoricImportFence,
} from "@/server/companies/historic-import-lock";
import { mapSlrbDocumentType } from "@/domain/autopart-slrb";
import { parseAutopartDateOnly } from "@/domain/autopart-report-money";
import { prisma } from "@/infra/database/client";
import { recordAuditEvent } from "@/server/audit/record";
import {
  autopartImportMaxBytes,
  autopartImportRoot,
} from "@/server/companies/autopart-master-import";
import {
  clearMatchedHistoricComparisons,
  closeHistoricAccountWrite,
  openHistoricAccountWrite,
  stampHistoricDocumentComparison,
  writeHistoricAccountBatch,
} from "@/server/companies/autopart-history";
import { AuthError, requireSystemPermission } from "@/server/rbac/guards";

export const HISTORIC_SNAPSHOT_RETIRE_PHRASE = "RETIRE ABSENT HISTORICAL DOCUMENTS";
export const HISTORIC_VERIFY_PHRASE = "VERIFY HISTORIC ACCOUNT";

const ONGOING_SOURCES = ["ONGOING_504", "ONGOING_TRM21QC", "ONGOING_504_BRIDGE"] as const;
const BATCH = 500;

export { claimHistoricImport, recoverAbandonedHistoricImports };

async function failSupersededAccountRuns(importId: string) {
  await prisma.autopartCustomerImportRun.updateMany({
    where: {
      status: "PROCESSING",
      type: "HISTORY_561L_SLRB",
      diagnostics: { path: ["allImportId"], equals: importId },
    },
    data: { status: "FAILED", completedAt: new Date() },
  });
}

type DocAccum = {
  account: string;
  documentType: "INVOICE" | "CREDIT";
  documentReference: string;
  documentDate: string | null;
  goodsMinor: number | null;
  vatMinor: number | null;
  grossMinor: number | null;
  ledgerRows: number;
  lineMinor: number;
  lineCount: number;
};

type StoredFile = {
  path: string;
  filename: string;
  sha256: string;
  bytes: number;
  encoding: "utf-8" | "windows-1252";
};

class ImportInterrupted extends Error {
  constructor(readonly linesSeen: number) {
    super("Import stopped before completion");
  }
}

export async function saveHistoricUpload(input: {
  actorUserId: string;
  slot: "561l" | "slrb";
  filename: string;
  body: ReadableStream<Uint8Array> | null;
  importId?: string | null;
}): Promise<{ importId: string; sha256: string; bytes: number; encoding: string }> {
  await requireSystemPermission(input.actorUserId, "autopart.import.manage");
  if (!input.body) throw new AuthError("Upload body is empty", "VALIDATION", 400);
  const safeName = input.filename.replace(/[^A-Za-z0-9._()-]+/g, "_").replace(/^\.+/, "").slice(0, 80);
  if (!safeName) throw new AuthError("Filename is required", "VALIDATION", 400);
  await mkdir(path.join(autopartImportRoot(), "history"), { recursive: true });
  const dest = path.join(autopartImportRoot(), "history", `${randomUUID()}-${safeName}`);
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
      if (bytes > autopartImportMaxBytes()) {
        await reader.cancel();
        throw new AuthError("File exceeds the Autopart upload limit", "VALIDATION", 400);
      }
      hash.update(value);
      if (!ws.write(value)) await once(ws, "drain");
    }
    ws.end();
    await finished(ws);
  } catch (error) {
    ws.destroy();
    await rm(dest, { force: true });
    throw error;
  }
  const sha256 = hash.digest("hex");
  const fingerprint = await fingerprintAutopartFile(dest);
  if (fingerprint.sha256 !== sha256 || fingerprint.bytes !== bytes) {
    await rm(dest, { force: true });
    throw new AuthError("Stored file does not match the uploaded bytes", "VALIDATION", 400);
  }
  const data =
    input.slot === "561l"
      ? {
          filename561l: safeName,
          fileHash561l: sha256,
          storagePath561l: dest,
          encoding561l: fingerprint.encoding,
        }
      : {
          filenameSlrb: safeName,
          fileHashSlrb: sha256,
          storagePathSlrb: dest,
          encodingSlrb: fingerprint.encoding,
        };
  if (input.importId) {
    const existing = await prisma.autopartHistoryAllImport.findUnique({ where: { id: input.importId } });
    if (!existing || existing.status === "COMMITTED") {
      throw new AuthError("Upload target was not found", "NOT_FOUND", 404);
    }
    await prisma.autopartHistoryAllImport.update({ where: { id: input.importId }, data });
    return { importId: input.importId, sha256, bytes, encoding: fingerprint.encoding };
  }
  const created = await prisma.autopartHistoryAllImport.create({
    data: {
      status: "PREVIEWED",
      fileHash561l: input.slot === "561l" ? sha256 : "pending",
      ...data,
      createdById: input.actorUserId,
    },
  });
  return { importId: created.id, sha256, bytes, encoding: fingerprint.encoding };
}

export async function previewStoredHistoricImport(actorUserId: string, importId: string) {
  await requireSystemPermission(actorUserId, "autopart.import.view");
  const row = await prisma.autopartHistoryAllImport.findUnique({ where: { id: importId } });
  if (!row?.storagePath561l || !row.storagePathSlrb || !row.encoding561l || !row.encodingSlrb) {
    throw new AuthError("Upload both the 561L-ALL and SLRB-ALL files before preview", "VALIDATION", 400);
  }
  const summary = await summariseHistoricFiles(
    { path: row.storagePath561l, encoding: row.encoding561l as "utf-8" | "windows-1252" },
    { path: row.storagePathSlrb, encoding: row.encodingSlrb as "utf-8" | "windows-1252" },
  );
  if (row.status !== "COMMITTED" && row.status !== "PROCESSING") {
    await prisma.autopartHistoryAllImport.update({
      where: { id: importId },
      data: {
        status: "PREVIEWED",
        parsed561l: summary.parsed561,
        parsedSlrb: summary.parsedSlrb,
        malformed561l: summary.malformed561,
        malformedSlrb: summary.malformedSlrb,
        excludedLedger: summary.excludedLedger,
        accountsRead: summary.matchedAccounts + summary.unmatchedAccounts,
        accountsCommitted: summary.matchedAccounts,
        accountsReviewed: summary.unmatchedAccounts,
        discrepancyCount: summary.discrepancyCount,
        summary: summary as Prisma.InputJsonValue,
      },
    });
  }
  return summary;
}

export async function confirmAllHistoricImport(actorUserId: string, raw: unknown) {
  await requireSystemPermission(actorUserId, "autopart.import.manage");
  const input = z
    .object({
      file561l: z.string().min(1),
      fileSlrb: z.string().min(1),
      filename561l: z.string().max(260).optional(),
      filenameSlrb: z.string().max(260).optional(),
    })
    .parse(raw);
  const [file561, fileSlrb] = await Promise.all([
    writeText(input.filename561l ?? "561L-ALL.CSV", input.file561l),
    writeText(input.filenameSlrb ?? "SLRB-ALL.CSV", input.fileSlrb),
  ]);
  const created = await prisma.autopartHistoryAllImport.create({
    data: {
      status: "PREVIEWED",
      filename561l: file561.filename,
      filenameSlrb: fileSlrb.filename,
      fileHash561l: file561.sha256,
      fileHashSlrb: fileSlrb.sha256,
      storagePath561l: file561.path,
      storagePathSlrb: fileSlrb.path,
      encoding561l: file561.encoding,
      encodingSlrb: fileSlrb.encoding,
      createdById: actorUserId,
    },
  });
  return runAllHistoricImport(created.id, actorUserId, { wait: true });
}

export async function startStoredHistoricImport(actorUserId: string, importId: string) {
  await requireSystemPermission(actorUserId, "autopart.import.manage");
  const row = await prisma.autopartHistoryAllImport.findUnique({ where: { id: importId } });
  if (!row?.storagePath561l || !row.storagePathSlrb) {
    throw new AuthError("Upload both files before importing", "VALIDATION", 400);
  }
  if (row.status === "COMMITTED") {
    return { importId, status: "COMMITTED" as const, async: false as const };
  }
  reserveHistoricImportProcess(importId);
  try {
    const claim = await claimHistoricImport(importId);
    if (claim.status === "missing") {
      releaseHistoricImportProcess(importId);
      throw new AuthError("Import not found", "NOT_FOUND", 404);
    }
    if (claim.status === "busy") {
      releaseHistoricImportProcess(importId);
      throw new AuthError("Another historical import is already running", "IMPORT_IN_PROGRESS", 409);
    }
    if (claim.status === "committed") {
      releaseHistoricImportProcess(importId);
      return { importId, status: "COMMITTED" as const, async: false as const };
    }
    void runAllHistoricImport(importId, actorUserId, {
      wait: true,
      claimed: true,
      processHeld: true,
      fence: claim.fence,
    }).catch((error) => {
      console.error("[ab:history-all] background import failed", error);
    });
    return { importId, status: "PROCESSING" as const, async: true as const };
  } catch (error) {
    releaseHistoricImportProcess(importId);
    throw error;
  }
}

export async function runAllHistoricImport(
  importId: string,
  actorUserId: string,
  options?: { wait?: boolean; stopAfterLines?: number; claimed?: boolean; processHeld?: boolean; fence?: bigint },
) {
  if (options?.processHeld) continueHistoricImportProcess(importId);
  else reserveHistoricImportProcess(importId);
  try {
    return await runClaimedHistoricImport(importId, actorUserId, options);
  } finally {
    releaseHistoricImportProcess(importId);
  }
}

async function runClaimedHistoricImport(
  importId: string,
  actorUserId: string,
  options?: { wait?: boolean; stopAfterLines?: number; claimed?: boolean; processHeld?: boolean; fence?: bigint },
) {
  const row = await prisma.autopartHistoryAllImport.findUnique({ where: { id: importId } });
  if (!row?.storagePath561l || !row.storagePathSlrb || !row.encoding561l || !row.encodingSlrb) {
    throw new AuthError("The stored ALL files are incomplete", "VALIDATION", 400);
  }
  const started = Date.now();
  let peak = process.memoryUsage().rss;
  const sample = () => {
    peak = Math.max(peak, process.memoryUsage().rss);
  };
  let fence: bigint | null = null;
  try {
    if (options?.claimed) {
      fence = options.fence ?? (await readOwnedFence(importId));
    } else {
      const claim = await claimHistoricImport(importId);
      if (claim.status === "missing") throw new AuthError("Import not found", "NOT_FOUND", 404);
      if (claim.status === "busy") throw new AuthError("Another historical import is already running", "IMPORT_IN_PROGRESS", 409);
      if (claim.status === "committed") {
        return {
          importId,
          status: "COMMITTED" as const,
          accountsCommitted: 0,
          accountsReviewed: 0,
          documentsWritten: 0,
          linesWritten: 0,
          elapsedMs: 0,
          peakRssBytes: process.memoryUsage().rss,
          accounts: [],
        };
      }
      fence = claim.fence;
    }
    const result = await executeImport({
      importId,
      actorUserId,
      file561: {
        path: row.storagePath561l,
        filename: row.filename561l ?? "561L-ALL.CSV",
        sha256: row.fileHash561l,
        bytes: 0,
        encoding: row.encoding561l as "utf-8" | "windows-1252",
      },
      fileSlrb: {
        path: row.storagePathSlrb,
        filename: row.filenameSlrb ?? "SLRB-ALL.CSV",
        sha256: row.fileHashSlrb ?? "",
        bytes: 0,
        encoding: row.encodingSlrb as "utf-8" | "windows-1252",
      },
      ...(options?.stopAfterLines != null ? { stopAfterLines: options.stopAfterLines } : {}),
      fence,
      sample,
    });
    const elapsedMs = Date.now() - started;
    sample();
    const committed = await finishOwnedImport(importId, fence, {
      status: "COMMITTED",
      completedAt: new Date(),
      elapsedMs,
      peakRssBytes: peak,
      ...result.counts,
      summary: result.summary as Prisma.InputJsonValue,
    });
    if (!committed) return { importId, status: "FENCED" as const };
    await recordAuditEvent({
      action: "autopart.history_all_imported",
      entityType: "AutopartHistoryAllImport",
      entityId: importId,
      actorUserId,
      after: { importId, ...result.counts, elapsedMs, peakRssBytes: peak },
    });
    return {
      importId,
      status: "COMMITTED" as const,
      accountsCommitted: result.counts.accountsCommitted,
      accountsReviewed: result.counts.accountsReviewed,
      documentsWritten: result.counts.documentsWritten,
      linesWritten: result.counts.importedLineCount,
      elapsedMs,
      peakRssBytes: peak,
      accounts: result.accountSample,
    };
  } catch (error) {
    if (error instanceof HistoricImportFenced || fence == null) {
      if (error instanceof HistoricImportFenced) return { importId, status: "FENCED" as const };
      throw error;
    }
    const interrupted = error instanceof ImportInterrupted;
    try {
      await withHistoricImportFence(importId, fence, () => failSupersededAccountRuns(importId));
    } catch (fenceError) {
      if (fenceError instanceof HistoricImportFenced) return { importId, status: "FENCED" as const };
      throw fenceError;
    }
    const failed = await finishOwnedImport(importId, fence, {
      status: "FAILED",
      completedAt: new Date(),
      elapsedMs: Date.now() - started,
      peakRssBytes: peak,
      summary: {
        recoverable: true,
        interrupted,
        ...(interrupted ? { linesSeen: error.linesSeen } : {}),
        message: error instanceof Error ? error.message : "Import failed",
      } as Prisma.InputJsonValue,
    });
    if (!failed) return { importId, status: "FENCED" as const };
    if (interrupted) {
      return { importId, status: "FAILED" as const, recoverable: true as const, linesSeen: error.linesSeen };
    }
    throw error;
  }
}

async function finishOwnedImport(
  importId: string,
  fence: bigint,
  data: Prisma.AutopartHistoryAllImportUpdateManyMutationInput,
): Promise<boolean> {
  try {
    return await finishHistoricImport(importId, fence, data);
  } catch (error) {
    if (error instanceof HistoricImportFenced) return false;
    throw error;
  }
}

async function executeImport(input: {
  importId: string;
  actorUserId: string;
  file561: StoredFile;
  fileSlrb: StoredFile;
  fence: bigint;
  stopAfterLines?: number;
  sample: () => void;
}) {
  await withHistoricImportFence(input.importId, input.fence, () => failSupersededAccountRuns(input.importId));
  const directory = await loadDirectory();
  const docs = new Map<string, DocAccum>();
  const ledgerByAccount = new Map<string, number>();
  let parsedSlrb = 0;
  let malformedSlrb = 0;
  let excludedLedger = 0;
  let invRows = 0;
  let crnRows = 0;
  const malformedSamples: string[] = [];
  let slrbHeader: string[] = [];
  const progressStarted = Date.now();
  let lastProgressAt = 0;
  const publishProgress = async (
    phase: string,
    counts: {
      parsed561l?: number;
      parsedSlrb?: number;
      malformed561l?: number;
      malformedSlrb?: number;
      excludedLedger?: number;
    },
  ) => {
    const now = Date.now();
    if (now - lastProgressAt < 2500) return;
    lastProgressAt = now;
    input.sample();
    await updateOwnedHistoricImport(input.importId, input.fence, {
      ...counts,
      elapsedMs: now - progressStarted,
      peakRssBytes: process.memoryUsage().rss,
      summary: { phase, recoverable: true } as Prisma.InputJsonValue,
    });
  };
  await forEachAutopartCsvRecord(
    input.fileSlrb.path,
    input.fileSlrb.encoding,
    async (record) => {
      parsedSlrb += 1;
      if ((parsedSlrb & 16383) === 0) {
        input.sample();
        await publishProgress("ledger", { parsedSlrb, malformedSlrb, excludedLedger });
      }
      const columns = headerIndex(slrbHeader);
      if (record.malformed || columns.account < 0 || columns.type < 0 || columns.ref < 0) {
        malformedSlrb += 1;
        if (malformedSamples.length < 20) malformedSamples.push(`SLRB ${record.recordNumber}: ${record.issue ?? "unreadable"}`);
        return;
      }
      const account = (record.fields[columns.account] ?? "").trim().toUpperCase();
      const rawType = (record.fields[columns.type] ?? "").trim().toUpperCase();
      const documentType = mapSlrbDocumentType(rawType);
      if (documentType === "PAYMENT" || documentType === "JOURNAL" || rawType === "CSH" || rawType === "OPB") {
        excludedLedger += 1;
        ledgerByAccount.set(account, (ledgerByAccount.get(account) ?? 0) + 1);
        return;
      }
      if (documentType !== "INVOICE" && documentType !== "CREDIT") {
        malformedSlrb += 1;
        if (malformedSamples.length < 20) malformedSamples.push(`SLRB ${record.recordNumber}: type ${rawType || "blank"}`);
        return;
      }
      if (documentType === "INVOICE") invRows += 1;
      else crnRows += 1;
      const reference = (record.fields[columns.ref] ?? "").trim().toUpperCase();
      if (!account || !reference) {
        malformedSlrb += 1;
        return;
      }
      const key = docKey(account, documentType, reference);
      const goods = moneyToMinor(record.fields[columns.goods] ?? null);
      const vat = moneyToMinor(columns.vat >= 0 ? record.fields[columns.vat] : null);
      const gross = moneyToMinor(columns.total >= 0 ? record.fields[columns.total] : null);
      const date = parseAutopartDateOnly(columns.date >= 0 ? record.fields[columns.date] : null);
      const current = docs.get(key);
      if (!current) {
        docs.set(key, {
          account,
          documentType,
          documentReference: reference,
          documentDate: date,
          goodsMinor: goods,
          vatMinor: vat,
          grossMinor: gross,
          ledgerRows: 1,
          lineMinor: 0,
          lineCount: 0,
        });
      } else {
        current.ledgerRows += 1;
        current.goodsMinor = (current.goodsMinor ?? 0) + (goods ?? 0);
        current.vatMinor = (current.vatMinor ?? 0) + (vat ?? 0);
        current.grossMinor = (current.grossMinor ?? 0) + (gross ?? 0);
      }
    },
    (header) => {
      slrbHeader = header;
    },
  );

  const lineState = new Map<string, { next: number; used: Set<number> }>();
  const accountLines = new Map<string, number>();
  const accountMinor = new Map<string, number>();
  let parsed561 = 0;
  let malformed561 = 0;
  let valid561 = 0;
  let multiline = 0;
  let line561Header: string[] = [];
  const stageBuffer: Prisma.AutopartHistoryStagedLineCreateManyInput[] = [];
  const salesBuffer = new Map<string, Array<{
    documentType: "INVOICE" | "CREDIT";
    documentReference: string;
    lineNumber: number;
    sku: string;
    description: string | null;
    units: string;
    salesNet: string;
    rawInvAndLn: string;
  }>>();
  const companyRuns = new Map<string, { runId: string; code: string; lines: number }>();
  const fileDocsByCompany = new Map<string, Set<string>>();

  const flushStage = async () => {
    if (!stageBuffer.length) return;
    const batch = stageBuffer.splice(0, stageBuffer.length);
    await withHistoricImportFence(input.importId, input.fence, () =>
      prisma.autopartHistoryStagedLine.createMany({ data: batch, skipDuplicates: true }),
    );
  };
  const flushSales = async (companyId: string) => {
    const lines = salesBuffer.get(companyId);
    if (!lines?.length) return;
    const run = companyRuns.get(companyId);
    if (!run) return;
    const batch = lines.splice(0, lines.length);
    await withHistoricImportFence(input.importId, input.fence, () =>
      writeHistoricAccountBatch({
        runId: run.runId,
        companyId,
        accountCode: run.code,
        documents: [],
        lines: batch,
      }),
    );
  };

  await forEachAutopartCsvRecord(
    input.file561.path,
    input.file561.encoding,
    async (record) => {
      parsed561 += 1;
      if (record.multiline) multiline += 1;
      if ((parsed561 & 16383) === 0) {
        input.sample();
        await publishProgress("lines", {
          parsed561l: parsed561,
          parsedSlrb,
          malformed561l: malformed561,
          malformedSlrb,
          excludedLedger,
        });
      }
      if (input.stopAfterLines && valid561 >= input.stopAfterLines) throw new ImportInterrupted(valid561);
      const columns = headerIndex(line561Header);
      const parsed = accept561(record, columns);
      if (!parsed) {
        malformed561 += 1;
        if (malformedSamples.length < 20) malformedSamples.push(`561L ${record.recordNumber}: ${record.issue ?? "not a sales line"}`);
        return;
      }
      valid561 += 1;
      const lineNumber = assignLineNumber(lineState, parsed.account, parsed.documentType, parsed.documentReference, parsed.sourceLineNumber);
      const key = docKey(parsed.account, parsed.documentType, parsed.documentReference);
      const accum = docs.get(key) ?? {
        account: parsed.account,
        documentType: parsed.documentType,
        documentReference: parsed.documentReference,
        documentDate: null,
        goodsMinor: null,
        vatMinor: null,
        grossMinor: null,
        ledgerRows: 0,
        lineMinor: 0,
        lineCount: 0,
      };
      accum.lineMinor += parsed.minor;
      accum.lineCount += 1;
      docs.set(key, accum);
      accountLines.set(parsed.account, (accountLines.get(parsed.account) ?? 0) + 1);
      accountMinor.set(parsed.account, (accountMinor.get(parsed.account) ?? 0) + parsed.minor);
      const classified = classifyHistoricAccount(parsed.account, directory);
      if (classified.outcome === "import") {
        let run = companyRuns.get(classified.companyId);
        if (!run) {
          const runId = await withHistoricImportFence(input.importId, input.fence, () =>
            openHistoricAccountWrite({
              actorUserId: input.actorUserId,
              companyId: classified.companyId,
              accountCode: classified.canonicalCode,
              filename561l: input.file561.filename,
              filenameSlrb: input.fileSlrb.filename,
              fileHash561l: input.file561.sha256,
              fileHashSlrb: input.fileSlrb.sha256,
              parentImportId: input.importId,
            }),
          );
          run = { runId, code: classified.canonicalCode, lines: 0 };
          companyRuns.set(classified.companyId, run);
        }
        const bucket = salesBuffer.get(classified.companyId) ?? [];
        bucket.push({
          documentType: parsed.documentType,
          documentReference: parsed.documentReference,
          lineNumber,
          sku: parsed.sku,
          description: parsed.description,
          units: parsed.units,
          salesNet: parsed.salesNet,
          rawInvAndLn: parsed.rawInvAndLn,
        });
        salesBuffer.set(classified.companyId, bucket);
        run.lines += 1;
        const keys = fileDocsByCompany.get(classified.companyId) ?? new Set<string>();
        keys.add(`${parsed.documentType}::${parsed.documentReference}`);
        fileDocsByCompany.set(classified.companyId, keys);
        if (bucket.length >= BATCH) await flushSales(classified.companyId);
      } else {
        stageBuffer.push({
          importId: input.importId,
          accountCode: parsed.account,
          documentType: parsed.documentType,
          documentReference: parsed.documentReference,
          lineNumber,
          sku: parsed.sku,
          descriptionSnapshot: parsed.description,
          units: parsed.units,
          salesNet: parsed.salesNet,
          rawInvAndLn: parsed.rawInvAndLn,
        });
        if (stageBuffer.length >= BATCH) await flushStage();
      }
    },
    (header) => {
      line561Header = header;
    },
  );
  for (const companyId of salesBuffer.keys()) await flushSales(companyId);
  await flushStage();

  if (parsed561 !== valid561 + malformed561) {
    throw new Error(`561L count mismatch: parsed ${parsed561}, valid ${valid561}, malformed ${malformed561}`);
  }
  if (parsedSlrb !== invRows + crnRows + excludedLedger + malformedSlrb) {
    throw new Error(`SLRB count mismatch: parsed ${parsedSlrb}`);
  }

  let documentsWritten = 0;
  const stagedDocs: Prisma.AutopartHistoryStagedDocumentCreateManyInput[] = [];
  const discrepancies: Array<{ account: string; reference: string; lineNet: string; goodsNet: string; minor: number }> = [];
  let discrepancyCount = 0;
  const verifiedDocs = new Map<string, DocAccum[]>();
  const accountGoods = new Map<string, number>();
  for (const doc of docs.values()) {
    if (doc.goodsMinor != null) {
      accountGoods.set(doc.account, (accountGoods.get(doc.account) ?? 0) + doc.goodsMinor);
    }
    const classified = classifyHistoricAccount(doc.account, directory);
    const goods = doc.goodsMinor == null ? null : minorToMoney(doc.goodsMinor);
    const diff = doc.goodsMinor == null ? null : doc.lineMinor - doc.goodsMinor;
    if (diff != null && diff !== 0) {
      discrepancyCount += 1;
      if (discrepancies.length < 30 || doc.documentReference === "SS272042") {
        discrepancies.push({
          account: doc.account,
          reference: doc.documentReference,
          lineNet: minorToMoney(doc.lineMinor),
          goodsNet: goods ?? "",
          minor: diff,
        });
      }
    }
    if (classified.outcome === "import") {
      const list = verifiedDocs.get(classified.companyId) ?? [];
      list.push(doc);
      verifiedDocs.set(classified.companyId, list);
      const keys = fileDocsByCompany.get(classified.companyId) ?? new Set<string>();
      keys.add(`${doc.documentType}::${doc.documentReference}`);
      fileDocsByCompany.set(classified.companyId, keys);
    } else if (doc.ledgerRows > 0 || doc.lineCount > 0) {
      stagedDocs.push({
        importId: input.importId,
        accountCode: doc.account,
        documentType: doc.documentType,
        documentReference: doc.documentReference,
        documentDate: doc.documentDate ? new Date(`${doc.documentDate}T12:00:00.000Z`) : null,
        goodsNet: goods,
        vat: doc.vatMinor == null ? null : minorToMoney(doc.vatMinor),
        grossTotal: doc.grossMinor == null ? null : minorToMoney(doc.grossMinor),
        source: doc.ledgerRows > 0 ? "SLRB" : "561L",
      });
      if (stagedDocs.length >= BATCH) {
        const batch = stagedDocs.splice(0, stagedDocs.length);
        await withHistoricImportFence(input.importId, input.fence, () =>
          prisma.autopartHistoryStagedDocument.createMany({ data: batch, skipDuplicates: true }),
        );
      }
    }
  }
  if (stagedDocs.length) {
    const batch = stagedDocs.splice(0, stagedDocs.length);
    await withHistoricImportFence(input.importId, input.fence, () =>
      prisma.autopartHistoryStagedDocument.createMany({ data: batch, skipDuplicates: true }),
    );
  }
  for (const [companyId, list] of verifiedDocs) {
    let run = companyRuns.get(companyId);
    if (!run) {
      const classified = classifyHistoricAccount(list[0]?.account ?? "", directory);
      if (classified.outcome !== "import") continue;
      const runId = await withHistoricImportFence(input.importId, input.fence, () =>
        openHistoricAccountWrite({
          actorUserId: input.actorUserId,
          companyId,
          accountCode: classified.canonicalCode,
          filename561l: input.file561.filename,
          filenameSlrb: input.fileSlrb.filename,
          fileHash561l: input.file561.sha256,
          fileHashSlrb: input.fileSlrb.sha256,
          parentImportId: input.importId,
        }),
      );
      run = { runId, code: classified.canonicalCode, lines: 0 };
      companyRuns.set(companyId, run);
    }
    for (let index = 0; index < list.length; index += 100) {
      const slice = list.slice(index, index + 100);
      await withHistoricImportFence(input.importId, input.fence, async () => {
        await writeHistoricAccountBatch({
          runId: run.runId,
          companyId,
          accountCode: run.code,
          documents: slice.map((doc) => ({
            documentType: doc.documentType,
            documentReference: doc.documentReference,
            documentDate: doc.documentDate,
            goodsNet: doc.goodsMinor == null ? null : minorToMoney(doc.goodsMinor),
            vat: doc.vatMinor == null ? null : minorToMoney(doc.vatMinor),
            grossTotal: doc.grossMinor == null ? null : minorToMoney(doc.grossMinor),
            source: doc.ledgerRows > 0 ? "SLRB" : "561L",
          })),
          lines: [],
        });
        const matched: Array<{ documentType: "INVOICE" | "CREDIT"; documentReference: string; linesNet: string }> = [];
        for (const doc of slice) {
          if (doc.goodsMinor == null) continue;
          const diff = doc.lineMinor - doc.goodsMinor;
          if (diff === 0) {
            matched.push({
              documentType: doc.documentType,
              documentReference: doc.documentReference,
              linesNet: minorToMoney(doc.lineMinor),
            });
            continue;
          }
          await stampHistoricDocumentComparison({
            companyId,
            documentType: doc.documentType,
            documentReference: doc.documentReference,
            linesNet: minorToMoney(doc.lineMinor),
            mismatchMinor: diff,
          });
        }
        await clearMatchedHistoricComparisons(companyId, matched);
      });
      documentsWritten += slice.length;
    }
  }

  for (const run of companyRuns.values()) {
    await withHistoricImportFence(input.importId, input.fence, () =>
      closeHistoricAccountWrite(run.runId, { imported: run.lines, updated: 0 }),
    );
  }
  await withHistoricImportFence(input.importId, input.fence, () => recordSnapshotGaps(input.importId, fileDocsByCompany));
  await withHistoricImportFence(input.importId, input.fence, () =>
    replaceReviewRows(input.importId, directory, accountLines, accountMinor, accountGoods, ledgerByAccount),
  );

  const stagedLineCount = await prisma.autopartHistoryStagedLine.count({ where: { importId: input.importId } });
  const importedLineCount = [...companyRuns.values()].reduce((sum, run) => sum + run.lines, 0);
  if (stagedLineCount + importedLineCount !== valid561) {
    throw new Error(`Sales lines were not all retained: valid ${valid561}, staged ${stagedLineCount}, imported ${importedLineCount}`);
  }

  const accountSample = [...accountLines.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .slice(0, 50)
    .map(([accountCode, lineCount]) => {
      const classified = classifyHistoricAccount(accountCode, directory);
      return {
        accountCode,
        outcome: classified.outcome,
        companyId: classified.outcome === "import" ? classified.companyId : null,
        reason: classified.outcome === "review" ? classified.reason : null,
        invoiceDocuments: 0,
        creditDocuments: 0,
        ledgerRows: ledgerByAccount.get(accountCode) ?? 0,
        lineCount,
        lineNet: minorToMoney(accountMinor.get(accountCode) ?? 0),
        goodsNet: minorToMoney(accountGoods.get(accountCode) ?? 0),
        warnings: [] as string[],
      };
    });

  return {
    counts: {
      accountsRead: accountLines.size,
      accountsCommitted: [...accountLines.keys()].filter(
        (code) => classifyHistoricAccount(code, directory).outcome === "import",
      ).length,
      accountsReviewed: [...accountLines.keys()].filter(
        (code) => classifyHistoricAccount(code, directory).outcome === "review",
      ).length,
      documentsWritten,
      linesWritten: importedLineCount,
      parsed561l: parsed561,
      parsedSlrb,
      malformed561l: malformed561,
      malformedSlrb,
      excludedLedger,
      stagedLineCount,
      importedLineCount,
      discrepancyCount,
    },
    summary: {
      multiline561: multiline,
      invoiceLedgerRows: invRows,
      creditLedgerRows: crnRows,
      malformedSamples,
      discrepancies: discrepancies.slice(0, 31),
      snapshotRule:
        "Documents in this file update customer history. Historical documents for those verified accounts that are absent from this file are listed as snapshot gaps and stay until RETIRE ABSENT HISTORICAL DOCUMENTS is confirmed. Ongoing 504/TRM documents are never retired here.",
    },
    accountSample,
  };
}

function accept561(record: AutopartCsvRecord, columns: ReturnType<typeof headerIndex>) {
  if (record.malformed || columns.account < 0 || columns.inv < 0 || columns.part < 0 || columns.sales < 0) return null;
  const account = (record.fields[columns.account] ?? "").trim().toUpperCase();
  const identity = parseInvAndLn(record.fields[columns.inv]);
  const sku = (record.fields[columns.part] ?? "").trim();
  const salesNet = (record.fields[columns.sales] ?? "").trim();
  const minor = moneyToMinor(salesNet);
  if (!account || !identity.ok || !identity.documentReference || !sku || minor == null) return null;
  if (identity.documentType !== "INVOICE" && identity.documentType !== "CREDIT") return null;
  return {
    account,
    documentType: identity.documentType,
    documentReference: identity.documentReference,
    sourceLineNumber: identity.sourceLineNumber,
    sku,
    description: columns.description >= 0 ? record.fields[columns.description] ?? null : null,
    units: columns.units >= 0 ? (record.fields[columns.units] ?? "0").trim() : "0",
    salesNet: minorToMoney(minor),
    minor,
    rawInvAndLn: record.fields[columns.inv] ?? "",
  };
}

function assignLineNumber(
  state: Map<string, { next: number; used: Set<number> }>,
  account: string,
  documentType: string,
  documentReference: string,
  sourceLineNumber: number | null,
): number {
  const key = docKey(account, documentType, documentReference);
  let row = state.get(key);
  if (!row) {
    row = { next: 1, used: new Set<number>() };
    state.set(key, row);
  }
  if (sourceLineNumber != null && sourceLineNumber >= 1 && !row.used.has(sourceLineNumber)) {
    row.used.add(sourceLineNumber);
    if (sourceLineNumber >= row.next) row.next = sourceLineNumber + 1;
    return sourceLineNumber;
  }
  while (row.used.has(row.next)) row.next += 1;
  const assigned = row.next;
  row.used.add(assigned);
  row.next += 1;
  return assigned;
}

function docKey(account: string, documentType: string, documentReference: string): string {
  return `${account}|${documentType}|${documentReference}`;
}

function headerIndex(header: string[]) {
  const names = header.map((field) => field.trim().toLowerCase().replace(/^\./, "").replace(/\.$/, ""));
  const find = (...wanted: string[]) => names.findIndex((name) => wanted.includes(name));
  return {
    account: find("acct", "a/c", "account"),
    inv: find("inv & ln", "inv ln", "invoice line"),
    part: find("part number", "part", "sku"),
    description: find("description", "desc"),
    units: find("units", "qty", "quantity"),
    sales: find("sales", "net", "value"),
    type: find("type"),
    ref: find("ref", "reference"),
    date: find("date"),
    goods: find("tot goods", "goods"),
    vat: find("tot vat", "vat"),
    total: find("total"),
  };
}

async function loadDirectory(): Promise<HistoricAccountDirectory> {
  const [companies, aliases, masters] = await Promise.all([
    prisma.company.findMany({
      where: { autopartCustomerCodeVerifiedAt: { not: null }, autopartCustomerCode: { not: null } },
      select: { id: true, autopartCustomerCode: true },
    }),
    prisma.autopartCustomerAccountAlias.findMany({
      select: { companyId: true, alias: true, company: { select: { autopartCustomerCode: true } } },
    }),
    prisma.autopartAccount.findMany({ select: { accountCode: true, companyId: true } }),
  ]);
  const verifiedByCode = new Map<string, HistoricAccountTarget | null>();
  const addVerified = (code: string | null | undefined, companyId: string, canonicalCode: string) => {
    const key = code?.trim().toUpperCase() ?? "";
    if (!key) return;
    const target = { companyId, canonicalCode };
    const current = verifiedByCode.get(key);
    if (current === undefined) verifiedByCode.set(key, target);
    else if (current?.companyId !== companyId) verifiedByCode.set(key, null);
  };
  for (const company of companies) {
    addVerified(company.autopartCustomerCode, company.id, company.autopartCustomerCode!.trim().toUpperCase());
  }
  for (const alias of aliases) {
    const canonical = alias.company.autopartCustomerCode?.trim().toUpperCase() || alias.alias.trim().toUpperCase();
    addVerified(alias.alias, alias.companyId, canonical);
  }
  const masterCompanyByCode = new Map<string, string | null>();
  const truncatedPrefixes = new Set<string>();
  for (const account of masters) {
    const code = account.accountCode.trim().toUpperCase();
    masterCompanyByCode.set(code, account.companyId);
    for (let length = 4; length < code.length; length += 1) truncatedPrefixes.add(code.slice(0, length));
  }
  for (const code of masterCompanyByCode.keys()) truncatedPrefixes.delete(code);
  return { verifiedByCode, masterCompanyByCode, truncatedPrefixes };
}

async function replaceReviewRows(
  importId: string,
  directory: HistoricAccountDirectory,
  accountLines: Map<string, number>,
  accountMinor: Map<string, number>,
  accountGoods: Map<string, number>,
  ledgerByAccount: Map<string, number>,
) {
  await prisma.autopartHistoryReviewAccount.deleteMany({ where: { importId } });
  const codes = new Set<string>([...accountLines.keys(), ...ledgerByAccount.keys(), ...accountGoods.keys()]);
  const reviewCodes: string[] = [];
  const rows: Prisma.AutopartHistoryReviewAccountCreateManyInput[] = [];
  for (const accountCode of codes) {
    const classified = classifyHistoricAccount(accountCode, directory);
    if (classified.outcome === "import") continue;
    reviewCodes.push(accountCode);
    rows.push({
      importId,
      accountCode,
      reason: classified.reason,
      lineCount: accountLines.get(accountCode) ?? 0,
      lineNet: minorToMoney(accountMinor.get(accountCode) ?? 0),
      goodsNet: minorToMoney(accountGoods.get(accountCode) ?? 0),
      ledgerRows: ledgerByAccount.get(accountCode) ?? 0,
      warnings:
        classified.reason === "AMBIGUOUS"
          ? ["Truncated or conflicting account code was not imported."]
          : [],
    });
    if (rows.length >= BATCH) {
      await prisma.autopartHistoryReviewAccount.createMany({ data: rows.splice(0, rows.length) });
    }
  }
  if (rows.length) await prisma.autopartHistoryReviewAccount.createMany({ data: rows });
  if (reviewCodes.length) {
    await prisma.autopartHistoryReviewAccount.updateMany({
      where: { status: { in: ["OPEN", "VERIFYING"] }, accountCode: { in: reviewCodes }, importId: { not: importId } },
      data: { status: "SUPERSEDED" },
    });
  }
}

async function recordSnapshotGaps(importId: string, fileDocsByCompany: Map<string, Set<string>>) {
  await prisma.autopartHistorySnapshotGap.deleteMany({ where: { importId } });
  for (const [companyId, keys] of fileDocsByCompany) {
    const existing = await prisma.autopartSalesDocument.findMany({
      where: {
        companyId,
        NOT: {
          OR: [{ has504: true }, { hasTrm21qc: true }, { source: { in: [...ONGOING_SOURCES] } }],
        },
      },
      select: { documentType: true, documentReference: true, goodsNet: true },
    });
    const gaps = existing.filter((doc) => !keys.has(`${doc.documentType}::${doc.documentReference}`));
    if (!gaps.length) continue;
    await prisma.autopartHistorySnapshotGap.createMany({
      data: gaps.map((doc) => ({
        importId,
        companyId,
        documentType: doc.documentType,
        documentReference: doc.documentReference,
        goodsNet: doc.goodsNet,
      })),
      skipDuplicates: true,
    });
  }
}

export async function retireAbsentHistoricDocuments(actorUserId: string, raw: unknown) {
  await requireSystemPermission(actorUserId, "autopart.import.manage");
  const input = z
    .object({ importId: z.string().min(1), confirmation: z.string() })
    .parse(raw);
  if (input.confirmation !== HISTORIC_SNAPSHOT_RETIRE_PHRASE) {
    throw new AuthError("Type the retirement confirmation before removing absent documents", "CONFIRMATION_REQUIRED", 400);
  }
  const imported = await prisma.autopartHistoryAllImport.findUnique({ where: { id: input.importId } });
  if (!imported || imported.status !== "COMMITTED") {
    throw new AuthError("Only a completed ALL import can retire documents it did not contain", "IMPORT_BLOCKED", 400);
  }
  const gaps = await prisma.autopartHistorySnapshotGap.findMany({
    where: { importId: input.importId, status: "OPEN" },
  });
  let retired = 0;
  for (const gap of gaps) {
    const document = await prisma.autopartSalesDocument.findFirst({
      where: { companyId: gap.companyId, documentType: gap.documentType, documentReference: gap.documentReference },
    });
    if (!document || document.has504 || document.hasTrm21qc || ONGOING_SOURCES.includes(document.source as (typeof ONGOING_SOURCES)[number])) {
      continue;
    }
    await prisma.autopartSalesLine.deleteMany({
      where: {
        companyId: gap.companyId,
        documentType: gap.documentType,
        documentReference: gap.documentReference,
        source: { not: "ONGOING_TRM21QC" },
      },
    });
    await prisma.autopartSalesDocument.deleteMany({
      where: {
        id: document.id,
        has504: false,
        hasTrm21qc: false,
        source: { notIn: [...ONGOING_SOURCES] },
      },
    });
    await prisma.autopartHistorySnapshotGap.update({
      where: { id: gap.id },
      data: { status: "RETIRED", retiredAt: new Date() },
    });
    retired += 1;
  }
  await recordAuditEvent({
    action: "autopart.history_snapshot_retired",
    entityType: "AutopartHistoryAllImport",
    entityId: input.importId,
    actorUserId,
    after: { retired, confirmation: HISTORIC_SNAPSHOT_RETIRE_PHRASE },
  });
  return { retired };
}

export async function getHistoricAllImport(actorUserId: string, importId: string) {
  await requireSystemPermission(actorUserId, "autopart.import.view");
  const row = await prisma.autopartHistoryAllImport.findUnique({ where: { id: importId } });
  if (!row) throw new AuthError("Import not found", "NOT_FOUND", 404);
  return {
    id: row.id,
    status: row.status,
    parsed561l: row.parsed561l,
    parsedSlrb: row.parsedSlrb,
    malformed561l: row.malformed561l,
    malformedSlrb: row.malformedSlrb,
    excludedLedger: row.excludedLedger,
    stagedLineCount: row.stagedLineCount,
    importedLineCount: row.importedLineCount,
    discrepancyCount: row.discrepancyCount,
    accountsCommitted: row.accountsCommitted,
    accountsReviewed: row.accountsReviewed,
    elapsedMs: row.elapsedMs,
    peakRssBytes: row.peakRssBytes,
    fileHash561l: row.fileHash561l,
    fileHashSlrb: row.fileHashSlrb,
    encoding561l: row.encoding561l,
    encodingSlrb: row.encodingSlrb,
    summary: row.summary,
  };
}

const reviewListSchema = z.object({
  query: z.string().max(80).optional(),
  reason: z.enum(["UNKNOWN", "AMBIGUOUS", "UNLINKED", "NOT_VERIFIED"]).optional(),
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(50).default(25),
});

export async function listHistoricReviews(actorUserId: string, raw: unknown) {
  await requireSystemPermission(actorUserId, "autopart.import.view");
  const input = reviewListSchema.parse(raw ?? {});
  const latest = await prisma.autopartHistoryAllImport.findFirst({
    where: { status: "COMMITTED" },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      createdAt: true,
      filename561l: true,
      filenameSlrb: true,
      fileHash561l: true,
      fileHashSlrb: true,
    },
  });
  if (!latest) return { import: null, total: 0, page: input.page, pageSize: input.pageSize, reviews: [] };
  const query = input.query?.trim();
  const where: Prisma.AutopartHistoryReviewAccountWhereInput = {
    importId: latest.id,
    status: { in: ["OPEN", "VERIFYING"] },
    ...(input.reason ? { reason: input.reason } : {}),
    ...(query ? { accountCode: { contains: query, mode: "insensitive" } } : {}),
  };
  const [total, reviews] = await Promise.all([
    prisma.autopartHistoryReviewAccount.count({ where }),
    prisma.autopartHistoryReviewAccount.findMany({
      where,
      orderBy: { accountCode: "asc" },
      skip: (input.page - 1) * input.pageSize,
      take: input.pageSize,
    }),
  ]);
  return {
    import: {
      id: latest.id,
      createdAt: latest.createdAt.toISOString(),
      filename561l: latest.filename561l,
      filenameSlrb: latest.filenameSlrb,
      fileHash561l: latest.fileHash561l,
      fileHashSlrb: latest.fileHashSlrb,
    },
    total,
    page: input.page,
    pageSize: input.pageSize,
    reviews: reviews.map((review) => ({
      id: review.id,
      accountCode: review.accountCode,
      reason: review.reason,
      status: review.status,
      invoiceDocuments: review.invoiceDocuments,
      creditDocuments: review.creditDocuments,
      lineCount: review.lineCount,
      lineNet: review.lineNet.toString(),
      goodsNet: review.goodsNet.toString(),
    })),
  };
}

export async function listOpenHistoricReviews(actorUserId: string) {
  const page = await listHistoricReviews(actorUserId, { page: 1, pageSize: 25 });
  return { import: page.import, reviews: page.reviews };
}

export async function searchCompaniesForHistoricVerify(actorUserId: string, raw: unknown) {
  await requireSystemPermission(actorUserId, "autopart.import.view");
  const query = z.object({ query: z.string().max(80) }).parse(raw).query.trim();
  if (query.length < 2) return [];
  const companies = await prisma.company.findMany({
    where: {
      OR: [
        { name: { contains: query, mode: "insensitive" } },
        { autopartCustomerCode: { contains: query, mode: "insensitive" } },
      ],
    },
    select: { id: true, name: true, autopartCustomerCode: true, autopartCustomerCodeVerifiedAt: true },
    orderBy: { name: "asc" },
    take: 8,
  });
  return companies.map((company) => ({
    id: company.id,
    name: company.name,
    autopartCustomerCode: company.autopartCustomerCode,
    verified: Boolean(company.autopartCustomerCodeVerifiedAt),
  }));
}

export async function verifyHistoricReviewAccount(actorUserId: string, raw: unknown) {
  await requireSystemPermission(actorUserId, "autopart.import.manage");
  const input = z
    .object({
      reviewId: z.string().min(1),
      companyId: z.string().min(1),
      confirmation: z.string(),
    })
    .parse(raw);
  if (input.confirmation !== HISTORIC_VERIFY_PHRASE) {
    throw new AuthError("Type the verification confirmation before importing staged history", "CONFIRMATION_REQUIRED", 400);
  }
  const review = await prisma.autopartHistoryReviewAccount.findUnique({ where: { id: input.reviewId } });
  if (!review || (review.status !== "OPEN" && review.status !== "VERIFYING")) {
    throw new AuthError("That review row is not open", "NOT_FOUND", 404);
  }
  if (review.reason === "AMBIGUOUS" || review.reason === "UNKNOWN") {
    throw new AuthError("Only an exact 407EXP account can be verified. Truncated or unknown codes stay staged.", "IMPORT_BLOCKED", 400);
  }
  const code = review.accountCode.trim().toUpperCase();
  const directory = await loadDirectory();
  if (directory.truncatedPrefixes?.has(code) || !directory.masterCompanyByCode.has(code)) {
    throw new AuthError("That code is not an exact 407EXP account", "IMPORT_BLOCKED", 400);
  }
  const linkedCompanyId = directory.masterCompanyByCode.get(code);
  if (linkedCompanyId && linkedCompanyId !== input.companyId) {
    throw new AuthError("This 407EXP account is already linked to a different customer", "IMPORT_BLOCKED", 409);
  }
  const company = await prisma.company.findUnique({
    where: { id: input.companyId },
    select: { id: true, autopartCustomerCode: true, autopartCustomerCodeVerifiedAt: true },
  });
  if (!company) throw new AuthError("Company not found", "NOT_FOUND", 404);
  const currentCode = company.autopartCustomerCode?.trim().toUpperCase() ?? "";
  if (currentCode && currentCode !== code) {
    throw new AuthError("That customer already has a different Autopart account", "IMPORT_BLOCKED", 409);
  }
  const other = await prisma.company.findFirst({
    where: { autopartCustomerCode: code, id: { not: company.id }, autopartCustomerCodeVerifiedAt: { not: null } },
    select: { id: true },
  });
  if (other) throw new AuthError("Another customer is already verified with this account", "IMPORT_BLOCKED", 409);
  await prisma.autopartHistoryReviewAccount.update({
    where: { id: review.id },
    data: { status: "VERIFYING", companyId: company.id },
  });
  await prisma.company.update({
    where: { id: company.id },
    data: {
      autopartCustomerCode: code,
      autopartCustomerCodeVerifiedAt: new Date(),
      autopartCustomerCodeVerifiedById: actorUserId,
    },
  });
  await prisma.autopartAccount.updateMany({
    where: { accountCode: code, companyId: null },
    data: { companyId: company.id },
  });
  let promoted: HistoricPromotionResult;
  try {
    promoted = await historicPromotion.write(actorUserId, company.id, code, review.id);
  } catch (error) {
    await rememberIncompleteVerification(review.id);
    if (error instanceof AuthError) throw error;
    const detail = error instanceof Error ? error.message : "staged history failed";
    throw new AuthError(
      `Staged history was not fully applied (${detail}). Verification is incomplete and can be retried.`,
      "PROMOTION_INCOMPLETE",
      409,
    );
  }
  if (!promoted.completed) {
    await rememberIncompleteVerification(review.id);
    throw new AuthError(
      "Staged history was not fully applied. Verification is incomplete and can be retried.",
      "PROMOTION_INCOMPLETE",
      409,
    );
  }
  await recordAuditEvent({
    action: "autopart.history_review.verified",
    entityType: "AutopartHistoryReviewAccount",
    entityId: review.id,
    actorUserId,
    companyId: company.id,
    before: { accountCode: code, reason: review.reason, companyAutopartCode: company.autopartCustomerCode },
    after: { accountCode: code, documents: promoted.documents, lines: promoted.lines, status: "APPLIED" },
  });
  return { accountCode: code, companyId: company.id, ...promoted };
}

type HistoricPromotionResult = {
  completed: boolean;
  applied: boolean;
  documents: number;
  lines: number;
};

function idlePromotion(): HistoricPromotionResult {
  return { completed: true, applied: false, documents: 0, lines: 0 };
}

const INCOMPLETE_VERIFICATION = [
  "Verification is incomplete. Staged history was not fully applied. Retry verification.",
];

async function rememberIncompleteVerification(reviewId: string) {
  await prisma.autopartHistoryReviewAccount.updateMany({
    where: { id: reviewId, status: { in: ["OPEN", "VERIFYING"] } },
    data: { status: "VERIFYING", warnings: INCOMPLETE_VERIFICATION },
  });
}

export const historicPromotion = {
  write(actorUserId: string, companyId: string, code: string, reviewId: string) {
    return promoteStagedAutopartHistory(actorUserId, companyId, code, reviewId);
  },
};

export async function stagedHistoricReviewIsPending(code: string): Promise<boolean> {
  const verified = code.trim().toUpperCase();
  if (!verified) return false;
  const latest = await prisma.autopartHistoryAllImport.findFirst({
    where: { status: "COMMITTED" },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
  if (!latest) return false;
  const review = await prisma.autopartHistoryReviewAccount.findFirst({
    where: {
      importId: latest.id,
      accountCode: verified,
      status: { in: ["OPEN", "VERIFYING"] },
      reason: { in: ["UNLINKED", "NOT_VERIFIED"] },
    },
    select: { id: true },
  });
  return review != null;
}

export async function beginHistoricAccountVerification(code: string, companyId: string): Promise<void> {
  const verified = code.trim().toUpperCase();
  if (!verified) return;
  const latest = await prisma.autopartHistoryAllImport.findFirst({
    where: { status: "COMMITTED" },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
  if (!latest) return;
  await prisma.autopartHistoryReviewAccount.updateMany({
    where: {
      importId: latest.id,
      accountCode: verified,
      status: { in: ["OPEN", "VERIFYING"] },
      reason: { in: ["UNLINKED", "NOT_VERIFIED"] },
    },
    data: { status: "VERIFYING", companyId },
  });
}

export async function promoteStagedAutopartHistory(
  actorUserId: string,
  companyId: string,
  code: string,
  reviewId?: string,
): Promise<HistoricPromotionResult> {
  const verified = code.trim().toUpperCase();
  if (!verified) return idlePromotion();
  const review = reviewId
    ? await prisma.autopartHistoryReviewAccount.findFirst({
        where: { id: reviewId, accountCode: verified, status: { in: ["OPEN", "VERIFYING"] } },
      })
    : await (async () => {
        const latest = await prisma.autopartHistoryAllImport.findFirst({
          where: { status: "COMMITTED" },
          orderBy: { createdAt: "desc" },
          select: { id: true },
        });
        if (!latest) return null;
        return prisma.autopartHistoryReviewAccount.findFirst({
          where: { importId: latest.id, accountCode: verified, status: { in: ["OPEN", "VERIFYING"] } },
        });
      })();
  if (!review || review.reason === "AMBIGUOUS" || review.reason === "UNKNOWN") return idlePromotion();
  const source = await prisma.autopartHistoryAllImport.findFirst({
    where: { id: review.importId, status: "COMMITTED" },
  });
  if (!source) return idlePromotion();
  const directory = await loadDirectory();
  const classified = classifyHistoricAccount(review.accountCode, directory);
  if (classified.outcome !== "import" || classified.companyId !== companyId) {
    await prisma.autopartHistoryReviewAccount.update({
      where: { id: review.id },
      data: { status: "VERIFYING", companyId, warnings: INCOMPLETE_VERIFICATION },
    });
    return { completed: false, applied: false, documents: 0, lines: 0 };
  }
  await prisma.autopartHistoryReviewAccount.update({
    where: { id: review.id },
    data: { status: "VERIFYING", companyId },
  });
  const runId = await openHistoricAccountWrite({
    actorUserId,
    companyId,
    accountCode: classified.canonicalCode,
    filename561l: source.filename561l,
    filenameSlrb: source.filenameSlrb,
    fileHash561l: source.fileHash561l,
    fileHashSlrb: source.fileHashSlrb ?? "",
    parentImportId: source.id,
  });
  const docs = await prisma.autopartHistoryStagedDocument.findMany({
    where: { importId: source.id, accountCode: verified },
  });
  await writeHistoricAccountBatch({
    runId,
    companyId,
    accountCode: classified.canonicalCode,
    documents: docs.map((document) => ({
      documentType: document.documentType === "CREDIT" ? "CREDIT" : "INVOICE",
      documentReference: document.documentReference,
      documentDate: document.documentDate ? document.documentDate.toISOString().slice(0, 10) : null,
      goodsNet: document.goodsNet?.toString() ?? null,
      vat: document.vat?.toString() ?? null,
      grossTotal: document.grossTotal?.toString() ?? null,
      source: document.source === "561L" ? "561L" : "SLRB",
    })),
    lines: [],
  });
  let lineCount = 0;
  let cursor: string | undefined;
  while (true) {
    const lines = await prisma.autopartHistoryStagedLine.findMany({
      where: { importId: source.id, accountCode: verified },
      orderBy: { id: "asc" },
      take: BATCH,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    if (!lines.length) break;
    cursor = lines[lines.length - 1]!.id;
    lineCount += lines.length;
    await writeHistoricAccountBatch({
      runId,
      companyId,
      accountCode: classified.canonicalCode,
      documents: [],
      lines: lines.map((line) => ({
        documentType: line.documentType === "CREDIT" ? "CREDIT" : "INVOICE",
        documentReference: line.documentReference,
        lineNumber: line.lineNumber,
        sku: line.sku,
        description: line.descriptionSnapshot,
        units: line.units.toString(),
        salesNet: line.salesNet.toString(),
        rawInvAndLn: line.rawInvAndLn ?? "",
      })),
    });
  }
  await stampPromotedHistoricComparisons(companyId, source.id, verified);
  await closeHistoricAccountWrite(runId, { imported: lineCount, updated: 0 });
  await prisma.autopartHistoryReviewAccount.update({
    where: { id: review.id },
    data: { status: "APPLIED", companyId, appliedAt: new Date(), warnings: [] },
  });
  return { completed: true, applied: docs.length + lineCount > 0, documents: docs.length, lines: lineCount };
}

async function stampPromotedHistoricComparisons(companyId: string, importId: string, accountCode: string) {
  const [documents, grouped] = await Promise.all([
    prisma.autopartHistoryStagedDocument.findMany({
      where: { importId, accountCode },
      select: { documentType: true, documentReference: true, goodsNet: true },
    }),
    prisma.autopartHistoryStagedLine.groupBy({
      by: ["documentType", "documentReference"],
      where: { importId, accountCode },
      _sum: { salesNet: true },
    }),
  ]);
  const lineMinorByDoc = new Map<string, number>();
  for (const row of grouped) {
    lineMinorByDoc.set(
      `${row.documentType}|${row.documentReference}`,
      moneyToMinor(row._sum.salesNet?.toString() ?? null) ?? 0,
    );
  }
  for (const document of documents) {
    if (document.goodsNet == null) continue;
    const goodsMinor = moneyToMinor(document.goodsNet.toString());
    if (goodsMinor == null) continue;
    const lineMinor = lineMinorByDoc.get(`${document.documentType}|${document.documentReference}`) ?? 0;
    const diff = lineMinor - goodsMinor;
    await stampHistoricDocumentComparison({
      companyId,
      documentType: document.documentType === "CREDIT" ? "CREDIT" : "INVOICE",
      documentReference: document.documentReference,
      linesNet: minorToMoney(lineMinor),
      mismatchMinor: diff === 0 ? null : diff,
    });
  }
}

async function writeText(filename: string, text: string): Promise<StoredFile> {
  await mkdir(path.join(autopartImportRoot(), "history"), { recursive: true });
  const dest = path.join(autopartImportRoot(), "history", `${randomUUID()}-${filename.replace(/[^A-Za-z0-9._()-]+/g, "_")}`);
  const bytes = Buffer.from(text, "utf8");
  const hash = createHash("sha256").update(bytes).digest("hex");
  const { writeFile } = await import("node:fs/promises");
  await writeFile(dest, bytes);
  return { path: dest, filename, sha256: hash, bytes: bytes.length, encoding: "utf-8" };
}

async function summariseHistoricFiles(
  file561: { path: string; encoding: "utf-8" | "windows-1252" },
  fileSlrb: { path: string; encoding: "utf-8" | "windows-1252" },
) {
  const directory = await loadDirectory();
  const docs = new Map<string, DocAccum>();
  const accountLines = new Map<string, number>();
  const accountMinor = new Map<string, number>();
  let parsed561 = 0;
  let malformed561 = 0;
  let parsedSlrb = 0;
  let malformedSlrb = 0;
  let excludedLedger = 0;
  let excludedMinor = 0;
  let invoiceLines = 0;
  let creditLines = 0;
  let lineMinor = 0;
  let goodsMinor = 0;
  let slrbHeader: string[] = [];
  let lineHeader: string[] = [];
  const fileDocsByCompany = new Map<string, Set<string>>();

  await forEachAutopartCsvRecord(fileSlrb.path, fileSlrb.encoding, (record) => {
    parsedSlrb += 1;
    const columns = headerIndex(slrbHeader);
    if (record.malformed || columns.account < 0 || columns.type < 0 || columns.ref < 0) {
      malformedSlrb += 1;
      return;
    }
    const account = (record.fields[columns.account] ?? "").trim().toUpperCase();
    const rawType = (record.fields[columns.type] ?? "").trim().toUpperCase();
    const documentType = mapSlrbDocumentType(rawType);
    if (documentType === "PAYMENT" || documentType === "JOURNAL" || rawType === "CSH" || rawType === "OPB") {
      excludedLedger += 1;
      excludedMinor += moneyToMinor(record.fields[columns.goods] ?? null) ?? 0;
      return;
    }
    if (documentType !== "INVOICE" && documentType !== "CREDIT") {
      malformedSlrb += 1;
      return;
    }
    const reference = (record.fields[columns.ref] ?? "").trim().toUpperCase();
    if (!account || !reference) {
      malformedSlrb += 1;
      return;
    }
    const key = docKey(account, documentType, reference);
    const goods = moneyToMinor(record.fields[columns.goods] ?? null);
    const current = docs.get(key) ?? {
      account,
      documentType,
      documentReference: reference,
      documentDate: null,
      goodsMinor: null,
      vatMinor: null,
      grossMinor: null,
      ledgerRows: 0,
      lineMinor: 0,
      lineCount: 0,
    };
    if (goods != null) current.goodsMinor = (current.goodsMinor ?? 0) + goods;
    current.ledgerRows += 1;
    docs.set(key, current);
  }, (header) => {
    slrbHeader = header;
  });

  await forEachAutopartCsvRecord(file561.path, file561.encoding, (record) => {
    parsed561 += 1;
    const parsed = accept561(record, headerIndex(lineHeader));
    if (!parsed) {
      malformed561 += 1;
      return;
    }
    if (parsed.documentType === "INVOICE") invoiceLines += 1;
    else creditLines += 1;
    lineMinor += parsed.minor;
    accountLines.set(parsed.account, (accountLines.get(parsed.account) ?? 0) + 1);
    accountMinor.set(parsed.account, (accountMinor.get(parsed.account) ?? 0) + parsed.minor);
    const key = docKey(parsed.account, parsed.documentType, parsed.documentReference);
    const current = docs.get(key) ?? {
      account: parsed.account,
      documentType: parsed.documentType,
      documentReference: parsed.documentReference,
      documentDate: null,
      goodsMinor: null,
      vatMinor: null,
      grossMinor: null,
      ledgerRows: 0,
      lineMinor: 0,
      lineCount: 0,
    };
    current.lineMinor += parsed.minor;
    current.lineCount += 1;
    docs.set(key, current);
    const classified = classifyHistoricAccount(parsed.account, directory);
    if (classified.outcome === "import") {
      const keys = fileDocsByCompany.get(classified.companyId) ?? new Set<string>();
      keys.add(`${parsed.documentType}::${parsed.documentReference}`);
      fileDocsByCompany.set(classified.companyId, keys);
    }
  }, (header) => {
    lineHeader = header;
  });

  let discrepancyCount = 0;
  let discrepancyMinor = 0;
  const reasons = { UNKNOWN: 0, AMBIGUOUS: 0, UNLINKED: 0, NOT_VERIFIED: 0 };
  const accounts = new Set<string>(accountLines.keys());
  for (const doc of docs.values()) accounts.add(doc.account);
  let matchedAccounts = 0;
  let unmatchedAccounts = 0;
  let matchedLines = 0;
  let unmatchedLines = 0;
  for (const account of accounts) {
    const classified = classifyHistoricAccount(account, directory);
    const lines = accountLines.get(account) ?? 0;
    if (classified.outcome === "import") {
      matchedAccounts += 1;
      matchedLines += lines;
    } else {
      unmatchedAccounts += 1;
      unmatchedLines += lines;
      reasons[classified.reason] += 1;
    }
  }
  for (const doc of docs.values()) {
    if (doc.goodsMinor == null) continue;
    goodsMinor += doc.goodsMinor;
    const diff = doc.lineMinor - doc.goodsMinor;
    if (diff !== 0 && doc.lineCount > 0) {
      discrepancyCount += 1;
      discrepancyMinor += diff;
    }
  }

  const examples: Array<{ account: string; documentReference: string; source: string }> = [];
  let overlapDocuments = 0;
  let overlapLines = 0;
  for (const [companyId, keys] of fileDocsByCompany) {
    const references = [...new Set([...keys].map((key) => key.split("::")[1] ?? "").filter(Boolean))];
    for (let index = 0; index < references.length; index += 500) {
      const chunk = references.slice(index, index + 500);
      const [documents, lines] = await Promise.all([
        prisma.autopartSalesDocument.findMany({
          where: {
            companyId,
            documentReference: { in: chunk },
            OR: [{ has504: true }, { hasTrm21qc: true }, { source: { in: [...ONGOING_SOURCES] } }],
          },
          select: { documentType: true, documentReference: true, source: true, autopartCustomerCode: true },
        }),
        prisma.autopartSalesLine.count({
          where: { companyId, source: "ONGOING_TRM21QC", documentReference: { in: chunk } },
        }),
      ]);
      for (const document of documents) {
        if (!keys.has(`${document.documentType}::${document.documentReference}`)) continue;
        overlapDocuments += 1;
        if (examples.length < 20) {
          examples.push({
            account: document.autopartCustomerCode,
            documentReference: document.documentReference,
            source: document.source,
          });
        }
      }
      overlapLines += lines;
    }
  }

  return {
    parsed561,
    malformed561,
    parsedSlrb,
    malformedSlrb,
    excludedLedger,
    invoiceLines,
    creditLines,
    lineNet: minorToMoney(lineMinor),
    goodsNet: minorToMoney(goodsMinor),
    excludedLedgerNet: minorToMoney(excludedMinor),
    discrepancyCount,
    discrepancyNet: minorToMoney(discrepancyMinor),
    matchedAccounts,
    unmatchedAccounts,
    matchedLines,
    unmatchedLines,
    reasons,
    ongoingOverlaps: { documents: overlapDocuments, lines: overlapLines, examples },
    storage: describeHistoricStorage(process.env, process.cwd()),
  };
}

export async function historicMatchingReadiness(actorUserId: string) {
  await requireSystemPermission(actorUserId, "autopart.import.view");
  return buildHistoricMatchingReadiness();
}

export async function buildHistoricMatchingReadiness() {
  const directory = await loadDirectory();
  const tableRows = await prisma.$queryRaw<Array<{ present: boolean }>>`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'AutopartHistoryAllImport'
    ) AS present
  `;
  const allImportTablesPresent = Boolean(tableRows[0]?.present);
  const [masters, historicLines, globalLines, latest] = await Promise.all([
    prisma.autopartAccount.findMany({ select: { accountCode: true } }),
    prisma.autopartSalesLine.groupBy({
      by: ["autopartCustomerCode"],
      where: { source: { not: "ONGOING_TRM21QC" } },
      _count: { _all: true },
      _sum: { salesNet: true },
    }),
    prisma.autopartInvoiceLine.groupBy({
      by: ["accountCode"],
      _count: { _all: true },
      _sum: { salesAmount: true },
    }),
    allImportTablesPresent
      ? prisma.autopartHistoryAllImport.findFirst({
          where: { status: "COMMITTED" },
          orderBy: { createdAt: "desc" },
          select: { id: true, importedLineCount: true, stagedLineCount: true, accountsCommitted: true, accountsReviewed: true, createdAt: true },
        })
      : Promise.resolve(null),
  ]);
  const masterSplit = { import: 0, UNKNOWN: 0, AMBIGUOUS: 0, UNLINKED: 0, NOT_VERIFIED: 0 };
  for (const account of masters) {
    const classified = classifyHistoricAccount(account.accountCode, directory);
    if (classified.outcome === "import") masterSplit.import += 1;
    else masterSplit[classified.reason] += 1;
  }
  const splitLines = (
    rows: Array<{ code: string; count: number; net: { toString(): string } | null }>,
  ) => {
    let importLines = 0;
    let stagedLines = 0;
    let importNet = 0;
    let stagedNet = 0;
    for (const row of rows) {
      const classified = classifyHistoricAccount(row.code, directory);
      const net = moneyToMinor(row.net?.toString() ?? null) ?? 0;
      if (classified.outcome === "import") {
        importLines += row.count;
        importNet += net;
      } else {
        stagedLines += row.count;
        stagedNet += net;
      }
    }
    return {
      importLines,
      stagedLines,
      importNet: minorToMoney(importNet),
      stagedNet: minorToMoney(stagedNet),
    };
  };
  const environment = describeHistoricEnvironment(process.env, describeDatabaseUrl(process.env["DATABASE_URL"] ?? ""));
  return {
    environment,
    storage: describeHistoricStorage(process.env, process.cwd()),
    verifiedCompanyCodes: [...directory.verifiedByCode.values()].filter((target) => target != null).length,
    masterAccounts: masters.length,
    masterSplit,
    customerHistoryLines: splitLines(
      historicLines.map((row) => ({ code: row.autopartCustomerCode, count: row._count._all, net: row._sum.salesNet })),
    ),
    globalInvoiceLines: splitLines(
      globalLines.map((row) => ({ code: row.accountCode, count: row._count._all, net: row._sum.salesAmount })),
    ),
    allImportTablesPresent,
    latestCommittedImport: latest
      ? {
          id: latest.id,
          createdAt: latest.createdAt.toISOString(),
          importedLineCount: latest.importedLineCount,
          stagedLineCount: latest.stagedLineCount,
          accountsCommitted: latest.accountsCommitted,
          accountsReviewed: latest.accountsReviewed,
        }
      : null,
    note: "Verified exact accounts would import. Every other 407EXP or file account would stay staged. This does not read the ALL files and does not change any row. Preview an uploaded pair for that file's matched, unmatched, and discrepancy totals.",
  };
}
