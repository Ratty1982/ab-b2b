import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { bootstrapRbac } from "../../prisma/bootstrap/rbac";
import { saveProduct } from "@/server/catalogue/service";
import { AuthError } from "@/server/rbac/guards";
import { getMyTradeTestLevel, setMyTradeTestLevel } from "@/server/admin-trade-test/service";
import { loadPricingActor, resolveVariantTradePrices } from "@/server/pricing/resolve-trade-price";
import { addToBasket, getBasket, getProductOrderingPanel } from "@/server/basket/service";
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
    data: { tradeTestPricingMode: "NONE", tradeTestPriceListId: null },
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
  it("trade customer cannot set trade test pricing mode", async () => {
    await expect(setMyTradeTestLevel(tradeId, { mode: "BASE_TRADE" })).rejects.toBeInstanceOf(AuthError);
    await expect(
      setMyTradeTestLevel(tradeId, { mode: "PRICE_LIST", priceListId: listA }),
    ).rejects.toBeInstanceOf(AuthError);
  });

  it("ADMIN + NONE disables ordering", async () => {
    await setMyTradeTestLevel(adminId, { mode: "NONE" });
    const view = await getMyTradeTestLevel(adminId);
    expect(view.mode).toBe("NONE");
    const actor = await loadPricingActor(adminId);
    expect(actor.adminTestPricingMode).toBe("NONE");
    expect(actor.adminTestPriceListId).toBeNull();
    const panel = await getProductOrderingPanel(adminId, { variantId });
    expect(panel.orderable).toBe(false);
    expect(panel.reason).toMatch(/trade test level/i);
    expect(panel.reason).not.toMatch(/Sign in/i);
  });

  it("ADMIN + BASE_TRADE uses ProductVariant.tradePrice and enables ordering", async () => {
    await setMyTradeTestLevel(adminId, { mode: "BASE_TRADE" });
    const view = await getMyTradeTestLevel(adminId);
    expect(view.mode).toBe("BASE_TRADE");
    expect(view.label).toBe("Default Trade Price");
    expect(view.priceListId).toBeNull();

    const actor = await loadPricingActor(adminId);
    expect(actor.adminTestPricingMode).toBe("BASE_TRADE");
    expect(actor.companyId).toBeNull();
    expect(actor.adminTestPriceListId).toBeNull();

    const variant = await prisma.productVariant.findUniqueOrThrow({ where: { id: variantId } });
    const priced = await resolveVariantTradePrices({
      companyId: null,
      priceListId: null,
      adminTestActive: true,
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
    expect(priced.get(variantId)?.unitPriceExVatDisplay).toBe("40.00");
    expect(priced.get(variantId)?.source).toBe("BASE");
    expect(priced.get(variantId)?.explanation.customerOverride).toBeNull();
    expect(priced.get(variantId)?.vatPercent).toBe(20);

    const panel = await getProductOrderingPanel(adminId, { variantId });
    expect(panel.orderable).toBe(true);
    expect(panel.caseQty).toBe(12);
    expect(panel.quantity).toBe(12);
    expect(panel.unitPriceExVatDisplay).toBe("40.00");
  });

  it("ADMIN + PRICE_LIST A then B changes pricing; switches to BASE_TRADE re-resolve", async () => {
    await setMyTradeTestLevel(adminId, { mode: "PRICE_LIST", priceListId: listA });
    let actor = await loadPricingActor(adminId);
    expect(actor.adminTestPricingMode).toBe("PRICE_LIST");
    expect(actor.adminTestPriceListId).toBe(listA);

    const variant = await prisma.productVariant.findUniqueOrThrow({ where: { id: variantId } });
    let priced = await resolveVariantTradePrices({
      companyId: null,
      priceListId: actor.adminTestPriceListId,
      adminTestActive: true,
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

    await setMyTradeTestLevel(adminId, { mode: "PRICE_LIST", priceListId: listB });
    actor = await loadPricingActor(adminId);
    priced = await resolveVariantTradePrices({
      companyId: null,
      priceListId: actor.adminTestPriceListId,
      adminTestActive: true,
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

    await setMyTradeTestLevel(adminId, { mode: "BASE_TRADE" });
    actor = await loadPricingActor(adminId);
    expect(actor.adminTestPricingMode).toBe("BASE_TRADE");
    priced = await resolveVariantTradePrices({
      companyId: null,
      priceListId: null,
      adminTestActive: true,
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
    expect(priced.get(variantId)?.unitPriceExVatDisplay).toBe("40.00");
    expect(priced.get(variantId)?.source).toBe("BASE");
  });

  it("BASE_TRADE and PRICE_LIST never receive CustomerPrice from a real company", async () => {
    const variant = await prisma.productVariant.findUniqueOrThrow({ where: { id: variantId } });

    await setMyTradeTestLevel(adminId, { mode: "BASE_TRADE" });
    let priced = await resolveVariantTradePrices({
      companyId: null,
      priceListId: null,
      adminTestActive: true,
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
    expect(priced.get(variantId)?.unitPriceExVatDisplay).toBe("40.00");
    expect(priced.get(variantId)?.explanation.customerOverride).toBeNull();

    await setMyTradeTestLevel(adminId, { mode: "PRICE_LIST", priceListId: listA });
    priced = await resolveVariantTradePrices({
      companyId: null,
      priceListId: listA,
      adminTestActive: true,
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

  it("quantity breaks still apply in BASE_TRADE and PRICE_LIST contexts", async () => {
    const variant = await prisma.productVariant.findUniqueOrThrow({ where: { id: variantId } });

    await setMyTradeTestLevel(adminId, { mode: "BASE_TRADE" });
    const at24Base = await resolveVariantTradePrices({
      companyId: null,
      priceListId: null,
      adminTestActive: true,
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
    expect(at24Base.get(variantId)?.source).toBe("QUANTITY_BREAK");
    expect(at24Base.get(variantId)?.unitPriceExVatDisplay).toBe("22.00");

    await setMyTradeTestLevel(adminId, { mode: "PRICE_LIST", priceListId: listB });
    const at24List = await resolveVariantTradePrices({
      companyId: null,
      priceListId: listB,
      adminTestActive: true,
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
    expect(at24List.get(variantId)?.source).toBe("QUANTITY_BREAK");
    expect(at24List.get(variantId)?.unitPriceExVatDisplay).toBe("22.00");
  });

  it("admin BASE_TRADE basket is isolated and re-prices when switching to PRICE_LIST", async () => {
    await setMyTradeTestLevel(adminId, { mode: "BASE_TRADE" });
    await prisma.basketItem.deleteMany({
      where: { basket: { userId: adminId, companyId: null } },
    });
    await prisma.basket.deleteMany({ where: { userId: adminId, companyId: null } });

    const beforeInv = await prisma.inventory.findFirstOrThrow({ where: { variantId } });
    const basket = await addToBasket(adminId, { variantId, quantity: 12 });
    expect(basket.adminTest).toBe(true);
    expect(basket.companyId).toBeNull();
    expect(basket.lines[0]!.quantity).toBe(12);
    expect(basket.lines[0]!.unitPriceExVatDisplay).toBe("40.00");

    const afterInv = await prisma.inventory.findFirstOrThrow({ where: { variantId } });
    expect(afterInv.qtyOnHand).toBe(beforeInv.qtyOnHand);
    expect(afterInv.qtyReserved).toBe(beforeInv.qtyReserved);
    expect(await prisma.order.count({ where: { companyId } })).toBe(0);

    await setMyTradeTestLevel(adminId, { mode: "PRICE_LIST", priceListId: listA });
    const repriced = await getBasket(adminId);
    expect(repriced.lines[0]!.unitPriceExVatDisplay).toBe("30.00");
    expect(repriced.adminTest).toBe(true);
  });

  it("audit records trade test mode changes", async () => {
    await setMyTradeTestLevel(adminId, { mode: "BASE_TRADE" });
    const event = await prisma.auditEvent.findFirst({
      where: {
        actorUserId: adminId,
        action: "user.trade_test_pricing_mode.updated",
      },
      orderBy: { createdAt: "desc" },
    });
    expect(event).not.toBeNull();
  });
});
