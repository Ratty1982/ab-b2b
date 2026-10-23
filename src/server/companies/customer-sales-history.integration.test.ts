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
  startCustomerSalesHistoryBaseline,
} from "@/server/companies/customer-sales-history-import";
import { listCustomerSalesAccounts } from "@/server/companies/customer-sales-import";
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

  it("imports Autopart inch-mark descriptions and distinct SKUs that share Inv&Ln /1", async () => {
    const fresh = await prisma.company.create({
      data: { name: `Retail Amazon quotes ${stamp}`, status: "ACTIVE" },
    });
    const code = `RA${stamp.slice(0, 8).toUpperCase()}`;
    await linkAndVerifyCompanyAutopartCustomerCode(adminId, { companyId: fresh.id, code });
    const text = readFileSync(
      resolve(import.meta.dirname, "../../domain/fixtures/autopart-561l-retail-amazon-quotes.csv"),
      "utf8",
    ).replaceAll("RETAIL", code);
    const preview = await previewCustomerSalesHistory(adminId, {
      companyId: fresh.id,
      text561l: text,
      filename561l: "561L-RETAIL-quotes.csv",
    });
    expect(preview.counts.rejected).toBe(0);
    expect(preview.counts.duplicate).toBe(1); // exact repeated SS5131 raw row
    expect(preview.counts.import).toBe(18);
    expect(preview.rows.some((row) => row.sku === "SWUX68" && row.quantity === "-1.000")).toBe(true);
    expect(
      preview.rows.filter((row) => row.document === "SC503053" && row.disposition === "import"),
    ).toHaveLength(13);

    const imported = await confirmCustomerSalesHistory(adminId, {
      companyId: fresh.id,
      text561l: text,
      filename561l: "561L-RETAIL-quotes.csv",
    });
    // rowsImported counts product lines + supporting document headers.
    expect(imported.rowsImported).toBe(24);
    const sc503053 = await prisma.autopartSalesLine.findMany({
      where: { companyId: fresh.id, documentReference: "SC503053" },
      orderBy: { lineNumber: "asc" },
    });
    expect(sc503053).toHaveLength(13);
    expect(new Set(sc503053.map((line) => line.lineNumber)).size).toBe(13);
    expect(new Set(sc503053.map((line) => line.sourceFingerprint)).size).toBe(13);
    expect(sc503053.every((line) => Number(line.units) < 0)).toBe(true);
    const lightning = await prisma.autopartSalesLine.findFirstOrThrow({
      where: { companyId: fresh.id, documentReference: "SC501695", sku: "SWUX68" },
    });
    expect(lightning.descriptionSnapshot).toContain('14"');
    expect(Number(lightning.salesNet)).toBeCloseTo(-16.66, 2);
    const again = await confirmCustomerSalesHistory(adminId, { companyId: fresh.id, text561l: text });
    expect(again.rowsImported).toBe(0);

    await prisma.autopartSalesLine.deleteMany({ where: { companyId: fresh.id } });
    await prisma.autopartSalesDocument.deleteMany({ where: { companyId: fresh.id } });
    await prisma.customerSalesCutover.deleteMany({ where: { companyId: fresh.id } });
    await prisma.company.delete({ where: { id: fresh.id } });
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
    await expect(startCustomerSalesHistoryBaseline(adminId, fresh.id)).rejects.toThrow(/not a new sales baseline/);
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

  it("starts a new sales baseline without claiming the customer never had history", async () => {
    const fresh = await prisma.company.create({
      data: { name: `Baseline ${stamp}`, status: "PROSPECT" },
    });
    expect(await prisma.customerSalesCutover.count({ where: { companyId: fresh.id } })).toBe(0);
    await prisma.company.update({ where: { id: fresh.id }, data: { status: "ACTIVE" } });
    expect(await prisma.customerSalesCutover.count({ where: { companyId: fresh.id } })).toBe(0);
    const code = `BL${stamp.slice(0, 8).toUpperCase()}`;
    await linkAndVerifyCompanyAutopartCustomerCode(adminId, { companyId: fresh.id, code });
    const held = await prisma.autopartSalesDocument.create({
      data: {
        companyId: fresh.id,
        autopartCustomerCode: code,
        documentType: "INVOICE",
        documentReference: `SSBL${stamp.slice(0, 6).toUpperCase()}`,
        source: "561L",
      },
    });
    await expect(startCustomerSalesHistoryBaseline(adminId, fresh.id)).rejects.toThrow(/already has imported sales/);
    await prisma.autopartSalesDocument.delete({ where: { id: held.id } });

    const started = await startCustomerSalesHistoryBaseline(adminId, fresh.id);
    expect(started.kind).toBe("PRELAUNCH_HISTORY_DISCARDED");
    expect(started.alreadyComplete).toBe(false);
    const again = await startCustomerSalesHistoryBaseline(adminId, fresh.id);
    expect(again.alreadyComplete).toBe(true);
    expect(again.kind).toBe("PRELAUNCH_HISTORY_DISCARDED");
    const listed = await listCustomerSalesAccounts(adminId, fresh.id);
    expect(listed.historyKind).toBe("PRELAUNCH_HISTORY_DISCARDED");
    expect(listed.historyStatus).toBe("COMPLETE");
    const evidence = await prisma.customerSalesCutover.findUniqueOrThrow({ where: { companyId: fresh.id } });
    expect(evidence.evidence).toMatchObject({ kind: "PRELAUNCH_HISTORY_DISCARDED" });
    await expect(completeCustomerSalesCutoverWithoutHistory(adminId, fresh.id)).rejects.toThrow(
      /not a record of no historical sales/,
    );

    const reference = `SSBASE${stamp.slice(0, 4).toUpperCase()}`;
    const ongoing = `Cust,Group,Document,Date,Part Number,Description,Qty,Sales,Cost,Margin,Perc%
${code},GRP,${reference},20/10/2026,SS,Steel Seal,1,10.00,4.00,6.00,60.000
`;
    const imported = await confirmAutopartTrm21qcImport(adminId, { text: ongoing, filename: "TRM21QC.csv", source: "MANUAL" });
    expect(imported.rowsImported).toBe(1);
    expect(await prisma.autopartSalesLine.count({ where: { companyId: fresh.id, documentReference: reference } })).toBe(1);

    const empty = await prisma.company.create({
      data: { name: `Genuine empty ${stamp}`, status: "ACTIVE" },
    });
    const emptyCode = `GE${stamp.slice(0, 8).toUpperCase()}`;
    await linkAndVerifyCompanyAutopartCustomerCode(adminId, { companyId: empty.id, code: emptyCode });
    const recorded = await completeCustomerSalesCutoverWithoutHistory(adminId, empty.id);
    expect(recorded.historyStatus).toBe("COMPLETE");
    const emptyEvidence = await prisma.customerSalesCutover.findUniqueOrThrow({ where: { companyId: empty.id } });
    expect(emptyEvidence.evidence).toMatchObject({ kind: "NO_HISTORICAL_SALES" });
    await expect(startCustomerSalesHistoryBaseline(adminId, empty.id)).rejects.toThrow(
      /not a discarded pre-launch baseline/,
    );

    await prisma.autopartSalesLine.deleteMany({ where: { companyId: fresh.id } });
    await prisma.autopartSalesDocument.deleteMany({ where: { companyId: fresh.id } });
    await prisma.customerSalesCutover.deleteMany({ where: { companyId: { in: [fresh.id, empty.id] } } });
    await prisma.company.deleteMany({ where: { id: { in: [fresh.id, empty.id] } } });
  });
});
