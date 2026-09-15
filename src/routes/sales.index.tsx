import { createFileRoute, Link } from "@tanstack/react-router";
import { PanelHeader, Metric } from "@/components/ab/AppShell";
import { StatusBadge } from "@/components/ab/Badges";
import { Search } from "lucide-react";
import { customers, gbp0, opportunities, pipelineStages } from "@/lib/data";
import { quotes, quoteTotal } from "@/lib/crm-data";

export const Route = createFileRoute("/sales/")({
  head: () => ({
    meta: [
      { title: "Sales Dashboard — Automotive Brands" },
      {
        name: "description",
        content:
          "Sales representative dashboard: sales against target, pipeline value, customers needing attention, tasks due and quotes awaiting follow-up.",
      },
      { property: "og:title", content: "Sales Dashboard — Automotive Brands" },
      { property: "og:description", content: "Actionable daily view for Automotive Brands sales reps." },
    ],
  }),
  component: SalesDashboard,
});

const target = 95000;
const mtd = 68420;

function SalesDashboard() {
  const pipelineValue = opportunities
    .filter((o) => o.stage !== "Won" && o.stage !== "Lost")
    .reduce((s, o) => s + o.value, 0);

  const attention = customers.filter(
    (c) => c.risk === "At risk" || c.risk === "No recent order" || c.risk === "Falling spend",
  );

  return (
    <div>
      <PanelHeader
        title="Good morning, James"
        sub="Tuesday 15 September 2026 · 8 accounts need action today"
        actions={
          <Link
            to="/sales/customers"
            className="inline-flex h-10 items-center rounded-md bg-primary px-5 text-[13px] font-bold text-primary-foreground transition hover:brightness-110"
          >
            My Customers
          </Link>
        }
      />

      <div className="hidden gap-px bg-border md:grid sm:grid-cols-2 lg:grid-cols-4">
        <Metric label="My sales MTD" value={gbp0(mtd)} tone="brand" hint={`${Math.round((mtd / target) * 100)}% of ${gbp0(target)} target`} />
        <Metric label="Pipeline value" value={gbp0(pipelineValue)} hint={`${opportunities.length} open opportunities`} />
        <Metric label="Open quotes" value={gbp0(14380)} tone="warn" hint="4 awaiting follow-up" />
        <Metric label="Orders this month" value="47" hint={`Avg order ${gbp0(742)}`} />
      </div>

      <MobileHome />

      <div className="hidden gap-6 p-4 sm:p-6 md:grid xl:grid-cols-3">
        <section className="xl:col-span-2 space-y-6">
          <div>
            <h2 className="mb-3 font-display text-lg font-semibold uppercase tracking-tight">
              Pipeline summary
            </h2>
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full min-w-[600px] text-[13px]">
                <tbody>
                  {pipelineStages
                    .filter((s) => s !== "Lost")
                    .map((stage) => {
                      const inStage = opportunities.filter((o) => o.stage === stage);
                      const value = inStage.reduce((s, o) => s + o.value, 0);
                      const pct = Math.min(100, (value / 45000) * 100);
                      return (
                        <tr key={stage} className="border-b border-border/60 last:border-0">
                          <td className="w-48 px-3 py-2.5 text-steel">{stage}</td>
                          <td className="num px-3 py-2.5 text-right">{inStage.length}</td>
                          <td className="px-3 py-2.5">
                            <div className="h-2 w-full overflow-hidden rounded-full bg-surface">
                              <div className="h-full bg-primary" style={{ width: `${pct}%` }} />
                            </div>
                          </td>
                          <td className="num w-28 px-3 py-2.5 text-right font-semibold">
                            {gbp0(value)}
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
          </div>

          <div>
            <h2 className="mb-3 font-display text-lg font-semibold uppercase tracking-tight">
              Customers requiring attention
            </h2>
            <ul className="divide-y divide-border rounded-lg border border-border">
              {attention.map((c) => (
                <li
                  key={c.id}
                  className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-3 py-3"
                >
                  <div className="min-w-0">
                    <Link
                      to="/sales/customers/$id"
                      params={{ id: c.id }}
                      className="block truncate text-[13px] font-semibold hover:text-primary"
                    >
                      {c.company}
                    </Link>
                    <div className="num text-[11px] text-steel">
                      {c.number} · {c.location} · last order {c.lastOrder} · YTD {gbp0(c.ytd)}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <StatusBadge tone={c.risk === "No recent order" ? "bad" : "warn"}>
                      {c.risk}
                    </StatusBadge>
                    <button
                      type="button"
                      className="h-8 rounded-md bg-primary px-3 text-[12px] font-bold text-primary-foreground"
                    >
                      Log call
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <aside className="space-y-6">
          <Panel title="Tasks due today">
            {[
              "Call Northgate Garage Group — reactivation",
              "Send Steel Seal case pricing to Seaforth",
              "Confirm visit with Mersey Motor Factors",
            ].map((t) => (
              <li key={t} className="flex items-start gap-2 px-3 py-2.5 text-[13px]">
                <input type="checkbox" className="mt-1 accent-primary" aria-label={t} />
                {t}
              </li>
            ))}
          </Panel>

          <Panel title="Quotes awaiting follow-up">
            {[
              { id: "AB-10428", company: "ABC Motor Factors", value: 2840, age: "7 days" },
              { id: "AB-10431", company: "Seaforth Motor Spares", value: 7250, age: "4 days" },
              { id: "AB-10436", company: "Penrose Autoparts", value: 4290, age: "2 days" },
            ].map((q) => (
              <li key={q.id} className="grid grid-cols-[minmax(0,1fr)_auto] gap-2 px-3 py-2.5 text-[13px]">
                <span className="min-w-0">
                  <span className="num block font-semibold text-primary">{q.id}</span>
                  <span className="block truncate text-[11px] text-steel">
                    {q.company} · open {q.age}
                  </span>
                </span>
                <span className="num self-center font-semibold">{gbp0(q.value)}</span>
              </li>
            ))}
          </Panel>

          <Panel title="New trade applications">
            {[
              { name: "Fairoak Autocentre", where: "Derby", when: "Today" },
              { name: "Kestrel Vehicle Parts", where: "Norwich", when: "Yesterday" },
            ].map((a) => (
              <li key={a.name} className="grid grid-cols-[minmax(0,1fr)_auto] gap-2 px-3 py-2.5 text-[13px]">
                <span className="min-w-0">
                  <span className="block truncate font-semibold">{a.name}</span>
                  <span className="block text-[11px] text-steel">
                    {a.where} · {a.when}
                  </span>
                </span>
                <StatusBadge tone="info">New</StatusBadge>
              </li>
            ))}
          </Panel>
        </aside>
      </div>
    </div>
  );
}


function MobileHome() {
  const today = [
    { time: "09:30", what: "Visit — Penrose Autoparts", where: "Bristol BS2 0QS", id: "penrose-autoparts" },
    { time: "12:15", what: "Visit — Hartley Tyre & Service", where: "Gloucester GL1 4EA", id: "abc-motor-factors" },
    { time: "15:00", what: "Call — Northgate Garage Group", where: "Reactivation call", id: "northgate-garage-group" },
  ];
  const nearby = customers.slice(0, 4);

  return (
    <div className="space-y-6 p-4 md:hidden">
      <div className="grid grid-cols-2 gap-px bg-border">
        <div className="bg-surface/60 px-3 py-2.5">
          <div className="text-[10px] uppercase tracking-[0.14em] text-steel">Sales MTD</div>
          <div className="num font-display text-xl font-semibold text-primary">{gbp0(mtd)}</div>
        </div>
        <div className="bg-surface/60 px-3 py-2.5">
          <div className="text-[10px] uppercase tracking-[0.14em] text-steel">Against target</div>
          <div className="num font-display text-xl font-semibold">
            {Math.round((mtd / target) * 100)}%
          </div>
        </div>
      </div>

      <Link
        to="/sales/customers"
        className="flex h-12 items-center gap-3 rounded-md border border-border bg-surface/50 px-4 text-[14px] text-steel"
      >
        <Search className="size-4" aria-hidden />
        Find a customer
      </Link>

      <section>
        <h2 className="mb-2 font-display text-base font-semibold uppercase">Today</h2>
        <ul className="divide-y divide-border rounded-lg border border-border">
          {today.map((t) => (
            <li key={t.time} className="grid grid-cols-[auto_minmax(0,1fr)] gap-3 px-3 py-3">
              <span className="num pt-0.5 text-[12px] font-semibold text-primary">{t.time}</span>
              <span className="min-w-0">
                <Link
                  to="/sales/customers/$id"
                  params={{ id: t.id }}
                  className="block truncate text-[14px] font-semibold"
                >
                  {t.what}
                </Link>
                <span className="block truncate text-[12px] text-steel">{t.where}</span>
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2 className="mb-2 font-display text-base font-semibold uppercase">Tasks due today</h2>
        <ul className="divide-y divide-border rounded-lg border border-border">
          {[
            "Call Northgate Garage Group — reactivation",
            "Send Steel Seal case pricing to Seaforth",
            "Chase quote AB-10428",
          ].map((t) => (
            <li key={t} className="flex items-start gap-3 px-3 py-3 text-[14px]">
              <input type="checkbox" className="mt-1 size-4 accent-primary" aria-label={t} />
              {t}
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2 className="mb-2 font-display text-base font-semibold uppercase">Customers nearby</h2>
        <ul className="space-y-3">
          {nearby.map((c) => (
            <li key={c.id} className="rounded-lg border border-border bg-surface/40 p-3">
              <Link
                to="/sales/customers/$id"
                params={{ id: c.id }}
                className="block truncate text-[14px] font-semibold"
              >
                {c.company}
              </Link>
              <div className="num text-[12px] text-steel">
                {c.location} · last order {c.lastOrder} · YTD {gbp0(c.ytd)}
              </div>
              <div className="mt-2 grid grid-cols-4 gap-2 text-[12px] font-semibold">
                <a href="tel:01214960142" className="rounded-md border border-border py-2 text-center">
                  Call
                </a>
                <a href="mailto:karen.doyle@abcmotorfactors.co.uk" className="rounded-md border border-border py-2 text-center">
                  Email
                </a>
                <Link
                  to="/sales/customers/$id"
                  params={{ id: c.id }}
                  className="rounded-md border border-border py-2 text-center"
                >
                  Visit
                </Link>
                <Link
                  to="/sales/order/$id"
                  params={{ id: c.id }}
                  className="rounded-md bg-primary py-2 text-center text-primary-foreground"
                >
                  Order
                </Link>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2 className="mb-2 font-display text-base font-semibold uppercase">Quotes needing action</h2>
        <ul className="divide-y divide-border rounded-lg border border-border">
          {quotes
            .filter((q) => ["Sent", "Viewed"].includes(q.status))
            .map((q) => (
              <li key={q.id} className="grid grid-cols-[minmax(0,1fr)_auto] gap-2 px-3 py-3 text-[13px]">
                <span className="min-w-0">
                  <Link to="/quote/$id" params={{ id: q.id }} className="num block font-semibold text-primary">
                    {q.id}
                  </Link>
                  <span className="block truncate text-[12px] text-steel">
                    {q.company} · {q.status}
                  </span>
                </span>
                <span className="num self-center font-semibold">{gbp0(quoteTotal(q))}</span>
              </li>
            ))}
        </ul>
      </section>
    </div>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h2 className="mb-3 font-display text-lg font-semibold uppercase tracking-tight">{title}</h2>
      <ul className="divide-y divide-border rounded-lg border border-border">{children}</ul>
    </div>
  );
}
