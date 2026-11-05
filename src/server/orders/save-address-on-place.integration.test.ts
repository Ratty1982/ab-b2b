/**
 * Staff order place + optional save-to-profile address behaviour.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { bootstrapRbac } from "../../../prisma/bootstrap/rbac";
import { saveProduct } from "@/server/catalogue/service";
import {
  getSalesOrderDraft,
  openSalesOrderDraft,
  placeSalesOrder,
  saveSalesOrderDraft,
} from "@/server/orders/sales-order-entry";
import { createAddress, updateAddress } from "@/server/companies/service";
import { AuthError } from "@/server/rbac/guards";

const prisma = new PrismaClient();
const stamp = Date.now();
let adminId = "";
let placeOnlyId = "";

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
}

async function seedCompany(name: string) {
  const company = await prisma.company.create({
    data: { name, status: "ACTIVE", paymentTerms: "Net 30" },
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
  return { company, contact };
}

async function seedVariant(sku: string) {
  const product = await saveProduct(adminId, {
    sku,
    name: `Save addr ${sku}`,
    brand: "Power Maxed",
    category: "Braking",
    trade: 12,
    rrp: 24,
    packQty: 1,
    caseQty: 1,
    description: "save address",
    active: true,
  });
  const variant = await prisma.productVariant.findFirstOrThrow({ where: { productId: product.id } });
  await seedStock(variant.id, 50);
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

beforeAll(async () => {
  await bootstrapRbac(prisma);
  adminId = await ensureUser(`save-addr-admin-${stamp}@example.invalid`, ["SUPER_ADMIN"]);
  // SALES_REPRESENTATIVE can place for customer but typically lacks companies.edit
  placeOnlyId = await ensureUser(`save-addr-place-${stamp}@example.invalid`, [
    "SALES_REPRESENTATIVE",
  ]);
  await prisma.salesRep.upsert({
    where: { userId: placeOnlyId },
    create: { userId: placeOnlyId, code: `SA${String(stamp).slice(-6)}`, active: true },
    update: { active: true },
  });
}, 60_000);

afterAll(async () => {
  await prisma.$disconnect();
});

describe("save address on staff order place", () => {
  it("hides save capability without companies.edit and blocks place when save is requested", async () => {
    const { company, contact } = await seedCompany(`Save Addr Deny ${stamp}`);
    const variant = await seedVariant(`SA-DENY-${stamp}`);
    const workspace = await openSalesOrderDraft(placeOnlyId, {
      companyId: company.id,
      fresh: true,
    });
    expect(workspace.canSaveCustomerAddress).toBe(false);

    await saveSalesOrderDraft(placeOnlyId, {
      draftId: workspace.draft.id,
      contactId: contact.id,
      source: "TELEPHONE",
      lines: [{ variantId: variant.id, qty: 1 }],
    });
    const refreshed = await getSalesOrderDraft(placeOnlyId, { draftId: workspace.draft.id });
    const expected = expectedFrom(refreshed.review!);

    await expect(
      placeSalesOrder(placeOnlyId, {
        draftId: workspace.draft.id,
        confirmAuthorised: true,
        idempotencyKey: `save-deny-${stamp}`,
        source: "TELEPHONE",
        contactId: contact.id,
        fulfilmentChoice: "DELIVERY",
        oneOffAddress: {
          line1: "99 Denied Road",
          town: "Leeds",
          postcode: "LS9 9ZZ",
          country: "GB",
        },
        saveAddressToProfile: true,
        lines: [{ variantId: variant.id, qty: 1 }],
        expectedReview: expected,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    expect(await prisma.order.count({ where: { companyId: company.id } })).toBe(0);
    expect(await prisma.address.count({ where: { companyId: company.id } })).toBe(0);
  });

  it("saves address after successful place, dedupes retries, preserves order snapshot, and edits do not rewrite orders", async () => {
    const { company, contact } = await seedCompany(`Save Addr Ok ${stamp}`);
    const variant = await seedVariant(`SA-OK-${stamp}`);
    const workspace = await openSalesOrderDraft(adminId, { companyId: company.id, fresh: true });
    expect(workspace.canSaveCustomerAddress).toBe(true);

    await saveSalesOrderDraft(adminId, {
      draftId: workspace.draft.id,
      contactId: contact.id,
      source: "TELEPHONE",
      lines: [{ variantId: variant.id, qty: 1 }],
    });
    const refreshed = await getSalesOrderDraft(adminId, { draftId: workspace.draft.id });
    const expected = expectedFrom(refreshed.review!);
    const oneOff = {
      line1: "12 Saved Lane",
      line2: null,
      town: "York",
      county: "North Yorkshire",
      postcode: "YO1 2AB",
      country: "GB",
    };

    const placed = await placeSalesOrder(adminId, {
      draftId: workspace.draft.id,
      confirmAuthorised: true,
      idempotencyKey: `save-ok-${stamp}`,
      source: "TELEPHONE",
      contactId: contact.id,
      fulfilmentChoice: "DELIVERY",
      oneOffAddress: oneOff,
      saveAddressToProfile: true,
      saveAddressAsDefaultDelivery: true,
      lines: [{ variantId: variant.id, qty: 1 }],
      expectedReview: expected,
    });
    expect(placed.ok).toBe(true);
    if (!placed.ok) return;
    expect(placed.savedAddressId).toBeTruthy();
    expect(placed.savedAddressError).toBeNull();

    const order = await prisma.order.findUniqueOrThrow({ where: { id: placed.order.id } });
    const snapshot = order.deliveryAddress as { line1?: string; postcode?: string } | null;
    expect(snapshot?.line1).toBe("12 Saved Lane");
    expect(snapshot?.postcode).toBe("YO1 2AB");

    const addresses = await prisma.address.findMany({ where: { companyId: company.id } });
    expect(addresses).toHaveLength(1);
    expect(addresses[0]!.isDefaultDelivery).toBe(true);
    expect(addresses[0]!.id).toBe(placed.savedAddressId);

    // Retry with same idempotency — no duplicate address.
    const retried = await placeSalesOrder(adminId, {
      draftId: workspace.draft.id,
      confirmAuthorised: true,
      idempotencyKey: `save-ok-${stamp}`,
      source: "TELEPHONE",
      contactId: contact.id,
      fulfilmentChoice: "DELIVERY",
      oneOffAddress: oneOff,
      saveAddressToProfile: true,
      saveAddressAsDefaultDelivery: true,
      lines: [{ variantId: variant.id, qty: 1 }],
      expectedReview: expected,
    });
    expect(retried.ok).toBe(true);
    if (retried.ok) {
      expect(retried.alreadyPlaced).toBe(true);
      expect(retried.savedAddressId).toBe(placed.savedAddressId);
    }
    expect(await prisma.address.count({ where: { companyId: company.id } })).toBe(1);

    // Editing the profile address must not rewrite the order snapshot.
    await updateAddress(adminId, {
      id: placed.savedAddressId!,
      companyId: company.id,
      line1: "99 Changed Road",
      postcode: "YO9 9ZZ",
    });
    const afterEdit = await prisma.order.findUniqueOrThrow({ where: { id: placed.order.id } });
    const snap2 = afterEdit.deliveryAddress as { line1?: string; postcode?: string } | null;
    expect(snap2?.line1).toBe("12 Saved Lane");
    expect(snap2?.postcode).toBe("YO1 2AB");
  });

  it("keeps collection orders unaffected and supports address edit permissions", async () => {
    const { company, contact } = await seedCompany(`Save Addr Coll ${stamp}`);
    const existing = await createAddress(adminId, {
      companyId: company.id,
      type: "DELIVERY",
      line1: "1 Existing",
      town: "Leeds",
      postcode: "LS1 1AA",
      country: "GB",
      isDefaultBilling: false,
      isDefaultDelivery: true,
    });
    const edited = await updateAddress(adminId, {
      id: existing.id,
      companyId: company.id,
      label: "Yard",
      contactName: "Alex",
      contactPhone: "01130001111",
    });
    expect(edited.label).toBe("Yard");
    expect(edited.contactName).toBe("Alex");

    await expect(
      updateAddress(placeOnlyId, {
        id: existing.id,
        companyId: company.id,
        label: "Hacked",
      }),
    ).rejects.toBeInstanceOf(AuthError);

    const variant = await seedVariant(`SA-COLL-${stamp}`);
    const workspace = await openSalesOrderDraft(adminId, { companyId: company.id, fresh: true });
    await saveSalesOrderDraft(adminId, {
      draftId: workspace.draft.id,
      contactId: contact.id,
      source: "TELEPHONE",
      fulfilmentChoice: "COLLECTION",
      lines: [{ variantId: variant.id, qty: 1 }],
    });
    const refreshed = await getSalesOrderDraft(adminId, { draftId: workspace.draft.id });
    const beforeCount = await prisma.address.count({ where: { companyId: company.id } });
    const placed = await placeSalesOrder(adminId, {
      draftId: workspace.draft.id,
      confirmAuthorised: true,
      idempotencyKey: `save-coll-${stamp}`,
      source: "TELEPHONE",
      contactId: contact.id,
      fulfilmentChoice: "COLLECTION",
      lines: [{ variantId: variant.id, qty: 1 }],
      expectedReview: expectedFrom(refreshed.review!),
    });
    expect(placed.ok).toBe(true);
    expect(await prisma.address.count({ where: { companyId: company.id } })).toBe(beforeCount);
  });
});
