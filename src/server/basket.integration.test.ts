import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { bootstrapRbac } from "../../prisma/bootstrap/rbac";
import { saveProduct } from "@/server/catalogue/service";
import { AuthError } from "@/server/rbac/guards";
import {
  addToBasket,
  getBasket,
  getBasketSummary,
  getProductOrderingPanel,
  removeBasketItem,
  updateBasketItem,
} from "@/server/basket/service";
import { upsertQuantityBreak } from "@/server/pricing/service";

const prisma = new PrismaClient();
let adminId = "";

async function ensureUser(
  email: string,
  roles: string[],
  actorType: "INTERNAL" | "TRADE" = "INTERNAL",
) {
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
  } else if (user.actorType !== actorType) {
    user = await prisma.user.update({ where: { id: user.id }, data: { actorType } });
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

async function ensureTradeBuyer(email: string, companyId: string) {
  const userId = await ensureUser(email, [], "TRADE");
  await prisma.companyUser.upsert({
    where: { companyId_userId: { companyId, userId } },
    create: {
      companyId,
      userId,
      role: "TRADE_BUYER",
      status: "ACTIVE",
      isDefault: true,
    },
    update: { role: "TRADE_BUYER", status: "ACTIVE", isDefault: true },
  });
  return userId;
}

async function seedStock(variantId: string, avail: number) {
  const warehouse = await prisma.warehouse.upsert({
    where: { code: "AUTOPART" },
    create: { code: "AUTOPART", name: "Autopart" },
    update: {},
  });
  await prisma.inventory.upsert({
    where: { variantId_warehouseId: { variantId, warehouseId: warehouse.id } },
    create: {
      variantId,
      warehouseId: warehouse.id,
      qtyOnHand: avail,
      qtyReserved: 0,
      status: avail >= 21 ? "IN_STOCK" : avail > 0 ? "LOW" : "OUT_OF_STOCK",
      externalSyncedAt: new Date(),
      sourceAvailRaw: String(avail),
    },
    update: {
      qtyOnHand: avail,
      qtyReserved: 0,
      status: avail >= 21 ? "IN_STOCK" : avail > 0 ? "LOW" : "OUT_OF_STOCK",
      externalSyncedAt: new Date(),
      sourceAvailRaw: String(avail),
    },
  });
  await prisma.stockSyncRun.create({
    data: {
      source: "231PO3NEW",
      mode: "live",
      status: "SUCCESS",
      trigger: "test",
      completedAt: new Date(),
      rowsRead: 1,
      matched: 1,
      updated: 1,
      unchanged: 0,
      unmatched: 0,
      invalid: 0,
      duplicates: 0,
    },
  });
}

beforeAll(async () => {
  await bootstrapRbac(prisma);
  adminId = await ensureUser("basket.admin@example.invalid", ["SUPER_ADMIN"]);
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("Phase 6A basket ordering", () => {
  it("adds case multiples, merges duplicate adds, and ignores client price/stock", async () => {
    const sku = `B6A-${Date.now()}`;
    const product = await saveProduct(adminId, {
      sku,
      name: "Basket case product",
      brand: "Power Maxed",
      category: "Braking",
      trade: 3.25,
      rrp: 6.5,
      packQty: 1,
      caseQty: 12,
      description: "basket",
      active: true,
    });
    const variant = await prisma.productVariant.findFirstOrThrow({ where: { productId: product.id } });
    await seedStock(variant.id, 36);

    const company = await prisma.company.create({
      data: { name: `Basket Co ${sku}`, status: "ACTIVE" },
    });
    const buyerId = await ensureTradeBuyer(`buyer-${sku}@example.invalid`, company.id);

    const panel = await getProductOrderingPanel(buyerId, { variantId: variant.id });
    expect(panel.orderable).toBe(true);
    expect(panel.caseQty).toBe(12);
    expect(panel.quantity).toBe(12);
    expect(JSON.stringify(panel)).not.toMatch(/"sellableQty"|:36|:17|:10/);

    const first = await addToBasket(buyerId, { variantId: variant.id, quantity: 12 });
    expect(first.lineCount).toBe(1);
    expect(first.lines[0]!.quantity).toBe(12);
    expect(first.lines[0]!.unitPriceExVatDisplay).toBe("3.25");
    expect(first.lines[0]!.lineNetDisplay).toBe("39.00");
    expect(first.totals.netDisplay).toBe("39.00");

    const second = await addToBasket(buyerId, { variantId: variant.id, quantity: 12 });
    expect(second.lineCount).toBe(1);
    expect(second.lines[0]!.quantity).toBe(24);

    await expect(addToBasket(buyerId, { variantId: variant.id, quantity: 24 })).rejects.toBeInstanceOf(AuthError);
    const afterReject = await getBasket(buyerId);
    expect(afterReject.lines[0]!.quantity).toBe(24);

    const beforeQty = await prisma.inventory.findFirstOrThrow({ where: { variantId: variant.id } });
    expect(beforeQty.qtyOnHand).toBe(36);
    expect(beforeQty.qtyReserved).toBe(0);
  });

  it("enforces company isolation (IDOR)", async () => {
    const sku = `B6IDOR-${Date.now()}`;
    const product = await saveProduct(adminId, {
      sku,
      name: "IDOR product",
      brand: "Power Maxed",
      category: "Braking",
      trade: 5,
      rrp: 9,
      caseQty: 2,
      packQty: 1,
      description: "idor",
      active: true,
    });
    const variant = await prisma.productVariant.findFirstOrThrow({ where: { productId: product.id } });
    await seedStock(variant.id, 40);

    const companyA = await prisma.company.create({ data: { name: `A ${sku}`, status: "ACTIVE" } });
    const companyB = await prisma.company.create({ data: { name: `B ${sku}`, status: "ACTIVE" } });
    const buyerA = await ensureTradeBuyer(`a-${sku}@example.invalid`, companyA.id);
    const buyerB = await ensureTradeBuyer(`b-${sku}@example.invalid`, companyB.id);

    const basketA = await addToBasket(buyerA, { variantId: variant.id, quantity: 2 });
    const itemId = basketA.lines[0]!.id;

    await expect(updateBasketItem(buyerB, { itemId, quantity: 4 })).rejects.toBeInstanceOf(AuthError);
    await expect(removeBasketItem(buyerB, { itemId })).rejects.toBeInstanceOf(AuthError);

    const basketB = await getBasket(buyerB);
    expect(basketB.lineCount).toBe(0);
    expect(basketB.companyId).toBe(companyB.id);
  });

  it("revalidates stock drop, case change, and inactive product without deleting lines", async () => {
    const sku = `B6RV-${Date.now()}`;
    const product = await saveProduct(adminId, {
      sku,
      name: "Revalidate product",
      brand: "Power Maxed",
      category: "Braking",
      trade: 4,
      rrp: 8,
      caseQty: 12,
      packQty: 1,
      description: "rv",
      active: true,
    });
    const variant = await prisma.productVariant.findFirstOrThrow({ where: { productId: product.id } });
    await seedStock(variant.id, 48);

    const company = await prisma.company.create({ data: { name: `RV ${sku}`, status: "ACTIVE" } });
    const buyerId = await ensureTradeBuyer(`rv-${sku}@example.invalid`, company.id);
    await addToBasket(buyerId, { variantId: variant.id, quantity: 24 });

    await seedStock(variant.id, 17);
    let basket = await getBasket(buyerId);
    expect(basket.lines[0]!.issue).toBe("QUANTITY_UNAVAILABLE");
    expect(basket.lines[0]!.issueMessage).not.toContain("17");
    expect(basket.lines[0]!.quantity).toBe(24);

    await prisma.productVariant.update({ where: { id: variant.id }, data: { caseQty: 10 } });
    basket = await getBasket(buyerId);
    expect(basket.lines[0]!.issue).toBe("CASE_CONFIGURATION_CHANGED");

    await prisma.productVariant.update({ where: { id: variant.id }, data: { caseQty: 12 } });
    await seedStock(variant.id, 48);
    await prisma.product.update({ where: { id: product.id }, data: { status: "DISCONTINUED", isActive: false } });
    basket = await getBasket(buyerId);
    expect(basket.lines[0]!.issue).toBe("PRODUCT_UNAVAILABLE");
  });

  it("re-resolves quantity breaks when basket quantity changes", async () => {
    const sku = `B6QB-${Date.now()}`;
    const product = await saveProduct(adminId, {
      sku,
      name: "Qty break product",
      brand: "Power Maxed",
      category: "Braking",
      trade: 10,
      rrp: 15,
      caseQty: 6,
      packQty: 1,
      description: "qb",
      active: true,
    });
    const variant = await prisma.productVariant.findFirstOrThrow({ where: { productId: product.id } });
    await seedStock(variant.id, 60);
    await upsertQuantityBreak(adminId, { variantId: variant.id, minQty: 12, unitPrice: 8.5 });

    const company = await prisma.company.create({ data: { name: `QB ${sku}`, status: "ACTIVE" } });
    const buyerId = await ensureTradeBuyer(`qb-${sku}@example.invalid`, company.id);
    const atSix = await addToBasket(buyerId, { variantId: variant.id, quantity: 6 });
    expect(atSix.lines[0]!.unitPriceExVatDisplay).toBe("10.00");

    const atTwelve = await updateBasketItem(buyerId, {
      itemId: atSix.lines[0]!.id,
      quantity: 12,
    });
    expect(atTwelve.lines[0]!.unitPriceExVatDisplay).toBe("8.50");
    expect(atTwelve.lines[0]!.priceSource).toBe("QUANTITY_BREAK");
  });

  it("rejects anonymous basket mutation and missing caseQty", async () => {
    await expect(addToBasket("missing-user", { variantId: "clxxxxxxxxxxxxxxxxxxxxxx", quantity: 1 })).rejects.toBeTruthy();
    const summary = await getBasketSummary("not-a-real-user");
    expect(summary.lineCount).toBe(0);

    const sku = `B6NOCASE-${Date.now()}`;
    const product = await saveProduct(adminId, {
      sku,
      name: "No case",
      brand: "Power Maxed",
      category: "Braking",
      trade: 2,
      rrp: 4,
      packQty: 1,
      caseQty: 1,
      description: "nocase",
      active: true,
    });
    const variant = await prisma.productVariant.findFirstOrThrow({ where: { productId: product.id } });
    await prisma.productVariant.update({ where: { id: variant.id }, data: { caseQty: null } });
    await seedStock(variant.id, 50);
    const company = await prisma.company.create({ data: { name: `NC ${sku}`, status: "ACTIVE" } });
    const buyerId = await ensureTradeBuyer(`nc-${sku}@example.invalid`, company.id);
    await expect(addToBasket(buyerId, { variantId: variant.id, quantity: 1 })).rejects.toBeInstanceOf(AuthError);
  });

  it("admin without acting context is not told to Sign in and cannot invent a basket", async () => {
    const sku = `B6ADM-${Date.now()}`;
    const product = await saveProduct(adminId, {
      sku,
      name: "Admin cloth",
      brand: "Power Maxed",
      category: "Braking",
      trade: 2.19,
      rrp: 4.99,
      packQty: 1,
      caseQty: 1,
      description: "admin-pdp",
      active: true,
    });
    const variant = await prisma.productVariant.findFirstOrThrow({ where: { productId: product.id } });
    await seedStock(variant.id, 20);

    const panel = await getProductOrderingPanel(adminId, { variantId: variant.id });
    expect(panel.orderable).toBe(false);
    expect(panel.reason).toMatch(/Select a trade customer/i);
    expect(panel.reason).not.toMatch(/Sign in/i);
    await expect(addToBasket(adminId, { variantId: variant.id, quantity: 1 })).rejects.toBeInstanceOf(AuthError);
  });

  it("admin with acting context orders into that company's basket", async () => {
    const { startActingContext } = await import("@/server/acting-context");
    const { loadAccessProfile } = await import("@/server/rbac/access");
    const sku = `B6ACT-${Date.now()}`;
    const product = await saveProduct(adminId, {
      sku,
      name: "Acting cloth",
      brand: "Power Maxed",
      category: "Braking",
      trade: 2.19,
      rrp: 4.99,
      packQty: 1,
      caseQty: 1,
      description: "acting",
      active: true,
    });
    const variant = await prisma.productVariant.findFirstOrThrow({ where: { productId: product.id } });
    await seedStock(variant.id, 20);
    const company = await prisma.company.create({
      data: { name: `Acting Co ${sku}`, status: "ACTIVE" },
    });

    const profile = await loadAccessProfile(adminId);
    expect(profile).not.toBeNull();
    await startActingContext({
      profile: profile!,
      onBehalfOfCompanyId: company.id,
      reason: "Phase 6A admin ordering test",
    });

    const panel = await getProductOrderingPanel(adminId, { variantId: variant.id });
    expect(panel.orderable).toBe(true);
    expect(panel.caseQty).toBe(1);
    expect(panel.quantity).toBe(1);
    expect(panel.unitPriceExVatDisplay).toBe("2.19");
    expect(panel.reason).toBeNull();

    const basket = await addToBasket(adminId, { variantId: variant.id, quantity: 1 });
    expect(basket.companyId).toBe(company.id);
    expect(basket.lineCount).toBe(1);
    expect(basket.lines[0]!.quantity).toBe(1);
  });
});
