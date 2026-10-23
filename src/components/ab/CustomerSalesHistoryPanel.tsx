import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  acknowledgeCustomerSalesHistoryFn,
  completeCustomerSalesCutoverFn,
  confirmCustomerSalesHistoryUploadFn,
  getCustomerSalesHistoryJobFn,
  getLatestCustomerSalesHistoryJobFn,
  retryCustomerSalesHistoryJobFn,
  startCustomerSalesHistoryBaselineFn,
  listCustomerSalesAccountsFn,
  previewCustomerSalesHistoryUploadFn,
} from "@/server/phase2/fns";
import {
  formatBytes,
  uploadCustomerSalesReport,
  type SavedCustomerSalesUpload,
} from "@/components/ab/upload-customer-sales-report";

type Preview = Extract<Awaited<ReturnType<typeof previewCustomerSalesHistoryUploadFn>>, { ok: true }>["data"];
type ImportResult = Extract<Awaited<ReturnType<typeof confirmCustomerSalesHistoryUploadFn>>, { ok: true }>["data"];

export function CustomerSalesHistoryPanel({ companyId }: { companyId: string }) {
  const [upload561l, setUpload561l] = useState<SavedCustomerSalesUpload | null>(null);
  const [uploadSlrb, setUploadSlrb] = useState<SavedCustomerSalesUpload | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [job, setJob] = useState<ImportResult | null>(null);
  const finishedJob = useRef<string | null>(null);
  const restoredJob = useRef<string | null>(null);
  const [historyStatus, setHistoryStatus] = useState<string>("NOT_STARTED");
  const [historyKind, setHistoryKind] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function refreshStatus() {
    const accounts = await listCustomerSalesAccountsFn({ data: { companyId } });
    if (accounts.ok) {
      setHistoryStatus(accounts.data.historyStatus);
      setHistoryKind(accounts.data.historyKind);
    }
  }

  useEffect(() => {
    finishedJob.current = null;
    restoredJob.current = null;
    setJob(null);
    setImportResult(null);
    void refreshStatus();
    void (async () => {
      const result = await getLatestCustomerSalesHistoryJobFn({ data: { companyId } });
      if (!result.ok || !result.data) return;
      restoredJob.current = result.data.jobId;
      setJob(result.data);
      if (result.data.status === "COMPLETE") {
        finishedJob.current = result.data.jobId;
        setImportResult(result.data);
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
    setImportResult(job);
    setPreview(null);
    if (restoredJob.current !== job.jobId) {
      toast.success(
        job.historyStatus === "REVIEW"
          ? "Valid rows stored. Cutover stays in review"
          : "Sales history stored for this customer",
      );
    }
    void refreshStatus();
  }, [job]);

  async function uploadFile(file: File, role: "HISTORY_561L" | "HISTORY_SLRB") {
    setPreview(null);
    setImportResult(null);
    setBusy(true);
    setProgress(`Uploading ${file.name}: 0 B of ${formatBytes(file.size)}`);
    try {
      const saved = await uploadCustomerSalesReport({
        file,
        companyId,
        role,
        onProgress: (loaded, total) => {
          setProgress(`Uploading ${file.name}: ${formatBytes(loaded)} of ${formatBytes(total)}`);
        },
      });
      if (role === "HISTORY_561L") setUpload561l(saved);
      else setUploadSlrb(saved);
      setProgress(`${file.name} uploaded (${formatBytes(saved.bytes)}). Preview reads this file and does not create sales.`);
    } catch (error) {
      if (role === "HISTORY_561L") setUpload561l(null);
      else setUploadSlrb(null);
      setProgress(null);
      toast.error(error instanceof Error ? error.message : "Upload failed");
    } finally {
      setBusy(false);
    }
  }

  async function runPreview(samplePage = 1) {
    setBusy(true);
    setProgress("Filtering the uploaded report to this customer's verified accounts…");
    const result = await previewCustomerSalesHistoryUploadFn({
      data: {
        companyId,
        ...(upload561l ? { upload561lId: upload561l.uploadId } : {}),
        ...(uploadSlrb ? { uploadSlrbId: uploadSlrb.uploadId } : {}),
        samplePage,
        samplePageSize: 25,
      },
    });
    setBusy(false);
    setProgress(null);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    setPreview(result.data);
    setImportResult(null);
  }

  return (
    <section className="mb-6 border border-border/80">
      <div className="border-b border-border/70 px-4 py-3">
        <h3 className="font-display text-sm font-semibold uppercase tracking-tight">Import Sales History</h3>
        <p className="mt-1 text-[13px] text-steel">
          For this Active customer and its verified Autopart aliases. 561L is product-sales evidence.
          SLRB is ledger and document evidence. Payments are not new sales. Becoming Active does not
          import history. Cutover is {historyStatus === "COMPLETE" ? "complete" : historyStatus === "REVIEW" ? "in review" : "not started"}.
          {historyKind === "PRELAUNCH_HISTORY_DISCARDED"
            ? " This is a new sales baseline after the pre-launch discard. It does not mean the customer never had historical sales."
            : historyKind === "NO_HISTORICAL_SALES"
              ? " This account is recorded as having no historical sales."
              : ""}
        </p>
      </div>
      <form
        className="grid gap-3 px-4 py-4"
        onSubmit={(event) => {
          event.preventDefault();
          void runPreview(1);
        }}
      >
        <label className="grid gap-1 text-[12px] font-semibold">
          561L product report
          <input
            type="file"
            accept=".csv,.txt,.tsv,text/plain,text/csv"
            className="text-[13px] font-normal"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (!file) return;
              void uploadFile(file, "HISTORY_561L");
            }}
          />
        </label>
        {upload561l ? (
          <p className="text-[12px] text-steel">
            {upload561l.filename} stored temporarily, {formatBytes(upload561l.bytes)}.
          </p>
        ) : null}
        <label className="grid gap-1 text-[12px] font-semibold">
          SLRB ledger report
          <input
            type="file"
            accept=".csv,.txt,.tsv,text/plain,text/csv"
            className="text-[13px] font-normal"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (!file) return;
              void uploadFile(file, "HISTORY_SLRB");
            }}
          />
        </label>
        {uploadSlrb ? (
          <p className="text-[12px] text-steel">
            {uploadSlrb.filename} stored temporarily, {formatBytes(uploadSlrb.bytes)}.
          </p>
        ) : null}
        {progress ? (
          <p className="text-[13px]" role="status">
            {progress}
          </p>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <button
            type="submit"
            disabled={busy || (!upload561l && !uploadSlrb)}
            className="h-9 rounded-md border border-border px-3 text-[12px] font-semibold disabled:opacity-50"
          >
            {busy ? "Working…" : "Preview history"}
          </button>
          <button
            type="button"
            disabled={busy}
            className="h-9 rounded-md border border-border px-3 text-[12px] font-semibold disabled:opacity-50"
            onClick={() => {
              void (async () => {
                setBusy(true);
                const result = await completeCustomerSalesCutoverFn({ data: { companyId } });
                setBusy(false);
                if (!result.ok) {
                  toast.error(result.error);
                  return;
                }
                await refreshStatus();
                toast.success(
                  result.data.alreadyComplete
                    ? "Historical cutover is already complete"
                    : "Recorded that this customer has no historical sales",
                );
              })();
            }}
          >
            No historical sales
          </button>
          <button
            type="button"
            disabled={busy}
            className="h-9 rounded-md border border-border px-3 text-[12px] font-semibold disabled:opacity-50"
            onClick={() => {
              void (async () => {
                setBusy(true);
                const result = await startCustomerSalesHistoryBaselineFn({ data: { companyId } });
                setBusy(false);
                if (!result.ok) {
                  toast.error(result.error);
                  return;
                }
                await refreshStatus();
                toast.success(
                  result.data.alreadyComplete
                    ? "New sales baseline is already recorded"
                    : "Started a new sales baseline. This does not say the customer never had historical sales",
                );
              })();
            }}
          >
            Start new sales baseline
          </button>
          {historyStatus === "REVIEW" ? (
            <button
              type="button"
              disabled={busy}
              className="h-9 rounded-md bg-primary px-3 text-[12px] font-bold uppercase text-primary-foreground disabled:opacity-50"
              onClick={() => {
                void (async () => {
                  setBusy(true);
                  const result = await acknowledgeCustomerSalesHistoryFn({ data: { companyId } });
                  setBusy(false);
                  if (!result.ok) {
                    toast.error(result.error);
                    return;
                  }
                  await refreshStatus();
                  toast.success("Exceptions accepted. Historical cutover is complete");
                })();
              }}
            >
              Exceptions reviewed
            </button>
          ) : null}
        </div>
      </form>
      {preview ? (
        <div className="border-t border-border/70 px-4 py-4">
          <h4 className="text-[12px] font-bold uppercase tracking-wide">Preview</h4>
          <p className="mt-1 text-[13px] text-steel">
            Preview shows proposed changes. It does not create sales records. Confirm import writes this
            uploaded file for the selected customer.
          </p>
          <p className="mt-2 text-[13px]" role="status">
            Accounts {preview.accountCodes.join(", ")}. Read {preview.rowsRead.toLocaleString("en-GB")} rows,{" "}
            {preview.matchingRows.toLocaleString("en-GB")} matching,{" "}
            {preview.otherCustomerRows.toLocaleString("en-GB")} other customers. Import {preview.counts.import}, ledger{" "}
            {preview.counts.ledger}, duplicate {preview.counts.duplicate}, rejected {preview.counts.rejected}. File size{" "}
            {formatBytes(preview.byteSize)}.
            {preview.dateFrom ? ` Dates ${preview.dateFrom} to ${preview.dateTo ?? preview.dateFrom}.` : ""}
          </p>
          {preview.message ? <p className="mt-2 text-[13px] text-steel">{preview.message}</p> : null}
          {preview.sampleTruncated ? (
            <p className="mt-2 text-[12px] text-steel">
              The sample is the first matching outcomes. Counts cover the whole file.
            </p>
          ) : null}
          {preview.rows.length > 0 ? (
            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[720px] text-left text-[12px]">
                <thead className="text-[11px] uppercase tracking-wider text-steel">
                  <tr>
                    <th className="py-2 pr-3">Document</th>
                    <th className="py-2 pr-3">Type</th>
                    <th className="py-2 pr-3">Date</th>
                    <th className="py-2 pr-3">Product</th>
                    <th className="py-2 pr-3">Qty</th>
                    <th className="py-2 pr-3">Amount</th>
                    <th className="py-2 pr-3">Result</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.rows.map((row, index) => (
                    <tr key={`${row.document}-${row.sku ?? ""}-${index}`} className="border-t border-border/60">
                      <td className="py-2 pr-3 font-mono">{row.document || "—"}</td>
                      <td className="py-2 pr-3">{row.type}</td>
                      <td className="py-2 pr-3">{row.date || "—"}</td>
                      <td className="py-2 pr-3 font-mono">{row.sku || "—"}</td>
                      <td className="num py-2 pr-3">{row.quantity || "—"}</td>
                      <td className="num py-2 pr-3">{row.amount || "—"}</td>
                      <td className="py-2 pr-3">
                        <span className="font-semibold uppercase">{row.disposition}</span>
                        <div className="text-steel">{row.reason}</div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
          {preview.samplePages > 1 ? (
            <div className="mt-3 flex items-center gap-2 text-[12px]">
              <button
                type="button"
                disabled={busy || preview.samplePage <= 1}
                className="h-8 rounded-md border border-border px-2 disabled:opacity-50"
                onClick={() => void runPreview(preview.samplePage - 1)}
              >
                Previous sample
              </button>
              <span>
                Sample page {preview.samplePage} of {preview.samplePages}
              </span>
              <button
                type="button"
                disabled={busy || preview.samplePage >= preview.samplePages}
                className="h-8 rounded-md border border-border px-2 disabled:opacity-50"
                onClick={() => void runPreview(preview.samplePage + 1)}
              >
                Next sample
              </button>
            </div>
          ) : null}
          <button
            type="button"
            disabled={!preview.canCommit || busy || jobActive}
            className="mt-3 h-9 rounded-md bg-primary px-3 text-[12px] font-bold uppercase text-primary-foreground disabled:opacity-50"
            onClick={() => {
              void (async () => {
                setBusy(true);
                setProgress("Confirming import from the stored file…");
                const result = await confirmCustomerSalesHistoryUploadFn({
                  data: {
                    companyId,
                    ...(upload561l ? { upload561lId: upload561l.uploadId } : {}),
                    ...(uploadSlrb ? { uploadSlrbId: uploadSlrb.uploadId } : {}),
                  },
                });
                setBusy(false);
                setProgress(null);
                if (!result.ok) {
                  toast.error(result.error);
                  return;
                }
                finishedJob.current = null;
                setJob(result.data);
                toast.message("Import started. History stays unchanged until the job finishes.");
              })();
            }}
          >
            Confirm import
          </button>
        </div>
      ) : null}
      {job ? (
        <div className="border-t border-border/70 px-4 py-3 text-[13px]" role="status">
          <p>
            {job.status === "COMPLETE"
              ? "Import complete. The customer history has been published."
              : job.status === "FAILED"
                ? "Import failed. The customer history was not published."
                : job.abandoned
                  ? "Import abandoned. Retry resumes from the saved progress."
                  : `Import ${job.status.toLowerCase()}. Customer history is not complete until this job finishes.`}
          </p>
          <p className="mt-1 text-steel">
            Processed {job.rowsProcessed.toLocaleString("en-GB")}. Stored {job.rowsStored.toLocaleString("en-GB")}.
            Duplicates {job.duplicates.toLocaleString("en-GB")}. Rejected {job.rejected.toLocaleString("en-GB")}. Failed{" "}
            {job.failed.toLocaleString("en-GB")}.
          </p>
          {job.sourceExpired || !job.sourceAvailable ? (
            <p className="mt-1 text-steel">{job.sourceMessage ?? "Upload the report again."}</p>
          ) : null}
          {job.canRetry ? (
            <button
              type="button"
              disabled={busy}
              className="mt-2 h-8 rounded-md border border-border px-2 text-[12px] font-semibold uppercase disabled:opacity-50"
              onClick={() => {
                void (async () => {
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
                  toast.message("Import resumed. History stays unchanged until the job finishes.");
                })();
              }}
            >
              Retry import
            </button>
          ) : null}
        </div>
      ) : null}
      {importResult ? (
        <div className="border-t border-border/70 px-4 py-4">
          <h4 className="text-[12px] font-bold uppercase tracking-wide">Import result</h4>
          <p className="mt-1 text-[13px]" role="status">
            Stored {importResult.rowsImported.toLocaleString("en-GB")} rows. Duplicates {importResult.duplicates}. Read{" "}
            {importResult.rowsRead.toLocaleString("en-GB")} rows, {importResult.otherCustomerRows.toLocaleString("en-GB")}{" "}
            from other customers were not stored. Cutover {importResult.historyStatus ?? "unchanged"}.
          </p>
        </div>
      ) : null}
    </section>
  );
}
