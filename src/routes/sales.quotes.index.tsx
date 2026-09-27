import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { PanelHeader } from "@/components/ab/AppShell";
import { StatusBadge } from "@/components/ab/Badges";
import { inputClass } from "@/components/ab/Drawer";
import { ROUTES } from "@/lib/app-nav";
import { formatDate } from "@/lib/datetime";
import { formatQuoteDateOnlyUk, QUOTE_STATUS_LABEL, type QuoteStatusKey } from "@/domain/quote";
import { listStaffQuotesFn } from "@/server/phase2/fns";

export const Route = createFileRoute("/sales/quotes/")({
  head: () => ({
    meta: [
      { title: "Quotes — Sales Portal — Automotive Brands" },
      {
        name: "description",
        content:
          "Every trade quote in one place: drafts, sent, viewed, accepted, declined, expired and converted.",
      },
    ],
  }),
  component: QuotesList,
});

const FILTERS = [
  "ALL",
  "DRAFT",
  "SENT",
  "VIEWED",
  "ACCEPTED",
  "DECLINED",
  "EXPIRED",
  "CONVERTED",
] as const;

type Row = Extract<Awaited<ReturnType<typeof listStaffQuotesFn>>, { ok: true }>["data"]["items"][number];

function quoteTone(status: string) {
  if (status === "CONVERTED" || status === "ACCEPTED") return "good" as const;
  if (status === "DECLINED" || status === "REJECTED" || status === "EXPIRED" || status === "CANCELLED")
    return "bad" as const;
  if (status === "DRAFT") return "neutral" as const;
  return "brand" as const;
}

function QuotesList() {
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("ALL");
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const result = await listStaffQuotesFn({
      data: {
        page: 1,
        pageSize: 50,
        q: q.trim() || undefined,
        status: filter === "ALL" ? undefined : filter,
      },
    });
    setLoading(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setError(null);
    setRows(result.data.items);
    setTotal(result.data.total);
  }, [filter, q]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div>
      <PanelHeader
        title="Quotes"
        sub="Draft, send and convert trade quotations"
        actions={
          <Link
            to={ROUTES.salesQuotesNew}
            className="inline-flex h-10 items-center rounded-md bg-primary px-5 text-[13px] font-bold uppercase tracking-wide text-primary-foreground transition hover:brightness-110"
          >
            New quote
          </Link>
        }
      />

      <div className="flex flex-wrap items-center gap-2 border-b border-border/70 px-4 py-3 sm:px-6">
        {FILTERS.map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setFilter(f)}
            aria-pressed={filter === f}
            className={`h-8 rounded-md border px-3 text-[12px] font-semibold transition-colors ${
              filter === f
                ? "border-primary bg-primary/10 text-primary"
                : "border-border text-steel hover:text-foreground"
            }`}
          >
            {f === "ALL" ? "All" : QUOTE_STATUS_LABEL[f as QuoteStatusKey] ?? f}
          </button>
        ))}
        <input
          className={`${inputClass} ml-auto max-w-xs`}
          placeholder="Search quote no, company, PO…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>

      <div className="p-4 sm:p-6">
        {error ? <p className="mb-4 text-sm text-bad">{error}</p> : null}
        {loading ? <p className="text-[13px] text-steel">Loading quotes…</p> : null}
        {!loading && rows.length === 0 ? (
          <p className="text-[13px] text-steel">No quotations match this filter.</p>
        ) : null}
        {rows.length > 0 ? (
          <>
            <p className="mb-3 text-[12px] text-steel">{total} quotation{total === 1 ? "" : "s"}</p>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-left text-[13px]">
                <thead>
                  <tr className="border-b border-border text-[11px] uppercase tracking-wide text-steel">
                    <th className="py-2 pr-3 font-semibold">Quote</th>
                    <th className="py-2 pr-3 font-semibold">Date</th>
                    <th className="py-2 pr-3 font-semibold">Company</th>
                    <th className="py-2 pr-3 font-semibold">Sales Rep</th>
                    <th className="py-2 pr-3 font-semibold">Status</th>
                    <th className="py-2 pr-3 font-semibold">Valid until</th>
                    <th className="py-2 pr-3 font-semibold text-right">Net</th>
                    <th className="py-2 pr-3 font-semibold text-right">VAT</th>
                    <th className="py-2 pr-3 font-semibold text-right">Total</th>
                    <th className="py-2 font-semibold">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.id} className="border-b border-border/60">
                      <td className="py-3 pr-3 font-semibold">{row.quoteNumber}</td>
                      <td className="py-3 pr-3 text-steel">{formatDate(row.createdAt) ?? "—"}</td>
                      <td className="py-3 pr-3">{row.company?.name ?? "—"}</td>
                      <td className="py-3 pr-3 text-steel">{row.salesRepName ?? "—"}</td>
                      <td className="py-3 pr-3">
                        <StatusBadge tone={quoteTone(row.status)}>{row.statusLabel}</StatusBadge>
                      </td>
                      <td className="py-3 pr-3 text-steel">
                        {formatQuoteDateOnlyUk(row.validUntil)}
                      </td>
                      <td className="py-3 pr-3 text-right">£{row.subtotal}</td>
                      <td className="py-3 pr-3 text-right">£{row.vatTotal}</td>
                      <td className="py-3 pr-3 text-right font-semibold">£{row.grandTotal}</td>
                      <td className="py-3">
                        <Link
                          to="/sales/quotes/$quoteId"
                          params={{ quoteId: row.id }}
                          className="font-semibold text-primary hover:underline"
                        >
                          Open
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}
