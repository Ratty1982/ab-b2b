import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { bootstrapRbac } from "../../../prisma/bootstrap/rbac";
import { saveProduct } from "@/server/catalogue/service";
import {
  getSalesOrderDraft,
  openSalesOrderDraft,
  placeSalesOrder,
  saveSalesOrderDraft,
  searchSalesOrderProducts,
  startSalesOrderEdit,
} from "@/server/orders/sales-order-entry";
import { buildCheckoutReview, resolveOrderLinesFromItems } from "@/server/orders/service";
import { stockFreshness } from "@/server/stock/service";

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
  return user;
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
      status: avail > 0 ? "IN_STOCK" : "OUT_OF_STOCK",
      externalSyncedAt: new Date(),
      sourceAvailRaw: String(avail),
    },
    update: {
      qtyOnHand: avail,
      qtyReserved: 0,
      status: avail > 0 ? "IN_STOCK" : "OUT_OF_STOCK",
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

async function seedCompany(name: string) {
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
  const contact = await prisma.contact.create({
    data: {
      companyId: company.id,
      firstName: "Pat",
      lastName: "Buyer",
      email: `buyer-${company.id}@example.invalid`,
      phone: "01130001111",
      isPrimary: true,
    },
  });
  return { company, address, contact };
}

async function seedVariant(sku: string, avail: number) {
  const product = await saveProduct(adminId, {
    sku,
    name: `Stock display ${sku}`,
    brand: "Power Maxed",
    category: "Braking",
    trade: 4,
    rrp: 8,
    packQty: 1,
    caseQty: 1,
    description: "stock display",
    active: true,
  });
  const variant = await prisma.productVariant.findFirstOrThrow({ where: { productId: product.id } });
  await prisma.productVariant.update({ where: { id: variant.id }, data: { backorderPolicy: "ALLOW" } });
  await seedStock(variant.id, avail);
  return variant;
}

function expectedFrom(review: {
  lines: Array<{
    variantId: string;
    quantity: number;
    customerUnitPrice: string | null;
    lineNet: string | null;
    availableQtyAtOrder?: number;
    backorderQtyAtOrder?: number;
  }>;
  totals: { subtotal: string; vatTotal: string; deliveryTotal: string; grandTotal: string };
}) {
  return {
    lines: review.lines.map((line) => ({
      variantId: line.variantId,
      qty: line.quantity,
      customerUnitPrice: line.customerUnitPrice ?? "0.00",
      lineNet: line.lineNet ?? "0.00",
      availableQty: line.availableQtyAtOrder,
      backorderQty: line.backorderQtyAtOrder,
    })),
    subtotal: review.totals.subtotal,
    vatTotal: review.totals.vatTotal,
    deliveryTotal: review.totals.deliveryTotal,
    grandTotal: review.totals.grandTotal,
  };
}

async function inventoryOf(variantId: string) {
  return prisma.inventory.findFirstOrThrow({ where: { variantId } });
}

async function activeReserved(orderId: string) {
  const rows = await prisma.orderStockReservation.findMany({ where: { orderId, status: "ACTIVE" } });
  return rows.reduce((sum, row) => sum + row.quantity, 0);
}

/** Move every recent live success back past the stale window, then restore it. */
async function withStaleAutopartStock<T>(run: () => Promise<T>): Promise<T> {
  const before = await stockFreshness();
  if (before.staleHours <= 0) throw new Error("stale window is disabled");
  const windowMs = before.staleHours * 60 * 60 * 1000;
  const cutoff = new Date(Date.now() - windowMs);
  const fresh = await prisma.stockSyncRun.findMany({
    where: {
      status: { in: ["SUCCESS", "PARTIAL"] },
      mode: "live",
      OR: [{ completedAt: null }, { completedAt: { gt: cutoff } }],
    },
    select: { id: true, completedAt: true },
  });
  if (fresh.length === 0) throw new Error("expected a recent live stock sync");
  const aged = new Date(Date.now() - windowMs - 60 * 60 * 1000);
  await prisma.$transaction(
    fresh.map((row) => prisma.stockSyncRun.update({ where: { id: row.id }, data: { completedAt: aged } })),
  );
  try {
    const stale = await stockFreshness();
    if (!stale.stale) throw new Error("stock feed did not become stale");
    return await run();
  } finally {
    await prisma.$transaction(
      fresh.map((row) =>
        prisma.stockSyncRun.update({ where: { id: row.id }, data: { completedAt: row.completedAt } }),
      ),
    );
  }
}

beforeAll(async () => {
  await bootstrapRbac(prisma);
  adminId = (await ensureUser("stock-display.admin@example.invalid", ["SUPER_ADMIN"])).id;
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("staff sales order stock display", () => {
  it("shows 200 available and allocates 2 when 200 are sellable and 2 are ordered", async () => {
    const stamp = Date.now();
    const sku = `STK200-${stamp}`;
    const variant = await seedVariant(sku, 200);
    const rep = await ensureUser(`stk200-${stamp}@example.invalid`, ["SALES_REPRESENTATIVE"]);
    const { company, address, contact } = await seedCompany(`Stock 200 ${stamp}`);

    const draft = await openSalesOrderDraft(rep.id, { companyId: company.id, fresh: true });
    const saved = await saveSalesOrderDraft(rep.id, {
      draftId: draft.draft.id,
      contactId: contact.id,
      addressId: address.id,
      source: "TELEPHONE",
      lines: [{ variantId: variant.id, qty: 2 }],
    });
    expect(saved.review?.lines[0]).toMatchObject({
      quantity: 2,
      sellableQty: 200,
      stockConfirmed: true,
      availableQtyAtOrder: 2,
      backorderQtyAtOrder: 0,
    });

    const hits = await searchSalesOrderProducts(rep.id, {
      companyId: company.id,
      q: sku,
      draftId: draft.draft.id,
    });
    expect(hits.find((hit) => hit.variantId === variant.id)).toMatchObject({
      sellableQty: 200,
      stockConfirmed: true,
    });

    const lines = await resolveOrderLinesFromItems(company.id, [{ variantId: variant.id, qty: 2 }]);
    const customerReview = buildCheckoutReview({
      company: {
        id: company.id,
        name: company.name,
        taxStatus: company.taxStatus,
        paymentTerms: company.paymentTerms,
      },
      lines,
      deliveryAddress: null,
      contact: { name: "Pat Buyer", email: "pat@example.invalid", phone: null },
      poNumber: null,
      deliveryInstructions: null,
    });
    expect(customerReview.lines[0]?.availableQtyAtOrder).toBe(2);
    expect(customerReview.lines[0]).not.toHaveProperty("sellableQty");
    expect(customerReview.lines[0]).not.toHaveProperty("stockConfirmed");

    const placed = await placeSalesOrder(rep.id, {
      draftId: draft.draft.id,
      confirmAuthorised: true,
      idempotencyKey: `stk200-${stamp}`,
      source: "TELEPHONE",
      contactId: contact.id,
      addressId: address.id,
      lines: [{ variantId: variant.id, qty: 2 }],
      expectedReview: expectedFrom(saved.review!),
    });
    expect(placed.ok).toBe(true);
    if (!placed.ok) return;
    const inv = await inventoryOf(variant.id);
    expect(inv.qtyOnHand).toBe(200);
    expect(inv.qtyReserved).toBe(2);
    expect(await activeReserved(placed.order.id)).toBe(2);
  });

  it("deducts stock reserved by other orders", async () => {
    const stamp = Date.now();
    const sku = `STKRES-${stamp}`;
    const variant = await seedVariant(sku, 200);
    const rep = await ensureUser(`stkres-${stamp}@example.invalid`, ["SALES_REPRESENTATIVE"]);
    const holder = await seedCompany(`Stock holder ${stamp}`);
    const buyer = await seedCompany(`Stock buyer ${stamp}`);

    const held = await openSalesOrderDraft(rep.id, { companyId: holder.company.id, fresh: true });
    const heldSaved = await saveSalesOrderDraft(rep.id, {
      draftId: held.draft.id,
      contactId: holder.contact.id,
      addressId: holder.address.id,
      source: "TELEPHONE",
      lines: [{ variantId: variant.id, qty: 50 }],
    });
    const heldPlaced = await placeSalesOrder(rep.id, {
      draftId: held.draft.id,
      confirmAuthorised: true,
      idempotencyKey: `stkres-hold-${stamp}`,
      source: "TELEPHONE",
      contactId: holder.contact.id,
      addressId: holder.address.id,
      lines: [{ variantId: variant.id, qty: 50 }],
      expectedReview: expectedFrom(heldSaved.review!),
    });
    expect(heldPlaced.ok).toBe(true);

    const draft = await openSalesOrderDraft(rep.id, { companyId: buyer.company.id, fresh: true });
    const saved = await saveSalesOrderDraft(rep.id, {
      draftId: draft.draft.id,
      contactId: buyer.contact.id,
      addressId: buyer.address.id,
      source: "TELEPHONE",
      lines: [{ variantId: variant.id, qty: 2 }],
    });
    expect(saved.review?.lines[0]).toMatchObject({
      sellableQty: 150,
      stockConfirmed: true,
      availableQtyAtOrder: 2,
      backorderQtyAtOrder: 0,
      quantity: 2,
    });
    const hits = await searchSalesOrderProducts(rep.id, { companyId: buyer.company.id, q: sku });
    expect(hits.find((hit) => hit.variantId === variant.id)).toMatchObject({
      sellableQty: 150,
      stockConfirmed: true,
    });
    const inv = await inventoryOf(variant.id);
    expect(inv.qtyOnHand).toBe(200);
    expect(inv.qtyReserved).toBe(50);
  });

  it("does not advertise stale or missing Autopart stock as available", async () => {
    const stamp = Date.now();
    const sku = `STKSTALE-${stamp}`;
    const variant = await seedVariant(sku, 200);
    const rep = await ensureUser(`stkstale-${stamp}@example.invalid`, ["SALES_REPRESENTATIVE"]);
    const { company, address, contact } = await seedCompany(`Stock stale ${stamp}`);

    const placedDraft = await openSalesOrderDraft(rep.id, { companyId: company.id, fresh: true });
    const placedSaved = await saveSalesOrderDraft(rep.id, {
      draftId: placedDraft.draft.id,
      contactId: contact.id,
      addressId: address.id,
      source: "TELEPHONE",
      lines: [{ variantId: variant.id, qty: 2 }],
    });
    const placed = await placeSalesOrder(rep.id, {
      draftId: placedDraft.draft.id,
      confirmAuthorised: true,
      idempotencyKey: `stkstale-place-${stamp}`,
      source: "TELEPHONE",
      contactId: contact.id,
      addressId: address.id,
      lines: [{ variantId: variant.id, qty: 2 }],
      expectedReview: expectedFrom(placedSaved.review!),
    });
    expect(placed.ok).toBe(true);
    if (!placed.ok) return;

    const freshDraft = await openSalesOrderDraft(rep.id, { companyId: company.id, fresh: true });
    await saveSalesOrderDraft(rep.id, {
      draftId: freshDraft.draft.id,
      contactId: contact.id,
      addressId: address.id,
      source: "TELEPHONE",
      lines: [{ variantId: variant.id, qty: 2 }],
    });

    await withStaleAutopartStock(async () => {
      const reviewed = await getSalesOrderDraft(rep.id, { draftId: freshDraft.draft.id });
      expect(reviewed.review?.lines[0]).toMatchObject({
        sellableQty: 0,
        stockConfirmed: false,
        availableQtyAtOrder: 0,
        backorderQtyAtOrder: 2,
      });
      expect(reviewed.review?.lines[0]?.sellableQty).not.toBe(198);
      const hits = await searchSalesOrderProducts(rep.id, {
        companyId: company.id,
        q: sku,
        draftId: freshDraft.draft.id,
      });
      expect(hits.find((hit) => hit.variantId === variant.id)).toMatchObject({
        sellableQty: 0,
        stockConfirmed: false,
      });

      const editing = await startSalesOrderEdit(rep.id, { orderId: placed.order.id });
      expect(editing.review?.lines[0]).toMatchObject({
        quantity: 2,
        sellableQty: 2,
        stockConfirmed: false,
        availableQtyAtOrder: 2,
        backorderQtyAtOrder: 0,
      });
      const editHits = await searchSalesOrderProducts(rep.id, {
        companyId: company.id,
        q: sku,
        draftId: editing.draft.id,
      });
      expect(editHits.find((hit) => hit.variantId === variant.id)?.stockConfirmed).toBe(false);
      const kept = await saveSalesOrderDraft(rep.id, {
        draftId: editing.draft.id,
        contactId: contact.id,
        addressId: address.id,
        lines: [{ variantId: variant.id, qty: 2 }],
      });
      const amended = await placeSalesOrder(rep.id, {
        draftId: editing.draft.id,
        confirmAuthorised: true,
        idempotencyKey: `stkstale-edit-${stamp}`,
        source: "TELEPHONE",
        contactId: contact.id,
        addressId: address.id,
        lines: [{ variantId: variant.id, qty: 2 }],
        expectedReview: expectedFrom(kept.review!),
      });
      expect(amended.ok).toBe(true);
    });

    const inv = await inventoryOf(variant.id);
    expect(inv.qtyOnHand).toBe(200);
    expect(inv.qtyReserved).toBe(2);
    expect(await activeReserved(placed.order.id)).toBe(2);
    expect((await stockFreshness()).stale).toBe(false);

    await prisma.inventory.deleteMany({ where: { variantId: variant.id } });
    const missing = await getSalesOrderDraft(rep.id, { draftId: freshDraft.draft.id });
    expect(missing.review?.lines[0]).toMatchObject({ sellableQty: 0, stockConfirmed: false });
    const missingHits = await searchSalesOrderProducts(rep.id, { companyId: company.id, q: sku });
    expect(missingHits.find((hit) => hit.variantId === variant.id)).toMatchObject({
      sellableQty: 0,
      stockConfirmed: false,
    });
  });

  it("does not treat an order's own reservation as unavailable when that order is edited", async () => {
    const stamp = Date.now();
    const sku = `STKEDIT-${stamp}`;
    const variant = await seedVariant(sku, 200);
    const rep = await ensureUser(`stkedit-${stamp}@example.invalid`, ["SALES_REPRESENTATIVE"]);
    const { company, address, contact } = await seedCompany(`Stock edit ${stamp}`);

    const draft = await openSalesOrderDraft(rep.id, { companyId: company.id, fresh: true });
    const saved = await saveSalesOrderDraft(rep.id, {
      draftId: draft.draft.id,
      contactId: contact.id,
      addressId: address.id,
      source: "TELEPHONE",
      lines: [{ variantId: variant.id, qty: 2 }],
    });
    const placed = await placeSalesOrder(rep.id, {
      draftId: draft.draft.id,
      confirmAuthorised: true,
      idempotencyKey: `stkedit-place-${stamp}`,
      source: "TELEPHONE",
      contactId: contact.id,
      addressId: address.id,
      lines: [{ variantId: variant.id, qty: 2 }],
      expectedReview: expectedFrom(saved.review!),
    });
    expect(placed.ok).toBe(true);
    if (!placed.ok) return;
    expect(await activeReserved(placed.order.id)).toBe(2);

    const editing = await startSalesOrderEdit(rep.id, { orderId: placed.order.id });
    expect(editing.review?.lines[0]).toMatchObject({
      sellableQty: 200,
      stockConfirmed: true,
      availableQtyAtOrder: 2,
      backorderQtyAtOrder: 0,
      quantity: 2,
    });
    const hits = await searchSalesOrderProducts(rep.id, {
      companyId: company.id,
      q: sku,
      draftId: editing.draft.id,
    });
    expect(hits.find((hit) => hit.variantId === variant.id)).toMatchObject({
      sellableQty: 200,
      stockConfirmed: true,
    });
    const unchanged = await searchSalesOrderProducts(rep.id, { companyId: company.id, q: sku });
    expect(unchanged.find((hit) => hit.variantId === variant.id)?.sellableQty).toBe(198);

    const kept = await saveSalesOrderDraft(rep.id, {
      draftId: editing.draft.id,
      contactId: contact.id,
      addressId: address.id,
      lines: [{ variantId: variant.id, qty: 2 }],
    });
    const amended = await placeSalesOrder(rep.id, {
      draftId: editing.draft.id,
      confirmAuthorised: true,
      idempotencyKey: `stkedit-save-${stamp}`,
      source: "TELEPHONE",
      contactId: contact.id,
      addressId: address.id,
      lines: [{ variantId: variant.id, qty: 2 }],
      expectedReview: expectedFrom(kept.review!),
    });
    expect(amended.ok).toBe(true);
    const inv = await inventoryOf(variant.id);
    expect(inv.qtyOnHand).toBe(200);
    expect(inv.qtyReserved).toBe(2);
    expect(await activeReserved(placed.order.id)).toBe(2);
  });

  it("shows 6 available, allocates 6 and backorders 6 when an order for all the stock is raised to 12", async () => {
    const stamp = Date.now();
    const sku = `STKBO-${stamp}`;
    const variant = await seedVariant(sku, 6);
    const rep = await ensureUser(`stkbo-${stamp}@example.invalid`, ["SALES_REPRESENTATIVE"]);
    const { company, address, contact } = await seedCompany(`Stock backorder ${stamp}`);

    const draft = await openSalesOrderDraft(rep.id, { companyId: company.id, fresh: true });
    const saved = await saveSalesOrderDraft(rep.id, {
      draftId: draft.draft.id,
      contactId: contact.id,
      addressId: address.id,
      source: "TELEPHONE",
      lines: [{ variantId: variant.id, qty: 6 }],
    });
    const placed = await placeSalesOrder(rep.id, {
      draftId: draft.draft.id,
      confirmAuthorised: true,
      idempotencyKey: `stkbo-place-${stamp}`,
      source: "TELEPHONE",
      contactId: contact.id,
      addressId: address.id,
      lines: [{ variantId: variant.id, qty: 6 }],
      expectedReview: expectedFrom(saved.review!),
    });
    expect(placed.ok).toBe(true);
    if (!placed.ok) return;

    const editing = await startSalesOrderEdit(rep.id, { orderId: placed.order.id });
    const changed = await saveSalesOrderDraft(rep.id, {
      draftId: editing.draft.id,
      contactId: contact.id,
      addressId: address.id,
      lines: [{ variantId: variant.id, qty: 12 }],
    });
    expect(changed.review?.lines[0]).toMatchObject({
      quantity: 12,
      sellableQty: 6,
      stockConfirmed: true,
      availableQtyAtOrder: 6,
      backorderQtyAtOrder: 6,
    });
    const hits = await searchSalesOrderProducts(rep.id, {
      companyId: company.id,
      q: sku,
      draftId: editing.draft.id,
    });
    expect(hits.find((hit) => hit.variantId === variant.id)).toMatchObject({
      sellableQty: 6,
      stockConfirmed: true,
    });

    const updated = await placeSalesOrder(rep.id, {
      draftId: editing.draft.id,
      confirmAuthorised: true,
      idempotencyKey: `stkbo-edit-${stamp}`,
      source: "TELEPHONE",
      contactId: contact.id,
      addressId: address.id,
      lines: [{ variantId: variant.id, qty: 12 }],
      backorderAcknowledged: true,
      expectedReview: expectedFrom(changed.review!),
    });
    expect(updated.ok).toBe(true);
    if (!updated.ok) return;
    const item = await prisma.orderItem.findFirstOrThrow({ where: { orderId: placed.order.id } });
    expect(item.qty).toBe(12);
    expect(item.availableQtyAtOrder).toBe(6);
    expect(item.backorderQtyAtOrder).toBe(6);
    const inv = await inventoryOf(variant.id);
    expect(inv.qtyOnHand).toBe(6);
    expect(inv.qtyReserved).toBe(6);
    expect(await activeReserved(placed.order.id)).toBe(6);
  });
});
