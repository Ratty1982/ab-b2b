import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { PanelHeader, Metric } from "@/components/ab/AppShell";
import { StatusBadge } from "@/components/ab/Badges";
import { ROUTES } from "@/lib/app-nav";
import {
  activityTypeLabel,
  formatOpportunityValue,
  leadStatusLabel,
  opportunityStageLabel,
} from "@/domain/crm";
import { getCrmOverviewFn } from "@/server/phase2/fns";

export const Route = createFileRoute("/crm/overview")({
  head: () => ({
    meta: [
      { title: "CRM Overview — Automotive Brands" },
      { name: "description", content: "My Day workspace for Sales CRM." },
    ],
  }),
  component: CrmOverviewPage,
});

type Data = Extract<Awaited<ReturnType<typeof getCrmOverviewFn>>, { ok: true }>["data"];

function CrmOverviewPage() {
  const [view, setView] = useState<"MY" | "TEAM">("MY");
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void getCrmOverviewFn({ data: { view } }).then((r) => {
      if (!r.ok) {
        setError(r.error);
        setData(null);
      } else {
        setError(null);
        setData(r.data);
      }
    });
  }, [view]);

  return (
    <div>
      <PanelHeader
        title="CRM Overview"
        sub="My Day — real tasks, opportunities and activity in your scope"
        actions={
          data?.canTeamView ? (
            <div className="flex gap-1 rounded-md border border-border p-0.5">
              {(["MY", "TEAM"] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setView(v)}
                  className={`h-9 rounded px-3 text-[12px] font-bold uppercase tracking-wide ${
                    view === v ? "bg-primary text-primary-foreground" : "text-steel"
                  }`}
                >
                  {v === "MY" ? "My view" : "Team"}
                </button>
              ))}
            </div>
          ) : null
        }
      />

      {error ? (
        <p className="px-4 py-3 text-sm text-destructive sm:px-6" role="alert">
          {error}
        </p>
      ) : null}

      {!data ? (
        <p className="px-4 py-6 text-sm text-steel sm:px-6">Loading…</p>
      ) : (
        <>
          <div className="grid gap-px bg-border sm:grid-cols-2 lg:grid-cols-4">
            <Metric label="Tasks due today" value={String(data.counts.tasksDueToday)} />
            <Metric
              label="Overdue tasks"
              value={String(data.counts.overdueTasks)}
              {...(data.counts.overdueTasks > 0 ? { tone: "warn" as const } : {})}
            />
            <Metric label="Open opportunities" value={String(data.counts.openOpportunities)} />
            <Metric label="Active leads" value={String(data.counts.activeLeads)} />
          </div>

          <div className="grid gap-6 p-4 sm:p-6 xl:grid-cols-3">
            <section className="space-y-4 xl:col-span-2">
              <h2 className="font-display text-lg font-semibold uppercase tracking-tight">My Day</h2>
              <TaskBlock title="Overdue" empty="No overdue tasks" items={data.myDay.overdue} />
              <TaskBlock title="Due today" empty="Nothing due today — you're up to date." items={data.myDay.dueToday} />
              <TaskBlock title="Upcoming" empty="No upcoming tasks in the next week" items={data.myDay.upcoming} />

              <div>
                <div className="mb-2 flex items-center justify-between">
                  <h2 className="font-display text-lg font-semibold uppercase tracking-tight">
                    Active opportunities
                  </h2>
                  <Link to={ROUTES.crm} className="text-[12px] font-bold uppercase text-primary">
                    View all
                  </Link>
                </div>
                {data.opportunities.length === 0 ? (
                  <p className="rounded-md border border-dashed border-border px-4 py-8 text-sm text-steel">
                    No open opportunities. Create one from a customer when there is a genuine sales
                    opportunity.
                  </p>
                ) : (
                  <ul className="divide-y divide-border rounded-md border border-border">
                    {data.opportunities.map((o) => (
                      <li key={o.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5 text-[13px]">
                        <div>
                          <Link
                            to={ROUTES.crm}
                            search={{ opportunityId: o.id }}
                            className="font-semibold hover:underline"
                          >
                            {o.title}
                          </Link>
                          <p className="text-steel">{o.company.name}</p>
                        </div>
                        <div className="text-right">
                          <StatusBadge>{opportunityStageLabel(o.stage)}</StatusBadge>
                          <p className="mt-1 tabular-nums text-steel">
                            {formatOpportunityValue(o.value)}
                          </p>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </section>

            <aside className="space-y-6">
              <div>
                <div className="mb-2 flex items-center justify-between">
                  <h2 className="font-display text-base font-semibold uppercase tracking-tight">
                    Recent activity
                  </h2>
                  <Link to="/crm/activities" className="text-[12px] font-bold uppercase text-primary">
                    Feed
                  </Link>
                </div>
                {data.recentActivity.length === 0 ? (
                  <p className="rounded-md border border-dashed border-border px-3 py-6 text-sm text-steel">
                    No activity recorded. Calls, meetings, notes and follow-ups will appear here.
                  </p>
                ) : (
                  <ul className="space-y-2">
                    {data.recentActivity.map((a) => (
                      <li key={a.id} className="rounded-md border border-border/70 px-3 py-2 text-[13px]">
                        <div className="flex justify-between gap-2 text-[11px] text-steel">
                          <span>{activityTypeLabel(a.type)}</span>
                          <time dateTime={a.occurredAt}>
                            {new Date(a.occurredAt).toLocaleString("en-GB", {
                              day: "2-digit",
                              month: "2-digit",
                              year: "numeric",
                              hour: "2-digit",
                              minute: "2-digit",
                              hour12: false,
                              timeZone: "Europe/London",
                            })}
                          </time>
                        </div>
                        <p className="font-medium">{a.subject ?? activityTypeLabel(a.type)}</p>
                        {a.company ? <p className="text-steel">{a.company.name}</p> : null}
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div>
                <div className="mb-2 flex items-center justify-between">
                  <h2 className="font-display text-base font-semibold uppercase tracking-tight">
                    Recent leads
                  </h2>
                  <Link to="/crm/leads" className="text-[12px] font-bold uppercase text-primary">
                    Leads
                  </Link>
                </div>
                {data.recentLeads.length === 0 ? (
                  <p className="rounded-md border border-dashed border-border px-3 py-6 text-sm text-steel">
                    No leads assigned to you.
                  </p>
                ) : (
                  <ul className="space-y-2">
                    {data.recentLeads.map((l) => (
                      <li key={l.id} className="rounded-md border border-border/70 px-3 py-2 text-[13px]">
                        <Link
                          to="/crm/leads"
                          search={{ leadId: l.id }}
                          className="font-semibold hover:underline"
                        >
                          {l.companyName}
                        </Link>
                        <p className="text-steel">
                          {leadStatusLabel(l.status)}
                          {l.contactName ? ` · ${l.contactName}` : ""}
                        </p>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </aside>
          </div>
        </>
      )}
    </div>
  );
}

function TaskBlock({
  title,
  empty,
  items,
}: {
  title: string;
  empty: string;
  items: Array<{
    id: string;
    title: string;
    dueAt: string | null;
    company: { id: string; name: string } | null;
    sourceModule: string | null;
  }>;
}) {
  return (
    <div>
      <h3 className="mb-2 text-[12px] font-bold uppercase tracking-[0.14em] text-steel">{title}</h3>
      {items.length === 0 ? (
        <p className="rounded-md border border-dashed border-border px-3 py-4 text-sm text-steel">
          {empty}
        </p>
      ) : (
        <ul className="divide-y divide-border rounded-md border border-border">
          {items.map((t) => (
            <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-[13px]">
              <div>
                <Link
                  to={ROUTES.crmTasks}
                  search={{ taskId: t.id }}
                  className="font-semibold hover:underline"
                >
                  {t.title}
                </Link>
                {t.company ? <p className="text-steel">{t.company.name}</p> : null}
              </div>
              <div className="flex items-center gap-2">
                {t.sourceModule ? (
                  <span className="rounded border border-border px-1.5 py-0.5 text-[10px] font-bold uppercase text-steel">
                    Sales Intelligence
                  </span>
                ) : null}
                <span className="tabular-nums text-steel">
                  {t.dueAt ? new Date(t.dueAt).toLocaleDateString("en-GB") : "—"}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
