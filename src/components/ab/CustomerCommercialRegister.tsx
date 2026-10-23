import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { StatusBadge } from "@/components/ab/Badges";
import { inputClass } from "@/components/ab/Drawer";
import { customerOrderStatusLabel } from "@/domain/order-status";
import { formatDate } from "@/lib/datetime";
import {
  listCompanyDocumentsFn,
  listCompanyInvoicesFn,
  listCompanyOrdersFn,
  listCompanyQuotesFn,
} from "@/server/workspace/fns";

type Tab = "Documents" | "Orders" | "Quotes" | "Invoices";

export function CustomerCommercialRegister({ companyId, tab }: { companyId: string; tab: Tab }) {
  const [page, setPage] = useState(1);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("ALL");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [total, setTotal] = useState(0);
  // Rows come from four different list shapes. Each table reads the fields it renders.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [rows, setRows] = useState<any[]>([]);

  useEffect(() => {
    setPage(1);
    setQ("");
    setStatus("ALL");
    setFrom("");
    setTo("");
  }, [tab, companyId]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const payload = {
      companyId,
      page,
      pageSize: 25,
      q: q || undefined,
      status: status === "ALL" ? undefined : status,
      from: from ? new Date(`${from}T00:00:00.000Z`).toISOString() : undefined,
      to: to ? new Date(`${to}T23:59:59.999Z`).toISOString() : undefined,
    };
    const request =
      tab === "Orders"
        ? listCompanyOrdersFn({ data: payload })
        : tab === "Quotes"
          ? listCompanyQuotesFn({ data: payload })
          : tab === "Invoices"
            ? listCompanyInvoicesFn({ data: payload })
            : listCompanyDocumentsFn({ data: payload });
    void request.then((result) => {
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
  }, [companyId, tab, page, q, status, from, to]);

  const pages = Math.max(1, Math.ceil(total / 25));

  return (
    <div className="grid gap-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        <input
          value={q}
          onChange={(event) => {
            setPage(1);
            setQ(event.target.value);
          }}
          placeholder="Search reference"
          className={inputClass}
          aria-label={`Search ${tab}`}
        />
        {tab === "Orders" || tab === "Quotes" ? (
          <select
            value={status}
            onChange={(event) => {
              setPage(1);
              setStatus(event.target.value);
            }}
            className={inputClass}
            aria-label={`${tab} status`}
          >
            <option value="ALL">All statuses</option>
            {tab === "Orders"
              ? ["SUBMITTED", "CONFIRMED", "PICKING", "PARTIALLY_DESPATCHED", "DISPATCHED", "DELIVERED", "ON_HOLD", "CANCELLED", "ADMINISTRATIVELY_CLOSED"].map(
                  (value) => (
                    <option key={value} value={value}>
                      {customerOrderStatusLabel(value)}
                    </option>
                  ),
                )
              : ["DRAFT", "SENT", "VIEWED", "ACCEPTED", "DECLINED", "EXPIRED", "CONVERTED", "CANCELLED"].map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
          </select>
        ) : null}
        <input
          type="date"
          value={from}
          onChange={(event) => {
            setPage(1);
            setFrom(event.target.value);
          }}
          className={inputClass}
          aria-label="From date"
        />
        <input
          type="date"
          value={to}
          onChange={(event) => {
            setPage(1);
            setTo(event.target.value);
          }}
          className={inputClass}
          aria-label="To date"
        />
      </div>
      {tab === "Documents" ? (
        <p className="text-[13px] text-steel">
          This register lists quotes, orders, invoices, and files already stored for this customer.
          Uploading a new customer file from here is a follow-up. A row without a file offers View
          record rather than a download.
        </p>
      ) : null}
      {tab === "Invoices" ? (
        <p className="text-[13px] text-steel">
          B2B invoices and imported Autopart invoices or credits for this customer are listed
          separately. The same document is shown once. Historical Autopart invoices appear only
          after that customer&apos;s sales are imported again. No PDF is offered unless a real file
          exists.
        </p>
      ) : null}
      {error ? <p className="text-sm text-bad">{error}</p> : null}
      {loading ? <p className="text-sm text-steel">Loading {tab.toLowerCase()}…</p> : null}
      {!loading && !error && rows.length === 0 ? (
        <p className="rounded-md border border-dashed border-border px-6 py-10 text-center text-sm text-steel">
          No {tab.toLowerCase()} for this customer.
        </p>
      ) : null}
      {!loading && rows.length > 0 ? (
        <div className="overflow-x-auto border border-border">
          {tab === "Orders" ? <OrderRows rows={rows} /> : null}
          {tab === "Quotes" ? <QuoteRows rows={rows} /> : null}
          {tab === "Invoices" ? <InvoiceRows rows={rows} portal={false} /> : null}
          {tab === "Documents" ? <DocumentRows rows={rows} /> : null}
        </div>
      ) : null}
      <div className="flex items-center justify-between text-[12px] text-steel">
        <span>
          {total} record{total === 1 ? "" : "s"}
        </span>
        <div className="flex gap-2">
          <button type="button" disabled={page <= 1} onClick={() => setPage((value) => value - 1)} className="h-9 rounded-md border border-border px-3 disabled:opacity-40">
            Previous
          </button>
          <span className="self-center">
            {page} / {pages}
          </span>
          <button type="button" disabled={page >= pages} onClick={() => setPage((value) => value + 1)} className="h-9 rounded-md border border-border px-3 disabled:opacity-40">
            Next
          </button>
        </div>
      </div>
    </div>
  );
}

function OrderRows({ rows }: { rows: Array<{ id: string; orderNumber: string; placedAt: string | null; source: string; status: string; manualResolutionKind: string; invoiceEvidence: string; grandTotal: string; lineCount: number; exportStatus: string; externalRef: string | null; outstandingQty: number; invoiceCount: number }> }) {
  return (
    <table className="min-w-full text-left text-[13px]">
      <thead className="bg-surface/60 text-[11px] uppercase text-steel">
        <tr>
          {["Order", "Date", "Source", "Status", "Value", "Lines", "Export", "Outstanding", ""].map((heading) => (
            <th key={heading} className="px-3 py-2 font-semibold">{heading}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={String(row.id)} className="border-t border-border/70">
            <td className="px-3 py-2 font-semibold">{String(row.orderNumber)}</td>
            <td className="px-3 py-2">{row.placedAt ? formatDate(String(row.placedAt)) : "—"}</td>
            <td className="px-3 py-2">{String(row.source)}</td>
            <td className="px-3 py-2">
              <StatusBadge>{customerOrderStatusLabel(String(row.status))}</StatusBadge>
              {row.manualResolutionKind === "FULFILLED_MANUALLY" ? (
                <div className="mt-1 text-[11px] text-steel">Fulfilled manually. Invoice evidence {String(row.invoiceEvidence).toLowerCase().replaceAll("_", " ")}.</div>
              ) : null}
              {row.manualResolutionKind === "CLOSED_ADMINISTRATIVELY" ? (
                <div className="mt-1 text-[11px] text-steel">Closed administratively. Goods were not marked despatched.</div>
              ) : null}
            </td>
            <td className="px-3 py-2">£{String(row.grandTotal)}</td>
            <td className="px-3 py-2">{String(row.lineCount)}</td>
            <td className="px-3 py-2">
              {String(row.exportStatus)}
              {row.externalRef ? <div className="text-[11px] text-steel">{String(row.externalRef)}</div> : null}
            </td>
            <td className="px-3 py-2">
              {row.manualResolutionKind === "CLOSED_ADMINISTRATIVELY" ? "—" : String(row.outstandingQty)}
            </td>
            <td className="px-3 py-2">
              <Link to="/admin/orders/$orderId" params={{ orderId: String(row.id) }} className="font-semibold text-primary hover:underline">
                View order
              </Link>
              {Number(row.invoiceCount) > 0 ? (
                <div className="text-[11px] text-steel">{String(row.invoiceCount)} linked invoice{Number(row.invoiceCount) === 1 ? "" : "s"}</div>
              ) : (
                <div className="text-[11px] text-steel">No linked invoice</div>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function QuoteRows({ rows }: { rows: Array<{ id: string; quoteNumber: string; createdAt: string; expiresAt: string | null; status: string; grandTotal: string; createdBy: string; orderId: string | null; orderNumber: string | null }> }) {
  return (
    <table className="min-w-full text-left text-[13px]">
      <thead className="bg-surface/60 text-[11px] uppercase text-steel">
        <tr>
          {["Quote", "Date", "Expiry", "Status", "Total", "Created by", "Order"].map((heading) => (
            <th key={heading} className="px-3 py-2 font-semibold">{heading}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={String(row.id)} className="border-t border-border/70">
            <td className="px-3 py-2">
              <Link to="/sales/quotes/$quoteId" params={{ quoteId: String(row.id) }} className="font-semibold text-primary hover:underline">
                {String(row.quoteNumber)}
              </Link>
            </td>
            <td className="px-3 py-2">{formatDate(String(row.createdAt))}</td>
            <td className="px-3 py-2">{row.expiresAt ? formatDate(String(row.expiresAt)) : "—"}</td>
            <td className="px-3 py-2">{String(row.status)}</td>
            <td className="px-3 py-2">£{String(row.grandTotal)}</td>
            <td className="px-3 py-2">{String(row.createdBy)}</td>
            <td className="px-3 py-2">
              {row.orderId ? (
                <Link to="/admin/orders/$orderId" params={{ orderId: String(row.orderId) }} className="text-primary hover:underline">
                  {String(row.orderNumber ?? "View order")}
                </Link>
              ) : (
                "—"
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function InvoiceRows({
  rows,
  portal,
}: {
  rows: Array<{
    id: string;
    origin: string;
    number: string;
    issuedAt: string | null;
    documentType: string;
    value: string | null;
    orderId: string | null;
    orderNumber: string | null;
    status: string | null;
  }>;
  portal: boolean;
}) {
  return (
    <table className="min-w-full text-left text-[13px]">
      <thead className="bg-surface/60 text-[11px] uppercase text-steel">
        <tr>
          {["Number", "Date", "Type", "Origin", "Value", "Order", "Status", ""].map((heading) => (
            <th key={heading} className="px-3 py-2 font-semibold">{heading}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={`${String(row.origin)}-${String(row.id)}`} className="border-t border-border/70">
            <td className="px-3 py-2 font-semibold">{String(row.number)}</td>
            <td className="px-3 py-2">{row.issuedAt ? formatDate(String(row.issuedAt)) : "—"}</td>
            <td className="px-3 py-2">{String(row.documentType)}</td>
            <td className="px-3 py-2">{String(row.origin)}</td>
            <td className="px-3 py-2">{row.value ? `£${String(row.value)}` : "—"}</td>
            <td className="px-3 py-2">
              {row.orderId ? (
                <Link
                  to={portal ? "/portal/orders/$orderId" : "/admin/orders/$orderId"}
                  params={{ orderId: String(row.orderId) }}
                  className="text-primary hover:underline"
                >
                  {String(row.orderNumber ?? "View order")}
                </Link>
              ) : (
                "—"
              )}
            </td>
            <td className="px-3 py-2">{row.status ? String(row.status) : "—"}</td>
            <td className="px-3 py-2 text-steel">View record</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function DocumentRows({ rows }: { rows: Array<{ id: string; recordKind: string; source: string; title: string; at: string | null }> }) {
  return (
    <table className="min-w-full text-left text-[13px]">
      <thead className="bg-surface/60 text-[11px] uppercase text-steel">
        <tr>
          {["Type", "Reference", "Date", "Source", ""].map((heading) => (
            <th key={heading} className="px-3 py-2 font-semibold">{heading}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={`${String(row.recordKind)}-${String(row.id)}`} className="border-t border-border/70">
            <td className="px-3 py-2">{String(row.source)}</td>
            <td className="px-3 py-2 font-semibold">{String(row.title)}</td>
            <td className="px-3 py-2">{row.at ? formatDate(String(row.at)) : "—"}</td>
            <td className="px-3 py-2">{String(row.source)}</td>
            <td className="px-3 py-2">
              {row.recordKind === "QUOTE" ? (
                <Link to="/sales/quotes/$quoteId" params={{ quoteId: String(row.id) }} className="font-semibold text-primary hover:underline">
                  View record
                </Link>
              ) : row.recordKind === "ORDER" ? (
                <Link to="/admin/orders/$orderId" params={{ orderId: String(row.id) }} className="font-semibold text-primary hover:underline">
                  View record
                </Link>
              ) : (
                <span className="text-steel">View record</span>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
