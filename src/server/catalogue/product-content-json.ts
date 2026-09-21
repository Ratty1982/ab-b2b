import { prisma } from "@/infra/database/client";
import { recordAuditEvent } from "@/server/audit/record";
import { AuthError, requireSystemPermission } from "@/server/rbac/guards";
import {
  parseProductContentJsonText,
  previewProductContentJson,
  type ProductContentJsonPreview,
  type ProductContentJsonSnapshot,
} from "@/domain/product-content-json";
import {
  parseSpecificationsDocument,
  serializeSpecificationsDocument,
  upsertSpecRows,
} from "@/domain/product-specifications";
import { moneyNumber } from "@/server/pricing/trade-price";

function defaultVariant<T extends { isDefault: boolean; createdAt: Date }>(variants: T[]): T | undefined {
  return variants.find((v) => v.isDefault) ?? variants[0];
}

async function loadSnapshot(productId: string): Promise<{
  snapshot: ProductContentJsonSnapshot;
  lookup: Parameters<typeof previewProductContentJson>[1];
  productExists: boolean;
}> {
  const product = await prisma.product.findUnique({
    where: { id: productId },
    include: {
      brand: true,
      category: { include: { parent: true } },
      variants: { orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }] },
      media: { orderBy: [{ isPrimary: "desc" }, { sortOrder: "asc" }] },
    },
  });
  if (!product) throw new AuthError("Product not found", "NOT_FOUND", 404);
  const variant = defaultVariant(product.variants);
  if (!variant) throw new AuthError("Product has no SKU variant", "VALIDATION", 400);
  const specDoc = parseSpecificationsDocument(product.specifications);
  const [brands, categories, mediaRows, otherSlugs, skuRows] = await Promise.all([
    prisma.brand.findMany({ select: { id: true, name: true } }),
    prisma.category.findMany({
      select: { id: true, name: true, parentId: true, parent: { select: { name: true } } },
    }),
    prisma.cmsMedia.findMany({ select: { id: true } }),
    prisma.product.findMany({ where: { NOT: { id: product.id } }, select: { slug: true } }),
    prisma.productVariant.findMany({ select: { sku: true } }),
  ]);
  const snapshot: ProductContentJsonSnapshot = {
    id: product.id,
    sku: variant.sku,
    name: product.name,
    slug: product.slug,
    brandId: product.brandId,
    brandName: product.brand.name,
    categoryId: product.categoryId,
    categoryName: product.category?.name ?? null,
    parentCategoryName: product.category?.parent?.name ?? null,
    status: product.status,
    isTradeVisible: product.isTradeVisible,
    isFeatured: product.isFeatured,
    isNew: product.isNew,
    shortDescription: product.shortDescription,
    description: product.description,
    ean: variant.barcode,
    mpn: variant.mpn,
    rrp: moneyNumber(variant.rrp),
    tradePrice: moneyNumber(variant.tradePrice),
    vatCode: variant.vatCode === "ZERO_RATED" ? "ZERO_RATED" : "STANDARD",
    packQty: variant.packQty,
    caseQty: variant.caseQty,
    minOrderQty: variant.minOrderQty,
    orderIncrement: variant.orderIncrement,
    metaTitle: product.metaTitle,
    metaDescription: product.metaDescription,
    specRows: specDoc.rows,
    selling: specDoc.selling,
    provenance: specDoc.provenance,
    seoKeywords: specDoc.seoKeywords,
    primaryMediaAlt: product.media.find((m) => m.isPrimary)?.altText ?? product.media[0]?.altText ?? null,
    otherProductSlugs: otherSlugs.map((row) => row.slug),
  };
  return {
    snapshot,
    lookup: {
      brands,
      categories: categories.map((c) => ({
        id: c.id,
        name: c.name,
        parentId: c.parentId,
        parentName: c.parent?.name ?? null,
      })),
      cmsMediaIds: mediaRows.map((row) => row.id),
      knownSkus: skuRows.map((row) => row.sku),
    },
    productExists: true,
  };
}

export async function previewProductJsonImport(actorUserId: string, input: { productId: string; jsonText: string }) {
  await requireSystemPermission(actorUserId, "products.edit");
  const parsedText = parseProductContentJsonText(input.jsonText);
  if (!parsedText.ok) {
    return {
      schemaValid: false,
      skuMatched: null,
      brandMatched: null,
      categoryMatched: null,
      issues: [{ level: "error" as const, code: "INVALID_JSON", message: parsedText.error }],
      changes: [],
      skipped: [],
      unsupported: [],
      unresolved: [],
      schemaVersion: "1.0",
      canApply: false,
    };
  }
  const { snapshot, lookup } = await loadSnapshot(input.productId);
  const preview = previewProductContentJson(snapshot, lookup, parsedText.data);
  return summarisePreview(preview);
}

function summarisePreview(preview: ProductContentJsonPreview) {
  const errors = preview.issues.filter((i) => i.level === "error");
  return {
    schemaValid: preview.schemaValid && errors.length === 0,
    skuMatched: preview.skuMatched,
    brandMatched: preview.brandMatched,
    categoryMatched: preview.categoryMatched,
    issues: preview.issues,
    changes: preview.changes,
    skipped: preview.skipped,
    unsupported: preview.unsupported,
    unresolved: preview.unresolved,
    schemaVersion: preview.schemaVersion,
    canApply: errors.length === 0,
    updatedCount: preview.changes.length,
    unchangedCount: preview.skipped.length,
    skippedCount: preview.unsupported.length + preview.unresolved.length,
  };
}

export async function applyProductJsonImport(actorUserId: string, input: { productId: string; jsonText: string }) {
  await requireSystemPermission(actorUserId, "products.edit");
  const parsedText = parseProductContentJsonText(input.jsonText);
  if (!parsedText.ok) throw new AuthError(parsedText.error, "VALIDATION", 400);
  const { snapshot, lookup } = await loadSnapshot(input.productId);
  const preview = previewProductContentJson(snapshot, lookup, parsedText.data);
  if (preview.issues.some((issue) => issue.level === "error")) {
    const first = preview.issues.find((issue) => issue.level === "error");
    throw new AuthError(first?.message ?? "JSON import is not valid", "VALIDATION", 400);
  }
  const patch = preview.patch;
  const product = await prisma.product.findUnique({
    where: { id: input.productId },
    include: {
      variants: { orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }] },
      media: { orderBy: [{ isPrimary: "desc" }, { sortOrder: "asc" }] },
    },
  });
  if (!product) throw new AuthError("Product not found", "NOT_FOUND", 404);
  const variant = defaultVariant(product.variants);
  if (!variant) throw new AuthError("Product has no SKU variant", "VALIDATION", 400);
  if (variant.sku.trim().toUpperCase() !== snapshot.sku.trim().toUpperCase()) {
    throw new AuthError("SKU changed since preview. Re-validate before applying.", "VALIDATION", 409);
  }

  const specDoc = parseSpecificationsDocument(product.specifications);
  if (patch.specRowsUpsert?.length) specDoc.rows = upsertSpecRows(specDoc.rows, patch.specRowsUpsert);
  if (patch.selling) specDoc.selling = { ...specDoc.selling, ...patch.selling };
  if (patch.provenance) specDoc.provenance = { ...specDoc.provenance, ...patch.provenance };
  if (patch.seoKeywords) specDoc.seoKeywords = patch.seoKeywords;

  const nextStatus = patch.status ?? product.status;

  await prisma.$transaction(async (tx) => {
    if (patch.brandId) {
      const brand = await tx.brand.findUnique({ where: { id: patch.brandId } });
      if (!brand) throw new AuthError("Brand no longer exists", "VALIDATION", 400);
    }
    if (patch.categoryId) {
      const category = await tx.category.findUnique({ where: { id: patch.categoryId } });
      if (!category) throw new AuthError("Category no longer exists", "VALIDATION", 400);
    }
    if (patch.slug && patch.slug !== product.slug) {
      const clash = await tx.product.findUnique({ where: { slug: patch.slug }, select: { id: true } });
      if (clash && clash.id !== product.id) throw new AuthError(`Slug "${patch.slug}" is already used`, "VALIDATION", 400);
    }

    const specChanged = Boolean(
      patch.specRowsUpsert?.length || patch.selling || patch.provenance || patch.seoKeywords,
    );
    const productData = {
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.brandId !== undefined ? { brandId: patch.brandId } : {}),
        ...(patch.categoryId !== undefined ? { categoryId: patch.categoryId } : {}),
        ...(patch.shortDescription !== undefined ? { shortDescription: patch.shortDescription } : {}),
        ...(patch.description !== undefined ? { description: patch.description } : {}),
        ...(patch.status !== undefined ? { status: patch.status, isActive: nextStatus === "ACTIVE" } : {}),
        ...(patch.isTradeVisible !== undefined ? { isTradeVisible: patch.isTradeVisible } : {}),
        ...(patch.isFeatured !== undefined ? { isFeatured: patch.isFeatured } : {}),
        ...(patch.isNew !== undefined ? { isNew: patch.isNew } : {}),
        ...(patch.metaTitle !== undefined ? { metaTitle: patch.metaTitle } : {}),
        ...(patch.metaDescription !== undefined ? { metaDescription: patch.metaDescription } : {}),
        ...(patch.slug !== undefined ? { slug: patch.slug } : {}),
        ...(specChanged ? { specifications: serializeSpecificationsDocument(specDoc) } : {}),
    };
    if (Object.keys(productData).length) {
      await tx.product.update({ where: { id: product.id }, data: productData });
    }

    const variantData = {
        ...(patch.ean !== undefined ? { barcode: patch.ean } : {}),
        ...(patch.mpn !== undefined ? { mpn: patch.mpn } : {}),
        ...(patch.rrp !== undefined ? { rrp: patch.rrp } : {}),
        ...(patch.tradePrice !== undefined ? { tradePrice: patch.tradePrice } : {}),
        ...(patch.vatCode !== undefined ? { vatCode: patch.vatCode } : {}),
        ...(patch.packQty !== undefined ? { packQty: patch.packQty } : {}),
        ...(patch.caseQty !== undefined ? { caseQty: patch.caseQty } : {}),
        ...(patch.minOrderQty !== undefined ? { minOrderQty: patch.minOrderQty } : {}),
        ...(patch.orderIncrement !== undefined ? { orderIncrement: patch.orderIncrement } : {}),
    };
    if (Object.keys(variantData).length) {
      await tx.productVariant.update({ where: { id: variant.id }, data: variantData });
    }

    if (patch.mediaAlt) {
      const primary = product.media.find((m) => m.isPrimary) ?? product.media[0];
      if (primary) {
        await tx.productMedia.update({ where: { id: primary.id }, data: { altText: patch.mediaAlt } });
      }
    }

    if (patch.attachMediaIds?.length) {
      let sortOrder = product.media.length;
      for (const mediaId of patch.attachMediaIds) {
        const media = await tx.cmsMedia.findUnique({ where: { id: mediaId } });
        if (!media) continue;
        await tx.productMedia.upsert({
          where: { productId_mediaId: { productId: product.id, mediaId } },
          create: {
            productId: product.id,
            mediaId,
            altText: patch.mediaAlt ?? media.altText,
            isPrimary: product.media.length === 0 && sortOrder === 0,
            sortOrder: sortOrder++,
          },
          update: {},
        });
      }
    }
  });

  const changedKeys = preview.changes.map((change) => change.key);
  await recordAuditEvent({
    action: "catalogue.product_json_import",
    entityType: "Product",
    entityId: product.id,
    actorUserId,
    metadata: {
      schemaVersion: preview.schemaVersion,
      changedFields: changedKeys,
      updatedCount: preview.changes.length,
      skippedCount: preview.skipped.length,
    },
    before: Object.fromEntries(preview.changes.map((change) => [change.key, change.current])),
    after: Object.fromEntries(preview.changes.map((change) => [change.key, change.proposed])),
  });

  return {
    updatedCount: preview.changes.length,
    unchangedCount: preview.skipped.length,
    skippedCount: preview.unsupported.length + preview.unresolved.length,
    errorCount: 0,
    changes: preview.changes,
  };
}
