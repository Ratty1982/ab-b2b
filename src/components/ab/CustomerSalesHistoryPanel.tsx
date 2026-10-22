import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  acknowledgeCustomerSalesHistoryFn,
  completeCustomerSalesCutoverFn,
  confirmCustomerSalesHistoryFn,
  listStoredCustomerSalesHistoryFn,
  startCustomerSalesHistoryBaselineFn,
  listCustomerSalesAccountsFn,
  previewCustomerSalesHistoryFn,
} from "@/server/phase2/fns";

type Preview = Extract<Awaited<ReturnType<typeof previewCustomerSalesHistoryFn>>, { ok: true }>["data"];
type StoredHistory = Extract<Awaited<ReturnType<typeof listStoredCustomerSalesHistoryFn>>, { ok: true }>["data"];

export function CustomerSalesHistoryPanel({ companyId }: { companyId: string }) {
  const [filename561l, setFilename561l] = useState("");
  const [filenameSlrb, setFilenameSlrb] = useState("");
  const [text561l, setText561l] = useState("");
  const [textSlrb, setTextSlrb] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [stored, setStored] = useState<StoredHistory | null>(null);
  const [storedError, setStoredError] = useState<string | null>(null);
  const [historyStatus, setHistoryStatus] = useState<string>("NOT_STARTED");
  const [historyKind, setHistoryKind] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function refreshStatus() {
    const accounts = await listCustomerSalesAccountsFn({ data: { companyId } });
    if (accounts.ok) {
      setHistoryStatus(accounts.data.historyStatus);
      setHistoryKind(accounts.data.historyKind);
    }
    const storedHistory = await listStoredCustomerSalesHistoryFn({ data: { companyId } });
    if (storedHistory.ok) {
      setStored(storedHistory.data);
      setStoredError(null);
    } else {
      setStoredError(storedHistory.error);
    }
  }

  useEffect(() => {
    void refreshStatus();
  }, [companyId]);

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
          void (async () => {
            setBusy(true);
            const result = await previewCustomerSalesHistoryFn({
              data: { companyId, text561l, textSlrb, filename561l, filenameSlrb },
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
        <label className="grid gap-1 text-[12px] font-semibold">
          561L product report
          <input
            type="file"
            accept=".csv,.txt,.tsv,text/plain,text/csv"
            className="text-[13px] font-normal"
            onChange={(event) => {
              const file = event.target.files?.[0];
              setPreview(null);
              if (!file) return;
              setFilename561l(file.name);
              void file.text().then(setText561l);
            }}
          />
        </label>
        <label className="grid gap-1 text-[12px] font-semibold">
          SLRB ledger report
          <input
            type="file"
            accept=".csv,.txt,.tsv,text/plain,text/csv"
            className="text-[13px] font-normal"
            onChange={(event) => {
              const file = event.target.files?.[0];
              setPreview(null);
              if (!file) return;
              setFilenameSlrb(file.name);
              void file.text().then(setTextSlrb);
            }}
          />
        </label>
        <div className="flex flex-wrap gap-2">
          <button
            type="submit"
            disabled={busy || (!text561l && !textSlrb)}
            className="h-9 rounded-md border border-border px-3 text-[12px] font-semibold disabled:opacity-50"
          >
            {busy ? "Checking…" : "Preview history"}
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
          <h4 className="text-[12px] font-bold uppercase tracking-wide">Proposed changes</h4>
          <p className="mt-1 text-[13px] text-steel">
            Preview shows proposed changes. Nothing in this table is stored until you import.
          </p>
          <p className="mt-2 text-[13px]" role="status">
            Accounts {preview.accountCodes.join(", ")}. Import {preview.counts.import}, ledger{" "}
            {preview.counts.ledger}, duplicate {preview.counts.duplicate}, rejected {preview.counts.rejected}.
            {preview.dateFrom ? ` Dates ${preview.dateFrom} to ${preview.dateTo ?? preview.dateFrom}.` : ""}
          </p>
          {preview.message ? <p className="mt-2 text-[13px] text-steel">{preview.message}</p> : null}
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
          <button
            type="button"
            disabled={!preview.canCommit || busy}
            className="mt-3 h-9 rounded-md bg-primary px-3 text-[12px] font-bold uppercase text-primary-foreground disabled:opacity-50"
            onClick={() => {
              void (async () => {
                setBusy(true);
                const result = await confirmCustomerSalesHistoryFn({
                  data: { companyId, text561l, textSlrb, filename561l, filenameSlrb },
                });
                setBusy(false);
                if (!result.ok) {
                  toast.error(result.error);
                  return;
                }
                toast.success(
                  result.data.historyStatus === "REVIEW"
                    ? "Valid rows stored. Cutover stays in review"
                    : "Sales history stored for this customer",
                );
                setPreview(null);
                await refreshStatus();
              })();
            }}
          >
            Import history for this customer
          </button>
        </div>
      ) : null}
      {storedError ? <p className="border-t border-border/70 px-4 py-3 text-[13px] text-warn">{storedError}</p> : null}
      {stored && (stored.productLines > 0 || stored.paymentDocuments > 0) ? (
        <div className="border-t border-border/70 px-4 py-4">
          <h4 className="text-[12px] font-bold uppercase tracking-wide">Stored records</h4>
          <p className="mt-1 text-[13px] text-steel">
            These are the records stored for this customer. Sales Enquiry counts each invoice once.
            Payments are stored as ledger evidence and are not product sales.
            {stored.historyStatus === "REVIEW"
              ? " Rejected rows still need staff acknowledgement before cutover is complete."
              : ""}
          </p>
          <p className="mt-2 text-[13px]" role="status">
            {stored.productLines} product lines, {stored.datedProductLines} dated, {stored.undatedProductLines}{" "}
            without an invoice date, {stored.saleDocuments} sale documents, {stored.paymentDocuments} payments.
            Stored product net {stored.productNet}.
            {stored.truncated ? ` Showing the first ${stored.rows.length} product lines.` : ""}
          </p>
          {stored.rows.length > 0 ? (
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
                    <th className="py-2 pr-3">Source</th>
                  </tr>
                </thead>
                <tbody>
                  {stored.rows.map((row, index) => (
                    <tr key={`${row.document}-${row.sku}-${index}`} className="border-t border-border/60">
                      <td className="py-2 pr-3 font-mono">{row.document}</td>
                      <td className="py-2 pr-3">{row.type}</td>
                      <td className="py-2 pr-3">{row.date ?? "Date unavailable"}</td>
                      <td className="py-2 pr-3 font-mono">{row.sku}</td>
                      <td className="num py-2 pr-3">{row.quantity}</td>
                      <td className="num py-2 pr-3">{row.amount}</td>
                      <td className="py-2 pr-3">{row.source}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
