/**
 * 504 + TRM21QC fulfilment apply and preview.
 * OFF must not despatch. Legacy 504C settings stay retired and disabled.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { bootstrapRbac } from "../../../prisma/bootstrap/rbac";
import {
  getAutopartFulfilmentForOrder,
  preview504TrmFulfilment,
  run504TrmFulfilmentAfterImport,
  update504TrmFulfilmentSettings,
} from "@/server/orders/autopart-504-trm-fulfilment";

const prisma = new PrismaClient();
let adminId = "";
const stamp = Date.now();

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

async function uniqueAbOrderNumber(): Promise<string> {
  for (let attempt = 0; attempt < 80; attempt++) {
    const n = String((100000 + ((Date.now() + attempt * 7919 + Math.floor(Math.random() * 900000)) % 900000)) % 1000000).padStart(6, "0");
    const orderNumber = `AB-${n}`;
    const existing = await prisma.order.findUnique({ where: { orderNumber }, select: { id: true } });
    if (!existing) return orderNumber;
  }
  throw new Error("Could not allocate a unique AB-######");
}

async function parkFulfilmentOff() {
  await prisma.autopartOngoingSalesFeedSettings.upsert({
    where: { id: "default" },
    create: { id: "default", fulfilmentMode: "OFF", fulfilmentFrom: new Date() },
    update: { fulfilmentMode: "OFF" },
  });
  await prisma.autopart504cFeedSettings.updateMany({
    where: { id: "default" },
    data: { runtimeMode: "RETIRED", enabled: false },
  });
}

async function createConfirmedOrder(orderNumber: string, sku: string) {
  const company = await prisma.company.create({
    data: {
      name: `504TRM Co ${orderNumber}`,
      status: "ACTIVE",
      autopartCustomerCode: `TRM-${orderNumber}`,
      autopartCustomerCodeVerifiedAt: new Date(),
    },
  });
  const brand = await prisma.brand.create({
    data: { name: `Brand ${sku}`, slug: `brand-${sku.toLowerCase()}` },
  });
  const category = await prisma.category.create({
    data: { name: `Cat ${sku}`, slug: `cat-${sku.toLowerCase()}` },
  });
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
    data: {
      variantId: variant.id,
      warehouseId: warehouse.id,
      qtyOnHand: 100,
      qtyReserved: 10,
      status: "IN_STOCK",
    },
  });
  const order = await prisma.order.create({
    data: {
      orderNumber,
      companyId: company.id,
      status: "CONFIRMED",
      subtotal: 10,
      vatTotal: 2,
      deliveryTotal: 0,
      grandTotal: 12,
      placedAt: new Date(),
      autopartCustomerCodeSnapshot: `TRM-${orderNumber}`,
      autopartAccountLinked: true,
      autopartExportStatus: "EXPORTED",
      deliveryAddress: { line1: "1 High Street", town: "Leeds", postcode: "LS1 1AA", country: "GB" },
      contactSnapshot: { name: "Alex Buyer", email: `buyer-${sku}@example.test`, phone: "01130000000" },
      items: {
        create: [
          {
            sku,
            name: "Widget A",
            qty: 10,
            unitPrice: 1,
            customerUnitPrice: 1,
            vatRate: 20,
            lineTotal: 10,
            lineVat: "2.00",
            lineGross: 12,
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
      quantity: 10,
      status: "ACTIVE",
    },
  });
  return { company, order, inventory, reservation, sku };
}

async function attach504TrmEvidence(input: {
  companyId: string;
  orderId: string;
  orderNumber: string;
  sku: string;
  document: string;
  units: number;
  salesNet: string;
  goodsNet: string;
}) {
  const doc = await prisma.autopartSalesDocument.create({
    data: {
      companyId: input.companyId,
      autopartCustomerCode: `TRM-${input.orderNumber}`,
      documentType: "INVOICE",
      documentReference: input.document,
      documentDate: new Date(),
      goodsNet: input.goodsNet,
      source: "ONGOING_504",
      has504: true,
      hasTrm21qc: true,
      customerOrderNumber: input.orderNumber,
      abOrderId: input.orderId,
      abOrderNumber: input.orderNumber,
      reconciliationStatus: "MATCHED",
    },
  });
  await prisma.autopartSalesLine.create({
    data: {
      companyId: input.companyId,
      documentId: doc.id,
      autopartCustomerCode: `TRM-${input.orderNumber}`,
      documentType: "INVOICE",
      documentReference: input.document,
      lineNumber: 1,
      sku: input.sku,
      descriptionSnapshot: "Widget A",
      units: String(input.units),
      salesNet: input.salesNet,
      matchStatus: "MATCHED",
      source: "ONGOING_TRM21QC",
    },
  });
  return doc;
}

beforeAll(async () => {
  await bootstrapRbac(prisma);
  adminId = await ensureUser(`504-trm.admin.${stamp}@example.invalid`, ["SUPER_ADMIN"]);
  await parkFulfilmentOff();
});

afterAll(async () => {
  await parkFulfilmentOff();
  await prisma.$disconnect();
});

describe("504 + TRM fulfilment modes", () => {
  it("OFF does not change the order", async () => {
    const orderNumber = await uniqueAbOrderNumber();
    const sku = `SKU-TRM-${orderNumber.slice(-6)}`;
    const { order, company } = await createConfirmedOrder(orderNumber, sku);
    await attach504TrmEvidence({
      companyId: company.id,
      orderId: order.id,
      orderNumber,
      sku,
      document: `SS${orderNumber.slice(-6)}`,
      units: 10,
      salesNet: "10.00",
      goodsNet: "10.00",
    });

    const applied = await run504TrmFulfilmentAfterImport(adminId);
    expect(applied.mode).toBe("OFF");
    expect(applied.applied).toBe(false);
    const refreshed = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(refreshed.status).toBe("CONFIRMED");
  });

  it("PREVIEW does not mutate; ACTIVE despatches from 504+TRM", async () => {
    const orderNumber = await uniqueAbOrderNumber();
    const sku = `SKU-TRM-${orderNumber.slice(-6)}`;
    const document = `SS${orderNumber.slice(-6)}A`;
    const { order, company, reservation, inventory } = await createConfirmedOrder(orderNumber, sku);
    await attach504TrmEvidence({
      companyId: company.id,
      orderId: order.id,
      orderNumber,
      sku,
      document,
      units: 6,
      salesNet: "6.00",
      goodsNet: "6.00",
    });

    await update504TrmFulfilmentSettings(adminId, {
      fulfilmentMode: "PREVIEW",
      fulfilmentFrom: new Date(Date.now() - 86400000).toISOString(),
    });
    const preview = await preview504TrmFulfilment(adminId);
    expect(preview.orders.some((row) => row.orderId === order.id)).toBe(true);
    expect(preview.wouldBecomePartial).toBeGreaterThanOrEqual(1);
    const stillConfirmed = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(stillConfirmed.status).toBe("CONFIRMED");

    const previewRun = await run504TrmFulfilmentAfterImport(adminId);
    expect(previewRun.applied).toBe(false);

    await update504TrmFulfilmentSettings(adminId, { fulfilmentMode: "ACTIVE" });
    const active = await run504TrmFulfilmentAfterImport(adminId);
    expect(active.applied).toBe(true);

    const after = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(after.status).toBe("PARTIALLY_DESPATCHED");
    const item = await prisma.orderItem.findFirstOrThrow({ where: { orderId: order.id } });
    expect(item.despatchedQty).toBe(6);
    const res = await prisma.orderStockReservation.findUniqueOrThrow({ where: { id: reservation.id } });
    expect(res.status).toBe("CONSUMED");
    const inv = await prisma.inventory.findUniqueOrThrow({ where: { id: inventory.id } });
    expect(inv.qtyOnHand).toBe(100);
    expect(inv.qtyReserved).toBe(0);

    const view = await getAutopartFulfilmentForOrder(order.id);
    expect(view?.statusLabel).toBe("Partially despatched");
    expect(view?.lines[0]?.despatchedQty).toBe(6);
    expect(view?.lines[0]?.remainingQty).toBe(4);

    const eventsBeforeReplay = await prisma.orderFulfilmentEvent.count({
      where: { orderId: order.id, source: "AUTOPART_504_TRM" },
    });
    const emailsBeforeReplay = await prisma.transactionalEmail.count({
      where: { entityId: order.id, purpose: { in: ["ORDER_DESPATCHED", "ORDER_PART_DESPATCHED"] } },
    });
    const invoicesBeforeReplay = await prisma.invoice.count({ where: { orderId: order.id } });
    const replay = await run504TrmFulfilmentAfterImport(adminId);
    expect(replay.ordersMutated).toBe(0);
    expect(replay.emailsQueued).toBe(0);
    const again = await prisma.orderItem.findFirstOrThrow({ where: { orderId: order.id } });
    expect(again.despatchedQty).toBe(6);
    expect(await prisma.orderFulfilmentEvent.count({ where: { orderId: order.id, source: "AUTOPART_504_TRM" } })).toBe(
      eventsBeforeReplay,
    );
    expect(
      await prisma.transactionalEmail.count({
        where: { entityId: order.id, purpose: { in: ["ORDER_DESPATCHED", "ORDER_PART_DESPATCHED"] } },
      }),
    ).toBe(emailsBeforeReplay);
    expect(await prisma.invoice.count({ where: { orderId: order.id } })).toBe(invoicesBeforeReplay);
    expect((await prisma.inventory.findUniqueOrThrow({ where: { id: inventory.id } })).qtyReserved).toBe(0);

    const legacy = await prisma.autopart504cFeedSettings.findUnique({ where: { id: "default" } });
    if (legacy) {
      expect(legacy.runtimeMode).toBe("RETIRED");
      expect(legacy.enabled).toBe(false);
    }

    await parkFulfilmentOff();
  });
});
