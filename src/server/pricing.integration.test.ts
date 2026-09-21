import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { bootstrapRbac } from "../../prisma/bootstrap/rbac";
import { saveProduct } from "@/server/catalogue/service";
import { getPublicProduct, listPublicProducts } from "@/server/catalogue/products";
import {
  previewTradePriceAsCustomer,
  upsertCustomerPrice,
  upsertPriceList,
  upsertPriceListItem,
  upsertPromotion,
  upsertQuantityBreak,
} from "@/server/pricing/service";
import { AuthError } from "@/server/rbac/guards";

const prisma = new PrismaClient();
let adminId = "";

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
  adminId = await ensureUser("pricing.admin@example.invalid", ["SUPER_ADMIN"]);
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("Phase 4A trade price resolution", () => {
  it("resolves customer over list over base, isolates companies, and hides anonymous trade", async () => {
    const sku = `PR4-${Date.now()}`;
    const product = await saveProduct(adminId, {
      sku,
      name: "Pricing fixture",
      brand: "Power Maxed",
      category: "Braking",
      trade: 8.6967,
      rrp: 17.99,
      packQty: 1,
      caseQty: 2,
      description: "pricing",
      active: true,
    });
    const variant = await prisma.productVariant.findFirstOrThrow({ where: { productId: product.id } });

    const list = await upsertPriceList(adminId, { name: `Distributor ${sku}` });
    await upsertPriceListItem(adminId, { priceListId: list.id, variantId: variant.id, unitPrice: 7.6 });

    const companyA = await prisma.company.create({
      data: { name: `Co A ${sku}`, status: "ACTIVE", priceListId: list.id },
    });
    const companyB = await prisma.company.create({
      data: { name: `Co B ${sku}`, status: "ACTIVE", priceListId: list.id },
    });
    await upsertCustomerPrice(adminId, { companyId: companyA.id, variantId: variant.id, unitPrice: 7.95 });

    const asA = await previewTradePriceAsCustomer(adminId, {
      variantId: variant.id,
      companyId: companyA.id,
      quantity: 1,
    });
    const asB = await previewTradePriceAsCustomer(adminId, {
      variantId: variant.id,
      companyId: companyB.id,
      quantity: 1,
    });
    expect(asA.resolved.source).toBe("CUSTOMER");
    expect(asA.resolved.unitPriceExVat).toBe("7.9500");
    expect(asB.resolved.source).toBe("PRICE_LIST");
    expect(asB.resolved.unitPriceExVat).toBe("7.6000");

    const anon = await getPublicProduct(null, sku);
    expect(anon?.card.price.trade).toBeNull();
    expect(anon?.card.price.source).toBe("hidden");
    expect(anon?.card.price.rrp).toBe(17.99);

    const staff = await getPublicProduct(adminId, sku);
    expect(staff?.card.price.trade).toBe(8.6967);
    expect(staff?.card.price.source).toBe("base_catalogue");

    const cat = await listPublicProducts({ userId: null, q: sku });
    expect(cat.items[0]?.price.trade).toBeNull();
  });

  it("applies volume breaks at threshold and ignores minQty=1 mirror", async () => {
    const sku = `PR4B-${Date.now()}`;
    const product = await saveProduct(adminId, {
      sku,
      name: "Break fixture",
      brand: "Steel Seal",
      category: "Engine Chemicals",
      trade: 8.7,
      rrp: 12,
      packQty: 1,
      caseQty: 2,
      description: "breaks",
      active: true,
    });
    const variant = await prisma.productVariant.findFirstOrThrow({ where: { productId: product.id } });
    await upsertQuantityBreak(adminId, { variantId: variant.id, minQty: 10, unitPrice: 8.2 });
    const company = await prisma.company.create({ data: { name: `Break Co ${sku}`, status: "ACTIVE" } });
    const below = await previewTradePriceAsCustomer(adminId, { variantId: variant.id, companyId: company.id, quantity: 2 });
    const at = await previewTradePriceAsCustomer(adminId, { variantId: variant.id, companyId: company.id, quantity: 10 });
    const caseQty = await previewTradePriceAsCustomer(adminId, { variantId: variant.id, companyId: company.id, quantity: 12 });
    expect(below.resolved.source).toBe("BASE");
    expect(at.resolved.source).toBe("QUANTITY_BREAK");
    expect(at.resolved.unitPriceExVat).toBe("8.2000");
    expect(caseQty.resolved.source).toBe("QUANTITY_BREAK");
  });

  it("applies one in-window promotion and denies trade users previewing another company", async () => {
    const sku = `PR4P-${Date.now()}`;
    const product = await saveProduct(adminId, {
      sku,
      name: "Promo fixture",
      brand: "Street Rhino",
      category: "Braking",
      trade: 10,
      rrp: 20,
      packQty: 1,
      caseQty: 1,
      description: "promo",
      active: true,
    });
    const variant = await prisma.productVariant.findFirstOrThrow({ where: { productId: product.id } });
    await upsertPromotion(adminId, {
      code: `WIN${Date.now()}`,
      name: "Ten off",
      type: "PERCENT",
      value: 10,
      isActive: true,
      skus: [sku],
      startsAt: new Date(Date.now() - 86400000).toISOString(),
      endsAt: new Date(Date.now() + 86400000).toISOString(),
    });
    const company = await prisma.company.create({ data: { name: `Promo Co ${sku}`, status: "ACTIVE" } });
    const resolved = await previewTradePriceAsCustomer(adminId, { variantId: variant.id, companyId: company.id, quantity: 1 });
    expect(resolved.resolved.source).toBe("PROMOTION");
    expect(resolved.resolved.vatPercent).toBe(20);

    const tradeId = await ensureUser(`trade.pricing.${Date.now()}@example.invalid`, [], "TRADE");
    const own = await prisma.company.create({ data: { name: `Trade Own ${sku}`, status: "ACTIVE" } });
    await prisma.companyUser.create({
      data: { companyId: own.id, userId: tradeId, role: "TRADE_BUYER", status: "ACTIVE", isDefault: true },
    });
    await expect(
      previewTradePriceAsCustomer(tradeId, { variantId: variant.id, companyId: company.id, quantity: 1 }),
    ).rejects.toBeInstanceOf(AuthError);
  });
});
