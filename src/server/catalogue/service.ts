import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "@/infra/database/client";
import { recordAuditEvent } from "@/server/audit/record";
import { AuthError, requireSystemPermission } from "@/server/rbac/guards";
import {
  brandCreateSchema,
  brandUpdateSchema,
  categoryCreateSchema,
  categoryDeleteSchema,
  categoryUpdateSchema,
  DEFAULT_BRANDS,
  DEFAULT_CATEGORY_TREE,
  normalizeVatCode,
  productDraftSchema,
  slugifyCatalogue,
} from "@/domain/catalogue";
import { cmsMediaPublicPath, type BrandLogoRef } from "@/lib/cms-media";

type Db = PrismaClient | Prisma.TransactionClient;

export type CategoryRecord = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  parentId: string | null;
  parentName: string | null;
  sortOrder: number;
  isActive: boolean;
  childCount: number;
  productCount: number;
  depth: number;
  imageMediaId: string | null;
  imageAlt: string | null;
  imageSrc: string | null;
};

export type BrandRecord = {
  id: string;
  slug: string;
  name: string;
  tagline: string | null;
  description: string | null;
  sortOrder: number;
  isActive: boolean;
  productCount: number;
  activeProductCount: number;
  logoMediaId: string | null;
  logoAlt: string | null;
  logoSrc: string | null;
};

async function uniqueSlug(db: Db, table: "category" | "brand", base: string, excludeId?: string) {
  const root = slugifyCatalogue(base);
  for (let i = 0; i < 50; i += 1) {
    const slug = i === 0 ? root : `${root.slice(0, 70)}-${i + 1}`;
    const existing =
      table === "category"
        ? await db.category.findUnique({ where: { slug }, select: { id: true } })
        : await db.brand.findUnique({ where: { slug }, select: { id: true } });
    if (!existing || existing.id === excludeId) return slug;
  }
  throw new AuthError("Could not allocate a unique slug", "VALIDATION", 400);
}

function mapCategory(
  row: {
    id: string;
    slug: string;
    name: string;
    description: string | null;
    parentId: string | null;
    sortOrder: number;
    isActive: boolean;
    imageMediaId: string | null;
    imageAlt: string | null;
    parent: { name: string } | null;
    _count: { children: number; products: number };
  },
  depth: number,
): CategoryRecord {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    parentId: row.parentId,
    parentName: row.parent?.name ?? null,
    sortOrder: row.sortOrder,
    isActive: row.isActive,
    childCount: row._count.children,
    productCount: row._count.products,
    depth,
    imageMediaId: row.imageMediaId,
    imageAlt: row.imageAlt,
    imageSrc: row.imageMediaId ? cmsMediaPublicPath(row.imageMediaId) : null,
  };
}

export async function bootstrapCatalogue(
  prismaClient: PrismaClient = prisma,
): Promise<{ created: boolean; categories: number; brands: number }> {
  const [categoryCount, brandCount] = await Promise.all([
    prismaClient.category.count(),
    prismaClient.brand.count(),
  ]);
  if (categoryCount > 0 && brandCount > 0) {
    return { created: false, categories: categoryCount, brands: brandCount };
  }

  await prismaClient.$transaction(async (tx) => {
    if ((await tx.brand.count()) === 0) {
      await tx.brand.createMany({
        data: DEFAULT_BRANDS.map((b) => ({
          slug: b.slug,
          name: b.name,
          tagline: b.tagline,
          description: b.description,
          sortOrder: b.sortOrder,
          isActive: true,
        })),
      });
    }

    if ((await tx.category.count()) === 0) {
      for (const [i, group] of DEFAULT_CATEGORY_TREE.entries()) {
        const parent = await tx.category.create({
          data: {
            slug: await uniqueSlug(tx, "category", group.name),
            name: group.name,
            description: group.description,
            sortOrder: i + 1,
            isActive: true,
          },
        });
        for (const [j, child] of group.children.entries()) {
          await tx.category.create({
            data: {
              slug: await uniqueSlug(tx, "category", child.name),
              name: child.name,
              description: child.description,
              parentId: parent.id,
              sortOrder: j + 1,
              isActive: true,
            },
          });
        }
      }
    }
  });

  const [categories, brands] = await Promise.all([
    prismaClient.category.count(),
    prismaClient.brand.count(),
  ]);
  return { created: true, categories, brands };
}

export async function listCategories(actorUserId: string): Promise<CategoryRecord[]> {
  await requireSystemPermission(actorUserId, "products.view");
  await bootstrapCatalogue();

  const rows = await prisma.category.findMany({
    include: {
      parent: { select: { name: true } },
      _count: { select: { children: true, products: true } },
    },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  });

  const byParent = new Map<string | null, typeof rows>();
  for (const row of rows) {
    const key = row.parentId;
    const list = byParent.get(key) ?? [];
    list.push(row);
    byParent.set(key, list);
  }

  const out: CategoryRecord[] = [];
  function walk(parentId: string | null, depth: number) {
    for (const row of byParent.get(parentId) ?? []) {
      out.push(mapCategory(row, depth));
      walk(row.id, depth + 1);
    }
  }
  walk(null, 0);
  return out;
}

export async function listBrands(actorUserId: string): Promise<BrandRecord[]> {
  await requireSystemPermission(actorUserId, "products.view");
  await bootstrapCatalogue();
  const rows = await prisma.brand.findMany({
    include: {
      _count: {
        select: {
          products: true,
        },
      },
    },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  });
  const activeCounts = await prisma.product.groupBy({
    by: ["brandId"],
    where: { status: "ACTIVE", isActive: true },
    _count: { _all: true },
  });
  const activeByBrand = new Map(activeCounts.map((row) => [row.brandId, row._count._all]));
  return rows.map((b) => ({
    id: b.id,
    slug: b.slug,
    name: b.name,
    tagline: b.tagline,
    description: b.description,
    sortOrder: b.sortOrder,
    isActive: b.isActive,
    productCount: b._count.products,
    activeProductCount: activeByBrand.get(b.id) ?? 0,
    logoMediaId: b.logoMediaId,
    logoAlt: b.logoAlt,
    logoSrc: b.logoMediaId ? cmsMediaPublicPath(b.logoMediaId) : null,
  }));
}

export async function listPublicBrandLogos(): Promise<Record<string, BrandLogoRef>> {
  const rows = await prisma.brand.findMany({
    where: { isActive: true, logoMediaId: { not: null } },
    select: { slug: true, logoMediaId: true, logoAlt: true },
  });
  const out: Record<string, BrandLogoRef> = {};
  for (const row of rows) {
    if (!row.logoMediaId) continue;
    out[row.slug] = {
      mediaId: row.logoMediaId,
      src: cmsMediaPublicPath(row.logoMediaId),
      alt: row.logoAlt ?? "",
    };
  }
  return out;
}

async function assertParentAllowed(parentId: string | null | undefined, selfId?: string) {
  if (!parentId) return null;
  if (selfId && parentId === selfId) {
    throw new AuthError("A category cannot be nested under itself", "VALIDATION", 400);
  }
  const parent = await prisma.category.findUnique({ where: { id: parentId } });
  if (!parent) throw new AuthError("Parent category not found", "NOT_FOUND", 404);
  if (selfId) {
    let cursor: string | null = parentId;
    const seen = new Set<string>([selfId]);
    while (cursor) {
      if (seen.has(cursor)) {
        throw new AuthError("That parent would create a circular category tree", "VALIDATION", 400);
      }
      seen.add(cursor);
      const row: { parentId: string | null } | null = await prisma.category.findUnique({
        where: { id: cursor },
        select: { parentId: true },
      });
      cursor = row?.parentId ?? null;
    }
  }
  return parent;
}

export async function createCategory(actorUserId: string, raw: unknown) {
  await requireSystemPermission(actorUserId, "products.edit");
  const input = categoryCreateSchema.parse(raw);
  const parentId = input.parentId ? input.parentId : null;
  await assertParentAllowed(parentId);
  const slug = await uniqueSlug(prisma, "category", input.slug || input.name);

  const created = await prisma.category.create({
    data: {
      name: input.name,
      slug,
      description: input.description ?? null,
      parentId,
      isActive: input.isActive,
      sortOrder: input.sortOrder,
      imageMediaId: input.imageMediaId ? input.imageMediaId : null,
      imageAlt: input.imageAlt ?? null,
    },
  });

  await recordAuditEvent({
    action: "catalogue.category_created",
    entityType: "Category",
    entityId: created.id,
    actorUserId,
    metadata: { slug: created.slug, parentId },
  });
  return created;
}

export async function updateCategory(actorUserId: string, raw: unknown) {
  await requireSystemPermission(actorUserId, "products.edit");
  const input = categoryUpdateSchema.parse(raw);
  const existing = await prisma.category.findUnique({ where: { id: input.id } });
  if (!existing) throw new AuthError("Category not found", "NOT_FOUND", 404);

  const parentId = input.parentId === "" || input.parentId === undefined ? null : input.parentId;
  await assertParentAllowed(parentId, input.id);
  const slug = await uniqueSlug(prisma, "category", input.slug || input.name, input.id);

  const updated = await prisma.category.update({
    where: { id: input.id },
    data: {
      name: input.name,
      slug,
      description: input.description ?? null,
      parentId,
      isActive: input.isActive,
      sortOrder: input.sortOrder,
      imageMediaId:
        input.imageMediaId === undefined
          ? existing.imageMediaId
          : input.imageMediaId
            ? input.imageMediaId
            : null,
      imageAlt: input.imageAlt === undefined ? existing.imageAlt : (input.imageAlt ?? null),
    },
  });

  await recordAuditEvent({
    action: "catalogue.category_updated",
    entityType: "Category",
    entityId: updated.id,
    actorUserId,
    metadata: { slug: updated.slug, parentId },
  });
  return updated;
}

export async function deleteCategory(actorUserId: string, raw: unknown) {
  await requireSystemPermission(actorUserId, "products.edit");
  const input = categoryDeleteSchema.parse(raw);
  const existing = await prisma.category.findUnique({
    where: { id: input.id },
    include: { _count: { select: { children: true, products: true } } },
  });
  if (!existing) throw new AuthError("Category not found", "NOT_FOUND", 404);

  const childCount = existing._count.children;
  const productCount = existing._count.products;

  await prisma.$transaction(async (tx) => {
    await tx.category.updateMany({
      where: { parentId: existing.id },
      data: { parentId: existing.parentId },
    });
    await tx.product.updateMany({
      where: { categoryId: existing.id },
      data: { categoryId: null },
    });
    await tx.category.delete({ where: { id: existing.id } });
  });

  await recordAuditEvent({
    action: "catalogue.category_deleted",
    entityType: "Category",
    entityId: existing.id,
    actorUserId,
    metadata: { slug: existing.slug, childCount, productCount },
  });
  return { ok: true as const, id: existing.id, slug: existing.slug, childCount, productCount };
}

export async function createBrand(actorUserId: string, raw: unknown) {
  await requireSystemPermission(actorUserId, "products.edit");
  const input = brandCreateSchema.parse(raw);
  const slug = await uniqueSlug(prisma, "brand", input.slug || input.name);
  const created = await prisma.brand.create({
    data: {
      name: input.name,
      slug,
      tagline: input.tagline ?? null,
      description: input.description ?? null,
      isActive: input.isActive,
      sortOrder: input.sortOrder,
      logoMediaId: input.logoMediaId ? input.logoMediaId : null,
      logoAlt: input.logoAlt ?? null,
    },
  });
  await recordAuditEvent({
    action: "catalogue.brand_created",
    entityType: "Brand",
    entityId: created.id,
    actorUserId,
    metadata: { slug: created.slug },
  });
  return created;
}

export async function updateBrand(actorUserId: string, raw: unknown) {
  await requireSystemPermission(actorUserId, "products.edit");
  const input = brandUpdateSchema.parse(raw);
  const existing = await prisma.brand.findUnique({ where: { id: input.id } });
  if (!existing) throw new AuthError("Brand not found", "NOT_FOUND", 404);
  const slug = await uniqueSlug(prisma, "brand", input.slug || input.name, input.id);
  const updated = await prisma.brand.update({
    where: { id: input.id },
    data: {
      name: input.name,
      slug,
      tagline: input.tagline ?? null,
      description: input.description ?? null,
      isActive: input.isActive,
      sortOrder: input.sortOrder,
      logoMediaId:
        input.logoMediaId === undefined ? existing.logoMediaId : input.logoMediaId ? input.logoMediaId : null,
      logoAlt: input.logoAlt === undefined ? existing.logoAlt : (input.logoAlt ?? null),
    },
  });
  await recordAuditEvent({
    action: "catalogue.brand_updated",
    entityType: "Brand",
    entityId: updated.id,
    actorUserId,
    metadata: { slug: updated.slug },
  });
  return updated;
}

export type ProductRecord = {
  id: string;
  variantId: string;
  sku: string;
  name: string;
  brand: string;
  brandId: string;
  category: string;
  subcategory: string;
  categoryId: string | null;
  trade: number;
  rrp: number;
  packQty: number;
  caseQty: number;
  description: string;
  vat: "standard" | "zero";
  isActive: boolean;
};

function money(value: unknown): number {
  if (typeof value === "number") return value;
  if (value && typeof value === "object" && "toNumber" in value && typeof value.toNumber === "function") {
    return (value as { toNumber: () => number }).toNumber();
  }
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

async function uniqueProductSlug(db: Db, base: string, excludeId?: string) {
  const root = slugifyCatalogue(base);
  for (let i = 0; i < 50; i += 1) {
    const slug = i === 0 ? root : `${root.slice(0, 70)}-${i + 1}`;
    const existing = await db.product.findUnique({ where: { slug }, select: { id: true } });
    if (!existing || existing.id === excludeId) return slug;
  }
  throw new AuthError("Could not allocate a unique product slug", "VALIDATION", 400);
}

async function findBrandRow(db: Db, nameOrSlug: string) {
  const needle = nameOrSlug.trim();
  return db.brand.findFirst({
    where: { OR: [{ slug: slugifyCatalogue(needle) }, { name: { equals: needle, mode: "insensitive" } }] },
  });
}

async function ensureBrand(db: Db, name: string) {
  const existing = await findBrandRow(db, name);
  if (existing) return existing;
  return db.brand.create({
    data: {
      name: name.trim(),
      slug: await uniqueSlug(db, "brand", name),
      isActive: true,
      sortOrder: 99,
    },
  });
}

async function ensureNamedCategory(db: Db, name: string, parentId: string | null) {
  const existing = await db.category.findFirst({
    where: { name: { equals: name.trim(), mode: "insensitive" }, parentId },
  });
  if (existing) return existing;
  return db.category.create({
    data: {
      name: name.trim(),
      slug: await uniqueSlug(db, "category", name),
      parentId,
      isActive: true,
      sortOrder: 99,
    },
  });
}

async function resolveProductCategoryId(
  db: Db,
  categoryName: string,
  subcategoryName: string | null | undefined,
) {
  const parent = await ensureNamedCategory(db, categoryName || "Uncategorised", null);
  const childName = subcategoryName?.trim();
  if (!childName) return parent.id;
  const child = await ensureNamedCategory(db, childName, parent.id);
  return child.id;
}

function mapProductRow(row: {
  id: string;
  name: string;
  description: string | null;
  isActive: boolean;
  brandId: string;
  categoryId: string | null;
  brand: { name: string };
  category: { name: string; parent: { name: string } | null } | null;
  variants: Array<{
    id: string;
    sku: string;
    packQty: number;
    caseQty: number | null;
    rrp: unknown;
    vatCode: string;
    quantityBreaks: Array<{ minQty: number; unitPrice: unknown }>;
  }>;
}): ProductRecord | null {
  const variant = row.variants[0];
  if (!variant) return null;
  const tradeBreak = variant.quantityBreaks.find((b) => b.minQty === 1) ?? variant.quantityBreaks[0];
  const parentName = row.category?.parent?.name ?? null;
  return {
    id: row.id,
    variantId: variant.id,
    sku: variant.sku,
    name: row.name,
    brand: row.brand.name,
    brandId: row.brandId,
    category: parentName ?? row.category?.name ?? "Uncategorised",
    subcategory: parentName ? (row.category?.name ?? "") : "",
    categoryId: row.categoryId,
    trade: money(tradeBreak?.unitPrice ?? 0),
    rrp: money(variant.rrp),
    packQty: variant.packQty,
    caseQty: variant.caseQty ?? 1,
    description: row.description ?? "",
    vat: variant.vatCode === "ZERO_RATED" ? "zero" : "standard",
    isActive: row.isActive,
  };
}

const productInclude = {
  brand: { select: { name: true } },
  category: { select: { name: true, parent: { select: { name: true } } } },
  variants: {
    orderBy: { createdAt: "asc" as const },
    take: 1,
    include: { quantityBreaks: true },
  },
} satisfies Prisma.ProductInclude;

export async function listProducts(actorUserId: string, q?: string): Promise<ProductRecord[]> {
  await requireSystemPermission(actorUserId, "products.view");
  await bootstrapCatalogue();
  const rows = await prisma.product.findMany({
    where: q
      ? {
          OR: [
            { name: { contains: q, mode: "insensitive" } },
            { variants: { some: { sku: { contains: q, mode: "insensitive" } } } },
            { brand: { name: { contains: q, mode: "insensitive" } } },
          ],
        }
      : {},
    include: {
      brand: { select: { name: true } },
      category: { select: { name: true, parent: { select: { name: true } } } },
      variants: {
        orderBy: { createdAt: "asc" },
        take: 1,
        include: { quantityBreaks: true },
      },
    },
    orderBy: [{ name: "asc" }],
    take: 2000,
  });
  return rows.map(mapProductRow).filter((p): p is ProductRecord => Boolean(p));
}

export async function saveProduct(actorUserId: string, raw: unknown): Promise<ProductRecord> {
  await requireSystemPermission(actorUserId, "products.edit");
  await bootstrapCatalogue();
  const input = productDraftSchema.parse(raw);
  const sku = input.sku.trim().toUpperCase();

  const saved = await prisma.$transaction(async (tx) => {
    const brand = await ensureBrand(tx, input.brand);
    const categoryId = await resolveProductCategoryId(tx, input.category, input.subcategory);
    const vatCode = normalizeVatCode(input.vat);
    const skuOwner = await tx.productVariant.findUnique({
      where: { sku },
      include: { product: true },
    });
    if (skuOwner && skuOwner.productId !== (input.id ?? "")) {
      throw new AuthError(`SKU ${sku} is already used`, "VALIDATION", 400);
    }

    const productId = input.id;
    const existingVariant = productId
      ? await tx.productVariant.findFirst({
          where: { productId },
          orderBy: { createdAt: "asc" },
        })
      : null;
    const isUpdate = Boolean(productId);
    let product;
    if (productId) {
      product = await tx.product.update({
        where: { id: productId },
        data: {
          name: input.name,
          slug: await uniqueProductSlug(tx, `${input.brand} ${input.name} ${sku}`, productId),
          brandId: brand.id,
          categoryId,
          description: input.description || null,
          isActive: input.active,
          status: input.active ? "ACTIVE" : "INACTIVE",
        },
      });
    } else {
      product = await tx.product.create({
        data: {
          name: input.name,
          slug: await uniqueProductSlug(tx, `${input.brand} ${input.name} ${sku}`),
          brandId: brand.id,
          categoryId,
          description: input.description || null,
          isActive: input.active,
          status: input.active ? "ACTIVE" : "INACTIVE",
        },
      });
    }

    const variantData = {
      sku,
      packQty: input.packQty,
      caseQty: input.caseQty,
      rrp: input.rrp,
      tradePrice: input.trade,
      vatCode,
      isActive: input.active,
      isDefault: true,
    };

    const variant = existingVariant
      ? await tx.productVariant.update({
          where: { id: existingVariant.id },
          data: variantData,
        })
      : await tx.productVariant.create({
          data: { ...variantData, productId: product.id },
        });

    await tx.quantityBreak.upsert({
      where: { variantId_minQty: { variantId: variant.id, minQty: 1 } },
      create: { variantId: variant.id, minQty: 1, unitPrice: input.trade },
      update: { unitPrice: input.trade },
    });

    return { isUpdate, product: await tx.product.findUniqueOrThrow({
      where: { id: product.id },
      include: productInclude,
    }) };
  });

  const mapped = mapProductRow(saved.product);
  if (!mapped) throw new AuthError("Product saved without a SKU", "INTERNAL", 500);

  await recordAuditEvent({
    action: saved.isUpdate ? "catalogue.product_updated" : "catalogue.product_created",
    entityType: "Product",
    entityId: mapped.id,
    actorUserId,
    metadata: { sku: mapped.sku },
  });
  return mapped;
}

export async function deleteProduct(actorUserId: string, sku: string) {
  await requireSystemPermission(actorUserId, "products.edit");
  const variant = await prisma.productVariant.findUnique({
    where: { sku: sku.trim().toUpperCase() },
    select: { id: true, productId: true, sku: true },
  });
  if (!variant) throw new AuthError("Product not found", "NOT_FOUND", 404);
  await prisma.product.delete({ where: { id: variant.productId } });
  await recordAuditEvent({
    action: "catalogue.product_deleted",
    entityType: "Product",
    entityId: variant.productId,
    actorUserId,
    metadata: { sku: variant.sku },
  });
  return { ok: true as const, sku: variant.sku };
}

export async function importProducts(actorUserId: string, csv: string) {
  const { importProducts: run } = await import("@/server/catalogue/import");
  const result = await run(actorUserId, csv);
  return {
    created: result.createdCount,
    updated: result.updatedCount,
    errors: (result.issues ?? []).slice(0, 50).map((issue) => ({
      line: issue.line,
      message: issue.message,
    })),
  };
}

export async function exportProductsCsv(actorUserId: string) {
  const { exportCatalogueCsv } = await import("@/server/catalogue/products");
  return exportCatalogueCsv(actorUserId, { page: 1, pageSize: 5000 });
}
