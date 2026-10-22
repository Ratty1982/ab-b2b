import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { StatusBadge } from "@/components/ab/Badges";
import {
  SiCreateFollowUpButton,
  type FollowUpRequest,
} from "@/components/sales-intelligence/create-followup-drawer";
import {
  SiClearFiltersButton,
  SiField,
  SiMetricCard,
  SiPager,
  siControlClassName,
} from "@/components/sales-intelligence/workspace";
import { COMPANY_STATUS_LABEL } from "@/domain/company";
import { formatQuoteDateOnlyUk } from "@/domain/quote";
import { formatGbp } from "@/domain/sales-intelligence";
import {
  isRetryCoolingDown,
  retryAvailableAt,
  salesEnquiryErrorText,
} from "@/domain/sales-enquiry-report";
import {
  SALES_ENQUIRY_DASHBOARD_PERIODS,
  salesEnquiryDashboardPeriodLabel,
  salesEnquirySectionLoads,
  type SalesEnquiryDashboardPeriod,
  type SalesEnquirySection,
} from "@/domain/sales-enquiry-dashboard";
import { formatQuantity } from "@/lib/format-quantity";
import { cn } from "@/lib/utils";
import { SalesReconciliationInvestigation } from "@/components/sales-intelligence/sales-reconciliation-investigation";
import {
  createCrmOpportunityFn,
  exportUnifiedCustomerSalesCsvFn,
  getUnifiedCustomerHistoryFn,
  getUnifiedCustomerSalesFn,
  listUnifiedCustomerProductsFn,
  listUnifiedCustomerTransactionsFn,
} from "@/server/phase2/fns";

type Dashboard = Extract<Awaited<ReturnType<typeof getUnifiedCustomerSalesFn>>, { ok: true }>["data"];
type Transactions = Extract<
  Awaited<ReturnType<typeof listUnifiedCustomerTransactionsFn>>,
  { ok: true }
>["data"];
type Products = Extract<Awaited<ReturnType<typeof listUnifiedCustomerProductsFn>>, { ok: true }>["data"];
type History = Extract<Awaited<ReturnType<typeof getUnifiedCustomerHistoryFn>>, { ok: true }>["data"];

type TxFilters = {
  type: "ALL" | "INVOICE" | "CREDIT";
  q: string;
  brandId: string;
  accountCode: string;
};

const EMPTY_FILTERS: TxFilters = { type: "ALL", q: "", brandId: "", accountCode: "" };

const SECTIONS: Array<{ id: SalesEnquirySection; label: string }> = [
  { id: "overview", label: "Overview" },
  { id: "transactions", label: "Transactions" },
  { id: "products", label: "Products Purchased" },
  { id: "history", label: "Reconciliation" },
];

function dateUk(value: string | null | undefined, fallback = "—"): string {
  return value ? formatQuoteDateOnlyUk(value.slice(0, 10)) : fallback;
}

function downloadCsv(csv: string, filename: string) {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function ReportNotice({
  loading,
  loadingLabel,
  error,
  onRetry,
}: {
  loading: boolean;
  loadingLabel: string;
  error: string | null;
  onRetry: () => void;
}) {
  const [now, setNow] = useState(() => Date.now());
  const [availableAt, setAvailableAt] = useState(0);
  useEffect(() => {
    if (!error) return;
    setAvailableAt(retryAvailableAt(Date.now()));
    const handle = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(handle);
  }, [error]);
  if (!loading && !error) return null;
  return (
    <div className="rounded-md border border-border bg-surface/40 px-3 py-2 text-[13px]" role="status">
      {loading ? <p className="text-steel">{loadingLabel}</p> : null}
      {error ? (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-bad">{error}</p>
          <button
            type="button"
            className="inline-flex h-9 items-center rounded-md border border-border px-3 text-[11px] font-bold uppercase disabled:opacity-50"
            disabled={Boolean(error) && isRetryCoolingDown(now, availableAt)}
            onClick={onRetry}
          >
            Retry
          </button>
        </div>
      ) : null}
    </div>
  );
}

function Skeleton() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Loading customer sales">
      <div className="h-16 animate-pulse rounded-md bg-surface/60" />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, index) => (
          <div key={index} className="h-20 animate-pulse rounded-md border border-border bg-surface/40" />
        ))}
      </div>
      <div className="h-56 animate-pulse rounded-md border border-border bg-surface/30" />
    </div>
  );
}

function documentTone(type: string) {
  return type === "CREDIT" ? ("warn" as const) : ("good" as const);
}

export function UnifiedCustomerSalesPanel({
  companyId,
  onFollowUp,
  onChangeCustomer,
}: {
  companyId: string;
  onFollowUp: (request: FollowUpRequest) => void;
  onChangeCustomer: () => void;
}) {
  const [period, setPeriod] = useState<SalesEnquiryDashboardPeriod>("THIS_MONTH");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [section, setSection] = useState<SalesEnquirySection>("overview");
  const [data, setData] = useState<Dashboard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [loadingCustomer, setLoadingCustomer] = useState(true);
  const [attempt, setAttempt] = useState(0);
  const [filters, setFilters] = useState<TxFilters>(EMPTY_FILTERS);
  const [qDraft, setQDraft] = useState("");
  const [txPage, setTxPage] = useState(1);
  const [tx, setTx] = useState<Transactions | null>(null);
  const [loadingTx, setLoadingTx] = useState(false);
  const [productQ, setProductQ] = useState("");
  const [productSort, setProductSort] = useState<"NET_SALES" | "QTY" | "RECENT" | "NAME_AZ">("NET_SALES");
  const [productPage, setProductPage] = useState(1);
  const [products, setProducts] = useState<Products | null>(null);
  const [loadingProducts, setLoadingProducts] = useState(false);
  const [history, setHistory] = useState<History | null>(null);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [selectedSku, setSelectedSku] = useState<string | null>(null);
  const [createdOpportunities, setCreatedOpportunities] = useState<Set<string>>(new Set());
  const [exporting, setExporting] = useState(false);
  const customReady = period !== "CUSTOM" || (customFrom !== "" && customTo !== "" && customTo >= customFrom);

  useEffect(() => {
    setSection("overview");
    setFilters(EMPTY_FILTERS);
    setQDraft("");
    setTx(null);
    setProducts(null);
    setHistory(null);
    setSelectedSku(null);
    setNote(null);
    setTxPage(1);
    setProductPage(1);
  }, [companyId]);

  useEffect(() => {
    if (!customReady) return;
    let cancelled = false;
    setLoadingCustomer(true);
    setError(null);
    void getUnifiedCustomerSalesFn({
      data: {
        companyId,
        period,
        from: period === "CUSTOM" ? customFrom : null,
        to: period === "CUSTOM" ? customTo : null,
      },
    }).then((result) => {
      if (cancelled) return;
      setLoadingCustomer(false);
      if (!result.ok) {
        setError(salesEnquiryErrorText(result.error, result.code));
        setData(null);
        return;
      }
      setData(result.data);
    });
    return () => {
      cancelled = true;
    };
  }, [companyId, period, customFrom, customTo, customReady, attempt]);

  useEffect(() => {
    const handle = window.setTimeout(() => {
      if (qDraft !== filters.q) {
        setFilters((current) => ({ ...current, q: qDraft }));
        setTxPage(1);
      }
    }, 300);
    return () => window.clearTimeout(handle);
  }, [qDraft, filters.q]);

  useEffect(() => {
    const loads = salesEnquirySectionLoads(section);
    if (!loads.transactions || !data || !customReady) return;
    let cancelled = false;
    setLoadingTx(true);
    const handle = window.setTimeout(() => {
      void listUnifiedCustomerTransactionsFn({
        data: {
          companyId,
          type: filters.type,
          status: "COUNTED",
          dating: data.period.preset === "ALL" ? "ALL" : "DATED",
          from: data.period.from,
          to: data.period.to,
          scope: data.period.preset === "ALL" ? "LIFETIME" : "PERIOD",
          q: filters.q || null,
          brandId: filters.brandId || null,
          accountCode: filters.accountCode || null,
          page: txPage,
          pageSize: 50,
        },
      }).then((result) => {
        if (cancelled) return;
        setLoadingTx(false);
        if (!result.ok) setError(salesEnquiryErrorText(result.error, result.code));
        else {
          setError(null);
          setTx(result.data);
        }
      });
    }, 200);
    return () => {
      cancelled = true;
      window.clearTimeout(handle);
    };
  }, [section, data, filters, txPage, companyId, customReady, attempt]);

  useEffect(() => {
    const loads = salesEnquirySectionLoads(section);
    if (!loads.products || !data || !customReady) return;
    let cancelled = false;
    setLoadingProducts(true);
    const handle = window.setTimeout(() => {
      void listUnifiedCustomerProductsFn({
        data: {
          companyId,
          q: productQ.trim() || null,
          brandId: filters.brandId || null,
          sort: productSort,
          from: data.period.from,
          to: data.period.to,
          scope: data.period.preset === "ALL" ? "LIFETIME" : "PERIOD",
          page: productPage,
          pageSize: 25,
        },
      }).then((result) => {
        if (cancelled) return;
        setLoadingProducts(false);
        if (!result.ok) setError(salesEnquiryErrorText(result.error, result.code));
        else {
          setError(null);
          setProducts(result.data);
        }
      });
    }, 200);
    return () => {
      cancelled = true;
      window.clearTimeout(handle);
    };
  }, [section, data, productQ, productSort, productPage, filters.brandId, companyId, customReady, attempt]);

  useEffect(() => {
    const loads = salesEnquirySectionLoads(section);
    if (!loads.history) return;
    let cancelled = false;
    setLoadingHistory(true);
    void getUnifiedCustomerHistoryFn({ data: { companyId } }).then((result) => {
      if (cancelled) return;
      setLoadingHistory(false);
      if (!result.ok) setError(salesEnquiryErrorText(result.error, result.code));
      else {
        setError(null);
        setHistory(result.data);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [section, companyId, attempt]);

  function choosePeriod(next: SalesEnquiryDashboardPeriod) {
    setPeriod(next);
    setTx(null);
    setProducts(null);
    setTxPage(1);
    setProductPage(1);
  }

  async function createOpportunity(title: string, description: string) {
    if (createdOpportunities.has("customer")) return;
    setCreatedOpportunities((current) => new Set(current).add("customer"));
    const result = await createCrmOpportunityFn({ data: { companyId, title, description } });
    if (!result.ok) {
      setCreatedOpportunities((current) => {
        const next = new Set(current);
        next.delete("customer");
        return next;
      });
      setError(result.error);
      return;
    }
    setNote("Opportunity created. No customer message was sent.");
  }

  async function exportCsv(kind: "transactions" | "products") {
    if (!data) return;
    setExporting(true);
    const scope = data.period.preset === "ALL" ? "LIFETIME" : "PERIOD";
    const result = await exportUnifiedCustomerSalesCsvFn({
      data:
        kind === "transactions"
          ? {
              kind,
              companyId,
              type: filters.type,
              status: "COUNTED",
              dating: scope === "PERIOD" ? "DATED" : "ALL",
              from: data.period.from,
              to: data.period.to,
              scope,
              q: filters.q || null,
              brandId: filters.brandId || null,
              accountCode: filters.accountCode || null,
            }
          : {
              kind,
              companyId,
              q: productQ.trim() || null,
              brandId: filters.brandId || null,
              sort: productSort,
              from: data.period.from,
              to: data.period.to,
              scope,
            },
    });
    setExporting(false);
    if (!result.ok) {
      setError(salesEnquiryErrorText(result.error, result.code));
      return;
    }
    downloadCsv(result.data.csv, result.data.filename);
    setNote(
      result.data.truncated
        ? `Export limited to the first ${result.data.rowCount} of ${result.data.total} rows.`
        : `Exported ${result.data.rowCount} rows.`,
    );
  }

  if (!data) {
    return (
      <section className="space-y-3" aria-label="Customer sales">
        {loadingCustomer && customReady ? <Skeleton /> : null}
        {!customReady ? (
          <p className="text-[13px] text-steel">Choose a from and to date for the custom range.</p>
        ) : null}
        <ReportNotice
          loading={false}
          loadingLabel="Loading customer sales…"
          error={error}
          onRetry={() => setAttempt((current) => current + 1)}
        />
      </section>
    );
  }

  const company = data.company;
  const account =
    company.autopartCustomerCode ||
    data.identity.find((code) => code.attached)?.code ||
    company.accountNumber ||
    "No account code";
  const movement = data.comparison
    ? {
        change: data.comparison.movement.change,
        percentChange: data.comparison.movement.percent,
        money: true,
      }
    : null;
  const chart = data.trend.map((point) => ({ label: point.label, net: Number(point.netSales) }));
  const txPages = tx ? Math.max(1, Math.ceil(tx.total / tx.pageSize)) : 1;
  const productPages = products ? Math.max(1, Math.ceil(products.total / products.pageSize)) : 1;
  const adminCustomer = company.customer360Href.startsWith("/admin/");

  return (
    <section className="space-y-4" aria-label="Customer sales">
      <header className="rounded-md border border-border bg-card p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-steel">Sales enquiry</p>
            <h2 className="mt-1 font-display text-2xl font-semibold leading-tight">{company.name}</h2>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-[13px] text-steel">
              <StatusBadge
                tone={company.status === "ACTIVE" ? "good" : company.status === "PROSPECT" ? "info" : "neutral"}
              >
                {(COMPANY_STATUS_LABEL as Record<string, string>)[company.status] ?? company.status}
              </StatusBadge>
              <span className="font-mono text-foreground">{account}</span>
              <span>{company.salesperson ? company.salesperson.name : "No salesperson assigned"}</span>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {adminCustomer ? (
              <Link
                to="/admin/customers/$id"
                params={{ id: company.id }}
                className="inline-flex h-9 items-center rounded-md border border-border px-3 text-[11px] font-bold uppercase tracking-wide"
              >
                Customer 360
              </Link>
            ) : (
              <Link
                to="/sales/customers/$id"
                params={{ id: company.id }}
                className="inline-flex h-9 items-center rounded-md border border-border px-3 text-[11px] font-bold uppercase tracking-wide"
              >
                Customer 360
              </Link>
            )}
            <button
              type="button"
              className="inline-flex h-9 items-center rounded-md border border-border px-3 text-[11px] font-bold uppercase tracking-wide disabled:opacity-50"
              disabled={createdOpportunities.has("customer")}
              onClick={() =>
                void createOpportunity(
                  `Opportunity — ${company.name}`,
                  `Raised from Sales Enquiry for ${data.period.rangeLabel}.`,
                )
              }
            >
              Create Opportunity
            </button>
            <SiCreateFollowUpButton
              onClick={() =>
                onFollowUp({
                  sourceModule: "SALES_ENQUIRY",
                  sourceReason: "CUSTOMER",
                  companyId,
                  historySource: "unified",
                })
              }
            />
            <button
              type="button"
              className="inline-flex h-9 items-center rounded-md border border-border px-3 text-[11px] font-bold uppercase tracking-wide"
              onClick={onChangeCustomer}
            >
              Change Customer
            </button>
          </div>
        </div>
      </header>

      <div className="rounded-md border border-primary/40 bg-primary/10 px-4 py-3">
        <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-steel">Reporting period</p>
        <p className="mt-1 font-display text-lg font-semibold">
          {data.period.label}
          <span className="ml-2 text-[14px] font-normal text-steel">{data.period.rangeLabel}</span>
        </p>
        <p className="mt-1 text-[12px] text-steel">
          Figures are ex VAT, in GBP.
          {data.period.includesUndatedHistory
            ? " All Time includes imported 561L product lines and ongoing TRM21QC lines. A line with no invoice date is included here and is not given a date. The monthly chart uses dated invoices only."
            : " Documents without an invoice date are not included in this period."}
        </p>
        <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label="Reporting period">
          {SALES_ENQUIRY_DASHBOARD_PERIODS.map((preset) => (
            <button
              key={preset}
              type="button"
              aria-pressed={period === preset}
              className={cn(
                "h-9 rounded-md border px-3 text-[11px] font-bold uppercase tracking-wide",
                period === preset
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border text-steel hover:text-foreground",
              )}
              onClick={() => choosePeriod(preset)}
            >
              {salesEnquiryDashboardPeriodLabel(preset)}
            </button>
          ))}
        </div>
        {period === "CUSTOM" ? (
          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:max-w-lg">
            <SiField label="From">
              <input
                type="date"
                className={siControlClassName(true)}
                value={customFrom}
                onChange={(event) => {
                  setCustomFrom(event.target.value);
                  setTx(null);
                  setProducts(null);
                }}
              />
            </SiField>
            <SiField label="To">
              <input
                type="date"
                className={siControlClassName(true)}
                value={customTo}
                onChange={(event) => {
                  setCustomTo(event.target.value);
                  setTx(null);
                  setProducts(null);
                }}
              />
            </SiField>
          </div>
        ) : null}
      </div>

      <div role="tablist" aria-label="Sales enquiry sections" className="flex flex-wrap gap-2">
        {SECTIONS.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            id={`sales-enquiry-tab-${item.id}`}
            aria-selected={section === item.id}
            aria-controls={`sales-enquiry-panel-${item.id}`}
            className={cn(
              "h-9 rounded-md border px-3 text-[12px] font-semibold",
              section === item.id
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border text-steel hover:text-foreground",
            )}
            onClick={() => setSection(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>

      <ReportNotice
        loading={
          loadingCustomer ||
          (section === "transactions" && loadingTx) ||
          (section === "products" && loadingProducts) ||
          (section === "history" && loadingHistory)
        }
        loadingLabel={
          section === "transactions"
            ? "Loading transactions…"
            : section === "products"
              ? "Loading products…"
              : section === "history"
                ? "Loading historical reporting…"
                : "Loading customer sales…"
        }
        error={error}
        onRetry={() => setAttempt((current) => current + 1)}
      />
      {note ? <p className="text-[13px] text-good">{note}</p> : null}

      {section === "overview" ? (
        <div
          role="tabpanel"
          id="sales-enquiry-panel-overview"
          aria-labelledby="sales-enquiry-tab-overview"
          className="space-y-4"
        >
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-md border border-border bg-card p-3">
              <SiMetricCard
                label="Net sales ex VAT"
                value={formatGbp(data.kpis.netSales)}
                movement={movement}
                primary
              />
              {data.comparison ? (
                <p className="mt-1 text-[12px] text-steel">Compared with {data.comparison.label}</p>
              ) : (
                <p className="mt-1 text-[12px] text-steel">No previous period for All Time.</p>
              )}
            </div>
            <div className="rounded-md border border-border bg-card p-3">
              <SiMetricCard label="Invoices" value={String(data.kpis.invoiceCount)} />
            </div>
            <div className="rounded-md border border-border bg-card p-3">
              <SiMetricCard label="Units sold" value={formatQuantity(data.kpis.units)} />
            </div>
            <div className="rounded-md border border-border bg-card p-3">
              <SiMetricCard label="Credits ex VAT" value={formatGbp(data.kpis.credits)} />
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-5">
            <div className="rounded-md border border-border bg-card p-4 lg:col-span-3">
              <h3 className="font-display text-[15px] font-semibold">Monthly sales, last 12 months</h3>
              <p className="mt-1 text-[12px] text-steel">Dated invoices and credits only. Undated history is not plotted.</p>
              {chart.every((point) => point.net === 0) ? (
                <p className="mt-6 text-[13px] text-steel">No dated sales in the last 12 months.</p>
              ) : (
                <div className="mt-3 h-56">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={chart}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                      <XAxis dataKey="label" tick={{ fontSize: 10 }} interval={0} angle={-35} height={48} textAnchor="end" />
                      <YAxis tick={{ fontSize: 10 }} />
                      <Tooltip formatter={(value) => formatGbp(Number(value).toFixed(2))} />
                      <Bar dataKey="net" name="Net sales" fill="hsl(var(--primary))" radius={[2, 2, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>
            <div className="rounded-md border border-border bg-card p-4 lg:col-span-2">
              <div className="flex items-center justify-between gap-2">
                <h3 className="font-display text-[15px] font-semibold">Best-selling products</h3>
                <button
                  type="button"
                  className="text-[12px] font-semibold text-primary underline"
                  onClick={() => setSection("products")}
                >
                  View all
                </button>
              </div>
              {data.topProducts.length === 0 ? (
                <p className="mt-4 text-[13px] text-steel">No product sales in this period.</p>
              ) : (
                <ol className="mt-3 space-y-2">
                  {data.topProducts.map((product) => (
                    <li key={product.sku} className="flex items-start justify-between gap-3 text-[13px]">
                      <button
                        type="button"
                        className="min-w-0 text-left"
                        onClick={() => {
                          setQDraft(product.sku);
                          setFilters((current) => ({ ...current, q: product.sku }));
                          setSection("transactions");
                        }}
                      >
                        <span className="block font-medium">{product.description || product.sku}</span>
                        <span className="font-mono text-[11px] text-steel">{product.sku}</span>
                      </button>
                      <span className="shrink-0 tabular-nums">{formatGbp(product.netSales)}</span>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          </div>

          <div className="rounded-md border border-border bg-card p-4">
            <div className="flex items-center justify-between gap-2">
              <h3 className="font-display text-[15px] font-semibold">Recent transactions</h3>
              <button
                type="button"
                className="text-[12px] font-semibold text-primary underline"
                onClick={() => setSection("transactions")}
              >
                Open transactions
              </button>
            </div>
            {data.recentTransactions.length === 0 ? (
              <p className="mt-4 text-[13px] text-steel">No transactions in this period.</p>
            ) : (
              <ul className="mt-3 divide-y divide-border">
                {data.recentTransactions.map((item) => (
                  <li key={item.lineId} className="flex flex-wrap items-center justify-between gap-2 py-2 text-[13px]">
                    <div className="min-w-0">
                      <p className="font-medium">
                        {item.reference || "No reference"} · {item.description || item.sku}
                      </p>
                      <p className="text-[12px] text-steel">
                        {item.dateLabel} · <span className="font-mono">{item.sku}</span>
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <StatusBadge tone={documentTone(item.documentType)}>
                        {item.documentType === "CREDIT" ? "Credit" : "Invoice"}
                      </StatusBadge>
                      <span className="tabular-nums">{formatGbp(item.net)}</span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      ) : null}

      {section === "transactions" ? (
        <div
          role="tabpanel"
          id="sales-enquiry-panel-transactions"
          aria-labelledby="sales-enquiry-tab-transactions"
          className="space-y-3"
        >
          <details className="rounded-md border border-border bg-card p-3" open>
            <summary className="cursor-pointer text-[12px] font-bold uppercase tracking-wide text-steel">
              Filters
            </summary>
            <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <SiField label="Search">
                <input
                  className={siControlClassName(Boolean(qDraft))}
                  placeholder="SKU, description or reference"
                  value={qDraft}
                  onChange={(event) => setQDraft(event.target.value)}
                  aria-label="Search transactions"
                />
              </SiField>
              <SiField label="Document type">
                <select
                  className={siControlClassName(filters.type !== "ALL")}
                  value={filters.type}
                  onChange={(event) => {
                    setFilters((current) => ({ ...current, type: event.target.value as TxFilters["type"] }));
                    setTxPage(1);
                  }}
                >
                  <option value="ALL">Invoices and credits</option>
                  <option value="INVOICE">Invoices</option>
                  <option value="CREDIT">Credits</option>
                </select>
              </SiField>
              <SiField label="Account">
                <select
                  className={siControlClassName(Boolean(filters.accountCode))}
                  value={filters.accountCode}
                  onChange={(event) => {
                    setFilters((current) => ({ ...current, accountCode: event.target.value }));
                    setTxPage(1);
                  }}
                >
                  <option value="">All accounts</option>
                  {data.identity
                    .filter((code) => code.attached)
                    .map((code) => (
                      <option key={code.code} value={code.code}>
                        {code.code}
                      </option>
                    ))}
                </select>
              </SiField>
              <SiField label="Brand">
                <select
                  className={siControlClassName(Boolean(filters.brandId))}
                  value={filters.brandId}
                  onChange={(event) => {
                    setFilters((current) => ({ ...current, brandId: event.target.value }));
                    setTxPage(1);
                  }}
                >
                  <option value="">All brands</option>
                  {data.brands.map((brand) => (
                    <option key={brand.id} value={brand.id}>
                      {brand.name}
                    </option>
                  ))}
                </select>
              </SiField>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <SiClearFiltersButton
                onClick={() => {
                  setFilters(EMPTY_FILTERS);
                  setQDraft("");
                  setTxPage(1);
                }}
              />
              <button
                type="button"
                className="h-9 rounded-md border border-border px-3 text-[11px] font-bold uppercase tracking-wide disabled:opacity-50"
                disabled={exporting}
                onClick={() => void exportCsv("transactions")}
              >
                Export CSV
              </button>
              <p className="text-[12px] text-steel">Dates follow {data.period.rangeLabel}.</p>
            </div>
          </details>
          {tx && tx.total === 0 && !loadingTx ? (
            <p className="text-[13px] text-steel">No transactions match these filters.</p>
          ) : null}
          {tx && tx.items.length > 0 ? (
            <div className="overflow-x-auto rounded-md border border-border">
              <table className="w-full min-w-[720px] text-left text-[13px]">
                <thead className="border-b border-border text-[10px] uppercase tracking-wide text-steel">
                  <tr>
                    <th className="px-3 py-2">Date</th>
                    <th className="px-3 py-2">Type</th>
                    <th className="px-3 py-2">Reference</th>
                    <th className="px-3 py-2">Product</th>
                    <th className="px-3 py-2 text-right">Qty</th>
                    <th className="px-3 py-2 text-right">Net ex VAT</th>
                  </tr>
                </thead>
                <tbody>
                  {tx.items.map((item) => (
                    <tr key={item.lineId} className="border-b border-border/50">
                      <td className="px-3 py-2">{item.dateLabel}</td>
                      <td className="px-3 py-2">
                        <StatusBadge tone={documentTone(item.documentType)}>
                          {item.documentType === "CREDIT" ? "Credit" : "Invoice"}
                        </StatusBadge>
                      </td>
                      <td className="px-3 py-2">{item.reference || "—"}</td>
                      <td className="px-3 py-2">
                        <span className="font-mono text-[12px]">{item.sku}</span>
                        <span className="mt-0.5 block text-steel">{item.description}</span>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{formatQuantity(item.qty)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{formatGbp(item.net)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
          {tx ? (
            <SiPager page={tx.page} totalPages={txPages} total={tx.total} onPage={setTxPage} />
          ) : null}
        </div>
      ) : null}

      {section === "products" ? (
        <div
          role="tabpanel"
          id="sales-enquiry-panel-products"
          aria-labelledby="sales-enquiry-tab-products"
          className="space-y-3"
        >
          <div className="grid gap-3 sm:grid-cols-3">
            <SiField label="Search">
              <input
                className={siControlClassName(Boolean(productQ))}
                placeholder="SKU or description"
                value={productQ}
                onChange={(event) => {
                  setProductQ(event.target.value);
                  setProductPage(1);
                }}
              />
            </SiField>
            <SiField label="Sort">
              <select
                className={siControlClassName()}
                value={productSort}
                onChange={(event) =>
                  setProductSort(event.target.value as "NET_SALES" | "QTY" | "RECENT" | "NAME_AZ")
                }
              >
                <option value="NET_SALES">Net sales</option>
                <option value="QTY">Units sold</option>
                <option value="RECENT">Most recent sale</option>
                <option value="NAME_AZ">SKU</option>
              </select>
            </SiField>
            <div className="flex items-end">
              <button
                type="button"
                className="h-9 rounded-md border border-border px-3 text-[11px] font-bold uppercase tracking-wide disabled:opacity-50"
                disabled={exporting}
                onClick={() => void exportCsv("products")}
              >
                Export CSV
              </button>
            </div>
          </div>
          {products && products.total === 0 && !loadingProducts ? (
            <p className="text-[13px] text-steel">No products purchased in this period.</p>
          ) : null}
          {products && products.items.length > 0 ? (
            <div className="overflow-x-auto rounded-md border border-border">
              <table className="w-full min-w-[760px] text-left text-[13px]">
                <thead className="border-b border-border text-[10px] uppercase tracking-wide text-steel">
                  <tr>
                    <th className="px-3 py-2">Product</th>
                    <th className="px-3 py-2 text-right">Units</th>
                    <th className="px-3 py-2 text-right">Net sales</th>
                    <th className="px-3 py-2 text-right">Credits</th>
                    <th className="px-3 py-2">Latest confirmed sale</th>
                  </tr>
                </thead>
                <tbody>
                  {products.items.map((item) => (
                    <tr key={item.sku} className="border-b border-border/50">
                      <td className="px-3 py-2">
                        <button
                          type="button"
                          className="text-left"
                          aria-expanded={selectedSku === item.sku}
                          onClick={() => setSelectedSku((current) => (current === item.sku ? null : item.sku))}
                        >
                          <span className="block font-medium">{item.description || item.sku}</span>
                          <span className="font-mono text-[12px] text-steel">{item.sku}</span>
                        </button>
                        {selectedSku === item.sku ? (
                          <p className="mt-1 text-[12px] text-steel">
                            {item.lines} counted line{item.lines === 1 ? "" : "s"} in {data.period.rangeLabel}.{" "}
                            <button
                              type="button"
                              className="font-semibold text-primary underline"
                              onClick={() => {
                                setQDraft(item.sku);
                                setFilters((current) => ({ ...current, q: item.sku }));
                                setSection("transactions");
                              }}
                            >
                              View transactions
                            </button>
                          </p>
                        ) : null}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{formatQuantity(item.units)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{formatGbp(item.netSales)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{formatGbp(item.credits)}</td>
                      <td className="px-3 py-2">{dateUk(item.latestConfirmedDate, "No dated sale")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
          {products ? (
            <SiPager page={products.page} totalPages={productPages} total={products.total} onPage={setProductPage} />
          ) : null}
        </div>
      ) : null}

      {section === "history" ? (
        <div
          role="tabpanel"
          id="sales-enquiry-panel-history"
          aria-labelledby="sales-enquiry-tab-history"
          className="space-y-3"
        >
          {!history && !loadingHistory ? (
            <p className="text-[13px] text-steel">Reconciliation is loaded when you open this section.</p>
          ) : null}
          {history ? (
            <HistoricalReport
              companyId={companyId}
              history={history}
              onViewUndated={() => {
                setPeriod("ALL");
                setSection("transactions");
              }}
            />
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function HistoricalReport({
  companyId,
  history,
  onViewUndated,
}: {
  companyId: string;
  history: History;
  onViewUndated: () => void;
}) {
  const summary = history.summary;
  const certification = history.certification;
  return (
    <div className="space-y-3">
      <p className="text-[13px] text-steel">
        Reconciliation covers imported 561L product lines and ongoing 504 and TRM21QC documents.
        The same invoice is counted once. Payments are not sales. Source records are not changed.
      </p>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <div className="rounded-md border border-border bg-card p-3">
          <SiMetricCard
            label={summary.certification === "COMPLETE" ? "All-time certified sales" : "Certified sales, excl. held lines"}
            value={formatGbp(summary.combinedNet ?? summary.certifiedNet)}
          />
        </div>
        <div className="rounded-md border border-border bg-card p-3">
          <SiMetricCard label="Invoices" value={String(summary.invoiceCount)} />
        </div>
        <div className="rounded-md border border-border bg-card p-3">
          <SiMetricCard label="Credits" value={formatGbp(summary.creditsAndAdjustments)} />
        </div>
      </div>
      <details className="rounded-md border border-border bg-card p-3">
        <summary className="cursor-pointer text-[13px] font-semibold">Duplicate and unreconciled records</summary>
        <dl className="mt-3 grid gap-2 text-[13px] sm:grid-cols-2">
          <div>
            <dt className="text-steel">Duplicate lines held back</dt>
            <dd className="tabular-nums">
              {summary.suppressedDuplicateLines} · {formatGbp(summary.suppressedDuplicateNet)}
            </dd>
          </div>
          <div>
            <dt className="text-steel">Lines still to reconcile</dt>
            <dd className="tabular-nums">
              {summary.unreconciledLines} lines on {summary.unreconciledDocuments} documents
            </dd>
          </div>
          <div>
            <dt className="text-steel">Undated lines in the certified total</dt>
            <dd className="tabular-nums">{summary.undatedLineCount}</dd>
          </div>
          <div>
            <dt className="text-steel">Held value still to reconcile</dt>
            <dd className="tabular-nums">{formatGbp(summary.unreconciledDatedNet)}</dd>
          </div>
          <div>
            <dt className="text-steel">Lines checked</dt>
            <dd className="tabular-nums">{certification.linesExamined}</dd>
          </div>
        </dl>
        {certification.discrepancyNote ? (
          <p className="mt-3 text-[12px] text-warn">{certification.discrepancyNote}</p>
        ) : (
          <p className="mt-3 text-[12px] text-steel">
            Certified sales, duplicates and held lines account for the ongoing documents checked.
          </p>
        )}
        <button type="button" className="mt-3 text-[12px] font-semibold text-primary underline" onClick={onViewUndated}>
          View transactions
        </button>
      </details>
      {history.investigationPermitted ? <SalesReconciliationInvestigation companyId={companyId} /> : null}
    </div>
  );
}
