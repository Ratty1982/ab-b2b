import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { StatusBadge } from "@/components/ab/Badges";
import { SiInternalStockLines, SiSkuMeta } from "@/components/sales-intelligence/product-kind";
import {
  SalesIntelligenceHeader,
  SiClearFiltersButton,
  SiComparisonSummary,
  SiEntityContext,
  SiExportButton,
  SiField,
  SiGapStatusCard,
  SiModeSwitch,
  SiMovementValue,
  SiPager,
  SiPeriodSummary,
  SiProvenance,
  SiStickyTableHead,
  SiViewEnquiryLink,
  SI_PERIOD_OPTIONS,
  siControlClassName,
} from "@/components/sales-intelligence/workspace";
import { useSalesIntelligenceFreshnessLabel } from "@/components/sales-intelligence/freshness";
import { ROUTES } from "@/lib/app-nav";
import { formatQuoteDateOnlyUk } from "@/domain/quote";
import type { SalesEnquiryPeriodPreset } from "@/domain/sales-history-period";
import {
  compactGapUrlSearch,
  parseGapUrlSearch,
  type GapCompareMode,
  type GapUrlSearch,
} from "@/domain/sales-gap";
import { formatGbp } from "@/domain/sales-intelligence";
import {
  clearedGapTableFilters,
  gapStatusLabel,
  hasActiveGapTableFilters,
  shouldShowEntitySuggestions,
  toggleGapStatusFilter,
} from "@/domain/sales-intelligence-ux";
import {
  CreateFollowUpDrawer,
  SiCreateFollowUpButton,
  type FollowUpRequest,
} from "@/components/sales-intelligence/create-followup-drawer";
import {
  exportCustomerGapCsvFn,
  exportProductGapCsvFn,
  getCustomerGapAnalysisFn,
  getProductGapAnalysisFn,
  searchSalesIntelligenceCustomersFn,
  searchSalesIntelligenceProductsFn,
} from "@/server/phase2/fns";

export const Route = createFileRoute("/sales/sales-intelligence/gaps")({
  validateSearch: (search: Record<string, unknown>): GapUrlSearch => parseGapUrlSearch(search),
  head: () => ({
    meta: [
      { title: "Gap Analysis — Sales Intelligence — Automotive Brands" },
      {
        name: "description",
        content: "Factual period comparison of customer and product purchase activity.",
      },
    ],
  }),
  component: GapAnalysisPage,
});

type CustomerHit = {
  id: string;
  name: string;
  autopartCustomerCode: string | null;
  accountNumber: string | null;
  salesperson: { name: string } | null;
};
type ProductHit = {
  sku: string;
  name: string;
  brandName: string | null;
  inCatalogue: boolean;
  productKind?: string;
  productKindLabel?: string;
};
type CustomerGap = Extract<Awaited<ReturnType<typeof getCustomerGapAnalysisFn>>, { ok: true }>["data"];
type ProductGap = Extract<Awaited<ReturnType<typeof getProductGapAnalysisFn>>, { ok: true }>["data"];

function gbp(v: string) {
  return formatGbp(v);
}

function statusTone(status: string): "bad" | "warn" | "good" | "brand" | "neutral" {
  if (status === "STOPPED") return "bad";
  if (status === "DECREASED") return "warn";
  if (status === "INCREASED") return "good";
  if (status === "NEW") return "brand";
  return "neutral";
}

function GapAnalysisPage() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const freshnessLabel = useSalesIntelligenceFreshnessLabel();
  const mode = search.mode ?? "customers";
  const period = (search.period ?? "LAST_30") as SalesEnquiryPeriodPreset;
  const compare = (search.compare ?? "PREVIOUS") as GapCompareMode;
  const compareBy = search.compareBy ?? "UNITS";
  const status = search.status ?? "ALL_CHANGES";
  const sort = search.sort ?? "NET_DECREASE";
  const page = search.page ?? 1;

  const [customerQ, setCustomerQ] = useState("");
  const [productQ, setProductQ] = useState("");
  const [changingEntity, setChangingEntity] = useState(false);
  const [customerHits, setCustomerHits] = useState<CustomerHit[]>([]);
  const [productHits, setProductHits] = useState<ProductHit[]>([]);
  const [filterQ, setFilterQ] = useState(search.q ?? "");
  const [customerData, setCustomerData] = useState<CustomerGap | null>(null);
  const [productData, setProductData] = useState<ProductGap | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [followUp, setFollowUp] = useState<FollowUpRequest | null>(null);

  function patch(next: {
    mode?: "customers" | "products";
    companyId?: string | null;
    sku?: string | null;
    period?: SalesEnquiryPeriodPreset;
    from?: string | null;
    to?: string | null;
    compare?: GapCompareMode;
    compareFrom?: string | null;
    compareTo?: string | null;
    compareBy?: "UNITS" | "NET_SALES";
    status?: string | null;
    brandId?: string | null;
    categoryId?: string | null;
    salesRepId?: string | null;
    q?: string | null;
    sort?: string | null;
    page?: number;
  }) {
    const draft: GapUrlSearch = {};
    const nextMode = next.mode ?? mode;
    const nextCompany =
      next.companyId === null ? undefined : (next.companyId ?? search.companyId);
    const nextSku = next.sku === null ? undefined : (next.sku ?? search.sku);
    const nextPeriod = next.period ?? period;
    const nextFrom = next.from === null ? undefined : (next.from ?? search.from);
    const nextTo = next.to === null ? undefined : (next.to ?? search.to);
    const nextCompare = next.compare ?? compare;
    const nextCompareFrom =
      next.compareFrom === null ? undefined : (next.compareFrom ?? search.compareFrom);
    const nextCompareTo =
      next.compareTo === null ? undefined : (next.compareTo ?? search.compareTo);
    const nextCompareBy = next.compareBy ?? compareBy;
    const nextStatus = next.status === null ? undefined : (next.status ?? status);
    const nextBrand = next.brandId === null ? undefined : (next.brandId ?? search.brandId);
    const nextCat = next.categoryId === null ? undefined : (next.categoryId ?? search.categoryId);
    const nextRep = next.salesRepId === null ? undefined : (next.salesRepId ?? search.salesRepId);
    const nextQ = next.q === null ? undefined : (next.q ?? search.q);
    const nextSort = next.sort === null ? undefined : (next.sort ?? sort);
    const nextPage = next.page ?? page;

    if (nextMode !== "customers") draft.mode = nextMode;
    if (nextCompany) draft.companyId = nextCompany;
    if (nextSku) draft.sku = nextSku;
    if (nextPeriod !== "LAST_30") draft.period = nextPeriod;
    if (nextPeriod === "CUSTOM") {
      if (nextFrom) draft.from = nextFrom;
      if (nextTo) draft.to = nextTo;
    }
    if (nextCompare !== "PREVIOUS") draft.compare = nextCompare;
    if (nextCompare === "CUSTOM") {
      if (nextCompareFrom) draft.compareFrom = nextCompareFrom;
      if (nextCompareTo) draft.compareTo = nextCompareTo;
    }
    if (nextCompareBy !== "UNITS") draft.compareBy = nextCompareBy;
    if (nextStatus && nextStatus !== "ALL_CHANGES") draft.status = nextStatus;
    if (nextBrand) draft.brandId = nextBrand;
    if (nextCat) draft.categoryId = nextCat;
    if (nextRep) draft.salesRepId = nextRep;
    if (nextQ) draft.q = nextQ;
    if (nextSort && nextSort !== "NET_DECREASE") draft.sort = nextSort;
    if (nextPage > 1) draft.page = nextPage;
    void navigate({ search: compactGapUrlSearch(draft) });
  }

  useEffect(() => {
    if (mode !== "customers" || customerQ.trim().length < 1) {
      setCustomerHits([]);
      return;
    }
    const t = window.setTimeout(() => {
      void searchSalesIntelligenceCustomersFn({ data: { q: customerQ.trim(), limit: 15 } }).then(
        (r) => {
          if (r.ok) setCustomerHits(r.data.items as CustomerHit[]);
        },
      );
    }, 200);
    return () => window.clearTimeout(t);
  }, [customerQ, mode]);

  useEffect(() => {
    if (mode !== "products" || productQ.trim().length < 1) {
      setProductHits([]);
      return;
    }
    const t = window.setTimeout(() => {
      void searchSalesIntelligenceProductsFn({ data: { q: productQ.trim(), limit: 15 } }).then(
        (r) => {
          if (r.ok) setProductHits(r.data.items as ProductHit[]);
        },
      );
    }, 200);
    return () => window.clearTimeout(t);
  }, [productQ, mode]);

  useEffect(() => {
    const t = window.setTimeout(() => {
      if ((filterQ.trim() || "") === (search.q ?? "")) return;
      patch({ q: filterQ.trim() || null, page: 1 });
    }, 250);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterQ]);

  useEffect(() => {
    setFilterQ(search.q ?? "");
  }, [search.q]);

  useEffect(() => {
    setChangingEntity(false);
    setCustomerQ("");
    setProductQ("");
    setCustomerHits([]);
    setProductHits([]);
  }, [search.companyId, search.sku, mode]);

  useEffect(() => {
    if (mode !== "customers" || !search.companyId) {
      setCustomerData(null);
      return;
    }
    void (async () => {
      setLoading(true);
      const r = await getCustomerGapAnalysisFn({
        data: {
          companyId: search.companyId,
          period,
          from: search.from ?? null,
          to: search.to ?? null,
          compare,
          compareFrom: search.compareFrom ?? null,
          compareTo: search.compareTo ?? null,
          compareBy,
          status,
          brandId: search.brandId ?? null,
          categoryId: search.categoryId ?? null,
          q: search.q ?? null,
          sort,
          page,
          pageSize: 25,
        },
      });
      if (!r.ok) {
        setError(r.error);
        setCustomerData(null);
      } else {
        setError(null);
        setCustomerData(r.data);
      }
      setLoading(false);
    })();
  }, [
    mode,
    search.companyId,
    period,
    search.from,
    search.to,
    compare,
    search.compareFrom,
    search.compareTo,
    compareBy,
    status,
    search.brandId,
    search.categoryId,
    search.q,
    sort,
    page,
  ]);

  useEffect(() => {
    if (mode !== "products" || !search.sku) {
      setProductData(null);
      return;
    }
    void (async () => {
      setLoading(true);
      const r = await getProductGapAnalysisFn({
        data: {
          sku: search.sku,
          period,
          from: search.from ?? null,
          to: search.to ?? null,
          compare,
          compareFrom: search.compareFrom ?? null,
          compareTo: search.compareTo ?? null,
          compareBy,
          status,
          salesRepId: search.salesRepId ?? null,
          q: search.q ?? null,
          sort,
          page,
          pageSize: 25,
        },
      });
      if (!r.ok) {
        setError(r.error);
        setProductData(null);
      } else {
        setError(null);
        setProductData(r.data);
      }
      setLoading(false);
    })();
  }, [
    mode,
    search.sku,
    period,
    search.from,
    search.to,
    compare,
    search.compareFrom,
    search.compareTo,
    compareBy,
    status,
    search.salesRepId,
    search.q,
    sort,
    page,
  ]);

  const totalPages = useMemo(() => {
    if (mode === "customers" && customerData) {
      return Math.max(1, Math.ceil(customerData.items.total / customerData.items.pageSize));
    }
    if (mode === "products" && productData) {
      return Math.max(1, Math.ceil(productData.items.total / productData.items.pageSize));
    }
    return 1;
  }, [mode, customerData, productData]);

  const customerSelected = mode === "customers" && Boolean(search.companyId);
  const productSelected = mode === "products" && Boolean(search.sku);
  const showCustomerHits = shouldShowEntitySuggestions({
    entitySelected: customerSelected,
    changing: changingEntity,
    queryLength: customerQ.trim().length,
    hitCount: customerHits.length,
  });
  const showProductHits = shouldShowEntitySuggestions({
    entitySelected: productSelected,
    changing: changingEntity,
    queryLength: productQ.trim().length,
    hitCount: productHits.length,
  });

  async function exportCsv() {
    if (mode === "customers" && search.companyId) {
      const r = await exportCustomerGapCsvFn({
        data: {
          companyId: search.companyId,
          period,
          from: search.from ?? null,
          to: search.to ?? null,
          compare,
          compareFrom: search.compareFrom ?? null,
          compareTo: search.compareTo ?? null,
          compareBy,
          status,
          brandId: search.brandId ?? null,
          categoryId: search.categoryId ?? null,
          q: search.q ?? null,
          sort,
        },
      });
      if (!r.ok) {
        setError(r.error);
        return;
      }
      downloadBlob(r.data.csv, r.data.filename);
    }
    if (mode === "products" && search.sku) {
      const r = await exportProductGapCsvFn({
        data: {
          sku: search.sku,
          period,
          from: search.from ?? null,
          to: search.to ?? null,
          compare,
          compareFrom: search.compareFrom ?? null,
          compareTo: search.compareTo ?? null,
          compareBy,
          status,
          salesRepId: search.salesRepId ?? null,
          q: search.q ?? null,
          sort,
        },
      });
      if (!r.ok) {
        setError(r.error);
        return;
      }
      downloadBlob(r.data.csv, r.data.filename);
    }
  }

  const canExport =
    (mode === "customers" && Boolean(search.companyId)) ||
    (mode === "products" && Boolean(search.sku));

  function clearTableFilters() {
    const cleared = clearedGapTableFilters();
    setFilterQ("");
    patch({
      status: cleared.status,
      compareBy: cleared.compareBy as "UNITS" | "NET_SALES",
      brandId: cleared.brandId,
      categoryId: cleared.categoryId,
      salesRepId: cleared.salesRepId,
      q: cleared.q,
      sort: cleared.sort,
      page: 1,
    });
  }

  return (
    <div>
      <SalesIntelligenceHeader
        title="Gap Analysis"
        freshnessLabel={freshnessLabel}
        actions={canExport ? <SiExportButton onClick={() => void exportCsv()} /> : null}
      />

      <div className="space-y-3 p-4 sm:p-5">
        <SiModeSwitch
          mode={mode}
          onChange={(value) => {
            setChangingEntity(false);
            patch({
              mode: value,
              companyId: value === "customers" ? search.companyId ?? null : null,
              sku: value === "products" ? search.sku ?? null : null,
              page: 1,
              q: null,
            });
          }}
        />

        {mode === "customers" ? (
          customerSelected && customerData && !changingEntity ? (
            <SiEntityContext
              eyebrow="Customer"
              title={customerData.company.name}
              meta={[
                customerData.company.autopartCustomerCode ||
                  customerData.company.accountNumber ||
                  "No Autopart code",
                customerData.company.salesperson?.name ?? "",
              ]}
              onChange={() => setChangingEntity(true)}
              changeLabel="Change customer"
            />
          ) : (
            <SiField label="Customer" className="max-w-xl">
              <input
                className={siControlClassName()}
                placeholder="Search name or Autopart account…"
                value={customerQ}
                onChange={(e) => setCustomerQ(e.target.value)}
                autoFocus={changingEntity}
              />
              {showCustomerHits ? (
                <ul className="mt-1 max-h-48 overflow-auto rounded-md border border-border bg-card text-[13px]">
                  {customerHits.map((c) => (
                    <li key={c.id}>
                      <button
                        type="button"
                        className="flex w-full flex-col px-3 py-2 text-left hover:bg-secondary/60"
                        onClick={() => {
                          setCustomerQ("");
                          setCustomerHits([]);
                          setChangingEntity(false);
                          patch({ companyId: c.id, page: 1 });
                        }}
                      >
                        <span className="font-medium">{c.name}</span>
                        <span className="text-[11px] text-steel">
                          {c.autopartCustomerCode || c.accountNumber || "No Autopart code"}
                          {c.salesperson ? ` · ${c.salesperson.name}` : ""}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </SiField>
          )
        ) : productSelected && productData && !changingEntity ? (
          <SiEntityContext
            eyebrow="Product"
            title={productData.product.name}
            meta={[
              productData.product.sku,
              productData.product.brandName ?? "",
              productData.product.productKindLabel && productData.product.productKind !== "CATALOGUE"
                ? productData.product.productKindLabel
                : "",
            ]}
            onChange={() => setChangingEntity(true)}
            changeLabel="Change product"
          />
        ) : (
          <SiField label="Product / SKU" className="max-w-xl">
            <input
              className={siControlClassName()}
              placeholder="Search SKU, name, historic SKU…"
              value={productQ}
              onChange={(e) => setProductQ(e.target.value)}
              autoFocus={changingEntity}
            />
            {showProductHits ? (
              <ul className="mt-1 max-h-48 overflow-auto rounded-md border border-border bg-card text-[13px]">
                {productHits.map((p) => (
                  <li key={p.sku}>
                    <button
                      type="button"
                      className="flex w-full flex-col px-3 py-2 text-left hover:bg-secondary/60"
                      onClick={() => {
                        setProductQ("");
                        setProductHits([]);
                        setChangingEntity(false);
                        patch({ sku: p.sku, page: 1 });
                      }}
                    >
                      <span className="font-medium">{p.name}</span>
                      <span className="font-mono text-[11px] text-steel">
                        {p.sku}
                        {p.productKindLabel && p.productKind !== "CATALOGUE"
                          ? ` · ${p.productKindLabel}`
                          : p.brandName
                            ? ` · ${p.brandName}`
                            : ""}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </SiField>
        )}

        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 lg:max-w-3xl">
          <SiField label="Selected period">
            <select
              className={siControlClassName(period === "CUSTOM")}
              value={period}
              onChange={(e) =>
                patch({ period: e.target.value as SalesEnquiryPeriodPreset, page: 1 })
              }
            >
              {SI_PERIOD_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </SiField>

          <SiField label="Compare with">
            <select
              className={siControlClassName(compare !== "PREVIOUS")}
              value={compare}
              onChange={(e) => patch({ compare: e.target.value as GapCompareMode, page: 1 })}
            >
              <option value="PREVIOUS">Previous equivalent period</option>
              <option value="PREVIOUS_YEAR">Same period previous year</option>
              <option value="CUSTOM">Custom comparison</option>
            </select>
          </SiField>
        </div>

        {period === "CUSTOM" ? (
          <div className="grid gap-2 sm:grid-cols-2 lg:max-w-xl">
            <SiField label="Selected from">
              <input
                type="date"
                className={siControlClassName(true)}
                value={search.from ?? ""}
                onChange={(e) => patch({ from: e.target.value || null, page: 1 })}
              />
            </SiField>
            <SiField label="Selected to">
              <input
                type="date"
                className={siControlClassName(true)}
                value={search.to ?? ""}
                onChange={(e) => patch({ to: e.target.value || null, page: 1 })}
              />
            </SiField>
          </div>
        ) : null}

        {compare === "CUSTOM" ? (
          <div className="grid gap-2 sm:grid-cols-2 lg:max-w-xl">
            <SiField label="Comparison from">
              <input
                type="date"
                className={siControlClassName(true)}
                value={search.compareFrom ?? ""}
                onChange={(e) => patch({ compareFrom: e.target.value || null })}
              />
            </SiField>
            <SiField label="Comparison to">
              <input
                type="date"
                className={siControlClassName(true)}
                value={search.compareTo ?? ""}
                onChange={(e) => patch({ compareTo: e.target.value || null })}
              />
            </SiField>
          </div>
        ) : null}

        {error ? <p className="text-[13px] text-bad">{error}</p> : null}
        {loading ? <p className="text-[13px] text-steel">Loading gap analysis…</p> : null}

        {mode === "customers" && customerData ? (
          <CustomerGapView
            data={customerData}
            filterQ={filterQ}
            setFilterQ={setFilterQ}
            status={status}
            sort={sort}
            compareBy={compareBy}
            brandId={search.brandId ?? ""}
            categoryId={search.categoryId ?? ""}
            onStatus={(v) => patch({ status: v, page: 1 })}
            onSort={(v) => patch({ sort: v, page: 1 })}
            onCompareBy={(v) => patch({ compareBy: v, page: 1 })}
            onBrand={(v) => patch({ brandId: v || null, page: 1 })}
            onCategory={(v) => patch({ categoryId: v || null, page: 1 })}
            onClearFilters={clearTableFilters}
            page={page}
            totalPages={totalPages}
            onPage={(p) => patch({ page: p })}
            enquiryLink={(sku) =>
              `${ROUTES.salesIntelligence}?mode=customers&companyId=${customerData.company.id}&period=CUSTOM&from=${customerData.selectedPeriod.from}&to=${customerData.selectedPeriod.to}&compare=CUSTOM&compareFrom=${customerData.comparisonPeriod.from}&compareTo=${customerData.comparisonPeriod.to}&q=${encodeURIComponent(sku)}`
            }
            onFollowUp={(sku, reason) =>
              setFollowUp({
                sourceModule: "GAP_ANALYSIS",
                sourceReason: reason,
                companyId: customerData.company.id,
                sku,
                period,
                from: search.from ?? null,
                to: search.to ?? null,
                compare,
                compareFrom: search.compareFrom ?? null,
                compareTo: search.compareTo ?? null,
              })
            }
          />
        ) : null}

        {mode === "products" && productData ? (
          <ProductGapView
            data={productData}
            filterQ={filterQ}
            setFilterQ={setFilterQ}
            status={status}
            sort={sort}
            compareBy={compareBy}
            salesRepId={search.salesRepId ?? ""}
            onStatus={(v) => patch({ status: v, page: 1 })}
            onSort={(v) => patch({ sort: v, page: 1 })}
            onCompareBy={(v) => patch({ compareBy: v, page: 1 })}
            onSalesRep={(v) => patch({ salesRepId: v || null, page: 1 })}
            onClearFilters={clearTableFilters}
            page={page}
            totalPages={totalPages}
            onPage={(p) => patch({ page: p })}
            enquiryLink={(companyId) =>
              `${ROUTES.salesIntelligence}?mode=customers&companyId=${companyId}&period=CUSTOM&from=${productData.selectedPeriod.from}&to=${productData.selectedPeriod.to}&compare=CUSTOM&compareFrom=${productData.comparisonPeriod.from}&compareTo=${productData.comparisonPeriod.to}`
            }
            onFollowUp={(companyId, reason) =>
              setFollowUp({
                sourceModule: "GAP_ANALYSIS",
                sourceReason: reason,
                companyId,
                sku: productData.product.sku,
                period,
                from: search.from ?? null,
                to: search.to ?? null,
                compare,
                compareFrom: search.compareFrom ?? null,
                compareTo: search.compareTo ?? null,
              })
            }
          />
        ) : null}

        <CreateFollowUpDrawer
          open={Boolean(followUp)}
          request={followUp}
          onClose={() => setFollowUp(null)}
        />

        {!loading && mode === "customers" && !search.companyId ? (
          <p className="text-[14px] text-steel">Search and select a customer to compare periods.</p>
        ) : null}
        {!loading && mode === "products" && !search.sku ? (
          <p className="text-[14px] text-steel">Search and select a product to compare periods.</p>
        ) : null}
      </div>
    </div>
  );
}

const GAP_STATUS_CARDS = ["STOPPED", "DECREASED", "INCREASED", "NEW"] as const;

function GapStatusCards({
  counts,
  status,
  mode,
  onStatus,
}: {
  counts: { stopped: number; decreased: number; increased: number; new: number };
  status: string;
  mode: "customers" | "products";
  onStatus: (v: string) => void;
}) {
  const byKey = {
    STOPPED: counts.stopped,
    DECREASED: counts.decreased,
    INCREASED: counts.increased,
    NEW: counts.new,
  } as const;
  return (
    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
      {GAP_STATUS_CARDS.map((s) => (
        <SiGapStatusCard
          key={s}
          status={s}
          count={byKey[s]}
          active={status === s}
          mode={mode}
          onClick={() => onStatus(toggleGapStatusFilter(status, s))}
        />
      ))}
    </div>
  );
}

function CustomerGapView({
  data,
  filterQ,
  setFilterQ,
  status,
  sort,
  compareBy,
  brandId,
  categoryId,
  onStatus,
  onSort,
  onCompareBy,
  onBrand,
  onCategory,
  onClearFilters,
  page,
  totalPages,
  onPage,
  enquiryLink,
  onFollowUp,
}: {
  data: CustomerGap;
  filterQ: string;
  setFilterQ: (v: string) => void;
  status: string;
  sort: string;
  compareBy: string;
  brandId: string;
  categoryId: string;
  onStatus: (v: string) => void;
  onSort: (v: string) => void;
  onCompareBy: (v: "UNITS" | "NET_SALES") => void;
  onBrand: (v: string) => void;
  onCategory: (v: string) => void;
  onClearFilters: () => void;
  page: number;
  totalPages: number;
  onPage: (p: number) => void;
  enquiryLink: (sku: string) => string;
  onFollowUp: (sku: string, reason: "STOPPED" | "DECREASED" | "INCREASED" | "NEW") => void;
}) {
  const filtersActive = hasActiveGapTableFilters({
    status,
    compareBy,
    brandId,
    categoryId,
    q: filterQ,
    sort,
  });

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <SiPeriodSummary
          selectedFrom={data.selectedPeriod.from}
          selectedTo={data.selectedPeriod.to}
          comparisonFrom={data.comparisonPeriod.from}
          comparisonTo={data.comparisonPeriod.to}
        />
        <SiProvenance text={data.dataSource} />
      </div>

      <GapStatusCards
        counts={data.statusCounts}
        status={status}
        mode="customers"
        onStatus={onStatus}
      />

      <SiComparisonSummary
        rows={[
          {
            label: "Net sales",
            selected: String(data.overall.netSales.selected),
            comparison: String(data.overall.netSales.comparison),
            change: data.overall.netSales.change,
            percentChange: data.overall.netSales.percentChange,
            money: true,
          },
          {
            label: "Units",
            selected: String(data.overall.units.selected),
            comparison: String(data.overall.units.comparison),
            change: data.overall.units.change,
            percentChange: data.overall.units.percentChange,
          },
        ]}
      />

      <div className="flex flex-wrap items-end gap-2">
        <SiField label="Status" className="min-w-[9rem]">
          <select
            className={siControlClassName(status !== "ALL_CHANGES")}
            value={status}
            onChange={(e) => onStatus(e.target.value)}
          >
            <option value="ALL_CHANGES">All changes</option>
            <option value="STOPPED">Stopped buying</option>
            <option value="DECREASED">Decreased</option>
            <option value="INCREASED">Increased</option>
            <option value="NEW">New</option>
            <option value="UNCHANGED">Unchanged</option>
          </select>
        </SiField>
        <SiField label="Compare by" className="min-w-[8rem]">
          <select
            className={siControlClassName(compareBy !== "UNITS")}
            value={compareBy}
            onChange={(e) => onCompareBy(e.target.value as "UNITS" | "NET_SALES")}
          >
            <option value="UNITS">Units</option>
            <option value="NET_SALES">Net sales</option>
          </select>
        </SiField>
        <SiField label="Search" className="min-w-[10rem] flex-1">
          <input
            className={siControlClassName(Boolean(filterQ.trim()))}
            value={filterQ}
            onChange={(e) => setFilterQ(e.target.value)}
            placeholder="SKU or name"
          />
        </SiField>
        <SiField label="Brand" className="min-w-[9rem]">
          <select
            className={siControlClassName(Boolean(brandId))}
            value={brandId}
            onChange={(e) => onBrand(e.target.value)}
          >
            <option value="">All brands</option>
            {data.filterOptions.brands.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </SiField>
        <SiField label="Category" className="min-w-[9rem]">
          <select
            className={siControlClassName(Boolean(categoryId))}
            value={categoryId}
            onChange={(e) => onCategory(e.target.value)}
          >
            <option value="">All categories</option>
            {data.filterOptions.categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </SiField>
        <SiField label="Sort" className="min-w-[11rem]">
          <select
            className={siControlClassName(sort !== "NET_DECREASE")}
            value={sort}
            onChange={(e) => onSort(e.target.value)}
          >
            <option value="NET_DECREASE">Largest net sales decrease</option>
            <option value="UNIT_DECREASE">Largest unit decrease</option>
            <option value="NET_INCREASE">Largest net sales increase</option>
            <option value="UNIT_INCREASE">Largest unit increase</option>
            <option value="RECENT">Most recently purchased</option>
            <option value="NAME_AZ">Product A–Z</option>
          </select>
        </SiField>
        {filtersActive ? <SiClearFiltersButton onClick={onClearFilters} /> : null}
      </div>

      {data.items.total === 0 ? (
        <p className="text-[14px] text-steel">
          {Number(data.overall.selected.netSales) === 0 &&
          Number(data.overall.comparison.netSales) === 0 &&
          data.overall.selected.units === 0 &&
          data.overall.comparison.units === 0
            ? "No purchases found in either period."
            : "No changes found between these periods."}
        </p>
      ) : (
        <>
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full text-left text-[13px]">
              <SiStickyTableHead>
                <tr className="border-b-2 border-foreground text-[11px] uppercase tracking-wide text-steel">
                  <th className="py-2 pr-2">Status</th>
                  <th className="py-2 pr-2">Product</th>
                  <th className="py-2 pr-2 text-right">Previous Qty</th>
                  <th className="py-2 pr-2 text-right">Selected Qty</th>
                  <th className="py-2 pr-2 text-right">Qty Change</th>
                  <th className="py-2 pr-2 text-right">Previous Net</th>
                  <th className="py-2 pr-2 text-right">Selected Net</th>
                  <th className="py-2 pr-2 text-right">Net Change</th>
                  <th className="py-2 pr-2">Last Purchased</th>
                  <th className="py-2">Action</th>
                </tr>
              </SiStickyTableHead>
              <tbody>
                {data.items.items.map((r) => (
                  <tr key={r.sku} className="border-b border-border/60">
                    <td className="py-2 pr-2">
                      <StatusBadge tone={statusTone(r.status)}>
                        {gapStatusLabel(r.status)}
                      </StatusBadge>
                    </td>
                    <td className="py-2 pr-2">
                      <div className="font-medium">{r.name}</div>
                      <div>
                        <SiSkuMeta
                          sku={r.sku}
                          brandName={r.brandName}
                          productKind={r.productKind}
                          productKindLabel={r.productKindLabel}
                        />
                      </div>
                      {r.productKind === "HISTORIC_ONLY" ? (
                        <span className="text-[11px] text-steel">{r.availabilityLabel}</span>
                      ) : (
                        <SiInternalStockLines
                          productKind={r.productKind}
                          availLine={r.availLine}
                          incomingLine={r.incomingLine}
                        />
                      )}
                    </td>
                    <td className="py-2 pr-2 text-right tabular-nums">{r.comparisonQty}</td>
                    <td className="py-2 pr-2 text-right tabular-nums">{r.selectedQty}</td>
                    <td className="py-2 pr-2 text-right">
                      <SiMovementValue change={r.qtyChange} emphasize />
                    </td>
                    <td className="py-2 pr-2 text-right tabular-nums">
                      {gbp(r.comparisonNetSales)}
                    </td>
                    <td className="py-2 pr-2 text-right tabular-nums">
                      {gbp(r.selectedNetSales)}
                    </td>
                    <td className="py-2 pr-2 text-right">
                      <SiMovementValue change={r.netChange} money emphasize />
                    </td>
                    <td className="py-2 pr-2 text-steel">
                      {r.lastPurchasedDate ? formatQuoteDateOnlyUk(r.lastPurchasedDate) : "—"}
                    </td>
                    <td className="py-2">
                      <div className="flex flex-col items-start gap-1">
                        <SiViewEnquiryLink href={enquiryLink(r.sku)} />
                        {r.status !== "UNCHANGED" ? (
                          <SiCreateFollowUpButton
                            onClick={() =>
                              onFollowUp(
                                r.sku,
                                r.status as "STOPPED" | "DECREASED" | "INCREASED" | "NEW",
                              )
                            }
                          />
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="space-y-3 md:hidden">
            {data.items.items.map((r) => (
              <div key={r.sku} className="border-b border-border pb-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="font-medium">{r.name}</div>
                    <div>
                      <SiSkuMeta
                        sku={r.sku}
                        brandName={r.brandName}
                        productKind={r.productKind}
                        productKindLabel={r.productKindLabel}
                      />
                    </div>
                    <SiInternalStockLines
                      productKind={r.productKind}
                      availLine={r.availLine}
                      incomingLine={r.incomingLine}
                    />
                  </div>
                  <StatusBadge tone={statusTone(r.status)}>
                    {gapStatusLabel(r.status)}
                  </StatusBadge>
                </div>
                <dl className="mt-2 grid grid-cols-2 gap-1 text-[12px]">
                  <div>
                    <dt className="text-steel">Previous Qty</dt>
                    <dd className="tabular-nums">{r.comparisonQty}</dd>
                  </div>
                  <div>
                    <dt className="text-steel">Selected Qty</dt>
                    <dd className="tabular-nums">{r.selectedQty}</dd>
                  </div>
                  <div>
                    <dt className="text-steel">Previous Net</dt>
                    <dd className="tabular-nums">{gbp(r.comparisonNetSales)}</dd>
                  </div>
                  <div>
                    <dt className="text-steel">Selected Net</dt>
                    <dd className="tabular-nums">{gbp(r.selectedNetSales)}</dd>
                  </div>
                  <div>
                    <dt className="text-steel">Qty Change</dt>
                    <dd>
                      <SiMovementValue change={r.qtyChange} emphasize />
                    </dd>
                  </div>
                  <div>
                    <dt className="text-steel">Net Change</dt>
                    <dd>
                      <SiMovementValue change={r.netChange} money emphasize />
                    </dd>
                  </div>
                </dl>
                <p className="mt-1 text-[12px] text-steel">
                  Last purchased{" "}
                  {r.lastPurchasedDate ? formatQuoteDateOnlyUk(r.lastPurchasedDate) : "—"}
                </p>
                <div className="mt-2 flex flex-wrap gap-3">
                  <SiViewEnquiryLink href={enquiryLink(r.sku)} />
                  {r.status !== "UNCHANGED" ? (
                    <SiCreateFollowUpButton
                      onClick={() =>
                        onFollowUp(
                          r.sku,
                          r.status as "STOPPED" | "DECREASED" | "INCREASED" | "NEW",
                        )
                      }
                    />
                  ) : null}
                </div>
              </div>
            ))}
          </div>
          <SiPager page={page} totalPages={totalPages} total={data.items.total} onPage={onPage} />
        </>
      )}

      {(data.brandMovement.length > 0 || data.categoryMovement.length > 0) && (
        <details className="rounded-md border border-border/70">
          <summary className="cursor-pointer px-3 py-2 text-[11px] font-bold uppercase tracking-wide text-steel">
            Breakdown
          </summary>
          <div className="grid gap-4 border-t border-border/60 px-3 py-3 lg:grid-cols-2">
            <MovementTable title="Brand" rows={data.brandMovement} />
            <MovementTable title="Category" rows={data.categoryMovement} />
          </div>
        </details>
      )}
    </div>
  );
}

function ProductGapView({
  data,
  filterQ,
  setFilterQ,
  status,
  sort,
  compareBy,
  salesRepId,
  onStatus,
  onSort,
  onCompareBy,
  onSalesRep,
  onClearFilters,
  page,
  totalPages,
  onPage,
  enquiryLink,
  onFollowUp,
}: {
  data: ProductGap;
  filterQ: string;
  setFilterQ: (v: string) => void;
  status: string;
  sort: string;
  compareBy: string;
  salesRepId: string;
  onStatus: (v: string) => void;
  onSort: (v: string) => void;
  onCompareBy: (v: "UNITS" | "NET_SALES") => void;
  onSalesRep: (v: string) => void;
  onClearFilters: () => void;
  page: number;
  totalPages: number;
  onPage: (p: number) => void;
  enquiryLink: (companyId: string) => string;
  onFollowUp: (
    companyId: string,
    reason: "STOPPED" | "DECREASED" | "INCREASED" | "NEW",
  ) => void;
}) {
  const filtersActive = hasActiveGapTableFilters({
    status,
    compareBy,
    salesRepId,
    q: filterQ,
    sort,
  });

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <SiPeriodSummary
          selectedFrom={data.selectedPeriod.from}
          selectedTo={data.selectedPeriod.to}
          comparisonFrom={data.comparisonPeriod.from}
          comparisonTo={data.comparisonPeriod.to}
        />
        <SiProvenance text={data.dataSource} />
      </div>

      <GapStatusCards
        counts={data.statusCounts}
        status={status}
        mode="products"
        onStatus={onStatus}
      />

      <SiComparisonSummary
        rows={[
          {
            label: "Net sales",
            selected: String(data.overall.netSales.selected),
            comparison: String(data.overall.netSales.comparison),
            change: data.overall.netSales.change,
            percentChange: data.overall.netSales.percentChange,
            money: true,
          },
          {
            label: "Units",
            selected: String(data.overall.units.selected),
            comparison: String(data.overall.units.comparison),
            change: data.overall.units.change,
            percentChange: data.overall.units.percentChange,
          },
          ...(data.overall.customers
            ? [
                {
                  label: "Customers",
                  selected: String(data.overall.customers.selected),
                  comparison: String(data.overall.customers.comparison),
                  change: data.overall.customers.change,
                  percentChange: data.overall.customers.percentChange,
                },
              ]
            : []),
        ]}
      />

      <div className="flex flex-wrap items-end gap-2">
        <SiField label="Status" className="min-w-[9rem]">
          <select
            className={siControlClassName(status !== "ALL_CHANGES")}
            value={status}
            onChange={(e) => onStatus(e.target.value)}
          >
            <option value="ALL_CHANGES">All changes</option>
            <option value="STOPPED">Stopped buying</option>
            <option value="DECREASED">Decreased</option>
            <option value="INCREASED">Increased</option>
            <option value="NEW">New</option>
            <option value="UNCHANGED">Unchanged</option>
          </select>
        </SiField>
        <SiField label="Compare by" className="min-w-[8rem]">
          <select
            className={siControlClassName(compareBy !== "UNITS")}
            value={compareBy}
            onChange={(e) => onCompareBy(e.target.value as "UNITS" | "NET_SALES")}
          >
            <option value="UNITS">Units</option>
            <option value="NET_SALES">Net sales</option>
          </select>
        </SiField>
        <SiField label="Search" className="min-w-[10rem] flex-1">
          <input
            className={siControlClassName(Boolean(filterQ.trim()))}
            value={filterQ}
            onChange={(e) => setFilterQ(e.target.value)}
            placeholder="Customer or account"
          />
        </SiField>
        <SiField label="Salesperson" className="min-w-[9rem]">
          <select
            className={siControlClassName(Boolean(salesRepId))}
            value={salesRepId}
            onChange={(e) => onSalesRep(e.target.value)}
          >
            <option value="">All salespeople</option>
            {data.filterOptions.salespeople.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </SiField>
        <SiField label="Sort" className="min-w-[11rem]">
          <select
            className={siControlClassName(sort !== "NET_DECREASE")}
            value={sort}
            onChange={(e) => onSort(e.target.value)}
          >
            <option value="NET_DECREASE">Largest net sales decrease</option>
            <option value="UNIT_DECREASE">Largest unit decrease</option>
            <option value="NET_INCREASE">Largest net sales increase</option>
            <option value="UNIT_INCREASE">Largest unit increase</option>
            <option value="RECENT">Most recently purchased</option>
            <option value="NAME_AZ">Customer A–Z</option>
          </select>
        </SiField>
        {filtersActive ? <SiClearFiltersButton onClick={onClearFilters} /> : null}
      </div>

      {data.items.total === 0 ? (
        <p className="text-[14px] text-steel">
          No customers found for this product in the selected periods.
        </p>
      ) : (
        <>
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full text-left text-[13px]">
              <SiStickyTableHead>
                <tr className="border-b-2 border-foreground text-[11px] uppercase tracking-wide text-steel">
                  <th className="py-2 pr-2">Status</th>
                  <th className="py-2 pr-2">Customer</th>
                  <th className="py-2 pr-2">Salesperson</th>
                  <th className="py-2 pr-2 text-right">Previous Qty</th>
                  <th className="py-2 pr-2 text-right">Selected Qty</th>
                  <th className="py-2 pr-2 text-right">Qty Change</th>
                  <th className="py-2 pr-2 text-right">Previous Net</th>
                  <th className="py-2 pr-2 text-right">Selected Net</th>
                  <th className="py-2 pr-2 text-right">Net Change</th>
                  <th className="py-2 pr-2">Last Purchased</th>
                  <th className="py-2">Action</th>
                </tr>
              </SiStickyTableHead>
              <tbody>
                {data.items.items.map((r) => (
                  <tr key={r.companyId} className="border-b border-border/60">
                    <td className="py-2 pr-2">
                      <StatusBadge tone={statusTone(r.status)}>
                        {gapStatusLabel(r.status)}
                      </StatusBadge>
                    </td>
                    <td className="py-2 pr-2">
                      <div className="font-medium">{r.name}</div>
                      <div className="font-mono text-[11px] text-steel">{r.account || "—"}</div>
                    </td>
                    <td className="py-2 pr-2 text-steel">{r.salespersonName || "—"}</td>
                    <td className="py-2 pr-2 text-right tabular-nums">{r.comparisonQty}</td>
                    <td className="py-2 pr-2 text-right tabular-nums">{r.selectedQty}</td>
                    <td className="py-2 pr-2 text-right">
                      <SiMovementValue change={r.qtyChange} emphasize />
                    </td>
                    <td className="py-2 pr-2 text-right tabular-nums">
                      {gbp(r.comparisonNetSales)}
                    </td>
                    <td className="py-2 pr-2 text-right tabular-nums">
                      {gbp(r.selectedNetSales)}
                    </td>
                    <td className="py-2 pr-2 text-right">
                      <SiMovementValue change={r.netChange} money emphasize />
                    </td>
                    <td className="py-2 pr-2 text-steel">
                      {r.lastPurchasedDate ? formatQuoteDateOnlyUk(r.lastPurchasedDate) : "—"}
                    </td>
                    <td className="py-2">
                      <div className="flex flex-col items-start gap-1">
                        <SiViewEnquiryLink href={enquiryLink(r.companyId)} />
                        {r.status !== "UNCHANGED" ? (
                          <SiCreateFollowUpButton
                            onClick={() =>
                              onFollowUp(
                                r.companyId,
                                r.status as "STOPPED" | "DECREASED" | "INCREASED" | "NEW",
                              )
                            }
                          />
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="space-y-3 md:hidden">
            {data.items.items.map((r) => (
              <div key={r.companyId} className="border-b border-border pb-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="font-medium">{r.name}</div>
                    <div className="font-mono text-[11px] text-steel">{r.account || "—"}</div>
                  </div>
                  <StatusBadge tone={statusTone(r.status)}>
                    {gapStatusLabel(r.status)}
                  </StatusBadge>
                </div>
                <dl className="mt-2 grid grid-cols-2 gap-1 text-[12px]">
                  <div>
                    <dt className="text-steel">Previous Qty</dt>
                    <dd className="tabular-nums">{r.comparisonQty}</dd>
                  </div>
                  <div>
                    <dt className="text-steel">Selected Qty</dt>
                    <dd className="tabular-nums">{r.selectedQty}</dd>
                  </div>
                  <div>
                    <dt className="text-steel">Qty Change</dt>
                    <dd>
                      <SiMovementValue change={r.qtyChange} emphasize />
                    </dd>
                  </div>
                  <div>
                    <dt className="text-steel">Net Change</dt>
                    <dd>
                      <SiMovementValue change={r.netChange} money emphasize />
                    </dd>
                  </div>
                  <div>
                    <dt className="text-steel">Last purchased</dt>
                    <dd>
                      {r.lastPurchasedDate ? formatQuoteDateOnlyUk(r.lastPurchasedDate) : "—"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-steel">Salesperson</dt>
                    <dd>{r.salespersonName || "—"}</dd>
                  </div>
                </dl>
                <div className="mt-2 flex flex-wrap gap-3">
                  <SiViewEnquiryLink href={enquiryLink(r.companyId)} />
                  {r.status !== "UNCHANGED" ? (
                    <SiCreateFollowUpButton
                      onClick={() =>
                        onFollowUp(
                          r.companyId,
                          r.status as "STOPPED" | "DECREASED" | "INCREASED" | "NEW",
                        )
                      }
                    />
                  ) : null}
                </div>
              </div>
            ))}
          </div>
          <SiPager page={page} totalPages={totalPages} total={data.items.total} onPage={onPage} />
        </>
      )}
    </div>
  );
}

function MovementTable({
  title,
  rows,
}: {
  title: string;
  rows: Array<{
    key: string;
    label: string;
    comparisonNetSales: string;
    selectedNetSales: string;
    change: string;
  }>;
}) {
  if (rows.length === 0) return null;
  return (
    <div>
      <h3 className="mb-2 text-[11px] font-bold uppercase tracking-wide text-steel">{title}</h3>
      <table className="w-full text-left text-[13px]">
        <thead>
          <tr className="border-b border-border text-[11px] uppercase tracking-wide text-steel">
            <th className="py-1.5 pr-2">{title}</th>
            <th className="py-1.5 pr-2 text-right">Comparison</th>
            <th className="py-1.5 pr-2 text-right">Selected</th>
            <th className="py-1.5 text-right">Change</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key} className="border-b border-border/40">
              <td className="py-1.5 pr-2">{r.label}</td>
              <td className="py-1.5 pr-2 text-right tabular-nums">{gbp(r.comparisonNetSales)}</td>
              <td className="py-1.5 pr-2 text-right tabular-nums">{gbp(r.selectedNetSales)}</td>
              <td className="py-1.5 text-right">
                <SiMovementValue change={r.change} money emphasize />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function downloadBlob(csv: string, filename: string) {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
