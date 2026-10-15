/**
 * Historical 561L/SLRB imports must not replace ongoing TRM21QC lines or 504/TRM headers.
 * Repeated product lines on an Amazon FBA invoice stay separate lines.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { bootstrapRbac } from "../../../prisma/bootstrap/rbac";
import { linkAndVerifyCompanyAutopartCustomerCode } from "@/server/companies/autopart-account";
import { confirmAutopartHistoryImport } from "@/server/companies/autopart-history";
import {
  confirmAutopart504Import,
  confirmAutopartTrm21qcImport,
} from "@/server/companies/autopart-ongoing-sales";

const prisma = new PrismaClient();
const stamp = Date.now();
const account = `HP${String(stamp).slice(-8)}`;

let adminId = "";
let companyId = "";

async function ensureUser(email: string) {
  let user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    user = await prisma.user.create({
      data: {
        email,
        name: "Historic protect",
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
  return user.id;
}

function historyFiles(input: {
  reference: string;
  lines: Array<{ line: number; sku: string; units: string; sales: string }>;
  goods: string;
  vat?: string;
  total?: string;
}) {
  const vat = input.vat ?? "0.00";
  const total = input.total ?? input.goods;
  const file561l = [
    "Acct.,Inv & Ln,Part Number,Description,Units,Sales",
    ...input.lines.map(
      (line) =>
        `${account},I/${input.reference}/${line.line},${line.sku},Historic ${line.sku},${line.units},${line.sales}`,
    ),
  ].join("\n");
  const fileSlrb = [
    "A/C,Type,Ref,Date,Tot Goods,Tot VAT,Total,Run Bal",
    `${account},INV,${input.reference},15 Oct 26,${input.goods},${vat},${total},${total}`,
  ].join("\n");
  return { file561l, fileSlrb };
}

function trmFile(reference: string, sku: string, qty: string, sales: string) {
  return `Cust,Group,Document,Date,Part Number,Description,Qty,Sales,Cost,Margin,Perc%
${account},GRP,${reference},15/10/2026,${sku},Ongoing ${sku},${qty},${sales},10.00,1.00,10.000
`;
}

function report504(reference: string, goods: string) {
  return `Type,Document,Date,Time,Customer Name,Goods,VAT,Value,Inits,Customer Order Number
ACCOUNT,${reference},15/10/2026,13:05,RETAIL AMAZON,${goods},16.00,96.00,WR,FBA-1
`;
}

beforeAll(async () => {
  await bootstrapRbac(prisma);
  adminId = await ensureUser(`hist-protect.${stamp}@example.invalid`);
  const company = await prisma.company.create({
    data: { name: `Historic protect ${stamp}`, status: "ACTIVE", paymentTerms: "30 Days" },
  });
  companyId = company.id;
  await linkAndVerifyCompanyAutopartCustomerCode(adminId, { companyId, code: account });
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("historical import protection", () => {
  it("keeps repeated FBA product lines and repeats the same historical import", async () => {
    const reference = `FBA${String(stamp).slice(-6)}`;
    const skuA = `FBA-A-${String(stamp).slice(-5)}`;
    const skuB = `FBA-B-${String(stamp).slice(-5)}`;
    const files = historyFiles({
      reference,
      goods: "30.00",
      lines: [
        { line: 1, sku: skuA, units: "2", sales: "10.00" },
        { line: 1, sku: skuB, units: "4", sales: "20.00" },
      ],
    });
    const first = await confirmAutopartHistoryImport(adminId, {
      companyId,
      ...files,
      filename561l: "561L-FBA.CSV",
      filenameSlrb: "SLRB-FBA.CSV",
    });
    expect(first.status).toBe("COMMITTED");

    const stored = async () =>
      prisma.autopartSalesLine.findMany({
        where: { companyId, documentReference: reference },
        select: { sku: true, lineNumber: true, units: true, salesNet: true, source: true },
        orderBy: { lineNumber: "asc" },
      });
    const afterFirst = await stored();
    expect(afterFirst).toHaveLength(2);
    expect(new Set(afterFirst.map((line) => line.lineNumber)).size).toBe(2);
    expect(afterFirst.map((line) => line.sku).sort()).toEqual([skuA, skuB].sort());
    expect(afterFirst.every((line) => line.source === "561L")).toBe(true);

    await confirmAutopartHistoryImport(adminId, {
      companyId,
      ...files,
      filename561l: "561L-FBA.CSV",
      filenameSlrb: "SLRB-FBA.CSV",
    });
    const afterSecond = await stored();
    expect(afterSecond).toHaveLength(2);
    expect(afterSecond.map((line) => [line.sku, line.lineNumber, Number(line.units), Number(line.salesNet)])).toEqual(
      afterFirst.map((line) => [line.sku, line.lineNumber, Number(line.units), Number(line.salesNet)]),
    );
  });

  it("does not overwrite a TRM21QC line or a 504 header, and still imports a non-colliding line", async () => {
    const reference = `TRM${String(stamp).slice(-6)}`;
    const trmSku = `TRM-${String(stamp).slice(-5)}`;
    const extraSku = `EXT-${String(stamp).slice(-5)}`;
    const trm = await confirmAutopartTrm21qcImport(adminId, {
      text: trmFile(reference, trmSku, "3", "16.00"),
      filename: "TRM21QC.csv",
      source: "MANUAL",
    });
    expect(trm.status).toBe("COMMITTED");
    const feed = await confirmAutopart504Import(adminId, {
      text: report504(reference, "16.00"),
      filename: "504.csv",
      source: "MANUAL",
    });
    expect(feed.status).toBe("COMMITTED");

    const before = await prisma.autopartSalesDocument.findFirstOrThrow({
      where: { documentReference: reference },
      include: { lines: true },
    });
    expect(before.has504).toBe(true);
    expect(before.lines).toHaveLength(1);
    const protectedLine = before.lines[0]!;
    const beforeLine = {
      id: protectedLine.id,
      sku: protectedLine.sku,
      units: protectedLine.units.toString(),
      salesNet: protectedLine.salesNet.toString(),
      source: protectedLine.source,
      importRunId: protectedLine.importRunId,
      sourceFingerprint: protectedLine.sourceFingerprint,
      sourceCost: protectedLine.sourceCost?.toString() ?? null,
      documentId: protectedLine.documentId,
    };

    const historic = await confirmAutopartHistoryImport(adminId, {
      companyId,
      ...historyFiles({
        reference,
        goods: "999.00",
        lines: [
          { line: protectedLine.lineNumber, sku: "REPLACED", units: "9", sales: "90.00" },
          { line: protectedLine.lineNumber + 1, sku: extraSku, units: "1", sales: "5.00" },
        ],
      }),
      filename561l: "561L-COLLIDE.CSV",
      filenameSlrb: "SLRB-COLLIDE.CSV",
    });
    expect(historic.status).toBe("COMMITTED");

    const after = await prisma.autopartSalesDocument.findFirstOrThrow({
      where: { id: before.id },
      include: { lines: { orderBy: { lineNumber: "asc" } } },
    });
    expect(after.goodsNet?.toString()).toBe(before.goodsNet?.toString());
    expect(after.vat?.toString()).toBe(before.vat?.toString());
    expect(after.grossTotal?.toString()).toBe(before.grossTotal?.toString());
    expect(after.source).toBe(before.source);
    expect(after.importRunId).toBe(before.importRunId);
    expect(after.has504).toBe(true);
    expect(after.hasTrm21qc).toBe(true);
    expect(after.customerOrderNumber).toBe(before.customerOrderNumber);
    expect(after.documentDate?.toISOString()).toBe(before.documentDate?.toISOString());

    const kept = after.lines.find((line) => line.id === beforeLine.id);
    expect(kept).toMatchObject({
      sku: beforeLine.sku,
      source: "ONGOING_TRM21QC",
      importRunId: beforeLine.importRunId,
      sourceFingerprint: beforeLine.sourceFingerprint,
      documentId: beforeLine.documentId,
    });
    expect(kept?.units.toString()).toBe(beforeLine.units);
    expect(kept?.salesNet.toString()).toBe(beforeLine.salesNet);
    expect(kept?.sourceCost?.toString() ?? null).toBe(beforeLine.sourceCost);

    const added = after.lines.find((line) => line.sku === extraSku);
    expect(added?.source).toBe("561L");
    expect(Number(added?.units)).toBe(1);
    expect(Number(added?.salesNet)).toBe(5);

    const diagnostics = await prisma.autopartImportDiagnostic.findMany({
      where: { importRunId: historic.runId },
    });
    expect(diagnostics.map((row) => row.reasonCode).sort()).toEqual([
      "PROTECTED_ONGOING_DOCUMENT",
      "PROTECTED_ONGOING_LINE",
    ]);
    expect(diagnostics.every((row) => row.status === "SKIPPED" && row.isWarning)).toBe(true);
    expect(diagnostics.find((row) => row.reasonCode === "PROTECTED_ONGOING_LINE")?.reason).toContain(reference);

    const run = await prisma.autopartCustomerImportRun.findUniqueOrThrow({ where: { id: historic.runId } });
    const issues = run.issues as Array<{ code: string; severity: string }>;
    expect(issues.some((issue) => issue.code === "PROTECTED_ONGOING_RECORD" && issue.severity === "WARNING")).toBe(
      true,
    );
  });

  it("imports an ordinary document in the same run as a protected one", async () => {
    const protectedRef = `MIX${String(stamp).slice(-6)}`;
    const plainRef = `PLN${String(stamp).slice(-6)}`;
    const trmSku = `MIX-${String(stamp).slice(-5)}`;
    const plainSku = `PLN-${String(stamp).slice(-5)}`;
    await confirmAutopartTrm21qcImport(adminId, {
      text: trmFile(protectedRef, trmSku, "1", "7.00"),
      filename: "TRM21QC-mix.csv",
      source: "MANUAL",
    });
    const file561l = `Acct.,Inv & Ln,Part Number,Description,Units,Sales
${account},I/${protectedRef}/1,REPLACED,Blocked,8,80.00
${account},I/${plainRef}/1,${plainSku},Plain,2,12.00
`;
    const fileSlrb = `A/C,Type,Ref,Date,Tot Goods,Tot VAT,Total,Run Bal
${account},INV,${protectedRef},15 Oct 26,80.00,0.00,80.00,80.00
${account},INV,${plainRef},15 Oct 26,12.00,0.00,12.00,12.00
`;
    const result = await confirmAutopartHistoryImport(adminId, {
      companyId,
      file561l,
      fileSlrb,
      filename561l: "561L-MIX.CSV",
      filenameSlrb: "SLRB-MIX.CSV",
    });
    expect(result.status).toBe("COMMITTED");
    const blocked = await prisma.autopartSalesLine.findFirstOrThrow({
      where: { documentReference: protectedRef, source: "ONGOING_TRM21QC" },
    });
    expect(blocked.sku).toBe(trmSku);
    expect(Number(blocked.salesNet)).toBe(7);
    const plain = await prisma.autopartSalesLine.findFirstOrThrow({
      where: { companyId, documentReference: plainRef },
    });
    expect(plain.sku).toBe(plainSku);
    expect(plain.source).toBe("561L");
    expect(Number(plain.salesNet)).toBe(12);
  });

  it("lets the ongoing feed replace a historical line, then keeps that feed line on the next historical import", async () => {
    const reference = `AFT${String(stamp).slice(-6)}`;
    const sku = `AFT-${String(stamp).slice(-5)}`;
    await confirmAutopartHistoryImport(adminId, {
      companyId,
      ...historyFiles({
        reference,
        goods: "10.00",
        lines: [{ line: 1, sku, units: "1", sales: "10.00" }],
      }),
      filename561l: "561L-BEFORE.CSV",
      filenameSlrb: "SLRB-BEFORE.CSV",
    });

    const trm = await confirmAutopartTrm21qcImport(adminId, {
      text: trmFile(reference, sku, "4", "40.00"),
      filename: "TRM21QC-after.csv",
      source: "MANUAL",
    });
    expect(trm.status).toBe("COMMITTED");
    const fed = await prisma.autopartSalesLine.findFirstOrThrow({
      where: { companyId, documentReference: reference, lineNumber: 1 },
    });
    expect(fed.source).toBe("ONGOING_TRM21QC");
    expect(Number(fed.units)).toBe(4);
    expect(Number(fed.salesNet)).toBe(40);
    const fingerprint = fed.sourceFingerprint;
    const runId = fed.importRunId;

    await confirmAutopartHistoryImport(adminId, {
      companyId,
      ...historyFiles({
        reference,
        goods: "90.00",
        lines: [{ line: 1, sku: "OTHER", units: "9", sales: "90.00" }],
      }),
      filename561l: "561L-AFTER.CSV",
      filenameSlrb: "SLRB-AFTER.CSV",
    });
    const kept = await prisma.autopartSalesLine.findFirstOrThrow({
      where: { companyId, documentReference: reference, lineNumber: 1 },
    });
    expect(kept.source).toBe("ONGOING_TRM21QC");
    expect(Number(kept.units)).toBe(4);
    expect(Number(kept.salesNet)).toBe(40);
    expect(kept.sku).toBe(sku);
    expect(kept.sourceFingerprint).toBe(fingerprint);
    expect(kept.importRunId).toBe(runId);
  });

  it("keeps 504 goods when a later historical file repeats the document", async () => {
    const reference = `GDS${String(stamp).slice(-6)}`;
    const sku = `GDS-${String(stamp).slice(-5)}`;
    await confirmAutopartHistoryImport(adminId, {
      companyId,
      ...historyFiles({
        reference,
        goods: "10.00",
        vat: "2.00",
        total: "12.00",
        lines: [{ line: 1, sku, units: "1", sales: "10.00" }],
      }),
      filename561l: "561L-GOODS.CSV",
      filenameSlrb: "SLRB-GOODS.CSV",
    });
    await confirmAutopart504Import(adminId, {
      text: report504(reference, "80.00"),
      filename: "504-goods.csv",
      source: "MANUAL",
    });
    const protectedHeader = await prisma.autopartSalesDocument.findFirstOrThrow({
      where: { companyId, documentReference: reference },
    });
    expect(Number(protectedHeader.goodsNet)).toBe(80);
    expect(protectedHeader.has504).toBe(true);

    await confirmAutopartHistoryImport(adminId, {
      companyId,
      ...historyFiles({
        reference,
        goods: "10.00",
        vat: "2.00",
        total: "12.00",
        lines: [{ line: 1, sku, units: "6", sales: "60.00" }],
      }),
      filename561l: "561L-GOODS-2.CSV",
      filenameSlrb: "SLRB-GOODS-2.CSV",
    });
    const after = await prisma.autopartSalesDocument.findFirstOrThrow({
      where: { id: protectedHeader.id },
      include: { lines: true },
    });
    expect(Number(after.goodsNet)).toBe(80);
    expect(after.vat?.toString()).toBe(protectedHeader.vat?.toString());
    expect(after.grossTotal?.toString()).toBe(protectedHeader.grossTotal?.toString());
    expect(after.source).toBe(protectedHeader.source);
    expect(after.importRunId).toBe(protectedHeader.importRunId);
    expect(after.has504).toBe(true);
    expect(after.customerOrderNumber).toBe("FBA-1");
    expect(Number(after.lines[0]?.units)).toBe(6);
    expect(after.lines[0]?.source).toBe("561L");
  });

  it("refuses a direct historical update of a TRM21QC line at write time", async () => {
    const reference = `LCK${String(stamp).slice(-6)}`;
    const sku = `LCK-${String(stamp).slice(-5)}`;
    await confirmAutopartTrm21qcImport(adminId, {
      text: trmFile(reference, sku, "2", "8.00"),
      filename: "TRM21QC-lock.csv",
      source: "MANUAL",
    });
    const line = await prisma.autopartSalesLine.findFirstOrThrow({
      where: { documentReference: reference, source: "ONGOING_TRM21QC" },
    });
    const historicRun = await prisma.autopartCustomerImportRun.create({
      data: {
        companyId,
        type: "HISTORY_561L_SLRB",
        status: "COMMITTED",
        filename: "direct.csv",
        dryRun: false,
      },
    });
    await expect(
      prisma.autopartSalesLine.update({
        where: { id: line.id },
        data: {
          source: "561L",
          units: "99",
          salesNet: "99.00",
          sku: "CHANGED",
          importRunId: historicRun.id,
        },
      }),
    ).rejects.toThrow();
    const kept = await prisma.autopartSalesLine.findUniqueOrThrow({ where: { id: line.id } });
    expect(kept.source).toBe("ONGOING_TRM21QC");
    expect(kept.sku).toBe(sku);
    expect(Number(kept.units)).toBe(2);
    expect(Number(kept.salesNet)).toBe(8);
    expect(kept.importRunId).toBe(line.importRunId);
  });
});
