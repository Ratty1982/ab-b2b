import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { PanelHeader } from "@/components/ab/AppShell";
import { StatusBadge } from "@/components/ab/Badges";
import { Drawer } from "@/components/ab/Drawer";
import { ROUTES } from "@/lib/app-nav";
import {
  siFollowupReasonLabel,
  siFollowupSourceLabel,
  type SiFollowupReason,
  type SiFollowupSourceModule,
} from "@/domain/sales-followup";
import {
  completeCrmTaskFn,
  getCrmTaskFn,
  listCrmTasksFn,
} from "@/server/phase2/fns";

type Search = { taskId?: string; source?: string };

export const Route = createFileRoute("/crm/tasks")({
  validateSearch: (search: Record<string, unknown>): Search => {
    const out: Search = {};
    if (typeof search["taskId"] === "string" && search["taskId"]) out.taskId = search["taskId"];
    if (typeof search["source"] === "string" && search["source"]) out.source = search["source"];
    return out;
  },
  head: () => ({
    meta: [
      { title: "Tasks — CRM — Automotive Brands" },
      {
        name: "description",
        content: "CRM tasks including Sales Intelligence follow-ups.",
      },
    ],
  }),
  component: CrmTasksPage,
});

type ListData = Extract<Awaited<ReturnType<typeof listCrmTasksFn>>, { ok: true }>["data"];
type TaskDetail = Extract<Awaited<ReturnType<typeof getCrmTaskFn>>, { ok: true }>["data"];

function CrmTasksPage() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const [data, setData] = useState<ListData | null>(null);
  const [detail, setDetail] = useState<TaskDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sourceFilter, setSourceFilter] = useState(search.source ?? "ALL");
  const [q, setQ] = useState("");

  useEffect(() => {
    void listCrmTasksFn({
      data: {
        q: q.trim() || null,
        sourceModule: sourceFilter === "ALL" ? "ALL" : sourceFilter,
        page: 1,
        pageSize: 50,
      },
    }).then((r) => {
      if (!r.ok) {
        setError(r.error);
        setData(null);
      } else {
        setError(null);
        setData(r.data);
      }
    });
  }, [q, sourceFilter]);

  useEffect(() => {
    if (!search.taskId) {
      setDetail(null);
      return;
    }
    void getCrmTaskFn({ data: { taskId: search.taskId } }).then((r) => {
      if (!r.ok) {
        setError(r.error);
        setDetail(null);
      } else {
        setDetail(r.data);
      }
    });
  }, [search.taskId]);

  async function completeTask() {
    if (!search.taskId) return;
    const r = await completeCrmTaskFn({ data: { taskId: search.taskId } });
    if (!r.ok) {
      setError(r.error);
      return;
    }
    const refreshed = await getCrmTaskFn({ data: { taskId: search.taskId } });
    if (refreshed.ok) setDetail(refreshed.data);
    const list = await listCrmTasksFn({
      data: { sourceModule: sourceFilter === "ALL" ? "ALL" : sourceFilter, pageSize: 50 },
    });
    if (list.ok) setData(list.data);
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PanelHeader
        title="Tasks"
        sub="CRM follow-ups including Sales Intelligence actions"
        crumbs={[{ label: "CRM" }, { label: "Tasks", to: ROUTES.crmTasks }]}
      />
      <div className="space-y-4 px-4 py-4 sm:px-6">
        {error ? (
          <p className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
            {error}
          </p>
        ) : null}
        <div className="flex flex-wrap gap-3">
          <input
            className="h-9 min-w-[200px] rounded-md border border-border px-3 text-sm"
            placeholder="Search title, customer, SKU"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <select
            className="h-9 rounded-md border border-border px-3 text-sm"
            value={sourceFilter}
            onChange={(e) => setSourceFilter(e.target.value)}
          >
            <option value="ALL">All sources</option>
            <option value="GAP_ANALYSIS">Gap Analysis</option>
            <option value="RANGE_OPPORTUNITY">Range Opportunity</option>
            <option value="SALES_ENQUIRY">Sales Enquiry</option>
            <option value="REBATE_ANALYSIS">Rebate Analysis</option>
          </select>
        </div>

        {!data ? (
          <p className="text-sm text-steel">Loading…</p>
        ) : data.total === 0 ? (
          <p className="text-sm text-steel">No open tasks match these filters.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead>
                <tr className="border-b border-border text-[10px] font-bold uppercase tracking-wide text-steel">
                  <th className="py-2 pr-3">Task</th>
                  <th className="py-2 pr-3">Customer</th>
                  <th className="py-2 pr-3">Source</th>
                  <th className="py-2 pr-3">Assignee</th>
                  <th className="py-2 pr-3">Due</th>
                  <th className="py-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((t) => (
                  <tr key={t.id} className="border-b border-border/60">
                    <td className="py-2 pr-3">
                      <button
                        type="button"
                        className="text-left font-medium text-primary hover:underline"
                        onClick={() => void navigate({ search: { taskId: t.id } })}
                      >
                        {t.title}
                      </button>
                      {t.sourceSku ? (
                        <div className="font-mono text-[11px] text-steel">{t.sourceSku}</div>
                      ) : null}
                    </td>
                    <td className="py-2 pr-3">{t.company?.name ?? "—"}</td>
                    <td className="py-2 pr-3">
                      {t.sourceLabel ? (
                        <StatusBadge tone="neutral">{t.sourceLabel}</StatusBadge>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="py-2 pr-3">{t.assigneeName ?? "—"}</td>
                    <td className="py-2 pr-3">
                      {t.dueAt
                        ? new Date(t.dueAt).toLocaleDateString("en-GB")
                        : "—"}
                    </td>
                    <td className="py-2">{t.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <Drawer
        open={Boolean(detail)}
        onClose={() => void navigate({ search: {} })}
        title={detail?.title ?? "Task"}
        {...(detail?.company?.name ? { sub: detail.company.name } : {})}
        width="lg"
        footer={
          detail && (detail.status === "OPEN" || detail.status === "IN_PROGRESS") ? (
            <button
              type="button"
              onClick={() => void completeTask()}
              className="h-11 w-full rounded-md bg-primary text-[13px] font-bold uppercase tracking-wide text-primary-foreground"
            >
              Mark completed
            </button>
          ) : null
        }
      >
        {detail ? (
          <div className="space-y-4 text-sm">
            <div className="flex flex-wrap gap-2">
              {detail.sourceLabel ? (
                <StatusBadge tone="info">Sales Intelligence · {detail.sourceLabel}</StatusBadge>
              ) : null}
              {detail.reasonLabel ? (
                <StatusBadge tone="neutral">{detail.reasonLabel}</StatusBadge>
              ) : null}
            </div>
            <p>
              Assigned to {detail.assignee?.name ?? "—"}
              {detail.dueAt
                ? ` · Due ${new Date(detail.dueAt).toLocaleDateString("en-GB")}`
                : ""}
            </p>
            {detail.snapshot ? (
              <div className="rounded-md border border-border/70 bg-muted/20 p-3">
                <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-steel">
                  Captured context
                </p>
                <p className="mt-1 font-medium">
                  {detail.snapshot.productName ?? detail.snapshot.sku ?? detail.company?.name}
                </p>
                {detail.snapshot.sku ? (
                  <p className="font-mono text-[11px] text-steel">{detail.snapshot.sku}</p>
                ) : null}
                <p className="mt-1 text-steel">
                  {siFollowupSourceLabel(detail.snapshot.sourceModule as SiFollowupSourceModule)} ·{" "}
                  {siFollowupReasonLabel(detail.snapshot.sourceReason as SiFollowupReason)}
                </p>
                <p className="text-steel">Period: {detail.snapshot.selectedPeriod.label}</p>
                {detail.snapshot.comparisonPeriod ? (
                  <p className="text-steel">
                    Comparison: {detail.snapshot.comparisonPeriod.label}
                  </p>
                ) : null}
                <dl className="mt-2 grid grid-cols-2 gap-1">
                  {Object.entries(detail.snapshot.metrics).map(([k, v]) =>
                    v == null || v === "" ? null : (
                      <div key={k}>
                        <dt className="text-[10px] uppercase text-steel">{k}</dt>
                        <dd className="tabular-nums">{String(v)}</dd>
                      </div>
                    ),
                  )}
                </dl>
                {detail.deepLinkPath ? (
                  <a
                    href={detail.deepLinkPath}
                    className="mt-3 inline-block text-[11px] font-bold uppercase tracking-wide text-primary"
                  >
                    View Sales Intelligence
                  </a>
                ) : null}
                <p className="mt-2 text-[11px] text-steel">
                  Captured context is a snapshot from task creation. Live analysis may differ.
                </p>
              </div>
            ) : detail.description ? (
              <pre className="whitespace-pre-wrap text-[13px] text-steel">{detail.description}</pre>
            ) : null}
          </div>
        ) : null}
      </Drawer>
    </div>
  );
}
