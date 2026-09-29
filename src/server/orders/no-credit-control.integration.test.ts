/**
 * Regression: order place / export / portal dashboard work without credit control fields.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { bootstrapRbac } from "../../../prisma/bootstrap/rbac";
import { saveProduct } from "@/server/catalogue/service";
import { addToBasket } from "@/server/basket/service";
import { placeOrder } from "@/server/orders/service";
import { exportAutopartOrdersCsv } from "@/server/orders/autopart-export";
import { getPortalDashboard } from "@/server/portal/dashboard";
import { linkAndVerifyCompanyAutopartCustomerCode } from "@/server/companies/autopart-account";

const prisma = new PrismaClient();
const suffix = `nocredit-${Date.now().toString(36)}`;
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

beforeAll(async () => {
  await bootstrapRbac(prisma);
  adminId = await ensureUser(`nocredit.admin.${suffix}@example.invalid`, ["SUPER_ADMIN"]);
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("no credit control regression", () => {
  it("placeOrder works without credit fields; export is not blocked; dashboard omits credit keys", async () => {
    const sku = `NC-${suffix}`;
    const product = await saveProduct(adminId, {
      sku,
      name: "No-credit product",
      brand: "Power Maxed",
      category: "Braking",
      trade: 3.25,
      rrp: 6.5,
      packQty: 1,
      caseQty: 12,
      description: "no credit",
      active: true,
    });
    const variant = await prisma.productVariant.findFirstOrThrow({
      where: { productId: product.id },
    });
    await seedStock(variant.id, 48);

    const company = await prisma.company.create({
      data: { name: `No Credit Co ${suffix}`, status: "ACTIVE", paymentTerms: "Net 30" },
    });
    const mam = `NC${suffix.slice(-6).toUpperCase()}`;
    await linkAndVerifyCompanyAutopartCustomerCode(adminId, {
      companyId: company.id,
      code: mam,
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

    const buyerId = await ensureUser(`nocredit.buyer.${suffix}@example.invalid`, [], "TRADE");
    await prisma.companyUser.create({
      data: {
        companyId: company.id,
        userId: buyerId,
        role: "TRADE_BUYER",
        status: "ACTIVE",
        isDefault: true,
      },
    });

    await addToBasket(buyerId, { variantId: variant.id, quantity: 12 });
    const placed = await placeOrder(buyerId, {
      idempotencyKey: `idem-${sku}`,
      addressId: address.id,
      poNumber: "PO-NC-1",
      expectedLinePrices: [{ variantId: variant.id, customerUnitPrice: "3.25" }],
    });
    expect(placed.ok).toBe(true);
    if (!placed.ok) return;

    expect(placed.order.status).toBe("SUBMITTED");
    expect(placed.order).not.toHaveProperty("creditLimitAtOrder");
    expect(placed.order).not.toHaveProperty("creditBlocked");

    const exported = await exportAutopartOrdersCsv(adminId, [placed.order.id]);
    expect(exported.csv.length).toBeGreaterThan(0);
    expect(exported.orderCount).toBe(1);
    expect(exported.orderNumbers).toContain(placed.order.orderNumber);

    const dash = await getPortalDashboard(buyerId);
    expect(dash.company.id).toBe(company.id);
    expect(dash.company.status).toBe("ACTIVE");
    expect(dash.totalOrderCount).toBeGreaterThanOrEqual(1);
    expect(dash).not.toHaveProperty("creditLimit");
    expect(dash).not.toHaveProperty("availableCredit");
    expect(dash).not.toHaveProperty("usedCredit");
    const keys = Object.keys(dash);
    expect(keys).not.toContain("creditLimit");
    expect(keys).not.toContain("availableCredit");
    expect(keys).not.toContain("usedCredit");
  });
});
