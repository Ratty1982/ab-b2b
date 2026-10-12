import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { bootstrapRbac } from "../../../prisma/bootstrap/rbac";
import { saveProduct } from "@/server/catalogue/service";
import { getPortalDashboard } from "@/server/portal/dashboard";
import { listCustomerPromotions } from "@/server/portal/promotions";
import { AuthError } from "@/server/rbac/guards";

const prisma = new PrismaClient();
const suffix = `${Date.now()}`;
const at = new Date("2026-10-12T11:00:00.000Z");

let adminId = "";
let buyerId = "";
let internalId = "";
let companyId = "";
let productId = "";
const promotionIds: string[] = [];

async function ensureInternal(email: string) {
  const user = await prisma.user.create({
    data: {
      email,
      name: email.split("@")[0]!,
      status: "ACTIVE",
      actorType: "INTERNAL",
      emailVerified: true,
    },
  });
  const role = await prisma.role.findUniqueOrThrow({ where: { key: "SUPER_ADMIN" } });
  await prisma.userRole.create({ data: { userId: user.id, roleId: role.id } });
  return user.id;
}

beforeAll(async () => {
  await bootstrapRbac(prisma);
  adminId = await ensureInternal(`portal.promo.admin.${suffix}@example.invalid`);
  internalId = await ensureInternal(`portal.promo.staff.${suffix}@example.invalid`);
  const company = await prisma.company.create({
    data: { name: `Portal Promo ${suffix}`, status: "ACTIVE" },
  });
  companyId = company.id;
  const buyer = await prisma.user.create({
    data: {
      email: `portal.promo.buyer.${suffix}@example.invalid`,
      name: `Portal Buyer ${suffix}`,
      status: "ACTIVE",
      actorType: "TRADE",
      emailVerified: true,
    },
  });
  buyerId = buyer.id;
  await prisma.companyUser.create({
    data: { companyId, userId: buyerId, role: "TRADE_BUYER", status: "ACTIVE", isDefault: true },
  });
});

afterAll(async () => {
  if (promotionIds.length) {
    await prisma.promotion.deleteMany({ where: { id: { in: promotionIds } } });
  }
  if (productId) await prisma.product.delete({ where: { id: productId } });
  if (companyId) await prisma.company.delete({ where: { id: companyId } });
  const userIds = [adminId, buyerId, internalId].filter(Boolean);
  if (userIds.length) {
    await prisma.userRole.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  }
  await prisma.$disconnect();
});

describe("customer promotions", () => {
  it("lists current engine-eligible offers and leaves promotion rows unchanged", async () => {
    const product = await saveProduct(adminId, {
      sku: `PPROMO-${suffix}`,
      name: `Portal Promo Cleaner ${suffix}`,
      brand: "Power Maxed",
      category: "Braking",
      trade: 8.7,
      rrp: 17.99,
      packQty: 1,
      caseQty: 6,
      description: "portal promotion fixture",
      active: true,
    });
    productId = product.id;
    const variant = await prisma.productVariant.findFirstOrThrow({ where: { productId } });

    const created = await prisma.promotion.createManyAndReturn({
      data: [
        {
          code: `PPROMO-A-${suffix}`,
          name: `Portal percent ${suffix}`,
          type: "PERCENT",
          value: "10.0000",
          isActive: true,
        },
        {
          code: `PPROMO-B-${suffix}`,
          name: `Portal fixed ${suffix}`,
          type: "FIXED",
          value: "1.5000",
          isActive: true,
          startsAt: new Date("2026-10-01T00:00:00.000Z"),
          endsAt: new Date("2026-10-31T23:00:00.000Z"),
        },
        {
          code: `PPROMO-C-${suffix}`,
          name: `Portal scoped ${suffix}`,
          type: "PERCENT",
          value: "5.0000",
          isActive: true,
          metadata: { variantIds: [variant.id], skus: [`MISSING-${suffix}`] },
        },
        {
          code: `PPROMO-D-${suffix}`,
          name: `Portal deal ${suffix}`,
          type: "QUANTITY_DEAL",
          value: "2.0000",
          isActive: true,
        },
        {
          code: `PPROMO-E-${suffix}`,
          name: `Portal paused ${suffix}`,
          type: "PERCENT",
          value: "15.0000",
          isActive: false,
        },
        {
          code: `PPROMO-F-${suffix}`,
          name: `Portal future ${suffix}`,
          type: "FIXED",
          value: "2.0000",
          isActive: true,
          startsAt: new Date("2026-11-01T00:00:00.000Z"),
        },
      ],
    });
    promotionIds.push(...created.map((row) => row.id));
    const before = await prisma.promotion.findMany({
      where: { id: { in: promotionIds } },
      orderBy: { code: "asc" },
    });

    await expect(listCustomerPromotions(internalId, at)).rejects.toBeInstanceOf(AuthError);

    const listed = await listCustomerPromotions(buyerId, at);
    const ours = listed.filter((row) => promotionIds.includes(row.id));
    expect(ours.map((row) => row.code).sort()).toEqual(
      [`PPROMO-A-${suffix}`, `PPROMO-B-${suffix}`, `PPROMO-C-${suffix}`].sort(),
    );
    const percent = ours.find((row) => row.code === `PPROMO-A-${suffix}`);
    expect(percent?.offerLabel).toBe("10% off");
    expect(percent?.scope).toBe("catalogue");
    expect(percent?.validityLabel).toBe("Open ended");
    const fixed = ours.find((row) => row.code === `PPROMO-B-${suffix}`);
    expect(fixed?.offerLabel).toBe("£1.50 off each unit");
    const scoped = ours.find((row) => row.code === `PPROMO-C-${suffix}`);
    expect(scoped?.products).toEqual([{ sku: variant.sku, name: `Portal Promo Cleaner ${suffix}` }]);
    expect(scoped?.products.some((product) => product.sku.includes("MISSING"))).toBe(false);

    const after = await prisma.promotion.findMany({
      where: { id: { in: promotionIds } },
      orderBy: { code: "asc" },
    });
    expect(after.map((row) => ({
      id: row.id,
      code: row.code,
      type: row.type,
      isActive: row.isActive,
      value: row.value.toString(),
      updatedAt: row.updatedAt.toISOString(),
    }))).toEqual(
      before.map((row) => ({
        id: row.id,
        code: row.code,
        type: row.type,
        isActive: row.isActive,
        value: row.value.toString(),
        updatedAt: row.updatedAt.toISOString(),
      })),
    );

    const dash = await getPortalDashboard(buyerId);
    expect(dash.currentPromotions.count).toBeGreaterThanOrEqual(3);
    expect(dash.currentPromotions.items.length).toBeLessThanOrEqual(3);
    expect(dash.features.promotions).toBe(true);
  });
});
