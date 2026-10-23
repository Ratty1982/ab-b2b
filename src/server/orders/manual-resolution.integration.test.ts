/**
 * Manual fulfilment and administrative close, including a later 504/TRM link.
 */
import "@/server/testing/use-protect-integration-database";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bootstrapRbac } from "../../../prisma/bootstrap/rbac";
import { prisma } from "@/infra/database/client";
import { closeOrderAdministratively, fulfilOrderManually } from "@/server/orders/manual-resolution";
import {
  run504TrmFulfilmentAfterImport,
  update504TrmFulfilmentSettings,
} from "@/server/orders/autopart-504-trm-fulfilment";
import { AuthError } from "@/server/rbac/guards";

const stamp = Date.now();
let adminId = "";

async function parkFulfilmentOff() {
  await prisma.autopartOngoingSalesFeedSettings.upsert({
    where: { id: "default" },
    create: { id: "default", fulfilmentMode: "OFF", enabled: false },
    update: { fulfilmentMode: "OFF", enabled: false },
  });
}

async function uniqueAbOrderNumber(): Promise<string> {
  for (let attempt = 0; attempt < 40; attempt++) {
    const n = String((100000 + ((stamp + attempt * 97) % 900000)) % 1000000).padStart(6, "0");
    const orderNumber = `AB-${n}`;
    const existing = await prisma.order.findUnique({ where: { orderNumber }, select: { id: true } });
    if (!existing) return orderNumber;
  }
  throw new Error("Could not allocate an order number");
}

async function createOrder(qty: number) {
  const orderNumber = await uniqueAbOrderNumber();
  const sku = `MAN-${orderNumber.slice(-6)}`;
  const company = await prisma.company.create({
    data: { name: `Manual ${orderNumber}`, status: "ACTIVE" },
  });
  const brand = await prisma.brand.create({ data: { name: `Brand ${sku}`, slug: `brand-${sku.toLowerCase()}` } });
  const category = await prisma.category.create({ data: { name: `Cat ${sku}`, slug: `cat-${sku.toLowerCase()}` } });
  const product = await prisma.product.create({
    data: {
      name: `Product ${sku}`,
      slug: `product-${sku.toLowerCase()}`,
      brandId: brand.id,
      categoryId: category.id,
      status: "ACTIVE",
      isActive: true,
      isTradeVisible: true,
    },
  });
  const variant = await prisma.productVariant.create({
    data: { productId: product.id, sku, isActive: true, tradePrice: 10 },
  });
  const warehouse = await prisma.warehouse.upsert({
    where: { code: "AUTOPART" },
    create: { code: "AUTOPART", name: "Autopart" },
    update: {},
  });
  const inventory = await prisma.inventory.create({
    data: { variantId: variant.id, warehouseId: warehouse.id, qtyOnHand: 40, qtyReserved: qty, status: "IN_STOCK" },
  });
  const order = await prisma.order.create({
    data: {
      orderNumber,
      companyId: company.id,
      status: "CONFIRMED",
      subtotal: qty,
      vatTotal: 0,
      grandTotal: qty,
      placedAt: new Date(),
      items: {
        create: [{ sku, name: "Widget", qty, unitPrice: 1, customerUnitPrice: 1, vatRate: 0, lineTotal: qty, lineVat: 0, lineGross: qty, variantId: variant.id }],
      },
    },
    include: { items: true },
  });
  await prisma.orderStockReservation.create({
    data: {
      orderId: order.id,
      orderItemId: order.items[0]!.id,
      variantId: variant.id,
      inventoryId: inventory.id,
      quantity: qty,
      status: "ACTIVE",
    },
  });
  return { company, order, inventory, sku };
}

async function createTwoLineOrder() {
  const orderNumber = await uniqueAbOrderNumber();
  const company = await prisma.company.create({ data: { name: `Manual ${orderNumber}`, status: "ACTIVE" } });
  const warehouse = await prisma.warehouse.upsert({
    where: { code: "AUTOPART" },
    create: { code: "AUTOPART", name: "Autopart" },
    update: {},
  });
  const lines = [5, 4] as const;
  const created = [];
  for (const [index, qty] of lines.entries()) {
    const sku = `MAN-${orderNumber.slice(-6)}-${index}`;
    const brand = await prisma.brand.create({ data: { name: `Brand ${sku}`, slug: `brand-${sku.toLowerCase()}` } });
    const category = await prisma.category.create({ data: { name: `Cat ${sku}`, slug: `cat-${sku.toLowerCase()}` } });
    const product = await prisma.product.create({
      data: {
        name: `Product ${sku}`,
        slug: `product-${sku.toLowerCase()}`,
        brandId: brand.id,
        categoryId: category.id,
        status: "ACTIVE",
        isActive: true,
        isTradeVisible: true,
      },
    });
    const variant = await prisma.productVariant.create({
      data: { productId: product.id, sku, isActive: true, tradePrice: 10 },
    });
    const inventory = await prisma.inventory.create({
      data: { variantId: variant.id, warehouseId: warehouse.id, qtyOnHand: 40, qtyReserved: qty, status: "IN_STOCK" },
    });
    created.push({ sku, qty, variantId: variant.id, inventoryId: inventory.id });
  }
  const order = await prisma.order.create({
    data: {
      orderNumber,
      companyId: company.id,
      status: "CONFIRMED",
      subtotal: 9,
      vatTotal: 0,
      grandTotal: 9,
      placedAt: new Date(),
      items: {
        create: created.map((line) => ({
          sku: line.sku,
          name: "Widget",
          qty: line.qty,
          unitPrice: 1,
          customerUnitPrice: 1,
          vatRate: 0,
          lineTotal: line.qty,
          lineVat: 0,
          lineGross: line.qty,
          variantId: line.variantId,
        })),
      },
    },
    include: { items: true },
  });
  for (const line of created) {
    const item = order.items.find((row) => row.sku === line.sku)!;
    await prisma.orderStockReservation.create({
      data: {
        orderId: order.id,
        orderItemId: item.id,
        variantId: line.variantId,
        inventoryId: line.inventoryId,
        quantity: line.qty,
        status: "ACTIVE",
      },
    });
  }
  return { order, lines: created };
}

beforeAll(async () => {
  await bootstrapRbac(prisma);
  const email = `manual.admin.${stamp}@example.invalid`;
  const user = await prisma.user.create({
    data: { email, name: "Manual Admin", status: "ACTIVE", actorType: "INTERNAL", emailVerified: true },
  });
  const role = await prisma.role.findUniqueOrThrow({ where: { key: "SUPER_ADMIN" } });
  await prisma.userRole.create({ data: { userId: user.id, roleId: role.id } });
  adminId = user.id;
  await parkFulfilmentOff();
});

afterAll(async () => {
  await parkFulfilmentOff();
  await prisma.$disconnect();
});

describe("manual order resolution", () => {
  it("partially and fully fulfils without an invoice, email, or stock rewrite", async () => {
    const partial = await createOrder(10);
    const line = partial.order.items[0]!;
    const first = await fulfilOrderManually(adminId, {
      orderId: partial.order.id,
      reason: "Supplied from the counter last year",
      invoiceEvidence: "OUTSTANDING",
      lines: [{ orderItemId: line.id, despatchedQty: 4 }],
    });
    expect(first.status).toBe("PARTIALLY_DESPATCHED");
    expect(first.idempotent).toBe(false);
    expect(first.lines[0]?.despatchedQty).toBe(4);
    expect(first.invoiceEvidence).toBe("OUTSTANDING");
    expect(await prisma.invoice.count({ where: { orderId: partial.order.id } })).toBe(0);
    expect(await prisma.transactionalEmail.count({ where: { entityId: partial.order.id } })).toBe(0);
    const stock = await prisma.inventory.findUniqueOrThrow({ where: { id: partial.inventory.id } });
    expect(stock.qtyOnHand).toBe(40);
    expect(stock.qtyReserved).toBe(6);
    const holds = await prisma.orderStockReservation.findMany({ where: { orderId: partial.order.id }, orderBy: { quantity: "asc" } });
    expect(holds.map((hold) => ({ status: hold.status, quantity: hold.quantity }))).toEqual([
      { status: "CONSUMED", quantity: 4 },
      { status: "ACTIVE", quantity: 6 },
    ]);
    const events = await prisma.orderFulfilmentEvent.findMany({ where: { orderId: partial.order.id } });
    expect(events.map((event) => event.source)).toEqual(["MANUAL"]);
    expect(events[0]?.kind).toBe("PART_DESPATCHED");

    const again = await fulfilOrderManually(adminId, {
      orderId: partial.order.id,
      reason: "Supplied from the counter last year",
      invoiceEvidence: "OUTSTANDING",
      lines: [{ orderItemId: line.id, despatchedQty: 4 }],
    });
    expect(again.idempotent).toBe(true);
    expect(await prisma.orderFulfilmentEvent.count({ where: { orderId: partial.order.id } })).toBe(1);
    expect((await prisma.inventory.findUniqueOrThrow({ where: { id: partial.inventory.id } })).qtyReserved).toBe(6);

    const balance = await fulfilOrderManually(adminId, {
      orderId: partial.order.id,
      reason: "The remaining units were supplied later",
      invoiceEvidence: "OUTSTANDING",
      lines: [{ orderItemId: line.id, despatchedQty: 10 }],
    });
    expect(balance.status).toBe("DISPATCHED");
    expect(balance.lines[0]?.despatchedQty).toBe(10);
    expect((await prisma.inventory.findUniqueOrThrow({ where: { id: partial.inventory.id } })).qtyReserved).toBe(0);
    expect(await prisma.orderStockReservation.count({ where: { orderId: partial.order.id, status: "ACTIVE" } })).toBe(0);
    const consumed = await prisma.orderStockReservation.aggregate({
      where: { orderId: partial.order.id, status: "CONSUMED" },
      _sum: { quantity: true },
    });
    expect(consumed._sum.quantity).toBe(10);

    const full = await createOrder(3);
    const fullLine = full.order.items[0]!;
    const done = await fulfilOrderManually(adminId, {
      orderId: full.order.id,
      reason: "Whole order was collected",
      invoiceEvidence: "UNAVAILABLE",
      lines: [{ orderItemId: fullLine.id, despatchedQty: 3 }],
    });
    expect(done.status).toBe("DISPATCHED");
    expect(await prisma.invoice.count({ where: { orderId: full.order.id } })).toBe(0);
    expect((await prisma.inventory.findUniqueOrThrow({ where: { id: full.inventory.id } })).qtyReserved).toBe(0);
    expect(await prisma.orderStockReservation.count({ where: { orderId: full.order.id, status: "ACTIVE" } })).toBe(0);
  });

  it("keeps the other line reserved and refuses to drive reserved stock negative", async () => {
    const { order, lines } = await createTwoLineOrder();
    const first = order.items.find((item) => item.qty === 5)!;
    const second = order.items.find((item) => item.qty === 4)!;
    const partial = await fulfilOrderManually(adminId, {
      orderId: order.id,
      reason: "Only the first line was collected",
      invoiceEvidence: "OUTSTANDING",
      lines: [
        { orderItemId: first.id, despatchedQty: 2 },
        { orderItemId: second.id, despatchedQty: 0 },
      ],
    });
    expect(partial.status).toBe("PARTIALLY_DESPATCHED");
    const firstStock = await prisma.inventory.findUniqueOrThrow({ where: { id: lines[0]!.inventoryId } });
    const secondStock = await prisma.inventory.findUniqueOrThrow({ where: { id: lines[1]!.inventoryId } });
    expect(firstStock.qtyReserved).toBe(3);
    expect(secondStock.qtyReserved).toBe(4);
    expect(firstStock.qtyOnHand).toBe(40);
    expect(secondStock.qtyOnHand).toBe(40);

    const thin = await createOrder(10);
    await prisma.inventory.update({ where: { id: thin.inventory.id }, data: { qtyReserved: 2 } });
    await fulfilOrderManually(adminId, {
      orderId: thin.order.id,
      reason: "Reserved stock was already short",
      invoiceEvidence: "OUTSTANDING",
      lines: [{ orderItemId: thin.order.items[0]!.id, despatchedQty: 4 }],
    });
    const thinStock = await prisma.inventory.findUniqueOrThrow({ where: { id: thin.inventory.id } });
    expect(thinStock.qtyReserved).toBe(0);
    expect(thinStock.qtyOnHand).toBe(40);
  });

  it("closes administratively without despatch and releases the reservation", async () => {
    const { order, inventory } = await createOrder(5);
    const beforeQty = order.items[0]!.despatchedQty;
    const closed = await closeOrderAdministratively(adminId, {
      orderId: order.id,
      reason: "Customer no longer wants the outstanding balance",
      invoiceEvidence: "UNAVAILABLE",
    });
    expect(closed.status).toBe("ADMINISTRATIVELY_CLOSED");
    expect(closed.lines[0]?.despatchedQty).toBe(beforeQty);
    expect(await prisma.invoice.count({ where: { orderId: order.id } })).toBe(0);
    const reservation = await prisma.orderStockReservation.findFirstOrThrow({ where: { orderId: order.id } });
    expect(reservation.status).toBe("RELEASED");
    const stock = await prisma.inventory.findUniqueOrThrow({ where: { id: inventory.id } });
    expect(stock.qtyOnHand).toBe(40);
    expect(stock.qtyReserved).toBe(0);
    const event = await prisma.orderFulfilmentEvent.findFirstOrThrow({ where: { orderId: order.id } });
    expect(event.kind).toBe("ADMINISTRATIVELY_CLOSED");
    expect(event.source).toBe("MANUAL");
    const repeat = await closeOrderAdministratively(adminId, {
      orderId: order.id,
      reason: "Customer no longer wants the outstanding balance",
      invoiceEvidence: "UNAVAILABLE",
    });
    expect(repeat.idempotent).toBe(true);
    expect(await prisma.orderFulfilmentEvent.count({ where: { orderId: order.id } })).toBe(1);

    const cancelled = await createOrder(1);
    await prisma.order.update({ where: { id: cancelled.order.id }, data: { status: "CANCELLED" } });
    await expect(
      fulfilOrderManually(adminId, {
        orderId: cancelled.order.id,
        reason: "Should not complete a cancelled order",
        invoiceEvidence: "OUTSTANDING",
        lines: [{ orderItemId: cancelled.order.items[0]!.id, despatchedQty: 1 }],
      }),
    ).rejects.toBeInstanceOf(AuthError);
    await expect(
      closeOrderAdministratively(adminId, {
        orderId: cancelled.order.id,
        reason: "Should not close a cancelled order",
        invoiceEvidence: "OUTSTANDING",
      }),
    ).rejects.toBeInstanceOf(AuthError);
  });

  it("links a later 504 invoice without repeating despatch", async () => {
    const { order, company, sku } = await createOrder(8);
    const line = order.items[0]!;
    await fulfilOrderManually(adminId, {
      orderId: order.id,
      reason: "Delivered before the invoice feed existed",
      invoiceEvidence: "OUTSTANDING",
      lines: [{ orderItemId: line.id, despatchedQty: 3 }],
    });
    await prisma.autopartSalesDocument.create({
      data: {
        companyId: company.id,
        autopartCustomerCode: "MANUAL",
        documentType: "INVOICE",
        documentReference: `LATER-${order.orderNumber}`,
        documentDate: new Date(),
        goodsNet: 8,
        source: "ONGOING_504",
        has504: true,
        hasTrm21qc: true,
        customerOrderNumber: order.orderNumber,
        abOrderId: order.id,
        abOrderNumber: order.orderNumber,
        reconciliationStatus: "MATCHED",
        lines: {
          create: [{
            companyId: company.id,
            autopartCustomerCode: "MANUAL",
            documentType: "INVOICE",
            documentReference: `LATER-${order.orderNumber}`,
            lineNumber: 1,
            sku,
            units: 8,
            salesNet: 8,
            source: "ONGOING_TRM21QC",
          }],
        },
      },
    });
    await update504TrmFulfilmentSettings(adminId, {
      fulfilmentMode: "ACTIVE",
      fulfilmentFrom: new Date(Date.now() - 86_400_000).toISOString(),
    });
    const run = await run504TrmFulfilmentAfterImport(adminId, { orderIds: [order.id] });
    expect(run.emailsQueued).toBe(0);
    const after = await prisma.order.findUniqueOrThrow({
      where: { id: order.id },
      include: { items: true },
    });
    expect(after.status).toBe("PARTIALLY_DESPATCHED");
    expect(after.items[0]?.despatchedQty).toBe(3);
    expect(after.invoiceEvidence).toBe("LINKED");
    const stillHeld = await prisma.orderStockReservation.findFirstOrThrow({
      where: { orderId: order.id, status: "ACTIVE" },
    });
    expect(stillHeld.quantity).toBe(5);
    expect(after.manualResolutionKind).toBe("FULFILLED_MANUALLY");
    const invoice = await prisma.invoice.findFirst({ where: { orderId: order.id, externalRef: `LATER-${order.orderNumber}` } });
    expect(invoice).toBeTruthy();
    const linked = await prisma.orderFulfilmentEvent.findMany({
      where: { orderId: order.id, kind: "INVOICE_LINKED" },
    });
    expect(linked).toHaveLength(1);
    expect(await prisma.orderFulfilmentEvent.count({ where: { orderId: order.id, source: "AUTOPART_504_TRM", kind: { in: ["DESPATCHED", "PART_DESPATCHED"] } } })).toBe(0);
    const second = await run504TrmFulfilmentAfterImport(adminId, { orderIds: [order.id] });
    expect(second.emailsQueued).toBe(0);
    expect(await prisma.orderFulfilmentEvent.count({ where: { orderId: order.id, kind: "INVOICE_LINKED" } })).toBe(1);
    expect((await prisma.orderItem.findFirstOrThrow({ where: { id: line.id } })).despatchedQty).toBe(3);
    await parkFulfilmentOff();
    expect((await prisma.autopartOngoingSalesFeedSettings.findUniqueOrThrow({ where: { id: "default" } })).enabled).toBe(false);
  });
});
