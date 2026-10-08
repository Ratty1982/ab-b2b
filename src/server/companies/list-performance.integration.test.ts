/**
 * Pagination and lookup behaviour for CRM and Autopart history lists.
 * Fixtures are synthetic. They are removed at the end of the file.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { bootstrapRbac } from "../../../prisma/bootstrap/rbac";
import { listCompaniesForActor } from "@/server/companies/service";
import { getCompanyAutopartHistoryWorkspace } from "@/server/companies/autopart-history";
import {
  listAutopartAccounts,
  listAutopartImportBatches,
  listAutopartInvoiceLines,
  listAutopartLedger,
  listDuplicateAutopartNames,
} from "@/server/companies/autopart-master-import";

const prisma = new PrismaClient();
const stamp = `PF${Date.now().toString(36).slice(-6).toUpperCase()}`;
const accountCode = `${stamp}01`;

let adminId = "";
let companyId = "";
let batchId = "";
let staleBatchId = "";
let liveBatchId = "";

async function ensureUser(email: string) {
  let user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    user = await prisma.user.create({
      data: {
        email,
        name: "Perf admin",
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

beforeAll(async () => {
  await bootstrapRbac(prisma);
  adminId = await ensureUser(`perf.admin.${stamp}@example.invalid`);
  const company = await prisma.company.create({
    data: { name: `Perf Customer ${stamp}`, status: "ACTIVE", accountNumber: `PF-${stamp}` },
  });
  companyId = company.id;
  await prisma.company.createMany({
    data: [
      { name: `Perf Customer ${stamp} B`, status: "ACTIVE" },
      { name: `Perf Customer ${stamp} C`, status: "ACTIVE" },
    ],
  });
  await prisma.autopartSalesLine.createMany({
    data: [
      {
        companyId,
        autopartCustomerCode: accountCode,
        documentType: "INVOICE",
        documentReference: `${stamp}-D1`,
        lineNumber: 1,
        sku: `${stamp}-SKU-A`,
        units: "2.000",
        salesNet: "10.00",
      },
      {
        companyId,
        autopartCustomerCode: accountCode,
        documentType: "INVOICE",
        documentReference: `${stamp}-D1`,
        lineNumber: 2,
        sku: `${stamp}-SKU-A`,
        units: "1.000",
        salesNet: "4.50",
      },
      {
        companyId,
        autopartCustomerCode: accountCode,
        documentType: "INVOICE",
        documentReference: `${stamp}-D2`,
        lineNumber: 1,
        sku: `${stamp}-SKU-B`,
        units: "3.000",
        salesNet: "7.25",
      },
    ],
  });
  const batch = await prisma.autopartImportBatch.create({
    data: {
      kind: "INVOICE_LINES",
      status: "COMMITTED",
      filename: `${stamp}.csv`,
      fileHash: `${stamp}-hash`,
      dryRun: false,
      createdById: adminId,
    },
  });
  batchId = batch.id;
  await prisma.autopartAccount.createMany({
    data: Array.from({ length: 55 }, (_, index) => ({
      accountCode: `${stamp}${String(index).padStart(2, "0")}`,
      originalName: `Perf Account ${stamp} ${index}`,
      classification: "UNIDENTIFIED" as const,
    })),
  });
  await prisma.autopartAccount.createMany({
    data: Array.from({ length: 26 }, (_, index) => {
      const name = `~~~PERF ${stamp} ${String(index).padStart(2, "0")}`;
      return [
        {
          accountCode: `${stamp}D${String(index).padStart(2, "0")}A`,
          originalName: name,
          classification: "UNIDENTIFIED" as const,
        },
        {
          accountCode: `${stamp}D${String(index).padStart(2, "0")}B`,
          originalName: name,
          classification: "UNIDENTIFIED" as const,
        },
      ];
    }).flat(),
  });
  await prisma.autopartAccount.create({
    data: {
      accountCode: `${stamp}SOLO`,
      originalName: `~~~PERF ${stamp} SOLO`,
      classification: "UNIDENTIFIED",
    },
  });
  await prisma.autopartInvoiceLine.createMany({
    data: Array.from({ length: 55 }, (_, index) => ({
      sourceIdentity: `${stamp}-line-${index}`,
      accountCode,
      rawInvAndLn: `${stamp}/${String(index).padStart(3, "0")}`,
      partNumber: index === 7 ? `${stamp}-PART` : `${stamp}-OTHER`,
      description: "Synthetic history line",
      quantity: "1.000",
      salesAmount: index === 7 ? "12.34" : "1.00",
      importBatchId: batchId,
      rawSource: { synthetic: true },
    })),
  });
  await prisma.autopartLedgerTransaction.createMany({
    data: [
      {
        sourceIdentity: `${stamp}-led-1`,
        accountCode,
        rawType: "INV",
        ledgerKind: "INVOICE",
        reference: `${stamp}R1`,
        transactionDate: new Date("2024-01-02"),
        goodsAmount: "12.34",
        totalAmount: "14.81",
        importBatchId: batchId,
        rawSource: { synthetic: true },
      },
      {
        sourceIdentity: `${stamp}-led-2`,
        accountCode,
        rawType: "INV",
        ledgerKind: "INVOICE",
        reference: `${stamp}R2`,
        transactionDate: new Date("2024-03-04"),
        goodsAmount: "8.00",
        totalAmount: "9.60",
        importBatchId: batchId,
        rawSource: { synthetic: true },
      },
    ],
  });
  const stale = await prisma.autopartImportBatch.create({
    data: {
      kind: "LEDGER",
      status: "RUNNING",
      filename: `${stamp}-stale.csv`,
      fileHash: `${stamp}-stale`,
      dryRun: true,
      heartbeatAt: new Date(Date.now() - 20 * 60 * 1000),
      createdById: adminId,
    },
  });
  staleBatchId = stale.id;
  const live = await prisma.autopartImportBatch.create({
    data: {
      kind: "LEDGER",
      status: "RUNNING",
      filename: `${stamp}-live.csv`,
      fileHash: `${stamp}-live`,
      dryRun: true,
      heartbeatAt: new Date(),
      createdById: adminId,
    },
  });
  liveBatchId = live.id;
});

afterAll(async () => {
  await prisma.autopartLedgerTransaction.deleteMany({
    where: { sourceIdentity: { startsWith: stamp } },
  });
  await prisma.autopartInvoiceLine.deleteMany({ where: { sourceIdentity: { startsWith: stamp } } });
  await prisma.autopartImportBatch.deleteMany({
    where: { id: { in: [batchId, staleBatchId, liveBatchId].filter(Boolean) } },
  });
  await prisma.autopartAccount.deleteMany({ where: { accountCode: { startsWith: stamp } } });
  await prisma.autopartSalesLine.deleteMany({ where: { companyId } });
  await prisma.company.deleteMany({ where: { name: { startsWith: `Perf Customer ${stamp}` } } });
  await prisma.$disconnect();
});

describe("list performance", () => {
  it("pages customer listings and searches one account", async () => {
    const first = await listCompaniesForActor(adminId, {
      q: `Perf Customer ${stamp}`,
      page: 1,
      pageSize: 1,
    });
    const second = await listCompaniesForActor(adminId, {
      q: `Perf Customer ${stamp}`,
      page: 2,
      pageSize: 1,
    });
    expect(first.total).toBe(3);
    expect(first.items).toHaveLength(1);
    expect(second.items).toHaveLength(1);
    expect(first.items[0]?.id).not.toBe(second.items[0]?.id);
    const exact = await listCompaniesForActor(adminId, { q: `PF-${stamp}`, page: 1, pageSize: 25 });
    expect(exact.total).toBe(1);
    expect(exact.items[0]?.id).toBe(companyId);
  });

  it("pages master accounts and duplicate names without loading every group", async () => {
    const first = await listAutopartAccounts(adminId, { q: stamp, page: 1 });
    const second = await listAutopartAccounts(adminId, { q: stamp, page: 2 });
    expect(first.pageSize).toBe(50);
    expect(first.total).toBeGreaterThan(50);
    expect(first.items).toHaveLength(50);
    expect(second.items.length).toBeGreaterThan(0);
    const seen = new Set(first.items.map((row) => row.accountCode));
    expect(second.items.some((row) => seen.has(row.accountCode))).toBe(false);
    const one = await listAutopartAccounts(adminId, { q: accountCode, page: 1 });
    expect(one.items.map((row) => row.accountCode)).toContain(accountCode);
    const huge = await listAutopartAccounts(adminId, { q: stamp, page: 1_000_000 });
    expect(huge.page).toBe(10_000);
    expect(huge.items).toEqual([]);

    const names = await listDuplicateAutopartNames(adminId, 1);
    const lastPage = Math.ceil(names.total / names.pageSize);
    const tail = await listDuplicateAutopartNames(adminId, lastPage);
    const previous =
      lastPage > 1 ? await listDuplicateAutopartNames(adminId, lastPage - 1) : { items: [] };
    const grouped = [...previous.items, ...tail.items].filter((row) =>
      row.originalName.includes(stamp),
    );
    expect(grouped).toHaveLength(26);
    expect(grouped.every((row) => row.count === 2 && row.accounts.length === 2)).toBe(true);
    expect(grouped.some((row) => row.originalName.includes("SOLO"))).toBe(false);
    expect(tail.items.some((row) => row.originalName === previous.items.at(-1)?.originalName)).toBe(
      false,
    );
  });

  it("pages invoice lines and ledger rows and keeps source amounts", async () => {
    const first = await listAutopartInvoiceLines(adminId, { accountCode, page: 1 });
    const second = await listAutopartInvoiceLines(adminId, { accountCode, page: 2 });
    expect(first.total).toBe(55);
    expect(first.items).toHaveLength(50);
    expect(second.items).toHaveLength(5);
    expect(first.items.some((row) => row.rawInvAndLn === second.items[0]?.rawInvAndLn)).toBe(false);
    const firstRef = first.items[0]?.rawInvAndLn ?? "";
    const secondRef = first.items[1]?.rawInvAndLn ?? "";
    expect(firstRef < secondRef).toBe(true);
    const priced = await listAutopartInvoiceLines(adminId, { accountCode, q: `${stamp}-PART` });
    expect(priced.items).toHaveLength(1);
    expect(priced.items[0]?.salesAmount).toBe("12.34");
    expect(priced.items[0]?.quantity).toBe("1.000");

    const ledger = await listAutopartLedger(adminId, { accountCode, page: 1 });
    expect(ledger.items.map((row) => row.reference)).toEqual([`${stamp}R2`, `${stamp}R1`]);
    expect(ledger.items[0]?.goodsAmount).toBe("8.00");
    expect(ledger.items[1]?.totalAmount).toBe("14.81");
  });

  it("counts distinct purchased products", async () => {
    const workspace = await getCompanyAutopartHistoryWorkspace(adminId, companyId);
    expect(workspace.historic.productsPurchased).toBe(2);
    expect(workspace.historic.lineCount).toBe(3);
    expect(workspace.topProducts.map((row) => row.sku).sort()).toEqual(
      [`${stamp}-SKU-A`, `${stamp}-SKU-B`].sort(),
    );
  });

  it("marks a stale running import failed and leaves a fresh one running", async () => {
    await listAutopartImportBatches(adminId, 1);
    const stale = await prisma.autopartImportBatch.findUniqueOrThrow({
      where: { id: staleBatchId },
    });
    const live = await prisma.autopartImportBatch.findUniqueOrThrow({ where: { id: liveBatchId } });
    expect(stale.status).toBe("FAILED");
    expect(stale.errorSummary).toBe("Import stopped before completion and can be retried.");
    expect(live.status).toBe("RUNNING");
  });
});
