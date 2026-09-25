/**
 * Admin order delete — releases ACTIVE reservations back to sellable stock.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { bootstrapRbac } from "../../../prisma/bootstrap/rbac";
import { deleteAdminOrder } from "@/server/orders/service";
import { AuthError } from "@/server/rbac/guards";
import { getEffectiveSellableQuantity } from "@/domain/stock";

const prisma = new PrismaClient();
let adminId = "";
let viewerId = "";

async function ensureUser(email: string, roles: string[]) {
  let user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    user = await prisma.user.create({
      data: {
        email,
        name: email.split("@")[0]!,
        status: "ACTIVE",
        actorType: "INTERNAL",
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

async function createReservedOrder(orderNumber: string, status: "SUBMITTED" | "CONFIRMED" | "DISPATCHED" = "SUBMITTED") {
  const stamp = `${orderNumber}-${Math.random().toString(36).slice(2, 8)}`;
  const company = await prisma.company.create({
    data: { name: `Del Co ${stamp}`, status: "ACTIVE" },
  });
  const brand = await prisma.brand.create({
    data: { name: `Brand ${stamp}`, slug: `brand-${stamp}` },
  });
  const category = await prisma.category.create({
    data: { name: `Cat ${stamp}`, slug: `cat-${stamp}` },
  });
  const product = await prisma.product.create({
    data: {
      name: `Product ${stamp}`,
      slug: `product-${stamp}`,
      brandId: brand.id,
      categoryId: category.id,
      status: "ACTIVE",
      isActive: true,
      isTradeVisible: true,
    },
  });
  const variant = await prisma.productVariant.create({
    data: { productId: product.id, sku: `VAR-${stamp}`, isActive: true, tradePrice: 5 },
  });
  const warehouse = await prisma.warehouse.upsert({
    where: { code: "AUTOPART" },
    create: { code: "AUTOPART", name: "Autopart" },
    update: {},
  });
  const inventory = await prisma.inventory.create({
    data: {
      variantId: variant.id,
      warehouseId: warehouse.id,
      qtyOnHand: 100,
      qtyReserved: 12,
      status: "IN_STOCK",
    },
  });
  const order = await prisma.order.create({
    data: {
      orderNumber,
      companyId: company.id,
      status,
      subtotal: 44.28,
      vatTotal: 10.05,
      deliveryTotal: 5.95,
      grandTotal: 60.28,
      placedAt: new Date(),
      contactSnapshot: { name: "Alex", email: `del-${stamp}@example.test` },
      deliveryAddress: {
        line1: "1 Road",
        town: "Leeds",
        postcode: "LS1 1AA",
        country: "GB",
      },
      items: {
        create: [
          {
            sku: `SKU-${stamp}`,
            name: "Line",
            qty: 12,
            unitPrice: 3.69,
            customerUnitPrice: 3.69,
            vatRate: 20,
            lineTotal: 44.28,
            variantId: variant.id,
          },
        ],
      },
    },
  });
  const reservation = await prisma.orderStockReservation.create({
    data: {
      orderId: order.id,
      variantId: variant.id,
      inventoryId: inventory.id,
      quantity: 12,
      status: status === "DISPATCHED" ? "CONSUMED" : "ACTIVE",
      ...(status === "DISPATCHED" ? { consumedAt: new Date() } : {}),
    },
  });
  if (status === "DISPATCHED") {
    await prisma.inventory.update({
      where: { id: inventory.id },
      data: { qtyReserved: 0 },
    });
  }
  return { order, inventory, reservation, company };
}

beforeAll(async () => {
  await bootstrapRbac(prisma);
  adminId = await ensureUser("order-delete-admin@ab.test", ["SUPER_ADMIN"]);
  viewerId = await ensureUser("order-delete-viewer@ab.test", ["MANAGEMENT"]);
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("deleteAdminOrder", () => {
  it("releases ACTIVE reservation and deletes the order", async () => {
    const ab = `AB-${String(940000 + (Date.now() % 50000)).padStart(6, "0")}`;
    const { order, inventory, reservation } = await createReservedOrder(ab);

    const before = await prisma.inventory.findUniqueOrThrow({ where: { id: inventory.id } });
    expect(before.qtyReserved).toBe(12);
    expect(before.qtyOnHand).toBe(100);
    expect(
      getEffectiveSellableQuantity({
        autopartAvail: before.qtyOnHand,
        reservedQty: before.qtyReserved,
      }),
    ).toBe(88);

    const result = await deleteAdminOrder(adminId, order.id);
    expect(result.orderNumber).toBe(ab);
    expect(result.releasedQuantity).toBe(12);
    expect(result.reservationCount).toBe(1);

    await expect(prisma.order.findUnique({ where: { id: order.id } })).resolves.toBeNull();
    await expect(
      prisma.orderStockReservation.findUnique({ where: { id: reservation.id } }),
    ).resolves.toBeNull();

    const after = await prisma.inventory.findUniqueOrThrow({ where: { id: inventory.id } });
    expect(after.qtyOnHand).toBe(100);
    expect(after.qtyReserved).toBe(0);
    expect(
      getEffectiveSellableQuantity({
        autopartAvail: after.qtyOnHand,
        reservedQty: after.qtyReserved,
      }),
    ).toBe(100);

    const audit = await prisma.auditEvent.findFirst({
      where: { action: "order.deleted", entityId: order.id },
    });
    expect(audit).toBeTruthy();
  });

  it("blocks despatched orders", async () => {
    const ab = `AB-${String(950000 + (Date.now() % 40000)).padStart(6, "0")}`;
    const { order } = await createReservedOrder(ab, "DISPATCHED");
    await expect(deleteAdminOrder(adminId, order.id)).rejects.toBeInstanceOf(AuthError);
    await expect(deleteAdminOrder(adminId, order.id)).rejects.toMatchObject({
      code: "ORDER_ALREADY_DESPATCHED",
    });
    await expect(prisma.order.findUnique({ where: { id: order.id } })).resolves.toBeTruthy();
  });

  it("denies staff without orders.edit", async () => {
    const ab = `AB-${String(960000 + (Date.now() % 30000)).padStart(6, "0")}`;
    const { order } = await createReservedOrder(ab);
    await expect(deleteAdminOrder(viewerId, order.id)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });
});
