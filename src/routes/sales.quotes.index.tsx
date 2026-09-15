import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { PanelHeader, Metric } from "@/components/ab/AppShell";
import { StatusBadge } from "@/components/ab/Badges";
import { gbp, gbp0 } from "@/lib/data";
import { quotes, quoteTotal } from "@/lib/crm-data";

export const Route = createFileRoute("/sales/quotes/")({
  head: () => ({
    meta: [
      { title: "Quotes — Sales Portal — Automotive Brands" },
      {
        name: "description",
        content:
          "Every trade quote in one place: drafts, sent, viewed, accepted, rejected and expired, with follow-up actions.",
      },
      { property: "og:title", content: "Quotes — Sales Portal" },
      { property: "og:description", content: "Trade quote workflow from draft to accepted order." },
    ],
  }),
  component: QuotesList,
});

const filters = ["All", "Draft", "Sent", "Viewed", "Accepted", "Rejected", "Expired"] as const;

export function quoteTone(status: string) {
  if (status === "Accepted") return "good" as const;
  if (status === "Rejected" || status === "Expired") return "bad" as const;
  if (status === "Draft") return "neutral" as const;
  return "brand" as const;
}

function QuotesList() {
  const [filter, setFilter] = useState<(typeof filters)[number]>("All");
  const rows = quotes.filter((q) => filter === "All" || q.status === filter);
  const open = quotes.filter((q) => ["Sent", "Viewed"].includes(q.status));
  const accepted = quotes.filter((q) => q.status === "Accepted");

  return (
    <div>
      <PanelHeader
        title="Quotes"
        sub="Draft, send, chase and convert trade quotes"
        actions={
          <Link
            to="/sales/quotes/new"
            search={{ customer: "abc-motor-factors" }}
            className="inline-flex h-10 items-center rounded-md bg-primary px-5 text-[13px] font-bold uppercase tracking-wide text-primary-foreground transition hover:brightness-110"
          >
            Create quote
          </Link>
        }
      />

      <div className="grid gap-px bg-border sm:grid-cols-2 lg:grid-cols-4">
        <Metric label="Open quote value" value={gbp0(open.reduce((s, q) => s + quoteTotal(q), 0))} tone="brand" hint={`${open.length} awaiting decision`} />
        <Metric label="Accepted this month" value={gbp0(accepted.reduce((s, q) => s + quoteTotal(q), 0))} tone="good" hint={`${accepted.length} converted to orders`} />
        <Metric label="Conversion rate" value="41%" hint="Rolling 90 days" />
        <Metric label="Expiring within 7 days" value="2" tone="warn" hint="Chase before they lapse" />
      </div>

      <div className="flex flex-wrap gap-2 border-b border-border/70 px-4 py-3 sm:px-6">
        {filters.map((f) => (
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
            {f}
          </button>
        ))}
      </div>

      <div className="p-4 sm:p-6">
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[900px] text-[13px]">
            <thead>
              <tr className="border-b border-border bg-surface/60 text-left text-[10px] uppercase tracking-[0.12em] text-steel">
                <th className="px-3 py-2 font-semibold">Quote</th>
                <th className="px-3 py-2 font-semibold">Company</th>
                <th className="px-3 py-2 font-semibold">Contact</th>
                <th className="px-3 py-2 font-semibold">Owner</th>
                <th className="px-3 py-2 font-semibold">Created</th>
                <th className="px-3 py-2 font-semibold">Expires</th>
                <th className="px-3 py-2 font-semibold">Status</th>
                <th className="px-3 py-2 text-right font-semibold">Value</th>
                <th className="px-3 py-2 text-right font-semibold">Action</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((q, i) => (
                <tr key={q.id} className={`border-b border-border/60 last:border-0 ${i % 2 ? "bg-surface/30" : ""}`}>
                  <td className="num px-3 py-2.5 font-medium text-primary">
                    <Link to="/quote/$id" params={{ id: q.id }}>
                      {q.id}
                    </Link>
                  </td>
                  <td className="px-3 py-2.5 font-medium">{q.company}</td>
                  <td className="px-3 py-2.5 text-steel">{q.contact}</td>
                  <td className="px-3 py-2.5 text-steel">{q.owner}</td>
                  <td className="px-3 py-2.5 text-steel">{q.created}</td>
                  <td className="px-3 py-2.5 text-steel">{q.expires}</td>
                  <td className="px-3 py-2.5">
                    <StatusBadge tone={quoteTone(q.status)}>{q.status}</StatusBadge>
                  </td>
                  <td className="num px-3 py-2.5 text-right font-semibold">{gbp(quoteTotal(q))}</td>
                  <td className="px-3 py-2.5 text-right">
                    <Link
                      to="/quote/$id"
                      params={{ id: q.id }}
                      className="text-[12px] font-semibold text-primary hover:underline"
                    >
                      {q.status === "Accepted" ? "View order" : q.status === "Draft" ? "Continue" : "Chase"}
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {rows.length === 0 ? (
          <p className="mt-4 rounded-lg border border-dashed border-border p-10 text-center text-[13px] text-steel">
            No quotes with this status.
          </p>
        ) : null}
      </div>
    </div>
  );
}
