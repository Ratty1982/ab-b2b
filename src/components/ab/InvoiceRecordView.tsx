import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { PanelHeader } from "@/components/ab/AppShell";
import { formatDate } from "@/lib/datetime";
import { getInvoiceRecordFn } from "@/server/workspace/fns";

type InvoiceRecord = {
  origin: "B2B" | "AUTOPART";
  number: string;
  companyId: string;
  companyName: string;
  status: string | null;
  statusLabel: string;
  documentType?: string;
  issuedAt: string | null;
  dueAt: string | null;
  currency: string;
  subtotal: string | null;
  vatTotal: string | null;
  grandTotal: string | null;
  orderId: string | null;
  orderNumber: string | null;
  externalRef: string | null;
  source?: string;
  documentFileUrl: null;
  lineSource: string | null;
  lines: Array<{
    lineNumber: number;
    sku: string;
    description: string | null;
    units: string;
    salesNet: string;
  }>;
  missing: string[];
};

function money(value: string | null): string {
  if (value == null || value === "") return "Not stored";
  const amount = Number(value);
  return Number.isFinite(amount) ? `£${amount.toFixed(2)}` : value;
}

export function InvoiceRecordView({
  invoiceId,
  origin,
  portal,
}: {
  invoiceId: string;
  origin: "b2b" | "autopart";
  portal: boolean;
}) {
  const [record, setRecord] = useState<InvoiceRecord | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void getInvoiceRecordFn({
      data: { id: invoiceId, origin: origin === "autopart" ? "AUTOPART" : "B2B" },
    }).then((result) => {
      if (cancelled) return;
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setRecord(result.data);
    });
    return () => {
      cancelled = true;
    };
  }, [invoiceId, origin]);

  if (error) {
    return (
      <div>
        <PanelHeader title="Invoice" sub="Record" />
        <p className="p-6 text-sm text-bad">{error}</p>
      </div>
    );
  }
  if (!record) {
    return (
      <div>
        <PanelHeader title="Invoice" sub="Record" />
        <p className="p-6 text-[13px] text-steel">Loading…</p>
      </div>
    );
  }

  return (
    <div>
      <PanelHeader
        title={record.number}
        sub={record.companyName}
        actions={
          portal ? (
            <Link
              to="/portal/invoices"
              className="inline-flex h-9 items-center rounded-md border border-border px-3 text-[12px] font-semibold"
            >
              Back
            </Link>
          ) : (
            <Link
              to="/admin/customers/$id"
              params={{ id: record.companyId }}
              className="inline-flex h-9 items-center rounded-md border border-border px-3 text-[12px] font-semibold"
            >
              Back
            </Link>
          )
        }
      />
      <div className="space-y-6 p-4 sm:p-6">
        <section className="grid gap-3 text-[13px] sm:grid-cols-2">
          <p>Customer: {record.companyName}</p>
          <p>
            {record.statusLabel}: {record.status ?? "Not stored"}
          </p>
          <p>Issued: {record.issuedAt ? formatDate(record.issuedAt) : "Not stored"}</p>
          <p>Due: {record.dueAt ? formatDate(record.dueAt) : "Not stored"}</p>
          {record.documentType ? <p>Document type: {record.documentType}</p> : null}
          {record.source ? <p>Source: {record.source}</p> : null}
          {record.externalRef ? <p>External reference: {record.externalRef}</p> : null}
          <p>
            Order:{" "}
            {record.orderId ? (
              <Link
                to={portal ? "/portal/orders/$orderId" : "/admin/orders/$orderId"}
                params={{ orderId: record.orderId }}
                className="text-primary hover:underline"
              >
                {record.orderNumber ?? "View order"}
              </Link>
            ) : (
              "Not linked"
            )}
          </p>
        </section>

        <section className="grid gap-2 text-[13px] sm:grid-cols-3">
          <p>Net: {money(record.subtotal)}</p>
          <p>VAT: {money(record.vatTotal)}</p>
          <p className="font-semibold">Gross: {money(record.grandTotal)}</p>
          <p className="text-steel">Currency: {record.currency}</p>
        </section>

        <section>
          <h2 className="text-[12px] font-bold uppercase tracking-wide text-steel">Lines</h2>
          {record.lineSource ? <p className="mt-1 text-[12px] text-steel">{record.lineSource}</p> : null}
          {record.lines.length ? (
            <table className="mt-3 min-w-full text-left text-[13px]">
              <thead className="text-[11px] uppercase text-steel">
                <tr>
                  <th className="py-2 pr-3">SKU</th>
                  <th className="py-2 pr-3">Description</th>
                  <th className="py-2 pr-3">Units</th>
                  <th className="py-2">Net</th>
                </tr>
              </thead>
              <tbody>
                {record.lines.map((line) => (
                  <tr key={line.lineNumber} className="border-t border-border/70">
                    <td className="py-2 pr-3 font-mono">{line.sku}</td>
                    <td className="py-2 pr-3">{line.description ?? "Description not stored"}</td>
                    <td className="py-2 pr-3">{line.units}</td>
                    <td className="py-2">{money(line.salesNet)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="mt-2 text-[13px] text-steel">No line items are stored for this record.</p>
          )}
        </section>

        <section className="rounded-md border border-border bg-surface/50 p-4 text-[13px]">
          <h2 className="text-[12px] font-bold uppercase tracking-wide text-steel">Not stored</h2>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            {record.missing.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
          {record.documentFileUrl ? null : (
            <p className="mt-3 text-steel">There is no invoice file to download.</p>
          )}
        </section>
      </div>
    </div>
  );
}
