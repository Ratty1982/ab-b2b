/**
 * Historic import run lifecycle: FAILED retry, phantom COMMITTED repair,
 * PROCESSING gating, SUCCESS idempotency.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@prisma/client";
import { createHash } from "node:crypto";
import { bootstrapRbac } from "../../../prisma/bootstrap/rbac";
import { AuthError } from "@/server/rbac/guards";
import {
  confirmAutopartHistoryImport,
  getCompanyAutopartHistoryWorkspace,
  hasSuccessfulHistoricImport,
  listPortalHistoricPurchases,
  previewAutopartHistoryImport,
} from "@/server/companies/autopart-history";
import { linkAndVerifyCompanyAutopartCustomerCode } from "@/server/companies/autopart-account";
import { saveProduct } from "@/server/catalogue/service";
const prisma = new PrismaClient();

let adminId = "";
let buyerId = "";

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

function tinyPair(code: string, stamp: string) {
  const file561 = `Acct.,Inv & Ln,Part Number,Description,Units,Sales
${code},I/SS${stamp}/1,LIFE-SKU-A,Item,2,"20.00"
${code},I/SS${stamp}/2,LIFE-SKU-B,Item,1,"10.00"
`;
  const fileSlrb = `A/C,Type,Ref,Date,Tot Goods,Tot VAT,Total,Run Bal
${code},INV,SS${stamp},06 Oct 14,30.00,6.00,36.00,36.00
`;
  return { file561, fileSlrb };
}

function hashes(file561: string, fileSlrb: string) {
  return {
    hash561: createHash("sha256").update(file561, "utf8").digest("hex"),
    hashSlrb: createHash("sha256").update(fileSlrb, "utf8").digest("hex"),
  };
}

beforeAll(async () => {
  await bootstrapRbac(prisma);
  adminId = await ensureUser("ap-life.admin@example.invalid", ["SUPER_ADMIN"]);
  const stamp = Date.now();
  buyerId = await ensureUser(`ap-life.buyer.${stamp}@example.invalid`, [], "TRADE");
  for (const sku of ["LIFE-SKU-A", "LIFE-SKU-B"]) {
    const existing = await prisma.productVariant.findUnique({ where: { sku } });
    if (!existing) {
      await saveProduct(adminId, {
        sku,
        name: sku,
        brand: "Life",
        category: "Engine",
        trade: 5,
        rrp: 10,
        packQty: 1,
        caseQty: 12,
        description: "lifecycle",
        active: true,
      });
    }
  }
}, 120_000);

afterAll(async () => {
  await prisma.$disconnect();
});

describe("historic import lifecycle semantics", () => {
  it("FAILED hash is not already-imported; retry reaches SUCCESS; re-confirm is idempotent", async () => {
    const stamp = String(Date.now()).slice(-6);
    const code = `LF${stamp}`;
    const company = await prisma.company.create({
      data: { name: `Life ${stamp}`, status: "ACTIVE" },
    });
    await linkAndVerifyCompanyAutopartCustomerCode(adminId, {
      companyId: company.id,
      code,
    });
    await prisma.companyUser.create({
      data: {
        companyId: company.id,
        userId: buyerId,
        role: "TRADE_BUYER",
        status: "ACTIVE",
        isDefault: true,
      },
    });

    const { file561, fileSlrb } = tinyPair(code, stamp);
    const { hash561, hashSlrb } = hashes(file561, fileSlrb);

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
        diagnostics: {
          failure: { name: "Error", message: "forced prior failure" },
        },
      },
    });

    expect(
      await hasSuccessfulHistoricImport({
        companyId: company.id,
        fileHash561l: hash561,
        fileHashSlrb: hashSlrb,
      }),
    ).toBeNull();

    const previewFailed = await previewAutopartHistoryImport(adminId, {
      companyId: company.id,
      file561l: file561,
      fileSlrb: fileSlrb,
    });
    expect(previewFailed.canCommit).toBe(true);
    expect(previewFailed.alreadyImported).toBe(false);
    expect(previewFailed.priorImport?.status).toBe("FAILED");
    expect(
      previewFailed.issues.some((i) => i.code === "PREVIOUS_ATTEMPT_FAILED"),
    ).toBe(true);
    expect(previewFailed.issues.some((i) => i.code === "ALREADY_IMPORTED")).toBe(false);

    const ok = await confirmAutopartHistoryImport(adminId, {
      companyId: company.id,
      file561l: file561,
      fileSlrb: fileSlrb,
    });
    expect(ok.imported + ok.updated).toBeGreaterThan(0);
    const successRun = await prisma.autopartCustomerImportRun.findUniqueOrThrow({
      where: { id: ok.runId },
    });
    expect(successRun.status).toBe("COMMITTED");
    expect(successRun.completedAt).not.toBeNull();

    const previewOk = await previewAutopartHistoryImport(adminId, {
      companyId: company.id,
      file561l: file561,
      fileSlrb: fileSlrb,
    });
    expect(previewOk.alreadyImported).toBe(true);
    expect(previewOk.priorImport?.status).toBe("COMMITTED");
    expect(previewOk.issues.some((i) => i.code === "ALREADY_IMPORTED")).toBe(true);
    expect(previewOk.issues.some((i) => i.code === "PREVIOUS_ATTEMPT_FAILED")).toBe(false);

    const linesBefore = await prisma.autopartSalesLine.count({
      where: { companyId: company.id },
    });
    const docsBefore = await prisma.autopartSalesDocument.count({
      where: { companyId: company.id },
    });
    const wsBefore = await getCompanyAutopartHistoryWorkspace(adminId, company.id);
    const spendBefore = Number(wsBefore.historic.netSpend);

    const again = await confirmAutopartHistoryImport(adminId, {
      companyId: company.id,
      file561l: file561,
      fileSlrb: fileSlrb,
    });
    expect(again.imported + again.updated).toBeGreaterThan(0);
    expect(await prisma.autopartSalesLine.count({ where: { companyId: company.id } })).toBe(
      linesBefore,
    );
    expect(await prisma.autopartSalesDocument.count({ where: { companyId: company.id } })).toBe(
      docsBefore,
    );
    const wsAfter = await getCompanyAutopartHistoryWorkspace(adminId, company.id);
    expect(Number(wsAfter.historic.netSpend)).toBeCloseTo(spendBefore, 2);

    const portal = await listPortalHistoricPurchases(buyerId, {});
    expect(portal.items.some((i) => i.sku.toUpperCase() === "LIFE-SKU-A")).toBe(true);
  });

  it("phantom COMMITTED (0 rows) is not treated as successful and is repaired", async () => {
    const stamp = String(Date.now() + 1).slice(-6);
    const code = `PH${stamp}`;
    const company = await prisma.company.create({
      data: { name: `Phantom ${stamp}`, status: "ACTIVE" },
    });
    await linkAndVerifyCompanyAutopartCustomerCode(adminId, {
      companyId: company.id,
      code,
    });
    const { file561, fileSlrb } = tinyPair(code, stamp);
    const { hash561, hashSlrb } = hashes(file561, fileSlrb);

    const phantom = await prisma.autopartCustomerImportRun.create({
      data: {
        companyId: company.id,
        type: "HISTORY_561L_SLRB",
        status: "COMMITTED",
        fileHash: hash561,
        fileHashSlrb: hashSlrb,
        dryRun: false,
        createdById: adminId,
        completedAt: new Date(),
        rowsImported: 0,
        rowsUpdated: 0,
      },
    });

    expect(
      await hasSuccessfulHistoricImport({
        companyId: company.id,
        fileHash561l: hash561,
        fileHashSlrb: hashSlrb,
      }),
    ).toBeNull();

    const repaired = await prisma.autopartCustomerImportRun.findUniqueOrThrow({
      where: { id: phantom.id },
    });
    expect(repaired.status).toBe("FAILED");

    const preview = await previewAutopartHistoryImport(adminId, {
      companyId: company.id,
      file561l: file561,
      fileSlrb: fileSlrb,
    });
    expect(preview.alreadyImported).toBe(false);
    expect(preview.canCommit).toBe(true);
    expect(preview.issues.some((i) => i.code === "ALREADY_IMPORTED")).toBe(false);

    const ok = await confirmAutopartHistoryImport(adminId, {
      companyId: company.id,
      file561l: file561,
      fileSlrb: fileSlrb,
    });
    expect(ok.imported).toBeGreaterThan(0);
  });

  it("active PROCESSING blocks confirm; stale PROCESSING is recovered", async () => {
    const stamp = String(Date.now() + 2).slice(-6);
    const code = `PR${stamp}`;
    const company = await prisma.company.create({
      data: { name: `Proc ${stamp}`, status: "ACTIVE" },
    });
    await linkAndVerifyCompanyAutopartCustomerCode(adminId, {
      companyId: company.id,
      code,
    });
    const { file561, fileSlrb } = tinyPair(code, stamp);
    const { hash561, hashSlrb } = hashes(file561, fileSlrb);

    await prisma.autopartCustomerImportRun.create({
      data: {
        companyId: company.id,
        type: "HISTORY_561L_SLRB",
        status: "PROCESSING",
        fileHash: hash561,
        fileHashSlrb: hashSlrb,
        dryRun: false,
        createdById: adminId,
        createdAt: new Date(),
      },
    });

    const previewActive = await previewAutopartHistoryImport(adminId, {
      companyId: company.id,
      file561l: file561,
      fileSlrb: fileSlrb,
    });
    expect(previewActive.canCommit).toBe(false);
    expect(previewActive.priorImport?.status).toBe("PROCESSING");
    expect(previewActive.issues.some((i) => i.code === "IMPORT_IN_PROGRESS")).toBe(true);

    await expect(
      confirmAutopartHistoryImport(adminId, {
        companyId: company.id,
        file561l: file561,
        fileSlrb: fileSlrb,
      }),
    ).rejects.toBeInstanceOf(AuthError);

    // Stale PROCESSING (16 minutes old) is recovered and retryable
    await prisma.autopartCustomerImportRun.updateMany({
      where: { companyId: company.id, status: "PROCESSING" },
      data: { createdAt: new Date(Date.now() - 16 * 60 * 1000) },
    });

    const previewStale = await previewAutopartHistoryImport(adminId, {
      companyId: company.id,
      file561l: file561,
      fileSlrb: fileSlrb,
    });
    expect(previewStale.canCommit).toBe(true);
    expect(previewStale.issues.some((i) => i.code === "IMPORT_IN_PROGRESS")).toBe(false);

    const ok = await confirmAutopartHistoryImport(adminId, {
      companyId: company.id,
      file561l: file561,
      fileSlrb: fileSlrb,
    });
    expect(ok.imported + ok.updated).toBeGreaterThan(0);
  });

  it("forced write failure marks FAILED via root client and surfaces detail; retry succeeds without doubling", async () => {
    const stamp = String(Date.now() + 3).slice(-6);
    const code = `FF${stamp}`;
    const company = await prisma.company.create({
      data: { name: `ForceFail ${stamp}`, status: "ACTIVE" },
    });
    await linkAndVerifyCompanyAutopartCustomerCode(adminId, {
      companyId: company.id,
      code,
    });
    const { file561, fileSlrb } = tinyPair(code, stamp);

    const spy = vi
      .spyOn(PrismaClient.prototype, "$executeRaw")
      .mockRejectedValueOnce(new Error("forced bulk upsert failure"));
    await expect(
      confirmAutopartHistoryImport(adminId, {
        companyId: company.id,
        file561l: file561,
        fileSlrb: fileSlrb,
      }),
    ).rejects.toMatchObject({
      code: "IMPORT_FAILED",
      message: expect.stringContaining("forced bulk upsert failure"),
    });
    spy.mockRestore();

    const failed = await prisma.autopartCustomerImportRun.findFirst({
      where: { companyId: company.id, status: "FAILED", dryRun: false },
      orderBy: { createdAt: "desc" },
    });
    expect(failed).toBeTruthy();
    const diag = failed!.diagnostics as { failure?: { message?: string } } | null;
    expect(diag?.failure?.message).toContain("forced bulk upsert failure");
    expect(await prisma.autopartSalesLine.count({ where: { companyId: company.id } })).toBe(0);

    const preview = await previewAutopartHistoryImport(adminId, {
      companyId: company.id,
      file561l: file561,
      fileSlrb: fileSlrb,
    });
    expect(preview.alreadyImported).toBe(false);
    expect(preview.issues.some((i) => i.code === "PREVIOUS_ATTEMPT_FAILED")).toBe(true);
    expect(preview.canCommit).toBe(true);

    const ok = await confirmAutopartHistoryImport(adminId, {
      companyId: company.id,
      file561l: file561,
      fileSlrb: fileSlrb,
    });
    expect(ok.imported).toBeGreaterThan(0);
    const lineCount = await prisma.autopartSalesLine.count({ where: { companyId: company.id } });
    expect(lineCount).toBe(2);

    await confirmAutopartHistoryImport(adminId, {
      companyId: company.id,
      file561l: file561,
      fileSlrb: fileSlrb,
    });
    expect(await prisma.autopartSalesLine.count({ where: { companyId: company.id } })).toBe(2);
  });

  it("COMMITTED is only set after writes; success requires completedAt", async () => {
    const stamp = String(Date.now() + 4).slice(-6);
    const code = `SU${stamp}`;
    const company = await prisma.company.create({
      data: { name: `SuccessMark ${stamp}`, status: "ACTIVE" },
    });
    await linkAndVerifyCompanyAutopartCustomerCode(adminId, {
      companyId: company.id,
      code,
    });
    const { file561, fileSlrb } = tinyPair(code, stamp);

    const ok = await confirmAutopartHistoryImport(adminId, {
      companyId: company.id,
      file561l: file561,
      fileSlrb: fileSlrb,
    });
    const run = await prisma.autopartCustomerImportRun.findUniqueOrThrow({
      where: { id: ok.runId },
    });
    expect(run.status).toBe("COMMITTED");
    expect(run.completedAt).not.toBeNull();
    expect(run.rowsImported + run.rowsUpdated).toBeGreaterThan(0);
    // No PROCESSING left hanging
    expect(
      await prisma.autopartCustomerImportRun.count({
        where: { companyId: company.id, status: "PROCESSING" },
      }),
    ).toBe(0);
  });
});
