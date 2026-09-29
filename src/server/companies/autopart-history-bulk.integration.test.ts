/**
 * Large-scale historic import regression — comparable to real YORKMOTO volume
 * (~4.5k 561L lines / ~800 SLRB docs) without committing commercial data.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { bootstrapRbac } from "../../../prisma/bootstrap/rbac";
import { AuthError } from "@/server/rbac/guards";
import {
  confirmAutopartHistoryImport,
  getCompanyAutopartHistoryWorkspace,
  listPortalHistoricPurchases,
  previewAutopartHistoryImport,
} from "@/server/companies/autopart-history";
import { linkAndVerifyCompanyAutopartCustomerCode } from "@/server/companies/autopart-account";
import { saveProduct } from "@/server/catalogue/service";

const prisma = new PrismaClient();

const LINE_COUNT = 4500;
const DOC_COUNT = 800;
const LINES_PER_DOC = Math.ceil(LINE_COUNT / DOC_COUNT);

let adminId = "";
let buyerId = "";
let companyId = "";
let account = "";

function pad(n: number, w: number) {
  return String(n).padStart(w, "0");
}

/** Sanitised synthetic CSV pair at production-like scale. */
function buildLargePair(code: string): { file561: string; fileSlrb: string } {
  const rows561 = ["Acct.,Inv & Ln,Part Number,Description,Units,Sales"];
  const rowsSlrb = ["A/C,Type,Ref,Date,Tot Goods,Tot VAT,Total,Run Bal"];
  let lineNo = 0;
  for (let d = 1; d <= DOC_COUNT; d++) {
    const ref = `SS${pad(d, 6)}`;
    const isCredit = d % 20 === 0;
    const type = isCredit ? "CRN" : "INV";
    const goods = isCredit ? "-50.00" : "100.00";
    const vat = isCredit ? "-10.00" : "20.00";
    const total = isCredit ? "-60.00" : "120.00";
    rowsSlrb.push(
      `${code},${type},${ref},06 Oct 14,${goods},${vat},${total},${total}`,
    );
    const linesHere = d === DOC_COUNT ? LINE_COUNT - lineNo : LINES_PER_DOC;
    for (let ln = 1; ln <= linesHere && lineNo < LINE_COUNT; ln++) {
      lineNo += 1;
      const inv = isCredit ? `C/${ref}/${ln}` : `I/${ref}/${ln}`;
      const sku = lineNo % 3 === 0 ? "BULK-SKU-A" : lineNo % 3 === 1 ? "BULK-SKU-B" : "GONE-SKU";
      const units = isCredit ? -1 : 2;
      const sales = isCredit ? "-25.00" : "50.00";
      rows561.push(`${code},${inv},${sku},Bulk item ${lineNo},${units},"${sales}"`);
    }
  }
  return { file561: rows561.join("\n") + "\n", fileSlrb: rowsSlrb.join("\n") + "\n" };
}

async function ensureUser(email: string, roles: string[], actorType: "INTERNAL" | "TRADE" = "INTERNAL") {
  let user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    user = await prisma.user.create({
      data: {
        email,
        name: email.split("@")[0]!,
        status: "ACTIVE",
        actorType,
        emailVerified: true,
      },
    });
  }
  for (const key of roles) {
    const role = await prisma.role.findUniqueOrThrow({ where: { key } });
    await prisma.userRole.upsert({
      where: { userId_roleId: { userId: user.id, roleId: role.id } },
      create: { userId: user.id, roleId: role.id },
      update: {},
    });
  }
  return user.id;
}

beforeAll(async () => {
  await bootstrapRbac(prisma);
  adminId = await ensureUser("ap-bulk.admin@example.invalid", ["SUPER_ADMIN"]);
  const stamp = Date.now();
  account = `BK${String(stamp).slice(-8)}`;
  const company = await prisma.company.create({
    data: { name: `AP Bulk ${stamp}`, status: "ACTIVE" },
  });
  companyId = company.id;
  await linkAndVerifyCompanyAutopartCustomerCode(adminId, {
    companyId,
    code: account,
  });
  buyerId = await ensureUser(`ap-bulk.buyer.${stamp}@example.invalid`, [], "TRADE");
  await prisma.companyUser.create({
    data: {
      companyId,
      userId: buyerId,
      role: "TRADE_BUYER",
      status: "ACTIVE",
      isDefault: true,
    },
  });
  async function ensureSku(sku: string) {
    const existing = await prisma.productVariant.findUnique({ where: { sku } });
    if (existing) return;
    await saveProduct(adminId, {
      sku,
      name: sku,
      brand: "Bulk Brand",
      category: "Engine",
      trade: 5,
      rrp: 10,
      packQty: 1,
      caseQty: 12,
      description: "bulk test",
      active: true,
    });
  }
  await ensureSku("BULK-SKU-A");
  await ensureSku("BULK-SKU-B");
}, 120_000);

afterAll(async () => {
  await prisma.$disconnect();
});

describe("historic import bulk write path", () => {
  it(
    "imports multi-thousand lines without interactive transaction failure",
    async () => {
      const { file561, fileSlrb } = buildLargePair(account);

      const preview = await previewAutopartHistoryImport(adminId, {
        companyId,
        file561l: file561,
        fileSlrb: fileSlrb,
        filename561l: "561L-bulk.csv",
        filenameSlrb: "SLRB-bulk.csv",
      });
      expect(preview.canCommit).toBe(true);
      expect(preview.report561l.validLines).toBe(LINE_COUNT);
      expect(preview.reportSlrb.invoiceDocuments + preview.reportSlrb.creditDocuments).toBe(
        DOC_COUNT,
      );

      const started = Date.now();
      const result = await confirmAutopartHistoryImport(adminId, {
        companyId,
        file561l: file561,
        fileSlrb: fileSlrb,
        filename561l: "561L-bulk.csv",
        filenameSlrb: "SLRB-bulk.csv",
      });
      const elapsedMs = Date.now() - started;
      expect(elapsedMs).toBeLessThan(120_000);

      const run = await prisma.autopartCustomerImportRun.findUniqueOrThrow({
        where: { id: result.runId },
      });
      expect(run.status).toBe("COMMITTED");
      expect(run.dryRun).toBe(false);

      const lineCount = await prisma.autopartSalesLine.count({ where: { companyId } });
      const docCount = await prisma.autopartSalesDocument.count({ where: { companyId } });
      expect(lineCount).toBe(LINE_COUNT);
      expect(docCount).toBe(DOC_COUNT);

      const ws = await getCompanyAutopartHistoryWorkspace(adminId, companyId);
      expect(ws.historic.imported).toBe(true);
      expect(ws.historic.productsPurchased).toBeGreaterThanOrEqual(2);

      const portal = await listPortalHistoricPurchases(buyerId, {});
      expect(portal.items.some((i) => i.sku.toUpperCase() === "BULK-SKU-A")).toBe(true);

      // Re-import same files — idempotent, no doubling
      const netSpendBefore = Number(ws.historic.netSpend);
      const second = await confirmAutopartHistoryImport(adminId, {
        companyId,
        file561l: file561,
        fileSlrb: fileSlrb,
      });
      expect(second.updated + second.imported).toBeGreaterThan(0);
      expect(await prisma.autopartSalesLine.count({ where: { companyId } })).toBe(LINE_COUNT);
      expect(await prisma.autopartSalesDocument.count({ where: { companyId } })).toBe(DOC_COUNT);
      const ws2 = await getCompanyAutopartHistoryWorkspace(adminId, companyId);
      expect(Number(ws2.historic.netSpend)).toBeCloseTo(netSpendBefore, 2);

      // Successful hash is recorded as COMMITTED only
      const committed = await prisma.autopartCustomerImportRun.count({
        where: {
          companyId,
          type: "HISTORY_561L_SLRB",
          status: "COMMITTED",
          fileHash: preview.fileHash561l,
        },
      });
      expect(committed).toBeGreaterThanOrEqual(1);
    },
    180_000,
  );

  it("FAILED run does not block retry; COMMITTED hash is informational only", async () => {
    const stamp = Date.now();
    const code = `FL${String(stamp).slice(-8)}`;
    const company = await prisma.company.create({
      data: { name: `Fail Retry ${stamp}`, status: "ACTIVE" },
    });
    await linkAndVerifyCompanyAutopartCustomerCode(adminId, {
      companyId: company.id,
      code,
    });
    const tiny561 = `Acct.,Inv & Ln,Part Number,Description,Units,Sales
${code},I/SS1/1,BULK-SKU-A,Item,1,"10.00"
${code},I/SS1/1,BULK-SKU-A,Dup adjacent,1,"10.00"
`;
    const tinySlrb = `A/C,Type,Ref,Date,Tot Goods,Tot VAT,Total,Run Bal
${code},INV,SS1,06 Oct 14,10.00,2.00,12.00,12.00
`;
    // Simulate a prior FAILED attempt with same hashes (must remain retryable)
    const { createHash } = await import("node:crypto");
    const hash561 = createHash("sha256").update(tiny561, "utf8").digest("hex");
    const hashSlrb = createHash("sha256").update(tinySlrb, "utf8").digest("hex");
    await prisma.autopartCustomerImportRun.create({
      data: {
        companyId: company.id,
        type: "HISTORY_561L_SLRB",
        status: "FAILED",
        fileHash: hash561,
        fileHashSlrb: hashSlrb,
        dryRun: false,
        createdById: adminId,
        completedAt: new Date(),
      },
    });

    const preview = await previewAutopartHistoryImport(adminId, {
      companyId: company.id,
      file561l: tiny561,
      fileSlrb: tinySlrb,
    });
    expect(preview.canCommit).toBe(true);
    // FAILED prior must not surface as already-imported
    expect(preview.alreadyImported).toBe(false);
    expect(preview.issues.some((i) => i.code === "PREVIOUS_ATTEMPT_FAILED")).toBe(true);

    const ok = await confirmAutopartHistoryImport(adminId, {
      companyId: company.id,
      file561l: tiny561,
      fileSlrb: tinySlrb,
    });
    expect(ok.imported + ok.updated).toBeGreaterThan(0);
    const run = await prisma.autopartCustomerImportRun.findUniqueOrThrow({
      where: { id: ok.runId },
    });
    expect(run.status).toBe("COMMITTED");
    // Adjacent duplicate Inv&Ln must upsert once (no ON CONFLICT twice error)
    expect(await prisma.autopartSalesLine.count({ where: { companyId: company.id } })).toBe(1);
  });

  it("surfaces friendly error (not raw Prisma) when confirm is blocked", async () => {
    await expect(
      confirmAutopartHistoryImport(adminId, {
        companyId,
        file561l: "not a report",
        fileSlrb: "not a report",
      }),
    ).rejects.toBeInstanceOf(AuthError);
  });
});
