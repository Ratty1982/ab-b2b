import { useState } from "react";
import { toast } from "sonner";
import { ConfirmAction } from "@/components/pricing/ConfirmAction";
import {
  acknowledgeCustomerSalesHistoryFn,
  completeCustomerSalesCutoverFn,
  confirmCustomerSalesHistoryFn,
  previewCustomerSalesHistoryFn,
  startCustomerSalesHistoryBaselineFn,
} from "@/server/phase2/fns";

const STANDARD_IMPORT_BYTES = 8_000_000;

type Preview = Extract<Awaited<ReturnType<typeof previewCustomerSalesHistoryFn>>, { ok: true }>["data"];
type RowFilter = "ALL" | "import" | "duplicate" | "rejected" | "ledger";

type ChosenFile = { name: string; size: number; text: string };

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

async function readReport(file: File): Promise<ChosenFile> {
  if (file.size > STANDARD_IMPORT_BYTES) {
    throw new Error(
      `${file.name} is ${formatSize(file.size)}. Files this large use the separate large-file import, which is not on this screen. Nothing was uploaded.`,
    );
  }
  return { name: file.name, size: file.size, text: await file.text() };
}

function FileSlot({
  label,
  help,
  file,
  disabled,
  onChoose,
  onClear,
}: {
  label: string;
  help: string;
  file: ChosenFile | null;
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
      {file ? (
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[12px]">
          <span>
            {file.name} · {formatSize(file.size)}
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
  const [productFile, setProductFile] = useState<ChosenFile | null>(null);
  const [ledgerFile, setLedgerFile] = useState<ChosenFile | null>(null);
  const [reading, setReading] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [filter, setFilter] = useState<RowFilter>("ALL");
  const [page, setPage] = useState(1);
  const [confirm, setConfirm] = useState<"import" | "none" | "baseline" | "review" | null>(null);

  async function choose(which: "product" | "ledger", file: File) {
    setReading(file.name);
    setPreview(null);
    setSaved(null);
    try {
      const chosen = await readReport(file);
      if (which === "product") setProductFile(chosen);
      else setLedgerFile(chosen);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "The file could not be read");
    } finally {
      setReading(null);
    }
  }

  const locked = historyStatus === "REVIEW";
  const recorded =
    historyStatus === "COMPLETE" &&
    (historyKind === "NO_HISTORICAL_SALES" || historyKind === "PRELAUNCH_HISTORY_DISCARDED");

  async function previewImport() {
    if (!productFile && !ledgerFile) return;
    setBusy(true);
    setSaved(null);
    const result = await previewCustomerSalesHistoryFn({
      data: {
        companyId,
        text561l: productFile?.text ?? "",
        textSlrb: ledgerFile?.text ?? "",
        filename561l: productFile?.name ?? "",
        filenameSlrb: ledgerFile?.name ?? "",
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
    setBusy(true);
    const result = await confirmCustomerSalesHistoryFn({
      data: {
        companyId,
        text561l: productFile?.text ?? "",
        textSlrb: ledgerFile?.text ?? "",
        filename561l: productFile?.name ?? "",
        filenameSlrb: ledgerFile?.name ?? "",
      },
    });
    setBusy(false);
    setConfirm(null);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    setSaved(
      result.data.historyStatus === "REVIEW"
        ? `Saved ${result.data.rowsImported} new rows. ${result.data.duplicates} were already imported. Exceptions still need review before current sales can be imported.`
        : `Saved ${result.data.rowsImported} new rows. ${result.data.duplicates} were already imported.`,
    );
    toast.success("Sales history saved");
    await onChanged();
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
          account on this customer. A preview does not save anything. A very large Retail file is handled
          by the separate large-file import and is refused here so it is not loaded twice.
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

      {reading ? <p className="mt-3 text-[13px] text-steel">Reading {reading}…</p> : null}
      {canImport && !locked && !blocked ? (
        <div
          className="mt-4 grid gap-3 lg:grid-cols-2"
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => {
            event.preventDefault();
            const file = event.dataTransfer.files[0];
            if (!file) return;
            const ledger = /slrb|ledger/i.test(file.name);
            void choose(ledger ? "ledger" : "product", file);
          }}
        >
          <FileSlot
            label="Product sales"
            help="The product report of purchases and sales values."
            file={productFile}
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
            disabled={busy}
            onChoose={(file) => void choose("ledger", file)}
            onClear={() => {
              setLedgerFile(null);
              setPreview(null);
            }}
          />
        </div>
      ) : null}

      {canImport && !locked && !blocked ? (
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            disabled={busy || (!productFile && !ledgerFile)}
            className="h-10 rounded-md bg-primary px-4 text-[12px] font-bold uppercase text-primary-foreground disabled:opacity-50"
            onClick={() => void previewImport()}
          >
            {busy ? "Checking…" : "Preview import"}
          </button>
        </div>
      ) : null}

      {preview ? (
        <div className="mt-4 border-t border-border pt-4">
          <p className="text-[13px] font-semibold" role="status">
            Preview only. Nothing has been saved.
          </p>
          <dl className="mt-3 grid grid-cols-2 gap-2 text-[13px] sm:grid-cols-5">
            <div><dt className="text-steel">Records found</dt><dd className="font-semibold">{found}</dd></div>
            <div><dt className="text-steel">New product rows</dt><dd className="font-semibold">{preview.counts.import}</dd></div>
            <div><dt className="text-steel">Already imported</dt><dd className="font-semibold">{preview.counts.duplicate}</dd></div>
            <div><dt className="text-steel">Rejected</dt><dd className="font-semibold">{preview.counts.rejected}</dd></div>
            <div>
              <dt className="text-steel">Dates</dt>
              <dd className="font-semibold">
                {preview.dateFrom ? `${preview.dateFrom} to ${preview.dateTo ?? preview.dateFrom}` : "—"}
              </dd>
            </div>
          </dl>
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
            <span>Page {page} of {pages}. The table shows a sample. The counts above are the full file.</span>
            <span className="flex gap-2">
              <button type="button" disabled={page <= 1} onClick={() => setPage((current) => current - 1)}>Previous</button>
              <button type="button" disabled={page >= pages} onClick={() => setPage((current) => current + 1)}>Next</button>
            </span>
          </div>
          <button
            type="button"
            disabled={!preview.canCommit || busy}
            className="mt-3 h-10 rounded-md bg-primary px-4 text-[12px] font-bold uppercase text-primary-foreground disabled:opacity-50"
            onClick={() => setConfirm("import")}
          >
            Confirm import
          </button>
        </div>
      ) : null}
      {saved ? <p className="mt-3 text-[13px]" role="status">{saved}</p> : null}

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
                  ? "This saves the previewed rows. It replaces the current no-history or new-baseline record with imported history. Rejected rows keep the account in review."
                  : "This saves the previewed rows for this customer. It does not email the customer or turn on automatic importing. Rejected rows must be reviewed before current sales can be imported."
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
          })();
        }}
      />
    </section>
  );
}
