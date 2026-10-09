import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { bootstrapRbac } from "../../../prisma/bootstrap/rbac";
import {
  confirmAutopartImport,
  getAutopartImportBatch,
  previewAutopartImport,
} from "@/server/companies/autopart-master-import";
import { GLOBAL_AUTOPART_SALES_PERIOD } from "@/server/sales-intelligence/history-sources";

const prisma = new PrismaClient();
const stamp = `Q${Date.now().toString(36).slice(-6).toUpperCase()}`;
const invoiceHeader = ".Acct.,Inv & Ln,Part Number,Description,Units,Sales";
const ledgerHeader = "A/C,Name,Sacct,Type,Ref,Date,Tot Goods,,Tot VAT,,Total,Run Bal";

let adminId = "";
let dir = "";
const previousDir = process.env["AUTOPART_IMPORT_DIR"];

type Report = {
  newRecords: number;
  identicalRecords: number;
  ambiguousRecords: number;
  financialConflicts: number;
  rejectedRecords: number;
  expectedStoredTotalChange: string;
  classifiedNewAmount: string;
  storedFinancialTotal: string;
  projectedFinancialTotal: string;
  canCommit: boolean;
  blockedReason: string | null;
  fileHashVerified?: boolean;
  examples: { classification: string; explanation: string }[];
};

function reportOf(batch: { diagnostics: unknown }): Report {
  const diagnostics = batch.diagnostics as { fileHashVerified?: boolean; incremental?: Report };
  if (!diagnostics.incremental) throw new Error("Incremental preview was not recorded");
  if (diagnostics.fileHashVerified === true) {
    return { ...diagnostics.incremental, fileHashVerified: true };
  }
  return diagnostics.incremental;
}

async function stage(
  kind: "INVOICE_LINES" | "LEDGER",
  filename: string,
  text: string,
  fileHash = createHash("sha256").update(text).digest("hex"),
) {
  const filePath = path.join(dir, filename);
  await writeFile(filePath, text, "utf8");
  const batch = await prisma.autopartImportBatch.create({
    data: {
      kind,
      status: "UPLOADED",
      filename,
      fileHash,
      storagePath: filePath,
      dryRun: true,
      createdById: adminId,
    },
  });
  return batch.id;
}

async function commit(batchId: string) {
  const started = await confirmAutopartImport(adminId, batchId);
  expect(started.status).toBe("RUNNING");
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const batch = await getAutopartImportBatch(adminId, batchId);
    if (batch.status === "COMMITTED" || batch.status === "FAILED" || batch.status === "CANCELLED") {
      return batch;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("Autopart import did not finish");
}

function invoice(account: string, reference: string, part: string, description: string, qty: string, sales: string) {
  return `${account},${reference},${part},${description},${qty},${sales}`;
}

function ledger(
  account: string,
  reference: string,
  goods: string,
  vat: string,
  total: string,
  balance: string,
  date = "06 Oct 14",
) {
  return `${account},Hidden,,INV,${reference},${date},${goods},,${vat},,${total},${balance}`;
}

describe("incremental 561L and SLRB integrity", () => {
  beforeAll(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "autopart-incremental-"));
    process.env["AUTOPART_IMPORT_DIR"] = dir;
    await bootstrapRbac(prisma);
    const email = `autopart-incremental.admin.${stamp}@example.invalid`;
    let user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      user = await prisma.user.create({
        data: { email, name: "Incremental admin", status: "ACTIVE", actorType: "INTERNAL", emailVerified: true },
      });
    }
    const role = await prisma.role.findUniqueOrThrow({ where: { key: "SUPER_ADMIN" } });
    await prisma.userRole.upsert({
      where: { userId_roleId: { userId: user.id, roleId: role.id } },
      create: { userId: user.id, roleId: role.id },
      update: {},
    });
    adminId = user.id;
  });

  afterAll(async () => {
    if (previousDir == null) delete process.env["AUTOPART_IMPORT_DIR"];
    else process.env["AUTOPART_IMPORT_DIR"] = previousDir;
    await prisma.autopartInvoiceLine.deleteMany({ where: { accountCode: { startsWith: stamp } } });
    await prisma.autopartLedgerTransaction.deleteMany({
      where: { accountCode: { startsWith: stamp } },
    });
    await prisma.autopartImportBatch.deleteMany({
      where: { createdById: adminId, filename: { contains: stamp } },
    });
    await rm(dir, { recursive: true, force: true });
    await prisma.$disconnect();
  });

  it("keeps the undated historical sales mode available", () => {
    expect(GLOBAL_AUTOPART_SALES_PERIOD.label).toBe("All Available History");
    expect(GLOBAL_AUTOPART_SALES_PERIOD.key).toBe("ALL_AVAILABLE_HISTORY");
  });

  it("1. stores two different products that share an Inv & Ln reference", async () => {
    const account = `${stamp}1`;
    const reference = `I/REF${stamp}/1`;
    const text = [
      invoiceHeader,
      invoice(account, reference, "PART-A", "Pad", "1", "10.00"),
      invoice(account, reference, "PART-B", "Disc", "2", "4.50"),
    ].join("\n");
    const batchId = await stage("INVOICE_LINES", `${stamp}-two-products.csv`, text);
    const preview = reportOf(await previewAutopartImport(adminId, { batchId }));
    expect(preview.canCommit).toBe(true);
    expect(preview.newRecords).toBe(2);
    expect(preview.financialConflicts).toBe(0);
    expect(preview.ambiguousRecords).toBe(0);
    expect(preview.expectedStoredTotalChange).toBe("14.50");
    const committed = await commit(batchId);
    expect(committed.importedRows).toBe(2);
    expect(committed.updatedRows).toBe(0);
    const lines = await prisma.autopartInvoiceLine.findMany({ where: { accountCode: account } });
    expect(lines).toHaveLength(2);
    expect(lines.map((line) => line.partNumber).sort()).toEqual(["PART-A", "PART-B"]);
    expect(lines.every((line) => line.rawInvAndLn === reference)).toBe(true);
  });

  it("2. stores two identical product lines that share a reference", async () => {
    const account = `${stamp}2`;
    const reference = `I/SAME${stamp}/1`;
    const text = [
      invoiceHeader,
      invoice(account, reference, "PART-A", "Pad", "1", "8.00"),
      invoice(account, reference, "PART-A", "Pad", "1", "8.00"),
    ].join("\n");
    const batchId = await stage("INVOICE_LINES", `${stamp}-identical-lines.csv`, text);
    const preview = reportOf(await previewAutopartImport(adminId, { batchId }));
    expect(preview.newRecords).toBe(2);
    expect(preview.identicalRecords).toBe(0);
    expect(preview.expectedStoredTotalChange).toBe("16.00");
    const committed = await commit(batchId);
    expect(committed.importedRows).toBe(2);
    const lines = await prisma.autopartInvoiceLine.findMany({ where: { accountCode: account } });
    expect(lines).toHaveLength(2);
    expect(lines[0]?.sourceIdentity).not.toBe(lines[1]?.sourceIdentity);
    expect(lines.every((line) => line.salesAmount.toFixed(2) === "8.00")).toBe(true);
    expect(lines.every((line) => line.quantity.toFixed(3) === "1.000")).toBe(true);

    const againId = await stage("INVOICE_LINES", `${stamp}-identical-lines-again.csv`, text);
    const again = reportOf(await previewAutopartImport(adminId, { batchId: againId }));
    expect(again.identicalRecords).toBe(2);
    expect(again.newRecords).toBe(0);
    expect(again.expectedStoredTotalChange).toBe("0.00");
    const replayed = await commit(againId);
    expect(replayed.importedRows).toBe(0);
    expect(replayed.updatedRows).toBe(2);
    expect(await prisma.autopartInvoiceLine.count({ where: { accountCode: account } })).toBe(2);
  });

  it("3. keeps one stored row when the same natural key repeats in the next 200-row chunk", async () => {
    const account = `${stamp}3`;
    const first = invoice(account, `I/CH${stamp}/1`, "PART-A", "Pad", "1", "10.00");
    const rows = [invoiceHeader, first];
    for (let index = 2; index <= 200; index += 1) {
      rows.push(invoice(account, `I/CH${stamp}/${index}`, "PART-A", "Pad", "1", "1.00"));
    }
    rows.push(first);
    const batchId = await stage("INVOICE_LINES", `${stamp}-chunk.csv`, rows.join("\n"));
    const preview = reportOf(await previewAutopartImport(adminId, { batchId }));
    expect(preview.newRecords).toBe(200);
    expect(preview.identicalRecords).toBe(1);
    expect(preview.financialConflicts).toBe(0);
    expect(preview.expectedStoredTotalChange).toBe("209.00");
    const committed = await commit(batchId);
    expect(committed.importedRows).toBe(200);
    expect(committed.updatedRows).toBe(1);
    expect(await prisma.autopartInvoiceLine.count({ where: { accountCode: account } })).toBe(200);
    const sum = await prisma.autopartInvoiceLine.aggregate({
      where: { accountCode: account },
      _sum: { salesAmount: true },
    });
    expect(sum._sum.salesAmount?.toFixed(2)).toBe("209.00");
  }, 30000);

  it("4. reimports an identical file without changing stored amounts", async () => {
    const account = `${stamp}4`;
    const reference = `I/FULL${stamp}/1`;
    const original = [invoiceHeader, invoice(account, reference, "PART-A", "Pad", "2", "12.50")].join(
      "\n",
    );
    const batchId = await stage("INVOICE_LINES", `${stamp}-full.csv`, original);
    await previewAutopartImport(adminId, { batchId });
    const imported = await commit(batchId);
    expect(imported.importedRows).toBe(1);
    const renamed = [
      invoiceHeader,
      invoice(account, reference, "PART-A", "Pad renamed", "2", "12.50"),
    ].join("\n");
    const againId = await stage("INVOICE_LINES", `${stamp}-full-again.csv`, renamed);
    const preview = reportOf(await previewAutopartImport(adminId, { batchId: againId }));
    expect(preview.fileHashVerified).toBe(true);
    expect(preview.identicalRecords).toBe(1);
    expect(preview.newRecords).toBe(0);
    expect(preview.expectedStoredTotalChange).toBe("0.00");
    expect(preview.storedFinancialTotal).toBe("12.50");
    expect(preview.projectedFinancialTotal).toBe("12.50");
    const committed = await commit(againId);
    expect(committed.importedRows).toBe(0);
    expect(committed.updatedRows).toBe(1);
    const line = await prisma.autopartInvoiceLine.findFirstOrThrow({ where: { accountCode: account } });
    expect(line.salesAmount.toFixed(2)).toBe("12.50");
    expect(line.quantity.toFixed(3)).toBe("2.000");
    expect(line.partNumber).toBe("PART-A");
    expect(line.description).toBe("Pad renamed");
    expect(await prisma.autopartInvoiceLine.count({ where: { accountCode: account } })).toBe(1);
  });

  it("5. replays part of a file and leaves the omitted lines untouched", async () => {
    const account = `${stamp}5`;
    const full = [
      invoiceHeader,
      invoice(account, `I/P${stamp}/1`, "PART-A", "Pad", "1", "10.00"),
      invoice(account, `I/P${stamp}/2`, "PART-B", "Disc", "1", "5.00"),
    ].join("\n");
    const batchId = await stage("INVOICE_LINES", `${stamp}-partial-base.csv`, full);
    await previewAutopartImport(adminId, { batchId });
    await commit(batchId);
    const partial = [
      invoiceHeader,
      invoice(account, `I/P${stamp}/1`, "PART-A", "Pad replay", "1", "10.00"),
    ].join("\n");
    const partialId = await stage("INVOICE_LINES", `${stamp}-partial.csv`, partial);
    const preview = reportOf(await previewAutopartImport(adminId, { batchId: partialId }));
    expect(preview.identicalRecords).toBe(1);
    expect(preview.newRecords).toBe(0);
    expect(preview.ambiguousRecords).toBe(0);
    expect(preview.expectedStoredTotalChange).toBe("0.00");
    expect(preview.storedFinancialTotal).toBe("15.00");
    const committed = await commit(partialId);
    expect(committed.importedRows).toBe(0);
    expect(committed.updatedRows).toBe(1);
    const lines = await prisma.autopartInvoiceLine.findMany({ where: { accountCode: account } });
    expect(lines).toHaveLength(2);
    const replayed = lines.find((line) => line.partNumber === "PART-A");
    const omitted = lines.find((line) => line.partNumber === "PART-B");
    expect(replayed?.description).toBe("Pad replay");
    expect(replayed?.salesAmount.toFixed(2)).toBe("10.00");
    expect(omitted?.description).toBe("Disc");
    expect(omitted?.salesAmount.toFixed(2)).toBe("5.00");
    expect(omitted?.importBatchId).toBe(batchId);
  });

  it("6. adds a new product line that shares an existing invoice reference", async () => {
    const account = `${stamp}6`;
    const reference = `I/ADD${stamp}/1`;
    const original = [invoiceHeader, invoice(account, reference, "PART-A", "Pad", "1", "10.00")].join(
      "\n",
    );
    const batchId = await stage("INVOICE_LINES", `${stamp}-add-base.csv`, original);
    await previewAutopartImport(adminId, { batchId });
    await commit(batchId);
    const extra = [
      invoiceHeader,
      invoice(account, reference, "PART-C", "Rotor", "3", "6.25"),
    ].join("\n");
    const extraId = await stage("INVOICE_LINES", `${stamp}-add-extra.csv`, extra);
    const preview = reportOf(await previewAutopartImport(adminId, { batchId: extraId }));
    expect(preview.newRecords).toBe(1);
    expect(preview.financialConflicts).toBe(0);
    expect(preview.expectedStoredTotalChange).toBe("6.25");
    const committed = await commit(extraId);
    expect(committed.importedRows).toBe(1);
    expect(committed.updatedRows).toBe(0);
    const lines = await prisma.autopartInvoiceLine.findMany({ where: { accountCode: account } });
    expect(lines).toHaveLength(2);
    const originalLine = lines.find((line) => line.partNumber === "PART-A");
    expect(originalLine?.salesAmount.toFixed(2)).toBe("10.00");
    expect(originalLine?.description).toBe("Pad");
    expect(originalLine?.importBatchId).toBe(batchId);
    expect(lines.find((line) => line.partNumber === "PART-C")?.salesAmount.toFixed(2)).toBe("6.25");
  });

  it("7. blocks an existing part whose sales amount changed and does not count it as an update", async () => {
    const account = `${stamp}7`;
    const reference = `I/AMT${stamp}/1`;
    const original = [invoiceHeader, invoice(account, reference, "PART-A", "Pad", "2", "12.50")].join(
      "\n",
    );
    const batchId = await stage("INVOICE_LINES", `${stamp}-amount-base.csv`, original);
    await previewAutopartImport(adminId, { batchId });
    await commit(batchId);
    const changed = [
      invoiceHeader,
      invoice(account, reference, "PART-A", "Pad renamed", "2", "99.99"),
      invoice(account, `I/AMT${stamp}/2`, "PART-NEW", "New", "1", "3.00"),
    ].join("\n");
    const changedId = await stage("INVOICE_LINES", `${stamp}-amount-changed.csv`, changed);
    const preview = reportOf(await previewAutopartImport(adminId, { batchId: changedId }));
    expect(preview.canCommit).toBe(false);
    expect(preview.financialConflicts).toBe(1);
    expect(preview.newRecords).toBe(1);
    expect(preview.expectedStoredTotalChange).toBe("0.00");
    expect(preview.classifiedNewAmount).toBe("3.00");
    expect(preview.blockedReason).toMatch(/financial conflicts/);
    expect(preview.examples.some((example) => example.classification === "FINANCIAL_CONFLICT")).toBe(
      true,
    );
    const blocked = await getAutopartImportBatch(adminId, changedId);
    expect(blocked.status).toBe("UPLOADED");
    await expect(confirmAutopartImport(adminId, changedId)).rejects.toThrow(/Preview the file/);
    const after = await getAutopartImportBatch(adminId, changedId);
    expect(after.importedRows).toBe(0);
    expect(after.updatedRows).toBe(0);
    const lines = await prisma.autopartInvoiceLine.findMany({ where: { accountCode: account } });
    expect(lines).toHaveLength(1);
    expect(lines[0]?.salesAmount.toFixed(2)).toBe("12.50");
    expect(lines[0]?.quantity.toFixed(3)).toBe("2.000");
    expect(lines[0]?.description).toBe("Pad");
    expect(lines[0]?.importBatchId).toBe(batchId);
  });

  it("8. blocks an existing part whose quantity changed", async () => {
    const account = `${stamp}8`;
    const reference = `I/QTY${stamp}/1`;
    const original = [invoiceHeader, invoice(account, reference, "PART-A", "Pad", "2", "12.50")].join(
      "\n",
    );
    const batchId = await stage("INVOICE_LINES", `${stamp}-qty-base.csv`, original);
    await previewAutopartImport(adminId, { batchId });
    await commit(batchId);
    const changed = [invoiceHeader, invoice(account, reference, "PART-A", "Pad", "9", "12.50")].join(
      "\n",
    );
    const changedId = await stage("INVOICE_LINES", `${stamp}-qty-changed.csv`, changed);
    const preview = reportOf(await previewAutopartImport(adminId, { batchId: changedId }));
    expect(preview.financialConflicts).toBe(1);
    expect(preview.canCommit).toBe(false);
    expect(preview.expectedStoredTotalChange).toBe("0.00");
    await expect(confirmAutopartImport(adminId, changedId)).rejects.toThrow(/Preview the file/);
    const line = await prisma.autopartInvoiceLine.findFirstOrThrow({ where: { accountCode: account } });
    expect(line.quantity.toFixed(3)).toBe("2.000");
    expect(line.salesAmount.toFixed(2)).toBe("12.50");
    expect(line.description).toBe("Pad");
    expect(line.importBatchId).toBe(batchId);
  });

  it("9. stores separate SLRB transactions that share a reference and date", async () => {
    const account = `${stamp}9`;
    const reference = `SL${stamp}`;
    const text = [
      ledgerHeader,
      ledger(account, reference, "10.00", "2.00", "12.00", "12.00"),
      ledger(account, reference, "25.00", "5.00", "30.00", "30.00"),
      ledger(account, reference, "4.00", "0.80", "4.80", "4.80"),
      ledger(account, reference, "4.00", "0.80", "4.80", "4.80"),
    ].join("\n");
    const batchId = await stage("LEDGER", `${stamp}-slrb-two.csv`, text);
    const preview = reportOf(await previewAutopartImport(adminId, { batchId }));
    expect(preview.newRecords).toBe(4);
    expect(preview.ambiguousRecords).toBe(0);
    expect(preview.expectedStoredTotalChange).toBe("43.00");
    const committed = await commit(batchId);
    expect(committed.importedRows).toBe(4);
    const rows = await prisma.autopartLedgerTransaction.findMany({ where: { accountCode: account } });
    expect(rows).toHaveLength(4);
    expect(new Set(rows.map((row) => row.sourceIdentity)).size).toBe(4);

    const partial = [ledgerHeader, ledger(account, reference, "25.00", "5.00", "30.00", "30.00")].join(
      "\n",
    );
    const partialId = await stage("LEDGER", `${stamp}-slrb-partial.csv`, partial);
    const replay = reportOf(await previewAutopartImport(adminId, { batchId: partialId }));
    expect(replay.identicalRecords).toBe(1);
    expect(replay.newRecords).toBe(0);
    expect(replay.expectedStoredTotalChange).toBe("0.00");
    const replayed = await commit(partialId);
    expect(replayed.importedRows).toBe(0);
    expect(replayed.updatedRows).toBe(1);
    expect(await prisma.autopartLedgerTransaction.count({ where: { accountCode: account } })).toBe(4);
    const goods = await prisma.autopartLedgerTransaction.aggregate({
      where: { accountCode: account },
      _sum: { goodsAmount: true },
    });
    expect(goods._sum.goodsAmount?.toFixed(2)).toBe("43.00");
  });

  it("10. reports an SLRB financial conflict instead of counting an update", async () => {
    const account = `${stamp}10`;
    const reference = `CF${stamp}`;
    const original = [ledgerHeader, ledger(account, reference, "15.00", "3.00", "18.00", "18.00")].join(
      "\n",
    );
    const batchId = await stage("LEDGER", `${stamp}-slrb-conflict-base.csv`, original);
    await previewAutopartImport(adminId, { batchId });
    await commit(batchId);
    const changed = [
      ledgerHeader,
      ledger(account, reference, "100.00", "20.00", "120.00", "500.00"),
      ledger(account, `NW${stamp}`, "4.00", "0.80", "4.80", "4.80", "07 Oct 14"),
    ].join("\n");
    const changedId = await stage("LEDGER", `${stamp}-slrb-conflict.csv`, changed);
    const preview = reportOf(await previewAutopartImport(adminId, { batchId: changedId }));
    expect(preview.financialConflicts).toBe(1);
    expect(preview.newRecords).toBe(1);
    expect(preview.identicalRecords).toBe(0);
    expect(preview.canCommit).toBe(false);
    expect(preview.expectedStoredTotalChange).toBe("0.00");
    expect(preview.classifiedNewAmount).toBe("4.00");
    await expect(confirmAutopartImport(adminId, changedId)).rejects.toThrow(/Preview the file/);
    const blocked = await getAutopartImportBatch(adminId, changedId);
    expect(blocked.updatedRows).toBe(0);
    expect(blocked.importedRows).toBe(0);
    const rows = await prisma.autopartLedgerTransaction.findMany({ where: { accountCode: account } });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.goodsAmount?.toFixed(2)).toBe("15.00");
    expect(rows[0]?.vatAmount?.toFixed(2)).toBe("3.00");
    expect(rows[0]?.totalAmount?.toFixed(2)).toBe("18.00");
    expect(rows[0]?.runningBalance?.toFixed(2)).toBe("18.00");
    expect(rows[0]?.importBatchId).toBe(batchId);
  });

  it("11. leaves stored financial data unchanged when the import is refused", async () => {
    const account = `${stamp}11`;
    const reference = `I/SAFE${stamp}/1`;
    const original = [invoiceHeader, invoice(account, reference, "PART-A", "Pad", "1", "10.00")].join(
      "\n",
    );
    const batchId = await stage("INVOICE_LINES", `${stamp}-safe.csv`, original);
    await previewAutopartImport(adminId, { batchId });
    await commit(batchId);
    const lineBefore = await prisma.autopartInvoiceLine.findFirstOrThrow({
      where: { accountCode: account },
    });

    const wrongHash = await stage(
      "INVOICE_LINES",
      `${stamp}-wrong-hash.csv`,
      original,
      "0".repeat(64),
    );
    await expect(previewAutopartImport(adminId, { batchId: wrongHash })).rejects.toThrow(
      /file hash does not match/,
    );
    const afterHash = await prisma.autopartInvoiceLine.findFirstOrThrow({
      where: { accountCode: account },
    });
    expect(afterHash.salesAmount.toFixed(2)).toBe("10.00");
    expect(afterHash.description).toBe("Pad");
    expect(afterHash.importBatchId).toBe(batchId);

    await prisma.autopartInvoiceLine.update({
      where: { id: lineBefore.id },
      data: { sourceIdentity: `fake-${stamp}-identity` },
    });
    const ambiguousText = [
      invoiceHeader,
      invoice(account, reference, "PART-A", "Should not stick", "1", "10.00"),
    ].join("\n");
    const ambiguousId = await stage("INVOICE_LINES", `${stamp}-ambiguous.csv`, ambiguousText);
    const ambiguous = reportOf(await previewAutopartImport(adminId, { batchId: ambiguousId }));
    expect(ambiguous.ambiguousRecords).toBe(1);
    expect(ambiguous.financialConflicts).toBe(0);
    expect(ambiguous.canCommit).toBe(false);
    expect(ambiguous.expectedStoredTotalChange).toBe("0.00");
    expect(ambiguous.examples.some((example) => example.explanation.match(/quarantined/))).toBe(true);
    await expect(confirmAutopartImport(adminId, ambiguousId)).rejects.toThrow(/Preview the file/);
    const afterAmbiguous = await prisma.autopartInvoiceLine.findFirstOrThrow({
      where: { accountCode: account },
    });
    expect(afterAmbiguous.description).toBe("Pad");
    expect(afterAmbiguous.salesAmount.toFixed(2)).toBe("10.00");
    expect(afterAmbiguous.importBatchId).toBe(batchId);
    expect(await prisma.autopartInvoiceLine.count({ where: { accountCode: account } })).toBe(1);

    const holder = await prisma.autopartImportBatch.create({
      data: {
        kind: "INVOICE_LINES",
        status: "COMMITTED",
        filename: `${stamp}-holder.csv`,
        fileHash: "holder",
        dryRun: false,
        createdById: adminId,
      },
    });
    await prisma.autopartInvoiceLine.createMany({
      data: [
        {
          sourceIdentity: `fake-${stamp}-ten`,
          accountCode: `${stamp}11B`,
          rawInvAndLn: `I/MULTI${stamp}/1`,
          partNumber: "PART-A",
          quantity: "1.00",
          salesAmount: "10.00",
          importBatchId: holder.id,
          rawSource: {},
          description: "Ten",
        },
        {
          sourceIdentity: `fake-${stamp}-twenty`,
          accountCode: `${stamp}11B`,
          rawInvAndLn: `I/MULTI${stamp}/1`,
          partNumber: "PART-A",
          quantity: "1.00",
          salesAmount: "20.00",
          importBatchId: holder.id,
          rawSource: {},
          description: "Twenty",
        },
      ],
    });
    const multi = [
      invoiceHeader,
      invoice(`${stamp}11B`, `I/MULTI${stamp}/1`, "PART-A", "Changed", "1", "10.00"),
    ].join("\n");
    const multiId = await stage("INVOICE_LINES", `${stamp}-multi.csv`, multi);
    const multiPreview = reportOf(await previewAutopartImport(adminId, { batchId: multiId }));
    expect(multiPreview.ambiguousRecords).toBe(1);
    expect(multiPreview.canCommit).toBe(false);
    await expect(confirmAutopartImport(adminId, multiId)).rejects.toThrow(/Preview the file/);
    const stored = await prisma.autopartInvoiceLine.findMany({
      where: { accountCode: `${stamp}11B` },
      orderBy: { salesAmount: "asc" },
    });
    expect(stored.map((row) => row.description)).toEqual(["Ten", "Twenty"]);
    expect(stored.map((row) => row.salesAmount.toFixed(2))).toEqual(["10.00", "20.00"]);

    const fresh = [invoiceHeader, invoice(account, `I/FRESH${stamp}/9`, "PART-Z", "New", "1", "3.00")].join(
      "\n",
    );
    const freshId = await stage("INVOICE_LINES", `${stamp}-fresh.csv`, fresh);
    const freshPreview = await previewAutopartImport(adminId, { batchId: freshId });
    expect(freshPreview.status).toBe("PREVIEWED");
    await prisma.autopartInvoiceLine.create({
      data: {
        sourceIdentity: `fake-${stamp}-part-z`,
        accountCode: account,
        rawInvAndLn: `I/FRESH${stamp}/9`,
        partNumber: "PART-Z",
        quantity: "1.00",
        salesAmount: "9.00",
        description: "Manual",
        importBatchId: holder.id,
        rawSource: {},
      },
    });
    await expect(confirmAutopartImport(adminId, freshId)).rejects.toThrow(/financial conflicts/);
    const freshLines = await prisma.autopartInvoiceLine.findMany({
      where: { accountCode: account, partNumber: "PART-Z" },
    });
    expect(freshLines).toHaveLength(1);
    expect(freshLines[0]?.salesAmount.toFixed(2)).toBe("9.00");
    expect(freshLines[0]?.description).toBe("Manual");
    const refused = await getAutopartImportBatch(adminId, freshId);
    expect(refused.status).toBe("UPLOADED");
    expect(refused.importedRows).toBe(0);
    expect(refused.updatedRows).toBe(0);
  });

  it("12. reports preview totals and commit counters from the same match", async () => {
    const account = `${stamp}12`;
    const base = [invoiceHeader, invoice(account, `I/TOT${stamp}/1`, "PART-A", "Pad", "1", "12.50")].join(
      "\n",
    );
    const baseId = await stage("INVOICE_LINES", `${stamp}-totals-base.csv`, base);
    await previewAutopartImport(adminId, { batchId: baseId });
    await commit(baseId);
    const next = [
      invoiceHeader,
      invoice(account, `I/TOT${stamp}/1`, "PART-A", "Pad", "1", "12.50"),
      invoice(account, `I/TOT${stamp}/2`, "PART-B", "Disc", "1", "3.00"),
      invoice(account, `I/TOT${stamp}/3`, "PART-C", "Credit", "1", "-1.00"),
      `${account},I/TOT${stamp}/4,PART-D,Bad,1,not-money`,
    ].join("\n");
    const nextId = await stage("INVOICE_LINES", `${stamp}-totals-next.csv`, next);
    const preview = reportOf(await previewAutopartImport(adminId, { batchId: nextId }));
    expect(preview.identicalRecords).toBe(1);
    expect(preview.newRecords).toBe(2);
    expect(preview.rejectedRecords).toBe(1);
    expect(preview.financialConflicts).toBe(0);
    expect(preview.ambiguousRecords).toBe(0);
    expect(preview.expectedStoredTotalChange).toBe("2.00");
    expect(preview.storedFinancialTotal).toBe("12.50");
    expect(preview.projectedFinancialTotal).toBe("14.50");
    expect(preview.canCommit).toBe(true);
    const committed = await commit(nextId);
    expect(committed.importedRows).toBe(preview.newRecords);
    expect(committed.updatedRows).toBe(preview.identicalRecords);
    expect(committed.rejectedRows).toBe(preview.rejectedRecords);
    const sum = await prisma.autopartInvoiceLine.aggregate({
      where: { accountCode: account },
      _sum: { salesAmount: true },
    });
    expect(sum._sum.salesAmount?.toFixed(2)).toBe("14.50");
    expect(await prisma.autopartInvoiceLine.count({ where: { accountCode: account } })).toBe(3);
  });
});
