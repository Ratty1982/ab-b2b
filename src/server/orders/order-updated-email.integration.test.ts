import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { bootstrapRbac } from "../../../prisma/bootstrap/rbac";
import { setEmailAdapterForTests } from "@/infra/email";
import { saveProduct } from "@/server/catalogue/service";
import { retryTransactionalEmail } from "@/server/email/transactional";
import {
  openSalesOrderDraft,
  placeSalesOrder,
  saveSalesOrderDraft,
  startSalesOrderEdit,
} from "@/server/orders/sales-order-entry";

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

async function ensureRep(email: string, code: string) {
  const user = await ensureUser(email, ["SALES_REPRESENTATIVE"]);
  const existing = await prisma.salesRep.findUnique({ where: { userId: user.id } });
  if (existing) return user;
  await prisma.salesRep.create({ data: { userId: user.id, code, active: true } });
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
}

async function seedVariant(sku: string, trade: number, avail: number) {
  const product = await saveProduct(adminId, {
    sku,
    name: `Updated order ${sku}`,
    brand: "Power Maxed",
    category: "Braking",
    trade,
    rrp: trade * 2,
    packQty: 1,
    caseQty: 1,
    description: "order updated email",
    active: true,
  });
  const variant = await prisma.productVariant.findFirstOrThrow({ where: { productId: product.id } });
  await seedStock(variant.id, avail);
  return variant;
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

async function enableTransactionalEmail(enabled = true) {
  await prisma.emailSettings.upsert({
    where: { id: "singleton" },
    create: {
      id: "singleton",
      enabled,
      fromEmail: "from@example.invalid",
      smtpHost: "smtp.example.invalid",
      smtpUsername: "u",
      smtpPasswordEncrypted: "v1:dGVzdA==:dGVzdA==:dGVzdA==",
      orderNotificationRecipients: [],
    },
    update: { enabled, orderNotificationRecipients: [] },
  });
}

function okAdapter() {
  setEmailAdapterForTests({
    name: "order-updated-ok",
    async send() {
      return { ok: true, id: "msg-ok" };
    },
  });
}

function failAdapter() {
  setEmailAdapterForTests({
    name: "order-updated-fail",
    async send() {
      return { ok: false, detail: "simulated provider failure" };
    },
  });
}

beforeAll(async () => {
  await bootstrapRbac(prisma);
  adminId = (await ensureUser("order-updated-email.admin@example.invalid", ["SUPER_ADMIN"])).id;
});

afterEach(() => {
  setEmailAdapterForTests(null);
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("order updated customer confirmation", () => {
  it("emails the latest contact with revised quantities, prices and totals", async () => {
    await enableTransactionalEmail();
    okAdapter();
    const stamp = Date.now();
    const variant = await seedVariant(`UPD-REV-${stamp}`, 5, 20);
    const { company, address, contact } = await seedCompany(`Updated Email ${stamp}`);
    const replacement = await prisma.contact.create({
      data: {
        companyId: company.id,
        firstName: "Sam",
        lastName: "Revised",
        email: `revised-${stamp}@example.invalid`,
        phone: "01130002222",
        isPrimary: false,
      },
    });
    const rep = await ensureRep(`upd-rev-${stamp}@example.invalid`, `UR${stamp}`.slice(0, 12));
    const draft = await openSalesOrderDraft(rep.id, { companyId: company.id, fresh: true });
    const saved = await saveSalesOrderDraft(rep.id, {
      draftId: draft.draft.id,
      contactId: contact.id,
      addressId: address.id,
      source: "TELEPHONE",
      lines: [{ variantId: variant.id, qty: 2, unitPriceOverride: "5.00" }],
    });
    const placed = await placeSalesOrder(rep.id, {
      draftId: draft.draft.id,
      confirmAuthorised: true,
      idempotencyKey: `upd-place-${stamp}`,
      source: "TELEPHONE",
      contactId: contact.id,
      addressId: address.id,
      poNumber: "PO-ORIG",
      lines: [{ variantId: variant.id, qty: 2, unitPriceOverride: "5.00" }],
      expectedReview: expectedFrom(saved.review!),
    });
    expect(placed.ok).toBe(true);
    if (!placed.ok) return;

    const receivedBefore = await prisma.transactionalEmail.findUniqueOrThrow({
      where: { idempotencyKey: `ORDER_RECEIVED:${placed.order.id}` },
    });
    expect(receivedBefore.toEmail).toBe(contact.email);
    expect(receivedBefore.purpose).toBe("ORDER_RECEIVED");

    const editing = await startSalesOrderEdit(rep.id, { orderId: placed.order.id });
    const changed = await saveSalesOrderDraft(rep.id, {
      draftId: editing.draft.id,
      contactId: replacement.id,
      addressId: address.id,
      source: "TELEPHONE",
      poNumber: "PO-EDIT",
      lines: [{ variantId: variant.id, qty: 5, unitPriceOverride: "6.50" }],
    });
    const updated = await placeSalesOrder(rep.id, {
      draftId: editing.draft.id,
      confirmAuthorised: true,
      idempotencyKey: `upd-edit-${stamp}`,
      source: "TELEPHONE",
      contactId: replacement.id,
      addressId: address.id,
      poNumber: "PO-EDIT",
      lines: [{ variantId: variant.id, qty: 5, unitPriceOverride: "6.50" }],
      expectedReview: expectedFrom(changed.review!),
    });
    expect(updated.ok).toBe(true);
    if (!updated.ok) return;
    expect(updated.email?.status).toBe("sent");
    expect(updated.order.items[0]?.qty).toBe(5);
    expect(updated.order.items[0]?.customerUnitPrice).toBe("6.50");

    const emails = await prisma.transactionalEmail.findMany({
      where: { entityId: placed.order.id, purpose: "ORDER_UPDATED" },
    });
    expect(emails).toHaveLength(1);
    const email = emails[0]!;
    expect(email.status).toBe("SENT");
    expect(email.toEmail).toBe(replacement.email);
    expect(email.idempotencyKey).toBe(`ORDER_UPDATED:${placed.order.id}:upd-edit-${stamp}`);
    expect(email.subject).toBe(`Your Automotive Brands Order ${placed.order.orderNumber} Has Been Updated`);
    expect(email.textBody).toContain("has been amended");
    expect(email.textBody).toContain(`Original order number: ${placed.order.orderNumber}`);
    expect(email.textBody).toContain("Your reference: PO-EDIT");
    expect(email.textBody).toContain("Qty: 5");
    expect(email.textBody).toContain("£6.50");
    expect(email.textBody).toContain(updated.order.subtotal);
    expect(email.textBody).toContain(updated.order.vatTotal);
    expect(email.textBody).toContain(updated.order.deliveryTotal === "0.00" ? "FREE" : updated.order.deliveryTotal);
    expect(email.textBody).toContain(updated.order.grandTotal);
    expect(email.textBody).toContain("10 Industrial Way");
    expect(email.textBody).not.toContain("Qty: 2");
    expect(email.htmlBody).toContain(`/portal/orders/${placed.order.id}`);
    expect(email.htmlBody).toContain("View your order");

    const receivedAfter = await prisma.transactionalEmail.findUniqueOrThrow({
      where: { id: receivedBefore.id },
    });
    expect(receivedAfter.subject).toBe(receivedBefore.subject);
    expect(receivedAfter.textBody).toBe(receivedBefore.textBody);
    expect(receivedAfter.htmlBody).toBe(receivedBefore.htmlBody);
    expect(receivedAfter.toEmail).toBe(receivedBefore.toEmail);
    expect(receivedAfter.idempotencyKey).toBe(receivedBefore.idempotencyKey);
    expect(receivedAfter.status).toBe(receivedBefore.status);
    expect(
      await prisma.transactionalEmail.count({
        where: { entityId: placed.order.id, purpose: "ORDER_RECEIVED" },
      }),
    ).toBe(1);
  });

  it("shows customer collection and backordered items", async () => {
    await enableTransactionalEmail();
    okAdapter();
    const stamp = Date.now();
    const variant = await seedVariant(`UPD-BO-${stamp}`, 4, 3);
    const { company, address, contact } = await seedCompany(`Updated Collection ${stamp}`);
    const rep = await ensureRep(`upd-bo-${stamp}@example.invalid`, `UB${stamp}`.slice(0, 12));
    const draft = await openSalesOrderDraft(rep.id, { companyId: company.id, fresh: true });
    const saved = await saveSalesOrderDraft(rep.id, {
      draftId: draft.draft.id,
      contactId: contact.id,
      addressId: address.id,
      source: "EMAIL",
      lines: [{ variantId: variant.id, qty: 1, unitPriceOverride: "4.00" }],
    });
    const placed = await placeSalesOrder(rep.id, {
      draftId: draft.draft.id,
      confirmAuthorised: true,
      idempotencyKey: `upd-bo-place-${stamp}`,
      source: "EMAIL",
      contactId: contact.id,
      addressId: address.id,
      lines: [{ variantId: variant.id, qty: 1, unitPriceOverride: "4.00" }],
      expectedReview: expectedFrom(saved.review!),
    });
    expect(placed.ok).toBe(true);
    if (!placed.ok) return;

    const editing = await startSalesOrderEdit(rep.id, { orderId: placed.order.id });
    const changed = await saveSalesOrderDraft(rep.id, {
      draftId: editing.draft.id,
      contactId: contact.id,
      fulfilmentChoice: "COLLECTION",
      source: "EMAIL",
      poNumber: "PO-COLLECT",
      lines: [{ variantId: variant.id, qty: 5, unitPriceOverride: "4.00" }],
    });
    expect(changed.review?.lines[0]?.backorderQtyAtOrder).toBeGreaterThan(0);
    const updated = await placeSalesOrder(rep.id, {
      draftId: editing.draft.id,
      confirmAuthorised: true,
      idempotencyKey: `upd-bo-edit-${stamp}`,
      source: "EMAIL",
      fulfilmentChoice: "COLLECTION",
      contactId: contact.id,
      poNumber: "PO-COLLECT",
      backorderAcknowledged: true,
      lines: [{ variantId: variant.id, qty: 5, unitPriceOverride: "4.00" }],
      expectedReview: expectedFrom(changed.review!),
    });
    expect(updated.ok).toBe(true);
    if (!updated.ok) return;
    expect(updated.order.fulfilmentChoice).toBe("COLLECTION");
    expect(updated.email?.status).toBe("sent");

    const email = await prisma.transactionalEmail.findUniqueOrThrow({
      where: { idempotencyKey: `ORDER_UPDATED:${placed.order.id}:upd-bo-edit-${stamp}` },
    });
    expect(email.textBody).toContain("CUSTOMER COLLECTION");
    expect(email.textBody).toContain("Customer Collection");
    expect(email.textBody).toContain("Delivery: £0.00");
    expect(email.textBody).not.toContain("10 Industrial Way");
    expect(email.textBody).toContain("Your reference: PO-COLLECT");
    expect(email.textBody).toMatch(/on backorder/);
    expect(email.textBody).toMatch(/SOME ITEMS ARE ON BACKORDER/);
    expect(email.htmlBody).toContain("currently on backorder");
  });

  it("does not duplicate an edit retry and sends a distinct email for the next amendment", async () => {
    await enableTransactionalEmail();
    okAdapter();
    const stamp = Date.now();
    const variant = await seedVariant(`UPD-IDEM-${stamp}`, 3, 30);
    const { company, address, contact } = await seedCompany(`Updated Idem ${stamp}`);
    const rep = await ensureRep(`upd-idem-${stamp}@example.invalid`, `UI${stamp}`.slice(0, 12));
    const draft = await openSalesOrderDraft(rep.id, { companyId: company.id, fresh: true });
    const saved = await saveSalesOrderDraft(rep.id, {
      draftId: draft.draft.id,
      contactId: contact.id,
      addressId: address.id,
      source: "CUSTOMER_VISIT",
      lines: [{ variantId: variant.id, qty: 2, unitPriceOverride: "3.00" }],
    });
    const placed = await placeSalesOrder(rep.id, {
      draftId: draft.draft.id,
      confirmAuthorised: true,
      idempotencyKey: `upd-idem-place-${stamp}`,
      source: "CUSTOMER_VISIT",
      contactId: contact.id,
      addressId: address.id,
      lines: [{ variantId: variant.id, qty: 2, unitPriceOverride: "3.00" }],
      expectedReview: expectedFrom(saved.review!),
    });
    expect(placed.ok).toBe(true);
    if (!placed.ok) return;

    const editing = await startSalesOrderEdit(rep.id, { orderId: placed.order.id });
    const changed = await saveSalesOrderDraft(rep.id, {
      draftId: editing.draft.id,
      contactId: contact.id,
      addressId: address.id,
      lines: [{ variantId: variant.id, qty: 4, unitPriceOverride: "3.00" }],
    });
    const editKey = `upd-idem-edit-${stamp}`;
    const first = await placeSalesOrder(rep.id, {
      draftId: editing.draft.id,
      confirmAuthorised: true,
      idempotencyKey: editKey,
      source: "CUSTOMER_VISIT",
      contactId: contact.id,
      addressId: address.id,
      lines: [{ variantId: variant.id, qty: 4, unitPriceOverride: "3.00" }],
      expectedReview: expectedFrom(changed.review!),
    });
    expect(first.ok && first.email?.status).toBe("sent");
    const again = await placeSalesOrder(rep.id, {
      draftId: editing.draft.id,
      confirmAuthorised: true,
      idempotencyKey: editKey,
      source: "CUSTOMER_VISIT",
      contactId: contact.id,
      addressId: address.id,
      lines: [{ variantId: variant.id, qty: 4, unitPriceOverride: "3.00" }],
      expectedReview: expectedFrom(changed.review!),
    });
    expect(again.ok && again.alreadyPlaced).toBe(true);
    if (!again.ok) return;
    expect(again.email?.emailId).toBe(first.ok ? first.email?.emailId : undefined);
    expect(
      await prisma.transactionalEmail.count({
        where: { entityId: placed.order.id, purpose: "ORDER_UPDATED" },
      }),
    ).toBe(1);

    const next = await startSalesOrderEdit(rep.id, { orderId: placed.order.id });
    const revised = await saveSalesOrderDraft(rep.id, {
      draftId: next.draft.id,
      contactId: contact.id,
      addressId: address.id,
      lines: [{ variantId: variant.id, qty: 7, unitPriceOverride: "3.00" }],
    });
    const second = await placeSalesOrder(rep.id, {
      draftId: next.draft.id,
      confirmAuthorised: true,
      idempotencyKey: `upd-idem-next-${stamp}`,
      source: "CUSTOMER_VISIT",
      contactId: contact.id,
      addressId: address.id,
      lines: [{ variantId: variant.id, qty: 7, unitPriceOverride: "3.00" }],
      expectedReview: expectedFrom(revised.review!),
    });
    expect(second.ok && second.email?.status).toBe("sent");
    const rows = await prisma.transactionalEmail.findMany({
      where: { entityId: placed.order.id, purpose: "ORDER_UPDATED" },
      orderBy: { createdAt: "asc" },
    });
    expect(rows).toHaveLength(2);
    expect(rows[0]!.idempotencyKey).not.toBe(rows[1]!.idempotencyKey);
    expect(rows[0]!.textBody).toContain("Qty: 4");
    expect(rows[0]!.textBody).not.toContain("Qty: 7");
    expect(rows[1]!.textBody).toContain("Qty: 7");
  });

  it("keeps a failed amendment email retryable without reversing the order or the original confirmation", async () => {
    await enableTransactionalEmail();
    okAdapter();
    const stamp = Date.now();
    const variant = await seedVariant(`UPD-FAIL-${stamp}`, 2, 40);
    const { company, address, contact } = await seedCompany(`Updated Fail ${stamp}`);
    const rep = await ensureRep(`upd-fail-${stamp}@example.invalid`, `UF${stamp}`.slice(0, 12));
    const draft = await openSalesOrderDraft(rep.id, { companyId: company.id, fresh: true });
    const saved = await saveSalesOrderDraft(rep.id, {
      draftId: draft.draft.id,
      contactId: contact.id,
      addressId: address.id,
      lines: [{ variantId: variant.id, qty: 2, unitPriceOverride: "2.00" }],
    });
    const placed = await placeSalesOrder(rep.id, {
      draftId: draft.draft.id,
      confirmAuthorised: true,
      idempotencyKey: `upd-fail-place-${stamp}`,
      source: "TELEPHONE",
      contactId: contact.id,
      addressId: address.id,
      lines: [{ variantId: variant.id, qty: 2, unitPriceOverride: "2.00" }],
      expectedReview: expectedFrom(saved.review!),
    });
    expect(placed.ok).toBe(true);
    if (!placed.ok) return;
    const receivedBefore = await prisma.transactionalEmail.findUniqueOrThrow({
      where: { idempotencyKey: `ORDER_RECEIVED:${placed.order.id}` },
    });

    failAdapter();
    const editing = await startSalesOrderEdit(rep.id, { orderId: placed.order.id });
    const changed = await saveSalesOrderDraft(rep.id, {
      draftId: editing.draft.id,
      contactId: contact.id,
      addressId: address.id,
      lines: [{ variantId: variant.id, qty: 5, unitPriceOverride: "2.50" }],
    });
    const updated = await placeSalesOrder(rep.id, {
      draftId: editing.draft.id,
      confirmAuthorised: true,
      idempotencyKey: `upd-fail-edit-${stamp}`,
      source: "TELEPHONE",
      contactId: contact.id,
      addressId: address.id,
      lines: [{ variantId: variant.id, qty: 5, unitPriceOverride: "2.50" }],
      expectedReview: expectedFrom(changed.review!),
    });
    expect(updated.ok).toBe(true);
    if (!updated.ok) return;
    expect(updated.email?.status).toBe("failed");
    expect(updated.order.items[0]?.qty).toBe(5);
    const stored = await prisma.order.findUniqueOrThrow({
      where: { id: placed.order.id },
      include: { items: true },
    });
    expect(stored.items[0]?.qty).toBe(5);
    expect(stored.items[0]?.customerUnitPrice.toString()).toContain("2.5");

    const failed = await prisma.transactionalEmail.findUniqueOrThrow({
      where: { idempotencyKey: `ORDER_UPDATED:${placed.order.id}:upd-fail-edit-${stamp}` },
    });
    expect(failed.status).toBe("FAILED");
    expect(failed.lastError).toContain("simulated provider failure");
    expect(failed.textBody).toContain("Qty: 5");
    expect(failed.textBody).toContain("£2.50");
    const failedSnapshot = failed.textBody;

    const receivedAfterFail = await prisma.transactionalEmail.findUniqueOrThrow({
      where: { id: receivedBefore.id },
    });
    expect(receivedAfterFail.textBody).toBe(receivedBefore.textBody);
    expect(receivedAfterFail.subject).toBe(receivedBefore.subject);
    expect(receivedAfterFail.idempotencyKey).toBe(`ORDER_RECEIVED:${placed.order.id}`);

    okAdapter();
    const later = await startSalesOrderEdit(rep.id, { orderId: placed.order.id });
    const laterSaved = await saveSalesOrderDraft(rep.id, {
      draftId: later.draft.id,
      contactId: contact.id,
      addressId: address.id,
      lines: [{ variantId: variant.id, qty: 9, unitPriceOverride: "2.50" }],
    });
    const laterPlaced = await placeSalesOrder(rep.id, {
      draftId: later.draft.id,
      confirmAuthorised: true,
      idempotencyKey: `upd-fail-later-${stamp}`,
      source: "TELEPHONE",
      contactId: contact.id,
      addressId: address.id,
      lines: [{ variantId: variant.id, qty: 9, unitPriceOverride: "2.50" }],
      expectedReview: expectedFrom(laterSaved.review!),
    });
    expect(laterPlaced.ok && laterPlaced.email?.status).toBe("sent");

    const stillFailed = await prisma.transactionalEmail.findUniqueOrThrow({ where: { id: failed.id } });
    expect(stillFailed.status).toBe("FAILED");
    expect(stillFailed.textBody).toBe(failedSnapshot);
    expect(stillFailed.textBody).not.toContain("Qty: 9");

    const retried = await retryTransactionalEmail(adminId, failed.id);
    expect(retried.status).toBe("SENT");
    const afterRetry = await prisma.transactionalEmail.findUniqueOrThrow({ where: { id: failed.id } });
    expect(afterRetry.textBody).toBe(failedSnapshot);
    expect(afterRetry.textBody).toContain("Qty: 5");
    expect(afterRetry.textBody).not.toContain("Qty: 9");
    expect(afterRetry.toEmail).toBe(contact.email);

    const receivedAfterRetry = await prisma.transactionalEmail.findUniqueOrThrow({
      where: { id: receivedBefore.id },
    });
    expect(receivedAfterRetry.textBody).toBe(receivedBefore.textBody);
    expect(receivedAfterRetry.htmlBody).toBe(receivedBefore.htmlBody);
    expect(
      await prisma.transactionalEmail.count({
        where: { entityId: placed.order.id, purpose: "ORDER_UPDATED" },
      }),
    ).toBe(2);
  });

  it("leaves the order saved and the email pending when delivery is disabled", async () => {
    await enableTransactionalEmail();
    okAdapter();
    const stamp = Date.now();
    const variant = await seedVariant(`UPD-PEND-${stamp}`, 3, 12);
    const { company, address, contact } = await seedCompany(`Updated Pending ${stamp}`);
    const rep = await ensureRep(`upd-pend-${stamp}@example.invalid`, `UP${stamp}`.slice(0, 12));
    const draft = await openSalesOrderDraft(rep.id, { companyId: company.id, fresh: true });
    const saved = await saveSalesOrderDraft(rep.id, {
      draftId: draft.draft.id,
      contactId: contact.id,
      addressId: address.id,
      lines: [{ variantId: variant.id, qty: 1, unitPriceOverride: "3.00" }],
    });
    const placed = await placeSalesOrder(rep.id, {
      draftId: draft.draft.id,
      confirmAuthorised: true,
      idempotencyKey: `upd-pend-place-${stamp}`,
      source: "TELEPHONE",
      contactId: contact.id,
      addressId: address.id,
      lines: [{ variantId: variant.id, qty: 1, unitPriceOverride: "3.00" }],
      expectedReview: expectedFrom(saved.review!),
    });
    expect(placed.ok).toBe(true);
    if (!placed.ok) return;

    await enableTransactionalEmail(false);
    const editing = await startSalesOrderEdit(rep.id, { orderId: placed.order.id });
    const changed = await saveSalesOrderDraft(rep.id, {
      draftId: editing.draft.id,
      contactId: contact.id,
      addressId: address.id,
      lines: [{ variantId: variant.id, qty: 3, unitPriceOverride: "3.00" }],
    });
    const updated = await placeSalesOrder(rep.id, {
      draftId: editing.draft.id,
      confirmAuthorised: true,
      idempotencyKey: `upd-pend-edit-${stamp}`,
      source: "TELEPHONE",
      contactId: contact.id,
      addressId: address.id,
      lines: [{ variantId: variant.id, qty: 3, unitPriceOverride: "3.00" }],
      expectedReview: expectedFrom(changed.review!),
    });
    expect(updated.ok).toBe(true);
    if (!updated.ok) return;
    expect(updated.email?.status).toBe("pending");
    expect(updated.order.items[0]?.qty).toBe(3);
    const email = await prisma.transactionalEmail.findUniqueOrThrow({
      where: { idempotencyKey: `ORDER_UPDATED:${placed.order.id}:upd-pend-edit-${stamp}` },
    });
    expect(email.status).toBe("DEFERRED");
    expect(email.textBody).toContain("Qty: 3");

    await enableTransactionalEmail(true);
    okAdapter();
    const retried = await retryTransactionalEmail(adminId, email.id);
    expect(retried.status).toBe("SENT");
    const afterRetry = await prisma.transactionalEmail.findUniqueOrThrow({ where: { id: email.id } });
    expect(afterRetry.textBody).toContain("Qty: 3");
  });

  it("does not email for draft saves, price refresh, or an internal note only", async () => {
    await enableTransactionalEmail();
    okAdapter();
    const stamp = Date.now();
    const variant = await seedVariant(`UPD-NOTE-${stamp}`, 4, 15);
    const { company, address, contact } = await seedCompany(`Updated Note ${stamp}`);
    const rep = await ensureRep(`upd-note-${stamp}@example.invalid`, `UN${stamp}`.slice(0, 12));
    const draft = await openSalesOrderDraft(rep.id, { companyId: company.id, fresh: true });
    const saved = await saveSalesOrderDraft(rep.id, {
      draftId: draft.draft.id,
      contactId: contact.id,
      addressId: address.id,
      lines: [{ variantId: variant.id, qty: 2, unitPriceOverride: "4.00" }],
    });
    const placed = await placeSalesOrder(rep.id, {
      draftId: draft.draft.id,
      confirmAuthorised: true,
      idempotencyKey: `upd-note-place-${stamp}`,
      source: "EMAIL",
      contactId: contact.id,
      addressId: address.id,
      lines: [{ variantId: variant.id, qty: 2, unitPriceOverride: "4.00" }],
      expectedReview: expectedFrom(saved.review!),
    });
    expect(placed.ok).toBe(true);
    if (!placed.ok) return;

    const editing = await startSalesOrderEdit(rep.id, { orderId: placed.order.id });
    await saveSalesOrderDraft(rep.id, {
      draftId: editing.draft.id,
      contactId: contact.id,
      addressId: address.id,
      lines: [{ variantId: variant.id, qty: 6, unitPriceOverride: "4.00" }],
    });
    await prisma.productVariant.update({ where: { id: variant.id }, data: { tradePrice: 9.99 } });
    await saveSalesOrderDraft(rep.id, {
      draftId: editing.draft.id,
      contactId: contact.id,
      addressId: address.id,
      lines: [{ variantId: variant.id, qty: 6, unitPriceOverride: "4.00" }],
    });
    expect(
      await prisma.transactionalEmail.count({
        where: { entityId: placed.order.id, purpose: "ORDER_UPDATED" },
      }),
    ).toBe(0);
    const untouched = await prisma.orderItem.findFirstOrThrow({ where: { orderId: placed.order.id } });
    expect(untouched.qty).toBe(2);

    const noted = await saveSalesOrderDraft(rep.id, {
      draftId: editing.draft.id,
      contactId: contact.id,
      addressId: address.id,
      internalNote: "Warehouse only — do not copy to the customer",
      lines: [{ variantId: variant.id, qty: 2, unitPriceOverride: "4.00" }],
    });
    const updated = await placeSalesOrder(rep.id, {
      draftId: editing.draft.id,
      confirmAuthorised: true,
      idempotencyKey: `upd-note-edit-${stamp}`,
      source: "EMAIL",
      contactId: contact.id,
      addressId: address.id,
      internalNote: "Warehouse only — do not copy to the customer",
      lines: [{ variantId: variant.id, qty: 2, unitPriceOverride: "4.00" }],
      expectedReview: expectedFrom(noted.review!),
    });
    expect(updated.ok).toBe(true);
    if (!updated.ok) return;
    expect(updated.email?.status).toBe("skipped");
    const row = await prisma.order.findUniqueOrThrow({ where: { id: placed.order.id } });
    expect(row.notes).toContain("Warehouse only");
    expect(
      await prisma.transactionalEmail.count({
        where: { entityId: placed.order.id, purpose: "ORDER_UPDATED" },
      }),
    ).toBe(0);
  });
});
