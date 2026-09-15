import { createFileRoute, Link } from "@tanstack/react-router";
import { PanelHeader } from "@/components/ab/AppShell";
import { StatusBadge } from "@/components/ab/Badges";
import { gbp } from "@/lib/data";
import { quotes, quoteTotal, type QuoteStatus } from "@/lib/crm-data";

export const Route = createFileRoute("/portal/quotes")({
  head: () => ({
    meta: [
      { title: "Quotes — Automotive Brands Trade Portal" },
      {
        name: "description",
        content: "View, accept and convert Automotive Brands trade quotes into orders.",
      },
      { property: "og:title", content: "Quotes — Automotive Brands Trade Portal" },
      { property: "og:description", content: "Trade quotes awaiting your decision." },
    ],
  }),
  component: PortalQuotes,
});

export function quoteTone(status: QuoteStatus) {
  switch (status) {
    case "Accepted":
      return "good" as const;
    case "Rejected":
    case "Expired":
      return "bad" as const;
    case "Draft":
      return "info" as const;
    default:
      return "brand" as const;
  }
}

function PortalQuotes() {
  const mine = quotes.filter((q) => q.customerId === "abc-motor-factors");

  return (
    <div>
      <PanelHeader
        title="Quotes"
        sub="Quotes prepared for ABC Motor Factors Ltd by your account manager"
        actions={
          <Link
            to="/portal/quick-order"
            className="inline-flex h-10 items-center rounded-md bg-primary px-5 text-[13px] font-bold uppercase tracking-wide text-primary-foreground transition hover:brightness-110"
          >
            Request a quote
          </Link>
        }
      />
      <div className="p-4 sm:p-6">
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[820px] text-[13px]">
            <thead>
              <tr className="border-b border-border bg-surface/60 text-left text-[10px] uppercase tracking-[0.12em] text-steel">
                <th className="px-3 py-2 font-semibold">Quote</th>
                <th className="px-3 py-2 font-semibold">Created</th>
                <th className="px-3 py-2 font-semibold">Expires</th>
                <th className="px-3 py-2 font-semibold">Prepared by</th>
                <th className="px-3 py-2 text-right font-semibold">Lines</th>
                <th className="px-3 py-2 font-semibold">Status</th>
                <th className="px-3 py-2 text-right font-semibold">Value</th>
                <th className="px-3 py-2 text-right font-semibold">Action</th>
              </tr>
            </thead>
            <tbody>
              {mine.map((q, i) => (
                <tr
                  key={q.id}
                  className={`border-b border-border/60 hover:bg-secondary/60 ${i % 2 ? "bg-surface/30" : ""}`}
                >
                  <td className="num px-3 py-2 font-medium text-primary">
                    <Link to="/quote/$id" params={{ id: q.id }}>
                      {q.id}
                    </Link>
                  </td>
                  <td className="px-3 py-2 text-steel">{q.created}</td>
                  <td className="px-3 py-2 text-steel">{q.expires}</td>
                  <td className="px-3 py-2 text-steel">{q.owner}</td>
                  <td className="num px-3 py-2 text-right">{q.lines.length}</td>
                  <td className="px-3 py-2">
                    <StatusBadge tone={quoteTone(q.status)}>{q.status}</StatusBadge>
                  </td>
                  <td className="num px-3 py-2 text-right font-semibold">{gbp(quoteTotal(q))}</td>
                  <td className="px-3 py-2 text-right">
                    <Link
                      to="/quote/$id"
                      params={{ id: q.id }}
                      className="text-[12px] font-semibold text-primary hover:underline"
                    >
                      {q.status === "Accepted" ? "View order" : "View quote"}
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
