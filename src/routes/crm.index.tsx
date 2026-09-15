import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Flame, Snowflake } from "lucide-react";
import { PanelHeader } from "@/components/ab/AppShell";
import { StatusBadge } from "@/components/ab/Badges";
import { Drawer, Field, inputClass } from "@/components/ab/Drawer";
import {
  activities,
  brands,
  customers,
  gbp,
  gbp0,
  opportunities as seed,
  pipelineStages,
  type Opportunity,
  type PipelineStage,
} from "@/lib/data";
import { opportunityDetail, quotes, quoteTotal, salesTeam } from "@/lib/crm-data";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/crm/")({
  head: () => ({
    meta: [
      { title: "Opportunity Pipeline — Automotive Brands CRM" },
      {
        name: "description",
        content:
          "Kanban sales pipeline from New Lead to Won with value, owner, expected close, last activity, next action and staleness on every card.",
      },
      { property: "og:title", content: "Opportunity Pipeline — Automotive Brands CRM" },
      {
        property: "og:description",
        content: "Move deals through nine stages with full context on each card.",
      },
    ],
  }),
  component: Pipeline,
});

const stageTone: Partial<Record<PipelineStage, string>> = {
  Won: "border-t-good",
  Lost: "border-t-destructive",
  "Quote Sent": "border-t-cyan",
  Negotiation: "border-t-warn",
};

const valueBands = [
  { label: "Any value", min: 0 },
  { label: "£5k+", min: 5000 },
  { label: "£10k+", min: 10000 },
  { label: "£25k+", min: 25000 },
];

function staleDays(lastActivity: string) {
  if (/yesterday/i.test(lastActivity)) return 1;
  if (/today/i.test(lastActivity)) return 0;
  const n = Number(lastActivity.replace(/\D/g, ""));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function Pipeline() {
  const [items, setItems] = useState<Opportunity[]>(seed);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overStage, setOverStage] = useState<PipelineStage | null>(null);
  const [selected, setSelected] = useState<Opportunity | null>(null);

  const [owner, setOwner] = useState("All representatives");
  const [brand, setBrand] = useState("All brands");
  const [band, setBand] = useState(0);
  const [activity, setActivity] = useState("All activity");
  const [closeBy, setCloseBy] = useState("Any date");

  const move = (id: string, stage: PipelineStage) =>
    setItems((prev) => prev.map((o) => (o.id === id ? { ...o, stage } : o)));

  const filtered = useMemo(
    () =>
      items.filter((o) => {
        if (owner !== "All representatives" && !owner.startsWith(o.owner.replace(" ", "").slice(0, 4)))
          if (!owner.toLowerCase().startsWith(o.owner.split(" ")[0]!.toLowerCase())) return false;
        if (brand !== "All brands" && !o.title.toLowerCase().includes(brand.toLowerCase())) return false;
        if (o.value < band) return false;
        const days = staleDays(o.lastActivity);
        if (activity === "Active (last 7 days)" && days > 7) return false;
        if (activity === "Stale (7+ days)" && days <= 7) return false;
        if (closeBy === "This month" && !/Sep 2026/.test(o.close)) return false;
        if (closeBy === "This quarter" && !/(Sep|Oct|Nov) 2026/.test(o.close)) return false;
        return true;
      }),
    [items, owner, brand, band, activity, closeBy],
  );

  const open = filtered.filter((o) => o.stage !== "Won" && o.stage !== "Lost");

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PanelHeader
        title="Opportunity Pipeline"
        sub={`${open.length} open opportunities · ${gbp0(open.reduce((s, o) => s + o.value, 0))} pipeline value`}
        actions={
          <button
            type="button"
            className="h-10 rounded-md bg-primary px-5 text-[13px] font-bold uppercase tracking-wide text-primary-foreground transition hover:brightness-110"
          >
            New opportunity
          </button>
        }
      />

      <div className="flex flex-wrap gap-2 border-b border-border/70 px-4 py-3 sm:px-6">
        <Select
          label="Representative"
          value={owner}
          onChange={setOwner}
          options={["All representatives", ...salesTeam.map((s) => s.name)]}
        />
        <Select label="Brand" value={brand} onChange={setBrand} options={["All brands", ...brands.map((b) => b.name)]} />
        <Select
          label="Value"
          value={valueBands.find((v) => v.min === band)!.label}
          onChange={(v) => setBand(valueBands.find((x) => x.label === v)?.min ?? 0)}
          options={valueBands.map((v) => v.label)}
        />
        <Select
          label="Activity"
          value={activity}
          onChange={setActivity}
          options={["All activity", "Active (last 7 days)", "Stale (7+ days)"]}
        />
        <Select
          label="Expected close"
          value={closeBy}
          onChange={setCloseBy}
          options={["Any date", "This month", "This quarter"]}
        />
      </div>

      <div className="min-h-0 flex-1 overflow-x-auto p-4 sm:p-6">
        <div className="flex min-w-max gap-3">
          {pipelineStages.map((stage) => {
            const inStage = filtered.filter((o) => o.stage === stage);
            const value = inStage.reduce((s, o) => s + o.value, 0);
            return (
              <section
                key={stage}
                onDragOver={(e) => {
                  e.preventDefault();
                  setOverStage(stage);
                }}
                onDragLeave={() => setOverStage((s) => (s === stage ? null : s))}
                onDrop={(e) => {
                  e.preventDefault();
                  if (dragId) move(dragId, stage);
                  setDragId(null);
                  setOverStage(null);
                }}
                className={cn(
                  "flex w-[276px] shrink-0 flex-col rounded-lg border border-t-2 border-border bg-surface/40 transition-colors",
                  stageTone[stage] ?? "border-t-steel/50",
                  overStage === stage && "border-primary bg-primary/5",
                )}
              >
                <header className="border-b border-border/70 px-3 py-2.5">
                  <h2 className="text-[11px] font-bold uppercase tracking-[0.12em]">{stage}</h2>
                  <p className="num mt-0.5 text-[11px] text-steel">
                    {inStage.length} · {gbp0(value)}
                  </p>
                </header>

                <ul className="flex flex-1 flex-col gap-2 p-2">
                  {inStage.map((o) => {
                    const days = staleDays(o.lastActivity);
                    const stale = days >= 7;
                    return (
                      <li
                        key={o.id}
                        draggable
                        onDragStart={() => setDragId(o.id)}
                        onDragEnd={() => {
                          setDragId(null);
                          setOverStage(null);
                        }}
                        className={cn(
                          "cursor-grab rounded-md border border-border bg-ink p-3 active:cursor-grabbing",
                          dragId === o.id && "opacity-40",
                          stale && "border-l-2 border-l-warn",
                        )}
                      >
                        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-2">
                          <button
                            type="button"
                            onClick={() => setSelected(o)}
                            className="min-w-0 text-left"
                          >
                            <span className="num block text-[10px] font-semibold text-primary">
                              {o.id}
                            </span>
                            <span className="mt-0.5 block truncate text-[13px] font-semibold leading-snug">
                              {o.company}
                            </span>
                            <span className="block truncate text-[12px] text-steel">{o.title}</span>
                          </button>
                          <span
                            title={stale ? `No activity for ${days} days` : "Recently active"}
                            className={cn("shrink-0", stale ? "text-warn" : "text-good")}
                          >
                            {stale ? (
                              <Snowflake className="size-3.5" aria-hidden />
                            ) : (
                              <Flame className="size-3.5" aria-hidden />
                            )}
                            <span className="sr-only">
                              {stale ? `Stale — ${days} days without activity` : "Active"}
                            </span>
                          </span>
                        </div>
                        <div className="num mt-2 font-display text-lg font-semibold">
                          {gbp0(o.value)}
                        </div>
                        <dl className="mt-2 space-y-0.5 text-[11px] text-steel">
                          <div className="flex justify-between gap-2">
                            <dt>Owner</dt>
                            <dd>{o.owner}</dd>
                          </div>
                          <div className="flex justify-between gap-2">
                            <dt>Close</dt>
                            <dd className="num">{o.close}</dd>
                          </div>
                          <div className="flex justify-between gap-2">
                            <dt>Last activity</dt>
                            <dd>{o.lastActivity}</dd>
                          </div>
                        </dl>
                        <p className="mt-2 border-t border-border/70 pt-2 text-[11px] text-cyan">
                          {o.nextAction}
                        </p>
                        <label className="sr-only" htmlFor={`stage-${o.id}`}>
                          Move {o.id} to stage
                        </label>
                        <select
                          id={`stage-${o.id}`}
                          value={o.stage}
                          onChange={(e) => move(o.id, e.target.value as PipelineStage)}
                          className="mt-2 h-8 w-full rounded-sm border border-border bg-surface px-2 text-[11px]"
                        >
                          {pipelineStages.map((s) => (
                            <option key={s} value={s}>
                              {s}
                            </option>
                          ))}
                        </select>
                      </li>
                    );
                  })}
                  {inStage.length === 0 ? (
                    <li className="rounded-md border border-dashed border-border/70 px-3 py-6 text-center text-[11px] text-steel">
                      Drop an opportunity here
                    </li>
                  ) : null}
                </ul>
              </section>
            );
          })}
        </div>
      </div>

      <OpportunityDrawer opportunity={selected} onClose={() => setSelected(null)} />
    </div>
  );
}

function Select({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: string[];
}) {
  return (
    <label className="flex items-center gap-2 text-[11px] uppercase tracking-[0.12em] text-steel">
      {label}
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-9 rounded-md border border-border bg-ink px-2 text-[12px] normal-case tracking-normal text-foreground"
      >
        {options.map((o) => (
          <option key={o}>{o}</option>
        ))}
      </select>
    </label>
  );
}

function OpportunityDrawer({
  opportunity,
  onClose,
}: {
  opportunity: Opportunity | null;
  onClose: () => void;
}) {
  if (!opportunity) return null;
  const customer = customers.find((c) => c.company === opportunity.company);
  const related = quotes.filter((q) => q.company === opportunity.company);

  return (
    <Drawer
      open
      onClose={onClose}
      width="xl"
      title={`${opportunity.id} — ${opportunity.company}`}
      sub={opportunity.title}
      footer={
        <div className="flex flex-wrap gap-2">
          <button className="h-11 flex-1 rounded-md bg-primary text-[13px] font-bold uppercase tracking-wide text-primary-foreground" type="button">
            Log next action
          </button>
          <Link
            to="/sales/quotes/new"
            search={{ customer: customer?.id ?? "abc-motor-factors" }}
            className="inline-flex h-11 items-center rounded-md border border-border px-5 text-[13px] font-semibold"
          >
            Create quote
          </Link>
          {customer ? (
            <Link
              to="/sales/customers/$id"
              params={{ id: customer.id }}
              className="inline-flex h-11 items-center rounded-md border border-border px-5 text-[13px] font-semibold"
            >
              Open customer
            </Link>
          ) : null}
        </div>
      }
    >
      <div className="grid gap-px bg-border sm:grid-cols-3">
        {[
          ["Value", gbp0(opportunity.value)],
          ["Probability", `${opportunityDetail.probability}%`],
          ["Weighted", gbp0((opportunity.value * opportunityDetail.probability) / 100)],
        ].map(([k, v]) => (
          <div key={k} className="bg-surface/60 px-3 py-2.5">
            <div className="text-[10px] uppercase tracking-[0.14em] text-steel">{k}</div>
            <div className="num font-display text-xl font-semibold">{v}</div>
          </div>
        ))}
      </div>

      <dl className="mt-5 divide-y divide-border rounded-lg border border-border text-[13px]">
        {[
          ["Stage", opportunity.stage],
          ["Owner", opportunity.owner],
          ["Primary contact", opportunityDetail.primaryContact],
          ["Expected close", opportunity.close],
          ["Source", opportunityDetail.source],
          ["Competitor", opportunityDetail.competitor],
          ["Brands involved", opportunityDetail.brandsInvolved.join(", ")],
          ["Ranges involved", opportunityDetail.rangesInvolved.join(", ")],
          ["Last activity", opportunity.lastActivity],
          ["Next action", opportunity.nextAction],
        ].map(([k, v]) => (
          <div key={k} className="grid grid-cols-[140px_minmax(0,1fr)] gap-3 px-3 py-2.5">
            <dt className="text-steel">{k}</dt>
            <dd className="font-medium">{v}</dd>
          </div>
        ))}
      </dl>

      <section className="mt-6">
        <h3 className="mb-2 font-display text-base font-semibold uppercase">Related quotes</h3>
        <ul className="divide-y divide-border rounded-lg border border-border text-[13px]">
          {related.length ? (
            related.map((q) => (
              <li key={q.id} className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-3 px-3 py-2.5">
                <Link to="/quote/$id" params={{ id: q.id }} className="num text-primary">
                  {q.id}
                </Link>
                <StatusBadge tone={q.status === "Accepted" ? "good" : "brand"}>{q.status}</StatusBadge>
                <span className="num font-semibold">{gbp(quoteTotal(q))}</span>
              </li>
            ))
          ) : (
            <li className="px-3 py-6 text-center text-steel">No quotes raised yet</li>
          )}
        </ul>
      </section>

      <section className="mt-6">
        <h3 className="mb-2 font-display text-base font-semibold uppercase">Tasks</h3>
        <ul className="divide-y divide-border rounded-lg border border-border text-[13px]">
          {[
            { t: opportunity.nextAction, d: "18 Sep 2026" },
            { t: "Confirm volumes with buyer", d: "24 Sep 2026" },
          ].map((x) => (
            <li key={x.t} className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 px-3 py-2.5">
              <input type="checkbox" className="accent-primary" aria-label={x.t} />
              <span className="min-w-0 truncate">{x.t}</span>
              <span className="num text-[12px] text-steel">Due {x.d}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="mt-6">
        <h3 className="mb-2 font-display text-base font-semibold uppercase">Activity timeline</h3>
        <ol className="relative border-l border-border pl-5">
          {activities.slice(0, 5).map((a) => (
            <li key={a.when + a.body} className="mb-4 last:mb-0">
              <span className="absolute -left-[5px] mt-1.5 size-2.5 rounded-full bg-primary" aria-hidden />
              <div className="num text-[11px] text-steel">
                {a.when} · {a.type} · {a.who}
              </div>
              <p className="text-[13px]">{a.body}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="mt-6">
        <Field label="Add a note to this opportunity">
          <textarea rows={3} className={inputClass} placeholder="Buyer wants to see case pricing before committing." />
        </Field>
      </section>
    </Drawer>
  );
}
