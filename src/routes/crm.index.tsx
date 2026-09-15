import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { PanelHeader } from "@/components/ab/AppShell";
import { gbp0, opportunities as seed, pipelineStages, type Opportunity, type PipelineStage } from "@/lib/data";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/crm/")({
  head: () => ({
    meta: [
      { title: "Opportunity Pipeline — Automotive Brands CRM" },
      {
        name: "description",
        content:
          "Drag-and-drop sales pipeline from New Lead to Won, with value, owner, expected close, last activity and next action on every opportunity.",
      },
      { property: "og:title", content: "Opportunity Pipeline — Automotive Brands CRM" },
      { property: "og:description", content: "Move deals through nine stages with full context on each card." },
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

function Pipeline() {
  const [items, setItems] = useState<Opportunity[]>(seed);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overStage, setOverStage] = useState<PipelineStage | null>(null);

  const move = (id: string, stage: PipelineStage) =>
    setItems((prev) => prev.map((o) => (o.id === id ? { ...o, stage } : o)));

  const open = items.filter((o) => o.stage !== "Won" && o.stage !== "Lost");

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PanelHeader
        title="Opportunity Pipeline"
        sub={`${open.length} open opportunities · ${gbp0(open.reduce((s, o) => s + o.value, 0))} weighted pipeline`}
        actions={
          <button
            type="button"
            className="h-10 rounded-md bg-primary px-5 text-[13px] font-bold text-primary-foreground transition hover:brightness-110"
          >
            New opportunity
          </button>
        }
      />

      <div className="min-h-0 flex-1 overflow-x-auto p-4 sm:p-6">
        <div className="flex min-w-max gap-3">
          {pipelineStages.map((stage) => {
            const inStage = items.filter((o) => o.stage === stage);
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
                  "flex w-[272px] shrink-0 flex-col rounded-lg border border-t-2 border-border bg-surface/40 transition-colors",
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
                  {inStage.map((o) => (
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
                      )}
                    >
                      <div className="num text-[10px] font-semibold text-primary">{o.id}</div>
                      <div className="mt-0.5 text-[13px] font-semibold leading-snug">{o.company}</div>
                      <div className="text-[12px] text-steel">{o.title}</div>
                      <div className="num mt-2 font-display text-lg font-semibold">{gbp0(o.value)}</div>
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
                  ))}
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
    </div>
  );
}
