import { useEffect, useState } from "react";
import { toast } from "sonner";
import { ONGOING_REPORT_RETENTION } from "@/domain/customer-sales-import";
import {
  confirmCustomerSalesImportUploadFn,
  listCustomerSalesAccountsFn,
  previewCustomerSalesImportUploadFn,
} from "@/server/phase2/fns";
import {
  formatBytes,
  uploadCustomerSalesReport,
  type SavedCustomerSalesUpload,
} from "@/components/ab/upload-customer-sales-report";

type Accounts = Extract<Awaited<ReturnType<typeof listCustomerSalesAccountsFn>>, { ok: true }>["data"];
type Preview = Extract<Awaited<ReturnType<typeof previewCustomerSalesImportUploadFn>>, { ok: true }>["data"];
type ImportResult = Extract<Awaited<ReturnType<typeof confirmCustomerSalesImportUploadFn>>, { ok: true }>["data"];

export function CustomerSalesImportPanel({ companyId }: { companyId: string }) {
  const [accounts, setAccounts] = useState<Accounts | null>(null);
  const [accountCode, setAccountCode] = useState("");
  const [upload, setUpload] = useState<SavedCustomerSalesUpload | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void listCustomerSalesAccountsFn({ data: { companyId } }).then((result) => {
      if (cancelled || !result.ok) return;
      setAccounts(result.data);
      const first = result.data.accounts.find((account) => account.verified);
      setAccountCode(first?.code ?? "");
    });
    return () => {
      cancelled = true;
    };
  }, [companyId]);

  if (!accounts) return null;
  if (!accounts.verified || accounts.accounts.length === 0) {
    return (
      <section className="mb-6 border border-border/80 px-4 py-4">
        <h3 className="font-display text-sm font-semibold uppercase tracking-tight">
          Import this customer's sales
        </h3>
        <p className="mt-2 text-[13px] text-steel">
          Verify an Autopart account on this Active customer, then complete Import Sales History,
          before uploading a 504 or TRM21QC report.
        </p>
      </section>
    );
  }

  async function runPreview(samplePage = 1) {
    if (!upload) return;
    setBusy(true);
    setProgress(`Filtering ${formatBytes(upload.bytes)} to the selected Autopart account…`);
    const result = await previewCustomerSalesImportUploadFn({
      data: { companyId, accountCode, uploadId: upload.uploadId, samplePage, samplePageSize: 25 },
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
        <h3 className="font-display text-sm font-semibold uppercase tracking-tight">
          Import this customer's sales
        </h3>
        <p className="mt-1 text-[13px] text-steel">{accounts.assessment}</p>
        <p className="mt-1 text-[12px] text-steel">
          Cutover:{" "}
          {accounts.historyStatus === "COMPLETE"
            ? "complete"
            : accounts.historyStatus === "REVIEW"
              ? "needs review"
              : "not started"}
          {accounts.historyFrom ? ` (${accounts.historyFrom} to ${accounts.historyTo ?? accounts.historyFrom})` : ""}
        </p>
        <p className="mt-1 text-[12px] text-steel">{ONGOING_REPORT_RETENTION}</p>
      </div>
      <form
        className="grid gap-3 px-4 py-4"
        onSubmit={(event) => {
          event.preventDefault();
          void runPreview(1);
        }}
      >
        <label className="grid gap-1 text-[12px] font-semibold">
          Verified Autopart account
          <select
            value={accountCode}
            onChange={(event) => {
              setAccountCode(event.target.value);
              setPreview(null);
            }}
            className="h-9 rounded-md border border-border bg-surface px-3 text-[13px] font-normal"
          >
            {accounts.accounts
              .filter((account) => account.verified)
              .map((account) => (
                <option key={account.code} value={account.code}>
                  {account.code} {account.kind === "alias" ? "(alias)" : "(primary)"}
                </option>
              ))}
          </select>
        </label>
        <label className="grid gap-1 text-[12px] font-semibold">
          Original Autopart report
          <input
            type="file"
            accept=".csv,.txt,.tsv,text/plain,text/csv"
            className="text-[13px] font-normal"
            onChange={(event) => {
              const file = event.target.files?.[0];
              setPreview(null);
              setImportResult(null);
              if (!file) return;
              setBusy(true);
              setProgress(`Uploading ${file.name}: 0 B of ${formatBytes(file.size)}`);
              void uploadCustomerSalesReport({
                file,
                companyId,
                role: "ONGOING",
                onProgress: (loaded, total) => {
                  setProgress(`Uploading ${file.name}: ${formatBytes(loaded)} of ${formatBytes(total)}`);
                },
              })
                .then((saved) => {
                  setUpload(saved);
                  setProgress(`${saved.filename} uploaded (${formatBytes(saved.bytes)}). Preview does not create sales.`);
                })
                .catch((error: unknown) => {
                  setUpload(null);
                  setProgress(null);
                  toast.error(error instanceof Error ? error.message : "Upload failed");
                })
                .finally(() => setBusy(false));
            }}
          />
        </label>
        {upload ? (
          <p className="text-[12px] text-steel">
            {upload.filename} stored temporarily, {formatBytes(upload.bytes)}.
          </p>
        ) : null}
        {progress ? (
          <p className="text-[13px]" role="status">
            {progress}
          </p>
        ) : null}
        <button
          type="submit"
          disabled={busy || !upload || !accountCode}
          className="h-9 w-fit rounded-md border border-border px-3 text-[12px] font-semibold disabled:opacity-50"
        >
          {busy ? "Working…" : "Preview import"}
        </button>
      </form>
      {preview ? (
        <div className="border-t border-border/70 px-4 py-4">
          <h4 className="text-[12px] font-bold uppercase tracking-wide">Preview</h4>
          <p className="mt-1 text-[13px] text-steel">
            Preview shows proposed changes and does not create sales records. Confirm import uses this uploaded file.
          </p>
          <p className="mt-2 text-[13px]" role="status">
            {preview.kind === "504"
              ? "504 invoices and credits"
              : preview.kind === "TRM21QC"
                ? "TRM21QC product lines"
                : "Report not accepted"}
            {" for "}
            <span className="font-mono">{preview.accountCode}</span>
            {". "}
            Read {preview.rowsRead.toLocaleString("en-GB")} rows, {preview.matchingRows.toLocaleString("en-GB")} matching,{" "}
            {preview.otherCustomerRows.toLocaleString("en-GB")} other customers. Import {preview.counts.import}, update{" "}
            {preview.counts.update}, duplicate {preview.counts.duplicate}, skipped {preview.counts.skipped}, rejected{" "}
            {preview.counts.rejected}. File size {formatBytes(preview.byteSize)}.
          </p>
          {preview.message ? <p className="mt-2 text-[13px] text-steel">{preview.message}</p> : null}
          <ul className="mt-2 text-[12px] text-steel">
            {preview.effects.map((effect) => (
              <li key={effect}>{effect}</li>
            ))}
          </ul>
          {preview.rows.length > 0 ? (
            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[640px] text-left text-[12px]">
                <thead className="text-[11px] uppercase tracking-wider text-steel">
                  <tr>
                    <th className="py-2 pr-3">Document</th>
                    <th className="py-2 pr-3">Type</th>
                    <th className="py-2 pr-3">Account</th>
                    <th className="py-2 pr-3">Amount</th>
                    <th className="py-2 pr-3">Result</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.rows.map((row, index) => (
                    <tr key={`${row.document}-${index}`} className="border-t border-border/60">
                      <td className="py-2 pr-3 font-mono">{row.document || "—"}</td>
                      <td className="py-2 pr-3">{row.type}</td>
                      <td className="py-2 pr-3 font-mono">{row.account || "—"}</td>
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
            disabled={!preview.canCommit || busy}
            className="mt-3 h-9 rounded-md bg-primary px-3 text-[12px] font-bold uppercase text-primary-foreground disabled:opacity-50"
            onClick={() => {
              void (async () => {
                if (!upload) return;
                setBusy(true);
                setProgress("Confirming import from the stored file…");
                const result = await confirmCustomerSalesImportUploadFn({
                  data: { companyId, accountCode, uploadId: upload.uploadId },
                });
                setBusy(false);
                setProgress(null);
                if (!result.ok) {
                  toast.error(result.error);
                  return;
                }
                setPreview(null);
                setImportResult(result.data);
                toast.success("Customer sales import stored");
                const refreshed = await listCustomerSalesAccountsFn({ data: { companyId } });
                if (refreshed.ok) setAccounts(refreshed.data);
              })();
            }}
          >
            Confirm import
          </button>
        </div>
      ) : null}
      {importResult ? (
        <div className="border-t border-border/70 px-4 py-4">
          <h4 className="text-[12px] font-bold uppercase tracking-wide">Import result</h4>
          <p className="mt-1 text-[13px]" role="status">
            Stored {importResult.rowsImported.toLocaleString("en-GB")} rows, updated {importResult.rowsUpdated}, skipped{" "}
            {importResult.rowsSkipped}. Read {importResult.rowsRead.toLocaleString("en-GB")} rows.{" "}
            {importResult.otherCustomerRows.toLocaleString("en-GB")} other customers were not stored. File size{" "}
            {formatBytes(importResult.byteSize)}.
          </p>
        </div>
      ) : null}
    </section>
  );
}
