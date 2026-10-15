/**
 * Readiness, preview, review verification, import lock, and mismatch clearing.
 * Requires TEST_DATABASE_URL. Refuses the application database.
 */
import "@/server/testing/use-protect-integration-database";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { bootstrapRbac } from "../../../prisma/bootstrap/rbac";
import { AuthError } from "@/server/rbac/guards";
import {
  buildHistoricMatchingReadiness,
  claimHistoricImport,
  HISTORIC_VERIFY_PHRASE,
  listHistoricReviews,
  previewStoredHistoricImport,
  recoverAbandonedHistoricImports,
  runAllHistoricImport,
  verifyHistoricReviewAccount,
} from "@/server/companies/autopart-history-all";

const prisma = new PrismaClient();
const stamp = Date.now();
const verified = `V${String(stamp).slice(-6)}`;
const unlinked = `U${String(stamp).slice(-6)}`;
const prefix = `P${String(stamp).slice(-6)}`;
const longer = `${prefix}X`;
const mismatchRef = `MM${String(stamp).slice(-5)}`;
const ongoingRef = `ON${String(stamp).slice(-5)}`;
const createdCompanyIds: string[] = [];
const createdUserIds: string[] = [];
let adminId = "";
let verifiedCompanyId = "";
let targetCompanyId = "";
let directory = "";

function lines(goods: string) {
  return {
    file561: `Acct.,Inv & Ln,Part Number,Description,Units,Sales
${verified},I/${mismatchRef}/1,SKU-A,Widget,1,10.00
${verified},I/${ongoingRef}/1,SKU-B,Live,1,11.00
${unlinked},I/WAIT1/1,SKU-C,Wait,1,3.00
${prefix},I/AMB1/1,SKU-D,Ambiguous,1,1.00
`,
    fileSlrb: `A/C,Type,Ref,Date,Tot Goods,Tot VAT,Total,Run Bal
${verified},INV,${mismatchRef},15 Oct 26,${goods},0.00,${goods},${goods}
${verified},INV,${ongoingRef},15 Oct 26,11.00,0.00,11.00,11.00
${verified},CSH,CASH1,15 Oct 26,5.00,0.00,5.00,0.00
${unlinked},INV,WAIT1,15 Oct 26,3.00,0.00,3.00,3.00
${prefix},INV,AMB1,15 Oct 26,1.00,0.00,1.00,1.00
`,
  };
}

async function storePair(goods: string) {
  const body = lines(goods);
  const file561 = path.join(directory, `561-${goods}.csv`);
  const fileSlrb = path.join(directory, `slrb-${goods}.csv`);
  await writeFile(file561, body.file561);
  await writeFile(fileSlrb, body.fileSlrb);
  const row = await prisma.autopartHistoryAllImport.create({
    data: {
      status: "PREVIEWED",
      filename561l: "561L-ALL.CSV",
      filenameSlrb: "SLRB-ALL.CSV",
      fileHash561l: `hash-561-${goods}-${stamp}`,
      fileHashSlrb: `hash-slrb-${goods}-${stamp}`,
      storagePath561l: file561,
      storagePathSlrb: fileSlrb,
      encoding561l: "utf-8",
      encodingSlrb: "utf-8",
      createdById: adminId,
    },
  });
  return row.id;
}

beforeAll(async () => {
  await bootstrapRbac(prisma);
  directory = await mkdtemp(path.join(os.tmpdir(), "historic-ready-"));
  const user = await prisma.user.create({
    data: {
      email: `hist-ready.${stamp}@example.invalid`,
      name: "Historic ready",
      status: "ACTIVE",
      actorType: "INTERNAL",
      emailVerified: true,
    },
  });
  createdUserIds.push(user.id);
  adminId = user.id;
  const role = await prisma.role.findUniqueOrThrow({ where: { key: "SUPER_ADMIN" } });
  await prisma.userRole.create({ data: { userId: user.id, roleId: role.id } });
  const verifiedCompany = await prisma.company.create({
    data: {
      name: `Ready verified ${stamp}`,
      status: "ACTIVE",
      paymentTerms: "30 Days",
      autopartCustomerCode: verified,
      autopartCustomerCodeVerifiedAt: new Date(),
      autopartCustomerCodeVerifiedById: adminId,
    },
  });
  const target = await prisma.company.create({
    data: { name: `Ready target ${stamp}`, status: "ACTIVE", paymentTerms: "30 Days" },
  });
  verifiedCompanyId = verifiedCompany.id;
  targetCompanyId = target.id;
  createdCompanyIds.push(verifiedCompanyId, targetCompanyId);
  await prisma.autopartAccount.createMany({
    data: [
      { accountCode: verified, originalName: "Verified", classification: "TRADE_CANDIDATE", companyId: verifiedCompanyId },
      { accountCode: unlinked, originalName: "Unlinked", classification: "TRADE_CANDIDATE" },
      { accountCode: longer, originalName: "Longer", classification: "TRADE_CANDIDATE" },
    ],
  });
  const ongoing = await prisma.autopartSalesDocument.create({
    data: {
      companyId: verifiedCompanyId,
      autopartCustomerCode: verified,
      documentType: "INVOICE",
      documentReference: ongoingRef,
      source: "ONGOING_504",
      has504: true,
      goodsNet: "11.00",
    },
  });
  await prisma.autopartSalesLine.create({
    data: {
      companyId: verifiedCompanyId,
      documentId: ongoing.id,
      autopartCustomerCode: verified,
      documentType: "INVOICE",
      documentReference: ongoingRef,
      lineNumber: 1,
      sku: "LIVE-SKU",
      units: "1",
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
    await prisma.autopartAccount.deleteMany({ where: { accountCode: { in: [verified, unlinked, longer] } } });
    await prisma.company.deleteMany({ where: { id: { in: createdCompanyIds } } });
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    if (directory) await rm(directory, { recursive: true, force: true });
  } finally {
    await prisma.$disconnect();
  }
});

describe("historical import readiness", () => {
  it("labels the connected test database and splits stored lines without writing", async () => {
    const before = await prisma.autopartSalesLine.count();
    const report = await buildHistoricMatchingReadiness();
    expect(report.environment.kind).toBe("isolated-test");
    expect(report.environment.database?.endsWith("_test")).toBe(true);
    expect(report.environment.coolify).toBe(false);
    expect(report.environment.productionResetAllowed).toBe(false);
    expect(report.masterSplit.import).toBeGreaterThanOrEqual(1);
    expect(report.storage.requirement.length).toBeGreaterThan(20);
    expect(await prisma.autopartSalesLine.count()).toBe(before);
  });

  it("previews matches, exclusions, discrepancies, and ongoing overlaps", async () => {
    const importId = await storePair("9.00");
    const preview = await previewStoredHistoricImport(adminId, importId);
    expect(preview.matchedAccounts).toBe(1);
    expect(preview.unmatchedAccounts).toBe(2);
    expect(preview.matchedLines).toBe(2);
    expect(preview.unmatchedLines).toBe(2);
    expect(preview.reasons.UNLINKED).toBe(1);
    expect(preview.reasons.AMBIGUOUS).toBe(1);
    expect(preview.excludedLedger).toBe(1);
    expect(preview.discrepancyCount).toBe(1);
    expect(preview.lineNet).toBe("25.00");
    expect(preview.ongoingOverlaps.documents).toBe(1);
    expect(preview.ongoingOverlaps.lines).toBe(1);
    expect(preview.storage.requirement).toContain("AUTOPART_IMPORT_DIR");
  });

  it("clears a stale mismatch, refuses ambiguous verification, and verifies an exact unlinked account", async () => {
    const importId = await storePair("9.00");
    const first = await runAllHistoricImport(importId, adminId);
    expect(first.status).toBe("COMMITTED");
    const mismatched = await prisma.autopartSalesDocument.findFirstOrThrow({
      where: { companyId: verifiedCompanyId, documentReference: mismatchRef },
    });
    expect(mismatched.valueMismatchMinor).toBe(100);
    const ongoing = await prisma.autopartSalesDocument.findFirstOrThrow({
      where: { companyId: verifiedCompanyId, documentReference: ongoingRef },
      include: { lines: true },
    });
    expect(ongoing.lines[0]?.sku).toBe("LIVE-SKU");
    expect(ongoing.lines[0]?.source).toBe("ONGOING_TRM21QC");

    const matchedId = await storePair("10.00");
    const second = await runAllHistoricImport(matchedId, adminId);
    expect(second.status).toBe("COMMITTED");
    const cleared = await prisma.autopartSalesDocument.findFirstOrThrow({
      where: { companyId: verifiedCompanyId, documentReference: mismatchRef },
    });
    expect(cleared.valueMismatchMinor).toBeNull();
    expect(Number(cleared.linesNetSum)).toBe(10);
    expect(Number(cleared.goodsNet)).toBe(10);

    const ambiguous = await listHistoricReviews(adminId, { query: prefix, reason: "AMBIGUOUS", page: 1, pageSize: 10 });
    expect(ambiguous.total).toBe(1);
    await expect(
      verifyHistoricReviewAccount(adminId, {
        reviewId: ambiguous.reviews[0]!.id,
        companyId: targetCompanyId,
        confirmation: HISTORIC_VERIFY_PHRASE,
      }),
    ).rejects.toBeInstanceOf(AuthError);

    const waiting = await listHistoricReviews(adminId, { query: unlinked, reason: "UNLINKED", pageSize: 1 });
    expect(waiting.reviews).toHaveLength(1);
    expect(waiting.total).toBe(1);
    const verifiedResult = await verifyHistoricReviewAccount(adminId, {
      reviewId: waiting.reviews[0]!.id,
      companyId: targetCompanyId,
      confirmation: HISTORIC_VERIFY_PHRASE,
    });
    expect(verifiedResult.lines).toBe(1);
    const audit = await prisma.auditEvent.findFirst({
      where: { action: "autopart.history_review.verified", entityId: waiting.reviews[0]!.id },
    });
    expect(audit?.companyId).toBe(targetCompanyId);
    const promoted = await prisma.autopartSalesLine.findFirst({
      where: { companyId: targetCompanyId, documentReference: "WAIT1", source: "561L" },
    });
    expect(promoted?.sku).toBe("SKU-C");
    const stillOpen = await listHistoricReviews(adminId, { query: unlinked, reason: "UNLINKED" });
    expect(stillOpen.total).toBe(0);
  });

  it("blocks a second import while one lock is live and recovers an abandoned lock", async () => {
    const live = await prisma.autopartHistoryAllImport.create({
      data: {
        status: "PROCESSING",
        fileHash561l: `live-${stamp}`,
        lockOwner: "otherhost:4242:aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
        heartbeatAt: new Date(),
        createdById: adminId,
      },
    });
    const next = await storePair("10.00");
    expect(await claimHistoricImport(next)).toBe("busy");
    await prisma.autopartHistoryAllImport.update({
      where: { id: live.id },
      data: { heartbeatAt: new Date(Date.now() - 10 * 60 * 1000) },
    });
    expect(await recoverAbandonedHistoricImports()).toBeGreaterThan(0);
    expect((await prisma.autopartHistoryAllImport.findUniqueOrThrow({ where: { id: live.id } })).status).toBe("FAILED");
    expect(await claimHistoricImport(next)).toBe("claimed");
    await prisma.autopartHistoryAllImport.update({
      where: { id: next },
      data: { status: "FAILED", lockOwner: null },
    });
  });
});
