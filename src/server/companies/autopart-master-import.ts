/**
 * Autopart 407EXP customer master and bulk 561L / SLRB history.
 * Reads private upload files. Does not create orders, change stock, send email,
 * or grant portal or historical access.
 */
import { createHash, randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import { createInterface } from "node:readline";
import { once } from "node:events";
import { finished } from "node:stream/promises";
import {
  Prisma,
  type AutopartAccountClassification,
  type AutopartDocumentMatchStatus,
  type AutopartMasterImportKind,
} from "@prisma/client";
import { prisma } from "@/infra/database/client";
import {
  AUTOPART_SOURCE_SYSTEM,
  parse407ExpDataLine,
  type Exp407Issue,
  type Exp407Row,
} from "@/domain/autopart-407exp";
import {
  INVOICE_REQUIRED_COLUMNS,
  LEDGER_REQUIRED_COLUMNS,
  applyColumnMap,
  detectColumnMap,
  interpretInvoiceRecord,
  interpretLedgerRecord,
  reconciliationStatus,
  createCsvPreviewTally,
  streamCsvRecords,
  type CanonicalColumn,
  type CsvScanRecord,
} from "@/domain/autopart-bulk-csv";
import { recordAuditEvent } from "@/server/audit/record";
import { AuthError, requireCompanyAccess, requireSystemPermission } from "@/server/rbac/guards";
import { loadCompanyGlobalAutopartHistory } from "@/server/companies/autopart-internal-history";

const ISSUE_CAP = 2000;
const CHUNK = 200;
const STALE_MS = 15 * 60 * 1000;
const DEFAULT_MAX_BYTES = 250 * 1024 * 1024;

const runningBatches = new Set<string>();

export function autopartImportRoot(): string {
  return process.env["AUTOPART_IMPORT_DIR"] || path.join(process.cwd(), "data", "autopart-imports");
}

export function autopartImportMaxBytes(): number {
  const raw = Number(process.env["AUTOPART_IMPORT_MAX_BYTES"] ?? DEFAULT_MAX_BYTES);
  if (!Number.isFinite(raw) || raw < 1024) return DEFAULT_MAX_BYTES;
  return Math.floor(raw);
}

export function portalAutopartHistoryEnabled(): boolean {
  return process.env["AUTOPART_PORTAL_HISTORY_ENABLED"] === "true";
}

function assertInsideRoot(filePath: string): string {
  const root = path.resolve(autopartImportRoot());
  const resolved = path.resolve(filePath);
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
    throw new AuthError("Import file path is not in private storage", "VALIDATION", 400);
  }
  return resolved;
}

export async function saveAutopartUpload(input: {
  actorUserId: string;
  filename: string;
  kind: AutopartMasterImportKind;
  body: ReadableStream<Uint8Array> | null;
}): Promise<{ batchId: string; fileHash: string; bytes: number }> {
  await requireSystemPermission(input.actorUserId, "autopart.import.manage");
  if (!input.body) throw new AuthError("Upload body is empty", "VALIDATION", 400);
  const safeName = input.filename
    .replace(/[^A-Za-z0-9._-]+/g, "_")
    .replace(/^\.+/, "")
    .slice(0, 80);
  if (!safeName) throw new AuthError("Filename is required", "VALIDATION", 400);
  await mkdir(autopartImportRoot(), { recursive: true });
  const dest = assertInsideRoot(path.join(autopartImportRoot(), `${randomUUID()}-${safeName}`));
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
  const fileHash = hash.digest("hex");
  const batch = await prisma.autopartImportBatch.create({
    data: {
      kind: input.kind,
      status: "UPLOADED",
      filename: safeName,
      fileHash,
      storagePath: dest,
      dryRun: true,
      createdById: input.actorUserId,
    },
  });
  await recordAuditEvent({
    action: "autopart_master_uploaded",
    entityType: "AutopartImportBatch",
    entityId: batch.id,
    actorUserId: input.actorUserId,
    metadata: { kind: input.kind, bytes, fileHash },
  });
  return { batchId: batch.id, fileHash, bytes };
}

type ColumnMap = Partial<Record<CanonicalColumn, string>>;

function readColumnMap(value: Prisma.JsonValue | null): ColumnMap {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const map: ColumnMap = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === "string") map[key as CanonicalColumn] = entry;
  }
  return map;
}

async function* streamTextLines(
  filePath: string,
): AsyncGenerator<{ rowNumber: number; line: string }> {
  const rl = createInterface({
    input: createReadStream(assertInsideRoot(filePath), { encoding: "utf8" }),
    crlfDelay: Infinity,
  });
  let rowNumber = 0;
  try {
    for await (const line of rl) {
      rowNumber += 1;
      yield { rowNumber, line: String(line).replace(/^\uFEFF/, "") };
    }
  } finally {
    rl.close();
  }
}

async function ownBatch(actorUserId: string, batchId: string) {
  await requireSystemPermission(actorUserId, "autopart.import.view");
  const batch = await prisma.autopartImportBatch.findUnique({ where: { id: batchId } });
  if (!batch) throw new AuthError("Import batch was not found", "NOT_FOUND", 404);
  return batch;
}

function publicBatch<T extends { storagePath: string | null }>(batch: T) {
  const { storagePath: _storagePath, ...rest } = batch;
  return rest;
}

export async function previewAutopartImport(
  actorUserId: string,
  input: { batchId: string; columnMap?: ColumnMap },
) {
  await requireSystemPermission(actorUserId, "autopart.import.manage");
  const batch = await ownBatch(actorUserId, input.batchId);
  if (!batch.storagePath)
    throw new AuthError("The upload file is no longer stored", "VALIDATION", 400);
  if (batch.status === "RUNNING" || batch.status === "COMMITTED") {
    throw new AuthError("This batch can no longer be previewed", "VALIDATION", 400);
  }
  await recoverStale(batch.id, batch.status, batch.heartbeatAt);
  const columnMap = input.columnMap ?? readColumnMap(batch.columnMap);
  if (batch.kind === "CUSTOMER_MASTER")
    return previewCustomers(batch.id, batch.storagePath, actorUserId);
  if (batch.kind === "INVOICE_LINES") {
    return previewCsv(batch.id, batch.storagePath, "INVOICE_LINES", columnMap, actorUserId);
  }
  return previewCsv(batch.id, batch.storagePath, "LEDGER", columnMap, actorUserId);
}

async function previewCustomers(batchId: string, filePath: string, actorUserId: string) {
  const summary = {
    dataRows: 0,
    distinctAccounts: 0,
    duplicateAccounts: 0,
    blankArea: 0,
    blankRep: 0,
    truncatedNames: 0,
    rejectedRows: 0,
    classifications: {} as Record<string, number>,
  };
  const seen = new Set<string>();
  const samples: Exp407Row[] = [];
  const issues: Exp407Issue[] = [];
  for await (const { rowNumber, line } of streamTextLines(filePath)) {
    const parsed = parse407ExpDataLine(line, rowNumber);
    if ("skip" in parsed) continue;
    if ("reject" in parsed) {
      summary.rejectedRows += 1;
      if (issues.length < 20) issues.push(parsed.reject);
      continue;
    }
    summary.dataRows += 1;
    if (parsed.row.nameTruncated) summary.truncatedNames += 1;
    if (!parsed.row.areaCode) summary.blankArea += 1;
    if (!parsed.row.repCode) summary.blankRep += 1;
    if (seen.has(parsed.row.accountCode)) {
      summary.duplicateAccounts += 1;
      if (issues.length < 20) {
        issues.push({
          sourceRowNumber: rowNumber,
          sourceRecordId: parsed.row.accountCode,
          issueType: "DUPLICATE_ACCOUNT",
          severity: "WARNING",
          explanation: `Account ${parsed.row.accountCode} is repeated. The first row is kept.`,
        });
      }
      continue;
    }
    seen.add(parsed.row.accountCode);
    summary.distinctAccounts += 1;
    summary.classifications[parsed.row.classification] =
      (summary.classifications[parsed.row.classification] ?? 0) + 1;
    if (samples.length < 8) samples.push(parsed.row);
  }
  const ready = summary.distinctAccounts > 0;
  const updated = await prisma.autopartImportBatch.update({
    where: { id: batchId },
    data: {
      status: ready ? "PREVIEWED" : "UPLOADED",
      dryRun: true,
      totalRows: summary.dataRows,
      validRows: summary.distinctAccounts,
      duplicateRows: summary.duplicateAccounts,
      rejectedRows: summary.rejectedRows,
      errorSummary: ready ? null : "No customer accounts were found in this file.",
      diagnostics: { summary, samples, issues, structural: ready },
    },
  });
  await recordAuditEvent({
    action: "autopart_master_previewed",
    entityType: "AutopartImportBatch",
    entityId: batchId,
    actorUserId,
    metadata: { kind: "CUSTOMER_MASTER", distinctAccounts: summary.distinctAccounts, ready },
  });
  return publicBatch(updated);
}

async function previewCsv(
  batchId: string,
  filePath: string,
  kind: "INVOICE_LINES" | "LEDGER",
  columnMap: ColumnMap,
  actorUserId: string,
) {
  const required = kind === "INVOICE_LINES" ? INVOICE_REQUIRED_COLUMNS : LEDGER_REQUIRED_COLUMNS;
  let headers: string[] = [];
  let map: Partial<Record<CanonicalColumn, number>> = {};
  let missing: CanonicalColumn[] = [...required];
  const accounts = new Set<string>();
  const samples: unknown[] = [];
  const tally = createCsvPreviewTally(kind === "INVOICE_LINES" ? "invoice" : "ledger");
  let headerSeen = false;
  for await (const record of streamCsvRecords(filePath)) {
    if (!headerSeen) {
      headerSeen = true;
      headers = record.cells;
      const detected = Object.keys(columnMap).length
        ? { map: applyColumnMap(headers, columnMap), missing: [] as CanonicalColumn[] }
        : detectColumnMap(headers, required);
      map = detected.map;
      missing = required.filter((column) => map[column] == null);
      if (missing.length > 0) break;
      continue;
    }
    const interpreted =
      kind === "INVOICE_LINES"
        ? interpretInvoiceRecord(record, headers, map)
        : interpretLedgerRecord(record, headers, map);
    tally.add(record, interpreted);
    if ("reject" in interpreted) continue;
    accounts.add(interpreted.row.accountCode);
    const recoveredSamples = samples.filter(
      (row) =>
        row != null && typeof row === "object" && "recovered" in row && row.recovered === true,
    ).length;
    if (!record.recovered && samples.length - recoveredSamples < 6) samples.push(interpreted.row);
    if (record.recovered && recoveredSamples < 2) {
      samples.push({ ...interpreted.row, recovered: true });
    }
  }
  const preview = tally.finish();
  const dataRows = preview.sourceRecords;
  const validRows = preview.validRecords + preview.recoveredRecords;
  const rejectedRows = preview.rejectedRecords;
  const needsMapping = missing.length > 0;
  const ready = !needsMapping && validRows > 0;
  const updated = await prisma.autopartImportBatch.update({
    where: { id: batchId },
    data: {
      status: ready ? "PREVIEWED" : "UPLOADED",
      dryRun: true,
      columnMap: columnMap as Prisma.InputJsonValue,
      totalRows: dataRows,
      validRows,
      rejectedRows,
      unmatchedAccounts: 0,
      errorSummary: needsMapping
        ? `Column mapping required: ${missing.join(", ")}`
        : ready
          ? null
          : "No valid data rows were found.",
      diagnostics: {
        headers,
        missingColumns: missing,
        needsMapping,
        samples,
        issues: preview.rejectedExamples,
        recoveredQuotes: preview.recoveredRecords,
        sourceRecords: preview.sourceRecords,
        validRecords: preview.validRecords,
        recoveredRecords: preview.recoveredRecords,
        rejectedRecords: preview.rejectedRecords,
        acceptedSales: preview.acceptedSales,
        recoveredSales: preview.recoveredSales,
        rejectionReasons: preview.rejectionReasons,
        unresolvedParsing: preview.unresolvedParsing,
        distinctAccounts: accounts.size,
        salesMeasure: kind === "INVOICE_LINES" ? "NET_EX_VAT" : null,
        structural: ready,
        provisionalHeaders: missing.length > 0,
      } as Prisma.InputJsonValue,
    },
  });
  await recordAuditEvent({
    action: "autopart_master_previewed",
    entityType: "AutopartImportBatch",
    entityId: batchId,
    actorUserId,
    metadata: { kind, validRows, rejectedRows, needsMapping },
  });
  return publicBatch(updated);
}

export async function confirmAutopartImport(actorUserId: string, batchId: string) {
  await requireSystemPermission(actorUserId, "autopart.import.manage");
  const batch = await ownBatch(actorUserId, batchId);
  if (batch.status !== "PREVIEWED" && batch.status !== "FAILED") {
    throw new AuthError("Preview the file before confirming the import", "VALIDATION", 400);
  }
  if (!batch.storagePath)
    throw new AuthError("The upload file is no longer stored", "VALIDATION", 400);
  const conflict = await prisma.autopartImportBatch.findFirst({
    where: { kind: batch.kind, status: "RUNNING", id: { not: batch.id } },
  });
  if (conflict)
    throw new AuthError("Another import of this type is already running", "CONFLICT", 409);
  const storagePath = batch.storagePath;
  const kind = batch.kind;
  const columnMap = readColumnMap(batch.columnMap);
  await prisma.autopartImportBatch.update({
    where: { id: batch.id },
    data: {
      status: "RUNNING",
      dryRun: false,
      startedAt: new Date(),
      heartbeatAt: new Date(),
      cancelRequested: false,
      errorSummary: null,
    },
  });
  runningBatches.add(batch.id);
  void executeConfirmedImport({
    batchId: batch.id,
    storagePath,
    kind,
    columnMap,
    actorUserId,
  }).finally(() => {
    runningBatches.delete(batch.id);
  });
  const running = await prisma.autopartImportBatch.findUniqueOrThrow({ where: { id: batch.id } });
  return publicBatch(running);
}

async function executeConfirmedImport(input: {
  batchId: string;
  storagePath: string;
  kind: AutopartMasterImportKind;
  columnMap: ColumnMap;
  actorUserId: string;
}) {
  try {
    if (input.kind === "CUSTOMER_MASTER") await commitCustomers(input.batchId, input.storagePath);
    else await commitCsv(input.batchId, input.storagePath, input.kind, input.columnMap);
    await rm(assertInsideRoot(input.storagePath), { force: true });
    const done = await prisma.autopartImportBatch.update({
      where: { id: input.batchId },
      data: { status: "COMMITTED", storagePath: null, completedAt: new Date(), dryRun: false },
    });
    await recordAuditEvent({
      action: "autopart_master_committed",
      entityType: "AutopartImportBatch",
      entityId: input.batchId,
      actorUserId: input.actorUserId,
      metadata: {
        kind: input.kind,
        importedRows: done.importedRows,
        updatedRows: done.updatedRows,
        rejectedRows: done.rejectedRows,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Import failed";
    await prisma.autopartImportBatch.update({
      where: { id: input.batchId },
      data: { status: "FAILED", errorSummary: message.slice(0, 500), completedAt: new Date() },
    });
    await recordAuditEvent({
      action: "autopart_master_failed",
      entityType: "AutopartImportBatch",
      entityId: input.batchId,
      actorUserId: input.actorUserId,
      metadata: { kind: input.kind },
    });
  }
}

async function heartbeat(batchId: string, counts: Record<string, number>) {
  const current = await prisma.autopartImportBatch.findUnique({
    where: { id: batchId },
    select: { cancelRequested: true },
  });
  if (current?.cancelRequested) throw new AuthError("Import cancelled", "CANCELLED", 409);
  await prisma.autopartImportBatch.update({
    where: { id: batchId },
    data: { heartbeatAt: new Date(), ...counts },
  });
}

async function commitCustomers(batchId: string, filePath: string) {
  const seen = new Set<string>();
  let chunk: Exp407Row[] = [];
  let imported = 0;
  let updated = 0;
  let duplicates = 0;
  let rejected = 0;
  let issuesStored = 0;
  const pendingIssues: Prisma.AutopartImportIssueCreateManyInput[] = [];
  const flushIssues = async () => {
    const room = ISSUE_CAP - issuesStored;
    const slice = pendingIssues.splice(0, Math.max(0, room));
    if (slice.length === 0) return;
    await prisma.autopartImportIssue.createMany({ data: slice });
    issuesStored += slice.length;
  };
  const flush = async () => {
    if (chunk.length === 0) return;
    const result = await upsertAccounts(batchId, chunk);
    imported += result.imported;
    updated += result.updated;
    chunk = [];
    await heartbeat(batchId, {
      importedRows: imported,
      updatedRows: updated,
      duplicateRows: duplicates,
      rejectedRows: rejected,
    });
  };
  for await (const { rowNumber, line } of streamTextLines(filePath)) {
    const parsed = parse407ExpDataLine(line, rowNumber);
    if ("skip" in parsed) continue;
    if ("reject" in parsed) {
      rejected += 1;
      pendingIssues.push(issueInput(batchId, parsed.reject));
      continue;
    }
    if (seen.has(parsed.row.accountCode)) {
      duplicates += 1;
      pendingIssues.push(
        issueInput(batchId, {
          sourceRowNumber: rowNumber,
          sourceRecordId: parsed.row.accountCode,
          issueType: "DUPLICATE_ACCOUNT",
          severity: "WARNING",
          explanation: `Account ${parsed.row.accountCode} is repeated. The first row is kept.`,
        }),
      );
      continue;
    }
    seen.add(parsed.row.accountCode);
    chunk.push(parsed.row);
    if (chunk.length >= CHUNK) {
      await flush();
      await flushIssues();
    }
  }
  await flush();
  await flushIssues();
  await relinkHistoricalRows();
  await prisma.autopartImportBatch.update({
    where: { id: batchId },
    data: {
      totalRows: imported + updated + duplicates + rejected,
      validRows: imported + updated,
      importedRows: imported,
      updatedRows: updated,
      duplicateRows: duplicates,
      rejectedRows: rejected,
      diagnostics: { issueLogTruncated: issuesStored >= ISSUE_CAP },
    },
  });
}

function issueInput(
  batchId: string,
  issue:
    | Exp407Issue
    | {
        sourceRowNumber: number;
        sourceRecordId: string | null;
        issueType: string;
        severity: "ERROR" | "WARNING";
        explanation: string;
        raw?: string;
      },
): Prisma.AutopartImportIssueCreateManyInput {
  return {
    batchId,
    sourceRowNumber: issue.sourceRowNumber,
    sourceRecordId: issue.sourceRecordId,
    issueType: issue.issueType,
    severity: issue.severity,
    explanation: issue.explanation.slice(0, 500),
    rawExcerpt: "raw" in issue && issue.raw ? issue.raw.slice(0, 500) : null,
  };
}

async function upsertAccounts(batchId: string, rows: Exp407Row[]) {
  const codes = rows.map((row) => row.accountCode);
  const existing = await prisma.autopartAccount.findMany({
    where: { sourceSystem: AUTOPART_SOURCE_SYSTEM, accountCode: { in: codes } },
  });
  const byCode = new Map(existing.map((row) => [row.accountCode, row]));
  const fresh = rows.filter((row) => !byCode.has(row.accountCode));
  if (fresh.length > 0) {
    await prisma.autopartAccount.createMany({
      data: fresh.map((row) => ({
        sourceSystem: AUTOPART_SOURCE_SYSTEM,
        accountCode: row.accountCode,
        originalName: row.originalName,
        nameTruncated: row.nameTruncated,
        areaCode: row.areaCode,
        repCode: row.repCode,
        classification: row.classification,
        classificationSource: "AUTO",
        classificationNote: row.classificationNote,
        portalEligible: false,
        historicalAccessEnabled: false,
        lastImportBatchId: batchId,
      })),
    });
  }
  for (const row of rows) {
    const current = byCode.get(row.accountCode);
    if (!current) continue;
    await prisma.autopartAccount.update({
      where: { id: current.id },
      data: {
        originalName: row.originalName,
        nameTruncated: row.nameTruncated,
        areaCode: row.areaCode,
        repCode: row.repCode,
        lastImportBatchId: batchId,
        ...(current.classificationSource === "AUTO"
          ? { classification: row.classification, classificationNote: row.classificationNote }
          : {}),
      },
    });
  }
  return { imported: fresh.length, updated: rows.length - fresh.length };
}

async function commitCsv(
  batchId: string,
  filePath: string,
  kind: AutopartMasterImportKind,
  columnMap: ColumnMap,
) {
  const required = kind === "INVOICE_LINES" ? INVOICE_REQUIRED_COLUMNS : LEDGER_REQUIRED_COLUMNS;
  let headers: string[] = [];
  let map: Partial<Record<CanonicalColumn, number>> = {};
  let headerSeen = false;
  let imported = 0;
  let updated = 0;
  let rejected = 0;
  let issuesStored = 0;
  const accounts = new Set<string>();
  const unmatched = new Set<string>();
  let buffer: CsvScanRecord[] = [];
  const pendingIssues: Prisma.AutopartImportIssueCreateManyInput[] = [];
  const flushIssues = async () => {
    const room = ISSUE_CAP - issuesStored;
    const slice = pendingIssues.splice(0, Math.max(0, room));
    if (!slice.length) return;
    await prisma.autopartImportIssue.createMany({ data: slice });
    issuesStored += slice.length;
  };
  const flush = async () => {
    if (!buffer.length) return;
    const result =
      kind === "INVOICE_LINES"
        ? await upsertInvoiceRows(batchId, headers, map, buffer)
        : await upsertLedgerRows(batchId, headers, map, buffer);
    imported += result.imported;
    updated += result.updated;
    rejected += result.rejected;
    for (const code of result.accounts) accounts.add(code);
    for (const code of result.unmatched) unmatched.add(code);
    pendingIssues.push(...result.issues);
    buffer = [];
    await heartbeat(batchId, {
      importedRows: imported,
      updatedRows: updated,
      rejectedRows: rejected,
      unmatchedAccounts: unmatched.size,
    });
    await flushIssues();
  };
  for await (const record of streamCsvRecords(filePath)) {
    if (!headerSeen) {
      headerSeen = true;
      headers = record.cells;
      map = Object.keys(columnMap).length
        ? applyColumnMap(headers, columnMap)
        : detectColumnMap(headers, required).map;
      const missing = required.filter((column) => map[column] == null);
      if (missing.length)
        throw new AuthError(`Column mapping required: ${missing.join(", ")}`, "VALIDATION", 400);
      continue;
    }
    buffer.push(record);
    if (buffer.length >= CHUNK) await flush();
  }
  await flush();
  await relinkHistoricalRows();
  await reconcileAccounts([...accounts], batchId);
  await prisma.autopartImportBatch.update({
    where: { id: batchId },
    data: {
      validRows: imported + updated,
      importedRows: imported,
      updatedRows: updated,
      rejectedRows: rejected,
      unmatchedAccounts: unmatched.size,
      reconciliationStatus: "RECONCILED",
      diagnostics: {
        issueLogTruncated: issuesStored >= ISSUE_CAP,
        salesMeasure: kind === "INVOICE_LINES" ? "NET_EX_VAT" : null,
        distinctAccounts: accounts.size,
      },
    },
  });
}

function sourceIdentity(parts: string[]): string {
  return createHash("sha256").update(parts.join("\u001e")).digest("hex");
}

async function accountIdMap(codes: string[]) {
  const rows = await prisma.autopartAccount.findMany({
    where: { sourceSystem: AUTOPART_SOURCE_SYSTEM, accountCode: { in: codes } },
    select: { id: true, accountCode: true },
  });
  return new Map(rows.map((row) => [row.accountCode, row.id]));
}

async function upsertInvoiceRows(
  batchId: string,
  headers: string[],
  map: Partial<Record<CanonicalColumn, number>>,
  records: CsvScanRecord[],
) {
  const occurrences = new Map<string, number>();
  const prepared: Prisma.AutopartInvoiceLineCreateManyInput[] = [];
  const issues: Prisma.AutopartImportIssueCreateManyInput[] = [];
  let rejected = 0;
  for (const record of records) {
    const interpreted = interpretInvoiceRecord(record, headers, map);
    if ("reject" in interpreted) {
      rejected += 1;
      issues.push(
        issueInput(batchId, {
          sourceRowNumber: interpreted.reject.rowNumber,
          sourceRecordId: interpreted.reject.sourceRecordId,
          issueType: interpreted.reject.issueType,
          severity: "ERROR",
          explanation: interpreted.reject.explanation,
          raw: interpreted.reject.raw,
        }),
      );
      continue;
    }
    const row = interpreted.row;
    const natural = [
      row.accountCode,
      row.rawInvAndLn,
      row.partNumber,
      row.quantity,
      row.salesAmount,
    ].join("\u001e");
    const occurrence = (occurrences.get(natural) ?? 0) + 1;
    occurrences.set(natural, occurrence);
    prepared.push({
      sourceIdentity: sourceIdentity([natural, String(occurrence)]),
      accountCode: row.accountCode,
      rawInvAndLn: row.rawInvAndLn,
      documentReference: row.documentReference,
      documentType: row.documentType,
      sourceLineNumber: row.sourceLineNumber,
      partNumber: row.partNumber,
      description: row.description,
      quantity: row.quantity,
      salesAmount: row.salesAmount,
      salesMeasure: row.salesMeasure,
      importBatchId: batchId,
      rawSource: row.raw,
      parseIssue: row.parseIssue,
    });
    if (row.parseIssue) {
      issues.push(
        issueInput(batchId, {
          sourceRowNumber: row.rowNumber,
          sourceRecordId: `${row.accountCode}:${row.rawInvAndLn}`,
          issueType: "MALFORMED_REFERENCE",
          severity: "WARNING",
          explanation: row.parseIssue,
        }),
      );
    }
  }
  const retained = await retainExistingInvoiceLines(prepared);
  const written = await writeFinancialRows("invoice", batchId, retained.rows, issues, rejected);
  return { ...written, updated: written.updated + retained.attached };
}

async function upsertLedgerRows(
  batchId: string,
  headers: string[],
  map: Partial<Record<CanonicalColumn, number>>,
  records: CsvScanRecord[],
) {
  const occurrences = new Map<string, number>();
  const prepared: Prisma.AutopartLedgerTransactionCreateManyInput[] = [];
  const issues: Prisma.AutopartImportIssueCreateManyInput[] = [];
  let rejected = 0;
  for (const record of records) {
    const interpreted = interpretLedgerRecord(record, headers, map);
    if ("reject" in interpreted) {
      rejected += 1;
      issues.push(
        issueInput(batchId, {
          sourceRowNumber: interpreted.reject.rowNumber,
          sourceRecordId: interpreted.reject.sourceRecordId,
          issueType: interpreted.reject.issueType,
          severity: "ERROR",
          explanation: interpreted.reject.explanation,
          raw: interpreted.reject.raw,
        }),
      );
      continue;
    }
    const row = interpreted.row;
    const natural = [
      row.accountCode,
      row.rawType,
      row.reference,
      row.transactionDate ?? "",
      row.goodsAmount ?? "",
      row.vatAmount ?? "",
      row.totalAmount ?? "",
      row.runningBalance ?? "",
    ].join("\u001e");
    const occurrence = (occurrences.get(natural) ?? 0) + 1;
    occurrences.set(natural, occurrence);
    prepared.push({
      sourceIdentity: sourceIdentity([natural, String(occurrence)]),
      accountCode: row.accountCode,
      rawType: row.rawType,
      ledgerKind: row.ledgerKind,
      reference: row.reference,
      transactionDate: row.transactionDate
        ? new Date(`${row.transactionDate}T00:00:00.000Z`)
        : null,
      goodsAmount: row.goodsAmount,
      vatAmount: row.vatAmount,
      totalAmount: row.totalAmount,
      runningBalance: row.runningBalance,
      originalName: row.originalName,
      sacct: row.sacct,
      importBatchId: batchId,
      rawSource: row.raw,
      parseIssue: row.parseIssue,
    });
    if (row.parseIssue) {
      issues.push(
        issueInput(batchId, {
          sourceRowNumber: row.rowNumber,
          sourceRecordId: `${row.accountCode}:${row.reference}`,
          issueType: row.ledgerKind === "UNKNOWN" ? "UNKNOWN_TRANSACTION_TYPE" : "INVALID_DATE",
          severity: "WARNING",
          explanation: row.parseIssue,
        }),
      );
    }
  }
  const retained = await retainExistingLedgerTransactions(prepared);
  const written = await writeFinancialRows("ledger", batchId, retained.rows, issues, rejected);
  return { ...written, updated: written.updated + retained.attached };
}

/**
 * Source identity still includes quantity and amount so rows already stored keep
 * matching. A later file with the same account and Inv & Ln but a different amount
 * would otherwise insert a second line. Attach that row to the stored line and
 * leave quantity, sales amount, part, account, and document fields unchanged.
 */
async function retainExistingInvoiceLines(rows: Prisma.AutopartInvoiceLineCreateManyInput[]) {
  if (rows.length === 0) return { rows, attached: 0 };
  const existing = await prisma.autopartInvoiceLine.findMany({
    where: {
      accountCode: { in: [...new Set(rows.map((row) => row.accountCode))] },
      rawInvAndLn: { in: [...new Set(rows.map((row) => row.rawInvAndLn))] },
    },
    select: { id: true, accountCode: true, rawInvAndLn: true, sourceIdentity: true },
  });
  const byKey = new Map<string, { id: string; sourceIdentity: string }>();
  for (const row of existing) {
    const key = `${row.accountCode}\u001e${row.rawInvAndLn}`;
    if (!byKey.has(key)) byKey.set(key, row);
  }
  const kept: Prisma.AutopartInvoiceLineCreateManyInput[] = [];
  const seenIdentity = new Set<string>();
  const seenKey = new Set<string>();
  let attached = 0;
  for (const row of rows) {
    const key = `${row.accountCode}\u001e${row.rawInvAndLn}`;
    const stored = byKey.get(key);
    if (seenIdentity.has(row.sourceIdentity)) {
      attached += 1;
      continue;
    }
    if (stored && stored.sourceIdentity !== row.sourceIdentity) {
      await prisma.autopartInvoiceLine.update({
        where: { id: stored.id },
        data: {
          description: row.description ?? null,
          parseIssue: row.parseIssue ?? null,
          importBatchId: row.importBatchId,
        },
      });
      attached += 1;
      continue;
    }
    if (seenKey.has(key)) {
      attached += 1;
      continue;
    }
    seenIdentity.add(row.sourceIdentity);
    seenKey.add(key);
    kept.push(row);
  }
  return { rows: kept, attached };
}

function ledgerDay(value: Date | string | null | undefined): string {
  if (value == null || value === "") return "";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString().slice(0, 10);
}

function ledgerCommercialKey(row: {
  accountCode: string;
  rawType: string;
  reference: string;
  transactionDate?: Date | string | null;
}): string {
  return [row.accountCode, row.rawType, row.reference, ledgerDay(row.transactionDate)].join("\u001e");
}

/**
 * Ledger identity includes the amounts, so a changed goods or balance figure would
 * insert a second transaction. The same account, type, reference, and date stay one
 * stored row. Amounts, reference, and date are not rewritten.
 */
async function retainExistingLedgerTransactions(
  rows: Prisma.AutopartLedgerTransactionCreateManyInput[],
) {
  if (rows.length === 0) return { rows, attached: 0 };
  const existing = await prisma.autopartLedgerTransaction.findMany({
    where: {
      accountCode: { in: [...new Set(rows.map((row) => row.accountCode))] },
      reference: { in: [...new Set(rows.map((row) => row.reference))] },
    },
    select: {
      id: true,
      accountCode: true,
      rawType: true,
      reference: true,
      transactionDate: true,
      sourceIdentity: true,
    },
  });
  const byKey = new Map<string, { id: string; sourceIdentity: string }>();
  for (const row of existing) {
    const key = ledgerCommercialKey(row);
    if (!byKey.has(key)) byKey.set(key, row);
  }
  const kept: Prisma.AutopartLedgerTransactionCreateManyInput[] = [];
  const seenIdentity = new Set<string>();
  const seenKey = new Set<string>();
  let attached = 0;
  for (const row of rows) {
    const key = ledgerCommercialKey({
      accountCode: row.accountCode,
      rawType: row.rawType,
      reference: row.reference,
      transactionDate: row.transactionDate ?? null,
    });
    const stored = byKey.get(key);
    if (seenIdentity.has(row.sourceIdentity)) {
      attached += 1;
      continue;
    }
    if (stored && stored.sourceIdentity !== row.sourceIdentity) {
      await prisma.autopartLedgerTransaction.update({
        where: { id: stored.id },
        data: {
          parseIssue: row.parseIssue ?? null,
          importBatchId: row.importBatchId,
        },
      });
      attached += 1;
      continue;
    }
    if (seenKey.has(key)) {
      attached += 1;
      continue;
    }
    seenIdentity.add(row.sourceIdentity);
    seenKey.add(key);
    kept.push(row);
  }
  return { rows: kept, attached };
}

async function writeFinancialRows(
  kind: "invoice" | "ledger",
  _batchId: string,
  rows: Array<{ sourceIdentity: string; accountCode: string }>,
  issues: Prisma.AutopartImportIssueCreateManyInput[],
  rejected: number,
) {
  if (rows.length === 0) {
    return {
      imported: 0,
      updated: 0,
      rejected,
      issues,
      accounts: [] as string[],
      unmatched: [] as string[],
    };
  }
  const codes = [...new Set(rows.map((row) => row.accountCode))];
  const accounts = await accountIdMap(codes);
  const unmatched = codes.filter((code) => !accounts.has(code));
  const identities = rows.map((row) => row.sourceIdentity);
  const existing =
    kind === "invoice"
      ? await prisma.autopartInvoiceLine.findMany({
          where: { sourceIdentity: { in: identities } },
          select: { sourceIdentity: true },
        })
      : await prisma.autopartLedgerTransaction.findMany({
          where: { sourceIdentity: { in: identities } },
          select: { sourceIdentity: true },
        });
  const existingSet = new Set(existing.map((row) => row.sourceIdentity));
  if (kind === "invoice") {
    await insertInvoiceSql(rows as Prisma.AutopartInvoiceLineCreateManyInput[], accounts);
  } else {
    await insertLedgerSql(rows as Prisma.AutopartLedgerTransactionCreateManyInput[], accounts);
  }
  const updated = rows.filter((row) => existingSet.has(row.sourceIdentity)).length;
  return {
    imported: rows.length - updated,
    updated,
    rejected,
    issues,
    accounts: codes,
    unmatched,
  };
}

async function insertInvoiceSql(
  rows: Prisma.AutopartInvoiceLineCreateManyInput[],
  accounts: Map<string, string>,
) {
  const values = Prisma.join(
    rows.map(
      (row) => Prisma.sql`(
        ${randomUUID()}, ${row.sourceIdentity}, ${row.accountCode}, ${accounts.get(String(row.accountCode)) ?? null},
        ${row.rawInvAndLn}, ${row.documentReference ?? null}, ${row.documentType ?? null}, ${row.sourceLineNumber ?? null},
        ${row.partNumber}, ${row.description ?? null}, ${String(row.quantity)}::decimal, ${String(row.salesAmount)}::decimal,
        ${row.salesMeasure ?? "NET_EX_VAT"}, ${row.importBatchId}, ${JSON.stringify(row.rawSource ?? {})}::jsonb,
        ${row.parseIssue ?? null}, NOW(), NOW()
      )`,
    ),
  );
  await prisma.$executeRaw`
    INSERT INTO "AutopartInvoiceLine" (
      "id", "sourceIdentity", "accountCode", "accountId", "rawInvAndLn", "documentReference", "documentType",
      "sourceLineNumber", "partNumber", "description", "quantity", "salesAmount", "salesMeasure",
      "importBatchId", "rawSource", "parseIssue", "createdAt", "updatedAt"
    ) VALUES ${values}
    ON CONFLICT ("sourceIdentity") DO UPDATE SET
      "accountId" = COALESCE(EXCLUDED."accountId", "AutopartInvoiceLine"."accountId"),
      "description" = EXCLUDED."description",
      "parseIssue" = EXCLUDED."parseIssue",
      "importBatchId" = EXCLUDED."importBatchId",
      "updatedAt" = NOW()
  `;
}

async function insertLedgerSql(
  rows: Prisma.AutopartLedgerTransactionCreateManyInput[],
  accounts: Map<string, string>,
) {
  const values = Prisma.join(
    rows.map(
      (row) => Prisma.sql`(
        ${randomUUID()}, ${row.sourceIdentity}, ${row.accountCode}, ${accounts.get(String(row.accountCode)) ?? null},
        ${row.rawType}, ${row.ledgerKind}::"AutopartLedgerKind", ${row.reference},
        ${row.transactionDate ?? null}::date, ${row.goodsAmount == null ? null : String(row.goodsAmount)}::decimal,
        ${row.vatAmount == null ? null : String(row.vatAmount)}::decimal,
        ${row.totalAmount == null ? null : String(row.totalAmount)}::decimal,
        ${row.runningBalance == null ? null : String(row.runningBalance)}::decimal,
        ${row.originalName ?? null}, ${row.sacct ?? null}, ${row.importBatchId},
        ${JSON.stringify(row.rawSource ?? {})}::jsonb, ${row.parseIssue ?? null}, NOW(), NOW()
      )`,
    ),
  );
  await prisma.$executeRaw`
    INSERT INTO "AutopartLedgerTransaction" (
      "id", "sourceIdentity", "accountCode", "accountId", "rawType", "ledgerKind", "reference",
      "transactionDate", "goodsAmount", "vatAmount", "totalAmount", "runningBalance",
      "originalName", "sacct", "importBatchId", "rawSource", "parseIssue", "createdAt", "updatedAt"
    ) VALUES ${values}
    ON CONFLICT ("sourceIdentity") DO UPDATE SET
      "accountId" = COALESCE(EXCLUDED."accountId", "AutopartLedgerTransaction"."accountId"),
      "parseIssue" = EXCLUDED."parseIssue",
      "importBatchId" = EXCLUDED."importBatchId",
      "updatedAt" = NOW()
  `;
}

async function relinkHistoricalRows() {
  await prisma.$executeRaw`
    UPDATE "AutopartInvoiceLine" AS line
    SET "accountId" = account.id
    FROM "AutopartAccount" AS account
    WHERE line."accountId" IS NULL
      AND line."accountCode" = account."accountCode"
      AND account."sourceSystem" = ${AUTOPART_SOURCE_SYSTEM}
  `;
  await prisma.$executeRaw`
    UPDATE "AutopartLedgerTransaction" AS entry
    SET "accountId" = account.id
    FROM "AutopartAccount" AS account
    WHERE entry."accountId" IS NULL
      AND entry."accountCode" = account."accountCode"
      AND account."sourceSystem" = ${AUTOPART_SOURCE_SYSTEM}
  `;
}

function decimal2(value: Prisma.Decimal | null | undefined): string | null {
  if (value == null) return null;
  return value.toFixed(2);
}

async function reconcileAccounts(accountCodes: string[], batchId: string) {
  for (let index = 0; index < accountCodes.length; index += 100) {
    const chunk = accountCodes.slice(index, index + 100);
    const lines = await prisma.autopartInvoiceLine.groupBy({
      by: ["accountCode", "documentType", "documentReference"],
      where: {
        accountCode: { in: chunk },
        documentType: { in: ["INVOICE", "CREDIT"] },
        documentReference: { not: null },
      },
      _count: { _all: true },
      _sum: { salesAmount: true },
    });
    const issueLines = await prisma.autopartInvoiceLine.groupBy({
      by: ["accountCode", "documentType", "documentReference"],
      where: {
        accountCode: { in: chunk },
        documentType: { in: ["INVOICE", "CREDIT"] },
        documentReference: { not: null },
        parseIssue: { not: null },
      },
      _count: { _all: true },
    });
    const ledgers = await prisma.autopartLedgerTransaction.groupBy({
      by: ["accountCode", "ledgerKind", "reference"],
      where: { accountCode: { in: chunk }, ledgerKind: { in: ["INVOICE", "CREDIT"] } },
      _count: { _all: true },
      _sum: { goodsAmount: true },
    });
    const accounts = await accountIdMap(chunk);
    const lineMap = new Map<string, { count: number; sales: string | null; issues: number }>();
    for (const line of lines) {
      if (!line.documentReference || !line.documentType) continue;
      const key = `${line.accountCode}\u001e${line.documentType}\u001e${line.documentReference.toUpperCase()}`;
      lineMap.set(key, {
        count: line._count._all,
        sales: decimal2(line._sum.salesAmount),
        issues: 0,
      });
    }
    for (const line of issueLines) {
      if (!line.documentReference || !line.documentType) continue;
      const key = `${line.accountCode}\u001e${line.documentType}\u001e${line.documentReference.toUpperCase()}`;
      const current = lineMap.get(key);
      if (current) current.issues = line._count._all;
    }
    const ledgerMap = new Map<string, { count: number; goods: string | null }>();
    for (const entry of ledgers) {
      const key = `${entry.accountCode}\u001e${entry.ledgerKind}\u001e${entry.reference.toUpperCase()}`;
      const current = ledgerMap.get(key);
      const goods = decimal2(entry._sum.goodsAmount);
      if (!current) {
        ledgerMap.set(key, { count: entry._count._all, goods });
      } else {
        current.count += entry._count._all;
        current.goods = goods;
      }
    }
    const keys = new Set([...lineMap.keys(), ...ledgerMap.keys()]);
    for (const key of keys) {
      const [accountCode, documentType, documentReference] = key.split("\u001e");
      if (!accountCode || !documentType || !documentReference) continue;
      const line = lineMap.get(key);
      const ledger = ledgerMap.get(key);
      const status = reconciliationStatus({
        lineCount: line?.count ?? 0,
        lineSales: line?.sales ?? null,
        parsedLineIssues: line?.issues ?? 0,
        ledgerCount: ledger?.count ?? 0,
        ledgerGoods: ledger?.goods ?? null,
      });
      await prisma.autopartDocumentMatch.upsert({
        where: {
          accountCode_documentType_documentReference: {
            accountCode,
            documentType,
            documentReference,
          },
        },
        create: {
          accountCode,
          accountId: accounts.get(accountCode) ?? null,
          documentType,
          documentReference,
          status,
          lineCount: line?.count ?? 0,
          lineSalesSum: line?.sales ?? null,
          ledgerGoods: ledger?.goods ?? null,
          ledgerCount: ledger?.count ?? 0,
          importBatchId: batchId,
          note: "Autopart historical reconciliation. Line sales are net ex VAT and are not the invoice total. Running balances are not current debt.",
        },
        update: {
          accountId: accounts.get(accountCode) ?? null,
          status,
          lineCount: line?.count ?? 0,
          lineSalesSum: line?.sales ?? null,
          ledgerGoods: ledger?.goods ?? null,
          ledgerCount: ledger?.count ?? 0,
          importBatchId: batchId,
        },
      });
    }
  }
}

async function recoverStale(batchId: string, status: string, heartbeatAt: Date | null) {
  if (status !== "RUNNING" || runningBatches.has(batchId)) return;
  if (heartbeatAt && Date.now() - heartbeatAt.getTime() < STALE_MS) return;
  await prisma.autopartImportBatch.update({
    where: { id: batchId },
    data: {
      status: "FAILED",
      errorSummary: "Import stopped before completion and can be retried.",
    },
  });
}

export async function cancelAutopartImport(actorUserId: string, batchId: string) {
  await requireSystemPermission(actorUserId, "autopart.import.manage");
  const batch = await ownBatch(actorUserId, batchId);
  if (batch.status === "COMMITTED")
    throw new AuthError("A committed import is not cancelled", "VALIDATION", 400);
  if (batch.status === "RUNNING") {
    await prisma.autopartImportBatch.update({
      where: { id: batch.id },
      data: { cancelRequested: true },
    });
    return { cancelled: false, requested: true };
  }
  if (batch.storagePath) await rm(batch.storagePath, { force: true }).catch(() => undefined);
  await prisma.autopartImportBatch.update({
    where: { id: batch.id },
    data: { status: "CANCELLED", storagePath: null, completedAt: new Date() },
  });
  return { cancelled: true, requested: false };
}

export async function getAutopartImportBatch(actorUserId: string, batchId: string) {
  const batch = await ownBatch(actorUserId, batchId);
  await recoverStale(batch.id, batch.status, batch.heartbeatAt);
  const fresh = await prisma.autopartImportBatch.findUniqueOrThrow({ where: { id: batch.id } });
  return publicBatch(fresh);
}

export async function listAutopartImportBatches(actorUserId: string, page = 1) {
  await requireSystemPermission(actorUserId, "autopart.import.view");
  const pageSize = 25;
  const where = {};
  const [total, items] = await Promise.all([
    prisma.autopartImportBatch.count({ where }),
    prisma.autopartImportBatch.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        kind: true,
        status: true,
        filename: true,
        fileHash: true,
        dryRun: true,
        totalRows: true,
        validRows: true,
        importedRows: true,
        updatedRows: true,
        duplicateRows: true,
        rejectedRows: true,
        unmatchedAccounts: true,
        reconciliationStatus: true,
        errorSummary: true,
        createdAt: true,
        completedAt: true,
      },
    }),
  ]);
  return { total, page, pageSize, items };
}

export async function listAutopartImportIssues(actorUserId: string, batchId: string, page = 1) {
  await requireSystemPermission(actorUserId, "autopart.import.view");
  const pageSize = 50;
  const where = { batchId };
  const [total, items] = await Promise.all([
    prisma.autopartImportIssue.count({ where }),
    prisma.autopartImportIssue.findMany({
      where,
      orderBy: { sourceRowNumber: "asc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);
  return { total, page, pageSize, items };
}

export async function listAutopartAccounts(
  actorUserId: string,
  input: {
    q?: string;
    classification?: AutopartAccountClassification | "ALL";
    link?: "all" | "linked" | "unlinked";
    page?: number;
  },
) {
  await requireSystemPermission(actorUserId, "autopart.customer.view");
  const page = input.page ?? 1;
  const pageSize = 50;
  const q = input.q?.trim() ?? "";
  const where: Prisma.AutopartAccountWhereInput = {
    ...(input.classification && input.classification !== "ALL"
      ? { classification: input.classification }
      : {}),
    ...(input.link === "linked" ? { companyId: { not: null } } : {}),
    ...(input.link === "unlinked" ? { companyId: null } : {}),
    ...(q
      ? {
          OR: [
            { accountCode: { contains: q, mode: "insensitive" } },
            { originalName: { contains: q, mode: "insensitive" } },
            { areaCode: { contains: q, mode: "insensitive" } },
            { repCode: { contains: q, mode: "insensitive" } },
          ],
        }
      : {}),
  };
  const [total, items] = await Promise.all([
    prisma.autopartAccount.count({ where }),
    prisma.autopartAccount.findMany({
      where,
      orderBy: { accountCode: "asc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        accountCode: true,
        originalName: true,
        nameTruncated: true,
        areaCode: true,
        repCode: true,
        classification: true,
        classificationSource: true,
        companyId: true,
        portalEligible: true,
        historicalAccessEnabled: true,
        company: { select: { id: true, name: true, status: true } },
      },
    }),
  ]);
  return { total, page, pageSize, items };
}

export async function listDuplicateAutopartNames(actorUserId: string, page = 1) {
  await requireSystemPermission(actorUserId, "autopart.customer.view");
  const pageSize = 25;
  const groupedAll = await prisma.autopartAccount.groupBy({
    by: ["originalName"],
    _count: { _all: true },
    orderBy: { originalName: "asc" },
  });
  const grouped = groupedAll.filter((row) => row._count._all > 1);
  const slice = grouped.slice((page - 1) * pageSize, page * pageSize);
  const names = slice.map((row) => row.originalName);
  const accounts = names.length
    ? await prisma.autopartAccount.findMany({
        where: { originalName: { in: names } },
        select: {
          id: true,
          accountCode: true,
          originalName: true,
          companyId: true,
          classification: true,
        },
        orderBy: { accountCode: "asc" },
      })
    : [];
  return {
    total: grouped.length,
    page,
    pageSize,
    items: slice.map((row) => ({
      originalName: row.originalName,
      count: row._count._all,
      accounts: accounts.filter((account) => account.originalName === row.originalName),
    })),
  };
}

export async function linkAutopartAccountToCompany(
  actorUserId: string,
  input: { accountId: string; companyId: string; setPrimary?: boolean },
) {
  await requireSystemPermission(actorUserId, "autopart.mapping.manage");
  const account = await prisma.autopartAccount.findUnique({ where: { id: input.accountId } });
  if (!account) throw new AuthError("Autopart account was not found", "NOT_FOUND", 404);
  const company = await prisma.company.findUnique({ where: { id: input.companyId } });
  if (!company) throw new AuthError("Company was not found", "NOT_FOUND", 404);
  if (
    input.setPrimary &&
    company.autopartCustomerCode &&
    company.autopartCustomerCode !== account.accountCode
  ) {
    throw new AuthError(
      "This company already has a different primary Autopart code",
      "VALIDATION",
      400,
    );
  }
  if (input.setPrimary) {
    const holder = await prisma.company.findFirst({
      where: { autopartCustomerCode: account.accountCode, id: { not: company.id } },
    });
    if (holder)
      throw new AuthError(
        "That Autopart code is already the primary code on another company",
        "CONFLICT",
        409,
      );
  }
  await prisma.autopartAccount.update({
    where: { id: account.id },
    data: { companyId: company.id },
  });
  if (input.setPrimary && !company.autopartCustomerCode) {
    await prisma.company.update({
      where: { id: company.id },
      data: { autopartCustomerCode: account.accountCode },
    });
  }
  await recordAuditEvent({
    action: "autopart_account_linked",
    entityType: "AutopartAccount",
    entityId: account.id,
    actorUserId,
    companyId: company.id,
    metadata: { accountCode: account.accountCode, setPrimary: Boolean(input.setPrimary) },
  });
  return {
    accountId: account.id,
    companyId: company.id,
    historicalAccessEnabled: account.historicalAccessEnabled,
  };
}

export async function createCompanyForAutopartAccount(actorUserId: string, accountId: string) {
  await requireSystemPermission(actorUserId, "autopart.mapping.manage");
  await requireSystemPermission(actorUserId, "companies.create");
  const account = await prisma.autopartAccount.findUnique({ where: { id: accountId } });
  if (!account) throw new AuthError("Autopart account was not found", "NOT_FOUND", 404);
  if (account.companyId)
    throw new AuthError("This Autopart account is already linked", "CONFLICT", 409);
  const holder = await prisma.company.findFirst({
    where: { autopartCustomerCode: account.accountCode },
  });
  if (holder)
    throw new AuthError(
      "A company already uses this Autopart code. Link that company instead.",
      "CONFLICT",
      409,
    );
  const company = await prisma.company.create({
    data: {
      name: account.originalName || account.accountCode,
      status: "PROSPECT",
      autopartCustomerCode: account.accountCode,
      notes: "Created from the Autopart customer master. No portal user was created.",
    },
  });
  await prisma.autopartAccount.update({
    where: { id: account.id },
    data: { companyId: company.id, portalEligible: false, historicalAccessEnabled: false },
  });
  await recordAuditEvent({
    action: "autopart_account_company_created",
    entityType: "Company",
    entityId: company.id,
    actorUserId,
    companyId: company.id,
    metadata: { accountCode: account.accountCode },
  });
  return { companyId: company.id, accountId: account.id };
}

export async function classifyAutopartAccountManually(
  actorUserId: string,
  input: { accountId: string; classification: AutopartAccountClassification; note?: string },
) {
  await requireSystemPermission(actorUserId, "autopart.mapping.manage");
  const account = await prisma.autopartAccount.update({
    where: { id: input.accountId },
    data: {
      classification: input.classification,
      classificationSource: "MANUAL",
      classificationNote: input.note?.slice(0, 300) || "Classified by an administrator",
      ...(input.classification !== "TRADE_CANDIDATE"
        ? { historicalAccessEnabled: false, historicalAccessRevokedAt: new Date() }
        : {}),
    },
  });
  await recordAuditEvent({
    action: "autopart_account_classified",
    entityType: "AutopartAccount",
    entityId: account.id,
    actorUserId,
    companyId: account.companyId,
    metadata: { accountCode: account.accountCode, classification: input.classification },
  });
  return {
    id: account.id,
    classification: account.classification,
    historicalAccessEnabled: account.historicalAccessEnabled,
  };
}

export async function setAutopartHistoricalAccess(
  actorUserId: string,
  input: { accountId: string; enabled: boolean },
) {
  await requireSystemPermission(actorUserId, "autopart.portal-access.manage");
  const account = await prisma.autopartAccount.findUnique({ where: { id: input.accountId } });
  if (!account) throw new AuthError("Autopart account was not found", "NOT_FOUND", 404);
  if (!input.enabled) {
    const revoked = await prisma.autopartAccount.update({
      where: { id: account.id },
      data: { historicalAccessEnabled: false, historicalAccessRevokedAt: new Date() },
    });
    await recordAuditEvent({
      action: "autopart_historical_access_revoked",
      entityType: "AutopartAccount",
      entityId: account.id,
      actorUserId,
      companyId: account.companyId,
      metadata: { accountCode: account.accountCode },
    });
    return { historicalAccessEnabled: revoked.historicalAccessEnabled };
  }
  if (!account.companyId)
    throw new AuthError("Link the Autopart account to a company first", "VALIDATION", 400);
  if (account.classification !== "TRADE_CANDIDATE") {
    throw new AuthError(
      "Historical access is only available for trade candidate accounts",
      "VALIDATION",
      400,
    );
  }
  const company = await prisma.company.findUniqueOrThrow({ where: { id: account.companyId } });
  if (company.status !== "ACTIVE") {
    throw new AuthError(
      "Customer portal history requires an active trade account. Internal CRM history does not use this switch.",
      "VALIDATION",
      400,
    );
  }
  const member = await prisma.companyUser.findFirst({
    where: { companyId: company.id, status: "ACTIVE" },
    select: { id: true },
  });
  if (!member) {
    throw new AuthError(
      "An authorised portal user must exist before historical access is enabled",
      "VALIDATION",
      400,
    );
  }
  const granted = await prisma.autopartAccount.update({
    where: { id: account.id },
    data: {
      historicalAccessEnabled: true,
      historicalAccessGrantedAt: new Date(),
      historicalAccessGrantedById: actorUserId,
      historicalAccessRevokedAt: null,
      portalEligible: false,
    },
  });
  await recordAuditEvent({
    action: "autopart_historical_access_granted",
    entityType: "AutopartAccount",
    entityId: account.id,
    actorUserId,
    companyId: company.id,
    metadata: { accountCode: account.accountCode },
  });
  return { historicalAccessEnabled: granted.historicalAccessEnabled };
}

export async function getCompanyAutopartMaster(actorUserId: string, companyId: string) {
  await requireCompanyAccess(actorUserId, companyId);
  await requireSystemPermission(actorUserId, "autopart.customer.view");
  const history = await loadCompanyGlobalAutopartHistory(actorUserId, companyId);
  const accounts = await prisma.autopartAccount.findMany({
    where: { companyId },
    orderBy: { accountCode: "asc" },
  });
  return {
    accounts: accounts.map((account) => ({
      id: account.id,
      accountCode: account.accountCode,
      originalName: account.originalName,
      nameTruncated: account.nameTruncated,
      areaCode: account.areaCode,
      repCode: account.repCode,
      classification: account.classification,
      portalEligible: account.portalEligible,
      historicalAccessEnabled: account.historicalAccessEnabled,
      historicalAccessGrantedAt: account.historicalAccessGrantedAt,
      mappingStatus: "LINKED" as const,
    })),
    lineCount: history.lineCount,
    ledgerCount: history.ledgerRowCount,
    source: history.source,
    mappingStatus: history.mappingStatus,
    latestBatch: history.latestBatch,
    portalHistoricalAccess: accounts.some((account) => account.historicalAccessEnabled),
    historicalLabel:
      "Autopart historical records from the global import. Not native B2B orders. Customer portal history is a separate approval.",
  };
}

export async function listAutopartInvoiceLines(
  actorUserId: string,
  input: { accountCode?: string; q?: string; page?: number },
) {
  await requireSystemPermission(actorUserId, "autopart.history.view");
  const page = input.page ?? 1;
  const pageSize = 50;
  const q = input.q?.trim() ?? "";
  const where: Prisma.AutopartInvoiceLineWhereInput = {
    ...(input.accountCode ? { accountCode: input.accountCode } : {}),
    ...(q
      ? {
          OR: [
            { partNumber: { contains: q, mode: "insensitive" } },
            { description: { contains: q, mode: "insensitive" } },
            { rawInvAndLn: { contains: q, mode: "insensitive" } },
            { accountCode: { contains: q, mode: "insensitive" } },
          ],
        }
      : {}),
  };
  const [total, items] = await Promise.all([
    prisma.autopartInvoiceLine.count({ where }),
    prisma.autopartInvoiceLine.findMany({
      where,
      orderBy: [{ accountCode: "asc" }, { rawInvAndLn: "asc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        accountCode: true,
        rawInvAndLn: true,
        documentReference: true,
        documentType: true,
        partNumber: true,
        description: true,
        quantity: true,
        salesAmount: true,
        salesMeasure: true,
        parseIssue: true,
      },
    }),
  ]);
  return {
    total,
    page,
    pageSize,
    salesMeasure: "NET_EX_VAT",
    items: items.map((item) => ({
      ...item,
      quantity: item.quantity.toFixed(3),
      salesAmount: item.salesAmount.toFixed(2),
    })),
  };
}

export async function listAutopartLedger(
  actorUserId: string,
  input: { accountCode?: string; page?: number },
) {
  await requireSystemPermission(actorUserId, "autopart.ledger.view");
  const page = input.page ?? 1;
  const pageSize = 50;
  const where = input.accountCode ? { accountCode: input.accountCode } : {};
  const [total, items] = await Promise.all([
    prisma.autopartLedgerTransaction.count({ where }),
    prisma.autopartLedgerTransaction.findMany({
      where,
      orderBy: [{ transactionDate: "desc" }, { reference: "asc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);
  return {
    total,
    page,
    pageSize,
    balanceNote:
      "Running balance is the historical Autopart source value, not the current amount due.",
    items: items.map((item) => ({
      id: item.id,
      accountCode: item.accountCode,
      rawType: item.rawType,
      ledgerKind: item.ledgerKind,
      reference: item.reference,
      transactionDate: item.transactionDate?.toISOString().slice(0, 10) ?? null,
      goodsAmount: item.goodsAmount?.toFixed(2) ?? null,
      vatAmount: item.vatAmount?.toFixed(2) ?? null,
      totalAmount: item.totalAmount?.toFixed(2) ?? null,
      runningBalance: item.runningBalance?.toFixed(2) ?? null,
      parseIssue: item.parseIssue,
    })),
  };
}

export async function listAutopartReconciliation(
  actorUserId: string,
  input: { accountCode?: string; status?: string; page?: number },
) {
  const profile = await requireSystemPermission(actorUserId, "autopart.history.view");
  const canLedger = profile.permissions.has("autopart.ledger.view");
  const page = input.page ?? 1;
  const pageSize = 50;
  const status = documentMatchStatus(input.status);
  const where: Prisma.AutopartDocumentMatchWhereInput = {
    ...(input.accountCode ? { accountCode: input.accountCode } : {}),
    ...(status ? { status } : {}),
  };
  const [total, grouped, items] = await Promise.all([
    prisma.autopartDocumentMatch.count({ where }),
    prisma.autopartDocumentMatch.groupBy({
      by: ["status"],
      where: input.accountCode ? { accountCode: input.accountCode } : {},
      _count: { _all: true },
    }),
    prisma.autopartDocumentMatch.findMany({
      where,
      orderBy: [{ accountCode: "asc" }, { documentReference: "asc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);
  return {
    total,
    page,
    pageSize,
    note: "Line sales are net ex VAT. Ledger goods are shown only with ledger permission. This is not a customer balance.",
    statuses: grouped.map((row) => ({ status: row.status, count: row._count._all })),
    items: items.map((item) => ({
      id: item.id,
      accountCode: item.accountCode,
      documentType: item.documentType,
      documentReference: item.documentReference,
      status: item.status,
      lineCount: item.lineCount,
      lineSalesSum: item.lineSalesSum?.toFixed(2) ?? null,
      ledgerGoods: canLedger ? (item.ledgerGoods?.toFixed(2) ?? null) : null,
      ledgerCount: canLedger ? item.ledgerCount : null,
    })),
  };
}

export async function writeAutopartReconciliationCsv(
  actorUserId: string,
  accountCode: string | undefined,
  write: (chunk: string) => void,
) {
  const profile = await requireSystemPermission(actorUserId, "autopart.history.view");
  const canLedger = profile.permissions.has("autopart.ledger.view");
  write(
    "accountCode,documentType,documentReference,status,lineCount,lineSalesNetExVat,ledgerGoods,ledgerCount\n",
  );
  let cursor: string | undefined;
  const where = accountCode ? { accountCode } : {};
  for (;;) {
    const items = await prisma.autopartDocumentMatch.findMany({
      where,
      orderBy: { id: "asc" },
      take: 200,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    if (items.length === 0) break;
    for (const item of items) {
      const cells = [
        item.accountCode,
        item.documentType,
        item.documentReference,
        item.status,
        String(item.lineCount),
        item.lineSalesSum?.toFixed(2) ?? "",
        canLedger ? (item.ledgerGoods?.toFixed(2) ?? "") : "",
        canLedger ? String(item.ledgerCount) : "",
      ];
      write(`${cells.map(csvCell).join(",")}\n`);
    }
    cursor = items[items.length - 1]?.id;
    if (items.length < 200) break;
  }
}

const DOCUMENT_MATCH_STATUSES = new Set<AutopartDocumentMatchStatus>([
  "MATCHED",
  "PARTIALLY_MATCHED",
  "LEDGER_ONLY",
  "PRODUCT_LINES_ONLY",
  "AMOUNT_DISCREPANCY",
  "AMBIGUOUS",
  "REQUIRES_REVIEW",
]);

function documentMatchStatus(value: string | undefined): AutopartDocumentMatchStatus | undefined {
  if (!value || !DOCUMENT_MATCH_STATUSES.has(value as AutopartDocumentMatchStatus))
    return undefined;
  return value as AutopartDocumentMatchStatus;
}

function csvCell(value: string): string {
  if (/[",\n]/.test(value)) return `"${value.replaceAll('"', '""')}"`;
  return value;
}

export async function listAutopartDocumentMatches(
  actorUserId: string,
  accountCode: string,
  page = 1,
) {
  await requireSystemPermission(actorUserId, "autopart.history.view");
  const pageSize = 50;
  const where = { accountCode };
  const [total, items] = await Promise.all([
    prisma.autopartDocumentMatch.count({ where }),
    prisma.autopartDocumentMatch.findMany({
      where,
      orderBy: { documentReference: "asc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);
  return {
    total,
    page,
    pageSize,
    items: items.map((item) => ({
      ...item,
      lineSalesSum: item.lineSalesSum?.toFixed(2) ?? null,
      ledgerGoods: item.ledgerGoods?.toFixed(2) ?? null,
    })),
  };
}

export async function getAutopartHistoricalSummary(actorUserId: string) {
  await requireSystemPermission(actorUserId, "autopart.history.view");
  const [accounts, lines, sales, committed] = await Promise.all([
    prisma.autopartAccount.count(),
    prisma.autopartInvoiceLine.count(),
    prisma.autopartInvoiceLine.aggregate({
      _sum: { salesAmount: true },
      where: { documentType: { in: ["INVOICE", "CREDIT"] } },
    }),
    prisma.autopartImportBatch.aggregate({
      where: { kind: "INVOICE_LINES", status: "COMMITTED", dryRun: false },
      _sum: { importedRows: true, updatedRows: true },
    }),
  ]);
  const importedInvoiceRows = committed._sum.importedRows ?? 0;
  const updatedInvoiceRows = committed._sum.updatedRows ?? 0;
  return {
    source: "AUTOPART_HISTORICAL",
    label:
      "Autopart historical line sales. This is not native B2B order turnover and not a customer balance.",
    accounts,
    invoiceLines: lines,
    importedInvoiceRows,
    updatedInvoiceRows,
    committedInvoiceRows: importedInvoiceRows + updatedInvoiceRows,
    countNote:
      "Product lines count stored AutopartInvoiceLine rows, one per source identity. Committed batch rows add new rows and rows that updated an existing identity. An update does not add a stored line and does not change the stored sales amount, quantity, account, or document. Source identity occurrence is counted inside each 200-row write, so the same natural key in a later chunk updates the earlier row. A later file that repeats the same account and invoice-line reference does not insert another product line and does not change the stored quantity or sales amount.",
    historicalLineSales: sales._sum.salesAmount?.toFixed(2) ?? "0.00",
    salesMeasure: "NET_EX_VAT",
  };
}

export async function getPortalAutopartHistory(actorUserId: string, page = 1) {
  const profile = await requireSystemPermission(actorUserId, "companies.view");
  if (profile.actorType !== "TRADE") {
    throw new AuthError("This history view is for a trade customer", "FORBIDDEN", 403);
  }
  if (!portalAutopartHistoryEnabled()) {
    return { enabled: false as const, items: [], total: 0, page, pageSize: 50 };
  }
  const companyIds = profile.companyMemberships
    .filter((membership) => membership.status === "ACTIVE")
    .map((membership) => membership.companyId);
  const accounts = await prisma.autopartAccount.findMany({
    where: {
      companyId: { in: companyIds },
      historicalAccessEnabled: true,
      classification: "TRADE_CANDIDATE",
    },
    select: { accountCode: true },
  });
  const codes = accounts.map((account) => account.accountCode);
  if (codes.length === 0)
    return { enabled: true as const, items: [], total: 0, page, pageSize: 50 };
  const pageSize = 50;
  const where = { accountCode: { in: codes } };
  const [total, items] = await Promise.all([
    prisma.autopartInvoiceLine.count({ where }),
    prisma.autopartInvoiceLine.findMany({
      where,
      orderBy: { rawInvAndLn: "asc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        accountCode: true,
        rawInvAndLn: true,
        partNumber: true,
        description: true,
        quantity: true,
        salesAmount: true,
        salesMeasure: true,
      },
    }),
  ]);
  return {
    enabled: true as const,
    total,
    page,
    pageSize,
    label: "Autopart historical purchases for your approved account.",
    items: items.map((item) => ({
      ...item,
      quantity: item.quantity.toFixed(3),
      salesAmount: item.salesAmount.toFixed(2),
    })),
  };
}

export async function storedFileSize(filePath: string): Promise<number> {
  const info = await stat(assertInsideRoot(filePath));
  return info.size;
}
