import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { bootstrapRbac } from "../../../prisma/bootstrap/rbac";
import { saveProduct } from "@/server/catalogue/service";
import { addToBasket } from "@/server/basket/service";
import { placeOrder } from "@/server/orders/service";
import {
  abandonSalesOrderDraft,
  ensureSalesOrderCrmActivity,
  getSalesOrderDraft,
  listSalesOrderDrafts,
  openSalesOrderDraft,
  placeSalesOrder,
  salesOrderCrmDependencies,
  saveSalesOrderDraft,
  searchSalesOrderProducts,
} from "@/server/orders/sales-order-entry";
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
  lines: Array<{ variantId: string; quantity: number; customerUnitPrice: string | null; lineNet: string | null }>;
  totals: { subtotal: string; vatTotal: string; deliveryTotal: string; grandTotal: string };
}) {
  return {
    lines: review.lines.map((line) => ({
      variantId: line.variantId,
      qty: line.quantity,
      customerUnitPrice: line.customerUnitPrice ?? "0.00",
      lineNet: line.lineNet ?? "0.00",
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
  it("rejects unassigned reps, prospects, and staff without permission", async () => {
    const stamp = Date.now();
    const { user: rep } = await ensureRep(`soe-rep-${stamp}@example.invalid`, "SALES_REPRESENTATIVE", `SOE${stamp}`);
    const { user: other } = await ensureRep(`soe-out-${stamp}@example.invalid`, "SALES_REPRESENTATIVE", `OUT${stamp}`);
    const cs = await ensureUser(`soe-cs-${stamp}@example.invalid`, ["CUSTOMER_SERVICE"]);
    const { company } = await seedCompany(`SOE Assigned ${stamp}`);
    const prospect = await seedCompany(`SOE Prospect ${stamp}`, "PROSPECT");
    const repRecord = await prisma.salesRep.findUniqueOrThrow({ where: { userId: rep.id } });
    await assign(company.id, repRecord.id, true);
    await assign(prospect.company.id, repRecord.id, true);

    await expect(openSalesOrderDraft(other.id, { companyId: company.id })).rejects.toMatchObject({
      code: "COMPANY_FORBIDDEN",
    });
    await expect(
      searchSalesOrderProducts(other.id, { companyId: company.id, q: "SOE" }),
    ).rejects.toMatchObject({ code: "COMPANY_FORBIDDEN" });
    expect(await prisma.salesOrderDraft.count({ where: { companyId: company.id, createdByUserId: other.id } })).toBe(0);

    await expect(openSalesOrderDraft(rep.id, { companyId: prospect.company.id })).rejects.toMatchObject({
      code: "COMPANY_NOT_ACTIVE",
    });
    const still = await prisma.company.findUniqueOrThrow({ where: { id: prospect.company.id } });
    expect(still.status).toBe("PROSPECT");

    await expect(openSalesOrderDraft(cs.id, { companyId: company.id })).rejects.toBeInstanceOf(AuthError);
    await expect(openSalesOrderDraft(cs.id, { companyId: company.id })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("limits a sales manager to team accounts", async () => {
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
    await expect(openSalesOrderDraft(manager.id, { companyId: otherCo.company.id })).rejects.toMatchObject({
      code: "COMPANY_FORBIDDEN",
    });
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

  it("prices the customer, applies an eligible promotion, VAT and delivery, and rejects case-qty and address errors", async () => {
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

      const blocked = await saveSalesOrderDraft(rep.id, {
        draftId: draft.draft.id,
        lines: [{ variantId: cased.id, qty: 6 }],
      });
      expect(blocked.review?.hasBlockingIssues).toBe(true);
      expect(blocked.review?.lines[0]?.issue).not.toBe("VALID");

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
    const otherHits = await searchSalesOrderProducts(rep.id, { companyId: other.company.id, q: priced.sku }).catch(
      (error: unknown) => error,
    );
    expect(otherHits).toMatchObject({ code: "COMPANY_FORBIDDEN" });

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
    });
    expect(placed.ok).toBe(true);
    if (!placed.ok) return;
    const item = await prisma.orderItem.findFirstOrThrow({ where: { orderId: placed.order.id } });
    expect(item.availableQtyAtOrder).toBe(3);
    expect(item.backorderQtyAtOrder).toBe(2);
    const inv = await prisma.inventory.findFirstOrThrow({ where: { variantId: variant.id } });
    expect(inv.qtyReserved).toBe(3);
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
    await expect(getSalesOrderDraft(rep.id, { draftId: draft.draft.id })).rejects.toMatchObject({
      code: "COMPANY_FORBIDDEN",
    });
    await expect(
      saveSalesOrderDraft(rep.id, { draftId: draft.draft.id, poNumber: "NO" }),
    ).rejects.toMatchObject({ code: "COMPANY_FORBIDDEN" });
    await expect(abandonSalesOrderDraft(rep.id, { draftId: draft.draft.id })).rejects.toMatchObject({
      code: "COMPANY_FORBIDDEN",
    });
    expect(await listSalesOrderDrafts(rep.id)).toEqual([]);
    const stillOpen = await prisma.salesOrderDraft.findUniqueOrThrow({ where: { id: draft.draft.id } });
    expect(stillOpen.status).toBe("OPEN");

    await prisma.companyAssignment.create({
      data: { companyId: company.id, salesRepId: otherRep.id, isPrimary: true },
    });
    await expect(getSalesOrderDraft(rep.id, { draftId: draft.draft.id })).rejects.toMatchObject({
      code: "COMPANY_FORBIDDEN",
    });
    await expect(getSalesOrderDraft(other.id, { draftId: draft.draft.id })).rejects.toMatchObject({
      code: "DRAFT_NOT_FOUND",
    });

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
  });
});
