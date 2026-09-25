import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { bootstrapRbac } from "../../../prisma/bootstrap/rbac";
import { saveProduct } from "@/server/catalogue/service";
import { AuthError } from "@/server/rbac/guards";
import { addToBasket, getBasket } from "@/server/basket/service";
import {
  getCheckoutContext,
  getPortalOrder,
  placeOrder,
  previewCheckout,
} from "@/server/orders/service";

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

async function seedCompanyWithAddress(name: string) {
  const company = await prisma.company.create({
    data: { name, status: "ACTIVE", paymentTerms: "Net 30" },
  });
  const address = await prisma.address.create({
    data: {
      companyId: company.id,
      type: "DELIVERY",
      label: "Warehouse",
      line1: "10 Industrial Way",
      town: "Leeds",
      postcode: "LS1 1AA",
      country: "GB",
      isDefaultDelivery: true,
    },
  });
  return { company, address };
}

beforeAll(async () => {
  await bootstrapRbac(prisma);
  adminId = await ensureUser("orders.admin@example.invalid", ["SUPER_ADMIN"]);
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("Phase 6B checkout order creation", () => {
  it("places a normal case-multiple order and reserves AB stock", async () => {
    const sku = `O6B-${Date.now()}`;
    const product = await saveProduct(adminId, {
      sku,
      name: "Checkout case product",
      brand: "Power Maxed",
      category: "Braking",
      trade: 3.25,
      rrp: 6.5,
      packQty: 1,
      caseQty: 12,
      description: "checkout",
      active: true,
    });
    const variant = await prisma.productVariant.findFirstOrThrow({
      where: { productId: product.id },
    });
    await seedStock(variant.id, 48);

    const { company, address } = await seedCompanyWithAddress(`Order Co ${sku}`);
    const buyerId = await ensureTradeBuyer(`buyer-${sku}@example.invalid`, company.id);

    const beforeInv = await prisma.inventory.findFirstOrThrow({ where: { variantId: variant.id } });
    expect(beforeInv.qtyOnHand).toBe(48);
    expect(beforeInv.qtyReserved).toBe(0);

    await addToBasket(buyerId, { variantId: variant.id, quantity: 24 });
    const ctx = await getCheckoutContext(buyerId);
    expect(ctx.companyId).toBe(company.id);
    expect(ctx.hasVerifiedAutopartCode).toBe(false);
    expect(ctx.basket.lineCount).toBe(1);
    expect(ctx.canPlaceOrder).toBe(true);

    const key = `idem-${sku}-normal`;
    const result = await placeOrder(buyerId, {
      idempotencyKey: key,
      addressId: address.id,
      poNumber: "PO-100",
      expectedLinePrices: [{ variantId: variant.id, customerUnitPrice: "3.25" }],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.order.status).toBe("SUBMITTED");
    expect(result.order.orderNumber).toMatch(/^AB-\d{6}$/);
    expect(result.order.poNumber).toBe("PO-100");
    expect(result.order.externalRef).toBeNull();
    expect(result.order.paymentTerms).toBe("Net 30");
    expect(result.order.items).toHaveLength(1);
    expect(result.order.items[0]!.qty).toBe(24);
    expect(result.order.items[0]!.orderingMode).toBe("CASE");
    // 24 × £3.25 = £78.00 goods → £5.95 delivery (below £150)
    expect(result.order.subtotal).toBe("78.00");
    expect(result.order.deliveryTotal).toBe("5.95");
    expect(Number(result.order.grandTotal)).toBeGreaterThan(Number(result.order.subtotal));

    const dbOrder = await prisma.order.findUniqueOrThrow({
      where: { id: result.order.id },
      include: { items: true },
    });
    expect(dbOrder.deliveryTotal.toString()).toBe("5.95");
    expect(dbOrder.externalRef).toBeNull();
    expect(dbOrder.status).toBe("SUBMITTED");
    expect(dbOrder.items[0]!.customerUnitPrice.toString()).toBe("3.25");
    expect(Number(dbOrder.items[0]!.unitPrice.toString())).toBe(3.25);
    expect(dbOrder.items[0]!.unitPrice.toFixed(4)).toBe("3.2500");

    const afterInv = await prisma.inventory.findFirstOrThrow({ where: { variantId: variant.id } });
    expect(afterInv.qtyOnHand).toBe(48);
    expect(afterInv.qtyReserved).toBe(24);

    const reservation = await prisma.orderStockReservation.findFirstOrThrow({
      where: { orderId: result.order.id },
    });
    expect(reservation.status).toBe("ACTIVE");
    expect(reservation.quantity).toBe(24);

    const basket = await prisma.basket.findFirst({
      where: { companyId: company.id },
      orderBy: { updatedAt: "desc" },
    });
    expect(basket?.status).toBe("CONVERTED");
  });

  it("allows final part-case qty 7 of caseQty 12", async () => {
    const sku = `O6BFP-${Date.now()}`;
    const product = await saveProduct(adminId, {
      sku,
      name: "Final part checkout",
      brand: "Power Maxed",
      category: "Braking",
      trade: 4.5,
      rrp: 9,
      packQty: 1,
      caseQty: 12,
      description: "final",
      active: true,
    });
    const variant = await prisma.productVariant.findFirstOrThrow({
      where: { productId: product.id },
    });
    await seedStock(variant.id, 7);

    const { company, address } = await seedCompanyWithAddress(`FP Co ${sku}`);
    const buyerId = await ensureTradeBuyer(`fp-${sku}@example.invalid`, company.id);

    await addToBasket(buyerId, { variantId: variant.id, quantity: 7 });
    const basket = await getBasket(buyerId);
    expect(basket.lines[0]!.isFinalPartCase).toBe(true);
    expect(basket.lines[0]!.quantity).toBe(7);

    const result = await placeOrder(buyerId, {
      idempotencyKey: `idem-${sku}-fp`,
      addressId: address.id,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.order.items[0]!.qty).toBe(7);
    expect(result.order.items[0]!.orderingMode).toBe("FINAL_PART_CASE");

    const dbItem = await prisma.orderItem.findFirstOrThrow({
      where: { orderId: result.order.id },
    });
    expect(dbItem.caseQty).toBe(12);
    expect(dbItem.orderingMode).toBe("FINAL_PART_CASE");

    const inv = await prisma.inventory.findFirstOrThrow({ where: { variantId: variant.id } });
    expect(inv.qtyOnHand).toBe(7);
    expect(inv.qtyReserved).toBe(7);
  });

  it("blocks place when expected unit price changed", async () => {
    const sku = `O6BPC-${Date.now()}`;
    const product = await saveProduct(adminId, {
      sku,
      name: "Price change product",
      brand: "Power Maxed",
      category: "Braking",
      trade: 10,
      rrp: 20,
      packQty: 1,
      caseQty: 6,
      description: "price",
      active: true,
    });
    const variant = await prisma.productVariant.findFirstOrThrow({
      where: { productId: product.id },
    });
    await seedStock(variant.id, 60);

    const { company, address } = await seedCompanyWithAddress(`PC Co ${sku}`);
    const buyerId = await ensureTradeBuyer(`pc-${sku}@example.invalid`, company.id);
    await addToBasket(buyerId, { variantId: variant.id, quantity: 6 });

    const preview = await previewCheckout(buyerId, {
      addressId: address.id,
      expectedLinePrices: [{ variantId: variant.id, customerUnitPrice: "9.50" }],
    });
    expect(preview.hasBlockingIssues).toBe(true);
    expect(preview.lines[0]!.issue).toBe("PRICE_UPDATED");

    const result = await placeOrder(buyerId, {
      idempotencyKey: `idem-${sku}-pc`,
      addressId: address.id,
      expectedLinePrices: [{ variantId: variant.id, customerUnitPrice: "9.50" }],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("REVIEW_REQUIRED");
    expect(result.lines[0]!.issue).toBe("PRICE_UPDATED");

    const open = await prisma.basket.findFirst({
      where: { companyId: company.id, status: "OPEN" },
    });
    expect(open).toBeTruthy();
    expect(await prisma.order.count({ where: { companyId: company.id } })).toBe(0);
  });

  it("returns the same order for an idempotent double place", async () => {
    const sku = `O6BID-${Date.now()}`;
    const product = await saveProduct(adminId, {
      sku,
      name: "Idempotent product",
      brand: "Power Maxed",
      category: "Braking",
      trade: 2,
      rrp: 4,
      packQty: 1,
      caseQty: 4,
      description: "idem",
      active: true,
    });
    const variant = await prisma.productVariant.findFirstOrThrow({
      where: { productId: product.id },
    });
    await seedStock(variant.id, 40);

    const { company, address } = await seedCompanyWithAddress(`Idem Co ${sku}`);
    const buyerId = await ensureTradeBuyer(`idem-${sku}@example.invalid`, company.id);
    await addToBasket(buyerId, { variantId: variant.id, quantity: 8 });

    const key = `idem-${sku}-double`;
    const first = await placeOrder(buyerId, {
      idempotencyKey: key,
      addressId: address.id,
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    const second = await placeOrder(buyerId, {
      idempotencyKey: key,
      addressId: address.id,
    });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.order.id).toBe(first.order.id);
    expect(second.order.orderNumber).toBe(first.order.orderNumber);
    expect(await prisma.order.count({ where: { companyId: company.id } })).toBe(1);
  });

  it("prevents company B from reading company A order (IDOR)", async () => {
    const sku = `O6BIDOR-${Date.now()}`;
    const product = await saveProduct(adminId, {
      sku,
      name: "IDOR order product",
      brand: "Power Maxed",
      category: "Braking",
      trade: 5,
      rrp: 10,
      packQty: 1,
      caseQty: 2,
      description: "idor",
      active: true,
    });
    const variant = await prisma.productVariant.findFirstOrThrow({
      where: { productId: product.id },
    });
    await seedStock(variant.id, 20);

    const { company: companyA, address } = await seedCompanyWithAddress(`A ${sku}`);
    const { company: companyB } = await seedCompanyWithAddress(`B ${sku}`);
    const buyerA = await ensureTradeBuyer(`a-${sku}@example.invalid`, companyA.id);
    const buyerB = await ensureTradeBuyer(`b-${sku}@example.invalid`, companyB.id);

    await addToBasket(buyerA, { variantId: variant.id, quantity: 2 });
    const placed = await placeOrder(buyerA, {
      idempotencyKey: `idem-${sku}-idor`,
      addressId: address.id,
    });
    expect(placed.ok).toBe(true);
    if (!placed.ok) return;

    await expect(getPortalOrder(buyerB, placed.order.id)).rejects.toBeInstanceOf(AuthError);
    const own = await getPortalOrder(buyerA, placed.order.id);
    expect(own.id).toBe(placed.order.id);
    expect(own.companyId).toBe(companyA.id);
  });
});
