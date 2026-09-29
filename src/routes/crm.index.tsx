import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useId, useState } from "react";
import { PanelHeader } from "@/components/ab/AppShell";
import { StatusBadge } from "@/components/ab/Badges";
import { Drawer, Field, inputClass } from "@/components/ab/Drawer";
import { LogActivityDrawer } from "@/components/crm/LogActivityDrawer";
import { ROUTES } from "@/lib/app-nav";
import {
  OPEN_OPPORTUNITY_STAGES,
  OPPORTUNITY_LOST_REASONS,
  OPPORTUNITY_STAGES,
  formatOpportunityValue,
  opportunityStageLabel,
} from "@/domain/crm";
import {
  createCrmOpportunityFn,
  getCrmOpportunityFn,
  listCrmOpportunitiesFn,
  listCompaniesFn,
  updateCrmOpportunityStageFn,
} from "@/server/phase2/fns";

type Search = { opportunityId?: string; view?: string };

export const Route = createFileRoute("/crm/")({
  validateSearch: (s: Record<string, unknown>): Search => {
    const out: Search = {};
    if (typeof s["opportunityId"] === "string" && s["opportunityId"]) {
      out.opportunityId = s["opportunityId"];
    }
    if (typeof s["view"] === "string" && s["view"]) out.view = s["view"];
    return out;
  },
  head: () => ({
    meta: [
      { title: "Opportunities — CRM — Automotive Brands" },
      {
        name: "description",
        content: "Production opportunity pipeline — real database records only.",
      },
    ],
  }),
  component: OpportunitiesPage,
});

type ListData = Extract<Awaited<ReturnType<typeof listCrmOpportunitiesFn>>, { ok: true }>["data"];
type Detail = Extract<Awaited<ReturnType<typeof getCrmOpportunityFn>>, { ok: true }>["data"];

function OpportunitiesPage() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const view = search.view === "table" ? "table" : "kanban";
  const [q, setQ] = useState("");
  const [data, setData] = useState<ListData | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [logOpen, setLogOpen] = useState(false);
  const [wonLost, setWonLost] = useState<"WON" | "LOST" | null>(null);

  function reload() {
    void listCrmOpportunitiesFn({
      data: { q: q.trim() || null, stage: "OPEN", pageSize: 100 },
    }).then((r) => {
      if (!r.ok) {
        setError(r.error);
        setData(null);
      } else {
        setError(null);
        setData(r.data);
      }
    });
  }

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  useEffect(() => {
    if (!search.opportunityId) {
      setDetail(null);
      return;
    }
    void getCrmOpportunityFn({ data: { opportunityId: search.opportunityId } }).then((r) => {
      if (!r.ok) setError(r.error);
      else setDetail(r.data);
    });
  }, [search.opportunityId]);

  async function moveStage(opportunityId: string, stage: string, confirm = false) {
    if ((stage === "WON" || stage === "LOST") && !confirm) {
      void navigate({ search: { ...search, opportunityId } });
      setWonLost(stage);
      return;
    }
    const r = await updateCrmOpportunityStageFn({
      data: {
        opportunityId,
        stage,
        confirmWonLost: stage === "WON" || stage === "LOST",
        lostReason: stage === "LOST" ? "Other" : null,
      },
    });
    if (!r.ok) setError(r.error);
    else reload();
  }

  const openValueSum = data?.stageTotals.reduce((s, g) => {
    const n = g.opportunityValue != null ? Number(g.opportunityValue) : 0;
    return s + (Number.isFinite(n) ? n : 0);
  }, 0);

  return (
    <div>
      <PanelHeader
        title="Opportunities"
        sub={
          data
            ? `${data.total} open · Opportunity Value ${formatOpportunityValue(openValueSum || null)} (entered estimates only)`
            : "Production pipeline"
        }
        actions={
          <div className="flex flex-wrap gap-2">
            <div className="flex rounded-md border border-border p-0.5">
              <button
                type="button"
                className={`h-9 px-3 text-[12px] font-bold uppercase ${view === "kanban" ? "bg-primary text-primary-foreground" : "text-steel"}`}
                onClick={() => void navigate({ search: { ...search, view: "kanban" } })}
              >
                Pipeline
              </button>
              <button
                type="button"
                className={`h-9 px-3 text-[12px] font-bold uppercase ${view === "table" ? "bg-primary text-primary-foreground" : "text-steel"}`}
                onClick={() => void navigate({ search: { ...search, view: "table" } })}
              >
                Table
              </button>
            </div>
            <button
              type="button"
              onClick={() => setCreateOpen(true)}
              className="h-10 rounded-md bg-primary px-4 text-[13px] font-bold text-primary-foreground"
            >
              New opportunity
            </button>
          </div>
        }
      />

      <div className="px-4 py-3 sm:px-6">
        <input
          className="h-10 w-full max-w-md rounded-md border border-border bg-background px-3 text-sm"
          placeholder="Search opportunity or customer"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>

      {error ? (
        <p className="px-4 text-sm text-destructive sm:px-6" role="alert">
          {error}
        </p>
      ) : null}

      {!data ? (
        <p className="px-4 py-6 text-sm text-steel sm:px-6">Loading…</p>
      ) : data.items.length === 0 ? (
        <p className="mx-4 my-6 rounded-md border border-dashed border-border px-4 py-10 text-center text-sm text-steel sm:mx-6">
          No open opportunities. Create an opportunity from a customer when there is a genuine sales
          opportunity.
        </p>
      ) : view === "table" ? (
        <div className="overflow-x-auto px-4 pb-6 sm:px-6">
          <table className="w-full min-w-[800px] text-left text-[13px]">
            <thead className="text-[11px] uppercase text-steel">
              <tr>
                <th className="pb-2 pr-3">Opportunity</th>
                <th className="pb-2 pr-3">Customer</th>
                <th className="pb-2 pr-3">Owner</th>
                <th className="pb-2 pr-3">Stage</th>
                <th className="pb-2 pr-3">Value</th>
                <th className="pb-2">Expected close</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((o) => (
                <tr
                  key={o.id}
                  className="cursor-pointer border-t border-border/60 hover:bg-muted/30"
                  onClick={() => void navigate({ search: { ...search, opportunityId: o.id } })}
                >
                  <td className="py-2.5 pr-3 font-semibold">{o.title}</td>
                  <td className="py-2.5 pr-3">{o.company.name}</td>
                  <td className="py-2.5 pr-3">{o.ownerName ?? "—"}</td>
                  <td className="py-2.5 pr-3">
                    <StatusBadge>{opportunityStageLabel(o.stage)}</StatusBadge>
                  </td>
                  <td className="py-2.5 pr-3 tabular-nums">{formatOpportunityValue(o.value)}</td>
                  <td className="py-2.5 tabular-nums text-steel">
                    {o.expectedClose
                      ? new Date(o.expectedClose).toLocaleDateString("en-GB")
                      : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="flex gap-3 overflow-x-auto px-4 pb-6 sm:px-6">
          {OPEN_OPPORTUNITY_STAGES.map((stage) => {
            const cards = data.items.filter((o) => o.stage === stage);
            const total = data.stageTotals.find((t) => t.stage === stage);
            return (
              <section
                key={stage}
                className="w-[260px] shrink-0 rounded-md border border-border bg-muted/10"
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  const id = e.dataTransfer.getData("text/opportunity-id");
                  if (id) void moveStage(id, stage);
                }}
              >
                <header className="border-b border-border/70 px-3 py-2">
                  <h2 className="text-[12px] font-bold uppercase tracking-wide">
                    {opportunityStageLabel(stage)}
                  </h2>
                  <p className="text-[11px] text-steel">
                    {cards.length} · {formatOpportunityValue(total?.opportunityValue ?? null)}
                  </p>
                </header>
                <ul className="space-y-2 p-2">
                  {cards.map((o) => (
                    <li
                      key={o.id}
                      draggable
                      onDragStart={(e) => e.dataTransfer.setData("text/opportunity-id", o.id)}
                      className="cursor-grab rounded-md border border-border bg-background p-3 active:cursor-grabbing"
                      onClick={() => void navigate({ search: { ...search, opportunityId: o.id } })}
                    >
                      <p className="text-[13px] font-semibold">{o.title}</p>
                      <p className="text-[12px] text-steel">{o.company.name}</p>
                      <div className="mt-2 flex justify-between text-[11px] text-steel">
                        <span>{o.ownerName ?? "Unassigned"}</span>
                        <span className="tabular-nums">{formatOpportunityValue(o.value)}</span>
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      )}

      <Drawer
        open={Boolean(detail)}
        onClose={() =>
          void navigate({
            search: search.view ? { view: search.view } : {},
          })
        }
        title={detail?.title ?? "Opportunity"}
        {...(detail?.company.name ? { sub: detail.company.name } : {})}
        width="lg"
        footer={
          detail && detail.stage !== "WON" && detail.stage !== "LOST" ? (
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="h-10 rounded-md border border-border px-3 text-[12px] font-bold uppercase"
                onClick={() => setLogOpen(true)}
              >
                Log call
              </button>
              <Link
                to={ROUTES.salesQuotesNew}
                search={{ companyId: detail.company.id }}
                className="inline-flex h-10 items-center rounded-md border border-border px-3 text-[12px] font-bold uppercase"
              >
                Create quote
              </Link>
              <button
                type="button"
                className="h-10 rounded-md bg-primary px-3 text-[12px] font-bold uppercase text-primary-foreground"
                onClick={() => setWonLost("WON")}
              >
                Mark won
              </button>
              <button
                type="button"
                className="h-10 rounded-md border border-border px-3 text-[12px] font-bold uppercase"
                onClick={() => setWonLost("LOST")}
              >
                Mark lost
              </button>
            </div>
          ) : null
        }
      >
        {detail ? (
          <div className="space-y-4 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge>{opportunityStageLabel(detail.stage)}</StatusBadge>
              <span className="tabular-nums">{formatOpportunityValue(detail.value)}</span>
              <span className="text-[11px] text-steel">Opportunity Value (estimate)</span>
            </div>
            <label className="block">
              <span className="text-[10px] font-bold uppercase text-steel">Stage</span>
              <select
                className={`${inputClass} mt-1`}
                value={detail.stage}
                onChange={(e) => void moveStage(detail.id, e.target.value)}
              >
                {OPPORTUNITY_STAGES.map((s) => (
                  <option key={s} value={s}>
                    {opportunityStageLabel(s)}
                  </option>
                ))}
              </select>
            </label>
            <dl className="grid grid-cols-2 gap-2">
              <div>
                <dt className="text-[10px] uppercase text-steel">Customer</dt>
                <dd>
                  <Link
                    to="/sales/customers/$id"
                    params={{ id: detail.company.id }}
                    className="text-primary hover:underline"
                  >
                    {detail.company.name}
                  </Link>
                </dd>
              </div>
              <div>
                <dt className="text-[10px] uppercase text-steel">Owner</dt>
                <dd>{detail.owner?.name ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-[10px] uppercase text-steel">Expected close</dt>
                <dd>
                  {detail.expectedClose
                    ? new Date(detail.expectedClose).toLocaleDateString("en-GB")
                    : "—"}
                </dd>
              </div>
            </dl>
            {detail.description ? <p className="text-steel">{detail.description}</p> : null}

            <div>
              <h3 className="mb-2 text-[11px] font-bold uppercase text-steel">Quotes</h3>
              {detail.quotes.length === 0 ? (
                <p className="text-steel">No linked quotes.</p>
              ) : (
                <ul className="space-y-1">
                  {detail.quotes.map((q) => (
                    <li key={q.id} className="flex justify-between border-b border-border/50 py-1">
                      <Link
                        to="/sales/quotes/$quoteId"
                        params={{ quoteId: q.id }}
                        className="font-mono text-primary hover:underline"
                      >
                        {q.quoteNumber}
                      </Link>
                      <span className="tabular-nums text-steel">
                        {q.status} · {formatOpportunityValue(q.grandTotal)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div>
              <h3 className="mb-2 text-[11px] font-bold uppercase text-steel">Open tasks</h3>
              {detail.openTasks.length === 0 ? (
                <p className="text-steel">No open tasks.</p>
              ) : (
                <ul className="space-y-1">
                  {detail.openTasks.map((t) => (
                    <li key={t.id}>
                      <Link
                        to={ROUTES.crmTasks}
                        search={{ taskId: t.id }}
                        className="hover:underline"
                      >
                        {t.title}
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div>
              <h3 className="mb-2 text-[11px] font-bold uppercase text-steel">Activity</h3>
              {detail.activities.length === 0 ? (
                <p className="text-steel">No activity yet.</p>
              ) : (
                <ul className="space-y-2">
                  {detail.activities.map((a) => (
                    <li key={a.id} className="rounded border border-border/60 px-3 py-2">
                      <p className="font-medium">{a.subject}</p>
                      {a.body ? <p className="text-steel">{a.body}</p> : null}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        ) : null}
      </Drawer>

      <CreateOpportunityDrawer
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={() => {
          setCreateOpen(false);
          reload();
        }}
      />

      <LogActivityDrawer
        open={logOpen}
        onClose={() => setLogOpen(false)}
        companyId={detail?.company.id ?? null}
        opportunityId={detail?.id ?? null}
        defaultType="CALL"
        onLogged={() => {
          if (detail) {
            void getCrmOpportunityFn({ data: { opportunityId: detail.id } }).then((r) => {
              if (r.ok) setDetail(r.data);
            });
          }
        }}
      />

      {detail && wonLost ? (
        <WonLostDrawer
          mode={wonLost}
          opportunityId={detail.id}
          currentValue={detail.value}
          onClose={() => setWonLost(null)}
          onDone={() => {
            setWonLost(null);
            reload();
            void getCrmOpportunityFn({ data: { opportunityId: detail.id } }).then((r) => {
              if (r.ok) setDetail(r.data);
            });
          }}
        />
      ) : null}
    </div>
  );
}

function CreateOpportunityDrawer({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  const id = useId();
  const [companies, setCompanies] = useState<Array<{ id: string; name: string }>>([]);
  const [companyId, setCompanyId] = useState("");
  const [title, setTitle] = useState("");
  const [value, setValue] = useState("");
  const [expectedClose, setExpectedClose] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    void listCompaniesFn({ data: { q: "", pageSize: 100 } }).then((r) => {
      if (r.ok) {
        const items = (r.data as { items?: Array<{ id: string; name: string }> }).items ?? [];
        setCompanies(items.map((c) => ({ id: c.id, name: c.name })));
      }
    });
  }, [open]);

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="New opportunity"
      width="md"
      footer={
        <button
          type="button"
          className="h-11 w-full rounded-md bg-primary text-[13px] font-bold uppercase text-primary-foreground"
          onClick={() => {
            void createCrmOpportunityFn({
              data: {
                companyId,
                title,
                value: value.trim() || null,
                expectedClose: expectedClose || null,
              },
            }).then((r) => {
              if (!r.ok) setError(r.error);
              else onCreated();
            });
          }}
        >
          Create
        </button>
      }
    >
      {error ? <p className="mb-2 text-sm text-destructive">{error}</p> : null}
      <div className="space-y-3">
        <Field label="Customer" htmlFor={`${id}-co`}>
          <select
            id={`${id}-co`}
            className={inputClass}
            value={companyId}
            onChange={(e) => setCompanyId(e.target.value)}
          >
            <option value="">Select customer…</option>
            {companies.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Title" htmlFor={`${id}-title`}>
          <input id={`${id}-title`} className={inputClass} value={title} onChange={(e) => setTitle(e.target.value)} />
        </Field>
        <Field label="Opportunity value (optional estimate)" htmlFor={`${id}-val`}>
          <input id={`${id}-val`} className={inputClass} value={value} onChange={(e) => setValue(e.target.value)} placeholder="Leave blank if unknown" />
        </Field>
        <Field label="Expected close" htmlFor={`${id}-close`}>
          <input id={`${id}-close`} type="date" className={inputClass} value={expectedClose} onChange={(e) => setExpectedClose(e.target.value)} />
        </Field>
      </div>
    </Drawer>
  );
}

function WonLostDrawer({
  mode,
  opportunityId,
  currentValue,
  onClose,
  onDone,
}: {
  mode: "WON" | "LOST";
  opportunityId: string;
  currentValue: string | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const [value, setValue] = useState(currentValue ?? "");
  const [reason, setReason] = useState<string>(OPPORTUNITY_LOST_REASONS[0]!);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);

  return (
    <Drawer
      open
      onClose={onClose}
      title={mode === "WON" ? "Mark opportunity won" : "Mark opportunity lost"}
      sub="Does not create an order or quote"
      width="md"
      footer={
        <button
          type="button"
          className="h-11 w-full rounded-md bg-primary text-[13px] font-bold uppercase text-primary-foreground"
          onClick={() => {
            void updateCrmOpportunityStageFn({
              data: {
                opportunityId,
                stage: mode,
                confirmWonLost: true,
                value: mode === "WON" ? value || null : null,
                lostReason: mode === "LOST" ? reason : null,
                note,
              },
            }).then((r) => {
              if (!r.ok) setError(r.error);
              else onDone();
            });
          }}
        >
          Confirm
        </button>
      }
    >
      {error ? <p className="mb-2 text-sm text-destructive">{error}</p> : null}
      <div className="space-y-3">
        {mode === "WON" ? (
          <Field label="Final opportunity value (optional)" htmlFor="won-val">
            <input id="won-val" className={inputClass} value={value} onChange={(e) => setValue(e.target.value)} />
          </Field>
        ) : (
          <Field label="Loss reason" htmlFor="lost-r">
            <select id="lost-r" className={inputClass} value={reason} onChange={(e) => setReason(e.target.value)}>
              {OPPORTUNITY_LOST_REASONS.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </Field>
        )}
        <Field label="Note" htmlFor="wl-note">
          <textarea id="wl-note" className={inputClass} rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
      </div>
    </Drawer>
  );
}
