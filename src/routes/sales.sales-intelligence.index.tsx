import { createFileRoute } from "@tanstack/react-router";
import { Fragment, useEffect, useMemo, useState } from "react";
import { AvailabilityBadge } from "@/components/ab/AvailabilityBadge";
import { StatusBadge } from "@/components/ab/Badges";
import {
  SalesIntelligenceHeader,
  SiClearFiltersButton,
  SiEntityContext,
  SiExportButton,
  SiField,
  SiMetricCard,
  SiModeSwitch,
  SiPager,
  SiPeriodSummary,
  SiProvenance,
  SiStickyTableHead,
  SI_PERIOD_OPTIONS,
  siControlClassName,
} from "@/components/sales-intelligence/workspace";
import { formatQuoteDateOnlyUk } from "@/domain/quote";
import type { PublicAvailability } from "@/domain/availability";
import {
  compactSalesEnquiryUrlSearch,
  formatGbp,
  parseSalesEnquiryUrlSearch,
  type SalesEnquiryUrlSearch,
} from "@/domain/sales-intelligence";
import type { SalesEnquiryPeriodPreset } from "@/domain/sales-history-period";
import {
  clearedEnquiryTableFilters,
  creditMovementHint,
  hasActiveEnquiryTableFilters,
  shouldShowEntitySuggestions,
} from "@/domain/sales-intelligence-ux";
import {
  exportCustomerSalesEnquiryCsvFn,
  exportProductSalesEnquiryCsvFn,
  getCustomerSalesEnquiryFn,
  getProductSalesEnquiryFn,
  searchSalesIntelligenceCustomersFn,
  searchSalesIntelligenceProductsFn,
} from "@/server/phase2/fns";

export const Route = createFileRoute("/sales/sales-intelligence/")({
  validateSearch: (search: Record<string, unknown>): SalesEnquiryUrlSearch =>
    parseSalesEnquiryUrlSearch(search),
  head: () => ({
    meta: [
      { title: "Sales Enquiry — Sales Intelligence — Automotive Brands" },
      {
        name: "description",
        content: "Internal customer and product sales enquiry from Autopart historic invoices.",
      },
    ],
  }),
  component: SalesEnquiryPage,
});

type CustomerHit = {
  id: string;
  name: string;
  autopartCustomerCode: string | null;
  accountNumber: string | null;
  paymentTerms: string | null;
  salesperson: { name: string } | null;
};

type ProductHit = {
  sku: string;
  name: string;
  brandName: string | null;
  inCatalogue: boolean;
};

type CustomerEnquiry = Extract<
  Awaited<ReturnType<typeof getCustomerSalesEnquiryFn>>,
  { ok: true }
>["data"];
type ProductEnquiry = Extract<
  Awaited<ReturnType<typeof getProductSalesEnquiryFn>>,
  { ok: true }
>["data"];

function gbp(value: string) {
  return formatGbp(value);
}

function SalesEnquiryPage() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const mode = search.mode ?? "customers";
  const period = (search.period ?? "LAST_30") as SalesEnquiryPeriodPreset;
  const compare = search.compare ?? "OFF";
  const page = search.page ?? 1;
  const sort = search.sort ?? "NET_SALES";

  const [customerQ, setCustomerQ] = useState("");
  const [productQ, setProductQ] = useState("");
  const [changingEntity, setChangingEntity] = useState(false);
  const [customerHits, setCustomerHits] = useState<CustomerHit[]>([]);
  const [productHits, setProductHits] = useState<ProductHit[]>([]);
  const [customerData, setCustomerData] = useState<CustomerEnquiry | null>(null);
  const [productData, setProductData] = useState<ProductEnquiry | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedSku, setExpandedSku] = useState<string | null>(null);
  const [expandedCompanyId, setExpandedCompanyId] = useState<string | null>(null);
  const [filterQ, setFilterQ] = useState(search.q ?? "");

  function patch(next: {
    mode?: "customers" | "products";
    companyId?: string | null;
    sku?: string | null;
    period?: SalesEnquiryPeriodPreset;
    from?: string | null;
    to?: string | null;
    compare?: "OFF" | "PREVIOUS" | "PREVIOUS_YEAR" | "CUSTOM";
    compareFrom?: string | null;
    compareTo?: string | null;
    q?: string | null;
    brandId?: string | null;
    categoryId?: string | null;
    salesRepId?: string | null;
    sort?: string | null;
    page?: number;
    txPage?: number;
  }) {
    const nextMode = next.mode ?? mode;
    const nextCompanyId =
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
    const nextQ = next.q === null ? undefined : (next.q ?? search.q);
    const nextBrand = next.brandId === null ? undefined : (next.brandId ?? search.brandId);
    const nextCat = next.categoryId === null ? undefined : (next.categoryId ?? search.categoryId);
    const nextRep = next.salesRepId === null ? undefined : (next.salesRepId ?? search.salesRepId);
    const nextSort = next.sort === null ? undefined : (next.sort ?? sort);
    const nextPage = next.page ?? page;
    const nextTxPage = next.txPage ?? search.txPage;
    const draft: SalesEnquiryUrlSearch = {};
    if (nextMode !== "customers") draft.mode = nextMode;
    if (nextCompanyId) draft.companyId = nextCompanyId;
    if (nextSku) draft.sku = nextSku;
    if (nextPeriod !== "LAST_30") draft.period = nextPeriod;
    if (nextPeriod === "CUSTOM") {
      if (nextFrom) draft.from = nextFrom;
      if (nextTo) draft.to = nextTo;
    } else if (nextFrom || nextTo) {
      if (nextFrom) draft.from = nextFrom;
      if (nextTo) draft.to = nextTo;
    }
    if (nextCompare !== "OFF") draft.compare = nextCompare;
    if (nextCompare === "CUSTOM") {
      if (nextCompareFrom) draft.compareFrom = nextCompareFrom;
      if (nextCompareTo) draft.compareTo = nextCompareTo;
    }
    if (nextQ) draft.q = nextQ;
    if (nextBrand) draft.brandId = nextBrand;
    if (nextCat) draft.categoryId = nextCat;
    if (nextRep) draft.salesRepId = nextRep;
    if (nextSort && nextSort !== "NET_SALES") draft.sort = nextSort;
    if (nextPage > 1) draft.page = nextPage;
    if (nextTxPage && nextTxPage > 1) draft.txPage = nextTxPage;
    void navigate({ search: compactSalesEnquiryUrlSearch(draft) });
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
      const r = await getCustomerSalesEnquiryFn({
        data: {
          companyId: search.companyId,
          period,
          from: search.from ?? null,
          to: search.to ?? null,
          compare,
          compareFrom: search.compareFrom ?? null,
          compareTo: search.compareTo ?? null,
          q: search.q ?? null,
          brandId: search.brandId ?? null,
          categoryId: search.categoryId ?? null,
          sort: sort as "NET_SALES",
          page,
          pageSize: 25,
          txSku: expandedSku,
          txPage: search.txPage ?? 1,
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
    search.q,
    search.brandId,
    search.categoryId,
    sort,
    page,
    expandedSku,
    search.txPage,
  ]);

  useEffect(() => {
    if (mode !== "products" || !search.sku) {
      setProductData(null);
      return;
    }
    void (async () => {
      setLoading(true);
      const r = await getProductSalesEnquiryFn({
        data: {
          sku: search.sku,
          period,
          from: search.from ?? null,
          to: search.to ?? null,
          compare,
          compareFrom: search.compareFrom ?? null,
          compareTo: search.compareTo ?? null,
          q: search.q ?? null,
          salesRepId: search.salesRepId ?? null,
          sort: sort as "NET_SALES",
          page,
          pageSize: 25,
          txCompanyId: expandedCompanyId,
          txPage: search.txPage ?? 1,
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
    search.q,
    search.salesRepId,
    sort,
    page,
    expandedCompanyId,
    search.txPage,
  ]);

  const totalPages = useMemo(() => {
    if (mode === "customers" && customerData) {
      return Math.max(1, Math.ceil(customerData.products.total / customerData.products.pageSize));
    }
    if (mode === "products" && productData) {
      return Math.max(1, Math.ceil(productData.customers.total / productData.customers.pageSize));
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
      const r = await exportCustomerSalesEnquiryCsvFn({
        data: {
          companyId: search.companyId,
          period,
          from: search.from ?? null,
          to: search.to ?? null,
          q: search.q ?? null,
          brandId: search.brandId ?? null,
          categoryId: search.categoryId ?? null,
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
      const r = await exportProductSalesEnquiryCsvFn({
        data: {
          sku: search.sku,
          period,
          from: search.from ?? null,
          to: search.to ?? null,
          q: search.q ?? null,
          salesRepId: search.salesRepId ?? null,
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

  return (
    <div>
      <SalesIntelligenceHeader
        title="Sales Enquiry"
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
                customerData.company.paymentTerms ?? "",
              ]}
              onChange={() => setChangingEntity(true)}
              changeLabel="Change customer"
            />
          ) : (
            <SiField label="Customer" className="max-w-xl">
              <input
                className={siControlClassName()}
                placeholder="Search name, Autopart account, postcode…"
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
              !productData.product.inCatalogue ? "Historic only" : "",
            ]}
            onChange={() => setChangingEntity(true)}
            changeLabel="Change product"
          />
        ) : (
          <SiField label="Product / SKU" className="max-w-xl">
            <input
              className={siControlClassName()}
              placeholder="Search SKU, name, brand, historic SKU…"
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
                        {!p.inCatalogue ? " · Historic only" : p.brandName ? ` · ${p.brandName}` : ""}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </SiField>
        )}

        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 lg:max-w-3xl">
          <SiField label="Period">
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

          <SiField label="Compare">
            <select
              className={siControlClassName(compare !== "OFF")}
              value={compare}
              onChange={(e) =>
                patch({
                  compare: e.target.value as "OFF" | "PREVIOUS" | "PREVIOUS_YEAR" | "CUSTOM",
                  page: 1,
                })
              }
            >
              <option value="OFF">Off</option>
              <option value="PREVIOUS">Previous equivalent period</option>
              <option value="PREVIOUS_YEAR">Same period previous year</option>
              <option value="CUSTOM">Custom comparison</option>
            </select>
          </SiField>

          <SiField label="Sort">
            <select
              className={siControlClassName(sort !== "NET_SALES")}
              value={sort}
              onChange={(e) => patch({ sort: e.target.value, page: 1 })}
            >
              <option value="NET_SALES">Net sales high → low</option>
              <option value="QTY">Qty high → low</option>
              <option value="PURCHASES">Most purchases</option>
              <option value="RECENT">Most recently purchased</option>
              <option value="NAME_AZ">
                {mode === "customers" ? "Product A–Z" : "Customer A–Z"}
              </option>
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
        {loading ? <p className="text-[13px] text-steel">Loading enquiry…</p> : null}

        {mode === "customers" && customerData ? (
          <CustomerEnquiryView
            data={customerData}
            filterQ={filterQ}
            setFilterQ={setFilterQ}
            brandId={search.brandId ?? ""}
            categoryId={search.categoryId ?? ""}
            onBrand={(id) => patch({ brandId: id || null, page: 1 })}
            onCategory={(id) => patch({ categoryId: id || null, page: 1 })}
            onClearFilters={() => {
              const cleared = clearedEnquiryTableFilters();
              setFilterQ("");
              patch({ ...cleared, page: 1 });
            }}
            expandedSku={expandedSku}
            onToggleSku={(sku) => setExpandedSku((prev) => (prev === sku ? null : sku))}
            page={page}
            totalPages={totalPages}
            onPage={(p) => patch({ page: p })}
          />
        ) : null}

        {mode === "products" && productData ? (
          <ProductEnquiryView
            data={productData}
            filterQ={filterQ}
            setFilterQ={setFilterQ}
            salesRepId={search.salesRepId ?? ""}
            onSalesRep={(id) => patch({ salesRepId: id || null, page: 1 })}
            onClearFilters={() => {
              const cleared = clearedEnquiryTableFilters();
              setFilterQ("");
              patch({ ...cleared, page: 1 });
            }}
            expandedCompanyId={expandedCompanyId}
            onToggleCompany={(id) =>
              setExpandedCompanyId((prev) => (prev === id ? null : id))
            }
            onOpenCustomer={(companyId) =>
              patch({
                mode: "customers",
                companyId,
                sku: null,
                page: 1,
                q: null,
              })
            }
            page={page}
            totalPages={totalPages}
            onPage={(p) => patch({ page: p })}
          />
        ) : null}

        {!loading && mode === "customers" && !search.companyId ? (
          <p className="text-[14px] text-steel">Search and select a customer to begin.</p>
        ) : null}
        {!loading && mode === "products" && !search.sku ? (
          <p className="text-[14px] text-steel">
            Search and select a product or historic SKU to begin.
          </p>
        ) : null}
      </div>
    </div>
  );
}

function EnquiryMetrics({
  summary,
  comparison,
  showCustomers,
}: {
  summary: {
    invoiceSales: string;
    credits: string;
    netSales: string;
    units: number;
    purchaseTransactions: number;
    productsPurchased: number;
    customers: number;
  };
  comparison: CustomerEnquiry["comparison"];
  showCustomers?: boolean;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
      <SiMetricCard
        label="Net sales"
        value={gbp(summary.netSales)}
        primary
        movement={
          comparison
            ? {
                change: comparison.netSales.difference,
                percentChange: comparison.netSales.percentChange,
                money: true,
              }
            : null
        }
      />
      <SiMetricCard
        label="Units"
        value={String(summary.units)}
        primary
        movement={
          comparison
            ? {
                change: comparison.units.difference,
                percentChange: comparison.units.percentChange,
              }
            : null
        }
      />
      <SiMetricCard label="Invoice sales" value={gbp(summary.invoiceSales)} />
      <SiMetricCard
        label="Credits"
        value={gbp(summary.credits)}
        creditHint={
          comparison
            ? creditMovementHint(summary.credits, comparison.credits.comparison)
            : null
        }
      />
      <SiMetricCard label="Transactions" value={String(summary.purchaseTransactions)} />
      <SiMetricCard
        label={showCustomers ? "Customers" : "Products"}
        value={String(showCustomers ? summary.customers : summary.productsPurchased)}
      />
    </div>
  );
}

function CustomerEnquiryView({
  data,
  filterQ,
  setFilterQ,
  brandId,
  categoryId,
  onBrand,
  onCategory,
  onClearFilters,
  expandedSku,
  onToggleSku,
  page,
  totalPages,
  onPage,
}: {
  data: CustomerEnquiry;
  filterQ: string;
  setFilterQ: (v: string) => void;
  brandId: string;
  categoryId: string;
  onBrand: (id: string) => void;
  onCategory: (id: string) => void;
  onClearFilters: () => void;
  expandedSku: string | null;
  onToggleSku: (sku: string) => void;
  page: number;
  totalPages: number;
  onPage: (p: number) => void;
}) {
  const filtersActive = hasActiveEnquiryTableFilters({
    brandId,
    categoryId,
    q: filterQ,
  });

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <SiPeriodSummary
          selectedFrom={data.period.from}
          selectedTo={data.period.to}
          comparisonFrom={data.comparison?.comparison.from ?? null}
          comparisonTo={data.comparison?.comparison.to ?? null}
        />
        <SiProvenance text={data.dataSource} />
      </div>

      <EnquiryMetrics summary={data.summary} comparison={data.comparison} />

      {data.comparison ? (
        <details className="rounded-md border border-border/70">
          <summary className="cursor-pointer px-3 py-2 text-[11px] font-bold uppercase tracking-wide text-steel">
            View full comparison
          </summary>
          <div className="overflow-x-auto border-t border-border/60 px-3 py-2">
            <ComparisonTable comparison={data.comparison} />
          </div>
        </details>
      ) : null}

      <div className="flex flex-wrap items-end gap-2">
        <SiField label="Search products" className="min-w-[10rem] flex-1">
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
        {filtersActive ? <SiClearFiltersButton onClick={onClearFilters} /> : null}
      </div>

      {data.products.total === 0 ? (
        <p className="text-[14px] text-steel">No purchases found for this period.</p>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[13px]">
              <SiStickyTableHead>
                <tr className="border-b-2 border-foreground text-[11px] uppercase tracking-wide text-steel">
                  <th className="bg-background py-2 pr-3">Product</th>
                  <th className="bg-background py-2 pr-3">Last purchased</th>
                  <th className="bg-background py-2 pr-3 text-right">Purchases</th>
                  <th className="bg-background py-2 pr-3 text-right">Qty</th>
                  <th className="bg-background py-2 pr-3 text-right">Invoice</th>
                  <th className="bg-background py-2 pr-3 text-right">Credits</th>
                  <th className="bg-background py-2 pr-3 text-right">Net</th>
                  <th className="bg-background py-2">Availability</th>
                </tr>
              </SiStickyTableHead>
              <tbody>
                {data.products.items.map((item) => (
                  <Fragment key={item.sku}>
                    <tr
                      className="cursor-pointer border-b border-border/60 hover:bg-surface/40"
                      onClick={() => onToggleSku(item.sku)}
                    >
                      <td className="py-2.5 pr-3">
                        <div className="font-medium">{item.name}</div>
                        <div className="font-mono text-[11px] text-steel">
                          {item.sku}
                          {item.brandName ? ` · ${item.brandName}` : ""}
                          {!item.inCatalogue ? " · Historic only" : ""}
                        </div>
                      </td>
                      <td className="py-2.5 pr-3 text-steel">
                        {item.lastPurchasedDate
                          ? formatQuoteDateOnlyUk(item.lastPurchasedDate)
                          : "—"}
                      </td>
                      <td className="py-2.5 pr-3 text-right tabular-nums">{item.purchaseCount}</td>
                      <td className="py-2.5 pr-3 text-right tabular-nums">{item.units}</td>
                      <td className="py-2.5 pr-3 text-right tabular-nums">
                        {gbp(item.invoiceSales)}
                      </td>
                      <td className="py-2.5 pr-3 text-right tabular-nums">{gbp(item.credits)}</td>
                      <td className="py-2.5 pr-3 text-right font-medium tabular-nums">
                        {gbp(item.netSales)}
                      </td>
                      <td className="py-2.5">
                        {item.availabilityBand === "historic" ? (
                          <StatusBadge tone="neutral">{item.availabilityLabel}</StatusBadge>
                        ) : (
                          <AvailabilityBadge
                            availability={item.availabilityBand as PublicAvailability}
                          />
                        )}
                      </td>
                    </tr>
                    {expandedSku === item.sku && data.transactions ? (
                      <tr className="border-b border-border/40 bg-surface/30">
                        <td colSpan={8} className="px-3 py-3">
                          <TxTable
                            rows={data.transactions.items.map((t) => ({
                              date: t.documentDate,
                              ref: t.documentReference,
                              type: t.documentType,
                              detail: t.description,
                              units: t.units,
                              net: t.netValue,
                            }))}
                          />
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
          <SiPager page={page} totalPages={totalPages} total={data.products.total} onPage={onPage} />
        </>
      )}

      {(data.brandBreakdown.length > 0 || data.categoryBreakdown.length > 0) && (
        <details className="rounded-md border border-border/70" open>
          <summary className="cursor-pointer px-3 py-2 text-[11px] font-bold uppercase tracking-wide text-steel">
            Breakdown by brand / category
          </summary>
          <div className="grid gap-4 border-t border-border/60 p-3 lg:grid-cols-2">
            <BreakdownTable title="Brand" rows={data.brandBreakdown} />
            <BreakdownTable title="Category" rows={data.categoryBreakdown} />
          </div>
        </details>
      )}
    </div>
  );
}

function ProductEnquiryView({
  data,
  filterQ,
  setFilterQ,
  salesRepId,
  onSalesRep,
  onClearFilters,
  expandedCompanyId,
  onToggleCompany,
  onOpenCustomer,
  page,
  totalPages,
  onPage,
}: {
  data: ProductEnquiry;
  filterQ: string;
  setFilterQ: (v: string) => void;
  salesRepId: string;
  onSalesRep: (id: string) => void;
  onClearFilters: () => void;
  expandedCompanyId: string | null;
  onToggleCompany: (id: string) => void;
  onOpenCustomer: (companyId: string) => void;
  page: number;
  totalPages: number;
  onPage: (p: number) => void;
}) {
  const filtersActive = hasActiveEnquiryTableFilters({
    salesRepId,
    q: filterQ,
  });
  const salespeople = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of data.customers.items) {
      if (c.salespersonId && c.salespersonName) map.set(c.salespersonId, c.salespersonName);
    }
    return [...map.entries()]
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name, "en-GB"));
  }, [data.customers.items]);

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <SiPeriodSummary
          selectedFrom={data.period.from}
          selectedTo={data.period.to}
          comparisonFrom={data.comparison?.comparison.from ?? null}
          comparisonTo={data.comparison?.comparison.to ?? null}
        />
        <SiProvenance text={data.dataSource} />
        {data.product.latestAutopartCost !== undefined ? (
          <p className="text-[11px] text-steel">
            Latest Autopart cost:{" "}
            {data.product.latestAutopartCost != null
              ? `£${data.product.latestAutopartCost}`
              : "No cost observation yet"}
          </p>
        ) : null}
      </div>

      <EnquiryMetrics summary={data.summary} comparison={data.comparison} showCustomers />

      {data.comparison ? (
        <details className="rounded-md border border-border/70">
          <summary className="cursor-pointer px-3 py-2 text-[11px] font-bold uppercase tracking-wide text-steel">
            View full comparison
          </summary>
          <div className="overflow-x-auto border-t border-border/60 px-3 py-2">
            <ComparisonTable comparison={data.comparison} />
          </div>
        </details>
      ) : null}

      <div className="flex flex-wrap items-end gap-2">
        <SiField label="Search customers" className="min-w-[10rem] flex-1">
          <input
            className={siControlClassName(Boolean(filterQ.trim()))}
            value={filterQ}
            onChange={(e) => setFilterQ(e.target.value)}
            placeholder="Customer or account"
          />
        </SiField>
        {salespeople.length > 0 ? (
          <SiField label="Salesperson" className="min-w-[9rem]">
            <select
              className={siControlClassName(Boolean(salesRepId))}
              value={salesRepId}
              onChange={(e) => onSalesRep(e.target.value)}
            >
              <option value="">All salespeople</option>
              {salespeople.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </SiField>
        ) : null}
        {filtersActive ? <SiClearFiltersButton onClick={onClearFilters} /> : null}
      </div>

      {data.customers.total === 0 ? (
        <p className="text-[14px] text-steel">No customers purchased this product in this period.</p>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[13px]">
              <SiStickyTableHead>
                <tr className="border-b-2 border-foreground text-[11px] uppercase tracking-wide text-steel">
                  <th className="bg-background py-2 pr-3">Customer</th>
                  <th className="bg-background py-2 pr-3">Salesperson</th>
                  <th className="bg-background py-2 pr-3">Last purchased</th>
                  <th className="bg-background py-2 pr-3 text-right">Purchases</th>
                  <th className="bg-background py-2 pr-3 text-right">Qty</th>
                  <th className="bg-background py-2 pr-3 text-right">Invoice</th>
                  <th className="bg-background py-2 pr-3 text-right">Credits</th>
                  <th className="bg-background py-2 text-right">Net</th>
                </tr>
              </SiStickyTableHead>
              <tbody>
                {data.customers.items.map((c) => (
                  <Fragment key={c.companyId}>
                    <tr
                      className="cursor-pointer border-b border-border/60 hover:bg-surface/40"
                      onClick={() => onToggleCompany(c.companyId)}
                    >
                      <td className="py-2.5 pr-3">
                        <button
                          type="button"
                          className="text-left font-medium text-primary"
                          onClick={(e) => {
                            e.stopPropagation();
                            onOpenCustomer(c.companyId);
                          }}
                        >
                          {c.name}
                        </button>
                        <div className="font-mono text-[11px] text-steel">{c.account || "—"}</div>
                      </td>
                      <td className="py-2.5 pr-3 text-steel">{c.salespersonName || "—"}</td>
                      <td className="py-2.5 pr-3 text-steel">
                        {c.lastPurchasedDate ? formatQuoteDateOnlyUk(c.lastPurchasedDate) : "—"}
                      </td>
                      <td className="py-2.5 pr-3 text-right tabular-nums">{c.purchaseCount}</td>
                      <td className="py-2.5 pr-3 text-right tabular-nums">{c.units}</td>
                      <td className="py-2.5 pr-3 text-right tabular-nums">{gbp(c.invoiceSales)}</td>
                      <td className="py-2.5 pr-3 text-right tabular-nums">{gbp(c.credits)}</td>
                      <td className="py-2.5 text-right font-medium tabular-nums">
                        {gbp(c.netSales)}
                      </td>
                    </tr>
                    {expandedCompanyId === c.companyId && data.transactions ? (
                      <tr className="border-b border-border/40 bg-surface/30">
                        <td colSpan={8} className="px-3 py-3">
                          <TxTable
                            rows={data.transactions.items.map((t) => ({
                              date: t.documentDate,
                              ref: t.documentReference,
                              type: t.documentType,
                              detail: t.customerName,
                              units: t.units,
                              net: t.netValue,
                            }))}
                          />
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
          <SiPager
            page={page}
            totalPages={totalPages}
            total={data.customers.total}
            onPage={onPage}
          />
        </>
      )}
    </div>
  );
}

function ComparisonTable({
  comparison,
}: {
  comparison: NonNullable<CustomerEnquiry["comparison"]>;
}) {
  const rows = [
    { label: "Invoice sales", m: comparison.invoiceSales, money: true },
    { label: "Credits", m: comparison.credits, money: true },
    { label: "Net sales", m: comparison.netSales, money: true },
    {
      label: "Units",
      m: {
        primary: String(comparison.units.primary),
        comparison: String(comparison.units.comparison),
        difference: String(comparison.units.difference),
        percentChange: comparison.units.percentChange,
      },
      money: false,
    },
  ];
  return (
    <table className="w-full text-left text-[13px]">
      <thead>
        <tr className="border-b border-border text-[11px] uppercase tracking-wide text-steel">
          <th className="py-2 pr-3">Metric</th>
          <th className="py-2 pr-3 text-right">Selected</th>
          <th className="py-2 pr-3 text-right">Comparison</th>
          <th className="py-2 pr-3 text-right">Change</th>
          <th className="py-2 text-right">%</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.label} className="border-b border-border/50">
            <td className="py-2 pr-3">{r.label}</td>
            <td className="py-2 pr-3 text-right tabular-nums">
              {r.money ? gbp(r.m.primary) : r.m.primary}
            </td>
            <td className="py-2 pr-3 text-right tabular-nums">
              {r.money ? gbp(r.m.comparison) : r.m.comparison}
            </td>
            <td className="py-2 pr-3 text-right tabular-nums">
              {r.money ? gbp(r.m.difference) : r.m.difference}
            </td>
            <td className="py-2 text-right tabular-nums">
              {r.m.percentChange == null
                ? "—"
                : `${r.m.percentChange > 0 ? "+" : ""}${r.m.percentChange.toFixed(2)}%`}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function BreakdownTable({
  title,
  rows,
}: {
  title: string;
  rows: Array<{ key: string; label: string; products: number; units: number; netSales: string }>;
}) {
  return (
    <div>
      <h3 className="mb-2 text-[11px] font-bold uppercase tracking-wide text-steel">{title}</h3>
      <table className="w-full text-left text-[13px]">
        <thead>
          <tr className="border-b border-border text-[11px] uppercase tracking-wide text-steel">
            <th className="py-1.5 pr-2">{title}</th>
            <th className="py-1.5 pr-2 text-right">Products</th>
            <th className="py-1.5 pr-2 text-right">Units</th>
            <th className="py-1.5 text-right">Net sales</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key} className="border-b border-border/40">
              <td className="py-1.5 pr-2">{r.label}</td>
              <td className="py-1.5 pr-2 text-right tabular-nums">{r.products}</td>
              <td className="py-1.5 pr-2 text-right tabular-nums">{r.units}</td>
              <td className="py-1.5 text-right tabular-nums">{gbp(r.netSales)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TxTable({
  rows,
}: {
  rows: Array<{
    date: string | null;
    ref: string;
    type: string;
    detail: string | null | undefined;
    units: number;
    net: string;
  }>;
}) {
  if (rows.length === 0) {
    return <p className="text-[12px] text-steel">No transactions in this period.</p>;
  }
  return (
    <table className="w-full text-left text-[12px]">
      <thead>
        <tr className="text-[10px] uppercase tracking-wide text-steel">
          <th className="py-1 pr-2">Date</th>
          <th className="py-1 pr-2">Reference</th>
          <th className="py-1 pr-2">Type</th>
          <th className="py-1 pr-2">Detail</th>
          <th className="py-1 pr-2 text-right">Units</th>
          <th className="py-1 text-right">Net</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((t, i) => (
          <tr key={`${t.ref}-${i}`} className="border-t border-border/40">
            <td className="py-1 pr-2">{t.date ? formatQuoteDateOnlyUk(t.date) : "—"}</td>
            <td className="py-1 pr-2 font-mono">{t.ref}</td>
            <td className="py-1 pr-2">{t.type === "CREDIT" ? "Credit" : "Invoice"}</td>
            <td className="py-1 pr-2 text-steel">{t.detail || "—"}</td>
            <td className="py-1 pr-2 text-right tabular-nums">{t.units}</td>
            <td className="py-1 text-right tabular-nums">{gbp(t.net)}</td>
          </tr>
        ))}
      </tbody>
    </table>
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
