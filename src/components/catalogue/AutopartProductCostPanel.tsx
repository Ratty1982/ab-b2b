import { useCallback, useEffect, useState } from "react";
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
import { formatDateTime } from "@/lib/datetime";

type CostPos = Extract<Awaited<ReturnType<typeof getProductAutopartCostFn>>, { ok: true }>["data"];
type History = Extract<
  Awaited<ReturnType<typeof getProductAutopartCostHistoryFn>>,
  { ok: true }
>["data"];

type Range = "30d" | "90d" | "12m" | "all";

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

export function AutopartProductCostPanel({ variantId }: { variantId: string }) {
  const [pos, setPos] = useState<CostPos | null | undefined>(undefined);
  const [history, setHistory] = useState<History | null>(null);
  const [range, setRange] = useState<Range>("90d");
  const [denied, setDenied] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      <section className="mt-8 border border-border bg-surface/30 p-5">
        <h3 className="font-display text-base uppercase">Autopart cost</h3>
        <p className="mt-2 text-[13px] text-steel">Loading…</p>
      </section>
    );
  }

  return (
    <section className="mt-8 border border-border bg-surface/30 p-5">
      <h3 className="font-display text-base uppercase">Autopart cost intelligence</h3>
      <p className="mt-1 text-[12px] text-steel">
        Internal Latest Cost from 231PO3NEW. Never shown to trade customers. Not used for sell
        prices.
      </p>
      {error ? <p className="mt-3 text-[13px] text-bad">{error}</p> : null}

      {!pos ? (
        <p className="mt-4 text-[13px] text-steel">
          No Autopart cost observed yet. Cost history begins after the next successful 231PO3NEW
          stock sync.
        </p>
      ) : (
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
                {pos.change
                  ? `${pos.change.absolute.startsWith("-") ? "" : "+"}${gbp(pos.change.absolute)}${
                      pos.change.percent != null ? ` / ${pos.change.percent}%` : ""
                    }`
                  : "—"}
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

          <div className="mt-4 h-56 w-full">
            {history?.points?.length ? (
              history.points.length === 1 ? (
                <div className="grid h-full place-items-center rounded-md border border-dashed border-border text-[13px] text-steel">
                  Current cost {gbp(history.points[0]!.latestCost)} on{" "}
                  {formatDay(history.points[0]!.businessDate)}. Trend appears after more daily
                  snapshots.
                </div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart
                    data={history.points.map((p) => ({
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
              )
            ) : (
              <div className="grid h-full place-items-center rounded-md border border-dashed border-border text-[13px] text-steel">
                {history?.emptyReason ?? "No cost history"}
              </div>
            )}
          </div>

          {history?.points?.length ? (
            <table className="mt-4 w-full text-left text-[13px]">
              <thead>
                <tr className="border-b border-border text-[11px] uppercase text-steel">
                  <th className="py-2">Date</th>
                  <th className="py-2 text-right">Cost</th>
                  <th className="py-2 text-right">Change</th>
                </tr>
              </thead>
              <tbody>
                {[...history.points].reverse().slice(0, 30).map((p) => (
                  <tr key={p.businessDate} className="border-b border-border/50">
                    <td className="py-2">{formatDay(p.businessDate)}</td>
                    <td className="py-2 text-right tabular-nums">{gbp(p.latestCost)}</td>
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
      )}
    </section>
  );
}
