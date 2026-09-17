import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";

import { bootstrapRbac } from "../../prisma/bootstrap/rbac";
import { AuthError } from "@/server/rbac/guards";
import {
  bootstrapCatalogue,
  createCategory,
  deleteCategory,
  listCategories,
  updateCategory,
  updateBrand,
} from "@/server/catalogue/service";

const prisma = new PrismaClient();
let adminId = "";
let salesRepUserId = "";

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
  adminId = await ensureUser("catalogue.admin@example.invalid", ["SUPER_ADMIN"]);
  salesRepUserId = await ensureUser("catalogue.sales@example.invalid", ["SALES_REPRESENTATIVE"]);
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("catalogue categories", () => {
  it("bootstraps a tree with subcategories and lets an editor nest a new child", async () => {
    const boot = await bootstrapCatalogue(prisma);
    expect(boot.categories).toBeGreaterThan(0);

    const tree = await listCategories(adminId);
    const braking = tree.find((c) => c.name === "Braking" && !c.parentId);
    expect(braking).toBeTruthy();
    expect(tree.some((c) => c.parentId === braking?.id)).toBe(true);

    const child = await createCategory(adminId, {
      name: `Pads ${Date.now()}`,
      parentId: braking!.id,
      isActive: true,
      sortOrder: 20,
    });
    expect(child.parentId).toBe(braking!.id);

    const renamed = await updateCategory(adminId, {
      id: child.id,
      name: child.name,
      slug: child.slug,
      parentId: braking!.id,
      description: "Workshop pads",
      isActive: true,
      sortOrder: 20,
    });
    expect(renamed.description).toBe("Workshop pads");
  });

  it("allows a deeper subcategory and rejects a circular parent", async () => {
    const tree = await listCategories(adminId);
    const child = tree.find((c) => c.parentId);
    expect(child).toBeTruthy();
    const grandchild = await createCategory(adminId, {
      name: `Deep ${Date.now()}`,
      parentId: child!.id,
      isActive: true,
    });
    expect(grandchild.parentId).toBe(child!.id);
    await expect(
      updateCategory(adminId, {
        id: child!.id,
        name: child!.name,
        slug: child!.slug,
        parentId: grandchild.id,
        isActive: true,
        sortOrder: child!.sortOrder,
      }),
    ).rejects.toBeInstanceOf(AuthError);
  });

  it("denies catalogue edits without products.edit", async () => {
    await expect(createCategory(salesRepUserId, { name: "Nope" })).rejects.toBeInstanceOf(AuthError);
  });

  it("deletes a category, reparents children and unassigns products", async () => {
    const parent = await createCategory(adminId, {
      name: `Delete parent ${Date.now()}`,
      isActive: true,
      sortOrder: 90,
    });
    const child = await createCategory(adminId, {
      name: `Delete child ${Date.now()}`,
      parentId: parent.id,
      isActive: true,
      sortOrder: 91,
    });
    const { saveProduct, listProducts } = await import("@/server/catalogue/service");
    const sku = `CATDEL-${Date.now()}`;
    await saveProduct(adminId, {
      sku,
      name: "Category delete fixture",
      brand: "Power Maxed",
      category: parent.name,
      trade: 1,
      rrp: 2,
      packQty: 1,
      caseQty: 1,
    });

    await expect(deleteCategory(salesRepUserId, { id: parent.id })).rejects.toBeInstanceOf(AuthError);

    const deleted = await deleteCategory(adminId, { id: parent.id });
    expect(deleted.id).toBe(parent.id);

    const tree = await listCategories(adminId);
    expect(tree.some((c) => c.id === parent.id)).toBe(false);
    const moved = tree.find((c) => c.id === child.id);
    expect(moved?.parentId).toBeNull();

    const products = await listProducts(adminId, sku);
    const row = products.find((p) => p.sku === sku);
    expect(row?.categoryId).toBeNull();

    await expect(deleteCategory(adminId, { id: parent.id })).rejects.toBeInstanceOf(AuthError);
  });

  it("does not recreate categories after they have all been deleted", async () => {
    let remaining = await listCategories(adminId);
    expect(remaining.length).toBeGreaterThan(0);
    while (remaining.length) {
      await deleteCategory(adminId, { id: remaining[0]!.id });
      remaining = await listCategories(adminId);
    }
    expect(remaining).toHaveLength(0);

    const boot = await bootstrapCatalogue(prisma);
    expect(boot.created).toBe(false);
    expect(boot.categories).toBe(0);
    expect(await listCategories(adminId)).toHaveLength(0);

    const { DEFAULT_CATEGORY_TREE } = await import("@/domain/catalogue");
    for (const [i, group] of DEFAULT_CATEGORY_TREE.entries()) {
      const parent = await createCategory(adminId, {
        name: group.name,
        description: group.description,
        isActive: true,
        sortOrder: i + 1,
      });
      for (const [j, child] of group.children.entries()) {
        await createCategory(adminId, {
          name: child.name,
          description: child.description,
          parentId: parent.id,
          isActive: true,
          sortOrder: j + 1,
        });
      }
    }
    expect((await listCategories(adminId)).some((c) => c.name === "Braking")).toBe(true);
  });

  it("updates a brand record", async () => {
    const { listBrands } = await import("@/server/catalogue/service");
    const brands = await listBrands(adminId);
    const pm = brands.find((b) => b.slug === "power-maxed") ?? brands[0];
    expect(pm).toBeTruthy();
    const updated = await updateBrand(adminId, {
      id: pm!.id,
      name: pm!.name,
      slug: pm!.slug,
      tagline: "Braking and drivetrain",
      description: pm!.description,
      isActive: true,
      sortOrder: pm!.sortOrder,
    });
    expect(updated.tagline).toBe("Braking and drivetrain");
  });
});

describe("catalogue products import export delete", () => {
  it("saves, exports, re-imports and deletes a SKU", async () => {
    const {
      saveProduct,
      listProducts,
      exportProductsCsv,
      importProducts,
      deleteProduct,
    } = await import("@/server/catalogue/service");

    const sku = `IMP-${Date.now()}`;
    const created = await saveProduct(adminId, {
      sku,
      name: "Import disc kit",
      brand: "Power Maxed",
      category: "Braking",
      subcategory: "Brake Discs",
      trade: 41.2,
      rrp: 55,
      packQty: 2,
      caseQty: 8,
      description: "CSV fixture",
    });
    expect(created.sku).toBe(sku);
    expect(created.trade).toBe(41.2);

    const listed = await listProducts(adminId, sku);
    expect(listed.some((p) => p.sku === sku)).toBe(true);

    const csv = await exportProductsCsv(adminId);
    expect(csv).toContain(sku);

    const roundTrip = await importProducts(
      adminId,
      csv.replace("Import disc kit", "Import disc kit updated"),
    );
    expect(roundTrip.updated + roundTrip.created).toBeGreaterThan(0);

    const after = await listProducts(adminId, sku);
    expect(after.find((p) => p.sku === sku)?.name).toBe("Import disc kit updated");

    await deleteProduct(adminId, sku);
    const gone = await listProducts(adminId, sku);
    expect(gone.some((p) => p.sku === sku)).toBe(false);
  });

  it("denies product delete without products.edit", async () => {
    const { deleteProduct } = await import("@/server/catalogue/service");
    await expect(deleteProduct(salesRepUserId, "NOPE")).rejects.toBeInstanceOf(AuthError);
  });
});

describe("phase 3 product master", () => {
  it("creates a product, rejects duplicate SKU, and updates without wiping description", async () => {
    const { createProduct, updateProductWorkspace, getProductWorkspace } = await import(
      "@/server/catalogue/products"
    );
    const { listBrands, listCategories } = await import("@/server/catalogue/service");
    const brands = await listBrands(adminId);
    const cats = await listCategories(adminId);
    const sku = `P3-${Date.now()}`;
    const created = await createProduct(adminId, {
      sku,
      name: "Phase 3 sealant",
      brandId: brands[0]!.id,
      categoryId: cats[0]!.id,
    });
    await updateProductWorkspace(adminId, {
      id: created.id,
      description: "Keep this copy",
      tradePrice: 9.5,
      rrp: 12,
    });
    await expect(
      createProduct(adminId, {
        sku,
        name: "Duplicate",
        brandId: brands[0]!.id,
        categoryId: cats[0]!.id,
      }),
    ).rejects.toBeInstanceOf(AuthError);

    await updateProductWorkspace(adminId, { id: created.id, name: "Phase 3 sealant updated" });
    const loaded = await getProductWorkspace(adminId, created.id);
    expect(loaded.name).toBe("Phase 3 sealant updated");
    expect(loaded.description).toBe("Keep this copy");
    expect(loaded.tradePrice).toBe(9.5);
  });

  it("denies create without products.create", async () => {
    const { createProduct } = await import("@/server/catalogue/products");
    const { listBrands, listCategories } = await import("@/server/catalogue/service");
    const brands = await listBrands(adminId);
    const cats = await listCategories(adminId);
    await expect(
      createProduct(salesRepUserId, {
        sku: `NOPE-${Date.now()}`,
        name: "Nope",
        brandId: brands[0]!.id,
        categoryId: cats[0]!.id,
      }),
    ).rejects.toBeInstanceOf(AuthError);
  });

  it("previews then confirms an import, is idempotent, and does not blank unmapped fields", async () => {
    const { saveProduct } = await import("@/server/catalogue/service");
    const { uploadProductImport, previewImport, confirmImport } = await import("@/server/catalogue/import");
    const { getProductWorkspace } = await import("@/server/catalogue/products");
    const sku = `P3IMP-${Date.now()}`;
    const saved = await saveProduct(adminId, {
      sku,
      name: "Original name",
      brand: "Power Maxed",
      category: "Braking",
      trade: 10,
      rrp: 14,
      packQty: 1,
      caseQty: 4,
      description: "Must survive a price-only import",
    });

    const csv = `sku,trade,rrp\n${sku},22.5,30\n${sku}-NEW,12,15\n`;
    const uploaded = await uploadProductImport(adminId, { filename: "prices.csv", csv, mime: "text/csv" });
    const previewed = await previewImport(adminId, uploaded.id);
    expect(previewed.summary?.updateCount).toBeGreaterThanOrEqual(1);
    expect(previewed.issues.some((i) => i.message.includes("Product name is required"))).toBe(true);

    const csv2 = `sku,name,brand,category,trade,rrp\n${sku},Original name,Power Maxed,Braking,22.5,30\n`;
    const job2 = await uploadProductImport(adminId, { filename: "prices2.csv", csv: csv2, mime: "text/csv" });
    await previewImport(adminId, job2.id);
    const applied = await confirmImport(adminId, job2.id);
    expect(applied.updatedCount).toBeGreaterThanOrEqual(1);
    const again = await confirmImport(adminId, job2.id);
    expect(again.status).toBe("APPLIED");

    const loaded = await getProductWorkspace(adminId, saved.id);
    expect(loaded.tradePrice).toBe(22.5);
    expect(loaded.description).toBe("Must survive a price-only import");

    const { getPublicProduct } = await import("@/server/catalogue/products");
    await updateProductWorkspaceSafe(saved.id);
    const anon = await getPublicProduct(null, loaded.slug);
    expect(anon?.card.price.trade).toBeNull();
    expect(anon?.card.price.rrp).not.toBeNull();
  });

  it("excludes inactive products from the public catalogue", async () => {
    const { saveProduct } = await import("@/server/catalogue/service");
    const { listPublicProducts, updateProductWorkspace } = await import("@/server/catalogue/products");
    const sku = `HID-${Date.now()}`;
    const saved = await saveProduct(adminId, {
      sku,
      name: "Hidden line",
      brand: "Steel Seal",
      category: "Engine Chemicals",
      trade: 8,
      rrp: 11,
      packQty: 1,
      caseQty: 1,
      description: "inactive",
      active: false,
    });
    await updateProductWorkspace(adminId, { id: saved.id, status: "INACTIVE" });
    const pub = await listPublicProducts({ userId: null, q: sku });
    expect(pub.items.some((p) => p.sku === sku)).toBe(false);
  });

  it("attaches media without deleting the asset on detach", async () => {
    const { saveProduct } = await import("@/server/catalogue/service");
    const { attachProductMedia, detachProductMedia, getProductWorkspace } = await import(
      "@/server/catalogue/products"
    );
    const media = await prisma.cmsMedia.create({
      data: {
        filename: "p3.png",
        contentType: "image/png",
        storageKey: `test/${Date.now()}.png`,
        storageProvider: "local",
        sizeBytes: 10,
      },
    });
    const sku = `IMG-${Date.now()}`;
    const saved = await saveProduct(adminId, {
      sku,
      name: "Imaged product",
      brand: "Power Maxed",
      category: "Braking",
      trade: 1,
      rrp: 2,
      packQty: 1,
      caseQty: 1,
    });
    await attachProductMedia(adminId, { productId: saved.id, mediaId: media.id, isPrimary: true });
    const withImg = await getProductWorkspace(adminId, saved.id);
    expect(withImg.media[0]?.mediaId).toBe(media.id);
    const unchanged = await prisma.cmsMedia.findUnique({ where: { id: media.id } });
    expect(unchanged?.storageKey).toBe(media.storageKey);
    expect(unchanged?.sizeBytes).toBe(10);
    await detachProductMedia(adminId, { id: withImg.media[0]!.id, productId: saved.id });
    const still = await prisma.cmsMedia.findUnique({ where: { id: media.id } });
    expect(still).toBeTruthy();
    expect(still?.storageKey).toBe(media.storageKey);
  });

  it("stores PRODUCT_IMAGE processing on new uploads then associates without rewriting", async () => {
    const { uploadCmsMedia } = await import("@/server/cms/media");
    const { saveProduct } = await import("@/server/catalogue/service");
    const { attachProductMedia, getProductWorkspace } = await import("@/server/catalogue/products");
    const sharp = (await import("sharp")).default;
    const raw = await sharp({
      create: { width: 2000, height: 1000, channels: 3, background: { r: 30, g: 30, b: 30 } },
    })
      .jpeg()
      .toBuffer();
    const uploaded = await uploadCmsMedia(adminId, {
      filename: "assoc-product.jpg",
      contentType: "image/jpeg",
      base64: raw.toString("base64"),
      usage: "PRODUCT_IMAGE",
    });
    expect(uploaded.width).toBe(1000);
    expect(uploaded.height).toBe(500);
    const sku = `IMG2-${Date.now()}`;
    const saved = await saveProduct(adminId, {
      sku,
      name: "Processed image product",
      brand: "Power Maxed",
      category: "Braking",
      trade: 1,
      rrp: 2,
      packQty: 1,
      caseQty: 1,
    });
    await attachProductMedia(adminId, { productId: saved.id, mediaId: uploaded.id, isPrimary: true });
    const before = await prisma.cmsMedia.findUnique({ where: { id: uploaded.id } });
    await attachProductMedia(adminId, { productId: saved.id, mediaId: uploaded.id, isPrimary: true });
    const after = await prisma.cmsMedia.findUnique({ where: { id: uploaded.id } });
    expect(after?.storageKey).toBe(before?.storageKey);
    expect(after?.sizeBytes).toBe(before?.sizeBytes);
    expect(after?.width).toBe(1000);
    const ws = await getProductWorkspace(adminId, saved.id);
    expect(ws.media).toHaveLength(1);
    expect(ws.media[0]?.isPrimary).toBe(true);
  });
});

async function updateProductWorkspaceSafe(id: string) {
  const { updateProductWorkspace } = await import("@/server/catalogue/products");
  await updateProductWorkspace(adminId, { id, status: "ACTIVE", isTradeVisible: true });
}
