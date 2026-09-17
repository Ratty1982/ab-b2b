import { createFileRoute, Link } from "@tanstack/react-router";
import { PanelHeader, Metric } from "@/components/ab/AppShell";
import { StatusBadge } from "@/components/ab/Badges";
import { ROUTES } from "@/lib/app-nav";
import { customers, gbp0, products, recentOrders } from "@/lib/data";
import { applications, managerTotals, quotes, quoteTotal } from "@/lib/crm-data";

export const Route = createFileRoute("/admin/")({
  head: () => ({
    meta: [
      { title: "Internal Admin — Automotive Brands" },
      {
        name: "description",
        content:
          "Internal administration for Automotive Brands: catalogue, companies, trade applications, orders, pricing, promotions, users and website content.",
      },
      { property: "og:title", content: "Internal Admin — Automotive Brands" },
      { property: "og:description", content: "Run the catalogue, pricing, accounts and content in one place." },
    ],
  }),
  component: AdminOverview,
});

const queues = [
  { label: "Trade applications awaiting review", count: 3, to: ROUTES.adminApplications },
  { label: "Orders held for credit check", count: 2, to: ROUTES.portalOrders },
  { label: "Quotes expiring within 7 days", count: 2, to: ROUTES.salesQuotes },
  { label: "Products missing safety data sheets", count: 4, to: ROUTES.adminProducts },
];

const auditLog = [
  { when: "Today, 11:04", who: "Rachel Tibbs", what: "Updated Trade B price list — Steel Seal chemicals" },
  { when: "Today, 09:47", who: "James Whitfield", what: "Approved trade application APP-2026-0409" },
  { when: "Yesterday, 16:12", who: "Dee Okafor", what: "Published promotion PM-AUTUMN to the trade portal" },
  { when: "Yesterday, 14:30", who: "Rachel Tibbs", what: "Added user Sue Marchant to ABC Motor Factors Ltd" },
];

function AdminOverview() {
  return (
    <div>
      <PanelHeader
        title="Administration"
        sub="Catalogue, commercial and platform control"
        crumbs={[{ label: "Home" }, { label: "Dashboard", to: ROUTES.admin }]}
      />

      <div className="grid gap-px bg-border sm:grid-cols-2 lg:grid-cols-4">
        <Metric label="Active trade accounts" value={String(customers.length)} tone="brand" hint="Prototype data set" />
        <Metric label="Catalogue lines" value={String(products.length)} hint="Prototype data set" />
        <Metric label="Sales YTD" value={gbp0(managerTotals.ytd)} hint="All representatives" />
        <Metric
          label="Open quote value"
          value={gbp0(quotes.filter((q) => ["Sent", "Viewed"].includes(q.status)).reduce((s, q) => s + quoteTotal(q), 0))}
          tone="warn"
          hint="Awaiting customer decision"
        />
      </div>

      <div className="grid gap-6 p-4 sm:p-6 xl:grid-cols-3">
        <section className="space-y-6 xl:col-span-2">
          <div>
            <h2 className="mb-3 font-display text-lg font-semibold uppercase">Work queues</h2>
            <ul className="divide-y divide-border rounded-lg border border-border text-[13px]">
              {queues.map((q) => (
                <li key={q.label} className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 px-3 py-3">
                  <span className="num inline-grid size-8 place-items-center rounded-md bg-primary/15 font-semibold text-primary">
                    {q.count}
                  </span>
                  <span className="min-w-0 truncate">{q.label}</span>
                  <Link to={q.to} className="text-[12px] font-semibold text-primary hover:underline">
                    Open
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <h2 className="mb-3 font-display text-lg font-semibold uppercase">Latest trade applications</h2>
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full min-w-[680px] text-[13px]">
                <tbody>
                  {applications.slice(0, 4).map((a, i) => (
                    <tr key={a.id} className={`border-b border-border/60 last:border-0 ${i % 2 ? "bg-surface/30" : ""}`}>
                      <td className="num px-3 py-2.5 text-primary">{a.id}</td>
                      <td className="px-3 py-2.5 font-medium">{a.company}</td>
                      <td className="px-3 py-2.5 text-steel">{a.type}</td>
                      <td className="px-3 py-2.5 text-steel">{a.town}</td>
                      <td className="px-3 py-2.5">
                        <StatusBadge tone={a.status === "Approved" ? "good" : a.status === "New" ? "brand" : "neutral"}>
                          {a.status}
                        </StatusBadge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div>
            <h2 className="mb-3 font-display text-lg font-semibold uppercase">Recent orders</h2>
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full min-w-[680px] text-[13px]">
                <tbody>
                  {recentOrders.map((o, i) => (
                    <tr key={o.id} className={`border-b border-border/60 last:border-0 ${i % 2 ? "bg-surface/30" : ""}`}>
                      <td className="num px-3 py-2.5 text-primary">{o.id}</td>
                      <td className="num px-3 py-2.5 text-steel">{o.po}</td>
                      <td className="px-3 py-2.5 text-steel">{o.date}</td>
                      <td className="px-3 py-2.5">{o.status}</td>
                      <td className="num px-3 py-2.5 text-right font-semibold">{gbp0(o.value)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        <aside>
          <h2 className="mb-3 font-display text-lg font-semibold uppercase">Audit log</h2>
          <ol className="divide-y divide-border rounded-lg border border-border text-[13px]">
            {auditLog.map((a) => (
              <li key={a.when} className="px-3 py-2.5">
                <div className="num text-[11px] text-steel">
                  {a.when} · {a.who}
                </div>
                <div>{a.what}</div>
              </li>
            ))}
          </ol>
        </aside>
      </div>
    </div>
  );
}
