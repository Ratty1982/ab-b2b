/**
 * Internal Sales Intelligence — factual Gap Analysis.
 * Reuses historic-lines loaders so totals reconcile with Sales Enquiry.
 */
import { z } from "zod";
import { prisma } from "@/infra/database/client";
import { AuthError, requireSystemPermission } from "@/server/rbac/guards";
import type { LoadedAccessProfile } from "@/server/rbac/access";
import { resolveSalesIntelligenceCompanyScope } from "@/server/sales-intelligence/scope";
import {
  groupHistoricByCompany,
  groupHistoricBySku,
  loadHistoricSalesLines,
  summarizeHistoricLines,
} from "@/server/sales-intelligence/historic-lines";
import {
  activityFromAgg,
  bumpStatus,
  classifyGapActivity,
  emptyGapActivity,
  emptyStatusCounts,
  moneyMovement,
  resolveGapPeriods,
  unitsMovement,
  type GapCompareBy,
  type GapCompareMode,
  type GapRowSort,
  type GapStatus,
} from "@/domain/sales-gap";
import { buildCsv, moneyMinorToDto, totalsToDto } from "@/domain/sales-intelligence";
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

const periodSchema = z.object({
  period: z
    .enum(["THIS_MONTH", "LAST_MONTH", "LAST_30", "LAST_90", "LAST_180", "YTD", "LAST_YEAR", "CUSTOM"])
    .optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  compare: z.enum(["PREVIOUS", "PREVIOUS_YEAR", "CUSTOM"]).optional().nullable(),
  compareFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  compareTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  compareBy: z.enum(["UNITS", "NET_SALES"]).optional(),
});

const customerGapSchema = periodSchema.extend({
  companyId: z.string().min(1),
  status: z
    .enum(["ALL_CHANGES", "STOPPED", "DECREASED", "INCREASED", "NEW", "UNCHANGED"])
    .optional(),
  brandId: z.string().optional().nullable(),
  categoryId: z.string().optional().nullable(),
  q: z.string().max(200).optional().nullable(),
  sort: z
    .enum(["NET_DECREASE", "UNIT_DECREASE", "NET_INCREASE", "UNIT_INCREASE", "RECENT", "NAME_AZ"])
    .optional(),
  page: z.number().int().min(1).max(10_000).optional(),
  pageSize: z.number().int().min(1).max(100).optional(),
});

const productGapSchema = periodSchema.extend({
  sku: z.string().min(1).max(120),
  status: z
    .enum(["ALL_CHANGES", "STOPPED", "DECREASED", "INCREASED", "NEW", "UNCHANGED"])
    .optional(),
  salesRepId: z.string().optional().nullable(),
  q: z.string().max(200).optional().nullable(),
  sort: z
    .enum(["NET_DECREASE", "UNIT_DECREASE", "NET_INCREASE", "UNIT_INCREASE", "RECENT", "NAME_AZ"])
    .optional(),
  page: z.number().int().min(1).max(10_000).optional(),
  pageSize: z.number().int().min(1).max(100).optional(),
});

function sortGapRows<
  T extends {
    qtyChange: number;
    netChangeMinor: bigint;
    lastPurchasedDate: string | null;
    name: string;
  },
>(rows: T[], sort: GapRowSort): void {
  rows.sort((a, b) => {
    switch (sort) {
      case "UNIT_DECREASE":
        return a.qtyChange - b.qtyChange || a.name.localeCompare(b.name);
      case "UNIT_INCREASE":
        return b.qtyChange - a.qtyChange || a.name.localeCompare(b.name);
      case "NET_INCREASE":
        if (b.netChangeMinor !== a.netChangeMinor) {
          return b.netChangeMinor > a.netChangeMinor ? 1 : -1;
        }
        return a.name.localeCompare(b.name);
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
      case "NET_DECREASE":
      default:
        if (a.netChangeMinor !== b.netChangeMinor) {
          return a.netChangeMinor < b.netChangeMinor ? -1 : 1;
        }
        return a.name.localeCompare(b.name);
    }
  });
}

function statusMatches(filter: string | undefined, status: GapStatus): boolean {
  const f = filter ?? "ALL_CHANGES";
  if (f === "ALL_CHANGES") return status !== "UNCHANGED";
  return status === f;
}

export async function getCustomerGapAnalysis(actorUserId: string, raw: unknown) {
  const profile = await requireSi(actorUserId);
  const input = customerGapSchema.parse(raw ?? {});
  await assertCompanyInScope(profile, input.companyId);
  const { recordStaffWorkspaceOpen } = await import("@/server/audit/staff-workspace-open");
  void recordStaffWorkspaceOpen({
    actorUserId: profile.userId,
    action: "si.gaps.opened",
    detail: "Opened gap analysis",
  });
  const compareBy = (input.compareBy ?? "UNITS") as GapCompareBy;
  const { selected, comparison } = resolveGapPeriods({
    period: input.period,
    from: input.from,
    to: input.to,
    compare: (input.compare ?? "PREVIOUS") as GapCompareMode,
    compareFrom: input.compareFrom,
    compareTo: input.compareTo,
  });

  const company = await prisma.company.findUnique({
    where: { id: input.companyId },
    select: {
      id: true,
      name: true,
      autopartCustomerCode: true,
      accountNumber: true,
      paymentTerms: true,
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

  const [selectedLines, comparisonLines] = await Promise.all([
    loadHistoricSalesLines({ companyId: input.companyId, range: selected }),
    loadHistoricSalesLines({ companyId: input.companyId, range: comparison }),
  ]);

  const selectedTotalsRaw = summarizeHistoricLines(selectedLines);
  const comparisonTotalsRaw = summarizeHistoricLines(comparisonLines);
  const selectedTotals = totalsToDto(selectedTotalsRaw);
  const comparisonTotals = totalsToDto(comparisonTotalsRaw);

  const selectedBySku = groupHistoricBySku(selectedLines);
  const comparisonBySku = groupHistoricBySku(comparisonLines);
  const keys = new Set([...selectedBySku.keys(), ...comparisonBySku.keys()]);

  const variants = keys.size
    ? await prisma.productVariant.findMany({
        where: {
          OR: [...keys].map((sku) => ({ sku: { equals: sku, mode: "insensitive" as const } })),
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

  type Row = {
    status: GapStatus;
    sku: string;
    name: string;
    brandId: string | null;
    brandName: string | null;
    categoryId: string | null;
    categoryName: string | null;
    inCatalogue: boolean;
    comparisonQty: number;
    selectedQty: number;
    qtyChange: number;
    comparisonInvoiceSales: string;
    comparisonCredits: string;
    comparisonNetSales: string;
    selectedInvoiceSales: string;
    selectedCredits: string;
    selectedNetSales: string;
    selectedNetMinor: bigint;
    comparisonNetMinor: bigint;
    netChange: string;
    netChangeMinor: bigint;
    lastPurchasedDate: string | null;
    availabilityBand: PublicAvailability | "historic";
    availabilityLabel: string;
  };

  const allRows: Row[] = [];
  const brandOptions = new Map<string, string>();
  const categoryOptions = new Map<string, string>();

  for (const key of keys) {
    const selEntry = selectedBySku.get(key);
    const cmpEntry = comparisonBySku.get(key);
    const selAct = selEntry ? activityFromAgg(selEntry.agg) : emptyGapActivity();
    const cmpAct = cmpEntry ? activityFromAgg(cmpEntry.agg) : emptyGapActivity();
    const status = classifyGapActivity(selAct, cmpAct, compareBy);
    if (!status) continue;

    const v = variantBySku.get(key);
    const product = v?.product;
    if (product?.brand) brandOptions.set(product.brand.id, product.brand.name);
    if (product?.category) categoryOptions.set(product.category.id, product.category.name);
    const stock = v ? stockMap.get(v.id) : undefined;
    const band = (stock?.availability ?? null) as PublicAvailability | null;
    const displaySku = v?.sku ?? selEntry?.sku ?? cmpEntry?.sku ?? key;
    const name = product?.name ?? selEntry?.desc ?? cmpEntry?.desc ?? displaySku;
    const lastPurchased =
      [selAct.lastInvoiceDate, cmpAct.lastInvoiceDate].filter(Boolean).sort().at(-1) ?? null;

    allRows.push({
      status,
      sku: displaySku,
      name,
      brandId: product?.brandId ?? null,
      brandName: product?.brand?.name ?? null,
      categoryId: product?.categoryId ?? null,
      categoryName: product?.category?.name ?? null,
      inCatalogue: Boolean(product),
      comparisonQty: cmpAct.invoiceUnits,
      selectedQty: selAct.invoiceUnits,
      qtyChange: selAct.invoiceUnits - cmpAct.invoiceUnits,
      comparisonInvoiceSales: moneyMinorToDto(cmpAct.invoiceSalesMinor),
      comparisonCredits: moneyMinorToDto(cmpAct.creditsMinor),
      comparisonNetSales: moneyMinorToDto(cmpAct.netSalesMinor),
      selectedInvoiceSales: moneyMinorToDto(selAct.invoiceSalesMinor),
      selectedCredits: moneyMinorToDto(selAct.creditsMinor),
      selectedNetSales: moneyMinorToDto(selAct.netSalesMinor),
      selectedNetMinor: selAct.netSalesMinor,
      comparisonNetMinor: cmpAct.netSalesMinor,
      netChange: moneyMinorToDto(selAct.netSalesMinor - cmpAct.netSalesMinor),
      netChangeMinor: selAct.netSalesMinor - cmpAct.netSalesMinor,
      lastPurchasedDate: lastPurchased,
      availabilityBand: product ? band ?? "in" : "historic",
      availabilityLabel: product
        ? band
          ? PUBLIC_AVAILABILITY_LABEL[band]
          : "Available to order"
        : "Historic Only",
    });
  }

  const summaryCounts = emptyStatusCounts();
  for (const r of allRows) bumpStatus(summaryCounts, r.status);

  let filtered = allRows.filter((r) => statusMatches(input.status, r.status));
  if (input.q?.trim()) {
    const qq = input.q.trim().toLowerCase();
    filtered = filtered.filter(
      (r) => r.sku.toLowerCase().includes(qq) || r.name.toLowerCase().includes(qq),
    );
  }
  if (input.brandId) filtered = filtered.filter((r) => r.brandId === input.brandId);
  if (input.categoryId) filtered = filtered.filter((r) => r.categoryId === input.categoryId);

  let movementSource = allRows;
  if (input.q?.trim()) {
    const qq = input.q.trim().toLowerCase();
    movementSource = movementSource.filter(
      (r) => r.sku.toLowerCase().includes(qq) || r.name.toLowerCase().includes(qq),
    );
  }
  if (input.brandId) movementSource = movementSource.filter((r) => r.brandId === input.brandId);
  if (input.categoryId) {
    movementSource = movementSource.filter((r) => r.categoryId === input.categoryId);
  }

  const brandMovement = new Map<
    string,
    { key: string; label: string; comparisonNetMinor: bigint; selectedNetMinor: bigint }
  >();
  const categoryMovement = new Map<
    string,
    { key: string; label: string; comparisonNetMinor: bigint; selectedNetMinor: bigint }
  >();
  for (const r of movementSource) {
    const bKey = r.brandId ?? "__none__";
    let b = brandMovement.get(bKey);
    if (!b) {
      b = {
        key: bKey,
        label: r.brandName ?? "Unassigned brand",
        comparisonNetMinor: 0n,
        selectedNetMinor: 0n,
      };
      brandMovement.set(bKey, b);
    }
    b.selectedNetMinor += r.selectedNetMinor;
    b.comparisonNetMinor += r.comparisonNetMinor;

    const cKey = r.categoryId ?? "__none__";
    let c = categoryMovement.get(cKey);
    if (!c) {
      c = {
        key: cKey,
        label: r.categoryName ?? "Unassigned category",
        comparisonNetMinor: 0n,
        selectedNetMinor: 0n,
      };
      categoryMovement.set(cKey, c);
    }
    c.selectedNetMinor += r.selectedNetMinor;
    c.comparisonNetMinor += r.comparisonNetMinor;
  }

  const sort = (input.sort ?? "NET_DECREASE") as GapRowSort;
  sortGapRows(filtered, sort);

  const page = input.page ?? 1;
  const pageSize = input.pageSize ?? 25;
  const total = filtered.length;
  const pageItems = filtered.slice((page - 1) * pageSize, page * pageSize).map(
    ({ netChangeMinor: _n, selectedNetMinor: _s, comparisonNetMinor: _c, ...rest }) => rest,
  );

  const rep = company.assignments[0]?.salesRep;

  return {
    dataSource:
      "Autopart historic sales (561L + SLRB). AB Orders and 504C are not included in these totals.",
    company: {
      id: company.id,
      name: company.name,
      autopartCustomerCode: company.autopartCustomerCode,
      accountNumber: company.accountNumber,
      paymentTerms: company.paymentTerms,
      salesperson: rep
        ? { id: rep.id, name: rep.displayName || rep.user.name || rep.user.email }
        : null,
    },
    selectedPeriod: selected,
    comparisonPeriod: comparison,
    compareBy,
    statusCounts: summaryCounts,
    overall: {
      netSales: moneyMovement(selectedTotalsRaw.netSalesMinor, comparisonTotalsRaw.netSalesMinor),
      units: unitsMovement(selectedTotalsRaw.units, comparisonTotalsRaw.units),
      selected: selectedTotals,
      comparison: comparisonTotals,
    },
    items: { items: pageItems, page, pageSize, total },
    brandMovement: [...brandMovement.values()]
      .map((b) => ({
        key: b.key,
        label: b.label,
        comparisonNetSales: moneyMinorToDto(b.comparisonNetMinor),
        selectedNetSales: moneyMinorToDto(b.selectedNetMinor),
        change: moneyMinorToDto(b.selectedNetMinor - b.comparisonNetMinor),
      }))
      .sort((a, b) => Number(a.change) - Number(b.change) || a.label.localeCompare(b.label)),
    categoryMovement: [...categoryMovement.values()]
      .map((c) => ({
        key: c.key,
        label: c.label,
        comparisonNetSales: moneyMinorToDto(c.comparisonNetMinor),
        selectedNetSales: moneyMinorToDto(c.selectedNetMinor),
        change: moneyMinorToDto(c.selectedNetMinor - c.comparisonNetMinor),
      }))
      .sort((a, b) => Number(a.change) - Number(b.change) || a.label.localeCompare(b.label)),
    filterOptions: {
      brands: [...brandOptions.entries()]
        .map(([id, name]) => ({ id, name }))
        .sort((a, b) => a.name.localeCompare(b.name, "en-GB")),
      categories: [...categoryOptions.entries()]
        .map(([id, name]) => ({ id, name }))
        .sort((a, b) => a.name.localeCompare(b.name, "en-GB")),
    },
  };
}

export async function getProductGapAnalysis(actorUserId: string, raw: unknown) {
  const profile = await requireSi(actorUserId);
  const input = productGapSchema.parse(raw ?? {});
  const scope = await resolveSalesIntelligenceCompanyScope(profile);
  const compareBy = (input.compareBy ?? "UNITS") as GapCompareBy;
  const { selected, comparison } = resolveGapPeriods({
    period: input.period,
    from: input.from,
    to: input.to,
    compare: (input.compare ?? "PREVIOUS") as GapCompareMode,
    compareFrom: input.compareFrom,
    compareTo: input.compareTo,
  });

  const skuFilter = { equals: input.sku.trim(), mode: "insensitive" as const };
  const companyFilter =
    scope === "all" ? null : ({ in: scope.length ? scope : ["__none__"] } as const);

  const [selectedLines, comparisonLines] = await Promise.all([
    loadHistoricSalesLines({
      ...(companyFilter ? { companyId: companyFilter } : {}),
      sku: skuFilter,
      range: selected,
    }),
    loadHistoricSalesLines({
      ...(companyFilter ? { companyId: companyFilter } : {}),
      sku: skuFilter,
      range: comparison,
    }),
  ]);

  const selectedTotalsRaw = summarizeHistoricLines(selectedLines);
  const comparisonTotalsRaw = summarizeHistoricLines(comparisonLines);

  const selectedByCo = groupHistoricByCompany(selectedLines);
  const comparisonByCo = groupHistoricByCompany(comparisonLines);
  const companyIds = [...new Set([...selectedByCo.keys(), ...comparisonByCo.keys()])];

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

  const variant = await prisma.productVariant.findFirst({
    where: { sku: skuFilter },
    select: {
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
  const historicDesc =
    selectedLines.find((l) => l.descriptionSnapshot?.trim())?.descriptionSnapshot?.trim() ??
    comparisonLines.find((l) => l.descriptionSnapshot?.trim())?.descriptionSnapshot?.trim() ??
    null;

  type Row = {
    status: GapStatus;
    companyId: string;
    name: string;
    account: string | null;
    salespersonId: string | null;
    salespersonName: string | null;
    comparisonQty: number;
    selectedQty: number;
    qtyChange: number;
    comparisonInvoiceSales: string;
    comparisonCredits: string;
    comparisonNetSales: string;
    selectedInvoiceSales: string;
    selectedCredits: string;
    selectedNetSales: string;
    netChange: string;
    netChangeMinor: bigint;
    lastPurchasedDate: string | null;
  };

  const allRows: Row[] = [];
  for (const companyId of companyIds) {
    const selAgg = selectedByCo.get(companyId);
    const cmpAgg = comparisonByCo.get(companyId);
    const selAct = selAgg ? activityFromAgg(selAgg) : emptyGapActivity();
    const cmpAct = cmpAgg ? activityFromAgg(cmpAgg) : emptyGapActivity();
    const status = classifyGapActivity(selAct, cmpAct, compareBy);
    if (!status) continue;
    const c = companyById.get(companyId);
    const rep = c?.assignments[0]?.salesRep;
    const lastPurchased =
      [selAct.lastInvoiceDate, cmpAct.lastInvoiceDate].filter(Boolean).sort().at(-1) ?? null;
    allRows.push({
      status,
      companyId,
      name: c?.name ?? "Unknown customer",
      account: c?.autopartCustomerCode ?? c?.accountNumber ?? null,
      salespersonId: rep?.id ?? null,
      salespersonName: rep ? rep.displayName || rep.user.name || rep.user.email : null,
      comparisonQty: cmpAct.invoiceUnits,
      selectedQty: selAct.invoiceUnits,
      qtyChange: selAct.invoiceUnits - cmpAct.invoiceUnits,
      comparisonInvoiceSales: moneyMinorToDto(cmpAct.invoiceSalesMinor),
      comparisonCredits: moneyMinorToDto(cmpAct.creditsMinor),
      comparisonNetSales: moneyMinorToDto(cmpAct.netSalesMinor),
      selectedInvoiceSales: moneyMinorToDto(selAct.invoiceSalesMinor),
      selectedCredits: moneyMinorToDto(selAct.creditsMinor),
      selectedNetSales: moneyMinorToDto(selAct.netSalesMinor),
      netChange: moneyMinorToDto(selAct.netSalesMinor - cmpAct.netSalesMinor),
      netChangeMinor: selAct.netSalesMinor - cmpAct.netSalesMinor,
      lastPurchasedDate: lastPurchased,
    });
  }

  const summaryCounts = emptyStatusCounts();
  for (const r of allRows) bumpStatus(summaryCounts, r.status);

  const salespeople = new Map<string, string>();
  for (const r of allRows) {
    if (r.salespersonId && r.salespersonName) {
      salespeople.set(r.salespersonId, r.salespersonName);
    }
  }

  let filtered = allRows.filter((r) => statusMatches(input.status, r.status));
  if (input.q?.trim()) {
    const qq = input.q.trim().toLowerCase();
    filtered = filtered.filter(
      (r) =>
        r.name.toLowerCase().includes(qq) || (r.account?.toLowerCase().includes(qq) ?? false),
    );
  }
  if (input.salesRepId) {
    filtered = filtered.filter((r) => r.salespersonId === input.salesRepId);
  }

  const sort = (input.sort ?? "NET_DECREASE") as GapRowSort;
  sortGapRows(filtered, sort);

  const page = input.page ?? 1;
  const pageSize = input.pageSize ?? 25;
  const total = filtered.length;
  const pageItems = filtered
    .slice((page - 1) * pageSize, page * pageSize)
    .map(({ netChangeMinor: _n, ...rest }) => rest);

  return {
    dataSource:
      "Autopart historic sales (561L + SLRB). AB Orders and 504C are not included in these totals.",
    product: {
      sku: variant?.sku ?? input.sku.trim(),
      name: variant?.product.name ?? historicDesc ?? input.sku.trim(),
      brandName: variant?.product.brand?.name ?? null,
      categoryName: variant?.product.category?.name ?? null,
      inCatalogue: Boolean(variant),
    },
    selectedPeriod: selected,
    comparisonPeriod: comparison,
    compareBy,
    statusCounts: summaryCounts,
    overall: {
      netSales: moneyMovement(selectedTotalsRaw.netSalesMinor, comparisonTotalsRaw.netSalesMinor),
      units: unitsMovement(selectedTotalsRaw.units, comparisonTotalsRaw.units),
      customers: unitsMovement(selectedTotalsRaw.customers, comparisonTotalsRaw.customers),
      selected: totalsToDto(selectedTotalsRaw),
      comparison: totalsToDto(comparisonTotalsRaw),
    },
    items: { items: pageItems, page, pageSize, total },
    filterOptions: {
      salespeople: [...salespeople.entries()]
        .map(([id, name]) => ({ id, name }))
        .sort((a, b) => a.name.localeCompare(b.name, "en-GB")),
    },
  };
}

export async function exportCustomerGapCsv(actorUserId: string, raw: unknown) {
  const input = customerGapSchema.parse(raw ?? {});
  const all: Awaited<ReturnType<typeof getCustomerGapAnalysis>>["items"]["items"] = [];
  let page = 1;
  let total = Infinity;
  let meta: Awaited<ReturnType<typeof getCustomerGapAnalysis>> | null = null;
  while (all.length < total && page < 200) {
    const next = await getCustomerGapAnalysis(actorUserId, {
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
    "Account",
    "Selected From",
    "Selected To",
    "Comparison From",
    "Comparison To",
    "Status",
    "SKU",
    "Product",
    "Brand",
    "Category",
    "Comparison Qty",
    "Selected Qty",
    "Qty Change",
    "Comparison Invoice Sales",
    "Comparison Credits",
    "Comparison Net Sales",
    "Selected Invoice Sales",
    "Selected Credits",
    "Selected Net Sales",
    "Net Sales Change",
    "Last Purchased",
  ];
  const rows = all.map((r) => [
    meta!.company.name,
    meta!.company.autopartCustomerCode ?? meta!.company.accountNumber ?? "",
    meta!.selectedPeriod.from,
    meta!.selectedPeriod.to,
    meta!.comparisonPeriod.from,
    meta!.comparisonPeriod.to,
    r.status,
    r.sku,
    r.name,
    r.brandName ?? "",
    r.categoryName ?? "",
    r.comparisonQty,
    r.selectedQty,
    r.qtyChange,
    r.comparisonInvoiceSales,
    r.comparisonCredits,
    r.comparisonNetSales,
    r.selectedInvoiceSales,
    r.selectedCredits,
    r.selectedNetSales,
    r.netChange,
    r.lastPurchasedDate ?? "",
  ]);
  return {
    filename: `gap-customer-${meta!.company.autopartCustomerCode ?? meta!.company.id}-${meta!.selectedPeriod.from}_${meta!.selectedPeriod.to}.csv`,
    csv: buildCsv(headers, rows),
  };
}

export async function exportProductGapCsv(actorUserId: string, raw: unknown) {
  const input = productGapSchema.parse(raw ?? {});
  const all: Awaited<ReturnType<typeof getProductGapAnalysis>>["items"]["items"] = [];
  let page = 1;
  let total = Infinity;
  let meta: Awaited<ReturnType<typeof getProductGapAnalysis>> | null = null;
  while (all.length < total && page < 200) {
    const next = await getProductGapAnalysis(actorUserId, {
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
    "SKU",
    "Product",
    "Selected From",
    "Selected To",
    "Comparison From",
    "Comparison To",
    "Status",
    "Customer",
    "Account",
    "Salesperson",
    "Comparison Qty",
    "Selected Qty",
    "Qty Change",
    "Comparison Invoice Sales",
    "Comparison Credits",
    "Comparison Net Sales",
    "Selected Invoice Sales",
    "Selected Credits",
    "Selected Net Sales",
    "Net Sales Change",
    "Last Purchased",
  ];
  const rows = all.map((r) => [
    meta!.product.sku,
    meta!.product.name,
    meta!.selectedPeriod.from,
    meta!.selectedPeriod.to,
    meta!.comparisonPeriod.from,
    meta!.comparisonPeriod.to,
    r.status,
    r.name,
    r.account ?? "",
    r.salespersonName ?? "",
    r.comparisonQty,
    r.selectedQty,
    r.qtyChange,
    r.comparisonInvoiceSales,
    r.comparisonCredits,
    r.comparisonNetSales,
    r.selectedInvoiceSales,
    r.selectedCredits,
    r.selectedNetSales,
    r.netChange,
    r.lastPurchasedDate ?? "",
  ]);
  return {
    filename: `gap-product-${meta!.product.sku.replace(/[^\w.-]+/g, "_")}-${meta!.selectedPeriod.from}_${meta!.selectedPeriod.to}.csv`,
    csv: buildCsv(headers, rows),
  };
}
