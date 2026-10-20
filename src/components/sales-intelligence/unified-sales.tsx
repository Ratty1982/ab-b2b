import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  isRetryCoolingDown,
  retryAvailableAt,
  salesEnquiryErrorText,
} from "@/domain/sales-enquiry-report";
import { StatusBadge } from "@/components/ab/Badges";
import {
  SiField,
  SiMetricCard,
  SiPager,
  siControlClassName,
} from "@/components/sales-intelligence/workspace";
import { COMPANY_STATUS_LABEL } from "@/domain/company";
import { formatQuoteDateOnlyUk } from "@/domain/quote";
import { formatGbp } from "@/domain/sales-intelligence";
import { DATE_UNAVAILABLE } from "@/domain/unified-sales";
import { formatQuantity } from "@/lib/format-quantity";
import type { UnifiedCustomerSummary } from "@/server/sales-intelligence/unified-sales";
export { UnifiedCustomerSalesPanel } from "@/components/sales-intelligence/sales-enquiry-dashboard";
import {
  getUnifiedProductSalesFn,
  getUnifiedReconciliationQueueFn,
} from "@/server/phase2/fns";

export type UnifiedFigures = UnifiedCustomerSummary;
type ProductSales = Extract<
  Awaited<ReturnType<typeof getUnifiedProductSalesFn>>,
  { ok: true }
>["data"];
type Queue = Extract<
  Awaited<ReturnType<typeof getUnifiedReconciliationQueueFn>>,
  { ok: true }
>["data"];

function statusLabel(status: string): string {
  return (COMPANY_STATUS_LABEL as Record<string, string>)[status] ?? status;
}

function dateUk(value: string | null | undefined, fallback = "—"): string {
  return value ? formatQuoteDateOnlyUk(value.slice(0, 10)) : fallback;
}

function dateTimeUk(value: string | null | undefined): string {
  if (!value) return "Never";
  return new Date(value).toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const smallButton =
  "inline-flex h-8 items-center rounded-md border border-border px-3 text-[11px] font-bold uppercase tracking-wide disabled:opacity-50";

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
  useEffect(() => {
    if (!error) return;
    const handle = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(handle);
  }, [error]);
  if (!loading && !error) return null;
  const cooling = error ? isRetryCoolingDown(Date.now(), retryAvailableAt(now)) : false;
  return (
    <div className="rounded-md border border-border bg-surface/40 px-3 py-2 text-[13px]" role="status">
      {loading ? <p className="text-steel">{loadingLabel}</p> : null}
      {error ? (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-bad">{error}</p>
          <button
            type="button"
            className="inline-flex h-9 items-center rounded-md border border-border px-3 text-[11px] font-bold uppercase disabled:opacity-50"
            disabled={cooling}
            onClick={onRetry}
          >
            Retry
          </button>
        </div>
      ) : null}
    </div>
  );
}

/** Reconciled headline figures. Shared by Sales Enquiry and both Customer 360 views. */
export function UnifiedSalesFigures({ figures }: { figures: UnifiedFigures }) {
  const { summary, identity, refresh } = figures;
  const complete = summary.certification === "COMPLETE";
  return (
    <div className="space-y-3">
      {complete ? (
        <p className="rounded-md border border-good/30 bg-good/10 px-3 py-2 text-[12px] text-good">
          Reconciled. Every source agrees, so the combined net is complete. Payments, receipts and
          ledger balances are not sales and are not included.
        </p>
      ) : (
        <div className="rounded-md border border-warn/30 bg-warn/10 px-3 py-2 text-[12px] text-warn">
          <p className="font-bold uppercase tracking-wide">Incomplete — reconciliation needed</p>
          <p className="mt-1">
            {summary.unreconciledLines} line{summary.unreconciledLines === 1 ? "" : "s"} on{" "}
            {summary.unreconciledDocuments} document{summary.unreconciledDocuments === 1 ? "" : "s"}{" "}
            could not be proven unique and are held back: 561L history{" "}
            {formatGbp(summary.unreconciledHistoricalNet)}, dated sources{" "}
            {formatGbp(summary.unreconciledDatedNet)}. No combined total is stated. The certified
            net excludes them.
          </p>
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <SiMetricCard
          label={complete ? "Combined net ex VAT" : "Certified net ex VAT (excl. unreconciled)"}
          value={formatGbp(summary.combinedNet ?? summary.certifiedNet)}
          primary
        />
        <SiMetricCard
          label="Historical sales ex VAT (561L, undated)"
          value={formatGbp(summary.historicalSales)}
        />
        <SiMetricCard
          label="Dated invoiced sales ex VAT"
          value={formatGbp(summary.datedInvoicedSales)}
        />
        <SiMetricCard
          label="Credits and adjustments"
          value={formatGbp(summary.creditsAndAdjustments)}
        />
        <SiMetricCard label="Invoices" value={String(summary.invoiceCount)} />
        <SiMetricCard label="Product lines" value={String(summary.lineCount)} />
        <SiMetricCard label="Distinct products" value={String(summary.productCount)} />
        <SiMetricCard label="Signed units" value={formatQuantity(summary.units)} />
        <SiMetricCard
          label="Last dated invoice"
          value={dateUk(summary.lastDatedInvoice, "None dated")}
        />
        <SiMetricCard label="Last successful refresh" value={dateTimeUk(refresh.latestAt)} />
        <SiMetricCard label="Undated lines" value={String(summary.undatedLineCount)} />
        <SiMetricCard
          label="Duplicates suppressed"
          value={`${summary.suppressedDuplicateLines} · ${formatGbp(summary.suppressedDuplicateNet)}`}
        />
      </div>
      <div className="flex flex-wrap items-center gap-2 text-[12px]">
        <span className="text-[10px] font-bold uppercase tracking-wide text-steel">
          Account codes
        </span>
        {identity.length === 0 ? (
          <span className="text-steel">No Autopart account code is linked.</span>
        ) : (
          identity.map((code) => (
            <span key={code.code} title={code.note ?? code.via.join(", ")}>
              <StatusBadge tone={code.mappingVerified ? "info" : "warn"}>
                <span className="font-mono">{code.code}</span>
                {code.mappingVerified ? "" : " · needs review"}
              </StatusBadge>
            </span>
          ))
        )}
      </div>
      {identity.some((code) => code.note) ? (
        <ul className="space-y-1 text-[11px] text-steel">
          {identity
            .filter((code) => code.note)
            .map((code) => (
              <li key={code.code}>
                <span className="font-mono">{code.code}</span>: {code.note}
              </li>
            ))}
        </ul>
      ) : null}
      <p className="text-[11px] text-steel">
        Refreshes: TRM21QC {dateTimeUk(refresh.ongoingTrm21qcAt)} · 504{" "}
        {dateTimeUk(refresh.ongoing504At)} · 561L history {dateTimeUk(refresh.global561lAt)} ·
        customer import {dateTimeUk(refresh.customerImportAt)}. New invoices and credits arrive
        through the existing import and feed runs only.
      </p>
    </div>
  );
}


export function UnifiedProductSalesPanel({
  sku,
  salesRepId,
  onOpenCustomer,
}: {
  sku: string;
  salesRepId: string | null;
  onOpenCustomer: (companyId: string) => void;
}) {
  const [data, setData] = useState<ProductSales | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState<"NET_SALES" | "QTY" | "RECENT" | "NAME_AZ">("NET_SALES");
  const [q, setQ] = useState("");

  useEffect(() => {
    setPage(1);
  }, [sku, salesRepId]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const handle = window.setTimeout(() => {
      void getUnifiedProductSalesFn({
        data: { sku, salesRepId, q: q.trim() || null, sort, page, pageSize: 25 },
      }).then((result) => {
        if (cancelled) return;
        setLoading(false);
        if (!result.ok) {
          setError(salesEnquiryErrorText(result.error, result.code));
          setData(null);
        } else {
          setError(null);
          setData(result.data);
        }
      });
    }, 200);
    return () => {
      cancelled = true;
      window.clearTimeout(handle);
    };
  }, [sku, salesRepId, q, sort, page, attempt]);

  if (!data) {
    return (
      <ReportNotice
        loading={loading}
        loadingLabel="Loading product customers…"
        error={error}
        onRetry={() => setAttempt((current) => current + 1)}
      />
    );
  }
  const pages = Math.max(1, Math.ceil(data.customers.total / data.customers.pageSize));
  const complete = data.summary.certification === "COMPLETE";

  return (
    <section
      className="space-y-3 rounded-md border border-border p-3 sm:p-4"
      aria-label="Product customers"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-wide text-steel">
            Customers who bought this — all sources
          </p>
          <h2 className="font-display text-lg font-semibold">{data.product.name}</h2>
          <p className="font-mono text-[12px] text-steel">
            {data.product.sku}
            {data.product.brandName ? ` · ${data.product.brandName}` : ""} ·{" "}
            {data.product.catalogueStatus}
          </p>
        </div>
        {data.product.productHref ? (
          <a href={data.product.productHref} className={smallButton}>
            Open product
          </a>
        ) : null}
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <SiMetricCard
          label={complete ? "Combined net ex VAT" : "Certified net ex VAT (excl. unreconciled)"}
          value={formatGbp(data.summary.combinedNet ?? data.summary.certifiedNet)}
          primary
        />
        <SiMetricCard label="Customers" value={String(data.summary.customers)} />
        <SiMetricCard label="Signed units" value={formatQuantity(data.summary.units)} />
        <SiMetricCard label="Credits" value={formatGbp(data.summary.credits)} />
      </div>
      {!complete ? (
        <p className="text-[12px] text-warn">
          {data.summary.unreconciledLines} unreconciled lines are held back from these totals and
          shown per customer.
        </p>
      ) : null}
      <p className="text-[12px] text-steel">{data.scopeNote}</p>
      <div className="grid gap-2 sm:grid-cols-2 lg:max-w-xl">
        <SiField label="Customer name">
          <input
            className={siControlClassName(Boolean(q))}
            value={q}
            onChange={(event) => {
              setQ(event.target.value);
              setPage(1);
            }}
          />
        </SiField>
        <SiField label="Sort">
          <select
            className={siControlClassName(sort !== "NET_SALES")}
            value={sort}
            onChange={(event) => {
              setSort(event.target.value as typeof sort);
              setPage(1);
            }}
          >
            <option value="NET_SALES">Net sales high → low</option>
            <option value="QTY">Quantity high → low</option>
            <option value="RECENT">Most recently dated</option>
            <option value="NAME_AZ">Customer A–Z</option>
          </select>
        </SiField>
      </div>
      <div className="overflow-auto">
        <table className="w-full text-left text-[13px]">
          <thead>
            <tr className="border-b border-border text-[10px] uppercase tracking-wide text-steel">
              <th className="py-2 pr-2">Customer</th>
              <th className="py-2 pr-2">Status</th>
              <th className="py-2 pr-2">Account</th>
              <th className="py-2 pr-2">Salesperson</th>
              <th className="py-2 pr-2 text-right">Qty</th>
              <th className="py-2 pr-2 text-right">Net ex VAT</th>
              <th className="py-2 pr-2 text-right">Credits</th>
              <th className="py-2 pr-2">Last dated purchase</th>
              <th className="py-2"> </th>
            </tr>
          </thead>
          <tbody>
            {data.customers.items.length === 0 ? (
              <tr>
                <td colSpan={9} className="py-6 text-center text-steel">
                  No customer in your scope has bought this product.
                </td>
              </tr>
            ) : null}
            {data.customers.items.map((item) => (
              <tr key={item.companyId} className="border-b border-border/50">
                <td className="py-2 pr-2">
                  <button
                    type="button"
                    className="font-medium text-primary"
                    onClick={() => onOpenCustomer(item.companyId)}
                  >
                    {item.name}
                  </button>
                  {item.unreconciledLines > 0 ? (
                    <div className="text-[11px] text-warn">
                      {item.unreconciledLines} unreconciled lines held back
                    </div>
                  ) : null}
                </td>
                <td className="py-2 pr-2">{statusLabel(item.status)}</td>
                <td className="py-2 pr-2 font-mono text-[12px]">{item.accountCodes ?? "—"}</td>
                <td className="py-2 pr-2">{item.salespersonName ?? "—"}</td>
                <td className="py-2 pr-2 text-right tabular-nums">{formatQuantity(item.units)}</td>
                <td className="py-2 pr-2 text-right tabular-nums">{formatGbp(item.netSales)}</td>
                <td className="py-2 pr-2 text-right tabular-nums">{formatGbp(item.credits)}</td>
                <td className="py-2 pr-2 whitespace-nowrap">
                  {dateUk(item.lastDatedPurchase, DATE_UNAVAILABLE)}
                </td>
                <td className="py-2">
                  <Link
                    to={
                      item.customer360Href.startsWith("/admin/")
                        ? "/admin/customers/$id"
                        : "/sales/customers/$id"
                    }
                    params={{ id: item.companyId }}
                    className="text-[11px] font-bold uppercase text-primary"
                  >
                    Customer 360
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <SiPager
        page={data.customers.page}
        totalPages={pages}
        total={data.customers.total}
        onPage={setPage}
      />
    </section>
  );
}

export function UnifiedReconciliationQueue() {
  const [open, setOpen] = useState(false);
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Queue | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    void getUnifiedReconciliationQueueFn({ data: { page, pageSize: 25 } }).then((result) => {
      if (cancelled) return;
      setLoading(false);
      if (!result.ok) {
        setError(salesEnquiryErrorText(result.error, result.code));
        setData(null);
      } else {
        setError(null);
        setData(result.data);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [open, page, attempt]);

  return (
    <section className="rounded-md border border-border p-3 text-[13px]">
      <button
        type="button"
        className="text-[11px] font-bold uppercase tracking-wide text-steel"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        {open ? "Hide" : "Show"} account reconciliation queue
      </button>
      {open ? (
        !data ? (
          <div className="mt-2">
            <ReportNotice
              loading={loading}
              loadingLabel="Loading reconciliation queue…"
              error={error}
              onRetry={() => setAttempt((current) => current + 1)}
            />
          </div>
        ) : !data.permitted ? (
          <p className="mt-2 text-steel">
            The reconciliation queue is available to management scope only.
          </p>
        ) : (
          <div className="mt-3 space-y-2">
            <p className="text-[12px] text-steel">
              {data.total} account codes · {data.totalLines} lines · {formatGbp(data.totalNet)} net.{" "}
              {data.note}
            </p>
            <div className="overflow-auto">
              <table className="w-full text-left text-[13px]">
                <thead>
                  <tr className="border-b border-border text-[10px] uppercase tracking-wide text-steel">
                    <th className="py-2 pr-2">Account code</th>
                    <th className="py-2 pr-2">Autopart name</th>
                    <th className="py-2 pr-2">Reason</th>
                    <th className="py-2 pr-2">Sources</th>
                    <th className="py-2 pr-2 text-right">Lines</th>
                    <th className="py-2 text-right">Net ex VAT</th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((item) => (
                    <tr key={item.code} className="border-b border-border/50">
                      <td className="py-2 pr-2 font-mono text-[12px]">{item.code}</td>
                      <td className="py-2 pr-2">
                        {item.accountName ?? "—"}
                        {item.classification ? (
                          <span className="ml-1 text-[11px] text-steel">
                            ({item.classification})
                          </span>
                        ) : null}
                      </td>
                      <td className="py-2 pr-2 text-[12px]">{item.reason}</td>
                      <td className="py-2 pr-2 text-[12px] text-steel">{item.sources}</td>
                      <td className="py-2 pr-2 text-right tabular-nums">{item.lines}</td>
                      <td className="py-2 text-right tabular-nums">{formatGbp(item.net)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <SiPager
              page={data.page}
              totalPages={Math.max(1, Math.ceil(data.total / data.pageSize))}
              total={data.total}
              onPage={setPage}
            />
          </div>
        )
      ) : null}
    </section>
  );
}
