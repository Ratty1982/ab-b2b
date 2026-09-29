/**
 * Internal Sales Intelligence — Sales Enquiry query layer.
 *
 * Provenance: AutopartSalesLine + AutopartSalesDocument only (561L / SLRB).
 * AB Orders and 504C are intentionally excluded from invoiced sales metrics.
 */
import { z } from "zod";
import { prisma } from "@/infra/database/client";
import { AuthError, requireSystemPermission } from "@/server/rbac/guards";
import { hasPermission, type LoadedAccessProfile } from "@/server/rbac/access";
import { getAccessibleCompanyIdsForSales } from "@/server/rbac/sales-access";
import {
  dateOnlyIsoFromDate,
  documentDatePrismaBounds,
  todayLondonDateOnly,
  type DateOnlyRange,
} from "@/domain/sales-history-period";
import {
  accumulateLine,
  buildCsv,
  compareSalesTotals,
  createLineAgg,
  emptySalesTotals,
  lineAggPurchaseCount,
  moneyMinorToDto,
  parseSalesNetMinor,
  resolveEnquiryComparisonPeriod,
  resolveEnquiryPrimaryPeriod,
  totalsToDto,
  type CustomerProductSort,
  type MutableLineAgg,
  type PeriodComparisonDto,
  type ProductCustomerSort,
  type SalesMoneyTotals,
  type SalesMoneyTotalsDto,
} from "@/domain/sales-intelligence";
import {
  PUBLIC_AVAILABILITY_LABEL,
  type PublicAvailability,
} from "@/domain/availability";
import { loadStockByVariantIds } from "@/server/stock/service";

const periodPresetSchema = z.enum([
  "THIS_MONTH",
  "LAST_MONTH",
  "LAST_30",
  "LAST_90",
  "LAST_180",
  "YTD",
  "LAST_YEAR",
  "CUSTOM",
]);

const periodInputSchema = z.object({
  period: periodPresetSchema.optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  compare: z.enum(["OFF", "PREVIOUS", "CUSTOM"]).optional().nullable(),
  compareFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  compareTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
});

type LineRow = {
  companyId: string;
  sku: string;
  units: { toString(): string } | number;
  salesNet: { toString(): string } | number;
  descriptionSnapshot: string | null;
  documentType: string;
  documentReference: string;
  document: { documentDate: Date | null } | null;
};

async function requireSalesIntelligence(actorUserId: string): Promise<LoadedAccessProfile> {
  const profile = await requireSystemPermission(actorUserId, "sales_intelligence.view");
  if (profile.actorType === "TRADE") {
    throw new AuthError("Sales Intelligence is internal only", "FORBIDDEN", 403);
  }
  return profile;
}

/**
 * Company scope for SI:
 * - sales.view_all / admin → all
 * - own/team sales → assigned
 * - sales_intelligence.view without sales scope (e.g. Accounts) → all
 */
export async function resolveSalesIntelligenceCompanyScope(
  profile: LoadedAccessProfile,
): Promise<string[] | "all"> {
  if (hasPermission(profile, "sales.view_all_accounts") || hasPermission(profile, "admin.access")) {
    return "all";
  }
  const scoped = await getAccessibleCompanyIdsForSales(profile);
  if (scoped === "all") return "all";
  if (scoped.length > 0) return scoped;
  if (hasPermission(profile, "sales_intelligence.view")) return "all";
  return [];
}

async function assertCompanyInScope(profile: LoadedAccessProfile, companyId: string) {
  const scope = await resolveSalesIntelligenceCompanyScope(profile);
  if (scope === "all") return;
  if (!scope.includes(companyId)) {
    throw new AuthError("No access to this company", "COMPANY_FORBIDDEN", 403);
  }
}

function lineCompanyFilter(scope: string[] | "all"): { companyId?: { in: string[] } } {
  if (scope === "all") return {};
  return { companyId: { in: scope.length ? scope : ["__none__"] } };
}

function resolvePeriods(raw: z.infer<typeof periodInputSchema>, today = todayLondonDateOnly()) {
  const primary = resolveEnquiryPrimaryPeriod({
    period: raw.period,
    from: raw.from,
    to: raw.to,
    today,
  });
  const comparison = resolveEnquiryComparisonPeriod({
    compare: raw.compare,
    primary,
    compareFrom: raw.compareFrom,
    compareTo: raw.compareTo,
  });
  return { primary, comparison };
}

async function loadLines(args: {
  companyId?: string | { in: string[] } | undefined;
  sku?: { equals: string; mode: "insensitive" } | undefined;
  range: DateOnlyRange;
}): Promise<LineRow[]> {
  const bounds = documentDatePrismaBounds(args.range);
  return prisma.autopartSalesLine.findMany({
    where: {
      ...(typeof args.companyId === "string"
        ? { companyId: args.companyId }
        : args.companyId
          ? { companyId: args.companyId }
          : {}),
      ...(args.sku ? { sku: args.sku } : {}),
      document: {
        is: {
          documentDate: { gte: bounds.gte, lte: bounds.lte },
        },
      },
    },
    select: {
      companyId: true,
      sku: true,
      units: true,
      salesNet: true,
      descriptionSnapshot: true,
      documentType: true,
      documentReference: true,
      document: { select: { documentDate: true } },
    },
  });
}

function summarizeLines(lines: LineRow[]): SalesMoneyTotals {
  const totals = emptySalesTotals();
  const invoiceRefs = new Set<string>();
  const skus = new Set<string>();
  const companies = new Set<string>();
  for (const line of lines) {
    const minor = parseSalesNetMinor(line.salesNet);
    totals.units += Number(line.units ?? 0);
    totals.netSalesMinor += minor;
    if (line.documentType === "INVOICE") {
      totals.invoiceSalesMinor += minor;
      invoiceRefs.add(`${line.companyId}:${line.documentReference}`);
    } else if (line.documentType === "CREDIT") {
      totals.creditsMinor += minor;
    }
    skus.add(line.sku.trim().toUpperCase());
    companies.add(line.companyId);
  }
  totals.purchaseTransactions = invoiceRefs.size;
  totals.productsPurchased = skus.size;
  totals.customers = companies.size;
  return totals;
}

/** Auditable customer net sales for a date range — rebate foundation. */
export async function getCustomerNetSales(
  actorUserId: string,
  companyId: string,
  from: string,
  to: string,
): Promise<SalesMoneyTotalsDto> {
  const profile = await requireSalesIntelligence(actorUserId);
  await assertCompanyInScope(profile, companyId);
  const lines = await loadLines({ companyId, range: { from, to } });
  return totalsToDto(summarizeLines(lines));
}

const searchSchema = z.object({
  q: z.string().max(200).optional(),
  limit: z.number().int().min(1).max(50).optional(),
});

export async function searchSalesIntelligenceCustomers(actorUserId: string, raw: unknown) {
  const profile = await requireSalesIntelligence(actorUserId);
  const input = searchSchema.parse(raw ?? {});
  const q = input.q?.trim() ?? "";
  if (q.length < 1) {
    return {
      items: [] as Array<{
        id: string;
        name: string;
        tradingName: string | null;
        accountNumber: string | null;
        autopartCustomerCode: string | null;
        paymentTerms: string | null;
        salesperson: { id: string; code: string | null; name: string } | null;
      }>,
    };
  }
  const scope = await resolveSalesIntelligenceCompanyScope(profile);
  const companyFilter =
    scope === "all" ? {} : { id: { in: scope.length ? scope : ["__none__"] } };

  const rows = await prisma.company.findMany({
    where: {
      ...companyFilter,
      OR: [
        { name: { contains: q, mode: "insensitive" } },
        { tradingName: { contains: q, mode: "insensitive" } },
        { accountNumber: { contains: q, mode: "insensitive" } },
        { autopartCustomerCode: { contains: q, mode: "insensitive" } },
        { addresses: { some: { postcode: { contains: q, mode: "insensitive" } } } },
      ],
    },
    select: {
      id: true,
      name: true,
      tradingName: true,
      accountNumber: true,
      autopartCustomerCode: true,
      paymentTerms: true,
      assignments: {
        take: 1,
        select: {
          salesRep: {
            select: {
              id: true,
              code: true,
              displayName: true,
              user: { select: { name: true, email: true } },
            },
          },
        },
      },
    },
    orderBy: { name: "asc" },
    take: input.limit ?? 20,
  });

  return {
    items: rows.map((r) => {
      const rep = r.assignments[0]?.salesRep;
      return {
        id: r.id,
        name: r.name,
        tradingName: r.tradingName,
        accountNumber: r.accountNumber,
        autopartCustomerCode: r.autopartCustomerCode,
        paymentTerms: r.paymentTerms,
        salesperson: rep
          ? {
              id: rep.id,
              code: rep.code,
              name: rep.displayName || rep.user.name || rep.user.email,
            }
          : null,
      };
    }),
  };
}

export async function searchSalesIntelligenceProducts(actorUserId: string, raw: unknown) {
  const profile = await requireSalesIntelligence(actorUserId);
  const input = searchSchema.parse(raw ?? {});
  const q = input.q?.trim() ?? "";
  type ProductSearchItem = {
    sku: string;
    name: string;
    brandName: string | null;
    categoryName: string | null;
    inCatalogue: boolean;
    variantId: string | null;
  };
  if (q.length < 1) return { items: [] as ProductSearchItem[] };
  const scope = await resolveSalesIntelligenceCompanyScope(profile);
  const limit = input.limit ?? 20;

  const variants = await prisma.productVariant.findMany({
    where: {
      OR: [
        { sku: { contains: q, mode: "insensitive" } },
        { product: { name: { contains: q, mode: "insensitive" } } },
        { product: { brand: { name: { contains: q, mode: "insensitive" } } } },
        { product: { category: { name: { contains: q, mode: "insensitive" } } } },
      ],
    },
    select: {
      id: true,
      sku: true,
      product: {
        select: {
          name: true,
          brand: { select: { name: true } },
          category: { select: { name: true } },
        },
      },
    },
    take: limit,
    orderBy: { sku: "asc" },
  });

  const seen = new Set(variants.map((v) => v.sku.trim().toUpperCase()));
  const items: ProductSearchItem[] = variants.map((v) => ({
    sku: v.sku,
    name: v.product.name,
    brandName: v.product.brand?.name ?? null,
    categoryName: v.product.category?.name ?? null,
    inCatalogue: true,
    variantId: v.id,
  }));

  const historic = await prisma.autopartSalesLine.findMany({
    where: {
      ...lineCompanyFilter(scope),
      OR: [
        { sku: { contains: q, mode: "insensitive" } },
        { descriptionSnapshot: { contains: q, mode: "insensitive" } },
      ],
    },
    select: { sku: true, descriptionSnapshot: true },
    distinct: ["sku"],
    take: limit * 3,
  });

  for (const h of historic) {
    const key = h.sku.trim().toUpperCase();
    if (seen.has(key)) continue;
    items.push({
      sku: h.sku.trim(),
      name: h.descriptionSnapshot?.trim() || h.sku.trim(),
      brandName: null,
      categoryName: null,
      inCatalogue: false,
      variantId: null,
    });
    seen.add(key);
    if (items.length >= limit) break;
  }

  return { items: items.slice(0, limit) };
}

function groupBySku(lines: LineRow[]): Map<string, { agg: MutableLineAgg; sku: string; desc: string | null }> {
  const map = new Map<string, { agg: MutableLineAgg; sku: string; desc: string | null }>();
  for (const line of lines) {
    const key = line.sku.trim().toUpperCase();
    let entry = map.get(key);
    if (!entry) {
      entry = {
        agg: createLineAgg(),
        sku: line.sku.trim(),
        desc: line.descriptionSnapshot?.trim() || null,
      };
      map.set(key, entry);
    }
    const dateIso = line.document?.documentDate
      ? dateOnlyIsoFromDate(line.document.documentDate)
      : null;
    accumulateLine(entry.agg, line, dateIso);
    if (!entry.desc && line.descriptionSnapshot?.trim()) {
      entry.desc = line.descriptionSnapshot.trim();
    }
  }
  return map;
}

function groupByCompany(lines: LineRow[]): Map<string, MutableLineAgg> {
  const map = new Map<string, MutableLineAgg>();
  for (const line of lines) {
    let agg = map.get(line.companyId);
    if (!agg) {
      agg = createLineAgg();
      map.set(line.companyId, agg);
    }
    const dateIso = line.document?.documentDate
      ? dateOnlyIsoFromDate(line.document.documentDate)
      : null;
    accumulateLine(agg, line, dateIso);
  }
  return map;
}

const customerEnquirySchema = periodInputSchema.extend({
  companyId: z.string().min(1),
  q: z.string().max(200).optional().nullable(),
  brandId: z.string().optional().nullable(),
  categoryId: z.string().optional().nullable(),
  sort: z.enum(["NET_SALES", "QTY", "PURCHASES", "RECENT", "NAME_AZ"]).optional(),
  page: z.number().int().min(1).max(10_000).optional(),
  pageSize: z.number().int().min(1).max(100).optional(),
  txSku: z.string().max(120).optional().nullable(),
  txPage: z.number().int().min(1).max(10_000).optional(),
  txPageSize: z.number().int().min(1).max(100).optional(),
});

export async function getCustomerSalesEnquiry(actorUserId: string, raw: unknown) {
  const profile = await requireSalesIntelligence(actorUserId);
  const input = customerEnquirySchema.parse(raw ?? {});
  await assertCompanyInScope(profile, input.companyId);
  const { primary, comparison: comparisonRange } = resolvePeriods(input);

  const company = await prisma.company.findUnique({
    where: { id: input.companyId },
    select: {
      id: true,
      name: true,
      tradingName: true,
      accountNumber: true,
      autopartCustomerCode: true,
      paymentTerms: true,
      assignments: {
        take: 1,
        select: {
          salesRep: {
            select: {
              id: true,
              code: true,
              displayName: true,
              user: { select: { name: true, email: true } },
            },
          },
        },
      },
    },
  });
  if (!company) throw new AuthError("Company not found", "NOT_FOUND", 404);

  const primaryLines = await loadLines({ companyId: input.companyId, range: primary });
  const primaryTotals = summarizeLines(primaryLines);

  let comparison: PeriodComparisonDto | null = null;
  if (comparisonRange) {
    const cmpLines = await loadLines({ companyId: input.companyId, range: comparisonRange });
    comparison = compareSalesTotals(
      primary,
      comparisonRange,
      primaryTotals,
      summarizeLines(cmpLines),
    );
  }

  const bySku = groupBySku(primaryLines);
  const skus = [...bySku.keys()];
  const variants = skus.length
    ? await prisma.productVariant.findMany({
        where: {
          OR: skus.map((sku) => ({ sku: { equals: sku, mode: "insensitive" as const } })),
        },
        select: {
          id: true,
          sku: true,
          product: {
            select: {
              name: true,
              brandId: true,
              categoryId: true,
              brand: { select: { id: true, name: true } },
              category: { select: { id: true, name: true } },
            },
          },
        },
      })
    : [];
  const variantBySku = new Map(variants.map((v) => [v.sku.trim().toUpperCase(), v]));
  const stockMap = await loadStockByVariantIds(variants.map((v) => v.id));

  type ProductRow = {
    sku: string;
    name: string;
    brandId: string | null;
    brandName: string | null;
    categoryId: string | null;
    categoryName: string | null;
    lastPurchasedDate: string | null;
    purchaseCount: number;
    units: number;
    invoiceSales: string;
    credits: string;
    netSales: string;
    netSalesMinor: bigint;
    availabilityBand: PublicAvailability | "historic";
    availabilityLabel: string;
    inCatalogue: boolean;
  };

  let products: ProductRow[] = [];
  const brandOptions = new Map<string, string>();
  const categoryOptions = new Map<string, string>();

  for (const [key, entry] of bySku) {
    const v = variantBySku.get(key);
    const product = v?.product;
    if (product?.brand) brandOptions.set(product.brand.id, product.brand.name);
    if (product?.category) categoryOptions.set(product.category.id, product.category.name);
    const stock = v ? stockMap.get(v.id) : undefined;
    const band = (stock?.availability ?? null) as PublicAvailability | null;
    const { agg } = entry;
    products.push({
      sku: v?.sku ?? entry.sku,
      name: product?.name ?? entry.desc ?? entry.sku,
      brandId: product?.brandId ?? null,
      brandName: product?.brand?.name ?? null,
      categoryId: product?.categoryId ?? null,
      categoryName: product?.category?.name ?? null,
      lastPurchasedDate: agg.lastPurchasedDate,
      purchaseCount: lineAggPurchaseCount(agg),
      units: agg.units,
      invoiceSales: moneyMinorToDto(agg.invoiceSalesMinor),
      credits: moneyMinorToDto(agg.creditsMinor),
      netSales: moneyMinorToDto(agg.netSalesMinor),
      netSalesMinor: agg.netSalesMinor,
      availabilityBand: product ? band ?? "in" : "historic",
      availabilityLabel: product
        ? band
          ? PUBLIC_AVAILABILITY_LABEL[band]
          : "Available to order"
        : "Historic Only",
      inCatalogue: Boolean(product),
    });
  }

  if (input.q?.trim()) {
    const qq = input.q.trim().toLowerCase();
    products = products.filter(
      (p) => p.sku.toLowerCase().includes(qq) || p.name.toLowerCase().includes(qq),
    );
  }
  if (input.brandId) products = products.filter((p) => p.brandId === input.brandId);
  if (input.categoryId) products = products.filter((p) => p.categoryId === input.categoryId);

  const sort = (input.sort ?? "NET_SALES") as CustomerProductSort;
  products.sort((a, b) => {
    switch (sort) {
      case "QTY":
        return b.units - a.units || a.sku.localeCompare(b.sku);
      case "PURCHASES":
        return b.purchaseCount - a.purchaseCount || a.sku.localeCompare(b.sku);
      case "RECENT": {
        if (a.lastPurchasedDate && b.lastPurchasedDate) {
          return b.lastPurchasedDate.localeCompare(a.lastPurchasedDate) || a.sku.localeCompare(b.sku);
        }
        if (a.lastPurchasedDate) return -1;
        if (b.lastPurchasedDate) return 1;
        return a.sku.localeCompare(b.sku);
      }
      case "NAME_AZ":
        return a.name.localeCompare(b.name, "en-GB") || a.sku.localeCompare(b.sku);
      case "NET_SALES":
      default:
        if (b.netSalesMinor !== a.netSalesMinor) {
          return b.netSalesMinor > a.netSalesMinor ? 1 : -1;
        }
        return a.sku.localeCompare(b.sku);
    }
  });

  const brandBreakdown = new Map<
    string,
    { key: string; label: string; products: number; units: number; netSalesMinor: bigint }
  >();
  const categoryBreakdown = new Map<
    string,
    { key: string; label: string; products: number; units: number; netSalesMinor: bigint }
  >();
  for (const p of products) {
    const bKey = p.brandId ?? "__none__";
    let b = brandBreakdown.get(bKey);
    if (!b) {
      b = {
        key: bKey,
        label: p.brandName ?? "Unassigned brand",
        products: 0,
        units: 0,
        netSalesMinor: 0n,
      };
      brandBreakdown.set(bKey, b);
    }
    b.products += 1;
    b.units += p.units;
    b.netSalesMinor += p.netSalesMinor;

    const cKey = p.categoryId ?? "__none__";
    let c = categoryBreakdown.get(cKey);
    if (!c) {
      c = {
        key: cKey,
        label: p.categoryName ?? "Unassigned category",
        products: 0,
        units: 0,
        netSalesMinor: 0n,
      };
      categoryBreakdown.set(cKey, c);
    }
    c.products += 1;
    c.units += p.units;
    c.netSalesMinor += p.netSalesMinor;
  }

  const page = input.page ?? 1;
  const pageSize = input.pageSize ?? 25;
  const total = products.length;
  const pageItems = products
    .slice((page - 1) * pageSize, page * pageSize)
    .map(({ netSalesMinor: _n, ...rest }) => rest);

  let transactions: {
    items: Array<{
      documentDate: string | null;
      documentReference: string;
      documentType: string;
      sku: string;
      description: string | null;
      units: number;
      netValue: string;
    }>;
    page: number;
    pageSize: number;
    total: number;
  } | null = null;

  if (input.txSku?.trim()) {
    const skuKey = input.txSku.trim().toUpperCase();
    const txLines = primaryLines
      .filter((l) => l.sku.trim().toUpperCase() === skuKey)
      .map((l) => ({
        documentDate: l.document?.documentDate
          ? dateOnlyIsoFromDate(l.document.documentDate)
          : null,
        documentReference: l.documentReference,
        documentType: l.documentType,
        sku: l.sku,
        description: l.descriptionSnapshot,
        units: Number(l.units ?? 0),
        netValue: moneyMinorToDto(parseSalesNetMinor(l.salesNet)),
        _sort: l.document?.documentDate?.getTime() ?? 0,
      }))
      .sort((a, b) => b._sort - a._sort || a.documentReference.localeCompare(b.documentReference));
    const txPage = input.txPage ?? 1;
    const txPageSize = input.txPageSize ?? 25;
    transactions = {
      items: txLines
        .slice((txPage - 1) * txPageSize, txPage * txPageSize)
        .map(({ _sort: _, ...r }) => r),
      page: txPage,
      pageSize: txPageSize,
      total: txLines.length,
    };
  }

  const rep = company.assignments[0]?.salesRep;

  return {
    dataSource:
      "Autopart historic sales (561L + SLRB). AB Orders and 504C are not included in these totals.",
    company: {
      id: company.id,
      name: company.name,
      tradingName: company.tradingName,
      accountNumber: company.accountNumber,
      autopartCustomerCode: company.autopartCustomerCode,
      paymentTerms: company.paymentTerms,
      salesperson: rep
        ? {
            id: rep.id,
            code: rep.code,
            name: rep.displayName || rep.user.name || rep.user.email,
          }
        : null,
    },
    period: primary,
    summary: totalsToDto(primaryTotals),
    comparison,
    products: { items: pageItems, page, pageSize, total },
    brandBreakdown: [...brandBreakdown.values()]
      .map((b) => ({
        key: b.key,
        label: b.label,
        products: b.products,
        units: b.units,
        netSales: moneyMinorToDto(b.netSalesMinor),
      }))
      .sort((a, b) => Number(b.netSales) - Number(a.netSales)),
    categoryBreakdown: [...categoryBreakdown.values()]
      .map((c) => ({
        key: c.key,
        label: c.label,
        products: c.products,
        units: c.units,
        netSales: moneyMinorToDto(c.netSalesMinor),
      }))
      .sort((a, b) => Number(b.netSales) - Number(a.netSales)),
    filterOptions: {
      brands: [...brandOptions.entries()]
        .map(([id, name]) => ({ id, name }))
        .sort((a, b) => a.name.localeCompare(b.name, "en-GB")),
      categories: [...categoryOptions.entries()]
        .map(([id, name]) => ({ id, name }))
        .sort((a, b) => a.name.localeCompare(b.name, "en-GB")),
    },
    transactions,
  };
}

const productEnquirySchema = periodInputSchema.extend({
  sku: z.string().min(1).max(120),
  q: z.string().max(200).optional().nullable(),
  salesRepId: z.string().optional().nullable(),
  sort: z.enum(["NET_SALES", "QTY", "PURCHASES", "RECENT", "NAME_AZ"]).optional(),
  page: z.number().int().min(1).max(10_000).optional(),
  pageSize: z.number().int().min(1).max(100).optional(),
  txCompanyId: z.string().optional().nullable(),
  txPage: z.number().int().min(1).max(10_000).optional(),
  txPageSize: z.number().int().min(1).max(100).optional(),
  includeCost: z.boolean().optional(),
});

export async function getProductSalesEnquiry(actorUserId: string, raw: unknown) {
  const profile = await requireSalesIntelligence(actorUserId);
  const input = productEnquirySchema.parse(raw ?? {});
  const scope = await resolveSalesIntelligenceCompanyScope(profile);
  const { primary, comparison: comparisonRange } = resolvePeriods(input);
  const skuFilter = { equals: input.sku.trim(), mode: "insensitive" as const };
  const companyFilter =
    scope === "all" ? null : ({ in: scope.length ? scope : ["__none__"] } as const);

  const primaryLines = await loadLines({
    ...(companyFilter ? { companyId: companyFilter } : {}),
    sku: skuFilter,
    range: primary,
  });
  const primaryTotals = summarizeLines(primaryLines);

  let comparison: PeriodComparisonDto | null = null;
  if (comparisonRange) {
    const cmpLines = await loadLines({
      ...(companyFilter ? { companyId: companyFilter } : {}),
      sku: skuFilter,
      range: comparisonRange,
    });
    comparison = compareSalesTotals(
      primary,
      comparisonRange,
      primaryTotals,
      summarizeLines(cmpLines),
    );
  }

  const variant = await prisma.productVariant.findFirst({
    where: { sku: skuFilter },
    select: {
      id: true,
      sku: true,
      product: {
        select: {
          name: true,
          brand: { select: { name: true } },
          category: { select: { name: true } },
        },
      },
    },
  });

  let latestAutopartCost: string | null | undefined;
  if (input.includeCost !== false && hasPermission(profile, "products.cost.view")) {
    const cost = await prisma.autopartProductCostPosition.findFirst({
      where: {
        OR: [
          { sku: { equals: input.sku.trim(), mode: "insensitive" } },
          ...(variant ? [{ productVariantId: variant.id }] : []),
        ],
      },
      select: { latestCost: true },
    });
    latestAutopartCost = cost ? String(cost.latestCost) : null;
  }

  const byCompany = groupByCompany(primaryLines);
  const companyIds = [...byCompany.keys()];
  const companies = companyIds.length
    ? await prisma.company.findMany({
        where: { id: { in: companyIds } },
        select: {
          id: true,
          name: true,
          autopartCustomerCode: true,
          accountNumber: true,
          assignments: {
            take: 1,
            select: {
              salesRep: {
                select: {
                  id: true,
                  code: true,
                  displayName: true,
                  user: { select: { name: true, email: true } },
                },
              },
            },
          },
        },
      })
    : [];
  const companyById = new Map(companies.map((c) => [c.id, c]));

  type CustomerRow = {
    companyId: string;
    name: string;
    account: string | null;
    salespersonId: string | null;
    salespersonName: string | null;
    lastPurchasedDate: string | null;
    purchaseCount: number;
    units: number;
    invoiceSales: string;
    credits: string;
    netSales: string;
    netSalesMinor: bigint;
  };

  let customers: CustomerRow[] = [];
  for (const [companyId, agg] of byCompany) {
    const c = companyById.get(companyId);
    const rep = c?.assignments[0]?.salesRep;
    customers.push({
      companyId,
      name: c?.name ?? "Unknown customer",
      account: c?.autopartCustomerCode ?? c?.accountNumber ?? null,
      salespersonId: rep?.id ?? null,
      salespersonName: rep ? rep.displayName || rep.user.name || rep.user.email : null,
      lastPurchasedDate: agg.lastPurchasedDate,
      purchaseCount: lineAggPurchaseCount(agg),
      units: agg.units,
      invoiceSales: moneyMinorToDto(agg.invoiceSalesMinor),
      credits: moneyMinorToDto(agg.creditsMinor),
      netSales: moneyMinorToDto(agg.netSalesMinor),
      netSalesMinor: agg.netSalesMinor,
    });
  }

  if (input.q?.trim()) {
    const qq = input.q.trim().toLowerCase();
    customers = customers.filter(
      (c) =>
        c.name.toLowerCase().includes(qq) || (c.account?.toLowerCase().includes(qq) ?? false),
    );
  }
  if (input.salesRepId) {
    customers = customers.filter((c) => c.salespersonId === input.salesRepId);
  }

  const sort = (input.sort ?? "NET_SALES") as ProductCustomerSort;
  customers.sort((a, b) => {
    switch (sort) {
      case "QTY":
        return b.units - a.units || a.name.localeCompare(b.name);
      case "PURCHASES":
        return b.purchaseCount - a.purchaseCount || a.name.localeCompare(b.name);
      case "RECENT": {
        if (a.lastPurchasedDate && b.lastPurchasedDate) {
          return (
            b.lastPurchasedDate.localeCompare(a.lastPurchasedDate) || a.name.localeCompare(b.name)
          );
        }
        if (a.lastPurchasedDate) return -1;
        if (b.lastPurchasedDate) return 1;
        return a.name.localeCompare(b.name);
      }
      case "NAME_AZ":
        return a.name.localeCompare(b.name, "en-GB");
      case "NET_SALES":
      default:
        if (b.netSalesMinor !== a.netSalesMinor) {
          return b.netSalesMinor > a.netSalesMinor ? 1 : -1;
        }
        return a.name.localeCompare(b.name);
    }
  });

  const page = input.page ?? 1;
  const pageSize = input.pageSize ?? 25;
  const total = customers.length;
  const pageItems = customers
    .slice((page - 1) * pageSize, page * pageSize)
    .map(({ netSalesMinor: _n, ...rest }) => rest);

  let transactions: {
    items: Array<{
      documentDate: string | null;
      companyId: string;
      customerName: string;
      account: string | null;
      documentReference: string;
      documentType: string;
      units: number;
      netValue: string;
    }>;
    page: number;
    pageSize: number;
    total: number;
  } | null = null;

  if (input.txCompanyId) {
    await assertCompanyInScope(profile, input.txCompanyId);
    const txLines = primaryLines
      .filter((l) => l.companyId === input.txCompanyId)
      .map((l) => {
        const c = companyById.get(l.companyId);
        return {
          documentDate: l.document?.documentDate
            ? dateOnlyIsoFromDate(l.document.documentDate)
            : null,
          companyId: l.companyId,
          customerName: c?.name ?? "Unknown",
          account: c?.autopartCustomerCode ?? c?.accountNumber ?? null,
          documentReference: l.documentReference,
          documentType: l.documentType,
          units: Number(l.units ?? 0),
          netValue: moneyMinorToDto(parseSalesNetMinor(l.salesNet)),
          _sort: l.document?.documentDate?.getTime() ?? 0,
        };
      })
      .sort((a, b) => b._sort - a._sort || a.documentReference.localeCompare(b.documentReference));
    const txPage = input.txPage ?? 1;
    const txPageSize = input.txPageSize ?? 25;
    transactions = {
      items: txLines
        .slice((txPage - 1) * txPageSize, txPage * txPageSize)
        .map(({ _sort: _, ...r }) => r),
      page: txPage,
      pageSize: txPageSize,
      total: txLines.length,
    };
  }

  const historicDesc =
    primaryLines.find((l) => l.descriptionSnapshot?.trim())?.descriptionSnapshot?.trim() ?? null;

  return {
    dataSource:
      "Autopart historic sales (561L + SLRB). AB Orders and 504C are not included in these totals.",
    product: {
      sku: variant?.sku ?? input.sku.trim(),
      name: variant?.product.name ?? historicDesc ?? input.sku.trim(),
      brandName: variant?.product.brand?.name ?? null,
      categoryName: variant?.product.category?.name ?? null,
      inCatalogue: Boolean(variant),
      latestAutopartCost,
    },
    period: primary,
    summary: totalsToDto(primaryTotals),
    comparison,
    customers: { items: pageItems, page, pageSize, total },
    transactions,
  };
}

async function collectAllCustomerProducts(actorUserId: string, input: z.infer<typeof customerEnquirySchema>) {
  const items: Awaited<ReturnType<typeof getCustomerSalesEnquiry>>["products"]["items"] = [];
  let page = 1;
  let total = Infinity;
  let meta: Awaited<ReturnType<typeof getCustomerSalesEnquiry>> | null = null;
  while (items.length < total && page < 200) {
    const next = await getCustomerSalesEnquiry(actorUserId, {
      ...input,
      page,
      pageSize: 100,
      txSku: null,
    });
    meta = next;
    total = next.products.total;
    items.push(...next.products.items);
    if (next.products.items.length === 0) break;
    page += 1;
  }
  return { meta: meta!, items };
}

export async function exportCustomerSalesEnquiryCsv(actorUserId: string, raw: unknown) {
  const input = customerEnquirySchema.parse(raw ?? {});
  const { primary } = resolvePeriods(input);
  const { meta, items } = await collectAllCustomerProducts(actorUserId, input);
  const headers = [
    "Period From",
    "Period To",
    "Customer",
    "Account",
    "SKU",
    "Product",
    "Brand",
    "Category",
    "Last Purchased",
    "Purchases",
    "Qty",
    "Invoice Sales",
    "Credits",
    "Net Sales",
  ];
  const rows = items.map((p) => [
    primary.from,
    primary.to,
    meta.company.name,
    meta.company.autopartCustomerCode ?? meta.company.accountNumber ?? "",
    p.sku,
    p.name,
    p.brandName ?? "",
    p.categoryName ?? "",
    p.lastPurchasedDate ?? "",
    p.purchaseCount,
    p.units,
    p.invoiceSales,
    p.credits,
    p.netSales,
  ]);
  return {
    filename: `sales-enquiry-customer-${meta.company.autopartCustomerCode ?? meta.company.id}-${primary.from}_${primary.to}.csv`,
    csv: buildCsv(headers, rows),
  };
}

export async function exportProductSalesEnquiryCsv(actorUserId: string, raw: unknown) {
  const input = productEnquirySchema.parse(raw ?? {});
  const { primary } = resolvePeriods(input);
  const allCustomers: Awaited<ReturnType<typeof getProductSalesEnquiry>>["customers"]["items"] =
    [];
  let page = 1;
  let total = Infinity;
  let productMeta: Awaited<ReturnType<typeof getProductSalesEnquiry>>["product"] | null = null;
  while (allCustomers.length < total && page < 200) {
    const next = await getProductSalesEnquiry(actorUserId, {
      ...input,
      page,
      pageSize: 100,
      txCompanyId: null,
    });
    productMeta = next.product;
    total = next.customers.total;
    allCustomers.push(...next.customers.items);
    if (next.customers.items.length === 0) break;
    page += 1;
  }

  const headers = [
    "Period From",
    "Period To",
    "SKU",
    "Product",
    "Customer",
    "Account",
    "Salesperson",
    "Last Purchased",
    "Purchases",
    "Qty",
    "Invoice Sales",
    "Credits",
    "Net Sales",
  ];
  const rows = allCustomers.map((c) => [
    primary.from,
    primary.to,
    productMeta?.sku ?? input.sku,
    productMeta?.name ?? "",
    c.name,
    c.account ?? "",
    c.salespersonName ?? "",
    c.lastPurchasedDate ?? "",
    c.purchaseCount,
    c.units,
    c.invoiceSales,
    c.credits,
    c.netSales,
  ]);
  return {
    filename: `sales-enquiry-product-${(productMeta?.sku ?? input.sku).replace(/[^\w.-]+/g, "_")}-${primary.from}_${primary.to}.csv`,
    csv: buildCsv(headers, rows),
  };
}
