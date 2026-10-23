import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { PanelHeader } from "@/components/ab/AppShell";
import { InvoiceRows } from "@/components/ab/CustomerCommercialRegister";
import { inputClass } from "@/components/ab/Drawer";
import { listPortalInvoicesFn } from "@/server/workspace/fns";

export const Route = createFileRoute("/portal/invoices")({
  head: () => ({
    meta: [{ title: "Invoices — Automotive Brands Trade Portal" }],
  }),
  component: PortalInvoicesPage,
});

function PortalInvoicesPage() {
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<
    Array<{
      id: string;
      origin: string;
      number: string;
      issuedAt: string | null;
      documentType: string;
      value: string | null;
      orderId: string | null;
      orderNumber: string | null;
      status: string | null;
    }>
  >([]);
  const [total, setTotal] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void listPortalInvoicesFn({ data: { page, pageSize: 25, q: q || undefined } }).then((result) => {
      if (cancelled) return;
      setLoading(false);
      if (!result.ok) {
        setError(result.error);
        setRows([]);
        return;
      }
      setError(null);
      setRows(result.data.items);
      setTotal(result.data.total);
    });
    return () => {
      cancelled = true;
    };
  }, [page, q]);

  const pages = Math.max(1, Math.ceil(total / 25));

  return (
    <div>
      <PanelHeader
        title="Invoices"
        sub="B2B invoices and imported Autopart invoices or credits for your account"
      />
      <div className="grid gap-4 p-4 sm:p-6">
        <p className="max-w-3xl text-[13px] text-steel">
          Only invoices for your active customer account are shown. A document that exists in more
          than one source is listed once. Download is offered only when a real invoice file is stored.
        </p>
        <input
          value={q}
          onChange={(event) => {
            setPage(1);
            setQ(event.target.value);
          }}
          placeholder="Search invoice or order"
          className={inputClass}
          aria-label="Search invoices"
        />
        {loading ? <p className="text-sm text-steel">Loading invoices…</p> : null}
        {error ? <p className="text-sm text-bad">{error}</p> : null}
        {!loading && !error && rows.length === 0 ? (
          <p className="rounded-md border border-dashed border-border px-6 py-10 text-center text-sm text-steel">
            No invoices are on file for this account yet.
          </p>
        ) : null}
        {!loading && rows.length > 0 ? (
          <div className="overflow-x-auto border border-border">
            <InvoiceRows rows={rows} portal />
          </div>
        ) : null}
        <div className="flex items-center justify-between text-[12px] text-steel">
          <span>{total} record{total === 1 ? "" : "s"}</span>
          <div className="flex gap-2">
            <button type="button" disabled={page <= 1} onClick={() => setPage((value) => value - 1)} className="h-9 rounded-md border border-border px-3 disabled:opacity-40">
              Previous
            </button>
            <span className="self-center">{page} / {pages}</span>
            <button type="button" disabled={page >= pages} onClick={() => setPage((value) => value + 1)} className="h-9 rounded-md border border-border px-3 disabled:opacity-40">
              Next
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
