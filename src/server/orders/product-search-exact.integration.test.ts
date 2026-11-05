import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { searchSalesOrderProducts } from "@/server/orders/sales-order-entry";

const prisma = new PrismaClient();
let adminId = "";
let companyId = "";
let brandId = "";
let categoryId = "";

async function ensureAdmin() {
  const email = `sku-search-admin-${Date.now()}@example.invalid`;
  const user = await prisma.user.create({
    data: {
      email,
      name: "SKU Search Admin",
      status: "ACTIVE",
      actorType: "INTERNAL",
      emailVerified: true,
    },
  });
  const role = await prisma.role.findUniqueOrThrow({ where: { key: "SUPER_ADMIN" } });
  await prisma.userRole.create({ data: { userId: user.id, roleId: role.id } });
  return user.id;
}

describe("exact SKU first product search", () => {
  beforeAll(async () => {
    adminId = await ensureAdmin();
    const stamp = Date.now();
    const brand = await prisma.brand.create({
      data: { name: `Exact Brand ${stamp}`, slug: `exact-brand-${stamp}`, isActive: true },
    });
    brandId = brand.id;
    const category = await prisma.category.create({
      data: { name: `Exact Cat ${stamp}`, slug: `exact-cat-${stamp}`, isActive: true },
    });
    categoryId = category.id;

    const company = await prisma.company.create({
      data: { name: `Exact Search Co ${stamp}`, status: "ACTIVE" },
    });
    companyId = company.id;

    async function seed(sku: string, name: string) {
      const product = await prisma.product.create({
        data: {
          name,
          slug: `${sku.toLowerCase()}-${stamp}`,
          brandId,
          categoryId,
          status: "ACTIVE",
          isActive: true,
          isTradeVisible: true,
          variants: {
            create: {
              sku,
              tradePrice: "10.00",
              rrp: "12.00",
              isActive: true,
              isDefault: true,
            },
          },
        },
      });
      return product;
    }

    // Short unique exact code — mirrors the SS vs contains-SS behaviour.
    const exactSku = `Z${String(stamp).slice(-5)}`;
    await seed(exactSku, `Exact ${exactSku} Product`);
    await seed(`${exactSku}-KIT`, `Kit containing ${exactSku} in title`);
    await seed(`BOSS-${stamp}`, "Boss polish");
    (globalThis as { __exactSku?: string }).__exactSku = exactSku;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("returns only the exact SKU when it exists", async () => {
    const exactSku = (globalThis as { __exactSku?: string }).__exactSku!;
    const hits = await searchSalesOrderProducts(adminId, {
      companyId,
      q: `  ${exactSku.toLowerCase()}  `,
    });
    expect(hits.length).toBeGreaterThanOrEqual(1);
    expect(hits.every((hit) => hit.sku.toUpperCase() === exactSku.toUpperCase())).toBe(true);
  });

  it("falls back to contains when no exact SKU exists", async () => {
    const hits = await searchSalesOrderProducts(adminId, {
      companyId,
      q: "BOSS",
    });
    expect(hits.some((hit) => hit.sku.toUpperCase().includes("BOSS"))).toBe(true);
  });
});
