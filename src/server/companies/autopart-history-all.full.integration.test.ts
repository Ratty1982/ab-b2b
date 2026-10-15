/**
 * Full 561L-ALL and SLRB-ALL validation on the dedicated test database.
 * The original exports stay outside the repository.
 */
import "@/server/testing/use-protect-integration-database";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { bootstrapRbac } from "../../../prisma/bootstrap/rbac";
import { fingerprintAutopartFile } from "@/domain/autopart-csv-stream";
import { HISTORIC_SNAPSHOT_RETIRE_PHRASE, retireAbsentHistoricDocuments, runAllHistoricImport } from "@/server/companies/autopart-history-all";

const linesPath = "/tmp/autopart-all/561L-ALL(1).CSV";
const ledgerPath = "/tmp/autopart-all/SLRB-ALL(1).CSV";
const originalsPresent = existsSync(linesPath) && existsSync(ledgerPath);
const prisma = new PrismaClient();
const stamp = Date.now();
const staleRef = `STALE${String(stamp).slice(-8)}`;
const ongoingRef = `KEEP${String(stamp).slice(-8)}`;
const createdCompanyIds: string[] = [];
const createdUserIds: string[] = [];

let adminId = "";
let retailaId = "";

beforeAll(async () => {
  await bootstrapRbac(prisma);
  const user = await prisma.user.create({
    data: {
      email: `hist-full.${stamp}@example.invalid`,
      name: "Historic full",
      status: "ACTIVE",
      actorType: "INTERNAL",
      emailVerified: true,
    },
  });
  createdUserIds.push(user.id);
  adminId = user.id;
  const role = await prisma.role.findUniqueOrThrow({ where: { key: "SUPER_ADMIN" } });
  await prisma.userRole.create({ data: { userId: user.id, roleId: role.id } });
  const company = await prisma.company.create({
    data: {
      name: `Retail Amazon ${stamp}`,
      status: "ACTIVE",
      paymentTerms: "30 Days",
      autopartCustomerCode: "RETAILA",
      autopartCustomerCodeVerifiedAt: new Date(),
      autopartCustomerCodeVerifiedById: adminId,
    },
  });
  retailaId = company.id;
  createdCompanyIds.push(retailaId);
  await prisma.autopartAccount.createMany({
    data: [
      { accountCode: "RETAILA", originalName: "Retail Amazon", classification: "TRADE_CANDIDATE", companyId: retailaId },
      { accountCode: "RETAILAMAZON", originalName: "Retail longer", classification: "TRADE_CANDIDATE" },
    ],
  });
  await prisma.autopartImportBatch.create({
    data: { kind: "CUSTOMER_MASTER", status: "COMMITTED", filename: "407EXP.txt", fileHash: `master-full-${stamp}` },
  });
  await prisma.autopartSalesDocument.create({
    data: {
      companyId: retailaId,
      autopartCustomerCode: "RETAILA",
      documentType: "INVOICE",
      documentReference: staleRef,
      source: "561L",
      goodsNet: "4.00",
    },
  });
  await prisma.autopartSalesLine.create({
    data: {
      companyId: retailaId,
      autopartCustomerCode: "RETAILA",
      documentType: "INVOICE",
      documentReference: staleRef,
      lineNumber: 1,
      sku: "STALE-SKU",
      units: "1",
      salesNet: "4.00",
      source: "561L",
    },
  });
  const ongoing = await prisma.autopartSalesDocument.create({
    data: {
      companyId: retailaId,
      autopartCustomerCode: "RETAILA",
      documentType: "INVOICE",
      documentReference: ongoingRef,
      source: "ONGOING_504",
      has504: true,
      goodsNet: "11.00",
    },
  });
  await prisma.autopartSalesLine.create({
    data: {
      companyId: retailaId,
      documentId: ongoing.id,
      autopartCustomerCode: "RETAILA",
      documentType: "INVOICE",
      documentReference: ongoingRef,
      lineNumber: 1,
      sku: "LIVE-SKU",
      units: "2",
      salesNet: "11.00",
      source: "ONGOING_TRM21QC",
    },
  });
});

afterAll(async () => {
  try {
    await prisma.autopartHistoryAllImport.deleteMany({ where: { createdById: { in: createdUserIds } } });
    await prisma.autopartSalesLine.deleteMany({ where: { companyId: { in: createdCompanyIds } } });
    await prisma.autopartSalesDocument.deleteMany({ where: { companyId: { in: createdCompanyIds } } });
    await prisma.autopartCustomerImportRun.deleteMany({ where: { companyId: { in: createdCompanyIds } } });
    await prisma.autopartAccount.deleteMany({ where: { accountCode: { in: ["RETAILA", "RETAILAMAZON"] } } });
    await prisma.autopartImportBatch.deleteMany({ where: { fileHash: `master-full-${stamp}` } });
    await prisma.company.deleteMany({ where: { id: { in: createdCompanyIds } } });
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  } finally {
    await prisma.$disconnect();
  }
});

async function createImport() {
  const [lines, ledger] = await Promise.all([
    fingerprintAutopartFile(linesPath),
    fingerprintAutopartFile(ledgerPath),
  ]);
  return prisma.autopartHistoryAllImport.create({
    data: {
      status: "PROCESSING",
      filename561l: "561L-ALL(1).CSV",
      filenameSlrb: "SLRB-ALL(1).CSV",
      fileHash561l: lines.sha256,
      fileHashSlrb: ledger.sha256,
      storagePath561l: linesPath,
      storagePathSlrb: ledgerPath,
      encoding561l: lines.encoding,
      encodingSlrb: ledger.encoding,
      createdById: adminId,
    },
  });
}

describe.skipIf(!originalsPresent)("original ALL files on the isolated database", () => {
  it("imports without dropping SS272042, survives an interrupt, and does not duplicate on replay", async () => {
    const beforeMaster = await prisma.autopartAccount.count();
    const beforeMasterBatches = await prisma.autopartImportBatch.count({ where: { kind: "CUSTOMER_MASTER" } });
    const interrupted = await createImport();
    const stopped = await runAllHistoricImport(interrupted.id, adminId, { stopAfterLines: 5_000 });
    expect(stopped.status).toBe("FAILED");
    expect(await prisma.autopartHistoryAllImport.findUnique({ where: { id: interrupted.id } })).toMatchObject({
      status: "FAILED",
    });

    const started = Date.now();
    const completed = await runAllHistoricImport(interrupted.id, adminId);
    const elapsedMs = Date.now() - started;
    expect(completed.status).toBe("COMMITTED");
    const saved = await prisma.autopartHistoryAllImport.findUniqueOrThrow({ where: { id: interrupted.id } });
    expect(saved.parsed561l).toBe(492_560);
    expect(saved.malformed561l).toBe(0);
    expect(saved.parsedSlrb).toBe(337_750);
    expect(saved.malformedSlrb).toBe(0);
    expect(saved.excludedLedger).toBe(99_596 + 171);
    expect(saved.importedLineCount + saved.stagedLineCount).toBe(492_560);
    expect(saved.fileHash561l).toBe("9c74cfd8aa4b2910c66e963175a6869ff077d62fd83d06263ac39981b324b3ea");
    expect(saved.encoding561l).toBe("windows-1252");

    const ssLines = await prisma.autopartSalesLine.findMany({
      where: { companyId: retailaId, documentReference: "SS272042", source: "561L" },
    });
    expect(ssLines).toHaveLength(99);
    const ssNet = ssLines.reduce((sum, line) => sum + Number(line.salesNet), 0);
    expect(ssNet.toFixed(2)).toBe("27825.77");
    const ssDoc = await prisma.autopartSalesDocument.findFirstOrThrow({
      where: { companyId: retailaId, documentReference: "SS272042", documentType: "INVOICE" },
    });
    expect(Number(ssDoc.goodsNet).toFixed(2)).toBe("27825.68");
    expect(ssDoc.valueMismatchMinor).toBe(9);
    const labels = new Set(ssLines.map((line) => line.rawInvAndLn));
    expect(labels.size).toBeLessThan(ssLines.length);

    const retailLines = await prisma.autopartSalesLine.count({
      where: { autopartCustomerCode: "RETAIL", source: "561L" },
    });
    expect(retailLines).toBe(0);
    const retailReview = await prisma.autopartHistoryReviewAccount.findFirst({
      where: { importId: interrupted.id, accountCode: "RETAIL" },
    });
    expect(retailReview?.reason).toBe("AMBIGUOUS");

    const stale = await prisma.autopartSalesDocument.findFirst({
      where: { companyId: retailaId, documentReference: staleRef },
    });
    expect(stale).toBeTruthy();
    const gap = await prisma.autopartHistorySnapshotGap.findFirst({
      where: { importId: interrupted.id, documentReference: staleRef, status: "OPEN" },
    });
    expect(gap).toBeTruthy();
    const ongoing = await prisma.autopartSalesDocument.findFirstOrThrow({
      where: { companyId: retailaId, documentReference: ongoingRef },
      include: { lines: true },
    });
    expect(Number(ongoing.goodsNet)).toBe(11);
    expect(ongoing.lines[0]?.sku).toBe("LIVE-SKU");
    expect(ongoing.lines[0]?.source).toBe("ONGOING_TRM21QC");
    expect(
      await prisma.autopartHistorySnapshotGap.count({
        where: { importId: interrupted.id, documentReference: ongoingRef },
      }),
    ).toBe(0);

    const beforeReplay = await prisma.autopartSalesLine.count({
      where: { companyId: retailaId, source: "561L" },
    });
    const replay = await createImport();
    const second = await runAllHistoricImport(replay.id, adminId);
    expect(second.status).toBe("COMMITTED");
    const afterReplay = await prisma.autopartSalesLine.count({
      where: { companyId: retailaId, source: "561L" },
    });
    expect(afterReplay).toBe(beforeReplay);
    expect(await prisma.autopartAccount.count()).toBe(beforeMaster);
    expect(await prisma.autopartImportBatch.count({ where: { kind: "CUSTOMER_MASTER" } })).toBe(beforeMasterBatches);
    expect(await prisma.autopartInvoiceLine.count({ where: { documentReference: "SS272042" } })).toBe(0);

    const retired = await retireAbsentHistoricDocuments(adminId, {
      importId: interrupted.id,
      confirmation: HISTORIC_SNAPSHOT_RETIRE_PHRASE,
    });
    expect(retired.retired).toBeGreaterThan(0);
    expect(await prisma.autopartSalesDocument.count({ where: { companyId: retailaId, documentReference: staleRef } })).toBe(0);
    expect(await prisma.autopartSalesDocument.count({ where: { companyId: retailaId, documentReference: ongoingRef } })).toBe(1);
    expect(Number((await prisma.autopartSalesDocument.findFirstOrThrow({ where: { documentReference: "SS272042", companyId: retailaId } })).goodsNet).toFixed(2)).toBe("27825.68");

    const replayRow = await prisma.autopartHistoryAllImport.findUniqueOrThrow({ where: { id: replay.id } });
    const peak = Math.max(saved.peakRssBytes ?? 0, replayRow.peakRssBytes ?? 0);
    const metrics = {
      elapsedMs,
      replayElapsedMs: replayRow.elapsedMs,
      peakRssBytes: peak,
      firstPeakRssBytes: saved.peakRssBytes,
      replayPeakRssBytes: replayRow.peakRssBytes,
      parsed561l: saved.parsed561l,
      parsedSlrb: saved.parsedSlrb,
      malformed561l: saved.malformed561l,
      malformedSlrb: saved.malformedSlrb,
      importedLineCount: saved.importedLineCount,
      stagedLineCount: saved.stagedLineCount,
      discrepancyCount: saved.discrepancyCount,
      excludedLedger: saved.excludedLedger,
      accountsCommitted: saved.accountsCommitted,
      accountsReviewed: saved.accountsReviewed,
      documentsWritten: saved.documentsWritten,
      testWallClockMs: Date.now() - started,
    };
    writeFileSync("/tmp/historic-full-metrics.json", JSON.stringify(metrics, null, 2));
    try {
      mkdirSync("/opt/cursor/artifacts", { recursive: true });
      writeFileSync("/opt/cursor/artifacts/historic-full-metrics.json", JSON.stringify(metrics, null, 2));
    } catch {
      // The private exports are not part of CI. Metrics stay in /tmp when that directory is absent.
    }
    console.log(JSON.stringify(metrics));
  }, 1_200_000);
});
