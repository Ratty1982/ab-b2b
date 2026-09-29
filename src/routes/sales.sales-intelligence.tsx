import { createFileRoute } from "@tanstack/react-router";
import { Fragment, useEffect, useMemo, useState } from "react";
import { PanelHeader } from "@/components/ab/AppShell";
import { AvailabilityBadge } from "@/components/ab/AvailabilityBadge";
import { StatusBadge } from "@/components/ab/Badges";
import { ROUTES } from "@/lib/app-nav";
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
  exportCustomerSalesEnquiryCsvFn,
  exportProductSalesEnquiryCsvFn,
  getCustomerSalesEnquiryFn,
  getProductSalesEnquiryFn,
  searchSalesIntelligenceCustomersFn,
  searchSalesIntelligenceProductsFn,
} from "@/server/phase2/fns";

export const Route = createFileRoute("/sales/sales-intelligence")({
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

function gbp(value: string) {
  return formatGbp(value);
}

function pct(value: number | null) {
  if (value == null) return "—";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(2)}%`;
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
    compare?: "OFF" | "PREVIOUS" | "CUSTOM";
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

  return (
    <div>
      <PanelHeader
        title="Sales Enquiry"
        sub="Internal enquiry from Autopart historic invoices and credits"
        crumbs={[
          { label: "Sales Intelligence" },
          { label: "Sales Enquiry", to: ROUTES.salesIntelligence },
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

        <div className="grid gap-3 lg:grid-cols-[minmax(0,1.4fr)_repeat(3,minmax(0,1fr))]">
          {mode === "customers" ? (
            <label className="text-[12px]">
              Customer
              <input
                className="mt-1 block h-10 w-full rounded-md border border-border bg-background px-3 text-[13px]"
                placeholder="Search name, Autopart account, postcode…"
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
                          {c.salesperson ? ` · ${c.salesperson.name}` : ""}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </label>
          ) : (
            <label className="text-[12px]">
              Product / SKU
              <input
                className="mt-1 block h-10 w-full rounded-md border border-border bg-background px-3 text-[13px]"
                placeholder="Search SKU, name, brand, historic SKU…"
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
                        <span className="font-mono text-[11px] text-steel">
                          {p.sku}
                          {!p.inCatalogue ? " · Historic only" : p.brandName ? ` · ${p.brandName}` : ""}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </label>
          )}

          <label className="text-[12px]">
            Period
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
            Compare
            <select
              className="mt-1 block h-10 w-full rounded-md border border-border bg-background px-3 text-[13px]"
              value={compare}
              onChange={(e) =>
                patch({
                  compare: e.target.value as "OFF" | "PREVIOUS" | "CUSTOM",
                  page: 1,
                })
              }
            >
              <option value="OFF">Off</option>
              <option value="PREVIOUS">Previous equivalent period</option>
              <option value="CUSTOM">Custom comparison</option>
            </select>
          </label>

          <label className="text-[12px]">
            Sort
            <select
              className="mt-1 block h-10 w-full rounded-md border border-border bg-background px-3 text-[13px]"
              value={sort}
              onChange={(e) => patch({ sort: e.target.value, page: 1 })}
            >
              <option value="NET_SALES">Net sales high → low</option>
              <option value="QTY">Qty high → low</option>
              <option value="PURCHASES">Most purchases</option>
              <option value="RECENT">Most recently purchased</option>
              <option value="NAME_AZ">{mode === "customers" ? "Product A–Z" : "Customer A–Z"}</option>
            </select>
          </label>
        </div>

        {period === "CUSTOM" ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-[12px]">
              From
              <input
                type="date"
                className="mt-1 block h-10 w-full rounded-md border border-border bg-background px-3 text-[13px]"
                value={search.from ?? ""}
                onChange={(e) => patch({ from: e.target.value || null, page: 1 })}
              />
            </label>
            <label className="text-[12px]">
              To
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
              Compare from
              <input
                type="date"
                className="mt-1 block h-10 w-full rounded-md border border-border bg-background px-3 text-[13px]"
                value={search.compareFrom ?? ""}
                onChange={(e) => patch({ compareFrom: e.target.value || null })}
              />
            </label>
            <label className="text-[12px]">
              Compare to
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

        {!loading &&
        mode === "customers" &&
        !search.companyId ? (
          <p className="text-[14px] text-steel">Search and select a customer to begin.</p>
        ) : null}
        {!loading && mode === "products" && !search.sku ? (
          <p className="text-[14px] text-steel">Search and select a product or historic SKU to begin.</p>
        ) : null}
      </div>
    </div>
  );
}

function SummaryStrip({
  summary,
  period,
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
  period: { from: string; to: string };
  showCustomers?: boolean;
}) {
  const cards = [
    { label: "Invoice sales", value: gbp(summary.invoiceSales) },
    { label: "Credits", value: gbp(summary.credits) },
    { label: "Net sales", value: gbp(summary.netSales) },
    { label: "Units", value: String(summary.units) },
    { label: "Purchase transactions", value: String(summary.purchaseTransactions) },
    showCustomers
      ? { label: "Customers", value: String(summary.customers) }
      : { label: "Products purchased", value: String(summary.productsPurchased) },
  ];
  return (
    <div>
      <p className="mb-2 text-[11px] uppercase tracking-wide text-steel">
        Period {formatQuoteDateOnlyUk(period.from)} – {formatQuoteDateOnlyUk(period.to)}
      </p>
      <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-6">
        {cards.map((c) => (
          <div key={c.label} className="border-b border-border/70 pb-2">
            <div className="text-[10px] uppercase tracking-wide text-steel">{c.label}</div>
            <div className="mt-1 font-display text-lg font-semibold tabular-nums">{c.value}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ComparisonBlock({
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
    <div className="overflow-x-auto">
      <p className="mb-2 text-[11px] uppercase tracking-wide text-steel">
        Comparison {formatQuoteDateOnlyUk(comparison.comparison.from)} –{" "}
        {formatQuoteDateOnlyUk(comparison.comparison.to)}
      </p>
      <table className="w-full text-left text-[13px]">
        <thead>
          <tr className="border-b border-border text-[11px] uppercase tracking-wide text-steel">
            <th className="py-2 pr-3">Metric</th>
            <th className="py-2 pr-3 text-right">Primary</th>
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
              <td className="py-2 text-right tabular-nums">{pct(r.m.percentChange)}</td>
            </tr>
          ))}
        </tbody>
      </table>
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
  expandedSku: string | null;
  onToggleSku: (sku: string) => void;
  page: number;
  totalPages: number;
  onPage: (p: number) => void;
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
          {data.company.paymentTerms ? ` · ${data.company.paymentTerms}` : ""}
        </p>
        <p className="mt-1 text-[11px] text-steel">{data.dataSource}</p>
      </div>

      <SummaryStrip summary={data.summary} period={data.period} />
      {data.comparison ? <ComparisonBlock comparison={data.comparison} /> : null}

      {(data.brandBreakdown.length > 0 || data.categoryBreakdown.length > 0) && (
        <div className="grid gap-4 lg:grid-cols-2">
          <BreakdownTable title="Brand" rows={data.brandBreakdown} />
          <BreakdownTable title="Category" rows={data.categoryBreakdown} />
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-3">
        <label className="text-[12px]">
          Search products
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
      </div>

      {data.products.total === 0 ? (
        <p className="text-[14px] text-steel">No purchases found for this period.</p>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[13px]">
              <thead>
                <tr className="border-b-2 border-foreground text-[11px] uppercase tracking-wide text-steel">
                  <th className="py-2 pr-3">Product</th>
                  <th className="py-2 pr-3">Last purchased</th>
                  <th className="py-2 pr-3 text-right">Purchases</th>
                  <th className="py-2 pr-3 text-right">Qty</th>
                  <th className="py-2 pr-3 text-right">Invoice</th>
                  <th className="py-2 pr-3 text-right">Credits</th>
                  <th className="py-2 pr-3 text-right">Net</th>
                  <th className="py-2">Availability</th>
                </tr>
              </thead>
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
                          {!item.inCatalogue ? " · Historic" : ""}
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
                      <td className="py-2.5 pr-3 text-right tabular-nums">{gbp(item.netSales)}</td>
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
          <Pager page={page} totalPages={totalPages} total={data.products.total} onPage={onPage} />
        </>
      )}
    </div>
  );
}

function ProductEnquiryView({
  data,
  filterQ,
  setFilterQ,
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
  expandedCompanyId: string | null;
  onToggleCompany: (id: string) => void;
  onOpenCustomer: (companyId: string) => void;
  page: number;
  totalPages: number;
  onPage: (p: number) => void;
}) {
  return (
    <div className="space-y-6">
      <div className="border-b border-border pb-3">
        <h2 className="font-display text-xl font-semibold uppercase tracking-wide">
          {data.product.name}
        </h2>
        <p className="mt-1 font-mono text-[13px] text-steel">
          {data.product.sku}
          {data.product.brandName ? ` · ${data.product.brandName}` : ""}
          {!data.product.inCatalogue ? " · Historic only (not in catalogue)" : ""}
        </p>
        {data.product.latestAutopartCost !== undefined ? (
          <p className="mt-1 text-[12px] text-steel">
            Latest Autopart cost:{" "}
            {data.product.latestAutopartCost != null
              ? `£${data.product.latestAutopartCost}`
              : "No cost observation yet"}
          </p>
        ) : null}
        <p className="mt-1 text-[11px] text-steel">{data.dataSource}</p>
      </div>

      <SummaryStrip summary={data.summary} period={data.period} showCustomers />
      {data.comparison ? <ComparisonBlock comparison={data.comparison} /> : null}

      <label className="block text-[12px] sm:max-w-sm">
        Search customers
        <input
          className="mt-1 block h-10 w-full rounded-md border border-border bg-background px-3 text-[13px]"
          value={filterQ}
          onChange={(e) => setFilterQ(e.target.value)}
          placeholder="Customer or account"
        />
      </label>

      {data.customers.total === 0 ? (
        <p className="text-[14px] text-steel">No customers purchased this product in this period.</p>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[13px]">
              <thead>
                <tr className="border-b-2 border-foreground text-[11px] uppercase tracking-wide text-steel">
                  <th className="py-2 pr-3">Customer</th>
                  <th className="py-2 pr-3">Salesperson</th>
                  <th className="py-2 pr-3">Last purchased</th>
                  <th className="py-2 pr-3 text-right">Purchases</th>
                  <th className="py-2 pr-3 text-right">Qty</th>
                  <th className="py-2 pr-3 text-right">Invoice</th>
                  <th className="py-2 pr-3 text-right">Credits</th>
                  <th className="py-2 text-right">Net</th>
                </tr>
              </thead>
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
                      <td className="py-2.5 text-right tabular-nums">{gbp(c.netSales)}</td>
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
          <Pager page={page} totalPages={totalPages} total={data.customers.total} onPage={onPage} />
        </>
      )}
    </div>
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
            <td className="py-1 pr-2">
              {t.date ? formatQuoteDateOnlyUk(t.date) : "—"}
            </td>
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
