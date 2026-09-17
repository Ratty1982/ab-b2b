import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/infra/database/client";
import { recordAuditEvent } from "@/server/audit/record";
import { AuthError, requireSystemPermission } from "@/server/rbac/guards";
import { slugifyCatalogue } from "@/domain/catalogue";
import {
  autoMapHeaders,
  coerceImportValues,
  matchTaxonomyName,
  parseMappedRows,
  type ColumnMapping,
  type ImportParsedRow,
  type TaxonomyResolution,
} from "@/domain/product-import";
import { parseCsvRecords } from "@/domain/catalogue-csv";

const MAX_CSV_BYTES = 1_500_000;
const MAX_ROWS = 2000;

function assertCsvUpload(filename: string, mime: string | undefined, csv: string) {
  const name = filename.toLowerCase();
  if (!name.endsWith(".csv")) {
    throw new AuthError("Upload a .csv file", "VALIDATION", 400);
  }
  const type = (mime ?? "").toLowerCase();
  if (
    type &&
    !["text/csv", "application/csv", "application/vnd.ms-excel", "text/plain", "application/octet-stream"].includes(
      type,
    )
  ) {
    throw new AuthError("File type must be CSV", "VALIDATION", 400);
  }
  if (Buffer.byteLength(csv, "utf8") > MAX_CSV_BYTES) {
    throw new AuthError("CSV is larger than 1.5 MB", "VALIDATION", 400);
  }
}

async function uniqueSlug(
  tx: Prisma.TransactionClient,
  table: "brand" | "category" | "product",
  base: string,
  excludeId?: string,
) {
  const root = slugifyCatalogue(base);
  for (let i = 0; i < 50; i += 1) {
    const slug = i === 0 ? root : `${root.slice(0, 70)}-${i + 1}`;
    const existing =
      table === "brand"
        ? await tx.brand.findUnique({ where: { slug }, select: { id: true } })
        : table === "category"
          ? await tx.category.findUnique({ where: { slug }, select: { id: true } })
          : await tx.product.findUnique({ where: { slug }, select: { id: true } });
    if (!existing || existing.id === excludeId) return slug;
  }
  throw new AuthError("Could not allocate a unique slug", "VALIDATION", 400);
}

type JobPreview = {
  headers: string[];
  csv: string;
  rows: ImportParsedRow[];
  summary: {
    newCount: number;
    updateCount: number;
    invalidCount: number;
    duplicateSkuCount: number;
    deactivateCount: number;
    newBrandCount: number;
    newCategoryCount: number;
  };
  changes: Array<{
    sku: string;
    kind: "new" | "update";
    fields: Array<{ field: string; from: string; to: string }>;
  }>;
  issues: Array<{ line: number; sku?: string; level: "error" | "warning"; message: string }>;
};

function asPreview(value: unknown): JobPreview | null {
  if (!value || typeof value !== "object") return null;
  return value as JobPreview;
}

export async function uploadProductImport(
  actorUserId: string,
  raw: { filename: string; csv: string; mime?: string },
) {
  await requireSystemPermission(actorUserId, "products.import");
  const { bootstrapCatalogue } = await import("@/server/catalogue/service");
  await bootstrapCatalogue();
  assertCsvUpload(raw.filename, raw.mime, raw.csv);
  const table = parseCsvRecords(raw.csv);
  if (!table.length) throw new AuthError("File is empty", "VALIDATION", 400);
  const headers = table[0]!.map((h) => h.trim());
  const mapping = autoMapHeaders(headers);
  const parsed = parseMappedRows(raw.csv, mapping);
  if (parsed.rows.length > MAX_ROWS) {
    throw new AuthError("Import is limited to 2,000 rows", "VALIDATION", 400);
  }

  const job = await prisma.productImportJob.create({
    data: {
      filename: raw.filename.slice(0, 200),
      uploadedById: actorUserId,
      status: "UPLOADED",
      rowCount: parsed.rows.length,
      mapping: mapping as Prisma.InputJsonValue,
      sourceHash: createHash("sha256").update(raw.csv).digest("hex"),
      preview: {
        headers,
        csv: raw.csv,
        rows: parsed.rows,
        summary: {
          newCount: 0,
          updateCount: 0,
          invalidCount: parsed.issues.filter((i) => i.level === "error").length,
          duplicateSkuCount: parsed.issues.filter((i) => i.message.includes("Duplicate SKU")).length,
          deactivateCount: 0,
          newBrandCount: 0,
          newCategoryCount: 0,
        },
        changes: [],
        issues: parsed.issues,
      } satisfies JobPreview as unknown as Prisma.InputJsonValue,
    },
  });
  return getImportJob(actorUserId, job.id);
}

export async function updateImportMapping(
  actorUserId: string,
  raw: { id: string; mapping: ColumnMapping; brandActions?: TaxonomyResolution[]; categoryActions?: TaxonomyResolution[] },
) {
  await requireSystemPermission(actorUserId, "products.import");
  const job = await prisma.productImportJob.findUnique({ where: { id: raw.id } });
  if (!job) throw new AuthError("Import not found", "NOT_FOUND", 404);
  if (job.status === "APPLIED") throw new AuthError("This import has already been applied", "VALIDATION", 400);
  const preview = asPreview(job.preview);
  if (!preview) throw new AuthError("Import file is no longer available", "VALIDATION", 400);
  const parsed = parseMappedRows(preview.csv, raw.mapping);
  await prisma.productImportJob.update({
    where: { id: job.id },
    data: {
      mapping: raw.mapping as Prisma.InputJsonValue,
      unknownBrands: (raw.brandActions ?? job.unknownBrands) as Prisma.InputJsonValue,
      unknownCategories: (raw.categoryActions ?? job.unknownCategories) as Prisma.InputJsonValue,
      preview: { ...preview, rows: parsed.rows, issues: parsed.issues } as unknown as Prisma.InputJsonValue,
      status: "UPLOADED",
    },
  });
  return previewImport(actorUserId, job.id);
}

export async function previewImport(actorUserId: string, id: string) {
  await requireSystemPermission(actorUserId, "products.import");
  const job = await prisma.productImportJob.findUnique({ where: { id } });
  if (!job) throw new AuthError("Import not found", "NOT_FOUND", 404);
  const preview = asPreview(job.preview);
  if (!preview) throw new AuthError("Import file is no longer available", "VALIDATION", 400);

  const [brands, categories, skus] = await Promise.all([
    prisma.brand.findMany({ select: { id: true, name: true, slug: true } }),
    prisma.category.findMany({ select: { id: true, name: true, slug: true, parentId: true } }),
    prisma.productVariant.findMany({
      where: { sku: { in: preview.rows.map((r) => r.sku) } },
      select: {
        sku: true,
        productId: true,
        tradePrice: true,
        rrp: true,
        product: { select: { name: true, status: true, brand: { select: { name: true } } } },
      },
    }),
  ]);
  const skuMap = new Map(skus.map((s) => [s.sku, s]));
  const mapping = job.mapping as ColumnMapping;
  const brandActions = new Map<string, TaxonomyResolution>();
  const categoryActions = new Map<string, TaxonomyResolution>();

  const storedBrands = Array.isArray(job.unknownBrands) ? (job.unknownBrands as TaxonomyResolution[]) : [];
  const storedCats = Array.isArray(job.unknownCategories)
    ? (job.unknownCategories as TaxonomyResolution[])
    : [];
  for (const row of storedBrands) brandActions.set(row.name.toLowerCase(), row);
  for (const row of storedCats) categoryActions.set(row.name.toLowerCase(), row);

  const issues = [...preview.issues];
  const changes: JobPreview["changes"] = [];
  let newCount = 0;
  let updateCount = 0;
  let deactivateCount = 0;
  const errorLines = new Set(issues.filter((i) => i.level === "error").map((i) => i.line));

  for (const row of preview.rows) {
    if (errorLines.has(row.line)) continue;
    const coerced = coerceImportValues(row.values);
    const existing = skuMap.get(row.sku);
    if (!row.present.includes("name") && mapping.name != null && !existing) {
      issues.push({ line: row.line, sku: row.sku, level: "error", message: "Product name is required for new SKUs" });
      errorLines.add(row.line);
      continue;
    }
    if (!existing && !coerced.name) {
      issues.push({ line: row.line, sku: row.sku, level: "error", message: "Product name is required for new SKUs" });
      errorLines.add(row.line);
      continue;
    }
    if (coerced.brand) {
      const matchId = matchTaxonomyName(coerced.brand, brands);
      if (!matchId && !brandActions.has(coerced.brand.toLowerCase())) {
        brandActions.set(coerced.brand.toLowerCase(), {
          name: coerced.brand,
          matchId: null,
          action: "create",
        });
      }
    } else if (!existing && mapping.brand != null) {
      issues.push({ line: row.line, sku: row.sku, level: "error", message: "Brand is required for new SKUs" });
      errorLines.add(row.line);
      continue;
    }
    if (coerced.category) {
      const matchId = matchTaxonomyName(coerced.category, categories);
      if (!matchId && !categoryActions.has(coerced.category.toLowerCase())) {
        categoryActions.set(coerced.category.toLowerCase(), {
          name: coerced.category,
          matchId: null,
          action: "create",
        });
      }
    }
    if (coerced.subcategory) {
      const matchId = matchTaxonomyName(coerced.subcategory, categories);
      if (!matchId && !categoryActions.has(coerced.subcategory.toLowerCase())) {
        categoryActions.set(coerced.subcategory.toLowerCase(), {
          name: coerced.subcategory,
          matchId: null,
          action: "create",
        });
      }
    }
    if (existing) {
      updateCount += 1;
      const fields: JobPreview["changes"][number]["fields"] = [];
      if (coerced.name && coerced.name !== existing.product.name) {
        fields.push({ field: "Name", from: existing.product.name, to: coerced.name });
      }
      if (coerced.brand && coerced.brand.toLowerCase() !== existing.product.brand.name.toLowerCase()) {
        fields.push({ field: "Brand", from: existing.product.brand.name, to: coerced.brand });
      }
      if (coerced.trade != null && coerced.trade !== Number(existing.tradePrice ?? 0)) {
        fields.push({ field: "Trade price", from: String(existing.tradePrice ?? ""), to: String(coerced.trade) });
      }
      if (coerced.rrp != null && coerced.rrp !== Number(existing.rrp ?? 0)) {
        fields.push({ field: "RRP", from: String(existing.rrp ?? ""), to: String(coerced.rrp) });
      }
      if (coerced.status && coerced.status !== existing.product.status) {
        fields.push({ field: "Status", from: existing.product.status, to: coerced.status });
        if (coerced.status === "INACTIVE" || coerced.status === "DISCONTINUED") deactivateCount += 1;
      }
      changes.push({ sku: row.sku, kind: "update", fields });
    } else {
      newCount += 1;
      changes.push({ sku: row.sku, kind: "new", fields: [] });
    }
  }

  const next: JobPreview = {
    ...preview,
    issues,
    changes,
    summary: {
      newCount,
      updateCount,
      invalidCount: issues.filter((i) => i.level === "error").length,
      duplicateSkuCount: issues.filter((i) => i.message.includes("Duplicate SKU")).length,
      deactivateCount,
      newBrandCount: [...brandActions.values()].filter((b) => b.action === "create").length,
      newCategoryCount: [...categoryActions.values()].filter((c) => c.action === "create").length,
    },
  };

  const updated = await prisma.productImportJob.update({
    where: { id: job.id },
    data: {
      status: "READY",
      errorCount: next.summary.invalidCount,
      warningCount: issues.filter((i) => i.level === "warning").length,
      unknownBrands: [...brandActions.values()] as unknown as Prisma.InputJsonValue,
      unknownCategories: [...categoryActions.values()] as unknown as Prisma.InputJsonValue,
      preview: next as unknown as Prisma.InputJsonValue,
    },
  });
  return serializeJob(updated);
}

async function resolveBrandId(
  tx: Prisma.TransactionClient,
  name: string | undefined,
  actions: TaxonomyResolution[],
  cache: Map<string, string>,
) {
  if (!name) return null;
  const key = name.toLowerCase();
  if (cache.has(key)) return cache.get(key)!;
  const existing = await tx.brand.findFirst({
    where: { OR: [{ name: { equals: name, mode: "insensitive" } }, { slug: slugifyCatalogue(name) }] },
  });
  if (existing) {
    cache.set(key, existing.id);
    return existing.id;
  }
  const action = actions.find((a) => a.name.toLowerCase() === key);
  if (action?.action === "map" && action.mapToId) {
    cache.set(key, action.mapToId);
    return action.mapToId;
  }
  if (action && action.action !== "create") {
    throw new AuthError(`Brand ${name} is not mapped`, "VALIDATION", 400);
  }
  const created = await tx.brand.create({
    data: { name, slug: await uniqueSlug(tx, "brand", name), isActive: true, sortOrder: 99 },
  });
  cache.set(key, created.id);
  return created.id;
}

async function resolveCategoryId(
  tx: Prisma.TransactionClient,
  categoryName: string | undefined,
  subcategoryName: string | undefined,
  actions: TaxonomyResolution[],
  cache: Map<string, string>,
) {
  async function ensure(name: string, parentId: string | null) {
    const key = `${parentId ?? "root"}:${name.toLowerCase()}`;
    if (cache.has(key)) return cache.get(key)!;
    const existing = await tx.category.findFirst({
      where: { name: { equals: name, mode: "insensitive" }, parentId },
    });
    if (existing) {
      cache.set(key, existing.id);
      return existing.id;
    }
    const action = actions.find((a) => a.name.toLowerCase() === name.toLowerCase());
    if (action?.action === "map" && action.mapToId) {
      cache.set(key, action.mapToId);
      return action.mapToId;
    }
    const created = await tx.category.create({
      data: {
        name,
        slug: await uniqueSlug(tx, "category", name),
        parentId,
        isActive: true,
        sortOrder: 99,
      },
    });
    cache.set(key, created.id);
    return created.id;
  }
  if (!categoryName && !subcategoryName) return null;
  const parentId = categoryName ? await ensure(categoryName, null) : null;
  if (subcategoryName) return ensure(subcategoryName, parentId);
  return parentId;
}

export async function confirmImport(actorUserId: string, id: string) {
  await requireSystemPermission(actorUserId, "products.import");
  const job = await prisma.productImportJob.findUnique({ where: { id } });
  if (!job) throw new AuthError("Import not found", "NOT_FOUND", 404);
  if (job.status === "APPLIED") return serializeJob(job);
  const preview = asPreview(job.preview);
  if (!preview) throw new AuthError("Import file is no longer available", "VALIDATION", 400);
  const mapping = job.mapping as ColumnMapping;
  if (mapping.sku == null) throw new AuthError("Map a SKU column before importing", "VALIDATION", 400);

  const errorLines = new Set(preview.issues.filter((i) => i.level === "error").map((i) => i.line));
  const brandActions = (Array.isArray(job.unknownBrands) ? job.unknownBrands : []) as TaxonomyResolution[];
  const categoryActions = (Array.isArray(job.unknownCategories) ? job.unknownCategories : []) as TaxonomyResolution[];

  let created = 0;
  let updated = 0;
  let skipped = 0;
  let failed = 0;
  const failures: Array<{ line: number; sku?: string; message: string }> = [];

  const brandCache = new Map<string, string>();
  const categoryCache = new Map<string, string>();

  for (const row of preview.rows) {
    if (errorLines.has(row.line)) {
      skipped += 1;
      continue;
    }
    const values = coerceImportValues(row.values);
    const present = new Set(row.present);
    try {
      await prisma.$transaction(async (tx) => {
        const existing = await tx.productVariant.findUnique({
          where: { sku: values.sku },
          include: { product: true },
        });
        let brandId = existing?.product.brandId ?? null;
        if (present.has("brand") && values.brand) {
          brandId = await resolveBrandId(tx, values.brand, brandActions, brandCache);
        }
        if (!existing && !brandId) throw new Error("Brand is required");
        let categoryId = existing?.product.categoryId ?? null;
        if (present.has("category") || present.has("subcategory")) {
          categoryId = await resolveCategoryId(
            tx,
            present.has("category") ? values.category : undefined,
            present.has("subcategory") ? values.subcategory : undefined,
            categoryActions,
            categoryCache,
          );
        }
        const status = values.status;
        const isActive = status ? status === "ACTIVE" : existing?.product.isActive ?? true;
        if (!existing) {
          if (!values.name || !brandId) throw new Error("SKU and product name are required");
          const product = await tx.product.create({
            data: {
              name: values.name,
              slug: await uniqueSlug(tx, "product", `${values.brand ?? ""} ${values.name}`),
              brandId,
              categoryId,
              description: present.has("description") ? values.description ?? null : null,
              shortDescription: present.has("shortDescription") ? values.shortDescription ?? null : null,
              status: status ?? "ACTIVE",
              isActive,
              isTradeVisible: values.isTradeVisible ?? true,
              isFeatured: values.isFeatured ?? false,
              isNew: values.isNew ?? false,
              metaTitle: present.has("metaTitle") ? values.metaTitle ?? null : null,
              metaDescription: present.has("metaDescription") ? values.metaDescription ?? null : null,
            },
          });
          const variant = await tx.productVariant.create({
            data: {
              productId: product.id,
              sku: values.sku,
              barcode: values.ean ?? null,
              mpn: values.mpn ?? null,
              externalRef: values.externalRef ?? null,
              packQty: values.packQty ?? 1,
              caseQty: values.caseQty ?? null,
              minOrderQty: values.minimumOrderQty ?? 1,
              orderIncrement: values.orderIncrement ?? 1,
              unit: values.unit ?? "EA",
              weightKg: values.weightKg ?? null,
              lengthMm: values.lengthMm ?? null,
              widthMm: values.widthMm ?? null,
              heightMm: values.heightMm ?? null,
              tradePrice: values.trade ?? null,
              rrp: values.rrp ?? null,
              vatCode: values.vat ?? "STANDARD",
              isDefault: true,
              isActive: true,
            },
          });
          if (values.trade != null) {
            await tx.quantityBreak.create({
              data: { variantId: variant.id, minQty: 1, unitPrice: values.trade },
            });
          }
          if (values.primaryImage) {
            const media = await tx.cmsMedia.findUnique({ where: { id: values.primaryImage } });
            if (media) {
              await tx.productMedia.create({
                data: {
                  productId: product.id,
                  mediaId: media.id,
                  isPrimary: true,
                  sortOrder: 0,
                },
              });
            }
          }
          created += 1;
        } else {
          await tx.product.update({
            where: { id: existing.productId },
            data: {
              ...(present.has("name") && values.name ? { name: values.name } : {}),
              ...(brandId && present.has("brand") ? { brandId } : {}),
              ...(present.has("category") || present.has("subcategory") ? { categoryId } : {}),
              ...(present.has("description") ? { description: values.description ?? null } : {}),
              ...(present.has("shortDescription") ? { shortDescription: values.shortDescription ?? null } : {}),
              ...(status
                ? { status, isActive }
                : present.has("active") && values.status
                  ? { status: values.status, isActive }
                  : {}),
              ...(present.has("tradeVisible") && values.isTradeVisible !== undefined
                ? { isTradeVisible: values.isTradeVisible }
                : {}),
              ...(present.has("featured") && values.isFeatured !== undefined ? { isFeatured: values.isFeatured } : {}),
              ...(present.has("newProduct") && values.isNew !== undefined ? { isNew: values.isNew } : {}),
              ...(present.has("slug") && values.slug
                ? { slug: await uniqueSlug(tx, "product", values.slug, existing.productId) }
                : {}),
              ...(present.has("metaTitle") ? { metaTitle: values.metaTitle ?? null } : {}),
              ...(present.has("metaDescription") ? { metaDescription: values.metaDescription ?? null } : {}),
            },
          });
          await tx.productVariant.update({
            where: { id: existing.id },
            data: {
              ...(present.has("ean") ? { barcode: values.ean ?? null } : {}),
              ...(present.has("mpn") ? { mpn: values.mpn ?? null } : {}),
              ...(present.has("externalRef") ? { externalRef: values.externalRef ?? null } : {}),
              ...(present.has("packQty") && values.packQty ? { packQty: values.packQty } : {}),
              ...(present.has("caseQty") ? { caseQty: values.caseQty ?? null } : {}),
              ...(present.has("minimumOrderQty") && values.minimumOrderQty
                ? { minOrderQty: values.minimumOrderQty }
                : {}),
              ...(present.has("orderIncrement") && values.orderIncrement
                ? { orderIncrement: values.orderIncrement }
                : {}),
              ...(present.has("unit") && values.unit ? { unit: values.unit } : {}),
              ...(present.has("weight") ? { weightKg: values.weightKg ?? null } : {}),
              ...(present.has("length") ? { lengthMm: values.lengthMm ?? null } : {}),
              ...(present.has("width") ? { widthMm: values.widthMm ?? null } : {}),
              ...(present.has("height") ? { heightMm: values.heightMm ?? null } : {}),
              ...(present.has("trade") && values.trade != null ? { tradePrice: values.trade } : {}),
              ...(present.has("rrp") && values.rrp != null ? { rrp: values.rrp } : {}),
              ...(present.has("vat") && values.vat ? { vatCode: values.vat } : {}),
            },
          });
          if (present.has("trade") && values.trade != null) {
            await tx.quantityBreak.upsert({
              where: { variantId_minQty: { variantId: existing.id, minQty: 1 } },
              create: { variantId: existing.id, minQty: 1, unitPrice: values.trade },
              update: { unitPrice: values.trade },
            });
          }
          if (present.has("primaryImage") && values.primaryImage) {
            const media = await tx.cmsMedia.findUnique({ where: { id: values.primaryImage } });
            if (media) {
              await tx.productMedia.deleteMany({ where: { productId: existing.productId, isPrimary: true } });
              await tx.productMedia.upsert({
                where: {
                  productId_mediaId: { productId: existing.productId, mediaId: media.id },
                },
                create: {
                  productId: existing.productId,
                  mediaId: media.id,
                  isPrimary: true,
                  sortOrder: 0,
                },
                update: { isPrimary: true },
              });
            }
          }
          updated += 1;
        }
      });
    } catch (error) {
      failed += 1;
      failures.push({
        line: row.line,
        sku: row.sku,
        message: error instanceof Error ? error.message : "Import failed",
      });
    }
  }

  const errorReport = [
    "line,sku,message",
    ...failures.map((f) => `${f.line},${f.sku ?? ""},"${(f.message ?? "").replaceAll('"', '""')}"`),
  ].join("\n");

  const applied = await prisma.productImportJob.update({
    where: { id: job.id },
    data: {
      status: failed && !created && !updated ? "FAILED" : "APPLIED",
      createdCount: created,
      updatedCount: updated,
      skippedCount: skipped,
      errorCount: failed + preview.issues.filter((i) => i.level === "error").length,
      appliedAt: new Date(),
      result: { created, updated, skipped, failed, failures } as Prisma.InputJsonValue,
      errorReport,
      preview: {
        ...preview,
        csv: undefined,
      } as unknown as Prisma.InputJsonValue,
    },
  });

  await recordAuditEvent({
    action: "catalogue.products_imported",
    entityType: "ProductImportJob",
    entityId: job.id,
    actorUserId,
    metadata: { created, updated, skipped, failed, filename: job.filename },
  });
  return serializeJob(applied);
}

function serializeJob(job: {
  id: string;
  filename: string;
  uploadedById: string;
  status: string;
  rowCount: number;
  createdCount: number;
  updatedCount: number;
  skippedCount: number;
  errorCount: number;
  warningCount: number;
  mapping: Prisma.JsonValue;
  unknownBrands: Prisma.JsonValue | null;
  unknownCategories: Prisma.JsonValue | null;
  preview: Prisma.JsonValue | null;
  result: Prisma.JsonValue | null;
  errorReport: string | null;
  createdAt: Date;
  appliedAt: Date | null;
}) {
  const preview = asPreview(job.preview);
  return {
    id: job.id,
    filename: job.filename,
    uploadedById: job.uploadedById,
    status: job.status,
    rowCount: job.rowCount,
    createdCount: job.createdCount,
    updatedCount: job.updatedCount,
    skippedCount: job.skippedCount,
    errorCount: job.errorCount,
    warningCount: job.warningCount,
    mapping: job.mapping,
    unknownBrands: job.unknownBrands,
    unknownCategories: job.unknownCategories,
    summary: preview?.summary ?? null,
    issues: preview?.issues ?? [],
    changes: preview?.changes ?? [],
    headers: preview?.headers ?? [],
    result: job.result,
    hasErrorReport: Boolean(job.errorReport),
    createdAt: job.createdAt.toISOString(),
    appliedAt: job.appliedAt?.toISOString() ?? null,
  };
}

export async function getImportJob(actorUserId: string, id: string) {
  await requireSystemPermission(actorUserId, "products.import");
  const job = await prisma.productImportJob.findUnique({ where: { id } });
  if (!job) throw new AuthError("Import not found", "NOT_FOUND", 404);
  return serializeJob(job);
}

export async function listImportJobs(actorUserId: string) {
  await requireSystemPermission(actorUserId, "products.import");
  const rows = await prisma.productImportJob.findMany({
    orderBy: { createdAt: "desc" },
    take: 50,
    include: { uploadedBy: { select: { name: true, email: true } } },
  });
  return rows.map((row) => ({
    ...serializeJob(row),
    uploadedBy: row.uploadedBy.name || row.uploadedBy.email,
  }));
}

export async function importErrorCsv(actorUserId: string, id: string) {
  await requireSystemPermission(actorUserId, "products.import");
  const job = await prisma.productImportJob.findUnique({ where: { id } });
  if (!job) throw new AuthError("Import not found", "NOT_FOUND", 404);
  return job.errorReport || "line,sku,message\n";
}

export async function importProducts(actorUserId: string, csv: string) {
  const job = await uploadProductImport(actorUserId, { filename: "inline.csv", csv, mime: "text/csv" });
  await previewImport(actorUserId, job.id);
  return confirmImport(actorUserId, job.id);
}
