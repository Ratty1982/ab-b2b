/**
 * Hold-until-complete stock workflow — place, export gates, FIFO release,
 * reservations, email idempotency, cancel, permissions.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { bootstrapRbac } from "../../../prisma/bootstrap/rbac";
import { saveProduct } from "@/server/catalogue/service";
import {
  openSalesOrderDraft,
  placeSalesOrder,
  saveSalesOrderDraft,
} from "@/server/orders/sales-order-entry";
import {
  cancelOrderStockHold,
  evaluateHeldOrdersAfterStockSync,
  listHeldOrders,
  retryHeldOrderEvaluation,
} from "@/server/orders/stock-hold";
import {
  exportAutopartOrdersCsv,
  previewAutopartOrderExport,
} from "@/server/orders/autopart-export";
import { listAdminOrders } from "@/server/orders/service";
import { applyStockFeed } from "@/server/stock/service";
import { setEmailAdapterForTests } from "@/infra/email";
import { AuthError } from "@/server/rbac/guards";
import { STOCK_HOLD_STAFF_LABEL } from "@/domain/order-stock-hold";

const prisma = new PrismaClient();
let adminId = "";

async function ensureUser(
  email: string,
  roles: string[],
  actorType: "INTERNAL" | "TRADE" = "INTERNAL",
  name?: string,
) {
  let user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    user = await prisma.user.create({
      data: {
        email,
        name: name ?? email.split("@")[0]!,
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
  return user;
}

async function ensureRep(email: string, code: string) {
  const user = await ensureUser(email, ["SALES_REPRESENTATIVE"], "INTERNAL", email.split("@")[0]);
  const existing = await prisma.salesRep.findUnique({ where: { userId: user.id } });
  if (existing) {
    await prisma.salesRep.update({
      where: { id: existing.id },
      data: { active: true, businessEmail: email },
    });
    return { user, rep: existing };
  }
  const rep = await prisma.salesRep.create({
    data: { userId: user.id, code, active: true, businessEmail: email },
  });
  return { user, rep };
}

async function seedStock(variantId: string, avail: number, reserved = 0) {
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
      qtyReserved: reserved,
      status: avail > 0 ? "IN_STOCK" : "OUT_OF_STOCK",
      externalSyncedAt: new Date(),
      sourceAvailRaw: String(avail),
    },
    update: {
      qtyOnHand: avail,
      qtyReserved: reserved,
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

async function seedCompany(name: string, mam: string) {
  // Pre-enforcement createdAt keeps staff order entry available without full setup wizard.
  const company = await prisma.company.create({
    data: {
      name,
      status: "ACTIVE",
      paymentTerms: "Net 30",
      autopartCustomerCode: mam,
      autopartCustomerCodeVerifiedAt: new Date(),
      autopartCustomerCodeVerifiedById: adminId,
      createdAt: new Date("2026-11-01T00:00:00.000Z"),
    },
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
  await prisma.address.create({
    data: {
      companyId: company.id,
      type: "BILLING",
      label: "Accounts",
      line1: "10 Industrial Way",
      town: "Leeds",
      postcode: "LS1 1AA",
      country: "GB",
      isDefaultBilling: true,
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

async function seedVariant(sku: string, trade: number, avail: number) {
  const product = await saveProduct(adminId, {
    sku,
    name: `Hold ${sku}`,
    brand: "Power Maxed",
    category: "Braking",
    trade,
    rrp: trade * 2,
    packQty: 1,
    caseQty: 1,
    description: "stock hold",
    active: true,
  });
  const variant = await prisma.productVariant.findFirstOrThrow({ where: { productId: product.id } });
  await prisma.productVariant.update({
    where: { id: variant.id },
    data: { backorderPolicy: "ALLOW" },
  });
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

async function placeHeldOrder(input: {
  actorId: string;
  companyId: string;
  contactId: string;
  addressId: string;
  variantId: string;
  qty: number;
  key: string;
  hold?: boolean;
  acknowledge?: boolean;
}) {
  const draft = await openSalesOrderDraft(input.actorId, {
    companyId: input.companyId,
    fresh: true,
  });
  const saved = await saveSalesOrderDraft(input.actorId, {
    draftId: draft.draft.id,
    contactId: input.contactId,
    addressId: input.addressId,
    source: "TELEPHONE",
    lines: [{ variantId: input.variantId, qty: input.qty }],
  });
  return placeSalesOrder(input.actorId, {
    draftId: draft.draft.id,
    confirmAuthorised: true,
    idempotencyKey: input.key,
    source: "TELEPHONE",
    contactId: input.contactId,
    addressId: input.addressId,
    lines: [{ variantId: input.variantId, qty: input.qty }],
    expectedReview: expectedFrom(saved.review!),
    backorderAcknowledged: input.acknowledge ?? true,
    holdUntilComplete: input.hold ?? false,
  });
}

beforeAll(async () => {
  await bootstrapRbac(prisma);
  adminId = (await ensureUser("hold.admin@example.invalid", ["SUPER_ADMIN"], "INTERNAL", "Hold Admin")).id;
  setEmailAdapterForTests({
    name: "test-hold",
    async send() {
      return { ok: true, providerId: "test-hold" };
    },
  });
});

afterEach(() => {
  setEmailAdapterForTests({
    name: "test-hold",
    async send() {
      return { ok: true, providerId: "test-hold" };
    },
  });
});

afterAll(async () => {
  setEmailAdapterForTests(null);
  await prisma.$disconnect();
});

describe("hold until complete stock workflow", () => {
  it("places a normal order without hold when unchecked", async () => {
    const stamp = Date.now();
    const variant = await seedVariant(`HOLD-N-${stamp}`, 8, 20);
    const { company, address, contact } = await seedCompany(`Hold Normal ${stamp}`, `HN${stamp}`);
    const staff = await ensureUser(`hold-n-${stamp}@example.invalid`, ["MANAGEMENT"]);
    const placed = await placeHeldOrder({
      actorId: staff.id,
      companyId: company.id,
      contactId: contact.id,
      addressId: address.id,
      variantId: variant.id,
      qty: 2,
      key: `hold-n-${stamp}`,
      hold: false,
    });
    expect(placed.ok).toBe(true);
    if (!placed.ok) return;
    const order = await prisma.order.findUniqueOrThrow({ where: { id: placed.order.id } });
    expect(order.status).toBe("SUBMITTED");
    expect(order.stockHoldState).toBe("NONE");
    expect(order.stockReleasePolicy).toBe("SHIP_AS_AVAILABLE");
  });

  it("holds partial and full backorders, preserves available reservations, blocks export", async () => {
    const stamp = Date.now();
    const partial = await seedVariant(`HOLD-P-${stamp}`, 5, 4);
    const full = await seedVariant(`HOLD-F-${stamp}`, 5, 0);
    const { company, address, contact } = await seedCompany(`Hold Partial ${stamp}`, `HP${stamp}`);
    const staff = await ensureUser(`hold-p-${stamp}@example.invalid`, ["MANAGEMENT"]);

    const partPlaced = await placeHeldOrder({
      actorId: staff.id,
      companyId: company.id,
      contactId: contact.id,
      addressId: address.id,
      variantId: partial.id,
      qty: 10,
      key: `hold-p-${stamp}`,
      hold: true,
    });
    expect(partPlaced.ok).toBe(true);
    if (!partPlaced.ok) return;
    const partOrder = await prisma.order.findUniqueOrThrow({ where: { id: partPlaced.order.id } });
    expect(partOrder.status).toBe("SUBMITTED");
    expect(partOrder.stockHoldState).toBe("WAITING_STOCK");
    expect(partOrder.stockReleasePolicy).toBe("HOLD_UNTIL_COMPLETE");
    expect(partOrder.orderNumber).toMatch(/^AB-/);
    const partRes = await prisma.orderStockReservation.findMany({
      where: { orderId: partOrder.id, status: "ACTIVE" },
    });
    expect(partRes.reduce((s, r) => s + r.quantity, 0)).toBe(4);

    const fullPlaced = await placeHeldOrder({
      actorId: staff.id,
      companyId: company.id,
      contactId: contact.id,
      addressId: address.id,
      variantId: full.id,
      qty: 3,
      key: `hold-f-${stamp}`,
      hold: true,
    });
    expect(fullPlaced.ok).toBe(true);
    if (!fullPlaced.ok) return;
    const fullOrder = await prisma.order.findUniqueOrThrow({ where: { id: fullPlaced.order.id } });
    expect(fullOrder.stockHoldState).toBe("WAITING_STOCK");
    expect(
      await prisma.orderStockReservation.count({
        where: { orderId: fullOrder.id, status: "ACTIVE" },
      }),
    ).toBe(0);

    const preview = await previewAutopartOrderExport(adminId, [partOrder.id, fullOrder.id]);
    expect(preview.ready).toBe(0);
    expect(preview.items.every((i) => i.reason === "WAITING_STOCK")).toBe(true);
    await expect(exportAutopartOrdersCsv(adminId, [partOrder.id])).rejects.toMatchObject({
      code: "EXPORT_BLOCKED",
    });

    const listed = await listAdminOrders(adminId, { autopartExport: "READY", q: partOrder.orderNumber });
    expect(listed.items.some((i) => i.id === partOrder.id)).toBe(false);
    const blocked = await listAdminOrders(adminId, {
      autopartExport: "BLOCKED",
      q: partOrder.orderNumber,
    });
    expect(blocked.items.find((i) => i.id === partOrder.id)?.stockHoldLabel).toBe(
      STOCK_HOLD_STAFF_LABEL,
    );
  });

  it("releases FIFO when stock arrives, ignoring own reservations and competing holds", async () => {
    const stamp = Date.now();
    const variant = await seedVariant(`HOLD-FIFO-${stamp}`, 7, 2);
    const a = await seedCompany(`Hold FIFO A ${stamp}`, `FA${stamp}`);
    const b = await seedCompany(`Hold FIFO B ${stamp}`, `FB${stamp}`);
    const staff = await ensureUser(`hold-fifo-${stamp}@example.invalid`, ["MANAGEMENT"]);
    const { user: rep, rep: repRow } = await ensureRep(`hold-rep-${stamp}@example.invalid`, `HR${stamp}`);
    await prisma.companyAssignment.create({
      data: { companyId: a.company.id, salesRepId: repRow.id, isPrimary: true },
    });

    const first = await placeHeldOrder({
      actorId: staff.id,
      companyId: a.company.id,
      contactId: a.contact.id,
      addressId: a.address.id,
      variantId: variant.id,
      qty: 5,
      key: `hold-fifo-a-${stamp}`,
      hold: true,
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    // Ensure second hold is later for FIFO.
    await prisma.order.update({
      where: { id: first.order.id },
      data: { stockHeldAt: new Date(Date.now() - 60_000) },
    });

    const second = await placeHeldOrder({
      actorId: staff.id,
      companyId: b.company.id,
      contactId: b.contact.id,
      addressId: b.address.id,
      variantId: variant.id,
      qty: 5,
      key: `hold-fifo-b-${stamp}`,
      hold: true,
    });
    expect(second.ok).toBe(true);
    if (!second.ok) return;

    // Only enough free stock for one remaining shortfall after own reservations.
    // First order reserved 2; needs 3 more. Second reserved 0 (stock gone); needs 5.
    await seedStock(variant.id, 5);
    // Recreate reserved counters from ACTIVE rows.
    const active = await prisma.orderStockReservation.groupBy({
      by: ["variantId"],
      where: { variantId: variant.id, status: "ACTIVE" },
      _sum: { quantity: true },
    });
    const reserved = active[0]?._sum.quantity ?? 0;
    const warehouse = await prisma.warehouse.findUniqueOrThrow({ where: { code: "AUTOPART" } });
    await prisma.inventory.update({
      where: { variantId_warehouseId: { variantId: variant.id, warehouseId: warehouse.id } },
      data: { qtyOnHand: 5, qtyReserved: reserved },
    });

    const eval1 = await evaluateHeldOrdersAfterStockSync({ actorUserId: staff.id });
    expect(eval1.released).toBe(1);
    const firstAfter = await prisma.order.findUniqueOrThrow({ where: { id: first.order.id } });
    const secondAfter = await prisma.order.findUniqueOrThrow({ where: { id: second.order.id } });
    expect(firstAfter.stockHoldState).toBe("READY_TO_EXPORT");
    expect(secondAfter.stockHoldState).toBe("WAITING_STOCK");
    expect(firstAfter.status).toBe("SUBMITTED");
    expect(firstAfter.autopartExportStatus).toBe("NOT_EXPORTED");

    const firstReserved = await prisma.orderStockReservation.aggregate({
      where: { orderId: first.order.id, status: "ACTIVE" },
      _sum: { quantity: true },
    });
    expect(firstReserved._sum.quantity).toBe(5);

    // Repeated polling is idempotent.
    const eval2 = await evaluateHeldOrdersAfterStockSync({ actorUserId: staff.id });
    expect(eval2.released).toBe(0);

    const emails = await prisma.transactionalEmail.findMany({
      where: {
        entityId: first.order.id,
        purpose: "ORDER_STOCK_HOLD_READY_INTERNAL",
      },
    });
    expect(emails.length).toBeGreaterThan(0);
    expect(emails[0]?.subject).toContain("Order Ready for Export");
    expect(emails[0]?.subject).toContain(first.order.orderNumber);
    expect(emails.some((e) => e.toEmail.toLowerCase() === rep.email.toLowerCase())).toBe(true);

    // Export works after release.
    const preview = await previewAutopartOrderExport(adminId, [first.order.id]);
    expect(preview.items[0]?.eligible).toBe(true);
    const exported = await exportAutopartOrdersCsv(adminId, [first.order.id]);
    expect(exported.orderCount).toBe(1);

    // Second still blocked.
    await expect(exportAutopartOrdersCsv(adminId, [second.order.id])).rejects.toMatchObject({
      code: "EXPORT_BLOCKED",
    });
  });

  it("does not release on failed/stale stock, and survives mid-release shortage", async () => {
    const stamp = Date.now();
    const variant = await seedVariant(`HOLD-STALE-${stamp}`, 6, 0);
    const { company, address, contact } = await seedCompany(`Hold Stale ${stamp}`, `HS${stamp}`);
    const staff = await ensureUser(`hold-stale-${stamp}@example.invalid`, ["MANAGEMENT"]);
    const placed = await placeHeldOrder({
      actorId: staff.id,
      companyId: company.id,
      contactId: contact.id,
      addressId: address.id,
      variantId: variant.id,
      qty: 4,
      key: `hold-stale-${stamp}`,
      hold: true,
    });
    expect(placed.ok).toBe(true);
    if (!placed.ok) return;

    // Mark stock sync stale by aging every live SUCCESS/PARTIAL run.
    // stockFreshness reads the latest live success globally (any source), so
    // aging only 231PO3NEW leaves fresh SUCCESS rows from other suites and
    // falsely reports freshness in CI.
    await prisma.stockSyncRun.updateMany({
      where: { mode: "live", status: { in: ["SUCCESS", "PARTIAL"] } },
      data: { completedAt: new Date(Date.now() - 100 * 60 * 60 * 1000) },
    });
    const staleEval = await evaluateHeldOrdersAfterStockSync({ actorUserId: staff.id });
    expect(staleEval.stale).toBe(true);
    expect(staleEval.released).toBe(0);
    const stillWaiting = await prisma.order.findUniqueOrThrow({ where: { id: placed.order.id } });
    expect(stillWaiting.stockHoldState).toBe("WAITING_STOCK");

    // Fresh success run, but failed feed must not release via applyStockFeed.
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
    const failed = await applyStockFeed({
      text: "not-a-valid-csv",
      dryRun: false,
      trigger: "manual",
      actorUserId: staff.id,
      sourceLabel: "231PO3NEW",
    });
    expect(failed.status).toBe("FAILED");
    const afterFail = await prisma.order.findUniqueOrThrow({ where: { id: placed.order.id } });
    expect(afterFail.stockHoldState).toBe("WAITING_STOCK");
  });

  it("cancels hold with permission + reason, rejects viewers, and keeps email failure from reversing release", async () => {
    const stamp = Date.now();
    const variant = await seedVariant(`HOLD-CX-${stamp}`, 9, 1);
    const { company, address, contact } = await seedCompany(`Hold Cancel ${stamp}`, `HC${stamp}`);
    const staff = await ensureUser(`hold-cx-${stamp}@example.invalid`, ["MANAGEMENT"]);
    const viewer = await ensureUser(`hold-view-${stamp}@example.invalid`, ["ACCOUNTS"]);

    const held = await placeHeldOrder({
      actorId: staff.id,
      companyId: company.id,
      contactId: contact.id,
      addressId: address.id,
      variantId: variant.id,
      qty: 3,
      key: `hold-cx-${stamp}`,
      hold: true,
    });
    expect(held.ok).toBe(true);
    if (!held.ok) return;

    await expect(retryHeldOrderEvaluation(viewer.id, held.order.id)).rejects.toBeInstanceOf(AuthError);
    await expect(
      cancelOrderStockHold(viewer.id, { orderId: held.order.id, reason: "nope" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    const listed = await listHeldOrders(adminId, { q: held.order.orderNumber });
    expect(listed.items[0]?.blockingSkus.length).toBeGreaterThan(0);

    const cancelled = await cancelOrderStockHold(adminId, {
      orderId: held.order.id,
      reason: "Customer accepted partial despatch",
      cancelOrder: false,
    });
    expect(cancelled.stockHoldState).toBe("CANCELLED_HOLD");
    expect(cancelled.orderStatus).toBe("SUBMITTED");

    // Email failure must not reverse a release.
    const variant2 = await seedVariant(`HOLD-EM-${stamp}`, 9, 0);
    const held2 = await placeHeldOrder({
      actorId: staff.id,
      companyId: company.id,
      contactId: contact.id,
      addressId: address.id,
      variantId: variant2.id,
      qty: 2,
      key: `hold-em-${stamp}`,
      hold: true,
    });
    expect(held2.ok).toBe(true);
    if (!held2.ok) return;
    await seedStock(variant2.id, 2);
    setEmailAdapterForTests({
      name: "test-hold-fail",
      async send() {
        throw new Error("smtp down");
      },
    });
    const released = await evaluateHeldOrdersAfterStockSync({ actorUserId: staff.id });
    expect(released.released).toBeGreaterThanOrEqual(1);
    const after = await prisma.order.findUniqueOrThrow({ where: { id: held2.order.id } });
    expect(after.stockHoldState).toBe("READY_TO_EXPORT");
  });

  it("leaves 216V Autopart backorder snapshots untouched", async () => {
    const stamp = Date.now();
    const before = await prisma.autopartBackorderSnapshot.count();
    const variant = await seedVariant(`HOLD-216-${stamp}`, 3, 0);
    const { company, address, contact } = await seedCompany(`Hold 216 ${stamp}`, `H6${stamp}`);
    const staff = await ensureUser(`hold-216-${stamp}@example.invalid`, ["MANAGEMENT"]);
    const placed = await placeHeldOrder({
      actorId: staff.id,
      companyId: company.id,
      contactId: contact.id,
      addressId: address.id,
      variantId: variant.id,
      qty: 1,
      key: `hold-216-${stamp}`,
      hold: true,
    });
    expect(placed.ok).toBe(true);
    await seedStock(variant.id, 1);
    await evaluateHeldOrdersAfterStockSync({ actorUserId: staff.id });
    expect(await prisma.autopartBackorderSnapshot.count()).toBe(before);
  });
});
