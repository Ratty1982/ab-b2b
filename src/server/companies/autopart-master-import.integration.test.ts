import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { bootstrapRbac } from "../../../prisma/bootstrap/rbac";
import { AuthError } from "@/server/rbac/guards";
import {
  cancelAutopartImport,
  confirmAutopartImport,
  createCompanyForAutopartAccount,
  downloadAutopartInvoiceValidationReport,
  getAutopartImportBatch,
  getPortalAutopartHistory,
  linkAutopartAccountToCompany,
  listAutopartAccounts,
  listAutopartDocumentMatches,
  listAutopartLedger,
  previewAutopartImport,
  saveAutopartUpload,
  setAutopartHistoricalAccess,
} from "@/server/companies/autopart-master-import";

const prisma = new PrismaClient();
const stamp = `M${Date.now().toString(36).slice(-6).toUpperCase()}`;
const tradeCode = `${stamp}A`;
const otherCode = `${stamp}B`;

let adminId = "";
let salesId = "";
let accountsId = "";
let tradeId = "";
let otherTradeId = "";
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

function customerFile() {
  const name = `${stamp}NAME`.slice(0, 30);
  const row = (account: string, label: string, area = "1", rep = "4") =>
    `${account.padEnd(10).slice(0, 10)} ${label.padEnd(30).slice(0, 30)}${area.padEnd(5).slice(0, 5)}${rep}`;
  return [
    "CUSTOMER LIST FOR EXPORT (407EXP)",
    "Account    Name                          Area Rep",
    "---------------------------------------------------",
    row(tradeCode, name),
    row(otherCode, name),
    row(`${stamp}C`, "CASH CUSTOMER", "", ""),
    row(`${stamp}X`, "SAMPLE - DO NOT USE"),
  ].join("\n");
}

function invoiceFile() {
  return [
    ".Acct.,Inv & Ln,Part Number,Description,Units,Sales",
    `${tradeCode},I/SS${stamp}/1,PART-A,Pad,1,10.00`,
    `${tradeCode},I/SS${stamp}/2,PART-B,Pad,1,5.00`,
    `${tradeCode},I/SSBAD,PART-C,Pad,1,not-money`,
    `${otherCode},I/SS${stamp}B/1,PART-Z,Other,1,4.00`,
  ].join("\n");
}

function ledgerFile() {
  return [
    "A/C,Name,Sacct,Type,Ref,Date,Tot Goods,,Tot VAT,,Total,Run Bal",
    `${tradeCode},Sample,,INV,SS${stamp},06 Oct 14,15.00,,3.00,,18.00,18.00`,
    `${tradeCode},Sample,,CSH,PAY${stamp},06 Oct 14,-18.00,,0.00,,-18.00,0.00`,
  ].join("\n");
}

async function stage(
  kind: "CUSTOMER_MASTER" | "INVOICE_LINES" | "LEDGER",
  filename: string,
  text: string,
) {
  const filePath = path.join(dir, filename);
  await writeFile(filePath, text, "utf8");
  const batch = await prisma.autopartImportBatch.create({
    data: {
      kind,
      status: "UPLOADED",
      filename,
      fileHash: stamp + filename,
      storagePath: filePath,
      dryRun: true,
      createdById: adminId,
    },
  });
  return batch.id;
}

describe("Autopart customer master import", () => {
  beforeAll(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "autopart-master-"));
    process.env["AUTOPART_IMPORT_DIR"] = dir;
    process.env["AUTOPART_PORTAL_HISTORY_ENABLED"] = "false";
    await bootstrapRbac(prisma);
    adminId = await ensureUser(`autopart-master.admin.${stamp}@example.invalid`, ["SUPER_ADMIN"]);
    salesId = await ensureUser(`autopart-master.sales.${stamp}@example.invalid`, [
      "SALES_REPRESENTATIVE",
    ]);
    accountsId = await ensureUser(`autopart-master.accounts.${stamp}@example.invalid`, [
      "ACCOUNTS",
    ]);
    tradeId = await ensureUser(`autopart-master.trade.${stamp}@example.invalid`, [], "TRADE");
    otherTradeId = await ensureUser(`autopart-master.other.${stamp}@example.invalid`, [], "TRADE");
  });

  afterAll(async () => {
    if (previousDir == null) delete process.env["AUTOPART_IMPORT_DIR"];
    else process.env["AUTOPART_IMPORT_DIR"] = previousDir;
    if (previousFlag == null) delete process.env["AUTOPART_PORTAL_HISTORY_ENABLED"];
    else process.env["AUTOPART_PORTAL_HISTORY_ENABLED"] = previousFlag;
    await prisma.autopartDocumentMatch.deleteMany({
      where: { accountCode: { startsWith: stamp } },
    });
    await prisma.autopartInvoiceLine.deleteMany({ where: { accountCode: { startsWith: stamp } } });
    await prisma.autopartLedgerTransaction.deleteMany({
      where: { accountCode: { startsWith: stamp } },
    });
    await prisma.autopartAccount.deleteMany({ where: { accountCode: { startsWith: stamp } } });
    const companies = await prisma.company.findMany({
      where: { autopartCustomerCode: { startsWith: stamp } },
      select: { id: true },
    });
    const companyIds = companies.map((company) => company.id);
    if (companyIds.length) {
      await prisma.companyUser.deleteMany({ where: { companyId: { in: companyIds } } });
      await prisma.company.deleteMany({ where: { id: { in: companyIds } } });
    }
    await prisma.autopartImportBatch.deleteMany({
      where: { createdById: adminId, filename: { contains: stamp } },
    });
    await rm(dir, { recursive: true, force: true });
    await prisma.$disconnect();
  });

  async function commit(batchId: string) {
    const started = await confirmAutopartImport(adminId, batchId);
    expect(started.status).toBe("RUNNING");
    for (let attempt = 0; attempt < 80; attempt += 1) {
      const batch = await getAutopartImportBatch(adminId, batchId);
      if (
        batch.status === "COMMITTED" ||
        batch.status === "FAILED" ||
        batch.status === "CANCELLED"
      ) {
        return batch;
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error("Autopart import did not finish");
  }

  it("imports 407EXP without portal access, users, or orders, and is idempotent", async () => {
    const ordersBefore = await prisma.order.count();
    const usersBefore = await prisma.user.count();
    const batchId = await stage("CUSTOMER_MASTER", `${stamp}-407.txt`, customerFile());
    const preview = await previewAutopartImport(adminId, { batchId });
    expect(preview.status).toBe("PREVIEWED");
    expect(preview.dryRun).toBe(true);
    const committed = await commit(batchId);
    expect(committed.status).toBe("COMMITTED");
    const accounts = await prisma.autopartAccount.findMany({
      where: { accountCode: { in: [tradeCode, otherCode, `${stamp}X`] } },
    });
    expect(accounts).toHaveLength(3);
    expect(accounts.every((account) => account.portalEligible === false)).toBe(true);
    expect(accounts.every((account) => account.historicalAccessEnabled === false)).toBe(true);
    expect(accounts.every((account) => account.companyId == null)).toBe(true);
    expect(accounts.find((account) => account.accountCode === `${stamp}X`)?.classification).toBe(
      "DO_NOT_USE",
    );
    expect(await prisma.order.count()).toBe(ordersBefore);
    expect(await prisma.user.count()).toBe(usersBefore);

    const againId = await stage("CUSTOMER_MASTER", `${stamp}-407-again.txt`, customerFile());
    await previewAutopartImport(adminId, { batchId: againId });
    const second = await commit(againId);
    expect(second.updatedRows).toBeGreaterThan(0);
    expect(second.importedRows).toBe(0);
    expect(await prisma.autopartAccount.count({ where: { accountCode: tradeCode } })).toBe(1);
  });

  it("rejects trade and sales ledger access, and keeps history internal until granted", async () => {
    await expect(listAutopartAccounts(tradeId, {})).rejects.toBeInstanceOf(AuthError);
    await expect(listAutopartLedger(salesId, { accountCode: tradeCode })).rejects.toBeInstanceOf(
      AuthError,
    );
    const visible = await listAutopartAccounts(salesId, { q: tradeCode });
    expect(visible.items.some((item) => item.accountCode === tradeCode)).toBe(true);
    const ledger = await listAutopartLedger(accountsId, { accountCode: tradeCode });
    expect(ledger.balanceNote).toMatch(/not the current amount due/);

    const invoiceId = await stage("INVOICE_LINES", `${stamp}-561.csv`, invoiceFile());
    await previewAutopartImport(adminId, { batchId: invoiceId });
    const invoice = await commit(invoiceId);
    expect(invoice.status).toBe("COMMITTED");
    const ledgerId = await stage("LEDGER", `${stamp}-slrb.csv`, ledgerFile());
    await previewAutopartImport(adminId, { batchId: ledgerId });
    const ledgerBatch = await commit(ledgerId);
    expect(ledgerBatch.status).toBe("COMMITTED");

    const issues = await prisma.autopartImportIssue.count({
      where: { batchId: invoiceId, issueType: "INVALID_MONEY" },
    });
    expect(issues).toBe(1);
    expect(await prisma.autopartInvoiceLine.count({ where: { accountCode: tradeCode } })).toBe(2);
    const matches = await listAutopartDocumentMatches(adminId, tradeCode);
    expect(
      matches.items.some((item) => item.status === "MATCHED" && item.lineSalesSum === "15.00"),
    ).toBe(true);
    const payments = await prisma.autopartLedgerTransaction.findMany({
      where: { accountCode: tradeCode, ledgerKind: "PAYMENT" },
    });
    expect(payments).toHaveLength(1);

    const account = await prisma.autopartAccount.findUniqueOrThrow({
      where: { sourceSystem_accountCode: { sourceSystem: "AUTOPART", accountCode: tradeCode } },
    });
    const created = await createCompanyForAutopartAccount(adminId, account.id);
    const company = await prisma.company.findUniqueOrThrow({ where: { id: created.companyId } });
    expect(company.status).toBe("PROSPECT");
    expect(await prisma.companyUser.count({ where: { companyId: company.id } })).toBe(0);
    await expect(
      setAutopartHistoricalAccess(adminId, { accountId: account.id, enabled: true }),
    ).rejects.toBeInstanceOf(AuthError);

    await prisma.company.update({ where: { id: company.id }, data: { status: "ACTIVE" } });
    await prisma.companyUser.create({
      data: {
        companyId: company.id,
        userId: tradeId,
        role: "TRADE_BUYER",
        status: "ACTIVE",
        isDefault: true,
      },
    });
    const granted = await setAutopartHistoricalAccess(adminId, {
      accountId: account.id,
      enabled: true,
    });
    expect(granted.historicalAccessEnabled).toBe(true);
    expect(await prisma.user.count({ where: { id: tradeId } })).toBe(1);

    const hidden = await getPortalAutopartHistory(tradeId);
    expect(hidden.enabled).toBe(false);

    process.env["AUTOPART_PORTAL_HISTORY_ENABLED"] = "true";
    const own = await getPortalAutopartHistory(tradeId);
    expect(own.enabled).toBe(true);
    expect(own.items.every((item) => item.accountCode === tradeCode)).toBe(true);
    expect(own.total).toBe(2);

    const otherCompany = await prisma.company.create({
      data: { name: `Other ${stamp}`, status: "ACTIVE" },
    });
    await prisma.companyUser.create({
      data: {
        companyId: otherCompany.id,
        userId: otherTradeId,
        role: "TRADE_BUYER",
        status: "ACTIVE",
        isDefault: true,
      },
    });
    const foreign = await getPortalAutopartHistory(otherTradeId);
    expect(foreign.total).toBe(0);

    await setAutopartHistoricalAccess(adminId, { accountId: account.id, enabled: false });
    const revoked = await getPortalAutopartHistory(tradeId);
    expect(revoked.total).toBe(0);

    const other = await prisma.autopartAccount.findUniqueOrThrow({
      where: { sourceSystem_accountCode: { sourceSystem: "AUTOPART", accountCode: otherCode } },
    });
    const linked = await linkAutopartAccountToCompany(adminId, {
      accountId: other.id,
      companyId: company.id,
    });
    expect(linked.historicalAccessEnabled).toBe(false);
    await prisma.company.delete({ where: { id: otherCompany.id } });
  });

  it("stores an upload outside the public tree and can cancel before commit", async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(customerFile()));
        controller.close();
      },
    });
    const saved = await saveAutopartUpload({
      actorUserId: adminId,
      filename: `${stamp}-upload.txt`,
      kind: "CUSTOMER_MASTER",
      body,
    });
    const batch = await prisma.autopartImportBatch.findUniqueOrThrow({
      where: { id: saved.batchId },
    });
    expect(batch.storagePath?.includes("public")).toBe(false);
    expect(batch.dryRun).toBe(true);
    const bytes = await readFile(batch.storagePath!);
    expect(bytes.length).toBeGreaterThan(10);
    const cancelled = await cancelAutopartImport(adminId, saved.batchId);
    expect(cancelled.cancelled).toBe(true);
  });

  it("validates a complete 561L file against the 407EXP master without writing invoice lines", async () => {
    const code = `${stamp}V`;
    const unknown = `${stamp}U`;
    const name = `${stamp}VAL`.slice(0, 30);
    const master = [
      "CUSTOMER LIST FOR EXPORT (407EXP)",
      "Account    Name                          Area Rep",
      "---------------------------------------------------",
      `${code.padEnd(10).slice(0, 10)} ${name.padEnd(30).slice(0, 30)}1    4`,
    ].join("\n");
    const masterId = await stage("CUSTOMER_MASTER", `${stamp}-val-407.txt`, master);
    const previewedMaster = await previewAutopartImport(adminId, { batchId: masterId });
    expect(previewedMaster.status).toBe("PREVIEWED");
    const committed = await commit(masterId);
    expect(committed.status).toBe("COMMITTED");
    const linesBefore = await prisma.autopartInvoiceLine.count({
      where: { accountCode: { in: [code, unknown] } },
    });
    const invoice = [
      ".Acct.,Inv & Ln,Part Number,Description,Units,Sales",
      `${code},I/SS1/1,PART-A,Pad,1,10.00`,
      `${code},C/SC1/1,PART-C,Credit,-1,-2.50`,
      `${code},I/SS1/2,PART-Z,Zero,1,0.00`,
      `${code},I/SS1/1,PART-B,Same invoice,1,4.00`,
      `"${code}","I/SS2/1","SWUX14","14" Phoenix","1","24.99"`,
      `${unknown},I/SS9/1,"=HYPERLINK(""http://evil"")",Formula,1,3.00`,
      `${code},,PART-R,Missing ref,1,2.00`,
      `,I/SS8/1,PART-M,Missing,1,1.00`,
      `${code},I/SS7/1,PART-X,Bad,1,not-money`,
      `${code},I/SS6/1,PART,Pad,2,1,10.00`,
    ].join("\n");
    const invoiceId = await stage("INVOICE_LINES", `${stamp}-val-561.csv`, invoice);
    const preview = await previewAutopartImport(adminId, { batchId: invoiceId });
    expect(preview.dryRun).toBe(true);
    expect(preview.status).toBe("PREVIEWED");
    expect(
      await prisma.autopartInvoiceLine.count({ where: { accountCode: { in: [code, unknown] } } }),
    ).toBe(linesBefore);
    const diagnostics = preview.diagnostics as {
      acceptedSales?: string;
      financialValidation?: {
        netSales: string;
        positiveSales: string;
        negativeSales: string;
        zeroCount: number;
        matchedLines: number;
        unmatchedLines: number;
        distinctUnmatchedAccounts: number;
        unmatchedSales: string;
        nameMatching: string;
        recoveredLines: number;
        preservedSeparateLines: number;
        checks: { id: string; outcome: string }[];
      };
    };
    const report = diagnostics.financialValidation;
    expect(report).toBeTruthy();
    if (!report) return;
    expect(report.netSales).toBe("41.49");
    expect(diagnostics.acceptedSales).toBe(report.netSales);
    expect(report.positiveSales).toBe("43.99");
    expect(report.negativeSales).toBe("-2.50");
    expect(report.zeroCount).toBe(1);
    expect(report.matchedLines).toBe(6);
    expect(report.unmatchedLines).toBe(1);
    expect(report.distinctUnmatchedAccounts).toBe(1);
    expect(report.unmatchedSales).toBe("3.00");
    expect(report.nameMatching).toBe("never");
    expect(report.recoveredLines).toBe(1);
    expect(report.preservedSeparateLines).toBe(1);
    const outcome = (id: string) => report.checks.find((item) => item.id === id)?.outcome;
    expect(outcome("signed_net_sales")).toBe("PASS");
    expect(outcome("recovered_fields")).toBe("PASS");
    expect(outcome("no_merged_lines")).toBe("PASS");
    expect(outcome("account_master_match")).toBe("WARNING");
    expect(outcome("missing_account_codes")).toBe("FAIL");
    expect(outcome("missing_invoice_references")).toBe("FAIL");
    expect(outcome("invalid_numeric_amounts")).toBe("FAIL");
    expect(outcome("ambiguous_recovered")).toBe("FAIL");
    expect(outcome("unexpected_duplicate_identities")).toBe("PASS");
    const stored = await prisma.autopartAccount.findUniqueOrThrow({
      where: { sourceSystem_accountCode: { sourceSystem: "AUTOPART", accountCode: code } },
    });
    expect(stored.companyId).toBeNull();
    expect(stored.portalEligible).toBe(false);
    const csv = await downloadAutopartInvoiceValidationReport(adminId, invoiceId);
    expect(csv.filename).toBe("561l-preimport-validation.csv");
    expect(csv.csv).toContain("summary,signed_net_sales,PASS,,,,,,41.49,");
    expect(csv.csv).toContain('"\'=HYPERLINK(""http://evil"")"');
    expect(csv.csv).not.toContain(",=HYPERLINK");
    await expect(
      downloadAutopartInvoiceValidationReport(salesId, invoiceId),
    ).rejects.toBeInstanceOf(AuthError);
    const afterDownload = await prisma.autopartInvoiceLine.count({
      where: { accountCode: { in: [code, unknown] } },
    });
    expect(afterDownload).toBe(linesBefore);
  });
});
