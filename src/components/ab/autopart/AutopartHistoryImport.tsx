import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { ConfirmAction } from "@/components/pricing/ConfirmAction";
import {
  formatBytes,
  uploadCustomerSalesReport,
  type SavedCustomerSalesUpload,
} from "@/components/ab/upload-customer-sales-report";
import {
  acknowledgeCustomerSalesHistoryFn,
  completeCustomerSalesCutoverFn,
  confirmCustomerSalesHistoryUploadFn,
  getCustomerSalesHistoryJobFn,
  getLatestCustomerSalesHistoryJobFn,
  listStoredCustomerSalesHistoryFn,
  previewCustomerSalesHistoryUploadFn,
  retryCustomerSalesHistoryJobFn,
  startCustomerSalesHistoryBaselineFn,
} from "@/server/phase2/fns";

type Preview = Extract<Awaited<ReturnType<typeof previewCustomerSalesHistoryUploadFn>>, { ok: true }>["data"];
type StoredHistory = Extract<Awaited<ReturnType<typeof listStoredCustomerSalesHistoryFn>>, { ok: true }>["data"];
type HistoryJob = Extract<Awaited<ReturnType<typeof getCustomerSalesHistoryJobFn>>, { ok: true }>["data"];
type RowFilter = "ALL" | "import" | "duplicate" | "rejected" | "ledger";

function FileSlot({
  label,
  help,
  file,
  progress,
  disabled,
  onChoose,
  onClear,
}: {
  label: string;
  help: string;
  file: SavedCustomerSalesUpload | null;
  progress: string | null;
  disabled: boolean;
  onChoose: (file: File) => void;
  onClear: () => void;
}) {
  return (
    <div className="rounded-md border border-dashed border-border p-3">
      <div className="text-[13px] font-semibold">{label}</div>
      <p className="mt-1 text-[12px] text-steel">{help}</p>
      <label className="mt-3 flex cursor-pointer flex-col gap-1 rounded-md bg-surface/40 px-3 py-4 text-[13px]">
        <span className="font-semibold">Drop a file here, or choose a file</span>
        <span className="text-[12px] text-steel">CSV or text export</span>
        <input
          type="file"
          accept=".csv,.txt,.tsv,text/plain,text/csv"
          disabled={disabled}
          className="sr-only"
          onChange={(event) => {
            const next = event.target.files?.[0];
            event.target.value = "";
            if (next) onChoose(next);
          }}
        />
      </label>
      {progress ? <p className="mt-2 text-[12px] text-steel">{progress}</p> : null}
      {file ? (
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[12px]">
          <span>
            {file.filename} · {formatBytes(file.bytes)}
          </span>
          <button type="button" className="font-semibold uppercase" onClick={onClear} disabled={disabled}>
            Remove
          </button>
        </div>
      ) : null}
    </div>
  );
}

export function AutopartHistoryImport({
  companyId,
  canImport,
  blocked,
  historyStatus,
  historyKind,
  onChanged,
}: {
  companyId: string;
  canImport: boolean;
  blocked: string | null;
  historyStatus: "NOT_STARTED" | "REVIEW" | "COMPLETE";
  historyKind: string | null;
  onChanged: () => Promise<void>;
}) {
  const [productFile, setProductFile] = useState<SavedCustomerSalesUpload | null>(null);
  const [ledgerFile, setLedgerFile] = useState<SavedCustomerSalesUpload | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [stored, setStored] = useState<StoredHistory | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [job, setJob] = useState<HistoryJob | null>(null);
  const finishedJob = useRef<string | null>(null);
  const restoredJob = useRef<string | null>(null);
  const [filter, setFilter] = useState<RowFilter>("ALL");
  const [page, setPage] = useState(1);
  const [confirm, setConfirm] = useState<"import" | "none" | "baseline" | "review" | null>(null);

  function jobFileNames(current: HistoryJob) {
    return [productFile?.filename ?? current.filename561l, ledgerFile?.filename ?? current.filenameSlrb]
      .filter(Boolean)
      .join(" and ");
  }

  function savedMessage(current: HistoryJob) {
    const names = jobFileNames(current) || "Sales history";
    return current.historyStatus === "REVIEW"
      ? `${names} saved. New ${current.rowsStored}, already imported ${current.duplicates}. Rejected rows still need review before current sales can be imported.`
      : `${names} saved. New ${current.rowsStored}, already imported ${current.duplicates}.`;
  }

  async function loadStored() {
    const result = await listStoredCustomerSalesHistoryFn({ data: { companyId } });
    if (result.ok) setStored(result.data);
  }

  useEffect(() => {
    finishedJob.current = null;
    restoredJob.current = null;
    setJob(null);
    setSaved(null);
    void loadStored();
    void (async () => {
      const result = await getLatestCustomerSalesHistoryJobFn({ data: { companyId } });
      if (!result.ok || !result.data) return;
      restoredJob.current = result.data.jobId;
      setJob(result.data);
      if (result.data.status === "COMPLETE") {
        finishedJob.current = result.data.jobId;
        setSaved(savedMessage(result.data));
      } else if (result.data.status === "FAILED" || result.data.abandoned) {
        finishedJob.current = result.data.jobId;
      }
    })();
  }, [companyId]);

  const jobActive =
    job != null &&
    !job.abandoned &&
    (job.status === "QUEUED" || job.status === "STAGING" || job.status === "PUBLISHING");

  useEffect(() => {
    if (!jobActive || !job) return;
    const timer = window.setInterval(() => {
      void (async () => {
        const result = await getCustomerSalesHistoryJobFn({ data: { jobId: job.jobId } });
        if (result.ok) setJob(result.data);
      })();
    }, 2000);
    return () => window.clearInterval(timer);
  }, [jobActive, job?.jobId]);

  useEffect(() => {
    if (!job || finishedJob.current === job.jobId) return;
    if (job.status !== "COMPLETE" && job.status !== "FAILED") return;
    finishedJob.current = job.jobId;
    if (job.status === "FAILED") {
      toast.error(job.error ?? "Import failed. No completed history was saved.");
      return;
    }
    setSaved(savedMessage(job));
    setPreview(null);
    if (restoredJob.current !== job.jobId) {
      toast.success("Sales history saved");
    }
    void onChanged();
    void loadStored();
  }, [job]);

  async function retryJob() {
    if (!job?.canRetry) return;
    setBusy(true);
    const result = await retryCustomerSalesHistoryJobFn({ data: { jobId: job.jobId } });
    setBusy(false);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    finishedJob.current = null;
    restoredJob.current = null;
    setJob(result.data);
    setSaved(null);
    if (result.data.sourceExpired || !result.data.sourceAvailable) {
      toast.error(result.data.sourceMessage ?? "Upload the report again.");
      return;
    }
    toast.message("Import resumed. History stays unchanged until the job finishes.");
  }

  async function choose(which: "product" | "ledger", file: File) {
    setPreview(null);
    setSaved(null);
    setProgress(`Uploading ${file.name}…`);
    try {
      const savedUpload = await uploadCustomerSalesReport({
        file,
        companyId,
        role: which === "product" ? "HISTORY_561L" : "HISTORY_SLRB",
        onProgress: (loaded, total) => {
          const percent = total > 0 ? Math.min(100, Math.round((loaded / total) * 100)) : 0;
          setProgress(`Uploading ${file.name}… ${percent}%`);
        },
      });
      if (which === "product") setProductFile(savedUpload);
      else setLedgerFile(savedUpload);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "The file could not be uploaded");
    } finally {
      setProgress(null);
    }
  }

  const locked = historyStatus === "REVIEW";
  const recorded =
    historyStatus === "COMPLETE" &&
    (historyKind === "NO_HISTORICAL_SALES" || historyKind === "PRELAUNCH_HISTORY_DISCARDED");

  async function previewImport(samplePage = 1, rejectedPage = preview?.rejectedPage ?? 1) {
    if (!productFile && !ledgerFile) return;
    setBusy(true);
    setSaved(null);
    const result = await previewCustomerSalesHistoryUploadFn({
      data: {
        companyId,
        ...(productFile ? { upload561lId: productFile.uploadId } : {}),
        ...(ledgerFile ? { uploadSlrbId: ledgerFile.uploadId } : {}),
        samplePage,
        samplePageSize: 25,
        rejectedPage,
        rejectedPageSize: 10,
      },
    });
    setBusy(false);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    setPreview(result.data);
    setFilter("ALL");
    setPage(1);
  }

  async function confirmImport() {
    if (!preview?.upload561lId && !preview?.uploadSlrbId) return;
    setBusy(true);
    const result = await confirmCustomerSalesHistoryUploadFn({
      data: {
        companyId,
        ...(preview.upload561lId ? { upload561lId: preview.upload561lId } : {}),
        ...(preview.uploadSlrbId ? { uploadSlrbId: preview.uploadSlrbId } : {}),
      },
    });
    setBusy(false);
    setConfirm(null);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    finishedJob.current = null;
    setJob(result.data);
    setSaved(null);
    toast.message("Import started. History stays unchanged until the job finishes.");
  }

  const rows = (preview?.rows ?? []).filter((row) => filter === "ALL" || row.disposition === filter);
  const pageSize = 8;
  const pages = Math.max(1, Math.ceil(rows.length / pageSize));
  const visible = rows.slice((page - 1) * pageSize, page * pageSize);
  const found = preview
    ? preview.counts.import + preview.counts.ledger + preview.counts.duplicate + preview.counts.rejected
    : 0;

  return (
    <section id="autopart-history" className="rounded-lg border border-border p-4 sm:p-5">
      <h3 className="font-display text-base font-semibold uppercase">Import sales history</h3>
      <p className="mt-2 max-w-3xl text-[13px] text-steel">
        Product sales show what was bought and the sales value. The ledger adds invoices, credits, and
        payments. Payments are not extra sales.
      </p>
      <details className="mt-2 text-[12px] text-steel">
        <summary className="cursor-pointer font-semibold">How these files are used</summary>
        <p className="mt-2 max-w-3xl">
          The old global history importer is retired. This import belongs only to the verified sales
          account on this customer. Large Retail files upload here and are filtered to that account.
          A preview does not save anything. Confirm uses the same uploaded file.
        </p>
      </details>

      {blocked ? <p className="mt-4 text-[13px] text-steel">{blocked}</p> : null}
      {!canImport && !blocked ? (
        <p className="mt-4 text-[13px] text-steel">You can view this position. Importing sales needs permission to edit orders.</p>
      ) : null}

      {locked ? (
        <div className="mt-4 rounded-md border border-warn/40 bg-warn/10 px-3 py-3 text-[13px]">
          <p>Some rows were rejected. Review them before importing current sales.</p>
          {canImport ? (
            <button
              type="button"
              className="mt-3 h-10 rounded-md bg-primary px-4 text-[12px] font-bold uppercase text-primary-foreground"
              onClick={() => setConfirm("review")}
            >
              Review exceptions
            </button>
          ) : null}
        </div>
      ) : null}

      {canImport && !locked && !blocked ? (
        <div
          className="mt-4 grid gap-3 lg:grid-cols-2"
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => {
            event.preventDefault();
            const file = event.dataTransfer.files[0];
            if (!file || busy) return;
            const ledger = /slrb|ledger/i.test(file.name);
            void choose(ledger ? "ledger" : "product", file);
          }}
        >
          <FileSlot
            label="Product sales"
            help="The product report of purchases and sales values."
            file={productFile}
            progress={null}
            disabled={busy}
            onChoose={(file) => void choose("product", file)}
            onClear={() => {
              setProductFile(null);
              setPreview(null);
            }}
          />
          <FileSlot
            label="Ledger"
            help="Invoices, credits, and payments. Payments are not additional sales."
            file={ledgerFile}
            progress={null}
            disabled={busy}
            onChoose={(file) => void choose("ledger", file)}
            onClear={() => {
              setLedgerFile(null);
              setPreview(null);
            }}
          />
        </div>
      ) : null}

      {progress && canImport && !locked && !blocked ? (
        <p className="mt-3 text-[13px] text-steel" role="status">{progress}</p>
      ) : null}

      {job ? (
        <div className="mt-4 rounded-md border border-border px-3 py-3 text-[13px]" role="status">
          <p className="font-semibold">
            {job.status === "COMPLETE"
              ? "Import complete. The customer history has been published."
              : job.status === "FAILED"
                ? "Import failed. The customer history was not published."
                : job.abandoned
                  ? "Import abandoned. The previous worker stopped before publication finished."
                  : `Import ${job.status.toLowerCase()}. ${job.phase === "PUBLISH" ? "Publishing stored rows." : "Reading and staging the report."}`}
          </p>
          <p className="mt-1 text-steel">
            {job.status === "COMPLETE"
              ? "Stored rows are now part of this customer's history."
              : job.sourceExpired || !job.sourceAvailable
                ? job.sourceMessage ?? "The uploaded report is no longer available. Upload it again."
                : job.status === "FAILED"
                  ? job.error ?? "No completed history was saved."
                  : job.abandoned
                    ? "Customer history was not changed. Retry resumes from the saved progress when the file is still available."
                    : "The import continues on this page. Customer history is not complete until this job finishes."}
          </p>
          <p className="mt-2">
            Processed {job.rowsProcessed.toLocaleString("en-GB")}. Stored {job.rowsStored.toLocaleString("en-GB")}. Duplicates{" "}
            {job.duplicates.toLocaleString("en-GB")}. Rejected {job.rejected.toLocaleString("en-GB")}. Failed{" "}
            {job.failed.toLocaleString("en-GB")}.
          </p>
          {job.error && job.status !== "FAILED" ? <p className="mt-2 text-steel">{job.error}</p> : null}
          {job.canRetry ? (
            <button
              type="button"
              disabled={busy}
              className="mt-3 h-9 rounded-md bg-primary px-3 text-[12px] font-bold uppercase text-primary-foreground disabled:opacity-50"
              onClick={() => void retryJob()}
            >
              {busy ? "Retrying…" : "Retry import"}
            </button>
          ) : null}
          {!job.sourceAvailable && !job.canRetry && (job.status === "FAILED" || job.abandoned) ? (
            <p className="mt-3 text-steel">
              {job.sourceMessage ?? "Upload the report again, then start a new import."}
            </p>
          ) : null}
        </div>
      ) : null}

      {canImport && !locked && !blocked ? (
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            disabled={busy || (!productFile && !ledgerFile)}
            className="h-10 rounded-md bg-primary px-4 text-[12px] font-bold uppercase text-primary-foreground disabled:opacity-50"
            onClick={() => void previewImport(1)}
          >
            {busy ? "Checking…" : "Preview import"}
          </button>
        </div>
      ) : null}

      {preview ? (
        <div className="mt-4 border-t border-border pt-4">
          <h4 className="text-[13px] font-semibold">Proposed changes</h4>
          <p className="mt-1 text-[13px] font-semibold" role="status">
            Preview only. Nothing has been saved.
          </p>
          <dl className="mt-3 grid grid-cols-2 gap-2 text-[13px] sm:grid-cols-3 lg:grid-cols-4">
            <div><dt className="text-steel">Records found</dt><dd className="font-semibold">{found}</dd></div>
            <div><dt className="text-steel">New product lines</dt><dd className="font-semibold">{preview.counts.productLines}</dd></div>
            <div><dt className="text-steel">New documents</dt><dd className="font-semibold">{preview.counts.supportingDocuments}</dd></div>
            <div><dt className="text-steel">Already imported</dt><dd className="font-semibold">{preview.counts.duplicate}</dd></div>
            <div><dt className="text-steel">Rejected</dt><dd className="font-semibold">{preview.counts.rejected}</dd></div>
            {preview.counts.failed > 0 ? (
              <div><dt className="text-steel">Value conflicts</dt><dd className="font-semibold">{preview.counts.failed}</dd></div>
            ) : null}
            <div>
              <dt className="text-steel">Dates</dt>
              <dd className="font-semibold">
                {preview.dateFrom ? `${preview.dateFrom} to ${preview.dateTo ?? preview.dateFrom}` : "—"}
              </dd>
            </div>
          </dl>
          <p className="mt-2 text-[12px] text-steel">
            New product lines are 561L purchases. New documents are SLRB invoice and credit headers. Rejected rows are not saved as sales.
          </p>
          <p className="mt-2 text-[12px] text-steel">
            Read {preview.rowsRead.toLocaleString("en-GB")} rows. {preview.matchingRows.toLocaleString("en-GB")} belong to this customer.{" "}
            {preview.otherCustomerRows.toLocaleString("en-GB")} from other customers were left out. File size {formatBytes(preview.byteSize)}.
          </p>
          {preview.counts.ledger > 0 ? (
            <p className="mt-2 text-[12px] text-steel">{preview.counts.ledger} ledger rows support the documents. They are not extra sales.</p>
          ) : null}
          {preview.message ? <p className="mt-2 text-[13px] text-steel">{preview.message}</p> : null}
          <div className="mt-3 flex flex-wrap gap-2">
            {(["ALL", "import", "duplicate", "rejected", "ledger"] as const).map((value) => (
              <button
                key={value}
                type="button"
                className={`h-8 rounded-md border px-2 text-[11px] font-semibold uppercase ${filter === value ? "border-primary text-foreground" : "border-border text-steel"}`}
                onClick={() => {
                  setFilter(value);
                  setPage(1);
                }}
              >
                {value === "ALL" ? "View all" : value === "import" ? "New" : value === "ledger" ? "Ledger" : value}
              </button>
            ))}
          </div>
          {visible.length > 0 ? (
            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[640px] text-left text-[12px]">
                <thead className="text-[11px] uppercase text-steel">
                  <tr>
                    {["Document", "Type", "Date", "Product", "Result"].map((heading) => (
                      <th key={heading} className="py-2 pr-3 font-semibold">{heading}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {visible.map((row, index) => (
                    <tr key={`${row.document}-${row.sku ?? ""}-${index}`} className="border-t border-border/60">
                      <td className="py-2 pr-3 font-mono">{row.document || "—"}</td>
                      <td className="py-2 pr-3">{row.type}</td>
                      <td className="py-2 pr-3">{row.date || "—"}</td>
                      <td className="py-2 pr-3 font-mono">{row.sku || "—"}</td>
                      <td className="py-2 pr-3">
                        <span className="font-semibold uppercase">{row.disposition}</span>
                        <div className="text-steel">{row.reason}</div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="mt-3 text-[13px] text-steel">No rows in this filter.</p>
          )}
          <div className="mt-2 flex items-center justify-between text-[12px] text-steel">
            <span>
              Page {page} of {pages}. Sample {preview.samplePage} of {preview.samplePages}. The counts above are the full file.
            </span>
            <span className="flex gap-2">
              <button type="button" disabled={page <= 1} onClick={() => setPage((current) => current - 1)}>Previous</button>
              <button type="button" disabled={page >= pages} onClick={() => setPage((current) => current + 1)}>Next</button>
              {preview.samplePages > 1 ? (
                <button
                  type="button"
                  disabled={busy || preview.samplePage >= preview.samplePages}
                  onClick={() => void previewImport(preview.samplePage + 1)}
                >
                  Next sample
                </button>
              ) : null}
            </span>
          </div>
          {preview.rejectionGroups.length > 0 ? (
            <div className="mt-4">
              <h5 className="text-[13px] font-semibold">Rejected by reason</h5>
              <p className="mt-1 text-[12px] text-steel">
                {preview.rejectedTotal.toLocaleString("en-GB")} rejected rows in the full file, grouped by reason. The examples below can move through the whole report.
              </p>
              <ul className="mt-2 space-y-1 text-[12px]">
                {preview.rejectionGroups.slice(0, 40).map((group) => (
                  <li key={group.reason}>
                    <span className="font-semibold">{group.count.toLocaleString("en-GB")}</span>
                    <span className="text-steel"> — {group.reason}</span>
                  </li>
                ))}
              </ul>
              {preview.rejectionGroups.length > 40 ? (
                <p className="mt-2 text-[12px] text-steel">
                  And {preview.rejectionGroups.length - 40} more reasons. The counts include every rejected row.
                </p>
              ) : null}
              {preview.rejectedExamples.length > 0 ? (
                <div className="mt-3 overflow-x-auto">
                  <table className="w-full min-w-[640px] text-left text-[12px]">
                    <thead className="text-[11px] uppercase text-steel">
                      <tr>
                        {["Document", "Type", "Product", "Reason"].map((heading) => (
                          <th key={heading} className="py-2 pr-3 font-semibold">{heading}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {preview.rejectedExamples.map((row, index) => (
                        <tr key={`${row.document}-${row.sku ?? ""}-${index}`} className="border-t border-border/60">
                          <td className="py-2 pr-3 font-mono">{row.document || "—"}</td>
                          <td className="py-2 pr-3">{row.type}</td>
                          <td className="py-2 pr-3 font-mono">{row.sku || "—"}</td>
                          <td className="py-2 pr-3 text-steel">{row.reason}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}
              <div className="mt-2 flex items-center justify-between text-[12px] text-steel">
                <span>
                  Rejected examples {preview.rejectedPage} of {preview.rejectedPages}.
                </span>
                <span className="flex gap-2">
                  <button
                    type="button"
                    disabled={busy || preview.rejectedPage <= 1}
                    onClick={() => void previewImport(preview.samplePage, preview.rejectedPage - 1)}
                  >
                    Previous rejected
                  </button>
                  <button
                    type="button"
                    disabled={busy || preview.rejectedPage >= preview.rejectedPages}
                    onClick={() => void previewImport(preview.samplePage, preview.rejectedPage + 1)}
                  >
                    Next rejected
                  </button>
                </span>
              </div>
            </div>
          ) : null}
          <button
            type="button"
            disabled={!preview.canCommit || busy || jobActive}
            className="mt-3 h-10 rounded-md bg-primary px-4 text-[12px] font-bold uppercase text-primary-foreground disabled:opacity-50"
            onClick={() => setConfirm("import")}
          >
            Confirm import
          </button>
        </div>
      ) : null}
      {saved ? <p className="mt-3 text-[13px]" role="status">{saved}</p> : null}

      {stored && (stored.productLines > 0 || stored.paymentDocuments > 0) ? (
        <div className="mt-4 border-t border-border pt-4">
          <h4 className="text-[13px] font-semibold">Stored records</h4>
          <p className="mt-1 text-[13px] text-steel">
            These are the records stored for this customer. Sales Enquiry counts each invoice once.
            Payments are stored as ledger evidence and are not product sales.
          </p>
          <p className="mt-2 text-[13px]" role="status">
            {stored.productLines} product lines, {stored.datedProductLines} dated, {stored.undatedProductLines} without an invoice date,{" "}
            {stored.saleDocuments} {stored.saleDocuments === 1 ? "sale document" : "sale documents"}, {stored.paymentDocuments}{" "}
            {stored.paymentDocuments === 1 ? "payment" : "payments"}.
          </p>
        </div>
      ) : null}

      {!locked && !blocked && historyStatus !== "COMPLETE" && canImport ? (
        <details className="mt-5 border-t border-border pt-4">
          <summary className="cursor-pointer text-[13px] font-semibold">Other ways to record history</summary>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <div className="rounded-md border border-border p-3">
              <h4 className="text-[13px] font-semibold">No historical sales</h4>
              <p className="mt-1 text-[12px] text-steel">This customer genuinely has no historical purchases to import.</p>
              <button type="button" className="mt-3 h-9 rounded-md border border-border px-3 text-[12px] font-semibold" onClick={() => setConfirm("none")}>
                Record no historical sales
              </button>
            </div>
            <div className="rounded-md border border-border p-3">
              <h4 className="text-[13px] font-semibold">Start a new sales baseline</h4>
              <p className="mt-1 text-[12px] text-steel">Historical purchases may have existed, but the record starts from a new point.</p>
              <button type="button" className="mt-3 h-9 rounded-md border border-border px-3 text-[12px] font-semibold" onClick={() => setConfirm("baseline")}>
                Start new sales baseline
              </button>
            </div>
          </div>
        </details>
      ) : null}
      {recorded ? (
        <p className="mt-4 text-[12px] text-steel">
          {historyKind === "NO_HISTORICAL_SALES"
            ? "This customer is recorded as having no historical purchases. Importing a file replaces that decision with stored history."
            : "This customer is recorded on a new sales baseline. Importing a file replaces that decision with stored history."}
        </p>
      ) : null}

      <ConfirmAction
        open={confirm != null}
        title={
          confirm === "none"
            ? "Record no historical sales?"
            : confirm === "baseline"
              ? "Start a new sales baseline?"
              : confirm === "review"
                ? "Accept the import exceptions?"
                : "Save this sales history?"
        }
        description={
          confirm === "none"
            ? "This records that the customer has no historical purchases. It is not the same as starting a new baseline. It does not import a file, and it will not replace a completed history import."
            : confirm === "baseline"
              ? "This records that sales start from a new point. It does not claim the customer never bought before. It does not import a file, and it will not replace a completed history import."
              : confirm === "review"
                ? "Rejected rows stay rejected. Accepting them completes the historical position so current sales can be imported. It does not delete the rejected rows or invent sales."
                  : recorded
                  ? "This starts the import on this page. History stays as it is until every required row is published. It replaces the current no-history or new-baseline record only after publication. Rejected rows are not saved as sales."
                  : "This starts the import on this page. You do not need to keep one request open for the whole file. Customer history stays as it is until the job finishes. Rejected rows are not saved as sales, and automatic importing stays off."
        }
        confirmLabel={busy ? "Saving…" : "Confirm"}
        onOpenChange={(open) => {
          if (!open && !busy) setConfirm(null);
        }}
        onConfirm={() => {
          void (async () => {
            if (confirm === "import") {
              await confirmImport();
              return;
            }
            setBusy(true);
            const result =
              confirm === "review"
                ? await acknowledgeCustomerSalesHistoryFn({ data: { companyId } })
                : confirm === "none"
                  ? await completeCustomerSalesCutoverFn({ data: { companyId } })
                  : await startCustomerSalesHistoryBaselineFn({ data: { companyId } });
            setBusy(false);
            setConfirm(null);
            if (!result.ok) {
              toast.error(result.error);
              return;
            }
            toast.success("Historical position saved");
            await onChanged();
            await loadStored();
          })();
        }}
      />
    </section>
  );
}
