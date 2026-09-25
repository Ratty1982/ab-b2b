/**
 * Server-side delivery charge on checkout / placeOrder.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { bootstrapRbac } from "../../../prisma/bootstrap/rbac";
import { saveProduct } from "@/server/catalogue/service";
import { addToBasket, getBasket } from "@/server/basket/service";
import { placeOrder, previewCheckout } from "@/server/orders/service";
import { buildOrderReceivedCustomerBodies } from "@/server/orders/email";
import { moneyToString, parseMoney } from "@/domain/money";

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
}

beforeAll(async () => {
  await bootstrapRbac(prisma);
  adminId = await ensureUser(`deliv.admin.${Date.now()}@example.invalid`, ["SUPER_ADMIN"]);
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("trade delivery on placeOrder", () => {
  it("snapshots £5.95 delivery under £150 and FREE at/above £150", async () => {
    const stamp = Date.now();

    // Under threshold: 1 case × £25.72 = £25.72 → delivery £5.95, VAT £6.33, gross £38.00
    const p1 = await saveProduct(adminId, {
      sku: `DEL-LOW-${stamp}`,
      name: "Delivery low",
      brand: "Power Maxed",
      category: "Braking",
      trade: 25.72,
      rrp: 40,
      packQty: 1,
      caseQty: 1,
      description: "delivery test",
      active: true,
    });
    const v1 = await prisma.productVariant.findFirstOrThrow({ where: { productId: p1.id } });
    await seedStock(v1.id, 100);

    const company = await prisma.company.create({
      data: {
        name: `Deliv Co ${stamp}`,
        status: "ACTIVE",
        taxStatus: "STANDARD",
        paymentTerms: "30 Days Net",
      },
    });
    const address = await prisma.address.create({
      data: {
        companyId: company.id,
        type: "DELIVERY",
        line1: "1 Test Street",
        town: "Birmingham",
        postcode: "B1 1AA",
        country: "GB",
        isDefaultDelivery: true,
      },
    });
    const buyerId = await ensureUser(`deliv.buyer.${stamp}@example.invalid`, [], "TRADE");
    await prisma.companyUser.create({
      data: {
        companyId: company.id,
        userId: buyerId,
        role: "TRADE_BUYER",
        status: "ACTIVE",
        isDefault: true,
      },
    });

    await addToBasket(buyerId, { variantId: v1.id, quantity: 1 });
    const basket = await getBasket(buyerId);
    expect(basket.totals.netDisplay).toBe("25.72");
    expect(basket.delivery.deliveryNetDisplay).toBe("5.95");
    expect(basket.delivery.vatWithDeliveryDisplay).toBe("6.33");
    expect(basket.delivery.orderGrossDisplay).toBe("38.00");

    const preview = await previewCheckout(buyerId, {
      addressId: address.id,
      expectedLinePrices: [{ variantId: v1.id, customerUnitPrice: "25.72" }],
    });
    expect(preview.totals.subtotal).toBe("25.72");
    expect(preview.totals.deliveryTotal).toBe("5.95");
    expect(preview.totals.vatTotal).toBe("6.33");
    expect(preview.totals.grandTotal).toBe("38.00");
    expect(preview.totals.freeDelivery).toBe(false);

    const placed = await placeOrder(buyerId, {
      idempotencyKey: `deliv-low-${stamp}`,
      addressId: address.id,
      poNumber: "PO-DELIV-LOW",
      expectedLinePrices: [{ variantId: v1.id, customerUnitPrice: "25.72" }],
    });
    expect(placed.ok).toBe(true);
    if (!placed.ok) return;
    expect(placed.order.subtotal).toBe("25.72");
    expect(placed.order.deliveryTotal).toBe("5.95");
    expect(placed.order.vatTotal).toBe("6.33");
    expect(placed.order.grandTotal).toBe("38.00");

    const email = buildOrderReceivedCustomerBodies({
      orderId: placed.order.id,
      orderNumber: placed.order.orderNumber,
      companyName: company.name,
      status: "SUBMITTED",
      poNumber: "PO-DELIV-LOW",
      currency: "GBP",
      subtotal: placed.order.subtotal,
      vatTotal: placed.order.vatTotal,
      deliveryTotal: placed.order.deliveryTotal,
      grandTotal: placed.order.grandTotal,
      placedAt: new Date(),
      paymentTerms: "30 Days Net",
      deliveryInstructions: null,
      deliveryAddress: {
        line1: "1 Test Street",
        line2: null,
        town: "Birmingham",
        county: null,
        postcode: "B1 1AA",
        country: "GB",
      },
      contact: { name: "Buyer", email: `deliv.buyer.${stamp}@example.invalid`, phone: null },
      items: [
        {
          sku: v1.sku,
          name: "Delivery low",
          qty: 1,
          customerUnitPrice: "25.72",
          lineTotal: "25.72",
          orderingMode: "CASE",
        },
      ],
      autopartAccountLinked: false,
      autopartCustomerCodeSnapshot: null,
      salesRepNameSnapshot: null,
      salesRepCodeSnapshot: null,
      portalOrderUrl: "https://example.test/portal/orders/x",
      adminOrderUrl: "https://example.test/admin/orders/x",
    });
    expect(email.text).toContain("Goods ex VAT: £25.72");
    expect(email.text).toContain("Delivery: £5.95");
    expect(email.html).toContain("£5.95");
    expect(email.html).not.toContain("Confirmed to your trade account terms");

    // Free delivery: 6 × £25.72 = £154.32 ≥ £150
    const company2 = await prisma.company.create({
      data: {
        name: `Deliv Free ${stamp}`,
        status: "ACTIVE",
        taxStatus: "STANDARD",
      },
    });
    const address2 = await prisma.address.create({
      data: {
        companyId: company2.id,
        type: "DELIVERY",
        line1: "2 Free Street",
        town: "Leeds",
        postcode: "LS1 1AA",
        country: "GB",
        isDefaultDelivery: true,
      },
    });
    const buyer2 = await ensureUser(`deliv.free.${stamp}@example.invalid`, [], "TRADE");
    await prisma.companyUser.create({
      data: {
        companyId: company2.id,
        userId: buyer2,
        role: "TRADE_BUYER",
        status: "ACTIVE",
        isDefault: true,
      },
    });
    await addToBasket(buyer2, { variantId: v1.id, quantity: 6 });
    const freeBasket = await getBasket(buyer2);
    expect(moneyToString(parseMoney(freeBasket.totals.netDisplay)!, 2)).toBe("154.32");
    expect(freeBasket.delivery.freeDelivery).toBe(true);
    expect(freeBasket.delivery.deliveryNetDisplay).toBe("0.00");

    const freePlaced = await placeOrder(buyer2, {
      idempotencyKey: `deliv-free-${stamp}`,
      addressId: address2.id,
      expectedLinePrices: [{ variantId: v1.id, customerUnitPrice: "25.72" }],
    });
    expect(freePlaced.ok).toBe(true);
    if (!freePlaced.ok) return;
    expect(freePlaced.order.deliveryTotal).toBe("0.00");
    expect(freePlaced.order.subtotal).toBe("154.32");
  });

  it("does not charge delivery VAT for exempt companies", async () => {
    const stamp = Date.now();
    const p = await saveProduct(adminId, {
      sku: `DEL-EX-${stamp}`,
      name: "Exempt delivery",
      brand: "Power Maxed",
      category: "Braking",
      trade: 40,
      rrp: 60,
      packQty: 1,
      caseQty: 1,
      description: "exempt",
      active: true,
    });
    const v = await prisma.productVariant.findFirstOrThrow({ where: { productId: p.id } });
    // Force ZERO_RATED on variant so goods VAT is 0; company EXEMPT also zeroes delivery VAT
    await prisma.productVariant.update({
      where: { id: v.id },
      data: { vatCode: "ZERO_RATED" },
    });
    await seedStock(v.id, 50);

    const company = await prisma.company.create({
      data: {
        name: `Exempt Co ${stamp}`,
        status: "ACTIVE",
        taxStatus: "EXEMPT",
      },
    });
    const address = await prisma.address.create({
      data: {
        companyId: company.id,
        type: "DELIVERY",
        line1: "9 Exempt Rd",
        town: "Cardiff",
        postcode: "CF10 1AA",
        country: "GB",
        isDefaultDelivery: true,
      },
    });
    const buyerId = await ensureUser(`deliv.ex.${stamp}@example.invalid`, [], "TRADE");
    await prisma.companyUser.create({
      data: {
        companyId: company.id,
        userId: buyerId,
        role: "TRADE_BUYER",
        status: "ACTIVE",
        isDefault: true,
      },
    });

    await addToBasket(buyerId, { variantId: v.id, quantity: 1 });
    const preview = await previewCheckout(buyerId, {
      addressId: address.id,
      expectedLinePrices: [{ variantId: v.id, customerUnitPrice: "40.00" }],
    });
    expect(preview.totals.subtotal).toBe("40.00");
    expect(preview.totals.deliveryTotal).toBe("5.95");
    expect(preview.totals.vatTotal).toBe("0.00");
    expect(preview.totals.grandTotal).toBe("45.95");
  });
});
