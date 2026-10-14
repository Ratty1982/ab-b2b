import { useEffect, useState } from "react";
import {
  isRetryCoolingDown,
  retryAvailableAt,
  salesEnquiryErrorText,
} from "@/domain/sales-enquiry-report";
import { Link } from "@tanstack/react-router";
import { StatusBadge } from "@/components/ab/Badges";
import {
  SiCreateFollowUpButton,
  type FollowUpRequest,
} from "@/components/sales-intelligence/create-followup-drawer";
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
import {
  createCrmOpportunityFn,
  exportUnifiedCustomerSalesCsvFn,
  getUnifiedCustomerSalesFn,
  getUnifiedProductSalesFn,
  getUnifiedReconciliationQueueFn,
  listUnifiedCustomerProductsFn,
  listUnifiedCustomerTransactionsFn,
} from "@/server/phase2/fns";

type CustomerSales = Extract<
  Awaited<ReturnType<typeof getUnifiedCustomerSalesFn>>,
  { ok: true }
>["data"];
type Transactions = Extract<
  Awaited<ReturnType<typeof listUnifiedCustomerTransactionsFn>>,
  { ok: true }
>["data"];
type Products = Extract<
  Awaited<ReturnType<typeof listUnifiedCustomerProductsFn>>,
  { ok: true }
>["data"];
type ProductSales = Extract<
  Awaited<ReturnType<typeof getUnifiedProductSalesFn>>,
  { ok: true }
>["data"];
type Queue = Extract<
  Awaited<ReturnType<typeof getUnifiedReconciliationQueueFn>>,
  { ok: true }
>["data"];

export type UnifiedFigures = Pick<CustomerSales, "summary" | "identity" | "refresh">;

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

function downloadCsv(csv: string, filename: string) {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

const smallButton =
  "inline-flex h-8 items-center rounded-md border border-border px-3 text-[11px] font-bold uppercase tracking-wide disabled:opacity-50";

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
              <StatusBadge tone={code.attached ? "info" : "warn"}>
                <span className="font-mono">{code.code}</span>
                {code.attached ? "" : " · not attached"}
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

type TxFilters = {
  type: "ALL" | "INVOICE" | "CREDIT";
  dating: "ALL" | "DATED" | "UNDATED";
  status: "COUNTED" | "UNRECONCILED" | "SUPPRESSED" | "ALL";
  from: string;
  to: string;
  q: string;
  brandId: string;
  accountCode: string;
};

const EMPTY_TX_FILTERS: TxFilters = {
  type: "ALL",
  dating: "ALL",
  status: "COUNTED",
  from: "",
  to: "",
  q: "",
  brandId: "",
  accountCode: "",
};

function txRequest(companyId: string, filters: TxFilters) {
  return {
    companyId,
    type: filters.type,
    dating: filters.dating,
    status: filters.status,
    from: filters.from || null,
    to: filters.to || null,
    q: filters.q.trim() || null,
    brandId: filters.brandId || null,
    accountCode: filters.accountCode || null,
  };
}

function isOpeningTransactionView(filters: TxFilters, page: number): boolean {
  return (
    page === 1 &&
    filters.type === "ALL" &&
    filters.dating === "ALL" &&
    filters.status === "COUNTED" &&
    filters.from === "" &&
    filters.to === "" &&
    filters.q === "" &&
    filters.brandId === "" &&
    filters.accountCode === ""
  );
}

function ReportNotice({
  loadingLabel,
  loading,
  error,
  onRetry,
}: {
  loadingLabel: string;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
}) {
  const [now, setNow] = useState(() => Date.now());
  const [availableAt, setAvailableAt] = useState(0);
  useEffect(() => {
    if (!isRetryCoolingDown(Date.now(), availableAt)) return;
    const handle = window.setInterval(() => setNow(Date.now()), 200);
    return () => window.clearInterval(handle);
  }, [availableAt]);
  if (loading && !error) {
    return (
      <p className="text-[13px] text-steel" role="status" aria-busy="true">
        {loadingLabel}
      </p>
    );
  }
  if (!error) return null;
  const cooling = isRetryCoolingDown(now, availableAt);
  return (
    <div className="flex flex-wrap items-center gap-2" role="alert">
      <p className="text-[12px] text-bad">{error}</p>
      <button
        type="button"
        className="rounded-md border border-border px-2 py-1 text-[11px] font-bold uppercase disabled:opacity-50"
        disabled={cooling}
        onClick={() => {
          if (isRetryCoolingDown(Date.now(), availableAt)) return;
          setAvailableAt(retryAvailableAt(Date.now()));
          onRetry();
        }}
      >
        Retry
      </button>
    </div>
  );
}

function statusTone(status: string) {
  if (status === "UNRECONCILED") return "warn" as const;
  if (status === "DUPLICATE") return "neutral" as const;
  if (status === "HISTORICAL") return "info" as const;
  return "good" as const;
}

export function UnifiedCustomerSalesPanel({
  companyId,
  onFollowUp,
}: {
  companyId: string;
  onFollowUp: (request: FollowUpRequest) => void;
}) {
  const [data, setData] = useState<CustomerSales | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [tab, setTab] = useState<"transactions" | "products">("transactions");
  const [filters, setFilters] = useState<TxFilters>(EMPTY_TX_FILTERS);
  const [qDraft, setQDraft] = useState("");
  const [txPage, setTxPage] = useState(1);
  const [tx, setTx] = useState<Transactions | null>(null);
  const [productQ, setProductQ] = useState("");
  const [productSort, setProductSort] = useState<"NET_SALES" | "QTY" | "RECENT" | "NAME_AZ">(
    "NET_SALES",
  );
  const [productPage, setProductPage] = useState(1);
  const [products, setProducts] = useState<Products | null>(null);
  const [createdOpportunities, setCreatedOpportunities] = useState<Set<string>>(new Set());
  const [exporting, setExporting] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [loadingCustomer, setLoadingCustomer] = useState(true);
  const [loadingTx, setLoadingTx] = useState(false);
  const [loadingProducts, setLoadingProducts] = useState(false);

  useEffect(() => {
    setFilters(EMPTY_TX_FILTERS);
    setQDraft("");
    setTxPage(1);
    setProductPage(1);
    setProductQ("");
    setNote(null);
    setCreatedOpportunities(new Set());
    setLoadingCustomer(true);
    setError(null);
    setData(null);
    setTx(null);
    let cancelled = false;
    void getUnifiedCustomerSalesFn({ data: { companyId } }).then((result) => {
      if (cancelled) return;
      setLoadingCustomer(false);
      if (!result.ok) {
        setError(salesEnquiryErrorText(result.error, result.code));
        setData(null);
        return;
      }
      setError(null);
      setData(result.data);
      setTx(result.data.initialTransactions);
    });
    return () => {
      cancelled = true;
    };
  }, [companyId, attempt]);

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
    if (tab !== "transactions") return;
    if (isOpeningTransactionView(filters, txPage)) {
      if (data?.initialTransactions) setTx(data.initialTransactions);
      return;
    }
    let cancelled = false;
    setLoadingTx(true);
    const handle = window.setTimeout(() => {
      void listUnifiedCustomerTransactionsFn({
        data: { ...txRequest(companyId, filters), page: txPage, pageSize: 50 },
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
  }, [companyId, filters, txPage, tab, data, attempt]);

  useEffect(() => {
    if (tab !== "products") return;
    let cancelled = false;
    setLoadingProducts(true);
    const handle = window.setTimeout(() => {
      void listUnifiedCustomerProductsFn({
        data: {
          companyId,
          q: productQ.trim() || null,
          brandId: filters.brandId || null,
          sort: productSort,
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
  }, [companyId, productQ, productSort, productPage, filters.brandId, tab, attempt]);

  function patchFilters(next: Partial<TxFilters>) {
    setFilters((current) => ({ ...current, ...next }));
    setTxPage(1);
  }

  async function createOpportunity(key: string, title: string, description: string) {
    if (createdOpportunities.has(key)) return;
    setCreatedOpportunities((current) => new Set(current).add(key));
    const result = await createCrmOpportunityFn({ data: { companyId, title, description } });
    if (!result.ok) {
      setCreatedOpportunities((current) => {
        const next = new Set(current);
        next.delete(key);
        return next;
      });
      setError(result.error);
      return;
    }
    setNote("Opportunity created. No customer message was sent.");
  }

  async function exportCsv(kind: "transactions" | "products") {
    setExporting(true);
    const result = await exportUnifiedCustomerSalesCsvFn({
      data:
        kind === "transactions"
          ? { kind, ...txRequest(companyId, filters) }
          : {
              kind,
              companyId,
              q: productQ.trim() || null,
              brandId: filters.brandId || null,
              sort: productSort,
            },
    });
    setExporting(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    downloadCsv(result.data.csv, result.data.filename);
    setNote(
      result.data.truncated
        ? `Export limited to the first ${result.data.rowCount} of ${result.data.total} rows. Narrow the filters to export the rest.`
        : `Exported ${result.data.rowCount} rows.`,
    );
  }

  if (!data) {
    return (
      <ReportNotice
        loading={loadingCustomer}
        loadingLabel="Loading customer sales…"
        error={error}
        onRetry={() => setAttempt((current) => current + 1)}
      />
    );
  }

  const company = data.company;
  const summary = data.summary;
  const codes = data.identity.filter((code) => code.attached).map((code) => code.code);
  const txPages = tx ? Math.max(1, Math.ceil(tx.total / tx.pageSize)) : 1;
  const productPages = products ? Math.max(1, Math.ceil(products.total / products.pageSize)) : 1;

  return (
    <section
      className="space-y-4 rounded-md border border-border p-3 sm:p-4"
      aria-label="Customer sales"
    >
      <ReportNotice
        loading={tab === "transactions" ? loadingTx : loadingProducts}
        loadingLabel={tab === "transactions" ? "Loading transactions…" : "Loading products…"}
        error={error}
        onRetry={() => setAttempt((current) => current + 1)}
      />
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-wide text-steel">
            Customer sales — all sources
          </p>
          <h2 className="font-display text-lg font-semibold">{company.name}</h2>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-[12px] text-steel">
            <StatusBadge
              tone={
                company.status === "ACTIVE"
                  ? "good"
                  : company.status === "PROSPECT"
                    ? "info"
                    : "neutral"
              }
            >
              {statusLabel(company.status)}
            </StatusBadge>
            <span className="font-mono">{codes.join(", ") || "No verified account code"}</span>
            <span>
              {company.salesperson
                ? `Salesperson ${company.salesperson.name}`
                : "No salesperson assigned"}
            </span>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <SiCreateFollowUpButton
            onClick={() =>
              onFollowUp({
                sourceModule: "SALES_ENQUIRY",
                sourceReason: "CUSTOMER",
                companyId: company.id,
                historySource: "unified",
              })
            }
          />
          <button
            type="button"
            className={smallButton}
            disabled={createdOpportunities.has("customer")}
            onClick={() =>
              void createOpportunity(
                "customer",
                `Sales review — ${company.name}`,
                `${company.name} (${statusLabel(company.status)}) has ${
                  summary.combinedNet
                    ? `combined net sales of ${formatGbp(summary.combinedNet)}`
                    : `certified net sales of ${formatGbp(summary.certifiedNet)} with ${summary.unreconciledLines} unreconciled lines`
                } ex VAT across all Autopart sources. Undated 561L history is not a stopped-buying signal. No customer message was sent.`,
              )
            }
          >
            {createdOpportunities.has("customer") ? "Opportunity created" : "Create opportunity"}
          </button>
          <Link
            to={
              company.customer360Href.startsWith("/admin/")
                ? "/admin/customers/$id"
                : "/sales/customers/$id"
            }
            params={{ id: company.id }}
            className={smallButton}
          >
            Customer 360
          </Link>
        </div>
      </div>

      <UnifiedSalesFigures figures={data} />
      {note ? <p className="text-[12px] text-steel">{note}</p> : null}

      <div className="flex flex-wrap gap-2" role="tablist" aria-label="Customer sales view">
        {(
          [
            ["transactions", "Transactions"],
            ["products", "Products purchased"],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={tab === value}
            onClick={() => setTab(value)}
            className={
              tab === value
                ? "h-8 rounded-md bg-primary px-3 text-[11px] font-bold uppercase tracking-wide text-primary-foreground"
                : "h-8 rounded-md border border-border px-3 text-[11px] font-bold uppercase tracking-wide text-steel"
            }
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "transactions" ? (
        <div className="space-y-3">
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <SiField label="Search SKU, description, reference">
              <input
                className={siControlClassName(Boolean(filters.q))}
                value={qDraft}
                onChange={(event) => setQDraft(event.target.value)}
              />
            </SiField>
            <SiField label="Document type">
              <select
                className={siControlClassName(filters.type !== "ALL")}
                value={filters.type}
                onChange={(event) =>
                  patchFilters({ type: event.target.value as TxFilters["type"] })
                }
              >
                <option value="ALL">All</option>
                <option value="INVOICE">Invoices</option>
                <option value="CREDIT">Credits</option>
              </select>
            </SiField>
            <SiField label="Dates">
              <select
                className={siControlClassName(filters.dating !== "ALL")}
                value={filters.dating}
                onChange={(event) =>
                  patchFilters({ dating: event.target.value as TxFilters["dating"] })
                }
              >
                <option value="ALL">Dated and undated</option>
                <option value="DATED">Dated only</option>
                <option value="UNDATED">Undated only</option>
              </select>
            </SiField>
            <SiField label="Reconciliation">
              <select
                className={siControlClassName(filters.status !== "COUNTED")}
                value={filters.status}
                onChange={(event) =>
                  patchFilters({ status: event.target.value as TxFilters["status"] })
                }
              >
                <option value="COUNTED">Each transaction once</option>
                <option value="UNRECONCILED">Unreconciled only</option>
                <option value="SUPPRESSED">Suppressed duplicates</option>
                <option value="ALL">Everything, including duplicates</option>
              </select>
            </SiField>
            <SiField label="Account">
              <select
                className={siControlClassName(Boolean(filters.accountCode))}
                value={filters.accountCode}
                onChange={(event) => patchFilters({ accountCode: event.target.value })}
              >
                <option value="">All linked accounts</option>
                {data.identity.map((code) => (
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
                onChange={(event) => patchFilters({ brandId: event.target.value })}
              >
                <option value="">Any brand</option>
                {data.brands.map((brand) => (
                  <option key={brand.id} value={brand.id}>
                    {brand.name}
                  </option>
                ))}
              </select>
            </SiField>
            <SiField label="Dated from">
              <input
                type="date"
                className={siControlClassName(Boolean(filters.from))}
                value={filters.from}
                onChange={(event) => patchFilters({ from: event.target.value })}
              />
            </SiField>
            <SiField label="Dated to">
              <input
                type="date"
                className={siControlClassName(Boolean(filters.to))}
                value={filters.to}
                onChange={(event) => patchFilters({ to: event.target.value })}
              />
            </SiField>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 text-[12px] text-steel">
            <span>
              {tx
                ? `${tx.total} rows · counted net ${formatGbp(tx.filteredCountedNet)} · counted units ${formatQuantity(tx.filteredCountedUnits)}`
                : "Loading transactions…"}
              {tx?.dateFilterNote ? ` · ${tx.dateFilterNote}` : ""}
            </span>
            <div className="flex gap-2">
              <button
                type="button"
                className={smallButton}
                onClick={() => {
                  setQDraft("");
                  setFilters(EMPTY_TX_FILTERS);
                  setTxPage(1);
                }}
              >
                Clear filters
              </button>
              <button
                type="button"
                className={smallButton}
                disabled={exporting}
                onClick={() => void exportCsv("transactions")}
              >
                Export transactions
              </button>
            </div>
          </div>
          <div className="overflow-auto">
            <table className="w-full text-left text-[13px]">
              <thead>
                <tr className="border-b border-border text-[10px] uppercase tracking-wide text-steel">
                  <th className="py-2 pr-2">Date</th>
                  <th className="py-2 pr-2">Reference</th>
                  <th className="py-2 pr-2">Type</th>
                  <th className="py-2 pr-2">Account</th>
                  <th className="py-2 pr-2">SKU</th>
                  <th className="py-2 pr-2">Description</th>
                  <th className="py-2 pr-2 text-right">Qty</th>
                  <th className="py-2 pr-2 text-right">Net ex VAT</th>
                  <th className="py-2 pr-2">Source</th>
                  <th className="py-2">Reconciliation</th>
                </tr>
              </thead>
              <tbody>
                {tx?.items.length === 0 ? (
                  <tr>
                    <td colSpan={10} className="py-6 text-center text-steel">
                      No transactions match these filters.
                    </td>
                  </tr>
                ) : null}
                {tx?.items.map((item) => (
                  <tr key={item.lineId} className="border-b border-border/50">
                    <td className="py-2 pr-2 whitespace-nowrap">
                      {item.date ? (
                        dateUk(item.date)
                      ) : (
                        <span className="text-steel">{DATE_UNAVAILABLE}</span>
                      )}
                    </td>
                    <td className="py-2 pr-2 font-mono text-[12px]">{item.reference ?? "—"}</td>
                    <td className="py-2 pr-2">{item.documentType}</td>
                    <td className="py-2 pr-2 font-mono text-[12px]">{item.accountCode}</td>
                    <td className="py-2 pr-2 font-mono text-[12px]">{item.sku}</td>
                    <td className="py-2 pr-2">{item.description ?? "—"}</td>
                    <td className="py-2 pr-2 text-right tabular-nums">{formatQuantity(item.qty)}</td>
                    <td className="py-2 pr-2 text-right tabular-nums">{formatGbp(item.net)}</td>
                    <td className="py-2 pr-2 text-[12px] text-steel">{item.sourceLabel}</td>
                    <td className="py-2" title={item.reasonLabel ?? undefined}>
                      <StatusBadge tone={statusTone(item.status)}>{item.statusLabel}</StatusBadge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {tx ? (
            <SiPager page={tx.page} totalPages={txPages} total={tx.total} onPage={setTxPage} />
          ) : null}
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <div className="grid gap-2 sm:grid-cols-2">
              <SiField label="Search products">
                <input
                  className={siControlClassName(Boolean(productQ))}
                  value={productQ}
                  onChange={(event) => {
                    setProductQ(event.target.value);
                    setProductPage(1);
                  }}
                />
              </SiField>
              <SiField label="Sort">
                <select
                  className={siControlClassName(productSort !== "NET_SALES")}
                  value={productSort}
                  onChange={(event) => {
                    setProductSort(event.target.value as typeof productSort);
                    setProductPage(1);
                  }}
                >
                  <option value="NET_SALES">Net sales high → low</option>
                  <option value="QTY">Quantity high → low</option>
                  <option value="RECENT">Most recently dated</option>
                  <option value="NAME_AZ">SKU A–Z</option>
                </select>
              </SiField>
            </div>
            <button
              type="button"
              className={smallButton}
              disabled={exporting}
              onClick={() => void exportCsv("products")}
            >
              Export products
            </button>
          </div>
          <div className="overflow-auto">
            <table className="w-full text-left text-[13px]">
              <thead>
                <tr className="border-b border-border text-[10px] uppercase tracking-wide text-steel">
                  <th className="py-2 pr-2">SKU</th>
                  <th className="py-2 pr-2">Description</th>
                  <th className="py-2 pr-2 text-right">Qty</th>
                  <th className="py-2 pr-2 text-right">Net ex VAT</th>
                  <th className="py-2 pr-2 text-right">Credits</th>
                  <th className="py-2 pr-2">Latest confirmed date</th>
                  <th className="py-2 pr-2">Frequency</th>
                  <th className="py-2 pr-2">Catalogue</th>
                  <th className="py-2 pr-2">Studley</th>
                  <th className="py-2 pr-2">Trade price</th>
                  <th className="py-2"> </th>
                </tr>
              </thead>
              <tbody>
                {products?.items.length === 0 ? (
                  <tr>
                    <td colSpan={11} className="py-6 text-center text-steel">
                      No products purchased match this search.
                    </td>
                  </tr>
                ) : null}
                {products?.items.map((item) => (
                  <tr key={item.sku} className="border-b border-border/50 align-top">
                    <td className="py-2 pr-2 font-mono text-[12px]">{item.sku}</td>
                    <td className="py-2 pr-2">
                      {item.description}
                      {item.unreconciledLines > 0 ? (
                        <div className="text-[11px] text-warn">
                          {item.unreconciledLines} unreconciled lines held back
                        </div>
                      ) : null}
                    </td>
                    <td className="py-2 pr-2 text-right tabular-nums">{formatQuantity(item.units)}</td>
                    <td className="py-2 pr-2 text-right tabular-nums">
                      {formatGbp(item.netSales)}
                    </td>
                    <td className="py-2 pr-2 text-right tabular-nums">{formatGbp(item.credits)}</td>
                    <td className="py-2 pr-2 whitespace-nowrap">
                      {dateUk(item.latestConfirmedDate, DATE_UNAVAILABLE)}
                    </td>
                    <td className="py-2 pr-2 text-[12px] text-steel">
                      {item.purchaseFrequencyLabel}
                    </td>
                    <td className="py-2 pr-2">
                      {item.productHref ? (
                        <a href={item.productHref} className="text-primary hover:underline">
                          {item.catalogueStatus}
                        </a>
                      ) : (
                        item.catalogueStatus
                      )}
                    </td>
                    <td className="py-2 pr-2 text-[12px] text-steel">
                      {products.studleyStockPermitted
                        ? (item.studleyAvailability ?? "No Studley figure")
                        : "Stock hidden"}
                    </td>
                    <td className="py-2 pr-2 text-[12px] tabular-nums">
                      {products.pricingPermitted
                        ? item.customerPrice
                          ? formatGbp(item.customerPrice)
                          : item.tradePrice
                            ? formatGbp(item.tradePrice)
                            : "—"
                        : "Price hidden"}
                    </td>
                    <td className="py-2">
                      <div className="flex flex-col items-start gap-1">
                        {item.productHref ? (
                          <a
                            href={item.productHref}
                            className="text-[11px] font-bold uppercase text-primary"
                          >
                            Open product
                          </a>
                        ) : null}
                        <button
                          type="button"
                          className="text-[11px] font-bold uppercase text-primary"
                          onClick={() =>
                            onFollowUp({
                              sourceModule: "SALES_ENQUIRY",
                              sourceReason: "PRODUCT",
                              companyId: company.id,
                              sku: item.sku,
                              historySource: "unified",
                            })
                          }
                        >
                          Follow-up
                        </button>
                        <button
                          type="button"
                          className="text-[11px] font-bold uppercase text-primary disabled:text-steel"
                          disabled={createdOpportunities.has(`sku:${item.sku}`)}
                          onClick={() =>
                            void createOpportunity(
                              `sku:${item.sku}`,
                              `${item.sku} — ${company.name}`,
                              `${company.name} has bought ${item.sku} (${formatQuantity(item.units)} units, ${formatGbp(item.netSales)} net ex VAT). Latest confirmed date: ${item.latestConfirmedDate ?? DATE_UNAVAILABLE}. No customer message was sent.`,
                            )
                          }
                        >
                          {createdOpportunities.has(`sku:${item.sku}`)
                            ? "Opportunity created"
                            : "Opportunity"}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {products ? (
            <SiPager
              page={products.page}
              totalPages={productPages}
              total={products.total}
              onPage={setProductPage}
            />
          ) : (
            <p className="text-[13px] text-steel">Loading products…</p>
          )}
        </div>
      )}
    </section>
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
