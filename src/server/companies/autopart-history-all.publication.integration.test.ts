/**
 * Account publication is one transaction. A failure after the first certified
 * batch leaves no sales rows and no portal or Sales Intelligence totals.
 * Promotion and retirement also wait for the ALL-file import lock.
 * Requires TEST_DATABASE_URL. Refuses the application database.
 */
import "@/server/testing/use-protect-integration-database";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { bootstrapRbac } from "../../../prisma/bootstrap/rbac";
import { listPortalPurchaseHistory } from "@/server/companies/purchase-history";
import { finishHistoricImport } from "@/server/companies/historic-import-lock";
import { getUnifiedCustomerHistory } from "@/server/sales-intelligence/unified-sales";
import {
  claimHistoricImport,
  historicPromotion,
  HISTORIC_SNAPSHOT_RETIRE_PHRASE,
  HISTORIC_VERIFY_PHRASE,
  promoteStagedAutopartHistory,
  retireAbsentHistoricDocuments,
  verifyHistoricReviewAccount,
} from "@/server/companies/autopart-history-all";

const prisma = new PrismaClient();
const holder = new PrismaClient();
const stamp = Date.now().toString(36).toUpperCase();
const partialCode = `P${stamp}`.slice(0, 20);
const lockedCode = `L${stamp}`.slice(0, 20);
const partialSkuA = `PA${stamp}`.slice(0, 24);
const partialSkuB = `PB${stamp}`.slice(0, 24);
const newSkuA = `NA${stamp}`.slice(0, 24);
const newSkuB = `NB${stamp}`.slice(0, 24);
const staleSku = `ST${stamp}`.slice(0, 24);
const liveSku = `LV${stamp}`.slice(0, 24);
const createdCompanyIds: string[] = [];
const createdUserIds: string[] = [];
const createdImportIds: string[] = [];
let adminId = "";
let partialBuyerId = "";
let lockedBuyerId = "";
let partialCompanyId = "";
let lockedCompanyId = "";
let partialReviewId = "";
let lockedReviewId = "";
let lockedImportId = "";

function restorePromotionHooks() {
  historicPromotion.batchSize = 500;
  historicPromotion.afterCertifiedBatch = null;
}

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

async function visibleHistory(buyerId: string, companyId: string) {
  const portal = await listPortalPurchaseHistory(buyerId, {});
  const intelligence = await getUnifiedCustomerHistory(adminId, { companyId });
  return {
    portalSkus: portal.items.map((item) => item.sku.toUpperCase()).sort(),
    portalSpend: portal.summary.historicNetSpend,
    portalProducts: portal.summary.productsPurchased,
    certifiedLines: intelligence.summary.lineCount,
    certifiedNet: Number(intelligence.summary.certifiedNet),
  };
}

async function waitForImportLockWaiter(): Promise<boolean> {
  const started = Date.now();
  while (Date.now() - started < 10_000) {
    const rows = await prisma.$queryRaw<Array<{ waiting: number }>>`
      SELECT COUNT(*)::int AS waiting
      FROM pg_locks
      WHERE NOT granted
    `;
    if (Number(rows[0]?.waiting ?? 0) > 0) return true;
    const active = await prisma.$queryRaw<Array<{ waiting: number }>>`
      SELECT COUNT(*)::int AS waiting
      FROM pg_stat_activity
      WHERE datname = current_database()
        AND pid <> pg_backend_pid()
        AND wait_event_type = 'Lock'
    `;
    if (Number(active[0]?.waiting ?? 0) > 0) return true;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return false;
}

async function describeDatabaseActivity(): Promise<string> {
  const rows = await prisma.$queryRaw<
    Array<{ state: string | null; wait_event_type: string | null; wait_event: string | null; query: string | null }>
  >`
    SELECT state, wait_event_type, wait_event, left(query, 220) AS query
    FROM pg_stat_activity
    WHERE datname = current_database()
      AND pid <> pg_backend_pid()
      AND state IS DISTINCT FROM 'idle'
  `;
  return JSON.stringify(rows, null, 2);
}

async function holdImportLock(): Promise<() => Promise<void>> {
  let release!: () => void;
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  let holding!: () => void;
  const held = new Promise<void>((resolve) => {
    holding = resolve;
  });
  const done = holder.$transaction(
    async (tx) => {
      await tx.$executeRaw`
        INSERT INTO "AutopartHistoryImportLock" ("id", "fence")
        VALUES (1, 0)
        ON CONFLICT ("id") DO NOTHING
      `;
      await tx.$queryRaw`SELECT "id" FROM "AutopartHistoryImportLock" WHERE "id" = 1 FOR UPDATE`;
      holding();
      await released;
    },
    { timeout: 30_000 },
  );
  await held;
  let unlocked = false;
  return async () => {
    if (unlocked) return;
    unlocked = true;
    release();
    await done;
  };
}

beforeAll(async () => {
  await bootstrapRbac(prisma);
  await releaseSingleton();
  const admin = await prisma.user.create({
    data: {
      email: `hist-pub.${stamp}@example.invalid`,
      name: "Historic publication",
      status: "ACTIVE",
      actorType: "INTERNAL",
      emailVerified: true,
    },
  });
  createdUserIds.push(admin.id);
  adminId = admin.id;
  const role = await prisma.role.findUniqueOrThrow({ where: { key: "SUPER_ADMIN" } });
  await prisma.userRole.create({ data: { userId: admin.id, roleId: role.id } });

  const partial = await prisma.company.create({
    data: { name: `Partial history ${stamp}`, status: "ACTIVE", paymentTerms: "30 Days" },
  });
  const locked = await prisma.company.create({
    data: {
      name: `Locked history ${stamp}`,
      status: "ACTIVE",
      paymentTerms: "30 Days",
      autopartCustomerCode: lockedCode,
      autopartCustomerCodeVerifiedAt: new Date(),
      autopartCustomerCodeVerifiedById: adminId,
    },
  });
  partialCompanyId = partial.id;
  lockedCompanyId = locked.id;
  createdCompanyIds.push(partialCompanyId, lockedCompanyId);
  partialBuyerId = (
    await prisma.user.create({
      data: {
        email: `hist-pub.buyer.${stamp}@example.invalid`,
        name: "Partial buyer",
        status: "ACTIVE",
        actorType: "TRADE",
        emailVerified: true,
      },
    })
  ).id;
  lockedBuyerId = (
    await prisma.user.create({
      data: {
        email: `hist-pub.locked.${stamp}@example.invalid`,
        name: "Locked buyer",
        status: "ACTIVE",
        actorType: "TRADE",
        emailVerified: true,
      },
    })
  ).id;
  createdUserIds.push(partialBuyerId, lockedBuyerId);
  await prisma.companyUser.createMany({
    data: [
      { companyId: partialCompanyId, userId: partialBuyerId, role: "TRADE_BUYER", status: "ACTIVE", isDefault: true },
      { companyId: lockedCompanyId, userId: lockedBuyerId, role: "TRADE_BUYER", status: "ACTIVE", isDefault: true },
    ],
  });
  await prisma.autopartAccount.createMany({
    data: [
      { accountCode: partialCode, originalName: "Partial", classification: "TRADE_CANDIDATE" },
      { accountCode: lockedCode, originalName: "Locked", classification: "TRADE_CANDIDATE", companyId: lockedCompanyId },
    ],
  });

  const partialImport = await prisma.autopartHistoryAllImport.create({
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
  createdImportIds.push(partialImport.id);
  const partialReview = await prisma.autopartHistoryReviewAccount.create({
    data: {
      importId: partialImport.id,
      accountCode: partialCode,
      reason: "UNLINKED",
      status: "OPEN",
      lineCount: 2,
      lineNet: "6.00",
      goodsNet: "6.00",
    },
  });
  partialReviewId = partialReview.id;
  await prisma.autopartHistoryStagedDocument.create({
    data: {
      importId: partialImport.id,
      accountCode: partialCode,
      documentType: "INVOICE",
      documentReference: "PART1",
      documentDate: new Date("2026-06-15T12:00:00.000Z"),
      goodsNet: "6.00",
      vat: "1.20",
      grossTotal: "7.20",
      source: "SLRB",
    },
  });
  await prisma.autopartHistoryStagedLine.createMany({
    data: [
      {
        importId: partialImport.id,
        accountCode: partialCode,
        documentType: "INVOICE",
        documentReference: "PART1",
        lineNumber: 1,
        sku: partialSkuA,
        descriptionSnapshot: "Partial A",
        units: "1",
        salesNet: "2.50",
      },
      {
        importId: partialImport.id,
        accountCode: partialCode,
        documentType: "INVOICE",
        documentReference: "PART1",
        lineNumber: 2,
        sku: partialSkuB,
        descriptionSnapshot: "Partial B",
        units: "1",
        salesNet: "3.50",
      },
    ],
  });

  const lockedImport = await prisma.autopartHistoryAllImport.create({
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
  lockedImportId = lockedImport.id;
  createdImportIds.push(lockedImportId);
  const lockedReview = await prisma.autopartHistoryReviewAccount.create({
    data: {
      importId: lockedImportId,
      accountCode: lockedCode,
      reason: "NOT_VERIFIED",
      status: "OPEN",
      companyId: lockedCompanyId,
      lineCount: 2,
      lineNet: "6.00",
      goodsNet: "6.00",
    },
  });
  lockedReviewId = lockedReview.id;
  await prisma.autopartHistoryStagedDocument.create({
    data: {
      importId: lockedImportId,
      accountCode: lockedCode,
      documentType: "INVOICE",
      documentReference: "NEW1",
      documentDate: new Date("2026-06-15T12:00:00.000Z"),
      goodsNet: "6.00",
      vat: "1.20",
      grossTotal: "7.20",
      source: "SLRB",
    },
  });
  await prisma.autopartHistoryStagedLine.createMany({
    data: [
      {
        importId: lockedImportId,
        accountCode: lockedCode,
        documentType: "INVOICE",
        documentReference: "NEW1",
        lineNumber: 1,
        sku: newSkuA,
        units: "1",
        salesNet: "2.50",
      },
      {
        importId: lockedImportId,
        accountCode: lockedCode,
        documentType: "INVOICE",
        documentReference: "NEW1",
        lineNumber: 2,
        sku: newSkuB,
        units: "1",
        salesNet: "3.50",
      },
    ],
  });
  const stale = await prisma.autopartSalesDocument.create({
    data: {
      companyId: lockedCompanyId,
      autopartCustomerCode: lockedCode,
      documentType: "INVOICE",
      documentReference: "STALE1",
      documentDate: new Date("2026-05-01T12:00:00.000Z"),
      goodsNet: "4.00",
      source: "SLRB",
    },
  });
  await prisma.autopartSalesLine.create({
    data: {
      companyId: lockedCompanyId,
      documentId: stale.id,
      autopartCustomerCode: lockedCode,
      documentType: "INVOICE",
      documentReference: "STALE1",
      lineNumber: 1,
      sku: staleSku,
      units: "1",
      salesNet: "4.00",
      source: "561L",
    },
  });
  const live = await prisma.autopartSalesDocument.create({
    data: {
      companyId: lockedCompanyId,
      autopartCustomerCode: lockedCode,
      documentType: "INVOICE",
      documentReference: "LIVE1",
      documentDate: new Date("2026-05-02T12:00:00.000Z"),
      goodsNet: "11.00",
      source: "ONGOING_TRM21QC",
      hasTrm21qc: true,
    },
  });
  await prisma.autopartSalesLine.create({
    data: {
      companyId: lockedCompanyId,
      documentId: live.id,
      autopartCustomerCode: lockedCode,
      documentType: "INVOICE",
      documentReference: "LIVE1",
      lineNumber: 1,
      sku: liveSku,
      units: "1",
      salesNet: "11.00",
      source: "ONGOING_TRM21QC",
    },
  });
  await prisma.autopartHistorySnapshotGap.createMany({
    data: [
      {
        importId: lockedImportId,
        companyId: lockedCompanyId,
        documentType: "INVOICE",
        documentReference: "STALE1",
        goodsNet: "4.00",
      },
      {
        importId: lockedImportId,
        companyId: lockedCompanyId,
        documentType: "INVOICE",
        documentReference: "LIVE1",
        goodsNet: "11.00",
      },
    ],
  });
}, 120_000);

afterAll(async () => {
  restorePromotionHooks();
  try {
    await releaseSingleton();
    await prisma.autopartHistoryAllImport.deleteMany({ where: { id: { in: createdImportIds } } });
    await prisma.autopartSalesLine.deleteMany({ where: { companyId: { in: createdCompanyIds } } });
    await prisma.autopartSalesDocument.deleteMany({ where: { companyId: { in: createdCompanyIds } } });
    await prisma.autopartCustomerImportRun.deleteMany({ where: { companyId: { in: createdCompanyIds } } });
    await prisma.autopartAccount.deleteMany({ where: { accountCode: { in: [partialCode, lockedCode] } } });
    await prisma.company.deleteMany({ where: { id: { in: createdCompanyIds } } });
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  } finally {
    await prisma.$disconnect();
    await holder.$disconnect();
  }
});

describe("historic account publication", () => {
  it("rolls back a halfway promotion so partial history is not certified", async () => {
    historicPromotion.batchSize = 1;
    historicPromotion.afterCertifiedBatch = (linesWritten) => {
      if (linesWritten >= 1) throw new Error("stopped after first certified batch");
    };
    try {
      await expect(
        verifyHistoricReviewAccount(adminId, {
          reviewId: partialReviewId,
          companyId: partialCompanyId,
          confirmation: HISTORIC_VERIFY_PHRASE,
        }),
      ).rejects.toMatchObject({ name: "AuthError", code: "PROMOTION_INCOMPLETE", status: 409 });
    } finally {
      restorePromotionHooks();
    }

    const company = await prisma.company.findUniqueOrThrow({ where: { id: partialCompanyId } });
    expect(company.autopartCustomerCode).toBe(partialCode);
    const review = await prisma.autopartHistoryReviewAccount.findUniqueOrThrow({ where: { id: partialReviewId } });
    expect(review.status).toBe("VERIFYING");
    expect(await prisma.autopartSalesLine.count({ where: { companyId: partialCompanyId } })).toBe(0);
    expect(await prisma.autopartSalesDocument.count({ where: { companyId: partialCompanyId } })).toBe(0);
    expect(
      await prisma.autopartCustomerImportRun.count({
        where: { companyId: partialCompanyId, status: { in: ["PROCESSING", "COMMITTED"] } },
      }),
    ).toBe(0);
    const hidden = await visibleHistory(partialBuyerId, partialCompanyId);
    expect(hidden.portalSkus).toEqual([]);
    expect(hidden.portalProducts).toBe(0);
    expect(Number(hidden.portalSpend)).toBe(0);
    expect(hidden.certifiedLines).toBe(0);
    expect(hidden.certifiedNet).toBe(0);

    const published = await verifyHistoricReviewAccount(adminId, {
      reviewId: partialReviewId,
      companyId: partialCompanyId,
      confirmation: HISTORIC_VERIFY_PHRASE,
    });
    expect(published.completed).toBe(true);
    expect(published.lines).toBe(2);
    const lines = await prisma.autopartSalesLine.findMany({
      where: { companyId: partialCompanyId },
      orderBy: { lineNumber: "asc" },
    });
    expect(lines.map((line) => line.sku)).toEqual([partialSkuA, partialSkuB]);
    expect(lines.map((line) => Number(line.salesNet))).toEqual([2.5, 3.5]);
    expect(await prisma.autopartSalesDocument.count({ where: { companyId: partialCompanyId } })).toBe(1);
    const applied = await prisma.autopartHistoryReviewAccount.findUniqueOrThrow({ where: { id: partialReviewId } });
    expect(applied.status).toBe("APPLIED");
    const shown = await visibleHistory(partialBuyerId, partialCompanyId);
    expect(shown.portalSkus).toEqual([partialSkuA, partialSkuB].sort());
    expect(shown.portalProducts).toBe(2);
    expect(Number(shown.portalSpend)).toBe(6);
    expect(shown.certifiedLines).toBe(2);
    expect(shown.certifiedNet).toBe(6);

    const again = await promoteStagedAutopartHistory(adminId, partialCompanyId, partialCode, partialReviewId);
    expect(again.applied).toBe(false);
    expect(await prisma.autopartSalesLine.count({ where: { companyId: partialCompanyId } })).toBe(2);
    const still = await visibleHistory(partialBuyerId, partialCompanyId);
    expect(still.certifiedLines).toBe(2);
    expect(still.certifiedNet).toBe(6);
  }, 120_000);

  it("refuses promotion and retirement while an ALL import holds the lock, then retries cleanly", async () => {
    await releaseSingleton();
    const before = await visibleHistory(lockedBuyerId, lockedCompanyId);
    expect(before.portalSkus).toEqual([liveSku, staleSku].sort());
    expect(before.certifiedLines).toBe(2);
    expect(before.certifiedNet).toBe(15);

    const busy = await prisma.autopartHistoryAllImport.create({
      data: { status: "PREVIEWED", fileHash561l: randomUUID(), createdById: adminId },
    });
    createdImportIds.push(busy.id);
    let fence: bigint | null = null;
    try {
      const claimed = await claimHistoricImport(busy.id);
      expect(claimed.status).toBe("claimed");
      if (claimed.status !== "claimed") throw new Error(`lock claim returned ${claimed.status}`);
      fence = claimed.fence;
      await expect(
        promoteStagedAutopartHistory(adminId, lockedCompanyId, lockedCode, lockedReviewId),
      ).rejects.toMatchObject({ code: "IMPORT_IN_PROGRESS", status: 409 });
      await expect(
        retireAbsentHistoricDocuments(adminId, {
          importId: lockedImportId,
          confirmation: HISTORIC_SNAPSHOT_RETIRE_PHRASE,
        }),
      ).rejects.toMatchObject({ code: "IMPORT_IN_PROGRESS", status: 409 });
      expect(await prisma.autopartSalesLine.count({ where: { sku: { in: [newSkuA, newSkuB] } } })).toBe(0);
      expect(await prisma.autopartSalesDocument.count({ where: { companyId: lockedCompanyId, documentReference: "STALE1" } })).toBe(1);
      expect(await prisma.autopartSalesLine.count({ where: { companyId: lockedCompanyId, sku: liveSku, source: "ONGOING_TRM21QC" } })).toBe(1);
      const gaps = await prisma.autopartHistorySnapshotGap.findMany({
        where: { importId: lockedImportId },
        orderBy: { documentReference: "asc" },
      });
      expect(gaps.map((gap) => gap.status)).toEqual(["OPEN", "OPEN"]);
      const blocked = await visibleHistory(lockedBuyerId, lockedCompanyId);
      expect(blocked.portalSkus).toEqual(before.portalSkus);
      expect(blocked.certifiedLines).toBe(before.certifiedLines);
      expect(blocked.certifiedNet).toBe(before.certifiedNet);
    } finally {
      if (fence != null) {
        await finishHistoricImport(busy.id, fence, {
          status: "FAILED",
          completedAt: new Date(),
          summary: { recoverable: true, message: "Test import released the lock." },
        });
      }
      await releaseSingleton();
    }

    const unlock = await holdImportLock();
    let settled = false;
    const attempt = promoteStagedAutopartHistory(adminId, lockedCompanyId, lockedCode, lockedReviewId).finally(() => {
      settled = true;
    });
    try {
      const waiting = await waitForImportLockWaiter();
      if (!waiting) {
        throw new Error(
          `promotion did not wait on the import lock (settled=${settled})\n${await describeDatabaseActivity()}`,
        );
      }
      expect(settled).toBe(false);
      expect(await prisma.autopartSalesLine.count({ where: { sku: { in: [newSkuA, newSkuB] } } })).toBe(0);
    } finally {
      await unlock();
    }
    const published = await attempt;
    expect(published.completed).toBe(true);
    expect(published.lines).toBe(2);
    expect(await prisma.autopartSalesLine.count({ where: { companyId: lockedCompanyId, documentReference: "NEW1" } })).toBe(2);

    const replay = await promoteStagedAutopartHistory(adminId, lockedCompanyId, lockedCode, lockedReviewId);
    expect(replay.applied).toBe(false);
    expect(await prisma.autopartSalesLine.count({ where: { companyId: lockedCompanyId, documentReference: "NEW1" } })).toBe(2);

    const retired = await retireAbsentHistoricDocuments(adminId, {
      importId: lockedImportId,
      confirmation: HISTORIC_SNAPSHOT_RETIRE_PHRASE,
    });
    expect(retired.retired).toBe(1);
    expect(await prisma.autopartSalesDocument.count({ where: { companyId: lockedCompanyId, documentReference: "STALE1" } })).toBe(0);
    expect(await prisma.autopartSalesLine.count({ where: { companyId: lockedCompanyId, sku: liveSku, source: "ONGOING_TRM21QC" } })).toBe(1);
    expect(await prisma.autopartSalesDocument.count({ where: { companyId: lockedCompanyId, documentReference: "LIVE1", hasTrm21qc: true } })).toBe(1);
    const liveGap = await prisma.autopartHistorySnapshotGap.findFirstOrThrow({
      where: { importId: lockedImportId, documentReference: "LIVE1" },
    });
    expect(liveGap.status).toBe("OPEN");
    const after = await visibleHistory(lockedBuyerId, lockedCompanyId);
    expect(after.portalSkus).toEqual([liveSku, newSkuA, newSkuB].sort());
    expect(after.certifiedLines).toBe(3);
    expect(after.certifiedNet).toBe(17);
    const retiredAgain = await retireAbsentHistoricDocuments(adminId, {
      importId: lockedImportId,
      confirmation: HISTORIC_SNAPSHOT_RETIRE_PHRASE,
    });
    expect(retiredAgain.retired).toBe(0);
    expect(await prisma.autopartSalesLine.count({ where: { companyId: lockedCompanyId } })).toBe(3);
  }, 120_000);
});
