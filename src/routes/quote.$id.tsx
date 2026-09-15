import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { useState } from "react";
import { Check, Download, Printer } from "lucide-react";
import { PublicLayout } from "@/components/ab/PublicLayout";
import { StatusBadge } from "@/components/ab/Badges";
import { gbp } from "@/lib/data";
import { quotes, quoteTotal } from "@/lib/crm-data";

export const Route = createFileRoute("/quote/$id")({
  loader: ({ params }) => {
    const quote = quotes.find((q) => q.id.toLowerCase() === params.id.toLowerCase());
    if (!quote) throw notFound();
    return { quote };
  },
  head: ({ loaderData }) => {
    if (!loaderData) {
      return {
        meta: [
          { title: "Quote unavailable — Automotive Brands" },
          { name: "robots", content: "noindex" },
        ],
      };
    }
    const { quote } = loaderData;
    return {
      meta: [
        { title: `Quote ${quote.id} — ${quote.company} — Automotive Brands` },
        {
          name: "description",
          content: `Trade quote ${quote.id} prepared for ${quote.company} by ${quote.owner}, valid until ${quote.expires}.`,
        },
        { name: "robots", content: "noindex" },
        { property: "og:title", content: `Quote ${quote.id} — Automotive Brands` },
        { property: "og:description", content: `Trade quote for ${quote.company}.` },
      ],
    };
  },
  component: QuotePage,
});

function QuotePage() {
  const { quote: q } = Route.useLoaderData();
  const [accepted, setAccepted] = useState(q.status === "Accepted");
  const net = quoteTotal(q);
  const vat = net * 0.2;
  const delivery = net > 250 ? 0 : 9.5;

  return (
    <PublicLayout>
      <div className="mx-auto max-w-[1000px] px-4 py-10 sm:px-6 lg:px-10">
        <div className="rounded-lg border border-border bg-surface/40">
          <header className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-4 border-b border-border p-6">
            <div className="min-w-0">
              <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-primary">
                Trade quotation
              </div>
              <h1 className="num mt-1 font-display text-3xl font-semibold uppercase tracking-tight">
                {q.id}
              </h1>
              <p className="mt-1 text-[13px] text-steel">
                Prepared for <span className="font-semibold text-foreground">{q.company}</span> ·
                Attention {q.contact}
              </p>
            </div>
            <div className="shrink-0 text-right">
              <StatusBadge tone={accepted ? "good" : "brand"}>
                {accepted ? "Accepted" : q.status}
              </StatusBadge>
              <div className="num mt-2 text-[12px] text-steel">Valid until {q.expires}</div>
            </div>
          </header>

          <dl className="grid gap-px border-b border-border bg-border sm:grid-cols-4">
            {[
              ["Quote date", q.created],
              ["Expires", q.expires],
              ["Prepared by", q.owner],
              ["Payment terms", "30 Days Net"],
            ].map(([k, v]) => (
              <div key={k} className="bg-surface/60 p-4">
                <dt className="text-[10px] uppercase tracking-[0.14em] text-steel">{k}</dt>
                <dd className="mt-1 text-[13px] font-semibold">{v}</dd>
              </div>
            ))}
          </dl>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-[13px]">
              <thead>
                <tr className="border-b border-border bg-surface/60 text-left text-[10px] uppercase tracking-[0.12em] text-steel">
                  <th className="px-4 py-2 font-semibold">SKU</th>
                  <th className="px-4 py-2 font-semibold">Product</th>
                  <th className="px-4 py-2 text-right font-semibold">Qty</th>
                  <th className="px-4 py-2 text-right font-semibold">Unit</th>
                  <th className="px-4 py-2 text-right font-semibold">Disc.</th>
                  <th className="px-4 py-2 text-right font-semibold">Line total</th>
                </tr>
              </thead>
              <tbody>
                {q.lines.map((l, i) => (
                  <tr key={l.sku} className={`border-b border-border/60 ${i % 2 ? "bg-surface/30" : ""}`}>
                    <td className="num px-4 py-2.5 text-primary">{l.sku}</td>
                    <td className="px-4 py-2.5">{l.name}</td>
                    <td className="num px-4 py-2.5 text-right">{l.qty}</td>
                    <td className="num px-4 py-2.5 text-right">{gbp(l.unit)}</td>
                    <td className="num px-4 py-2.5 text-right text-steel">
                      {l.discount ? `${l.discount}%` : "—"}
                    </td>
                    <td className="num px-4 py-2.5 text-right font-semibold">
                      {gbp(l.qty * l.unit * (1 - l.discount / 100))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="grid gap-6 p-6 sm:grid-cols-2">
            <div>
              <div className="text-[11px] uppercase tracking-[0.16em] text-steel">Notes</div>
              <p className="mt-2 text-[13px] leading-relaxed text-steel">{q.notes}</p>
            </div>
            <dl className="num space-y-2 text-[13px]">
              <Line label="Subtotal (ex VAT)" value={gbp(net)} />
              <Line label="Delivery" value={delivery === 0 ? "Free" : gbp(delivery)} />
              <Line label="VAT at 20%" value={gbp(vat)} />
              <div className="flex items-center justify-between border-t border-border pt-2 font-display text-xl font-semibold">
                <dt>Quote total</dt>
                <dd>{gbp(net + vat + delivery)}</dd>
              </div>
            </dl>
          </div>

          <footer className="flex flex-wrap items-center gap-3 border-t border-border p-6">
            {accepted ? (
              <>
                <span className="inline-flex items-center gap-2 rounded-md bg-good/15 px-4 py-2 text-[13px] font-bold text-good">
                  <Check className="size-4" aria-hidden /> Quote accepted — converted to order AB-9714
                </span>
                <Link
                  to="/portal/orders"
                  className="inline-flex h-11 items-center rounded-md border border-border px-5 text-[13px] font-semibold transition-colors hover:border-steel"
                >
                  View order
                </Link>
              </>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => setAccepted(true)}
                  className="inline-flex h-11 items-center rounded-md bg-primary px-6 text-[13px] font-bold uppercase tracking-wide text-primary-foreground transition hover:brightness-110"
                >
                  Accept & convert to order
                </button>
                <button
                  type="button"
                  className="inline-flex h-11 items-center rounded-md border border-border px-5 text-[13px] font-semibold transition-colors hover:border-steel"
                >
                  Request changes
                </button>
              </>
            )}
            <button
              type="button"
              className="inline-flex h-11 items-center gap-2 rounded-md px-4 text-[13px] font-semibold text-steel transition-colors hover:text-foreground"
            >
              <Download className="size-4" aria-hidden /> PDF
            </button>
            <button
              type="button"
              className="inline-flex h-11 items-center gap-2 rounded-md px-4 text-[13px] font-semibold text-steel transition-colors hover:text-foreground"
            >
              <Printer className="size-4" aria-hidden /> Print
            </button>
          </footer>
        </div>
      </div>
    </PublicLayout>
  );
}

function Line({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <dt className="text-steel">{label}</dt>
      <dd className="font-semibold">{value}</dd>
    </div>
  );
}
