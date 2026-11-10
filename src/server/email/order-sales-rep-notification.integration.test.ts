/**
 * Assigned sales-rep inclusion in ORDER_RECEIVED_INTERNAL after order commit.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { bootstrapRbac } from "../../../prisma/bootstrap/rbac";
import { saveProduct } from "@/server/catalogue/service";
import { addToBasket } from "@/server/basket/service";
import { placeOrder } from "@/server/orders/service";
import { setEmailAdapterForTests } from "@/infra/email";
import { retryTransactionalEmail, sendOrderEmailsAfterCommit } from "@/server/email/transactional";

const prisma = new PrismaClient();
const stamp = Date.now();
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

async function ensureRep(
  email: string,
  code: string,
  opts?: { active?: boolean; businessEmail?: string },
) {
  const user = await ensureUser(email, ["SALES_REPRESENTATIVE"], "INTERNAL");
  let rep = await prisma.salesRep.findUnique({ where: { userId: user.id } });
  if (!rep) {
    rep = await prisma.salesRep.create({
      data: {
        userId: user.id,
        code,
        active: opts?.active ?? true,
        businessEmail: opts?.businessEmail ?? email,
      },
    });
  } else {
    rep = await prisma.salesRep.update({
      where: { id: rep.id },
      data: {
        active: opts?.active ?? true,
        businessEmail: opts?.businessEmail ?? email,
      },
    });
  }
  return { user, rep };
}

async function ensureTradeBuyer(email: string, companyId: string) {
  const user = await ensureUser(email, [], "TRADE");
  await prisma.companyUser.upsert({
    where: { companyId_userId: { companyId, userId: user.id } },
    create: {
      companyId,
      userId: user.id,
      role: "TRADE_BUYER",
      status: "ACTIVE",
      isDefault: true,
    },
    update: { role: "TRADE_BUYER", status: "ACTIVE", isDefault: true },
  });
  return user.id;
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
      status: "IN_STOCK",
      externalSyncedAt: new Date(),
      sourceAvailRaw: String(avail),
    },
    update: {
      qtyOnHand: avail,
      qtyReserved: 0,
      status: "IN_STOCK",
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

async function seedVariant(sku: string, trade: number, avail: number) {
  const product = await saveProduct(adminId, {
    sku,
    name: `Order notify ${sku}`,
    brand: "Power Maxed",
    category: "Braking",
    trade,
    rrp: trade * 2,
    packQty: 1,
    caseQty: 1,
    description: "order sales rep notification",
    active: true,
  });
  const variant = await prisma.productVariant.findFirstOrThrow({
    where: { productId: product.id },
  });
  await seedStock(variant.id, avail);
  return variant;
}

async function seedCompany(name: string) {
  const company = await prisma.company.create({
    data: {
      name,
      status: "ACTIVE",
      paymentTerms: "Net 30",
      primaryEmail: `buyer.${stamp}@example.invalid`,
    },
  });
  const address = await prisma.address.create({
    data: {
      companyId: company.id,
      type: "DELIVERY",
      label: "Main",
      line1: "1 Trade Way",
      town: "Leeds",
      postcode: "LS1 1AA",
      country: "GB",
      isDefaultDelivery: true,
    },
  });
  const contact = await prisma.contact.create({
    data: {
      companyId: company.id,
      firstName: "Alex",
      lastName: "Buyer",
      email: `contact.${name.replace(/\s+/g, ".").toLowerCase()}@example.invalid`,
      phone: "0113 000000",
      isPrimary: true,
    },
  });
  return { company, address, contact };
}

async function enableTransactionalEmail(recipients: string[]) {
  await prisma.emailSettings.upsert({
    where: { id: "singleton" },
    create: {
      id: "singleton",
      enabled: true,
      fromEmail: "from@example.invalid",
      smtpHost: "smtp.example.invalid",
      smtpUsername: "u",
      smtpPasswordEncrypted: "v1:dGVzdA==:dGVzdA==:dGVzdA==",
      orderNotificationRecipients: recipients,
    },
    update: {
      enabled: true,
      orderNotificationRecipients: recipients,
    },
  });
}

beforeAll(async () => {
  await bootstrapRbac(prisma);
  adminId = (await ensureUser(`osrn.admin.${stamp}@example.invalid`, ["SUPER_ADMIN"])).id;
});

afterEach(() => {
  setEmailAdapterForTests(null);
  delete process.env["TRADE_ORDER_NOTIFICATION_EMAIL"];
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("order sales rep notification", () => {
  it("customer checkout emails the primary assigned rep and dedupes configured recipients", async () => {
    await enableTransactionalEmail(["Ops@Example.invalid", "desk@example.invalid"]);
    setEmailAdapterForTests({
      name: "test-ok",
      async send() {
        return { ok: true, id: "msg-ok" };
      },
    });

    const { user: rep, rep: salesRep } = await ensureRep(
      `osrn.rep.${stamp}@example.invalid`,
      `OR${String(stamp).slice(-4)}`,
      { businessEmail: `Rep.${stamp}@Example.invalid` },
    );
    const { user: otherRep, rep: otherSalesRep } = await ensureRep(
      `osrn.other.${stamp}@example.invalid`,
      `OT${String(stamp).slice(-4)}`,
    );
    const variant = await seedVariant(`OSRN-C-${stamp}`, 5, 40);
    const { company, address } = await seedCompany(`OSRN Customer ${stamp}`);
    await prisma.companyAssignment.create({
      data: { companyId: company.id, salesRepId: salesRep.id, isPrimary: true },
    });
    // Unrelated rep must never receive confidential order detail.
    await prisma.companyAssignment.create({
      data: {
        companyId: (await seedCompany(`OSRN Other Co ${stamp}`)).company.id,
        salesRepId: otherSalesRep.id,
        isPrimary: true,
      },
    });

    const buyerId = await ensureTradeBuyer(`osrn.buyer.${stamp}@example.invalid`, company.id);
    await addToBasket(buyerId, { variantId: variant.id, quantity: 2 });
    const placed = await placeOrder(buyerId, {
      idempotencyKey: `osrn-cust-${stamp}`,
      addressId: address.id,
      expectedLinePrices: [{ variantId: variant.id, customerUnitPrice: "5.00" }],
    });
    expect(placed.ok).toBe(true);
    if (!placed.ok) return;

    const customer = await prisma.transactionalEmail.findMany({
      where: { entityId: placed.order.id, purpose: "ORDER_RECEIVED" },
    });
    expect(customer).toHaveLength(1);

    const internal = await prisma.transactionalEmail.findMany({
      where: { entityId: placed.order.id, purpose: "ORDER_RECEIVED_INTERNAL" },
      orderBy: { toEmail: "asc" },
    });
    const toEmails = internal.map((row) => row.toEmail);
    expect(toEmails).toEqual([
      "desk@example.invalid",
      "ops@example.invalid",
      `rep.${stamp}@example.invalid`,
    ]);
    expect(toEmails).not.toContain(otherRep.email.toLowerCase());
    expect(new Set(toEmails).size).toBe(toEmails.length);

    const repMail = internal.find((row) => row.toEmail === `rep.${stamp}@example.invalid`);
    expect(repMail?.subject).toContain("New Customer Order");
    expect(repMail?.subject).toContain(placed.order.orderNumber);
    expect(repMail?.textBody).toContain("RECEIVED / SUBMITTED");
    expect(repMail?.textBody).toContain("Customer (B2B portal)");
    expect(repMail?.idempotencyKey).toBe(
      `ORDER_RECEIVED_INTERNAL:${placed.order.id}:rep.${stamp}@example.invalid`,
    );

    await sendOrderEmailsAfterCommit(placed.order.id);
    expect(
      await prisma.transactionalEmail.count({
        where: { entityId: placed.order.id, purpose: "ORDER_RECEIVED_INTERNAL" },
      }),
    ).toBe(3);

    // Reassignment must not redirect retries of the original order notification.
    await prisma.companyAssignment.deleteMany({ where: { companyId: company.id } });
    await prisma.companyAssignment.create({
      data: { companyId: company.id, salesRepId: otherSalesRep.id, isPrimary: true },
    });
    await sendOrderEmailsAfterCommit(placed.order.id);
    const afterReassign = await prisma.transactionalEmail.findMany({
      where: { entityId: placed.order.id, purpose: "ORDER_RECEIVED_INTERNAL" },
    });
    expect(afterReassign.map((r) => r.toEmail).sort()).toEqual(toEmails);
    expect(afterReassign.some((r) => r.toEmail === otherRep.email.toLowerCase())).toBe(false);
  });

  it("staff-created orders notify the assigned rep, not the placer substitute", async () => {
    await enableTransactionalEmail(["ops@example.invalid"]);
    setEmailAdapterForTests({
      name: "test-ok",
      async send() {
        return { ok: true, id: "staff-ok" };
      },
    });

    const { user: owner, rep: ownerRep } = await ensureRep(
      `osrn.owner.${stamp}@example.invalid`,
      `OW${String(stamp).slice(-4)}`,
    );
    const { user: taker } = await ensureRep(
      `osrn.taker.${stamp}@example.invalid`,
      `TK${String(stamp).slice(-4)}`,
    );

    const { company } = await seedCompany(`OSRN Staff ${stamp}`);
    const order = await prisma.order.create({
      data: {
        orderNumber: `AB-STAFF-${stamp}`,
        companyId: company.id,
        status: "SUBMITTED",
        currency: "GBP",
        subtotal: 8,
        vatTotal: 1.6,
        deliveryTotal: 0,
        grandTotal: 9.6,
        placedAt: new Date(),
        entrySource: "TELEPHONE",
        placedByStaffUserId: taker.id,
        placedByStaffName: taker.name,
        salesRepIdSnapshot: ownerRep.id,
        salesRepCodeSnapshot: ownerRep.code,
        salesRepNameSnapshot: owner.name,
        contactSnapshot: {
          name: "Alex Buyer",
          email: `staff.buyer.${stamp}@example.invalid`,
          phone: null,
        },
        deliveryAddress: {
          line1: "1 Trade Way",
          town: "Leeds",
          postcode: "LS1 1AA",
          country: "GB",
        },
        paymentTermsSnapshot: "Net 30",
        autopartCustomerCodeSnapshot: "STAFF01",
        autopartAccountLinked: true,
      },
    });
    await prisma.orderItem.create({
      data: {
        orderId: order.id,
        sku: "SKU-STAFF",
        name: "Staff Widget",
        qty: 1,
        unitPrice: 8,
        customerUnitPrice: 8,
        vatRate: 20,
        lineTotal: 8,
        lineVat: 1.6,
        lineGross: 9.6,
      },
    });

    await sendOrderEmailsAfterCommit(order.id);

    const internal = await prisma.transactionalEmail.findMany({
      where: { entityId: order.id, purpose: "ORDER_RECEIVED_INTERNAL" },
    });
    const emails = internal.map((r) => r.toEmail).sort();
    expect(emails).toEqual([owner.email.toLowerCase(), "ops@example.invalid"].sort());
    expect(emails).not.toContain(taker.email.toLowerCase());

    const ownerMail = internal.find((r) => r.toEmail === owner.email.toLowerCase());
    expect(ownerMail?.textBody).toContain("Internal staff");
    expect(ownerMail?.textBody).toContain(order.orderNumber);
    expect(ownerMail?.textBody).not.toMatch(/despatched successfully/i);
  });

  it("skips inactive assigned reps and records the skip reason once", async () => {
    await enableTransactionalEmail(["ops@example.invalid"]);
    setEmailAdapterForTests({
      name: "test-ok",
      async send() {
        return { ok: true, id: "inactive-ok" };
      },
    });

    const { rep: inactiveRep } = await ensureRep(
      `osrn.inactive.${stamp}@example.invalid`,
      `IN${String(stamp).slice(-4)}`,
      { active: false },
    );
    const { company } = await seedCompany(`OSRN Inactive ${stamp}`);
    const order = await prisma.order.create({
      data: {
        orderNumber: `AB-INACT-${stamp}`,
        companyId: company.id,
        status: "SUBMITTED",
        currency: "GBP",
        subtotal: 10,
        vatTotal: 2,
        deliveryTotal: 0,
        grandTotal: 12,
        placedAt: new Date(),
        contactSnapshot: {
          name: "Buyer",
          email: `inactive.buyer.${stamp}@example.invalid`,
          phone: null,
        },
        deliveryAddress: {
          line1: "1 High St",
          town: "Leeds",
          postcode: "LS1 1AA",
          country: "GB",
        },
        paymentTermsSnapshot: "Net 30",
        salesRepIdSnapshot: inactiveRep.id,
        salesRepCodeSnapshot: inactiveRep.code,
        salesRepNameSnapshot: "Inactive Rep",
      },
    });
    await prisma.orderItem.create({
      data: {
        orderId: order.id,
        sku: "SKU-INACT",
        name: "Widget",
        qty: 1,
        unitPrice: 10,
        customerUnitPrice: 10,
        vatRate: 20,
        lineTotal: 10,
        lineVat: 2,
        lineGross: 12,
      },
    });

    await sendOrderEmailsAfterCommit(order.id);

    const internal = await prisma.transactionalEmail.findMany({
      where: { entityId: order.id, purpose: "ORDER_RECEIVED_INTERNAL" },
    });
    expect(internal.map((r) => r.toEmail)).toEqual(["ops@example.invalid"]);
    expect(internal.some((r) => r.toEmail.includes("inactive"))).toBe(false);

    const skips = await prisma.auditEvent.findMany({
      where: {
        action: "email.order_sales_rep_notification_skipped",
        entityId: order.id,
      },
    });
    expect(skips).toHaveLength(1);
    expect(skips[0]?.metadata).toMatchObject({ reason: "sales_rep_inactive" });

    await sendOrderEmailsAfterCommit(order.id);
    expect(
      await prisma.auditEvent.count({
        where: {
          action: "email.order_sales_rep_notification_skipped",
          entityId: order.id,
        },
      }),
    ).toBe(1);
  });

  it("unassigned customers skip rep email but keep configured recipients; drafts send nothing", async () => {
    await enableTransactionalEmail(["ops@example.invalid"]);
    setEmailAdapterForTests({
      name: "test-ok",
      async send() {
        return { ok: true, id: "unassigned-ok" };
      },
    });

    const variant = await seedVariant(`OSRN-U-${stamp}`, 3, 20);
    const { company, address } = await seedCompany(`OSRN Unassigned ${stamp}`);
    const buyerId = await ensureTradeBuyer(`osrn.unbuyer.${stamp}@example.invalid`, company.id);
    await addToBasket(buyerId, { variantId: variant.id, quantity: 1 });
    const placed = await placeOrder(buyerId, {
      idempotencyKey: `osrn-unassigned-${stamp}`,
      addressId: address.id,
      expectedLinePrices: [{ variantId: variant.id, customerUnitPrice: "3.00" }],
    });
    expect(placed.ok).toBe(true);
    if (!placed.ok) return;
    const unassignedOrder = await prisma.order.findUniqueOrThrow({
      where: { id: placed.order.id },
      select: { salesRepIdSnapshot: true },
    });
    expect(unassignedOrder.salesRepIdSnapshot).toBeNull();

    const internal = await prisma.transactionalEmail.findMany({
      where: { entityId: placed.order.id, purpose: "ORDER_RECEIVED_INTERNAL" },
    });
    expect(internal.map((r) => r.toEmail)).toEqual(["ops@example.invalid"]);
    expect(
      await prisma.auditEvent.count({
        where: {
          action: "email.order_sales_rep_notification_skipped",
          entityId: placed.order.id,
        },
      }),
    ).toBe(1);

    // Draft / uncommitted sales-order drafts never enter the after-commit email path.
    const draftCompany = await seedCompany(`OSRN Draft ${stamp}`);
    const { user: rep } = await ensureRep(
      `osrn.draftrep.${stamp}@example.invalid`,
      `DR${String(stamp).slice(-4)}`,
    );
    const draft = await prisma.salesOrderDraft.create({
      data: {
        companyId: draftCompany.company.id,
        createdByUserId: rep.id,
        status: "OPEN",
        source: "TELEPHONE",
      },
    });
    expect(
      await prisma.transactionalEmail.count({
        where: { entityId: draft.id },
      }),
    ).toBe(0);
    expect(
      await prisma.transactionalEmail.count({
        where: {
          purpose: { in: ["ORDER_RECEIVED", "ORDER_RECEIVED_INTERNAL"] },
          entityId: draft.id,
        },
      }),
    ).toBe(0);
  });

  it("failed send retries safely without duplicating or affecting the customer email", async () => {
    await enableTransactionalEmail(["ops@example.invalid"]);
    let failOnce = true;
    setEmailAdapterForTests({
      name: "test-fail-once",
      async send(message) {
        if (message.to.includes("rep.") && failOnce) {
          failOnce = false;
          return { ok: false, detail: "simulated rep failure" };
        }
        return { ok: true, id: "retry-ok" };
      },
    });

    const { rep: salesRep } = await ensureRep(
      `osrn.retryrep.${stamp}@example.invalid`,
      `RR${String(stamp).slice(-4)}`,
      { businessEmail: `rep.retry.${stamp}@example.invalid` },
    );
    const variant = await seedVariant(`OSRN-R-${stamp}`, 6, 20);
    const { company, address } = await seedCompany(`OSRN Retry ${stamp}`);
    await prisma.companyAssignment.create({
      data: { companyId: company.id, salesRepId: salesRep.id, isPrimary: true },
    });
    const buyerId = await ensureTradeBuyer(`osrn.retrybuyer.${stamp}@example.invalid`, company.id);
    await addToBasket(buyerId, { variantId: variant.id, quantity: 1 });
    const placed = await placeOrder(buyerId, {
      idempotencyKey: `osrn-retry-${stamp}`,
      addressId: address.id,
      expectedLinePrices: [{ variantId: variant.id, customerUnitPrice: "6.00" }],
    });
    expect(placed.ok).toBe(true);
    if (!placed.ok) return;

    const repMail = await prisma.transactionalEmail.findUniqueOrThrow({
      where: {
        idempotencyKey: `ORDER_RECEIVED_INTERNAL:${placed.order.id}:rep.retry.${stamp}@example.invalid`,
      },
    });
    expect(repMail.status).toBe("FAILED");

    const customer = await prisma.transactionalEmail.findUniqueOrThrow({
      where: { idempotencyKey: `ORDER_RECEIVED:${placed.order.id}` },
    });
    expect(customer.status).toBe("SENT");

    const retried = await retryTransactionalEmail(adminId, repMail.id);
    expect(retried.status).toBe("SENT");
    expect(
      await prisma.transactionalEmail.count({
        where: {
          entityId: placed.order.id,
          purpose: "ORDER_RECEIVED_INTERNAL",
          toEmail: `rep.retry.${stamp}@example.invalid`,
        },
      }),
    ).toBe(1);
    expect(
      await prisma.transactionalEmail.count({
        where: { entityId: placed.order.id, purpose: "ORDER_RECEIVED" },
      }),
    ).toBe(1);
  });
});
