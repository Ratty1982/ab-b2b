import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { bootstrapRbac } from "../../../prisma/bootstrap/rbac";
import { getCompanyWorkspace } from "@/server/companies/service";
import {
  autopartUploadInFlight,
  getPortalAutopartHistory,
  listAutopartDocumentMatches,
  listAutopartInvoiceLines,
  listAutopartLedger,
  saveAutopartUpload,
  setAutopartHistoricalAccess,
  writeAutopartReconciliationCsv,
} from "@/server/companies/autopart-master-import";
import { listCustomerPrices } from "@/server/pricing/service";
import { AuthError, requireAuthenticatedUser } from "@/server/rbac/guards";
import { deactivateStaffUser } from "@/server/users/service";

const prisma = new PrismaClient();
const stamp = `S${Date.now().toString(36).slice(-7).toUpperCase()}`;
const accountCode = `${stamp}A`;
const formulaRef = "=cmd|'/c calc'!A0";

let adminId = "";
let salesId = "";
let accountsId = "";
let tradeId = "";
let otherTradeId = "";
let staffId = "";
let companyId = "";
let otherCompanyId = "";
let accountId = "";
let batchId = "";
let dir = "";
const previousDir = process.env["AUTOPART_IMPORT_DIR"];
const previousFlag = process.env["AUTOPART_PORTAL_HISTORY_ENABLED"];
const previousMax = process.env["AUTOPART_IMPORT_MAX_BYTES"];

async function ensureUser(
  email: string,
  roles: string[],
  actorType: "INTERNAL" | "TRADE" = "INTERNAL",
) {
  const user = await prisma.user.create({
    data: { email, name: email.split("@")[0]!, status: "ACTIVE", actorType, emailVerified: true },
  });
  for (const key of roles) {
    const role = await prisma.role.findUniqueOrThrow({ where: { key } });
    await prisma.userRole.create({ data: { userId: user.id, roleId: role.id } });
  }
  return user.id;
}

function textBody(text: string): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(text));
      controller.close();
    },
  });
}

describe("security access controls", () => {
  beforeAll(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "ab-security-upload-"));
    process.env["AUTOPART_IMPORT_DIR"] = dir;
    process.env["AUTOPART_PORTAL_HISTORY_ENABLED"] = "false";
    await bootstrapRbac(prisma);
    adminId = await ensureUser(`security.admin.${stamp}@example.invalid`, ["SUPER_ADMIN"]);
    salesId = await ensureUser(`security.sales.${stamp}@example.invalid`, ["SALES_REPRESENTATIVE"]);
    accountsId = await ensureUser(`security.accounts.${stamp}@example.invalid`, ["ACCOUNTS"]);
    tradeId = await ensureUser(`security.trade.${stamp}@example.invalid`, [], "TRADE");
    otherTradeId = await ensureUser(`security.other.${stamp}@example.invalid`, [], "TRADE");
    staffId = await ensureUser(`security.staff.${stamp}@example.invalid`, ["MARKETING"]);

    const company = await prisma.company.create({
      data: { name: `Security ${stamp}`, status: "ACTIVE" },
    });
    const other = await prisma.company.create({
      data: { name: `Security other ${stamp}`, status: "ACTIVE" },
    });
    companyId = company.id;
    otherCompanyId = other.id;
    await prisma.companyUser.create({
      data: { companyId, userId: tradeId, role: "TRADE_BUYER", status: "ACTIVE", isDefault: true },
    });
    await prisma.companyUser.create({
      data: {
        companyId: otherCompanyId,
        userId: otherTradeId,
        role: "TRADE_BUYER",
        status: "ACTIVE",
        isDefault: true,
      },
    });

    const batch = await prisma.autopartImportBatch.create({
      data: {
        kind: "INVOICE_LINES",
        status: "UPLOADED",
        filename: `${stamp}.csv`,
        fileHash: stamp,
        dryRun: true,
        createdById: adminId,
      },
    });
    batchId = batch.id;
    const account = await prisma.autopartAccount.create({
      data: {
        accountCode,
        originalName: `Security ${stamp}`,
        classification: "TRADE_CANDIDATE",
        companyId,
        portalEligible: false,
        historicalAccessEnabled: false,
      },
    });
    accountId = account.id;
    await prisma.autopartInvoiceLine.create({
      data: {
        sourceIdentity: `${stamp}-line`,
        accountCode,
        accountId,
        rawInvAndLn: `I/${stamp}/1`,
        documentReference: formulaRef,
        documentType: "INVOICE",
        partNumber: "PAD",
        description: "Pad",
        quantity: "1.000",
        salesAmount: "10.00",
        importBatchId: batchId,
        rawSource: { fixture: true },
      },
    });
    await prisma.autopartLedgerTransaction.create({
      data: {
        sourceIdentity: `${stamp}-ledger`,
        accountCode,
        accountId,
        rawType: "INV",
        ledgerKind: "INVOICE",
        reference: stamp,
        goodsAmount: "88.88",
        importBatchId: batchId,
        rawSource: { fixture: true },
      },
    });
    await prisma.autopartDocumentMatch.create({
      data: {
        accountCode,
        accountId,
        documentReference: formulaRef,
        documentType: "INVOICE",
        status: "MATCHED",
        lineCount: 1,
        lineSalesSum: "-12.50",
        ledgerGoods: "88.88",
        ledgerCount: 1,
      },
    });
  });

  afterAll(async () => {
    if (previousDir == null) delete process.env["AUTOPART_IMPORT_DIR"];
    else process.env["AUTOPART_IMPORT_DIR"] = previousDir;
    if (previousFlag == null) delete process.env["AUTOPART_PORTAL_HISTORY_ENABLED"];
    else process.env["AUTOPART_PORTAL_HISTORY_ENABLED"] = previousFlag;
    if (previousMax == null) delete process.env["AUTOPART_IMPORT_MAX_BYTES"];
    else process.env["AUTOPART_IMPORT_MAX_BYTES"] = previousMax;
    await prisma.autopartDocumentMatch.deleteMany({ where: { accountCode } });
    await prisma.autopartInvoiceLine.deleteMany({ where: { accountCode } });
    await prisma.autopartLedgerTransaction.deleteMany({ where: { accountCode } });
    await prisma.autopartAccount.deleteMany({ where: { accountCode } });
    await prisma.autopartImportBatch.deleteMany({ where: { id: batchId } });
    await prisma.companyUser.deleteMany({
      where: { companyId: { in: [companyId, otherCompanyId] } },
    });
    await prisma.company.deleteMany({ where: { id: { in: [companyId, otherCompanyId] } } });
    const userIds = [adminId, salesId, accountsId, tradeId, otherTradeId, staffId].filter(Boolean);
    await prisma.authSession.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.userRole.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await rm(dir, { recursive: true, force: true });
    await prisma.$disconnect();
  });

  it("denies the wrong role, another company, and unapproved history", async () => {
    await expect(listAutopartLedger(salesId, { accountCode })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    const accountsLedger = await listAutopartLedger(accountsId, { accountCode });
    expect(accountsLedger.items.some((item) => item.goodsAmount === "88.88")).toBe(true);

    const salesMatches = await listAutopartDocumentMatches(salesId, accountCode);
    expect(salesMatches.items[0]?.lineSalesSum).toBe("-12.50");
    expect(salesMatches.items[0]?.ledgerGoods).toBeNull();
    expect(salesMatches.items[0]?.ledgerCount).toBeNull();
    const accountsMatches = await listAutopartDocumentMatches(accountsId, accountCode);
    expect(accountsMatches.items[0]?.ledgerGoods).toBe("88.88");

    await expect(getCompanyWorkspace(otherTradeId, companyId)).rejects.toBeInstanceOf(AuthError);
    await expect(listCustomerPrices(tradeId, companyId)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(
      saveAutopartUpload({
        actorUserId: salesId,
        filename: "customers.txt",
        kind: "CUSTOMER_MASTER",
        body: textBody("not-imported\n"),
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      setAutopartHistoricalAccess(salesId, { accountId, enabled: true }),
    ).rejects.toBeInstanceOf(AuthError);

    const usersBefore = await prisma.user.count();
    process.env["AUTOPART_PORTAL_HISTORY_ENABLED"] = "true";
    const unapproved = await getPortalAutopartHistory(tradeId);
    expect(unapproved.enabled).toBe(true);
    expect(unapproved.total).toBe(0);

    const granted = await setAutopartHistoricalAccess(adminId, { accountId, enabled: true });
    expect(granted.historicalAccessEnabled).toBe(true);
    const account = await prisma.autopartAccount.findUniqueOrThrow({ where: { id: accountId } });
    expect(account.portalEligible).toBe(false);
    expect(await prisma.user.count()).toBe(usersBefore);

    process.env["AUTOPART_PORTAL_HISTORY_ENABLED"] = "false";
    const flagOff = await getPortalAutopartHistory(tradeId);
    expect(flagOff.enabled).toBe(false);
    expect(flagOff.total).toBe(0);

    process.env["AUTOPART_PORTAL_HISTORY_ENABLED"] = "true";
    const own = await getPortalAutopartHistory(tradeId);
    expect(own.total).toBe(1);
    expect(own.items.every((item) => item.accountCode === accountCode)).toBe(true);
    const foreign = await getPortalAutopartHistory(otherTradeId);
    expect(foreign.total).toBe(0);

    await setAutopartHistoricalAccess(adminId, { accountId, enabled: false });
    const revoked = await getPortalAutopartHistory(tradeId);
    expect(revoked.total).toBe(0);
  });

  it("neutralises formula text in the reconciliation export and keeps signed totals", async () => {
    let salesCsv = "";
    await writeAutopartReconciliationCsv(salesId, accountCode, (chunk) => {
      salesCsv += chunk;
    });
    expect(salesCsv).toContain("\"'=cmd|'/c calc'!A0\"");
    expect(salesCsv).toContain(",-12.50,");
    expect(salesCsv).not.toContain("88.88");

    let accountsCsv = "";
    await writeAutopartReconciliationCsv(accountsId, accountCode, (chunk) => {
      accountsCsv += chunk;
    });
    expect(accountsCsv).toContain("88.88");
    expect(accountsCsv).toContain(",-12.50,");
  });

  it("rejects invalid uploads and limits concurrent writes", async () => {
    await expect(
      saveAutopartUpload({
        actorUserId: adminId,
        filename: "../../secret.csv",
        kind: "CUSTOMER_MASTER",
        body: textBody("account\n"),
      }),
    ).rejects.toMatchObject({ code: "VALIDATION" });

    await expect(
      saveAutopartUpload({
        actorUserId: adminId,
        filename: "binary.csv",
        kind: "CUSTOMER_MASTER",
        body: textBody("a\0b"),
      }),
    ).rejects.toMatchObject({ code: "VALIDATION" });

    await expect(
      saveAutopartUpload({
        actorUserId: adminId,
        filename: "empty.csv",
        kind: "CUSTOMER_MASTER",
        body: textBody(""),
      }),
    ).rejects.toMatchObject({ code: "VALIDATION" });

    process.env["AUTOPART_IMPORT_MAX_BYTES"] = "1024";
    await expect(
      saveAutopartUpload({
        actorUserId: adminId,
        filename: "large.csv",
        kind: "CUSTOMER_MASTER",
        body: textBody("a".repeat(1100)),
      }),
    ).rejects.toMatchObject({ code: "VALIDATION" });
    delete process.env["AUTOPART_IMPORT_MAX_BYTES"];

    expect(await readdir(dir)).toEqual([]);

    const releases: Array<() => void> = [];
    function heldBody(): ReadableStream<Uint8Array> {
      let release!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      releases.push(release);
      return new ReadableStream({
        async start(controller) {
          controller.enqueue(new TextEncoder().encode("account,name\n1,Sample\n"));
          await gate;
          controller.close();
        },
      });
    }

    const first = saveAutopartUpload({
      actorUserId: adminId,
      filename: "one.csv",
      kind: "CUSTOMER_MASTER",
      body: heldBody(),
    });
    const second = saveAutopartUpload({
      actorUserId: adminId,
      filename: "two.csv",
      kind: "CUSTOMER_MASTER",
      body: heldBody(),
    });
    try {
      for (let attempt = 0; attempt < 50 && autopartUploadInFlight() < 2; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      expect(autopartUploadInFlight()).toBe(2);
      await expect(
        saveAutopartUpload({
          actorUserId: adminId,
          filename: "three.csv",
          kind: "CUSTOMER_MASTER",
          body: textBody("account,name\n1,Sample\n"),
        }),
      ).rejects.toMatchObject({ code: "RATE_LIMITED" });
    } finally {
      for (const release of releases) release();
    }
    const saved = await Promise.all([first, second]);
    expect(saved).toHaveLength(2);
    const batches = await prisma.autopartImportBatch.findMany({
      where: { id: { in: saved.map((row) => row.batchId) } },
    });
    expect(batches.every((batch) => batch.storagePath?.startsWith(dir))).toBe(true);
    expect(batches.every((batch) => !batch.storagePath?.includes("/public"))).toBe(true);
    await prisma.autopartImportBatch.deleteMany({
      where: { id: { in: saved.map((row) => row.batchId) } },
    });
    for (const batch of batches) {
      if (batch.storagePath) await rm(batch.storagePath, { force: true });
    }
  });

  it("rejects a disabled user and deletes sessions on deactivation", async () => {
    await prisma.authSession.create({
      data: {
        userId: staffId,
        token: `security-${stamp}`,
        expiresAt: new Date(Date.now() + 86_400_000),
      },
    });
    await prisma.user.update({ where: { id: staffId }, data: { status: "DISABLED" } });
    await expect(requireAuthenticatedUser(staffId)).rejects.toMatchObject({
      code: "UNAUTHENTICATED",
    });
    expect(await prisma.authSession.count({ where: { userId: staffId } })).toBe(1);

    await prisma.user.update({ where: { id: staffId }, data: { status: "ACTIVE" } });
    await deactivateStaffUser(adminId, { id: staffId });
    expect(await prisma.authSession.count({ where: { userId: staffId } })).toBe(0);
    await expect(requireAuthenticatedUser(staffId)).rejects.toMatchObject({
      code: "UNAUTHENTICATED",
    });
  });

  it("clamps historical list pages", async () => {
    const listed = await listAutopartInvoiceLines(salesId, { accountCode, page: 0 });
    expect(listed.page).toBe(1);
    const huge = await listAutopartInvoiceLines(salesId, { accountCode, page: 1_000_000_000 });
    expect(huge.page).toBe(10_000);
    expect(huge.items).toEqual([]);
  });
});
