import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { bootstrapRbac } from "../../../prisma/bootstrap/rbac";
import { AuthError } from "@/server/rbac/guards";
import {
  confirmAutopartCreditImport,
  confirmAutopartHistoryImport,
  getCompanyAutopartHistoryWorkspace,
  listPortalHistoricPurchases,
  previewAutopartCreditImport,
  previewAutopartHistoryImport,
  verifyAutopartAccountAlias,
} from "@/server/companies/autopart-history";
import { linkAndVerifyCompanyAutopartCustomerCode } from "@/server/companies/autopart-account";
import { saveProduct } from "@/server/catalogue/service";

const prisma = new PrismaClient();
const fixtureDir = resolve(import.meta.dirname, "../../domain/fixtures");
const file561 = readFileSync(resolve(fixtureDir, "autopart-561l-sample.csv"), "utf8");
const fileSlrb = readFileSync(resolve(fixtureDir, "autopart-slrb-sample.csv"), "utf8");
const file407 = readFileSync(resolve(fixtureDir, "autopart-407p100-sample.csv"), "utf8");

let adminId = "";
let buyerAId = "";
let buyerBId = "";
let companyAId = "";
let companyBId = "";

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

let accountA = "YORKMOT";
let accountB = "OTHERCO";

beforeAll(async () => {
  await bootstrapRbac(prisma);
  adminId = await ensureUser("ap-hist.admin@example.invalid", ["SUPER_ADMIN"]);
  const stamp = Date.now();
  // Unique codes per run — Autopart customer codes are globally unique.
  accountA = `YH${String(stamp).slice(-8)}`;
  accountB = `OB${String(stamp).slice(-8)}`;

  const companyA = await prisma.company.create({
    data: {
      name: `AP Hist A ${stamp}`,
      status: "ACTIVE",
      paymentTerms: "30 Days",
      creditLimit: 1000,
    },
  });
  companyAId = companyA.id;
  await linkAndVerifyCompanyAutopartCustomerCode(adminId, {
    companyId: companyAId,
    code: accountA,
  });

  const companyB = await prisma.company.create({
    data: {
      name: `AP Hist B ${stamp}`,
      status: "ACTIVE",
    },
  });
  companyBId = companyB.id;
  await linkAndVerifyCompanyAutopartCustomerCode(adminId, {
    companyId: companyBId,
    code: accountB,
  });

  buyerAId = await ensureUser(`ap-hist.buyer.a.${stamp}@example.invalid`, [], "TRADE");
  buyerBId = await ensureUser(`ap-hist.buyer.b.${stamp}@example.invalid`, [], "TRADE");
  await prisma.companyUser.create({
    data: {
      companyId: companyAId,
      userId: buyerAId,
      role: "TRADE_BUYER",
      status: "ACTIVE",
      isDefault: true,
    },
  });
  await prisma.companyUser.create({
    data: {
      companyId: companyBId,
      userId: buyerBId,
      role: "TRADE_BUYER",
      status: "ACTIVE",
      isDefault: true,
    },
  });

  async function ensureSku(sku: string, name: string, brand: string, trade: number, rrp: number) {
    const existing = await prisma.productVariant.findUnique({ where: { sku } });
    if (existing) return;
    await saveProduct(adminId, {
      sku,
      name,
      brand,
      category: "Engine",
      trade,
      rrp,
      packQty: 1,
      caseQty: 12,
      description: "test",
      active: true,
    });
  }
  await ensureSku("SS", "Steel Seal Head Gasket Repair", "Steel Seal", 25.95, 40);
  await ensureSku("PMCSEAL", "Coolant Seal", "Power Maxed", 5.04, 10);
});

afterAll(async () => {
  await prisma.$disconnect();
});

function withAccount(text: string, code: string, alias?: string) {
  return text.replace(/YORKMOT/g, alias ?? code);
}

describe("Autopart history import", () => {
  it("blocks wrong account, imports with match, is idempotent, and scopes portal data", async () => {
    const file561A = withAccount(file561, accountA);
    const fileSlrbA = withAccount(fileSlrb, accountA);
    const aliasCode = `${accountA}O`;
    const file561Alias = withAccount(file561, accountA, aliasCode);
    const fileSlrbAlias = withAccount(fileSlrb, accountA, aliasCode);

    const wrong = await previewAutopartHistoryImport(adminId, {
      companyId: companyAId,
      file561l: file561Alias,
      fileSlrb: fileSlrbAlias,
      filename561l: "561l.csv",
      filenameSlrb: "slrb.csv",
    });
    expect(wrong.canCommit).toBe(false);
    expect(
      wrong.issues.some(
        (i) => i.code === "ACCOUNT_MISMATCH" || i.code === "ACCOUNT_ALIAS_REQUIRED",
      ),
    ).toBe(true);

    await verifyAutopartAccountAlias(adminId, {
      companyId: companyAId,
      alias: aliasCode,
      note: "Known report alias",
    });
    const aliased = await previewAutopartHistoryImport(adminId, {
      companyId: companyAId,
      file561l: file561Alias,
      fileSlrb: fileSlrbAlias,
    });
    expect(aliased.canCommit).toBe(true);

    const preview = await previewAutopartHistoryImport(adminId, {
      companyId: companyAId,
      file561l: file561A,
      fileSlrb: fileSlrbA,
      filename561l: "561l.csv",
      filenameSlrb: "slrb.csv",
    });
    expect(preview.canCommit).toBe(true);
    expect(preview.matching.matchedDocuments).toBeGreaterThanOrEqual(2);
    expect(preview.products.matchedAbSkus).toBeGreaterThanOrEqual(2);

    const first = await confirmAutopartHistoryImport(adminId, {
      companyId: companyAId,
      file561l: file561A,
      fileSlrb: fileSlrbA,
      filename561l: "561l.csv",
      filenameSlrb: "slrb.csv",
    });
    expect(first.imported).toBeGreaterThan(0);

    const lines = await prisma.autopartSalesLine.count({ where: { companyId: companyAId } });
    const docs = await prisma.autopartSalesDocument.count({ where: { companyId: companyAId } });

    const second = await confirmAutopartHistoryImport(adminId, {
      companyId: companyAId,
      file561l: file561A,
      fileSlrb: fileSlrbA,
    });
    expect(second.imported + second.updated).toBeGreaterThan(0);
    expect(await prisma.autopartSalesLine.count({ where: { companyId: companyAId } })).toBe(lines);
    expect(await prisma.autopartSalesDocument.count({ where: { companyId: companyAId } })).toBe(docs);

    const ws = await getCompanyAutopartHistoryWorkspace(adminId, companyAId);
    expect(ws.historic.imported).toBe(true);
    expect(Number(ws.historic.netSpend)).toBeCloseTo(622.8 + 60.48 - 51.9 + 30, 2);

    const portalA = await listPortalHistoricPurchases(buyerAId, {});
    expect(portalA.items.some((i) => i.sku.toUpperCase() === "SS")).toBe(true);
    const ss = portalA.items.find((i) => i.sku.toUpperCase() === "SS")!;
    expect(ss.canBuyAgain).toBe(true);
    // Latest dated SLRB match for SS includes credit SS100900 on 10 Oct 14
    expect(ss.lastPurchasedDate).toBe("2014-10-10");

    await expect(listPortalHistoricPurchases(buyerBId, {})).resolves.toMatchObject({
      items: [],
    });

    // Portal cannot preview/import
    await expect(
      previewAutopartHistoryImport(buyerAId, {
        companyId: companyAId,
        file561l: file561A,
        fileSlrb: fileSlrbA,
      }),
    ).rejects.toBeInstanceOf(AuthError);
  });
});

describe("Autopart credit 407P100 import", () => {
  it("imports regression totals and updates idempotently", async () => {
    const file407A = withAccount(file407, accountA);
    const preview = await previewAutopartCreditImport(adminId, {
      companyId: companyAId,
      file407: file407A,
      filename: "407.csv",
    });
    expect(preview.canCommit).toBe(true);
    expect(preview.position?.creditLimit).toBe("5000.00");
    expect(preview.position?.usedCredit).toBe("3494.75");
    expect(preview.position?.availableCreditRaw).toBe("1505.25");

    await confirmAutopartCreditImport(adminId, {
      companyId: companyAId,
      file407: file407A,
      filename: "407.csv",
    });
    let pos = await prisma.autopartCreditPosition.findUniqueOrThrow({
      where: { companyId: companyAId },
    });
    expect(Number(pos.availableCreditRaw)).toBeCloseTo(1505.25, 2);

    const reducedText = `Account,Invoices,Picking,DropShip,CrossDock,Suspends,UnConsol,Total,Credit Limit
${accountA},"£2,494.75",£0.00,£0.00,£0.00,£0.00,£0.00,"£2,494.75","£5,000.00"
`;
    await confirmAutopartCreditImport(adminId, {
      companyId: companyAId,
      file407: reducedText,
    });
    pos = await prisma.autopartCreditPosition.findUniqueOrThrow({
      where: { companyId: companyAId },
    });
    expect(Number(pos.availableCreditRaw)).toBeCloseTo(2505.25, 2);

    // Same file again — still one row
    await confirmAutopartCreditImport(adminId, {
      companyId: companyAId,
      file407: reducedText,
    });
    expect(await prisma.autopartCreditPosition.count({ where: { companyId: companyAId } })).toBe(1);

    await expect(
      previewAutopartCreditImport(buyerAId, { companyId: companyAId, file407: file407A }),
    ).rejects.toBeInstanceOf(AuthError);
  });
});
