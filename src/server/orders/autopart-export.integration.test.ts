/**
 * Autopart CSV export — eligibility, metadata, reservations unchanged, no APC.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { bootstrapRbac } from "../../../prisma/bootstrap/rbac";
import {
  exportAutopartOrdersCsv,
  previewAutopartOrderExport,
} from "@/server/orders/autopart-export";
import { AUTOPART_ORDER_CSV_HEADERS, AUTOPART_EXPORT_SOURCE } from "@/domain/autopart-order-export";

const prisma = new PrismaClient();
let adminId = "";
let otherStaffId = "";

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

async function createEligibleOrder(input: {
  orderNumber: string;
  mam: string | null;
  linked?: boolean;
  status?: "SUBMITTED" | "CANCELLED";
  items?: Array<{ sku: string; qty: number; lineTotal: string; unit: string }>;
  delivery?: boolean;
  email?: boolean;
  freeDelivery?: boolean;
}) {
  const company = await prisma.company.create({
    data: {
      name: `Export Co ${input.orderNumber}`,
      status: "ACTIVE",
      ...(input.mam
        ? {
            autopartCustomerCode: `${input.mam}-${input.orderNumber}`,
            autopartCustomerCodeVerifiedAt: new Date(),
            autopartCustomerCodeVerifiedById: adminId,
          }
        : {}),
    },
  });

  const items = input.items ?? [
    { sku: "PMML500SC40", qty: 12, lineTotal: "44.28", unit: "3.69" },
  ];
  const subtotal = items.reduce((s, it) => s + Number(it.lineTotal), 0);
  const deliveryTotal = input.freeDelivery ? 0 : 5.95;
  const vatTotal = input.freeDelivery ? Number((subtotal * 0.2).toFixed(2)) : 10.05;
  const grandTotal = Number((subtotal + deliveryTotal + vatTotal).toFixed(2));

  const order = await prisma.order.create({
    data: {
      orderNumber: input.orderNumber,
      companyId: company.id,
      status: input.status ?? "SUBMITTED",
      subtotal,
      vatTotal,
      deliveryTotal,
      grandTotal,
      placedAt: new Date("2026-09-25T15:00:00.000Z"),
      poNumber: "PO-100",
      paymentTermsSnapshot: "30 Days",
      autopartCustomerCodeSnapshot: input.mam,
      autopartAccountLinked: input.linked ?? Boolean(input.mam),
      ...(input.delivery === false
        ? {}
        : {
            deliveryAddress: {
              line1: "12 High Street",
              line2: "Unit B",
              town: "Leeds",
              county: "West Yorkshire",
              postcode: "LS1 1AA",
              country: "GB",
              contactName: "Alex Buyer",
            },
          }),
      contactSnapshot:
        input.email === false
          ? { name: "Alex", phone: "07700900123" }
          : { name: "Alex Buyer", email: "buyer@example.test", phone: "07700900123" },
      items: {
        create: items.map((it) => ({
          sku: it.sku,
          name: it.sku,
          qty: it.qty,
          unitPrice: it.unit,
          customerUnitPrice: it.unit,
          vatRate: 20,
          lineTotal: it.lineTotal,
          lineVat: "0.00",
          lineGross: it.lineTotal,
        })),
      },
    },
  });

  const createdItems = await prisma.orderItem.findMany({ where: { orderId: order.id } });
  const firstItemId = createdItems[0]?.id ?? null;
  const stamp = `${input.orderNumber}-${Math.random().toString(36).slice(2, 8)}`;
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
      qtyReserved: items[0]!.qty,
      status: "IN_STOCK",
    },
  });

  const reservation = await prisma.orderStockReservation.create({
    data: {
      orderId: order.id,
      orderItemId: firstItemId,
      variantId: variant.id,
      inventoryId: inventory.id,
      quantity: items[0]!.qty,
      status: "ACTIVE",
    },
  });

  return { order, company, reservation, inventory };
}

beforeAll(async () => {
  await bootstrapRbac(prisma);
  adminId = await ensureUser("autopart-export-admin@test.local", ["SUPER_ADMIN"]);
  otherStaffId = await ensureUser("autopart-export-viewer@test.local", ["MANAGEMENT"]);
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("autopart order CSV export service", () => {
  it("exports eligible single-line order and records metadata without touching reservation/status", async () => {
    const stamp = Date.now();
    const { order, reservation, inventory } = await createEligibleOrder({
      orderNumber: `AB-EXP-${stamp}`,
      mam: `MAM${stamp}`,
    });

    const preview = await previewAutopartOrderExport(adminId, [order.id]);
    expect(preview.selected).toBe(1);
    expect(preview.ready).toBe(1);
    expect(preview.blocked).toBe(0);

    const result = await exportAutopartOrdersCsv(adminId, [order.id]);
    expect(result.orderCount).toBe(1);
    expect(result.lineCount).toBe(1);
    expect(result.filename).toContain(order.orderNumber);
    expect(result.headers).toEqual([...AUTOPART_ORDER_CSV_HEADERS]);
    expect(result.csv.split("\n")[0]).toContain("External Reference");
    expect(result.csv).toContain(order.orderNumber);
    expect(result.csv).toContain("PMML500SC40");
    expect(result.csv).toContain(AUTOPART_EXPORT_SOURCE);
    expect(result.csv).toContain(`MAM${stamp}`);
    expect(result.csv).toContain("44.28");
    expect(result.csv).toContain("5.95");
    expect(result.csv).toContain("10.05");
    expect(result.csv).toContain("60.28");
    expect(result.csv).toContain("3.69");

    const refreshed = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(refreshed.autopartExportStatus).toBe("EXPORTED");
    expect(refreshed.autopartExportedAt).toBeTruthy();
    expect(refreshed.autopartExportedByUserId).toBe(adminId);
    expect(refreshed.autopartExportBatchId).toBe(result.batchId);
    expect(refreshed.autopartExportCount).toBe(1);
    expect(refreshed.status).toBe("SUBMITTED"); // fulfilment unchanged
    expect(refreshed.externalRef).toBeNull();

    const resAfter = await prisma.orderStockReservation.findUniqueOrThrow({
      where: { id: reservation.id },
    });
    expect(resAfter.status).toBe("ACTIVE");
    expect(resAfter.quantity).toBe(reservation.quantity);
    const invAfter = await prisma.inventory.findUniqueOrThrow({ where: { id: inventory.id } });
    expect(invAfter.qtyReserved).toBe(inventory.qtyReserved);
    expect(invAfter.qtyOnHand).toBe(inventory.qtyOnHand);

    const batch = await prisma.autopartOrderExportBatch.findUniqueOrThrow({
      where: { id: result.batchId },
    });
    expect(batch.reference).toMatch(/^APX-\d{6}$/);
    expect(batch.orderCount).toBe(1);
    expect(batch.isReexport).toBe(false);

    const audits = await prisma.auditEvent.findMany({
      where: {
        OR: [
          { entityId: order.id, action: "order.autopart_export" },
          { entityId: result.batchId, action: "order.autopart_batch_export" },
        ],
      },
    });
    expect(audits.some((a) => a.action === "order.autopart_export")).toBe(true);
    expect(audits.some((a) => a.action === "order.autopart_batch_export")).toBe(true);
    const exportAudit = audits.find((a) => a.action === "order.autopart_export");
    const meta = exportAudit?.metadata as Record<string, unknown> | null;
    expect(meta?.["apcInvoked"]).toBe(false);
    expect(meta?.["reservationUnchanged"]).toBe(true);
  });

  it("blocks missing Autopart snapshot and cancelled / empty / missing SKU", async () => {
    const stamp = Date.now();
    const missing = await createEligibleOrder({
      orderNumber: `AB-NO-MAM-${stamp}`,
      mam: null,
      linked: false,
    });
    const cancelled = await createEligibleOrder({
      orderNumber: `AB-CXL-${stamp}`,
      mam: `CXL${stamp}`,
      status: "CANCELLED",
    });
    const noSku = await createEligibleOrder({
      orderNumber: `AB-NOSKU-${stamp}`,
      mam: `NS${stamp}`,
      items: [{ sku: "   ", qty: 1, lineTotal: "10.00", unit: "10.00" }],
    });

    const preview = await previewAutopartOrderExport(adminId, [
      missing.order.id,
      cancelled.order.id,
      noSku.order.id,
    ]);
    expect(preview.ready).toBe(0);
    expect(preview.blocked).toBe(3);
    expect(preview.items.map((i) => i.reason).sort()).toEqual([
      "CANCELLED",
      "MISSING_AUTOPART_SNAPSHOT",
      "MISSING_SKU",
    ]);

    await expect(exportAutopartOrdersCsv(adminId, [missing.order.id])).rejects.toThrow(
      /AUTOPART ACCOUNT REQUIRED|Blocked/i,
    );
  });

  it("batch exports multiple orders and requires re-export confirmation", async () => {
    const stamp = Date.now();
    const a = await createEligibleOrder({ orderNumber: `AB-B1-${stamp}`, mam: `B1${stamp}` });
    const b = await createEligibleOrder({
      orderNumber: `AB-B2-${stamp}`,
      mam: `B2${stamp}`,
      freeDelivery: true,
      items: [
        { sku: "SKU-A", qty: 2, lineTotal: "80.00", unit: "40.00" },
        { sku: "SKU-B", qty: 1, lineTotal: "70.00", unit: "70.00" },
      ],
    });

    const first = await exportAutopartOrdersCsv(adminId, [a.order.id, b.order.id]);
    expect(first.orderCount).toBe(2);
    expect(first.lineCount).toBe(3);
    expect(first.csv).toContain(a.order.orderNumber);
    expect(first.csv).toContain(b.order.orderNumber);
    expect(first.csv).toContain("0.00"); // free delivery shipping share possible

    await expect(exportAutopartOrdersCsv(adminId, [a.order.id])).rejects.toThrow(/re-export/i);

    const re = await exportAutopartOrdersCsv(adminId, [a.order.id], { confirmReexport: true });
    expect(re.isReexport).toBe(true);
    const after = await prisma.order.findUniqueOrThrow({ where: { id: a.order.id } });
    expect(after.autopartExportCount).toBe(2);

    const reAudits = await prisma.auditEvent.findMany({
      where: { entityId: a.order.id, action: "order.autopart_reexport" },
    });
    expect(reAudits.length).toBeGreaterThan(0);
  });

  it("denies export for staff without orders.edit / admin.access", async () => {
    const stamp = Date.now();
    const { order } = await createEligibleOrder({
      orderNumber: `AB-DENY-${stamp}`,
      mam: `DN${stamp}`,
    });
    await expect(previewAutopartOrderExport(otherStaffId, [order.id])).rejects.toThrow(
      /permission/i,
    );
  });
});
