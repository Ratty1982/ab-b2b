import { useCallback, useEffect, useId, useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  getProductAutopartCostFn,
  getProductAutopartCostHistoryFn,
} from "@/server/phase2/fns";
import { formatDate, formatDateTime } from "@/lib/datetime";
import { cn } from "@/lib/utils";
import {
  productCostAccordionDefaultOpen,
  shouldRenderCostHistoryChart,
} from "@/domain/product-cost-history";

type CostPos = Extract<Awaited<ReturnType<typeof getProductAutopartCostFn>>, { ok: true }>["data"];
type History = Extract<
  Awaited<ReturnType<typeof getProductAutopartCostHistoryFn>>,
  { ok: true }
>["data"];

type HistoryRange = "30d" | "90d" | "12m" | "all";

function gbp(v: string | null | undefined, places = 4) {
  if (v == null || v === "") return "—";
  const n = Number(v);
  if (!Number.isFinite(n)) return `£${v}`;
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
    minimumFractionDigits: Math.min(2, places),
    maximumFractionDigits: places,
  }).format(n);
}

function formatDay(isoDate: string) {
  const [y, m, d] = isoDate.split("-").map(Number);
  if (!y || !m || !d) return isoDate;
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(y, m - 1, d)));
}

function changeLabel(change: NonNullable<NonNullable<CostPos>["change"]>) {
  const abs = `${change.absolute.startsWith("-") ? "" : "+"}${gbp(change.absolute)}`;
  const pct = change.percent != null ? ` / ${change.percent}%` : "";
  return `${abs}${pct}`;
}

type Presentation = "accordion" | "panel";

/**
 * Autopart Cost Intelligence for a single product variant.
 * - presentation="accordion" (product workspace): compact collapsed summary by default
 * - presentation="panel" (Cost Intelligence drill): always-open detail (unchanged workspace UX)
 */
export function AutopartProductCostPanel({
  variantId,
  presentation = "panel",
}: {
  variantId: string;
  presentation?: Presentation;
}) {
  const panelId = useId();
  const contentId = `${panelId}-content`;
  const [pos, setPos] = useState<CostPos | null | undefined>(undefined);
  const [history, setHistory] = useState<History | null>(null);
  const [range, setRange] = useState<HistoryRange>("90d");
  const [denied, setDenied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(
    presentation === "accordion" ? productCostAccordionDefaultOpen() : true,
  );

  const load = useCallback(async () => {
    setError(null);
    const [p, h] = await Promise.all([
      getProductAutopartCostFn({ data: { variantId } }),
      getProductAutopartCostHistoryFn({ data: { variantId, range } }),
    ]);
    if (!p.ok) {
      if (/forbidden|permission|cost/i.test(p.error)) {
        setDenied(true);
        setPos(null);
        return;
      }
      setError(p.error);
      setPos(null);
      return;
    }
    setDenied(false);
    setPos(p.data);
    if (h.ok) setHistory(h.data);
  }, [variantId, range]);

  useEffect(() => {
    void load();
  }, [load]);

  if (denied) return null;
  if (pos === undefined) {
    return (
      <section className="mt-8 border border-border bg-surface/30 p-4">
        <h3 className="font-display text-base uppercase">Autopart cost intelligence</h3>
        <p className="mt-2 text-[13px] text-steel">Loading…</p>
      </section>
    );
  }

  const detail = (
    <CostDetailBody
      pos={pos}
      history={history}
      range={range}
      setRange={setRange}
      error={error}
    />
  );

  if (presentation !== "accordion") {
    return (
      <section className="mt-8 border border-border bg-surface/30 p-5">
        <h3 className="font-display text-base uppercase">Autopart cost intelligence</h3>
        <p className="mt-1 text-[12px] text-steel">
          Internal Latest Cost from 231PO3NEW. Never shown to trade customers. Not used for sell
          prices.
        </p>
        {detail}
      </section>
    );
  }

  return (
    <section className="mt-8 border border-border bg-surface/30">
      <h3 className="sr-only">Autopart cost intelligence</h3>
      <button
        type="button"
        className={cn(
          "flex w-full items-center gap-3 px-4 py-3 text-left transition-colors",
          "hover:bg-surface/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
        )}
        aria-expanded={open}
        aria-controls={contentId}
        onClick={() => setOpen((v) => !v)}
      >
        <div className="min-w-0 flex-1">
          <p className="font-display text-[12px] font-semibold uppercase tracking-wide text-steel">
            Autopart cost intelligence
          </p>
          {!pos ? (
            <p className="mt-1 text-[13px] text-steel">No Autopart cost observed yet</p>
          ) : (
            <div className="mt-1.5 flex flex-wrap items-baseline gap-x-5 gap-y-1 text-[13px]">
              <span>
                <span className="text-[11px] uppercase tracking-wide text-steel">Latest Cost </span>
                <span className="font-semibold tabular-nums">{gbp(pos.latestCost)}</span>
              </span>
              <span>
                <span className="text-[11px] uppercase tracking-wide text-steel">Last Change </span>
                <span className="font-semibold">
                  {pos.lastChangedAt
                    ? formatDate(pos.lastChangedAt) ?? "—"
                    : formatDate(pos.firstObservedAt) ?? "—"}
                </span>
              </span>
              {pos.previousCost && pos.change && pos.change.direction !== "flat" ? (
                <span className="tabular-nums text-steel">
                  Previous {gbp(pos.previousCost)}{" "}
                  <span className="font-semibold text-foreground">{changeLabel(pos.change)}</span>
                </span>
              ) : null}
            </div>
          )}
        </div>
        <span className="shrink-0 text-[11px] font-bold uppercase tracking-wide text-steel">
          {open ? "Hide history ▴" : "View history ▾"}
        </span>
      </button>

      <div
        id={contentId}
        hidden={!open}
        className="border-t border-border px-4 pb-4 pt-3"
      >
        <p className="text-[12px] text-steel">
          Internal Latest Cost from 231PO3NEW. Never shown to trade customers. Not used for sell
          prices.
        </p>
        {detail}
      </div>
    </section>
  );
}

function CostDetailBody({
  pos,
  history,
  range,
  setRange,
  error,
}: {
  pos: CostPos | null;
  history: History | null;
  range: "30d" | "90d" | "12m" | "all";
  setRange: (r: "30d" | "90d" | "12m" | "all") => void;
  error: string | null;
}) {
  if (error) return <p className="mt-3 text-[13px] text-bad">{error}</p>;

  if (!pos) {
    return (
      <p className="mt-4 text-[13px] text-steel">
        No Autopart cost observed yet. Cost history begins after the next successful 231PO3NEW
        stock sync.
      </p>
    );
  }

  const movements = history?.points ?? [];
  const showChart = shouldRenderCostHistoryChart(
    movements.map((p) => ({
      businessDate: p.businessDate,
      firstObservedDate: p.firstObservedDate ?? p.businessDate,
      lastObservedDate: p.lastObservedDate ?? p.businessDate,
      latestCost: p.latestCost,
      changeFromPrevious: p.changeFromPrevious,
    })),
  );
  const single = movements.length === 1 ? movements[0]! : null;

  return (
    <>
      <dl className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4 text-[13px]">
        <div>
          <dt className="text-[11px] uppercase tracking-wide text-steel">Latest Autopart cost</dt>
          <dd className="font-semibold tabular-nums">{gbp(pos.latestCost)}</dd>
        </div>
        <div>
          <dt className="text-[11px] uppercase tracking-wide text-steel">Previous cost</dt>
          <dd className="font-semibold tabular-nums">{gbp(pos.previousCost)}</dd>
        </div>
        <div>
          <dt className="text-[11px] uppercase tracking-wide text-steel">Change</dt>
          <dd className="font-semibold tabular-nums">
            {pos.change ? changeLabel(pos.change) : "—"}
          </dd>
        </div>
        <div>
          <dt className="text-[11px] uppercase tracking-wide text-steel">Last changed</dt>
          <dd className="font-semibold">
            {pos.lastChangedAt ? formatDateTime(pos.lastChangedAt) : "—"}
          </dd>
        </div>
        <div>
          <dt className="text-[11px] uppercase tracking-wide text-steel">Last updated</dt>
          <dd className="font-semibold">{formatDateTime(pos.lastObservedAt)}</dd>
        </div>
        <div>
          <dt className="text-[11px] uppercase tracking-wide text-steel">First observed</dt>
          <dd className="font-semibold">{formatDateTime(pos.firstObservedAt)}</dd>
        </div>
      </dl>

      <div className="mt-6 flex flex-wrap gap-2">
        {(
          [
            ["30d", "30 days"],
            ["90d", "90 days"],
            ["12m", "12 months"],
            ["all", "All"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setRange(id)}
            className={
              range === id
                ? "h-8 rounded-md bg-primary px-3 text-[11px] font-bold uppercase text-primary-foreground"
                : "h-8 rounded-md border border-border px-3 text-[11px] font-bold uppercase text-steel"
            }
          >
            {label}
          </button>
        ))}
      </div>

      <div className="mt-4">
        {showChart ? (
          <div className="h-56 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart
                data={movements.map((p) => ({
                  ...p,
                  costNum: Number(p.latestCost),
                }))}
                margin={{ top: 8, right: 12, left: 0, bottom: 0 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis
                  dataKey="businessDate"
                  tickFormatter={formatDay}
                  tick={{ fontSize: 11 }}
                  stroke="hsl(var(--steel))"
                />
                <YAxis
                  tickFormatter={(v) => `£${Number(v).toFixed(2)}`}
                  tick={{ fontSize: 11 }}
                  stroke="hsl(var(--steel))"
                  width={56}
                  domain={["auto", "auto"]}
                />
                <Tooltip
                  formatter={(value) => gbp(String(value))}
                  labelFormatter={(label) => formatDay(String(label))}
                />
                <Line
                  type="linear"
                  dataKey="costNum"
                  name="Latest cost"
                  stroke="hsl(var(--primary))"
                  strokeWidth={2}
                  dot={{ r: 3 }}
                  connectNulls={false}
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <div className="rounded-md border border-dashed border-border px-4 py-5 text-[13px] text-steel">
            {single ? (
              <>
                No cost changes recorded yet.
                <br />
                Current cost {gbp(single.latestCost)}, first observed{" "}
                {formatDay(single.firstObservedDate ?? single.businessDate)}
                {(single.lastObservedDate ?? single.businessDate) !==
                (single.firstObservedDate ?? single.businessDate)
                  ? `, last observed ${formatDay(single.lastObservedDate ?? single.businessDate)}`
                  : null}
                .
              </>
            ) : (
              (history?.emptyReason ?? "No cost history")
            )}
          </div>
        )}
      </div>

      {movements.length ? (
        <table className="mt-4 w-full text-left text-[13px]">
          <thead>
            <tr className="border-b border-border text-[11px] uppercase text-steel">
              <th className="py-2">Cost</th>
              <th className="py-2">First observed</th>
              <th className="py-2">Last observed</th>
              <th className="py-2 text-right">Change</th>
            </tr>
          </thead>
          <tbody>
            {[...movements].reverse().slice(0, 30).map((p) => (
              <tr
                key={`${p.firstObservedDate ?? p.businessDate}-${p.latestCost}`}
                className="border-b border-border/50"
              >
                <td className="py-2 tabular-nums font-medium">{gbp(p.latestCost)}</td>
                <td className="py-2">{formatDay(p.firstObservedDate ?? p.businessDate)}</td>
                <td className="py-2">{formatDay(p.lastObservedDate ?? p.businessDate)}</td>
                <td className="py-2 text-right tabular-nums">
                  {p.changeFromPrevious
                    ? `${p.changeFromPrevious.startsWith("-") ? "" : "+"}${gbp(p.changeFromPrevious)}`
                    : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </>
  );
}
