import { createFileRoute, Link } from "@tanstack/react-router";
import { PanelHeader, Metric } from "@/components/ab/AppShell";
import { StatusBadge } from "@/components/ab/Badges";
import { customers, gbp0, opportunities, pipelineStages } from "@/lib/data";

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

      <div className="grid gap-px bg-border sm:grid-cols-2 lg:grid-cols-4">
        <Metric label="My sales MTD" value={gbp0(mtd)} tone="brand" hint={`${Math.round((mtd / target) * 100)}% of ${gbp0(target)} target`} />
        <Metric label="Pipeline value" value={gbp0(pipelineValue)} hint={`${opportunities.length} open opportunities`} />
        <Metric label="Open quotes" value={gbp0(14380)} tone="warn" hint="4 awaiting follow-up" />
        <Metric label="Orders this month" value="47" hint={`Avg order ${gbp0(742)}`} />
      </div>

      <div className="grid gap-6 p-4 sm:p-6 xl:grid-cols-3">
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

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h2 className="mb-3 font-display text-lg font-semibold uppercase tracking-tight">{title}</h2>
      <ul className="divide-y divide-border rounded-lg border border-border">{children}</ul>
    </div>
  );
}
