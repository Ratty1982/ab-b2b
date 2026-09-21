import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "@/infra/database/client";
import { recordAuditEvent } from "@/server/audit/record";
import { AuthError, requireAnySystemPermission, requireSystemPermission } from "@/server/rbac/guards";
import {
  productCreateSchema,
  productMediaReorderSchema,
  productMediaWriteSchema,
  productVariantWriteSchema,
  productWorkspaceSchema,
  slugifyCatalogue,
  type ProductStatus,
} from "@/domain/catalogue";
import { parseSpecificationsDocument, serializeSpecificationsDocument } from "@/domain/product-specifications";
import { publicAvailabilityFromQty, type PublicAvailability } from "@/domain/availability";
import { cmsMediaPublicPath } from "@/lib/cms-media";
import {
  moneyNumber,
  resolveDisplayPrice,
  viewerFromAccess,
  type DisplayPrice,
  type PriceViewer,
} from "@/server/pricing/trade-price";
import { loadAccessProfile } from "@/server/rbac/access";

type Db = PrismaClient | Prisma.TransactionClient;

async function uniqueProductSlug(db: Db, base: string, excludeId?: string) {
  const root = slugifyCatalogue(base);
  for (let i = 0; i < 50; i += 1) {
    const slug = i === 0 ? root : `${root.slice(0, 70)}-${i + 1}`;
    const existing = await db.product.findUnique({ where: { slug }, select: { id: true } });
    if (!existing || existing.id === excludeId) return slug;
  }
  throw new AuthError("Could not allocate a unique product slug", "VALIDATION", 400);
}

export type CatalogueListItem = {
  id: string;
  sku: string;
  name: string;
  slug: string;
  brand: string;
  brandId: string;
  category: string;
  categoryId: string | null;
  status: ProductStatus;
  trade: number | null;
  rrp: number | null;
  stockQty: number | null;
  stockLabel: string;
  imageSrc: string | null;
  updatedAt: string;
  isTradeVisible: boolean;
  isFeatured: boolean;
};

export type CatalogueListQuery = {
  q?: string;
  brandId?: string;
  categoryId?: string;
  status?: ProductStatus | "";
  tradeVisible?: boolean | "";
  featured?: boolean | "";
  stock?: "in" | "out" | "unknown" | "";
  sort?: "name" | "sku" | "updated" | "brand";
  page?: number;
  pageSize?: number;
  exportLimit?: boolean;
};

function defaultVariant<T extends { isDefault: boolean; createdAt: Date }>(variants: T[]): T | undefined {
  return variants.find((v) => v.isDefault) ?? variants[0];
}

export async function listCataloguePage(actorUserId: string, raw: CatalogueListQuery) {
  await requireSystemPermission(actorUserId, "products.view");
  const { bootstrapCatalogue } = await import("@/server/catalogue/service");
  await bootstrapCatalogue();
  const page = Math.max(1, Number(raw.page) || 1);
  const pageSize = raw.exportLimit
    ? Math.min(5000, Math.max(1, Number(raw.pageSize) || 5000))
    : Math.min(100, Math.max(10, Number(raw.pageSize) || 25));
  const q = raw.q?.trim();
  const categoryIds = raw.categoryId
    ? [
        raw.categoryId,
        ...(
          await prisma.category.findMany({
            where: { parentId: raw.categoryId },
            select: { id: true },
          })
        ).map((c) => c.id),
      ]
    : undefined;

  const where: Prisma.ProductWhereInput = {
    ...(raw.brandId ? { brandId: raw.brandId } : {}),
    ...(categoryIds ? { categoryId: { in: categoryIds } } : {}),
    ...(raw.status ? { status: raw.status } : {}),
    ...(raw.tradeVisible === true || raw.tradeVisible === false
      ? { isTradeVisible: raw.tradeVisible }
      : {}),
    ...(raw.featured === true || raw.featured === false ? { isFeatured: raw.featured } : {}),
    ...(q
      ? {
          OR: [
            { name: { contains: q, mode: "insensitive" } },
            { variants: { some: { sku: { contains: q, mode: "insensitive" } } } },
            { variants: { some: { barcode: { contains: q, mode: "insensitive" } } } },
            { variants: { some: { mpn: { contains: q, mode: "insensitive" } } } },
          ],
        }
      : {}),
    ...(raw.stock === "in"
      ? { variants: { some: { inventory: { some: { qtyOnHand: { gt: 0 } } } } } }
      : raw.stock === "out"
        ? {
            AND: [
              { variants: { some: { inventory: { some: {} } } } },
              { NOT: { variants: { some: { inventory: { some: { qtyOnHand: { gt: 0 } } } } } } },
            ],
          }
        : raw.stock === "unknown"
          ? { variants: { every: { inventory: { none: {} } } } }
          : {}),
  };

  const orderBy: Prisma.ProductOrderByWithRelationInput[] =
    raw.sort === "sku"
      ? [{ variants: { _count: "desc" } }, { name: "asc" }]
      : raw.sort === "updated"
        ? [{ updatedAt: "desc" }]
        : raw.sort === "brand"
          ? [{ brand: { name: "asc" } }, { name: "asc" }]
          : [{ name: "asc" }];

  const [total, rows] = await prisma.$transaction([
    prisma.product.count({ where }),
    prisma.product.findMany({
      where,
      include: {
        brand: { select: { name: true } },
        category: { select: { name: true, parent: { select: { name: true } } } },
        variants: {
          orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
          include: {
            inventory: { select: { qtyOnHand: true } },
          },
        },
        media: {
          orderBy: [{ isPrimary: "desc" }, { sortOrder: "asc" }],
          take: 1,
        },
      },
      orderBy,
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);

  const items: CatalogueListItem[] = rows.map((row) => {
    const variant = defaultVariant(row.variants);
    const stockQty = variant
      ? variant.inventory.reduce((sum, inv) => sum + inv.qtyOnHand, 0)
      : null;
    const hasInv = Boolean(variant?.inventory.length);
    const parentName = row.category?.parent?.name;
    return {
      id: row.id,
      sku: variant?.sku ?? "",
      name: row.name,
      slug: row.slug,
      brand: row.brand.name,
      brandId: row.brandId,
      category: parentName ? `${parentName} / ${row.category?.name}` : (row.category?.name ?? "—"),
      categoryId: row.categoryId,
      status: row.status,
      trade: moneyNumber(variant?.tradePrice),
      rrp: moneyNumber(variant?.rrp),
      stockQty: hasInv ? stockQty : null,
      stockLabel: hasInv ? String(stockQty) : "Autopart",
      imageSrc: row.media[0]?.mediaId ? cmsMediaPublicPath(row.media[0].mediaId) : null,
      updatedAt: row.updatedAt.toISOString(),
      isTradeVisible: row.isTradeVisible,
      isFeatured: row.isFeatured,
    };
  });

  if (raw.sort === "sku") {
    items.sort((a, b) => a.sku.localeCompare(b.sku));
  }

  return { items, total, page, pageSize, pageCount: Math.max(1, Math.ceil(total / pageSize)) };
}

export async function createProduct(actorUserId: string, raw: unknown) {
  await requireSystemPermission(actorUserId, "products.create");
  const { bootstrapCatalogue } = await import("@/server/catalogue/service");
  await bootstrapCatalogue();
  const input = productCreateSchema.parse(raw);
  const sku = input.sku.trim().toUpperCase();
  const existing = await prisma.productVariant.findUnique({ where: { sku } });
  if (existing) throw new AuthError(`SKU ${sku} is already used`, "VALIDATION", 400);

  const [brand, category] = await Promise.all([
    prisma.brand.findUnique({ where: { id: input.brandId } }),
    prisma.category.findUnique({ where: { id: input.categoryId } }),
  ]);
  if (!brand) throw new AuthError("Brand not found", "NOT_FOUND", 404);
  if (!category) throw new AuthError("Category not found", "NOT_FOUND", 404);

  const product = await prisma.$transaction(async (tx) => {
    const created = await tx.product.create({
      data: {
        name: input.name,
        slug: await uniqueProductSlug(tx, `${brand.name} ${input.name}`),
        brandId: brand.id,
        categoryId: category.id,
        status: "DRAFT",
        isActive: false,
        isTradeVisible: true,
      },
    });
    await tx.productVariant.create({
      data: {
        productId: created.id,
        sku,
        isDefault: true,
        isActive: true,
        packQty: 1,
        minOrderQty: 1,
        orderIncrement: 1,
        unit: "EA",
      },
    });
    return created;
  });

  await recordAuditEvent({
    action: "catalogue.product_created",
    entityType: "Product",
    entityId: product.id,
    actorUserId,
    metadata: { sku },
  });
  return { id: product.id, sku };
}

function specsFromJson(value: unknown): Array<{ name: string; value: string }> {
  return parseSpecificationsDocument(value).rows;
}

export async function getProductWorkspace(actorUserId: string, id: string) {
  await requireSystemPermission(actorUserId, "products.view");
  const product = await prisma.product.findUnique({
    where: { id },
    include: {
      brand: true,
      category: { include: { parent: true } },
      variants: {
        orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
        include: {
          inventory: { include: { warehouse: true } },
        },
      },
      media: { orderBy: [{ isPrimary: "desc" }, { sortOrder: "asc" }] },
    },
  });
  if (!product) throw new AuthError("Product not found", "NOT_FOUND", 404);
  const variant = defaultVariant(product.variants);
  const specDoc = parseSpecificationsDocument(product.specifications);
  const activity = await prisma.auditEvent.findMany({
    where: {
      OR: [{ entityId: product.id }, { entityId: variant?.id ?? "__none__" }],
      entityType: { in: ["Product", "ProductVariant"] },
    },
    orderBy: { createdAt: "desc" },
    take: 40,
    select: {
      id: true,
      action: true,
      createdAt: true,
      actorUserId: true,
      metadata: true,
      after: true,
    },
  });
  const actorIds = [...new Set(activity.map((event) => event.actorUserId).filter((id): id is string => Boolean(id)))];
  const actors = actorIds.length
    ? await prisma.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, name: true, email: true } })
    : [];
  const actorName = new Map(actors.map((user) => [user.id, user.name || user.email]));
  return {
    id: product.id,
    name: product.name,
    slug: product.slug,
    brandId: product.brandId,
    brandName: product.brand.name,
    categoryId: product.categoryId,
    categoryName: product.category?.name ?? null,
    parentCategoryName: product.category?.parent?.name ?? null,
    status: product.status,
    isActive: product.isActive,
    isTradeVisible: product.isTradeVisible,
    isFeatured: product.isFeatured,
    isNew: product.isNew,
    shortDescription: product.shortDescription,
    description: product.description,
    specifications: specDoc.rows,
    selling: specDoc.selling,
    provenance: specDoc.provenance,
    metaTitle: product.metaTitle,
    metaDescription: product.metaDescription,
    sku: variant?.sku ?? "",
    ean: variant?.barcode ?? null,
    mpn: variant?.mpn ?? null,
    externalRef: variant?.externalRef ?? null,
    tradePrice: moneyNumber(variant?.tradePrice),
    rrp: moneyNumber(variant?.rrp),
    vat: variant?.vatCode === "ZERO_RATED" ? "zero" : "standard",
    packQty: variant?.packQty ?? 1,
    caseQty: variant?.caseQty ?? null,
    minimumOrderQty: variant?.minOrderQty ?? 1,
    orderIncrement: variant?.orderIncrement ?? 1,
    unit: variant?.unit ?? "EA",
    weightKg: moneyNumber(variant?.weightKg),
    lengthMm: moneyNumber(variant?.lengthMm),
    widthMm: moneyNumber(variant?.widthMm),
    heightMm: moneyNumber(variant?.heightMm),
    defaultVariantId: variant?.id ?? null,
    variants: product.variants.map((v) => ({
      id: v.id,
      sku: v.sku,
      name: v.name,
      barcode: v.barcode,
      isDefault: v.isDefault,
      isActive: v.isActive,
    })),
    media: product.media.map((m) => ({
      id: m.id,
      mediaId: m.mediaId,
      src: cmsMediaPublicPath(m.mediaId),
      altText: m.altText,
      isPrimary: m.isPrimary,
      sortOrder: m.sortOrder,
    })),
    inventory: product.variants.flatMap((v) =>
      v.inventory.map((inv) => ({
        variantSku: v.sku,
        warehouse: inv.warehouse.name,
        warehouseCode: inv.warehouse.code,
        qtyOnHand: inv.qtyOnHand,
        qtyReserved: inv.qtyReserved,
        status: inv.status,
        externalSyncedAt: inv.externalSyncedAt?.toISOString() ?? null,
      })),
    ),
    activity: activity.map((event) => ({
      id: event.id,
      action: event.action,
      at: event.createdAt.toISOString(),
      actorName: event.actorUserId ? actorName.get(event.actorUserId) ?? null : null,
    })),
  };
}

export async function updateProductWorkspace(actorUserId: string, raw: unknown) {
  const profile = await requireSystemPermission(actorUserId, "products.edit");
  const input = productWorkspaceSchema.parse(raw);
  const existing = await prisma.product.findUnique({
    where: { id: input.id },
    include: { variants: { orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }] }, brand: true },
  });
  if (!existing) throw new AuthError("Product not found", "NOT_FOUND", 404);
  const variant = defaultVariant(existing.variants);
  if (!variant) throw new AuthError("Product has no SKU variant", "VALIDATION", 400);

  if (input.sku) {
    const sku = input.sku.trim().toUpperCase();
    const clash = await prisma.productVariant.findUnique({ where: { sku } });
    if (clash && clash.id !== variant.id) throw new AuthError(`SKU ${sku} is already used`, "VALIDATION", 400);
  }

  const nextStatus = input.status ?? existing.status;
  const nextActive = nextStatus === "ACTIVE";
  const statusChanged = nextStatus !== existing.status;

  await prisma.$transaction(async (tx) => {
    await tx.product.update({
      where: { id: existing.id },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.brandId !== undefined ? { brandId: input.brandId } : {}),
        ...(input.categoryId !== undefined ? { categoryId: input.categoryId } : {}),
        ...(input.shortDescription !== undefined ? { shortDescription: input.shortDescription } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.specifications !== undefined
          ? {
              specifications: serializeSpecificationsDocument({
                ...parseSpecificationsDocument(existing.specifications),
                rows: input.specifications,
              }),
            }
          : {}),
        ...(input.status !== undefined ? { status: input.status, isActive: nextActive } : {}),
        ...(input.isTradeVisible !== undefined ? { isTradeVisible: input.isTradeVisible } : {}),
        ...(input.isFeatured !== undefined ? { isFeatured: input.isFeatured } : {}),
        ...(input.isNew !== undefined ? { isNew: input.isNew } : {}),
        ...(input.metaTitle !== undefined ? { metaTitle: input.metaTitle } : {}),
        ...(input.metaDescription !== undefined ? { metaDescription: input.metaDescription } : {}),
        ...(input.slug
          ? { slug: await uniqueProductSlug(tx, input.slug, existing.id) }
          : {}),
      },
    });
    await tx.productVariant.update({
      where: { id: variant.id },
      data: {
        ...(input.sku ? { sku: input.sku.trim().toUpperCase() } : {}),
        ...(input.ean !== undefined ? { barcode: input.ean || null } : {}),
        ...(input.mpn !== undefined ? { mpn: input.mpn || null } : {}),
        ...(input.externalRef !== undefined ? { externalRef: input.externalRef || null } : {}),
        ...(input.tradePrice !== undefined ? { tradePrice: input.tradePrice } : {}),
        ...(input.rrp !== undefined ? { rrp: input.rrp } : {}),
        ...(input.vat !== undefined
          ? { vatCode: input.vat.toLowerCase().startsWith("zero") ? "ZERO_RATED" : "STANDARD" }
          : {}),
        ...(input.packQty !== undefined ? { packQty: input.packQty } : {}),
        ...(input.caseQty !== undefined ? { caseQty: input.caseQty } : {}),
        ...(input.minimumOrderQty !== undefined ? { minOrderQty: input.minimumOrderQty } : {}),
        ...(input.orderIncrement !== undefined ? { orderIncrement: input.orderIncrement } : {}),
        ...(input.unit !== undefined ? { unit: input.unit } : {}),
        ...(input.weightKg !== undefined ? { weightKg: input.weightKg } : {}),
        ...(input.lengthMm !== undefined ? { lengthMm: input.lengthMm } : {}),
        ...(input.widthMm !== undefined ? { widthMm: input.widthMm } : {}),
        ...(input.heightMm !== undefined ? { heightMm: input.heightMm } : {}),
      },
    });
    if (input.tradePrice !== undefined && input.tradePrice != null) {
      await tx.quantityBreak.upsert({
        where: { variantId_minQty: { variantId: variant.id, minQty: 1 } },
        create: { variantId: variant.id, minQty: 1, unitPrice: input.tradePrice },
        update: { unitPrice: input.tradePrice },
      });
    }
  });

  await recordAuditEvent({
    action: statusChanged ? "catalogue.product_status_changed" : "catalogue.product_updated",
    entityType: "Product",
    entityId: existing.id,
    actorUserId,
    metadata: { sku: input.sku ?? variant.sku, status: nextStatus },
    after: { status: nextStatus },
  });
  void profile;
  return getProductWorkspace(actorUserId, existing.id);
}

export async function saveProductVariant(actorUserId: string, raw: unknown) {
  await requireSystemPermission(actorUserId, "products.edit");
  const input = productVariantWriteSchema.parse(raw);
  const sku = input.sku.trim().toUpperCase();
  const product = await prisma.product.findUnique({ where: { id: input.productId } });
  if (!product) throw new AuthError("Product not found", "NOT_FOUND", 404);
  const clash = await prisma.productVariant.findUnique({ where: { sku } });
  if (clash && clash.id !== input.id) throw new AuthError(`SKU ${sku} is already used`, "VALIDATION", 400);

  if (input.id) {
    await prisma.productVariant.update({
      where: { id: input.id },
      data: {
        sku,
        name: input.name || null,
        barcode: input.barcode || null,
        isActive: input.isActive ?? true,
      },
    });
  } else {
    await prisma.productVariant.updateMany({
      where: { productId: product.id, isDefault: true },
      data: {},
    });
    await prisma.productVariant.create({
      data: {
        productId: product.id,
        sku,
        name: input.name || null,
        barcode: input.barcode || null,
        isDefault: false,
        isActive: input.isActive ?? true,
      },
    });
  }
  await recordAuditEvent({
    action: "catalogue.product_updated",
    entityType: "Product",
    entityId: product.id,
    actorUserId,
    metadata: { sku, variant: true },
  });
  return getProductWorkspace(actorUserId, product.id);
}

export async function attachProductMedia(actorUserId: string, raw: unknown) {
  await requireSystemPermission(actorUserId, "products.edit");
  const input = productMediaWriteSchema.parse(raw);
  const media = await prisma.cmsMedia.findUnique({ where: { id: input.mediaId } });
  if (!media) throw new AuthError("Media not found", "NOT_FOUND", 404);
  const count = await prisma.productMedia.count({ where: { productId: input.productId } });
  const row = await prisma.productMedia.upsert({
    where: { productId_mediaId: { productId: input.productId, mediaId: input.mediaId } },
    create: {
      productId: input.productId,
      mediaId: input.mediaId,
      altText: input.altText ?? media.altText,
      isPrimary: count === 0 || Boolean(input.isPrimary),
      sortOrder: count,
    },
    update: {
      ...(input.altText !== undefined ? { altText: input.altText } : {}),
      ...(input.isPrimary ? { isPrimary: true } : {}),
    },
  });
  if (input.isPrimary || count === 0) {
    await prisma.productMedia.updateMany({
      where: { productId: input.productId, NOT: { id: row.id } },
      data: { isPrimary: false },
    });
  }
  await recordAuditEvent({
    action: "catalogue.product_updated",
    entityType: "Product",
    entityId: input.productId,
    actorUserId,
    metadata: { mediaId: input.mediaId },
  });
  return getProductWorkspace(actorUserId, input.productId);
}

export async function reorderProductMedia(actorUserId: string, raw: unknown) {
  await requireSystemPermission(actorUserId, "products.edit");
  const input = productMediaReorderSchema.parse(raw);
  await prisma.$transaction(
    input.orderedIds.map((id, index) =>
      prisma.productMedia.updateMany({
        where: { id, productId: input.productId },
        data: {
          sortOrder: index,
          isPrimary: input.primaryId ? id === input.primaryId : index === 0,
        },
      }),
    ),
  );
  return getProductWorkspace(actorUserId, input.productId);
}

export async function detachProductMedia(actorUserId: string, raw: unknown) {
  await requireSystemPermission(actorUserId, "products.edit");
  const input = zProductMediaId.parse(raw);
  const row = await prisma.productMedia.findFirst({
    where: { id: input.id, productId: input.productId },
  });
  if (!row) throw new AuthError("Image is not on this product", "NOT_FOUND", 404);
  await prisma.productMedia.delete({ where: { id: row.id } });
  if (row.isPrimary) {
    const next = await prisma.productMedia.findFirst({
      where: { productId: input.productId },
      orderBy: { sortOrder: "asc" },
    });
    if (next) {
      await prisma.productMedia.update({ where: { id: next.id }, data: { isPrimary: true } });
    }
  }
  return getProductWorkspace(actorUserId, input.productId);
}

const zProductMediaId = {
  parse(raw: unknown) {
    const data = raw as { id?: string; productId?: string };
    if (!data?.id || !data?.productId) throw new AuthError("Image association required", "VALIDATION", 400);
    return { id: data.id, productId: data.productId };
  },
};

async function catalogueExportRows(actorUserId: string, query: CatalogueListQuery) {
  const page = await listCataloguePage(actorUserId, { ...query, page: 1, pageSize: 5000, exportLimit: true });
  const ids = page.items.map((p) => p.id);
  const full = await prisma.product.findMany({
    where: { id: { in: ids } },
    include: {
      brand: true,
      category: { include: { parent: true } },
      variants: { orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }] },
      media: { where: { isPrimary: true }, take: 1 },
    },
  });
  const byId = new Map(full.map((p) => [p.id, p]));
  return page.items.map((item) => {
    const row = byId.get(item.id);
    const variant = row ? defaultVariant(row.variants) : undefined;
    return {
      sku: item.sku,
      externalRef: variant?.externalRef ?? "",
      ean: variant?.barcode ?? "",
      mpn: variant?.mpn ?? "",
      name: item.name,
      brand: item.brand,
      category: row?.category?.parent?.name ?? row?.category?.name ?? "",
      subcategory: row?.category?.parent ? row.category.name : "",
      shortDescription: row?.shortDescription ?? "",
      description: row?.description ?? "",
      trade: item.trade ?? "",
      rrp: item.rrp ?? "",
      vat: variant?.vatCode === "ZERO_RATED" ? "zero" : "standard",
      packQty: variant?.packQty ?? 1,
      caseQty: variant?.caseQty ?? "",
      minimumOrderQty: variant?.minOrderQty ?? 1,
      orderIncrement: variant?.orderIncrement ?? 1,
      unit: variant?.unit ?? "EA",
      weight: variant?.weightKg != null ? String(variant.weightKg) : "",
      length: variant?.lengthMm != null ? String(variant.lengthMm) : "",
      width: variant?.widthMm != null ? String(variant.widthMm) : "",
      height: variant?.heightMm != null ? String(variant.heightMm) : "",
      status: item.status,
      active: item.status === "ACTIVE",
      tradeVisible: item.isTradeVisible,
      featured: item.isFeatured,
      newProduct: row?.isNew ?? false,
      slug: item.slug,
      metaTitle: row?.metaTitle ?? "",
      metaDescription: row?.metaDescription ?? "",
      primaryImage: row?.media[0]?.mediaId ?? "",
    };
  });
}

export async function exportCatalogueCsv(actorUserId: string, query: CatalogueListQuery) {
  await requireAnySystemPermission(actorUserId, ["products.export", "products.edit", "products.view"]);
  const { serializeImportCsv } = await import("@/domain/product-import");
  return serializeImportCsv(await catalogueExportRows(actorUserId, query));
}

const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export async function exportCatalogueWorkbook(actorUserId: string, query: CatalogueListQuery) {
  await requireAnySystemPermission(actorUserId, ["products.export", "products.edit", "products.view"]);
  const { buildProductImportWorkbook, splitTaxonomyLists } = await import("@/domain/product-import-workbook");
  const [rows, categories, brands] = await Promise.all([
    catalogueExportRows(actorUserId, query),
    prisma.category.findMany({
      select: { name: true, parentId: true },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    }),
    prisma.brand.findMany({
      select: { name: true },
      where: { isActive: true },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    }),
  ]);
  const bytes = await buildProductImportWorkbook(splitTaxonomyLists({ categories, brands }), rows);
  const day = new Date().toISOString().slice(0, 10);
  return {
    filename: `automotive-brands-products-${day}.xlsx`,
    mime: XLSX_MIME,
    base64: Buffer.from(bytes).toString("base64"),
  };
}

export async function viewerForUserId(userId: string | null): Promise<PriceViewer> {
  if (!userId) return { kind: "anonymous" };
  const profile = await loadAccessProfile(userId);
  if (!profile) return { kind: "anonymous" };
  return viewerFromAccess({
    signedIn: true,
    actorType: profile.actorType,
    permissions: profile.permissions,
  });
}

const publicWhere: Prisma.ProductWhereInput = {
  status: "ACTIVE",
  isActive: true,
  isTradeVisible: true,
};

export type PublicProductCard = {
  id: string;
  sku: string;
  slug: string;
  name: string;
  brand: string;
  brandSlug: string;
  category: string;
  categorySlug: string | null;
  imageSrc: string | null;
  rrp: number | null;
  price: DisplayPrice;
  availability: PublicAvailability | null;
  isNew: boolean;
  isFeatured: boolean;
};

function toPublicCard(
  row: {
    id: string;
    slug: string;
    name: string;
    isNew: boolean;
    isFeatured: boolean;
    brand: { name: string; slug: string };
    category: { name: string; slug: string; parent: { name: string } | null } | null;
    variants: Array<{
      sku: string;
      tradePrice: unknown;
      rrp: unknown;
      isDefault: boolean;
      createdAt: Date;
      inventory: Array<{ qtyOnHand: number }>;
    }>;
    media: Array<{ mediaId: string; isPrimary: boolean; altText?: string | null }>;
  },
  viewer: PriceViewer,
): PublicProductCard {
  const variant = defaultVariant(row.variants);
  const hasInv = Boolean(variant?.inventory.length);
  const qty = hasInv ? variant!.inventory.reduce((sum, inv) => sum + inv.qtyOnHand, 0) : null;
  const primary = row.media[0];
  return {
    id: row.id,
    sku: variant?.sku ?? "",
    slug: row.slug,
    name: row.name,
    brand: row.brand.name,
    brandSlug: row.brand.slug,
    category: row.category?.parent?.name ?? row.category?.name ?? "",
    categorySlug: row.category?.slug ?? null,
    imageSrc: primary?.mediaId ? cmsMediaPublicPath(primary.mediaId) : null,
    rrp: moneyNumber(variant?.rrp),
    price: resolveDisplayPrice({
      viewer,
      tradePrice: variant?.tradePrice,
      rrp: variant?.rrp,
    }),
    availability: publicAvailabilityFromQty(qty),
    isNew: row.isNew,
    isFeatured: row.isFeatured,
  };
}

const publicInclude = {
  brand: { select: { name: true, slug: true } },
  category: { select: { name: true, slug: true, parent: { select: { name: true } } } },
  variants: {
    orderBy: [{ isDefault: "desc" as const }, { createdAt: "asc" as const }],
    include: { inventory: { select: { qtyOnHand: true } } },
  },
  media: { orderBy: [{ isPrimary: "desc" as const }, { sortOrder: "asc" as const }], take: 8 },
} satisfies Prisma.ProductInclude;

export async function listPublicProducts(input: {
  userId: string | null;
  q?: string | undefined;
  brandSlug?: string | undefined;
  categorySlug?: string | undefined;
  page?: number | undefined;
}) {
  const viewer = await viewerForUserId(input.userId);
  const page = Math.max(1, input.page ?? 1);
  const pageSize = 24;
  const [requestedCategory, categoryRows, brands, categoryCounts] = await Promise.all([
    input.categorySlug
      ? prisma.category.findUnique({
          where: { slug: input.categorySlug },
          select: { id: true, slug: true, name: true, isActive: true },
        })
      : Promise.resolve(null),
    prisma.category.findMany({
      where: { isActive: true },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      select: { id: true, slug: true, name: true, parentId: true, sortOrder: true },
    }),
    prisma.brand.findMany({
      where: { isActive: true, products: { some: publicWhere } },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      select: { slug: true, name: true },
    }),
    prisma.product.groupBy({
      by: ["categoryId"],
      where: { ...publicWhere, categoryId: { not: null } },
      _count: { _all: true },
    }),
  ]);
  const { categoryIdsForFilter, nestPublicCategories } = await import("@/domain/public-catalogue-nav");
  const activeCategory = requestedCategory?.isActive ? requestedCategory : null;
  const categoryIds = activeCategory ? categoryIdsForFilter(categoryRows, activeCategory.id) : undefined;

  const where: Prisma.ProductWhereInput = {
    ...publicWhere,
    ...(input.brandSlug ? { brand: { slug: input.brandSlug, isActive: true } } : {}),
    ...(categoryIds ? { categoryId: { in: categoryIds } } : {}),
    ...(input.q
      ? {
          OR: [
            { name: { contains: input.q, mode: "insensitive" } },
            { variants: { some: { sku: { contains: input.q, mode: "insensitive" } } } },
          ],
        }
      : {}),
  };
  const [total, rows] = await Promise.all([
    prisma.product.count({ where }),
    prisma.product.findMany({
      where,
      include: publicInclude,
      orderBy: [{ isFeatured: "desc" }, { name: "asc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);
  const countsById = new Map(
    categoryCounts
      .filter((row) => row.categoryId)
      .map((row) => [row.categoryId as string, row._count._all]),
  );
  return {
    items: rows.map((row) => toPublicCard(row, viewer)),
    total,
    page,
    pageSize,
    brands,
    categories: nestPublicCategories(categoryRows, countsById),
    category: activeCategory ? { slug: activeCategory.slug, name: activeCategory.name } : null,
  };
}

export async function getPublicProduct(userId: string | null, slugOrSku: string) {
  const viewer = await viewerForUserId(userId);
  const needle = slugOrSku.trim();
  const product =
    (await prisma.product.findFirst({
      where: { ...publicWhere, slug: needle },
      include: publicInclude,
    })) ??
    (await prisma.product.findFirst({
      where: { ...publicWhere, variants: { some: { sku: { equals: needle, mode: "insensitive" } } } },
      include: publicInclude,
    }));
  if (!product) return null;
  const variant = defaultVariant(product.variants);
  const related = await prisma.product.findMany({
    where: { ...publicWhere, brandId: product.brandId, id: { not: product.id } },
    include: publicInclude,
    take: 4,
    orderBy: { name: "asc" },
  });
  return {
    card: toPublicCard(product, viewer),
    description: product.description,
    shortDescription: product.shortDescription,
    specifications: specsFromJson(product.specifications),
    selling: parseSpecificationsDocument(product.specifications).selling,
    gallery: product.media.map((m) => ({
      src: cmsMediaPublicPath(m.mediaId),
      alt: m.altText || product.name,
    })),
    sku: variant?.sku ?? "",
    packQty: variant?.packQty ?? null,
    caseQty: variant?.caseQty ?? null,
    minimumOrderQty: variant?.minOrderQty ?? null,
    orderIncrement: variant?.orderIncrement ?? null,
    related: related.map((row) => toPublicCard(row, viewer)),
  };
}

export async function listPublicBrands() {
  const rows = await prisma.brand.findMany({
    where: { isActive: true },
    orderBy: { sortOrder: "asc" },
  });
  const counts = await prisma.product.groupBy({
    by: ["brandId"],
    where: publicWhere,
    _count: { _all: true },
  });
  const byBrand = new Map(counts.map((row) => [row.brandId, row._count._all]));
  return rows.map((b) => ({
    slug: b.slug,
    name: b.name,
    tagline: b.tagline,
    description: b.description,
    logoSrc: b.logoMediaId ? cmsMediaPublicPath(b.logoMediaId) : null,
    lines: byBrand.get(b.id) ?? 0,
  }));
}

export async function listPublicCategories() {
  return prisma.category.findMany({
    where: { isActive: true },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    select: { slug: true, name: true, description: true, parentId: true },
  });
}

export async function getPublicProductsBySkus(userId: string | null, skus: string[]) {
  const wanted = [...new Set(skus.map((sku) => sku.trim()).filter(Boolean))];
  if (!wanted.length) return [] as PublicProductCard[];
  const viewer = await viewerForUserId(userId);
  const rows = await prisma.product.findMany({
    where: {
      ...publicWhere,
      variants: { some: { sku: { in: wanted, mode: "insensitive" } } },
    },
    include: publicInclude,
  });
  const cards = rows.map((row) => toPublicCard(row, viewer));
  const bySku = new Map(cards.map((card) => [card.sku.toUpperCase(), card]));
  return wanted.map((sku) => bySku.get(sku.toUpperCase())).filter((card): card is PublicProductCard => Boolean(card));
}

export async function listRecentPublicProducts(userId: string | null, take = 6) {
  const viewer = await viewerForUserId(userId);
  const rows = await prisma.product.findMany({
    where: publicWhere,
    include: publicInclude,
    orderBy: [{ isNew: "desc" }, { createdAt: "desc" }],
    take: Math.min(12, Math.max(1, take)),
  });
  return rows.map((row) => toPublicCard(row, viewer));
}

export async function listPublicProductIndex(userId: string | null, take = 80) {
  const viewer = await viewerForUserId(userId);
  const rows = await prisma.product.findMany({
    where: publicWhere,
    include: publicInclude,
    orderBy: [{ isFeatured: "desc" }, { createdAt: "desc" }],
    take: Math.min(120, Math.max(1, take)),
  });
  return rows.map((row) => toPublicCard(row, viewer));
}

export async function getPublicBrand(
  userId: string | null,
  slug: string,
  extras?: { q?: string | undefined; categorySlug?: string | undefined; page?: number | undefined },
) {
  const brand = await prisma.brand.findFirst({ where: { slug, isActive: true } });
  if (!brand) return null;
  const catalogue = await listPublicProducts({
    userId,
    brandSlug: slug,
    q: extras?.q,
    categorySlug: extras?.categorySlug,
    page: extras?.page,
  });
  return {
    slug: brand.slug,
    name: brand.name,
    tagline: brand.tagline,
    description: brand.description,
    logoSrc: brand.logoMediaId ? cmsMediaPublicPath(brand.logoMediaId) : null,
    products: catalogue.items,
    catalogue,
  };
}
