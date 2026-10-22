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
      source: "ONGOING_TRM21QC",
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

    expect(byRef.get(ref("C1"))).toBeUndefined();
    expect(byRef.get(ref("R1"))).toBeUndefined();
    expect(byRef.get(ref("S1"))).toBeUndefined();

    const mismatch = byRef.get(ref("M1"));
    expect(mismatch?.reasons).toEqual(["DOCUMENT_GOODS_MISMATCH"]);
    expect(mismatch?.goodsNet).toBe("25.00");
    expect(mismatch?.productLineNet).toBe("10.00");
    expect(mismatch?.difference).toBe("15.00");
    expect(mismatch?.lines[0]).toMatchObject({
      sku: skuOil.toUpperCase(),
      qty: "1.000",
      net: "10.00",
      difference: "15.00",
    });

    expect(result.documents.find((document) => document.documentType === "CREDIT")).toBeUndefined();

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
    expect(account.documents).toHaveLength(0);

    const historical = await getSalesReconciliationInvestigation(managerId, {
      companyId,
      source: "HISTORICAL_561L",
      reason: "CONFLICTING_OVERLAP",
      pageSize: 10,
    });
    expect(historical.permitted).toBe(true);
    if (!historical.permitted) return;
    expect(historical.documents).toHaveLength(0);

    const credits = await getSalesReconciliationInvestigation(managerId, {
      companyId,
      documentType: "CREDIT",
      pageSize: 10,
    });
    expect(credits.permitted).toBe(true);
    if (!credits.permitted) return;
    expect(credits.documents).toHaveLength(0);

    const page = await getSalesReconciliationInvestigation(managerId, { companyId, page: 1, pageSize: 1 });
    expect(page.permitted).toBe(true);
    if (!page.permitted) return;
    expect(page.documents).toHaveLength(1);
    expect(page.total).toBe(1);
    const next = await getSalesReconciliationInvestigation(managerId, { companyId, page: 2, pageSize: 1 });
    expect(next.permitted).toBe(true);
    if (!next.permitted) return;
    expect(next.documents).toHaveLength(0);

    const csv = await exportSalesReconciliationCsv(managerId, {
      companyId,
      reason: "DOCUMENT_GOODS_MISMATCH",
    });
    expect(csv.csv).toContain("Invoice reference");
    expect(csv.csv).toContain("SKU");
    expect(csv.csv).toContain("Difference");
    expect(csv.csv).toContain(ref("M1"));
    expect(csv.csv).toContain(skuOil.toUpperCase());
    expect(csv.csv).toContain("15.00");
    expect(csv.csv).toContain("Correct Autopart source data");
    expect(csv.csv).not.toContain(ref("C1"));
    expect(csv.csv).not.toContain(ref("S1"));
    expect(csv.truncated).toBe(false);
    await expect(exportSalesReconciliationCsv(repUserId, { companyId })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });
});
