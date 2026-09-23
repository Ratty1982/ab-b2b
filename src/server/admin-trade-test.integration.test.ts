import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { bootstrapRbac } from "../../prisma/bootstrap/rbac";
import { saveProduct } from "@/server/catalogue/service";
import { AuthError } from "@/server/rbac/guards";
import { getMyTradeTestLevel, setMyTradeTestLevel } from "@/server/admin-trade-test/service";
import { loadPricingActor, resolveVariantTradePrices } from "@/server/pricing/resolve-trade-price";
import { addToBasket, getProductOrderingPanel } from "@/server/basket/service";
import { upsertQuantityBreak } from "@/server/pricing/service";

const prisma = new PrismaClient();
const suffix = `ttl-${Date.now()}`;
let adminId = "";
let tradeId = "";
let listA = "";
let listB = "";
let variantId = "";
let companyId = "";

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

beforeAll(async () => {
  await bootstrapRbac(prisma);
  adminId = await ensureUser(`admin.${suffix}@example.invalid`, ["SUPER_ADMIN"], "INTERNAL");
  tradeId = await ensureUser(`trade.${suffix}@example.invalid`, [], "TRADE");

  const a = await prisma.priceList.create({
    data: { code: `A-${suffix}`, name: "Trade Test A", currency: "GBP" },
  });
  const b = await prisma.priceList.create({
    data: { code: `B-${suffix}`, name: "Trade Test B", currency: "GBP" },
  });
  listA = a.id;
  listB = b.id;

  const product = await saveProduct(adminId, {
    sku: `SS-${suffix}`,
    name: "Steel Seal Head Gasket Repair",
    brand: "Power Maxed",
    category: "Braking",
    trade: 40,
    rrp: 79.99,
    packQty: 1,
    caseQty: 12,
    description: "steel-seal",
    active: true,
  });
  const variant = await prisma.productVariant.findFirstOrThrow({ where: { productId: product.id } });
  variantId = variant.id;
  await prisma.priceListItem.create({
    data: { priceListId: listA, variantId, unitPrice: 30 },
  });
  await prisma.priceListItem.create({
    data: { priceListId: listB, variantId, unitPrice: 25 },
  });
  await upsertQuantityBreak(adminId, { variantId, minQty: 24, unitPrice: 22 });

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
      qtyOnHand: 120,
      qtyReserved: 0,
      status: "IN_STOCK",
      externalSyncedAt: new Date(),
      sourceAvailRaw: "120",
    },
    update: {
      qtyOnHand: 120,
      qtyReserved: 0,
      status: "IN_STOCK",
      externalSyncedAt: new Date(),
      sourceAvailRaw: "120",
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

  const company = await prisma.company.create({
    data: { name: `TTL Co ${suffix}`, status: "ACTIVE", priceListId: listA },
  });
  companyId = company.id;
  await prisma.companyUser.create({
    data: {
      companyId,
      userId: tradeId,
      role: "TRADE_BUYER",
      status: "ACTIVE",
      isDefault: true,
    },
  });
  await prisma.customerPrice.create({
    data: { companyId, variantId, unitPrice: 11.11 },
  });
});

afterAll(async () => {
  await prisma.user.updateMany({
    where: { id: { in: [adminId, tradeId] } },
    data: { tradeTestPriceListId: null },
  });
  await prisma.basketItem.deleteMany({
    where: { basket: { userId: adminId, companyId: null } },
  });
  await prisma.basket.deleteMany({ where: { userId: adminId, companyId: null } });
  await prisma.customerPrice.deleteMany({ where: { companyId } });
  await prisma.companyUser.deleteMany({ where: { companyId } });
  await prisma.company.deleteMany({ where: { id: companyId } });
  await prisma.priceListItem.deleteMany({ where: { priceListId: { in: [listA, listB] } } });
  await prisma.priceList.deleteMany({ where: { id: { in: [listA, listB] } } });
  await prisma.$disconnect();
});

describe("Admin Trade Test Level", () => {
  it("trade customer cannot set tradeTestPriceListId", async () => {
    await expect(setMyTradeTestLevel(tradeId, { priceListId: listA })).rejects.toBeInstanceOf(AuthError);
  });

  it("admin can select PriceList A then B and pricing changes", async () => {
    await setMyTradeTestLevel(adminId, { priceListId: listA });
    let actor = await loadPricingActor(adminId);
    expect(actor.adminTestPriceListId).toBe(listA);
    expect(actor.companyId).toBeNull();

    const variant = await prisma.productVariant.findUniqueOrThrow({ where: { id: variantId } });
    let priced = await resolveVariantTradePrices({
      companyId: null,
      priceListId: actor.adminTestPriceListId,
      quantity: 12,
      variants: [
        {
          id: variant.id,
          sku: variant.sku,
          tradePrice: variant.tradePrice,
          vatCode: variant.vatCode,
        },
      ],
    });
    expect(priced.get(variantId)?.unitPriceExVatDisplay).toBe("30.00");
    expect(priced.get(variantId)?.source).toBe("PRICE_LIST");
    expect(priced.get(variantId)?.vatPercent).toBe(20);

    await setMyTradeTestLevel(adminId, { priceListId: listB });
    actor = await loadPricingActor(adminId);
    priced = await resolveVariantTradePrices({
      companyId: null,
      priceListId: actor.adminTestPriceListId,
      quantity: 12,
      variants: [
        {
          id: variant.id,
          sku: variant.sku,
          tradePrice: variant.tradePrice,
          vatCode: variant.vatCode,
        },
      ],
    });
    expect(priced.get(variantId)?.unitPriceExVatDisplay).toBe("25.00");
  });

  it("admin test context never receives CustomerPrice from a real company", async () => {
    await setMyTradeTestLevel(adminId, { priceListId: listA });
    const variant = await prisma.productVariant.findUniqueOrThrow({ where: { id: variantId } });
    const priced = await resolveVariantTradePrices({
      companyId: null,
      priceListId: listA,
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
    expect(priced.get(variantId)?.unitPriceExVatDisplay).toBe("30.00");
    expect(priced.get(variantId)?.explanation.customerOverride).toBeNull();
  });

  it("quantity breaks still apply in admin test context", async () => {
    await setMyTradeTestLevel(adminId, { priceListId: listB });
    const variant = await prisma.productVariant.findUniqueOrThrow({ where: { id: variantId } });
    const at24 = await resolveVariantTradePrices({
      companyId: null,
      priceListId: listB,
      quantity: 24,
      variants: [
        {
          id: variant.id,
          sku: variant.sku,
          tradePrice: variant.tradePrice,
          vatCode: variant.vatCode,
        },
      ],
    });
    expect(at24.get(variantId)?.source).toBe("QUANTITY_BREAK");
    expect(at24.get(variantId)?.unitPriceExVatDisplay).toBe("22.00");
  });

  it("admin with level A can add a full case to isolated basket; clearing level disables ordering", async () => {
    await setMyTradeTestLevel(adminId, { priceListId: listA });
    await prisma.basketItem.deleteMany({
      where: { basket: { userId: adminId, companyId: null } },
    });
    await prisma.basket.deleteMany({ where: { userId: adminId, companyId: null } });
    const panel = await getProductOrderingPanel(adminId, { variantId });
    expect(panel.orderable).toBe(true);
    expect(panel.caseQty).toBe(12);
    expect(panel.quantity).toBe(12);
    expect(panel.unitPriceExVatDisplay).toBe("30.00");

    const basket = await addToBasket(adminId, { variantId, quantity: 12 });
    expect(basket.adminTest).toBe(true);
    expect(basket.companyId).toBeNull();
    expect(basket.lines[0]!.quantity).toBe(12);

    await setMyTradeTestLevel(adminId, { priceListId: null });
    const view = await getMyTradeTestLevel(adminId);
    expect(view.priceListId).toBeNull();
    const blocked = await getProductOrderingPanel(adminId, { variantId });
    expect(blocked.orderable).toBe(false);
    expect(blocked.reason).toMatch(/trade test level/i);
  });

  it("audit records trade test level changes", async () => {
    await setMyTradeTestLevel(adminId, { priceListId: listA });
    const event = await prisma.auditEvent.findFirst({
      where: {
        actorUserId: adminId,
        action: "user.trade_test_price_list.updated",
      },
      orderBy: { createdAt: "desc" },
    });
    expect(event).not.toBeNull();
  });
});
