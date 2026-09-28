import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { bootstrapRbac } from "../../../prisma/bootstrap/rbac";
import { AuthError } from "@/server/rbac/guards";
import { placeOrder } from "@/server/orders/service";
import {
  evaluateOrderCredit,
  lockCompanyForCredit,
  releaseOrderCreditHold,
  sumPendingApprovedAbExposure,
} from "@/server/orders/credit-control";
import { saveProduct } from "@/server/catalogue/service";
import { addToBasket } from "@/server/basket/service";
import { prisma as appPrisma } from "@/infra/database/client";
import { previewAutopartOrderExport, exportAutopartOrdersCsv } from "@/server/orders/autopart-export";
import { moneyToString } from "@/domain/money";

const prisma = new PrismaClient();

let adminId = "";
let sku = "";

async function ensureUser(email: string, roles: string[], actorType: "INTERNAL" | "TRADE" = "INTERNAL") {
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

async function seedStock(variantId: string, qty: number) {
  const warehouse = await prisma.warehouse.upsert({
    where: { code: "MAIN" },
    create: { code: "MAIN", name: "Main" },
    update: {},
  });
  await prisma.inventory.upsert({
    where: { variantId_warehouseId: { variantId, warehouseId: warehouse.id } },
    create: {
      variantId,
      warehouseId: warehouse.id,
      qtyOnHand: qty,
      qtyReserved: 0,
    },
    update: { qtyOnHand: qty, qtyReserved: 0 },
  });
}

async function seedCreditPosition(opts: {
  companyId: string;
  code: string;
  limit: string;
  exposure: string;
  importedAt: Date;
}) {
  const available = (Number(opts.limit) - Number(opts.exposure)).toFixed(2);
  await prisma.autopartCreditPosition.upsert({
    where: { companyId: opts.companyId },
    create: {
      companyId: opts.companyId,
      autopartCustomerCode: opts.code,
      invoices: opts.exposure,
      picking: 0,
      dropShip: 0,
      crossDock: 0,
      suspends: 0,
      unConsol: 0,
      totalExposure: opts.exposure,
      creditLimit: opts.limit,
      availableCreditRaw: available,
      sourceReport: "407P100",
      sourceImportedAt: opts.importedAt,
    },
    update: {
      totalExposure: opts.exposure,
      creditLimit: opts.limit,
      availableCreditRaw: available,
      invoices: opts.exposure,
      sourceImportedAt: opts.importedAt,
      autopartCustomerCode: opts.code,
    },
  });
}

async function seedTradeCompany(label: string) {
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const code = `C${stamp.replace(/[^a-zA-Z0-9]/g, "").slice(-9)}`.slice(0, 12);
  const company = await prisma.company.create({
    data: {
      name: `${label} ${stamp}`,
      status: "ACTIVE",
      paymentTerms: "30 Days",
      autopartCustomerCode: code,
      autopartCustomerCodeVerifiedAt: new Date(),
      autopartCustomerCodeVerifiedById: adminId,
    },
  });
  const address = await prisma.address.create({
    data: {
      companyId: company.id,
      label: "Main",
      line1: "1 Test Street",
      town: "York",
      postcode: "YO1 1AA",
      country: "GB",
      isDefaultDelivery: true,
    },
  });
  const buyerId = await ensureUser(`buyer.${stamp}@example.invalid`, [], "TRADE");
  await prisma.companyUser.create({
    data: {
      companyId: company.id,
      userId: buyerId,
      role: "TRADE_BUYER",
      status: "ACTIVE",
      isDefault: true,
    },
  });
  return { company, address, buyerId, code };
}

beforeAll(async () => {
  await bootstrapRbac(prisma);
  adminId = await ensureUser("credit.ctrl.admin@example.invalid", ["SUPER_ADMIN"]);
  sku = `CCSKU-${Date.now()}`;
  const product = await saveProduct(adminId, {
    sku,
    name: "Credit Control Test Part",
    brand: "Power Maxed",
    category: "Engine",
    trade: 100,
    rrp: 150,
    packQty: 1,
    caseQty: 1,
    description: "credit test",
    active: true,
  });
  await seedStock(product.variantId, 10000);
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("credit control — placeOrder", () => {
  it("APPROVED when within available credit", async () => {
    const { company, address, buyerId, code } = await seedTradeCompany("Credit Pass");
    await seedCreditPosition({
      companyId: company.id,
      code,
      limit: "5000.00",
      exposure: "3494.75",
      importedAt: new Date(),
    });
    const variant = await prisma.productVariant.findUniqueOrThrow({ where: { sku } });
    await addToBasket(buyerId, { variantId: variant.id, quantity: 10 });
    const result = await placeOrder(buyerId, {
      idempotencyKey: `credit-pass-${Date.now()}`,
      addressId: address.id,
      expectedLinePrices: [{ variantId: variant.id, customerUnitPrice: "100.00" }],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const order = await prisma.order.findUniqueOrThrow({ where: { id: result.order.id } });
    expect(order.creditStatus).toBe("APPROVED");
    expect(order.orderNumber).toMatch(/^AB-/);
  });

  it("HOLD when order exceeds available — still creates AB order and blocks export", async () => {
    const { company, address, buyerId, code } = await seedTradeCompany("Credit Hold");
    await seedCreditPosition({
      companyId: company.id,
      code,
      limit: "5000.00",
      exposure: "3494.75",
      importedAt: new Date(),
    });
    const variant = await prisma.productVariant.findUniqueOrThrow({ where: { sku } });
    await addToBasket(buyerId, { variantId: variant.id, quantity: 17 });
    const result = await placeOrder(buyerId, {
      idempotencyKey: `credit-hold-${Date.now()}`,
      addressId: address.id,
      expectedLinePrices: [{ variantId: variant.id, customerUnitPrice: "100.00" }],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const order = await prisma.order.findUniqueOrThrow({ where: { id: result.order.id } });
    expect(order.creditStatus).toBe("HOLD");
    expect(order.creditDecisionReason).toBe("EXCEEDS_AVAILABLE_CREDIT");
    expect(Number(order.creditOverBy)).toBeGreaterThan(0);

    const preview = await previewAutopartOrderExport(adminId, [order.id]);
    expect(preview.items[0]?.eligible).toBe(false);
    expect(preview.items[0]?.reason).toBe("CREDIT_APPROVAL_REQUIRED");
    await expect(exportAutopartOrdersCsv(adminId, [order.id])).rejects.toBeInstanceOf(AuthError);
  });

  it("pending approved exposure holds the second order", async () => {
    const { company, code } = await seedTradeCompany("Credit Pending");
    const snapAt = new Date(Date.now() - 60 * 60 * 1000);
    await seedCreditPosition({
      companyId: company.id,
      code,
      limit: "5000.00",
      exposure: "3494.75",
      importedAt: snapAt,
    });

    await prisma.order.create({
      data: {
        orderNumber: `AB-PENDA-${Date.now()}`,
        companyId: company.id,
        status: "SUBMITTED",
        subtotal: "833.33",
        vatTotal: "166.67",
        deliveryTotal: "0",
        grandTotal: "1000.00",
        creditStatus: "APPROVED",
        creditDecisionReason: "WITHIN_AVAILABLE_CREDIT",
        orderCreditRequirement: "1000.00",
        placedAt: new Date(Date.now() - 30 * 60 * 1000),
        contactSnapshot: { name: "T", email: "t@example.invalid", phone: null },
        deliveryAddress: {
          line1: "2 Test Street",
          town: "York",
          postcode: "YO1 2BB",
          country: "GB",
        },
        autopartAccountLinked: true,
        autopartCustomerCodeSnapshot: code,
        items: {
          create: {
            sku,
            name: "line",
            qty: 1,
            unitPrice: 100,
            customerUnitPrice: 100,
            lineTotal: 100,
            lineVat: 20,
            lineGross: 120,
            vatRate: 0.2,
          },
        },
      },
    });

    const pending = await sumPendingApprovedAbExposure(appPrisma, company.id, snapAt);
    expect(moneyToString(pending, 2)).toBe("1000.00");

    const decision = await appPrisma.$transaction(async (tx) => {
      await lockCompanyForCredit(tx, company.id);
      return evaluateOrderCredit(tx, {
        companyId: company.id,
        grandTotal: "1000.00",
        paymentTerms: "30 Days",
        hasVerifiedAutopartAccount: true,
      });
    });
    expect(decision.reason).toBe("EXCEEDS_AVAILABLE_CREDIT");
    expect(decision.creditStatus).toBe("HOLD");
    expect(decision.creditSnapshotStatus).toBe("CURRENT");
    expect(decision.pendingAbExposure).toBe("1000.00");
    expect(decision.effectiveAvailableCredit).toBe("505.25");
    expect(decision.overBy).toBe("494.75");
  });

  it("REVIEW_REQUIRED when no 407P100", async () => {
    const { company } = await seedTradeCompany("Credit Missing");
    const decision = await appPrisma.$transaction(async (tx) => {
      await lockCompanyForCredit(tx, company.id);
      return evaluateOrderCredit(tx, {
        companyId: company.id,
        grandTotal: "500.00",
        paymentTerms: "30 Days",
        hasVerifiedAutopartAccount: true,
      });
    });
    expect(decision.creditStatus).toBe("REVIEW_REQUIRED");
    expect(decision.reason).toBe("CREDIT_INFORMATION_NOT_AVAILABLE");
  });

  it("REVIEW_REQUIRED when snapshot is stale", async () => {
    const { company, code } = await seedTradeCompany("Credit Stale");
    await seedCreditPosition({
      companyId: company.id,
      code,
      limit: "5000",
      exposure: "1000",
      importedAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
    });
    const decision = await appPrisma.$transaction(async (tx) => {
      await lockCompanyForCredit(tx, company.id);
      return evaluateOrderCredit(tx, {
        companyId: company.id,
        grandTotal: "100.00",
        paymentTerms: "30 Days",
        hasVerifiedAutopartAccount: true,
      });
    });
    expect(decision.creditStatus).toBe("REVIEW_REQUIRED");
    expect(decision.reason).toBe("CREDIT_INFORMATION_STALE");
  });

  it("manual release authorises export path and denies unauthorised actors", async () => {
    const { company, buyerId, code } = await seedTradeCompany("Credit Release");
    const order = await prisma.order.create({
      data: {
        orderNumber: `AB-REL-${Date.now()}`,
        companyId: company.id,
        status: "SUBMITTED",
        subtotal: "1666.67",
        vatTotal: "333.33",
        deliveryTotal: "0",
        grandTotal: "2000.00",
        creditStatus: "HOLD",
        creditDecisionReason: "EXCEEDS_AVAILABLE_CREDIT",
        creditOverBy: "494.75",
        orderCreditRequirement: "2000.00",
        placedAt: new Date(),
        contactSnapshot: { name: "T", email: "t@example.invalid", phone: null },
        deliveryAddress: {
          line1: "1 Test Street",
          town: "York",
          postcode: "YO1 1AA",
          country: "GB",
        },
        autopartAccountLinked: true,
        autopartCustomerCodeSnapshot: code,
        items: {
          create: {
            sku,
            name: "line",
            qty: 1,
            unitPrice: 100,
            customerUnitPrice: 100,
            lineTotal: 100,
            lineVat: 20,
            lineGross: 120,
            vatRate: 0.2,
          },
        },
      },
    });

    await expect(
      releaseOrderCreditHold(buyerId, { orderId: order.id, note: "nope" }),
    ).rejects.toBeInstanceOf(AuthError);

    const released = await releaseOrderCreditHold(adminId, {
      orderId: order.id,
      note: "Customer paid down balance — release approved",
    });
    expect(released.creditStatus).toBe("APPROVED");
    const after = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(after.creditStatus).toBe("APPROVED");
    expect(after.creditApprovalNote).toContain("paid down");
    expect(after.previousCreditStatus).toBe("HOLD");
  });

  it("newer 407P100 drops prior APPROVED orders from pending exposure", async () => {
    const { company, code } = await seedTradeCompany("Credit Recon");
    const oldSnap = new Date("2026-09-01T10:00:00.000Z");
    const newSnap = new Date("2026-09-28T10:00:00.000Z");
    await seedCreditPosition({
      companyId: company.id,
      code,
      limit: "5000",
      exposure: "2494.75",
      importedAt: newSnap,
    });
    await prisma.order.create({
      data: {
        orderNumber: `AB-OLD-${Date.now()}`,
        companyId: company.id,
        status: "SUBMITTED",
        subtotal: "833.33",
        vatTotal: "166.67",
        deliveryTotal: "0",
        grandTotal: "1000.00",
        creditStatus: "APPROVED",
        placedAt: new Date("2026-09-10T12:00:00.000Z"),
        contactSnapshot: { name: "T", email: "t@example.invalid", phone: null },
        deliveryAddress: {
          line1: "1",
          town: "York",
          postcode: "YO1 1AA",
          country: "GB",
        },
        items: {
          create: {
            sku,
            name: "x",
            qty: 1,
            unitPrice: 1,
            customerUnitPrice: 1,
            lineTotal: 1,
            lineVat: 0,
            lineGross: 1,
            vatRate: 0,
          },
        },
      },
    });
    const pendingVsOld = await sumPendingApprovedAbExposure(appPrisma, company.id, oldSnap);
    expect(moneyToString(pendingVsOld, 2)).toBe("1000.00");
    const pendingVsNew = await sumPendingApprovedAbExposure(appPrisma, company.id, newSnap);
    expect(moneyToString(pendingVsNew, 2)).toBe("0.00");
  });
});
