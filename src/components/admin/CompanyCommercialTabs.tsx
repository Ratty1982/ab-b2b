import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { StatusBadge } from "@/components/ab/Badges";
import { inputClass } from "@/components/ab/Drawer";
import { customerOrderStatusLabel, customerOrderStatusTone } from "@/domain/order-status";
import { formatDate } from "@/lib/datetime";
import { listAdminOrdersFn, listCompanyInvoicesFn, listStaffQuotesFn } from "@/server/phase2/fns";

function gbp(value: string, currency = "GBP") {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return value;
  return new Intl.NumberFormat("en-GB", { style: "currency", currency }).format(amount);
}

function SearchForm({
  label,
  value,
  onChange,
  onSubmit,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
}) {
  return (
    <form
      className="flex flex-wrap items-end gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <label className="grid gap-1 text-[12px] font-semibold text-steel">
        {label}
        <input value={value} onChange={(event) => onChange(event.target.value)} className={inputClass} />
      </label>
      <button type="submit" className="h-10 rounded-md border border-border px-3 text-[12px] font-semibold">
        Search
      </button>
    </form>
  );
}

function PanelMessage({ children }: { children: string }) {
  return <p className="text-sm text-steel">{children}</p>;
}

export function CompanyOrdersPanel({ companyId }: { companyId: string }) {
  const [draft, setDraft] = useState("");
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [total, setTotal] = useState(0);
  const [rows, setRows] = useState<
    Array<{
      id: string;
      orderNumber: string;
      status: string;
      placedAt: string | null;
      poNumber: string | null;
      grandTotal: string;
      currency: string;
      containsBackorder: boolean;
      fullyBackordered: boolean;
    }>
  >([]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void listAdminOrdersFn({
      data: { companyId, pageSize: 25, ...(q ? { q } : {}) },
    }).then((result) => {
      if (cancelled) return;
      setLoading(false);
      if (!result.ok) {
        setError(result.error);
        setRows([]);
        setTotal(0);
        return;
      }
      setError(null);
      setRows(result.data.items);
      setTotal(result.data.total);
    });
    return () => {
      cancelled = true;
    };
  }, [companyId, q]);

  return (
    <section className="grid gap-4">
      <div>
        <h2 className="font-display text-lg uppercase">Orders</h2>
        <p className="mt-1 text-[13px] text-steel">Placed orders for this company.</p>
      </div>
      <SearchForm label="Order, PO or account" value={draft} onChange={setDraft} onSubmit={() => setQ(draft.trim())} />
      {loading ? <PanelMessage>Loading orders…</PanelMessage> : null}
      {error ? <p className="text-sm text-bad">{error}</p> : null}
      {!loading && !error && rows.length === 0 ? <PanelMessage>No orders for this company.</PanelMessage> : null}
      {rows.length > 0 ? (
        <div className="overflow-x-auto border border-border">
          <table className="w-full min-w-[40rem] text-left text-[13px]">
            <thead className="border-b border-border bg-surface/40 text-[11px] uppercase tracking-wide text-steel">
              <tr>
                <th className="px-3 py-2 font-semibold">Order</th>
                <th className="px-3 py-2 font-semibold">Placed</th>
                <th className="px-3 py-2 font-semibold">PO</th>
                <th className="px-3 py-2 font-semibold">Status</th>
                <th className="px-3 py-2 text-right font-semibold">Total</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((order) => (
                <tr key={order.id} className="border-b border-border/70">
                  <td className="px-3 py-2 font-medium">
                    <Link to="/admin/orders/$orderId" params={{ orderId: order.id }} className="text-primary hover:underline">
                      {order.orderNumber}
                    </Link>
                  </td>
                  <td className="px-3 py-2 text-steel">{order.placedAt ? formatDate(order.placedAt) : "—"}</td>
                  <td className="px-3 py-2 text-steel">{order.poNumber || "—"}</td>
                  <td className="px-3 py-2">
                    <StatusBadge
                      tone={customerOrderStatusTone(order.status, { hasBackorderItems: order.containsBackorder })}
                    >
                      {customerOrderStatusLabel(order.status, {
                        hasBackorderItems: order.containsBackorder,
                        fullyBackordered: order.fullyBackordered,
                      })}
                    </StatusBadge>
                  </td>
                  <td className="px-3 py-2 text-right">{gbp(order.grandTotal, order.currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {!loading && total > rows.length ? (
        <p className="text-[12px] text-steel">Showing {rows.length} of {total} orders.</p>
      ) : null}
    </section>
  );
}

export function CompanyQuotesPanel({ companyId }: { companyId: string }) {
  const [draft, setDraft] = useState("");
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [total, setTotal] = useState(0);
  const [rows, setRows] = useState<
    Array<{
      id: string;
      quoteNumber: string;
      statusLabel: string;
      grandTotal: string;
      currency: string;
      validUntil: string | null;
      poNumber: string | null;
    }>
  >([]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void listStaffQuotesFn({
      data: { companyId, page: 1, pageSize: 25, ...(q ? { q } : {}) },
    }).then((result) => {
      if (cancelled) return;
      setLoading(false);
      if (!result.ok) {
        setError(result.error);
        setRows([]);
        setTotal(0);
        return;
      }
      setError(null);
      setRows(
        result.data.items.map((item) => ({
          id: item.id,
          quoteNumber: item.quoteNumber,
          statusLabel: item.statusLabel,
          grandTotal: item.grandTotal,
          currency: item.currency,
          validUntil: item.validUntil,
          poNumber: item.poNumber,
        })),
      );
      setTotal(result.data.total);
    });
    return () => {
      cancelled = true;
    };
  }, [companyId, q]);

  return (
    <section className="grid gap-4">
      <div>
        <h2 className="font-display text-lg uppercase">Quotations</h2>
        <p className="mt-1 text-[13px] text-steel">Quotations prepared for this company.</p>
      </div>
      <SearchForm label="Quote number or PO" value={draft} onChange={setDraft} onSubmit={() => setQ(draft.trim())} />
      {loading ? <PanelMessage>Loading quotations…</PanelMessage> : null}
      {error ? <p className="text-sm text-bad">{error}</p> : null}
      {!loading && !error && rows.length === 0 ? <PanelMessage>No quotations for this company.</PanelMessage> : null}
      {rows.length > 0 ? (
        <div className="overflow-x-auto border border-border">
          <table className="w-full min-w-[40rem] text-left text-[13px]">
            <thead className="border-b border-border bg-surface/40 text-[11px] uppercase tracking-wide text-steel">
              <tr>
                <th className="px-3 py-2 font-semibold">Quote</th>
                <th className="px-3 py-2 font-semibold">Valid until</th>
                <th className="px-3 py-2 font-semibold">PO</th>
                <th className="px-3 py-2 font-semibold">Status</th>
                <th className="px-3 py-2 text-right font-semibold">Total</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((quote) => (
                <tr key={quote.id} className="border-b border-border/70">
                  <td className="px-3 py-2 font-medium">
                    <Link to="/sales/quotes/$quoteId" params={{ quoteId: quote.id }} className="text-primary hover:underline">
                      {quote.quoteNumber}
                    </Link>
                  </td>
                  <td className="px-3 py-2 text-steel">{quote.validUntil ? formatDate(quote.validUntil) : "—"}</td>
                  <td className="px-3 py-2 text-steel">{quote.poNumber || "—"}</td>
                  <td className="px-3 py-2">{quote.statusLabel}</td>
                  <td className="px-3 py-2 text-right">{gbp(quote.grandTotal, quote.currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {!loading && total > rows.length ? (
        <p className="text-[12px] text-steel">Showing {rows.length} of {total} quotations.</p>
      ) : null}
    </section>
  );
}

export function CompanyInvoicesPanel({ companyId }: { companyId: string }) {
  const [draft, setDraft] = useState("");
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [total, setTotal] = useState(0);
  const [rows, setRows] = useState<
    Array<{
      id: string;
      invoiceNumber: string;
      statusLabel: string;
      kindLabel: string;
      issuedAt: string | null;
      dueAt: string | null;
      grandTotal: string;
      currency: string;
      accountsReference: string | null;
      orderId: string | null;
      orderNumber: string | null;
    }>
  >([]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void listCompanyInvoicesFn({
      data: { companyId, ...(q ? { q } : {}) },
    }).then((result) => {
      if (cancelled) return;
      setLoading(false);
      if (!result.ok) {
        setError(result.error);
        setRows([]);
        setTotal(0);
        return;
      }
      setError(null);
      setRows(result.data.items);
      setTotal(result.data.total);
    });
    return () => {
      cancelled = true;
    };
  }, [companyId, q]);

  return (
    <section className="grid gap-4">
      <div>
        <h2 className="font-display text-lg uppercase">Invoices</h2>
        <p className="mt-1 max-w-2xl text-[13px] text-steel">
          Invoices recorded for this company. This list is not an account statement and does not show a balance.
        </p>
      </div>
      <SearchForm label="Invoice, order or reference" value={draft} onChange={setDraft} onSubmit={() => setQ(draft.trim())} />
      {loading ? <PanelMessage>Loading invoices…</PanelMessage> : null}
      {error ? <p className="text-sm text-bad">{error}</p> : null}
      {!loading && !error && rows.length === 0 ? <PanelMessage>No invoices recorded for this company.</PanelMessage> : null}
      {rows.length > 0 ? (
        <div className="overflow-x-auto border border-border">
          <table className="w-full min-w-[44rem] text-left text-[13px]">
            <thead className="border-b border-border bg-surface/40 text-[11px] uppercase tracking-wide text-steel">
              <tr>
                <th className="px-3 py-2 font-semibold">Invoice</th>
                <th className="px-3 py-2 font-semibold">Type</th>
                <th className="px-3 py-2 font-semibold">Issued</th>
                <th className="px-3 py-2 font-semibold">Due</th>
                <th className="px-3 py-2 font-semibold">Order</th>
                <th className="px-3 py-2 font-semibold">Status</th>
                <th className="px-3 py-2 text-right font-semibold">Total</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((invoice) => (
                <tr key={invoice.id} className="border-b border-border/70">
                  <td className="px-3 py-2 font-medium">
                    {invoice.invoiceNumber}
                    {invoice.accountsReference ? (
                      <div className="text-[11px] text-steel">Ref {invoice.accountsReference}</div>
                    ) : null}
                  </td>
                  <td className="px-3 py-2">{invoice.kindLabel}</td>
                  <td className="px-3 py-2 text-steel">{invoice.issuedAt ? formatDate(invoice.issuedAt) : "—"}</td>
                  <td className="px-3 py-2 text-steel">{invoice.dueAt ? formatDate(invoice.dueAt) : "—"}</td>
                  <td className="px-3 py-2">
                    {invoice.orderId && invoice.orderNumber ? (
                      <Link
                        to="/admin/orders/$orderId"
                        params={{ orderId: invoice.orderId }}
                        className="text-primary hover:underline"
                      >
                        {invoice.orderNumber}
                      </Link>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="px-3 py-2">{invoice.statusLabel}</td>
                  <td className="px-3 py-2 text-right">{gbp(invoice.grandTotal, invoice.currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {!loading && total > rows.length ? (
        <p className="text-[12px] text-steel">Showing the latest {rows.length} of {total} invoices.</p>
      ) : null}
    </section>
  );
}
