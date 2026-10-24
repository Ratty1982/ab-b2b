import { useState } from "react";
import { toast } from "sonner";
import { ConfirmAction } from "@/components/pricing/ConfirmAction";
import {
  formatBytes,
  uploadCustomerSalesReport,
  type SavedCustomerSalesUpload,
} from "@/components/ab/upload-customer-sales-report";
import { confirmCustomerSalesImportUploadFn, previewCustomerSalesImportUploadFn } from "@/server/phase2/fns";

type Preview = Extract<Awaited<ReturnType<typeof previewCustomerSalesImportUploadFn>>, { ok: true }>["data"];

export function AutopartRecentSales({
  companyId,
  canImport,
  accountCode,
  aliases,
  historyStatus,
  companyStatus,
  verified,
  automaticImportEnabled = false,
  outstandingIssue = null,
  onChanged,
}: {
  companyId: string;
  canImport: boolean;
  accountCode: string | null;
  aliases: string[];
  historyStatus: "NOT_STARTED" | "REVIEW" | "COMPLETE";
  companyStatus: string;
  verified: boolean;
  automaticImportEnabled?: boolean;
  outstandingIssue?: string | null;
  onChanged: () => Promise<void>;
}) {
  const [selected, setSelected] = useState(accountCode ?? "");
  const [file, setFile] = useState<SavedCustomerSalesUpload | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const ready = verified && companyStatus === "ACTIVE" && historyStatus === "COMPLETE" && Boolean(selected);
  const blocked =
    !verified
      ? "Verify the sales account before using a catch-up file."
      : companyStatus !== "ACTIVE"
        ? "Catch-up imports are available only for an Active customer."
        : historyStatus === "REVIEW"
          ? "Catch-up imports stay closed until the historical exceptions are reviewed."
          : historyStatus !== "COMPLETE"
            ? "Finish historical sales setup before using a catch-up file."
            : null;

  async function choose(next: File) {
    setPreview(null);
    setSaved(null);
    setProgress(`Uploading ${next.name}…`);
    try {
      const savedUpload = await uploadCustomerSalesReport({
        file: next,
        companyId,
        role: "ONGOING",
        onProgress: (loaded, total) => {
          const percent = total > 0 ? Math.min(100, Math.round((loaded / total) * 100)) : 0;
          setProgress(`Uploading ${next.name}… ${percent}%`);
        },
      });
      setFile(savedUpload);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "The file could not be uploaded");
    } finally {
      setProgress(null);
    }
  }

  const accounts = [
    ...(accountCode ? [accountCode] : []),
    ...aliases.filter((alias) => alias !== accountCode),
  ];

  return (
    <section id="autopart-current" className="rounded-lg border border-border p-4 sm:p-5">
      <h3 className="font-display text-base font-semibold uppercase">Automatic sales updates</h3>
      <p className="mt-2 max-w-3xl text-[13px] text-steel">
        After historical 561L and SLRB setup is complete, scheduled 504 and TRM21QC feeds keep this
        customer's sales up to date automatically. Manual upload is optional recovery or catch-up only —
        it is not a required setup step.
      </p>
      <p className="mt-2 text-[13px]">
        Automatic polling is{" "}
        <span className="font-semibold">{automaticImportEnabled ? "enabled" : "disabled"}</span>
        {outstandingIssue ? `. Outstanding issue: ${outstandingIssue}` : "."}
      </p>
      {accountCode ? (
        <p className="mt-3 text-[13px]">
          Verified account <span className="font-mono font-semibold">{selected || accountCode}</span>
        </p>
      ) : null}
      {blocked ? <p className="mt-3 text-[13px] text-steel">{blocked}</p> : null}
      {ready && canImport ? (
        <form
          className="mt-4 grid gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (!file) return;
            void (async () => {
              setBusy(true);
              const result = await previewCustomerSalesImportUploadFn({
                data: { companyId, accountCode: selected, uploadId: file.uploadId },
              });
              setBusy(false);
              if (!result.ok) {
                toast.error(result.error);
                return;
              }
              setPreview(result.data);
            })();
          }}
        >
          {accounts.length > 1 ? (
            <label className="grid gap-1 text-[12px] font-semibold">
              Account
              <select
                value={selected}
                onChange={(event) => {
                  setSelected(event.target.value);
                  setPreview(null);
                }}
                className="h-10 rounded-md border border-border bg-surface px-3 text-[13px] font-normal"
              >
                {accounts.map((code) => (
                  <option key={code} value={code}>
                    {code}
                    {code === accountCode ? " · primary" : " · alias"}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <div
            className="rounded-md border border-dashed border-border p-3"
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault();
              const next = event.dataTransfer.files[0];
              if (next && !busy) void choose(next);
            }}
          >
            <div className="text-[13px] font-semibold">Optional catch-up: invoice report or product-sales report</div>
            <label className="mt-3 flex cursor-pointer flex-col gap-1 rounded-md bg-surface/40 px-3 py-4 text-[13px]">
              <span className="font-semibold">Drop a file here, or choose a file</span>
              <span className="text-[12px] text-steel">CSV or text export</span>
              <input
                type="file"
                accept=".csv,.txt,.tsv,text/plain,text/csv"
                className="sr-only"
                onChange={(event) => {
                  const next = event.target.files?.[0];
                  event.target.value = "";
                  if (next) void choose(next);
                }}
              />
            </label>
            {progress ? <p className="mt-2 text-[12px] text-steel" role="status">{progress}</p> : null}
            {file ? (
              <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[12px]">
                <span>
                  {file.filename} · {formatBytes(file.bytes)}
                </span>
                <button type="button" className="font-semibold uppercase" onClick={() => { setFile(null); setPreview(null); }}>
                  Remove
                </button>
              </div>
            ) : null}
          </div>
          <button
            type="submit"
            disabled={busy || !file}
            className="h-10 w-fit rounded-md border border-border px-4 text-[12px] font-bold uppercase disabled:opacity-50"
          >
            {busy ? "Checking…" : "Preview import"}
          </button>
        </form>
      ) : null}
      {preview ? (
        <div className="mt-4 border-t border-border pt-4 text-[13px]">
          <h4 className="font-semibold">Proposed changes</h4>
          <p className="mt-1 font-semibold" role="status">Preview only. Nothing has been saved.</p>
          <p className="mt-2">
            {preview.kind === "504" ? "Invoices and credits" : preview.kind === "TRM21QC" ? "Product sales" : "Unrecognised file"}
            {" · "}
            New {preview.counts.import}, updated {preview.counts.update}, duplicates {preview.counts.duplicate}, rejected {preview.counts.rejected}.
          </p>
          <p className="mt-2 text-[12px] text-steel">
            Read {preview.rowsRead.toLocaleString("en-GB")} rows. {preview.otherCustomerRows.toLocaleString("en-GB")} from other customers were left out.
            File size {formatBytes(preview.byteSize)}.
          </p>
          {preview.message ? <p className="mt-2 text-steel">{preview.message}</p> : null}
          <button
            type="button"
            disabled={!preview.canCommit || busy}
            className="mt-3 h-10 rounded-md bg-primary px-4 text-[12px] font-bold uppercase text-primary-foreground disabled:opacity-50"
            onClick={() => setConfirmOpen(true)}
          >
            Confirm import
          </button>
        </div>
      ) : null}
      {saved ? <p className="mt-3 text-[13px]" role="status">{saved}</p> : null}
      <ConfirmAction
        open={confirmOpen}
        title="Save this catch-up import?"
        description="This stores the uploaded file that was previewed for recovery or catch-up. It does not email the customer. Automatic mailbox polling is controlled separately."
        confirmLabel={busy ? "Saving…" : "Confirm"}
        onOpenChange={(open) => {
          if (!open && !busy) setConfirmOpen(false);
        }}
        onConfirm={() => {
          if (!file || !preview) return;
          const checked = preview;
          void (async () => {
            setBusy(true);
            const result = await confirmCustomerSalesImportUploadFn({
              data: { companyId, accountCode: selected, uploadId: checked.uploadId },
            });
            setBusy(false);
            setConfirmOpen(false);
            if (!result.ok) {
              toast.error(result.error);
              return;
            }
            const savedAt = new Date().toLocaleString("en-GB", { timeZone: "Europe/London" });
            setSaved(
              `${file.filename} saved at ${savedAt}. New ${result.data.rowsImported}, updated ${result.data.rowsUpdated}, duplicates ${checked.counts.duplicate}, rejected ${checked.counts.rejected}.`,
            );
            setPreview(null);
            toast.success("Catch-up import saved");
            await onChanged();
          })();
        }}
      />
    </section>
  );
}
