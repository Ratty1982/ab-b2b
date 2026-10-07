/**
 * Brand and dataset sales-history verification.
 * Does not write sales lines and does not change forecast demand maths.
 */
import { z } from "zod";
import { prisma } from "@/infra/database/client";
import { hasPermission } from "@/server/rbac/access";
import { AuthError, requirePurchasingAccess } from "@/server/rbac/guards";
import { recordAuditEvent } from "@/server/audit/record";
import { dateOnlyIsoFromDate } from "@/domain/sales-history-period";
import {
  classifySalesHistoryVerification,
  mergeCoverageIntervals,
  monthsWithNoRecordedSales,
  requiredForecastCoverageWindow,
  validateCoverageDates,
  type CoverageInterval,
  type SalesHistoryVerificationStatus,
} from "@/domain/sales-history-coverage";
import { todayLondonDateOnly } from "@/domain/sales-history-period";

function requirePurchasingManage(actorUserId: string) {
  return requirePurchasingAccess(actorUserId).then((profile) => {
    if (!hasPermission(profile, "purchasing.manage")) {
      throw new AuthError("purchasing.manage is required", "FORBIDDEN", 403);
    }
    return profile;
  });
}

type SaleFacts = {
  earliestSale: string | null;
  latestSale: string | null;
  lineCount: number;
  skuCount: number;
  months: string[];
};

async function brandBySlug(slug: string) {
  const brand = await prisma.brand.findUnique({ where: { slug }, select: { id: true, name: true, slug: true } });
  if (!brand) throw new AuthError("Brand not found", "NOT_FOUND", 404);
  return brand;
}

async function saleFacts(brandId: string | null): Promise<SaleFacts> {
  const brandFilter = brandId
    ? prisma.$queryRaw<Array<{ earliest: Date | null; latest: Date | null; lines: number; skus: number }>>`
        SELECT MIN(d."documentDate") AS earliest,
               MAX(d."documentDate") AS latest,
               COUNT(*)::int AS lines,
               COUNT(DISTINCT UPPER(l.sku))::int AS skus
        FROM "AutopartSalesLine" l
        INNER JOIN "AutopartSalesDocument" d ON d.id = l."documentId"
        INNER JOIN "ProductVariant" v ON UPPER(v.sku) = UPPER(l.sku)
        INNER JOIN "Product" p ON p.id = v."productId"
        WHERE d."documentDate" IS NOT NULL AND p."brandId" = ${brandId}
      `
    : prisma.$queryRaw<Array<{ earliest: Date | null; latest: Date | null; lines: number; skus: number }>>`
        SELECT MIN(d."documentDate") AS earliest,
               MAX(d."documentDate") AS latest,
               COUNT(*)::int AS lines,
               COUNT(DISTINCT UPPER(l.sku))::int AS skus
        FROM "AutopartSalesLine" l
        INNER JOIN "AutopartSalesDocument" d ON d.id = l."documentId"
        WHERE d."documentDate" IS NOT NULL
      `;
  const monthsQuery = brandId
    ? prisma.$queryRaw<Array<{ month: string }>>`
        SELECT DISTINCT to_char(d."documentDate", 'YYYY-MM') AS month
        FROM "AutopartSalesLine" l
        INNER JOIN "AutopartSalesDocument" d ON d.id = l."documentId"
        INNER JOIN "ProductVariant" v ON UPPER(v.sku) = UPPER(l.sku)
        INNER JOIN "Product" p ON p.id = v."productId"
        WHERE d."documentDate" IS NOT NULL AND p."brandId" = ${brandId}
        ORDER BY 1
      `
    : prisma.$queryRaw<Array<{ month: string }>>`
        SELECT DISTINCT to_char(d."documentDate", 'YYYY-MM') AS month
        FROM "AutopartSalesLine" l
        INNER JOIN "AutopartSalesDocument" d ON d.id = l."documentId"
        WHERE d."documentDate" IS NOT NULL
        ORDER BY 1
      `;
  const [totals, months] = await Promise.all([brandFilter, monthsQuery]);
  const row = totals[0];
  return {
    earliestSale: row?.earliest ? dateOnlyIsoFromDate(row.earliest) : null,
    latestSale: row?.latest ? dateOnlyIsoFromDate(row.latest) : null,
    lineCount: Number(row?.lines ?? 0),
    skuCount: Number(row?.skus ?? 0),
    months: months.map((item) => item.month),
  };
}

export type CoverageIndex = {
  all: CoverageInterval[];
  byBrandId: Map<string, CoverageInterval[]>;
  byBrandSlug: Map<string, CoverageInterval[]>;
};

export async function loadCoverageIndex(): Promise<CoverageIndex> {
  const rows = await prisma.salesHistoryCoverageVerification.findMany({
    select: {
      scope: true,
      brandId: true,
      coverageFrom: true,
      coverageTo: true,
      brand: { select: { slug: true } },
    },
  });
  const all: CoverageInterval[] = [];
  const byBrandId = new Map<string, CoverageInterval[]>();
  const byBrandSlug = new Map<string, CoverageInterval[]>();
  for (const row of rows) {
    const interval = { from: dateOnlyIsoFromDate(row.coverageFrom), to: dateOnlyIsoFromDate(row.coverageTo) };
    if (row.scope === "ALL") {
      all.push(interval);
      continue;
    }
    if (!row.brandId) continue;
    const list = byBrandId.get(row.brandId) ?? [];
    list.push(interval);
    byBrandId.set(row.brandId, list);
    if (row.brand?.slug) {
      const slugList = byBrandSlug.get(row.brand.slug) ?? [];
      slugList.push(interval);
      byBrandSlug.set(row.brand.slug, slugList);
    }
  }
  return { all, byBrandId, byBrandSlug };
}

export function verificationForBrandSlug(
  index: CoverageIndex,
  brandSlug: string,
  today = todayLondonDateOnly(),
): {
  status: SalesHistoryVerificationStatus;
  verifiedCoverageFrom: string | null;
  verifiedCoverageTo: string | null;
} {
  const ranges = mergeCoverageIntervals([...(index.byBrandSlug.get(brandSlug) ?? []), ...index.all]);
  const classified = classifySalesHistoryVerification(ranges, requiredForecastCoverageWindow(today));
  return {
    status: classified.status,
    verifiedCoverageFrom: classified.coveredFrom,
    verifiedCoverageTo: classified.coveredTo,
  };
}

const previewInput = z.object({
  scope: z.enum(["BRAND", "ALL"]),
  brandSlug: z.string().trim().min(1).optional().nullable(),
});

export async function previewSalesHistoryCoverage(actorUserId: string, raw: unknown) {
  const profile = await requirePurchasingAccess(actorUserId);
  const input = previewInput.parse(raw ?? {});
  const brand = input.scope === "BRAND" ? await brandBySlug(input.brandSlug ?? "") : null;
  const facts = await saleFacts(brand?.id ?? null);
  const stored = await prisma.salesHistoryCoverageVerification.findMany({
    where: brand ? { scope: "BRAND", brandId: brand.id } : { scope: "ALL" },
    orderBy: { verifiedAt: "desc" },
    take: 12,
    include: { verifiedBy: { select: { name: true, email: true } } },
  });
  const dataset = brand
    ? await prisma.salesHistoryCoverageVerification.findMany({
        where: { scope: "ALL" },
        orderBy: { verifiedAt: "desc" },
        take: 12,
        include: { verifiedBy: { select: { name: true, email: true } } },
      })
    : [];
  const effective = mergeCoverageIntervals(
    [...stored, ...dataset].map((row) => ({
      from: dateOnlyIsoFromDate(row.coverageFrom),
      to: dateOnlyIsoFromDate(row.coverageTo),
    })),
  );
  return {
    scope: input.scope,
    brandName: brand?.name ?? "All products",
    brandSlug: brand?.slug ?? null,
    earliestSale: facts.earliestSale,
    latestSale: facts.latestSale,
    lineCount: facts.lineCount,
    skuCount: facts.skuCount,
    monthsRepresented: facts.months.length,
    monthsWithNoRecordedSales:
      facts.earliestSale && facts.latestSale
        ? monthsWithNoRecordedSales(facts.months, facts.earliestSale, facts.latestSale)
        : [],
    quietMonthNote: "A month with no recorded sales is not necessarily a missing import.",
    effectiveCoverage: effective,
    history: [...stored, ...dataset].map((row) => ({
      id: row.id,
      coverageFrom: dateOnlyIsoFromDate(row.coverageFrom),
      coverageTo: dateOnlyIsoFromDate(row.coverageTo),
      verifiedAt: row.verifiedAt.toISOString(),
      verifiedBy: row.verifiedBy.name || row.verifiedBy.email,
      notes: row.notes,
    })),
    canManage: hasPermission(profile, "purchasing.manage"),
  };
}

const verifyInput = z.object({
  scope: z.enum(["BRAND", "ALL"]),
  brandSlug: z.string().trim().min(1).optional().nullable(),
  coverageFrom: z.string(),
  coverageTo: z.string(),
  confirmed: z.boolean(),
  notes: z.string().trim().max(2000).optional().nullable(),
});

export async function verifySalesHistoryCoverage(actorUserId: string, raw: unknown) {
  await requirePurchasingManage(actorUserId);
  const input = verifyInput.parse(raw);
  if (input.confirmed !== true) {
    throw new AuthError(
      "Confirm that the available sales history for this scope and period has been imported and reviewed.",
      "VALIDATION",
      400,
    );
  }
  if (input.scope === "BRAND" && !input.brandSlug?.trim()) {
    throw new AuthError("Choose a brand to verify.", "VALIDATION", 400);
  }
  const brand = input.scope === "BRAND" ? await brandBySlug(input.brandSlug ?? "") : null;
  const facts = await saleFacts(brand?.id ?? null);
  const valid = validateCoverageDates({
    from: input.coverageFrom,
    to: input.coverageTo,
    earliestSale: facts.earliestSale,
    latestSale: facts.latestSale,
  });
  if (!valid.ok) throw new AuthError(valid.message, "VALIDATION", 400);
  const saved = await prisma.salesHistoryCoverageVerification.create({
    data: {
      scope: input.scope,
      brandId: brand?.id ?? null,
      coverageFrom: new Date(`${input.coverageFrom}T00:00:00.000Z`),
      coverageTo: new Date(`${input.coverageTo}T00:00:00.000Z`),
      verifiedById: actorUserId,
      notes: input.notes?.trim() || null,
    },
  });
  await recordAuditEvent({
    action: "purchasing.sales_history.verify",
    entityType: "SalesHistoryCoverageVerification",
    entityId: saved.id,
    actorUserId,
    metadata: {
      scope: input.scope,
      brandSlug: brand?.slug ?? null,
      brandName: brand?.name ?? null,
      coverageFrom: input.coverageFrom,
      coverageTo: input.coverageTo,
      notes: input.notes?.trim() || null,
    },
  });
  return previewSalesHistoryCoverage(actorUserId, { scope: input.scope, brandSlug: brand?.slug ?? null });
}

export async function listSalesHistoryBrands(actorUserId: string) {
  await requirePurchasingAccess(actorUserId);
  return prisma.brand.findMany({
    where: { isActive: true },
    select: { slug: true, name: true },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  });
}
