import { useState } from "react";
import { toast } from "sonner";
import { ConfirmAction } from "@/components/pricing/ConfirmAction";
import { confirmCustomerSalesImportFn, previewCustomerSalesImportFn } from "@/server/phase2/fns";

const STANDARD_IMPORT_BYTES = 8_000_000;

type Preview = Extract<Awaited<ReturnType<typeof previewCustomerSalesImportFn>>, { ok: true }>["data"];
type ChosenFile = { name: string; size: number; text: string };

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function AutopartRecentSales({
  companyId,
  canImport,
  accountCode,
  aliases,
  historyStatus,
  companyStatus,
  verified,
  onChanged,
}: {
  companyId: string;
  canImport: boolean;
  accountCode: string | null;
  aliases: string[];
  historyStatus: "NOT_STARTED" | "REVIEW" | "COMPLETE";
  companyStatus: string;
  verified: boolean;
  onChanged: () => Promise<void>;
}) {
  const [selected, setSelected] = useState(accountCode ?? "");
  const [file, setFile] = useState<ChosenFile | null>(null);
  const [reading, setReading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const ready = verified && companyStatus === "ACTIVE" && historyStatus === "COMPLETE" && Boolean(selected);
  const blocked =
    !verified
      ? "Verify the sales account before importing current sales."
      : companyStatus !== "ACTIVE"
        ? "Current sales are imported only for an Active customer."
        : historyStatus === "REVIEW"
          ? "Current sales stay closed until the historical exceptions are reviewed."
          : historyStatus !== "COMPLETE"
            ? "Record the historical position before importing current sales."
            : null;

  async function choose(next: File) {
    setPreview(null);
    setSaved(null);
    if (next.size > STANDARD_IMPORT_BYTES) {
      toast.error(`${next.name} is too large for this screen. Use the separate large-file import. Nothing was uploaded.`);
      return;
    }
    setReading(true);
    setFile({ name: next.name, size: next.size, text: await next.text() });
    setReading(false);
  }

  const accounts = [
    ...(accountCode ? [accountCode] : []),
    ...aliases.filter((alias) => alias !== accountCode),
  ];

  return (
    <section id="autopart-current" className="rounded-lg border border-border p-4 sm:p-5">
      <h3 className="font-display text-base font-semibold uppercase">Import recent sales</h3>
      <p className="mt-2 max-w-3xl text-[13px] text-steel">
        Invoice and credit reports, or product-sales reports, for the verified account shown here.
        Automatic mailbox collection stays off.
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
              const result = await previewCustomerSalesImportFn({
                data: { companyId, accountCode: selected, text: file.text, filename: file.name },
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
              if (next) void choose(next);
            }}
          >
            <div className="text-[13px] font-semibold">Invoice report or product-sales report</div>
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
            {file ? (
              <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[12px]">
                <span>
                  {file.name} · {formatSize(file.size)}
                </span>
                <button type="button" className="font-semibold uppercase" onClick={() => { setFile(null); setPreview(null); }}>
                  Remove
                </button>
              </div>
            ) : null}
          </div>
          {reading ? <p className="text-[13px] text-steel">Reading file…</p> : null}
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
          <p className="font-semibold" role="status">Preview only. Nothing has been saved.</p>
          <p className="mt-2">
            {preview.kind === "504" ? "Invoices and credits" : preview.kind === "TRM21QC" ? "Product sales" : "Unrecognised file"}
            {" · "}
            New {preview.counts.import}, updated {preview.counts.update}, duplicates {preview.counts.duplicate}, rejected {preview.counts.rejected}.
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
        title="Save these recent sales?"
        description="This stores the previewed invoices or product sales for this customer. It does not email the customer or turn on automatic importing."
        confirmLabel={busy ? "Saving…" : "Confirm"}
        onOpenChange={(open) => {
          if (!open && !busy) setConfirmOpen(false);
        }}
        onConfirm={() => {
          if (!file || !preview) return;
          const checked = preview;
          void (async () => {
            setBusy(true);
            const result = await confirmCustomerSalesImportFn({
              data: { companyId, accountCode: selected, text: file.text, filename: file.name },
            });
            setBusy(false);
            setConfirmOpen(false);
            if (!result.ok) {
              toast.error(result.error);
              return;
            }
            setSaved(
              `${file.name} saved. New ${result.data.rowsImported}, updated ${result.data.rowsUpdated}, duplicates ${checked.counts.duplicate}, rejected ${checked.counts.rejected}.`,
            );
            setPreview(null);
            toast.success("Recent sales saved");
            await onChanged();
          })();
        }}
      />
    </section>
  );
}
