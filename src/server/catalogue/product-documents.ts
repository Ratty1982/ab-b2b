/**
 * Product Documents service — SDS upload, replace, bulk import, public access.
 */
import type { Prisma, ProductDocumentType } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/infra/database/client";
import { AuthError, requireSystemPermission } from "@/server/rbac/guards";
import { hasPermission } from "@/server/rbac/access";
import { recordAuditEvent } from "@/server/audit/record";
import { deleteMediaObject, getMediaObjectBytes, putMediaObject } from "@/server/cms/storage";
import {
  defaultDocumentTitle,
  matchFilenameToProducts,
  PRODUCT_DOCUMENT_TYPES,
  productDocumentPublicPath,
  productDocumentTypeLabel,
  sha256Hex,
  validateProductDocumentPdf,
  type ProductDocumentTypeKey,
  type ProductMatchCandidate,
} from "@/domain/product-documents";

function newDocumentId(): string {
  return `pd_${crypto.randomUUID().replace(/-/g, "")}`;
}

function decodeBase64Body(raw: string): Buffer {
  const trimmed = raw.trim();
  const comma = trimmed.indexOf(",");
  const payload =
    trimmed.startsWith("data:") && comma >= 0 ? trimmed.slice(comma + 1) : trimmed;
  return Buffer.from(payload, "base64");
}

async function requireDocumentsManage(userId: string) {
  const profile = await requireSystemPermission(userId, "products.edit");
  if (profile.actorType === "TRADE") {
    throw new AuthError("Trade users cannot manage product documents", "FORBIDDEN", 403);
  }
  return profile;
}

async function requireDocumentsView(userId: string) {
  const profile = await requireSystemPermission(userId, "products.view");
  if (profile.actorType === "TRADE") {
    throw new AuthError("Trade users cannot access product document admin", "FORBIDDEN", 403);
  }
  return profile;
}

function utcNoon(dateOnly: string | null | undefined): Date | null {
  if (!dateOnly) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateOnly)) return null;
  return new Date(`${dateOnly}T12:00:00.000Z`);
}

function toAdminDto(row: {
  id: string;
  productId: string;
  type: string;
  status: string;
  title: string;
  originalFilename: string;
  contentType: string;
  sizeBytes: number;
  checksumSha256: string;
  revision: string | null;
  documentDate: Date | null;
  notes: string | null;
  uploadedById: string | null;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  replacesDocumentId: string | null;
}) {
  return {
    id: row.id,
    productId: row.productId,
    type: row.type,
    typeLabel: productDocumentTypeLabel(row.type),
    status: row.status,
    title: row.title,
    originalFilename: row.originalFilename,
    contentType: row.contentType,
    sizeBytes: row.sizeBytes,
    checksumSha256: row.checksumSha256,
    revision: row.revision,
    documentDate: row.documentDate?.toISOString() ?? null,
    notes: row.notes,
    uploadedById: row.uploadedById,
    archivedAt: row.archivedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    replacesDocumentId: row.replacesDocumentId,
    viewUrl: productDocumentPublicPath(row.id),
    downloadUrl: `${productDocumentPublicPath(row.id)}?download=1`,
  };
}

export async function listProductDocumentsAdmin(actorUserId: string, productId: string) {
  await requireDocumentsView(actorUserId);
  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: { id: true, name: true },
  });
  if (!product) throw new AuthError("Product not found", "NOT_FOUND", 404);

  const rows = await prisma.productDocument.findMany({
    where: { productId },
    orderBy: [{ type: "asc" }, { status: "asc" }, { createdAt: "desc" }],
  });

  const currentSds = rows.find(
    (r) => r.type === "SAFETY_DATA_SHEET" && r.status === "CURRENT",
  );
  const otherCurrent = rows.filter(
    (r) => !(r.type === "SAFETY_DATA_SHEET" && r.status === "CURRENT") && r.status === "CURRENT",
  );
  const archived = rows.filter((r) => r.status === "ARCHIVED");

  return {
    productId: product.id,
    productName: product.name,
    currentSds: currentSds ? toAdminDto(currentSds) : null,
    otherDocuments: otherCurrent.map(toAdminDto),
    archived: archived.map(toAdminDto),
    typeOptions: PRODUCT_DOCUMENT_TYPES.map((t) => ({
      value: t,
      label: productDocumentTypeLabel(t),
    })),
  };
}

const uploadSchema = z.object({
  productId: z.string().min(1),
  type: z.enum(PRODUCT_DOCUMENT_TYPES).default("SAFETY_DATA_SHEET"),
  title: z.string().trim().max(200).optional().nullable(),
  filename: z.string().min(1),
  contentType: z.string().optional().nullable(),
  base64: z.string().min(1),
  revision: z.string().trim().max(80).optional().nullable(),
  documentDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  notes: z.string().trim().max(2000).optional().nullable(),
  /** When true and a current doc of same type exists, archive it. */
  replaceExisting: z.boolean().optional(),
});

export async function uploadProductDocument(actorUserId: string, raw: unknown) {
  await requireDocumentsManage(actorUserId);
  const input = uploadSchema.parse(raw);
  const product = await prisma.product.findUnique({
    where: { id: input.productId },
    select: { id: true, name: true },
  });
  if (!product) throw new AuthError("Product not found", "NOT_FOUND", 404);

  const bytes = decodeBase64Body(input.base64);
  const validated = validateProductDocumentPdf({
    filename: input.filename,
    contentType: input.contentType,
    bytes,
  });
  if (!validated.ok) throw new AuthError(validated.error, "VALIDATION", 400);

  const checksum = sha256Hex(bytes);
  const type = input.type as ProductDocumentType;

  const existingCurrent = await prisma.productDocument.findFirst({
    where: { productId: product.id, type, status: "CURRENT" },
  });
  if (existingCurrent && !input.replaceExisting) {
    throw new AuthError(
      "A current document of this type already exists. Confirm replacement.",
      "EXISTS",
      409,
    );
  }

  const duplicate = await prisma.productDocument.findFirst({
    where: {
      productId: product.id,
      type,
      checksumSha256: checksum,
      status: "CURRENT",
    },
  });
  if (duplicate) {
    throw new AuthError("This exact PDF is already attached as the current document", "DUPLICATE", 409);
  }

  const docId = newDocumentId();
  const storageKey = `products/${product.id}/documents/${docId}/${validated.filename}`;

  let stored;
  try {
    stored = await putMediaObject({
      storageKey,
      bytes,
      contentType: validated.contentType,
    });
  } catch (err) {
    throw new AuthError(
      `Storage upload failed: ${err instanceof Error ? err.message : "unknown"}`,
      "STORAGE",
      502,
    );
  }

  const title =
    input.title?.trim() ||
    defaultDocumentTitle(product.name, input.type as ProductDocumentTypeKey);

  try {
    const created = await prisma.$transaction(async (tx) => {
      if (existingCurrent && input.replaceExisting) {
        await tx.productDocument.update({
          where: { id: existingCurrent.id },
          data: {
            status: "ARCHIVED",
            archivedAt: new Date(),
            archivedById: actorUserId,
          },
        });
      }
      return tx.productDocument.create({
        data: {
          id: docId,
          productId: product.id,
          type,
          status: "CURRENT",
          title,
          originalFilename: validated.filename,
          storageKey: stored.storageKey,
          storageProvider: stored.provider,
          bytes: stored.bytes ? Buffer.from(stored.bytes) : null,
          contentType: validated.contentType,
          sizeBytes: bytes.length,
          checksumSha256: checksum,
          revision: input.revision?.trim() || null,
          documentDate: utcNoon(input.documentDate),
          notes: input.notes?.trim() || null,
          uploadedById: actorUserId,
          replacesDocumentId: existingCurrent && input.replaceExisting ? existingCurrent.id : null,
        },
      });
    });

    await recordAuditEvent({
      action: existingCurrent && input.replaceExisting
        ? "catalogue.document_replaced"
        : "catalogue.document_uploaded",
      entityType: "ProductDocument",
      entityId: created.id,
      actorUserId,
      metadata: {
        productId: product.id,
        documentType: type,
        type,
        filename: validated.filename,
        checksum,
        replacedDocumentId:
          existingCurrent && input.replaceExisting ? existingCurrent.id : null,
      },
    });

    return toAdminDto(created);
  } catch (err) {
    // Best-effort cleanup of orphaned object if DB write failed after upload.
    await deleteMediaObject({
      storageProvider: stored.provider,
      storageKey: stored.storageKey,
    }).catch(() => undefined);
    throw err;
  }
}

export async function archiveProductDocument(actorUserId: string, documentId: string) {
  await requireDocumentsManage(actorUserId);
  const existing = await prisma.productDocument.findUnique({ where: { id: documentId } });
  if (!existing) throw new AuthError("Document not found", "NOT_FOUND", 404);
  if (existing.status === "ARCHIVED") return toAdminDto(existing);

  const updated = await prisma.productDocument.update({
    where: { id: existing.id },
    data: {
      status: "ARCHIVED",
      archivedAt: new Date(),
      archivedById: actorUserId,
    },
  });

  await recordAuditEvent({
    action: "catalogue.document_archived",
    entityType: "ProductDocument",
    entityId: updated.id,
    actorUserId,
    metadata: {
      productId: updated.productId,
      type: updated.type,
      filename: updated.originalFilename,
    },
  });

  return toAdminDto(updated);
}

export type BulkPreviewItem = {
  clientKey: string;
  filename: string;
  sizeBytes: number;
  checksumSha256: string;
  status:
    | "MATCHED"
    | "REVIEW"
    | "NO_MATCH"
    | "ALREADY_ATTACHED"
    | "EXISTING_SDS"
    | "INVALID";
  message: string;
  productId: string | null;
  productName: string | null;
  sku: string | null;
  candidates: ProductMatchCandidate[];
  /** Present for valid files — used on confirm. */
  base64?: string;
  contentType?: string;
};

export async function previewBulkSdsImport(
  actorUserId: string,
  raw: { files: Array<{ filename: string; contentType?: string; base64: string; clientKey?: string }> },
) {
  await requireDocumentsManage(actorUserId);
  const files = raw.files ?? [];
  if (!files.length) throw new AuthError("No files provided", "VALIDATION", 400);
  if (files.length > 40) {
    throw new AuthError("Preview up to 40 PDFs at a time", "VALIDATION", 400);
  }

  const variants = await prisma.productVariant.findMany({
    where: { isActive: true, product: { isActive: true } },
    select: {
      sku: true,
      productId: true,
      isDefault: true,
      product: { select: { id: true, name: true, brand: { select: { name: true } } } },
    },
    take: 20000,
  });
  // Prefer default variant SKU per product.
  const byProduct = new Map<string, ProductMatchCandidate>();
  for (const v of variants) {
    const existing = byProduct.get(v.productId);
    if (!existing || v.isDefault) {
      byProduct.set(v.productId, {
        productId: v.product.id,
        sku: v.sku,
        name: v.product.name,
        brandName: v.product.brand.name,
      });
    }
  }
  const catalogueFinal = [...byProduct.values()];

  const items: BulkPreviewItem[] = [];
  for (let i = 0; i < files.length; i++) {
    const file = files[i]!;
    const clientKey = file.clientKey ?? `f-${i}`;
    const bytes = decodeBase64Body(file.base64);
    const validated = validateProductDocumentPdf({
      filename: file.filename,
      contentType: file.contentType,
      bytes,
    });
    if (!validated.ok) {
      items.push({
        clientKey,
        filename: file.filename,
        sizeBytes: bytes.length,
        checksumSha256: "",
        status: "INVALID",
        message: validated.error,
        productId: null,
        productName: null,
        sku: null,
        candidates: [],
      });
      continue;
    }
    const checksum = sha256Hex(bytes);
    const match = matchFilenameToProducts(validated.filename, catalogueFinal);

    let productId: string | null = null;
    let productName: string | null = null;
    let sku: string | null = null;
    let candidates: ProductMatchCandidate[] = [];
    let status: BulkPreviewItem["status"] = "NO_MATCH";
    let message = match.reason;

    if (match.status === "MATCHED") {
      productId = match.product.productId;
      productName = match.product.name;
      sku = match.product.sku;
      status = "MATCHED";
    } else if (match.status === "REVIEW") {
      candidates = match.products;
      status = "REVIEW";
    }

    if (productId) {
      const dup = await prisma.productDocument.findFirst({
        where: {
          productId,
          type: "SAFETY_DATA_SHEET",
          checksumSha256: checksum,
          status: "CURRENT",
        },
        select: { id: true },
      });
      if (dup) {
        status = "ALREADY_ATTACHED";
        message = "Exact PDF already attached";
      } else {
        const existing = await prisma.productDocument.findFirst({
          where: { productId, type: "SAFETY_DATA_SHEET", status: "CURRENT" },
          select: { id: true, title: true },
        });
        if (existing) {
          status = "EXISTING_SDS";
          message = "Product already has a current SDS — choose Replace or Skip";
        }
      }
    }

    items.push({
      clientKey,
      filename: validated.filename,
      sizeBytes: bytes.length,
      checksumSha256: checksum,
      status,
      message,
      productId,
      productName,
      sku,
      candidates,
      base64: file.base64,
      contentType: validated.contentType,
    });
  }

  return { items, catalogueSize: catalogueFinal.length };
}

const confirmBulkSchema = z.object({
  items: z.array(
    z.object({
      clientKey: z.string(),
      filename: z.string(),
      base64: z.string(),
      contentType: z.string().optional().nullable(),
      productId: z.string().min(1),
      action: z.enum(["IMPORT", "REPLACE", "SKIP"]),
      title: z.string().optional().nullable(),
      revision: z.string().optional().nullable(),
    }),
  ),
});

export async function confirmBulkSdsImport(actorUserId: string, raw: unknown) {
  await requireDocumentsManage(actorUserId);
  const input = confirmBulkSchema.parse(raw);
  const results: Array<{
    clientKey: string;
    filename: string;
    status: "IMPORTED" | "REPLACED" | "SKIPPED" | "FAILED";
    message: string;
    documentId?: string;
  }> = [];

  let imported = 0;
  let replaced = 0;
  let skipped = 0;
  let failed = 0;

  for (const item of input.items) {
    if (item.action === "SKIP") {
      skipped += 1;
      results.push({
        clientKey: item.clientKey,
        filename: item.filename,
        status: "SKIPPED",
        message: "Skipped",
      });
      continue;
    }
    try {
      const doc = await uploadProductDocument(actorUserId, {
        productId: item.productId,
        type: "SAFETY_DATA_SHEET",
        title: item.title,
        filename: item.filename,
        contentType: item.contentType,
        base64: item.base64,
        revision: item.revision,
        replaceExisting: item.action === "REPLACE",
      });
      if (item.action === "REPLACE") {
        replaced += 1;
        results.push({
          clientKey: item.clientKey,
          filename: item.filename,
          status: "REPLACED",
          message: "Replaced existing SDS",
          documentId: doc.id,
        });
      } else {
        imported += 1;
        results.push({
          clientKey: item.clientKey,
          filename: item.filename,
          status: "IMPORTED",
          message: "Imported",
          documentId: doc.id,
        });
      }
    } catch (err) {
      failed += 1;
      results.push({
        clientKey: item.clientKey,
        filename: item.filename,
        status: "FAILED",
        message: err instanceof Error ? err.message : "Import failed",
      });
    }
  }

  await recordAuditEvent({
    action: "catalogue.bulk_document_import",
    entityType: "ProductDocument",
    actorUserId,
    metadata: { imported, replaced, skipped, failed, total: input.items.length },
  });

  return { imported, replaced, skipped, failed, results };
}

export async function searchProductsForDocumentAttach(
  actorUserId: string,
  q: string,
  limit = 20,
) {
  await requireDocumentsView(actorUserId);
  const needle = q.trim();
  if (needle.length < 2) return [];
  const rows = await prisma.product.findMany({
    where: {
      OR: [
        { name: { contains: needle, mode: "insensitive" } },
        { variants: { some: { sku: { contains: needle, mode: "insensitive" } } } },
      ],
    },
    select: {
      id: true,
      name: true,
      brand: { select: { name: true } },
      variants: {
        orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
        take: 1,
        select: { sku: true },
      },
    },
    take: Math.min(50, Math.max(1, limit)),
  });
  return rows.map((r) => ({
    productId: r.id,
    name: r.name,
    sku: r.variants[0]?.sku ?? "",
    brandName: r.brand.name,
  }));
}

/** Public/admin download — enforces product visibility for anonymous access. */
export async function getProductDocumentBytes(
  documentId: string,
  opts?: { actorUserId?: string | null; allowArchived?: boolean },
): Promise<{
  bytes: Buffer;
  contentType: string;
  filename: string;
} | null> {
  const doc = await prisma.productDocument.findUnique({
    where: { id: documentId },
    include: {
      product: {
        select: {
          id: true,
          status: true,
          isActive: true,
          isTradeVisible: true,
        },
      },
    },
  });
  if (!doc) return null;

  const actorUserId = opts?.actorUserId ?? null;
  let isStaff = false;
  if (actorUserId) {
    try {
      const profile = await requireSystemPermission(actorUserId, "products.view");
      isStaff =
        profile.actorType !== "TRADE" &&
        (hasPermission(profile, "products.view") || hasPermission(profile, "admin.access"));
    } catch {
      isStaff = false;
    }
  }

  if (doc.status !== "CURRENT") {
    if (!(isStaff && opts?.allowArchived !== false)) return null;
  }

  if (!isStaff) {
    // Public access only for CURRENT docs on publicly visible products.
    if (doc.status !== "CURRENT") return null;
    if (
      doc.product.status !== "ACTIVE" ||
      !doc.product.isActive ||
      !doc.product.isTradeVisible
    ) {
      return null;
    }
  }

  const bytes = await getMediaObjectBytes({
    storageProvider: doc.storageProvider,
    storageKey: doc.storageKey,
    bytes: doc.bytes,
  });
  if (!bytes) return null;

  return {
    bytes,
    contentType: doc.contentType,
    filename: doc.originalFilename,
  };
}

export async function listPublicProductDocuments(productId: string) {
  const rows = await prisma.productDocument.findMany({
    where: { productId, status: "CURRENT" },
    orderBy: [{ type: "asc" }, { createdAt: "desc" }],
    select: {
      id: true,
      type: true,
      title: true,
      revision: true,
      documentDate: true,
      sizeBytes: true,
      updatedAt: true,
    },
  });
  return rows.map((r) => ({
    id: r.id,
    type: r.type,
    typeLabel: productDocumentTypeLabel(r.type),
    title: r.title,
    revision: r.revision,
    documentDate: r.documentDate?.toISOString() ?? null,
    sizeBytes: r.sizeBytes,
    updatedAt: r.updatedAt.toISOString(),
    viewUrl: productDocumentPublicPath(r.id),
    downloadUrl: `${productDocumentPublicPath(r.id)}?download=1`,
  }));
}

/** Whether product has a current SDS (for catalogue list). */
export function sdsFilterWhere(
  sds: "attached" | "missing" | "" | undefined,
): Prisma.ProductWhereInput {
  if (sds === "attached") {
    return {
      productDocuments: {
        some: { type: "SAFETY_DATA_SHEET", status: "CURRENT" },
      },
    };
  }
  if (sds === "missing") {
    return {
      productDocuments: {
        none: { type: "SAFETY_DATA_SHEET", status: "CURRENT" },
      },
    };
  }
  return {};
}
