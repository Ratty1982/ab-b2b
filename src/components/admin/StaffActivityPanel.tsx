import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { InstantText } from "@/components/ab/InstantText";
import { StatusBadge } from "@/components/ab/Badges";
import { cn } from "@/lib/utils";
import {
  getStaffUserActivityFn,
  listStaffLoginHistoryFn,
} from "@/server/phase2/fns";
import {
  STAFF_ACTIVITY_AREAS,
  STAFF_ACTIVITY_PERIODS,
  type StaffActivityPeriod,
} from "@/domain/staff-activity";

type ActivityDetail = Extract<
  Awaited<ReturnType<typeof getStaffUserActivityFn>>,
  { ok: true }
>["data"];

type LoginHistory = Extract<
  Awaited<ReturnType<typeof listStaffLoginHistoryFn>>,
  { ok: true }
>["data"];

export function StaffActivityPanel({
  userId,
  enabled,
}: {
  userId: string;
  enabled: boolean;
}) {
  const [period, setPeriod] = useState<StaffActivityPeriod>("30d");
  const [area, setArea] = useState<(typeof STAFF_ACTIVITY_AREAS)[number]["key"]>("all");
  const [q, setQ] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [breakdownKey, setBreakdownKey] = useState<string | null>(null);
  const [detail, setDetail] = useState<ActivityDetail | null>(null);
  const [loginHistory, setLoginHistory] = useState<LoginHistory | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!enabled) return;
    setLoading(true);
    setError(null);
    const [activityResult, loginResult] = await Promise.all([
      getStaffUserActivityFn({
        data: {
          userId,
          period,
          area,
          q: search || null,
          page,
          pageSize: 25,
          breakdownKey,
        },
      }),
      listStaffLoginHistoryFn({ data: { userId, page: 1, pageSize: 8 } }),
    ]);
    setLoading(false);
    if (!activityResult.ok) {
      setError(activityResult.error);
      setDetail(null);
      return;
    }
    setDetail(activityResult.data);
    if (loginResult.ok) setLoginHistory(loginResult.data);
  }, [enabled, userId, period, area, search, page, breakdownKey]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    setPage(1);
  }, [userId, period, area, search, breakdownKey]);

  if (!enabled) {
    return (
      <p className="text-[13px] text-steel">Staff activity history is available to Super Admin only.</p>
    );
  }

  if (error) {
    return (
      <div className="rounded-md border border-border bg-surface/40 p-4">
        <p className="text-[13px] font-medium">Could not load activity</p>
        <p className="mt-1 text-[12px] text-steel">{error}</p>
        <button
          type="button"
          className="mt-3 h-8 rounded-md border border-border px-3 text-[12px] font-semibold"
          onClick={() => void load()}
        >
          Try again
        </button>
      </div>
    );
  }

  if (!detail && loading) {
    return <p className="text-[13px] text-steel">Loading activity…</p>;
  }

  if (!detail) return null;

  const totalPages = Math.max(1, Math.ceil(detail.total / detail.pageSize));

  return (
    <div className="grid gap-5">
      <div className="rounded-md border border-border bg-surface/40 px-4 py-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <h3 className="font-display text-base font-semibold uppercase tracking-tight">
              {detail.user.name}
            </h3>
            <p className="mt-0.5 text-[12px] text-steel">
              {detail.user.roleLabel} · {detail.user.statusLabel}
            </p>
          </div>
          <StatusBadge tone={detail.user.status === "ACTIVE" ? "good" : detail.user.status === "DISABLED" ? "bad" : "warn"}>
            {detail.user.statusLabel}
          </StatusBadge>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Metric label="Last login" value={detail.lastLoginLabel} />
          <Metric label="Last active" value={detail.lastActiveLabel} />
          <Metric label="Logins · 30 days" value={String(detail.logins30d)} />
          <Metric label="Actions · 30 days" value={String(detail.actions30d)} />
        </div>
        <p className="mt-3 text-[12px] text-steel">
          {detail.followUps30d} CRM follow-ups · {detail.customersWorked30d} customers worked with
        </p>
      </div>

      <div>
        <h4 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-steel">
          Last 30 days
        </h4>
        <div className="mt-2 grid gap-1.5 sm:grid-cols-2">
          {detail.breakdown.map((row) => (
            <button
              key={row.key}
              type="button"
              onClick={() => setBreakdownKey(breakdownKey === row.key ? null : row.key)}
              className={cn(
                "flex items-center justify-between rounded-md border px-3 py-2 text-left text-[13px] transition",
                breakdownKey === row.key
                  ? "border-primary bg-primary/10"
                  : "border-border bg-ink/30 hover:border-primary/50",
              )}
            >
              <span>{row.label}</span>
              <span className="num font-semibold">{row.count}</span>
            </button>
          ))}
        </div>
      </div>

      <div>
        <h4 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-steel">
          Security / login
        </h4>
        <div className="mt-2 overflow-hidden rounded-md border border-border">
          <table className="w-full text-[12px]">
            <thead>
              <tr className="border-b border-border bg-surface/50 text-left text-[10px] uppercase tracking-[0.12em] text-steel">
                <th className="px-3 py-2 font-semibold">When</th>
                <th className="px-3 py-2 font-semibold">Event</th>
                <th className="px-3 py-2 font-semibold">IP</th>
              </tr>
            </thead>
            <tbody>
              {(loginHistory?.items ?? []).length === 0 ? (
                <tr>
                  <td colSpan={3} className="px-3 py-3 text-steel">
                    No security events recorded yet.
                  </td>
                </tr>
              ) : (
                loginHistory!.items.map((row) => (
                  <tr key={row.id} className="border-b border-border/60 last:border-0">
                    <td className="px-3 py-2 whitespace-nowrap">
                      <InstantText value={row.at} variant="audit" />
                    </td>
                    <td className="px-3 py-2">{row.actionLabel}</td>
                    <td className="num px-3 py-2 text-steel">{row.ipAddress ?? "—"}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div>
        <div className="flex flex-wrap items-end gap-2">
          <label className="grid gap-1 text-[11px] font-semibold uppercase tracking-wide text-steel">
            Period
            <select
              value={period}
              onChange={(e) => setPeriod(e.target.value as StaffActivityPeriod)}
              className="h-9 min-w-[9rem] rounded-md border border-border bg-ink px-2 text-[13px] font-normal normal-case tracking-normal text-foreground"
            >
              {STAFF_ACTIVITY_PERIODS.filter((p) => p.key !== "custom").map((p) => (
                <option key={p.key} value={p.key}>
                  {p.label}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1 text-[11px] font-semibold uppercase tracking-wide text-steel">
            Area
            <select
              value={area}
              onChange={(e) => setArea(e.target.value as typeof area)}
              className="h-9 min-w-[9rem] rounded-md border border-border bg-ink px-2 text-[13px] font-normal normal-case tracking-normal text-foreground"
            >
              {STAFF_ACTIVITY_AREAS.map((a) => (
                <option key={a.key} value={a.key}>
                  {a.label}
                </option>
              ))}
            </select>
          </label>
          <form
            className="flex min-w-[12rem] flex-1 gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              setSearch(q.trim());
            }}
          >
            <label className="grid flex-1 gap-1 text-[11px] font-semibold uppercase tracking-wide text-steel">
              Search
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Customer / action / record"
                className="h-9 rounded-md border border-border bg-ink px-2 text-[13px] font-normal normal-case tracking-normal text-foreground"
              />
            </label>
            <button
              type="submit"
              className="mt-5 h-9 rounded-md border border-border px-3 text-[12px] font-semibold"
            >
              Search
            </button>
          </form>
        </div>

        <h4 className="mt-4 text-[11px] font-semibold uppercase tracking-[0.14em] text-steel">
          Activity history
          {breakdownKey ? (
            <button
              type="button"
              className="ml-2 text-[11px] font-semibold normal-case tracking-normal text-primary"
              onClick={() => setBreakdownKey(null)}
            >
              Clear category filter
            </button>
          ) : null}
        </h4>

        <div className="mt-2 overflow-hidden rounded-md border border-border">
          <table className="w-full min-w-[560px] text-[12px]">
            <thead>
              <tr className="border-b border-border bg-surface/50 text-left text-[10px] uppercase tracking-[0.12em] text-steel">
                <th className="px-3 py-2 font-semibold">Date / time</th>
                <th className="px-3 py-2 font-semibold">Action</th>
                <th className="px-3 py-2 font-semibold">Area</th>
                <th className="px-3 py-2 font-semibold">Customer / record</th>
                <th className="px-3 py-2 font-semibold">Detail</th>
              </tr>
            </thead>
            <tbody>
              {detail.timeline.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-3 py-4 text-steel">
                    No activity in this period.
                  </td>
                </tr>
              ) : (
                detail.timeline.map((row) => (
                  <tr key={row.id} className="border-b border-border/60 last:border-0 align-top">
                    <td className="px-3 py-2 whitespace-nowrap">
                      <InstantText value={row.at} variant="audit" />
                    </td>
                    <td className="px-3 py-2 font-medium">{row.actionLabel}</td>
                    <td className="px-3 py-2 text-steel">{row.areaLabel}</td>
                    <td className="px-3 py-2">
                      {row.recordHref && row.recordLabel ? (
                        <a href={row.recordHref} className="font-semibold text-primary hover:underline">
                          {row.recordLabel}
                        </a>
                      ) : (
                        row.recordLabel ?? "—"
                      )}
                    </td>
                    <td className="px-3 py-2 text-steel">
                      <span className="line-clamp-2" title={row.detail ?? undefined}>
                        {row.detail ?? "—"}
                      </span>
                      <span className="mt-0.5 block text-[10px] text-steel/70">{row.action}</span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="mt-3 flex items-center justify-between gap-3 text-[12px] text-steel">
          <span>
            {detail.total} event{detail.total === 1 ? "" : "s"}
            {loading ? " · Updating…" : ""}
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={page <= 1 || loading}
              className="h-8 rounded-md border border-border px-3 font-semibold disabled:opacity-40"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              Previous
            </button>
            <span>
              Page {page} / {totalPages}
            </span>
            <button
              type="button"
              disabled={page >= totalPages || loading}
              className="h-8 rounded-md border border-border px-3 font-semibold disabled:opacity-40"
              onClick={() => setPage((p) => p + 1)}
            >
              Next
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-steel">{label}</p>
      <p className="mt-0.5 text-[13px] font-semibold">{value}</p>
    </div>
  );
}

/** Compact Super Admin overview above the users table. */
export function StaffActivityOverviewBar({
  overview,
}: {
  overview: {
    internalUsers: number;
    loggedInToday: number;
    activeToday: number;
    meaningfulActionsToday: number;
  } | null;
}) {
  if (!overview) return null;
  return (
    <div className="mb-4 grid grid-cols-2 gap-2 rounded-md border border-border bg-surface/40 p-3 sm:grid-cols-4">
      <OverviewStat label="Internal users" value={overview.internalUsers} />
      <OverviewStat label="Logged in today" value={overview.loggedInToday} />
      <OverviewStat label="Active today" value={overview.activeToday} />
      <OverviewStat label="Actions today" value={overview.meaningfulActionsToday} />
    </div>
  );
}

function OverviewStat({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-steel">{label}</p>
      <p className="num mt-0.5 text-lg font-semibold">{value}</p>
    </div>
  );
}

export function notifyActivityDenied(error: string) {
  toast.error(error);
}
