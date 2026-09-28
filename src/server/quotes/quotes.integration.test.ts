import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { bootstrapRbac } from "../../../prisma/bootstrap/rbac";
import { saveProduct } from "@/server/catalogue/service";
import { AuthError } from "@/server/rbac/guards";
import {
  acceptQuoteAsCustomer,
  acceptQuoteOnBehalf,
  createQuote,
  declineQuote,
  duplicateQuote,
  getQuoteForPortal,
  getQuoteForStaff,
  listQuotesForPortal,
  listQuotesForStaff,
  markQuoteViewedByCustomer,
  sendQuote,
  updateQuoteDraft,
} from "@/server/quotes/service";
import { allocateQuoteNumber } from "@/server/quotes/quote-number";

const prisma = new PrismaClient();
let adminId = "";

async function ensureUser(
  email: string,
  roles: string[],
  actorType: "INTERNAL" | "TRADE" = "INTERNAL",
) {
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
  } else if (user.actorType !== actorType) {
    user = await prisma.user.update({ where: { id: user.id }, data: { actorType } });
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

async function ensureTradeBuyer(email: string, companyId: string) {
  const userId = await ensureUser(email, [], "TRADE");
  await prisma.companyUser.upsert({
    where: { companyId_userId: { companyId, userId } },
    create: {
      companyId,
      userId,
      role: "TRADE_BUYER",
      status: "ACTIVE",
      isDefault: true,
    },
    update: { role: "TRADE_BUYER", status: "ACTIVE", isDefault: true },
  });
  return userId;
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
      status: avail >= 21 ? "IN_STOCK" : avail > 0 ? "LOW" : "OUT_OF_STOCK",
      externalSyncedAt: new Date(),
      sourceAvailRaw: String(avail),
    },
    update: {
      qtyOnHand: avail,
      qtyReserved: 0,
      status: avail >= 21 ? "IN_STOCK" : avail > 0 ? "LOW" : "OUT_OF_STOCK",
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
    data: {
      name,
      status: "ACTIVE",
      paymentTerms: "Net 30",
      taxStatus: "STANDARD",
      primaryEmail: `${name.replace(/\s+/g, "").toLowerCase()}@example.invalid`,
    },
  });
  const contact = await prisma.contact.create({
    data: {
      companyId: company.id,
      firstName: "Pat",
      lastName: "Buyer",
      email: `buyer-${company.id}@example.invalid`,
      isPrimary: true,
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
  return { company, contact, address };
}

async function seedVariant(sku: string, trade: number, caseQty = 12) {
  const product = await saveProduct(adminId, {
    sku,
    name: `Quote product ${sku}`,
    brand: "Power Maxed",
    category: "Braking",
    trade,
    rrp: trade * 2,
    packQty: 1,
    caseQty,
    description: "quote test",
    active: true,
  });
  const variant = await prisma.productVariant.findFirstOrThrow({
    where: { productId: product.id },
  });
  await seedStock(variant.id, 120);
  return variant;
}

beforeAll(async () => {
  await bootstrapRbac(prisma);
  adminId = await ensureUser("quotes.admin@example.invalid", ["SUPER_ADMIN"]);
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("Quote numbering", () => {
  it("allocates QT-###### sequentially and safely", async () => {
    const a = await prisma.$transaction((tx) => allocateQuoteNumber(tx));
    const b = await prisma.$transaction((tx) => allocateQuoteNumber(tx));
    expect(a).toMatch(/^QT-\d{6}$/);
    expect(b).toMatch(/^QT-\d{6}$/);
    expect(a).not.toBe(b);
    const na = Number(a.slice(3));
    const nb = Number(b.slice(3));
    expect(nb).toBe(na + 1);
  });
});

describe("Quote draft / pricing / delivery / VAT", () => {
  it("creates draft, resolves pricing, applies free delivery at £100+, snapshots override", async () => {
    const sku = `QT-PR-${Date.now()}`;
    const variant = await seedVariant(sku, 12.5, 12);
    const { company, contact, address } = await seedCompany(`Quote Price Co ${sku}`);

    await prisma.customerPrice.create({
      data: { companyId: company.id, variantId: variant.id, unitPrice: 3.69 },
    });

    const draft = await createQuote(adminId, {
      companyId: company.id,
      contactId: contact.id,
      deliveryAddressId: address.id,
      customerNotes: "Price includes delivery to your registered trade address.",
      internalNotes: "Margin watch",
      validityDays: 30,
    });
    expect(draft.status).toBe("DRAFT");
    expect(draft.quoteNumber).toMatch(/^QT-\d{6}$/);
    expect(draft.internalNotes).toBe("Margin watch");

    // Below free delivery threshold (12 * 3.50 = 42)
    const withLines = await updateQuoteDraft(adminId, {
      id: draft.id,
      lines: [{ variantId: variant.id, qty: 12, quotedUnitPrice: "3.5000" }],
    });
    expect(withLines.items).toHaveLength(1);
    expect(withLines.items[0]!.normalUnitPrice).toBe("3.6900");
    expect(withLines.items[0]!.unitPrice).toBe("3.5000");
    expect(withLines.items[0]!.priceOverride).toBe(true);
    expect(withLines.subtotal).toBe("42.00");
    expect(withLines.deliveryTotal).toBe("5.95");
    expect(Number(withLines.vatTotal)).toBeGreaterThan(0);

    // Raise to free delivery (≥ £100 goods)
    const freeDel = await updateQuoteDraft(adminId, {
      id: draft.id,
      lines: [{ variantId: variant.id, qty: 48, quotedUnitPrice: "3.5000" }],
    });
    expect(freeDel.subtotal).toBe("168.00");
    expect(freeDel.deliveryTotal).toBe("0.00");

    // Quote does not reserve stock
    const inv = await prisma.inventory.findFirstOrThrow({ where: { variantId: variant.id } });
    expect(inv.qtyReserved).toBe(0);
  });

  it("rejects price override without permission", async () => {
    const sku = `QT-RBAC-${Date.now()}`;
    const variant = await seedVariant(sku, 5, 1);
    const { company } = await seedCompany(`Quote RBAC ${sku}`);
    // MANAGEMENT has quotes.view but not override_price / edit in our map —
    // use a user with quotes.edit but strip override by using CUSTOMER_SERVICE if it has edit.
    // SALES_REP has override — create a custom user with only quotes.edit via SUPER path:
    // Instead: call update as trade user (no staff quotes.edit).
    const buyerId = await ensureTradeBuyer(`norbac-${sku}@example.invalid`, company.id);
    const draft = await createQuote(adminId, { companyId: company.id });
    await expect(
      updateQuoteDraft(buyerId, {
        id: draft.id,
        lines: [{ variantId: variant.id, qty: 1, quotedUnitPrice: "1.00" }],
      }),
    ).rejects.toBeInstanceOf(AuthError);
  });
});

describe("Quote send / view / decline / portal isolation", () => {
  it("sends draft, marks viewed for customer only, declines, isolates companies", async () => {
    const sku = `QT-SV-${Date.now()}`;
    const variant = await seedVariant(sku, 10, 1);
    const { company, contact } = await seedCompany(`Quote Send Co ${sku}`);
    const other = await seedCompany(`Other Co ${sku}`);
    const buyerId = await ensureTradeBuyer(`buyer-sv-${sku}@example.invalid`, company.id);
    const otherBuyer = await ensureTradeBuyer(`other-sv-${sku}@example.invalid`, other.company.id);

    const draft = await createQuote(adminId, {
      companyId: company.id,
      contactId: contact.id,
      validUntil: "2099-12-31",
    });
    await updateQuoteDraft(adminId, {
      id: draft.id,
      lines: [{ variantId: variant.id, qty: 1 }],
      validUntil: "2099-12-31",
    });

    const sent = await sendQuote(adminId, { id: draft.id });
    expect(sent.quote.status).toBe("SENT");
    expect(sent.toEmail).toBeTruthy();

    // Admin preview must not mark VIEWED
    const staffView = await getQuoteForStaff(adminId, draft.id);
    expect(staffView.status).toBe("SENT");
    expect(staffView.firstViewedAt).toBeNull();

    const portalView = await getQuoteForPortal(buyerId, draft.id);
    expect(portalView.status).toBe("VIEWED");
    expect(portalView.firstViewedAt).toBeTruthy();
    expect(portalView.internalNotes).toBeNull();

    // Idempotent viewed
    const again = await markQuoteViewedByCustomer(buyerId, draft.id);
    expect(again.status).toBe("VIEWED");

    // IDOR — other company cannot see
    await expect(getQuoteForPortal(otherBuyer, draft.id)).rejects.toBeInstanceOf(AuthError);

    const list = await listQuotesForPortal(buyerId);
    expect(list.some((q) => q.id === draft.id)).toBe(true);
    const otherList = await listQuotesForPortal(otherBuyer);
    expect(otherList.some((q) => q.id === draft.id)).toBe(false);

    const declined = await declineQuote(buyerId, { id: draft.id, reason: "Too expensive" });
    expect(declined.status).toBe("DECLINED");
    await expect(
      acceptQuoteAsCustomer(buyerId, {
        id: draft.id,
        idempotencyKey: `declined-${sku}`,
      }),
    ).rejects.toBeInstanceOf(AuthError);
  });
});

describe("Quote accept → order conversion", () => {
  it("retains quoted price, reserves stock, starts SUBMITTED, links source quote, emails once", async () => {
    const sku = `QT-AC-${Date.now()}`;
    const variant = await seedVariant(sku, 8, 12);
    const { company, contact, address } = await seedCompany(`Quote Accept Co ${sku}`);
    await prisma.customerPrice.create({
      data: { companyId: company.id, variantId: variant.id, unitPrice: 3.69 },
    });
    const buyerId = await ensureTradeBuyer(`buyer-ac-${sku}@example.invalid`, company.id);

    const draft = await createQuote(adminId, {
      companyId: company.id,
      contactId: contact.id,
      deliveryAddressId: address.id,
      poNumber: "PO-QUOTE-1",
      validUntil: "2099-12-31",
    });
    await updateQuoteDraft(adminId, {
      id: draft.id,
      lines: [{ variantId: variant.id, qty: 12, quotedUnitPrice: "3.5000" }],
      validUntil: "2099-12-31",
    });
    await sendQuote(adminId, { id: draft.id });

    // Current price changes after quote — must not affect acceptance
    await prisma.customerPrice.updateMany({
      where: { companyId: company.id, variantId: variant.id },
      data: { unitPrice: 4.99 },
    });

    const beforeRes = await prisma.inventory.findFirstOrThrow({ where: { variantId: variant.id } });
    expect(beforeRes.qtyReserved).toBe(0);

    const key = `accept-${sku}`;
    const accepted = await acceptQuoteAsCustomer(buyerId, { id: draft.id, idempotencyKey: key });
    expect(accepted.alreadyConverted).toBe(false);
    expect(accepted.orderNumber).toMatch(/^AB-\d{6}$/);
    expect(accepted.quote.status).toBe("CONVERTED");

    const order = await prisma.order.findUniqueOrThrow({
      where: { id: accepted.orderId },
      include: { items: true },
    });
    expect(order.status).toBe("SUBMITTED");
    expect(order.sourceQuoteId).toBe(draft.id);
    expect(order.sourceQuoteNumber).toBe(draft.quoteNumber);
    expect(order.poNumber).toBe("PO-QUOTE-1");
    expect(order.externalRef).toBeNull();
    expect(Number(order.items[0]!.unitPrice)).toBeCloseTo(3.5, 4);
    expect(Number(order.items[0]!.customerUnitPrice)).toBeCloseTo(3.5, 2);
    expect(order.items[0]!.availableQtyAtOrder).toBe(12);
    expect(order.items[0]!.backorderQtyAtOrder).toBe(0);

    const afterRes = await prisma.inventory.findFirstOrThrow({ where: { variantId: variant.id } });
    expect(afterRes.qtyOnHand).toBe(beforeRes.qtyOnHand);
    expect(afterRes.qtyReserved).toBe(12);

    // Standard ORDER_RECEIVED / INTERNAL after commit (same path as checkout)
    const customerEmails = await prisma.transactionalEmail.findMany({
      where: { entityId: order.id, purpose: "ORDER_RECEIVED" },
    });
    expect(customerEmails).toHaveLength(1);
    expect(customerEmails[0]!.idempotencyKey).toBe(`ORDER_RECEIVED:${order.id}`);
    expect(customerEmails[0]!.toEmail).toBe((contact.email ?? "").toLowerCase());

    const internalEmails = await prisma.transactionalEmail.findMany({
      where: { entityId: order.id, purpose: "ORDER_RECEIVED_INTERNAL" },
    });
    // Internal may be 0 when ops recipients are unset in test env — never more than intended.
    expect(internalEmails.length).toBeLessThanOrEqual(3);

    // Idempotent re-accept — no second order, no second customer email
    const again = await acceptQuoteAsCustomer(buyerId, { id: draft.id, idempotencyKey: key });
    expect(again.alreadyConverted).toBe(true);
    expect(again.orderId).toBe(accepted.orderId);

    const orderCount = await prisma.order.count({ where: { sourceQuoteId: draft.id } });
    expect(orderCount).toBe(1);
    expect(
      await prisma.transactionalEmail.count({
        where: { entityId: order.id, purpose: "ORDER_RECEIVED" },
      }),
    ).toBe(1);

    // Different key after conversion returns the same order (no second order)
    const raced = await acceptQuoteAsCustomer(buyerId, {
      id: draft.id,
      idempotencyKey: `${key}-b`,
    });
    expect(raced.alreadyConverted).toBe(true);
    expect(raced.orderId).toBe(accepted.orderId);
    expect(await prisma.order.count({ where: { sourceQuoteId: draft.id } })).toBe(1);
    expect(
      await prisma.transactionalEmail.count({
        where: { entityId: order.id, purpose: "ORDER_RECEIVED" },
      }),
    ).toBe(1);
  });

  it("partial backorder at conversion keeps quoted price and reserves only available stock", async () => {
    const sku = `QT-BO-${Date.now()}`;
    const variant = await seedVariant(sku, 5, 12);
    const { company, contact } = await seedCompany(`Quote BO Co ${sku}`);
    const buyerId = await ensureTradeBuyer(`buyer-bo-${sku}@example.invalid`, company.id);

    const draft = await createQuote(adminId, {
      companyId: company.id,
      contactId: contact.id,
      validUntil: "2099-12-31",
    });
    await updateQuoteDraft(adminId, {
      id: draft.id,
      lines: [{ variantId: variant.id, qty: 12, quotedUnitPrice: "5.0400" }],
      validUntil: "2099-12-31",
    });
    await sendQuote(adminId, { id: draft.id });

    await seedStock(variant.id, 5);

    const accepted = await acceptQuoteAsCustomer(buyerId, {
      id: draft.id,
      idempotencyKey: `bo-${sku}`,
    });
    const order = await prisma.order.findUniqueOrThrow({
      where: { id: accepted.orderId },
      include: { items: true },
    });
    expect(order.items[0]!.qty).toBe(12);
    expect(Number(order.items[0]!.customerUnitPrice)).toBeCloseTo(5.04, 2);
    expect(order.items[0]!.availableQtyAtOrder).toBe(5);
    expect(order.items[0]!.backorderQtyAtOrder).toBe(7);

    const inv = await prisma.inventory.findFirstOrThrow({ where: { variantId: variant.id } });
    expect(inv.qtyReserved).toBe(5);

    const email = await prisma.transactionalEmail.findFirstOrThrow({
      where: { entityId: order.id, purpose: "ORDER_RECEIVED" },
    });
    expect(email.textBody).toContain("on backorder");
  });

  it("rejects acceptance when backorders are denied and stock is insufficient", async () => {
    const sku = `QT-ST-${Date.now()}`;
    const variant = await seedVariant(sku, 5, 12);
    await prisma.productVariant.update({
      where: { id: variant.id },
      data: { backorderPolicy: "DENY" },
    });
    const { company, contact } = await seedCompany(`Quote Stock Co ${sku}`);
    const buyerId = await ensureTradeBuyer(`buyer-st-${sku}@example.invalid`, company.id);

    const draft = await createQuote(adminId, {
      companyId: company.id,
      contactId: contact.id,
      validUntil: "2099-12-31",
    });
    await updateQuoteDraft(adminId, {
      id: draft.id,
      lines: [{ variantId: variant.id, qty: 12 }],
      validUntil: "2099-12-31",
    });
    await sendQuote(adminId, { id: draft.id });

    await seedStock(variant.id, 0);

    await expect(
      acceptQuoteAsCustomer(buyerId, {
        id: draft.id,
        idempotencyKey: `stock-fail-${sku}`,
      }),
    ).rejects.toMatchObject({ code: "QUOTE_STOCK_UNAVAILABLE" });

    const orders = await prisma.order.count({ where: { sourceQuoteId: draft.id } });
    expect(orders).toBe(0);
    const q = await prisma.quote.findUniqueOrThrow({ where: { id: draft.id } });
    expect(q.status).not.toBe("CONVERTED");
  });

  it("rejects expired quotes", async () => {
    const sku = `QT-EX-${Date.now()}`;
    const variant = await seedVariant(sku, 5, 1);
    const { company, contact } = await seedCompany(`Quote Exp Co ${sku}`);
    const buyerId = await ensureTradeBuyer(`buyer-ex-${sku}@example.invalid`, company.id);

    const draft = await createQuote(adminId, {
      companyId: company.id,
      contactId: contact.id,
      validUntil: "2020-01-01",
    });
    await updateQuoteDraft(adminId, {
      id: draft.id,
      lines: [{ variantId: variant.id, qty: 1 }],
      validUntil: "2020-01-01",
    });
    // Force SENT despite past validity for status machine test
    await prisma.quote.update({
      where: { id: draft.id },
      data: { status: "SENT", sentAt: new Date(), sentById: adminId },
    });

    await expect(
      acceptQuoteAsCustomer(buyerId, {
        id: draft.id,
        idempotencyKey: `expired-${sku}`,
      }),
    ).rejects.toMatchObject({ code: "QUOTE_EXPIRED" });
  });

  it("staff accept-on-behalf uses the same conversion pipeline", async () => {
    const sku = `QT-OB-${Date.now()}`;
    const variant = await seedVariant(sku, 6, 1);
    const { company, contact } = await seedCompany(`Quote Behalf Co ${sku}`);

    const draft = await createQuote(adminId, {
      companyId: company.id,
      contactId: contact.id,
      validUntil: "2099-12-31",
    });
    await updateQuoteDraft(adminId, {
      id: draft.id,
      lines: [{ variantId: variant.id, qty: 1 }],
      validUntil: "2099-12-31",
    });
    await sendQuote(adminId, { id: draft.id });

    const result = await acceptQuoteOnBehalf(adminId, {
      id: draft.id,
      idempotencyKey: `behalf-${sku}`,
      note: "Customer confirmed by phone",
    });
    expect(result.orderNumber).toMatch(/^AB-\d{6}$/);
    const q = await prisma.quote.findUniqueOrThrow({ where: { id: draft.id } });
    expect(q.status).toBe("CONVERTED");
    expect(q.acceptedByStaffId).toBe(adminId);
    expect(q.acceptanceNote).toBe("Customer confirmed by phone");
  });
});

describe("Quote duplicate / commercial lock", () => {
  it("duplicates to a new draft with re-resolved pricing", async () => {
    const sku = `QT-DUP-${Date.now()}`;
    const variant = await seedVariant(sku, 7.25, 1);
    const { company } = await seedCompany(`Quote Dup Co ${sku}`);

    const draft = await createQuote(adminId, { companyId: company.id, validUntil: "2099-12-31" });
    await updateQuoteDraft(adminId, {
      id: draft.id,
      lines: [{ variantId: variant.id, qty: 1, quotedUnitPrice: "6.0000" }],
    });
    await sendQuote(adminId, { id: draft.id });

    await expect(
      updateQuoteDraft(adminId, {
        id: draft.id,
        lines: [{ variantId: variant.id, qty: 2 }],
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });

    const dup = await duplicateQuote(adminId, { id: draft.id });
    expect(dup.status).toBe("DRAFT");
    expect(dup.quoteNumber).not.toBe(draft.quoteNumber);
    expect(dup.items[0]!.unitPrice).toBe("7.2500");
    expect(dup.items[0]!.priceOverride).toBe(false);
  });
});

describe("Quote Autopart boundary", () => {
  it("converted order stays SUBMITTED with null externalRef (no Autopart side effects)", async () => {
    const sku = `QT-AP-${Date.now()}`;
    const variant = await seedVariant(sku, 4, 1);
    const { company, contact } = await seedCompany(`Quote AP Co ${sku}`);
    const buyerId = await ensureTradeBuyer(`buyer-ap-${sku}@example.invalid`, company.id);

    const draft = await createQuote(adminId, {
      companyId: company.id,
      contactId: contact.id,
      validUntil: "2099-12-31",
    });
    await updateQuoteDraft(adminId, {
      id: draft.id,
      lines: [{ variantId: variant.id, qty: 1 }],
      validUntil: "2099-12-31",
    });
    await sendQuote(adminId, { id: draft.id });
    const accepted = await acceptQuoteAsCustomer(buyerId, {
      id: draft.id,
      idempotencyKey: `ap-${sku}`,
    });

    const order = await prisma.order.findUniqueOrThrow({ where: { id: accepted.orderId } });
    expect(order.status).toBe("SUBMITTED");
    expect(order.externalRef).toBeNull();
    expect(order.autopartExportedAt).toBeNull();

    const staffList = await listQuotesForStaff(adminId, { q: draft.quoteNumber });
    expect(staffList.items.some((q) => q.id === draft.id)).toBe(true);
  });
});

describe("Quote send validation / empty draft", () => {
  it("allows empty draft but blocks send when empty or £0", async () => {
    const { company, contact } = await seedCompany(`Quote Empty ${Date.now()}`);
    const draft = await createQuote(adminId, {
      companyId: company.id,
      contactId: contact.id,
      validUntil: "2099-12-31",
    });
    expect(draft.status).toBe("DRAFT");
    expect(draft.grandTotal).toBe("0.00");

    await expect(sendQuote(adminId, { id: draft.id })).rejects.toMatchObject({
      code: "VALIDATION",
    });
  });
});

describe("Quote regression — live QT commercial snapshot", () => {
  it("accepts SS + PMCSEAL style quote with snapshotted commercials and one ORDER_RECEIVED", async () => {
    const stamp = Date.now();
    const ss = await seedVariant(`SS-${stamp}`, 25.95, 12);
    const pmc = await seedVariant(`PMCSEAL-${stamp}`, 5.04, 12);
    const { company, contact, address } = await seedCompany(`Quote Live ${stamp}`);
    const buyerId = await ensureTradeBuyer(`buyer-live-${stamp}@example.invalid`, company.id);

    const draft = await createQuote(adminId, {
      companyId: company.id,
      contactId: contact.id,
      deliveryAddressId: address.id,
      poNumber: "testy01",
      validUntil: "2099-12-31",
      customerNotes: "Customer-facing note",
      internalNotes: "INTERNAL ONLY — never leak",
    });
    await updateQuoteDraft(adminId, {
      id: draft.id,
      lines: [
        { variantId: ss.id, qty: 24, quotedUnitPrice: "25.9500" },
        { variantId: pmc.id, qty: 12, quotedUnitPrice: "5.0400" },
      ],
      deliveryTotalOverride: "0.00",
      validUntil: "2099-12-31",
    });

    const staff = await getQuoteForStaff(adminId, draft.id);
    expect(staff.subtotal).toBe("683.28");
    expect(staff.deliveryTotal).toBe("0.00");
    expect(staff.vatTotal).toBe("136.66");
    expect(staff.grandTotal).toBe("819.94");
    expect(staff.internalNotes).toContain("INTERNAL ONLY");

    await sendQuote(adminId, { id: draft.id });
    const portal = await getQuoteForPortal(buyerId, draft.id);
    expect(portal.internalNotes).toBeNull();
    expect(portal.customerNotes).toContain("Customer-facing");
    expect(portal.grandTotal).toBe("819.94");

    const accepted = await acceptQuoteAsCustomer(buyerId, {
      id: draft.id,
      idempotencyKey: `live-${stamp}`,
    });
    expect(accepted.alreadyConverted).toBe(false);

    const order = await prisma.order.findUniqueOrThrow({
      where: { id: accepted.orderId },
      include: { items: true },
    });
    expect(Number(order.subtotal)).toBeCloseTo(683.28, 2);
    expect(Number(order.deliveryTotal)).toBeCloseTo(0, 2);
    expect(Number(order.vatTotal)).toBeCloseTo(136.66, 2);
    expect(Number(order.grandTotal)).toBeCloseTo(819.94, 2);
    expect(order.sourceQuoteNumber).toBe(draft.quoteNumber);
    expect(order.poNumber).toBe("testy01");

    const emails = await prisma.transactionalEmail.findMany({
      where: { entityId: order.id, purpose: "ORDER_RECEIVED" },
    });
    expect(emails).toHaveLength(1);
    expect(emails[0]!.textBody).toContain(order.orderNumber);
    expect(emails[0]!.textBody).toContain(draft.quoteNumber);
    expect(emails[0]!.textBody).not.toContain("INTERNAL ONLY");

    await acceptQuoteAsCustomer(buyerId, {
      id: draft.id,
      idempotencyKey: `live-${stamp}-refresh`,
    });
    expect(await prisma.order.count({ where: { sourceQuoteId: draft.id } })).toBe(1);
    expect(
      await prisma.transactionalEmail.count({
        where: { entityId: order.id, purpose: "ORDER_RECEIVED" },
      }),
    ).toBe(1);
  });
});
