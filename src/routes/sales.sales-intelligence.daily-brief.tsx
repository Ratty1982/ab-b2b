import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { StatusBadge } from "@/components/ab/Badges";
import {
  SalesIntelligenceHeader,
  SiField,
  SiMetricCard,
  SiMovementValue,
  SiPager,
  SiStickyTableHead,
  siControlClassName,
} from "@/components/sales-intelligence/workspace";
import { useSalesIntelligenceFreshnessLabel } from "@/components/sales-intelligence/freshness";
import {
  CreateFollowUpDrawer,
  SiCreateFollowUpButton,
  type FollowUpRequest,
} from "@/components/sales-intelligence/create-followup-drawer";
import { ROUTES } from "@/lib/app-nav";
import { formatGbp } from "@/domain/sales-intelligence";
import {
  compactPortfolioUrlSearch,
  PORTFOLIO_DEFAULT_PERIOD,
  type PortfolioFilter,
  type PortfolioUrlSearch,
} from "@/domain/sales-portfolio";
import {
  completeDailyBriefFollowUpFn,
  getDailySalesBriefFn,
} from "@/server/phase2/fns";

type BriefSearch = {
  salesRepId?: string;
  unassigned?: boolean;
  customerGroupId?: string;
  activityPage?: number;
};

function parseBriefSearch(search: Record<string, unknown>): BriefSearch {
  const out: BriefSearch = {};
  if (typeof search["salesRepId"] === "string" && search["salesRepId"]) {
    out.salesRepId = search["salesRepId"];
  }
  if (search["unassigned"] === true || search["unassigned"] === "true") out.unassigned = true;
  if (typeof search["customerGroupId"] === "string" && search["customerGroupId"]) {
    out.customerGroupId = search["customerGroupId"];
  }
  if (typeof search["activityPage"] === "number" && search["activityPage"] >= 1) {
    out.activityPage = search["activityPage"];
  } else if (typeof search["activityPage"] === "string") {
    const n = Number(search["activityPage"]);
    if (Number.isFinite(n) && n >= 1) out.activityPage = Math.floor(n);
  }
  return out;
}

export const Route = createFileRoute("/sales/sales-intelligence/daily-brief")({
  validateSearch: (search: Record<string, unknown>): BriefSearch => parseBriefSearch(search),
  head: () => ({
    meta: [
      { title: "Daily Sales Brief — Sales Intelligence — Automotive Brands" },
      {
        name: "description",
        content:
          "Concise daily sales brief: attention cases, opportunities, returned customers, and CRM follow-ups for today.",
      },
    ],
  }),
  component: DailySalesBriefPage,
});

type BriefData = Extract<Awaited<ReturnType<typeof getDailySalesBriefFn>>, { ok: true }>["data"];

function statusLabel(status: string): string {
  switch (status) {
    case "NEW_TODAY":
      return "New today";
    case "RETURNED":
      return "Returned";
    case "GROWING":
      return "Growing";
    default:
      return "Normal activity";
  }
}

function DailySalesBriefPage() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const freshness = useSalesIntelligenceFreshnessLabel();
  const [data, setData] = useState<BriefData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [showHelp, setShowHelp] = useState(false);
  const [followUp, setFollowUp] = useState<FollowUpRequest | null>(null);
  const [completingId, setCompletingId] = useState<string | null>(null);

  const query = useMemo(
    () => ({
      salesRepId: search.salesRepId ?? null,
      unassigned: search.unassigned ?? false,
      customerGroupId: search.customerGroupId ?? null,
      activityPage: search.activityPage ?? 1,
    }),
    [search],
  );

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void getDailySalesBriefFn({ data: query }).then((res) => {
      if (cancelled) return;
      if (!res.ok) {
        setError(res.error);
        setData(null);
      } else {
        setError(null);
        setData(res.data);
      }
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [query]);

  function patchSearch(patch: Record<string, unknown>) {
    const next: BriefSearch = { ...search };
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined || v === null || v === "" || v === false) {
        delete (next as Record<string, unknown>)[k];
      } else {
        (next as Record<string, unknown>)[k] = v;
      }
    }
    void navigate({ search: next });
  }

  async function completeFollowUp(taskId: string) {
    setCompletingId(taskId);
    const r = await completeDailyBriefFollowUpFn({ data: { taskId } });
    setCompletingId(null);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    const refreshed = await getDailySalesBriefFn({ data: query });
    if (refreshed.ok) setData(refreshed.data);
  }

  const portfolioSearch = (filter?: PortfolioFilter, companyId?: string): PortfolioUrlSearch =>
    compactPortfolioUrlSearch({
      period: PORTFOLIO_DEFAULT_PERIOD,
      ...(search.salesRepId ? { salesRepId: search.salesRepId } : {}),
      ...(search.unassigned ? { unassigned: true } : {}),
      ...(search.customerGroupId ? { customerGroupId: search.customerGroupId } : {}),
      ...(filter ? { filter } : {}),
      ...(companyId ? { companyId } : {}),
    });

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <SalesIntelligenceHeader
        title="Daily Sales Brief"
        freshnessLabel={freshness}
        actions={
          <>
            <button
              type="button"
              className="h-9 rounded-md border border-border px-3 text-[11px] font-bold uppercase tracking-wide text-steel hover:text-foreground"
              onClick={() => setShowHelp((v) => !v)}
            >
              How calculated
            </button>
            <Link
              to={ROUTES.salesIntelligencePortfolio}
              search={portfolioSearch()}
              className="inline-flex h-9 items-center rounded-md bg-primary px-3 text-[11px] font-bold uppercase tracking-wide text-primary-foreground"
            >
              View full portfolio
            </Link>
          </>
        }
      />

      <div className="space-y-5 px-4 py-4 sm:px-6">
        {error ? (
          <p className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
            {error}
          </p>
        ) : null}

        {showHelp && data ? (
          <section className="rounded-md border border-border bg-surface/40 p-4 text-[12px] text-steel">
            <h2 className="font-display text-sm font-semibold uppercase text-foreground">
              How the Daily Brief is calculated
            </h2>
            <dl className="mt-3 grid gap-2 sm:grid-cols-2">
              {Object.entries(data.methodology).map(([k, v]) => (
                <div key={k}>
                  <dt className="text-[10px] font-bold uppercase tracking-wide text-foreground">
                    {k.replace(/([A-Z])/g, " $1")}
                  </dt>
                  <dd className="mt-0.5">{v}</dd>
                </div>
              ))}
            </dl>
          </section>
        ) : null}

        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-steel">Today</p>
            <p className="font-display text-2xl font-semibold uppercase tracking-tight sm:text-3xl">
              {data?.businessDateLabel ?? "—"}
            </p>
            {data?.salesRepFilterLabel ? (
              <p className="mt-1 text-[12px] text-steel">
                Daily Brief for: <span className="text-foreground">{data.salesRepFilterLabel}</span>
              </p>
            ) : null}
          </div>
          <div className="flex flex-wrap gap-3">
            {data?.canSelectSalesRep ? (
              <SiField label="Sales rep">
                <select
                  className={siControlClassName()}
                  value={search.unassigned ? "__unassigned__" : (search.salesRepId ?? "")}
                  onChange={(e) => {
                    const v = e.target.value;
                    if (v === "__unassigned__") {
                      patchSearch({ unassigned: true, salesRepId: undefined, activityPage: 1 });
                    } else {
                      patchSearch({
                        unassigned: undefined,
                        salesRepId: v || undefined,
                        activityPage: 1,
                      });
                    }
                  }}
                >
                  <option value="">All (in scope)</option>
                  <option value="__unassigned__">Unassigned</option>
                  {(data.salesReps ?? []).map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.label}
                    </option>
                  ))}
                </select>
              </SiField>
            ) : null}
            {data?.customerGroups?.length ? (
              <SiField label="Customer group">
                <select
                  className={siControlClassName()}
                  value={search.customerGroupId ?? ""}
                  onChange={(e) =>
                    patchSearch({
                      customerGroupId: e.target.value || undefined,
                      activityPage: 1,
                    })
                  }
                >
                  <option value="">All groups</option>
                  {data.customerGroups.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name}
                    </option>
                  ))}
                </select>
              </SiField>
            ) : null}
          </div>
        </div>

        {loading && !data ? (
          <p className="text-sm text-steel">Loading daily brief…</p>
        ) : data ? (
          <>
            <section>
              <h2 className="mb-2 font-display text-sm font-semibold uppercase tracking-wide">
                Today
              </h2>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
                <SiMetricCard label="Customers purchased" value={String(data.summary.customersPurchased)} />
                <SiMetricCard
                  label="Net sales today"
                  value={formatGbp(data.summary.netSalesToday)}
                />
                <SiMetricCard label="Need attention" value={String(data.summary.needAttention)} />
                <SiMetricCard
                  label="New opportunities"
                  value={String(data.summary.newOpportunities)}
                />
                <SiMetricCard
                  label="Follow-ups due today"
                  value={String(data.summary.followUpsDueToday)}
                />
                <SiMetricCard
                  label="Overdue follow-ups"
                  value={String(data.summary.overdueFollowUps)}
                />
              </div>
              <p className="mt-2 text-[11px] text-steel">
                Since yesterday: {data.sinceYesterday.customersPurchased} customers purchased ·{" "}
                {data.sinceYesterday.dormantReturned} dormant returned ·{" "}
                {data.sinceYesterday.firstTimeProductPurchases} first-time products ·{" "}
                {data.sinceYesterday.followUpsCreated} follow-ups created ·{" "}
                {data.sinceYesterday.followUpsCompleted} completed
              </p>
            </section>

            <section>
              <div className="mb-2 flex flex-wrap items-end justify-between gap-2">
                <h2 className="font-display text-sm font-semibold uppercase tracking-wide">
                  Needs attention
                </h2>
                <Link
                  to={ROUTES.salesIntelligencePortfolio}
                  search={portfolioSearch("NEEDS_ATTENTION")}
                  className="text-[11px] font-bold uppercase tracking-wide text-steel hover:text-foreground"
                >
                  View all in portfolio
                </Link>
              </div>
              {data.needsAttention.length === 0 ? (
                <p className="text-[12px] text-steel">No customers currently require attention.</p>
              ) : (
                <div className="space-y-2">
                  {data.needsAttention.map((r) => (
                    <article
                      key={r.companyId}
                      className="rounded-md border border-border px-3 py-3"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div>
                          <h3 className="font-display text-base font-semibold uppercase">
                            {r.companyName}
                          </h3>
                          <p className="text-[11px] text-steel">
                            {[r.mamAccount, r.customerGroupName, r.salesRepName]
                              .filter(Boolean)
                              .join(" · ")}
                          </p>
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {r.attentionReasons.map((a) => (
                            <StatusBadge key={a.code} tone="warn">
                              {a.label}
                            </StatusBadge>
                          ))}
                        </div>
                      </div>
                      <p className="mt-2 text-[12px] text-steel">{r.cadenceSummary}</p>
                      <div className="mt-2 text-[12px]">
                        <span className="text-steel">Sales: </span>
                        <span className="font-semibold">{formatGbp(r.currentNetSales)}</span>
                        <span className="text-steel"> current · </span>
                        <span className="font-semibold">{formatGbp(r.previousNetSales)}</span>
                        <span className="text-steel"> comparable · </span>
                        <SiMovementValue
                          change={r.movement}
                          percentChange={r.movementPercent}
                          money
                        />
                      </div>
                      <ul className="mt-2 space-y-1 text-[11px] text-steel">
                        {r.attentionReasons.map((a) => (
                          <li key={`${a.code}-why`}>{a.explanation}</li>
                        ))}
                      </ul>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <Link
                          to="/admin/customers/$id"
                          params={{ id: r.companyId }}
                          className="h-8 rounded-md border border-border px-2.5 text-[10px] font-bold uppercase leading-8"
                        >
                          View customer
                        </Link>
                        <Link
                          to={ROUTES.salesIntelligence}
                          search={{ mode: "customers", companyId: r.companyId }}
                          className="h-8 rounded-md border border-border px-2.5 text-[10px] font-bold uppercase leading-8"
                        >
                          View analysis
                        </Link>
                        <SiCreateFollowUpButton
                          onClick={() =>
                            setFollowUp({
                              sourceModule: "PORTFOLIO",
                              sourceReason:
                                r.attentionReasons[0]?.code === "DORMANT"
                                  ? "DORMANT"
                                  : r.attentionReasons[0]?.code === "DECLINING"
                                    ? "DECLINING"
                                    : "PURCHASE_GAP",
                              companyId: r.companyId,
                              period: PORTFOLIO_DEFAULT_PERIOD,
                            })
                          }
                        />
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </section>

            <section>
              <div className="mb-2 flex flex-wrap items-end justify-between gap-2">
                <h2 className="font-display text-sm font-semibold uppercase tracking-wide">
                  Opportunities
                </h2>
                <Link
                  to={ROUTES.salesIntelligencePortfolio}
                  search={portfolioSearch("HAS_OPPORTUNITIES")}
                  className="text-[11px] font-bold uppercase tracking-wide text-steel hover:text-foreground"
                >
                  View opportunities in portfolio
                </Link>
              </div>
              {data.opportunities.length === 0 ? (
                <p className="text-[12px] text-steel">
                  No supported sales opportunities identified from current data.
                </p>
              ) : (
                <div className="space-y-2">
                  {data.opportunities.map((r) => (
                    <article
                      key={`opp-${r.companyId}`}
                      className="rounded-md border border-border px-3 py-3"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div>
                          <h3 className="font-display text-base font-semibold uppercase">
                            {r.companyName}
                          </h3>
                          <p className="text-[11px] text-steel">
                            {[r.mamAccount, r.customerGroupName, r.salesRepName]
                              .filter(Boolean)
                              .join(" · ")}
                          </p>
                        </div>
                        <p className="text-[12px] font-semibold">
                          {r.opportunityCount} supported opportunit
                          {r.opportunityCount === 1 ? "y" : "ies"}
                        </p>
                      </div>
                      <ul className="mt-2 space-y-1.5 text-[12px]">
                        {r.opportunities.slice(0, 3).map((o, i) => (
                          <li key={`${o.type}-${o.sku ?? o.brandName ?? i}`}>
                            <span className="font-semibold">{o.title}</span>
                            <span className="text-steel"> — {o.explanation}</span>
                          </li>
                        ))}
                      </ul>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <Link
                          to={ROUTES.salesIntelligencePortfolio}
                          search={portfolioSearch("HAS_OPPORTUNITIES", r.companyId)}
                          className="h-8 rounded-md border border-border px-2.5 text-[10px] font-bold uppercase leading-8"
                        >
                          View opportunities
                        </Link>
                        <SiCreateFollowUpButton
                          onClick={() =>
                            setFollowUp({
                              sourceModule: "PORTFOLIO",
                              sourceReason:
                                r.opportunities[0]?.type === "CROSS_SELL"
                                  ? "CROSS_SELL"
                                  : r.opportunities[0]?.type === "BRAND_GAP"
                                    ? "RANGE_GAP"
                                    : "STOPPED",
                              companyId: r.companyId,
                              sku: r.opportunities[0]?.sku ?? null,
                              period: PORTFOLIO_DEFAULT_PERIOD,
                            })
                          }
                        />
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </section>

            <section>
              <h2 className="mb-2 font-display text-sm font-semibold uppercase tracking-wide">
                Positive movement
              </h2>
              {data.positiveMovement.length === 0 ? (
                <p className="text-[12px] text-steel">
                  No conservative positive movement events for today.
                </p>
              ) : (
                <div className="space-y-2">
                  {data.positiveMovement.map((p, idx) => (
                    <article
                      key={`${p.kind}-${p.companyId}-${p.sku ?? p.brandName ?? idx}`}
                      className="rounded-md border border-border px-3 py-3"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div>
                          <div className="mb-1">
                            <StatusBadge tone="good">{p.headline}</StatusBadge>
                          </div>
                          <h3 className="font-display text-base font-semibold uppercase">
                            {p.companyName}
                          </h3>
                          <p className="text-[11px] text-steel">
                            {[p.mamAccount, p.customerGroupName, p.salesRepName]
                              .filter(Boolean)
                              .join(" · ")}
                          </p>
                        </div>
                        {p.netSalesToday != null ? (
                          <p className="text-[12px] font-semibold">
                            Today {formatGbp(p.netSalesToday)}
                          </p>
                        ) : null}
                      </div>
                      <p className="mt-2 text-[12px] text-steel">{p.detail}</p>
                      {p.typicalIntervalDays != null ? (
                        <p className="mt-1 text-[11px] text-steel">
                          Previous typical cadence: ~{p.typicalIntervalDays} days
                        </p>
                      ) : null}
                      <div className="mt-3">
                        <Link
                          to="/admin/customers/$id"
                          params={{ id: p.companyId }}
                          className="h-8 rounded-md border border-border px-2.5 text-[10px] font-bold uppercase leading-8"
                        >
                          View customer
                        </Link>
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </section>

            <section>
              <div className="mb-2 flex flex-wrap items-end justify-between gap-2">
                <h2 className="font-display text-sm font-semibold uppercase tracking-wide">
                  Follow-ups
                </h2>
                <Link
                  to={ROUTES.crmTasks}
                  className="text-[11px] font-bold uppercase tracking-wide text-steel hover:text-foreground"
                >
                  Open CRM tasks
                </Link>
              </div>
              <div className="grid gap-4 lg:grid-cols-2">
                <div>
                  <h3 className="mb-2 text-[11px] font-bold uppercase tracking-wide text-steel">
                    Overdue ({data.followUps.overdueTotal})
                  </h3>
                  {data.followUps.overdue.length === 0 ? (
                    <p className="text-[12px] text-steel">No overdue follow-ups.</p>
                  ) : (
                    <ul className="space-y-2">
                      {data.followUps.overdue.map((t) => (
                        <li
                          key={t.id}
                          className="rounded-md border border-border px-3 py-2 text-[12px]"
                        >
                          <p className="font-semibold uppercase">{t.companyName ?? "No company"}</p>
                          <p>{t.title}</p>
                          <p className="text-[11px] text-steel">
                            {[t.assigneeName, t.sourceLabel, t.sourceReason, t.dueAt?.slice(0, 10)]
                              .filter(Boolean)
                              .join(" · ")}
                          </p>
                          <div className="mt-2 flex flex-wrap gap-2">
                            <Link
                              to={ROUTES.crmTasks}
                              search={{ taskId: t.id }}
                              className="h-7 rounded-md border border-border px-2 text-[10px] font-bold uppercase leading-7"
                            >
                              Open
                            </Link>
                            {data.followUps.canComplete ? (
                              <button
                                type="button"
                                disabled={completingId === t.id}
                                className="h-7 rounded-md bg-primary px-2 text-[10px] font-bold uppercase text-primary-foreground disabled:opacity-50"
                                onClick={() => void completeFollowUp(t.id)}
                              >
                                Complete
                              </button>
                            ) : null}
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                <div>
                  <h3 className="mb-2 text-[11px] font-bold uppercase tracking-wide text-steel">
                    Due today ({data.followUps.dueTodayTotal})
                  </h3>
                  {data.followUps.dueToday.length === 0 ? (
                    <p className="text-[12px] text-steel">No follow-ups due today.</p>
                  ) : (
                    <ul className="space-y-2">
                      {data.followUps.dueToday.map((t) => (
                        <li
                          key={t.id}
                          className="rounded-md border border-border px-3 py-2 text-[12px]"
                        >
                          <p className="font-semibold uppercase">{t.companyName ?? "No company"}</p>
                          <p>{t.title}</p>
                          <p className="text-[11px] text-steel">
                            {[t.assigneeName, t.sourceLabel, t.sourceReason]
                              .filter(Boolean)
                              .join(" · ")}
                          </p>
                          <div className="mt-2 flex flex-wrap gap-2">
                            <Link
                              to={ROUTES.crmTasks}
                              search={{ taskId: t.id }}
                              className="h-7 rounded-md border border-border px-2 text-[10px] font-bold uppercase leading-7"
                            >
                              Open
                            </Link>
                            {data.followUps.canComplete ? (
                              <button
                                type="button"
                                disabled={completingId === t.id}
                                className="h-7 rounded-md bg-primary px-2 text-[10px] font-bold uppercase text-primary-foreground disabled:opacity-50"
                                onClick={() => void completeFollowUp(t.id)}
                              >
                                Complete
                              </button>
                            ) : null}
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            </section>

            <section>
              <h2 className="mb-2 font-display text-sm font-semibold uppercase tracking-wide">
                Today&apos;s activity
              </h2>
              <div className="overflow-x-auto rounded-md border border-border">
                <table className="min-w-full text-left text-[12px]">
                  <SiStickyTableHead>
                    <tr className="border-b border-border text-[10px] font-bold uppercase tracking-wide text-steel">
                      <th className="px-3 py-2">Customer</th>
                      <th className="px-3 py-2">Sales rep</th>
                      <th className="px-3 py-2">Net sales today</th>
                      <th className="px-3 py-2">Units</th>
                      <th className="px-3 py-2">Products</th>
                      <th className="px-3 py-2">Last purchase before today</th>
                      <th className="px-3 py-2">Status</th>
                    </tr>
                  </SiStickyTableHead>
                  <tbody>
                    {data.activity.rows.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="px-3 py-6 text-steel">
                          No customers with invoice purchases today.
                        </td>
                      </tr>
                    ) : (
                      data.activity.rows.map((r) => (
                        <tr key={r.companyId} className="border-b border-border/70">
                          <td className="px-3 py-2">
                            <Link
                              to="/admin/customers/$id"
                              params={{ id: r.companyId }}
                              className="font-semibold uppercase hover:underline"
                            >
                              {r.companyName}
                            </Link>
                            {r.customerGroupName ? (
                              <p className="text-[10px] text-steel">{r.customerGroupName}</p>
                            ) : null}
                          </td>
                          <td className="px-3 py-2 text-steel">{r.salesRepName ?? "—"}</td>
                          <td className="px-3 py-2 font-semibold">
                            {formatGbp(r.netSalesToday)}
                          </td>
                          <td className="px-3 py-2">{r.units}</td>
                          <td className="px-3 py-2">{r.products}</td>
                          <td className="px-3 py-2 text-steel">
                            {r.lastPurchaseBeforeToday ?? "—"}
                          </td>
                          <td className="px-3 py-2">
                            <StatusBadge
                              tone={
                                r.status === "RETURNED" || r.status === "NEW_TODAY"
                                  ? "good"
                                  : r.status === "GROWING"
                                    ? "info"
                                    : "neutral"
                              }
                            >
                              {statusLabel(r.status)}
                            </StatusBadge>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
              <SiPager
                page={data.activity.page}
                totalPages={Math.max(1, Math.ceil(data.activity.total / data.activity.pageSize))}
                total={data.activity.total}
                onPage={(page) => patchSearch({ activityPage: page })}
              />
            </section>
          </>
        ) : null}
      </div>

      <CreateFollowUpDrawer
        open={followUp != null}
        request={followUp}
        onClose={() => setFollowUp(null)}
      />
    </div>
  );
}
