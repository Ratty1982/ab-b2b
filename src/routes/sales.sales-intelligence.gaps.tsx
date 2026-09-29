import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { PanelHeader } from "@/components/ab/AppShell";
import { AvailabilityBadge } from "@/components/ab/AvailabilityBadge";
import { StatusBadge } from "@/components/ab/Badges";
import { ROUTES } from "@/lib/app-nav";
import { formatQuoteDateOnlyUk } from "@/domain/quote";
import type { PublicAvailability } from "@/domain/availability";
import type { SalesEnquiryPeriodPreset } from "@/domain/sales-history-period";
import {
  compactGapUrlSearch,
  parseGapUrlSearch,
  type GapCompareMode,
  type GapUrlSearch,
} from "@/domain/sales-gap";
import { formatGbp } from "@/domain/sales-intelligence";
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
type ProductHit = { sku: string; name: string; brandName: string | null; inCatalogue: boolean };
type CustomerGap = Extract<Awaited<ReturnType<typeof getCustomerGapAnalysisFn>>, { ok: true }>["data"];
type ProductGap = Extract<Awaited<ReturnType<typeof getProductGapAnalysisFn>>, { ok: true }>["data"];

const PERIOD_OPTIONS: Array<{ value: SalesEnquiryPeriodPreset; label: string }> = [
  { value: "THIS_MONTH", label: "This month" },
  { value: "LAST_MONTH", label: "Last month" },
  { value: "LAST_30", label: "Last 30 days" },
  { value: "LAST_90", label: "Last 3 months" },
  { value: "LAST_180", label: "Last 6 months" },
  { value: "YTD", label: "Year to date" },
  { value: "LAST_YEAR", label: "Last year" },
  { value: "CUSTOM", label: "Custom" },
];

function gbp(v: string) {
  return formatGbp(v);
}
function pct(v: number | null) {
  if (v == null) return "—";
  const sign = v > 0 ? "+" : "";
  return `${sign}${v.toFixed(2)}%`;
}

function statusTone(status: string): "bad" | "warn" | "good" | "brand" | "neutral" {
  if (status === "STOPPED") return "bad";
  if (status === "DECREASED") return "warn";
  if (status === "INCREASED") return "good";
  if (status === "NEW") return "brand";
  return "neutral";
}

function statusLabel(status: string) {
  if (status === "STOPPED") return "Stopped buying";
  if (status === "DECREASED") return "Decreased";
  if (status === "INCREASED") return "Increased";
  if (status === "NEW") return "New";
  return "Unchanged";
}

function GapAnalysisPage() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const mode = search.mode ?? "customers";
  const period = (search.period ?? "LAST_30") as SalesEnquiryPeriodPreset;
  const compare = (search.compare ?? "PREVIOUS") as GapCompareMode;
  const compareBy = search.compareBy ?? "UNITS";
  const status = search.status ?? "ALL_CHANGES";
  const sort = search.sort ?? "NET_DECREASE";
  const page = search.page ?? 1;

  const [customerQ, setCustomerQ] = useState("");
  const [productQ, setProductQ] = useState("");
  const [customerHits, setCustomerHits] = useState<CustomerHit[]>([]);
  const [productHits, setProductHits] = useState<ProductHit[]>([]);
  const [filterQ, setFilterQ] = useState(search.q ?? "");
  const [customerData, setCustomerData] = useState<CustomerGap | null>(null);
  const [productData, setProductData] = useState<ProductGap | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  return (
    <div>
      <PanelHeader
        title="Gap Analysis"
        sub="Factual comparison of purchase activity between two periods"
        crumbs={[
          { label: "Sales Intelligence" },
          { label: "Gap Analysis", to: ROUTES.salesIntelligenceGaps },
        ]}
        actions={
          (mode === "customers" && search.companyId) || (mode === "products" && search.sku) ? (
            <button
              type="button"
              onClick={() => void exportCsv()}
              className="h-10 rounded-md border border-border px-4 text-[12px] font-bold uppercase tracking-wide"
            >
              Export CSV
            </button>
          ) : null
        }
      />

      <div className="space-y-4 p-4 sm:p-6">
        <div className="flex flex-wrap gap-2">
          {(
            [
              ["customers", "Customers"],
              ["products", "Products"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() =>
                patch({
                  mode: value,
                  companyId: value === "customers" ? search.companyId ?? null : null,
                  sku: value === "products" ? search.sku ?? null : null,
                  page: 1,
                  q: null,
                })
              }
              className={`h-9 rounded-md border px-4 text-[11px] font-bold uppercase tracking-wide ${
                mode === value
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border text-steel"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="grid gap-3 lg:grid-cols-4">
          {mode === "customers" ? (
            <label className="text-[12px] lg:col-span-2">
              Customer
              <input
                className="mt-1 block h-10 w-full rounded-md border border-border bg-background px-3 text-[13px]"
                placeholder="Search name or Autopart account…"
                value={customerQ}
                onChange={(e) => setCustomerQ(e.target.value)}
              />
              {customerHits.length > 0 ? (
                <ul className="mt-1 max-h-48 overflow-auto rounded-md border border-border bg-card text-[13px]">
                  {customerHits.map((c) => (
                    <li key={c.id}>
                      <button
                        type="button"
                        className="flex w-full flex-col px-3 py-2 text-left hover:bg-secondary/60"
                        onClick={() => {
                          setCustomerQ(c.name);
                          setCustomerHits([]);
                          patch({ companyId: c.id, page: 1 });
                        }}
                      >
                        <span className="font-medium">{c.name}</span>
                        <span className="text-[11px] text-steel">
                          {c.autopartCustomerCode || c.accountNumber || "No Autopart code"}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </label>
          ) : (
            <label className="text-[12px] lg:col-span-2">
              Product / SKU
              <input
                className="mt-1 block h-10 w-full rounded-md border border-border bg-background px-3 text-[13px]"
                placeholder="Search SKU, name, historic SKU…"
                value={productQ}
                onChange={(e) => setProductQ(e.target.value)}
              />
              {productHits.length > 0 ? (
                <ul className="mt-1 max-h-48 overflow-auto rounded-md border border-border bg-card text-[13px]">
                  {productHits.map((p) => (
                    <li key={p.sku}>
                      <button
                        type="button"
                        className="flex w-full flex-col px-3 py-2 text-left hover:bg-secondary/60"
                        onClick={() => {
                          setProductQ(p.sku);
                          setProductHits([]);
                          patch({ sku: p.sku, page: 1 });
                        }}
                      >
                        <span className="font-medium">{p.name}</span>
                        <span className="font-mono text-[11px] text-steel">{p.sku}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </label>
          )}

          <label className="text-[12px]">
            Selected period
            <select
              className="mt-1 block h-10 w-full rounded-md border border-border bg-background px-3 text-[13px]"
              value={period}
              onChange={(e) =>
                patch({ period: e.target.value as SalesEnquiryPeriodPreset, page: 1 })
              }
            >
              {PERIOD_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>

          <label className="text-[12px]">
            Compare with
            <select
              className="mt-1 block h-10 w-full rounded-md border border-border bg-background px-3 text-[13px]"
              value={compare}
              onChange={(e) => patch({ compare: e.target.value as GapCompareMode, page: 1 })}
            >
              <option value="PREVIOUS">Previous equivalent period</option>
              <option value="PREVIOUS_YEAR">Same period previous year</option>
              <option value="CUSTOM">Custom comparison</option>
            </select>
          </label>
        </div>

        {period === "CUSTOM" ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-[12px]">
              Selected from
              <input
                type="date"
                className="mt-1 block h-10 w-full rounded-md border border-border bg-background px-3 text-[13px]"
                value={search.from ?? ""}
                onChange={(e) => patch({ from: e.target.value || null, page: 1 })}
              />
            </label>
            <label className="text-[12px]">
              Selected to
              <input
                type="date"
                className="mt-1 block h-10 w-full rounded-md border border-border bg-background px-3 text-[13px]"
                value={search.to ?? ""}
                onChange={(e) => patch({ to: e.target.value || null, page: 1 })}
              />
            </label>
          </div>
        ) : null}

        {compare === "CUSTOM" ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-[12px]">
              Comparison from
              <input
                type="date"
                className="mt-1 block h-10 w-full rounded-md border border-border bg-background px-3 text-[13px]"
                value={search.compareFrom ?? ""}
                onChange={(e) => patch({ compareFrom: e.target.value || null })}
              />
            </label>
            <label className="text-[12px]">
              Comparison to
              <input
                type="date"
                className="mt-1 block h-10 w-full rounded-md border border-border bg-background px-3 text-[13px]"
                value={search.compareTo ?? ""}
                onChange={(e) => patch({ compareTo: e.target.value || null })}
              />
            </label>
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
            page={page}
            totalPages={totalPages}
            onPage={(p) => patch({ page: p })}
            enquiryLink={(sku) =>
              `${ROUTES.salesIntelligence}?mode=customers&companyId=${customerData.company.id}&period=CUSTOM&from=${customerData.selectedPeriod.from}&to=${customerData.selectedPeriod.to}&compare=CUSTOM&compareFrom=${customerData.comparisonPeriod.from}&compareTo=${customerData.comparisonPeriod.to}&q=${encodeURIComponent(sku)}`
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
            page={page}
            totalPages={totalPages}
            onPage={(p) => patch({ page: p })}
            enquiryLink={(companyId) =>
              `${ROUTES.salesIntelligence}?mode=customers&companyId=${companyId}&period=CUSTOM&from=${productData.selectedPeriod.from}&to=${productData.selectedPeriod.to}&compare=CUSTOM&compareFrom=${productData.comparisonPeriod.from}&compareTo=${productData.comparisonPeriod.to}`
            }
          />
        ) : null}

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

function CountStrip({
  counts,
}: {
  counts: { stopped: number; decreased: number; increased: number; new: number; unchanged: number };
}) {
  const cards = [
    { label: "Stopped buying", value: counts.stopped },
    { label: "Decreased", value: counts.decreased },
    { label: "Increased", value: counts.increased },
    { label: "New", value: counts.new },
  ];
  return (
    <div className="grid gap-2 sm:grid-cols-4">
      {cards.map((c) => (
        <div key={c.label} className="border-b border-border/70 pb-2">
          <div className="text-[10px] uppercase tracking-wide text-steel">{c.label}</div>
          <div className="mt-1 font-display text-xl font-semibold tabular-nums">{c.value}</div>
        </div>
      ))}
    </div>
  );
}

function OverallMovement({
  data,
  showCustomers = false,
}: {
  data: {
    selectedPeriod: { from: string; to: string };
    comparisonPeriod: { from: string; to: string };
    overall: {
      netSales: { selected: string | number; comparison: string | number; change: string | number; percentChange: number | null };
      units: { selected: string | number; comparison: string | number; change: string | number; percentChange: number | null };
      customers?: { selected: string | number; comparison: string | number; change: string | number; percentChange: number | null };
    };
  };
  showCustomers?: boolean;
}) {
  return (
    <div className="overflow-x-auto">
      <p className="mb-2 text-[11px] uppercase tracking-wide text-steel">
        Selected {formatQuoteDateOnlyUk(data.selectedPeriod.from)} –{" "}
        {formatQuoteDateOnlyUk(data.selectedPeriod.to)} · Comparison{" "}
        {formatQuoteDateOnlyUk(data.comparisonPeriod.from)} –{" "}
        {formatQuoteDateOnlyUk(data.comparisonPeriod.to)}
      </p>
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
          <tr className="border-b border-border/50">
            <td className="py-2 pr-3">Net sales</td>
            <td className="py-2 pr-3 text-right tabular-nums">
              {gbp(String(data.overall.netSales.selected))}
            </td>
            <td className="py-2 pr-3 text-right tabular-nums">
              {gbp(String(data.overall.netSales.comparison))}
            </td>
            <td className="py-2 pr-3 text-right tabular-nums">
              {gbp(String(data.overall.netSales.change))}
            </td>
            <td className="py-2 text-right tabular-nums">
              {pct(data.overall.netSales.percentChange)}
            </td>
          </tr>
          <tr className="border-b border-border/50">
            <td className="py-2 pr-3">Units</td>
            <td className="py-2 pr-3 text-right tabular-nums">{data.overall.units.selected}</td>
            <td className="py-2 pr-3 text-right tabular-nums">{data.overall.units.comparison}</td>
            <td className="py-2 pr-3 text-right tabular-nums">{data.overall.units.change}</td>
            <td className="py-2 text-right tabular-nums">{pct(data.overall.units.percentChange)}</td>
          </tr>
          {showCustomers && data.overall.customers ? (
            <tr className="border-b border-border/50">
              <td className="py-2 pr-3">Customers</td>
              <td className="py-2 pr-3 text-right tabular-nums">{data.overall.customers.selected}</td>
              <td className="py-2 pr-3 text-right tabular-nums">
                {data.overall.customers.comparison}
              </td>
              <td className="py-2 pr-3 text-right tabular-nums">{data.overall.customers.change}</td>
              <td className="py-2 text-right tabular-nums">
                {pct(data.overall.customers.percentChange)}
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
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
  page,
  totalPages,
  onPage,
  enquiryLink,
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
  page: number;
  totalPages: number;
  onPage: (p: number) => void;
  enquiryLink: (sku: string) => string;
}) {
  return (
    <div className="space-y-6">
      <div className="border-b border-border pb-3">
        <h2 className="font-display text-xl font-semibold uppercase tracking-wide">
          {data.company.name}
        </h2>
        <p className="mt-1 text-[13px] text-steel">
          {data.company.autopartCustomerCode || data.company.accountNumber || "No Autopart code"}
          {data.company.salesperson ? ` · ${data.company.salesperson.name}` : ""}
        </p>
        <p className="mt-1 text-[11px] text-steel">{data.dataSource}</p>
      </div>

      <CountStrip counts={data.statusCounts} />
      <OverallMovement data={data} />

      {(data.brandMovement.length > 0 || data.categoryMovement.length > 0) && (
        <div className="grid gap-4 lg:grid-cols-2">
          <MovementTable title="Brand" rows={data.brandMovement} />
          <MovementTable title="Category" rows={data.categoryMovement} />
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <label className="text-[12px]">
          Status
          <select
            className="mt-1 block h-10 w-full rounded-md border border-border bg-background px-3 text-[13px]"
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
        </label>
        <label className="text-[12px]">
          Compare by
          <select
            className="mt-1 block h-10 w-full rounded-md border border-border bg-background px-3 text-[13px]"
            value={compareBy}
            onChange={(e) => onCompareBy(e.target.value as "UNITS" | "NET_SALES")}
          >
            <option value="UNITS">Units</option>
            <option value="NET_SALES">Net sales</option>
          </select>
        </label>
        <label className="text-[12px]">
          Search
          <input
            className="mt-1 block h-10 w-full rounded-md border border-border bg-background px-3 text-[13px]"
            value={filterQ}
            onChange={(e) => setFilterQ(e.target.value)}
            placeholder="SKU or name"
          />
        </label>
        <label className="text-[12px]">
          Brand
          <select
            className="mt-1 block h-10 w-full rounded-md border border-border bg-background px-3 text-[13px]"
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
        </label>
        <label className="text-[12px]">
          Category
          <select
            className="mt-1 block h-10 w-full rounded-md border border-border bg-background px-3 text-[13px]"
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
        </label>
        <label className="text-[12px]">
          Sort
          <select
            className="mt-1 block h-10 w-full rounded-md border border-border bg-background px-3 text-[13px]"
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
        </label>
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
              <thead>
                <tr className="border-b-2 border-foreground text-[11px] uppercase tracking-wide text-steel">
                  <th className="py-2 pr-2">Status</th>
                  <th className="py-2 pr-2">Product</th>
                  <th className="py-2 pr-2 text-right">Cmp qty</th>
                  <th className="py-2 pr-2 text-right">Sel qty</th>
                  <th className="py-2 pr-2 text-right">Qty Δ</th>
                  <th className="py-2 pr-2 text-right">Cmp net</th>
                  <th className="py-2 pr-2 text-right">Sel net</th>
                  <th className="py-2 pr-2 text-right">Net Δ</th>
                  <th className="py-2 pr-2">Last purchased</th>
                  <th className="py-2">Action</th>
                </tr>
              </thead>
              <tbody>
                {data.items.items.map((r) => (
                  <tr key={r.sku} className="border-b border-border/60">
                    <td className="py-2 pr-2">
                      <StatusBadge tone={statusTone(r.status)}>{statusLabel(r.status)}</StatusBadge>
                    </td>
                    <td className="py-2 pr-2">
                      <div className="font-medium">{r.name}</div>
                      <div className="font-mono text-[11px] text-steel">
                        {r.sku}
                        {!r.inCatalogue ? " · Historic only" : r.brandName ? ` · ${r.brandName}` : ""}
                      </div>
                      {r.availabilityBand === "historic" ? (
                        <span className="text-[11px] text-steel">{r.availabilityLabel}</span>
                      ) : (
                        <AvailabilityBadge availability={r.availabilityBand as PublicAvailability} />
                      )}
                    </td>
                    <td className="py-2 pr-2 text-right tabular-nums">{r.comparisonQty}</td>
                    <td className="py-2 pr-2 text-right tabular-nums">{r.selectedQty}</td>
                    <td className="py-2 pr-2 text-right tabular-nums">{r.qtyChange}</td>
                    <td className="py-2 pr-2 text-right tabular-nums">{gbp(r.comparisonNetSales)}</td>
                    <td className="py-2 pr-2 text-right tabular-nums">{gbp(r.selectedNetSales)}</td>
                    <td className="py-2 pr-2 text-right tabular-nums">{gbp(r.netChange)}</td>
                    <td className="py-2 pr-2 text-steel">
                      {r.lastPurchasedDate ? formatQuoteDateOnlyUk(r.lastPurchasedDate) : "—"}
                    </td>
                    <td className="py-2">
                      <a
                        href={enquiryLink(r.sku)}
                        className="text-[11px] font-bold uppercase text-primary"
                      >
                        View enquiry
                      </a>
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
                    <div className="font-mono text-[11px] text-steel">{r.sku}</div>
                  </div>
                  <StatusBadge tone={statusTone(r.status)}>{statusLabel(r.status)}</StatusBadge>
                </div>
                <dl className="mt-2 grid grid-cols-2 gap-1 text-[12px]">
                  <div>
                    <dt className="text-steel">Cmp qty</dt>
                    <dd className="tabular-nums">{r.comparisonQty}</dd>
                  </div>
                  <div>
                    <dt className="text-steel">Sel qty</dt>
                    <dd className="tabular-nums">{r.selectedQty}</dd>
                  </div>
                  <div>
                    <dt className="text-steel">Cmp net</dt>
                    <dd className="tabular-nums">{gbp(r.comparisonNetSales)}</dd>
                  </div>
                  <div>
                    <dt className="text-steel">Sel net</dt>
                    <dd className="tabular-nums">{gbp(r.selectedNetSales)}</dd>
                  </div>
                  <div>
                    <dt className="text-steel">Qty Δ</dt>
                    <dd className="tabular-nums">{r.qtyChange}</dd>
                  </div>
                  <div>
                    <dt className="text-steel">Net Δ</dt>
                    <dd className="tabular-nums">{gbp(r.netChange)}</dd>
                  </div>
                </dl>
                <p className="mt-1 text-[12px] text-steel">
                  Last purchased{" "}
                  {r.lastPurchasedDate ? formatQuoteDateOnlyUk(r.lastPurchasedDate) : "—"}
                </p>
                <a
                  href={enquiryLink(r.sku)}
                  className="mt-2 inline-block text-[11px] font-bold uppercase text-primary"
                >
                  View enquiry
                </a>
              </div>
            ))}
          </div>
          <Pager page={page} totalPages={totalPages} total={data.items.total} onPage={onPage} />
        </>
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
  page,
  totalPages,
  onPage,
  enquiryLink,
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
  page: number;
  totalPages: number;
  onPage: (p: number) => void;
  enquiryLink: (companyId: string) => string;
}) {
  return (
    <div className="space-y-6">
      <div className="border-b border-border pb-3">
        <h2 className="font-display text-xl font-semibold uppercase tracking-wide">
          {data.product.name}
        </h2>
        <p className="mt-1 font-mono text-[13px] text-steel">
          {data.product.sku}
          {!data.product.inCatalogue ? " · Historic only" : ""}
        </p>
        <p className="mt-1 text-[11px] text-steel">{data.dataSource}</p>
      </div>

      <CountStrip
        counts={{
          stopped: data.statusCounts.stopped,
          decreased: data.statusCounts.decreased,
          increased: data.statusCounts.increased,
          new: data.statusCounts.new,
          unchanged: data.statusCounts.unchanged,
        }}
      />
      <OverallMovement data={data} showCustomers />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        <label className="text-[12px]">
          Status
          <select
            className="mt-1 block h-10 w-full rounded-md border border-border bg-background px-3 text-[13px]"
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
        </label>
        <label className="text-[12px]">
          Compare by
          <select
            className="mt-1 block h-10 w-full rounded-md border border-border bg-background px-3 text-[13px]"
            value={compareBy}
            onChange={(e) => onCompareBy(e.target.value as "UNITS" | "NET_SALES")}
          >
            <option value="UNITS">Units</option>
            <option value="NET_SALES">Net sales</option>
          </select>
        </label>
        <label className="text-[12px]">
          Search
          <input
            className="mt-1 block h-10 w-full rounded-md border border-border bg-background px-3 text-[13px]"
            value={filterQ}
            onChange={(e) => setFilterQ(e.target.value)}
            placeholder="Customer or account"
          />
        </label>
        <label className="text-[12px]">
          Salesperson
          <select
            className="mt-1 block h-10 w-full rounded-md border border-border bg-background px-3 text-[13px]"
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
        </label>
        <label className="text-[12px]">
          Sort
          <select
            className="mt-1 block h-10 w-full rounded-md border border-border bg-background px-3 text-[13px]"
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
        </label>
      </div>

      {data.items.total === 0 ? (
        <p className="text-[14px] text-steel">
          No customers found for this product in the selected periods.
        </p>
      ) : (
        <>
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full text-left text-[13px]">
              <thead>
                <tr className="border-b-2 border-foreground text-[11px] uppercase tracking-wide text-steel">
                  <th className="py-2 pr-2">Status</th>
                  <th className="py-2 pr-2">Customer</th>
                  <th className="py-2 pr-2">Salesperson</th>
                  <th className="py-2 pr-2 text-right">Cmp qty</th>
                  <th className="py-2 pr-2 text-right">Sel qty</th>
                  <th className="py-2 pr-2 text-right">Qty Δ</th>
                  <th className="py-2 pr-2 text-right">Cmp net</th>
                  <th className="py-2 pr-2 text-right">Sel net</th>
                  <th className="py-2 pr-2 text-right">Net Δ</th>
                  <th className="py-2 pr-2">Last purchased</th>
                  <th className="py-2">Action</th>
                </tr>
              </thead>
              <tbody>
                {data.items.items.map((r) => (
                  <tr key={r.companyId} className="border-b border-border/60">
                    <td className="py-2 pr-2">
                      <StatusBadge tone={statusTone(r.status)}>{statusLabel(r.status)}</StatusBadge>
                    </td>
                    <td className="py-2 pr-2">
                      <div className="font-medium">{r.name}</div>
                      <div className="font-mono text-[11px] text-steel">{r.account || "—"}</div>
                    </td>
                    <td className="py-2 pr-2 text-steel">{r.salespersonName || "—"}</td>
                    <td className="py-2 pr-2 text-right tabular-nums">{r.comparisonQty}</td>
                    <td className="py-2 pr-2 text-right tabular-nums">{r.selectedQty}</td>
                    <td className="py-2 pr-2 text-right tabular-nums">{r.qtyChange}</td>
                    <td className="py-2 pr-2 text-right tabular-nums">{gbp(r.comparisonNetSales)}</td>
                    <td className="py-2 pr-2 text-right tabular-nums">{gbp(r.selectedNetSales)}</td>
                    <td className="py-2 pr-2 text-right tabular-nums">{gbp(r.netChange)}</td>
                    <td className="py-2 pr-2 text-steel">
                      {r.lastPurchasedDate ? formatQuoteDateOnlyUk(r.lastPurchasedDate) : "—"}
                    </td>
                    <td className="py-2">
                      <a
                        href={enquiryLink(r.companyId)}
                        className="text-[11px] font-bold uppercase text-primary"
                      >
                        View enquiry
                      </a>
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
                  <StatusBadge tone={statusTone(r.status)}>{statusLabel(r.status)}</StatusBadge>
                </div>
                <dl className="mt-2 grid grid-cols-2 gap-1 text-[12px]">
                  <div>
                    <dt className="text-steel">Cmp qty</dt>
                    <dd className="tabular-nums">{r.comparisonQty}</dd>
                  </div>
                  <div>
                    <dt className="text-steel">Sel qty</dt>
                    <dd className="tabular-nums">{r.selectedQty}</dd>
                  </div>
                  <div>
                    <dt className="text-steel">Net Δ</dt>
                    <dd className="tabular-nums">{gbp(r.netChange)}</dd>
                  </div>
                  <div>
                    <dt className="text-steel">Last purchased</dt>
                    <dd>
                      {r.lastPurchasedDate ? formatQuoteDateOnlyUk(r.lastPurchasedDate) : "—"}
                    </dd>
                  </div>
                </dl>
                <a
                  href={enquiryLink(r.companyId)}
                  className="mt-2 inline-block text-[11px] font-bold uppercase text-primary"
                >
                  View enquiry
                </a>
              </div>
            ))}
          </div>
          <Pager page={page} totalPages={totalPages} total={data.items.total} onPage={onPage} />
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
              <td className="py-1.5 text-right tabular-nums">{gbp(r.change)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Pager({
  page,
  totalPages,
  total,
  onPage,
}: {
  page: number;
  totalPages: number;
  total: number;
  onPage: (p: number) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <p className="text-[12px] text-steel">
        Page {page} of {totalPages} · {total} rows
      </p>
      <div className="flex gap-2">
        <button
          type="button"
          disabled={page <= 1}
          onClick={() => onPage(Math.max(1, page - 1))}
          className="h-9 rounded-md border border-border px-3 text-[11px] font-bold uppercase disabled:opacity-40"
        >
          Previous
        </button>
        <button
          type="button"
          disabled={page >= totalPages}
          onClick={() => onPage(page + 1)}
          className="h-9 rounded-md border border-border px-3 text-[11px] font-bold uppercase disabled:opacity-40"
        >
          Next
        </button>
      </div>
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
