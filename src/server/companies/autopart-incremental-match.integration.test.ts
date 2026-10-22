import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { bootstrapRbac } from "../../../prisma/bootstrap/rbac";
import { confirmAutopartImport, previewAutopartImport } from "@/server/companies/autopart-master-import";
import { GLOBAL_AUTOPART_SALES_PERIOD } from "@/server/sales-intelligence/history-sources";

const prisma = new PrismaClient();
const stamp = `Q${Date.now().toString(36).slice(-6).toUpperCase()}`;

let adminId = "";
let dir = "";
const previousDir = process.env["AUTOPART_IMPORT_DIR"];

describe("retired 561L and SLRB incremental import", () => {
  beforeAll(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "autopart-incremental-"));
    process.env["AUTOPART_IMPORT_DIR"] = dir;
    await bootstrapRbac(prisma);
    const email = `autopart-incremental.admin.${stamp}@example.invalid`;
    const user = await prisma.user.create({
      data: { email, name: "Incremental admin", status: "ACTIVE", actorType: "INTERNAL", emailVerified: true },
    });
    const role = await prisma.role.findUniqueOrThrow({ where: { key: "SUPER_ADMIN" } });
    await prisma.userRole.create({ data: { userId: user.id, roleId: role.id } });
    adminId = user.id;
  });

  afterAll(async () => {
    if (previousDir === undefined) delete process.env["AUTOPART_IMPORT_DIR"];
    else process.env["AUTOPART_IMPORT_DIR"] = previousDir;
    await prisma.autopartImportBatch.deleteMany({ where: { createdById: adminId } });
    await prisma.userRole.deleteMany({ where: { userId: adminId } });
    await prisma.user.deleteMany({ where: { id: adminId } });
    if (dir) await rm(dir, { recursive: true, force: true });
    await prisma.$disconnect();
  });

  it("labels the global sales period as ongoing sales only", () => {
    expect(GLOBAL_AUTOPART_SALES_PERIOD.label).toBe("Ongoing sales only");
    expect(GLOBAL_AUTOPART_SALES_PERIOD.key).toBe("ALL_AVAILABLE_HISTORY");
  });

  it("refuses incremental 561L and SLRB preview and confirm before any row is written", async () => {
    const beforeInvoices = await prisma.autopartInvoiceLine.count();
    const beforeLedger = await prisma.autopartLedgerTransaction.count();
    const invoicePath = path.join(dir, `${stamp}-561.csv`);
    await writeFile(invoicePath, ".Acct.,Inv & Ln,Part Number,Description,Units,Sales\n", "utf8");
    const invoice = await prisma.autopartImportBatch.create({
      data: {
        kind: "INVOICE_LINES",
        status: "UPLOADED",
        filename: `${stamp}-561.csv`,
        fileHash: stamp,
        storagePath: invoicePath,
        dryRun: true,
        createdById: adminId,
      },
    });
    const ledgerPath = path.join(dir, `${stamp}-slrb.csv`);
    await writeFile(ledgerPath, "A/C,Name,Sacct,Type,Ref,Date,Tot Goods,,Tot VAT,,Total,Run Bal\n", "utf8");
    const ledger = await prisma.autopartImportBatch.create({
      data: {
        kind: "LEDGER",
        status: "UPLOADED",
        filename: `${stamp}-slrb.csv`,
        fileHash: `${stamp}-l`,
        storagePath: ledgerPath,
        dryRun: true,
        createdById: adminId,
      },
    });

    await expect(previewAutopartImport(adminId, { batchId: invoice.id })).rejects.toMatchObject({
      code: "HISTORICAL_IMPORT_RETIRED",
    });
    await expect(confirmAutopartImport(adminId, invoice.id)).rejects.toMatchObject({
      code: "HISTORICAL_IMPORT_RETIRED",
    });
    await expect(previewAutopartImport(adminId, { batchId: ledger.id })).rejects.toMatchObject({
      code: "HISTORICAL_IMPORT_RETIRED",
    });
    expect(await prisma.autopartInvoiceLine.count()).toBe(beforeInvoices);
    expect(await prisma.autopartLedgerTransaction.count()).toBe(beforeLedger);
  });
});
