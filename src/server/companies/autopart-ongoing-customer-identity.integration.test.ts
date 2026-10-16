/**
 * Unmapped and mixed-customer 504/TRM imports must not inherit another customer's sales.
 *
 * Requires TEST_DATABASE_URL. Refuses the application database.
 */
import "@/server/testing/use-protect-integration-database";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { bootstrapRbac } from "../../../prisma/bootstrap/rbac";
import { ongoingSalesReportContentHash } from "@/domain/autopart-ongoing-sales-attachment";
import { linkAndVerifyCompanyAutopartCustomerCode } from "@/server/companies/autopart-account";
import {
  confirmAutopartTrm21qcImport,
  listOngoingSalesImportRuns,
} from "@/server/companies/autopart-ongoing-sales";
import { processOngoingSalesEmailBatch } from "@/server/companies/autopart-ongoing-sales-poll";

const prisma = new PrismaClient();
const stamp = Date.now().toString(36).toUpperCase();
const accountA = `IA${stamp}`.slice(0, 12);
const accountB = `IB${stamp}`.slice(0, 12);
const aliasA = `AL${stamp}`.slice(0, 12);
const sku = `ISK${stamp}`.slice(0, 16);
const references: string[] = [];
let adminId = "";
let companyAId = "";
let companyBId = "";

function reference(label: string) {
  const value = `SS${label}${stamp}`.slice(0, 16);
  references.push(value);
  return value;
}

function trm(lines: Array<{ account: string; document: string; qty: string; sales: string; sku?: string; description?: string }>) {
  return `Cust,Group,Document,Date,Part Number,Description,Qty,Sales,Cost,Margin,Perc%
${lines
  .map(
    (line) =>
      `${line.account},GRP,${line.document},14/10/2026,${line.sku ?? sku},${line.description ?? "Identity part"},${line.qty},${line.sales},4.00,1.00,10.000`,
  )
  .join("\n")}
`;
}

function email(filename: string, text: string) {
  return {
    uid: `uid-${filename}-${stamp}`,
    messageId: `<${filename}-${stamp}@example.invalid>`,
    from: "reports@example.invalid",
    subject: "TRM21QC",
    receivedAt: new Date(),
    attachments: [{ filename, content: Buffer.from(text), contentType: "text/csv" }],
  };
}

beforeAll(async () => {
  await bootstrapRbac(prisma);
  const admin = await prisma.user.create({
    data: {
      email: `customer-identity.${stamp}@example.invalid`,
      name: "Customer identity",
      status: "ACTIVE",
      actorType: "INTERNAL",
      emailVerified: true,
    },
  });
  adminId = admin.id;
  const role = await prisma.role.findUniqueOrThrow({ where: { key: "SUPER_ADMIN" } });
  await prisma.userRole.create({ data: { userId: adminId, roleId: role.id } });
  const companyA = await prisma.company.create({
    data: { name: `Identity A ${stamp}`, status: "ACTIVE", paymentTerms: "30 Days" },
  });
  const companyB = await prisma.company.create({
    data: { name: `Identity B ${stamp}`, status: "ACTIVE", paymentTerms: "30 Days" },
  });
  companyAId = companyA.id;
  companyBId = companyB.id;
  await linkAndVerifyCompanyAutopartCustomerCode(adminId, { companyId: companyAId, code: accountA });
  await linkAndVerifyCompanyAutopartCustomerCode(adminId, { companyId: companyBId, code: accountB });
  await prisma.autopartCustomerAccountAlias.create({
    data: { companyId: companyAId, alias: aliasA, verifiedById: adminId },
  });
}, 120_000);

afterAll(async () => {
  try {
    if (references.length) {
      await prisma.autopartSalesLine.deleteMany({ where: { documentReference: { in: references } } });
      await prisma.autopartSalesDocument.deleteMany({ where: { documentReference: { in: references } } });
      await prisma.autopartImportDiagnostic.deleteMany({ where: { documentReference: { in: references } } });
    }
    await prisma.autopartCustomerImportRun.deleteMany({ where: { createdById: adminId } });
    await prisma.company.deleteMany({ where: { id: { in: [companyAId, companyBId].filter(Boolean) } } });
    await prisma.user.deleteMany({ where: { id: adminId } });
  } finally {
    await prisma.$disconnect();
  }
});

describe("ongoing customer identity", () => {
  it("does not let an unresolved TRM inherit the only historical company", async () => {
    const document = reference("U");
    const unknown = `UX${stamp}`.slice(0, 12);
    const historic = await prisma.autopartSalesDocument.create({
      data: {
        companyId: companyAId,
        autopartCustomerCode: accountA,
        documentType: "INVOICE",
        documentReference: document,
        goodsNet: "10.00",
        source: "SLRB",
      },
    });
    await prisma.autopartSalesLine.create({
      data: {
        companyId: companyAId,
        documentId: historic.id,
        autopartCustomerCode: accountA,
        documentType: "INVOICE",
        documentReference: document,
        lineNumber: 1,
        sku,
        units: "1",
        salesNet: "10.00",
        source: "561L",
      },
    });

    const imported = await confirmAutopartTrm21qcImport(adminId, {
      text: trm([{ account: unknown, document, qty: "3", sales: "16.00" }]),
      filename: "TRM21QC-unmapped.csv",
      source: "MANUAL",
    });
    expect(imported.status).toBe("COMMITTED");
    const diagnostics = imported.diagnostics as { attentionRequired?: boolean };
    expect(diagnostics.attentionRequired).toBe(false);

    const kept = await prisma.autopartSalesDocument.findFirstOrThrow({
      where: { id: historic.id },
      include: { lines: true },
    });
    expect(kept.companyId).toBe(companyAId);
    expect(kept.autopartCustomerCode).toBe(accountA);
    expect(kept.goodsNet?.toString()).toBe("10");
    expect(kept.hasTrm21qc).toBe(false);
    expect(kept.lines.map((line) => [line.source, Number(line.units), line.autopartCustomerCode])).toEqual([
      ["561L", 1, accountA],
    ]);
    const ongoing = await prisma.autopartSalesDocument.findFirstOrThrow({
      where: { documentReference: document, hasTrm21qc: true },
      include: { lines: true },
    });
    expect(ongoing.companyId).toBeNull();
    expect(ongoing.autopartCustomerCode).toBe(unknown);
    expect(ongoing.lines).toHaveLength(1);
    expect(Number(ongoing.lines[0]?.units)).toBe(3);

    const replay = await confirmAutopartTrm21qcImport(adminId, {
      text: trm([{ account: unknown, document, qty: "3", sales: "16.00" }]),
      filename: "TRM21QC-unmapped.csv",
      source: "MANUAL",
    });
    expect(replay.status).toBe("COMMITTED");
    expect(await prisma.autopartSalesLine.count({ where: { documentId: ongoing.id } })).toBe(1);
    expect(await prisma.autopartSalesLine.count({ where: { documentId: historic.id, source: "561L" } })).toBe(1);
  });

  it("rejects a document shared by two customers and keeps each customer's lines", async () => {
    const document = reference("M");
    const historicA = await prisma.autopartSalesDocument.create({
      data: {
        companyId: companyAId,
        autopartCustomerCode: accountA,
        documentType: "INVOICE",
        documentReference: document,
        goodsNet: "10.00",
        source: "SLRB",
      },
    });
    await prisma.autopartSalesLine.create({
      data: {
        companyId: companyAId,
        documentId: historicA.id,
        autopartCustomerCode: accountA,
        documentType: "INVOICE",
        documentReference: document,
        lineNumber: 1,
        sku,
        units: "1",
        salesNet: "10.00",
        source: "561L",
      },
    });
    const historicB = await prisma.autopartSalesDocument.create({
      data: {
        companyId: companyBId,
        autopartCustomerCode: accountB,
        documentType: "INVOICE",
        documentReference: document,
        goodsNet: "80.00",
        source: "SLRB",
      },
    });
    await prisma.autopartSalesLine.create({
      data: {
        companyId: companyBId,
        documentId: historicB.id,
        autopartCustomerCode: accountB,
        documentType: "INVOICE",
        documentReference: document,
        lineNumber: 1,
        sku,
        units: "8",
        salesNet: "80.00",
        source: "561L",
      },
    });

    const text = trm([
      { account: accountA, document, qty: "2", sales: "12.00" },
      { account: accountB, document, qty: "9", sales: "90.00" },
    ]);
    const mixed = await confirmAutopartTrm21qcImport(adminId, {
      text,
      filename: "TRM21QC-mixed.csv",
      source: "MANUAL",
    });
    expect(mixed.status).toBe("COMMITTED");
    const diagnostics = mixed.diagnostics as { attentionRequired?: boolean; attentionReason?: string };
    expect(diagnostics.attentionRequired).toBe(true);
    expect(diagnostics.attentionReason).toContain("Re-upload");
    const rows = await prisma.autopartImportDiagnostic.findMany({ where: { importRunId: mixed.id } });
    expect(rows.every((row) => row.reasonCode === "MIXED_CUSTOMER_DOCUMENT")).toBe(true);
    expect(rows.some((row) => row.reason?.includes(accountA) && row.reason?.includes(accountB))).toBe(true);
    const runs = await listOngoingSalesImportRuns(adminId, 10);
    expect(runs.find((run) => run.id === mixed.id)?.attentionRequired).toBe(true);

    const keptA = await prisma.autopartSalesLine.findFirstOrThrow({ where: { documentId: historicA.id } });
    const keptB = await prisma.autopartSalesLine.findFirstOrThrow({ where: { documentId: historicB.id } });
    expect(Number(keptA.units)).toBe(1);
    expect(keptA.autopartCustomerCode).toBe(accountA);
    expect(Number(keptB.units)).toBe(8);
    expect(keptB.companyId).toBe(companyBId);
    expect(await prisma.autopartSalesLine.count({ where: { documentReference: document, source: "ONGOING_TRM21QC" } })).toBe(
      0,
    );

    const hash = ongoingSalesReportContentHash(text);
    const before = await prisma.autopartCustomerImportRun.count({ where: { fileHash: hash } });
    const poll = await processOngoingSalesEmailBatch({
      emails: [email("TRM21QC-mixed.csv", text)],
      actorUserId: adminId,
      source: "EMAIL",
      autoArchive: false,
    });
    expect(poll.processedTrm21qc).toBe(0);
    expect(poll.duplicatesIgnored).toBe(1);
    expect(await prisma.autopartCustomerImportRun.count({ where: { fileHash: hash } })).toBe(before);

    const again = await confirmAutopartTrm21qcImport(adminId, {
      text,
      filename: "TRM21QC-mixed-replay.csv",
      source: "MANUAL",
    });
    expect((again.diagnostics as { attentionRequired?: boolean }).attentionRequired).toBe(true);
    expect(await prisma.autopartSalesLine.count({ where: { documentReference: document, source: "ONGOING_TRM21QC" } })).toBe(
      0,
    );
    expect(Number((await prisma.autopartSalesLine.findFirstOrThrow({ where: { documentId: historicA.id } })).units)).toBe(1);
    expect(Number((await prisma.autopartSalesLine.findFirstOrThrow({ where: { documentId: historicB.id } })).units)).toBe(8);
  });

  it("imports each customer separately when they share a reference, including repeated SKUs and a verified alias", async () => {
    const document = reference("S");
    const repeatedSku = `IRP${stamp}`.slice(0, 16);
    const first = await confirmAutopartTrm21qcImport(adminId, {
      text: trm([
        { account: accountA, document, qty: "1", sales: "5.00", sku: repeatedSku, description: "Repeat" },
        { account: aliasA, document, qty: "2", sales: "6.00", sku: repeatedSku, description: "Repeat" },
      ]),
      filename: "TRM21QC-alias.csv",
      source: "MANUAL",
    });
    expect(first.status).toBe("COMMITTED");
    expect((first.diagnostics as { attentionRequired?: boolean }).attentionRequired).toBe(false);
    const linesA = await prisma.autopartSalesLine.findMany({
      where: { documentReference: document, companyId: companyAId },
      orderBy: { lineNumber: "asc" },
    });
    expect(linesA).toHaveLength(2);
    expect(new Set(linesA.map((line) => line.lineNumber)).size).toBe(2);
    expect(linesA.every((line) => line.sku === repeatedSku && line.companyId === companyAId)).toBe(true);

    const historicB = await prisma.autopartSalesDocument.create({
      data: {
        companyId: companyBId,
        autopartCustomerCode: accountB,
        documentType: "INVOICE",
        documentReference: document,
        goodsNet: "70.00",
        source: "SLRB",
      },
    });
    await prisma.autopartSalesLine.create({
      data: {
        companyId: companyBId,
        documentId: historicB.id,
        autopartCustomerCode: accountB,
        documentType: "INVOICE",
        documentReference: document,
        lineNumber: 1,
        sku: repeatedSku,
        units: "7",
        salesNet: "70.00",
        source: "561L",
      },
    });
    const second = await confirmAutopartTrm21qcImport(adminId, {
      text: trm([{ account: accountB, document, qty: "9", sales: "90.00", sku: repeatedSku }]),
      filename: "TRM21QC-other.csv",
      source: "MANUAL",
    });
    expect(second.status).toBe("COMMITTED");
    expect((second.diagnostics as { attentionRequired?: boolean }).attentionRequired).toBe(true);
    const conflict = await prisma.autopartImportDiagnostic.findFirst({
      where: { importRunId: second.id, reasonCode: "ONGOING_DOCUMENT_CONFLICT" },
    });
    expect(conflict?.reason).toContain(document);
    const stillA = await prisma.autopartSalesLine.findMany({
      where: { documentReference: document, companyId: companyAId, source: "ONGOING_TRM21QC" },
    });
    expect(stillA.map((line) => Number(line.units)).sort()).toEqual([1, 2]);
    const stillB = await prisma.autopartSalesLine.findFirstOrThrow({ where: { documentId: historicB.id } });
    expect(stillB.companyId).toBe(companyBId);
    expect(Number(stillB.units)).toBe(7);
    expect(stillB.source).toBe("561L");
    expect(stillB.autopartCustomerCode).toBe(accountB);
  });

  it("rejects invoice and credit lines grouped on one reference before writing", async () => {
    const document = reference("C");
    const imported = await confirmAutopartTrm21qcImport(adminId, {
      text: trm([
        { account: accountA, document, qty: "1", sales: "10.00" },
        { account: accountA, document, qty: "-1", sales: "-4.00" },
      ]),
      filename: "TRM21QC-credit-mix.csv",
      source: "MANUAL",
    });
    expect(imported.status).toBe("COMMITTED");
    expect((imported.diagnostics as { attentionRequired?: boolean }).attentionRequired).toBe(true);
    const rows = await prisma.autopartImportDiagnostic.findMany({ where: { importRunId: imported.id } });
    expect(rows.every((row) => row.reasonCode === "MIXED_DOCUMENT_TYPE" && row.reason?.includes(document))).toBe(true);
    expect(await prisma.autopartSalesDocument.count({ where: { documentReference: document } })).toBe(0);
  });

  it("does not create another failure run when mailbox polling sees the same failed file", async () => {
    const document = reference("F");
    const text = trm([{ account: accountA, document, qty: "1", sales: "4.00" }]);
    const hash = ongoingSalesReportContentHash(text);
    await prisma.autopartCustomerImportRun.create({
      data: {
        type: "ONGOING_TRM21QC",
        status: "FAILED",
        filename: "TRM21QC-failed.csv",
        fileHash: hash,
        dryRun: false,
        createdById: adminId,
        issues: { error: "import failed", documentReference: document },
      },
    });
    const poll = await processOngoingSalesEmailBatch({
      emails: [email("TRM21QC-failed.csv", text)],
      actorUserId: adminId,
      source: "EMAIL",
      autoArchive: false,
    });
    expect(poll.processedTrm21qc).toBe(0);
    expect(poll.attachments[0]?.result).toBe("skipped");
    expect(poll.attachments[0]?.skipReason).toContain("already failed");
    expect(await prisma.autopartCustomerImportRun.count({ where: { fileHash: hash } })).toBe(1);
    await processOngoingSalesEmailBatch({
      emails: [email("TRM21QC-failed-again.csv", text)],
      actorUserId: adminId,
      source: "EMAIL",
      autoArchive: false,
    });
    expect(await prisma.autopartCustomerImportRun.count({ where: { fileHash: hash } })).toBe(1);
    expect(await prisma.autopartSalesDocument.count({ where: { documentReference: document } })).toBe(0);
  });
});
