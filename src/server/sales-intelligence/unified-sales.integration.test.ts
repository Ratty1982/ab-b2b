/**
 * Unified customer sales enquiry — synthetic fixtures only.
 * Proves identity, reconciliation, certification, date filters, scope and Customer 360 agreement.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { bootstrapRbac } from "../../../prisma/bootstrap/rbac";
import {
  exportUnifiedCustomerSalesCsv,
  getUnifiedCustomerSales,
  getUnifiedProductSales,
  getUnifiedReconciliationQueue,
  listUnifiedCustomerProducts,
  listUnifiedCustomerTransactions,
  loadUnifiedCustomerSummary,
  loadUnifiedFinancialCertification,
} from "@/server/sales-intelligence/unified-sales";
import { getCompanyCrmWorkspace } from "@/server/crm/customer";
import { getCompanyAutopartHistoryWorkspace } from "@/server/companies/autopart-history";
import { confirmAutopartTrm21qcImport } from "@/server/companies/autopart-ongoing-sales";
import { previewSalesIntelligenceFollowUp } from "@/server/sales-intelligence/followup";

const prisma = new PrismaClient();
const stamp = `US${Date.now().toString(36).slice(-6).toUpperCase()}`;
const skuA = `US-A-${stamp}`;
const skuB = `US-B-${stamp}`;
const skuC = `US-C-${stamp}`;
const codeP1 = `${stamp}P1`;
const codeP2 = `${stamp}P2`;
const codeQ = `${stamp}Q`;
const codeT = `${stamp}T`;
const codeShared = `${stamp}X`;
const ref = (name: string) => `${stamp}${name}`;

let adminId = "";
let repUserId = "";
let tradeId = "";
let repId = "";
let batchId = "";
let prospectId = "";
let cleanId = "";
let feedProspectId = "";
let otherId = "";
let gsfId = "";
let twinAId = "";
let twinBId = "";
let pennyId = "";
const codeGsf = `${stamp}G`;
const codeTwinA = `${stamp}A`;
const codeTwinB = `${stamp}B`;
const codePenny = `${stamp}Y`;
const codeOrphan = `${stamp}Z`;
const skuBrake = `US-BRK-${stamp}`;
const skuPad = `US-PAD-${stamp}`;
const skuFilter = `US-FLT-${stamp}`;
const skuOil = `US-OIL-${stamp}`;
const skuBelt = `US-BLT-${stamp}`;
let identity = 0;

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

async function historical(input: {
  accountCode: string;
  inv: string;
  type: "INVOICE" | "CREDIT" | "UNKNOWN";
  ref: string | null;
  sku: string;
  qty: string;
  sales: string;
}) {
  identity += 1;
  await prisma.autopartInvoiceLine.create({
    data: {
      sourceIdentity: `${stamp}-${identity}`,
      accountCode: input.accountCode,
      rawInvAndLn: input.inv,
      documentReference: input.ref,
      documentType: input.type,
      partNumber: input.sku,
      description: `Synthetic ${input.sku}`,
      quantity: input.qty,
      salesAmount: input.sales,
      salesMeasure: "NET_EX_VAT",
      importBatchId: batchId,
      rawSource: { synthetic: true },
    },
  });
}

async function dated(input: {
  companyId: string | null;
  code: string;
  type: "INVOICE" | "CREDIT";
  ref: string;
  date: string | null;
  source: "561L" | "ONGOING_TRM21QC";
  lines: Array<{ sku: string; qty: string; net: string }>;
}) {
  const document = await prisma.autopartSalesDocument.create({
    data: {
      companyId: input.companyId,
      autopartCustomerCode: input.code,
      documentType: input.type,
      documentReference: input.ref,
      documentDate: input.date ? new Date(`${input.date}T12:00:00.000Z`) : null,
      source: input.source,
      hasTrm21qc: input.source === "ONGOING_TRM21QC",
    },
  });
  let lineNumber = 0;
  for (const line of input.lines) {
    lineNumber += 1;
    await prisma.autopartSalesLine.create({
      data: {
        companyId: input.companyId,
        documentId: document.id,
        autopartCustomerCode: input.code,
        documentType: input.type,
        documentReference: input.ref,
        lineNumber,
        sku: line.sku,
        descriptionSnapshot: `Synthetic ${line.sku}`,
        units: line.qty,
        salesNet: line.net,
        source: input.source,
      },
    });
  }
}

async function account(accountCode: string, companyId: string | null) {
  await prisma.autopartAccount.create({
    data: {
      accountCode,
      originalName: `Synthetic ${accountCode}`,
      classification: "TRADE_CANDIDATE",
      companyId,
    },
  });
}

beforeAll(async () => {
  await bootstrapRbac(prisma);
  adminId = await ensureUser(`us.admin.${stamp}@example.invalid`, ["SUPER_ADMIN"]);
  repUserId = await ensureUser(`us.rep.${stamp}@example.invalid`, ["SALES_REPRESENTATIVE"]);
  tradeId = await ensureUser(`us.trade.${stamp}@example.invalid`, [], "TRADE");
  const rep = await prisma.salesRep.create({
    data: { userId: repUserId, code: `US-${stamp}`, displayName: `Rep ${stamp}`, active: true },
  });
  repId = rep.id;

  prospectId = (
    await prisma.company.create({ data: { name: `US Prospect ${stamp}`, status: "PROSPECT" } })
  ).id;
  cleanId = (await prisma.company.create({ data: { name: `US Clean ${stamp}`, status: "ACTIVE" } }))
    .id;
  feedProspectId = (
    await prisma.company.create({ data: { name: `US Feed ${stamp}`, status: "PROSPECT" } })
  ).id;
  otherId = (
    await prisma.company.create({ data: { name: `US Other ${stamp}`, status: "SUSPENDED" } })
  ).id;
  await prisma.companyAssignment.create({
    data: { companyId: prospectId, salesRepId: repId, isPrimary: true },
  });

  batchId = (
    await prisma.autopartImportBatch.create({
      data: {
        kind: "INVOICE_LINES",
        status: "COMMITTED",
        filename: `us-${stamp}.csv`,
        fileHash: `us-${stamp}`,
        dryRun: false,
        createdById: adminId,
        completedAt: new Date(),
      },
    })
  ).id;

  await account(codeP1, prospectId);
  await account(codeP2, prospectId);
  await account(codeQ, cleanId);
  await account(codeT, feedProspectId);
  await account(codeShared, prospectId);
  await prisma.autopartCustomerAccountAlias.create({
    data: { companyId: otherId, alias: codeShared, verifiedById: adminId },
  });

  // Prospect: historical only (two codes), a raw-positive 561L credit, and a repeated identical row.
  await historical({
    accountCode: codeP1,
    inv: `I/${ref("I1")}/1`,
    type: "INVOICE",
    ref: ref("I1"),
    sku: skuA,
    qty: "2",
    sales: "20.00",
  });
  await historical({
    accountCode: codeP1,
    inv: `I/${ref("I1")}/2`,
    type: "INVOICE",
    ref: ref("I1"),
    sku: skuB,
    qty: "1",
    sales: "5.00",
  });
  await historical({
    accountCode: codeP2,
    inv: `I/${ref("I2")}/1`,
    type: "INVOICE",
    ref: ref("I2"),
    sku: skuA,
    qty: "1",
    sales: "10.00",
  });
  await historical({
    accountCode: codeP1,
    inv: `C/${ref("C1")}/1`,
    type: "CREDIT",
    ref: ref("C1"),
    sku: skuB,
    qty: "1",
    sales: "4.00",
  });
  await historical({
    accountCode: codeP1,
    inv: `I/${ref("I5")}/1`,
    type: "INVOICE",
    ref: ref("I5"),
    sku: skuC,
    qty: "1",
    sales: "7.00",
  });
  await historical({
    accountCode: codeP1,
    inv: `I/${ref("I5")}/1`,
    type: "INVOICE",
    ref: ref("I5"),
    sku: skuC,
    qty: "1",
    sales: "7.00",
  });
  // Same invoice in 561L history and the dated feed, two distinct lines sharing the reference.
  await historical({
    accountCode: codeP1,
    inv: `I/${ref("I3")}/1`,
    type: "INVOICE",
    ref: ref("I3"),
    sku: skuA,
    qty: "1",
    sales: "10.00",
  });
  await historical({
    accountCode: codeP1,
    inv: `I/${ref("I3")}/2`,
    type: "INVOICE",
    ref: ref("I3"),
    sku: skuA,
    qty: "1",
    sales: "10.00",
  });
  await dated({
    companyId: prospectId,
    code: codeP1,
    type: "INVOICE",
    ref: ref("I3"),
    date: "2026-08-01",
    source: "ONGOING_TRM21QC",
    lines: [
      { sku: skuA, qty: "1", net: "10.00" },
      { sku: skuA, qty: "1", net: "10.00" },
    ],
  });
  // Same reference in both sources but the lines disagree: held back from certified totals.
  await historical({
    accountCode: codeP1,
    inv: `I/${ref("I4")}/1`,
    type: "INVOICE",
    ref: ref("I4"),
    sku: skuB,
    qty: "3",
    sales: "15.00",
  });
  await dated({
    companyId: prospectId,
    code: codeP1,
    type: "INVOICE",
    ref: ref("I4"),
    date: "2026-08-10",
    source: "ONGOING_TRM21QC",
    lines: [{ sku: skuB, qty: "3", net: "16.00" }],
  });
  // New dated invoice and credit, plus a feed line still waiting for a company but on a linked code.
  await dated({
    companyId: prospectId,
    code: codeP1,
    type: "INVOICE",
    ref: ref("N1"),
    date: "2026-09-01",
    source: "ONGOING_TRM21QC",
    lines: [{ sku: skuA, qty: "1", net: "11.00" }],
  });
  await dated({
    companyId: prospectId,
    code: codeP1,
    type: "CREDIT",
    ref: ref("N2"),
    date: "2026-09-15",
    source: "ONGOING_TRM21QC",
    lines: [{ sku: skuA, qty: "-1", net: "-11.00" }],
  });
  await dated({
    companyId: null,
    code: codeP2,
    type: "INVOICE",
    ref: ref("N3"),
    date: "2026-09-20",
    source: "ONGOING_TRM21QC",
    lines: [{ sku: skuB, qty: "2", net: "9.00" }],
  });
  // Shared code: linked to two companies, so it attaches to neither.
  await historical({
    accountCode: codeShared,
    inv: `I/${ref("X1")}/1`,
    type: "INVOICE",
    ref: ref("X1"),
    sku: skuA,
    qty: "1",
    sales: "9999999.99",
  });

  // Clean company: one overlap that reconciles fully, and one company 561L + TRM overlap.
  await historical({
    accountCode: codeQ,
    inv: `I/${ref("Q1")}/1`,
    type: "INVOICE",
    ref: ref("Q1"),
    sku: skuA,
    qty: "4",
    sales: "40.00",
  });
  await dated({
    companyId: cleanId,
    code: codeQ,
    type: "INVOICE",
    ref: ref("Q1"),
    date: "2026-07-01",
    source: "561L",
    lines: [{ sku: skuA, qty: "4", net: "40.00" }],
  });
  await historical({
    accountCode: codeQ,
    inv: `I/${ref("Q2")}/1`,
    type: "INVOICE",
    ref: ref("Q2"),
    sku: skuB,
    qty: "1",
    sales: "6.00",
  });

  // Feed prospect: 561L history only, new sales arrive through the TRM21QC import below.
  await historical({
    accountCode: codeT,
    inv: `I/${ref("T1")}/1`,
    type: "INVOICE",
    ref: ref("T1"),
    sku: skuA,
    qty: "3",
    sales: "30.00",
  });

  gsfId = (
    await prisma.company.create({
      data: { name: `GSF CARPARTS ${stamp}`, status: "ACTIVE", accountNumber: `GSF-${stamp}` },
    })
  ).id;
  twinAId = (
    await prisma.company.create({ data: { name: `US Twin A ${stamp}`, status: "ACTIVE" } })
  ).id;
  twinBId = (
    await prisma.company.create({ data: { name: `US Twin B ${stamp}`, status: "PROSPECT" } })
  ).id;
  pennyId = (
    await prisma.company.create({ data: { name: `US Penny ${stamp}`, status: "ACTIVE" } })
  ).id;
  await account(codeGsf, gsfId);
  await account(codeTwinA, twinAId);
  await account(codeTwinB, twinBId);
  await account(codePenny, pennyId);

  await historical({
    accountCode: codeGsf,
    inv: `I/${ref("H1")}/1`,
    type: "INVOICE",
    ref: ref("H1"),
    sku: skuBrake,
    qty: "2",
    sales: "20.00",
  });
  await historical({
    accountCode: codeGsf,
    inv: `I/${ref("H1")}/2`,
    type: "INVOICE",
    ref: ref("H1"),
    sku: skuPad,
    qty: "1",
    sales: "8.00",
  });
  await historical({
    accountCode: codeGsf,
    inv: `I/${ref("H2")}/1`,
    type: "INVOICE",
    ref: ref("H2"),
    sku: skuFilter,
    qty: "1",
    sales: "6.00",
  });
  await historical({
    accountCode: codeGsf,
    inv: `I/${ref("H2")}/1`,
    type: "INVOICE",
    ref: ref("H2"),
    sku: skuFilter,
    qty: "1",
    sales: "6.00",
  });
  await historical({
    accountCode: codeGsf,
    inv: `I/${ref("MISS")}/1`,
    type: "INVOICE",
    ref: null,
    sku: skuBelt,
    qty: "1",
    sales: "3.00",
  });
  await historical({
    accountCode: codeGsf,
    inv: `I/${ref("UNK")}/1`,
    type: "UNKNOWN",
    ref: ref("UNK"),
    sku: skuBelt,
    qty: "1",
    sales: "2.50",
  });
  await historical({
    accountCode: codeGsf,
    inv: `I/${ref("Q")}/1`,
    type: "INVOICE",
    ref: ref("Q"),
    sku: skuBelt,
    qty: "1",
    sales: "5.00",
  });
  await historical({
    accountCode: codeGsf,
    inv: `I/${ref("Q")}/1`,
    type: "INVOICE",
    ref: ref("Q"),
    sku: skuBelt,
    qty: "2",
    sales: "9.00",
  });
  await historical({
    accountCode: codeGsf,
    inv: `I/${ref("O")}/1`,
    type: "INVOICE",
    ref: ref("O"),
    sku: skuOil,
    qty: "1",
    sales: "12.00",
  });
  await dated({
    companyId: gsfId,
    code: codeGsf,
    type: "INVOICE",
    ref: ref("O"),
    date: "2026-09-01",
    source: "ONGOING_TRM21QC",
    lines: [{ sku: skuOil, qty: "1", net: "12.00" }],
  });
  await prisma.autopartSalesDocument.updateMany({
    where: { companyId: gsfId, documentReference: ref("O") },
    data: { has504: true, goodsNet: "12.00", hasTrm21qc: true },
  });
  await historical({
    accountCode: codeGsf,
    inv: `I/${ref("M")}/1`,
    type: "INVOICE",
    ref: ref("M"),
    sku: skuOil,
    qty: "1",
    sales: "10.00",
  });
  await dated({
    companyId: gsfId,
    code: codeGsf,
    type: "INVOICE",
    ref: ref("M"),
    date: "2026-08-01",
    source: "ONGOING_TRM21QC",
    lines: [{ sku: skuOil, qty: "1", net: "10.00" }],
  });
  await prisma.autopartSalesDocument.updateMany({
    where: { companyId: gsfId, documentReference: ref("M") },
    data: { has504: true, goodsNet: "99.00", hasTrm21qc: true },
  });
  await dated({
    companyId: gsfId,
    code: codeGsf,
    type: "INVOICE",
    ref: ref("N"),
    date: "2026-10-01",
    source: "ONGOING_TRM21QC",
    lines: [{ sku: skuBrake, qty: "1", net: "15.00" }],
  });
  await dated({
    companyId: gsfId,
    code: codeGsf,
    type: "CREDIT",
    ref: ref("C"),
    date: "2026-10-02",
    source: "ONGOING_TRM21QC",
    lines: [{ sku: skuBrake, qty: "-1", net: "-4.00" }],
  });
  await prisma.autopartSalesDocument.create({
    data: {
      companyId: gsfId,
      autopartCustomerCode: codeGsf,
      documentType: "INVOICE",
      documentReference: ref("H504"),
      documentDate: new Date("2026-09-05T12:00:00.000Z"),
      source: "ONGOING_504",
      has504: true,
      goodsNet: "25.00",
      reconciliationStatus: "AWAITING_LINES",
    },
  });

  await historical({
    accountCode: codePenny,
    inv: `I/${ref("P")}/1`,
    type: "INVOICE",
    ref: ref("P"),
    sku: skuOil,
    qty: "1",
    sales: "12.00",
  });
  await dated({
    companyId: pennyId,
    code: codePenny,
    type: "INVOICE",
    ref: ref("P"),
    date: "2026-07-15",
    source: "ONGOING_TRM21QC",
    lines: [{ sku: skuOil, qty: "1", net: "12.00" }],
  });
  await prisma.autopartSalesDocument.updateMany({
    where: { companyId: pennyId, documentReference: ref("P") },
    data: { has504: true, goodsNet: "12.01", hasTrm21qc: true },
  });

  await historical({
    accountCode: codeTwinA,
    inv: `I/${ref("SAME")}/1`,
    type: "INVOICE",
    ref: ref("SAME"),
    sku: skuBrake,
    qty: "1",
    sales: "10.00",
  });
  await historical({
    accountCode: codeTwinB,
    inv: `I/${ref("SAME")}/1`,
    type: "INVOICE",
    ref: ref("SAME"),
    sku: skuBrake,
    qty: "4",
    sales: "40.00",
  });
  await historical({
    accountCode: codeOrphan,
    inv: `I/${ref("ORPH")}/1`,
    type: "INVOICE",
    ref: ref("ORPH"),
    sku: skuBrake,
    qty: "1",
    sales: "123.45",
  });
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("unified customer sales", () => {
  it("shows a prospect's full history with separate subtotals and an incomplete status", async () => {
    const result = await getUnifiedCustomerSales(adminId, { companyId: prospectId });
    const s = result.summary;
    expect(result.company.status).toBe("PROSPECT");
    expect(s.historicalSales).toBe("42.00");
    expect(s.historicalNet).toBe("38.00");
    expect(s.datedInvoicedSales).toBe("40.00");
    expect(s.creditsAndAdjustments).toBe("-15.00");
    expect(s.datedNet).toBe("29.00");
    expect(s.certifiedNet).toBe("67.00");
    expect(s.certification).toBe("INCOMPLETE");
    expect(s.combinedNet).toBeNull();
    expect(s.unreconciledLines).toBe(3);
    expect(s.unreconciledHistoricalNet).toBe("22.00");
    expect(s.unreconciledDatedNet).toBe("16.00");
    expect(s.suppressedDuplicateLines).toBe(2);
    expect(s.suppressedDuplicateNet).toBe("20.00");
    expect(s.invoiceCount).toBe(6);
    expect(s.creditNoteCount).toBe(2);
    expect(s.lastDatedInvoice).toBe("2026-09-20");
    expect(result.company.salesperson?.id).toBe(repId);
  });

  it("lists every verified code and holds back a code linked to two companies", async () => {
    const result = await getUnifiedCustomerSales(adminId, { companyId: prospectId });
    const byCode = new Map(result.identity.map((entry) => [entry.code, entry]));
    expect(byCode.get(codeP1)?.attached).toBe(true);
    expect(byCode.get(codeP2)?.attached).toBe(true);
    expect(byCode.get(codeShared)?.attached).toBe(false);
    const other = await getUnifiedCustomerSales(adminId, { companyId: otherId });
    expect(other.summary.lineCount).toBe(0);
    const queue = await getUnifiedReconciliationQueue(adminId, { page: 1, pageSize: 100 });
    expect(queue.permitted).toBe(true);
    if (queue.permitted) {
      const shared = queue.items.find((item) => item.code === codeShared);
      expect(shared?.linkedCompanies).toBe(2);
      expect(shared?.net).toBe("9999999.99");
    }
  });

  it("keeps totals unchanged when a prospect becomes active", async () => {
    const before = await loadUnifiedCustomerSummary(prospectId);
    await prisma.company.update({ where: { id: prospectId }, data: { status: "ACTIVE" } });
    const after = await loadUnifiedCustomerSummary(prospectId);
    await prisma.company.update({ where: { id: prospectId }, data: { status: "PROSPECT" } });
    expect(after.summary).toEqual(before.summary);
  });

  it("counts a matched invoice once and keeps both distinct lines that share its reference", async () => {
    const tx = await listUnifiedCustomerTransactions(adminId, {
      companyId: prospectId,
      q: ref("I3"),
      status: "ALL",
    });
    const counted = tx.items.filter((item) => item.counted);
    const suppressed = tx.items.filter((item) => item.status === "DUPLICATE");
    expect(counted).toHaveLength(2);
    expect(
      counted.every((item) => item.source === "TRM21QC_FEED" && item.status === "MATCHED"),
    ).toBe(true);
    expect(suppressed).toHaveLength(2);
    expect(suppressed.every((item) => item.source === "HISTORICAL_561L")).toBe(true);
    expect(tx.filteredCountedNet).toBe("20.00");
  });

  it("reports an overlap that does not agree and a repeated 561L row for reconciliation", async () => {
    const tx = await listUnifiedCustomerTransactions(adminId, {
      companyId: prospectId,
      status: "UNRECONCILED",
    });
    const reasons = tx.items.map((item) => `${item.reference}:${item.reason}`).sort();
    expect(reasons).toEqual(
      [
        `${ref("I4")}:CONFLICTING_OVERLAP`,
        `${ref("I4")}:CONFLICTING_OVERLAP`,
        `${ref("I5")}:REPEATED_SOURCE_ROW`,
      ].sort(),
    );
  });

  it("states a combined total when every overlap reconciles", async () => {
    const result = await getUnifiedCustomerSales(adminId, { companyId: cleanId });
    expect(result.summary.certification).toBe("COMPLETE");
    expect(result.summary.combinedNet).toBe("46.00");
    expect(result.summary.suppressedDuplicateLines).toBe(1);
  });

  it("shows undated 561L rows as date unavailable and keeps them out of date ranges", async () => {
    const all = await listUnifiedCustomerTransactions(adminId, {
      companyId: prospectId,
      pageSize: 100,
    });
    const undated = all.items.filter((item) => item.date == null);
    expect(undated.length).toBeGreaterThan(0);
    expect(undated.every((item) => item.dateLabel === "Date unavailable")).toBe(true);
    const ranged = await listUnifiedCustomerTransactions(adminId, {
      companyId: prospectId,
      from: "2026-01-01",
      to: "2026-12-31",
      pageSize: 100,
    });
    expect(ranged.items.length).toBeGreaterThan(0);
    expect(ranged.items.every((item) => item.date != null)).toBe(true);
    const contradiction = await listUnifiedCustomerTransactions(adminId, {
      companyId: prospectId,
      dating: "UNDATED",
      from: "2026-01-01",
    });
    expect(contradiction.total).toBe(0);
    const credits = await listUnifiedCustomerTransactions(adminId, {
      companyId: prospectId,
      type: "CREDIT",
    });
    expect(credits.items.every((item) => Number(item.net) < 0)).toBe(true);
    const second = await listUnifiedCustomerTransactions(adminId, {
      companyId: prospectId,
      accountCode: codeP2,
    });
    expect(second.items.length).toBe(2);
  });

  it("summarises products with confirmed dates only from dated rows", async () => {
    const products = await listUnifiedCustomerProducts(adminId, {
      companyId: prospectId,
      pageSize: 50,
    });
    const a = products.items.find((item) => item.sku.toUpperCase() === skuA.toUpperCase());
    expect(a?.netSales).toBe("50.00");
    expect(a?.latestConfirmedDate).toBe("2026-09-01");
    const c = products.items.find((item) => item.sku.toUpperCase() === skuC.toUpperCase());
    expect(c?.latestConfirmedDate).toBeNull();
    expect(c?.unreconciledLines).toBe(1);
    const csv = await exportUnifiedCustomerSalesCsv(adminId, {
      kind: "transactions",
      companyId: prospectId,
    });
    expect(csv.truncated).toBe(false);
    expect(csv.csv).toContain("Date unavailable");
  });

  it("lists authorised customers for a product and respects salesperson scope", async () => {
    const admin = await getUnifiedProductSales(adminId, { sku: skuA, pageSize: 100 });
    const prospect = admin.customers.items.find((item) => item.companyId === prospectId);
    expect(prospect?.status).toBe("PROSPECT");
    expect(prospect?.netSales).toBe("50.00");
    expect(prospect?.salespersonName).toBe(`Rep ${stamp}`);
    expect(prospect?.lastDatedPurchase).toBe("2026-09-01");
    expect(admin.customers.items.some((item) => item.companyId === cleanId)).toBe(true);

    const rep = await getUnifiedProductSales(repUserId, { sku: skuA, pageSize: 100 });
    expect(rep.customers.items.map((item) => item.companyId)).toEqual([prospectId]);
    await expect(getUnifiedCustomerSales(repUserId, { companyId: cleanId })).rejects.toMatchObject({
      code: "COMPANY_FORBIDDEN",
    });
    await expect(getUnifiedCustomerSales(tradeId, { companyId: prospectId })).rejects.toBeTruthy();
    const queue = await getUnifiedReconciliationQueue(repUserId, {});
    expect(queue.permitted).toBe(false);
  });

  it("gives Customer 360 the same figures as Sales Enquiry", async () => {
    const enquiry = await getUnifiedCustomerSales(adminId, { companyId: prospectId });
    const crm = await getCompanyCrmWorkspace(adminId, { companyId: prospectId });
    expect(crm.unifiedSales.summary).toEqual(enquiry.summary);
    expect(crm.snapshot.historicNetSales).toBe(enquiry.summary.certifiedNet);
    const admin = await getCompanyAutopartHistoryWorkspace(adminId, prospectId);
    expect(admin.unifiedSales?.summary).toEqual(enquiry.summary);
    const followUp = await previewSalesIntelligenceFollowUp(adminId, {
      sourceModule: "SALES_ENQUIRY",
      sourceReason: "CUSTOMER",
      companyId: prospectId,
      historySource: "unified",
    });
    expect(JSON.stringify(followUp)).toContain("67.00");
  });

  it("attaches new feed invoices and credits to a prospect once, without activating it", async () => {
    const before = await loadUnifiedCustomerSummary(feedProspectId);
    expect(before.summary.historicalNet).toBe("30.00");
    expect(before.summary.datedNet).toBe("0.00");

    const invoiceDoc = `SSU${stamp.slice(-6)}`;
    const creditDoc = `SCU${stamp.slice(-6)}`;
    const invoiceText = `Cust,Group,Document,Date,Part Number,Description,Qty,Sales,Cost,Margin,Perc%
${codeT},GRP,${invoiceDoc},02/10/2026,${skuA},Synthetic,2,24.00,12.00,12.00,50.000
`;
    await confirmAutopartTrm21qcImport(adminId, {
      text: invoiceText,
      filename: "trm-invoice.csv",
      source: "MANUAL",
    });
    const afterInvoice = await loadUnifiedCustomerSummary(feedProspectId);
    expect(afterInvoice.summary.datedInvoicedSales).toBe("24.00");
    expect(afterInvoice.summary.certifiedNet).toBe("54.00");
    expect(afterInvoice.summary.lastDatedInvoice).toBe("2026-10-02");
    expect(afterInvoice.refresh.ongoingTrm21qcAt).not.toBeNull();
    const stored = await prisma.autopartSalesLine.findMany({
      where: { documentReference: invoiceDoc },
    });
    expect(stored.map((line) => line.companyId)).toEqual([feedProspectId]);

    const creditText = `Cust,Group,Document,Date,Part Number,Description,Qty,Sales,Cost,Margin,Perc%
${codeT},GRP,${creditDoc},03/10/2026,${skuA},Synthetic,-1,-12.00,-6.00,-6.00,50.000
`;
    await confirmAutopartTrm21qcImport(adminId, {
      text: creditText,
      filename: "trm-credit.csv",
      source: "MANUAL",
    });
    const afterCredit = await loadUnifiedCustomerSummary(feedProspectId);
    expect(afterCredit.summary.creditsAndAdjustments).toBe("-12.00");
    expect(afterCredit.summary.certifiedNet).toBe("42.00");
    const creditRows = await listUnifiedCustomerTransactions(adminId, {
      companyId: feedProspectId,
      type: "CREDIT",
    });
    expect(creditRows.items[0]?.reference).toBe(creditDoc);
    expect(creditRows.items[0]?.date).toBe("2026-10-03");

    await confirmAutopartTrm21qcImport(adminId, {
      text: invoiceText,
      filename: "trm-invoice-again.csv",
      source: "MANUAL",
    });
    await confirmAutopartTrm21qcImport(adminId, {
      text: creditText,
      filename: "trm-credit-again.csv",
      source: "MANUAL",
    });
    const replayed = await loadUnifiedCustomerSummary(feedProspectId);
    expect(replayed.summary).toEqual(afterCredit.summary);

    const company = await prisma.company.findUniqueOrThrow({ where: { id: feedProspectId } });
    expect(company.status).toBe("PROSPECT");
    const linked = await prisma.autopartAccount.findFirstOrThrow({ where: { accountCode: codeT } });
    expect(linked.portalEligible).toBe(false);
    expect(linked.historicalAccessEnabled).toBe(false);
  });

  it("keeps a GSF-style history intact across undated lines, a new invoice, a credit and 504 headers", async () => {
    const result = await getUnifiedCustomerSales(adminId, { companyId: gsfId });
    const s = result.summary;
    expect(result.company.name).toContain("GSF CARPARTS");
    expect(result.company.status).toBe("ACTIVE");
    expect(s.historicalSales).toBe("48.00");
    expect(s.datedInvoicedSales).toBe("27.00");
    expect(s.creditsAndAdjustments).toBe("-4.00");
    expect(s.certifiedNet).toBe("71.00");
    expect(s.certification).toBe("INCOMPLETE");
    expect(s.combinedNet).toBeNull();
    expect(s.suppressedDuplicateLines).toBe(1);
    expect(s.suppressedDuplicateNet).toBe("12.00");
    expect(s.unreconciledHistoricalNet).toBe("21.50");
    expect(s.unreconciledDatedNet).toBe("35.00");
    expect(s.lastDatedInvoice).toBe("2026-10-01");

    const products = await listUnifiedCustomerProducts(adminId, { companyId: gsfId, pageSize: 50 });
    const brake = products.items.find((item) => item.sku.toUpperCase() === skuBrake.toUpperCase());
    expect(brake?.netSales).toBe("31.00");
    expect(brake?.latestConfirmedDate).toBe("2026-10-01");

    const overlap = await listUnifiedCustomerTransactions(adminId, {
      companyId: gsfId,
      q: ref("O"),
      status: "ALL",
    });
    expect(overlap.items.filter((item) => item.counted)).toHaveLength(1);
    expect(overlap.items.find((item) => item.counted)?.net).toBe("12.00");
    expect(overlap.items.some((item) => item.source === "ONGOING_504" && item.reference === ref("O"))).toBe(
      false,
    );

    const separate = await listUnifiedCustomerTransactions(adminId, {
      companyId: gsfId,
      q: ref("Q"),
      status: "ALL",
    });
    expect(separate.items.filter((item) => item.counted)).toHaveLength(2);
    expect(separate.items.some((item) => item.reason === "REPEATED_SOURCE_ROW")).toBe(false);

    const held = await listUnifiedCustomerTransactions(adminId, {
      companyId: gsfId,
      status: "UNRECONCILED",
      pageSize: 50,
    });
    const reasons = held.items.map((item) => item.reason).sort();
    expect(reasons).toEqual(
      [
        "DOCUMENT_GOODS_MISMATCH",
        "DOCUMENT_GOODS_MISMATCH",
        "DOCUMENT_GOODS_MISMATCH",
        "NO_DOCUMENT_REFERENCE",
        "REPEATED_SOURCE_ROW",
        "UNKNOWN_DOCUMENT_TYPE",
      ].sort(),
    );
    expect(held.items.find((item) => item.reference === ref("H504"))?.net).toBe("25.00");
    expect(held.items.every((item) => item.net !== "99.00")).toBe(true);

    const credits = await listUnifiedCustomerTransactions(adminId, {
      companyId: gsfId,
      type: "CREDIT",
    });
    expect(credits.items.map((item) => item.net)).toEqual(["-4.00"]);

    const followUp = await previewSalesIntelligenceFollowUp(adminId, {
      sourceModule: "SALES_ENQUIRY",
      sourceReason: "CUSTOMER",
      companyId: gsfId,
      historySource: "unified",
    });
    expect(JSON.stringify(followUp)).toContain("Incomplete — certified 71.00");
    expect(JSON.stringify(followUp)).not.toContain("99.00");
    expect(JSON.stringify(followUp)).not.toContain("25.00");

    const report = await loadUnifiedFinancialCertification(gsfId);
    expect(report.linesExamined).toBe(14);
    expect(report.certifiedNet).toBe("71.00");
    expect(report.rawAttachedNet).toBe("114.50");
    expect(report.duplicateNet).toBe("12.00");
    expect(report.repeatedRowsExcluded).toBe(1);
    expect(report.repeatedNetExcluded).toBe("6.00");
    expect(report.unknownTypeLines).toBe(1);
    expect(report.unknownTypeNet).toBe("2.50");
    expect(report.missingReferenceLines).toBe(1);
    expect(report.missingReferenceNet).toBe("3.00");
    expect(report.headerOnlyDocuments).toBe(1);
    expect(report.headerOnlyNet).toBe("25.00");
    expect(report.unexplainedDiscrepancy).toBe("0.00");
    expect(report.discrepancyNote).toBeNull();
    expect(report.occurrenceLimitation).toMatch(/200-row/);
  });

  it("treats a 1p 504 difference as agreement and does not add the header", async () => {
    const result = await getUnifiedCustomerSales(adminId, { companyId: pennyId });
    expect(result.summary.certification).toBe("COMPLETE");
    expect(result.summary.combinedNet).toBe("12.00");
    expect(result.summary.suppressedDuplicateNet).toBe("12.00");
    expect(result.summary.certifiedNet).toBe("12.00");
  });

  it("does not combine the same invoice reference across two customers", async () => {
    const a = await getUnifiedCustomerSales(adminId, { companyId: twinAId });
    const b = await getUnifiedCustomerSales(adminId, { companyId: twinBId });
    expect(a.summary.certifiedNet).toBe("10.00");
    expect(a.summary.certification).toBe("COMPLETE");
    expect(b.summary.certifiedNet).toBe("40.00");
    expect(b.summary.certification).toBe("COMPLETE");
    expect(b.company.status).toBe("PROSPECT");
  });

  it("leaves an unmatched account on the reconciliation queue", async () => {
    const queue = await getUnifiedReconciliationQueue(adminId, { page: 1, pageSize: 100 });
    expect(queue.permitted).toBe(true);
    if (!queue.permitted) return;
    const orphan = queue.items.find((item) => item.code === codeOrphan);
    expect(orphan?.net).toBe("123.45");
    expect(orphan?.linkedCompanies).toBe(0);
    const gsf = await getUnifiedCustomerSales(adminId, { companyId: gsfId });
    expect(gsf.summary.certifiedNet).toBe("71.00");
  });
});
