/**
 * Bulk verification approves exact identity evidence only.
 * Prospect links, truncated codes, and existing verified mappings are not rewritten.
 * Requires TEST_DATABASE_URL. Refuses the application database.
 */
import "@/server/testing/use-protect-integration-database";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { bootstrapRbac } from "../../../prisma/bootstrap/rbac";
import { HISTORIC_MATCH_VERIFY_PHRASE } from "@/domain/historic-account-match";
import { claimHistoricImport, finishHistoricImport } from "@/server/companies/historic-import-lock";
import { historicPromotion } from "@/server/companies/autopart-history-all";
import { approveHistoricAccountMatches, historicAccountMatchReport } from "@/server/companies/historic-account-match";

const prisma = new PrismaClient();
const stamp = Date.now().toString(36).toUpperCase();
const evidenceCode = `EV${stamp}`;
const prospectCode = `PR${stamp}`;
const shortCode = `T${stamp}`;
const longCode = `T${stamp}X`;
const verifiedCode = `VF${stamp}`;
const otherCode = `OT${stamp}`;
const vatCode = `VAT${stamp}`.slice(0, 20);
const staleCode = `ST${stamp}`.slice(0, 20);
const dupCode = `D${stamp}`;
const lockCode = `LK${stamp}`.slice(0, 20);
const retryCode = `RY${stamp}`.slice(0, 20);
const evidenceSku = `EVS${stamp}`.slice(0, 24);
const otherSku = `OTS${stamp}`.slice(0, 24);
const retrySku = `RYS${stamp}`.slice(0, 24);
const liveSku = `LV${stamp}`.slice(0, 24);
const createdCompanyIds: string[] = [];
const createdUserIds: string[] = [];
const createdImportIds: string[] = [];
let adminId = "";
let strangerId = "";
let evidenceCompanyId = "";
let prospectCompanyId = "";
let shortCompanyId = "";
let verifiedCompanyId = "";
let otherCompanyId = "";
let vatCompanyId = "";
let staleCompanyId = "";
let staleOtherCompanyId = "";
let lockCompanyId = "";
let retryCompanyId = "";

async function releaseSingleton() {
  await prisma.$executeRaw`
    UPDATE "AutopartHistoryImportLock"
    SET "fence" = "fence" + 1,
        "owner" = NULL,
        "importId" = NULL,
        "heartbeatAt" = NULL
    WHERE "id" = 1
  `;
}

beforeAll(async () => {
  await bootstrapRbac(prisma);
  await releaseSingleton();
  const admin = await prisma.user.create({
    data: {
      email: `hist-match.${stamp}@example.invalid`,
      name: "Historic match",
      status: "ACTIVE",
      actorType: "INTERNAL",
      emailVerified: true,
    },
  });
  const stranger = await prisma.user.create({
    data: {
      email: `hist-match.none.${stamp}@example.invalid`,
      name: "No import permission",
      status: "ACTIVE",
      actorType: "INTERNAL",
      emailVerified: true,
    },
  });
  adminId = admin.id;
  strangerId = stranger.id;
  createdUserIds.push(adminId, strangerId);
  const role = await prisma.role.findUniqueOrThrow({ where: { key: "SUPER_ADMIN" } });
  await prisma.userRole.create({ data: { userId: adminId, roleId: role.id } });

  const evidence = await prisma.company.create({
    data: { name: `Evidence ${stamp}`, status: "PROSPECT" },
  });
  const prospect = await prisma.company.create({
    data: {
      name: `Prospect ${stamp}`,
      status: "PROSPECT",
      autopartCustomerCode: prospectCode,
      notes: `Created from the Autopart customer master. Account ${prospectCode}.`,
    },
  });
  const short = await prisma.company.create({
    data: { name: `Short ${stamp}`, status: "PROSPECT", externalRef: shortCode },
  });
  const verified = await prisma.company.create({
    data: {
      name: `Verified ${stamp}`,
      status: "ACTIVE",
      autopartCustomerCode: verifiedCode,
      autopartCustomerCodeVerifiedAt: new Date("2026-01-01T00:00:00.000Z"),
      autopartCustomerCodeVerifiedById: adminId,
    },
  });
  const other = await prisma.company.create({
    data: { name: `Other ${stamp}`, status: "ACTIVE" },
  });
  const vat = await prisma.company.create({
    data: {
      name: `Vat ${stamp}`,
      status: "ACTIVE",
      companyNumber: `CN${stamp}`.slice(0, 20),
      vatNumber: `GB${stamp}`.slice(0, 20),
      autopartCustomerCode: vatCode,
    },
  });
  const stale = await prisma.company.create({
    data: { name: `Stale current ${stamp}`, status: "PROSPECT", autopartCustomerCode: staleCode },
  });
  const staleOther = await prisma.company.create({
    data: { name: `Stale previous ${stamp}`, status: "PROSPECT" },
  });
  const lockCompany = await prisma.company.create({
    data: { name: `Lock ${stamp}`, status: "PROSPECT", autopartCustomerCode: lockCode },
  });
  const retryCompany = await prisma.company.create({
    data: { name: `Retry ${stamp}`, status: "PROSPECT", autopartCustomerCode: retryCode },
  });
  const dupLower = await prisma.company.create({
    data: { name: `Dup lower ${stamp}`, status: "PROSPECT", externalRef: dupCode.toLowerCase(), accountNumber: dupCode.toLowerCase() },
  });
  const dupUpper = await prisma.company.create({
    data: { name: `Dup upper ${stamp}`, status: "PROSPECT", externalRef: dupCode, accountNumber: dupCode },
  });
  evidenceCompanyId = evidence.id;
  prospectCompanyId = prospect.id;
  shortCompanyId = short.id;
  verifiedCompanyId = verified.id;
  otherCompanyId = other.id;
  vatCompanyId = vat.id;
  staleCompanyId = stale.id;
  staleOtherCompanyId = staleOther.id;
  lockCompanyId = lockCompany.id;
  retryCompanyId = retryCompany.id;
  createdCompanyIds.push(
    evidenceCompanyId,
    prospectCompanyId,
    shortCompanyId,
    verifiedCompanyId,
    otherCompanyId,
    vatCompanyId,
    staleCompanyId,
    staleOtherCompanyId,
    lockCompanyId,
    retryCompanyId,
    dupLower.id,
    dupUpper.id,
  );

  await prisma.autopartAccount.createMany({
    data: [
      { accountCode: evidenceCode, originalName: "Evidence motors", classification: "TRADE_CANDIDATE", companyId: evidenceCompanyId },
      { accountCode: prospectCode, originalName: "Prospect motors", classification: "TRADE_CANDIDATE", companyId: prospectCompanyId },
      { accountCode: shortCode, originalName: "Short motors", classification: "TRADE_CANDIDATE", companyId: shortCompanyId },
      { accountCode: longCode, originalName: "Long motors", classification: "TRADE_CANDIDATE" },
      { accountCode: verifiedCode, originalName: "Verified motors", classification: "TRADE_CANDIDATE", companyId: verifiedCompanyId },
      { accountCode: otherCode, originalName: "Other motors", classification: "TRADE_CANDIDATE" },
      { accountCode: vatCode, originalName: "Vat motors", classification: "TRADE_CANDIDATE", companyId: vatCompanyId },
      { accountCode: staleCode, originalName: "Stale motors", classification: "TRADE_CANDIDATE", companyId: staleCompanyId },
      { accountCode: dupCode, originalName: "Duplicate motors", classification: "TRADE_CANDIDATE" },
      { accountCode: lockCode, originalName: "Lock motors", classification: "TRADE_CANDIDATE", companyId: lockCompanyId },
      { accountCode: retryCode, originalName: "Retry motors", classification: "TRADE_CANDIDATE", companyId: retryCompanyId },
    ],
  });
  const evidenceAccount = await prisma.autopartAccount.findFirstOrThrow({ where: { accountCode: evidenceCode } });
  const shortAccount = await prisma.autopartAccount.findFirstOrThrow({ where: { accountCode: shortCode } });
  const lockAccount = await prisma.autopartAccount.findFirstOrThrow({ where: { accountCode: lockCode } });
  const retryAccount = await prisma.autopartAccount.findFirstOrThrow({ where: { accountCode: retryCode } });
  await prisma.auditEvent.createMany({
    data: [
      {
        action: "autopart_account_linked",
        entityType: "AutopartAccount",
        entityId: evidenceAccount.id,
        actorUserId: adminId,
        companyId: evidenceCompanyId,
      },
      {
        action: "autopart_account_linked",
        entityType: "AutopartAccount",
        entityId: shortAccount.id,
        actorUserId: adminId,
        companyId: shortCompanyId,
      },
      {
        action: "autopart_account_linked",
        entityType: "AutopartAccount",
        entityId: lockAccount.id,
        actorUserId: adminId,
        companyId: lockCompanyId,
      },
      {
        action: "autopart_account_linked",
        entityType: "AutopartAccount",
        entityId: retryAccount.id,
        actorUserId: adminId,
        companyId: retryCompanyId,
      },
    ],
  });
  const staleAccount = await prisma.autopartAccount.findFirstOrThrow({ where: { accountCode: staleCode } });
  await prisma.auditEvent.create({
    data: {
      action: "autopart_account_linked",
      entityType: "AutopartAccount",
      entityId: staleAccount.id,
      actorUserId: adminId,
      companyId: staleOtherCompanyId,
      createdAt: new Date("2026-02-01T00:00:00.000Z"),
    },
  });
  const kept = await prisma.autopartSalesDocument.create({
    data: {
      companyId: otherCompanyId,
      autopartCustomerCode: otherCode,
      documentType: "INVOICE",
      documentReference: `KEEP${stamp}`.slice(0, 20),
      goodsNet: "4.00",
      source: "561L",
    },
  });
  const live = await prisma.autopartSalesDocument.create({
    data: {
      companyId: otherCompanyId,
      autopartCustomerCode: otherCode,
      documentType: "INVOICE",
      documentReference: `LIVE${stamp}`.slice(0, 20),
      goodsNet: "11.00",
      source: "ONGOING_TRM21QC",
      hasTrm21qc: true,
    },
  });
  await prisma.autopartSalesLine.createMany({
    data: [
      {
        companyId: otherCompanyId,
        documentId: kept.id,
        autopartCustomerCode: otherCode,
        documentType: "INVOICE",
        documentReference: `KEEP${stamp}`.slice(0, 20),
        lineNumber: 1,
        sku: otherSku,
        units: "1",
        salesNet: "4.00",
        source: "561L",
      },
      {
        companyId: otherCompanyId,
        documentId: live.id,
        autopartCustomerCode: otherCode,
        documentType: "INVOICE",
        documentReference: `LIVE${stamp}`.slice(0, 20),
        lineNumber: 1,
        sku: liveSku,
        units: "1",
        salesNet: "11.00",
        source: "ONGOING_TRM21QC",
      },
    ],
  });

  const imported = await prisma.autopartHistoryAllImport.create({
    data: {
      status: "COMMITTED",
      filename561l: "561L-ALL.CSV",
      filenameSlrb: "SLRB-ALL.CSV",
      fileHash561l: randomUUID(),
      fileHashSlrb: randomUUID(),
      createdById: adminId,
      completedAt: new Date(),
    },
  });
  createdImportIds.push(imported.id);
  await prisma.autopartHistoryReviewAccount.create({
    data: {
      importId: imported.id,
      accountCode: evidenceCode,
      reason: "UNLINKED",
      status: "OPEN",
      lineCount: 1,
      lineNet: "9.50",
      goodsNet: "9.50",
    },
  });
  await prisma.autopartHistoryStagedDocument.create({
    data: {
      importId: imported.id,
      accountCode: evidenceCode,
      documentType: "INVOICE",
      documentReference: "MATCH1",
      documentDate: new Date("2026-06-15T12:00:00.000Z"),
      goodsNet: "9.50",
      vat: "1.90",
      grossTotal: "11.40",
      source: "SLRB",
    },
  });
  await prisma.autopartHistoryStagedLine.create({
    data: {
      importId: imported.id,
      accountCode: evidenceCode,
      documentType: "INVOICE",
      documentReference: "MATCH1",
      lineNumber: 1,
      sku: evidenceSku,
      descriptionSnapshot: "Matched part",
      units: "1",
      salesNet: "9.50",
    },
  });
  await prisma.autopartHistoryReviewAccount.create({
    data: {
      importId: imported.id,
      accountCode: retryCode,
      reason: "NOT_VERIFIED",
      status: "OPEN",
      lineCount: 1,
      lineNet: "2.00",
      goodsNet: "2.00",
    },
  });
  await prisma.autopartHistoryStagedDocument.create({
    data: {
      importId: imported.id,
      accountCode: retryCode,
      documentType: "INVOICE",
      documentReference: "RETRY1",
      goodsNet: "2.00",
      vat: "0.40",
      grossTotal: "2.40",
      source: "SLRB",
    },
  });
  await prisma.autopartHistoryStagedLine.create({
    data: {
      importId: imported.id,
      accountCode: retryCode,
      documentType: "INVOICE",
      documentReference: "RETRY1",
      lineNumber: 1,
      sku: retrySku,
      units: "1",
      salesNet: "2.00",
    },
  });
}, 120_000);

afterAll(async () => {
  try {
    await releaseSingleton();
    await prisma.autopartSalesLine.deleteMany({ where: { companyId: { in: createdCompanyIds } } });
    await prisma.autopartSalesDocument.deleteMany({ where: { companyId: { in: createdCompanyIds } } });
    await prisma.autopartCustomerImportRun.deleteMany({ where: { companyId: { in: createdCompanyIds } } });
    await prisma.autopartAccount.deleteMany({
      where: {
        accountCode: {
          in: [evidenceCode, prospectCode, shortCode, longCode, verifiedCode, otherCode, vatCode, staleCode, dupCode, lockCode, retryCode],
        },
      },
    });
    await prisma.autopartHistoryAllImport.deleteMany({ where: { id: { in: createdImportIds } } });
    await prisma.company.deleteMany({ where: { id: { in: createdCompanyIds } } });
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  } finally {
    await prisma.$disconnect();
  }
});

describe("historic account matching", () => {
  it("approves exact evidence, skips unsafe rows, and publishes staged history once", async () => {
    const before = await historicAccountMatchReport(adminId, { query: evidenceCode, category: "EXACT_EVIDENCE" });
    expect(before.environment.kind).toBe("isolated-test");
    expect(before.rows.map((row) => row.accountCode)).toContain(evidenceCode);
    expect(before.rows.find((row) => row.accountCode === evidenceCode)?.selectable).toBe(true);
    const prospect = await historicAccountMatchReport(adminId, { query: prospectCode, category: "LINKED_UNVERIFIED" });
    expect(prospect.rows.map((row) => row.accountCode)).toContain(prospectCode);
    const conflict = await historicAccountMatchReport(adminId, { query: shortCode, category: "CONFLICT" });
    expect(conflict.rows.map((row) => row.accountCode)).toContain(shortCode);
    expect(conflict.rows.find((row) => row.accountCode === shortCode)?.conflicts.length).toBeGreaterThan(0);
    const verified = await historicAccountMatchReport(adminId, { query: verifiedCode, category: "VERIFIED" });
    expect(verified.rows.map((row) => row.accountCode)).toContain(verifiedCode);

    await expect(
      approveHistoricAccountMatches(strangerId, {
        accountCodes: [evidenceCode],
        confirmation: HISTORIC_MATCH_VERIFY_PHRASE,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      approveHistoricAccountMatches(adminId, { accountCodes: [evidenceCode], confirmation: "approve" }),
    ).rejects.toMatchObject({ code: "CONFIRMATION_REQUIRED" });
    const untouched = await prisma.company.findUniqueOrThrow({ where: { id: evidenceCompanyId } });
    expect(untouched.autopartCustomerCode).toBeNull();
    expect(untouched.status).toBe("PROSPECT");

    const saved = await approveHistoricAccountMatches(adminId, {
      accountCodes: [evidenceCode, prospectCode, shortCode, verifiedCode],
      confirmation: HISTORIC_MATCH_VERIFY_PHRASE,
    });
    expect(saved.approved.map((row) => row.accountCode)).toEqual([evidenceCode]);
    expect(saved.approved[0]?.lines).toBe(1);
    expect(saved.skipped.map((row) => row.accountCode).sort()).toEqual([prospectCode, shortCode].sort());
    expect(saved.preserved.map((row) => row.accountCode)).toEqual([verifiedCode]);

    const evidenceCompany = await prisma.company.findUniqueOrThrow({ where: { id: evidenceCompanyId } });
    expect(evidenceCompany.status).toBe("PROSPECT");
    expect(evidenceCompany.autopartCustomerCode).toBe(evidenceCode);
    expect(evidenceCompany.autopartCustomerCodeVerifiedById).toBe(adminId);
    expect(await prisma.companyUser.count({ where: { companyId: evidenceCompanyId } })).toBe(0);
    expect(await prisma.userInvitation.count({ where: { companyId: evidenceCompanyId } })).toBe(0);
    const evidenceAccount = await prisma.autopartAccount.findFirstOrThrow({ where: { accountCode: evidenceCode } });
    expect(evidenceAccount.companyId).toBe(evidenceCompanyId);
    expect(evidenceAccount.portalEligible).toBe(false);
    expect(evidenceAccount.historicalAccessEnabled).toBe(false);
    const published = await prisma.autopartSalesLine.findMany({ where: { companyId: evidenceCompanyId } });
    expect(published.map((line) => line.sku)).toEqual([evidenceSku]);
    expect(published[0]?.companyId).toBe(evidenceCompanyId);
    expect(await prisma.autopartSalesDocument.count({ where: { companyId: evidenceCompanyId } })).toBe(1);

    const prospectCompany = await prisma.company.findUniqueOrThrow({ where: { id: prospectCompanyId } });
    expect(prospectCompany.autopartCustomerCodeVerifiedAt).toBeNull();
    expect(prospectCompany.status).toBe("PROSPECT");
    const verifiedCompany = await prisma.company.findUniqueOrThrow({ where: { id: verifiedCompanyId } });
    expect(verifiedCompany.autopartCustomerCodeVerifiedAt?.toISOString()).toBe("2026-01-01T00:00:00.000Z");
    expect(verifiedCompany.autopartCustomerCodeVerifiedById).toBe(adminId);
    const otherLines = await prisma.autopartSalesLine.findMany({
      where: { companyId: otherCompanyId },
      orderBy: { sku: "asc" },
    });
    expect(otherLines.map((line) => line.sku)).toEqual([liveSku, otherSku].sort());
    expect(otherLines.find((line) => line.sku === liveSku)?.source).toBe("ONGOING_TRM21QC");
    expect(await prisma.autopartSalesDocument.count({ where: { companyId: otherCompanyId, hasTrm21qc: true } })).toBe(1);

    const again = await approveHistoricAccountMatches(adminId, {
      accountCodes: [evidenceCode],
      confirmation: HISTORIC_MATCH_VERIFY_PHRASE,
    });
    expect(again.approved).toEqual([]);
    expect(again.preserved.map((row) => row.accountCode)).toEqual([evidenceCode]);
    expect(await prisma.autopartSalesLine.count({ where: { companyId: evidenceCompanyId } })).toBe(1);
    expect(await prisma.autopartSalesLine.count({ where: { sku: otherSku, companyId: otherCompanyId } })).toBe(1);

    const audit = await prisma.auditEvent.findFirst({
      where: { action: "autopart.historic_match.bulk_verified", actorUserId: adminId },
      orderBy: { createdAt: "desc" },
    });
    expect(audit).not.toBeNull();
  }, 120_000);

  it("does not verify a company number, a stale staff link, or a duplicated reference", async () => {
    const vat = await historicAccountMatchReport(adminId, { query: vatCode, category: "LINKED_UNVERIFIED" });
    expect(vat.rows.map((row) => row.accountCode)).toContain(vatCode);
    const stale = await historicAccountMatchReport(adminId, { query: staleCode, category: "CONFLICT" });
    expect(stale.rows.find((row) => row.accountCode === staleCode)?.conflicts.join(" ")).toContain("different company");
    const duplicated = await historicAccountMatchReport(adminId, { query: dupCode, category: "CONFLICT" });
    const dupRow = duplicated.rows.find((row) => row.accountCode === dupCode);
    expect(dupRow?.conflicts.join(" ")).toContain("external reference");
    expect(dupRow?.conflicts.join(" ")).toContain("account number");

    const saved = await approveHistoricAccountMatches(adminId, {
      accountCodes: [vatCode, staleCode, dupCode],
      confirmation: HISTORIC_MATCH_VERIFY_PHRASE,
    });
    expect(saved.approved).toEqual([]);
    expect(saved.skipped.map((row) => row.accountCode).sort()).toEqual([dupCode, staleCode, vatCode].sort());
    expect((await prisma.company.findUniqueOrThrow({ where: { id: vatCompanyId } })).autopartCustomerCodeVerifiedAt).toBeNull();
    expect((await prisma.company.findUniqueOrThrow({ where: { id: staleCompanyId } })).autopartCustomerCodeVerifiedAt).toBeNull();
  }, 120_000);

  it("refuses bulk verification while an ALL-file import holds the lock", async () => {
    const busy = await prisma.autopartHistoryAllImport.create({
      data: { status: "PREVIEWED", fileHash561l: randomUUID(), createdById: adminId },
    });
    createdImportIds.push(busy.id);
    const claimed = await claimHistoricImport(busy.id);
    expect(claimed.status).toBe("claimed");
    if (claimed.status !== "claimed") throw new Error(`lock claim returned ${claimed.status}`);
    try {
      const saved = await approveHistoricAccountMatches(adminId, {
        accountCodes: [lockCode],
        confirmation: HISTORIC_MATCH_VERIFY_PHRASE,
      });
      expect(saved.approved).toEqual([]);
      expect(saved.incomplete.map((row) => row.accountCode)).toEqual([lockCode]);
      const company = await prisma.company.findUniqueOrThrow({ where: { id: lockCompanyId } });
      expect(company.autopartCustomerCodeVerifiedAt).toBeNull();
      expect(company.autopartCustomerCode).toBe(lockCode);
    } finally {
      await finishHistoricImport(busy.id, claimed.fence, {
        status: "FAILED",
        completedAt: new Date(),
        summary: { recoverable: true, message: "Test import released the lock." },
      });
      await releaseSingleton();
    }
  }, 120_000);

  it("rolls back a failed bulk verification and retries it once", async () => {
    historicPromotion.batchSize = 1;
    historicPromotion.afterCertifiedBatch = (linesWritten) => {
      if (linesWritten >= 1) throw new Error("stopped after first certified batch");
    };
    try {
      const failed = await approveHistoricAccountMatches(adminId, {
        accountCodes: [retryCode],
        confirmation: HISTORIC_MATCH_VERIFY_PHRASE,
      });
      expect(failed.approved).toEqual([]);
      expect(failed.incomplete.map((row) => row.accountCode)).toEqual([retryCode]);
    } finally {
      historicPromotion.batchSize = 500;
      historicPromotion.afterCertifiedBatch = null;
    }
    const company = await prisma.company.findUniqueOrThrow({ where: { id: retryCompanyId } });
    expect(company.autopartCustomerCodeVerifiedAt).toBeNull();
    expect(company.status).toBe("PROSPECT");
    expect(await prisma.autopartSalesLine.count({ where: { companyId: retryCompanyId } })).toBe(0);
    const review = await prisma.autopartHistoryReviewAccount.findFirstOrThrow({
      where: { accountCode: retryCode },
    });
    expect(review.status).toBe("OPEN");

    const retried = await approveHistoricAccountMatches(adminId, {
      accountCodes: [retryCode],
      confirmation: HISTORIC_MATCH_VERIFY_PHRASE,
    });
    expect(retried.approved.map((row) => row.accountCode)).toEqual([retryCode]);
    expect(retried.approved[0]?.lines).toBe(1);
    const verified = await prisma.company.findUniqueOrThrow({ where: { id: retryCompanyId } });
    expect(verified.status).toBe("PROSPECT");
    expect(verified.autopartCustomerCode).toBe(retryCode);
    expect(await prisma.autopartSalesLine.count({ where: { companyId: retryCompanyId, sku: retrySku } })).toBe(1);
    expect(await prisma.autopartSalesLine.count({ where: { companyId: otherCompanyId, sku: liveSku, source: "ONGOING_TRM21QC" } })).toBe(1);
    const keptVerified = await prisma.company.findUniqueOrThrow({ where: { id: verifiedCompanyId } });
    expect(keptVerified.autopartCustomerCodeVerifiedAt?.toISOString()).toBe("2026-01-01T00:00:00.000Z");
  }, 120_000);
});
