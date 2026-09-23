import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { bootstrapRbac } from "../../prisma/bootstrap/rbac";
import { AuthError } from "@/server/rbac/guards";
import {
  clearCompanyAutopartCustomerCode,
  normalizeAutopartCustomerCode,
  setCompanyAutopartCustomerCode,
  verifyCompanyAutopartCustomerCode,
} from "@/server/companies/autopart-account";
import { submitTradeApplication, getTradeApplication, approveTradeApplication } from "@/server/applications/service";
import { upsertCustomerPrice, deleteCustomerPrice, listCustomerPrices } from "@/server/pricing/service";
import { resolveVariantTradePrices } from "@/server/pricing/resolve-trade-price";
import { saveProduct } from "@/server/catalogue/service";

const prisma = new PrismaClient();
const suffix = `c6a5-${Date.now()}`;
let adminId = "";
let tradeId = "";
let companyA = "";
let companyB = "";
let listId = "";
let variantId = "";

async function ensureUser(email: string, roles: string[], actorType: "INTERNAL" | "TRADE") {
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
  adminId = await ensureUser(`admin.${suffix}@example.invalid`, ["SUPER_ADMIN"], "INTERNAL");
  tradeId = await ensureUser(`trade.${suffix}@example.invalid`, [], "TRADE");

  const list = await prisma.priceList.create({
    data: { code: `L-${suffix}`, name: `List ${suffix}`, currency: "GBP" },
  });
  listId = list.id;

  const product = await saveProduct(adminId, {
    sku: `SS-${suffix}`,
    name: "Steel Seal Head Gasket Repair",
    brand: "Power Maxed",
    category: "Braking",
    trade: 25.95,
    rrp: 39.99,
    packQty: 1,
    caseQty: 12,
    description: "commercial",
    active: true,
  });
  const variant = await prisma.productVariant.findFirstOrThrow({ where: { productId: product.id } });
  variantId = variant.id;
  await prisma.priceListItem.create({
    data: { priceListId: listId, variantId, unitPrice: 23 },
  });

  const a = await prisma.company.create({
    data: { name: `ABC ${suffix}`, status: "ACTIVE", priceListId: listId },
  });
  const b = await prisma.company.create({
    data: { name: `Other ${suffix}`, status: "ACTIVE", priceListId: listId },
  });
  companyA = a.id;
  companyB = b.id;
  await prisma.companyUser.create({
    data: {
      companyId: companyA,
      userId: tradeId,
      role: "TRADE_BUYER",
      status: "ACTIVE",
      isDefault: true,
    },
  });
});

afterAll(async () => {
  await prisma.customerPrice.deleteMany({ where: { companyId: { in: [companyA, companyB] } } });
  await prisma.companyUser.deleteMany({ where: { companyId: companyA } });
  await prisma.company.deleteMany({ where: { id: { in: [companyA, companyB] } } });
  await prisma.priceListItem.deleteMany({ where: { priceListId: listId } });
  await prisma.priceList.deleteMany({ where: { id: listId } });
  await prisma.$disconnect();
});

describe("Phase 6A.5 commercial accounts", () => {
  it("normalizes Autopart codes without destroying leading zeros", () => {
    expect(normalizeAutopartCustomerCode("  AB 001  ")).toBe("AB 001");
    expect(normalizeAutopartCustomerCode("00123")).toBe("00123");
    expect(normalizeAutopartCustomerCode("   ")).toBeNull();
  });

  it("CustomerPrice wins for company A; company B keeps list price; remove falls back", async () => {
    await upsertCustomerPrice(adminId, {
      companyId: companyA,
      variantId,
      unitPrice: 21.75,
    });
    const listed = await listCustomerPrices(adminId, companyA);
    expect(listed.items[0]!.normalPriceDisplay).toBe("£23.00");
    expect(listed.items[0]!.unitPriceDisplay).toBe("£21.75");

    const variant = await prisma.productVariant.findUniqueOrThrow({ where: { id: variantId } });
    const forA = await resolveVariantTradePrices({
      companyId: companyA,
      quantity: 1,
      variants: [
        {
          id: variant.id,
          sku: variant.sku,
          tradePrice: variant.tradePrice,
          vatCode: variant.vatCode,
        },
      ],
    });
    expect(forA.get(variantId)?.unitPriceExVatDisplay).toBe("21.75");
    expect(forA.get(variantId)?.source).toBe("CUSTOMER");

    const forB = await resolveVariantTradePrices({
      companyId: companyB,
      quantity: 1,
      variants: [
        {
          id: variant.id,
          sku: variant.sku,
          tradePrice: variant.tradePrice,
          vatCode: variant.vatCode,
        },
      ],
    });
    expect(forB.get(variantId)?.unitPriceExVatDisplay).toBe("23.00");
    expect(forB.get(variantId)?.explanation.customerOverride).toBeNull();

    const anon = await resolveVariantTradePrices({
      companyId: null,
      quantity: 1,
      variants: [
        {
          id: variant.id,
          sku: variant.sku,
          tradePrice: variant.tradePrice,
          vatCode: variant.vatCode,
        },
      ],
    });
    expect(anon.get(variantId)?.explanation.customerOverride).toBeNull();

    await deleteCustomerPrice(adminId, listed.items[0]!.id);
    const after = await resolveVariantTradePrices({
      companyId: companyA,
      quantity: 1,
      variants: [
        {
          id: variant.id,
          sku: variant.sku,
          tradePrice: variant.tradePrice,
          vatCode: variant.vatCode,
        },
      ],
    });
    expect(after.get(variantId)?.unitPriceExVatDisplay).toBe("23.00");
  });

  it("trade customer cannot set Autopart code or CustomerPrice", async () => {
    await expect(
      setCompanyAutopartCustomerCode(tradeId, { companyId: companyA, code: "HACK" }),
    ).rejects.toBeInstanceOf(AuthError);
    await expect(
      upsertCustomerPrice(tradeId, { companyId: companyA, variantId, unitPrice: 1 }),
    ).rejects.toBeInstanceOf(AuthError);
  });

  it("registration claimed Autopart code does not verify Company link", async () => {
    const submitted = await submitTradeApplication({
      companyName: `Claim Co ${suffix}`,
      primaryContact: {
        firstName: "Sam",
        lastName: "Claim",
        email: `claim.${suffix}@example.invalid`,
        phone: null,
        role: null,
      },
      brandsInterest: [],
      claimedAutopartCustomerCode: "ABC001",
      websiteConfirm: "",
    });
    const app = await getTradeApplication(adminId, submitted.id);
    expect(app.claimedAutopartCustomerCode).toBe("ABC001");

    const approved = await approveTradeApplication(adminId, { id: submitted.id });
    const company = await prisma.company.findUniqueOrThrow({
      where: { id: approved.companyId },
    });
    expect(company.autopartCustomerCode).toBeNull();
    expect(company.autopartCustomerCodeVerifiedAt).toBeNull();
  });

  it("staff set / verify / change / clear Autopart code; duplicates rejected", async () => {
    const set = await setCompanyAutopartCustomerCode(adminId, {
      companyId: companyA,
      code: `AP-${suffix}`,
    });
    expect(set.code).toBe(`AP-${suffix}`);
    expect(set.verified).toBe(false);

    const verified = await verifyCompanyAutopartCustomerCode(adminId, { companyId: companyA });
    expect(verified.verified).toBe(true);
    expect(verified.verifiedBy?.id).toBe(adminId);

    const changed = await setCompanyAutopartCustomerCode(adminId, {
      companyId: companyA,
      code: `AP2-${suffix}`,
    });
    expect(changed.code).toBe(`AP2-${suffix}`);
    expect(changed.verified).toBe(false);
    expect(changed.verifiedAt).toBeNull();

    await setCompanyAutopartCustomerCode(adminId, {
      companyId: companyB,
      code: `AP2-${suffix}`,
    }).then(
      () => {
        throw new Error("expected duplicate rejection");
      },
      (error) => {
        expect(error).toBeInstanceOf(AuthError);
        expect((error as AuthError).code).toBe("AUTOPART_CODE_DUPLICATE");
      },
    );

    const cleared = await clearCompanyAutopartCustomerCode(adminId, { companyId: companyA });
    expect(cleared.code).toBeNull();
    expect(cleared.verified).toBe(false);

    const audit = await prisma.auditEvent.findFirst({
      where: {
        companyId: companyA,
        action: { startsWith: "company.autopart_account." },
      },
      orderBy: { createdAt: "desc" },
    });
    expect(audit).not.toBeNull();
  });
});
