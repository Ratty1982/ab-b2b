import "@/server/testing/use-protect-integration-database";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { bootstrapRbac } from "../../../prisma/bootstrap/rbac";
import { linkAndVerifyCompanyAutopartCustomerCode } from "@/server/companies/autopart-account";
import { confirmCustomerSalesImport } from "@/server/companies/customer-sales-import";
import {
  acknowledgeCustomerSalesHistoryReview,
  completeCustomerSalesCutoverWithoutHistory,
  confirmCustomerSalesHistory,
  previewCustomerSalesHistory,
} from "@/server/companies/customer-sales-history-import";
import { confirmAutopartTrm21qcImport } from "@/server/companies/autopart-ongoing-sales";
import { AuthError } from "@/server/rbac/guards";

const prisma = new PrismaClient();
const stamp = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const account = `YH${stamp.slice(0, 6).toUpperCase()}`;
const lines = readFileSync(resolve(import.meta.dirname, "../../domain/fixtures/autopart-561l-sample.csv"), "utf8").replaceAll(
  "YORKMOT",
  account,
);
const ledger = readFileSync(resolve(import.meta.dirname, "../../domain/fixtures/autopart-slrb-sample.csv"), "utf8").replaceAll(
  "YORKMOT",
  account,
);
const cleanLines = lines
  .split(/\r?\n/)
  .filter((line) => !line.includes("BADLINE"))
  .join("\n");

let adminId = "";
let companyId = "";
let prospectId = "";

beforeAll(async () => {
  await bootstrapRbac(prisma);
  let user = await prisma.user.findUnique({ where: { email: `history.${stamp}@example.invalid` } });
  if (!user) {
    user = await prisma.user.create({
      data: {
        email: `history.${stamp}@example.invalid`,
        name: "History importer",
        status: "ACTIVE",
        actorType: "INTERNAL",
        emailVerified: true,
      },
    });
  }
  const role = await prisma.role.findUniqueOrThrow({ where: { key: "SUPER_ADMIN" } });
  await prisma.userRole.upsert({
    where: { userId_roleId: { userId: user.id, roleId: role.id } },
    create: { userId: user.id, roleId: role.id },
    update: {},
  });
  adminId = user.id;
  const company = await prisma.company.create({
    data: { name: `History Customer ${stamp}`, status: "ACTIVE" },
  });
  const prospect = await prisma.company.create({
    data: { name: `History Prospect ${stamp}`, status: "PROSPECT" },
  });
  companyId = company.id;
  prospectId = prospect.id;
  await linkAndVerifyCompanyAutopartCustomerCode(adminId, { companyId, code: account });
});

afterAll(async () => {
  await prisma.autopartSalesLine.deleteMany({ where: { companyId } });
  await prisma.autopartSalesDocument.deleteMany({ where: { companyId } });
  await prisma.customerSalesCutover.deleteMany({ where: { companyId } });
  await prisma.company.deleteMany({ where: { id: { in: [companyId, prospectId] } } });
  await prisma.$disconnect();
});

describe("customer sales history", () => {
  it("imports 561L and SLRB for the verified customer and then accepts ongoing sales once", async () => {
    await expect(previewCustomerSalesHistory(adminId, { companyId: prospectId, text561l: lines })).rejects.toBeInstanceOf(
      AuthError,
    );
    const blocked = `Cust,Group,Document,Date,Part Number,Description,Qty,Sales,Cost,Margin,Perc%
${account},GRP,SSBEFORE,29/09/2026,SS,Widget,1,10.00,4.00,6.00,60.000
`;
    const beforeCutover = await confirmAutopartTrm21qcImport(adminId, {
      text: blocked,
      filename: "TRM21QC.csv",
      source: "MANUAL",
    });
    expect(await prisma.autopartSalesLine.count({ where: { documentReference: "SSBEFORE" } })).toBe(0);
    expect(
      await prisma.autopartImportDiagnostic.count({
        where: { importRunId: beforeCutover.id, reasonCode: "HISTORY_CUTOVER_INCOMPLETE" },
      }),
    ).toBeGreaterThan(0);

    const preview = await previewCustomerSalesHistory(adminId, {
      companyId,
      text561l: cleanLines,
      textSlrb: ledger,
      filename561l: "561L.csv",
      filenameSlrb: "SLRB.csv",
    });
    expect(preview.canCommit).toBe(true);
    expect(preview.counts.ledger).toBeGreaterThan(0);
    expect(preview.rows.some((row) => row.type === "CREDIT" && row.amount?.startsWith("-"))).toBe(true);
    expect(preview.rows.some((row) => row.document === "SS999999" && row.disposition === "import")).toBe(true);

    const imported = await confirmCustomerSalesHistory(adminId, {
      companyId,
      text561l: cleanLines,
      textSlrb: ledger,
      filename561l: "561L.csv",
      filenameSlrb: "SLRB.csv",
    });
    expect(imported.rowsImported).toBeGreaterThan(0);
    const credit = await prisma.autopartSalesLine.findFirstOrThrow({
      where: { companyId, documentReference: "SS100900" },
    });
    expect(Number(credit.units)).toBeLessThan(0);
    expect(Number(credit.salesNet)).toBeLessThan(0);
    const payment = await prisma.autopartSalesDocument.findFirstOrThrow({
      where: { companyId, documentReference: "REC001", documentType: "PAYMENT" },
    });
    expect(payment.goodsNet).toBeNull();
    expect(await prisma.autopartSalesLine.count({ where: { companyId, documentType: "PAYMENT" } })).toBe(0);
    const header = await prisma.autopartSalesDocument.findFirstOrThrow({
      where: { companyId, documentReference: "SS306008", documentType: "INVOICE" },
    });
    expect(Number(header.goodsNet)).toBeCloseTo(683.28, 2);
    expect(await prisma.autopartSalesLine.count({ where: { documentId: header.id } })).toBe(2);

    const again = await confirmCustomerSalesHistory(adminId, { companyId, text561l: cleanLines, textSlrb: ledger });
    expect(again.rowsImported).toBe(0);
    expect(await prisma.autopartSalesLine.count({ where: { companyId, documentReference: "SS306008" } })).toBe(2);

    const overlap = `Cust,Group,Document,Date,Part Number,Description,Qty,Sales,Cost,Margin,Perc%
${account},GRP,SS306008,06/10/2014,SS,Steel Seal,24,622.80,300.00,322.80,51.830
${account},GRP,SSNEW${stamp.slice(0, 4).toUpperCase()},20/10/2026,SS,Steel Seal,1,10.00,4.00,6.00,60.000
`;
    const ongoing = await confirmCustomerSalesImport(adminId, {
      companyId,
      accountCode: account,
      text: overlap,
      filename: "TRM21QC.csv",
    });
    expect(ongoing.rowsImported).toBe(1);
    expect(
      await prisma.autopartSalesLine.count({
        where: { companyId, documentReference: "SS306008", sku: "SS", source: "561L" },
      }),
    ).toBe(1);
    expect(
      await prisma.autopartSalesLine.count({
        where: { companyId, documentReference: `SSNEW${stamp.slice(0, 4).toUpperCase()}` },
      }),
    ).toBe(1);
    const cutover = await prisma.customerSalesCutover.findUniqueOrThrow({ where: { companyId } });
    expect(cutover.historyStatus).toBe("COMPLETE");
    expect(cutover.historyFrom).toBeTruthy();
    expect(cutover.historyTo).toBeTruthy();
  });

  it("records an explicit empty history without importing", async () => {
    const fresh = await prisma.company.create({
      data: { name: `Empty History ${stamp}`, status: "ACTIVE" },
    });
    const code = `EH${stamp.slice(0, 8).toUpperCase()}`;
    await linkAndVerifyCompanyAutopartCustomerCode(adminId, { companyId: fresh.id, code });
    const result = await completeCustomerSalesCutoverWithoutHistory(adminId, fresh.id);
    expect(result.historyStatus).toBe("COMPLETE");
    expect(await prisma.autopartSalesDocument.count({ where: { companyId: fresh.id } })).toBe(0);
    await prisma.customerSalesCutover.deleteMany({ where: { companyId: fresh.id } });
    await prisma.company.delete({ where: { id: fresh.id } });
  });

  it("keeps two lines of the same SKU and repeats without duplicating them", async () => {
    const ref = `SSMU${stamp.slice(0, 6).toUpperCase()}`;
    const text = `Acct.,Inv & Ln,Part Number,Description,Units,Sales
${account},I/${ref}/1,SS,First,2,"£10.00"
${account},I/${ref}/2,SS,Second,5,"£25.00"
${account},I/${ref}B/,SS,No line A,1,"£3.00"
${account},I/${ref}B/,SS,No line B,4,"£8.00"
`;
    const imported = await confirmCustomerSalesHistory(adminId, { companyId, text561l: text, filename561l: "multi.csv" });
    expect(imported.historyStatus).toBe("COMPLETE");
    expect(await prisma.autopartSalesLine.count({ where: { companyId, documentReference: ref, sku: "SS" } })).toBe(2);
    expect(await prisma.autopartSalesLine.count({ where: { companyId, documentReference: `${ref}B`, sku: "SS" } })).toBe(2);
    const again = await confirmCustomerSalesHistory(adminId, { companyId, text561l: text });
    expect(again.rowsImported).toBe(0);
    expect(await prisma.autopartSalesLine.count({ where: { companyId, documentReference: ref, sku: "SS" } })).toBe(2);
    expect(await prisma.autopartSalesLine.count({ where: { companyId, documentReference: `${ref}B`, sku: "SS" } })).toBe(2);
  });

  it("keeps cutover in review when a row is rejected and does not call that zero history", async () => {
    const fresh = await prisma.company.create({
      data: { name: `Review History ${stamp}`, status: "ACTIVE" },
    });
    const code = `RV${stamp.slice(0, 8).toUpperCase()}`;
    await linkAndVerifyCompanyAutopartCustomerCode(adminId, { companyId: fresh.id, code });
    const text = `Acct.,Inv & Ln,Part Number,Description,Units,Sales
${code},I/SSOK${stamp.slice(0, 4).toUpperCase()}/1,SS,Ok,1,"£4.00"
${code},I/BADLINE,MISSING,Bad identity,1,"£1.00"
`;
    const imported = await confirmCustomerSalesHistory(adminId, { companyId: fresh.id, text561l: text });
    expect(imported.historyStatus).toBe("REVIEW");
    expect(imported.rowsImported).toBeGreaterThan(0);
    await expect(completeCustomerSalesCutoverWithoutHistory(adminId, fresh.id)).rejects.toBeInstanceOf(AuthError);
    const blocked = `Cust,Group,Document,Date,Part Number,Description,Qty,Sales,Cost,Margin,Perc%
${code},GRP,SSREV${stamp.slice(0, 4).toUpperCase()},29/09/2026,SS,Widget,1,10.00,4.00,6.00,60.000
`;
    await confirmAutopartTrm21qcImport(adminId, { text: blocked, filename: "TRM21QC.csv", source: "MANUAL" });
    expect(await prisma.autopartSalesLine.count({ where: { documentReference: `SSREV${stamp.slice(0, 4).toUpperCase()}` } })).toBe(0);
    const skipped = await prisma.autopartImportDiagnostic.findFirst({
      where: { customerAccount: code, reasonCode: "HISTORY_CUTOVER_INCOMPLETE" },
      orderBy: { createdAt: "desc" },
    });
    expect(skipped?.salesNet).toBeNull();
    expect(skipped?.quantity).toBeNull();
    expect(skipped?.sku).toBeNull();
    await acknowledgeCustomerSalesHistoryReview(adminId, fresh.id);
    const cutover = await prisma.customerSalesCutover.findUniqueOrThrow({ where: { companyId: fresh.id } });
    expect(cutover.historyStatus).toBe("COMPLETE");
    await prisma.autopartSalesLine.deleteMany({ where: { companyId: fresh.id } });
    await prisma.autopartSalesDocument.deleteMany({ where: { companyId: fresh.id } });
    await prisma.customerSalesCutover.deleteMany({ where: { companyId: fresh.id } });
    await prisma.company.delete({ where: { id: fresh.id } });
  });
});
