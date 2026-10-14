/**
 * Super Admin deletion of dispatched test orders.
 * Does not change physical stock or real Autopart records.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { bootstrapRbac } from "../../../prisma/bootstrap/rbac";
import { allocateOrderNumber } from "@/server/orders/order-number";
import {
  deleteDispatchedTestOrder,
  previewDispatchedTestOrderDeletion,
} from "@/server/orders/delete-dispatched-test-order";
import { deleteAdminOrder } from "@/server/orders/service";
import { AuthError } from "@/server/rbac/guards";

const prisma = new PrismaClient();
let superAdminId = "";
let managementId = "";
let salesManagerId = "";
let salesRepId = "";
let regularAdminId = "";

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

function nextOrderNumber() {
  const n = 880000 + Math.floor(Math.random() * 19999);
  return `AB-${String(n).padStart(6, "0")}`;
}

async function createOrder(options: {
  status?: "SUBMITTED" | "DISPATCHED" | "DELIVERED";
  qtyReserved?: number;
  reservations?: Array<"ACTIVE" | "CONSUMED" | "RELEASED">;
  despatchedQty?: number;
  autopartExportStatus?: "NOT_EXPORTED" | "EXPORTED";
  autopartExportCount?: number;
  externalRef?: string;
}) {
  const stamp = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const status = options.status ?? "DISPATCHED";
  const company = await prisma.company.create({
    data: { name: `Test delete ${stamp}`, status: "ACTIVE" },
  });
  const brand = await prisma.brand.create({
    data: { name: `Brand ${stamp}`, slug: `brand-tdel-${stamp}` },
  });
  const category = await prisma.category.create({
    data: { name: `Cat ${stamp}`, slug: `cat-tdel-${stamp}` },
  });
  const product = await prisma.product.create({
    data: {
      name: `Product ${stamp}`,
      slug: `product-tdel-${stamp}`,
      brandId: brand.id,
      categoryId: category.id,
      status: "ACTIVE",
      isActive: true,
      isTradeVisible: true,
    },
  });
  const variant = await prisma.productVariant.create({
    data: { productId: product.id, sku: `TDEL-${stamp}`, isActive: true, tradePrice: 5 },
  });
  const warehouse = await prisma.warehouse.upsert({
    where: { code: "AUTOPART" },
    create: { code: "AUTOPART", name: "Autopart" },
    update: {},
  });
  const qtyReserved = options.qtyReserved ?? 0;
  const inventory = await prisma.inventory.create({
    data: {
      variantId: variant.id,
      warehouseId: warehouse.id,
      qtyOnHand: 100,
      qtyReserved,
      status: "IN_STOCK",
    },
  });
  const orderNumber = nextOrderNumber();
  const order = await prisma.order.create({
    data: {
      orderNumber,
      companyId: company.id,
      status,
      subtotal: 44.28,
      vatTotal: 10.05,
      deliveryTotal: 5.95,
      grandTotal: 60.28,
      currency: "GBP",
      placedAt: new Date(),
      ...(options.externalRef ? { externalRef: options.externalRef } : {}),
      autopartExportStatus: options.autopartExportStatus ?? "NOT_EXPORTED",
      autopartExportCount: options.autopartExportCount ?? 0,
      contactSnapshot: { name: "Test Buyer", email: `tdel-${stamp}@example.test` },
      deliveryAddress: { line1: "1 Road", town: "Leeds", postcode: "LS1 1AA", country: "GB" },
      items: {
        create: [
          {
            sku: `SKU-${stamp}`,
            name: "Test line",
            qty: 12,
            unitPrice: 3.69,
            customerUnitPrice: 3.69,
            vatRate: 20,
            lineTotal: 44.28,
            variantId: variant.id,
            despatchedQty: options.despatchedQty ?? 0,
          },
        ],
      },
    },
  });
  const kinds = options.reservations ?? [];
  for (const reservationStatus of kinds) {
    await prisma.orderStockReservation.create({
      data: {
        orderId: order.id,
        variantId: variant.id,
        inventoryId: inventory.id,
        quantity: reservationStatus === "ACTIVE" ? qtyReserved : 5,
        status: reservationStatus,
        ...(reservationStatus === "CONSUMED" ? { consumedAt: new Date() } : {}),
        ...(reservationStatus === "RELEASED" ? { releasedAt: new Date() } : {}),
      },
    });
  }
  return { order, inventory, company, variant, orderNumber, stamp };
}

function deletionInput(orderId: string, orderNumber: string, overrides: Record<string, unknown> = {}) {
  return {
    orderId,
    reason: "Internal test order. No physical goods were shipped.",
    confirmTestData: true,
    confirmOrderNumber: orderNumber,
    ...overrides,
  };
}

beforeAll(async () => {
  await bootstrapRbac(prisma);
  superAdminId = await ensureUser("dispatched-test-delete-super@ab.test", ["SUPER_ADMIN"]);
  managementId = await ensureUser("dispatched-test-delete-mgmt@ab.test", ["MANAGEMENT"]);
  salesManagerId = await ensureUser("dispatched-test-delete-smgr@ab.test", ["SALES_MANAGER"]);
  salesRepId = await ensureUser("dispatched-test-delete-rep@ab.test", ["SALES_REPRESENTATIVE"]);

  const adminRole = await prisma.role.upsert({
    where: { key: "TEST_REGULAR_ADMIN" },
    create: {
      key: "TEST_REGULAR_ADMIN",
      name: "Test regular admin",
      isSystem: false,
      description: "Local test role with admin access but not Super Admin.",
    },
    update: {},
  });
  for (const key of ["orders.view", "orders.edit", "admin.access"]) {
    const permission = await prisma.permission.findUniqueOrThrow({ where: { key } });
    await prisma.rolePermission.upsert({
      where: { roleId_permissionId: { roleId: adminRole.id, permissionId: permission.id } },
      create: { roleId: adminRole.id, permissionId: permission.id },
      update: {},
    });
  }
  regularAdminId = await ensureUser("dispatched-test-delete-admin@ab.test", ["TEST_REGULAR_ADMIN"]);
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("deleteDispatchedTestOrder", () => {
  it("lets Super Admin delete an eligible dispatched test order and keeps the audit", async () => {
    const target = await createOrder({
      qtyReserved: 7,
      reservations: ["ACTIVE", "CONSUMED", "RELEASED"],
    });
    const other = await createOrder({
      status: "SUBMITTED",
      qtyReserved: 4,
      reservations: ["ACTIVE"],
    });
    await prisma.orderFulfilmentEvent.create({
      data: {
        orderId: target.order.id,
        kind: "ORDER_RECEIVED",
        summary: "Placed during an internal test",
        source: "ORDER_PLACE",
      },
    });
    const quote = await prisma.quote.create({
      data: {
        quoteNumber: `QT-TDEL-${target.stamp}`,
        companyId: target.company.id,
        status: "CONVERTED",
        currency: "GBP",
        subtotal: 10,
        vatTotal: 2,
        deliveryTotal: 0,
        grandTotal: 12,
        convertedOrderId: target.order.id,
        convertedAt: new Date(),
      },
    });
    await prisma.order.update({
      where: { id: target.order.id },
      data: { sourceQuoteId: quote.id, sourceQuoteNumber: quote.quoteNumber },
    });
    const draft = await prisma.salesOrderDraft.create({
      data: {
        companyId: target.company.id,
        createdByUserId: superAdminId,
        status: "PLACED",
        placedOrderId: target.order.id,
      },
    });
    await prisma.transactionalEmail.create({
      data: {
        purpose: "ORDER_RECEIVED",
        status: "SENT",
        toEmail: "buyer@example.test",
        subject: "Order received",
        textBody: "Test",
        entityType: "Order",
        entityId: target.order.id,
        idempotencyKey: `ORDER_RECEIVED:${target.order.id}`,
      },
    });

    await expect(deleteAdminOrder(superAdminId, target.order.id)).rejects.toMatchObject({
      code: "ORDER_ALREADY_DESPATCHED",
    });

    const preview = await previewDispatchedTestOrderDeletion(superAdminId, target.order.id);
    expect(preview.eligible).toBe(true);
    expect(preview.customerName).toBe(target.company.name);
    expect(preview.grandTotal).toBe("60.28");
    expect(preview.fulfilmentRecords.map((event) => event.kind)).toContain("ORDER_RECEIVED");

    const before = await prisma.inventory.findUniqueOrThrow({ where: { id: target.inventory.id } });
    expect(before.qtyOnHand).toBe(100);
    expect(before.qtyReserved).toBe(7);

    const result = await deleteDispatchedTestOrder(
      superAdminId,
      deletionInput(target.order.id, target.orderNumber),
    );
    expect(result.orderNumber).toBe(target.orderNumber);
    expect(result.releasedQuantity).toBe(7);

    expect(await prisma.order.findUnique({ where: { id: target.order.id } })).toBeNull();
    expect(
      await prisma.order.findFirst({ where: { orderNumber: target.orderNumber } }),
    ).toBeNull();
    expect(await prisma.orderItem.count({ where: { orderId: target.order.id } })).toBe(0);
    expect(await prisma.orderFulfilmentEvent.count({ where: { orderId: target.order.id } })).toBe(0);
    expect(await prisma.orderStockReservation.count({ where: { orderId: target.order.id } })).toBe(0);
    expect(
      await prisma.transactionalEmail.count({
        where: { entityType: "Order", entityId: target.order.id },
      }),
    ).toBe(0);

    const stock = await prisma.inventory.findUniqueOrThrow({ where: { id: target.inventory.id } });
    expect(stock.qtyOnHand).toBe(100);
    expect(stock.qtyReserved).toBe(0);

    const otherOrder = await prisma.order.findUniqueOrThrow({ where: { id: other.order.id } });
    expect(otherOrder.status).toBe("SUBMITTED");
    expect(otherOrder.grandTotal.toString()).toBe("60.28");
    const otherStock = await prisma.inventory.findUniqueOrThrow({ where: { id: other.inventory.id } });
    expect(otherStock.qtyOnHand).toBe(100);
    expect(otherStock.qtyReserved).toBe(4);
    expect(
      await prisma.orderStockReservation.count({
        where: { orderId: other.order.id, status: "ACTIVE" },
      }),
    ).toBe(1);

    const quoteAfter = await prisma.quote.findUniqueOrThrow({ where: { id: quote.id } });
    expect(quoteAfter.convertedOrderId).toBeNull();
    const draftAfter = await prisma.salesOrderDraft.findUniqueOrThrow({ where: { id: draft.id } });
    expect(draftAfter.placedOrderId).toBeNull();

    const retired = await prisma.retiredOrderNumber.findUniqueOrThrow({
      where: { orderNumber: target.orderNumber },
    });
    expect(retired.orderId).toBe(target.order.id);
    expect(retired.previousStatus).toBe("DISPATCHED");
    expect(retired.retiredByUserId).toBe(superAdminId);

    const audit = await prisma.auditEvent.findFirstOrThrow({
      where: { action: "order.test_dispatched_deleted", entityId: target.order.id },
    });
    expect(audit.actorUserId).toBe(superAdminId);
    expect(audit.companyId).toBe(target.company.id);
    const metadata = audit.metadata as {
      orderNumber: string;
      previousStatus: string;
      customerId: string;
      deletedByUserId: string;
      reason: string;
      deletedAt: string;
      stockReservationChecks: {
        activeReleasedQuantity: number;
        consumedQuantityNotReleased: number;
        alreadyReleasedQuantityNotReleasedAgain: number;
        qtyOnHandUnchanged: boolean;
      };
      externalReferenceChecks: { invoiceCount: number; blockers: string[] };
    };
    expect(metadata.orderNumber).toBe(target.orderNumber);
    expect(metadata.previousStatus).toBe("DISPATCHED");
    expect(metadata.customerId).toBe(target.company.id);
    expect(metadata.deletedByUserId).toBe(superAdminId);
    expect(metadata.reason).toMatch(/No physical goods/);
    expect(metadata.deletedAt).toBeTruthy();
    expect(metadata.stockReservationChecks).toMatchObject({
      activeReleasedQuantity: 7,
      consumedQuantityNotReleased: 5,
      alreadyReleasedQuantityNotReleasedAgain: 5,
      qtyOnHandUnchanged: true,
    });
    expect(metadata.externalReferenceChecks.invoiceCount).toBe(0);
    expect(metadata.externalReferenceChecks.blockers).toEqual([]);

    const sequenceValue = Number(target.orderNumber.slice(3));
    await expect(
      prisma.$transaction(async (tx) => {
        await tx.$executeRaw`
          UPDATE "OrderNumberSequence"
          SET "nextValue" = ${sequenceValue}
          WHERE "id" = 'default'
        `;
        const allocated = await allocateOrderNumber(tx);
        expect(allocated).not.toBe(target.orderNumber);
        throw new Error("ROLLBACK_SEQUENCE");
      }),
    ).rejects.toThrow("ROLLBACK_SEQUENCE");
  });

  it("denies management, sales staff, and regular admin", async () => {
    const { order, orderNumber } = await createOrder({});
    for (const userId of [managementId, salesManagerId, salesRepId, regularAdminId]) {
      await expect(
        deleteDispatchedTestOrder(userId, deletionInput(order.id, orderNumber)),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
    expect(await prisma.order.findUnique({ where: { id: order.id } })).toBeTruthy();
  });

  it("rejects a missing reason and a wrong order number", async () => {
    const { order, orderNumber } = await createOrder({});
    await expect(
      deleteDispatchedTestOrder(
        superAdminId,
        deletionInput(order.id, orderNumber, { reason: "   " }),
      ),
    ).rejects.toMatchObject({ code: "REASON_REQUIRED" });
    await expect(
      deleteDispatchedTestOrder(
        superAdminId,
        deletionInput(order.id, orderNumber, { confirmOrderNumber: "AB-000000" }),
      ),
    ).rejects.toMatchObject({ code: "ORDER_NUMBER_MISMATCH" });
    await expect(
      deleteDispatchedTestOrder(
        superAdminId,
        deletionInput(order.id, orderNumber, { confirmTestData: false }),
      ),
    ).rejects.toMatchObject({ code: "TEST_DATA_CONFIRMATION_REQUIRED" });
    expect(await prisma.order.findUnique({ where: { id: order.id } })).toBeTruthy();
    expect(
      await prisma.auditEvent.findFirst({
        where: { action: "order.test_dispatched_deleted", entityId: order.id },
      }),
    ).toBeNull();
  });

  it("refuses a linked credit note and leaves it attached", async () => {
    const { order, orderNumber, company, stamp } = await createOrder({});
    const invoice = await prisma.invoice.create({
      data: {
        invoiceNumber: `CR-TDEL-${stamp}`,
        companyId: company.id,
        orderId: order.id,
        status: "PART_PAID",
        subtotal: 10,
        vatTotal: 2,
        grandTotal: 12,
        autopartDocumentKind: "CREDIT",
      },
    });
    await expect(
      deleteDispatchedTestOrder(superAdminId, deletionInput(order.id, orderNumber)),
    ).rejects.toMatchObject({ code: "TEST_ORDER_DELETE_BLOCKED" });
    await expect(
      deleteDispatchedTestOrder(superAdminId, deletionInput(order.id, orderNumber)),
    ).rejects.toThrow(/credit note/);
    const still = await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id } });
    expect(still.orderId).toBe(order.id);
    expect(await prisma.order.findUnique({ where: { id: order.id } })).toBeTruthy();
  });

  it("refuses genuine shipment evidence and an Autopart payment document", async () => {
    const shipped = await createOrder({ despatchedQty: 2 });
    await prisma.orderFulfilmentEvent.create({
      data: {
        orderId: shipped.order.id,
        kind: "DESPATCHED",
        summary: "Goods left the warehouse",
        source: "AUTOPART_504C",
      },
    });
    await expect(
      deleteDispatchedTestOrder(superAdminId, deletionInput(shipped.order.id, shipped.orderNumber)),
    ).rejects.toThrow(/Genuine shipment/);
    const shippedStock = await prisma.inventory.findUniqueOrThrow({
      where: { id: shipped.inventory.id },
    });
    expect(shippedStock.qtyOnHand).toBe(100);

    const exported = await createOrder({ autopartExportStatus: "EXPORTED", autopartExportCount: 1 });
    await expect(
      deleteDispatchedTestOrder(
        superAdminId,
        deletionInput(exported.order.id, exported.orderNumber),
      ),
    ).rejects.toThrow(/exported to Autopart/);

    const paid = await createOrder({});
    const document = await prisma.autopartSalesDocument.create({
      data: {
        companyId: paid.company.id,
        autopartCustomerCode: "TESTACCT",
        documentType: "PAYMENT",
        documentReference: `PAY-${paid.stamp}`,
        source: "SLRB",
        abOrderId: paid.order.id,
        abOrderNumber: paid.orderNumber,
      },
    });
    await expect(
      deleteDispatchedTestOrder(superAdminId, deletionInput(paid.order.id, paid.orderNumber)),
    ).rejects.toThrow(/Autopart PAYMENT/);
    const documentAfter = await prisma.autopartSalesDocument.findUniqueOrThrow({
      where: { id: document.id },
    });
    expect(documentAfter.abOrderId).toBe(paid.order.id);
    expect(documentAfter.documentReference).toBe(`PAY-${paid.stamp}`);
    expect(await prisma.order.findUnique({ where: { id: paid.order.id } })).toBeTruthy();
  });

  it("refuses delivered orders and orders that are not dispatched", async () => {
    const delivered = await createOrder({ status: "DELIVERED" });
    await expect(
      deleteDispatchedTestOrder(
        superAdminId,
        deletionInput(delivered.order.id, delivered.orderNumber),
      ),
    ).rejects.toThrow(/Delivered orders cannot/);
    const submitted = await createOrder({ status: "SUBMITTED" });
    await expect(
      deleteDispatchedTestOrder(
        superAdminId,
        deletionInput(submitted.order.id, submitted.orderNumber),
      ),
    ).rejects.toMatchObject({ code: "TEST_ORDER_DELETE_BLOCKED" });
    expect(await prisma.order.findUnique({ where: { id: delivered.order.id } })).toBeTruthy();
    expect(await prisma.order.findUnique({ where: { id: submitted.order.id } })).toBeTruthy();
  });
});
