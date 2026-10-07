import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { bootstrapRbac } from "../../../prisma/bootstrap/rbac";
import { skuMatchKey } from "@/domain/stock";
import { AuthError } from "@/server/rbac/guards";
import { getPublicProduct } from "@/server/catalogue/products";
import { saveProduct } from "@/server/catalogue/service";
import {
  addProductSupplier,
  createSupplier,
  listSuppliers,
  setPreferredProductSupplier,
  setProductSupplierActive,
  setSupplierActive,
  updateSupplier,
} from "@/server/purchasing/suppliers";

const prisma = new PrismaClient();
const stamp = Date.now();
const catalogueSku = `SUP-CAT-${stamp}`;
const externalSku = `SUP-EXT-${stamp}`;

let adminId = "";
let accountsId = "";
let salesId = "";
let tradeId = "";

async function ensureUser(email: string, roles: string[], actorType: "INTERNAL" | "TRADE" = "INTERNAL") {
  let user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    user = await prisma.user.create({
      data: { email, name: email.split("@")[0]!, status: "ACTIVE", actorType, emailVerified: true },
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
  adminId = await ensureUser(`sup.admin.${stamp}@example.invalid`, ["SUPER_ADMIN"]);
  accountsId = await ensureUser(`sup.acc.${stamp}@example.invalid`, ["ACCOUNTS"]);
  salesId = await ensureUser(`sup.sales.${stamp}@example.invalid`, ["SALES_REPRESENTATIVE"]);
  tradeId = await ensureUser(`sup.trade.${stamp}@example.invalid`, [], "TRADE");

  const product = await saveProduct(adminId, {
    sku: catalogueSku,
    name: `Supplier catalogue ${stamp}`,
    brand: "Power Maxed",
    category: "Cleaning",
    trade: 4,
    rrp: 8,
    packQty: 1,
    caseQty: 1,
  });
  await prisma.product.update({
    where: { id: product.id },
    data: { status: "ACTIVE", isActive: true, isTradeVisible: true, slug: `supplier-cat-${stamp}` },
  });
  const now = new Date();
  await prisma.autopartProduct.create({
    data: {
      sku: externalSku,
      matchKey: skuMatchKey(externalSku),
      description: "External purchasing SKU",
      availQty: 1,
      incomingQty: 0,
      presentInLatestFeed: true,
      firstSeenAt: now,
      lastSeenAt: now,
    },
  });
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("supplier master", () => {
  it("creates, edits and deactivates a supplier and rejects a duplicate code", async () => {
    const created = await createSupplier(adminId, {
      name: `Alpha Supply ${stamp}`,
      code: `alp ${stamp}`,
      accountNumber: "ACC-1",
      defaultLeadTimeDays: 14,
      defaultMinimumOrderValue: "1000.00",
      currency: "gbp",
    });
    expect(created.code).toBe(`ALP-${stamp}`);
    expect(created.currency).toBe("GBP");
    const updated = await updateSupplier(adminId, { ...created, name: `Alpha Supply Updated ${stamp}`, id: created.id });
    expect(updated.name).toContain("Updated");
    await expect(
      createSupplier(adminId, { name: "Duplicate", code: created.code }),
    ).rejects.toMatchObject({ code: "VALIDATION" });
    const inactive = await setSupplierActive(adminId, { id: created.id, active: false });
    expect(inactive.active).toBe(false);
    const audits = await prisma.auditEvent.findMany({
      where: { entityId: created.id, entityType: "Supplier" },
      select: { action: true },
    });
    expect(audits.map((event) => event.action)).toEqual(
      expect.arrayContaining([
        "purchasing.supplier.create",
        "purchasing.supplier.update",
        "purchasing.supplier.deactivate",
      ]),
    );
  });

  it("lets a purchasing viewer read suppliers and blocks trade, sales and manage-without-permission", async () => {
    const listed = await listSuppliers(accountsId, { status: "all" });
    expect(listed.canManage).toBe(false);
    await expect(createSupplier(accountsId, { name: "Nope" })).rejects.toBeInstanceOf(AuthError);
    await expect(listSuppliers(tradeId, {})).rejects.toBeInstanceOf(AuthError);
    await expect(listSuppliers(salesId, {})).rejects.toBeInstanceOf(AuthError);
  });

  it("supports several suppliers per SKU with one active preferred, including an external Autopart product", async () => {
    const primary = await createSupplier(adminId, { name: `Primary ${stamp}`, code: `pri-${stamp}` });
    const secondary = await createSupplier(adminId, { name: `Secondary ${stamp}`, code: `sec-${stamp}` });
    const first = await addProductSupplier(adminId, {
      supplierId: primary.id,
      sku: catalogueSku,
      isPreferred: true,
      minimumOrderQty: 12,
      orderMultiple: 6,
      unitCost: "4.25",
    });
    await addProductSupplier(adminId, { supplierId: secondary.id, sku: catalogueSku, isPreferred: true });
    const rows = await prisma.productSupplier.findMany({
      where: { matchKey: skuMatchKey(catalogueSku), active: true },
    });
    expect(rows).toHaveLength(2);
    expect(rows.filter((row) => row.isPreferred)).toHaveLength(1);
    expect(rows.find((row) => row.isPreferred)?.supplierId).toBe(secondary.id);

    const external = await addProductSupplier(adminId, {
      supplierId: primary.id,
      sku: externalSku,
      supplierSku: "EXT-1",
    });
    const externalRow = await prisma.productSupplier.findUniqueOrThrow({ where: { id: external.id } });
    expect(externalRow.autopartProductId).toBeTruthy();
    expect(externalRow.variantId).toBeNull();

    await setPreferredProductSupplier(adminId, { id: first.id });
    const preferredAgain = await prisma.productSupplier.findMany({
      where: { matchKey: skuMatchKey(catalogueSku), isPreferred: true, active: true },
    });
    expect(preferredAgain).toHaveLength(1);
    expect(preferredAgain[0]?.supplierId).toBe(primary.id);

    await setProductSupplierActive(adminId, { id: first.id, active: false });
    const afterDeactivate = await prisma.productSupplier.findUniqueOrThrow({ where: { id: first.id } });
    expect(afterDeactivate.active).toBe(false);
    expect(afterDeactivate.isPreferred).toBe(false);

    const publicProduct = await getPublicProduct(null, `supplier-cat-${stamp}`);
    expect(publicProduct?.card.slug).toBe(`supplier-cat-${stamp}`);
    const serialised = JSON.stringify(publicProduct);
    expect(serialised).not.toContain(`Primary ${stamp}`);
    expect(serialised).not.toContain("4.25");
    expect(serialised).not.toMatch(/supplierSku|unitCost|ProductSupplier/);
  });
});
