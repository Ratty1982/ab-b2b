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
  }, 20_000);

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

    const csvExcel = `sep=;\nsku;trade\n${sku.toLowerCase()};24,75\n`;
    const job3 = await uploadProductImport(adminId, { filename: "excel.csv", csv: csvExcel, mime: "text/csv" });
    const preview3 = await previewImport(adminId, job3.id);
    expect(preview3.summary?.updateCount).toBeGreaterThanOrEqual(1);
    const appliedExcel = await confirmImport(adminId, job3.id);
    expect(appliedExcel.updatedCount).toBeGreaterThanOrEqual(1);
    const afterExcel = await getProductWorkspace(adminId, saved.id);
    expect(afterExcel.tradePrice).toBe(24.75);
    expect(afterExcel.description).toBe("Must survive a price-only import");

    const { getPublicProduct } = await import("@/server/catalogue/products");
    await updateProductWorkspaceSafe(saved.id);
    const anon = await getPublicProduct(null, loaded.slug);
    expect(anon?.card.price.trade).toBeNull();
    expect(anon?.card.price.rrp).not.toBeNull();
    expect(anon?.nav.brands.length).toBeGreaterThan(0);
    expect(anon?.nav.categories.length).toBeGreaterThan(0);
    expect(anon?.nav.brands.some((b) => typeof b.slug === "string" && b.name.length > 0)).toBe(true);
    expect(anon?.nav.categories.some((c) => typeof c.slug === "string" && Array.isArray(c.children))).toBe(true);
    expect(anon?.unit).toBeTruthy();
  });

  it("downloads an Excel template with category dropdowns and accepts that workbook as an import", async () => {
    const { downloadProductImportTemplate, uploadProductImport, previewImport } = await import(
      "@/server/catalogue/import"
    );
    const template = await downloadProductImportTemplate(adminId);
    expect(template.filename.endsWith(".xlsx")).toBe(true);
    const uploaded = await uploadProductImport(adminId, {
      filename: template.filename,
      workbookBase64: template.base64,
      mime: template.mime,
    });
    expect(uploaded.rowCount).toBeGreaterThanOrEqual(1);
    const previewed = await previewImport(adminId, uploaded.id);
    expect(previewed.headers).toContain("category");
    expect(previewed.headers).toContain("subcategory");
  });

  it("exports the catalogue as an Excel workbook with category dropdowns", async () => {
    const { exportCatalogueWorkbook } = await import("@/server/catalogue/products");
    const { workbookToCsv } = await import("@/domain/product-import-workbook");
    const file = await exportCatalogueWorkbook(adminId, { page: 1, pageSize: 5000 });
    expect(file.filename.endsWith(".xlsx")).toBe(true);
    const csv = await workbookToCsv(new Uint8Array(Buffer.from(file.base64, "base64")));
    expect(csv.toLowerCase()).toContain("sku");
    expect(csv.toLowerCase()).toContain("category");
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

describe("public catalogue navigation and cards", () => {
  it("lists every active category from the database, nested, excluding inactive", async () => {
    const { listPublicProducts } = await import("@/server/catalogue/products");
    const stamp = Date.now();
    const parent = await createCategory(adminId, {
      name: `Pub parent ${stamp}`,
      isActive: true,
      sortOrder: 500,
    });
    const child = await createCategory(adminId, {
      name: `Pub child ${stamp}`,
      parentId: parent.id,
      isActive: true,
      sortOrder: 1,
    });
    const inactive = await createCategory(adminId, {
      name: `Pub inactive ${stamp}`,
      isActive: false,
      sortOrder: 501,
    });

    const { flattenCategorySlugs } = await import("@/domain/public-catalogue-nav");
    const pub = await listPublicProducts({ userId: null });
    const slugs = flattenCategorySlugs(pub.categories);
    expect(slugs).toContain(parent.slug);
    expect(slugs).toContain(child.slug);
    expect(slugs).not.toContain(inactive.slug);

    const dbActive = await prisma.category.findMany({
      where: { isActive: true },
      select: { slug: true, parentId: true },
    });
    for (const row of dbActive) {
      expect(slugs).toContain(row.slug);
    }

    const parentNode = pub.categories.find((n) => n.slug === parent.slug);
    expect(parentNode?.children.some((c) => c.slug === child.slug)).toBe(true);

    const empty = await listPublicProducts({ userId: null, categorySlug: parent.slug });
    expect(empty.category?.slug).toBe(parent.slug);
    expect(empty.items).toHaveLength(0);
    expect(empty.categories.length).toBe(pub.categories.length);
  });

  it("keeps brand navigation database-driven and hides anonymous trade plus stock qty", async () => {
    const { saveProduct } = await import("@/server/catalogue/service");
    const { listPublicProducts } = await import("@/server/catalogue/products");
    const sku = `PUBNAV-${Date.now()}`;
    const trade = 77.77;
    const rrp = 88.88;
    const saved = await saveProduct(adminId, {
      sku,
      name: "Public nav fixture",
      brand: "Power Maxed",
      category: "Braking",
      trade,
      rrp,
      packQty: 1,
      caseQty: 1,
    });
    await updateProductWorkspaceSafe(saved.id);

    const variant = await prisma.productVariant.findFirstOrThrow({ where: { productId: saved.id } });
    const warehouse = await prisma.warehouse.upsert({
      where: { code: "PUB-TEST" },
      create: { code: "PUB-TEST", name: "Public test warehouse" },
      update: {},
    });
    await prisma.inventory.upsert({
      where: { variantId_warehouseId: { variantId: variant.id, warehouseId: warehouse.id } },
      create: { variantId: variant.id, warehouseId: warehouse.id, qtyOnHand: 42 },
      update: { qtyOnHand: 42 },
    });

    const anon = await listPublicProducts({ userId: null, q: sku });
    expect(anon.brands.some((b) => b.slug === "power-maxed")).toBe(true);
    const dbBrands = await prisma.brand.findMany({
      where: { isActive: true, products: { some: { status: "ACTIVE", isActive: true, isTradeVisible: true } } },
      select: { slug: true },
    });
    expect(anon.brands.map((b) => b.slug).sort()).toEqual(dbBrands.map((b) => b.slug).sort());

    expect(anon.items).toHaveLength(1);
    const card = anon.items[0]!;
    expect(card.price.trade).toBeNull();
    expect(card.price.rrp).toBe(rrp);
    expect(JSON.stringify(card)).not.toContain(String(trade));
    expect(card).not.toHaveProperty("stockQty");
    expect(card).not.toHaveProperty("qtyOnHand");
    expect(card.availability).toBe("in");
    expect(["In Stock", "Low Stock", "Out of Stock"]).toContain(
      card.availability === "in" ? "In Stock" : card.availability === "low" ? "Low Stock" : "Out of Stock",
    );
    expect(card.imageSrc).toBeNull();

    const signedIn = await listPublicProducts({ userId: adminId, q: sku });
    expect(signedIn.items[0]?.price.trade).toBe(trade);
    expect(signedIn.items[0]?.price.rrp).toBe(rrp);
    expect(signedIn.items[0]).not.toHaveProperty("qtyOnHand");

    const gridAndListShare = {
      sku: card.sku,
      name: card.name,
      brand: card.brand,
      imageSrc: card.imageSrc,
      price: card.price,
      availability: card.availability,
    };
    expect(gridAndListShare.sku).toBe(sku);
    expect(gridAndListShare.availability).toBe("in");
  });

  it("includes grandchild products when filtering by a parent category", async () => {
    const { saveProduct } = await import("@/server/catalogue/service");
    const { listPublicProducts } = await import("@/server/catalogue/products");
    const stamp = Date.now();
    const parent = await createCategory(adminId, {
      name: `Deep parent ${stamp}`,
      isActive: true,
      sortOrder: 600,
    });
    const child = await createCategory(adminId, {
      name: `Deep child ${stamp}`,
      parentId: parent.id,
      isActive: true,
      sortOrder: 1,
    });
    const grand = await createCategory(adminId, {
      name: `Deep grand ${stamp}`,
      parentId: child.id,
      isActive: true,
      sortOrder: 1,
    });
    const sku = `DEEP-${stamp}`;
    const saved = await saveProduct(adminId, {
      sku,
      name: "Deep nested product",
      brand: "Steel Seal",
      category: "Braking",
      trade: 5,
      rrp: 9,
      packQty: 1,
      caseQty: 1,
    });
    await prisma.product.update({ where: { id: saved.id }, data: { categoryId: grand.id } });
    await updateProductWorkspaceSafe(saved.id);
    const pub = await listPublicProducts({ userId: null, categorySlug: parent.slug, q: sku });
    expect(pub.category?.slug).toBe(parent.slug);
    expect(pub.items.some((p) => p.sku === sku)).toBe(true);
  });
});

describe("per-product content JSON importer", () => {
  it("applies a merge, preserves omitted/null fields, sanitises HTML, and writes an audit event", async () => {
    const { saveProduct } = await import("@/server/catalogue/service");
    const { getProductWorkspace } = await import("@/server/catalogue/products");
    const { applyProductJsonImport, previewProductJsonImport } = await import(
      "@/server/catalogue/product-content-json"
    );
    const sku = `JSON-${Date.now()}`;
    const saved = await saveProduct(adminId, {
      sku,
      name: "Glass Cleaner 1ltr",
      brand: "Power Maxed",
      category: "Braking",
      trade: 4.6,
      rrp: 10.99,
      packQty: 1,
      caseQty: 6,
      description: "Keep me if omitted",
    });
    await updateProductWorkspaceSafe(saved.id);
    await prisma.product.update({
      where: { id: saved.id },
      data: {
        specifications: {
          rows: [],
          selling: { keyBenefits: ["Existing benefit"], features: [], applications: [], directions: null, warnings: null },
          provenance: { manufacturerUrl: null, supplierUrl: null, notes: "keep me" },
          seoKeywords: [],
        },
      },
    });
    const before = await getProductWorkspace(adminId, saved.id);
    const inventoryBefore = await prisma.inventory.findMany({ where: { variantId: before.defaultVariantId ?? "__none__" } });
    const breaksBefore = await prisma.quantityBreak.findMany({ where: { variantId: before.defaultVariantId ?? "__none__" } });
    const customerPricesBefore = await prisma.customerPrice.count({ where: { variantId: before.defaultVariantId ?? "__none__" } });

    const preview = await previewProductJsonImport(adminId, {
      productId: saved.id,
      jsonText: JSON.stringify({
        schemaVersion: "1.0",
        identity: { sku, name: "Power Maxed Glass Cleaner 1 Litre", brand: "power maxed" },
        content: {
          shortDescription: "Ready-to-use glass cleaner.",
          description: `<p>Updated</p><script>alert(1)</script>`,
          keyBenefits: ["Streak-free"],
          features: [],
        },
        commercial: { rrp: 11.49 },
        source: { notes: null },
      }),
    });
    expect(preview.canApply).toBe(true);
    expect(preview.skuMatched).toBe(true);

    const applied = await applyProductJsonImport(adminId, {
      productId: saved.id,
      jsonText: JSON.stringify({
        schemaVersion: "1.0",
        identity: { sku, name: "Power Maxed Glass Cleaner 1 Litre", brand: "power maxed" },
        content: {
          shortDescription: "Ready-to-use glass cleaner.",
          description: `<p>Updated</p><script>alert(1)</script>`,
          keyBenefits: ["Streak-free"],
          features: [],
        },
        commercial: { rrp: 11.49 },
        source: { notes: null },
      }),
    });
    expect(applied.errorCount).toBe(0);

    const after = await getProductWorkspace(adminId, saved.id);
    expect(after.name).toBe("Power Maxed Glass Cleaner 1 Litre");
    expect(after.shortDescription).toBe("Ready-to-use glass cleaner.");
    expect(after.description).toContain("<p>Updated</p>");
    expect(after.description).not.toMatch(/script/i);
    expect(after.selling.keyBenefits).toEqual(["Streak-free"]);
    expect(after.rrp).toBe(11.49);
    expect(after.tradePrice).toBe(4.6);
    expect(after.packQty).toBe(1);
    expect(after.caseQty).toBe(6);
    expect(after.provenance.notes).toBe("keep me");

    const inventoryAfter = await prisma.inventory.findMany({ where: { variantId: after.defaultVariantId ?? "__none__" } });
    expect(inventoryAfter).toEqual(inventoryBefore);
    const breaksAfter = await prisma.quantityBreak.findMany({ where: { variantId: after.defaultVariantId ?? "__none__" } });
    expect(breaksAfter.map((row) => row.id).sort()).toEqual(breaksBefore.map((row) => row.id).sort());
    const customerPricesAfter = await prisma.customerPrice.count({ where: { variantId: after.defaultVariantId ?? "__none__" } });
    expect(customerPricesAfter).toBe(customerPricesBefore);

    const mediaCount = await prisma.productMedia.count({ where: { productId: saved.id } });
    expect(mediaCount).toBe(before.media.length);

    expect(after.activity.some((event) => event.action === "catalogue.product_json_import")).toBe(true);
  });

  it("blocks SKU mismatch, unknown brand, unknown category, and unauthorised users", async () => {
    const { saveProduct } = await import("@/server/catalogue/service");
    const { applyProductJsonImport, previewProductJsonImport } = await import(
      "@/server/catalogue/product-content-json"
    );
    const sku = `JSONB-${Date.now()}`;
    const saved = await saveProduct(adminId, {
      sku,
      name: "JSON block fixture",
      brand: "Steel Seal",
      category: "Braking",
      trade: 1,
      rrp: 2,
      packQty: 1,
      caseQty: 1,
    });
    await updateProductWorkspaceSafe(saved.id);

    const mismatch = await previewProductJsonImport(adminId, {
      productId: saved.id,
      jsonText: JSON.stringify({ schemaVersion: "1.0", identity: { sku: "OTHER-SKU", name: "Nope" } }),
    });
    expect(mismatch.canApply).toBe(false);
    expect(mismatch.issues.some((i) => i.code === "SKU_MISMATCH")).toBe(true);

    const brand = await previewProductJsonImport(adminId, {
      productId: saved.id,
      jsonText: JSON.stringify({ schemaVersion: "1.0", identity: { sku, brand: "Not A Real Brand" } }),
    });
    expect(brand.issues.some((i) => i.code === "UNKNOWN_BRAND")).toBe(true);

    const category = await previewProductJsonImport(adminId, {
      productId: saved.id,
      jsonText: JSON.stringify({ schemaVersion: "1.0", identity: { sku, category: "No Such Category" } }),
    });
    expect(category.issues.some((i) => i.code === "UNKNOWN_CATEGORY")).toBe(true);

    await expect(
      applyProductJsonImport(salesRepUserId, {
        productId: saved.id,
        jsonText: JSON.stringify({ schemaVersion: "1.0", identity: { sku, name: "Hijack" } }),
      }),
    ).rejects.toBeInstanceOf((await import("@/server/rbac/guards")).AuthError);
  });

  it("lets a later manual save edit imported selling copy and shows it on the public page", async () => {
    const { saveProduct } = await import("@/server/catalogue/service");
    const { getProductWorkspace, updateProductWorkspace, getPublicProduct } = await import(
      "@/server/catalogue/products"
    );
    const { applyProductJsonImport } = await import("@/server/catalogue/product-content-json");
    const sku = `JSONE-${Date.now()}`;
    const saved = await saveProduct(adminId, {
      sku,
      name: "Editable after import",
      brand: "Power Maxed",
      category: "Braking",
      trade: 8.7,
      rrp: 17.99,
      packQty: 1,
      caseQty: 2,
    });
    await updateProductWorkspaceSafe(saved.id);
    const workspace = await getProductWorkspace(adminId, saved.id);
    await applyProductJsonImport(adminId, {
      productId: saved.id,
      jsonText: JSON.stringify({
        schemaVersion: "1.0",
        identity: { sku, name: "Editable after import" },
        content: {
          shortDescription: "Imported short",
          description: "<p>Imported description</p>",
          keyBenefits: ["Suitable for tinted windows", "Streak-free"],
          features: ["Professional-grade"],
          applications: ["Mirrors"],
          directions: "Apply and wipe",
          warnings: "Original warning",
        },
        specifications: { additional: { finish: "Streak-Free" } },
        commercial: { rrp: 17.99, packQty: 1, caseQty: 2 },
        seo: { metaTitle: "Imported title", slug: workspace.slug },
      }),
    });
    const imported = await getProductWorkspace(adminId, saved.id);
    expect(imported.selling.keyBenefits).toEqual(["Suitable for tinted windows", "Streak-free"]);
    expect(imported.tradePrice).toBe(8.7);
    expect(imported.metaTitle).toBe("Imported title");

    await expect(
      updateProductWorkspace(salesRepUserId, {
        id: saved.id,
        selling: { keyBenefits: ["Hijack"] },
      }),
    ).rejects.toBeInstanceOf(AuthError);

    const updated = await updateProductWorkspace(adminId, {
      id: saved.id,
      shortDescription: "Manual short",
      description: "<p>Manual description</p>",
      selling: {
        keyBenefits: ["Safe for tinted vehicle windows", "Streak-free", "Added benefit"],
        features: ["Professional-grade", "Added feature"],
        applications: ["Interior glass", "Mirrors"],
        directions: "Spray, then wipe",
        warnings: "",
      },
      specifications: [
        { name: "Finish", value: "Streak-Free" },
        { name: "Residue Free", value: "Yes" },
      ],
      tradePrice: 8.7,
      rrp: 17.99,
      metaTitle: "Manual SEO title",
      metaDescription: "Manual SEO description",
    });
    expect(updated.shortDescription).toBe("Manual short");
    expect(updated.selling.keyBenefits).toEqual([
      "Safe for tinted vehicle windows",
      "Streak-free",
      "Added benefit",
    ]);
    expect(updated.selling.features).toContain("Added feature");
    expect(updated.selling.applications[0]).toBe("Interior glass");
    expect(updated.selling.directions).toBe("Spray, then wipe");
    expect(updated.selling.warnings).toBeNull();
    expect(updated.specifications.some((row) => row.name === "Residue Free" && row.value === "Yes")).toBe(true);
    expect(updated.metaTitle).toBe("Manual SEO title");
    expect(updated.rrp).toBe(17.99);

    const removed = await updateProductWorkspace(adminId, {
      id: saved.id,
      selling: {
        keyBenefits: ["Streak-free"],
        features: ["Professional-grade"],
        applications: ["Mirrors"],
        directions: "Spray, then wipe",
        warnings: null,
      },
      specifications: [{ name: "Finish", value: "Crystal" }],
    });
    expect(removed.selling.keyBenefits).toEqual(["Streak-free"]);
    expect(removed.specifications).toEqual([{ name: "Finish", value: "Crystal" }]);

    const reordered = await updateProductWorkspace(adminId, {
      id: saved.id,
      selling: {
        keyBenefits: ["B", "A"],
        features: ["F2", "F1"],
        applications: ["App2", "App1"],
        directions: "Spray, then wipe",
        warnings: null,
      },
    });
    expect(reordered.selling.keyBenefits).toEqual(["B", "A"]);
    expect(reordered.selling.features).toEqual(["F2", "F1"]);
    expect(reordered.selling.applications).toEqual(["App2", "App1"]);

    const pub = await getPublicProduct(null, reordered.slug);
    expect(pub?.shortDescription).toBe("Manual short");
    expect(pub?.selling.keyBenefits).toEqual(["B", "A"]);
    expect(pub?.selling.features).toEqual(["F2", "F1"]);
    expect(pub?.card.price.trade).toBeNull();
  });
});

async function updateProductWorkspaceSafe(id: string) {
  const { updateProductWorkspace } = await import("@/server/catalogue/products");
  await updateProductWorkspace(adminId, { id, status: "ACTIVE", isTradeVisible: true });
}
