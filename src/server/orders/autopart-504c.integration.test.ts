/**
 * Autopart 504C reconciliation — dry-run, apply, despatch, idempotency, credits.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { bootstrapRbac } from "../../../prisma/bootstrap/rbac";
import {
  buildAutopart504cSampleFixture,
  format504cDataRow,
  AUTOPART_504C_HEADER,
  AUTOPART_504C_SEPARATOR,
} from "@/domain/autopart-504c-fixture";
import {
  applyAutopart504cFile,
  dryRunAutopart504cFile,
  getAutopart504cFeedSettings,
  pollAutopart504cMailboxNow,
  runAutopart504cScheduledPollIfEnabled,
  updateAutopart504cFeedSettings,
} from "@/server/orders/autopart-504c";

const prisma = new PrismaClient();
let adminId = "";

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

async function createProcessingOrder(orderNumber: string) {
  const company = await prisma.company.create({
    data: {
      name: `504C Co ${orderNumber}`,
      status: "ACTIVE",
      autopartCustomerCode: `MAM-${orderNumber}`,
      autopartCustomerCodeVerifiedAt: new Date(),
    },
  });

  const stamp = `${orderNumber}-${Math.random().toString(36).slice(2, 8)}`;
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
    data: {
      productId: product.id,
      sku: `VAR-${stamp}`,
      isActive: true,
      tradePrice: 10,
    },
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
      qtyReserved: 5,
      status: "IN_STOCK",
    },
  });

  const order = await prisma.order.create({
    data: {
      orderNumber,
      companyId: company.id,
      status: "CONFIRMED",
      subtotal: 44.28,
      vatTotal: 10.05,
      deliveryTotal: 5.95,
      grandTotal: 60.28,
      placedAt: new Date("2026-09-25T12:00:00.000Z"),
      poNumber: "PO696969",
      autopartCustomerCodeSnapshot: `MAM-${orderNumber}`,
      autopartAccountLinked: true,
      autopartExportStatus: "EXPORTED",
      deliveryAddress: {
        line1: "12 High Street",
        town: "Leeds",
        postcode: "LS1 1AA",
        country: "GB",
      },
      contactSnapshot: {
        name: "Alex Buyer",
        email: `buyer-${stamp}@example.test`,
        phone: "01130000000",
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
            lineVat: "0.00",
            lineGross: 44.28,
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
      quantity: 5,
      status: "ACTIVE",
    },
  });

  return { order, company, inventory, reservation };
}

function reportForAbOrders(
  rows: Array<{
    document: string;
    orderNumber: string;
    goods?: string;
    vat?: string;
    value?: string;
    credit?: boolean;
  }>,
) {
  const lines = [
    "LISTING OF INVOICES AND CREDITS BY CUSTOMER (504C)",
    AUTOPART_504C_HEADER,
    AUTOPART_504C_SEPARATOR,
    ...rows.map((r) =>
      format504cDataRow({
        document: r.document,
        date: "25/09/2026",
        time: "14:12",
        account: "AB001",
        customer: "EXAMPLE MOTOR FACTORS",
        goods: r.goods ?? (r.credit ? "-12.00" : "44.28"),
        vat: r.vat ?? (r.credit ? "-2.40" : "10.05"),
        value: r.value ?? (r.credit ? "-14.40" : "60.28"),
        inits: "WR",
        orderNumber: r.orderNumber,
      }),
    ),
    format504cDataRow({
      document: "I555001",
      date: "25/09/2026",
      time: "13:05",
      account: "AMZ01",
      customer: "AMAZON EU SARL",
      goods: "22.00",
      vat: "4.40",
      value: "26.40",
      inits: "AZ",
      orderNumber: "026-1234567-8901234",
    }),
    "*** END OF REPORT ***",
  ];
  return lines.join("\n");
}

beforeAll(async () => {
  await bootstrapRbac(prisma);
  adminId = await ensureUser("504c-admin@ab.test", ["SUPER_ADMIN"]);
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("autopart 504C feed defaults", () => {
  it("defaults to disabled / not configured", async () => {
    const settings = await getAutopart504cFeedSettings();
    expect(settings.enabled).toBe(false);
    expect(settings.automaticPolling).toBe("OFF");
    expect(["NOT_CONFIGURED", "DISABLED"]).toContain(settings.statusLabel);
    expect(settings.scheduleHours).toEqual([13, 16]);
  });

  it("scheduler no-ops while disabled", async () => {
    const result = await runAutopart504cScheduledPollIfEnabled();
    expect(result.ran).toBe(false);
    expect(result.reason).toMatch(/disabled/i);
  });

  it("poll mailbox now refuses while disabled", async () => {
    const result = await pollAutopart504cMailboxNow(adminId);
    expect(result.ran).toBe(false);
    expect(result.reason).toMatch(/DISABLED|NOT CONFIGURED/i);
  });

  it("cannot enable without configured", async () => {
    await expect(
      updateAutopart504cFeedSettings(adminId, { enabled: true, configured: false }),
    ).rejects.toThrow(/configured/i);
  });
});

describe("autopart 504C dry-run and apply", () => {
  it("dry-run parses fixture without mutating orders", async () => {
    const abNumber = `AB-${String(900000 + (Date.now() % 90000)).padStart(6, "0")}`;
    const { order, reservation, inventory } = await createProcessingOrder(abNumber);

    const preview = await dryRunAutopart504cFile(adminId, {
      text: reportForAbOrders([{ document: `I${Date.now().toString().slice(-7)}`, orderNumber: abNumber }]),
      filename: "dry.txt",
    });
    expect(preview.abInvoices.some((r) => r.abOrderNumber === abNumber && r.match === "MATCHED")).toBe(
      true,
    );
    expect(preview.nonAbRows).toBeGreaterThanOrEqual(1);

    const refreshed = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(refreshed.status).toBe("CONFIRMED");
    const res = await prisma.orderStockReservation.findUniqueOrThrow({ where: { id: reservation.id } });
    expect(res.status).toBe("ACTIVE");
    const inv = await prisma.inventory.findUniqueOrThrow({ where: { id: inventory.id } });
    expect(inv.qtyOnHand).toBe(100);
    expect(inv.qtyReserved).toBe(5);

    const emails = await prisma.transactionalEmail.findMany({
      where: { entityId: order.id, purpose: "ORDER_DESPATCHED" },
    });
    expect(emails).toHaveLength(0);
  });

  it("apply invoices → DESPATCHED once; duplicate file safe; credit no despatch", async () => {
    const abNumber = `AB-${String(910000 + (Date.now() % 80000)).padStart(6, "0")}`;
    const doc = `I${Date.now().toString().slice(-7)}`;
    const creditDoc = `C${Date.now().toString().slice(-7)}`;
    const { order, reservation, inventory } = await createProcessingOrder(abNumber);

    const text = reportForAbOrders([
      { document: doc, orderNumber: abNumber },
      { document: creditDoc, orderNumber: abNumber, credit: true },
    ]);

    const run = await applyAutopart504cFile(adminId, {
      text,
      filename: "apply.txt",
      allowApply: true,
    });
    expect(run.ordersDespatched).toBe(1);
    expect(run.newInvoices).toBeGreaterThanOrEqual(1);
    expect(run.credits).toBe(1);

    const after = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(after.status).toBe("DISPATCHED");

    const invoice = await prisma.invoice.findFirst({ where: { externalRef: doc } });
    expect(invoice).toBeTruthy();
    expect(invoice!.autopartCustomerOrderNumber).toBe(abNumber);
    expect(invoice!.autopartDocumentKind).toBe("INVOICE");

    const credit = await prisma.invoice.findFirst({ where: { externalRef: creditDoc } });
    expect(credit?.autopartDocumentKind).toBe("CREDIT");

    const res = await prisma.orderStockReservation.findUniqueOrThrow({ where: { id: reservation.id } });
    expect(res.status).toBe("CONSUMED");
    const inv = await prisma.inventory.findUniqueOrThrow({ where: { id: inventory.id } });
    expect(inv.qtyOnHand).toBe(100);
    expect(inv.qtyReserved).toBe(0);

    const emails = await prisma.transactionalEmail.findMany({
      where: { entityId: order.id, purpose: "ORDER_DESPATCHED" },
    });
    expect(emails).toHaveLength(1);

    const replay = await applyAutopart504cFile(adminId, {
      text,
      filename: "apply-replay.txt",
      allowApply: true,
    });
    expect(replay.duplicates).toBeGreaterThanOrEqual(2);
    expect(replay.ordersDespatched).toBe(0);

    const emailsAfter = await prisma.transactionalEmail.findMany({
      where: { entityId: order.id, purpose: "ORDER_DESPATCHED" },
    });
    expect(emailsAfter).toHaveLength(1);
  });

  it("refuses apply without allowApply when feed disabled", async () => {
    await expect(
      applyAutopart504cFile(adminId, {
        text: buildAutopart504cSampleFixture(),
        allowApply: false,
      }),
    ).rejects.toThrow(/DISABLED/i);
  });

  it("does not despatch RECEIVED orders from 504C alone", async () => {
    const abNumber = `AB-${String(920000 + (Date.now() % 70000)).padStart(6, "0")}`;
    const { order } = await createProcessingOrder(abNumber);
    await prisma.order.update({ where: { id: order.id }, data: { status: "SUBMITTED" } });

    const run = await applyAutopart504cFile(adminId, {
      text: reportForAbOrders([
        { document: `I${Date.now().toString().slice(-6)}`, orderNumber: abNumber },
      ]),
      allowApply: true,
    });
    expect(run.ordersDespatched).toBe(0);
    const refreshed = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(refreshed.status).toBe("SUBMITTED");
  });

  it("reports unknown AB references without treating non-AB as errors", async () => {
    const unknown = `AB-${String(930000 + (Date.now() % 60000)).padStart(6, "0")}`;
    const run = await applyAutopart504cFile(adminId, {
      text: reportForAbOrders([
        { document: `I${Date.now().toString().slice(-6)}`, orderNumber: unknown },
      ]),
      allowApply: true,
    });
    expect(run.unmatchedAbRefs).toBe(1);
    expect(run.nonAbRows).toBeGreaterThanOrEqual(1);
    expect(run.status).toBe("PARTIAL");
  });
});
