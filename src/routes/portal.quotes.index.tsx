import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { PanelHeader } from "@/components/ab/AppShell";
import { StatusBadge } from "@/components/ab/Badges";
import { ROUTES } from "@/lib/app-nav";
import { formatDate } from "@/lib/datetime";
import { formatQuoteDateOnlyUk } from "@/domain/quote";
import { listPortalQuotesFn } from "@/server/phase2/fns";

export const Route = createFileRoute("/portal/quotes/")({
  head: () => ({
    meta: [{ title: "Quotes — Automotive Brands Trade Portal" }],
  }),
  component: PortalQuotesList,
});

type Row = Extract<Awaited<ReturnType<typeof listPortalQuotesFn>>, { ok: true }>["data"][number];

function quoteTone(status: string) {
  if (status === "CONVERTED" || status === "ACCEPTED") return "good" as const;
  if (status === "DECLINED" || status === "REJECTED" || status === "EXPIRED") return "bad" as const;
  return "brand" as const;
}

function PortalQuotesList() {
  const [rows, setRows] = useState<Row[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const result = await listPortalQuotesFn();
    setLoading(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setError(null);
    setRows(result.data);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div>
      <PanelHeader title="Quotes" sub="Quotations prepared for your trade account" />
      <div className="p-4 sm:p-6">
        {error ? <p className="mb-4 text-sm text-bad">{error}</p> : null}
        {loading ? <p className="text-[13px] text-steel">Loading quotes…</p> : null}
        {!loading && rows.length === 0 ? (
          <p className="text-[13px] text-steel">
            You have no quotations yet. Your account manager will send quotes here when ready.
          </p>
        ) : null}
        {rows.length > 0 ? (
          <>
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full text-left text-[13px]">
                <thead>
                  <tr className="border-b border-border text-[11px] uppercase tracking-wide text-steel">
                    <th className="py-2 pr-3 font-semibold">Quote</th>
                    <th className="py-2 pr-3 font-semibold">Date</th>
                    <th className="py-2 pr-3 font-semibold">Valid until</th>
                    <th className="py-2 pr-3 font-semibold">Status</th>
                    <th className="py-2 pr-3 font-semibold text-right">Total</th>
                    <th className="py-2 font-semibold">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.id} className="border-b border-border/60">
                      <td className="py-3 pr-3 font-semibold">{row.quoteNumber}</td>
                      <td className="py-3 pr-3 text-steel">
                        {formatDate(row.sentAt ?? row.createdAt) ?? "—"}
                      </td>
                      <td className="py-3 pr-3">{formatQuoteDateOnlyUk(row.validUntil)}</td>
                      <td className="py-3 pr-3">
                        <StatusBadge tone={quoteTone(row.status)}>{row.statusLabel}</StatusBadge>
                      </td>
                      <td className="py-3 pr-3 text-right font-semibold">£{row.grandTotal}</td>
                      <td className="py-3">
                        <Link
                          to="/portal/quotes/$quoteId"
                          params={{ quoteId: row.id }}
                          className="font-semibold text-primary hover:underline"
                        >
                          View
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <ul className="space-y-3 md:hidden">
              {rows.map((row) => (
                <li key={row.id} className="rounded-lg border border-border p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="font-semibold">{row.quoteNumber}</div>
                      <div className="mt-1 text-[12px] text-steel">
                        Valid until {formatQuoteDateOnlyUk(row.validUntil)}
                      </div>
                    </div>
                    <StatusBadge tone={quoteTone(row.status)}>{row.statusLabel}</StatusBadge>
                  </div>
                  <div className="mt-3 flex items-center justify-between">
                    <span className="font-semibold">£{row.grandTotal}</span>
                    <Link
                      to="/portal/quotes/$quoteId"
                      params={{ quoteId: row.id }}
                      className="text-[13px] font-semibold text-primary"
                    >
                      View quote
                    </Link>
                  </div>
                </li>
              ))}
            </ul>
          </>
        ) : null}
        <p className="mt-6 text-[12px] text-steel">
          <Link to={ROUTES.portal} className="font-semibold text-primary">
            Back to portal
          </Link>
        </p>
      </div>
    </div>
  );
}
