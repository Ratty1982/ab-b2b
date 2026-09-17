import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "@/infra/database/client";
import { recordAuditEvent } from "@/server/audit/record";
import { AuthError, requireSystemPermission } from "@/server/rbac/guards";
import {
  brandCreateSchema,
  brandUpdateSchema,
  categoryCreateSchema,
  categoryUpdateSchema,
  DEFAULT_BRANDS,
  DEFAULT_CATEGORY_TREE,
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
    include: { _count: { select: { products: true } } },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  });
  return rows.map((b) => ({
    id: b.id,
    slug: b.slug,
    name: b.name,
    tagline: b.tagline,
    description: b.description,
    sortOrder: b.sortOrder,
    isActive: b.isActive,
    productCount: b._count.products,
    logoMediaId: b.logoMediaId,
    logoAlt: b.logoAlt,
    logoSrc: b.logoMediaId ? cmsMediaPublicPath(b.logoMediaId) : null,
  }));
}

export async function listPublicBrandLogos(): Promise<Record<string, BrandLogoRef>> {
  await bootstrapCatalogue();
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
  if (parent.parentId) {
    throw new AuthError("Subcategories can only sit under a top-level category", "VALIDATION", 400);
  }
  if (selfId) {
    const childCount = await prisma.category.count({ where: { parentId: selfId } });
    if (childCount > 0) {
      throw new AuthError("Move or remove subcategories before nesting this category", "VALIDATION", 400);
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
