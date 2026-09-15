import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { useState } from "react";
import { AlertTriangle, ArrowUpRight, Clock, Lightbulb, TrendingDown } from "lucide-react";
import { PanelHeader, Metric } from "@/components/ab/AppShell";
import { StatusBadge, OrderStatusBadge } from "@/components/ab/Badges";
import { ActivityDrawer, activityKinds, type ActivityKind } from "@/components/ab/ActivityDrawer";
import {
  activities as seedActivities,
  customers,
  gbp,
  gbp0,
  opportunities,
  recentOrders,
} from "@/lib/data";
import {
  accountInsights,
  contacts,
  monthlySales,
  quotes,
  quoteTotal,
  salesByBrand,
  topProducts,
  deliveryAddresses,
} from "@/lib/crm-data";
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
  "Activity",
  "Tasks",
  "Notes",
  "Documents",
  "Account",
] as const;

const insightIcon = {
  warn: AlertTriangle,
  bad: TrendingDown,
  info: Lightbulb,
  brand: Clock,
} as const;

const tasks = [
  { id: "t1", title: "Follow up Power Maxed display stand", due: "18 Sep 2026", priority: "High" },
  { id: "t2", title: "Confirm Q4 Steel Seal stock plan", due: "23 Sep 2026", priority: "Normal" },
  { id: "t3", title: "Send updated price list", due: "30 Sep 2026", priority: "Low" },
];

const notes = [
  {
    when: "11 Sep 2026",
    who: "James Whitfield",
    body: "Karen confirmed the branch is trialling a competitor chemical range on the counter. Price comparison needed on Steel Seal 300ml.",
  },
  {
    when: "22 Aug 2026",
    who: "James Whitfield",
    body: "Second branch in Wolverhampton now taking deliveries directly. Add to standing delivery schedule.",
  },
];

const documents = [
  { name: "Signed credit application", type: "PDF", size: "1.2 MB", date: "14 Feb 2024" },
  { name: "Trading terms — 30 days net", type: "PDF", size: "480 KB", date: "14 Feb 2024" },
  { name: "Q3 pricing agreement", type: "PDF", size: "310 KB", date: "02 Jul 2026" },
];

function Customer360() {
  const { customer } = Route.useLoaderData();
  const [tab, setTab] = useState<(typeof tabs)[number]>("Overview");
  const [drawer, setDrawer] = useState<ActivityKind | null>(null);
  const [timeline, setTimeline] = useState(seedActivities);

  const opps = opportunities.filter((o) => o.company === customer.company);
  const custQuotes = quotes.filter((q) => q.company === customer.company);
  const openQuotes = custQuotes.filter((q) => ["Sent", "Viewed", "Draft"].includes(q.status));
  const openQuoteValue = openQuotes.reduce((s, q) => s + quoteTotal(q), 0);
  const custContacts = contacts.filter((c) => c.customerId === customer.id);
  const maxMonth = Math.max(...monthlySales.map((m) => Math.max(m.value, m.ly)));
  const lastYear = Math.round(customer.ytd * 0.81);
  const growth = Math.round(((customer.ytd - lastYear) / lastYear) * 100);

  return (
    <div>
      <PanelHeader
        title={customer.company}
        sub={`${customer.number} · ${customer.location} · Account manager ${customer.manager}`}
        actions={
          <>
            <button
              type="button"
              onClick={() => setDrawer("Call")}
              className="h-10 rounded-md border border-border px-4 text-[13px] font-semibold transition-colors hover:border-steel"
            >
              Log activity
            </button>
            <Link
              to="/sales/quotes/new"
              search={{ customer: customer.id }}
              className="inline-flex h-10 items-center rounded-md border border-border px-4 text-[13px] font-semibold transition-colors hover:border-steel"
            >
              Create quote
            </Link>
            <Link
              to="/sales/order/$id"
              params={{ id: customer.id }}
              className="inline-flex h-10 items-center rounded-md bg-primary px-5 text-[13px] font-bold uppercase tracking-wide text-primary-foreground transition hover:brightness-110"
            >
              Place order for customer
            </Link>
          </>
        }
      />

      {/* Account header strip */}
      <dl className="grid gap-px border-b border-border bg-border sm:grid-cols-3 lg:grid-cols-6">
        {[
          ["Account status", customer.status],
          ["Account number", customer.number],
          ["Price group (internal)", "Trade A"],
          ["Payment terms", "30 Days Net"],
          ["Credit limit", gbp0(15000)],
          ["Available credit", gbp0(8940)],
        ].map(([k, v]) => (
          <div key={k} className="bg-surface/60 px-4 py-2.5">
            <dt className="text-[10px] uppercase tracking-[0.14em] text-steel">{k}</dt>
            <dd className="num mt-0.5 text-[13px] font-semibold">{v}</dd>
          </div>
        ))}
      </dl>

      {/* Quick activity bar */}
      <div className="flex flex-wrap gap-2 border-b border-border/70 bg-surface/30 px-4 py-2 sm:px-6">
        {activityKinds.map((a) => (
          <button
            key={a.kind}
            type="button"
            onClick={() => setDrawer(a.kind)}
            className="inline-flex h-9 items-center gap-2 rounded-md border border-border bg-ink px-3 text-[12px] font-semibold transition-colors hover:border-primary hover:text-primary"
          >
            <a.icon className="size-3.5" aria-hidden />
            {a.label}
          </button>
        ))}
      </div>

      <div className="grid gap-px bg-border sm:grid-cols-3 lg:grid-cols-6">
        <Metric label="YTD sales" value={gbp0(customer.ytd)} tone="brand" hint={`vs ${gbp0(lastYear)} last year`} />
        <Metric
          label="Sales vs last year"
          value={`${growth > 0 ? "+" : ""}${growth}%`}
          tone={growth >= 0 ? "good" : "warn"}
          hint="Rolling 12 months"
        />
        <Metric label="Last order" value={customer.lastOrder} hint="AB-9821 · £1,247.40" />
        <Metric label="Average order" value={gbp0(742)} hint="52 orders YTD" />
        <Metric label="Open quotes" value={gbp0(openQuoteValue)} tone="warn" hint={`${openQuotes.length} awaiting decision`} />
        <Metric label="Open opportunities" value={String(opps.length)} hint={gbp0(opps.reduce((s, o) => s + o.value, 0))} />
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
              tab === t
                ? "border-primary text-foreground"
                : "border-transparent text-steel hover:text-foreground",
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
                {accountInsights.map((i) => {
                  const Icon = insightIcon[i.tone];
                  return (
                    <li
                      key={i.id}
                      className={cn(
                        "grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 rounded-lg border p-3",
                        i.tone === "warn" && "border-warn/30 bg-warn/5",
                        i.tone === "bad" && "border-destructive/40 bg-destructive/5",
                        i.tone === "info" && "border-cyan/30 bg-cyan/5",
                        i.tone === "brand" && "border-primary/40 bg-primary/5",
                      )}
                    >
                      <Icon
                        className={cn(
                          "size-4 shrink-0",
                          i.tone === "warn" && "text-warn",
                          i.tone === "bad" && "text-destructive",
                          i.tone === "info" && "text-cyan",
                          i.tone === "brand" && "text-primary",
                        )}
                        aria-hidden
                      />
                      <span className="min-w-0">
                        <span className="block text-[13px] font-semibold">{i.title}</span>
                        <span className="block text-[13px] text-steel">{i.body}</span>
                      </span>
                      <button
                        type="button"
                        onClick={() => setDrawer(i.action === "Log call" ? "Call" : "Note")}
                        className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-md border border-border px-3 text-[12px] font-semibold hover:border-steel"
                      >
                        {i.action}
                        <ArrowUpRight className="size-3.5" aria-hidden />
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>

            <div>
              <h2 className="mb-3 font-display text-lg font-semibold uppercase">
                Sales — last 12 months
              </h2>
              <div className="rounded-lg border border-border bg-surface/40 p-4">
                <div className="flex h-44 items-end gap-2">
                  {monthlySales.map((m) => (
                    <div key={m.month} className="flex min-w-0 flex-1 flex-col items-center gap-1.5">
                      <div className="flex h-full w-full items-end gap-0.5">
                        <div
                          className="w-1/2 rounded-t-sm bg-primary/85"
                          style={{ height: `${(m.value / maxMonth) * 100}%` }}
                          aria-hidden
                        />
                        <div
                          className="w-1/2 rounded-t-sm bg-steel/30"
                          style={{ height: `${(m.ly / maxMonth) * 100}%` }}
                          aria-hidden
                        />
                      </div>
                      <span className="num truncate text-[10px] text-steel">{m.month}</span>
                      <span className="sr-only">
                        {m.month}: {gbp0(m.value)} this year, {gbp0(m.ly)} last year
                      </span>
                    </div>
                  ))}
                </div>
                <div className="mt-3 flex gap-4 text-[11px] text-steel">
                  <span className="flex items-center gap-1.5">
                    <span className="size-2.5 rounded-sm bg-primary/85" aria-hidden /> This year
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="size-2.5 rounded-sm bg-steel/30" aria-hidden /> Last year
                  </span>
                </div>
              </div>
            </div>

            <div>
              <h2 className="mb-3 font-display text-lg font-semibold uppercase">Recent orders</h2>
              <OrdersTable />
            </div>

            <div>
              <h2 className="mb-3 font-display text-lg font-semibold uppercase">
                Top purchased products
              </h2>
              <div className="overflow-x-auto rounded-lg border border-border">
                <table className="w-full min-w-[560px] text-[13px]">
                  <thead>
                    <tr className="border-b border-border bg-surface/60 text-left text-[10px] uppercase tracking-[0.12em] text-steel">
                      <th className="px-3 py-2 font-semibold">SKU</th>
                      <th className="px-3 py-2 font-semibold">Product</th>
                      <th className="px-3 py-2 font-semibold">Brand</th>
                      <th className="px-3 py-2 text-right font-semibold">Qty YTD</th>
                      <th className="px-3 py-2 text-right font-semibold">Value YTD</th>
                    </tr>
                  </thead>
                  <tbody>
                    {topProducts.map((p, i) => (
                      <tr key={p.sku} className={`border-b border-border/60 ${i % 2 ? "bg-surface/30" : ""}`}>
                        <td className="num px-3 py-2 text-primary">{p.sku}</td>
                        <td className="px-3 py-2">{p.name}</td>
                        <td className="px-3 py-2 text-steel">{p.brand}</td>
                        <td className="num px-3 py-2 text-right">{p.qty}</td>
                        <td className="num px-3 py-2 text-right font-semibold">{gbp0(p.value)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </section>

          <aside className="space-y-6">
            <ListPanel title="Sales by brand">
              {salesByBrand.map((b) => (
                <li key={b.brand} className="px-3 py-2.5 text-[13px]">
                  <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
                    <span className="min-w-0 truncate">{b.brand}</span>
                    <span className="num shrink-0 font-semibold">{gbp0(b.value)}</span>
                  </div>
                  <div className="mt-1 flex items-center gap-2">
                    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface">
                      <div
                        className="h-full bg-primary"
                        style={{ width: `${(b.value / 16240) * 100}%` }}
                      />
                    </div>
                    <span
                      className={cn(
                        "num text-[11px]",
                        b.change < 0 ? "text-destructive" : "text-good",
                      )}
                    >
                      {b.change > 0 ? "+" : ""}
                      {b.change}%
                    </span>
                  </div>
                </li>
              ))}
            </ListPanel>

            <ListPanel title="Open quotes">
              {openQuotes.length ? (
                openQuotes.map((q) => (
                  <li key={q.id} className="px-3 py-2.5 text-[13px]">
                    <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
                      <Link to="/quote/$id" params={{ id: q.id }} className="num font-semibold text-primary">
                        {q.id}
                      </Link>
                      <span className="num shrink-0 font-semibold">{gbp0(quoteTotal(q))}</span>
                    </div>
                    <div className="num text-[11px] text-steel">
                      {q.status} · expires {q.expires}
                    </div>
                  </li>
                ))
              ) : (
                <li className="px-3 py-6 text-center text-[13px] text-steel">No open quotes</li>
              )}
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

            <ListPanel title="Upcoming tasks">
              {tasks.map((t) => (
                <li key={t.id} className="flex items-start gap-2 px-3 py-2.5 text-[13px]">
                  <input type="checkbox" className="mt-1 accent-primary" aria-label={t.title} />
                  <span className="min-w-0">
                    <span className="block">{t.title}</span>
                    <span className="num block text-[11px] text-steel">
                      Due {t.due} · {t.priority}
                    </span>
                  </span>
                </li>
              ))}
            </ListPanel>

            <ListPanel title="Recent activity">
              {timeline.slice(0, 4).map((a) => (
                <li key={a.when + a.body} className="px-3 py-2.5 text-[13px]">
                  <div className="num text-[11px] text-steel">
                    {a.when} · {a.type}
                  </div>
                  <div className="line-clamp-2">{a.body}</div>
                </li>
              ))}
            </ListPanel>
          </aside>
        </div>
      ) : tab === "Contacts" ? (
        <div className="p-4 sm:p-6">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 className="font-display text-lg font-semibold uppercase">Contacts</h2>
            <button
              type="button"
              className="h-9 rounded-md bg-primary px-4 text-[12px] font-bold text-primary-foreground transition hover:brightness-110"
            >
              Add contact
            </button>
          </div>
          <div className="hidden overflow-x-auto rounded-lg border border-border md:block">
            <table className="w-full min-w-[900px] text-[13px]">
              <thead>
                <tr className="border-b border-border bg-surface/60 text-left text-[10px] uppercase tracking-[0.12em] text-steel">
                  <th className="px-3 py-2 font-semibold">Name</th>
                  <th className="px-3 py-2 font-semibold">Job title</th>
                  <th className="px-3 py-2 font-semibold">Department</th>
                  <th className="px-3 py-2 font-semibold">Role</th>
                  <th className="px-3 py-2 font-semibold">Telephone</th>
                  <th className="px-3 py-2 font-semibold">Mobile</th>
                  <th className="px-3 py-2 font-semibold">Email</th>
                  <th className="px-3 py-2 font-semibold">Preferred</th>
                  <th className="px-3 py-2 font-semibold">Last contact</th>
                </tr>
              </thead>
              <tbody>
                {custContacts.map((c, i) => (
                  <tr key={c.id} className={`border-b border-border/60 ${i % 2 ? "bg-surface/30" : ""}`}>
                    <td className="px-3 py-2 font-semibold">{c.name}</td>
                    <td className="px-3 py-2 text-steel">{c.jobTitle}</td>
                    <td className="px-3 py-2 text-steel">{c.department}</td>
                    <td className="px-3 py-2">
                      <StatusBadge tone="neutral">{c.role}</StatusBadge>
                    </td>
                    <td className="num px-3 py-2">{c.telephone}</td>
                    <td className="num px-3 py-2">{c.mobile}</td>
                    <td className="px-3 py-2 text-steel">{c.email}</td>
                    <td className="px-3 py-2 text-steel">{c.preferred}</td>
                    <td className="px-3 py-2 text-steel">{c.lastContact}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ul className="space-y-3 md:hidden">
            {custContacts.map((c) => (
              <li key={c.id} className="rounded-lg border border-border bg-surface/40 p-4">
                <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-2">
                  <span className="min-w-0">
                    <span className="block truncate font-semibold">{c.name}</span>
                    <span className="block text-[12px] text-steel">{c.jobTitle}</span>
                  </span>
                  <StatusBadge tone="neutral">{c.role}</StatusBadge>
                </div>
                <div className="num mt-3 grid grid-cols-2 gap-2 text-[12px]">
                  <a href={`tel:${c.mobile.replace(/\s/g, "")}`} className="rounded-md border border-border py-2 text-center font-semibold">
                    Call
                  </a>
                  <a href={`mailto:${c.email}`} className="rounded-md border border-border py-2 text-center font-semibold">
                    Email
                  </a>
                </div>
                <div className="num mt-2 text-[11px] text-steel">
                  Prefers {c.preferred} · last contact {c.lastContact}
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : tab === "Orders" ? (
        <div className="p-4 sm:p-6">
          <OrdersTable full />
        </div>
      ) : tab === "Quotes" ? (
        <div className="p-4 sm:p-6">
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full min-w-[720px] text-[13px]">
              <thead>
                <tr className="border-b border-border bg-surface/60 text-left text-[10px] uppercase tracking-[0.12em] text-steel">
                  <th className="px-3 py-2 font-semibold">Quote</th>
                  <th className="px-3 py-2 font-semibold">Created</th>
                  <th className="px-3 py-2 font-semibold">Expires</th>
                  <th className="px-3 py-2 font-semibold">Owner</th>
                  <th className="px-3 py-2 font-semibold">Status</th>
                  <th className="px-3 py-2 text-right font-semibold">Value</th>
                </tr>
              </thead>
              <tbody>
                {custQuotes.map((q, i) => (
                  <tr key={q.id} className={`border-b border-border/60 ${i % 2 ? "bg-surface/30" : ""}`}>
                    <td className="num px-3 py-2 font-medium text-primary">
                      <Link to="/quote/$id" params={{ id: q.id }}>
                        {q.id}
                      </Link>
                    </td>
                    <td className="px-3 py-2 text-steel">{q.created}</td>
                    <td className="px-3 py-2 text-steel">{q.expires}</td>
                    <td className="px-3 py-2 text-steel">{q.owner}</td>
                    <td className="px-3 py-2">
                      <StatusBadge
                        tone={
                          q.status === "Accepted"
                            ? "good"
                            : q.status === "Rejected" || q.status === "Expired"
                              ? "bad"
                              : "brand"
                        }
                      >
                        {q.status}
                      </StatusBadge>
                    </td>
                    <td className="num px-3 py-2 text-right font-semibold">{gbp(quoteTotal(q))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : tab === "Opportunities" ? (
        <div className="p-4 sm:p-6">
          <ul className="grid gap-3 md:grid-cols-2">
            {opps.map((o) => (
              <li key={o.id} className="rounded-lg border border-border bg-surface/40 p-4">
                <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
                  <Link
                    to="/crm"
                    className="num min-w-0 truncate font-semibold text-primary"
                  >
                    {o.id}
                  </Link>
                  <span className="num shrink-0 font-display text-lg font-semibold">
                    {gbp0(o.value)}
                  </span>
                </div>
                <div className="mt-1 text-[13px] font-semibold">{o.title}</div>
                <div className="num mt-1 text-[12px] text-steel">
                  {o.stage} · {o.owner} · closes {o.close}
                </div>
                <div className="mt-2 text-[12px] text-steel">Next action: {o.nextAction}</div>
              </li>
            ))}
            {opps.length === 0 ? (
              <li className="rounded-lg border border-dashed border-border p-8 text-center text-[13px] text-steel">
                No open opportunities for this customer.
              </li>
            ) : null}
          </ul>
        </div>
      ) : tab === "Activity" ? (
        <div className="p-4 sm:p-6">
          <ol className="relative border-l border-border pl-6">
            {timeline.map((a) => (
              <li key={a.when + a.body} className="mb-6 last:mb-0">
                <span className="absolute -left-[5px] mt-1.5 size-2.5 rounded-full bg-primary" aria-hidden />
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
      ) : tab === "Tasks" ? (
        <div className="p-4 sm:p-6">
          <ul className="divide-y divide-border rounded-lg border border-border">
            {tasks.map((t) => (
              <li key={t.id} className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 px-3 py-3 text-[13px]">
                <input type="checkbox" className="accent-primary" aria-label={t.title} />
                <span className="min-w-0 truncate">{t.title}</span>
                <span className="num shrink-0 text-[12px] text-steel">
                  Due {t.due} · {t.priority}
                </span>
              </li>
            ))}
          </ul>
          <button
            type="button"
            onClick={() => setDrawer("Task")}
            className="mt-3 h-10 rounded-md bg-primary px-5 text-[13px] font-bold text-primary-foreground transition hover:brightness-110"
          >
            Create task
          </button>
        </div>
      ) : tab === "Notes" ? (
        <div className="space-y-3 p-4 sm:p-6">
          {notes.map((n) => (
            <article key={n.when} className="rounded-lg border border-border bg-surface/40 p-4">
              <div className="num text-[11px] text-steel">
                {n.when} · {n.who}
              </div>
              <p className="mt-1 text-[14px] leading-relaxed">{n.body}</p>
            </article>
          ))}
          <button
            type="button"
            onClick={() => setDrawer("Note")}
            className="h-10 rounded-md bg-primary px-5 text-[13px] font-bold text-primary-foreground transition hover:brightness-110"
          >
            Add note
          </button>
        </div>
      ) : tab === "Documents" ? (
        <div className="p-4 sm:p-6">
          <ul className="divide-y divide-border rounded-lg border border-border text-[13px]">
            {documents.map((d) => (
              <li key={d.name} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-3 py-3">
                <span className="min-w-0">
                  <span className="block truncate font-medium">{d.name}</span>
                  <span className="num block text-[11px] text-steel">
                    {d.type} · {d.size} · uploaded {d.date}
                  </span>
                </span>
                <button type="button" className="text-[12px] font-semibold text-primary hover:underline">
                  Download
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <div className="grid gap-6 p-4 sm:p-6 lg:grid-cols-2">
          <div>
            <h2 className="mb-3 font-display text-lg font-semibold uppercase">Account settings</h2>
            <dl className="divide-y divide-border rounded-lg border border-border text-[13px]">
              {[
                ["Account number", customer.number],
                ["Status", customer.status],
                ["Account manager", customer.manager],
                ["Price group (internal)", "Trade A"],
                ["Payment terms", "30 Days Net"],
                ["Credit limit", gbp0(15000)],
                ["Available credit", gbp0(8940)],
                ["Permitted catalogues", "All five brands"],
                ["VAT number", "GB 418 2290 41"],
                ["Company registration", "04127788"],
              ].map(([k, v]) => (
                <div key={k} className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 px-3 py-2.5">
                  <dt className="text-steel">{k}</dt>
                  <dd className="num font-semibold">{v}</dd>
                </div>
              ))}
            </dl>
          </div>
          <div>
            <h2 className="mb-3 font-display text-lg font-semibold uppercase">Delivery addresses</h2>
            <ul className="divide-y divide-border rounded-lg border border-border text-[13px]">
              {deliveryAddresses.map((d) => (
                <li key={d.id} className="px-3 py-3">
                  <div className="font-semibold">{d.label}</div>
                  <div className="text-[12px] text-steel">{d.line}</div>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      <ActivityDrawer
        open={drawer !== null}
        kind={drawer ?? "Call"}
        company={customer.company}
        onClose={() => setDrawer(null)}
        onLogged={(entry) =>
          setTimeline((t) => [
            { when: "Just now", type: entry.kind, who: customer.manager, body: entry.body },
            ...t,
          ])
        }
      />
    </div>
  );
}

function OrdersTable({ full }: { full?: boolean }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full min-w-[640px] text-[13px]">
        <thead>
          <tr className="border-b border-border bg-surface/60 text-left text-[10px] uppercase tracking-[0.12em] text-steel">
            <th className="px-3 py-2 font-semibold">Order</th>
            {full ? <th className="px-3 py-2 font-semibold">PO number</th> : null}
            <th className="px-3 py-2 font-semibold">Date</th>
            <th className="px-3 py-2 text-right font-semibold">Lines</th>
            <th className="px-3 py-2 font-semibold">Status</th>
            <th className="px-3 py-2 text-right font-semibold">Value</th>
          </tr>
        </thead>
        <tbody>
          {recentOrders.map((o, i) => (
            <tr key={o.id} className={`border-b border-border/60 last:border-0 ${i % 2 ? "bg-surface/30" : ""}`}>
              <td className="num px-3 py-2.5 font-medium text-primary">{o.id}</td>
              {full ? <td className="num px-3 py-2.5 text-steel">{o.po}</td> : null}
              <td className="px-3 py-2.5 text-steel">{o.date}</td>
              <td className="num px-3 py-2.5 text-right">{o.lines}</td>
              <td className="px-3 py-2.5">
                <OrderStatusBadge status={o.status} />
              </td>
              <td className="num px-3 py-2.5 text-right font-semibold">{gbp(o.value)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
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
