/**
 * Catalogue taxonomy bootstrap — Prisma + domain only.
 * Isolated from catalogue/service.ts so production Docker bootstrap bundling
 * does not follow dynamic imports into products → stock → TanStack Start.
 */
import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "@/infra/database/client";
import {
  DEFAULT_BRANDS,
  DEFAULT_CATEGORY_TREE,
  isLaunchPublicBrandSlug,
  LAUNCH_PUBLIC_BRAND_SLUGS,
  shouldSeedDefaultCatalogue,
  slugifyCatalogue,
} from "@/domain/catalogue";

type Db = PrismaClient | Prisma.TransactionClient;

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
  throw new Error("Could not allocate a unique slug during catalogue bootstrap");
}

/**
 * Idempotent public launch visibility: only Power Maxed + Steel Seal are
 * trade-visible on the public site. Other brands stay in the catalogue with
 * isActive=false so they can be enabled later without re-importing.
 *
 * Also keeps launch-brand tagline/description aligned with DEFAULT_BRANDS so
 * public brand pages do not keep prototype aftermarket copy.
 */
export async function ensureLaunchPublicBrands(
  prismaClient: PrismaClient = prisma,
): Promise<{ activated: string[]; deactivated: string[] }> {
  const defs = new Map(DEFAULT_BRANDS.map((b) => [b.slug, b]));
  const rows = await prismaClient.brand.findMany({
    select: { id: true, slug: true, isActive: true, tagline: true, description: true, sortOrder: true },
  });
  const activated: string[] = [];
  const deactivated: string[] = [];

  for (const row of rows) {
    const shouldBePublic = isLaunchPublicBrandSlug(row.slug);
    const def = defs.get(row.slug);
    const data: { isActive?: boolean; tagline?: string; description?: string; sortOrder?: number } = {};

    if (row.isActive !== shouldBePublic) {
      data.isActive = shouldBePublic;
      if (shouldBePublic) activated.push(row.slug);
      else deactivated.push(row.slug);
    }

    if (shouldBePublic && def) {
      if (row.tagline !== def.tagline) data.tagline = def.tagline;
      if (row.description !== def.description) data.description = def.description;
      if (row.sortOrder !== def.sortOrder) data.sortOrder = def.sortOrder;
    }

    if (Object.keys(data).length === 0) continue;
    await prismaClient.brand.update({ where: { id: row.id }, data });
  }

  void LAUNCH_PUBLIC_BRAND_SLUGS;
  return { activated, deactivated };
}

export async function bootstrapCatalogue(
  prismaClient: PrismaClient = prisma,
): Promise<{ created: boolean; categories: number; brands: number }> {
  const [categoryCount, brandCount] = await Promise.all([
    prismaClient.category.count(),
    prismaClient.brand.count(),
  ]);

  let created = false;
  if (shouldSeedDefaultCatalogue(categoryCount, brandCount)) {
    await prismaClient.$transaction(async (tx) => {
      if ((await tx.brand.count()) === 0) {
        await tx.brand.createMany({
          data: DEFAULT_BRANDS.map((b) => ({
            slug: b.slug,
            name: b.name,
            tagline: b.tagline,
            description: b.description,
            sortOrder: b.sortOrder,
            isActive: b.isActive,
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
    created = true;
  }

  await ensureLaunchPublicBrands(prismaClient);

  const [categories, brands] = await Promise.all([
    prismaClient.category.count(),
    prismaClient.brand.count(),
  ]);
  return { created, categories, brands };
}
