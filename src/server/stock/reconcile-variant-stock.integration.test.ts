import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { bootstrapRbac } from "../../../prisma/bootstrap/rbac";
import { reconcileVariantStockFromAutopartMaster } from "@/server/stock/reconcile-variant-stock";
import { ensureAutopartWarehouse } from "@/server/stock/service";
import { DEFAULT_VARIANT_BACKORDER_POLICY } from "@/domain/backorder";

const prisma = new PrismaClient();
const stamp = Date.now();
let brandId = "";
let categoryId = "";
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
  return user.id;
}

beforeAll(async () => {
  await bootstrapRbac(prisma);
  adminId = await ensureUser(`stock.reconcile.${stamp}@example.invalid`, ["SUPER_ADMIN"]);
  await ensureAutopartWarehouse();
  const brand = await prisma.brand.create({
    data: { name: `Reconcile Brand ${stamp}`, slug: `reconcile-brand-${stamp}`, isActive: true },
  });
  brandId = brand.id;
  const category = await prisma.category.create({
    data: { name: `Reconcile Cat ${stamp}`, slug: `reconcile-cat-${stamp}`, isActive: true },
  });
  categoryId = category.id;
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("reconcileVariantStockFromAutopartMaster", () => {
  it("defaults new variant policy constant to INHERIT", () => {
    expect(DEFAULT_VARIANT_BACKORDER_POLICY).toBe("INHERIT");
  });

  it("initialises inventory from a trusted master with positive Avail", async () => {
    const sku = `RECPLUS${stamp}`;
    const product = await prisma.product.create({
      data: {
        name: `Plus ${stamp}`,
        slug: `plus-${stamp}`,
        brandId,
        categoryId,
        status: "ACTIVE",
        isActive: true,
        variants: {
          create: { sku, isDefault: true, isActive: true, backorderPolicy: "INHERIT" },
        },
      },
      include: { variants: true },
    });
    const variant = product.variants[0]!;
    await prisma.autopartProduct.create({
      data: {
        sku,
        matchKey: sku,
        description: "plus",
        availQty: 20,
        firstSeenAt: new Date(),
        lastSeenAt: new Date(),
        presentInLatestFeed: true,
        sourceAvailRaw: "20",
      },
    });

    const result = await reconcileVariantStockFromAutopartMaster({
      variantId: variant.id,
      sku,
      actorUserId: adminId,
    });
    expect(result.status).toBe("linked_and_confirmed");
    if (result.status === "linked_and_confirmed") expect(result.availQty).toBe(20);

    const inv = await prisma.inventory.findFirst({ where: { variantId: variant.id } });
    expect(inv?.qtyOnHand).toBe(20);
    const master = await prisma.autopartProduct.findUniqueOrThrow({ where: { matchKey: sku } });
    expect(master.catalogueVariantId).toBe(variant.id);

    // Idempotent — does not overwrite existing inventory.
    const again = await reconcileVariantStockFromAutopartMaster({
      variantId: variant.id,
      sku,
      actorUserId: adminId,
    });
    expect(again.status).toBe("linked_only");
    const inv2 = await prisma.inventory.findFirst({ where: { variantId: variant.id } });
    expect(inv2?.qtyOnHand).toBe(20);
  });

  it("confirms zero Avail without inventing positive stock", async () => {
    const sku = `RECZERO${stamp}`;
    const product = await prisma.product.create({
      data: {
        name: `Zero ${stamp}`,
        slug: `zero-${stamp}`,
        brandId,
        categoryId,
        status: "ACTIVE",
        isActive: true,
        variants: {
          create: { sku, isDefault: true, isActive: true, backorderPolicy: "INHERIT" },
        },
      },
      include: { variants: true },
    });
    const variant = product.variants[0]!;
    await prisma.autopartProduct.create({
      data: {
        sku,
        matchKey: sku,
        description: "zero",
        availQty: 0,
        firstSeenAt: new Date(),
        lastSeenAt: new Date(),
        presentInLatestFeed: true,
        sourceAvailRaw: "0",
      },
    });
    const result = await reconcileVariantStockFromAutopartMaster({
      variantId: variant.id,
      sku,
      actorUserId: adminId,
    });
    expect(result.status).toBe("linked_and_confirmed");
    const inv = await prisma.inventory.findFirst({ where: { variantId: variant.id } });
    expect(inv?.qtyOnHand).toBe(0);
  });

  it("leaves stock unconfirmed when no master exists", async () => {
    const sku = `RECNONE${stamp}`;
    const product = await prisma.product.create({
      data: {
        name: `None ${stamp}`,
        slug: `none-${stamp}`,
        brandId,
        categoryId,
        status: "ACTIVE",
        isActive: true,
        variants: {
          create: { sku, isDefault: true, isActive: true, backorderPolicy: "INHERIT" },
        },
      },
      include: { variants: true },
    });
    const variant = product.variants[0]!;
    const result = await reconcileVariantStockFromAutopartMaster({
      variantId: variant.id,
      sku,
      actorUserId: adminId,
    });
    expect(result.status).toBe("no_master");
    const inv = await prisma.inventory.findFirst({ where: { variantId: variant.id } });
    expect(inv).toBeNull();
  });

  it("does not overwrite an existing manual override", async () => {
    const sku = `RECMAN${stamp}`;
    const product = await prisma.product.create({
      data: {
        name: `Man ${stamp}`,
        slug: `man-${stamp}`,
        brandId,
        categoryId,
        status: "ACTIVE",
        isActive: true,
        variants: {
          create: { sku, isDefault: true, isActive: true, backorderPolicy: "INHERIT" },
        },
      },
      include: { variants: true },
    });
    const variant = product.variants[0]!;
    const warehouse = await ensureAutopartWarehouse();
    await prisma.inventory.create({
      data: {
        variantId: variant.id,
        warehouseId: warehouse.id,
        qtyOnHand: 5,
        qtyReserved: 0,
        status: "IN_STOCK",
        manualOverrideQty: 3,
        manualOverrideReason: "test",
        manualOverrideAt: new Date(),
        manualOverrideByUserId: adminId,
      },
    });
    await prisma.autopartProduct.create({
      data: {
        sku,
        matchKey: sku,
        description: "man",
        availQty: 99,
        firstSeenAt: new Date(),
        lastSeenAt: new Date(),
        presentInLatestFeed: true,
      },
    });
    const result = await reconcileVariantStockFromAutopartMaster({
      variantId: variant.id,
      sku,
      actorUserId: adminId,
    });
    expect(result.status).toBe("linked_only");
    const inv = await prisma.inventory.findFirst({ where: { variantId: variant.id } });
    expect(inv?.qtyOnHand).toBe(5);
    expect(inv?.manualOverrideQty).toBe(3);
  });
});
