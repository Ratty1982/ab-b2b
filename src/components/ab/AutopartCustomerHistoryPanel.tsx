import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { formatDateTime } from "@/lib/datetime";
import {
  confirmAutopartHistoryImportFn,
  getCompanyAutopartHistoryWorkspaceFn,
  getHistoricImportRunStatusFn,
  listCompanyAutopartInvoiceLinesFn,
  previewAutopartHistoryImportFn,
  verifyAutopartAccountAliasFn,
} from "@/server/phase2/fns";

type Workspace = Extract<
  Awaited<ReturnType<typeof getCompanyAutopartHistoryWorkspaceFn>>,
  { ok: true }
>["data"];
type HistoryPreview = Extract<
  Awaited<ReturnType<typeof previewAutopartHistoryImportFn>>,
  { ok: true }
>["data"];
type ImportRunStatus = Extract<
  Awaited<ReturnType<typeof getHistoricImportRunStatusFn>>,
  { ok: true }
>["data"];
type InvoicePage = Extract<
  Awaited<ReturnType<typeof listCompanyAutopartInvoiceLinesFn>>,
  { ok: true }
>["data"];

function gbp(v: string | number | null | undefined) {
  if (v == null || v === "") return "—";
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return `£${v}`;
  return new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(n);
}

async function readFileText(file: File | null): Promise<string | null> {
  if (!file) return null;
  return file.text();
}

export function AutopartCustomerHistoryPanel({ companyId }: { companyId: string }) {
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [file561, setFile561] = useState<File | null>(null);
  const [fileSlrb, setFileSlrb] = useState<File | null>(null);
  const [historyPreview, setHistoryPreview] = useState<HistoryPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmingHistory, setConfirmingHistory] = useState(false);
  const [importProgress, setImportProgress] = useState<ImportRunStatus | null>(null);
  const [alias, setAlias] = useState("");
  const [aliasNote, setAliasNote] = useState("");
  const [lineQuery, setLineQuery] = useState("");
  const [submittedQuery, setSubmittedQuery] = useState("");
  const [linePage, setLinePage] = useState(1);
  const [invoiceLines, setInvoiceLines] = useState<InvoicePage | null>(null);
  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const r = await getCompanyAutopartHistoryWorkspaceFn({ data: { companyId } });
    if (!r.ok) {
      setError(r.error);
      setWorkspace(null);
    } else {
      setWorkspace(r.data);
      setError(null);
    }
    setLoading(false);
  }, [companyId]);

  useEffect(() => {
    void load();
  }, [load]);

  const loadLines = useCallback(async () => {
    const result = await listCompanyAutopartInvoiceLinesFn({
      data: { companyId, q: submittedQuery, page: linePage },
    });
    if (!result.ok) {
      setInvoiceLines(null);
      return;
    }
    setInvoiceLines(result.data);
  }, [companyId, linePage, submittedQuery]);

  useEffect(() => {
    if (!workspace || workspace.globalHistory.restricted) return;
    if ((workspace.globalHistory.lineCount ?? 0) === 0) return;
    void loadLines();
  }, [workspace, loadLines]);

  useEffect(() => {
    return () => {
      if (pollTimer.current) clearTimeout(pollTimer.current);
    };
  }, []);

  const pollImportRun = useCallback(
    async (runId: string) => {
      const poll = async () => {
        const r = await getHistoricImportRunStatusFn({ data: { runId } });
        if (!r.ok) {
          toast.error(r.error || "Could not load import progress");
          setConfirmingHistory(false);
          setBusy(false);
          return;
        }
        setImportProgress(r.data);
        if (r.data.status === "PROCESSING") {
          pollTimer.current = setTimeout(() => void poll(), 2000);
          return;
        }
        setConfirmingHistory(false);
        setBusy(false);
        if (r.data.status === "COMMITTED") {
          toast.success("Historic Autopart data imported");
          setHistoryPreview(null);
          setImportProgress(null);
          await load();
          return;
        }
        if (r.data.status === "FAILED") {
          const progressNote =
            r.data.partialProgress != null
              ? " Some batches may already be persisted; retry is idempotent."
              : "";
          toast.error(
            `Historic import failed.${progressNote} No completed import was recorded.`,
          );
          // Keep preview so the operator can retry
        }
      };
      void poll();
    },
    [load],
  );

  async function onPreviewHistory() {
    if (!file561 || !fileSlrb) {
      toast.error("Select both 561L and SLRB files");
      return;
    }
    setBusy(true);
    setImportProgress(null);
    const [t561, tSlrb] = await Promise.all([readFileText(file561), readFileText(fileSlrb)]);
    const r = await previewAutopartHistoryImportFn({
      data: {
        companyId,
        file561l: t561!,
        fileSlrb: tSlrb!,
        filename561l: file561.name,
        filenameSlrb: fileSlrb.name,
      },
    });
    setBusy(false);
    if (!r.ok) {
      toast.error(r.error);
      return;
    }
    setHistoryPreview(r.data);
    if (r.data.priorImport?.status === "PROCESSING" && r.data.priorImport.runId) {
      setConfirmingHistory(true);
      setBusy(true);
      void pollImportRun(r.data.priorImport.runId);
      toast.message("A historic import is already processing — showing progress");
      return;
    }
    toast.message(r.data.canCommit ? "Preview ready — review then confirm" : "Preview blocked");
  }

  async function onConfirmHistory() {
    if (!file561 || !fileSlrb || !historyPreview?.canCommit || busy || confirmingHistory) return;
    setBusy(true);
    setConfirmingHistory(true);
    setImportProgress(null);
    try {
      const [t561, tSlrb] = await Promise.all([readFileText(file561), readFileText(fileSlrb)]);
      const r = await confirmAutopartHistoryImportFn({
        data: {
          companyId,
          file561l: t561!,
          fileSlrb: tSlrb!,
          filename561l: file561.name,
          filenameSlrb: fileSlrb.name,
          previewRunId: historyPreview.runId ?? undefined,
        },
      });
      if (!r.ok) {
        toast.error(
          r.error ||
            "Historic import failed. No completed import was recorded. You can retry this file pair.",
        );
        setConfirmingHistory(false);
        setBusy(false);
        return;
      }
      if (r.data.async) {
        toast.message(
          r.data.message ??
            "Large historic import is processing server-side. Progress updates below.",
        );
        if (r.data.workspace) setWorkspace(r.data.workspace);
        void pollImportRun(r.data.runId);
        return;
      }
      toast.success("Historic Autopart data imported");
      setHistoryPreview(null);
      setImportProgress(null);
      setWorkspace(r.data.workspace);
      setConfirmingHistory(false);
      setBusy(false);
    } catch {
      setConfirmingHistory(false);
      setBusy(false);
      toast.error("Historic import failed. You can retry this file pair.");
    }
  }

  async function onAddAlias() {
    if (!alias.trim()) return;
    setBusy(true);
    const r = await verifyAutopartAccountAliasFn({
      data: { companyId, alias: alias.trim(), note: aliasNote || null },
    });
    setBusy(false);
    if (!r.ok) {
      toast.error(r.error);
      return;
    }
    toast.success("Alias verified");
    setAlias("");
    setAliasNote("");
    setWorkspace(r.data);
  }

  if (loading) return <p className="p-4 text-[13px] text-steel">Loading Autopart workspace…</p>;
  if (error || !workspace) {
    return <p className="p-4 text-[13px] text-bad">{error ?? "Unable to load"}</p>;
  }

  const progress = importProgress?.progress;
  const importInFlight =
    confirmingHistory || importProgress?.status === "PROCESSING";

  return (
    <div className="space-y-6 p-4 sm:p-6">
      <section className="rounded-lg border border-border p-5">
        <h2 className="font-display text-base font-semibold uppercase">Autopart account</h2>
        <p className="mt-2 text-[12px] text-steel">
          Account mapping, imported history, and customer portal approval are separate. Internal
          CRM history does not require an active trade account.
        </p>
        <dl className="mt-3 grid gap-2 text-[13px] sm:grid-cols-2">
          <div>
            <dt className="text-steel">Linked Autopart account</dt>
            <dd className="font-mono font-semibold">
              {workspace.globalHistory.accounts.length
                ? workspace.globalHistory.accounts.map((account) => account.accountCode).join(", ")
                : "—"}
            </dd>
          </div>
          <div>
            <dt className="text-steel">Account mapping status</dt>
            <dd>{workspace.globalHistory.mappingStatus === "LINKED" ? "Linked" : "Not linked"}</dd>
          </div>
          <div>
            <dt className="text-steel">Company code verification</dt>
            <dd>{workspace.company.verified ? "Verified" : "Not verified"}</dd>
          </div>
          <div>
            <dt className="text-steel">Historic purchase data</dt>
            <dd>
              {workspace.purchaseDataStatus === "GLOBAL"
                ? "Global Autopart Import"
                : workspace.purchaseDataStatus === "LEGACY"
                  ? "Legacy company import"
                  : workspace.purchaseDataStatus === "RESTRICTED"
                    ? "Restricted"
                    : "Not imported"}
            </dd>
          </div>
          <div>
            <dt className="text-steel">Historical invoice lines</dt>
            <dd>
              {workspace.globalHistory.lineCount == null
                ? "Restricted"
                : workspace.globalHistory.lineCount.toLocaleString("en-GB")}
            </dd>
          </div>
          <div>
            <dt className="text-steel">Historical ledger transactions</dt>
            <dd>
              {workspace.globalHistory.ledgerRowCount == null
                ? "Restricted"
                : workspace.globalHistory.ledgerRowCount.toLocaleString("en-GB")}
            </dd>
          </div>
          <div>
            <dt className="text-steel">Source</dt>
            <dd>
              {workspace.globalHistory.restricted
                ? "Restricted"
                : workspace.globalHistory.source === "GLOBAL_AUTOPART_IMPORT"
                  ? "Global Autopart Import"
                  : workspace.historic.imported
                    ? "Legacy company import"
                    : "Not imported"}
            </dd>
          </div>
          <div>
            <dt className="text-steel">Latest applicable import batch</dt>
            <dd>
              {workspace.globalHistory.latestBatch
                ? `${workspace.globalHistory.latestBatch.filename}${
                    workspace.globalHistory.latestBatch.completedAt
                      ? ` · ${formatDateTime(workspace.globalHistory.latestBatch.completedAt)}`
                      : ""
                  }`
                : workspace.historic.lastImportedAt
                  ? formatDateTime(workspace.historic.lastImportedAt)
                  : "—"}
            </dd>
          </div>
          <div>
            <dt className="text-steel">Customer portal history</dt>
            <dd>
              {workspace.globalHistory.accounts.some((account) => account.portalHistoricalAccess)
                ? "Approved"
                : "Not approved"}
            </dd>
          </div>
        </dl>
        {workspace.globalHistory.accounts.length ? (
          <ul className="mt-3 space-y-1 text-[13px]">
            {workspace.globalHistory.accounts.map((account) => (
              <li key={account.id}>
                <a
                  className="text-cyan underline"
                  href={`/admin/customers/autopart-imports?account=${encodeURIComponent(account.accountCode)}`}
                >
                  View Autopart master record {account.accountCode}
                </a>
              </li>
            ))}
          </ul>
        ) : null}

        {workspace.globalHistory.restricted ? null : (workspace.globalHistory.lineCount ?? 0) > 0 ? (
          <div className="mt-4 border-t border-border pt-4">
            <h3 className="text-[12px] font-semibold uppercase tracking-wide text-steel">
              Internal historical sales
            </h3>
            <p className="mt-1 text-[12px] text-steel">{workspace.globalHistory.label}</p>
            <dl className="mt-3 grid gap-2 text-[13px] sm:grid-cols-4">
              <div>
                <dt className="text-steel">Net sales ex VAT</dt>
                <dd className="font-semibold">{gbp(workspace.globalHistory.netSalesExVat)}</dd>
              </div>
              <div>
                <dt className="text-steel">Sales ex VAT</dt>
                <dd className="font-semibold">{gbp(workspace.globalHistory.salesExVat)}</dd>
              </div>
              <div>
                <dt className="text-steel">Credits ex VAT</dt>
                <dd className="font-semibold">{gbp(workspace.globalHistory.creditsExVat)}</dd>
              </div>
              <div>
                <dt className="text-steel">Invoice documents</dt>
                <dd className="font-semibold">
                  {(workspace.globalHistory.documentCount ?? 0).toLocaleString("en-GB")}
                </dd>
              </div>
              <div>
                <dt className="text-steel">Products purchased</dt>
                <dd className="font-semibold">
                  {(workspace.globalHistory.productsPurchased ?? 0).toLocaleString("en-GB")}
                </dd>
              </div>
              <div>
                <dt className="text-steel">Net quantity</dt>
                <dd className="font-semibold">{workspace.globalHistory.netQuantity}</dd>
              </div>
              <div>
                <dt className="text-steel">Purchase date</dt>
                <dd className="font-semibold">—</dd>
              </div>
              <div>
                <dt className="text-steel">Zero-value lines</dt>
                <dd className="font-semibold">{workspace.globalHistory.zeroLineCount}</dd>
              </div>
            </dl>
            <p className="mt-2 text-[12px] text-steel">
              {workspace.globalHistory.purchaseDateNote} Purchase trends and a last purchase date
              stay blank because no reliable source date is available.
            </p>
          </div>
        ) : null}

        {workspace.historic.imported ? (
          <dl className="mt-4 grid gap-2 border-t border-border pt-4 text-[13px] sm:grid-cols-4">
            <div className="sm:col-span-4 text-[12px] font-semibold uppercase tracking-wide text-steel">
              Legacy company import
            </div>
            <div>
              <dt className="text-steel">Historic net spend</dt>
              <dd className="font-semibold">{gbp(workspace.historic.netSpend)}</dd>
            </div>
            <div>
              <dt className="text-steel">Historic net units</dt>
              <dd className="font-semibold">{workspace.historic.netUnits}</dd>
            </div>
            <div>
              <dt className="text-steel">Products</dt>
              <dd className="font-semibold">{workspace.historic.productsPurchased}</dd>
            </div>
            <div>
              <dt className="text-steel">Last historic purchase</dt>
              <dd className="font-semibold">
                {workspace.historic.lastHistoricPurchaseDate || "—"}
              </dd>
            </div>
          </dl>
        ) : null}
      </section>

      {workspace.globalHistory.restricted || (workspace.globalHistory.lineCount ?? 0) === 0 ? null : (
        <section className="rounded-lg border border-border p-5">
          <h2 className="font-display text-base font-semibold uppercase">
            Historical invoice lines
          </h2>
          <p className="mt-2 text-[12px] text-steel">
            {workspace.globalHistory.purchaseDateNote} Sales and credits stay on separate amounts.
            Native B2B orders are not included.
          </p>
          <form
            className="mt-3 flex flex-wrap gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              setLinePage(1);
              setSubmittedQuery(lineQuery);
            }}
          >
            <input
              className="h-9 min-w-[200px] flex-1 rounded-md border border-border px-3 text-[13px]"
              placeholder="Search part, description, or invoice reference"
              value={lineQuery}
              onChange={(event) => setLineQuery(event.target.value)}
            />
            <button
              type="submit"
              className="h-9 rounded-md border border-border px-3 text-[12px] font-semibold"
            >
              Search
            </button>
          </form>
          {invoiceLines && invoiceLines.items.length === 0 ? (
            <p className="mt-3 text-[13px] text-steel">No invoice lines match this search.</p>
          ) : null}
          {invoiceLines && invoiceLines.items.length > 0 ? (
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-left text-[13px]">
                <thead>
                  <tr className="border-b border-border text-[11px] uppercase text-steel">
                    <th className="py-2 pr-2">Account</th>
                    <th className="py-2 pr-2">Document</th>
                    <th className="py-2 pr-2">Part</th>
                    <th className="py-2 pr-2">Description</th>
                    <th className="py-2 pr-2 text-right">Qty</th>
                    <th className="py-2 pr-2 text-right">Net ex VAT</th>
                    <th className="py-2">Date</th>
                  </tr>
                </thead>
                <tbody>
                  {invoiceLines.items.map((line) => (
                    <tr key={line.id} className="border-b border-border/50">
                      <td className="py-2 pr-2 font-mono">{line.accountCode}</td>
                      <td className="py-2 pr-2 font-mono">
                        {line.documentReference || line.rawInvAndLn}
                        {line.documentType ? (
                          <span className="block text-[11px] text-steel">{line.documentType}</span>
                        ) : null}
                      </td>
                      <td className="py-2 pr-2 font-mono">{line.partNumber}</td>
                      <td className="py-2 pr-2">{line.description || "—"}</td>
                      <td className="py-2 pr-2 text-right">{line.quantity}</td>
                      <td className="py-2 pr-2 text-right">{gbp(line.salesAmount)}</td>
                      <td className="py-2 text-steel">—</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="mt-3 flex items-center gap-2 text-[12px]">
                <button
                  type="button"
                  className="h-8 border border-border px-3 uppercase"
                  disabled={linePage <= 1}
                  onClick={() => setLinePage((page) => Math.max(1, page - 1))}
                >
                  Previous
                </button>
                <span className="text-steel">
                  Page {invoiceLines.page} · {invoiceLines.total.toLocaleString("en-GB")} lines
                </span>
                <button
                  type="button"
                  className="h-8 border border-border px-3 uppercase"
                  disabled={linePage * invoiceLines.pageSize >= invoiceLines.total}
                  onClick={() => setLinePage((page) => page + 1)}
                >
                  Next
                </button>
              </div>
            </div>
          ) : null}
        </section>
      )}

      <section className="rounded-lg border border-border p-5">
        <h2 className="font-display text-base font-semibold uppercase">Verified account aliases</h2>
        <p className="mt-2 text-[12px] text-steel">
          Aliases are only required for genuine alternative Autopart account codes. Legacy
          shortened account fields used by supported reports such as 561L are validated
          automatically.
        </p>
        {workspace.aliases.length ? (
          <ul className="mt-3 space-y-1 text-[13px]">
            {workspace.aliases.map((a) => (
              <li key={a.id} className="font-mono">
                {a.alias}{" "}
                <span className="text-steel">
                  · {a.verifiedByName} · {formatDateTime(a.verifiedAt)}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 text-[13px] text-steel">No aliases.</p>
        )}
        <div className="mt-3 flex flex-wrap gap-2">
          <input
            className="h-9 rounded-md border border-border px-3 text-[13px]"
            placeholder="Alias (exact)"
            value={alias}
            onChange={(e) => setAlias(e.target.value)}
          />
          <input
            className="h-9 min-w-[200px] flex-1 rounded-md border border-border px-3 text-[13px]"
            placeholder="Note (optional)"
            value={aliasNote}
            onChange={(e) => setAliasNote(e.target.value)}
          />
          <button
            type="button"
            disabled={busy}
            onClick={() => void onAddAlias()}
            className="h-9 rounded-md border border-border px-3 text-[12px] font-semibold"
          >
            Verify alias
          </button>
        </div>
      </section>

      <section className="rounded-lg border border-border p-5">
        <h2 className="font-display text-base font-semibold uppercase">Import historic data</h2>
        <p className="mt-2 text-[12px] text-steel">
          Upload 561L (lines) and SLRB (document dates). Format is detected from file content —
          extension does not matter. Dry-run first — no database writes until confirm. Large
          retail histories process server-side with live progress.
        </p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <label className="text-[12px]">
            561L report
            <span className="mt-0.5 block text-[11px] text-steel">Accepted: .txt, .csv</span>
            <input
              type="file"
              accept=".csv,.txt,text/csv,text/plain"
              className="mt-1 block w-full text-[12px]"
              onChange={(e) => setFile561(e.target.files?.[0] ?? null)}
            />
          </label>
          <label className="text-[12px]">
            SLRB report
            <span className="mt-0.5 block text-[11px] text-steel">Accepted: .txt, .csv</span>
            <input
              type="file"
              accept=".csv,.txt,text/csv,text/plain"
              className="mt-1 block w-full text-[12px]"
              onChange={(e) => setFileSlrb(e.target.files?.[0] ?? null)}
            />
          </label>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => void onPreviewHistory()}
            className="h-10 rounded-md border border-border px-4 text-[12px] font-bold uppercase"
          >
            Preview
          </button>
          <button
            type="button"
            disabled={
              busy ||
              confirmingHistory ||
              !historyPreview?.canCommit ||
              historyPreview?.priorImport?.status === "PROCESSING"
            }
            onClick={() => void onConfirmHistory()}
            className="h-10 rounded-md bg-primary px-4 text-[12px] font-bold uppercase text-primary-foreground disabled:opacity-40"
          >
            {importInFlight ? "Importing…" : "Confirm import"}
          </button>
        </div>

        {importProgress ? (
          <div
            className="mt-4 space-y-2 rounded-md border border-border/70 bg-surface/40 p-3 text-[12px]"
            data-historic-import-progress={importProgress.status}
          >
            <p className="font-semibold uppercase tracking-wide">
              Status: {importProgress.status}
            </p>
            {progress ? (
              <>
                <p>{progress.message}</p>
                <p className="text-steel">
                  Documents {progress.documentsWritten.toLocaleString()}
                  {progress.phase === "documents" || progress.phase === "lines" || progress.phase === "complete"
                    ? ` · Lines ${progress.linesWritten.toLocaleString()}`
                    : null}
                </p>
                {progress.total > 0 ? (
                  <div className="h-2 overflow-hidden rounded bg-border/60">
                    <div
                      className="h-full bg-primary transition-[width]"
                      style={{
                        width: `${Math.min(100, Math.round((progress.current / progress.total) * 100))}%`,
                      }}
                    />
                  </div>
                ) : null}
              </>
            ) : (
              <p className="text-steel">Waiting for progress…</p>
            )}
            {importProgress.status === "FAILED" && importProgress.failure ? (
              <p className="text-bad">
                {(importProgress.failure as { message?: string }).message ??
                  "Import failed"}
              </p>
            ) : null}
          </div>
        ) : null}

        {historyPreview ? (
          <div className="mt-4 space-y-3 rounded-md border border-border/70 bg-surface/40 p-3 text-[12px]">
            <dl className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              <div>
                <dt className="text-[10px] font-semibold uppercase tracking-wide text-steel">
                  Report customer
                </dt>
                <dd className="mt-0.5 font-semibold num">
                  {historyPreview.accountMatch?.reportCustomer ??
                    historyPreview.reportCustomer ??
                    historyPreview.accountMatch?.slrbAccount ??
                    historyPreview.slrbAccount ??
                    "—"}
                </dd>
              </div>
              <div>
                <dt className="text-[10px] font-semibold uppercase tracking-wide text-steel">
                  Autopart account
                </dt>
                <dd className="mt-0.5 font-semibold num">
                  {historyPreview.accountMatch?.verifiedAccount ??
                    historyPreview.verifiedAccount ??
                    "—"}
                </dd>
              </div>
              <div>
                <dt className="text-[10px] font-semibold uppercase tracking-wide text-steel">
                  Status
                </dt>
                <dd className="mt-0.5 font-semibold">
                  {historyPreview.accountMatch?.status === "MATCHED_REPORT_CUSTOMER" ||
                  historyPreview.accountMatch?.status === "MATCHED"
                    ? "Matched"
                    : historyPreview.accountMatch?.status === "MATCHED_TRUNCATED"
                      ? "Matched — shortened report account"
                      : historyPreview.accountMatch?.status === "MATCHED_ALIAS"
                        ? "Matched via verified alias"
                        : historyPreview.accountMatch?.status === "ALIAS_REQUIRED"
                          ? "Account alias required"
                          : historyPreview.accountMatch?.status === "MULTIPLE_ACCOUNTS"
                            ? "Multiple accounts detected"
                            : historyPreview.accountMatch?.status === "AMBIGUOUS_TRUNCATED"
                              ? "Ambiguous truncated account"
                              : historyPreview.accountMatch?.ok
                                ? "Matched"
                                : "Mismatch"}
                </dd>
              </div>
            </dl>
            {historyPreview.accountMatch?.ok &&
            historyPreview.accountMatch.rowAccount &&
            historyPreview.accountMatch.verifiedAccount &&
            historyPreview.accountMatch.rowAccount !==
              historyPreview.accountMatch.verifiedAccount ? (
              <p className="text-[11px] text-steel">
                561L account code {historyPreview.accountMatch.rowAccount} — 561L uses a
                shortened {historyPreview.accountMatch.accountFieldWidth ?? 7}-character
                account field.
              </p>
            ) : null}
            {historyPreview.accountMatch?.status === "MULTIPLE_ACCOUNTS" &&
            historyPreview.accountMatch.multipleAccounts?.length ? (
              <p className="text-[11px] text-bad">
                Multiple accounts detected:{" "}
                {historyPreview.accountMatch.multipleAccounts.join(", ")}
              </p>
            ) : null}
            {historyPreview.accountMatch?.status === "ALIAS_REQUIRED" &&
            historyPreview.accountMatch.suggestedAlias ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  setAlias(historyPreview.accountMatch!.suggestedAlias!);
                  setAliasNote("Report account from 561L/SLRB");
                  void (async () => {
                    setBusy(true);
                    const r = await verifyAutopartAccountAliasFn({
                      data: {
                        companyId,
                        alias: historyPreview.accountMatch!.suggestedAlias!,
                        note: "Report account from 561L/SLRB",
                      },
                    });
                    setBusy(false);
                    if (!r.ok) {
                      toast.error(r.error);
                      return;
                    }
                    toast.success(
                      `Verified ${historyPreview.accountMatch!.suggestedAlias} as account alias`,
                    );
                    setWorkspace(r.data);
                    setAlias("");
                    setAliasNote("");
                    if (file561 && fileSlrb) void onPreviewHistory();
                  })();
                }}
                className="h-9 rounded-md border border-border px-3 text-[11px] font-bold uppercase"
              >
                Verify {historyPreview.accountMatch.suggestedAlias} as account alias
              </button>
            ) : null}
            <p>
              561L: {historyPreview.report561l.validLines} lines (
              {historyPreview.report561l.invoiceLines} inv / {historyPreview.report561l.creditLines}{" "}
              credit) · SLRB: {historyPreview.reportSlrb.invoiceDocuments} invoices
              {historyPreview.reportSlrb.creditDocuments
                ? ` / ${historyPreview.reportSlrb.creditDocuments} credits`
                : null}
            </p>
            <p>
              Matched docs: {historyPreview.matching.matchedDocuments} · Unmatched 561L:{" "}
              {historyPreview.matching.unmatched561Documents} · SLRB without lines:{" "}
              {historyPreview.matching.slrbDocumentsWithoutLines} · SKUs matched:{" "}
              {historyPreview.products.matchedAbSkus}/{historyPreview.products.uniqueSkus}
            </p>
            <ul className="space-y-1">
              {historyPreview.issues.map((i) => (
                <li
                  key={`${i.code}-${i.message}`}
                  className={
                    i.severity === "BLOCKING"
                      ? "text-bad"
                      : i.severity === "WARNING"
                        ? "text-warn"
                        : "text-steel"
                  }
                >
                  [{i.severity}] {i.message}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </section>

      {workspace.globalHistory.products.length ? (
        <section className="rounded-lg border border-border p-5">
          <h2 className="font-display text-base font-semibold uppercase">
            Historical products purchased
          </h2>
          <p className="mt-2 text-[12px] text-steel">
            Quantities and net sales exclude VAT from the global Autopart import. Legacy company
            import products are listed separately when that import exists.
          </p>
          <table className="mt-3 w-full text-left text-[13px]">
            <thead>
              <tr className="border-b border-border text-[11px] uppercase text-steel">
                <th className="py-2">Part</th>
                <th className="py-2 text-right">Quantity</th>
                <th className="py-2 text-right">Net ex VAT</th>
              </tr>
            </thead>
            <tbody>
              {workspace.globalHistory.products.map((product) => (
                <tr key={product.partNumber} className="border-b border-border/50">
                  <td className="py-2 font-mono">{product.partNumber}</td>
                  <td className="py-2 text-right">{product.quantity}</td>
                  <td className="py-2 text-right">{gbp(product.netSalesExVat)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}

      {workspace.globalHistory.frequentProducts.length ? (
        <section className="rounded-lg border border-border p-5">
          <h2 className="font-display text-base font-semibold uppercase">
            Most frequently purchased
          </h2>
          <p className="mt-2 text-[12px] text-steel">
            Ranked by imported invoice-line count. This is Autopart history, separate from native
            B2B orders.
          </p>
          <table className="mt-3 w-full text-left text-[13px]">
            <thead>
              <tr className="border-b border-border text-[11px] uppercase text-steel">
                <th className="py-2">Part</th>
                <th className="py-2 text-right">Lines</th>
                <th className="py-2 text-right">Quantity</th>
                <th className="py-2 text-right">Net ex VAT</th>
              </tr>
            </thead>
            <tbody>
              {workspace.globalHistory.frequentProducts.map((product) => (
                <tr key={product.partNumber} className="border-b border-border/50">
                  <td className="py-2 font-mono">{product.partNumber}</td>
                  <td className="py-2 text-right">{product.lineCount}</td>
                  <td className="py-2 text-right">{product.quantity}</td>
                  <td className="py-2 text-right">{gbp(product.netSalesExVat)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}

      {workspace.historic.imported && workspace.topProducts.length ? (
        <section className="rounded-lg border border-border p-5">
          <h2 className="font-display text-base font-semibold uppercase">
            Legacy company import products
          </h2>
          <table className="mt-3 w-full text-left text-[13px]">
            <thead>
              <tr className="border-b border-border text-[11px] uppercase text-steel">
                <th className="py-2">SKU</th>
                <th className="py-2 text-right">Net units</th>
                <th className="py-2 text-right">Net spend</th>
              </tr>
            </thead>
            <tbody>
              {workspace.topProducts.map((p) => (
                <tr key={p.sku} className="border-b border-border/50">
                  <td className="py-2 font-mono">{p.sku}</td>
                  <td className="py-2 text-right">{p.netUnits}</td>
                  <td className="py-2 text-right">{gbp(p.netSpend)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}
    </div>
  );
}
