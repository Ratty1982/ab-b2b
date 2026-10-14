import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { bootstrapRbac } from "../../../prisma/bootstrap/rbac";
import { saveProduct } from "@/server/catalogue/service";
import { addToBasket } from "@/server/basket/service";
import { placeOrder, resolveOrderLinesFromItems } from "@/server/orders/service";
import {
  abandonSalesOrderDraft,
  ensureSalesOrderCrmActivity,
  getSalesOrderDraft,
  listSalesOrderDrafts,
  openSalesOrderDraft,
  placeSalesOrder,
  startSalesOrderEdit,
  salesOrderCrmDependencies,
  saveSalesOrderDraft,
  searchOrderEntryCustomers,
  searchSalesOrderProducts,
} from "@/server/orders/sales-order-entry";
import { listCompaniesForActor } from "@/server/companies/service";
import { acceptQuoteOnBehalf, createQuote, sendQuote, updateQuoteDraft } from "@/server/quotes/service";
import { AuthError } from "@/server/rbac/guards";

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

async function ensureRep(email: string, role: "SALES_REPRESENTATIVE" | "SALES_MANAGER", code: string, managerId?: string) {
  const user = await ensureUser(email, [role], "INTERNAL", email.split("@")[0]);
  const existing = await prisma.salesRep.findUnique({ where: { userId: user.id } });
  if (existing) return { user, rep: existing };
  const rep = await prisma.salesRep.create({
    data: { userId: user.id, code, active: true, managerId: managerId ?? null },
  });
  return { user, rep };
}

async function ensureTradeBuyer(email: string, companyId: string) {
  const user = await ensureUser(email, [], "TRADE");
  await prisma.companyUser.upsert({
    where: { companyId_userId: { companyId, userId: user.id } },
    create: { companyId, userId: user.id, role: "TRADE_BUYER", status: "ACTIVE", isDefault: true },
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

async function seedCompany(name: string, status: "ACTIVE" | "PROSPECT" = "ACTIVE") {
  const company = await prisma.company.create({
    data: { name, status, paymentTerms: "Net 30" },
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

async function seedVariant(sku: string, trade: number, caseQty: number, avail: number) {
  const product = await saveProduct(adminId, {
    sku,
    name: `Sales order ${sku}`,
    brand: "Power Maxed",
    category: "Braking",
    trade,
    rrp: trade * 2,
    packQty: 1,
    caseQty,
    description: "sales order entry",
    active: true,
  });
  const variant = await prisma.productVariant.findFirstOrThrow({ where: { productId: product.id } });
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

async function assign(companyId: string, salesRepId: string, isPrimary: boolean) {
  await prisma.companyAssignment.create({
    data: { companyId, salesRepId, isPrimary },
  });
}

beforeAll(async () => {
  await bootstrapRbac(prisma);
  adminId = (await ensureUser("soe.admin@example.invalid", ["SUPER_ADMIN"], "INTERNAL", "Super Admin")).id;
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("sales order entry on behalf of a customer", () => {
  it("lets another representative order for an active customer, and still blocks prospects and staff without permission", async () => {
    const stamp = Date.now();
    const { user: rep } = await ensureRep(`soe-rep-${stamp}@example.invalid`, "SALES_REPRESENTATIVE", `SOE${stamp}`);
    const { user: other } = await ensureRep(`soe-out-${stamp}@example.invalid`, "SALES_REPRESENTATIVE", `OUT${stamp}`);
    const cs = await ensureUser(`soe-cs-${stamp}@example.invalid`, ["CUSTOMER_SERVICE"]);
    const { company } = await seedCompany(`SOE Assigned ${stamp}`);
    const prospect = await seedCompany(`SOE Prospect ${stamp}`, "PROSPECT");
    const repRecord = await prisma.salesRep.findUniqueOrThrow({ where: { userId: rep.id } });
    await assign(company.id, repRecord.id, true);
    await assign(prospect.company.id, repRecord.id, true);

    const opened = await openSalesOrderDraft(other.id, { companyId: company.id });
    expect(opened.draft.companyId).toBe(company.id);
    expect(opened.assignedSalesRep?.code).toBe(repRecord.code);
    expect(opened.quotes).toEqual([]);
    const hits = await searchSalesOrderProducts(other.id, { companyId: company.id, q: "SOE" });
    expect(Array.isArray(hits)).toBe(true);
    const found = await searchOrderEntryCustomers(other.id, { q: `SOE Assigned ${stamp}` });
    expect(found.items.some((row) => row.id === company.id)).toBe(true);
    expect(found.total).toBe(found.items.length);
    const crm = await listCompaniesForActor(other.id, { q: `SOE Assigned ${stamp}`, status: "ACTIVE" });
    expect(crm.items.some((row) => row.id === company.id)).toBe(false);

    await expect(openSalesOrderDraft(rep.id, { companyId: prospect.company.id })).rejects.toMatchObject({
      code: "COMPANY_NOT_ACTIVE",
    });
    const still = await prisma.company.findUniqueOrThrow({ where: { id: prospect.company.id } });
    expect(still.status).toBe("PROSPECT");
    const prospectHits = await searchOrderEntryCustomers(rep.id, { q: `SOE Prospect ${stamp}` });
    expect(prospectHits.items.some((row) => row.id === prospect.company.id)).toBe(false);
    expect(prospectHits.total).toBe(0);

    await expect(openSalesOrderDraft(cs.id, { companyId: company.id })).rejects.toBeInstanceOf(AuthError);
    await expect(openSalesOrderDraft(cs.id, { companyId: company.id })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("keeps the assigned representative on the order and records who took the call", async () => {
    const stamp = Date.now();
    const variant = await seedVariant(`SOE-ANY-${stamp}`, 9, 1, 12);
    const { user: owner } = await ensureRep(`soe-owner-${stamp}@example.invalid`, "SALES_REPRESENTATIVE", `OWN${stamp}`.slice(0, 12));
    const { user: taker } = await ensureRep(`soe-taker-${stamp}@example.invalid`, "SALES_REPRESENTATIVE", `TAK${stamp}`.slice(0, 12));
    const ownerRep = await prisma.salesRep.findUniqueOrThrow({ where: { userId: owner.id } });
    const { company, address, contact } = await seedCompany(`SOE Phone ${stamp}`);
    await assign(company.id, ownerRep.id, true);
    const quote = await createQuote(owner.id, {
      companyId: company.id,
      contactId: contact.id,
      validUntil: "2099-12-31",
    });
    await updateQuoteDraft(owner.id, {
      id: quote.id,
      lines: [{ variantId: variant.id, qty: 1 }],
      validUntil: "2099-12-31",
    });
    await sendQuote(owner.id, { id: quote.id });

    const draft = await openSalesOrderDraft(taker.id, { companyId: company.id, fresh: true });
    expect(draft.quotes).toEqual([]);
    expect(draft.assignedSalesRep?.code).toBe(ownerRep.code);
    await expect(
      placeSalesOrder(taker.id, {
        draftId: draft.draft.id,
        confirmAuthorised: true,
        idempotencyKey: `quote-hidden-${stamp}`,
        source: "TELEPHONE",
        quoteId: quote.id,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    const saved = await saveSalesOrderDraft(taker.id, {
      draftId: draft.draft.id,
      contactId: contact.id,
      addressId: address.id,
      source: "TELEPHONE",
      lines: [{ variantId: variant.id, qty: 1 }],
    });
    const placed = await placeSalesOrder(taker.id, {
      draftId: draft.draft.id,
      confirmAuthorised: true,
      idempotencyKey: `taken-${stamp}`,
      source: "TELEPHONE",
      contactId: contact.id,
      addressId: address.id,
      lines: [{ variantId: variant.id, qty: 1 }],
      expectedReview: expectedFrom(saved.review!),
    });
    expect(placed.ok).toBe(true);
    if (!placed.ok) return;
    const order = await prisma.order.findUniqueOrThrow({ where: { id: placed.order.id } });
    expect(order.placedByStaffUserId).toBe(taker.id);
    expect(order.salesRepIdSnapshot).toBe(ownerRep.id);
    expect(order.salesRepCodeSnapshot).toBe(ownerRep.code);
    await expect(getSalesOrderDraft(owner.id, { draftId: draft.draft.id })).rejects.toMatchObject({
      code: "DRAFT_NOT_FOUND",
    });
  });

  it("lets a sales manager enter an order outside the team without widening CRM access", async () => {
    const stamp = Date.now();
    const { rep: managerRep, user: manager } = await ensureRep(
      `soe-mgr-${stamp}@example.invalid`,
      "SALES_MANAGER",
      `MGR${stamp}`,
    );
    const { rep: teamRep } = await ensureRep(
      `soe-team-${stamp}@example.invalid`,
      "SALES_REPRESENTATIVE",
      `TEAM${stamp}`,
      managerRep.id,
    );
    const { rep: outsider } = await ensureRep(
      `soe-stranger-${stamp}@example.invalid`,
      "SALES_REPRESENTATIVE",
      `STR${stamp}`,
    );
    const teamCo = await seedCompany(`SOE Team ${stamp}`);
    const otherCo = await seedCompany(`SOE Other ${stamp}`);
    await assign(teamCo.company.id, teamRep.id, true);
    await assign(otherCo.company.id, outsider.id, true);

    const opened = await openSalesOrderDraft(manager.id, { companyId: teamCo.company.id });
    expect(opened.draft.companyId).toBe(teamCo.company.id);
    const outside = await openSalesOrderDraft(manager.id, { companyId: otherCo.company.id, fresh: true });
    expect(outside.draft.companyId).toBe(otherCo.company.id);
    const crm = await listCompaniesForActor(manager.id, { q: otherCo.company.name, status: "ACTIVE" });
    expect(crm.items.some((row) => row.id === otherCo.company.id)).toBe(false);
  });

  it("keeps salesperson drafts and the customer basket separate", async () => {
    const stamp = Date.now();
    const variant = await seedVariant(`SOE-BASKET-${stamp}`, 4, 1, 40);
    const { user: a } = await ensureRep(`soe-a-${stamp}@example.invalid`, "SALES_REPRESENTATIVE", `A${stamp}`);
    const { user: b } = await ensureRep(`soe-b-${stamp}@example.invalid`, "SALES_REPRESENTATIVE", `B${stamp}`);
    const repA = await prisma.salesRep.findUniqueOrThrow({ where: { userId: a.id } });
    const repB = await prisma.salesRep.findUniqueOrThrow({ where: { userId: b.id } });
    const { company, address, contact } = await seedCompany(`SOE Drafts ${stamp}`);
    await assign(company.id, repA.id, true);
    await assign(company.id, repB.id, false);
    const buyerId = await ensureTradeBuyer(`soe-buyer-${stamp}@example.invalid`, company.id);
    await addToBasket(buyerId, { variantId: variant.id, quantity: 3 });

    const draftA = await openSalesOrderDraft(a.id, { companyId: company.id, fresh: true });
    const draftB = await openSalesOrderDraft(b.id, { companyId: company.id, fresh: true });
    expect(draftA.draft.id).not.toBe(draftB.draft.id);

    await saveSalesOrderDraft(a.id, {
      draftId: draftA.draft.id,
      lines: [{ variantId: variant.id, qty: 2 }],
      contactId: contact.id,
      addressId: address.id,
    });
    const rereadB = await getSalesOrderDraft(b.id, { draftId: draftB.draft.id });
    expect(rereadB.draft.lines).toHaveLength(0);
    await expect(getSalesOrderDraft(b.id, { draftId: draftA.draft.id })).rejects.toMatchObject({
      code: "DRAFT_NOT_FOUND",
    });

    const reserved = await prisma.inventory.findFirstOrThrow({ where: { variantId: variant.id } });
    expect(reserved.qtyReserved).toBe(0);
    const basket = await prisma.basket.findFirstOrThrow({
      where: { companyId: company.id, status: "OPEN" },
      include: { items: true },
    });
    expect(basket.items).toEqual([expect.objectContaining({ variantId: variant.id, qty: 3 })]);

    await abandonSalesOrderDraft(a.id, { draftId: draftA.draft.id });
    const abandoned = await prisma.salesOrderDraft.findUniqueOrThrow({ where: { id: draftA.draft.id } });
    expect(abandoned.status).toBe("ABANDONED");
    await expect(
      placeSalesOrder(a.id, {
        draftId: draftA.draft.id,
        confirmAuthorised: true,
        idempotencyKey: `abandoned-${stamp}`,
        source: "TELEPHONE",
        contactId: contact.id,
        addressId: address.id,
        lines: [{ variantId: variant.id, qty: 1 }],
      }),
    ).rejects.toMatchObject({ code: "DRAFT_CONFLICT" });
  });

  it("prices the customer, applies an eligible promotion and VAT, and rejects another customer's address", async () => {
    const stamp = Date.now();
    const priced = await seedVariant(`SOE-PRICE-${stamp}`, 20, 1, 30);
    const cased = await seedVariant(`SOE-CASE-${stamp}`, 3.25, 12, 48);
    await prisma.productVariant.update({ where: { id: cased.id }, data: { minOrderQty: 12 } });
    const { company, address, contact } = await seedCompany(`SOE Price ${stamp}`);
    const other = await seedCompany(`SOE Price Other ${stamp}`);
    await prisma.customerPrice.create({
      data: { companyId: company.id, variantId: priced.id, unitPrice: "16.5000" },
    });
    const promo = await prisma.promotion.create({
      data: {
        code: `SOE${stamp}`.slice(0, 20),
        name: "Sales order promo",
        type: "PERCENT",
        value: "10",
        isActive: true,
        metadata: { variantIds: [priced.id] },
      },
    });
    const { user: rep } = await ensureRep(`soe-price-${stamp}@example.invalid`, "SALES_REPRESENTATIVE", `PR${stamp}`);
    await assign(company.id, (await prisma.salesRep.findUniqueOrThrow({ where: { userId: rep.id } })).id, true);

    try {
      const hits = await searchSalesOrderProducts(rep.id, { companyId: company.id, q: priced.sku });
      expect(hits[0]?.customerUnitPrice).toBe("14.85");
      expect(hits[0]?.promotionCode).toBe(promo.code);
      expect(hits[0]?.priceSource).toBe("PROMOTION");

      const draft = await openSalesOrderDraft(rep.id, { companyId: company.id, fresh: true });
      const saved = await saveSalesOrderDraft(rep.id, {
        draftId: draft.draft.id,
        contactId: contact.id,
        addressId: address.id,
        source: "EMAIL",
        lines: [{ variantId: priced.id, qty: 1 }],
        poNumber: "PO-PHONE-1",
      });
      expect(saved.review?.totals.subtotal).toBe("14.85");
      expect(saved.review?.totals.deliveryTotal).toBe("5.95");
      expect(saved.review?.totals.vatTotal).not.toBe("0.00");
      expect(Number(saved.review?.totals.grandTotal)).toBeGreaterThan(14.85);

      const units = await saveSalesOrderDraft(rep.id, {
        draftId: draft.draft.id,
        lines: [{ variantId: cased.id, qty: 6 }],
      });
      expect(units.review?.hasBlockingIssues).toBe(false);
      expect(units.review?.lines[0]?.issue).toBe("VALID");
      expect(units.review?.lines[0]?.issueMessage).toBeNull();
      expect(units.review?.lines[0]?.quantity).toBe(6);
      expect(units.review?.lines[0]?.caseQty).toBe(12);

      await expect(
        saveSalesOrderDraft(rep.id, { draftId: draft.draft.id, addressId: other.address.id }),
      ).rejects.toMatchObject({ code: "ADDRESS_NOT_FOUND" });
      await expect(
        saveSalesOrderDraft(rep.id, { draftId: draft.draft.id, contactId: other.contact.id }),
      ).rejects.toMatchObject({ code: "CONTACT_NOT_FOUND" });
      await expect(
        placeSalesOrder(rep.id, {
          draftId: draft.draft.id,
          confirmAuthorised: true,
          idempotencyKey: `bad-postcode-${stamp}`,
          source: "TELEPHONE",
          contactId: contact.id,
          oneOffAddress: { line1: "1 Road", town: "Leeds", postcode: "NOT A POSTCODE", country: "GB" },
          lines: [{ variantId: priced.id, qty: 1 }],
        }),
      ).rejects.toThrow();

      const stored = await prisma.customerPrice.findUniqueOrThrow({
        where: { companyId_variantId: { companyId: company.id, variantId: priced.id } },
      });
      expect(Number(stored.unitPrice.toString())).toBe(16.5);
    } finally {
      await prisma.promotion.update({ where: { id: promo.id }, data: { isActive: false } });
    }
  });

  it("keeps a new campaign off negotiated prices until management allows it, and blocks placement when that price changes", async () => {
    const stamp = Date.now();
    const priced = await seedVariant(`SOE-PROT-${stamp}`, 20, 1, 30);
    const { company, address, contact } = await seedCompany(`SOE Protect ${stamp}`);
    const other = await seedCompany(`SOE Protect Other ${stamp}`);
    await prisma.customerPrice.create({
      data: { companyId: company.id, variantId: priced.id, unitPrice: "16.5000" },
    });
    const promo = await prisma.promotion.create({
      data: {
        code: `PROT${stamp}`.slice(0, 20),
        name: "Protected campaign",
        type: "PERCENT",
        value: "10",
        isActive: true,
        campaignStatus: "APPROVED",
        appliesToNegotiatedPrices: false,
        metadata: { skus: [priced.sku] },
      },
    });
    const { user: rep } = await ensureRep(`soe-prot-${stamp}@example.invalid`, "SALES_REPRESENTATIVE", `PT${stamp}`);
    await assign(company.id, (await prisma.salesRep.findUniqueOrThrow({ where: { userId: rep.id } })).id, true);
    const hits = await searchSalesOrderProducts(rep.id, { companyId: company.id, q: priced.sku });
    expect(hits[0]?.customerUnitPrice).toBe("16.50");
    expect(hits[0]?.promotionCode).toBeNull();
    const otherHits = await searchSalesOrderProducts(rep.id, { companyId: other.company.id, q: priced.sku });
    expect(otherHits[0]?.customerUnitPrice).toBe("18.00");
    expect(otherHits[0]?.promotionCode).toBe(promo.code);

    const draft = await openSalesOrderDraft(rep.id, { companyId: company.id, fresh: true });
    const saved = await saveSalesOrderDraft(rep.id, {
      draftId: draft.draft.id,
      contactId: contact.id,
      addressId: address.id,
      source: "TELEPHONE",
      lines: [{ variantId: priced.id, qty: 1 }],
    });
    expect(saved.review?.totals.subtotal).toBe("16.50");
    const reviewed = expectedFrom(saved.review!);

    await prisma.customerPrice.update({
      where: { companyId_variantId: { companyId: company.id, variantId: priced.id } },
      data: { unitPrice: "15.0000" },
    });
    const blocked = await placeSalesOrder(rep.id, {
      draftId: draft.draft.id,
      confirmAuthorised: true,
      idempotencyKey: `prot-block-${stamp}`,
      source: "TELEPHONE",
      contactId: contact.id,
      addressId: address.id,
      lines: [{ variantId: priced.id, qty: 1 }],
      expectedReview: reviewed,
    });
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) {
      expect(blocked.code).toBe("REVIEW_REQUIRED");
      expect(blocked.review.lines[0]?.customerUnitPrice).toBe("15.00");
    }
    expect(await prisma.order.count({ where: { companyId: company.id } })).toBe(0);

    const refreshed = await saveSalesOrderDraft(rep.id, {
      draftId: draft.draft.id,
      lines: [{ variantId: priced.id, qty: 1 }],
    });
    expect(refreshed.review?.totals.subtotal).toBe("15.00");
    await prisma.promotion.update({ where: { id: promo.id }, data: { appliesToNegotiatedPrices: true } });
    const discounted = await saveSalesOrderDraft(rep.id, {
      draftId: draft.draft.id,
      lines: [{ variantId: priced.id, qty: 1 }],
    });
    expect(discounted.review?.lines[0]?.customerUnitPrice).toBe("13.50");
    expect(discounted.review?.lines[0]?.promotionCode).toBe(promo.code);
    const placed = await placeSalesOrder(rep.id, {
      draftId: draft.draft.id,
      confirmAuthorised: true,
      idempotencyKey: `prot-place-${stamp}`,
      source: "TELEPHONE",
      contactId: contact.id,
      addressId: address.id,
      lines: [{ variantId: priced.id, qty: 1 }],
      expectedReview: expectedFrom(discounted.review!),
    });
    expect(placed.ok).toBe(true);
    await prisma.promotion.update({ where: { id: promo.id }, data: { isActive: false } });
  });

  it("requires review when the price changes and does not write an order", async () => {
    const stamp = Date.now();
    const variant = await seedVariant(`SOE-CHG-${stamp}`, 9, 1, 20);
    const { company, address, contact } = await seedCompany(`SOE Change ${stamp}`);
    const { user: rep } = await ensureRep(`soe-chg-${stamp}@example.invalid`, "SALES_REPRESENTATIVE", `CH${stamp}`);
    await assign(company.id, (await prisma.salesRep.findUniqueOrThrow({ where: { userId: rep.id } })).id, true);
    const draft = await openSalesOrderDraft(rep.id, { companyId: company.id, fresh: true });
    const saved = await saveSalesOrderDraft(rep.id, {
      draftId: draft.draft.id,
      contactId: contact.id,
      addressId: address.id,
      source: "CUSTOMER_VISIT",
      lines: [{ variantId: variant.id, qty: 1 }],
    });
    const reviewed = expectedFrom(saved.review!);
    const result = await placeSalesOrder(rep.id, {
      draftId: draft.draft.id,
      confirmAuthorised: true,
      idempotencyKey: `chg-${stamp}`,
      source: "CUSTOMER_VISIT",
      contactId: contact.id,
      addressId: address.id,
      lines: [{ variantId: variant.id, qty: 1 }],
      expectedReview: {
        ...reviewed,
        lines: [{ variantId: variant.id, qty: 1, customerUnitPrice: "1.00", lineNet: "1.00" }],
        subtotal: "1.00",
        grandTotal: "1.00",
      },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("REVIEW_REQUIRED");
      expect(result.review.lines[0]?.issue).toBe("PRICE_UPDATED");
      expect(result.review.lines[0]?.customerUnitPrice).toBe("9.00");
      expect(result.changes[0]?.previousUnitPrice).toBe("1.00");
      expect(result.changes[0]?.newUnitPrice).toBe("9.00");
    }
    const totalsOnly = await placeSalesOrder(rep.id, {
      draftId: draft.draft.id,
      confirmAuthorised: true,
      idempotencyKey: `chg-total-${stamp}`,
      source: "CUSTOMER_VISIT",
      contactId: contact.id,
      addressId: address.id,
      lines: [{ variantId: variant.id, qty: 1 }],
      expectedReview: { ...reviewed, grandTotal: "0.01" },
    });
    expect(totalsOnly.ok).toBe(false);
    if (!totalsOnly.ok) {
      expect(totalsOnly.totalsChanged).toBe(true);
      expect(totalsOnly.review.totals.grandTotal).toBe(reviewed.grandTotal);
    }
    await expect(
      placeSalesOrder(rep.id, {
        draftId: draft.draft.id,
        confirmAuthorised: true,
        idempotencyKey: `chg-missing-${stamp}`,
        source: "CUSTOMER_VISIT",
        contactId: contact.id,
        addressId: address.id,
        lines: [{ variantId: variant.id, qty: 1 }],
      }),
    ).rejects.toMatchObject({ code: "EXPECTED_PRICES_REQUIRED" });
    expect(await prisma.order.count({ where: { companyId: company.id } })).toBe(0);
    const reserved = await prisma.inventory.findFirstOrThrow({ where: { variantId: variant.id } });
    expect(reserved.qtyReserved).toBe(0);
    const still = await prisma.salesOrderDraft.findUniqueOrThrow({ where: { id: draft.draft.id } });
    expect(still.status).toBe("OPEN");
  });

  it("places once, reserves stock, attributes staff, emails the customer, and is idempotent", async () => {
    const stamp = Date.now();
    const variant = await seedVariant(`SOE-PLACE-${stamp}`, 8, 1, 15);
    const { company, address, contact } = await seedCompany(`SOE Place ${stamp}`);
    const buyerId = await ensureTradeBuyer(`soe-hist-${stamp}@example.invalid`, company.id);
    await addToBasket(buyerId, { variantId: variant.id, quantity: 2 });
    const { user: rep } = await ensureRep(
      `soe-place-${stamp}@example.invalid`,
      "SALES_REPRESENTATIVE",
      `PL${stamp}`,
    );
    await assign(company.id, (await prisma.salesRep.findUniqueOrThrow({ where: { userId: rep.id } })).id, true);
    const draft = await openSalesOrderDraft(rep.id, { companyId: company.id, fresh: true });
    const saved = await saveSalesOrderDraft(rep.id, {
      draftId: draft.draft.id,
      contactId: contact.id,
      addressId: address.id,
      source: "TELEPHONE",
      poNumber: "CUST-REF-9",
      deliveryInstructions: "Leave at trade counter",
      internalNote: "INTERNAL phone note",
      lines: [{ variantId: variant.id, qty: 2 }],
    });
    const key = `place-${stamp}-key`;
    const first = await placeSalesOrder(rep.id, {
      draftId: draft.draft.id,
      confirmAuthorised: true,
      idempotencyKey: key,
      source: "TELEPHONE",
      contactId: contact.id,
      addressId: address.id,
      poNumber: "CUST-REF-9",
      deliveryInstructions: "Leave at trade counter",
      internalNote: "INTERNAL phone note",
      lines: [{ variantId: variant.id, qty: 2 }],
      expectedReview: expectedFrom(saved.review!),
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.alreadyPlaced).toBe(false);
    expect(first.order.orderNumber).toMatch(/^AB-\d{6}$/);
    expect(first.order.placedByStaffName).toBe(rep.name);
    expect(first.order.entrySource).toBe("TELEPHONE");
    expect(first.order.contact?.email).toBe(contact.email);
    expect(first.order.subtotal).toBe("16.00");
    expect(first.order.deliveryTotal).toBe("5.95");
    expect(first.order.vatTotal).not.toBe("0.00");

    const order = await prisma.order.findUniqueOrThrow({
      where: { id: first.order.id },
      include: { items: true },
    });
    expect(order.orderedByUserId).toBe(rep.id);
    expect(order.onBehalfOfUserId).toBe(rep.id);
    expect(order.placedByStaffUserId).toBe(rep.id);
    expect(order.notes).toBe("INTERNAL phone note");
    expect(order.basketId).toBeNull();
    expect(Number(order.items[0]?.customerUnitPrice.toString())).toBe(8);
    expect(order.items[0]?.promotionId).toBeNull();

    const inv = await prisma.inventory.findFirstOrThrow({ where: { variantId: variant.id } });
    expect(inv.qtyOnHand).toBe(15);
    expect(inv.qtyReserved).toBe(2);
    const reservation = await prisma.orderStockReservation.findFirstOrThrow({ where: { orderId: order.id } });
    expect(reservation.quantity).toBe(2);

    const basket = await prisma.basket.findFirstOrThrow({
      where: { companyId: company.id, status: "OPEN" },
      include: { items: true },
    });
    expect(basket.items[0]?.qty).toBe(2);

    const portal = await import("@/server/orders/service").then((orders) => orders.getPortalOrder(buyerId, order.id));
    expect(portal.orderNumber).toBe(order.orderNumber);
    expect(portal.placedByStaffName).toBe(rep.name);

    const admin = await import("@/server/orders/service").then((orders) => orders.getAdminOrder(adminId, order.id));
    expect(admin.placedByStaffName).toBe(rep.name);

    const emails = await prisma.transactionalEmail.findMany({
      where: { entityId: order.id, purpose: "ORDER_RECEIVED" },
    });
    expect(emails).toHaveLength(1);
    expect(emails[0]?.toEmail).toBe(contact.email);
    expect(emails[0]?.textBody ?? emails[0]?.htmlBody).not.toContain("INTERNAL phone note");
    expect(await prisma.transactionalEmail.count({ where: { entityId: order.id, toEmail: rep.email } })).toBe(0);

    const activities = await prisma.activity.findMany({
      where: { companyId: company.id, metadata: { path: ["salesOrderId"], equals: order.id } },
    });
    expect(activities).toHaveLength(1);
    expect(activities[0]?.userId).toBe(rep.id);

    const second = await placeSalesOrder(rep.id, {
      draftId: draft.draft.id,
      confirmAuthorised: true,
      idempotencyKey: key,
      source: "TELEPHONE",
      contactId: contact.id,
      addressId: address.id,
      lines: [{ variantId: variant.id, qty: 2 }],
      expectedReview: expectedFrom(saved.review!),
    });
    expect(second.ok && second.alreadyPlaced && second.order.id).toBe(first.order.id);
    expect(await prisma.order.count({ where: { idempotencyKey: key } })).toBe(1);
    expect(await prisma.transactionalEmail.count({ where: { entityId: order.id, purpose: "ORDER_RECEIVED" } })).toBe(1);
    expect(
      await prisma.activity.count({
        where: { companyId: company.id, metadata: { path: ["salesOrderId"], equals: order.id } },
      }),
    ).toBe(1);
    const invAfter = await prisma.inventory.findFirstOrThrow({ where: { variantId: variant.id } });
    expect(invAfter.qtyReserved).toBe(2);
  });

  it("rolls back when concurrent placement would oversell", async () => {
    const stamp = Date.now();
    const variant = await seedVariant(`SOE-RACE-${stamp}`, 2, 12, 12);
    await prisma.productVariant.update({ where: { id: variant.id }, data: { backorderPolicy: "DENY" } });
    const a = await seedCompany(`SOE Race A ${stamp}`);
    const b = await seedCompany(`SOE Race B ${stamp}`);
    const { user: rep } = await ensureRep(`soe-race-${stamp}@example.invalid`, "SALES_REPRESENTATIVE", `RC${stamp}`);
    const salesRepId = (await prisma.salesRep.findUniqueOrThrow({ where: { userId: rep.id } })).id;
    await assign(a.company.id, salesRepId, true);
    await assign(b.company.id, salesRepId, false);
    const draftA = await openSalesOrderDraft(rep.id, { companyId: a.company.id, fresh: true });
    const draftB = await openSalesOrderDraft(rep.id, { companyId: b.company.id, fresh: true });
    const savedA = await saveSalesOrderDraft(rep.id, {
      draftId: draftA.draft.id,
      contactId: a.contact.id,
      addressId: a.address.id,
      source: "EMAIL",
      lines: [{ variantId: variant.id, qty: 12 }],
    });
    const savedB = await saveSalesOrderDraft(rep.id, {
      draftId: draftB.draft.id,
      contactId: b.contact.id,
      addressId: b.address.id,
      source: "EMAIL",
      lines: [{ variantId: variant.id, qty: 12 }],
    });
    const body = (
      draftId: string,
      contactId: string,
      addressId: string,
      key: string,
      review: NonNullable<typeof savedA.review>,
    ) => ({
      draftId,
      confirmAuthorised: true as const,
      idempotencyKey: key,
      source: "EMAIL" as const,
      contactId,
      addressId,
      lines: [{ variantId: variant.id, qty: 12 }],
      expectedReview: expectedFrom(review),
    });
    const results = await Promise.allSettled([
      placeSalesOrder(rep.id, body(draftA.draft.id, a.contact.id, a.address.id, `race-a-${stamp}`, savedA.review!)),
      placeSalesOrder(rep.id, body(draftB.draft.id, b.contact.id, b.address.id, `race-b-${stamp}`, savedB.review!)),
    ]);
    const orders = await prisma.order.count({
      where: { items: { some: { variantId: variant.id } } },
    });
    expect(orders).toBe(1);
    const inv = await prisma.inventory.findFirstOrThrow({ where: { variantId: variant.id } });
    expect(inv.qtyReserved).toBe(12);
    expect(inv.qtyOnHand).toBe(12);
    const placed = results.filter((result) => result.status === "fulfilled" && result.value.ok);
    expect(placed.length).toBe(1);
    const openDrafts = await prisma.salesOrderDraft.count({
      where: { id: { in: [draftA.draft.id, draftB.draft.id] }, status: "OPEN" },
    });
    expect(openDrafts).toBe(1);
  });

  it("lets management place for an active account and keeps portal checkout unstamped", async () => {
    const stamp = Date.now();
    const variant = await seedVariant(`SOE-MGMT-${stamp}`, 5, 1, 10);
    const { company, address, contact } = await seedCompany(`SOE Mgmt ${stamp}`);
    const management = await ensureUser(`soe-mgmt-${stamp}@example.invalid`, ["MANAGEMENT"], "INTERNAL", "Alex Morgan");
    const draft = await openSalesOrderDraft(management.id, { companyId: company.id, fresh: true });
    const saved = await saveSalesOrderDraft(management.id, {
      draftId: draft.draft.id,
      contactId: contact.id,
      addressId: address.id,
      source: "CUSTOMER_VISIT",
      lines: [{ variantId: variant.id, qty: 1 }],
    });
    const placed = await placeSalesOrder(management.id, {
      draftId: draft.draft.id,
      confirmAuthorised: true,
      idempotencyKey: `mgmt-${stamp}`,
      source: "CUSTOMER_VISIT",
      contactId: contact.id,
      addressId: address.id,
      lines: [{ variantId: variant.id, qty: 1 }],
      expectedReview: expectedFrom(saved.review!),
    });
    expect(placed.ok && placed.order.placedByStaffName).toBe("Alex Morgan");

    const buyerId = await ensureTradeBuyer(`soe-portal-${stamp}@example.invalid`, company.id);
    await addToBasket(buyerId, { variantId: variant.id, quantity: 1 });
    const portal = await placeOrder(buyerId, {
      idempotencyKey: `portal-${stamp}-checkout`,
      addressId: address.id,
    });
    expect(portal.ok).toBe(true);
    if (!portal.ok) return;
    const row = await prisma.order.findUniqueOrThrow({ where: { id: portal.order.id } });
    expect(row.entrySource).toBeNull();
    expect(row.placedByStaffUserId).toBeNull();
    expect(row.onBehalfOfUserId).toBeNull();
    expect(row.orderedByUserId).toBe(buyerId);
    expect(row.basketId).toBeTruthy();
  });

  it("accepts an existing quotation once and leaves direct quote acceptance unchanged", async () => {
    const stamp = Date.now();
    const variant = await seedVariant(`SOE-QT-${stamp}`, 11, 1, 20);
    const { company, contact } = await seedCompany(`SOE Quote ${stamp}`);
    const { user: rep } = await ensureRep(`soe-qt-${stamp}@example.invalid`, "SALES_REPRESENTATIVE", `QT${stamp}`);
    await assign(company.id, (await prisma.salesRep.findUniqueOrThrow({ where: { userId: rep.id } })).id, true);

    const direct = await createQuote(adminId, {
      companyId: company.id,
      contactId: contact.id,
      validUntil: "2099-12-31",
    });
    await updateQuoteDraft(adminId, {
      id: direct.id,
      lines: [{ variantId: variant.id, qty: 1 }],
      validUntil: "2099-12-31",
    });
    await sendQuote(adminId, { id: direct.id });
    const behalf = await acceptQuoteOnBehalf(adminId, {
      id: direct.id,
      idempotencyKey: `direct-behalf-${stamp}`,
      note: "Existing accept-on-behalf path",
    });
    const directOrder = await prisma.order.findUniqueOrThrow({ where: { id: behalf.orderId } });
    expect(directOrder.onBehalfOfUserId).toBe(adminId);
    expect(directOrder.entrySource).toBeNull();
    expect(behalf.alreadyConverted).toBe(false);
    const again = await acceptQuoteOnBehalf(adminId, {
      id: direct.id,
      idempotencyKey: `direct-behalf-${stamp}-2`,
      note: "Existing accept-on-behalf path",
    });
    expect(again.alreadyConverted).toBe(true);
    expect(await prisma.order.count({ where: { sourceQuoteId: direct.id } })).toBe(1);

    const quoted = await seedVariant(`SOE-QT2-${stamp}`, 12, 1, 20);
    const draftQuote = await createQuote(adminId, {
      companyId: company.id,
      contactId: contact.id,
      validUntil: "2099-12-31",
    });
    await updateQuoteDraft(adminId, {
      id: draftQuote.id,
      lines: [{ variantId: quoted.id, qty: 1, quotedUnitPrice: "7.5000" }],
      validUntil: "2099-12-31",
    });
    await sendQuote(adminId, { id: draftQuote.id });
    const sent = await prisma.quoteItem.findFirstOrThrow({ where: { quoteId: draftQuote.id } });
    await prisma.customerPrice.create({
      data: { companyId: company.id, variantId: quoted.id, unitPrice: "1.0000" },
    });
    const draft = await openSalesOrderDraft(rep.id, { companyId: company.id, fresh: true });
    const placed = await placeSalesOrder(rep.id, {
      draftId: draft.draft.id,
      confirmAuthorised: true,
      idempotencyKey: `quote-entry-${stamp}`,
      source: "EMAIL",
      quoteId: draftQuote.id,
      internalNote: "INTERNAL quote note",
    });
    expect(placed.ok && placed.alreadyPlaced).toBe(false);
    if (!placed.ok) return;
    const converted = await prisma.order.findUniqueOrThrow({
      where: { id: placed.order.id },
      include: { items: true },
    });
    expect(converted.items[0]?.customerUnitPrice.toString()).toBe(sent.customerUnitPrice.toString());
    expect(Number(converted.items[0]?.customerUnitPrice.toString())).not.toBe(1);
    expect(converted.entrySource).toBe("EMAIL");
    expect(converted.placedByStaffUserId).toBe(rep.id);
    expect(converted.placedByStaffName).toBe(rep.name);
    expect(converted.salesOrderDraftId).toBe(draft.draft.id);
    expect(converted.notes).toBe("INTERNAL quote note");
    expect(converted.subtotal.toString()).toBe(sent.lineTotal.toString());
    const emails = await prisma.transactionalEmail.count({
      where: { entityId: converted.id, purpose: "ORDER_RECEIVED" },
    });
    const quoteEmails = await prisma.transactionalEmail.findMany({
      where: { entityId: converted.id, purpose: "ORDER_RECEIVED" },
    });
    expect(quoteEmails.some((email) => (email.textBody ?? "").includes("INTERNAL quote note"))).toBe(false);
    const repeat = await placeSalesOrder(rep.id, {
      draftId: draft.draft.id,
      confirmAuthorised: true,
      idempotencyKey: `quote-entry-${stamp}-again`,
      source: "TELEPHONE",
      internalNote: "Do not overwrite the original note",
      quoteId: draftQuote.id,
    });
    expect(repeat.ok && repeat.alreadyPlaced && repeat.order.id).toBe(converted.id);
    const afterRepeat = await prisma.order.findUniqueOrThrow({ where: { id: converted.id } });
    expect(afterRepeat.entrySource).toBe("EMAIL");
    expect(afterRepeat.placedByStaffUserId).toBe(rep.id);
    expect(afterRepeat.notes).toBe("INTERNAL quote note");
    expect(await prisma.order.count({ where: { sourceQuoteId: draftQuote.id } })).toBe(1);
    expect(
      await prisma.transactionalEmail.count({ where: { entityId: converted.id, purpose: "ORDER_RECEIVED" } }),
    ).toBe(emails);
    expect(
      await prisma.activity.count({
        where: { companyId: company.id, metadata: { path: ["salesOrderId"], equals: converted.id } },
      }),
    ).toBe(1);
  });

  it("backorders only the unavailable units and reserves the rest", async () => {
    const stamp = Date.now();
    const variant = await seedVariant(`SOE-BO-${stamp}`, 4, 1, 3);
    await prisma.productVariant.update({ where: { id: variant.id }, data: { backorderPolicy: "ALLOW" } });
    const { company, address, contact } = await seedCompany(`SOE Backorder ${stamp}`);
    const management = await ensureUser(`soe-bo-${stamp}@example.invalid`, ["MANAGEMENT"], "INTERNAL", "Morgan");
    const draft = await openSalesOrderDraft(management.id, { companyId: company.id, fresh: true });
    const denied = await seedVariant(`SOE-DENY-${stamp}`, 4, 1, 0);
    await prisma.productVariant.update({ where: { id: denied.id }, data: { backorderPolicy: "DENY" } });
    const blocked = await saveSalesOrderDraft(management.id, {
      draftId: draft.draft.id,
      lines: [{ variantId: denied.id, qty: 1 }],
    });
    expect(blocked.review?.hasBlockingIssues).toBe(true);

    const ready = await saveSalesOrderDraft(management.id, {
      draftId: draft.draft.id,
      contactId: contact.id,
      addressId: address.id,
      source: "TELEPHONE",
      lines: [{ variantId: variant.id, qty: 5 }],
    });
    const placed = await placeSalesOrder(management.id, {
      draftId: draft.draft.id,
      confirmAuthorised: true,
      idempotencyKey: `bo-${stamp}`,
      source: "TELEPHONE",
      contactId: contact.id,
      addressId: address.id,
      lines: [{ variantId: variant.id, qty: 5 }],
      expectedReview: expectedFrom(ready.review!),
      backorderAcknowledged: true,
    });
    expect(placed.ok).toBe(true);
    if (!placed.ok) return;
    const item = await prisma.orderItem.findFirstOrThrow({ where: { orderId: placed.order.id } });
    expect(item.availableQtyAtOrder).toBe(3);
    expect(item.backorderQtyAtOrder).toBe(2);
    const inv = await prisma.inventory.findFirstOrThrow({ where: { variantId: variant.id } });
    expect(inv.qtyReserved).toBe(3);
    expect(inv.qtyOnHand).toBe(3);
    const stored = await prisma.order.findUniqueOrThrow({ where: { id: placed.order.id } });
    expect(stored.backorderAcknowledgedByUserId).toBe(management.id);
    expect(stored.backorderAcknowledgedAt).toBeTruthy();
  });

  it("keeps one order when placement races abandon or a second submit", async () => {
    const stamp = Date.now();
    const variant = await seedVariant(`SOE-LOCK-${stamp}`, 6, 1, 30);
    const { company, address, contact } = await seedCompany(`SOE Lock ${stamp}`);
    const { user: rep } = await ensureRep(`soe-lock-${stamp}@example.invalid`, "SALES_REPRESENTATIVE", `LK${stamp}`);
    await assign(company.id, (await prisma.salesRep.findUniqueOrThrow({ where: { userId: rep.id } })).id, true);

    const abandonDraft = await openSalesOrderDraft(rep.id, { companyId: company.id, fresh: true });
    const abandonSaved = await saveSalesOrderDraft(rep.id, {
      draftId: abandonDraft.draft.id,
      contactId: contact.id,
      addressId: address.id,
      source: "TELEPHONE",
      lines: [{ variantId: variant.id, qty: 1 }],
    });
    const abandonRace = await Promise.allSettled([
      placeSalesOrder(rep.id, {
        draftId: abandonDraft.draft.id,
        confirmAuthorised: true,
        idempotencyKey: `lock-place-${stamp}`,
        source: "TELEPHONE",
        contactId: contact.id,
        addressId: address.id,
        lines: [{ variantId: variant.id, qty: 1 }],
        expectedReview: expectedFrom(abandonSaved.review!),
      }),
      abandonSalesOrderDraft(rep.id, { draftId: abandonDraft.draft.id }),
    ]);
    const abandonOrders = await prisma.order.count({ where: { salesOrderDraftId: abandonDraft.draft.id } });
    const abandonRow = await prisma.salesOrderDraft.findUniqueOrThrow({ where: { id: abandonDraft.draft.id } });
    const placeWon = abandonRace[0].status === "fulfilled" && abandonRace[0].value.ok;
    const abandonWon = abandonRace[1].status === "fulfilled";
    expect(Number(placeWon) + Number(abandonWon)).toBe(1);
    if (abandonRow.status === "PLACED") {
      expect(abandonOrders).toBe(1);
      expect(abandonRace[1].status).toBe("rejected");
    } else {
      expect(abandonRow.status).toBe("ABANDONED");
      expect(abandonOrders).toBe(0);
      expect(abandonRace[0].status).toBe("rejected");
    }

    const duplicate = await openSalesOrderDraft(rep.id, { companyId: company.id, fresh: true });
    const duplicateSaved = await saveSalesOrderDraft(rep.id, {
      draftId: duplicate.draft.id,
      contactId: contact.id,
      addressId: address.id,
      source: "EMAIL",
      lines: [{ variantId: variant.id, qty: 2 }],
    });
    const duplicateBody = (key: string) => ({
      draftId: duplicate.draft.id,
      confirmAuthorised: true as const,
      idempotencyKey: key,
      source: "EMAIL" as const,
      contactId: contact.id,
      addressId: address.id,
      lines: [{ variantId: variant.id, qty: 2 }],
      expectedReview: expectedFrom(duplicateSaved.review!),
    });
    const duplicated = await Promise.allSettled([
      placeSalesOrder(rep.id, duplicateBody(`lock-a-${stamp}`)),
      placeSalesOrder(rep.id, duplicateBody(`lock-b-${stamp}`)),
    ]);
    expect(await prisma.order.count({ where: { salesOrderDraftId: duplicate.draft.id } })).toBe(1);
    expect(duplicated.filter((result) => result.status === "fulfilled" && result.value.ok)).toHaveLength(1);
    expect(duplicated.filter((result) => result.status === "rejected")).toHaveLength(1);
    const reserved = await prisma.inventory.findFirstOrThrow({ where: { variantId: variant.id } });
    const reservedQty = await prisma.orderItem.aggregate({
      where: { variantId: variant.id },
      _sum: { availableQtyAtOrder: true },
    });
    expect(reserved.qtyReserved).toBe(reservedQty._sum.availableQtyAtOrder ?? 0);

    const editing = await openSalesOrderDraft(rep.id, { companyId: company.id, fresh: true });
    await saveSalesOrderDraft(rep.id, {
      draftId: editing.draft.id,
      contactId: contact.id,
      addressId: address.id,
      source: "TELEPHONE",
      lines: [{ variantId: variant.id, qty: 1 }],
    });
    const editingSaved = await getSalesOrderDraft(rep.id, { draftId: editing.draft.id });
    const editRace = await Promise.allSettled([
      placeSalesOrder(rep.id, {
        draftId: editing.draft.id,
        confirmAuthorised: true,
        idempotencyKey: `lock-edit-${stamp}`,
        source: "TELEPHONE",
        contactId: contact.id,
        addressId: address.id,
        lines: [{ variantId: variant.id, qty: 1 }],
        expectedReview: expectedFrom(editingSaved.review!),
      }),
      saveSalesOrderDraft(rep.id, {
        draftId: editing.draft.id,
        lines: [{ variantId: variant.id, qty: 3 }],
      }),
    ]);
    const editOrder = await prisma.order.findFirst({
      where: { salesOrderDraftId: editing.draft.id },
      include: { items: true },
    });
    const editDraft = await prisma.salesOrderDraft.findUniqueOrThrow({
      where: { id: editing.draft.id },
      include: { lines: true },
    });
    expect(editRace.filter((result) => result.status === "rejected").length).toBeGreaterThan(0);
    if (editOrder) {
      expect(editDraft.status).toBe("PLACED");
      expect(editOrder.items[0]?.qty).toBe(editDraft.lines[0]?.qty);
    } else {
      expect(editDraft.status).toBe("OPEN");
      expect(editDraft.lines[0]?.qty).toBe(3);
    }
    expect(await prisma.order.count({ where: { salesOrderDraftId: editing.draft.id } })).toBeLessThanOrEqual(1);
  });

  it("stops access after reassignment, revocation, or an inactive account", async () => {
    const stamp = Date.now();
    const { user: rep } = await ensureRep(`soe-revoke-${stamp}@example.invalid`, "SALES_REPRESENTATIVE", `RV${stamp}`);
    const { user: other } = await ensureRep(`soe-newrep-${stamp}@example.invalid`, "SALES_REPRESENTATIVE", `NW${stamp}`);
    const salesRep = await prisma.salesRep.findUniqueOrThrow({ where: { userId: rep.id } });
    const otherRep = await prisma.salesRep.findUniqueOrThrow({ where: { userId: other.id } });
    const { company, address, contact } = await seedCompany(`SOE Revoke ${stamp}`);
    const assignment = await prisma.companyAssignment.create({
      data: { companyId: company.id, salesRepId: salesRep.id, isPrimary: true },
    });
    const variant = await seedVariant(`SOE-RV-${stamp}`, 4, 1, 8);
    const draft = await openSalesOrderDraft(rep.id, { companyId: company.id, fresh: true });
    await saveSalesOrderDraft(rep.id, {
      draftId: draft.draft.id,
      contactId: contact.id,
      addressId: address.id,
      lines: [{ variantId: variant.id, qty: 1 }],
    });

    await prisma.companyAssignment.delete({ where: { id: assignment.id } });
    const stillMine = await getSalesOrderDraft(rep.id, { draftId: draft.draft.id });
    expect(stillMine.draft.id).toBe(draft.draft.id);
    expect(stillMine.assignedSalesRep).toBeNull();
    await saveSalesOrderDraft(rep.id, { draftId: draft.draft.id, poNumber: "STILL-MINE" });
    expect((await listSalesOrderDrafts(rep.id)).some((row) => row.id === draft.draft.id)).toBe(true);
    const stillOpen = await prisma.salesOrderDraft.findUniqueOrThrow({ where: { id: draft.draft.id } });
    expect(stillOpen.status).toBe("OPEN");
    expect(stillOpen.poNumber).toBe("STILL-MINE");

    await prisma.companyAssignment.create({
      data: { companyId: company.id, salesRepId: otherRep.id, isPrimary: true },
    });
    const afterReassignment = await getSalesOrderDraft(rep.id, { draftId: draft.draft.id });
    expect(afterReassignment.assignedSalesRep?.code).toBe(otherRep.code);
    await expect(getSalesOrderDraft(other.id, { draftId: draft.draft.id })).rejects.toMatchObject({
      code: "DRAFT_NOT_FOUND",
    });
    const otherDraft = await openSalesOrderDraft(other.id, { companyId: company.id, fresh: true });
    expect(otherDraft.draft.id).not.toBe(draft.draft.id);

    await prisma.companyAssignment.create({
      data: { companyId: company.id, salesRepId: salesRep.id, isPrimary: false },
    });
    await prisma.company.update({ where: { id: company.id }, data: { status: "SUSPENDED" } });
    await expect(getSalesOrderDraft(rep.id, { draftId: draft.draft.id })).rejects.toMatchObject({
      code: "COMPANY_NOT_ACTIVE",
    });
    await expect(
      placeSalesOrder(rep.id, {
        draftId: draft.draft.id,
        confirmAuthorised: true,
        idempotencyKey: `inactive-${stamp}`,
        source: "TELEPHONE",
        contactId: contact.id,
        addressId: address.id,
        lines: [{ variantId: variant.id, qty: 1 }],
        expectedReview: {
          lines: [{ variantId: variant.id, qty: 1, customerUnitPrice: "4.00", lineNet: "4.00" }],
          subtotal: "4.00",
          vatTotal: "0.80",
          deliveryTotal: "5.95",
          grandTotal: "10.75",
        },
      }),
    ).rejects.toMatchObject({ code: "COMPANY_NOT_ACTIVE" });
    expect(await prisma.order.count({ where: { companyId: company.id } })).toBe(0);
  });

  it("records a CRM failure and repairs the activity without sending another email", async () => {
    const stamp = Date.now();
    const variant = await seedVariant(`SOE-CRM-${stamp}`, 5, 1, 10);
    const { company, address, contact } = await seedCompany(`SOE CRM ${stamp}`);
    const { user: rep } = await ensureRep(`soe-crm-${stamp}@example.invalid`, "SALES_REPRESENTATIVE", `CRM${stamp}`);
    await assign(company.id, (await prisma.salesRep.findUniqueOrThrow({ where: { userId: rep.id } })).id, true);
    const draft = await openSalesOrderDraft(rep.id, { companyId: company.id, fresh: true });
    const saved = await saveSalesOrderDraft(rep.id, {
      draftId: draft.draft.id,
      contactId: contact.id,
      addressId: address.id,
      source: "TELEPHONE",
      internalNote: "INTERNAL crm note",
      lines: [{ variantId: variant.id, qty: 1 }],
    });
    const original = salesOrderCrmDependencies.createActivity;
    salesOrderCrmDependencies.createActivity = async () => {
      throw new Error("crm down");
    };
    let placed: Awaited<ReturnType<typeof placeSalesOrder>>;
    try {
      placed = await placeSalesOrder(rep.id, {
        draftId: draft.draft.id,
        confirmAuthorised: true,
        idempotencyKey: `crm-${stamp}`,
        source: "TELEPHONE",
        contactId: contact.id,
        addressId: address.id,
        internalNote: "INTERNAL crm note",
        lines: [{ variantId: variant.id, qty: 1 }],
        expectedReview: expectedFrom(saved.review!),
      });
    } finally {
      salesOrderCrmDependencies.createActivity = original;
    }
    expect(placed!.ok).toBe(true);
    if (!placed!.ok) return;
    expect(
      await prisma.activity.count({
        where: { companyId: company.id, metadata: { path: ["salesOrderId"], equals: placed.order.id } },
      }),
    ).toBe(0);
    const failure = await prisma.auditEvent.findFirst({
      where: { action: "order.crm_activity_failed", entityId: placed.order.id },
    });
    expect(failure).toBeTruthy();
    expect(await prisma.transactionalEmail.count({ where: { entityId: placed.order.id, purpose: "ORDER_RECEIVED" } })).toBe(1);

    const repaired = await placeSalesOrder(rep.id, {
      draftId: draft.draft.id,
      confirmAuthorised: true,
      idempotencyKey: `crm-${stamp}`,
      source: "TELEPHONE",
      contactId: contact.id,
      addressId: address.id,
      lines: [{ variantId: variant.id, qty: 1 }],
      expectedReview: expectedFrom(saved.review!),
    });
    expect(repaired.ok && repaired.alreadyPlaced).toBe(true);
    const activities = await prisma.activity.findMany({
      where: { companyId: company.id, metadata: { path: ["salesOrderId"], equals: placed.order.id } },
    });
    expect(activities).toHaveLength(1);
    expect(activities[0]?.body).toContain("INTERNAL crm note");
    expect(await prisma.transactionalEmail.count({ where: { entityId: placed.order.id, purpose: "ORDER_RECEIVED" } })).toBe(1);
    const again = await ensureSalesOrderCrmActivity({
      actorUserId: rep.id,
      companyId: company.id,
      orderId: placed.order.id,
      orderNumber: placed.order.orderNumber,
      source: "TELEPHONE",
      internalNote: "INTERNAL crm note",
    });
    expect(again).toBe("exists");
    expect(
      await prisma.activity.count({
        where: { companyId: company.id, metadata: { path: ["salesOrderId"], equals: placed.order.id } },
      }),
    ).toBe(1);
    expect(await prisma.orderStockReservation.count({ where: { orderId: placed.order.id } })).toBe(1);
  });

  it("rejects an idempotency key reused for another draft, customer, or staff member", async () => {
    const stamp = Date.now();
    const variant = await seedVariant(`SOE-IDEM-${stamp}`, 6, 1, 40);
    const { company, address, contact } = await seedCompany(`SOE Idem ${stamp}`);
    const otherCustomer = await seedCompany(`SOE Idem Other ${stamp}`);
    const { user: rep } = await ensureRep(`soe-idem-${stamp}@example.invalid`, "SALES_REPRESENTATIVE", `ID${stamp}`);
    const { user: otherRep } = await ensureRep(`soe-idem-b-${stamp}@example.invalid`, "SALES_REPRESENTATIVE", `IB${stamp}`);
    const repRecord = await prisma.salesRep.findUniqueOrThrow({ where: { userId: rep.id } });
    await assign(company.id, repRecord.id, true);

    const draft = await openSalesOrderDraft(rep.id, { companyId: company.id, fresh: true });
    const saved = await saveSalesOrderDraft(rep.id, {
      draftId: draft.draft.id,
      contactId: contact.id,
      addressId: address.id,
      source: "TELEPHONE",
      lines: [{ variantId: variant.id, qty: 1 }],
    });
    const key = `idem-reuse-${stamp}`;
    const placed = await placeSalesOrder(rep.id, {
      draftId: draft.draft.id,
      confirmAuthorised: true,
      idempotencyKey: key,
      source: "TELEPHONE",
      contactId: contact.id,
      addressId: address.id,
      lines: [{ variantId: variant.id, qty: 1 }],
      expectedReview: expectedFrom(saved.review!),
    });
    expect(placed.ok && placed.alreadyPlaced).toBe(false);
    if (!placed.ok) return;

    const retry = await placeSalesOrder(rep.id, {
      draftId: draft.draft.id,
      confirmAuthorised: true,
      idempotencyKey: key,
      source: "TELEPHONE",
      contactId: contact.id,
      addressId: address.id,
      lines: [{ variantId: variant.id, qty: 1 }],
      expectedReview: expectedFrom(saved.review!),
    });
    expect(retry.ok && retry.alreadyPlaced && retry.order.id).toBe(placed.order.id);

    const secondDraft = await openSalesOrderDraft(rep.id, { companyId: company.id, fresh: true });
    const secondSaved = await saveSalesOrderDraft(rep.id, {
      draftId: secondDraft.draft.id,
      contactId: contact.id,
      addressId: address.id,
      source: "EMAIL",
      lines: [{ variantId: variant.id, qty: 1 }],
    });
    await expect(
      placeSalesOrder(rep.id, {
        draftId: secondDraft.draft.id,
        confirmAuthorised: true,
        idempotencyKey: key,
        source: "EMAIL",
        contactId: contact.id,
        addressId: address.id,
        lines: [{ variantId: variant.id, qty: 1 }],
        expectedReview: expectedFrom(secondSaved.review!),
      }),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });

    const otherDraft = await openSalesOrderDraft(rep.id, { companyId: otherCustomer.company.id, fresh: true });
    const otherSaved = await saveSalesOrderDraft(rep.id, {
      draftId: otherDraft.draft.id,
      contactId: otherCustomer.contact.id,
      addressId: otherCustomer.address.id,
      source: "CUSTOMER_VISIT",
      lines: [{ variantId: variant.id, qty: 1 }],
    });
    await expect(
      placeSalesOrder(rep.id, {
        draftId: otherDraft.draft.id,
        confirmAuthorised: true,
        idempotencyKey: key,
        source: "CUSTOMER_VISIT",
        contactId: otherCustomer.contact.id,
        addressId: otherCustomer.address.id,
        lines: [{ variantId: variant.id, qty: 1 }],
        expectedReview: expectedFrom(otherSaved.review!),
      }),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });

    const staffDraft = await openSalesOrderDraft(otherRep.id, { companyId: company.id, fresh: true });
    const staffSaved = await saveSalesOrderDraft(otherRep.id, {
      draftId: staffDraft.draft.id,
      contactId: contact.id,
      addressId: address.id,
      source: "TELEPHONE",
      lines: [{ variantId: variant.id, qty: 1 }],
    });
    await expect(
      placeSalesOrder(otherRep.id, {
        draftId: staffDraft.draft.id,
        confirmAuthorised: true,
        idempotencyKey: key,
        source: "TELEPHONE",
        contactId: contact.id,
        addressId: address.id,
        lines: [{ variantId: variant.id, qty: 1 }],
        expectedReview: expectedFrom(staffSaved.review!),
      }),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });

    expect(await prisma.order.count({ where: { OR: [{ idempotencyKey: key }, { companyId: company.id }] } })).toBe(1);
    expect(await prisma.order.count({ where: { companyId: otherCustomer.company.id } })).toBe(0);
    expect(await prisma.orderStockReservation.count({ where: { orderId: placed.order.id } })).toBe(1);
    expect(await prisma.transactionalEmail.count({ where: { entityId: placed.order.id, purpose: "ORDER_RECEIVED" } })).toBe(1);
    expect((await prisma.salesOrderDraft.findUniqueOrThrow({ where: { id: secondDraft.draft.id } })).status).toBe("OPEN");
    expect((await prisma.salesOrderDraft.findUniqueOrThrow({ where: { id: staffDraft.draft.id } })).status).toBe("OPEN");
  });

  it("keeps one order when the same draft is placed concurrently with one key", async () => {
    const stamp = Date.now();
    const variant = await seedVariant(`SOE-RACE-${stamp}`, 8, 1, 20);
    const { company, address, contact } = await seedCompany(`SOE Race ${stamp}`);
    const { user: rep } = await ensureRep(`soe-race-${stamp}@example.invalid`, "SALES_REPRESENTATIVE", `RC${stamp}`);
    const draft = await openSalesOrderDraft(rep.id, { companyId: company.id, fresh: true });
    const saved = await saveSalesOrderDraft(rep.id, {
      draftId: draft.draft.id,
      contactId: contact.id,
      addressId: address.id,
      source: "TELEPHONE",
      lines: [{ variantId: variant.id, qty: 2 }],
    });
    const body = {
      draftId: draft.draft.id,
      confirmAuthorised: true as const,
      idempotencyKey: `race-same-${stamp}`,
      source: "TELEPHONE" as const,
      contactId: contact.id,
      addressId: address.id,
      lines: [{ variantId: variant.id, qty: 2 }],
      expectedReview: expectedFrom(saved.review!),
    };
    const raced = await Promise.allSettled([placeSalesOrder(rep.id, body), placeSalesOrder(rep.id, body)]);
    expect(raced.every((result) => result.status === "fulfilled" && result.value.ok)).toBe(true);
    const orders = await prisma.order.findMany({ where: { salesOrderDraftId: draft.draft.id } });
    expect(orders).toHaveLength(1);
    expect(await prisma.orderStockReservation.count({ where: { orderId: orders[0]!.id } })).toBe(1);
    expect(await prisma.transactionalEmail.count({ where: { entityId: orders[0]!.id, purpose: "ORDER_RECEIVED" } })).toBe(1);
    const reserved = await prisma.inventory.findFirstOrThrow({ where: { variantId: variant.id } });
    expect(reserved.qtyReserved).toBe(2);
  });

  it("replays a completed quotation conversion without a second order or email", async () => {
    const stamp = Date.now();
    const variant = await seedVariant(`SOE-QID-${stamp}`, 9, 1, 12);
    const { company, contact } = await seedCompany(`SOE Qid ${stamp}`);
    const { user: rep } = await ensureRep(`soe-qid-${stamp}@example.invalid`, "SALES_REPRESENTATIVE", `QI${stamp}`);
    await assign(company.id, (await prisma.salesRep.findUniqueOrThrow({ where: { userId: rep.id } })).id, true);
    const quote = await createQuote(adminId, { companyId: company.id, contactId: contact.id, validUntil: "2099-12-31" });
    await updateQuoteDraft(adminId, {
      id: quote.id,
      lines: [{ variantId: variant.id, qty: 1 }],
      validUntil: "2099-12-31",
    });
    await sendQuote(adminId, { id: quote.id });
    const draft = await openSalesOrderDraft(rep.id, { companyId: company.id, fresh: true });
    const key = `quote-idem-${stamp}`;
    const placed = await placeSalesOrder(rep.id, {
      draftId: draft.draft.id,
      confirmAuthorised: true,
      idempotencyKey: key,
      source: "EMAIL",
      quoteId: quote.id,
      internalNote: "INTERNAL quote replay",
    });
    expect(placed.ok && placed.alreadyPlaced).toBe(false);
    if (!placed.ok) return;
    const replay = await placeSalesOrder(rep.id, {
      draftId: draft.draft.id,
      confirmAuthorised: true,
      idempotencyKey: key,
      source: "EMAIL",
      quoteId: quote.id,
    });
    expect(replay.ok && replay.alreadyPlaced && replay.order.id).toBe(placed.order.id);
    expect(await prisma.order.count({ where: { sourceQuoteId: quote.id } })).toBe(1);
    expect(await prisma.transactionalEmail.count({ where: { entityId: placed.order.id, purpose: "ORDER_RECEIVED" } })).toBe(1);
    expect(await prisma.orderStockReservation.count({ where: { orderId: placed.order.id } })).toBe(1);

    const other = await createQuote(adminId, { companyId: company.id, contactId: contact.id, validUntil: "2099-12-31" });
    await updateQuoteDraft(adminId, {
      id: other.id,
      lines: [{ variantId: variant.id, qty: 1 }],
      validUntil: "2099-12-31",
    });
    await sendQuote(adminId, { id: other.id });
    const otherDraft = await openSalesOrderDraft(rep.id, { companyId: company.id, fresh: true });
    await expect(
      placeSalesOrder(rep.id, {
        draftId: otherDraft.draft.id,
        confirmAuthorised: true,
        idempotencyKey: key,
        source: "EMAIL",
        quoteId: other.id,
      }),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
    expect((await prisma.quote.findUniqueOrThrow({ where: { id: other.id } })).status).not.toBe("CONVERTED");
  });

  it("pages every matching active account and searches aliases and contact numbers", async () => {
    const stamp = `${Date.now()}`;
    const { user: rep } = await ensureRep(`soe-search-${stamp}@example.invalid`, "SALES_REPRESENTATIVE", `SE${stamp.slice(-6)}`);
    const hidden = await prisma.company.create({
      data: { name: `${stamp} Hidden`, status: "SUSPENDED", accountNumber: `HID-${stamp}` },
    });
    const alpha = await prisma.company.create({
      data: {
        name: `${stamp} Alpha`,
        tradingName: `${stamp} Motors`,
        accountNumber: `ACC-${stamp}`,
        autopartCustomerCode: `AP${stamp.slice(-8)}`,
        phone: `0114${stamp.slice(-7)}`,
        primaryEmail: `desk-${stamp}@example.invalid`,
        status: "ACTIVE",
      },
    });
    await prisma.contact.create({
      data: {
        companyId: alpha.id,
        firstName: `Nia${stamp.slice(-6)}`,
        lastName: `Keane${stamp.slice(-6)}`,
        email: `nia-${stamp}@example.invalid`,
        phone: `0121${stamp.slice(-7)}`,
        mobile: `07700${stamp.slice(-6)}`,
        isPrimary: true,
      },
    });
    await prisma.autopartCustomerAccountAlias.create({
      data: { companyId: alpha.id, alias: `ALIAS${stamp.slice(-8)}`.toUpperCase(), verifiedById: adminId },
    });
    await prisma.company.create({ data: { name: `${stamp} Beta`, status: "ACTIVE" } });
    await prisma.company.create({ data: { name: `${stamp} Gamma`, status: "ACTIVE" } });

    const page1 = await searchOrderEntryCustomers(rep.id, { q: stamp, page: 1, pageSize: 2 });
    const page2 = await searchOrderEntryCustomers(rep.id, { q: stamp, page: 2, pageSize: 2 });
    expect(page1.total).toBe(3);
    expect(page1.page).toBe(1);
    expect(page1.items).toHaveLength(2);
    expect(page2.items).toHaveLength(1);
    const ids = [...page1.items, ...page2.items].map((row) => row.id);
    expect(new Set(ids).size).toBe(3);
    expect(ids).not.toContain(hidden.id);

    const queries = [
      `${stamp} Motors`,
      `ACC-${stamp}`,
      `AP${stamp.slice(-8)}`,
      `ALIAS${stamp.slice(-8)}`,
      `0114${stamp.slice(-7)}`,
      `desk-${stamp}@example.invalid`,
      `Nia${stamp.slice(-6)}`,
      `Keane${stamp.slice(-6)}`,
      `nia-${stamp}@example.invalid`,
      `0121${stamp.slice(-7)}`,
      `07700${stamp.slice(-6)}`,
    ];
    for (const q of queries) {
      const hit = await searchOrderEntryCustomers(rep.id, { q, pageSize: 20 });
      expect(hit.items.some((row) => row.id === alpha.id), q).toBe(true);
    }
    expect((await searchOrderEntryCustomers(rep.id, { q: `${stamp} Hidden` })).total).toBe(0);
  });

  it("accepts staff unit quantities and order-only prices without changing portal case rules", async () => {
    const stamp = Date.now();
    const variant = await seedVariant(`SOE-UNIT-${stamp}`, 3.25, 12, 48);
    await prisma.productVariant.update({
      where: { id: variant.id },
      data: { minOrderQty: 12, backorderPolicy: "DENY" },
    });
    const { company, address, contact } = await seedCompany(`SOE Unit ${stamp}`);
    const buyerId = await ensureTradeBuyer(`soe-unit-buyer-${stamp}@example.invalid`, company.id);
    const { user: rep } = await ensureRep(
      `soe-unit-${stamp}@example.invalid`,
      "SALES_REPRESENTATIVE",
      `UN${stamp}`,
    );
    await assign(
      company.id,
      (await prisma.salesRep.findUniqueOrThrow({ where: { userId: rep.id } })).id,
      true,
    );
    const promo = await prisma.promotion.create({
      data: {
        code: `UNIT${stamp}`.slice(0, 20),
        name: "Unit price promo",
        type: "PERCENT",
        value: "10",
        isActive: true,
        metadata: { variantIds: [variant.id] },
      },
    });

    try {
      await expect(addToBasket(buyerId, { variantId: variant.id, quantity: 1 })).rejects.toThrow();
      const portalLines = await resolveOrderLinesFromItems(company.id, [
        { variantId: variant.id, qty: 1 },
      ]);
      expect(portalLines[0]?.issue).toBe("CASE_CONFIGURATION_CHANGED");
      expect(await prisma.basketItem.count({ where: { variantId: variant.id } })).toBe(0);

      const draft = await openSalesOrderDraft(rep.id, { companyId: company.id, fresh: true });
      for (const qty of [1, 2, 15] as const) {
        const saved = await saveSalesOrderDraft(rep.id, {
          draftId: draft.draft.id,
          contactId: contact.id,
          addressId: address.id,
          source: "TELEPHONE",
          lines: [{ variantId: variant.id, qty }],
        });
        const line = saved.review?.lines[0];
        expect(line?.issue, `qty ${qty}`).toBe("VALID");
        expect(line?.issueMessage).toBeNull();
        expect(line?.quantity).toBe(qty);
        expect(line?.caseQty).toBe(12);
        expect(line?.priceOverridden).toBe(false);
        expect(line?.customerUnitPrice).toBe(line?.resolvedUnitPrice);
      }

      const oversold = await saveSalesOrderDraft(rep.id, {
        draftId: draft.draft.id,
        lines: [{ variantId: variant.id, qty: 50 }],
      });
      expect(oversold.review?.lines[0]?.issue).not.toBe("VALID");

      const overridden = await saveSalesOrderDraft(rep.id, {
        draftId: draft.draft.id,
        lines: [{ variantId: variant.id, qty: 2, unitPriceOverride: "2.5" }],
      });
      const overrideLine = overridden.review?.lines[0];
      expect(overrideLine?.issue).toBe("VALID");
      expect(overrideLine?.customerUnitPrice).toBe("2.50");
      expect(overrideLine?.lineNet).toBe("5.00");
      expect(overrideLine?.lineVat).toBe("1.00");
      expect(overrideLine?.priceSource).toBe("STAFF_OVERRIDE");
      expect(overrideLine?.priceOverridden).toBe(true);
      expect(overrideLine?.promotionCode).toBeNull();
      expect(overrideLine?.resolvedUnitPrice).not.toBe("2.50");
      expect(overridden.draft.lines[0]?.unitPriceOverride).toBe("2.50");
      const net = Number(overrideLine?.lineNet);
      const lineVat = Number(overrideLine?.lineVat);
      const delivery = Number(overridden.review?.totals.deliveryTotal);
      const orderVat = Number(overridden.review?.totals.vatTotal);
      expect(overridden.review?.totals.subtotal).toBe("5.00");
      expect(orderVat).toBeCloseTo(lineVat + delivery * 0.2, 2);
      expect(Number(overridden.review?.totals.grandTotal)).toBeCloseTo(net + orderVat + delivery, 2);

      const reopened = await getSalesOrderDraft(rep.id, { draftId: draft.draft.id });
      expect(reopened.draft.lines[0]?.unitPriceOverride).toBe("2.50");
      expect(reopened.review?.lines[0]?.customerUnitPrice).toBe("2.50");

      const reset = await saveSalesOrderDraft(rep.id, {
        draftId: draft.draft.id,
        lines: [{ variantId: variant.id, qty: 2, unitPriceOverride: null }],
      });
      expect(reset.draft.lines[0]?.unitPriceOverride).toBeNull();
      expect(reset.review?.lines[0]?.priceOverridden).toBe(false);
      expect(reset.review?.lines[0]?.priceSource).toBe("PROMOTION");
      expect(reset.review?.lines[0]?.customerUnitPrice).toBe(reset.review?.lines[0]?.resolvedUnitPrice);

      await expect(
        saveSalesOrderDraft(rep.id, {
          draftId: draft.draft.id,
          lines: [{ variantId: variant.id, qty: 2, unitPriceOverride: "-1.00" }],
        }),
      ).rejects.toThrow();

      const priced = await saveSalesOrderDraft(rep.id, {
        draftId: draft.draft.id,
        lines: [{ variantId: variant.id, qty: 2, unitPriceOverride: "2.50" }],
      });
      const key = `unit-${stamp}`;
      const placed = await placeSalesOrder(rep.id, {
        draftId: draft.draft.id,
        confirmAuthorised: true,
        idempotencyKey: key,
        source: "TELEPHONE",
        contactId: contact.id,
        addressId: address.id,
        lines: [{ variantId: variant.id, qty: 2, unitPriceOverride: "2.50" }],
        expectedReview: expectedFrom(priced.review!),
      });
      expect(placed.ok).toBe(true);
      if (!placed.ok) return;
      const order = await prisma.order.findUniqueOrThrow({
        where: { id: placed.order.id },
        include: { items: true },
      });
      expect(order.items[0]?.qty).toBe(2);
      expect(Number(order.items[0]?.customerUnitPrice.toString())).toBe(2.5);
      expect(Number(order.items[0]?.lineTotal.toString())).toBe(5);
      expect(Number(order.items[0]?.lineVat.toString())).toBe(1);
      expect(order.items[0]?.priceSource).toBe("STAFF_OVERRIDE");
      expect(order.items[0]?.promotionId).toBeNull();
      expect(Number(order.subtotal.toString())).toBe(Number(priced.review?.totals.subtotal));
      expect(Number(order.vatTotal.toString())).toBe(Number(priced.review?.totals.vatTotal));
      expect(Number(order.grandTotal.toString())).toBe(Number(priced.review?.totals.grandTotal));
      const inventory = await prisma.inventory.findFirstOrThrow({ where: { variantId: variant.id } });
      expect(inventory.qtyOnHand).toBe(48);
      expect(inventory.qtyReserved).toBe(2);
      const reservation = await prisma.orderStockReservation.findFirstOrThrow({
        where: { orderId: order.id },
      });
      expect(reservation.quantity).toBe(2);

      const audit = await prisma.auditEvent.findFirstOrThrow({
        where: { entityId: order.id, action: "order.placed_for_customer" },
      });
      const after = audit.after as {
        priceOverrides?: Array<{
          orderId: string;
          resolvedUnitPrice: string;
          overriddenUnitPrice: string;
          staffUserId: string;
        }>;
      };
      expect(after.priceOverrides?.[0]).toMatchObject({
        orderId: order.id,
        overriddenUnitPrice: "2.50",
        staffUserId: rep.id,
      });
      expect(after.priceOverrides?.[0]?.resolvedUnitPrice).not.toBe("2.50");

      const storedTrade = await prisma.productVariant.findUniqueOrThrow({ where: { id: variant.id } });
      expect(Number(storedTrade.tradePrice?.toString())).toBe(3.25);
      expect(storedTrade.caseQty).toBe(12);
      expect(storedTrade.minOrderQty).toBe(12);
      expect(
        await prisma.customerPrice.count({ where: { companyId: company.id, variantId: variant.id } }),
      ).toBe(0);

      const again = await placeSalesOrder(rep.id, {
        draftId: draft.draft.id,
        confirmAuthorised: true,
        idempotencyKey: key,
        source: "TELEPHONE",
        contactId: contact.id,
        addressId: address.id,
        lines: [{ variantId: variant.id, qty: 2, unitPriceOverride: "2.50" }],
        expectedReview: expectedFrom(priced.review!),
      });
      expect(again.ok && again.alreadyPlaced && again.order.id).toBe(order.id);
      expect(await prisma.order.count({ where: { idempotencyKey: key } })).toBe(1);
      const inventoryAfter = await prisma.inventory.findFirstOrThrow({ where: { variantId: variant.id } });
      expect(inventoryAfter.qtyReserved).toBe(2);
    } finally {
      await prisma.promotion.update({ where: { id: promo.id }, data: { isActive: false } });
    }
  });

  it("places a customer collection without an address and with no delivery charge", async () => {
    const stamp = Date.now();
    const variant = await seedVariant(`SOE-COL-${stamp}`, 9, 12, 20);
    const { company, contact } = await seedCompany(`SOE Collection ${stamp}`);
    const { user: rep } = await ensureRep(`soe-col-${stamp}@example.invalid`, "SALES_REPRESENTATIVE", `CL${stamp}`.slice(0, 12));
    const draft = await openSalesOrderDraft(rep.id, { companyId: company.id, fresh: true });
    const saved = await saveSalesOrderDraft(rep.id, {
      draftId: draft.draft.id,
      contactId: contact.id,
      source: "TELEPHONE",
      fulfilmentChoice: "COLLECTION",
      lines: [{ variantId: variant.id, qty: 1 }],
    });
    expect(saved.draft.fulfilmentChoice).toBe("COLLECTION");
    expect(saved.addressReady).toBe(true);
    expect(saved.review?.totals.deliveryTotal).toBe("0.00");
    const placed = await placeSalesOrder(rep.id, {
      draftId: draft.draft.id,
      confirmAuthorised: true,
      idempotencyKey: `col-${stamp}`,
      source: "TELEPHONE",
      fulfilmentChoice: "COLLECTION",
      contactId: contact.id,
      lines: [{ variantId: variant.id, qty: 1 }],
      expectedReview: expectedFrom(saved.review!),
    });
    expect(placed.ok).toBe(true);
    if (!placed.ok) return;
    expect(placed.order.deliveryTotal).toBe("0.00");
    expect(placed.order.fulfilmentChoice).toBe("COLLECTION");
    expect(placed.order.deliveryMethodLabel).toBe("Customer Collection");
    expect(placed.order.deliveryAddress).toBeNull();
    const row = await prisma.order.findUniqueOrThrow({ where: { id: placed.order.id } });
    expect(row.orderNumber).toMatch(/^AB-/);
    expect(row.deliveryAddress).toBeNull();
  });

  it("keeps a blank quantity blank and blocks placement until it is entered", async () => {
    const stamp = Date.now();
    const variant = await seedVariant(`SOE-QTY-${stamp}`, 9, 12, 20);
    const { company, address, contact } = await seedCompany(`SOE Qty ${stamp}`);
    const { user: rep } = await ensureRep(`soe-qty-${stamp}@example.invalid`, "SALES_REPRESENTATIVE", `QY${stamp}`.slice(0, 12));
    const draft = await openSalesOrderDraft(rep.id, { companyId: company.id, fresh: true });
    const blank = await saveSalesOrderDraft(rep.id, {
      draftId: draft.draft.id,
      contactId: contact.id,
      addressId: address.id,
      source: "EMAIL",
      lines: [{ variantId: variant.id, qty: null }],
    });
    expect(blank.draft.lines[0]?.qty).toBeNull();
    expect(blank.review).toBeNull();
    const reopened = await getSalesOrderDraft(rep.id, { draftId: draft.draft.id });
    expect(reopened.draft.lines[0]?.qty).toBeNull();
    await expect(
      placeSalesOrder(rep.id, {
        draftId: draft.draft.id,
        confirmAuthorised: true,
        idempotencyKey: `qty-blank-${stamp}`,
        source: "EMAIL",
        contactId: contact.id,
        addressId: address.id,
        lines: [{ variantId: variant.id, qty: 3 }],
        expectedReview: {
          lines: [{ variantId: variant.id, qty: 3, customerUnitPrice: "9.00", lineNet: "9.00", availableQty: 20, backorderQty: 0 }],
          subtotal: "9.00",
          vatTotal: "1.80",
          deliveryTotal: "5.95",
          grandTotal: "16.75",
        },
      }),
    ).rejects.toMatchObject({ code: "QUANTITY_REQUIRED" });
    const saved = await saveSalesOrderDraft(rep.id, {
      draftId: draft.draft.id,
      lines: [{ variantId: variant.id, qty: 3 }],
    });
    expect(saved.draft.lines[0]?.qty).toBe(3);
    expect(saved.review?.lines[0]?.quantity).toBe(3);
    const placed = await placeSalesOrder(rep.id, {
      draftId: draft.draft.id,
      confirmAuthorised: true,
      idempotencyKey: `qty-${stamp}`,
      source: "EMAIL",
      contactId: contact.id,
      addressId: address.id,
      lines: [{ variantId: variant.id, qty: 3 }],
      expectedReview: expectedFrom(saved.review!),
    });
    expect(placed.ok).toBe(true);
    if (!placed.ok) return;
    expect(placed.order.items[0]?.qty).toBe(3);
    const inv = await prisma.inventory.findFirstOrThrow({ where: { variantId: variant.id } });
    expect(inv.qtyReserved).toBe(3);
    expect(inv.qtyOnHand).toBe(20);
  });

  it("keeps the newest product first after a draft is reopened", async () => {
    const stamp = Date.now();
    const first = await seedVariant(`SOE-OLD-${stamp}`, 4, 1, 10);
    const second = await seedVariant(`SOE-NEW-${stamp}`, 4, 1, 10);
    const { company } = await seedCompany(`SOE Order ${stamp}`);
    const { user: rep } = await ensureRep(`soe-ord-${stamp}@example.invalid`, "SALES_REPRESENTATIVE", `OR${stamp}`.slice(0, 12));
    const draft = await openSalesOrderDraft(rep.id, { companyId: company.id, fresh: true });
    await saveSalesOrderDraft(rep.id, {
      draftId: draft.draft.id,
      lines: [
        { variantId: second.id, qty: 2 },
        { variantId: first.id, qty: 1 },
      ],
    });
    const reopened = await getSalesOrderDraft(rep.id, { draftId: draft.draft.id });
    expect(reopened.draft.lines.map((line) => line.variantId)).toEqual([second.id, first.id]);
  });

  it("edits a submitted order in place and adjusts only the active reservation", async () => {
    const stamp = Date.now();
    const variant = await seedVariant(`SOE-EDIT-${stamp}`, 8, 1, 12);
    const { company, address, contact } = await seedCompany(`SOE Edit ${stamp}`);
    const { user: rep } = await ensureRep(`soe-edit-${stamp}@example.invalid`, "SALES_REPRESENTATIVE", `ED${stamp}`.slice(0, 12));
    const draft = await openSalesOrderDraft(rep.id, { companyId: company.id, fresh: true });
    const saved = await saveSalesOrderDraft(rep.id, {
      draftId: draft.draft.id,
      contactId: contact.id,
      addressId: address.id,
      source: "CUSTOMER_VISIT",
      lines: [{ variantId: variant.id, qty: 2, unitPriceOverride: "6.50" }],
    });
    const placed = await placeSalesOrder(rep.id, {
      draftId: draft.draft.id,
      confirmAuthorised: true,
      idempotencyKey: `edit-place-${stamp}`,
      source: "CUSTOMER_VISIT",
      contactId: contact.id,
      addressId: address.id,
      lines: [{ variantId: variant.id, qty: 2, unitPriceOverride: "6.50" }],
      expectedReview: expectedFrom(saved.review!),
    });
    expect(placed.ok).toBe(true);
    if (!placed.ok) return;
    const orderId = placed.order.id;
    const orderNumber = placed.order.orderNumber;

    const editing = await startSalesOrderEdit(rep.id, { orderId });
    expect(editing.draft.editingOrderId).toBe(orderId);
    expect(editing.draft.lines[0]?.qty).toBe(2);
    expect(editing.draft.lines[0]?.unitPriceOverride).toBe("6.50");
    const changed = await saveSalesOrderDraft(rep.id, {
      draftId: editing.draft.id,
      contactId: contact.id,
      addressId: address.id,
      fulfilmentChoice: "DELIVERY",
      poNumber: "PO-EDIT",
      lines: [{ variantId: variant.id, qty: 5, unitPriceOverride: "6.50" }],
    });
    const updated = await placeSalesOrder(rep.id, {
      draftId: editing.draft.id,
      confirmAuthorised: true,
      idempotencyKey: `edit-save-${stamp}`,
      source: "CUSTOMER_VISIT",
      contactId: contact.id,
      addressId: address.id,
      poNumber: "PO-EDIT",
      lines: [{ variantId: variant.id, qty: 5, unitPriceOverride: "6.50" }],
      expectedReview: expectedFrom(changed.review!),
    });
    expect(updated.ok).toBe(true);
    if (!updated.ok) return;
    expect(updated.order.id).toBe(orderId);
    expect(updated.order.orderNumber).toBe(orderNumber);
    expect(updated.order.items).toHaveLength(1);
    expect(updated.order.items[0]?.qty).toBe(5);
    expect(updated.order.items[0]?.customerUnitPrice).toBe("6.50");
    const row = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(row.idempotencyKey).toBe(`edit-place-${stamp}`);
    expect(row.editIdempotencyKey).toBe(`edit-save-${stamp}`);
    expect(row.poNumber).toBe("PO-EDIT");
    expect(await prisma.order.count({ where: { companyId: company.id } })).toBe(1);
    const inv = await prisma.inventory.findFirstOrThrow({ where: { variantId: variant.id } });
    expect(inv.qtyOnHand).toBe(12);
    expect(inv.qtyReserved).toBe(5);
    const active = await prisma.orderStockReservation.findMany({ where: { orderId, status: "ACTIVE" } });
    expect(active.reduce((sum, hold) => sum + hold.quantity, 0)).toBe(5);
    const audit = await prisma.auditEvent.findFirstOrThrow({
      where: { entityId: orderId, action: "order.edited_for_customer" },
    });
    expect(audit.actorUserId).toBe(rep.id);
    expect(audit.before).toBeTruthy();
    expect(audit.after).toBeTruthy();

    await prisma.order.update({
      where: { id: orderId },
      data: { autopartExportStatus: "EXPORTED", autopartExportCount: 1, autopartExportedAt: new Date() },
    });
    await expect(startSalesOrderEdit(rep.id, { orderId })).rejects.toMatchObject({ code: "ORDER_LOCKED" });
  });

  it("requires a fresh backorder acknowledgement when the allocation changes", async () => {
    const stamp = Date.now();
    const variant = await seedVariant(`SOE-ACK-${stamp}`, 4, 1, 4);
    await prisma.productVariant.update({ where: { id: variant.id }, data: { backorderPolicy: "ALLOW" } });
    const { company, address, contact } = await seedCompany(`SOE Ack ${stamp}`);
    const { user: rep } = await ensureRep(`soe-ack-${stamp}@example.invalid`, "SALES_REPRESENTATIVE", `AK${stamp}`.slice(0, 12));
    const draft = await openSalesOrderDraft(rep.id, { companyId: company.id, fresh: true });
    const saved = await saveSalesOrderDraft(rep.id, {
      draftId: draft.draft.id,
      contactId: contact.id,
      addressId: address.id,
      source: "TELEPHONE",
      lines: [{ variantId: variant.id, qty: 6 }],
    });
    expect(saved.review?.lines[0]?.backorderQtyAtOrder).toBe(2);
    const missing = await placeSalesOrder(rep.id, {
      draftId: draft.draft.id,
      confirmAuthorised: true,
      idempotencyKey: `ack-missing-${stamp}`,
      source: "TELEPHONE",
      contactId: contact.id,
      addressId: address.id,
      lines: [{ variantId: variant.id, qty: 6 }],
      expectedReview: expectedFrom(saved.review!),
    });
    expect(missing.ok).toBe(false);
    if (missing.ok) return;
    expect(missing.acknowledgementRequired).toBe(true);
    expect(await prisma.order.count({ where: { companyId: company.id } })).toBe(0);
    const inv = await prisma.inventory.findFirstOrThrow({ where: { variantId: variant.id } });
    expect(inv.qtyReserved).toBe(0);
    expect(inv.qtyOnHand).toBe(4);
  });
});
