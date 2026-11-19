import { useCallback, useEffect, useState } from "react";
import { getOrderDiagnosticsFn } from "@/server/phase2/fns";

type Diagnostics = Extract<Awaited<ReturnType<typeof getOrderDiagnosticsFn>>, { ok: true }>["data"];

function when(iso: string | null | undefined): string {
  return iso ? new Date(iso).toLocaleString("en-GB") : "Not recorded";
}

export function OrderDiagnosticsPanel({ orderId }: { orderId: string }) {
  const [data, setData] = useState<Diagnostics | null>(null);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await getOrderDiagnosticsFn({ data: { orderId } });
      if (result.ok) {
        setData(result.data);
        setError(null);
      } else {
        setData(null);
        setError(result.error);
      }
    } catch {
      setError("Unable to load diagnostics");
    } finally {
      setLoading(false);
    }
  }, [orderId]);

  useEffect(() => {
    if (open && !data && !loading && !error) void load();
  }, [open, data, loading, error, load]);

  return (
    <section className="rounded-lg border border-border p-5 lg:col-span-2" data-testid="order-diagnostics">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <button type="button" aria-expanded={open} aria-controls="order-diagnostics-content"
          onClick={() => setOpen((value) => !value)}
          className="flex flex-1 items-center gap-2 text-left font-display text-base font-semibold uppercase">
          <span aria-hidden="true">{open ? "▾" : "▸"}</span> Order diagnostics
          <span className="font-sans text-xs font-normal normal-case text-steel">
            {open ? "Hide details" : "Show read-only evidence"}
          </span>
        </button>
        {open ? <button type="button" onClick={() => void load()} disabled={loading}
          className="rounded-md border border-border px-3 py-2 text-xs font-semibold disabled:opacity-50">
          {loading ? "Loading…" : "Refresh diagnostics"}
        </button> : null}
      </div>
      {open ? <div id="order-diagnostics-content">
      <p className="mt-2 text-xs text-steel">Read-only evidence from B2B records. Nothing is retried or changed.</p>
      {error ? <p role="alert" className="mt-3 text-sm text-destructive">{error}</p> : null}
      {data ? (
        <div className="mt-4 space-y-5 text-sm">
          <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <div><dt className="text-steel">Order state</dt><dd className="font-semibold">{data.orderStatus}</dd></div>
            <div><dt className="text-steel">Stock hold</dt><dd>{data.stockReleasePolicy} / {data.stockHoldState}</dd></div>
            <div><dt className="text-steel">Export</dt><dd>{data.exportStatus} · {data.exportCount} CSV generation(s)</dd></div>
            <div><dt className="text-steel">Export batch</dt><dd>{data.exportBatch?.reference ?? "Not recorded"}</dd></div>
            <div><dt className="text-steel">Invoice evidence classification</dt><dd>{data.invoiceEvidence}</dd></div>
            <div><dt className="text-steel">Last hold check</dt><dd>{when(data.stockHoldLastCheckedAt)}</dd></div>
          </dl>
          {data.invoices.length > 0 && data.invoiceEvidence === "NOT_RECORDED" ? (
            <p className="rounded border border-border p-3 text-xs text-steel">A linked invoice is recorded, but the separate order-level invoice-evidence classification is NOT_RECORDED. This does not mean the invoice is missing; the two records are not automatically equivalent.</p>
          ) : null}
          <div>
            <h3 className="font-semibold">Stock-ready notification</h3>
            {data.emails.filter(e => e.purpose === "ORDER_STOCK_HOLD_READY_INTERNAL").length ? (
              <ul className="mt-2 space-y-2">
                {data.emails.filter(e => e.purpose === "ORDER_STOCK_HOLD_READY_INTERNAL").map(e => (
                  <li key={e.id} className="rounded border border-border p-3">
                    <div className="font-medium">{e.status} · {e.toEmail} · attempts {e.attemptCount}</div>
                    <div className="text-xs text-steel">Created {when(e.createdAt)} · Provider accepted {when(e.sentAt)}</div>
                    {e.lastError ? <div className="mt-1 break-words text-xs text-destructive">Last error: {e.lastError}</div> : null}
                    {e.providerId ? <div className="mt-1 break-all text-xs text-steel">Provider ID: {e.providerId}</div> : null}
                  </li>
                ))}
              </ul>
            ) : <p className="mt-2 text-steel">No stock-ready email outbox record was found for this order.</p>}
          </div>
          <div>
            <h3 className="font-semibold">Linked invoice records ({data.invoices.length})</h3>
            {data.invoices.length ? (
              <ul className="mt-2 space-y-1">
                {data.invoices.map(i => <li key={i.id} className="rounded border border-border p-2">
                  {i.invoiceNumber} · {i.status} · issued {when(i.issuedAt)}
                  {i.autopartDocumentKind ? ` · Autopart ${i.autopartDocumentKind}` : ""}
                </li>)}
              </ul>
            ) : <p className="mt-2 text-steel">No invoice linked to this order in B2B.</p>}
          </div>
          <div>
            <h3 className="font-semibold">Recorded timeline ({data.timeline.length})</h3>
            {data.timeline.length ? (
              <ol className="mt-2 max-h-[28rem] space-y-2 overflow-y-auto border-l border-border pl-4">
                {data.timeline.map(event => (
                  <li key={event.id} className="rounded border border-border p-2">
                    <div className="text-xs text-steel">{when(event.at)} · {event.kind.replaceAll("_", " ")}</div>
                    <div className="break-words">{event.detail}</div>
                  </li>
                ))}
              </ol>
            ) : <p className="mt-2 text-steel">No events recorded.</p>}
          </div>
          <ul className="space-y-1 text-xs text-steel">
            {data.limitations.map(l => <li key={l}>• {l}</li>)}
          </ul>
        </div>
      ) : !error ? <p className="mt-3 text-sm text-steel">Loading diagnostics…</p> : null}
      </div> : null}
    </section>
  );
}
