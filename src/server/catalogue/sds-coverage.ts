/**
 * SDS coverage workspace — product-level counts, filtered table, CSV, requirement mutations.
 * Reuses ProductDocument. Does not query documents per product (no N+1).
 */
import { Prisma, type ProductSdsRequirement } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/infra/database/client";
import { recordAuditEvent } from "@/server/audit/record";
import { AuthError } from "@/server/rbac/guards";
import {
  requireDocumentsManage,
  requireDocumentsView,
} from "@/server/catalogue/product-documents";
import { formatDate } from "@/lib/datetime";
import {
  classifySdsCoverage,
  finaliseSdsCoverageCounts,
  SDS_COVERAGE_POPULATIONS,
  SDS_COVERAGE_STATUS_LABEL,
  SDS_COVERAGE_STATUSES,
  SDS_NOT_REQUIRED_MAX_SELECTION,
  SDS_NOT_REQUIRED_REASON_MAX,
  sdsDocumentMetaLabel,
  toUtf8Csv,
  type SdsCoveragePopulation,
  type SdsCoverageStatus,
} from "@/domain/sds-coverage";

const SDS = "SAFETY_DATA_SHEET" as const;

export const ACTIVE_B2B_CATALOGUE_WHERE: Prisma.ProductWhereInput = {
  status: "ACTIVE",
  isActive: true,
  isTradeVisible: true,
};

function populationWhere(population: SdsCoveragePopulation): Prisma.ProductWhereInput {
  if (population === "inactive") {
    return {
      OR: [{ status: { not: "ACTIVE" } }, { isActive: false }, { isTradeVisible: false }],
    };
  }
  if (population === "all") return {};
  return ACTIVE_B2B_CATALOGUE_WHERE;
}

function populationSql(population: SdsCoveragePopulation): Prisma.Sql {
  if (population === "inactive") {
    return Prisma.sql`(p.status <> 'ACTIVE' OR p."isActive" = false OR p."isTradeVisible" = false)`;
  }
  if (population === "all") return Prisma.sql`TRUE`;
  return Prisma.sql`(p.status = 'ACTIVE' AND p."isActive" = true AND p."isTradeVisible" = true)`;
}

function coverageStatusWhere(status: SdsCoverageStatus | "ALL"): Prisma.ProductWhereInput {
  if (status === "CURRENT") {
    return {
      sdsRequirement: "REQUIRED",
      productDocuments: { some: { type: SDS, status: "CURRENT" } },
    };
  }
  if (status === "MISSING") {
    return {
      sdsRequirement: "REQUIRED",
      productDocuments: { none: { type: SDS } },
    };
  }
  if (status === "ARCHIVED_ONLY") {
    return {
      AND: [
        { sdsRequirement: "REQUIRED" },
        { productDocuments: { none: { type: SDS, status: "CURRENT" } } },
        { productDocuments: { some: { type: SDS, status: "ARCHIVED" } } },
      ],
    };
  }
  if (status === "NOT_REQUIRED") {
    return { sdsRequirement: "NOT_REQUIRED" };
  }
  return {};
}

const listQuerySchema = z.object({
  population: z.enum(SDS_COVERAGE_POPULATIONS).optional().default("active"),
  status: z.enum(["ALL", ...SDS_COVERAGE_STATUSES]).optional().default("ALL"),
  brandId: z.string().min(1).optional().nullable(),
  q: z.string().trim().max(120).optional().nullable(),
  page: z.coerce.number().int().min(1).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).optional().default(25),
});

function searchWhere(q: string | null | undefined): Prisma.ProductWhereInput {
  const needle = q?.trim();
  if (!needle) return {};
  return {
    OR: [
      { name: { contains: needle, mode: "insensitive" } },
      { variants: { some: { sku: { contains: needle, mode: "insensitive" } } } },
      { variants: { some: { mpn: { contains: needle, mode: "insensitive" } } } },
      { variants: { some: { barcode: { contains: needle, mode: "insensitive" } } } },
    ],
  };
}

function listWhere(input: z.infer<typeof listQuerySchema>): Prisma.ProductWhereInput {
  return {
    AND: [
      populationWhere(input.population),
      coverageStatusWhere(input.status),
      input.brandId ? { brandId: input.brandId } : {},
      searchWhere(input.q),
    ],
  };
}

type SummaryRow = {
  active_products: number;
  current_sds: number;
  archived_only: number;
  not_required: number;
};

export async function getSdsCoverageSummary(
  actorUserId: string,
  raw?: { population?: SdsCoveragePopulation },
) {
  await requireDocumentsView(actorUserId);
  const population = raw?.population ?? "active";
  const [row] = await prisma.$queryRaw<SummaryRow[]>`
    SELECT
      COUNT(*)::int AS active_products,
      COUNT(*) FILTER (
        WHERE p."sdsRequirement" = 'REQUIRED'
          AND EXISTS (
            SELECT 1 FROM "ProductDocument" d
            WHERE d."productId" = p.id
              AND d.type = 'SAFETY_DATA_SHEET'
              AND d.status = 'CURRENT'
          )
      )::int AS current_sds,
      COUNT(*) FILTER (
        WHERE p."sdsRequirement" = 'REQUIRED'
          AND NOT EXISTS (
            SELECT 1 FROM "ProductDocument" d
            WHERE d."productId" = p.id
              AND d.type = 'SAFETY_DATA_SHEET'
              AND d.status = 'CURRENT'
          )
          AND EXISTS (
            SELECT 1 FROM "ProductDocument" d
            WHERE d."productId" = p.id
              AND d.type = 'SAFETY_DATA_SHEET'
              AND d.status = 'ARCHIVED'
          )
      )::int AS archived_only,
      COUNT(*) FILTER (WHERE p."sdsRequirement" = 'NOT_REQUIRED')::int AS not_required
    FROM "Product" p
    WHERE ${populationSql(population)}
  `;
  const counts = finaliseSdsCoverageCounts({
    activeProducts: row?.active_products ?? 0,
    currentSds: row?.current_sds ?? 0,
    archivedOnly: row?.archived_only ?? 0,
    notRequired: row?.not_required ?? 0,
  });
  return {
    ...counts,
    population,
    formula: "(Current SDS + Not Required) / Active Products × 100",
    populationLabel:
      population === "inactive"
        ? "Inactive, draft, discontinued, or not trade-visible products"
        : population === "all"
          ? "All catalogue products"
          : "Active B2B catalogue (ACTIVE, trade-visible)",
  };
}

function skuSummary(variants: Array<{ sku: string; isDefault: boolean; createdAt: Date }>): string {
  const ordered = [...variants].sort((a, b) => {
    if (a.isDefault !== b.isDefault) return a.isDefault ? -1 : 1;
    return a.createdAt.getTime() - b.createdAt.getTime();
  });
  const primary = ordered[0]?.sku ?? "";
  if (ordered.length > 1) return `${primary} +${ordered.length - 1}`;
  return primary;
}

function mapCoverageRow(row: {
  id: string;
  name: string;
  sdsRequirement: ProductSdsRequirement;
  sdsNotRequiredReason: string | null;
  sdsRequirementUpdatedAt: Date | null;
  updatedAt: Date;
  brand: { name: string };
  variants: Array<{ sku: string; mpn: string | null; isDefault: boolean; createdAt: Date }>;
  productDocuments: Array<{
    status: string;
    originalFilename: string;
    revision: string | null;
    documentDate: Date | null;
    createdAt: Date;
    updatedAt: Date;
  }>;
}) {
  const current = row.productDocuments.find((d) => d.status === "CURRENT") ?? null;
  const archived = row.productDocuments.some((d) => d.status === "ARCHIVED");
  const status = classifySdsCoverage({
    sdsRequirement: row.sdsRequirement,
    hasCurrentSds: Boolean(current),
    hasArchivedSds: archived,
  });
  const defaultVariant =
    row.variants.find((v) => v.isDefault) ??
    [...row.variants].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())[0];
  const currentMeta = current
    ? sdsDocumentMetaLabel({
        filename: current.originalFilename,
        revision: current.revision,
        documentDateLabel: current.documentDate ? formatDate(current.documentDate) : null,
        uploadedLabel: formatDate(current.createdAt) ?? "",
      })
    : null;
  const updatedAt =
    current?.updatedAt ?? row.sdsRequirementUpdatedAt ?? row.updatedAt;
  return {
    productId: row.id,
    name: row.name,
    brand: row.brand.name,
    sku: skuSummary(row.variants),
    primarySku: defaultVariant?.sku ?? "",
    mpn: defaultVariant?.mpn ?? null,
    sdsStatus: status,
    sdsStatusLabel: SDS_COVERAGE_STATUS_LABEL[status],
    currentSdsFilename: currentMeta?.filename ?? null,
    currentSdsDetail: currentMeta?.detail ?? null,
    notRequiredReason: status === "NOT_REQUIRED" ? row.sdsNotRequiredReason : null,
    updatedAt: updatedAt.toISOString(),
  };
}

const coverageInclude = {
  brand: { select: { name: true } },
  variants: {
    orderBy: [{ isDefault: "desc" as const }, { createdAt: "asc" as const }],
    select: { sku: true, mpn: true, isDefault: true, createdAt: true },
  },
  productDocuments: {
    where: { type: SDS },
    select: {
      status: true,
      originalFilename: true,
      revision: true,
      documentDate: true,
      createdAt: true,
      updatedAt: true,
    },
  },
} satisfies Prisma.ProductInclude;

export async function listSdsCoveragePage(actorUserId: string, raw: unknown) {
  await requireDocumentsView(actorUserId);
  const input = listQuerySchema.parse(raw ?? {});
  const where = listWhere(input);
  const skip = (input.page - 1) * input.pageSize;

  const [total, rows, summary] = await Promise.all([
    prisma.product.count({ where }),
    prisma.product.findMany({
      where,
      include: coverageInclude,
      orderBy: [{ name: "asc" }],
      skip,
      take: input.pageSize,
    }),
    getSdsCoverageSummary(actorUserId, { population: input.population }),
  ]);

  return {
    summary,
    items: rows.map(mapCoverageRow),
    total,
    page: input.page,
    pageSize: input.pageSize,
    pageCount: Math.max(1, Math.ceil(total / input.pageSize)),
    filters: {
      population: input.population,
      status: input.status,
      brandId: input.brandId ?? null,
      q: input.q ?? null,
    },
  };
}

export async function exportSdsCoverageCsv(actorUserId: string, raw: unknown) {
  await requireDocumentsView(actorUserId);
  const input = listQuerySchema
    .omit({ page: true, pageSize: true })
    .parse(raw ?? {});
  const where = listWhere({ ...input, page: 1, pageSize: 25 });
  const rows = await prisma.product.findMany({
    where,
    include: coverageInclude,
    orderBy: [{ name: "asc" }],
    take: 5000,
  });
  const items = rows.map(mapCoverageRow);
  const headers = [
    "Product",
    "Brand",
    "SKU",
    "MPN",
    "SDS Status",
    "Current SDS filename",
    "Uploaded / updated",
    "Not Required reason",
  ];
  const csv = toUtf8Csv(
    headers,
    items.map((item) => [
      item.name,
      item.brand,
      item.primarySku || item.sku,
      item.mpn,
      item.sdsStatusLabel,
      item.currentSdsFilename,
      item.updatedAt ? formatDate(item.updatedAt) : "",
      item.notRequiredReason,
    ]),
  );
  await recordAuditEvent({
    action: "catalogue.sds_coverage_exported",
    entityType: "Product",
    actorUserId,
    metadata: {
      rowCount: items.length,
      population: input.population,
      status: input.status,
      brandId: input.brandId ?? null,
      q: input.q ?? null,
    },
  });
  const day = new Date().toISOString().slice(0, 10);
  return {
    filename: `sds-coverage-${day}.csv`,
    mime: "text/csv;charset=utf-8",
    csv,
    rowCount: items.length,
  };
}

const requirementSchema = z.object({
  productIds: z.array(z.string().min(1)).min(1).max(SDS_NOT_REQUIRED_MAX_SELECTION),
  requirement: z.enum(["REQUIRED", "NOT_REQUIRED"]),
  reason: z.string().trim().max(SDS_NOT_REQUIRED_REASON_MAX).optional().nullable(),
  confirm: z.literal(true),
});

export async function setProductSdsRequirement(actorUserId: string, raw: unknown) {
  await requireDocumentsManage(actorUserId);
  const input = requirementSchema.parse(raw);
  const uniqueIds = [...new Set(input.productIds)];
  if (uniqueIds.length > SDS_NOT_REQUIRED_MAX_SELECTION) {
    throw new AuthError(
      `Select at most ${SDS_NOT_REQUIRED_MAX_SELECTION} products`,
      "VALIDATION",
      400,
    );
  }

  const products = await prisma.product.findMany({
    where: { id: { in: uniqueIds } },
    include: {
      productDocuments: {
        where: { type: SDS },
        select: { status: true },
      },
    },
  });
  if (products.length !== uniqueIds.length) {
    throw new AuthError("One or more products were not found", "NOT_FOUND", 404);
  }

  const now = new Date();
  const reason =
    input.requirement === "NOT_REQUIRED" ? input.reason?.trim() || null : null;

  await prisma.product.updateMany({
    where: { id: { in: uniqueIds } },
    data: {
      sdsRequirement: input.requirement,
      sdsNotRequiredReason: reason,
      sdsRequirementUpdatedAt: now,
      sdsRequirementUpdatedById: actorUserId,
    },
  });

  const results = products.map((product) => {
    const previousStatus = classifySdsCoverage({
      sdsRequirement: product.sdsRequirement,
      hasCurrentSds: product.productDocuments.some((d) => d.status === "CURRENT"),
      hasArchivedSds: product.productDocuments.some((d) => d.status === "ARCHIVED"),
    });
    const newStatus = classifySdsCoverage({
      sdsRequirement: input.requirement,
      hasCurrentSds: product.productDocuments.some((d) => d.status === "CURRENT"),
      hasArchivedSds: product.productDocuments.some((d) => d.status === "ARCHIVED"),
    });
    return {
      productId: product.id,
      previousStatus,
      newStatus,
      requirement: input.requirement,
    };
  });

  for (const row of results) {
    await recordAuditEvent({
      action:
        input.requirement === "NOT_REQUIRED"
          ? "catalogue.sds_marked_not_required"
          : "catalogue.sds_requirement_restored",
      entityType: "Product",
      entityId: row.productId,
      actorUserId,
      metadata: {
        productId: row.productId,
        previousStatus: row.previousStatus,
        newStatus: row.newStatus,
        reason: reason,
      },
    });
  }

  return { updated: results.length, items: results };
}
