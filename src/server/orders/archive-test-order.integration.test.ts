/**
 * Super Admin archive for dispatched test orders that permanent deletion refuses.
 * Creates its own orders. Does not archive AB-000007 or any pre-existing order.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { bootstrapRbac } from "../../../prisma/bootstrap/rbac";
import { archiveTestOrders, restoreTestOrder } from "@/server/orders/archive-test-order";
import { deleteDispatchedTestOrder } from "@/server/orders/delete-dispatched-test-order";
import { deleteAdminOrder, getAdminOrder, listAdminOrders } from "@/server/orders/service";
import { getAdminDashboard } from "@/server/admin/dashboard";
import { AuthError } from "@/server/rbac/guards";

const prisma = new PrismaClient();
let superAdminId = "";
let managementId = "";
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
  const n = 770000 + Math.floor(Math.random() * 19999);
  return `AB-${String(n).padStart(6, "0")}`;
}

async function createDispatchedTestOrder() {
  const stamp = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const company = await prisma.company.create({
    data: { name: `Archive test ${stamp}`, status: "ACTIVE" },
  });
  const brand = await prisma.brand.create({
    data: { name: `Brand ${stamp}`, slug: `brand-arch-${stamp}` },
  });
  const category = await prisma.category.create({
    data: { name: `Cat ${stamp}`, slug: `cat-arch-${stamp}` },
  });
  const product = await prisma.product.create({
    data: {
      name: `Product ${stamp}`,
      slug: `product-arch-${stamp}`,
      brandId: brand.id,
      categoryId: category.id,
      status: "ACTIVE",
      isActive: true,
      isTradeVisible: true,
    },
  });
  const variant = await prisma.productVariant.create({
    data: { productId: product.id, sku: `ARCH-${stamp}`, isActive: true, tradePrice: 5 },
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
      qtyReserved: 4,
      status: "IN_STOCK",
    },
  });
  const batch = await prisma.autopartOrderExportBatch.create({
    data: {
      reference: `APX-ARCH-${stamp}`,
      createdByUserId: superAdminId,
      orderCount: 1,
      lineCount: 1,
      filename: `arch-${stamp}.csv`,
      orderIds: [],
    },
  });
  const orderNumber = nextOrderNumber();
  const invoiceNumber = `SS-ARCH-${stamp}`;
  const order = await prisma.order.create({
    data: {
      orderNumber,
      companyId: company.id,
      status: "DISPATCHED",
      subtotal: 44.28,
      vatTotal: 10.05,
      deliveryTotal: 5.95,
      grandTotal: 60.28,
      currency: "GBP",
      placedAt: new Date(),
      autopartExportStatus: "EXPORTED",
      autopartExportCount: 1,
      autopartExportBatchId: batch.id,
      contactSnapshot: { name: "Test Buyer", email: `arch-${stamp}@example.test` },
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
            despatchedQty: 12,
          },
        ],
      },
    },
  });
  await prisma.orderStockReservation.create({
    data: {
      orderId: order.id,
      variantId: variant.id,
      inventoryId: inventory.id,
      quantity: 4,
      status: "CONSUMED",
      consumedAt: new Date(),
    },
  });
  const invoice = await prisma.invoice.create({
    data: {
      invoiceNumber,
      companyId: company.id,
      orderId: order.id,
      status: "ISSUED",
      subtotal: 44.28,
      vatTotal: 10.05,
      grandTotal: 60.28,
      autopartDocumentKind: "INVOICE",
      externalRef: `INV-${stamp}`,
    },
  });
  const document = await prisma.autopartSalesDocument.create({
    data: {
      companyId: company.id,
      autopartCustomerCode: "T999",
      documentType: "INVOICE",
      documentReference: invoiceNumber,
      source: "ONGOING_504",
      abOrderId: order.id,
      abOrderNumber: orderNumber,
      goodsNet: 44.28,
      grossTotal: 60.28,
    },
  });
  const fulfilment = await prisma.orderFulfilmentEvent.create({
    data: {
      orderId: order.id,
      kind: "DESPATCHED",
      source: "AUTOPART_504C",
      summary: "Despatch recorded against the test invoice",
    },
  });
  return { order, orderNumber, company, inventory, invoice, document, fulfilment, batch, stamp };
}

function archiveInput(orderIds: string[], orderNumbers: string[], overrides: Record<string, unknown> = {}) {
  return {
    orderIds,
    reason: "Internal test order. No physical goods were shipped.",
    confirmTestData: true,
    confirmOrderNumbers: orderNumbers.join(", "),
    ...overrides,
  };
}

beforeAll(async () => {
  await bootstrapRbac(prisma);
  superAdminId = await ensureUser("archive-test-order-super@ab.test", ["SUPER_ADMIN"]);
  managementId = await ensureUser("archive-test-order-mgmt@ab.test", ["MANAGEMENT"]);
  salesRepId = await ensureUser("archive-test-order-rep@ab.test", ["SALES_REPRESENTATIVE"]);
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
  regularAdminId = await ensureUser("archive-test-order-admin@ab.test", ["TEST_REGULAR_ADMIN"]);
});

afterAll(async () => {
  const untouched = await prisma.order.findUnique({
    where: { orderNumber: "AB-000007" },
    select: { archivedAt: true },
  });
  if (untouched) expect(untouched.archivedAt).toBeNull();
  await prisma.$disconnect();
});

describe("archive test orders", () => {
  it("archives a dispatched order that deletion refuses and keeps financial history", async () => {
    const target = await createDispatchedTestOrder();
    const other = await createDispatchedTestOrder();
    const beforeDashboard = await getAdminDashboard(superAdminId);

    await expect(deleteAdminOrder(superAdminId, target.order.id)).rejects.toMatchObject({
      code: "ORDER_ALREADY_DESPATCHED",
    });
    await expect(
      deleteDispatchedTestOrder(superAdminId, {
        orderId: target.order.id,
        reason: "Internal test order. No physical goods were shipped.",
        confirmTestData: true,
        confirmOrderNumber: target.orderNumber,
      }),
    ).rejects.toBeInstanceOf(AuthError);

    const archived = await archiveTestOrders(
      superAdminId,
      archiveInput([target.order.id], [target.orderNumber]),
    );
    expect(archived.archived).toEqual([{ orderId: target.order.id, orderNumber: target.orderNumber }]);

    const stored = await prisma.order.findUniqueOrThrow({ where: { id: target.order.id } });
    expect(stored.status).toBe("DISPATCHED");
    expect(stored.archivedAt).toBeTruthy();
    expect(stored.archivedByUserId).toBe(superAdminId);
    expect(stored.archiveReason).toMatch(/No physical goods/);
    expect(stored.grandTotal.toString()).toBe("60.28");
    expect(stored.autopartExportStatus).toBe("EXPORTED");
    expect(stored.autopartExportCount).toBe(1);
    expect(stored.autopartExportBatchId).toBe(target.batch.id);

    const invoice = await prisma.invoice.findUniqueOrThrow({ where: { id: target.invoice.id } });
    expect(invoice.orderId).toBe(target.order.id);
    expect(invoice.invoiceNumber).toBe(target.invoice.invoiceNumber);
    expect(invoice.status).toBe("ISSUED");
    expect(invoice.autopartDocumentKind).toBe("INVOICE");
    expect(await prisma.invoice.count({ where: { orderId: target.order.id, autopartDocumentKind: "CREDIT" } })).toBe(
      0,
    );

    const document = await prisma.autopartSalesDocument.findUniqueOrThrow({ where: { id: target.document.id } });
    expect(document.documentReference).toBe(target.document.documentReference);
    expect(document.abOrderId).toBe(target.order.id);
    expect(document.documentType).toBe("INVOICE");

    expect(await prisma.orderFulfilmentEvent.count({ where: { orderId: target.order.id } })).toBe(1);
    const stock = await prisma.inventory.findUniqueOrThrow({ where: { id: target.inventory.id } });
    expect(stock.qtyOnHand).toBe(100);
    expect(stock.qtyReserved).toBe(4);
    expect(await prisma.orderStockReservation.count({ where: { orderId: target.order.id, status: "CONSUMED" } })).toBe(
      1,
    );
    expect(await prisma.transactionalEmail.count({ where: { entityId: target.order.id } })).toBe(0);

    const live = await listAdminOrders(superAdminId, { q: target.orderNumber, pageSize: 20 });
    expect(live.items.map((row) => row.orderNumber)).not.toContain(target.orderNumber);
    const archivedList = await listAdminOrders(superAdminId, {
      q: target.orderNumber,
      archive: "ARCHIVED",
      pageSize: 20,
    });
    expect(archivedList.items.map((row) => row.orderNumber)).toContain(target.orderNumber);
    expect(archivedList.items[0]?.archiveReason).toMatch(/No physical goods/);
    expect(archivedList.items[0]?.archivedByName).toBeTruthy();

    await expect(listAdminOrders(managementId, { archive: "ARCHIVED" })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(getAdminOrder(managementId, target.order.id)).rejects.toMatchObject({
      code: "ORDER_NOT_FOUND",
    });
    const detail = await getAdminOrder(superAdminId, target.order.id);
    expect(detail.status).toBe("DISPATCHED");
    expect(detail.archiveReason).toMatch(/No physical goods/);
    expect(detail.archivedByName).toBeTruthy();

    const afterDashboard = await getAdminDashboard(superAdminId);
    expect(afterDashboard.summary.ordersToday.count).toBe(beforeDashboard.summary.ordersToday.count - 1);
    expect(afterDashboard.recentOrders.map((row) => row.orderNumber)).not.toContain(target.orderNumber);

    const otherStored = await prisma.order.findUniqueOrThrow({ where: { id: other.order.id } });
    expect(otherStored.archivedAt).toBeNull();
    expect(otherStored.status).toBe("DISPATCHED");

    const audit = await prisma.auditEvent.findFirstOrThrow({
      where: { action: "order.test_archived", entityId: target.order.id },
    });
    expect(audit.actorUserId).toBe(superAdminId);

    const restored = await restoreTestOrder(superAdminId, {
      orderId: target.order.id,
      confirmOrderNumber: target.orderNumber,
    });
    expect(restored.status).toBe("DISPATCHED");
    const back = await prisma.order.findUniqueOrThrow({ where: { id: target.order.id } });
    expect(back.archivedAt).toBeNull();
    expect(back.archiveReason).toBeNull();
    expect(back.status).toBe("DISPATCHED");
    expect(back.autopartExportBatchId).toBe(target.batch.id);
    const visible = await listAdminOrders(superAdminId, { q: target.orderNumber, pageSize: 20 });
    expect(visible.items.map((row) => row.orderNumber)).toContain(target.orderNumber);
    const restoreAudit = await prisma.auditEvent.findFirstOrThrow({
      where: { action: "order.test_restored", entityId: target.order.id },
    });
    expect(restoreAudit.actorUserId).toBe(superAdminId);
  });

  it("rejects other roles and a mismatched order number without changing the order", async () => {
    const target = await createDispatchedTestOrder();
    for (const userId of [managementId, salesRepId, regularAdminId]) {
      await expect(
        archiveTestOrders(userId, archiveInput([target.order.id], [target.orderNumber])),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(
        restoreTestOrder(userId, { orderId: target.order.id, confirmOrderNumber: target.orderNumber }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
    await expect(
      archiveTestOrders(
        superAdminId,
        archiveInput([target.order.id], [target.orderNumber], { confirmOrderNumbers: "AB-000000" }),
      ),
    ).rejects.toMatchObject({ code: "ORDER_NUMBER_MISMATCH" });
    await expect(
      archiveTestOrders(
        superAdminId,
        archiveInput([target.order.id], [target.orderNumber], { confirmTestData: false }),
      ),
    ).rejects.toMatchObject({ code: "TEST_DATA_CONFIRMATION_REQUIRED" });
    const stored = await prisma.order.findUniqueOrThrow({ where: { id: target.order.id } });
    expect(stored.archivedAt).toBeNull();
    expect(stored.status).toBe("DISPATCHED");
  });

  it("archives several test orders together and leaves an unselected order alone", async () => {
    const first = await createDispatchedTestOrder();
    const second = await createDispatchedTestOrder();
    const third = await createDispatchedTestOrder();
    const result = await archiveTestOrders(
      superAdminId,
      archiveInput(
        [first.order.id, second.order.id],
        [second.orderNumber, first.orderNumber],
      ),
    );
    expect(result.archived.map((row) => row.orderNumber).sort()).toEqual(
      [first.orderNumber, second.orderNumber].sort(),
    );
    expect((await prisma.order.findUniqueOrThrow({ where: { id: third.order.id } })).archivedAt).toBeNull();
    const firstListed = await listAdminOrders(superAdminId, { q: first.orderNumber, pageSize: 20 });
    const secondListed = await listAdminOrders(superAdminId, { q: second.orderNumber, pageSize: 20 });
    const thirdListed = await listAdminOrders(superAdminId, { q: third.orderNumber, pageSize: 20 });
    expect(firstListed.items.map((row) => row.id)).not.toContain(first.order.id);
    expect(secondListed.items.map((row) => row.id)).not.toContain(second.order.id);
    expect(thirdListed.items.map((row) => row.id)).toContain(third.order.id);
  });
});
