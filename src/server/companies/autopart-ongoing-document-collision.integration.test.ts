/**
 * Ongoing 504/TRM imports must not turn a historical document into the ongoing identity
 * when an authoritative ongoing document already exists.
 *
 * Requires TEST_DATABASE_URL. Refuses the application database.
 */
import "@/server/testing/use-protect-integration-database";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { bootstrapRbac } from "../../../prisma/bootstrap/rbac";
import { linkAndVerifyCompanyAutopartCustomerCode } from "@/server/companies/autopart-account";
import {
  confirmAutopart504Import,
  confirmAutopartTrm21qcImport,
} from "@/server/companies/autopart-ongoing-sales";
import { readOngoingSalesSafetyReport } from "@/server/companies/autopart-ongoing-sales-safety";

const prisma = new PrismaClient();
const stamp = Date.now().toString(36).toUpperCase();
const reference = `SS${stamp}`.slice(0, 16);
const accountA = `CA${stamp}`.slice(0, 12);
const accountB = `CB${stamp}`.slice(0, 12);
const sku = `CSK${stamp}`.slice(0, 16);
const createdCompanyIds: string[] = [];
let adminId = "";
let companyAId = "";
let companyBId = "";

function trm(account: string, qty: string, sales: string) {
  return `Cust,Group,Document,Date,Part Number,Description,Qty,Sales,Cost,Margin,Perc%
${account},GRP,${reference},14/10/2026,${sku},Collision part,${qty},${sales},4.00,1.00,10.000
`;
}

beforeAll(async () => {
  await bootstrapRbac(prisma);
  const admin = await prisma.user.create({
    data: {
      email: `doc-collision.${stamp}@example.invalid`,
      name: "Document collision",
      status: "ACTIVE",
      actorType: "INTERNAL",
      emailVerified: true,
    },
  });
  adminId = admin.id;
  const role = await prisma.role.findUniqueOrThrow({ where: { key: "SUPER_ADMIN" } });
  await prisma.userRole.create({ data: { userId: adminId, roleId: role.id } });
  const companyA = await prisma.company.create({
    data: { name: `Collision A ${stamp}`, status: "ACTIVE", paymentTerms: "30 Days" },
  });
  const companyB = await prisma.company.create({
    data: { name: `Collision B ${stamp}`, status: "ACTIVE", paymentTerms: "30 Days" },
  });
  companyAId = companyA.id;
  companyBId = companyB.id;
  createdCompanyIds.push(companyAId, companyBId);
  await linkAndVerifyCompanyAutopartCustomerCode(adminId, { companyId: companyAId, code: accountA });
  await linkAndVerifyCompanyAutopartCustomerCode(adminId, { companyId: companyBId, code: accountB });

  const historicA = await prisma.autopartSalesDocument.create({
    data: {
      companyId: companyAId,
      autopartCustomerCode: accountA,
      documentType: "INVOICE",
      documentReference: reference,
      goodsNet: "10.00",
      vat: "2.00",
      grossTotal: "12.00",
      source: "SLRB",
    },
  });
  await prisma.autopartSalesLine.create({
    data: {
      companyId: companyAId,
      documentId: historicA.id,
      autopartCustomerCode: accountA,
      documentType: "INVOICE",
      documentReference: reference,
      lineNumber: 1,
      sku,
      units: "1",
      salesNet: "10.00",
      source: "561L",
    },
  });
  await prisma.autopartSalesDocument.create({
    data: {
      companyId: companyBId,
      autopartCustomerCode: accountB,
      documentType: "INVOICE",
      documentReference: reference,
      goodsNet: "80.00",
      vat: "16.00",
      grossTotal: "96.00",
      source: "SLRB",
    },
  });
  await prisma.autopartSalesDocument.create({
    data: {
      companyId: null,
      autopartCustomerCode: "UNKNOWN",
      documentType: "INVOICE",
      documentReference: reference,
      goodsNet: "16.00",
      vat: "3.20",
      grossTotal: "19.20",
      source: "ONGOING_504",
      has504: true,
      hasTrm21qc: false,
    },
  });
}, 120_000);

afterAll(async () => {
  try {
    await prisma.autopartSalesLine.deleteMany({ where: { documentReference: reference } });
    await prisma.autopartSalesDocument.deleteMany({ where: { documentReference: reference } });
    await prisma.autopartImportDiagnostic.deleteMany({ where: { documentReference: reference } });
    await prisma.company.deleteMany({ where: { id: { in: createdCompanyIds } } });
    await prisma.user.deleteMany({ where: { id: adminId } });
  } finally {
    await prisma.$disconnect();
  }
});

describe("ongoing document collision", () => {
  it("attaches TRM lines to the ongoing document and leaves both historical companies unchanged", async () => {
    const first = await confirmAutopartTrm21qcImport(adminId, {
      text: trm(accountA, "3", "16.00"),
      filename: "TRM21QC_20261014.csv",
      source: "MANUAL",
    });
    expect(first.status).toBe("COMMITTED");

    const rows = await prisma.autopartSalesDocument.findMany({
      where: { documentReference: reference },
      include: { lines: true },
      orderBy: { goodsNet: "asc" },
    });
    expect(rows).toHaveLength(3);
    const historicA = rows.find((row) => row.companyId === companyAId && row.source === "SLRB");
    const historicB = rows.find((row) => row.companyId === companyBId);
    const ongoing = rows.find((row) => row.has504);
    expect(historicA?.goodsNet?.toString()).toBe("10");
    expect(historicA?.hasTrm21qc).toBe(false);
    expect(historicA?.lines.map((line) => [line.source, Number(line.units)])).toEqual([["561L", 1]]);
    expect(historicB?.goodsNet?.toString()).toBe("80");
    expect(historicB?.lines).toHaveLength(0);
    expect(ongoing?.companyId).toBeNull();
    expect(ongoing?.autopartCustomerCode).toBe(accountA);
    expect(ongoing?.hasTrm21qc).toBe(true);
    expect(ongoing?.goodsNet?.toString()).toBe("16");
    expect(ongoing?.lines).toHaveLength(1);
    expect(ongoing?.lines[0]?.source).toBe("ONGOING_TRM21QC");
    expect(Number(ongoing?.lines[0]?.units)).toBe(3);
    if (!ongoing || !historicA || !historicB) throw new Error("expected historic and ongoing documents");
    const ongoingId = ongoing.id;
    const historicAId = historicA.id;
    const historicBId = historicB.id;

    const replay = await confirmAutopartTrm21qcImport(adminId, {
      text: trm(accountA, "3", "16.00"),
      filename: "TRM21QC_20261014.csv",
      source: "MANUAL",
    });
    expect(replay.status).toBe("COMMITTED");
    expect(await prisma.autopartSalesLine.count({ where: { documentId: ongoingId, source: "ONGOING_TRM21QC" } })).toBe(1);
    expect(await prisma.autopartSalesLine.count({ where: { documentReference: reference, source: "561L" } })).toBe(1);

    const otherCustomer = await confirmAutopartTrm21qcImport(adminId, {
      text: trm(accountB, "9", "80.00"),
      filename: "TRM21QC_other_customer.csv",
      source: "MANUAL",
    });
    expect(otherCustomer.status).toBe("COMMITTED");
    const diagnostics = await prisma.autopartImportDiagnostic.findMany({
      where: { importRunId: otherCustomer.id, documentReference: reference },
    });
    expect(diagnostics.some((row) => row.reasonCode === "ONGOING_DOCUMENT_CONFLICT" && row.reason?.includes(reference))).toBe(
      true,
    );
    const ongoingAfter = await prisma.autopartSalesDocument.findFirstOrThrow({
      where: { id: ongoingId },
      include: { lines: true },
    });
    expect(ongoingAfter.companyId).toBeNull();
    expect(ongoingAfter.autopartCustomerCode).toBe(accountA);
    expect(ongoingAfter.lines).toHaveLength(1);
    expect(Number(ongoingAfter.lines[0]?.units)).toBe(3);
    expect((await prisma.autopartSalesDocument.findFirstOrThrow({ where: { id: historicBId } })).goodsNet?.toString()).toBe(
      "80",
    );

    const feed = await confirmAutopart504Import(adminId, {
      text: `Type,Document,Date,Time,Customer Name,Goods,VAT,Value,Inits,Customer Order Number
ACCOUNT,${reference},14/10/2026,13:05,COLLISION A,18.00,3.60,21.60,WR,PO-KEEP
`,
      filename: "504.csv",
      source: "MANUAL",
    });
    expect(feed.status).toBe("COMMITTED");
    const after504 = await prisma.autopartSalesDocument.findMany({ where: { documentReference: reference } });
    expect(after504.find((row) => row.id === ongoingId)?.goodsNet?.toString()).toBe("18");
    expect(after504.find((row) => row.id === historicAId)?.goodsNet?.toString()).toBe("10");
    expect(after504.find((row) => row.id === historicBId)?.goodsNet?.toString()).toBe("80");

    const report = await readOngoingSalesSafetyReport(adminId);
    expect(report.readOnly).toBe(true);
    expect(report.appliesChanges).toBe(false);
    expect(report.recovery.targetFile).toBe("TRM21QC_20261014.csv");
    expect(report.collisions.total).toBeGreaterThanOrEqual(report.collisions.shown.length);
    expect(report.collisions.shown.some((row) => row.documentReference === reference && row.historicalCount >= 2)).toBe(
      true,
    );
    expect(report.coverageNote).toContain("Showing");
    expect(report.attentionImports.total).toBeGreaterThanOrEqual(report.attentionImports.shown.length);
    expect(report.undispatchedOrders.candidateTotal).toBeGreaterThanOrEqual(report.undispatchedOrders.inspected);
    expect(report.sharedHistoricalNote).toContain("not duplicates");
  }, 120_000);
});
