import { useEffect, useState } from "react";
import { StatusBadge } from "@/components/ab/Badges";
import { SiField, SiPager, siControlClassName } from "@/components/sales-intelligence/workspace";
import { formatGbp } from "@/domain/sales-intelligence";
import { isRetryCoolingDown, retryAvailableAt, salesEnquiryErrorText } from "@/domain/sales-enquiry-report";
import {
  LINE_COMPARISON_VIEW_LABELS,
  LINE_COMPARISON_VIEWS,
  RECONCILIATION_ACTION_LABELS,
  RECONCILIATION_DOCUMENT_TYPES,
  RECONCILIATION_REASONS,
  RECONCILIATION_SOURCES,
  type LineComparisonView,
} from "@/domain/sales-reconciliation";
import { UNIFIED_SOURCE_LABELS } from "@/domain/unified-sales";
import { formatQuantity } from "@/lib/format-quantity";
import {
  exportSalesReconciliationCsvFn,
  getSalesReconciliationInvestigationFn,
} from "@/server/phase2/fns";

type Investigation = Extract<
  Awaited<ReturnType<typeof getSalesReconciliationInvestigationFn>>,
  { ok: true }
>["data"];
type PermittedInvestigation = Extract<Investigation, { permitted: true }>;

type Filters = {
  reason: string;
  accountCode: string;
  source: string;
  documentType: string;
  comparison: LineComparisonView;
};

const EMPTY_FILTERS: Filters = {
  reason: "",
  accountCode: "",
  source: "",
  documentType: "",
  comparison: "DIFFERENCES",
};

const REASON_OPTIONS: Array<{ value: (typeof RECONCILIATION_REASONS)[number]; label: string }> = [
  { value: "CONFLICTING_OVERLAP", label: "Conflicting sources" },
  { value: "DOCUMENT_GOODS_MISMATCH", label: "504 goods mismatch" },
  { value: "REPEATED_SOURCE_ROW", label: "Repeated source row" },
  { value: "NO_DOCUMENT_REFERENCE", label: "No document reference" },
  { value: "UNKNOWN_DOCUMENT_TYPE", label: "Unknown document type" },
  { value: "AMBIGUOUS_ACCOUNT", label: "Ambiguous account" },
];

function downloadCsv(csv: string, filename: string) {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function SalesReconciliationInvestigation({ companyId }: { companyId: string }) {
  const [open, setOpen] = useState(false);
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [accountDraft, setAccountDraft] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<PermittedInvestigation | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [exporting, setExporting] = useState(false);
  const [exportNote, setExportNote] = useState<string | null>(null);

  useEffect(() => {
    setOpen(false);
    setData(null);
    setFilters(EMPTY_FILTERS);
    setAccountDraft("");
    setPage(1);
    setError(null);
    setExportNote(null);
  }, [companyId]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    void getSalesReconciliationInvestigationFn({
      data: {
        companyId,
        reason: filters.reason || null,
        accountCode: filters.accountCode || null,
        source: filters.source || null,
        documentType: filters.documentType || null,
        comparison: filters.comparison,
        page,
        pageSize: 10,
      },
    }).then((result) => {
      if (cancelled) return;
      setLoading(false);
      if (!result.ok) {
        setError(salesEnquiryErrorText(result.error, result.code));
        setData(null);
        return;
      }
      if (!result.data.permitted) {
        setError("Reconciliation investigation is limited to management.");
        setData(null);
        return;
      }
      setError(null);
      setData(result.data);
    });
    return () => {
      cancelled = true;
    };
  }, [open, companyId, filters, page, attempt]);

  const pages = Math.max(1, Math.ceil((data?.total ?? 0) / (data?.pageSize ?? 10)));

  return (
    <div className="rounded-md border border-border bg-card p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-[13px] font-semibold">Reconciliation investigation</h3>
          <p className="mt-1 text-[12px] text-steel">
            Unreconciled documents, grouped by reference. Differences only is the default, so matching lines stay hidden until you ask for them.
          </p>
        </div>
        <button
          type="button"
          className="h-9 rounded-md border border-border px-3 text-[11px] font-bold uppercase tracking-wide"
          aria-expanded={open}
          onClick={() => setOpen((current) => !current)}
        >
          {open ? "Hide investigation" : "Investigate unreconciled records"}
        </button>
      </div>
      {open ? (
        <div className="mt-3 space-y-3">
          <p className="text-[12px] text-steel">{data?.readOnlyNote}</p>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <SiField label="Lines">
              <select
                className={siControlClassName(filters.comparison !== "DIFFERENCES")}
                value={filters.comparison}
                aria-label="Line comparison"
                onChange={(event) => {
                  setFilters((current) => ({ ...current, comparison: event.target.value as LineComparisonView }));
                  setPage(1);
                }}
              >
                {LINE_COMPARISON_VIEWS.map((view) => (
                  <option key={view} value={view}>
                    {LINE_COMPARISON_VIEW_LABELS[view]}
                  </option>
                ))}
              </select>
            </SiField>
            <SiField label="Discrepancy">
              <select
                className={siControlClassName(Boolean(filters.reason))}
                value={filters.reason}
                aria-label="Discrepancy reason"
                onChange={(event) => {
                  setFilters((current) => ({ ...current, reason: event.target.value }));
                  setPage(1);
                }}
              >
                <option value="">All reasons</option>
                {REASON_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </SiField>
            <SiField label="Account">
              <input
                className={siControlClassName(Boolean(accountDraft))}
                value={accountDraft}
                aria-label="Account code"
                placeholder="Account code"
                onChange={(event) => setAccountDraft(event.target.value)}
                onBlur={() => {
                  const accountCode = accountDraft.trim().toUpperCase();
                  setAccountDraft(accountCode);
                  setFilters((current) => ({ ...current, accountCode }));
                  setPage(1);
                }}
                onKeyDown={(event) => {
                  if (event.key !== "Enter") return;
                  const accountCode = accountDraft.trim().toUpperCase();
                  setAccountDraft(accountCode);
                  setFilters((current) => ({ ...current, accountCode }));
                  setPage(1);
                }}
              />
            </SiField>
            <SiField label="Source">
              <select
                className={siControlClassName(Boolean(filters.source))}
                value={filters.source}
                aria-label="Source"
                onChange={(event) => {
                  setFilters((current) => ({ ...current, source: event.target.value }));
                  setPage(1);
                }}
              >
                <option value="">All sources</option>
                {RECONCILIATION_SOURCES.map((source) => (
                  <option key={source} value={source}>
                    {UNIFIED_SOURCE_LABELS[source]}
                  </option>
                ))}
              </select>
            </SiField>
            <SiField label="Document type">
              <select
                className={siControlClassName(Boolean(filters.documentType))}
                value={filters.documentType}
                aria-label="Document type"
                onChange={(event) => {
                  setFilters((current) => ({ ...current, documentType: event.target.value }));
                  setPage(1);
                }}
              >
                <option value="">All document types</option>
                {RECONCILIATION_DOCUMENT_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {type === "UNKNOWN" ? "Unknown" : type === "CREDIT" ? "Credit" : "Invoice"}
                  </option>
                ))}
              </select>
            </SiField>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="h-9 rounded-md border border-border px-3 text-[11px] font-bold uppercase tracking-wide"
              onClick={() => {
                setFilters(EMPTY_FILTERS);
                setAccountDraft("");
                setPage(1);
              }}
            >
              Clear filters
            </button>
            <button
              type="button"
              className="h-9 rounded-md border border-border px-3 text-[11px] font-bold uppercase tracking-wide disabled:opacity-50"
              disabled={exporting}
              onClick={() => {
                setExporting(true);
                setExportNote(null);
                void exportSalesReconciliationCsvFn({
                  data: {
                    companyId,
                    reason: filters.reason || null,
                    accountCode: filters.accountCode || null,
                    source: filters.source || null,
                    documentType: filters.documentType || null,
                    comparison: filters.comparison,
                  },
                }).then((result) => {
                  setExporting(false);
                  if (!result.ok) {
                    setExportNote(salesEnquiryErrorText(result.error, result.code));
                    return;
                  }
                  downloadCsv(result.data.csv, result.data.filename);
                  setExportNote(
                    result.data.truncated
                      ? `Exported ${result.data.rowCount} filtered rows. The file is capped.`
                      : `Exported ${result.data.rowCount} ${filters.comparison === "DIFFERENCES" ? "discrepancy" : "filtered"} rows.`,
                  );
                });
              }}
            >
              {filters.comparison === "DIFFERENCES" ? "Export discrepancies" : "Export filtered CSV"}
            </button>
            {exportNote ? <p className="text-[12px] text-steel">{exportNote}</p> : null}
          </div>
          <InvestigationStatus loading={loading} error={error} onRetry={() => setAttempt((current) => current + 1)} />
          {data && data.total === 0 && !loading ? (
            <p className="text-[13px] text-steel">No unreconciled documents match these filters.</p>
          ) : null}
          {data?.documents.map((document) => (
            <article
              key={document.id}
              className="rounded-md border border-border p-3"
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="font-medium">
                    {document.reference ?? "No document reference"}
                    <span className="ml-2 text-[12px] text-steel">{document.accountCode}</span>
                  </p>
                  <p className="mt-1 text-[12px] text-steel">{document.reasonLabels.join(" ")}</p>
                </div>
                <StatusBadge tone={document.documentType === "CREDIT" ? "warn" : "neutral"}>
                  {document.documentType === "UNKNOWN" ? "Unknown" : document.documentType === "CREDIT" ? "Credit" : "Invoice"}
                </StatusBadge>
              </div>
              <ul className="mt-2 space-y-1 text-[12px]">
                {document.actions.map((action) => (
                  <li key={action}>
                    <span className="font-semibold">{RECONCILIATION_ACTION_LABELS[action]}.</span>{" "}
                    {document.guidance[document.actions.indexOf(action)]}
                  </li>
                ))}
              </ul>
              <div className="mt-3 rounded-md border border-border bg-surface/30 p-3">
                <p className="text-[11px] font-bold uppercase tracking-wide text-steel">Document summary</p>
                <ul className="mt-2 space-y-1 text-[13px]">
                  {document.sources
                    .filter((source) => source.source !== "ONGOING_504")
                    .map((source) => (
                      <li key={source.source} className="flex flex-wrap justify-between gap-2">
                        <span>{source.sourceLabel}</span>
                        <span className="tabular-nums">
                          {source.lineCount} lines · {formatGbp(source.net)}
                        </span>
                      </li>
                    ))}
                </ul>
                <p className="mt-2 text-[12px] text-steel">Source totals, not certified sales.</p>
                <p className="mt-2 text-[15px] font-semibold tabular-nums">
                  Total difference {document.comparison.totalDifference == null ? "—" : formatGbp(document.comparison.totalDifference)}
                </p>
                {document.comparison.totalDifferenceSummary ? (
                  <p className="mt-1 text-[12px] text-steel">{document.comparison.totalDifferenceSummary}</p>
                ) : null}
                {document.goodsNet != null ? (
                  <p className="mt-2 text-[13px]">
                    504 goods total <span className="tabular-nums">{formatGbp(document.goodsNet)}</span>
                    {document.difference ? (
                      <span className="text-steel"> · differs from the product lines by {formatGbp(document.difference)}</span>
                    ) : null}
                  </p>
                ) : null}
                <p className="mt-2 text-[12px] text-steel">{document.comparison.summary}</p>
              </div>
              <div className="mt-3 overflow-x-auto">
                <table className="w-full min-w-[48rem] text-left text-[13px]">
                  <thead className="text-[11px] uppercase tracking-wide text-steel">
                    <tr>
                      <th className="py-1 pr-3 font-medium">Finding</th>
                      <th className="py-1 pr-3 font-medium">SKU</th>
                      <th className="py-1 pr-3 font-medium">Occurrence</th>
                      <th className="py-1 pr-3 font-medium">Sources</th>
                      <th className="py-1 pr-3 font-medium">Quantity difference</th>
                      <th className="py-1 font-medium">Net difference</th>
                    </tr>
                  </thead>
                  <tbody>
                    {document.comparison.rows.map((row) => (
                      <tr key={row.id} className="border-t border-border align-top">
                        <td className="py-1.5 pr-3">{row.label}</td>
                        <td className="py-1.5 pr-3 font-mono">{row.sku || "—"}</td>
                        <td className="py-1.5 pr-3 tabular-nums">{row.occurrence}</td>
                        <td className="py-1.5 pr-3">
                          {row.sources.map((source) => (
                            <div key={source.source}>
                              {source.sourceLabel}:{" "}
                              {source.missing
                                ? "Missing"
                                : `${formatQuantity(source.qty)} · ${formatGbp(source.net ?? "0")}`}
                            </div>
                          ))}
                        </td>
                        <td className="py-1.5 pr-3 tabular-nums">{row.qtyDifference ?? "—"}</td>
                        <td className="py-1.5 tabular-nums">{row.netDifference == null ? "—" : formatGbp(row.netDifference)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {document.comparison.rows.length === 0 ? (
                <p className="mt-2 text-[12px] text-steel">No lines in this view. The document summary still shows the source totals.</p>
              ) : null}
              {document.comparison.rowsTruncated ? (
                <p className="mt-2 text-[12px] text-steel">
                  Showing the first {document.comparison.rows.length} rows in this view. Export discrepancies for the full filtered set.
                </p>
              ) : null}
            </article>
          ))}
          {data && data.total > 0 ? (
            <SiPager page={data.page} totalPages={pages} total={data.total} onPage={setPage} />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function InvestigationStatus({
  loading,
  error,
  onRetry,
}: {
  loading: boolean;
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
      {loading ? <p className="text-steel">Loading unreconciled documents…</p> : null}
      {error ? (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-bad">{error}</p>
          <button
            type="button"
            className="inline-flex h-9 items-center rounded-md border border-border px-3 text-[11px] font-bold uppercase disabled:opacity-50"
            disabled={isRetryCoolingDown(now, availableAt)}
            onClick={onRetry}
          >
            Retry
          </button>
        </div>
      ) : null}
    </div>
  );
}
