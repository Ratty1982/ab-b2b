import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { PanelHeader } from "@/components/ab/AppShell";
import { LogActivityDrawer } from "@/components/crm/LogActivityDrawer";
import { activityTypeLabel } from "@/domain/crm";
import { listCrmActivitiesFn } from "@/server/phase2/fns";

export const Route = createFileRoute("/crm/activities")({
  head: () => ({
    meta: [{ title: "Activities — CRM — Automotive Brands" }],
  }),
  component: CrmActivitiesPage,
});

type Data = Extract<Awaited<ReturnType<typeof listCrmActivitiesFn>>, { ok: true }>["data"];

function CrmActivitiesPage() {
  const [type, setType] = useState("ALL");
  const [q, setQ] = useState("");
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [logOpen, setLogOpen] = useState(false);

  function reload() {
    void listCrmActivitiesFn({
      data: {
        type: type === "ALL" ? "ALL" : type,
        q: q.trim() || null,
        pageSize: 50,
      },
    }).then((r) => {
      if (!r.ok) setError(r.error);
      else {
        setError(null);
        setData(r.data);
      }
    });
  }

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type, q]);

  return (
    <div>
      <PanelHeader
        title="Activities"
        sub="Relationship history — logged calls, emails, meetings and notes"
        actions={
          <button
            type="button"
            onClick={() => setLogOpen(true)}
            className="h-10 rounded-md bg-primary px-4 text-[13px] font-bold text-primary-foreground"
          >
            Log activity
          </button>
        }
      />

      <div className="flex flex-wrap gap-2 border-b border-border/70 px-4 py-3 sm:px-6">
        <input
          className="h-10 min-w-[180px] flex-1 rounded-md border border-border bg-background px-3 text-sm"
          placeholder="Search summary or customer"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <select
          className="h-10 rounded-md border border-border bg-background px-3 text-sm"
          value={type}
          onChange={(e) => setType(e.target.value)}
        >
          <option value="ALL">All types</option>
          <option value="CALL">Calls</option>
          <option value="EMAIL">Emails logged</option>
          <option value="MEETING">Meetings</option>
          <option value="NOTE">Notes</option>
          <option value="FOLLOW_UP">Follow-ups</option>
          <option value="TASK">Tasks</option>
          <option value="SYSTEM">System</option>
        </select>
      </div>

      {error ? (
        <p className="px-4 py-3 text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}

      {!data ? (
        <p className="px-4 py-6 text-sm text-steel">Loading…</p>
      ) : data.items.length === 0 ? (
        <p className="mx-4 my-6 rounded-md border border-dashed border-border px-4 py-10 text-center text-sm text-steel sm:mx-6">
          No activity recorded. Calls, meetings, notes and follow-ups will appear here.
        </p>
      ) : (
        <ul className="divide-y divide-border px-4 sm:px-6">
          {data.items.map((a) => (
            <li key={a.id} className="py-3 text-[13px]">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <div>
                  <span className="text-[11px] font-bold uppercase tracking-wide text-steel">
                    {activityTypeLabel(a.type)}
                  </span>
                  <p className="font-semibold">{a.subject ?? activityTypeLabel(a.type)}</p>
                  {a.company ? (
                    <Link
                      to="/sales/customers/$id"
                      params={{ id: a.company.id }}
                      className="text-primary hover:underline"
                    >
                      {a.company.name}
                    </Link>
                  ) : a.lead ? (
                    <Link
                      to="/crm/leads"
                      search={{ leadId: a.lead.id }}
                      className="text-primary hover:underline"
                    >
                      {a.lead.companyName}
                    </Link>
                  ) : null}
                  {a.body ? <p className="mt-1 text-steel">{a.body}</p> : null}
                </div>
                <div className="text-right text-[11px] text-steel">
                  <div>{a.actorName ?? "—"}</div>
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
              </div>
            </li>
          ))}
        </ul>
      )}

      <LogActivityDrawer open={logOpen} onClose={() => setLogOpen(false)} onLogged={reload} />
    </div>
  );
}
