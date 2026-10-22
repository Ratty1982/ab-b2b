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
  confirmAutopart504Import,
  confirmAutopartTrm21qcImport,
  listOngoingSalesImportRuns,
  resolveCompanyByAutopartCode,
} from "@/server/companies/autopart-ongoing-sales";
import { processOngoingSalesEmailBatch } from "@/server/companies/autopart-ongoing-sales-poll";

const prisma = new PrismaClient();
const stamp = Date.now().toString(36).toUpperCase();
const accountA = `IA${stamp}`.slice(0, 12);
const accountB = `IB${stamp}`.slice(0, 12);
const aliasA = `AL${stamp}`.slice(0, 12);
const sku = `ISK${stamp}`.slice(0, 16);
const references: string[] = [];
const extraCompanyIds: string[] = [];
const orderIds: string[] = [];
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
  await prisma.customerSalesCutover.createMany({
    data: [companyAId, companyBId].map((companyId) => ({
      companyId,
      historyStatus: "COMPLETE" as const,
      completedAt: new Date(),
      evidence: { kind: "NO_HISTORICAL_SALES" },
    })),
  });
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
    const companyIds = [companyAId, companyBId, ...extraCompanyIds].filter(Boolean);
    if (companyIds.length) {
      await prisma.invoice.deleteMany({ where: { companyId: { in: companyIds } } });
    }
    if (orderIds.length) await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
    await prisma.autopartAccount.deleteMany({ where: { companyId: { in: [companyAId, companyBId, ...extraCompanyIds] } } });
    await prisma.autopartCustomerImportRun.deleteMany({ where: { createdById: adminId } });
    await prisma.company.deleteMany({
      where: { id: { in: [companyAId, companyBId, ...extraCompanyIds].filter(Boolean) } },
    });
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
    expect(
      await prisma.autopartSalesDocument.count({ where: { documentReference: document, hasTrm21qc: true } }),
    ).toBe(0);
    expect(
      await prisma.autopartSalesLine.count({ where: { documentReference: document, source: "ONGOING_TRM21QC" } }),
    ).toBe(0);
    const skipped = await prisma.autopartImportDiagnostic.findMany({
      where: { importRunId: imported.id, reasonCode: "UNMAPPED_CUSTOMER" },
    });
    expect(skipped.length).toBeGreaterThan(0);

    const replay = await confirmAutopartTrm21qcImport(adminId, {
      text: trm([{ account: unknown, document, qty: "3", sales: "16.00" }]),
      filename: "TRM21QC-unmapped.csv",
      source: "MANUAL",
    });
    expect(replay.status).toBe("COMMITTED");
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

  it("keeps an unresolved account off a company-owned ongoing document", async () => {
    const document = reference("O");
    const unknown = `UB${stamp}`.slice(0, 12);
    const ongoing = await prisma.autopartSalesDocument.create({
      data: {
        companyId: companyAId,
        autopartCustomerCode: accountA,
        documentType: "INVOICE",
        documentReference: document,
        goodsNet: "16.00",
        source: "ONGOING_504",
        has504: true,
      },
    });
    await prisma.autopartSalesLine.create({
      data: {
        companyId: companyAId,
        documentId: ongoing.id,
        autopartCustomerCode: accountA,
        documentType: "INVOICE",
        documentReference: document,
        lineNumber: 1,
        sku,
        units: "2",
        salesNet: "16.00",
        source: "ONGOING_TRM21QC",
      },
    });
    const imported = await confirmAutopartTrm21qcImport(adminId, {
      text: trm([{ account: unknown, document, qty: "9", sales: "90.00" }]),
      filename: "TRM21QC-unresolved-owner.csv",
      source: "MANUAL",
    });
    expect(imported.status).toBe("COMMITTED");
    expect(
      await prisma.autopartImportDiagnostic.count({
        where: { importRunId: imported.id, reasonCode: "UNMAPPED_CUSTOMER" },
      }),
    ).toBeGreaterThan(0);
    const kept = await prisma.autopartSalesDocument.findFirstOrThrow({
      where: { id: ongoing.id },
      include: { lines: true },
    });
    expect(kept.companyId).toBe(companyAId);
    expect(kept.autopartCustomerCode).toBe(accountA);
    expect(kept.goodsNet?.toString()).toBe("16");
    expect(kept.lines).toHaveLength(1);
    expect(kept.lines[0]?.companyId).toBe(companyAId);
    expect(Number(kept.lines[0]?.units)).toBe(2);
  });

  it("does not attach a verified customer to an unassigned document for a different account", async () => {
    const document = reference("N");
    const ongoing = await prisma.autopartSalesDocument.create({
      data: {
        companyId: null,
        autopartCustomerCode: accountA,
        documentType: "INVOICE",
        documentReference: document,
        goodsNet: "11.00",
        source: "ONGOING_TRM21QC",
        hasTrm21qc: true,
      },
    });
    await prisma.autopartSalesLine.create({
      data: {
        companyId: null,
        documentId: ongoing.id,
        autopartCustomerCode: accountA,
        documentType: "INVOICE",
        documentReference: document,
        lineNumber: 1,
        sku,
        units: "4",
        salesNet: "11.00",
        source: "ONGOING_TRM21QC",
      },
    });
    const imported = await confirmAutopartTrm21qcImport(adminId, {
      text: trm([{ account: accountB, document, qty: "8", sales: "80.00" }]),
      filename: "TRM21QC-verified-other.csv",
      source: "MANUAL",
    });
    expect((imported.diagnostics as { attentionRequired?: boolean }).attentionRequired).toBe(true);
    const kept = await prisma.autopartSalesDocument.findFirstOrThrow({
      where: { id: ongoing.id },
      include: { lines: true },
    });
    expect(kept.companyId).toBeNull();
    expect(kept.autopartCustomerCode).toBe(accountA);
    expect(Number(kept.lines[0]?.units)).toBe(4);
    expect(kept.lines[0]?.companyId).toBeNull();
    expect(await prisma.autopartSalesLine.count({ where: { documentReference: document, companyId: companyBId } })).toBe(0);
  });

  it("distinguishes an unverified stored code and a linked 407EXP account from a verified code", async () => {
    const storedCode = `SC${stamp}`.slice(0, 12);
    const linkedCode = `EX${stamp}`.slice(0, 12);
    const storedCompany = await prisma.company.create({
      data: {
        name: `Unverified ${stamp}`,
        status: "ACTIVE",
        paymentTerms: "30 Days",
        autopartCustomerCode: storedCode,
      },
    });
    extraCompanyIds.push(storedCompany.id);
    const stored = await resolveCompanyByAutopartCode(storedCode);
    expect(stored.authority).toBe("stored-code");
    expect(stored.companyId).toBe(storedCompany.id);
    expect(storedCompany.autopartCustomerCodeVerifiedAt).toBeNull();
    const verified = await resolveCompanyByAutopartCode(accountA);
    expect(verified.authority).toBe("verified-code");

    await prisma.autopartAccount.create({
      data: {
        sourceSystem: "AUTOPART",
        accountCode: linkedCode,
        originalName: `Master ${stamp}`,
        classification: "TRADE_CANDIDATE",
        companyId: companyBId,
        portalEligible: false,
      },
    });
    const linked = await resolveCompanyByAutopartCode(linkedCode);
    expect(linked.authority).toBe("account-link");
    expect(linked.companyId).toBe(companyBId);
    const stillIneligible = await prisma.autopartAccount.findFirstOrThrow({
      where: { accountCode: linkedCode },
    });
    expect(stillIneligible.portalEligible).toBe(false);

    const document = reference("V");
    const ongoing = await prisma.autopartSalesDocument.create({
      data: {
        companyId: companyAId,
        autopartCustomerCode: accountA,
        documentType: "INVOICE",
        documentReference: document,
        goodsNet: "21.00",
        source: "ONGOING_504",
        has504: true,
      },
    });
    await prisma.autopartSalesLine.create({
      data: {
        companyId: companyAId,
        documentId: ongoing.id,
        autopartCustomerCode: accountA,
        documentType: "INVOICE",
        documentReference: document,
        lineNumber: 1,
        sku,
        units: "3",
        salesNet: "21.00",
        source: "ONGOING_TRM21QC",
      },
    });
    for (const account of [storedCode, linkedCode]) {
      const imported = await confirmAutopartTrm21qcImport(adminId, {
        text: trm([{ account, document, qty: "6", sales: "60.00" }]),
        filename: `TRM21QC-${account}.csv`,
        source: "MANUAL",
      });
      expect(
        await prisma.autopartImportDiagnostic.count({
          where: {
            importRunId: imported.id,
            reasonCode: { in: ["UNMAPPED_CUSTOMER", "OWNERSHIP_NOT_UNIQUE"] },
          },
        }),
      ).toBeGreaterThan(0);
    }
    const kept = await prisma.autopartSalesDocument.findFirstOrThrow({
      where: { id: ongoing.id },
      include: { lines: true },
    });
    expect(kept.companyId).toBe(companyAId);
    expect(kept.autopartCustomerCode).toBe(accountA);
    expect(kept.goodsNet?.toString()).toBe("21");
    expect(kept.lines).toHaveLength(1);
    expect(Number(kept.lines[0]?.units)).toBe(3);
    expect(kept.lines[0]?.companyId).toBe(companyAId);
  });

  it("reconciles 504 and TRM21QC for the same verified customer and leaves the other company unchanged", async () => {
    const document = reference("R");
    const historic = await prisma.autopartSalesDocument.create({
      data: {
        companyId: companyBId,
        autopartCustomerCode: accountB,
        documentType: "INVOICE",
        documentReference: document,
        goodsNet: "40.00",
        source: "SLRB",
      },
    });
    await prisma.autopartSalesLine.create({
      data: {
        companyId: companyBId,
        documentId: historic.id,
        autopartCustomerCode: accountB,
        documentType: "INVOICE",
        documentReference: document,
        lineNumber: 1,
        sku,
        units: "4",
        salesNet: "40.00",
        source: "561L",
      },
    });
    const orderNumber = `AB-${String(Date.now())}`;
    const order = await prisma.order.create({
      data: {
        orderNumber,
        companyId: companyAId,
        status: "CONFIRMED",
        subtotal: 16,
        vatTotal: 3.2,
        deliveryTotal: 0,
        grandTotal: 19.2,
        placedAt: new Date(),
        autopartCustomerCodeSnapshot: accountA,
        autopartAccountLinked: true,
        autopartExportStatus: "EXPORTED",
        deliveryAddress: { line1: "1 High Street", town: "Leeds", postcode: "LS1 1AA", country: "GB" },
        contactSnapshot: { name: "Alex Buyer", email: `buyer-${stamp}@example.test`, phone: "01130000000" },
      },
    });
    orderIds.push(order.id);
    const feed = await confirmAutopart504Import(adminId, {
      text: `Type,Document,Date,Time,Customer Name,Goods,VAT,Value,Inits,Customer Order Number
ACCOUNT,${document},14/10/2026,13:05,IDENTITY A,16.00,3.20,19.20,WR,${orderNumber}
`,
      filename: "504-same-customer.csv",
      source: "MANUAL",
    });
    expect(feed.status).toBe("COMMITTED");
    const lines = await confirmAutopartTrm21qcImport(adminId, {
      text: trm([{ account: aliasA, document, qty: "2", sales: "16.00" }]),
      filename: "TRM21QC-same-customer.csv",
      source: "MANUAL",
    });
    expect(lines.status).toBe("COMMITTED");
    expect((lines.diagnostics as { attentionRequired?: boolean }).attentionRequired).toBe(false);
    const reconciled = await prisma.autopartSalesDocument.findFirstOrThrow({
      where: { documentReference: document, companyId: companyAId, has504: true },
      include: { lines: true },
    });
    expect(reconciled.hasTrm21qc).toBe(true);
    expect(Number(reconciled.goodsNet)).toBe(16);
    expect(reconciled.lines).toHaveLength(1);
    expect(reconciled.lines[0]?.companyId).toBe(companyAId);
    expect(Number(reconciled.lines[0]?.units)).toBe(2);
    const other = await prisma.autopartSalesDocument.findFirstOrThrow({
      where: { id: historic.id },
      include: { lines: true },
    });
    expect(other.companyId).toBe(companyBId);
    expect(other.goodsNet?.toString()).toBe("40");
    expect(other.has504).toBe(false);
    expect(other.lines).toHaveLength(1);
    expect(other.lines[0]?.source).toBe("561L");
    expect(Number(other.lines[0]?.units)).toBe(4);
  });
});
