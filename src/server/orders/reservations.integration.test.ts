import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { bootstrapRbac } from "../../../prisma/bootstrap/rbac";
import { saveProduct } from "@/server/catalogue/service";
import { AuthError } from "@/server/rbac/guards";
import { addToBasket } from "@/server/basket/service";
import { placeOrder } from "@/server/orders/service";
import { reserveStockForOrder } from "@/server/orders/reservations";
import { getEffectiveSellableQuantity } from "@/domain/stock";
import { setEmailAdapterForTests } from "@/infra/email";
import {
  retryTransactionalEmail,
  sendOrderEmailsAfterCommit,
} from "@/server/email/transactional";

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
      status: avail >= 21 ? "IN_STOCK" : avail > 0 ? "LOW" : "OUT_OF_STOCK",
      externalSyncedAt: new Date(),
      sourceAvailRaw: String(avail),
    },
    update: {
      qtyOnHand: avail,
      qtyReserved: reserved,
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

async function seedCompanyWithAddress(name: string) {
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
  return { company, address };
}

async function seedOrderableVariant(prefix: string, opts: { trade: number; caseQty: number; avail: number }) {
  const sku = `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const product = await saveProduct(adminId, {
    sku,
    name: `Reserve ${sku}`,
    brand: "Power Maxed",
    category: "Braking",
    trade: opts.trade,
    rrp: opts.trade * 2,
    packQty: 1,
    caseQty: opts.caseQty,
    description: "reserve",
    active: true,
  });
  const variant = await prisma.productVariant.findFirstOrThrow({
    where: { productId: product.id },
  });
  await seedStock(variant.id, opts.avail);
  return { sku, product, variant };
}

beforeAll(async () => {
  await bootstrapRbac(prisma);
  adminId = await ensureUser("reserve.admin@example.invalid", ["SUPER_ADMIN"]);
});

afterEach(async () => {
  setEmailAdapterForTests(null);
  delete process.env["TRADE_ORDER_NOTIFICATION_EMAIL"];
  await prisma.emailSettings.updateMany({ data: { enabled: false } });
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("Phase 6B stock reservations", () => {
  it("Avail 48 order 24 → qtyOnHand stays 48, qtyReserved 24, effective 24", async () => {
    const { sku, variant } = await seedOrderableVariant("RSV48", {
      trade: 3,
      caseQty: 12,
      avail: 48,
    });
    const { company, address } = await seedCompanyWithAddress(`RSV48 ${sku}`);
    const buyerId = await ensureTradeBuyer(`rsv48-${sku}@example.invalid`, company.id);

    await addToBasket(buyerId, { variantId: variant.id, quantity: 24 });
    const result = await placeOrder(buyerId, {
      idempotencyKey: `idem-${sku}-a`,
      addressId: address.id,
    });
    expect(result.ok).toBe(true);

    const inv = await prisma.inventory.findFirstOrThrow({ where: { variantId: variant.id } });
    expect(inv.qtyOnHand).toBe(48);
    expect(inv.qtyReserved).toBe(24);
    expect(
      getEffectiveSellableQuantity({
        autopartAvail: inv.qtyOnHand,
        reservedQty: inv.qtyReserved,
      }),
    ).toBe(24);
  });

  it("second order of 24 ok; third rejected", async () => {
    const { sku, variant } = await seedOrderableVariant("RSV3", {
      trade: 2.5,
      caseQty: 12,
      avail: 48,
    });

    const co1 = await seedCompanyWithAddress(`RSV3a ${sku}`);
    const co2 = await seedCompanyWithAddress(`RSV3b ${sku}`);
    const co3 = await seedCompanyWithAddress(`RSV3c ${sku}`);
    const b1 = await ensureTradeBuyer(`rsv3a-${sku}@example.invalid`, co1.company.id);
    const b2 = await ensureTradeBuyer(`rsv3b-${sku}@example.invalid`, co2.company.id);
    const b3 = await ensureTradeBuyer(`rsv3c-${sku}@example.invalid`, co3.company.id);

    // Fill baskets while stock is still available (basket does not reserve).
    await addToBasket(b1, { variantId: variant.id, quantity: 24 });
    await addToBasket(b2, { variantId: variant.id, quantity: 24 });
    await addToBasket(b3, { variantId: variant.id, quantity: 24 });

    const r1 = await placeOrder(b1, {
      idempotencyKey: `idem-${sku}-1`,
      addressId: co1.address.id,
    });
    expect(r1.ok).toBe(true);

    const r2 = await placeOrder(b2, {
      idempotencyKey: `idem-${sku}-2`,
      addressId: co2.address.id,
    });
    expect(r2.ok).toBe(true);

    const mid = await prisma.inventory.findFirstOrThrow({ where: { variantId: variant.id } });
    expect(mid.qtyOnHand).toBe(48);
    expect(mid.qtyReserved).toBe(48);

    // Third place: soft check or hard lock rejects — no third reservation.
    let rejected = false;
    try {
      const r3 = await placeOrder(b3, {
        idempotencyKey: `idem-${sku}-3`,
        addressId: co3.address.id,
      });
      if (!r3.ok) {
        expect(r3.code).toBe("REVIEW_REQUIRED");
        rejected = true;
      }
    } catch (error) {
      expect(error).toBeInstanceOf(AuthError);
      expect((error as AuthError).code).toBe("INSUFFICIENT_STOCK");
      rejected = true;
    }
    expect(rejected).toBe(true);

    const inv = await prisma.inventory.findFirstOrThrow({ where: { variantId: variant.id } });
    expect(inv.qtyReserved).toBe(48);
    expect(await prisma.order.count({ where: { companyId: co3.company.id } })).toBe(0);
  });

  it("concurrent placeOrder for last 24 — exactly one succeeds", async () => {
    const { sku, variant } = await seedOrderableVariant("RSVRACE", {
      trade: 2,
      caseQty: 12,
      avail: 24,
    });
    const coA = await seedCompanyWithAddress(`RaceA ${sku}`);
    const coB = await seedCompanyWithAddress(`RaceB ${sku}`);
    const buyerA = await ensureTradeBuyer(`racea-${sku}@example.invalid`, coA.company.id);
    const buyerB = await ensureTradeBuyer(`raceb-${sku}@example.invalid`, coB.company.id);

    await addToBasket(buyerA, { variantId: variant.id, quantity: 24 });
    await addToBasket(buyerB, { variantId: variant.id, quantity: 24 });

    const settled = await Promise.allSettled([
      placeOrder(buyerA, {
        idempotencyKey: `idem-${sku}-race-a`,
        addressId: coA.address.id,
      }),
      placeOrder(buyerB, {
        idempotencyKey: `idem-${sku}-race-b`,
        addressId: coB.address.id,
      }),
    ]);

    const successes = settled.filter(
      (r) => r.status === "fulfilled" && r.value.ok === true,
    );
    const failures = settled.filter(
      (r) =>
        r.status === "rejected" ||
        (r.status === "fulfilled" && r.value.ok === false),
    );
    // One may fail with AuthError (rejected) or REVIEW_REQUIRED if stock check raced first.
    expect(successes).toHaveLength(1);
    expect(failures.length + successes.length).toBe(2);

    const inv = await prisma.inventory.findFirstOrThrow({ where: { variantId: variant.id } });
    expect(inv.qtyOnHand).toBe(24);
    expect(inv.qtyReserved).toBe(24);
    expect(
      await prisma.orderStockReservation.count({
        where: { variantId: variant.id, status: "ACTIVE" },
      }),
    ).toBe(1);
  });

  it("failed transaction leaves no reservation", async () => {
    const { sku, variant } = await seedOrderableVariant("RSVFAIL", {
      trade: 4,
      caseQty: 6,
      avail: 36,
    });
    const invBefore = await prisma.inventory.findFirstOrThrow({ where: { variantId: variant.id } });

    await expect(
      prisma.$transaction(async (tx) => {
        const order = await tx.order.create({
          data: {
            orderNumber: `AB-TEST-${sku}`,
            companyId: (
              await tx.company.create({
                data: { name: `Fail Co ${sku}`, status: "ACTIVE" },
              })
            ).id,
            status: "SUBMITTED",
            currency: "GBP",
            subtotal: "24.00",
            vatTotal: "4.80",
            deliveryTotal: "0.00",
            grandTotal: "28.80",
            items: {
              create: [
                {
                  variantId: variant.id,
                  sku: variant.sku,
                  name: "fail line",
                  qty: 6,
                  unitPrice: "4.0000",
                  customerUnitPrice: "4.00",
                  vatRate: 20,
                  lineTotal: "24.00",
                  lineVat: "4.80",
                  lineGross: "28.80",
                },
              ],
            },
          },
          include: { items: true },
        });
        await reserveStockForOrder(tx, {
          orderId: order.id,
          lines: order.items.map((item) => ({
            orderItemId: item.id,
            variantId: item.variantId!,
            quantity: item.qty,
          })),
        });
        throw new Error("simulated failure after reserve");
      }),
    ).rejects.toThrow("simulated failure after reserve");

    const invAfter = await prisma.inventory.findFirstOrThrow({ where: { variantId: variant.id } });
    expect(invAfter.qtyOnHand).toBe(invBefore.qtyOnHand);
    expect(invAfter.qtyReserved).toBe(0);
    expect(
      await prisma.orderStockReservation.count({ where: { variantId: variant.id } }),
    ).toBe(0);
  });

  it("final part-case with effective 7 reserves 7", async () => {
    const { sku, variant } = await seedOrderableVariant("RSVFP", {
      trade: 5,
      caseQty: 12,
      avail: 7,
    });
    const { company, address } = await seedCompanyWithAddress(`FP ${sku}`);
    const buyerId = await ensureTradeBuyer(`fp-${sku}@example.invalid`, company.id);

    await addToBasket(buyerId, { variantId: variant.id, quantity: 7 });
    const result = await placeOrder(buyerId, {
      idempotencyKey: `idem-${sku}-fp`,
      addressId: address.id,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.order.items[0]!.orderingMode).toBe("FINAL_PART_CASE");

    const inv = await prisma.inventory.findFirstOrThrow({ where: { variantId: variant.id } });
    expect(inv.qtyOnHand).toBe(7);
    expect(inv.qtyReserved).toBe(7);
    expect(
      getEffectiveSellableQuantity({
        autopartAvail: inv.qtyOnHand,
        reservedQty: inv.qtyReserved,
      }),
    ).toBe(0);
  });
});

describe("Phase 6B order emails", () => {
  async function enableTransactionalEmail() {
    await prisma.emailSettings.upsert({
      where: { id: "singleton" },
      create: {
        id: "singleton",
        enabled: true,
        fromEmail: "from@example.invalid",
        smtpHost: "smtp.example.invalid",
        smtpUsername: "u",
        smtpPasswordEncrypted: "v1:dGVzdA==:dGVzdA==:dGVzdA==",
      },
      update: { enabled: true },
    });
  }

  it("creates ORDER_RECEIVED; failure does not rollback; retry uses snapshot; double place one email", async () => {
    await enableTransactionalEmail();
    const { sku, variant } = await seedOrderableVariant("RSVEM", {
      trade: 3.25,
      caseQty: 4,
      avail: 40,
    });
    const { company, address } = await seedCompanyWithAddress(`Email Co ${sku}`);
    const buyerId = await ensureTradeBuyer(`em-${sku}@example.invalid`, company.id);

    let failOnce = true;
    setEmailAdapterForTests({
      name: "test-fail-once",
      async send() {
        if (failOnce) {
          failOnce = false;
          return { ok: false, detail: "simulated provider failure" };
        }
        return { ok: true, id: "msg-ok", detail: "sent" };
      },
    });

    await addToBasket(buyerId, { variantId: variant.id, quantity: 8 });
    const key = `idem-${sku}-email`;
    const first = await placeOrder(buyerId, {
      idempotencyKey: key,
      addressId: address.id,
      expectedLinePrices: [{ variantId: variant.id, customerUnitPrice: "3.25" }],
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    // Order committed despite email failure.
    expect(await prisma.order.count({ where: { id: first.order.id } })).toBe(1);

    const emails = await prisma.transactionalEmail.findMany({
      where: { entityId: first.order.id, purpose: "ORDER_RECEIVED" },
    });
    expect(emails).toHaveLength(1);
    expect(emails[0]!.status).toBe("FAILED");
    expect(emails[0]!.textBody).toContain("3.25");
    expect(emails[0]!.idempotencyKey).toBe(`ORDER_RECEIVED:${first.order.id}`);

    // Change live trade price — retry must still use snapshot 3.25.
    await prisma.productVariant.update({
      where: { id: variant.id },
      data: { tradePrice: 9.99 },
    });

    const retried = await retryTransactionalEmail(adminId, emails[0]!.id);
    expect(retried.status).toBe("SENT");
    const afterRetry = await prisma.transactionalEmail.findUniqueOrThrow({
      where: { id: emails[0]!.id },
    });
    expect(afterRetry.textBody).toContain("3.25");
    expect(afterRetry.textBody).not.toContain("9.99");

    // Idempotent double place — still one customer email.
    const second = await placeOrder(buyerId, {
      idempotencyKey: key,
      addressId: address.id,
    });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.order.id).toBe(first.order.id);
    expect(
      await prisma.transactionalEmail.count({
        where: { entityId: first.order.id, purpose: "ORDER_RECEIVED" },
      }),
    ).toBe(1);

    // Re-running after-commit is also idempotent.
    await sendOrderEmailsAfterCommit(first.order.id);
    expect(
      await prisma.transactionalEmail.count({
        where: { entityId: first.order.id, purpose: "ORDER_RECEIVED" },
      }),
    ).toBe(1);
  });

  it("creates internal email when TRADE_ORDER_NOTIFICATION_EMAIL is set", async () => {
    await enableTransactionalEmail();
    process.env["TRADE_ORDER_NOTIFICATION_EMAIL"] = "ops@example.invalid";
    setEmailAdapterForTests({
      name: "test-ok",
      async send() {
        return { ok: true, id: "internal-ok" };
      },
    });

    const { sku, variant } = await seedOrderableVariant("RSVINT", {
      trade: 2,
      caseQty: 4,
      avail: 20,
    });
    const { company, address } = await seedCompanyWithAddress(`Int Co ${sku}`);
    const buyerId = await ensureTradeBuyer(`int-${sku}@example.invalid`, company.id);
    await addToBasket(buyerId, { variantId: variant.id, quantity: 4 });

    const result = await placeOrder(buyerId, {
      idempotencyKey: `idem-${sku}-int`,
      addressId: address.id,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const internal = await prisma.transactionalEmail.findUnique({
      where: {
        idempotencyKey: `ORDER_RECEIVED_INTERNAL:${result.order.id}:ops@example.invalid`,
      },
    });
    expect(internal).toBeTruthy();
    expect(internal!.toEmail).toBe("ops@example.invalid");
    expect(internal!.status).toBe("SENT");
    expect(internal!.textBody).toContain("Autopart linked:");
  });
});

describe("AuthError mapping", () => {
  it("exposes INSUFFICIENT_STOCK as AuthError", () => {
    const err = new AuthError("Insufficient stock for one or more lines", "INSUFFICIENT_STOCK", 409);
    expect(err.code).toBe("INSUFFICIENT_STOCK");
  });
});
