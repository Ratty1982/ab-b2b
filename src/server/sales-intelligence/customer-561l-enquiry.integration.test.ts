/**
 * LMS-style per-customer 561L/SLRB history must appear in Sales Enquiry.
 * The retired global AutopartInvoiceLine table is not a source.
 */
import "@/server/testing/use-protect-integration-database";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { bootstrapRbac } from "../../../prisma/bootstrap/rbac";
import { ALL_DATED_HISTORY_QUERY_RANGE } from "@/domain/sales-history-period";
import { linkAndVerifyCompanyAutopartCustomerCode } from "@/server/companies/autopart-account";
import { confirmAutopartTrm21qcImport } from "@/server/companies/autopart-ongoing-sales";
import {
  completeCustomerSalesCutoverWithoutHistory,
  confirmCustomerSalesHistory,
  listStoredCustomerSalesHistory,
  previewCustomerSalesHistory,
} from "@/server/companies/customer-sales-history-import";
import { getCustomerSalesEnquiry } from "@/server/sales-intelligence/enquiry";
import { loadHistoricSalesLines } from "@/server/sales-intelligence/historic-lines";
import {
  getUnifiedCustomerSales,
  listUnifiedCustomerProducts,
  listUnifiedCustomerTransactions,
} from "@/server/sales-intelligence/unified-sales";
import { AuthError } from "@/server/rbac/guards";

const prisma = new PrismaClient();
const stamp = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const code = `LM${stamp.slice(0, 8).toUpperCase()}`;

let adminId = "";
let companyId = "";
const extraCompanyIds: string[] = [];

function historyFiles() {
  const lines = `Acct.,Inv & Ln,Part Number,Description,Units,Sales
${code},I/INV1/1,SS,Steel Seal,2,"£20.00"
${code},I/INV1/2,PAD,Pads,1,"£5.00"
${code},I/UNDATED/1,BELT,Belt,1,"£7.00"
${code},C/CR1/1,SS,Steel Seal,1,"£4.00"
${code},I/INV2/1,OIL,Oil,1,"£10.00"
${code},I/INV3/1,FILTER,Filter,1,"£8.00"
${code},I/DUP1/1,SS,Steel Seal,1,"£6.00"
`;
  const ledger = `A/C,Type,Ref,Date,Tot Goods,Tot VAT,Total,Run Bal
${code},INV,INV1,01 Oct 26,"£25.00","£5.00","£30.00","£30.00"
${code},CRN,CR1,02 Oct 26,"-£4.00","-£0.80","-£4.80","£25.20"
${code},PAY,PAY1,03 Oct 26,"£0.00","£0.00","-£10.00","£15.20"
${code},INV,INV2,04 Oct 26,"£99.00","£19.80","£118.80","£134.00"
${code},INV,INV3,05 Oct 26,"£8.00","£1.60","£9.60","£143.60"
${code},INV,DUP1,06 Oct 26,"£6.00","£1.20","£7.20","£150.80"
`;
  return { lines, ledger };
}

beforeAll(async () => {
  await bootstrapRbac(prisma);
  const user = await prisma.user.create({
    data: {
      email: `lms.${stamp}@example.invalid`,
      name: "LMS enquiry",
      status: "ACTIVE",
      actorType: "INTERNAL",
      emailVerified: true,
    },
  });
  const role = await prisma.role.findUniqueOrThrow({ where: { key: "SUPER_ADMIN" } });
  await prisma.userRole.create({ data: { userId: user.id, roleId: role.id } });
  adminId = user.id;
  const company = await prisma.company.create({
    data: { name: `LMS Redditch ${stamp}`, status: "ACTIVE" },
  });
  companyId = company.id;
  await linkAndVerifyCompanyAutopartCustomerCode(adminId, { companyId, code });
});

afterAll(async () => {
  const ids = [companyId, ...extraCompanyIds].filter(Boolean);
  if (ids.length) {
    await prisma.autopartSalesLine.deleteMany({ where: { companyId: { in: ids } } });
    await prisma.autopartSalesDocument.deleteMany({ where: { companyId: { in: ids } } });
    await prisma.customerSalesCutover.deleteMany({ where: { companyId: { in: ids } } });
    await prisma.autopartImportDiagnostic.deleteMany({ where: { companyId: { in: ids } } });
    await prisma.autopartCustomerImportRun.deleteMany({ where: { companyId: { in: ids } } });
    await prisma.company.deleteMany({ where: { id: { in: ids } } });
  }
  await prisma.$disconnect();
});

describe("imported 561L history in Sales Enquiry", () => {
  it("counts LMS-style history once, keeps payments out, and leaves undated lines without a date", async () => {
    const { lines, ledger } = historyFiles();
    const proposed = await previewCustomerSalesHistory(adminId, {
      companyId,
      text561l: lines,
      textSlrb: ledger,
      filename561l: "561L.csv",
      filenameSlrb: "SLRB.csv",
    });
    expect(proposed.message).toMatch(/proposed changes/i);
    expect(proposed.counts.import).toBeGreaterThan(0);
    expect(proposed.counts.ledger).toBe(1);

    const imported = await confirmCustomerSalesHistory(adminId, {
      companyId,
      text561l: lines,
      textSlrb: ledger,
    });
    expect(imported.historyStatus).toBe("COMPLETE");
    expect(imported.rowsImported).toBeGreaterThan(0);

    const stored = await listStoredCustomerSalesHistory(adminId, companyId);
    expect(stored.kind).toBe("stored");
    expect(stored.productLines).toBe(7);
    expect(stored.paymentDocuments).toBe(1);
    expect(stored.undatedProductLines).toBe(1);
    expect(stored.rows.find((row) => row.document === "UNDATED")?.date).toBeNull();
    expect(stored.rows.find((row) => row.document === "INV1" && row.sku === "SS")?.date).toBe("2026-10-01");
    expect(Number(stored.productNet)).toBe(52);

    const again = await confirmCustomerSalesHistory(adminId, {
      companyId,
      text561l: lines,
      textSlrb: ledger,
    });
    expect(again.rowsImported).toBe(0);
    expect(await prisma.autopartSalesLine.count({ where: { companyId, source: "561L" } })).toBe(7);

    const ongoing = `Cust,Group,Document,Date,Part Number,Description,Qty,Sales,Cost,Margin,Perc%
${code},GRP,INV1,01/10/2026,SS,Steel Seal,2,20.00,8.00,12.00,60.000
${code},GRP,INV1,01/10/2026,PAD,Pads,1,5.00,2.00,3.00,60.000
${code},GRP,NEW1,20/10/2026,ROTOR,Rotor,1,11.00,4.00,7.00,60.000
`;
    const trm = await confirmAutopartTrm21qcImport(adminId, {
      text: ongoing,
      filename: "TRM21QC.csv",
      source: "MANUAL",
    });
    expect(trm.rowsImported).toBe(1);
    expect(
      await prisma.autopartSalesLine.count({
        where: { companyId, documentReference: "INV1", source: "ONGOING_TRM21QC" },
      }),
    ).toBe(0);

    const duplicate = await prisma.autopartSalesDocument.findFirstOrThrow({
      where: { companyId, documentReference: "DUP1" },
    });
    await prisma.autopartSalesLine.create({
      data: {
        companyId,
        documentId: duplicate.id,
        autopartCustomerCode: code,
        documentType: "INVOICE",
        documentReference: "DUP1",
        lineNumber: 9,
        sku: "SS",
        units: "1",
        salesNet: "6.00",
        source: "ONGOING_TRM21QC",
      },
    });
    const conflict = await prisma.autopartSalesDocument.findFirstOrThrow({
      where: { companyId, documentReference: "INV3" },
    });
    await prisma.autopartSalesLine.create({
      data: {
        companyId,
        documentId: conflict.id,
        autopartCustomerCode: code,
        documentType: "INVOICE",
        documentReference: "INV3",
        lineNumber: 9,
        sku: "FILTER",
        units: "1",
        salesNet: "9.00",
        source: "ONGOING_TRM21QC",
      },
    });

    expect(await prisma.autopartInvoiceLine.count({ where: { accountCode: code } })).toBe(0);

    const lifetime = await getUnifiedCustomerSales(adminId, { companyId, period: "ALL" });
    expect(lifetime.kpis.netSales).toBe("55.00");
    expect(lifetime.period.includesUndatedHistory).toBe(true);
    const october = await getUnifiedCustomerSales(adminId, {
      companyId,
      period: "CUSTOM",
      from: "2026-10-01",
      to: "2026-10-31",
    });
    expect(october.kpis.netSales).toBe("48.00");
    expect(october.period.includesUndatedHistory).toBe(false);

    const allTransactions = await listUnifiedCustomerTransactions(adminId, {
      companyId,
      status: "COUNTED",
      pageSize: 50,
    });
    expect(allTransactions.filteredCountedNet).toBe("55.00");
    expect(allTransactions.items.some((item) => item.reference === "UNDATED" && item.date == null)).toBe(true);
    expect(allTransactions.items.some((item) => item.reference === "PAY1")).toBe(false);
    expect(allTransactions.items.filter((item) => item.reference === "DUP1")).toHaveLength(1);
    expect(allTransactions.items.find((item) => item.reference === "DUP1")?.source).toBe("TRM21QC_FEED");
    expect(allTransactions.items.some((item) => item.reference === "INV3")).toBe(false);

    const ranged = await listUnifiedCustomerTransactions(adminId, {
      companyId,
      scope: "PERIOD",
      from: "2026-10-01",
      to: "2026-10-31",
      status: "COUNTED",
      pageSize: 50,
    });
    expect(ranged.filteredCountedNet).toBe("48.00");
    expect(ranged.items.every((item) => item.date != null)).toBe(true);
    expect(ranged.items.some((item) => item.reference === "UNDATED")).toBe(false);

    const products = await listUnifiedCustomerProducts(adminId, { companyId, pageSize: 50 });
    const netBySku = new Map(products.items.map((item) => [item.sku.toUpperCase(), item.netSales]));
    expect(netBySku.get("SS")).toBe("22.00");
    expect(netBySku.get("BELT")).toBe("7.00");
    expect(netBySku.get("OIL")).toBe("10.00");
    expect(netBySku.get("ROTOR")).toBe("11.00");
    expect(netBySku.has("FILTER")).toBe(false);
    const productNet = products.items.reduce((sum, item) => sum + Number(item.netSales), 0);
    expect(productNet).toBe(55);

    const enquiry = await getCustomerSalesEnquiry(adminId, {
      companyId,
      period: "CUSTOM",
      from: "2026-10-01",
      to: "2026-10-31",
    });
    expect(enquiry.summary.netSales).toBe(october.kpis.netSales);
    const enquiryLines = await loadHistoricSalesLines({
      companyId,
      range: { from: "2026-10-01", to: "2026-10-31" },
    });
    expect(enquiryLines.some((line) => line.documentReference === "UNDATED")).toBe(false);
    expect(enquiryLines.some((line) => line.documentReference === "INV3")).toBe(false);
    expect(enquiryLines.filter((line) => line.documentReference === "DUP1")).toHaveLength(1);
    const allLines = await loadHistoricSalesLines({ companyId, range: ALL_DATED_HISTORY_QUERY_RANGE });
    expect(allLines.some((line) => line.documentReference === "UNDATED" && line.document?.documentDate == null)).toBe(
      true,
    );

    const panel = readFileSync("src/components/ab/autopart/AutopartHistoryImport.tsx", "utf8");
    const recent = readFileSync("src/components/ab/autopart/AutopartRecentSales.tsx", "utf8");
    expect(panel).toContain("Proposed changes");
    expect(panel).toContain("Stored records");
    expect(panel).toContain("uploadCustomerSalesReport");
    expect(panel).not.toContain("previewCustomerSalesHistoryFn");
    expect(panel).not.toContain("Historical 561L and SLRB purchases are not included");
    expect(panel).not.toContain("separate large-file import");
    expect(recent).toContain("uploadCustomerSalesReport");
    expect(recent).not.toContain("previewCustomerSalesImportFn");
  });

  it("keeps a reviewed import visible without treating rejected rows as zero history", async () => {
    const fresh = await prisma.company.create({
      data: { name: `LMS Review ${stamp}`, status: "ACTIVE" },
    });
    extraCompanyIds.push(fresh.id);
    const reviewCode = `LR${stamp.slice(0, 8).toUpperCase()}`;
    await linkAndVerifyCompanyAutopartCustomerCode(adminId, { companyId: fresh.id, code: reviewCode });
    const text = `Acct.,Inv & Ln,Part Number,Description,Units,Sales
${reviewCode},I/OK1/1,SS,Steel Seal,1,"£4.00"
${reviewCode},I/BADLINE,MISSING,Bad identity,1,"£1.00"
`;
    const ledger = `A/C,Type,Ref,Date,Tot Goods,Tot VAT,Total,Run Bal
${reviewCode},INV,OK1,01 Oct 26,"£4.00","£0.80","£4.80","£4.80"
`;
    const imported = await confirmCustomerSalesHistory(adminId, {
      companyId: fresh.id,
      text561l: text,
      textSlrb: ledger,
    });
    expect(imported.historyStatus).toBe("REVIEW");
    await expect(completeCustomerSalesCutoverWithoutHistory(adminId, fresh.id)).rejects.toBeInstanceOf(AuthError);
    const sales = await getUnifiedCustomerSales(adminId, { companyId: fresh.id, period: "ALL" });
    expect(sales.kpis.netSales).toBe("4.00");
    const stored = await listStoredCustomerSalesHistory(adminId, fresh.id);
    expect(stored.productLines).toBe(1);
    expect(stored.historyStatus).toBe("REVIEW");
  });

  it("shows stored product lines when the Autopart account is not verified", async () => {
    const loose = await prisma.company.create({
      data: { name: `LMS Unlinked ${stamp}`, status: "ACTIVE" },
    });
    extraCompanyIds.push(loose.id);
    await prisma.autopartSalesLine.create({
      data: {
        companyId: loose.id,
        autopartCustomerCode: "UNLINKED",
        documentType: "INVOICE",
        documentReference: "KEEP",
        lineNumber: 1,
        sku: "SS",
        units: "1",
        salesNet: "4.00",
        source: "561L",
      },
    });
    const stored = await listStoredCustomerSalesHistory(adminId, loose.id);
    expect(stored.productLines).toBe(1);
    expect(stored.rows[0]?.document).toBe("KEEP");
    expect(stored.rows[0]?.date).toBeNull();
  });
});
