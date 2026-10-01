/**
 * Internal Sales Intelligence — Range Opportunities.
 *
 * Comparable population is limited to the actor's Sales Intelligence company
 * scope (no out-of-scope customer identity leakage). Evidence is aggregate only.
 *
 * Cross-sell co-purchase helper is available via computeSkuCoPurchase (no UI yet).
 */
import { z } from "zod";
import { prisma } from "@/infra/database/client";
import { AuthError, requireSystemPermission } from "@/server/rbac/guards";
import type { LoadedAccessProfile } from "@/server/rbac/access";
import { resolveSalesIntelligenceCompanyScope } from "@/server/sales-intelligence/scope";
import {
  loadHistoricSalesLines,
  summarizeHistoricLines,
  type HistoricLineRow,
} from "@/server/sales-intelligence/historic-lines";
import { totalsToDto, buildCsv } from "@/domain/sales-intelligence";
import {
  RANGE_OPPORTUNITY_CONFIG,
  availabilityFilterMatches,
  calculateCustomerSimilarity,
  calculateObservedAdoption,
  computeSkuCoPurchase,
  emptyPurchaseProfileSets,
  rangeMatchLabel,
  resolveOpportunityAnalysisPeriod,
  resolveRangeMatch,
  sortOpportunityRows,
  type OpportunityAnalysisPeriod,
  type OpportunitySort,
  type PurchaseProfileSets,
  type RangeMatch,
  type SimilarityBreakdown,
} from "@/domain/sales-opportunity";
import {
  PUBLIC_AVAILABILITY_LABEL,
  type PublicAvailability,
} from "@/domain/availability";
import { loadStockByVariantIds } from "@/server/stock/service";

async function requireSi(actorUserId: string): Promise<LoadedAccessProfile> {
  const profile = await requireSystemPermission(actorUserId, "sales_intelligence.view");
  if (profile.actorType === "TRADE") {
    throw new AuthError("Sales Intelligence is internal only", "FORBIDDEN", 403);
  }
  return profile;
}

async function assertCompanyInScope(profile: LoadedAccessProfile, companyId: string) {
  const scope = await resolveSalesIntelligenceCompanyScope(profile);
  if (scope === "all") return;
  if (!scope.includes(companyId)) {
    throw new AuthError("No access to this company", "COMPANY_FORBIDDEN", 403);
  }
}

const inputSchema = z.object({
  companyId: z.string().min(1),
  period: z.enum(["LAST_90", "LAST_180", "LAST_365", "LAST_730", "CUSTOM"]).optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  q: z.string().max(200).optional().nullable(),
  brandId: z.string().optional().nullable(),
  categoryId: z.string().optional().nullable(),
  rangeMatch: z
    .enum(["ALL", "SAME_BRAND_CATEGORY", "SAME_CATEGORY", "SAME_BRAND", "BROADER_RANGE"])
    .optional()
    .nullable(),
  availability: z.enum(["ALL", "IN", "LOW", "BACKORDER", "ORDERABLE"]).optional().nullable(),
  minAdoption: z.number().min(0).max(1).optional().nullable(),
  sort: z.enum(["ADOPTION", "BUYERS", "UNITS", "RANGE_MATCH", "NAME_AZ"]).optional(),
  page: z.number().int().min(1).max(10_000).optional(),
  pageSize: z.number().int().min(1).max(100).optional(),
  includeBroader: z.boolean().optional(),
});

type CatalogueSku = {
  sku: string;
  skuKey: string;
  variantId: string;
  name: string;
  brandId: string | null;
  brandName: string | null;
  categoryId: string | null;
  categoryName: string | null;
  inCatalogue: boolean;
  tradeEligible: boolean;
};

const catalogueSkuSelect = {
  id: true,
  sku: true,
  isActive: true,
  product: {
    select: {
      name: true,
      isActive: true,
      isTradeVisible: true,
      status: true,
      brandId: true,
      categoryId: true,
      brand: { select: { id: true, name: true } },
      category: { select: { id: true, name: true } },
    },
  },
} as const;

function putCatalogueSku(
  map: Map<string, CatalogueSku>,
  v: {
    id: string;
    sku: string;
    isActive: boolean;
    product: {
      name: string;
      isActive: boolean;
      isTradeVisible: boolean;
      status: string;
      brandId: string | null;
      categoryId: string | null;
      brand: { id: string; name: string } | null;
      category: { id: string; name: string } | null;
    };
  },
) {
  const p = v.product;
  const tradeEligible =
    v.isActive && p.isActive && p.isTradeVisible && p.status === "ACTIVE";
  map.set(v.sku.trim().toUpperCase(), {
    sku: v.sku.trim(),
    skuKey: v.sku.trim().toUpperCase(),
    variantId: v.id,
    name: p.name,
    brandId: p.brandId,
    brandName: p.brand?.name ?? null,
    categoryId: p.categoryId,
    categoryName: p.category?.name ?? null,
    inCatalogue: true,
    tradeEligible,
  });
}

/**
 * Catalogue lookup by SKU. ProductVariant.sku is stored uppercase in practice;
 * prefer `IN` (fast) and fall back to case-insensitive OR only for misses.
 */
async function loadCatalogueBySkus(skus: string[]): Promise<Map<string, CatalogueSku>> {
  const upperKeys = [...new Set(skus.map((s) => s.trim().toUpperCase()).filter(Boolean))];
  const map = new Map<string, CatalogueSku>();
  if (!upperKeys.length) return map;

  const chunkSize = 200;
  for (let i = 0; i < upperKeys.length; i += chunkSize) {
    const chunk = upperKeys.slice(i, i + chunkSize);
    const variants = await prisma.productVariant.findMany({
      where: { sku: { in: chunk } },
      select: catalogueSkuSelect,
    });
    for (const v of variants) putCatalogueSku(map, v);
  }

  const missing = upperKeys.filter((k) => !map.has(k));
  const fbChunk = 80;
  for (let i = 0; i < missing.length; i += fbChunk) {
    const chunk = missing.slice(i, i + fbChunk);
    const variants = await prisma.productVariant.findMany({
      where: {
        OR: chunk.map((sku) => ({ sku: { equals: sku, mode: "insensitive" as const } })),
      },
      select: catalogueSkuSelect,
    });
    for (const v of variants) putCatalogueSku(map, v);
  }
  return map;
}

function invoiceSkuSet(lines: HistoricLineRow[]): Set<string> {
  const set = new Set<string>();
  for (const line of lines) {
    if (line.documentType !== "INVOICE") continue;
    set.add(line.sku.trim().toUpperCase());
  }
  return set;
}

function invoiceUnitsBySku(lines: HistoricLineRow[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const line of lines) {
    if (line.documentType !== "INVOICE") continue;
    const key = line.sku.trim().toUpperCase();
    map.set(key, (map.get(key) ?? 0) + Number(line.units ?? 0));
  }
  return map;
}

function buildProfile(
  invoiceSkus: Set<string>,
  catalogue: Map<string, CatalogueSku>,
): PurchaseProfileSets {
  const profile = emptyPurchaseProfileSets();
  for (const sku of invoiceSkus) {
    profile.skus.add(sku);
    const cat = catalogue.get(sku);
    if (cat?.brandId) profile.brandIds.add(cat.brandId);
    if (cat?.categoryId) profile.categoryIds.add(cat.categoryId);
  }
  return profile;
}

type CompanyActivity = {
  companyId: string;
  lines: HistoricLineRow[];
  invoiceSkus: Set<string>;
  invoiceUnits: Map<string, number>;
  hasInvoice: boolean;
};

function groupLinesByCompany(lines: HistoricLineRow[]): Map<string, HistoricLineRow[]> {
  const map = new Map<string, HistoricLineRow[]>();
  for (const line of lines) {
    let arr = map.get(line.companyId);
    if (!arr) {
      arr = [];
      map.set(line.companyId, arr);
    }
    arr.push(line);
  }
  return map;
}

export async function getCustomerRangeOpportunities(actorUserId: string, raw: unknown) {
  const profile = await requireSi(actorUserId);
  const input = inputSchema.parse(raw ?? {});
  await assertCompanyInScope(profile, input.companyId);

  const analysisPeriod = resolveOpportunityAnalysisPeriod({
    period: (input.period ?? RANGE_OPPORTUNITY_CONFIG.defaultAnalysisPeriod) as OpportunityAnalysisPeriod,
    from: input.from,
    to: input.to,
  });

  const company = await prisma.company.findUnique({
    where: { id: input.companyId },
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
              displayName: true,
              user: { select: { name: true, email: true } },
            },
          },
        },
      },
    },
  });
  if (!company) throw new AuthError("Company not found", "NOT_FOUND", 404);

  const scope = await resolveSalesIntelligenceCompanyScope(profile);
  const companyFilter =
    scope === "all" ? undefined : { in: scope.length ? scope : ["__none__"] };

  // Single period load for authorised population (+ ensure target included).
  const allLines = await loadHistoricSalesLines({
    ...(companyFilter ? { companyId: companyFilter } : {}),
    range: analysisPeriod,
  });

  // If target somehow outside filter (shouldn't), merge target lines.
  let lines = allLines;
  if (companyFilter && !companyFilter.in.includes(input.companyId)) {
    const targetLines = await loadHistoricSalesLines({
      companyId: input.companyId,
      range: analysisPeriod,
    });
    lines = [...allLines, ...targetLines];
  }

  const byCompany = groupLinesByCompany(lines);
  const activities = new Map<string, CompanyActivity>();
  const allSkus = new Set<string>();
  for (const [companyId, companyLines] of byCompany) {
    const invoiceSkus = invoiceSkuSet(companyLines);
    for (const s of invoiceSkus) allSkus.add(s);
    const hasInvoice = invoiceSkus.size > 0;
    activities.set(companyId, {
      companyId,
      lines: companyLines,
      invoiceSkus,
      invoiceUnits: invoiceUnitsBySku(companyLines),
      hasInvoice,
    });
  }

  // Ensure target activity entry even with zero lines
  if (!activities.has(input.companyId)) {
    activities.set(input.companyId, {
      companyId: input.companyId,
      lines: [],
      invoiceSkus: new Set(),
      invoiceUnits: new Map(),
      hasInvoice: false,
    });
  }

  const catalogue = await loadCatalogueBySkus([...allSkus]);
  const targetAct = activities.get(input.companyId)!;
  const targetProfile = buildProfile(targetAct.invoiceSkus, catalogue);
  const targetTotals = totalsToDto(summarizeHistoricLines(targetAct.lines));

  // Related current products for expand context (catalogue only)
  const relatedProducts = [...targetAct.invoiceSkus]
    .map((sku) => catalogue.get(sku))
    .filter((c): c is CatalogueSku => Boolean(c?.tradeEligible))
    .map((c) => ({
      sku: c.sku,
      name: c.name,
      brandName: c.brandName,
      categoryName: c.categoryName,
    }))
    .sort((a, b) => a.name.localeCompare(b.name, "en-GB"))
    .slice(0, 40);

  type Comparable = {
    companyId: string;
    similarity: SimilarityBreakdown;
    invoiceSkus: Set<string>;
    invoiceUnits: Map<string, number>;
  };

  const comparables: Comparable[] = [];
  for (const act of activities.values()) {
    if (act.companyId === input.companyId) continue;
    if (!act.hasInvoice) continue;
    const otherProfile = buildProfile(act.invoiceSkus, catalogue);
    const similarity = calculateCustomerSimilarity(targetProfile, otherProfile);
    if (similarity.score < RANGE_OPPORTUNITY_CONFIG.minSimilarity) continue;
    comparables.push({
      companyId: act.companyId,
      similarity,
      invoiceSkus: act.invoiceSkus,
      invoiceUnits: act.invoiceUnits,
    });
  }

  // Deterministic order for stable tests
  comparables.sort(
    (a, b) => b.similarity.score - a.similarity.score || a.companyId.localeCompare(b.companyId),
  );

  const methodology = {
    analysisPeriod,
    weights: {
      category: RANGE_OPPORTUNITY_CONFIG.weightCategory,
      brand: RANGE_OPPORTUNITY_CONFIG.weightBrand,
      sku: RANGE_OPPORTUNITY_CONFIG.weightSku,
    },
    minSimilarity: RANGE_OPPORTUNITY_CONFIG.minSimilarity,
    minComparableCustomers: RANGE_OPPORTUNITY_CONFIG.minComparableCustomers,
    minCandidateBuyers: RANGE_OPPORTUNITY_CONFIG.minCandidateBuyers,
    scopeNote:
      "Comparable cohort is limited to customers within the actor's Sales Intelligence visibility. Evidence is aggregate only — other customer identities are never returned.",
  };

  const emptyBase = {
    dataSource:
      "Autopart historic sales (561L + SLRB). AB Orders and 504C are not included. Range Opportunities recommend current catalogue products only.",
    company: {
      id: company.id,
      name: company.name,
      autopartCustomerCode: company.autopartCustomerCode,
      accountNumber: company.accountNumber,
      salesperson: company.assignments[0]?.salesRep
        ? {
            id: company.assignments[0].salesRep.id,
            name:
              company.assignments[0].salesRep.displayName ||
              company.assignments[0].salesRep.user.name ||
              company.assignments[0].salesRep.user.email,
          }
        : null,
    },
    analysisPeriod,
    methodology,
    profile: {
      netSales: targetTotals.netSales,
      invoiceSales: targetTotals.invoiceSales,
      credits: targetTotals.credits,
      units: targetTotals.units,
      purchaseTransactions: targetTotals.purchaseTransactions,
      productsPurchased: targetTotals.productsPurchased,
      activeCategories: targetProfile.categoryIds.size,
      activeBrands: targetProfile.brandIds.size,
      relatedProducts,
    },
    summary: {
      opportunities: 0,
      comparableCustomers: comparables.length,
      activeCategories: targetProfile.categoryIds.size,
      activeBrands: targetProfile.brandIds.size,
    },
    evidenceInsufficient: false,
    noPurchaseHistory: !targetAct.hasInvoice,
    averageSimilarity: null as number | null,
    items: { items: [] as OpportunityItem[], page: 1, pageSize: input.pageSize ?? 25, total: 0 },
    filterOptions: { brands: [] as Array<{ id: string; name: string }>, categories: [] as Array<{ id: string; name: string }> },
  };

  if (!targetAct.hasInvoice) {
    return { ...emptyBase, noPurchaseHistory: true };
  }

  if (comparables.length < RANGE_OPPORTUNITY_CONFIG.minComparableCustomers) {
    return {
      ...emptyBase,
      evidenceInsufficient: true,
      summary: {
        ...emptyBase.summary,
        comparableCustomers: comparables.length,
      },
    };
  }

  const cohortSize = comparables.length;
  const avgSimilarity =
    comparables.reduce((s, c) => s + c.similarity.score, 0) / cohortSize;

  // Aggregate candidate buyers/units from comparable cohort
  type CandAgg = { buyers: number; units: number };
  const candMap = new Map<string, CandAgg>();
  for (const c of comparables) {
    for (const sku of c.invoiceSkus) {
      // Never purchased by target (invoice presence)
      if (targetAct.invoiceSkus.has(sku)) continue;
      let agg = candMap.get(sku);
      if (!agg) {
        agg = { buyers: 0, units: 0 };
        candMap.set(sku, agg);
      }
      agg.buyers += 1;
      agg.units += c.invoiceUnits.get(sku) ?? 0;
    }
  }

  // Load catalogue for candidate SKUs that may not be in target profile catalogue map
  const missingCandSkus = [...candMap.keys()].filter((s) => !catalogue.has(s));
  if (missingCandSkus.length) {
    const extra = await loadCatalogueBySkus(missingCandSkus);
    for (const [k, v] of extra) catalogue.set(k, v);
  }

  const candidateVariantIds = [...candMap.keys()]
    .map((s) => catalogue.get(s)?.variantId)
    .filter((id): id is string => Boolean(id));
  const stockMap = await loadStockByVariantIds(candidateVariantIds);

  type OpportunityItem = {
    sku: string;
    name: string;
    brandId: string | null;
    brandName: string | null;
    categoryId: string | null;
    categoryName: string | null;
    rangeMatch: RangeMatch;
    rangeMatchLabel: string;
    buyers: number;
    cohort: number;
    adoption: number;
    adoptionLabel: string;
    comparableUnits: number;
    availabilityBand: PublicAvailability | null;
    availabilityLabel: string;
    relatedCustomerProducts: number;
    why: {
      comparableCustomers: number;
      averageSimilarity: number;
      categoryOverlap: number | null;
      brandOverlap: number | null;
      skuOverlap: number | null;
      buyers: number;
      units: number;
      adoption: number;
      customerActiveInCategory: boolean;
      customerActiveInBrand: boolean;
      sampleRelatedProducts: Array<{ sku: string; name: string }>;
    };
  };

  const allowBroader =
    input.includeBroader === true ||
    input.rangeMatch === "BROADER_RANGE" ||
    input.rangeMatch === "ALL";

  let rows: OpportunityItem[] = [];
  const brandOptions = new Map<string, string>();
  const categoryOptions = new Map<string, string>();

  for (const [skuKey, agg] of candMap) {
    if (agg.buyers < RANGE_OPPORTUNITY_CONFIG.minCandidateBuyers) continue;
    const cat = catalogue.get(skuKey);
    if (!cat || !cat.tradeEligible) continue;

    const stock = stockMap.get(cat.variantId);
    const band = (stock?.availability ?? null) as PublicAvailability | null;
    if (!availabilityFilterMatches(input.availability ?? "ORDERABLE", band)) continue;

    const rangeMatch = resolveRangeMatch(targetProfile, cat.brandId, cat.categoryId);
    if (!allowBroader && rangeMatch === "BROADER_RANGE") continue;
    if (
      input.rangeMatch &&
      input.rangeMatch !== "ALL" &&
      rangeMatch !== input.rangeMatch
    ) {
      continue;
    }

    const adoption = calculateObservedAdoption(agg.buyers, cohortSize) ?? 0;
    if (input.minAdoption != null && adoption < input.minAdoption) continue;

    if (cat.brandId && cat.brandName) brandOptions.set(cat.brandId, cat.brandName);
    if (cat.categoryId && cat.categoryName) {
      categoryOptions.set(cat.categoryId, cat.categoryName);
    }

    const relatedInCategory = cat.categoryId
      ? relatedProducts.filter((p) => {
          const c = catalogue.get(p.sku.toUpperCase());
          return c?.categoryId === cat.categoryId;
        })
      : [];

    // Average overlap vs cohort for explainability (mean of comparable similarities)
    const meanCat =
      comparables.reduce((s, c) => s + (c.similarity.category ?? 0), 0) / cohortSize;
    const meanBrand =
      comparables.reduce((s, c) => s + (c.similarity.brand ?? 0), 0) / cohortSize;
    const meanSku =
      comparables.reduce((s, c) => s + (c.similarity.sku ?? 0), 0) / cohortSize;

    rows.push({
      sku: cat.sku,
      name: cat.name,
      brandId: cat.brandId,
      brandName: cat.brandName,
      categoryId: cat.categoryId,
      categoryName: cat.categoryName,
      rangeMatch,
      rangeMatchLabel: rangeMatchLabel(rangeMatch),
      buyers: agg.buyers,
      cohort: cohortSize,
      adoption,
      adoptionLabel: `${Math.round(adoption * 100)}%`,
      comparableUnits: agg.units,
      availabilityBand: band,
      availabilityLabel: band ? PUBLIC_AVAILABILITY_LABEL[band] : "Availability unknown",
      relatedCustomerProducts: relatedInCategory.length,
      why: {
        comparableCustomers: cohortSize,
        averageSimilarity: avgSimilarity,
        categoryOverlap: meanCat,
        brandOverlap: meanBrand,
        skuOverlap: meanSku,
        buyers: agg.buyers,
        units: agg.units,
        adoption,
        customerActiveInCategory: Boolean(
          cat.categoryId && targetProfile.categoryIds.has(cat.categoryId),
        ),
        customerActiveInBrand: Boolean(cat.brandId && targetProfile.brandIds.has(cat.brandId)),
        sampleRelatedProducts: relatedInCategory.slice(0, 6).map((p) => ({
          sku: p.sku,
          name: p.name,
        })),
      },
    });
  }

  if (input.q?.trim()) {
    const qq = input.q.trim().toLowerCase();
    rows = rows.filter(
      (r) => r.sku.toLowerCase().includes(qq) || r.name.toLowerCase().includes(qq),
    );
  }
  if (input.brandId) rows = rows.filter((r) => r.brandId === input.brandId);
  if (input.categoryId) rows = rows.filter((r) => r.categoryId === input.categoryId);

  const sort = (input.sort ?? "RANGE_MATCH") as OpportunitySort;
  sortOpportunityRows(rows, sort);

  const page = input.page ?? 1;
  const pageSize = input.pageSize ?? 25;
  const total = rows.length;
  const pageItems = rows.slice((page - 1) * pageSize, page * pageSize);

  // Cross-sell foundation (computed, not exposed in table): co-purchase for target top SKUs
  const coPurchaseSeed = [...targetAct.invoiceSkus].slice(0, 5);
  const crossSellFoundation = coPurchaseSeed.map((sku) => ({
    sku,
    coBuyers: Object.fromEntries(
      [...computeSkuCoPurchase(
        comparables.map((c) => c.invoiceSkus),
        sku,
      )].slice(0, 10),
    ),
  }));

  return {
    dataSource: emptyBase.dataSource,
    company: emptyBase.company,
    analysisPeriod,
    methodology,
    profile: emptyBase.profile,
    summary: {
      opportunities: total,
      comparableCustomers: cohortSize,
      activeCategories: targetProfile.categoryIds.size,
      activeBrands: targetProfile.brandIds.size,
    },
    evidenceInsufficient: false,
    noPurchaseHistory: false,
    averageSimilarity: avgSimilarity,
    items: { items: pageItems, page, pageSize, total },
    filterOptions: {
      brands: [...brandOptions.entries()]
        .map(([id, name]) => ({ id, name }))
        .sort((a, b) => a.name.localeCompare(b.name, "en-GB")),
      categories: [...categoryOptions.entries()]
        .map(([id, name]) => ({ id, name }))
        .sort((a, b) => a.name.localeCompare(b.name, "en-GB")),
    },
    /** Internal/debug foundation for future Cross Sell phase — not customer PII. */
    crossSellFoundation,
  };
}

export async function exportCustomerRangeOpportunitiesCsv(actorUserId: string, raw: unknown) {
  const input = inputSchema.parse(raw ?? {});
  const all: Awaited<ReturnType<typeof getCustomerRangeOpportunities>>["items"]["items"] = [];
  let page = 1;
  let total = Infinity;
  let meta: Awaited<ReturnType<typeof getCustomerRangeOpportunities>> | null = null;
  while (all.length < total && page < 200) {
    const next = await getCustomerRangeOpportunities(actorUserId, {
      ...input,
      page,
      pageSize: 100,
    });
    meta = next;
    total = next.items.total;
    all.push(...next.items.items);
    if (next.items.items.length === 0) break;
    page += 1;
  }
  const headers = [
    "Customer",
    "Autopart Account",
    "Analysis From",
    "Analysis To",
    "SKU",
    "Product",
    "Brand",
    "Category",
    "Range Match",
    "Comparable Customers",
    "Comparable Buyers",
    "Adoption %",
    "Comparable Units",
    "Availability",
  ];
  const rows = all.map((r) => [
    meta!.company.name,
    meta!.company.autopartCustomerCode ?? meta!.company.accountNumber ?? "",
    meta!.analysisPeriod.from,
    meta!.analysisPeriod.to,
    r.sku,
    r.name,
    r.brandName ?? "",
    r.categoryName ?? "",
    r.rangeMatchLabel,
    r.cohort,
    r.buyers,
    r.adoptionLabel,
    r.comparableUnits,
    r.availabilityLabel,
  ]);
  return {
    filename: `range-opportunities-${meta!.company.autopartCustomerCode ?? meta!.company.id}-${meta!.analysisPeriod.from}_${meta!.analysisPeriod.to}.csv`,
    csv: buildCsv(headers, rows),
  };
}

