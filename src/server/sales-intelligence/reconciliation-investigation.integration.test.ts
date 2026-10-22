/**
 * Read-only reconciliation investigation. Synthetic rows only.
 * Proves filters, source comparison, 504 differences, management access and that nothing is rewritten.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { bootstrapRbac } from "../../../prisma/bootstrap/rbac";
import { getUnifiedCustomerHistory } from "@/server/sales-intelligence/unified-sales";
import {
  exportSalesReconciliationCsv,
  getSalesReconciliationInvestigation,
} from "@/server/sales-intelligence/reconciliation-investigation";
import { resetReportGuardForTests } from "@/server/sales-intelligence/report-guard";

const prisma = new PrismaClient();
const stamp = `RI${Date.now().toString(36).slice(-6).toUpperCase()}`;
const ref = (name: string) => `${stamp}${name}`;
const skuPad = `RI-PAD-${stamp}`;
const skuOil = `RI-OIL-${stamp}`;
const skuBelt = `RI-BLT-${stamp}`;
const skuBolt = `RI-BOLT-${stamp}`;
const skuWasher = `RI-WASH-${stamp}`;
const codeOwn = `${stamp}A`;
const codeShared = `${stamp}X`;

let managerId = "";
let repUserId = "";
let companyId = "";
let otherId = "";
let batchId = "";
let identity = 0;

async function ensureUser(email: string, roles: string[]) {
  const user = await prisma.user.create({
    data: { email, name: email.split("@")[0]!, status: "ACTIVE", actorType: "INTERNAL", emailVerified: true },
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
  reference: string | null;
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
      documentReference: input.reference,
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

beforeAll(async () => {
  resetReportGuardForTests();
  await bootstrapRbac(prisma);
  managerId = await ensureUser(`ri.mgmt.${stamp}@example.invalid`, ["MANAGEMENT"]);
  repUserId = await ensureUser(`ri.rep.${stamp}@example.invalid`, ["SALES_REPRESENTATIVE"]);
  const rep = await prisma.salesRep.create({
    data: { userId: repUserId, code: `RI-${stamp}`, displayName: `Rep ${stamp}`, active: true },
  });
  companyId = (await prisma.company.create({ data: { name: `RI Customer ${stamp}`, status: "ACTIVE" } })).id;
  otherId = (await prisma.company.create({ data: { name: `RI Other ${stamp}`, status: "ACTIVE" } })).id;
  await prisma.companyAssignment.create({
    data: { companyId, salesRepId: rep.id, isPrimary: true },
  });
  batchId = (
    await prisma.autopartImportBatch.create({
      data: {
        kind: "INVOICE_LINES",
        status: "COMMITTED",
        filename: `ri-${stamp}.csv`,
        fileHash: `ri-${stamp}`,
        dryRun: false,
        createdById: managerId,
        completedAt: new Date(),
      },
    })
  ).id;
  await prisma.autopartAccount.create({
    data: {
      accountCode: codeOwn,
      originalName: `Synthetic ${codeOwn}`,
      classification: "TRADE_CANDIDATE",
      companyId,
    },
  });
  await prisma.autopartAccount.create({
    data: {
      accountCode: codeShared,
      originalName: `Synthetic ${codeShared}`,
      classification: "TRADE_CANDIDATE",
      companyId,
    },
  });
  await prisma.autopartCustomerAccountAlias.create({
    data: { companyId: otherId, alias: codeShared, verifiedById: managerId },
  });

  await historical({
    accountCode: codeOwn,
    inv: `${stamp}-C1`,
    type: "INVOICE",
    reference: ref("C1"),
    sku: skuPad,
    qty: "1",
    sales: "10.00",
  });
  const conflict = await prisma.autopartSalesDocument.create({
    data: {
      companyId,
      autopartCustomerCode: codeOwn,
      documentType: "INVOICE",
      documentReference: ref("C1"),
      documentDate: new Date("2026-09-01T12:00:00.000Z"),
      source: "561L",
      has504: false,
      hasTrm21qc: false,
    },
  });
  await prisma.autopartSalesLine.create({
    data: {
      companyId,
      documentId: conflict.id,
      autopartCustomerCode: codeOwn,
      documentType: "INVOICE",
      documentReference: ref("C1"),
      lineNumber: 1,
      sku: skuPad,
      descriptionSnapshot: `Synthetic ${skuPad}`,
      units: "2",
      salesNet: "30.00",
      source: "561L",
    },
  });

  const mismatch = await prisma.autopartSalesDocument.create({
    data: {
      companyId,
      autopartCustomerCode: codeOwn,
      documentType: "INVOICE",
      documentReference: ref("M1"),
      documentDate: new Date("2026-09-02T12:00:00.000Z"),
      source: "561L",
      has504: true,
      goodsNet: "25.00",
      hasTrm21qc: false,
    },
  });
  await prisma.autopartSalesLine.create({
    data: {
      companyId,
      documentId: mismatch.id,
      autopartCustomerCode: codeOwn,
      documentType: "INVOICE",
      documentReference: ref("M1"),
      lineNumber: 1,
      sku: skuOil,
      descriptionSnapshot: `Synthetic ${skuOil}`,
      units: "1",
      salesNet: "10.00",
      source: "561L",
    },
  });

  await historical({
    accountCode: codeOwn,
    inv: `${stamp}-R1`,
    type: "INVOICE",
    reference: ref("R1"),
    sku: skuBelt,
    qty: "1",
    sales: "4.00",
  });
  await historical({
    accountCode: codeOwn,
    inv: `${stamp}-R1`,
    type: "INVOICE",
    reference: ref("R1"),
    sku: skuBelt,
    qty: "1",
    sales: "4.00",
  });
  await historical({
    accountCode: codeOwn,
    inv: `${stamp}-CR`,
    type: "CREDIT",
    reference: null,
    sku: skuBelt,
    qty: "1",
    sales: "3.00",
  });
  await historical({
    accountCode: codeShared,
    inv: `${stamp}-S1`,
    type: "INVOICE",
    reference: ref("S1"),
    sku: skuPad,
    qty: "1",
    sales: "7.00",
  });

  for (const [index, sku] of [
    [1, skuBolt],
    [2, skuBolt],
    [3, skuBolt],
    [4, skuWasher],
  ] as const) {
    await historical({
      accountCode: codeOwn,
      inv: `${stamp}-D1-${index}`,
      type: "INVOICE",
      reference: ref("D1"),
      sku,
      qty: "1",
      sales: sku === skuWasher ? "5.00" : "10.00",
    });
  }
  const copies = await prisma.autopartSalesDocument.create({
    data: {
      companyId,
      autopartCustomerCode: codeOwn,
      documentType: "INVOICE",
      documentReference: ref("D1"),
      documentDate: new Date("2026-09-03T12:00:00.000Z"),
      source: "561L",
      has504: false,
      hasTrm21qc: false,
    },
  });
  await prisma.autopartSalesLine.createMany({
    data: [1, 2].map((lineNumber) => ({
      companyId,
      documentId: copies.id,
      autopartCustomerCode: codeOwn,
      documentType: "INVOICE" as const,
      documentReference: ref("D1"),
      lineNumber,
      sku: skuBolt,
      descriptionSnapshot: `Synthetic ${skuBolt}`,
      units: "1",
      salesNet: "10.00",
      source: "561L",
    })),
  });
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("sales reconciliation investigation", () => {
  it("groups unreconciled documents and compares sources without changing records", async () => {
    const beforeLines = await prisma.autopartInvoiceLine.count({ where: { importBatchId: batchId } });
    const beforeDocs = await prisma.autopartSalesDocument.findMany({
      where: { companyId },
      select: { id: true, reconciliationStatus: true, goodsNet: true, has504: true },
      orderBy: { documentReference: "asc" },
    });
    const history = await getUnifiedCustomerHistory(managerId, { companyId });
    expect(history.investigationPermitted).toBe(true);
    const repHistory = await getUnifiedCustomerHistory(repUserId, { companyId });
    expect(repHistory.investigationPermitted).toBe(false);

    const result = await getSalesReconciliationInvestigation(managerId, { companyId, pageSize: 10 });
    expect(result.permitted).toBe(true);
    if (!result.permitted) return;
    const byRef = new Map(result.documents.map((document) => [document.reference, document]));

    const conflict = byRef.get(ref("C1"));
    expect(conflict?.reasons).toContain("CONFLICTING_OVERLAP");
    expect(conflict?.actions).toContain("AUTOPART_SOURCE");
    expect(conflict?.sources.map((source) => source.source).sort()).toEqual([
      "COMPANY_561L_SLRB",
      "HISTORICAL_561L",
    ]);
    expect(conflict?.difference).toBe("20.00");
    expect(conflict?.comparison.view).toBe("DIFFERENCES");
    expect(conflict?.comparison.totalDifference).toBe("20.00");
    expect(conflict?.comparison.totalDifferenceSummary).toContain("not certified sales");
    expect(conflict?.comparison.rows).toHaveLength(1);
    expect(conflict?.comparison.rows[0]).toMatchObject({
      kind: "QTY_AND_NET_CHANGED",
      sku: skuPad.toUpperCase(),
      occurrence: 1,
      qtyDifference: "-1.000",
      netDifference: "-20.00",
    });
    expect(conflict?.comparison.rows[0]?.sources.find((source) => source.source === "HISTORICAL_561L")).toMatchObject({
      qty: "1.000",
      net: "10.00",
      missing: false,
    });
    expect(conflict?.comparison.rows[0]?.sources.find((source) => source.source === "COMPANY_561L_SLRB")).toMatchObject({
      qty: "2.000",
      net: "30.00",
      missing: false,
    });
    expect(conflict?.sources.find((source) => source.source === "HISTORICAL_561L")).toMatchObject({
      net: "10.00",
      lineCount: 1,
    });
    expect(conflict?.sources.find((source) => source.source === "COMPANY_561L_SLRB")).toMatchObject({
      net: "30.00",
      lineCount: 1,
    });

    const copies = byRef.get(ref("D1"));
    expect(copies?.comparison.matching).toBe(2);
    expect(copies?.comparison.missing).toBe(2);
    expect(copies?.comparison.rows.map((row) => row.kind)).toEqual(["MISSING", "MISSING"]);
    expect(copies?.comparison.rows.map((row) => row.sku).sort()).toEqual([
      skuBolt.toUpperCase(),
      skuWasher.toUpperCase(),
    ]);
    expect(copies?.comparison.totalDifference).toBe("15.00");
    expect(copies?.sources.find((source) => source.source === "HISTORICAL_561L")?.lineCount).toBe(4);
    expect(copies?.sources.find((source) => source.source === "COMPANY_561L_SLRB")?.lineCount).toBe(2);
    const allLines = await getSalesReconciliationInvestigation(managerId, {
      companyId,
      comparison: "ALL",
      pageSize: 10,
    });
    expect(allLines.permitted).toBe(true);
    if (!allLines.permitted) return;
    const shown = allLines.documents.find((document) => document.reference === ref("D1"));
    expect(
      shown?.comparison.rows
        .filter((row) => row.sku === skuBolt.toUpperCase())
        .map((row) => [row.occurrence, row.kind]),
    ).toEqual([
      [1, "MATCH"],
      [2, "MATCH"],
      [3, "MISSING"],
    ]);
    const duplicates = await getSalesReconciliationInvestigation(managerId, {
      companyId,
      comparison: "DUPLICATES",
      pageSize: 10,
    });
    expect(duplicates.permitted).toBe(true);
    if (!duplicates.permitted) return;
    expect(
      duplicates.documents.find((document) => document.reference === ref("D1"))?.comparison.rows,
    ).toEqual([]);
    expect(
      duplicates.documents.find((document) => document.reference === ref("R1"))?.comparison.rows[0]?.kind,
    ).toBe("REPEATED");

    const mismatch = byRef.get(ref("M1"));
    expect(mismatch?.reasons).toEqual(["DOCUMENT_GOODS_MISMATCH"]);
    expect(mismatch?.goodsNet).toBe("25.00");
    expect(mismatch?.productLineNet).toBe("10.00");
    expect(mismatch?.difference).toBe("15.00");
    expect(mismatch?.comparison.rows).toEqual([]);
    expect(mismatch?.comparison.totalDifference).toBe("15.00");
    expect(mismatch?.comparison.totalDifferenceSummary).toContain("504 goods total 25.00");
    expect(mismatch?.comparison.totalDifferenceSummary).toContain("not certified sales");

    const repeated = byRef.get(ref("R1"));
    expect(repeated?.actions).toEqual(["IMPORT_PROCESSING"]);
    expect(repeated?.comparison.repeated).toBe(1);
    expect(repeated?.comparison.rows).toHaveLength(1);
    expect(repeated?.comparison.rows[0]).toMatchObject({
      kind: "REPEATED",
      sku: skuBelt.toUpperCase(),
      netDifference: "4.00",
    });

    const shared = byRef.get(ref("S1"));
    expect(shared?.actions).toEqual(["ACCOUNT_MAPPING"]);
    expect(shared?.accountCode).toBe(codeShared);
    expect(shared?.comparison.rows[0]).toMatchObject({ kind: "HELD", netDifference: "7.00" });

    const credit = result.documents.find((document) => document.documentType === "CREDIT");
    expect(credit?.reference).toBeNull();
    expect(credit?.reasons).toContain("NO_DOCUMENT_REFERENCE");
    expect(credit?.comparison.rows[0]).toMatchObject({ kind: "HELD", netDifference: "-3.00" });

    const afterLines = await prisma.autopartInvoiceLine.count({ where: { importBatchId: batchId } });
    const afterDocs = await prisma.autopartSalesDocument.findMany({
      where: { companyId },
      select: { id: true, reconciliationStatus: true, goodsNet: true, has504: true },
      orderBy: { documentReference: "asc" },
    });
    expect(afterLines).toBe(beforeLines);
    expect(afterDocs).toEqual(beforeDocs);
    expect(afterDocs.every((document) => document.reconciliationStatus == null)).toBe(true);

    const rep = await getSalesReconciliationInvestigation(repUserId, { companyId });
    expect(rep.permitted).toBe(false);
  });

  it("filters by reason, account, source and document type, and exports only that set", async () => {
    const goods = await getSalesReconciliationInvestigation(managerId, {
      companyId,
      reason: "DOCUMENT_GOODS_MISMATCH",
      pageSize: 10,
    });
    expect(goods.permitted).toBe(true);
    if (!goods.permitted) return;
    expect(goods.documents.map((document) => document.reference)).toEqual([ref("M1")]);

    const account = await getSalesReconciliationInvestigation(managerId, {
      companyId,
      accountCode: codeShared.toLowerCase(),
      pageSize: 10,
    });
    expect(account.permitted).toBe(true);
    if (!account.permitted) return;
    expect(account.documents.map((document) => document.reference)).toEqual([ref("S1")]);

    const historical = await getSalesReconciliationInvestigation(managerId, {
      companyId,
      source: "HISTORICAL_561L",
      reason: "CONFLICTING_OVERLAP",
      pageSize: 10,
    });
    expect(historical.permitted).toBe(true);
    if (!historical.permitted) return;
    const historicalConflict = historical.documents.find((document) => document.reference === ref("C1"));
    expect(historicalConflict?.comparison.rows[0]?.sources.map((source) => source.source).sort()).toEqual([
      "COMPANY_561L_SLRB",
      "HISTORICAL_561L",
    ]);
    expect(historicalConflict?.sources.map((source) => source.net).sort()).toEqual(["10.00", "30.00"]);

    const credits = await getSalesReconciliationInvestigation(managerId, {
      companyId,
      documentType: "CREDIT",
      pageSize: 10,
    });
    expect(credits.permitted).toBe(true);
    if (!credits.permitted) return;
    expect(credits.documents).toHaveLength(1);
    expect(credits.documents[0]?.documentType).toBe("CREDIT");

    const page = await getSalesReconciliationInvestigation(managerId, { companyId, page: 1, pageSize: 1 });
    expect(page.permitted).toBe(true);
    if (!page.permitted) return;
    expect(page.documents).toHaveLength(1);
    expect(page.total).toBeGreaterThan(1);
    const next = await getSalesReconciliationInvestigation(managerId, { companyId, page: 2, pageSize: 1 });
    expect(next.permitted).toBe(true);
    if (!next.permitted) return;
    expect(next.documents[0]?.reference).not.toBe(page.documents[0]?.reference);

    const csv = await exportSalesReconciliationCsv(managerId, {
      companyId,
      reason: "DOCUMENT_GOODS_MISMATCH",
    });
    expect(csv.filename.startsWith("reconciliation-discrepancies-")).toBe(true);
    expect(csv.csv).toContain("Invoice reference");
    expect(csv.csv).toContain("Finding");
    expect(csv.csv).toContain("Total difference");
    expect(csv.csv).toContain("Document total");
    expect(csv.csv).toContain(ref("M1"));
    expect(csv.csv).toContain("15.00");
    expect(csv.csv).toContain("Correct Autopart source data");
    expect(csv.csv).not.toContain(skuOil.toUpperCase());
    expect(csv.csv).not.toContain(ref("C1"));
    expect(csv.csv).not.toContain(ref("S1"));
    expect(csv.rowCount).toBe(1);
    expect(csv.truncated).toBe(false);

    const differences = await exportSalesReconciliationCsv(managerId, {
      companyId,
      reason: "CONFLICTING_OVERLAP",
      comparison: "DIFFERENCES",
    });
    expect(differences.csv).toContain(ref("D1"));
    expect(differences.csv).toContain("Missing line");
    expect(differences.csv).toContain(skuBolt.toUpperCase());
    expect(differences.csv).toContain(skuWasher.toUpperCase());
    expect(differences.csv).not.toContain("Matching line");
    const matching = await exportSalesReconciliationCsv(managerId, {
      companyId,
      reason: "CONFLICTING_OVERLAP",
      comparison: "MATCHING",
    });
    expect(matching.filename.startsWith("reconciliation-lines-")).toBe(true);
    expect(matching.csv).toContain("Matching line");
    expect(matching.csv).toContain(skuBolt.toUpperCase());
    expect(matching.csv).not.toContain("Missing line");
    expect(matching.csv).not.toContain(skuWasher.toUpperCase());
    await expect(exportSalesReconciliationCsv(repUserId, { companyId })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });
});
