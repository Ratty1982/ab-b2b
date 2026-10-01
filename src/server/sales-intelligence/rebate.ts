/**
 * Sales Intelligence — Rebate / Net Spend Analysis.
 *
 * Source of truth: AutopartSalesDocument + AutopartSalesLine (561L + SLRB).
 * Net Spend === Sales Enquiry Net Sales for the same customer + period.
 * No rebate eligibility schemes in Phase 4.
 */
import { z } from "zod";
import { prisma } from "@/infra/database/client";
import { AuthError, requireSystemPermission } from "@/server/rbac/guards";
import type { LoadedAccessProfile } from "@/server/rbac/access";
import { resolveSalesIntelligenceCompanyScope } from "@/server/sales-intelligence/scope";
import {
  dateOnlyIsoFromDate,
  todayLondonDateOnly,
} from "@/domain/sales-history-period";
import {
  applyRebateEligibilityRules,
  countDocumentTypes,
  rebatePeriodCsvCells,
  resolveRebateComparisonPeriod,
  resolveRebatePrimaryPeriod,
  RebatePeriodValidationError,
  toRebatePeriodDto,
  type RebateCatalogueFilter,
  type RebateCustomerSort,
  type RebateDocTypeFilter,
  type ResolvedRebatePeriod,
} from "@/domain/sales-rebate";
import {
  buildCsv,
  compareSalesTotals,
  moneyMinorToDto,
  parseSalesNetMinor,
  totalsToDto,
  type PeriodComparisonDto,
} from "@/domain/sales-intelligence";
import { parseMoney } from "@/domain/money";
import {
  groupHistoricBySku,
  loadHistoricSalesLines,
  summarizeHistoricLines,
  type HistoricLineRow,
} from "@/server/sales-intelligence/historic-lines";

async function requireSalesIntelligence(actorUserId: string): Promise<LoadedAccessProfile> {
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

const periodPresetSchema = z.enum([
  "ALL",
  "THIS_MONTH",
  "LAST_MONTH",
  "THIS_QUARTER",
  "PREVIOUS_QUARTER",
  "YTD",
  "LAST_YEAR",
  "LAST_90",
  "LAST_180",
  "LAST_365",
  "CUSTOM",
]);

const periodInputSchema = z.object({
  period: periodPresetSchema.optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  compare: z.enum(["OFF", "PREVIOUS", "PREVIOUS_YEAR", "CUSTOM"]).optional().nullable(),
  compareFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  compareTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
});

function resolvePeriods(
  raw: z.infer<typeof periodInputSchema>,
  today = todayLondonDateOnly(),
): { primary: ResolvedRebatePeriod; comparison: import("@/domain/sales-history-period").DateOnlyRange | null } {
  try {
    const primary = resolveRebatePrimaryPeriod({
      period: raw.period,
      from: raw.from,
      to: raw.to,
      today,
    });
    const comparison = resolveRebateComparisonPeriod({
      compare: raw.compare,
      primary,
      period: raw.period,
      compareFrom: raw.compareFrom,
      compareTo: raw.compareTo,
    });
    return { primary, comparison };
  } catch (e) {
    if (e instanceof RebatePeriodValidationError) {
      throw new AuthError(e.message, "BAD_REQUEST", 400);
    }
    throw e;
  }
}

function spendSummaryFromLines(lines: HistoricLineRow[]) {
  // Phase 4: eligibility rules are identity — prepare for future schemes.
  const eligible = applyRebateEligibilityRules(lines, null);
  const totals = summarizeHistoricLines(eligible);
  const docs = countDocumentTypes(eligible);
  return {
    invoiceSales: moneyMinorToDto(totals.invoiceSalesMinor),
    credits: moneyMinorToDto(totals.creditsMinor),
    netSpend: moneyMinorToDto(totals.netSalesMinor),
    units: totals.units,
    invoiceDocuments: docs.invoiceDocuments,
    creditDocuments: docs.creditDocuments,
    products: totals.productsPurchased,
    /** Same shape as Sales Enquiry for reconciliation. */
    enquiryTotals: totalsToDto(totals),
    totals,
  };
}

async function countUndatedDocuments(companyId: string | { in: string[] } | undefined): Promise<number> {
  return prisma.autopartSalesDocument.count({
    where: {
      documentDate: null,
      ...(typeof companyId === "string"
        ? { companyId }
        : companyId
          ? { companyId }
          : {}),
    },
  });
}

type DocAgg = {
  documentReference: string;
  documentType: string;
  documentDate: string | null;
  lineCount: number;
  units: number;
  netValueMinor: bigint;
  lines: Array<{
    sku: string;
    description: string | null;
    units: number;
    netValue: string;
    brandName: string | null;
    categoryName: string | null;
  }>;
};

function aggregateDocuments(lines: HistoricLineRow[]): DocAgg[] {
  const map = new Map<string, DocAgg>();
  for (const line of lines) {
    const key = `${line.documentType}:${line.documentReference}`;
    let agg = map.get(key);
    if (!agg) {
      agg = {
        documentReference: line.documentReference,
        documentType: line.documentType,
        documentDate: line.document?.documentDate
          ? dateOnlyIsoFromDate(line.document.documentDate)
          : null,
        lineCount: 0,
        units: 0,
        netValueMinor: 0n,
        lines: [],
      };
      map.set(key, agg);
    }
    const units = Number(line.units ?? 0);
    const minor = parseSalesNetMinor(line.salesNet);
    agg.lineCount += 1;
    agg.units += units;
    agg.netValueMinor += minor;
    agg.lines.push({
      sku: line.sku,
      description: line.descriptionSnapshot,
      units,
      netValue: moneyMinorToDto(minor),
      brandName: null,
      categoryName: null,
    });
  }
  return [...map.values()].sort((a, b) => {
    const da = a.documentDate ?? "";
    const db = b.documentDate ?? "";
    return db.localeCompare(da) || a.documentReference.localeCompare(b.documentReference);
  });
}

async function attachCatalogueMeta(skus: string[]) {
  if (!skus.length) {
    return {
      variantBySku: new Map<
        string,
        {
          sku: string;
          name: string;
          brandId: string | null;
          brandName: string | null;
          categoryId: string | null;
          categoryName: string | null;
        }
      >(),
    };
  }
  const variants = await prisma.productVariant.findMany({
    where: {
      OR: skus.map((sku) => ({ sku: { equals: sku, mode: "insensitive" as const } })),
    },
    select: {
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
  });
  const variantBySku = new Map(
    variants.map((v) => [
      v.sku.trim().toUpperCase(),
      {
        sku: v.sku,
        name: v.product.name,
        brandId: v.product.brandId,
        brandName: v.product.brand?.name ?? null,
        categoryId: v.product.categoryId,
        categoryName: v.product.category?.name ?? null,
      },
    ]),
  );
  return { variantBySku };
}

async function loadCompanyContext(companyId: string) {
  const company = await prisma.company.findUnique({
    where: { id: companyId },
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
  const rep = company.assignments[0]?.salesRep;
  return {
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
  };
}

const customerSchema = periodInputSchema.extend({
  companyId: z.string().min(1),
  q: z.string().max(200).optional().nullable(),
  docType: z.enum(["ALL", "INVOICE", "CREDIT"]).optional().nullable(),
  brandId: z.string().optional().nullable(),
  categoryId: z.string().optional().nullable(),
  catalogue: z.enum(["ALL", "CATALOGUE", "HISTORIC"]).optional().nullable(),
  docPage: z.number().int().min(1).max(10_000).optional(),
  page: z.number().int().min(1).max(10_000).optional(),
  pageSize: z.number().int().min(1).max(100).optional(),
  docRef: z.string().max(120).optional().nullable(),
});

/** Customer rebate / net-spend analysis with document and product drilldowns. */
export async function getCustomerRebateAnalysis(actorUserId: string, raw: unknown) {
  const profile = await requireSalesIntelligence(actorUserId);
  const input = customerSchema.parse(raw ?? {});
  await assertCompanyInScope(profile, input.companyId);
  const { primary, comparison: comparisonRange } = resolvePeriods(input);
  const company = await loadCompanyContext(input.companyId);

  const primaryLines = await loadHistoricSalesLines({
    companyId: input.companyId,
    range: primary.queryRange,
  });
  const spend = spendSummaryFromLines(primaryLines);
  const undatedExcluded = await countUndatedDocuments(input.companyId);

  let comparison: PeriodComparisonDto | null = null;
  if (comparisonRange) {
    const cmpLines = await loadHistoricSalesLines({
      companyId: input.companyId,
      range: comparisonRange,
    });
    comparison = compareSalesTotals(
      primary.unbounded
        ? { from: comparisonRange.from, to: comparisonRange.to }
        : { from: primary.from!, to: primary.to! },
      comparisonRange,
      spend.totals,
      summarizeHistoricLines(applyRebateEligibilityRules(cmpLines, null)),
    );
    if (primary.unbounded) {
      // Avoid leaking internal sentinel bounds into comparison.primary.
      comparison = {
        ...comparison,
        primary: { from: "", to: "" },
      };
    }
  }

  const skus = [...new Set(primaryLines.map((l) => l.sku.trim().toUpperCase()))];
  const { variantBySku } = await attachCatalogueMeta(skus);

  // Enrich document lines with brand/category where catalogue maps.
  const documents = aggregateDocuments(primaryLines).map((doc) => ({
    ...doc,
    lines: doc.lines.map((ln) => {
      const v = variantBySku.get(ln.sku.trim().toUpperCase());
      return {
        ...ln,
        brandName: v?.brandName ?? null,
        categoryName: v?.categoryName ?? null,
      };
    }),
  }));

  const bySku = groupHistoricBySku(primaryLines);
  type ProductRow = {
    sku: string;
    name: string;
    brandId: string | null;
    brandName: string | null;
    categoryId: string | null;
    categoryName: string | null;
    invoiceSales: string;
    credits: string;
    netSpend: string;
    netSpendMinor: bigint;
    units: number;
    invoiceDocuments: number;
    lastPurchasedDate: string | null;
    inCatalogue: boolean;
    historicOnly: boolean;
  };

  let products: ProductRow[] = [];
  const brandOptions = new Map<string, string>();
  const categoryOptions = new Map<string, string>();

  for (const [key, entry] of bySku) {
    const v = variantBySku.get(key);
    if (v?.brandId && v.brandName) brandOptions.set(v.brandId, v.brandName);
    if (v?.categoryId && v.categoryName) categoryOptions.set(v.categoryId, v.categoryName);
    products.push({
      sku: v?.sku ?? entry.sku,
      name: v?.name ?? entry.desc ?? entry.sku,
      brandId: v?.brandId ?? null,
      brandName: v?.brandName ?? null,
      categoryId: v?.categoryId ?? null,
      categoryName: v?.categoryName ?? null,
      invoiceSales: moneyMinorToDto(entry.agg.invoiceSalesMinor),
      credits: moneyMinorToDto(entry.agg.creditsMinor),
      netSpend: moneyMinorToDto(entry.agg.netSalesMinor),
      netSpendMinor: entry.agg.netSalesMinor,
      units: entry.agg.units,
      invoiceDocuments: entry.agg.invoiceRefs.size,
      lastPurchasedDate: entry.agg.lastPurchasedDate,
      inCatalogue: Boolean(v),
      historicOnly: !v,
    });
  }

  // Unfiltered product/brand/category totals must reconcile to headline.
  const brandBreakdownFull = rollupDim(products, "brand");
  const categoryBreakdownFull = rollupDim(products, "category");

  const productSumMinor = products.reduce((a, p) => a + p.netSpendMinor, 0n);
  const brandSumMinor = brandBreakdownFull.reduce((a, b) => a + b.netSpendMinor, 0n);
  const categorySumMinor = categoryBreakdownFull.reduce((a, c) => a + c.netSpendMinor, 0n);
  const documentSumMinor = documents.reduce((a, d) => a + d.netValueMinor, 0n);

  // Filters apply to detail only — headline stays full period.
  const docType = (input.docType ?? "ALL") as RebateDocTypeFilter;
  const catalogue = (input.catalogue ?? "ALL") as RebateCatalogueFilter;
  const q = input.q?.trim().toLowerCase() ?? "";

  let filteredDocs = documents;
  if (docType !== "ALL") {
    filteredDocs = filteredDocs.filter((d) => d.documentType === docType);
  }
  if (q) {
    filteredDocs = filteredDocs.filter(
      (d) =>
        d.documentReference.toLowerCase().includes(q) ||
        d.lines.some(
          (l) =>
            l.sku.toLowerCase().includes(q) ||
            (l.description ?? "").toLowerCase().includes(q),
        ),
    );
  }

  let filteredProducts = products;
  if (q) {
    filteredProducts = filteredProducts.filter(
      (p) => p.sku.toLowerCase().includes(q) || p.name.toLowerCase().includes(q),
    );
  }
  if (input.brandId === "__none__") {
    filteredProducts = filteredProducts.filter((p) => !p.brandId);
  } else if (input.brandId) {
    filteredProducts = filteredProducts.filter((p) => p.brandId === input.brandId);
  }
  if (input.categoryId === "__none__") {
    filteredProducts = filteredProducts.filter((p) => !p.categoryId);
  } else if (input.categoryId) {
    filteredProducts = filteredProducts.filter((p) => p.categoryId === input.categoryId);
  }
  if (catalogue === "CATALOGUE") {
    filteredProducts = filteredProducts.filter((p) => p.inCatalogue);
  } else if (catalogue === "HISTORIC") {
    filteredProducts = filteredProducts.filter((p) => p.historicOnly);
  }

  const productFilterActive = Boolean(
    q || input.brandId || input.categoryId || catalogue !== "ALL",
  );
  const docFilterActive = Boolean(q || docType !== "ALL");
  const filtersActive = productFilterActive || docFilterActive;
  const filteredNetSpendMinor = productFilterActive
    ? filteredProducts.reduce((a, p) => a + p.netSpendMinor, 0n)
    : filteredDocs.reduce((a, d) => a + d.netValueMinor, 0n);

  const pageSize = input.pageSize ?? 25;
  const docPage = input.docPage ?? 1;
  const productPage = input.page ?? 1;

  const docItems = filteredDocs
    .slice((docPage - 1) * pageSize, docPage * pageSize)
    .map(({ netValueMinor, lines, ...rest }) => ({
      ...rest,
      netValue: moneyMinorToDto(netValueMinor),
      lines:
        input.docRef && input.docRef === rest.documentReference
          ? lines
          : undefined,
    }));

  // If a specific doc is requested but not on this page, still attach its lines when matching.
  let expandedDocument: {
    documentReference: string;
    documentDate: string | null;
    documentType: string;
    netValue: string;
    lineCount: number;
    units: number;
    lines: DocAgg["lines"];
  } | null = null;
  if (input.docRef?.trim()) {
    const found = documents.find((d) => d.documentReference === input.docRef);
    if (found) {
      expandedDocument = {
        documentReference: found.documentReference,
        documentDate: found.documentDate,
        documentType: found.documentType,
        netValue: moneyMinorToDto(found.netValueMinor),
        lineCount: found.lineCount,
        units: found.units,
        lines: found.lines,
      };
    }
  }

  const productItems = filteredProducts
    .sort((a, b) => {
      if (b.netSpendMinor !== a.netSpendMinor) return b.netSpendMinor > a.netSpendMinor ? 1 : -1;
      return a.sku.localeCompare(b.sku);
    })
    .slice((productPage - 1) * pageSize, productPage * pageSize)
    .map(({ netSpendMinor: _n, ...rest }) => rest);

  const brandBreakdown = brandBreakdownFull
    .map(({ netSpendMinor: _n, ...rest }) => rest)
    .sort((a, b) => Number(b.netSpend) - Number(a.netSpend) || a.label.localeCompare(b.label));
  const categoryBreakdown = categoryBreakdownFull
    .map(({ netSpendMinor: _n, ...rest }) => rest)
    .sort((a, b) => Number(b.netSpend) - Number(a.netSpend) || a.label.localeCompare(b.label));

  return {
    dataSource:
      "Autopart historic sales (561L + SLRB). AB Orders and 504C are not included. Net Spend is total historic invoiced net sales after credits — rebate eligibility rules are not applied.",
    disclaimer:
      "Net spend includes all imported invoice and credit activity in the selected period. Rebate eligibility rules are not applied.",
    company,
    period: toRebatePeriodDto(primary),
    summary: {
      invoiceSales: spend.invoiceSales,
      credits: spend.credits,
      netSpend: spend.netSpend,
      units: spend.units,
      invoiceDocuments: spend.invoiceDocuments,
      creditDocuments: spend.creditDocuments,
      products: spend.products,
    },
    /** For automated reconciliation with Sales Enquiry. */
    enquiryReconciliation: spend.enquiryTotals,
    comparison: comparison
      ? {
          ...comparison,
          netSpend: comparison.netSales,
        }
      : null,
    undatedExcluded,
    reconciliation: {
      documentNetSpend: moneyMinorToDto(documentSumMinor),
      productNetSpend: moneyMinorToDto(productSumMinor),
      brandNetSpend: moneyMinorToDto(brandSumMinor),
      categoryNetSpend: moneyMinorToDto(categorySumMinor),
      matchesSummary:
        documentSumMinor === spend.totals.netSalesMinor &&
        productSumMinor === spend.totals.netSalesMinor &&
        brandSumMinor === spend.totals.netSalesMinor &&
        categorySumMinor === spend.totals.netSalesMinor,
    },
    filtersActive,
    filtered: filtersActive
      ? {
          netSpend: moneyMinorToDto(filteredNetSpendMinor),
          documents: filteredDocs.length,
          products: filteredProducts.length,
        }
      : null,
    documents: {
      items: docItems,
      page: docPage,
      pageSize,
      total: filteredDocs.length,
    },
    expandedDocument,
    products: {
      items: productItems,
      page: productPage,
      pageSize,
      total: filteredProducts.length,
    },
    brandBreakdown,
    categoryBreakdown,
    filterOptions: {
      brands: [
        ...[...brandOptions.entries()]
          .map(([id, name]) => ({ id, name }))
          .sort((a, b) => a.name.localeCompare(b.name, "en-GB")),
        { id: "__none__", name: "Unassigned" },
      ],
      categories: [
        ...[...categoryOptions.entries()]
          .map(([id, name]) => ({ id, name }))
          .sort((a, b) => a.name.localeCompare(b.name, "en-GB")),
        { id: "__none__", name: "Unassigned" },
      ],
    },
    print: {
      generatedAt: new Date().toISOString(),
      title: "Rebate / Net Spend Analysis",
      organisation: "Automotive Brands",
    },
  };
}

function rollupDim(
  products: Array<{
    brandId: string | null;
    brandName: string | null;
    categoryId: string | null;
    categoryName: string | null;
    invoiceSales: string;
    credits: string;
    netSpendMinor: bigint;
    units: number;
    sku: string;
  }>,
  dim: "brand" | "category",
) {
  const map = new Map<
    string,
    {
      key: string;
      label: string;
      invoiceSalesMinor: bigint;
      creditsMinor: bigint;
      netSpendMinor: bigint;
      units: number;
      products: number;
    }
  >();
  for (const p of products) {
    const key =
      dim === "brand" ? (p.brandId ?? "__none__") : (p.categoryId ?? "__none__");
    const label =
      dim === "brand"
        ? (p.brandName ?? "Unassigned")
        : (p.categoryName ?? "Unassigned");
    let row = map.get(key);
    if (!row) {
      row = {
        key,
        label,
        invoiceSalesMinor: 0n,
        creditsMinor: 0n,
        netSpendMinor: 0n,
        units: 0,
        products: 0,
      };
      map.set(key, row);
    }
    row.invoiceSalesMinor += parseSalesNetMinor(p.invoiceSales);
    row.creditsMinor += parseSalesNetMinor(p.credits);
    row.netSpendMinor += p.netSpendMinor;
    row.units += p.units;
    row.products += 1;
  }
  return [...map.values()].map((r) => ({
    key: r.key,
    label: r.label,
    invoiceSales: moneyMinorToDto(r.invoiceSalesMinor),
    credits: moneyMinorToDto(r.creditsMinor),
    netSpend: moneyMinorToDto(r.netSpendMinor),
    netSpendMinor: r.netSpendMinor,
    units: r.units,
    products: r.products,
  }));
}

/** Low-level reusable net spend for a company + period (future rebate schemes). */
export async function getCustomerNetSpend(
  actorUserId: string,
  companyId: string,
  from: string,
  to: string,
) {
  const profile = await requireSalesIntelligence(actorUserId);
  await assertCompanyInScope(profile, companyId);
  const lines = await loadHistoricSalesLines({ companyId, range: { from, to } });
  return spendSummaryFromLines(lines);
}

const multiSchema = periodInputSchema.extend({
  q: z.string().max(200).optional().nullable(),
  salesRepId: z.string().optional().nullable(),
  minNet: z.string().optional().nullable(),
  maxNet: z.string().optional().nullable(),
  hasCredits: z.boolean().optional().nullable(),
  sort: z
    .enum(["NET_DESC", "NET_ASC", "INVOICE_DESC", "CREDITS_DESC", "NAME_AZ"])
    .optional(),
  page: z.number().int().min(1).max(10_000).optional(),
  pageSize: z.number().int().min(1).max(100).optional(),
});

type MultiRow = {
  companyId: string;
  name: string;
  accountNumber: string | null;
  autopartCustomerCode: string | null;
  salesperson: { id: string; name: string } | null;
  invoiceSales: string;
  credits: string;
  netSpend: string;
  netSpendMinor: bigint;
  creditsAbsMinor: bigint;
  invoiceSalesMinor: bigint;
  invoiceDocuments: number;
  creditDocuments: number;
  units: number;
};

export async function getMultiCustomerRebateAnalysis(actorUserId: string, raw: unknown) {
  const profile = await requireSalesIntelligence(actorUserId);
  const input = multiSchema.parse(raw ?? {});
  const scope = await resolveSalesIntelligenceCompanyScope(profile);
  const { primary, comparison: comparisonRange } = resolvePeriods(input);

  const companyFilter =
    scope === "all" ? undefined : { in: scope.length ? scope : ["__none__"] };

  const lines = await loadHistoricSalesLines({
    companyId: companyFilter,
    range: primary.queryRange,
  });
  const eligible = applyRebateEligibilityRules(lines, null);

  // Group by company with document counts.
  const byCompany = new Map<
    string,
    {
      lines: HistoricLineRow[];
    }
  >();
  for (const line of eligible) {
    let g = byCompany.get(line.companyId);
    if (!g) {
      g = { lines: [] };
      byCompany.set(line.companyId, g);
    }
    g.lines.push(line);
  }

  const companyIds = [...byCompany.keys()];
  const companies = companyIds.length
    ? await prisma.company.findMany({
        where: { id: { in: companyIds } },
        select: {
          id: true,
          name: true,
          accountNumber: true,
          autopartCustomerCode: true,
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
      })
    : [];
  const companyMap = new Map(companies.map((c) => [c.id, c]));

  let rows: MultiRow[] = [];
  for (const [companyId, group] of byCompany) {
    const spend = spendSummaryFromLines(group.lines);
    const co = companyMap.get(companyId);
    const rep = co?.assignments[0]?.salesRep;
    rows.push({
      companyId,
      name: co?.name ?? companyId,
      accountNumber: co?.accountNumber ?? null,
      autopartCustomerCode: co?.autopartCustomerCode ?? null,
      salesperson: rep
        ? {
            id: rep.id,
            name: rep.displayName || rep.user.name || rep.user.email,
          }
        : null,
      invoiceSales: spend.invoiceSales,
      credits: spend.credits,
      netSpend: spend.netSpend,
      netSpendMinor: spend.totals.netSalesMinor,
      creditsAbsMinor: spend.totals.creditsMinor < 0n ? -spend.totals.creditsMinor : spend.totals.creditsMinor,
      invoiceSalesMinor: spend.totals.invoiceSalesMinor,
      invoiceDocuments: spend.invoiceDocuments,
      creditDocuments: spend.creditDocuments,
      units: spend.units,
    });
  }

  // Salesperson filter options from authorized cohort (before filters).
  const salesRepOptions = new Map<string, string>();
  for (const r of rows) {
    if (r.salesperson) salesRepOptions.set(r.salesperson.id, r.salesperson.name);
  }

  const q = input.q?.trim().toLowerCase() ?? "";
  if (q) {
    rows = rows.filter(
      (r) =>
        r.name.toLowerCase().includes(q) ||
        (r.accountNumber ?? "").toLowerCase().includes(q) ||
        (r.autopartCustomerCode ?? "").toLowerCase().includes(q) ||
        (r.salesperson?.name ?? "").toLowerCase().includes(q),
    );
  }
  if (input.salesRepId) {
    rows = rows.filter((r) => r.salesperson?.id === input.salesRepId);
  }
  if (input.hasCredits) {
    rows = rows.filter((r) => r.creditDocuments > 0);
  }
  if (input.minNet) {
    const min = parseMoney(input.minNet)?.minor;
    if (min != null) rows = rows.filter((r) => r.netSpendMinor >= min);
  }
  if (input.maxNet) {
    const max = parseMoney(input.maxNet)?.minor;
    if (max != null) rows = rows.filter((r) => r.netSpendMinor <= max);
  }

  const sort = (input.sort ?? "NET_DESC") as RebateCustomerSort;
  rows.sort((a, b) => {
    switch (sort) {
      case "NET_ASC":
        return a.netSpendMinor !== b.netSpendMinor
          ? a.netSpendMinor < b.netSpendMinor
            ? -1
            : 1
          : a.name.localeCompare(b.name, "en-GB");
      case "INVOICE_DESC":
        return a.invoiceSalesMinor !== b.invoiceSalesMinor
          ? a.invoiceSalesMinor > b.invoiceSalesMinor
            ? -1
            : 1
          : a.name.localeCompare(b.name, "en-GB");
      case "CREDITS_DESC":
        // Greatest absolute credit reduction first.
        return a.creditsAbsMinor !== b.creditsAbsMinor
          ? a.creditsAbsMinor > b.creditsAbsMinor
            ? -1
            : 1
          : a.name.localeCompare(b.name, "en-GB");
      case "NAME_AZ":
        return a.name.localeCompare(b.name, "en-GB");
      case "NET_DESC":
      default:
        return a.netSpendMinor !== b.netSpendMinor
          ? a.netSpendMinor > b.netSpendMinor
            ? -1
            : 1
          : a.name.localeCompare(b.name, "en-GB");
    }
  });

  // Cohort summary = sum of filtered authorized rows (not whole DB).
  let invoiceSalesMinor = 0n;
  let creditsMinor = 0n;
  let netSpendMinor = 0n;
  let units = 0;
  for (const r of rows) {
    invoiceSalesMinor += r.invoiceSalesMinor;
    creditsMinor += parseSalesNetMinor(r.credits);
    netSpendMinor += r.netSpendMinor;
    units += r.units;
  }

  let comparison: PeriodComparisonDto | null = null;
  if (comparisonRange) {
    const cmpLines = await loadHistoricSalesLines({
      companyId: companyFilter,
      range: comparisonRange,
    });
    // Comparison uses same company set as filtered primary rows when possible;
    // for simplicity, compare full scoped activity in comparison period.
    const cmpEligible = applyRebateEligibilityRules(cmpLines, null);
    const filteredIds = new Set(rows.map((r) => r.companyId));
    const cmpScoped = cmpEligible.filter((l) => filteredIds.has(l.companyId));
    const primaryTotals = {
      invoiceSalesMinor,
      creditsMinor,
      netSalesMinor: netSpendMinor,
      units,
      purchaseTransactions: 0,
      productsPurchased: 0,
      customers: rows.length,
    };
    comparison = compareSalesTotals(
      primary.unbounded
        ? { from: comparisonRange.from, to: comparisonRange.to }
        : { from: primary.from!, to: primary.to! },
      comparisonRange,
      primaryTotals,
      summarizeHistoricLines(cmpScoped),
    );
    if (primary.unbounded) {
      comparison = { ...comparison, primary: { from: "", to: "" } };
    }
  }

  const page = input.page ?? 1;
  const pageSize = input.pageSize ?? 25;
  const pageItems = rows.slice((page - 1) * pageSize, page * pageSize).map(
    ({ netSpendMinor: _n, creditsAbsMinor: _c, invoiceSalesMinor: _i, ...rest }) => rest,
  );

  const undatedExcluded = await countUndatedDocuments(companyFilter);

  return {
    dataSource:
      "Autopart historic sales (561L + SLRB). Aggregates include only customers in the actor’s Sales Intelligence scope.",
    disclaimer:
      "Net spend includes all imported invoice and credit activity in the selected period. Rebate eligibility rules are not applied.",
    period: toRebatePeriodDto(primary),
    summary: {
      customers: rows.length,
      invoiceSales: moneyMinorToDto(invoiceSalesMinor),
      credits: moneyMinorToDto(creditsMinor),
      netSpend: moneyMinorToDto(netSpendMinor),
      units,
    },
    comparison: comparison
      ? {
          ...comparison,
          netSpend: comparison.netSales,
        }
      : null,
    undatedExcluded,
    customers: {
      items: pageItems,
      page,
      pageSize,
      total: rows.length,
    },
    filterOptions: {
      salespeople: [...salesRepOptions.entries()]
        .map(([id, name]) => ({ id, name }))
        .sort((a, b) => a.name.localeCompare(b.name, "en-GB")),
    },
    print: {
      generatedAt: new Date().toISOString(),
      title: "Multi-Customer Rebate / Net Spend Analysis",
      organisation: "Automotive Brands",
    },
  };
}

export async function exportCustomerRebateSummaryCsv(actorUserId: string, raw: unknown) {
  const data = await getCustomerRebateAnalysis(actorUserId, raw);
  const periodCells = rebatePeriodCsvCells(data.period);
  const csv = buildCsv(
    [
      "Customer",
      "Account",
      "Period",
      "Period From",
      "Period To",
      "Invoice Sales",
      "Credits",
      "Net Spend",
      "Invoice Documents",
      "Credit Documents",
      "Units",
      "Products",
    ],
    [
      [
        data.company.name,
        data.company.autopartCustomerCode ?? data.company.accountNumber ?? "",
        periodCells.periodLabel,
        periodCells.periodFrom,
        periodCells.periodTo,
        data.summary.invoiceSales,
        data.summary.credits,
        data.summary.netSpend,
        data.summary.invoiceDocuments,
        data.summary.creditDocuments,
        data.summary.units,
        data.summary.products,
      ],
    ],
  );
  return { filename: `rebate-summary-${data.company.autopartCustomerCode ?? data.company.id}.csv`, csv };
}

export async function exportCustomerRebateDocumentsCsv(actorUserId: string, raw: unknown) {
  const profile = await requireSalesIntelligence(actorUserId);
  const input = customerSchema.parse(raw ?? {});
  await assertCompanyInScope(profile, input.companyId);
  const { primary } = resolvePeriods(input);
  const company = await loadCompanyContext(input.companyId);
  const lines = await loadHistoricSalesLines({
    companyId: input.companyId,
    range: primary.queryRange,
  });
  const docs = aggregateDocuments(applyRebateEligibilityRules(lines, null));
  const periodCells = rebatePeriodCsvCells(toRebatePeriodDto(primary));
  const csv = buildCsv(
    [
      "Customer",
      "Account",
      "Period",
      "Date",
      "Document Reference",
      "Type",
      "Line Count",
      "Units",
      "Net Value",
    ],
    docs.map((d) => [
      company.name,
      company.autopartCustomerCode ?? company.accountNumber ?? "",
      periodCells.periodLabel,
      d.documentDate ?? "",
      d.documentReference,
      d.documentType === "CREDIT" ? "Credit" : "Invoice",
      d.lineCount,
      d.units,
      moneyMinorToDto(d.netValueMinor),
    ]),
  );
  return {
    filename: `rebate-documents-${company.autopartCustomerCode ?? company.id}.csv`,
    csv,
  };
}

export async function exportCustomerRebateProductsCsv(actorUserId: string, raw: unknown) {
  const data = await getCustomerRebateAnalysis(actorUserId, {
    ...(raw as object),
    page: 1,
    pageSize: 100,
    q: null,
    brandId: null,
    categoryId: null,
    catalogue: "ALL",
    docType: "ALL",
  });
  // Re-fetch unfiltered product list via analysis with large page — pull full via internal path.
  const profile = await requireSalesIntelligence(actorUserId);
  const input = customerSchema.parse(raw ?? {});
  await assertCompanyInScope(profile, input.companyId);
  const { primary } = resolvePeriods(input);
  const company = await loadCompanyContext(input.companyId);
  const lines = await loadHistoricSalesLines({
    companyId: input.companyId,
    range: primary.queryRange,
  });
  const bySku = groupHistoricBySku(applyRebateEligibilityRules(lines, null));
  const skus = [...bySku.keys()];
  const { variantBySku } = await attachCatalogueMeta(skus);
  const periodCells = rebatePeriodCsvCells(toRebatePeriodDto(primary));
  const rows: Array<Array<string | number>> = [];
  for (const [key, entry] of bySku) {
    const v = variantBySku.get(key);
    rows.push([
      company.name,
      company.autopartCustomerCode ?? company.accountNumber ?? "",
      periodCells.periodLabel,
      v?.sku ?? entry.sku,
      v?.name ?? entry.desc ?? entry.sku,
      v?.brandName ?? "Unassigned",
      v?.categoryName ?? "Unassigned",
      moneyMinorToDto(entry.agg.invoiceSalesMinor),
      moneyMinorToDto(entry.agg.creditsMinor),
      moneyMinorToDto(entry.agg.netSalesMinor),
      entry.agg.units,
      entry.agg.invoiceRefs.size,
      entry.agg.lastPurchasedDate ?? "",
    ]);
  }
  rows.sort((a, b) => String(a[3]).localeCompare(String(b[3])));
  const csv = buildCsv(
    [
      "Customer",
      "Account",
      "Period",
      "SKU",
      "Product",
      "Brand",
      "Category",
      "Invoice Sales",
      "Credits",
      "Net Spend",
      "Units",
      "Invoice Documents",
      "Last Purchased",
    ],
    rows,
  );
  void data;
  return {
    filename: `rebate-products-${company.autopartCustomerCode ?? company.id}.csv`,
    csv,
  };
}

export async function exportMultiCustomerRebateCsv(actorUserId: string, raw: unknown) {
  // Full filtered dataset — page through with large page size by calling core with high limit.
  const data = await getMultiCustomerRebateAnalysis(actorUserId, {
    ...(typeof raw === "object" && raw ? raw : {}),
    page: 1,
    pageSize: 100,
  });
  // Re-run aggregation for full export without pagination cap issues.
  const profile = await requireSalesIntelligence(actorUserId);
  const input = multiSchema.parse(raw ?? {});
  const scope = await resolveSalesIntelligenceCompanyScope(profile);
  const { primary } = resolvePeriods(input);
  const companyFilter =
    scope === "all" ? undefined : { in: scope.length ? scope : ["__none__"] };
  const lines = await loadHistoricSalesLines({
    companyId: companyFilter,
    range: primary.queryRange,
  });
  const eligible = applyRebateEligibilityRules(lines, null);
  const byCompany = new Map<string, HistoricLineRow[]>();
  for (const line of eligible) {
    const list = byCompany.get(line.companyId) ?? [];
    list.push(line);
    byCompany.set(line.companyId, list);
  }
  const companyIds = [...byCompany.keys()];
  const companies = companyIds.length
    ? await prisma.company.findMany({
        where: { id: { in: companyIds } },
        select: {
          id: true,
          name: true,
          accountNumber: true,
          autopartCustomerCode: true,
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
      })
    : [];
  const companyMap = new Map(companies.map((c) => [c.id, c]));

  let exportRows: MultiRow[] = [];
  for (const [companyId, group] of byCompany) {
    const spend = spendSummaryFromLines(group);
    const co = companyMap.get(companyId);
    const rep = co?.assignments[0]?.salesRep;
    exportRows.push({
      companyId,
      name: co?.name ?? companyId,
      accountNumber: co?.accountNumber ?? null,
      autopartCustomerCode: co?.autopartCustomerCode ?? null,
      salesperson: rep
        ? {
            id: rep.id,
            name: rep.displayName || rep.user.name || rep.user.email,
          }
        : null,
      invoiceSales: spend.invoiceSales,
      credits: spend.credits,
      netSpend: spend.netSpend,
      netSpendMinor: spend.totals.netSalesMinor,
      creditsAbsMinor:
        spend.totals.creditsMinor < 0n ? -spend.totals.creditsMinor : spend.totals.creditsMinor,
      invoiceSalesMinor: spend.totals.invoiceSalesMinor,
      invoiceDocuments: spend.invoiceDocuments,
      creditDocuments: spend.creditDocuments,
      units: spend.units,
    });
  }

  const q = input.q?.trim().toLowerCase() ?? "";
  if (q) {
    exportRows = exportRows.filter(
      (r) =>
        r.name.toLowerCase().includes(q) ||
        (r.accountNumber ?? "").toLowerCase().includes(q) ||
        (r.autopartCustomerCode ?? "").toLowerCase().includes(q),
    );
  }
  if (input.salesRepId) {
    exportRows = exportRows.filter((r) => r.salesperson?.id === input.salesRepId);
  }
  if (input.hasCredits) {
    exportRows = exportRows.filter((r) => r.creditDocuments > 0);
  }
  if (input.minNet) {
    const min = parseMoney(input.minNet)?.minor;
    if (min != null) exportRows = exportRows.filter((r) => r.netSpendMinor >= min);
  }
  if (input.maxNet) {
    const max = parseMoney(input.maxNet)?.minor;
    if (max != null) exportRows = exportRows.filter((r) => r.netSpendMinor <= max);
  }

  exportRows.sort((a, b) =>
    a.netSpendMinor > b.netSpendMinor ? -1 : a.netSpendMinor < b.netSpendMinor ? 1 : 0,
  );

  const periodCells = rebatePeriodCsvCells(toRebatePeriodDto(primary));
  const csv = buildCsv(
    [
      "Customer",
      "Account",
      "Salesperson",
      "Period",
      "Period From",
      "Period To",
      "Invoice Sales",
      "Credits",
      "Net Spend",
      "Invoice Documents",
      "Credit Documents",
      "Units",
    ],
    exportRows.map((r) => [
      r.name,
      r.autopartCustomerCode ?? r.accountNumber ?? "",
      r.salesperson?.name ?? "",
      periodCells.periodLabel,
      periodCells.periodFrom,
      periodCells.periodTo,
      r.invoiceSales,
      r.credits,
      r.netSpend,
      r.invoiceDocuments,
      r.creditDocuments,
      r.units,
    ]),
  );
  void data;
  const fileSuffix = primary.unbounded
    ? "all-history"
    : `${primary.from}_${primary.to}`;
  return { filename: `rebate-multi-customer-${fileSuffix}.csv`, csv };
}
