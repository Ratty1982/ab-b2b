import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { useState } from "react";
import { AlertTriangle, ArrowUpRight, Lightbulb, Clock } from "lucide-react";
import { PanelHeader, Metric } from "@/components/ab/AppShell";
import { StatusBadge, OrderStatusBadge } from "@/components/ab/Badges";
import {
  activities,
  customers,
  gbp,
  gbp0,
  opportunities,
  products,
  recentOrders,
  revenueTrend,
} from "@/lib/data";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/sales/customers/$id")({
  loader: ({ params }) => {
    const customer = customers.find((c) => c.id === params.id);
    if (!customer) throw notFound();
    return { customer };
  },
  head: ({ loaderData }) => {
    if (!loaderData) {
      return {
        meta: [
          { title: "Customer not found — Automotive Brands" },
          { name: "robots", content: "noindex" },
        ],
      };
    }
    const { customer } = loaderData;
    return {
      meta: [
        { title: `${customer.company} — Customer 360 — Automotive Brands` },
        {
          name: "description",
          content: `Full customer record for ${customer.company} (${customer.number}): sales, orders, quotes, opportunities, activities and account insights.`,
        },
        { property: "og:title", content: `${customer.company} — Customer 360` },
        {
          property: "og:description",
          content: "Sales, orders, quotes, opportunities and account insights in one record.",
        },
      ],
    };
  },
  component: Customer360,
});

const tabs = [
  "Overview",
  "Contacts",
  "Orders",
  "Quotes",
  "Opportunities",
  "Activities",
  "Tasks",
  "Notes",
  "Documents",
] as const;

function Customer360() {
  const { customer } = Route.useLoaderData();
  const [tab, setTab] = useState<(typeof tabs)[number]>("Overview");
  const opps = opportunities.filter((o) => o.company === customer.company);
  const maxTrend = Math.max(...revenueTrend.map((r) => r.value));

  return (
    <div>
      <PanelHeader
        title={customer.company}
        sub={`${customer.number} · ${customer.location} · Account Manager ${customer.manager} · Trade A · 30 Days · Credit limit ${gbp0(15000)}`}
        actions={
          <>
            <button
              type="button"
              className="h-10 rounded-md border border-border px-4 text-[13px] font-semibold transition-colors hover:border-steel"
            >
              Log activity
            </button>
            <button
              type="button"
              className="h-10 rounded-md border border-border px-4 text-[13px] font-semibold transition-colors hover:border-steel"
            >
              Create quote
            </button>
            <Link
              to="/portal/quick-order"
              className="inline-flex h-10 items-center rounded-md bg-primary px-5 text-[13px] font-bold text-primary-foreground transition hover:brightness-110"
            >
              Place order for customer
            </Link>
          </>
        }
      />

      <div className="flex items-center gap-2 border-b border-border/70 bg-primary/5 px-4 py-2 text-[12px] sm:px-6">
        <StatusBadge tone="brand">Acting on behalf of {customer.company}</StatusBadge>
        <span className="text-steel">Pricing, catalogue and delivery addresses follow their account settings.</span>
      </div>

      <div className="grid gap-px bg-border sm:grid-cols-2 lg:grid-cols-4">
        <Metric label="YTD sales" value={gbp0(customer.ytd)} tone="brand" hint="vs £31,140 last year" />
        <Metric label="Last order" value={customer.lastOrder} hint="AB-9821 · £1,247.40" />
        <Metric label="Open quotes" value={gbp0(4280)} tone="warn" hint="1 quote awaiting response" />
        <Metric label="Average order" value={gbp0(742)} hint="52 orders YTD" />
      </div>

      <div className="flex gap-1 overflow-x-auto border-b border-border/70 px-4 sm:px-6">
        {tabs.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            aria-current={tab === t ? "page" : undefined}
            className={cn(
              "shrink-0 border-b-2 px-3 py-3 text-[13px] font-semibold",
              tab === t ? "border-primary text-foreground" : "border-transparent text-steel hover:text-foreground",
            )}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === "Overview" ? (
        <div className="grid gap-6 p-4 sm:p-6 xl:grid-cols-3">
          <section className="space-y-6 xl:col-span-2">
            <div>
              <h2 className="mb-3 font-display text-lg font-semibold uppercase">Account insights</h2>
              <ul className="space-y-2">
                <Insight
                  icon={<AlertTriangle className="size-4" aria-hidden />}
                  tone="warn"
                  title="Order frequency warning"
                  body="This customer normally orders every 14 days. Their last order was 31 days ago."
                  action="Call now"
                />
                <Insight
                  icon={<Lightbulb className="size-4" aria-hidden />}
                  tone="info"
                  title="Cross-sell opportunity"
                  body="This customer purchases Steel Seal but has never purchased Power Maxed."
                  action="Build quote"
                />
                <Insight
                  icon={<Clock className="size-4" aria-hidden />}
                  tone="brand"
                  title="Quote follow-up"
                  body="Quote AB-10428 worth £2,840 has been open for 7 days."
                  action="Chase quote"
                />
              </ul>
            </div>

            <div>
              <h2 className="mb-3 font-display text-lg font-semibold uppercase">Revenue trend</h2>
              <div className="rounded-lg border border-border bg-surface/40 p-4">
                <div className="flex h-40 items-end gap-3">
                  {revenueTrend.map((r) => (
                    <div key={r.month} className="flex min-w-0 flex-1 flex-col items-center gap-2">
                      <div
                        className="w-full rounded-t-sm bg-primary/80"
                        style={{ height: `${(r.value / maxTrend) * 100}%` }}
                        aria-hidden
                      />
                      <span className="num text-[11px] text-steel">{r.month}</span>
                      <span className="sr-only">
                        {r.month}: {gbp0(r.value)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div>
              <h2 className="mb-3 font-display text-lg font-semibold uppercase">Recent orders</h2>
              <div className="overflow-x-auto rounded-lg border border-border">
                <table className="w-full min-w-[560px] text-[13px]">
                  <tbody>
                    {recentOrders.map((o) => (
                      <tr key={o.id} className="border-b border-border/60 last:border-0">
                        <td className="num px-3 py-2.5 font-medium text-primary">{o.id}</td>
                        <td className="px-3 py-2.5 text-steel">{o.date}</td>
                        <td className="num px-3 py-2.5 text-right">{o.lines} lines</td>
                        <td className="px-3 py-2.5">
                          <OrderStatusBadge status={o.status} />
                        </td>
                        <td className="num px-3 py-2.5 text-right font-semibold">{gbp(o.value)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </section>

          <aside className="space-y-6">
            <ListPanel title="Top products">
              {products.slice(0, 4).map((p) => (
                <li key={p.sku} className="grid grid-cols-[minmax(0,1fr)_auto] gap-2 px-3 py-2.5 text-[13px]">
                  <span className="min-w-0 truncate">{p.name}</span>
                  <span className="num shrink-0 font-semibold">{gbp0(p.trade * 24)}</span>
                </li>
              ))}
            </ListPanel>

            <ListPanel title="Top brands">
              {[
                { name: "Steel Seal", value: 16240 },
                { name: "Power Maxed", value: 11880 },
                { name: "Bramley Power", value: 7460 },
                { name: "Street Rhino", value: 2840 },
              ].map((b) => (
                <li key={b.name} className="grid grid-cols-[minmax(0,1fr)_auto] gap-2 px-3 py-2.5 text-[13px]">
                  <span className="min-w-0 truncate">{b.name}</span>
                  <span className="num shrink-0 font-semibold">{gbp0(b.value)}</span>
                </li>
              ))}
            </ListPanel>

            <ListPanel title="Open opportunities">
              {opps.length ? (
                opps.map((o) => (
                  <li key={o.id} className="px-3 py-2.5 text-[13px]">
                    <div className="num font-semibold text-primary">{o.id}</div>
                    <div className="truncate">{o.title}</div>
                    <div className="num text-[11px] text-steel">
                      {gbp0(o.value)} · {o.stage} · closes {o.close}
                    </div>
                  </li>
                ))
              ) : (
                <li className="px-3 py-6 text-center text-[13px] text-steel">
                  No open opportunities
                </li>
              )}
            </ListPanel>

            <ListPanel title="Outstanding tasks">
              {["Follow up display stand — Friday", "Confirm Q4 stock plan"].map((t) => (
                <li key={t} className="flex items-start gap-2 px-3 py-2.5 text-[13px]">
                  <input type="checkbox" className="mt-1 accent-primary" aria-label={t} />
                  {t}
                </li>
              ))}
            </ListPanel>
          </aside>
        </div>
      ) : tab === "Activities" ? (
        <div className="p-4 sm:p-6">
          <ol className="relative border-l border-border pl-6">
            {activities.map((a) => (
              <li key={a.when + a.body} className="mb-6 last:mb-0">
                <span
                  className="absolute -left-[5px] mt-1.5 size-2.5 rounded-full bg-primary"
                  aria-hidden
                />
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[12px] font-semibold text-steel">{a.when}</span>
                  <StatusBadge tone="neutral">{a.type}</StatusBadge>
                </div>
                <p className="mt-1 text-[14px]">{a.body}</p>
                <p className="text-[11px] text-steel">{a.who}</p>
              </li>
            ))}
          </ol>
        </div>
      ) : (
        <div className="grid place-items-center p-16 text-center">
          <p className="font-display text-lg uppercase">{tab}</p>
          <p className="mt-1 max-w-md text-sm text-steel">
            This tab is part of the next build phase. The Overview and Activities tabs show the
            intended interaction pattern.
          </p>
        </div>
      )}
    </div>
  );
}

function Insight({
  icon,
  tone,
  title,
  body,
  action,
}: {
  icon: React.ReactNode;
  tone: "warn" | "info" | "brand";
  title: string;
  body: string;
  action: string;
}) {
  return (
    <li
      className={cn(
        "grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 rounded-lg border p-3",
        tone === "warn" && "border-warn/30 bg-warn/5",
        tone === "info" && "border-cyan/30 bg-cyan/5",
        tone === "brand" && "border-primary/40 bg-primary/5",
      )}
    >
      <span
        className={cn(
          "shrink-0",
          tone === "warn" && "text-warn",
          tone === "info" && "text-cyan",
          tone === "brand" && "text-primary",
        )}
      >
        {icon}
      </span>
      <span className="min-w-0">
        <span className="block text-[13px] font-semibold">{title}</span>
        <span className="block text-[13px] text-steel">{body}</span>
      </span>
      <button
        type="button"
        className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-md border border-border px-3 text-[12px] font-semibold hover:border-steel"
      >
        {action}
        <ArrowUpRight className="size-3.5" aria-hidden />
      </button>
    </li>
  );
}

function ListPanel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h2 className="mb-3 font-display text-lg font-semibold uppercase">{title}</h2>
      <ul className="divide-y divide-border rounded-lg border border-border">{children}</ul>
    </div>
  );
}
