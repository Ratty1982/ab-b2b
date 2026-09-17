import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { PanelHeader, Metric } from "@/components/ab/AppShell";
import { StatusBadge } from "@/components/ab/Badges";
import { Drawer } from "@/components/ab/Drawer";
import { customers, gbp0, opportunities, pipelineStages } from "@/lib/data";
import { managerTotals, monthlySales, salesByBrand, salesTeam, quotes, quoteTotal } from "@/lib/crm-data";
import { ROUTES } from "@/lib/app-nav";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/crm/manager")({
  head: () => ({
    meta: [
      { title: "Sales Manager Dashboard — Automotive Brands CRM" },
      {
        name: "description",
        content:
          "Management view of sales against target, performance by representative, pipeline by stage, quote conversion, new and lost accounts and at-risk customers.",
      },
      { property: "og:title", content: "Sales Manager Dashboard — Automotive Brands" },
      {
        property: "og:description",
        content: "Team performance, pipeline and account health in one management view.",
      },
    ],
  }),
  component: ManagerDashboard,
});

function ManagerDashboard() {
  const [rep, setRep] = useState<(typeof salesTeam)[number] | null>(null);
  const maxMonth = Math.max(...monthlySales.map((m) => m.value));
  const atRisk = customers.filter((c) => c.risk === "At risk" || c.risk === "No recent order");
  const pipelineByStage = pipelineStages.map((s) => ({
    stage: s,
    value: opportunities.filter((o) => o.stage === s).reduce((a, o) => a + o.value, 0),
  }));
  const maxStage = Math.max(...pipelineByStage.map((p) => p.value), 1);
  const topOpps = [...opportunities]
    .filter((o) => o.stage !== "Won" && o.stage !== "Lost")
    .sort((a, b) => b.value - a.value)
    .slice(0, 6);

  return (
    <div>
      <PanelHeader
        title="Sales Manager Dashboard"
        sub="Team performance, pipeline health and account risk · September 2026"
        crumbs={[{ label: "Operations" }, { label: "Sales Team", to: ROUTES.crmManager }]}
      />

      <div className="grid gap-px bg-border sm:grid-cols-3 lg:grid-cols-6">
        <Metric
          label="Sales MTD"
          value={gbp0(managerTotals.mtd)}
          tone="brand"
          hint={`${Math.round((managerTotals.mtd / managerTotals.target) * 100)}% of ${gbp0(managerTotals.target)}`}
        />
        <Metric label="Sales YTD" value={gbp0(managerTotals.ytd)} hint="All representatives" />
        <Metric
          label="Pipeline"
          value={gbp0(opportunities.reduce((s, o) => s + o.value, 0))}
          hint={`${opportunities.length} opportunities`}
        />
        <Metric label="Quote conversion" value={`${managerTotals.conversion}%`} tone="good" hint="Rolling 90 days" />
        <Metric label="New accounts" value={String(managerTotals.newAccounts)} hint="YTD" />
        <Metric label="Lost / inactive" value={String(managerTotals.lostAccounts)} tone="warn" hint="No order in 120 days" />
      </div>

      <div className="grid gap-6 p-4 sm:p-6 xl:grid-cols-3">
        <section className="space-y-6 xl:col-span-2">
          <div>
            <h2 className="mb-3 font-display text-lg font-semibold uppercase">Sales by representative</h2>
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full min-w-[820px] text-[13px]">
                <thead>
                  <tr className="border-b border-border bg-surface/60 text-left text-[10px] uppercase tracking-[0.12em] text-steel">
                    <th className="px-3 py-2 font-semibold">Representative</th>
                    <th className="px-3 py-2 font-semibold">Region</th>
                    <th className="px-3 py-2 text-right font-semibold">MTD</th>
                    <th className="px-3 py-2 text-right font-semibold">Target</th>
                    <th className="px-3 py-2 font-semibold">Against target</th>
                    <th className="px-3 py-2 text-right font-semibold">Pipeline</th>
                    <th className="px-3 py-2 text-right font-semibold">Open quotes</th>
                    <th className="px-3 py-2 text-right font-semibold">Conversion</th>
                    <th className="px-3 py-2 text-right font-semibold">Accounts</th>
                  </tr>
                </thead>
                <tbody>
                  {salesTeam.map((s, i) => {
                    const pct = Math.round((s.mtd / s.target) * 100);
                    return (
                      <tr
                        key={s.name}
                        className={cn("border-b border-border/60 last:border-0", i % 2 && "bg-surface/30")}
                      >
                        <td className="px-3 py-2">
                          <button
                            type="button"
                            onClick={() => setRep(s)}
                            className="font-semibold text-primary hover:underline"
                          >
                            {s.name}
                          </button>
                        </td>
                        <td className="px-3 py-2 text-steel">{s.region}</td>
                        <td className="num px-3 py-2 text-right font-semibold">{gbp0(s.mtd)}</td>
                        <td className="num px-3 py-2 text-right text-steel">{gbp0(s.target)}</td>
                        <td className="px-3 py-2">
                          <div className="flex items-center gap-2">
                            <div className="h-1.5 w-28 overflow-hidden rounded-full bg-surface">
                              <div
                                className={cn("h-full", pct >= 90 ? "bg-good" : pct >= 70 ? "bg-warn" : "bg-destructive")}
                                style={{ width: `${Math.min(100, pct)}%` }}
                              />
                            </div>
                            <span className="num text-[12px]">{pct}%</span>
                          </div>
                        </td>
                        <td className="num px-3 py-2 text-right">{gbp0(s.pipeline)}</td>
                        <td className="num px-3 py-2 text-right">{s.quotes}</td>
                        <td className="num px-3 py-2 text-right">{s.conversion}%</td>
                        <td className="num px-3 py-2 text-right">{s.accounts}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <div>
            <h2 className="mb-3 font-display text-lg font-semibold uppercase">Sales — last 12 months</h2>
            <div className="rounded-lg border border-border bg-surface/40 p-4">
              <div className="flex h-40 items-end gap-2">
                {monthlySales.map((m) => (
                  <div key={m.month} className="flex min-w-0 flex-1 flex-col items-center gap-1.5">
                    <div
                      className="w-full rounded-t-sm bg-primary/80"
                      style={{ height: `${(m.value / maxMonth) * 100}%` }}
                      aria-hidden
                    />
                    <span className="num truncate text-[10px] text-steel">{m.month}</span>
                    <span className="sr-only">
                      {m.month}: {gbp0(m.value)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div>
            <h2 className="mb-3 font-display text-lg font-semibold uppercase">Top opportunities</h2>
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full min-w-[720px] text-[13px]">
                <tbody>
                  {topOpps.map((o, i) => (
                    <tr key={o.id} className={cn("border-b border-border/60 last:border-0", i % 2 && "bg-surface/30")}>
                      <td className="num px-3 py-2.5 text-primary">{o.id}</td>
                      <td className="px-3 py-2.5 font-medium">{o.company}</td>
                      <td className="px-3 py-2.5 text-steel">{o.title}</td>
                      <td className="px-3 py-2.5 text-steel">{o.owner}</td>
                      <td className="px-3 py-2.5">
                        <StatusBadge tone="neutral">{o.stage}</StatusBadge>
                      </td>
                      <td className="num px-3 py-2.5 text-right font-semibold">{gbp0(o.value)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        <aside className="space-y-6">
          <Panel title="Pipeline by stage">
            {pipelineByStage.map((p) => (
              <li key={p.stage} className="px-3 py-2 text-[13px]">
                <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
                  <span className="min-w-0 truncate">{p.stage}</span>
                  <span className="num shrink-0 font-semibold">{gbp0(p.value)}</span>
                </div>
                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface">
                  <div className="h-full bg-cyan" style={{ width: `${(p.value / maxStage) * 100}%` }} />
                </div>
              </li>
            ))}
          </Panel>

          <Panel title="Sales by brand">
            {salesByBrand.map((b) => (
              <li key={b.brand} className="grid grid-cols-[minmax(0,1fr)_auto] gap-2 px-3 py-2.5 text-[13px]">
                <span className="min-w-0 truncate">{b.brand}</span>
                <span className="num shrink-0 font-semibold">{gbp0(b.value)}</span>
              </li>
            ))}
          </Panel>

          <Panel title="At-risk customers">
            {atRisk.map((c) => (
              <li key={c.id} className="px-3 py-2.5 text-[13px]">
                <Link to="/sales/customers/$id" params={{ id: c.id }} className="font-semibold text-primary">
                  {c.company}
                </Link>
                <div className="num text-[11px] text-steel">
                  {c.number} · last order {c.lastOrder} · {gbp0(c.ytd)} YTD
                </div>
              </li>
            ))}
          </Panel>

          <Panel title="Quotes awaiting decision">
            {quotes
              .filter((q) => ["Sent", "Viewed"].includes(q.status))
              .map((q) => (
                <li key={q.id} className="grid grid-cols-[minmax(0,1fr)_auto] gap-2 px-3 py-2.5 text-[13px]">
                  <span className="min-w-0 truncate">
                    <Link to="/quote/$id" params={{ id: q.id }} className="num text-primary">
                      {q.id}
                    </Link>{" "}
                    {q.company}
                  </span>
                  <span className="num shrink-0 font-semibold">{gbp0(quoteTotal(q))}</span>
                </li>
              ))}
          </Panel>
        </aside>
      </div>

      <Drawer
        open={rep !== null}
        onClose={() => setRep(null)}
        width="lg"
        title={rep?.name ?? ""}
        sub={rep ? `${rep.region} · ${rep.accounts} accounts` : ""}
      >
        {rep ? (
          <>
            <div className="grid gap-px bg-border sm:grid-cols-2">
              {[
                ["Sales MTD", gbp0(rep.mtd)],
                ["Target", gbp0(rep.target)],
                ["Pipeline", gbp0(rep.pipeline)],
                ["Quote conversion", `${rep.conversion}%`],
              ].map(([k, v]) => (
                <div key={k} className="bg-surface/60 px-3 py-2.5">
                  <div className="text-[10px] uppercase tracking-[0.14em] text-steel">{k}</div>
                  <div className="num font-display text-xl font-semibold">{v}</div>
                </div>
              ))}
            </div>
            <h3 className="mb-2 mt-6 font-display text-base font-semibold uppercase">Their accounts</h3>
            <ul className="divide-y divide-border rounded-lg border border-border text-[13px]">
              {customers
                .filter((c) => c.manager === rep.name)
                .map((c) => (
                  <li key={c.id} className="grid grid-cols-[minmax(0,1fr)_auto] gap-2 px-3 py-2.5">
                    <Link to="/sales/customers/$id" params={{ id: c.id }} className="min-w-0 truncate text-primary">
                      {c.company}
                    </Link>
                    <span className="num shrink-0 font-semibold">{gbp0(c.ytd)}</span>
                  </li>
                ))}
            </ul>
          </>
        ) : null}
      </Drawer>
    </div>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h2 className="mb-3 font-display text-lg font-semibold uppercase">{title}</h2>
      <ul className="divide-y divide-border rounded-lg border border-border">{children}</ul>
    </div>
  );
}
