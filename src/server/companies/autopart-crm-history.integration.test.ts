import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { bootstrapRbac } from "../../../prisma/bootstrap/rbac";
import { AuthError } from "@/server/rbac/guards";
import {
  listCompanyAutopartInvoiceLines,
  purchaseDataStatus,
} from "@/server/companies/autopart-internal-history";
import {
  confirmAutopartImport,
  createCompanyForAutopartAccount,
  getAutopartHistoricalSummary,
  getAutopartImportBatch,
  getCompanyAutopartMaster,
  getPortalAutopartHistory,
  linkAutopartAccountToCompany,
  listAutopartLedger,
  previewAutopartImport,
  setAutopartHistoricalAccess,
} from "@/server/companies/autopart-master-import";

const prisma = new PrismaClient();
const stamp = `C${Date.now().toString(36).slice(-6).toUpperCase()}`;
const primaryCode = `${stamp}A`;
const secondCode = `${stamp}B`;
const foreignCode = `${stamp}Z`;

let adminId = "";
let salesId = "";
let managementId = "";
let salesRepId = "";
let prospectId = "";
let otherCompanyId = "";
let codeOnlyCompanyId = "";
let batchId = "";
let dir = "";
const previousDir = process.env["AUTOPART_IMPORT_DIR"];
const previousFlag = process.env["AUTOPART_PORTAL_HISTORY_ENABLED"];

async function ensureUser(
  email: string,
  roles: string[],
  actorType: "INTERNAL" | "TRADE" = "INTERNAL",
) {
  let user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    user = await prisma.user.create({
      data: { email, name: email.split("@")[0]!, status: "ACTIVE", actorType, emailVerified: true },
    });
  }
  for (const key of roles) {
    const role = await prisma.role.findUniqueOrThrow({ where: { key } });
    await prisma.userRole.upsert({
      where: { userId_roleId: { userId: user.id, roleId: role.id } },
      create: { userId: user.id, roleId: role.id },
      update: {},
    });
  }
  return user.id;
}

describe("internal CRM Autopart history", () => {
  beforeAll(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "autopart-crm-history-"));
    process.env["AUTOPART_IMPORT_DIR"] = dir;
    process.env["AUTOPART_PORTAL_HISTORY_ENABLED"] = "false";
    await bootstrapRbac(prisma);
    adminId = await ensureUser(`crm-hist.admin.${stamp}@example.invalid`, ["SUPER_ADMIN"]);
    salesId = await ensureUser(`crm-hist.sales.${stamp}@example.invalid`, ["SALES_REPRESENTATIVE"]);
    managementId = await ensureUser(`crm-hist.mgmt.${stamp}@example.invalid`, ["MANAGEMENT"]);

    const batch = await prisma.autopartImportBatch.create({
      data: {
        kind: "INVOICE_LINES",
        status: "COMMITTED",
        filename: `${stamp}-561.csv`,
        fileHash: stamp,
        dryRun: false,
        importedRows: 5,
        updatedRows: 0,
        validRows: 5,
        completedAt: new Date("2024-06-01T12:00:00.000Z"),
        createdById: adminId,
      },
    });
    batchId = batch.id;

    await prisma.autopartAccount.createMany({
      data: [
        {
          accountCode: primaryCode,
          originalName: `GSF CARPARTS ${stamp}`,
          classification: "TRADE_CANDIDATE",
          portalEligible: false,
          historicalAccessEnabled: false,
          lastImportBatchId: batchId,
        },
        {
          accountCode: secondCode,
          originalName: `SECOND ${stamp}`,
          classification: "TRADE_CANDIDATE",
          portalEligible: false,
          historicalAccessEnabled: false,
          lastImportBatchId: batchId,
        },
        {
          accountCode: foreignCode,
          originalName: `FOREIGN ${stamp}`,
          classification: "TRADE_CANDIDATE",
          portalEligible: false,
          historicalAccessEnabled: false,
          lastImportBatchId: batchId,
        },
      ],
    });

    const lines = [
      line(primaryCode, "INV1", "INVOICE", "P1", "2.000", "10.00", "I/INV1/1"),
      line(primaryCode, "INV1", "INVOICE", "P2", "1.000", "5.50", "I/INV1/2"),
      line(primaryCode, "CR1", "CREDIT", "P1", "-1.000", "-3.00", "C/CR1/1"),
      line(primaryCode, "INV1", "INVOICE", "P4", "0.000", "0.00", "I/INV1/3"),
      line(secondCode, "INV2", "INVOICE", "P3", "4.000", "7.25", "I/INV2/1"),
      line(foreignCode, "INV9", "INVOICE", "PX", "1.000", "100.00", "I/INV9/1"),
    ];
    await prisma.autopartInvoiceLine.createMany({ data: lines });
    await prisma.autopartLedgerTransaction.create({
      data: {
        sourceIdentity: `${stamp}-ledger-pay`,
        accountCode: primaryCode,
        rawType: "CSH",
        ledgerKind: "PAYMENT",
        reference: `PAY${stamp}`,
        goodsAmount: "-19.75",
        vatAmount: "0.00",
        totalAmount: "-19.75",
        runningBalance: "0.00",
        importBatchId: batchId,
        rawSource: {},
      },
    });

    const primary = await prisma.autopartAccount.findUniqueOrThrow({
      where: { sourceSystem_accountCode: { sourceSystem: "AUTOPART", accountCode: primaryCode } },
    });
    const created = await createCompanyForAutopartAccount(adminId, primary.id);
    prospectId = created.companyId;
    const second = await prisma.autopartAccount.findUniqueOrThrow({
      where: { sourceSystem_accountCode: { sourceSystem: "AUTOPART", accountCode: secondCode } },
    });
    await linkAutopartAccountToCompany(adminId, {
      accountId: second.id,
      companyId: prospectId,
    });

    const other = await prisma.company.create({
      data: { name: `Other ${stamp}`, status: "ACTIVE" },
    });
    otherCompanyId = other.id;
    const codeOnly = await prisma.company.create({
      data: {
        name: `Code only ${stamp}`,
        status: "PROSPECT",
        autopartCustomerCode: foreignCode,
      },
    });
    codeOnlyCompanyId = codeOnly.id;

    await prisma.autopartSalesLine.create({
      data: {
        companyId: prospectId,
        autopartCustomerCode: primaryCode,
        documentType: "INVOICE",
        documentReference: `LEG${stamp}`,
        lineNumber: 1,
        sku: "LEGACY",
        units: "1.000",
        salesNet: "1.00",
        source: "561L",
      },
    });
    await prisma.order.create({
      data: {
        orderNumber: `ORD-${stamp}`,
        companyId: prospectId,
        subtotal: "999.99",
        vatTotal: "0.00",
        grandTotal: "999.99",
      },
    });

    const rep = await prisma.salesRep.create({
      data: { userId: salesId, code: `R${stamp}`.slice(0, 12), active: true },
    });
    salesRepId = rep.id;
    await prisma.companyAssignment.create({
      data: { companyId: prospectId, salesRepId, isPrimary: true },
    });
  });

  afterAll(async () => {
    if (previousDir == null) delete process.env["AUTOPART_IMPORT_DIR"];
    else process.env["AUTOPART_IMPORT_DIR"] = previousDir;
    if (previousFlag == null) delete process.env["AUTOPART_PORTAL_HISTORY_ENABLED"];
    else process.env["AUTOPART_PORTAL_HISTORY_ENABLED"] = previousFlag;
    await prisma.order.deleteMany({ where: { orderNumber: `ORD-${stamp}` } });
    await prisma.companyAssignment.deleteMany({ where: { salesRepId } });
    if (salesRepId) await prisma.salesRep.deleteMany({ where: { id: salesRepId } });
    await prisma.autopartSalesLine.deleteMany({
      where: { autopartCustomerCode: { startsWith: stamp } },
    });
    await prisma.autopartLedgerTransaction.deleteMany({
      where: { accountCode: { startsWith: stamp } },
    });
    await prisma.autopartInvoiceLine.deleteMany({ where: { accountCode: { startsWith: stamp } } });
    await prisma.autopartAccount.deleteMany({ where: { accountCode: { startsWith: stamp } } });
    const companies = await prisma.company.findMany({
      where: {
        OR: [
          { id: { in: [prospectId, otherCompanyId, codeOnlyCompanyId].filter(Boolean) } },
          { autopartCustomerCode: { startsWith: stamp } },
          { name: { contains: stamp } },
        ],
      },
      select: { id: true },
    });
    const companyIds = companies.map((company) => company.id);
    if (companyIds.length) {
      await prisma.companyUser.deleteMany({ where: { companyId: { in: companyIds } } });
      await prisma.company.deleteMany({ where: { id: { in: companyIds } } });
    }
    await prisma.autopartImportBatch.deleteMany({
      where: { OR: [{ id: batchId }, { filename: { contains: stamp } }] },
    });
    await rm(dir, { recursive: true, force: true });
    await prisma.$disconnect();
  });

  it("shows global history for a prospect without enabling portal access", async () => {
    const company = await prisma.company.findUniqueOrThrow({ where: { id: prospectId } });
    expect(company.status).toBe("PROSPECT");
    expect(company.autopartCustomerCode).toBe(primaryCode);
    const accounts = await prisma.autopartAccount.findMany({
      where: { companyId: prospectId },
      orderBy: { accountCode: "asc" },
    });
    expect(accounts.map((account) => account.accountCode)).toEqual([primaryCode, secondCode]);
    expect(accounts.every((account) => account.historicalAccessEnabled === false)).toBe(true);
    expect(accounts.every((account) => account.portalEligible === false)).toBe(true);
    expect(await prisma.autopartInvoiceLine.count({ where: { accountCode: primaryCode } })).toBe(4);

    const master = await getCompanyAutopartMaster(adminId, prospectId);
    expect(master.lineCount).toBe(5);
    expect(master.ledgerCount).toBe(1);
    expect(master.source).toBe("GLOBAL_AUTOPART_IMPORT");
    expect(master.portalHistoricalAccess).toBe(false);

    await expect(
      setAutopartHistoricalAccess(adminId, { accountId: accounts[0]!.id, enabled: true }),
    ).rejects.toBeInstanceOf(AuthError);
    expect(
      (await prisma.autopartAccount.findUniqueOrThrow({ where: { id: accounts[0]!.id } }))
        .historicalAccessEnabled,
    ).toBe(false);
    const tradeId = await ensureUser(`crm-hist.trade.${stamp}@example.invalid`, [], "TRADE");
    await prisma.companyUser.create({
      data: {
        companyId: prospectId,
        userId: tradeId,
        role: "TRADE_BUYER",
        status: "ACTIVE",
        isDefault: true,
      },
    });
    await expect(
      setAutopartHistoricalAccess(adminId, { accountId: accounts[0]!.id, enabled: true }),
    ).rejects.toBeInstanceOf(AuthError);
    const portalOff = await getPortalAutopartHistory(tradeId);
    expect(portalOff.enabled).toBe(false);
    process.env["AUTOPART_PORTAL_HISTORY_ENABLED"] = "true";
    const portalOn = await getPortalAutopartHistory(tradeId);
    expect(portalOn.enabled).toBe(false);
    expect(portalOn.total).toBe(0);
    process.env["AUTOPART_PORTAL_HISTORY_ENABLED"] = "false";

    const lines = await listCompanyAutopartInvoiceLines(adminId, {
      companyId: prospectId,
      q: "P3",
    });
    expect(lines.total).toBe(1);
    expect(lines.items[0]?.accountCode).toBe(secondCode);
    expect(lines.items[0]?.purchaseDate).toBeNull();
    const hidden = await listCompanyAutopartInvoiceLines(adminId, {
      companyId: prospectId,
      q: "PX",
    });
    expect(hidden.total).toBe(0);
  });

  it("keeps unlinked and unrelated companies empty and blocks sales ledger values", async () => {
    const unrelated = await getCompanyAutopartMaster(adminId, otherCompanyId);
    expect(unrelated.lineCount).toBe(0);
    expect(unrelated.mappingStatus).toBe("UNLINKED");

    const codeOnly = await getCompanyAutopartMaster(adminId, codeOnlyCompanyId);
    expect(codeOnly.lineCount).toBe(0);

    const salesHistory = await getCompanyAutopartMaster(salesId, prospectId);
    expect(salesHistory.lineCount).toBe(5);
    expect(salesHistory.ledgerCount).toBeNull();
    await expect(listAutopartLedger(salesId, { accountCode: primaryCode })).rejects.toBeInstanceOf(
      AuthError,
    );
    await expect(getCompanyAutopartMaster(salesId, otherCompanyId)).rejects.toBeInstanceOf(AuthError);

    const management = await getCompanyAutopartMaster(managementId, prospectId);
    expect(management.ledgerCount).toBe(1);
    const ledger = await listAutopartLedger(managementId, { accountCode: primaryCode });
    expect(ledger.balanceNote).toMatch(/not the current amount due/);
    expect(ledger.items.some((item) => item.runningBalance === "0.00")).toBe(true);
    expect(ledger.items.some((item) => item.ledgerKind === "PAYMENT")).toBe(true);

    const salesMaster = await getCompanyAutopartMaster(salesId, prospectId);
    expect(salesMaster.lineCount).toBe(5);
    expect(salesMaster.ledgerCount).toBeNull();
  });

  it("explains committed invoice rows that update an existing source identity", async () => {
    expect(purchaseDataStatus({ restricted: false, globalLines: 5, legacyLines: 0 })).toBe(
      "GLOBAL",
    );
    expect(purchaseDataStatus({ restricted: false, globalLines: 0, legacyLines: 0 })).toBe(
      "NOT_IMPORTED",
    );
    const summary = await getAutopartHistoricalSummary(adminId);
    expect(summary.committedInvoiceRows).toBe(
      summary.importedInvoiceRows + summary.updatedInvoiceRows,
    );
    expect(summary.countNote).toMatch(/source identity/);
    expect(summary.invoiceLines).toBeGreaterThanOrEqual(5);

    const account = `${stamp}Q`;
    const header = ".Acct.,Inv & Ln,Part Number,Description,Units,Sales";
    const first = `${account},I/GAP${stamp}/1,PART-A,Pad,1,10.00`;
    const rows = [header, first];
    for (let index = 2; index <= 200; index += 1) {
      rows.push(`${account},I/GAP${stamp}/${index},PART-A,Pad,1,1.00`);
    }
    rows.push(first);
    const filename = `${stamp}-gap.csv`;
    const filePath = path.join(dir, filename);
    await writeFile(filePath, rows.join("\n"), "utf8");
    const staged = await prisma.autopartImportBatch.create({
      data: {
        kind: "INVOICE_LINES",
        status: "UPLOADED",
        filename,
        fileHash: createHash("sha256").update(rows.join("\n")).digest("hex"),
        storagePath: filePath,
        dryRun: true,
        createdById: adminId,
      },
    });
    await expect(previewAutopartImport(adminId, { batchId: staged.id })).rejects.toMatchObject({
      code: "HISTORICAL_IMPORT_RETIRED",
    });
    await expect(confirmAutopartImport(adminId, staged.id)).rejects.toMatchObject({
      code: "HISTORICAL_IMPORT_RETIRED",
    });
    expect(await prisma.autopartInvoiceLine.count({ where: { accountCode: account } })).toBe(0);
  });
});

function line(
  accountCode: string,
  documentReference: string,
  documentType: string,
  partNumber: string,
  quantity: string,
  salesAmount: string,
  rawInvAndLn: string,
) {
  return {
    sourceIdentity: `${stamp}-${accountCode}-${rawInvAndLn}-${partNumber}`,
    accountCode,
    rawInvAndLn,
    documentReference,
    documentType,
    partNumber,
    description: partNumber,
    quantity,
    salesAmount,
    salesMeasure: "NET_EX_VAT",
    importBatchId: batchId,
    rawSource: {},
  };
}
