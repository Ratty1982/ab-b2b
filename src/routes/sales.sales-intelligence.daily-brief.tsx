import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { StatusBadge } from "@/components/ab/Badges";
import {
  SiField,
  SiPager,
  siControlClassName,
} from "@/components/sales-intelligence/workspace";
import { useSalesIntelligenceFreshnessLabel } from "@/components/sales-intelligence/freshness";
import {
  CreateFollowUpDrawer,
  SiCreateFollowUpButton,
  type FollowUpRequest,
} from "@/components/sales-intelligence/create-followup-drawer";
import { ROUTES } from "@/lib/app-nav";
import { cn } from "@/lib/utils";
import { formatGbp } from "@/domain/sales-intelligence";
import {
  compactPortfolioUrlSearch,
  PORTFOLIO_DEFAULT_PERIOD,
  type PortfolioFilter,
  type PortfolioUrlSearch,
} from "@/domain/sales-portfolio";
import { dailyBriefCardGridClassName } from "@/domain/sales-daily-brief";
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
          "Salesperson daily brief: priorities, today’s customers, opportunities, and follow-ups.",
      },
    ],
  }),
  component: DailySalesBriefPage,
});

type BriefData = Extract<Awaited<ReturnType<typeof getDailySalesBriefFn>>, { ok: true }>["data"];

function priorityTone(label: string): "bad" | "warn" | "info" | "neutral" {
  const l = label.toLowerCase();
  if (l.includes("gone quiet") || l.includes("purchase gap")) return "bad";
  if (l.includes("sales lower") || l.includes("worth checking")) return "warn";
  return "info";
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

  const followUpsClear =
    data != null && data.followUps.overdueTotal === 0 && data.followUps.dueTodayTotal === 0;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="border-b border-border/70 px-4 py-3 sm:px-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-steel">
              Sales Intelligence
            </p>
            <h1 className="font-display text-xl font-semibold tracking-tight sm:text-2xl">
              {data?.greeting.line ?? "Daily Sales Brief"}
            </h1>
            <p className="mt-1 text-[13px] text-steel">
              {data?.greeting.subtitle ?? "Here's what is happening across your customers today."}
            </p>
            <p className="mt-1 text-[11px] text-steel">
              {[data?.businessDateLabel, freshness].filter(Boolean).join(" · ")}
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
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
              className="inline-flex h-9 items-center rounded-md border border-border px-3 text-[11px] font-bold uppercase tracking-wide text-steel hover:text-foreground"
            >
              Full portfolio
            </Link>
          </div>
        </div>

        {data?.canSelectSalesRep ? (
          <div className="mt-3 flex flex-wrap items-end gap-3 rounded-md border border-border/70 px-3 py-2">
            <p className="pb-2 text-[10px] font-bold uppercase tracking-wide text-steel">Viewing</p>
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
                <option value="">All in scope</option>
                <option value="__unassigned__">Unassigned</option>
                {(data.salesReps ?? []).map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.label}
                  </option>
                ))}
              </select>
            </SiField>
            {(data.customerGroups?.length ?? 0) > 0 ? (
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
        ) : null}
      </div>

      <div className="space-y-5 px-4 py-4 sm:px-6">
        {error ? (
          <p className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
            {error}
          </p>
        ) : null}

        {showHelp && data ? (
          <section className="rounded-md border border-border bg-surface/40 p-4 text-[12px] text-steel">
            <h2 className="font-display text-sm font-semibold uppercase text-foreground">
              How calculated
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

        {loading && !data ? (
          <p className="text-sm text-steel">Loading daily brief…</p>
        ) : data ? (
          <>
            {/* 2. Today's sales summary */}
            <section className="rounded-md border border-border px-3 py-3 sm:px-4">
              <div className="flex flex-wrap items-end gap-x-8 gap-y-3">
                <div>
                  <p className="font-display text-3xl font-semibold tabular-nums tracking-tight">
                    {formatGbp(data.summary.netSalesToday)}
                  </p>
                  <p className="text-[11px] font-bold uppercase tracking-wide text-steel">
                    Sales today
                  </p>
                </div>
                <div>
                  <p className="font-display text-3xl font-semibold tabular-nums tracking-tight">
                    {data.summary.customersPurchased}
                  </p>
                  <p className="text-[11px] font-bold uppercase tracking-wide text-steel">
                    Customers ordered
                  </p>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-steel">
                {data.summary.needAttention === 0 ? (
                  <span className="text-good">No customers need attention</span>
                ) : (
                  <span>
                    <span className="font-semibold text-foreground">
                      {data.summary.needAttention}
                    </span>{" "}
                    {data.summary.needAttention === 1
                      ? "customer worth checking"
                      : "customers worth checking"}
                  </span>
                )}
                <span>
                  <span className="font-semibold text-foreground">
                    {data.summary.newOpportunities}
                  </span>{" "}
                  sales{" "}
                  {data.summary.newOpportunities === 1 ? "opportunity" : "opportunities"}
                </span>
                {data.summary.followUpsDueToday > 0 ? (
                  <span>
                    <span className="font-semibold text-foreground">
                      {data.summary.followUpsDueToday}
                    </span>{" "}
                    due today
                  </span>
                ) : null}
                {data.summary.overdueFollowUps > 0 ? (
                  <span className="text-destructive">
                    <span className="font-semibold">{data.summary.overdueFollowUps}</span> overdue
                  </span>
                ) : (
                  <span className="text-good">Nothing overdue</span>
                )}
              </div>
            </section>

            {/* 3. YOUR PRIORITIES */}
            <section>
              <div className="mb-2 flex flex-wrap items-end justify-between gap-2">
                <h2 className="font-display text-sm font-semibold uppercase tracking-wide">
                  Your priorities
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
                <div className="max-w-3xl text-[13px]">
                  <p className="font-semibold text-good">You&apos;re all caught up</p>
                  <p className="text-steel">No customers need your attention right now.</p>
                </div>
              ) : (
                <div className={dailyBriefCardGridClassName(data.needsAttention.length)}>
                  {data.needsAttention.map((r) => (
                    <article
                      key={r.companyId}
                      className="rounded-md border border-border px-3 py-2.5"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="min-w-0">
                          <h3 className="font-display text-sm font-semibold uppercase leading-tight">
                            {r.companyName}
                          </h3>
                          <p className="text-[11px] text-steel">
                            {[r.customerGroupName, r.salesRepName].filter(Boolean).join(" · ")}
                          </p>
                        </div>
                        <StatusBadge tone={priorityTone(r.priorityLabel)}>
                          {r.priorityLabel}
                        </StatusBadge>
                      </div>
                      <ul className="mt-2 space-y-0.5 text-[12px] text-steel">
                        {r.summaryLines.map((line) => (
                          <li key={line}>{line}</li>
                        ))}
                      </ul>
                      <div className="mt-2.5 flex flex-wrap gap-2">
                        <Link
                          to="/admin/customers/$id"
                          params={{ id: r.companyId }}
                          className="h-8 rounded-md bg-primary px-2.5 text-[10px] font-bold uppercase leading-8 text-primary-foreground"
                        >
                          View customer
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

            {/* 4. TODAY'S CUSTOMERS */}
            <section>
              <h2 className="mb-2 font-display text-sm font-semibold uppercase tracking-wide">
                Today&apos;s customers
              </h2>
              {data.activity.rows.length === 0 ? (
                <p className="text-[13px] text-steel">No customers with invoice orders today.</p>
              ) : (
                <div className="space-y-2">
                  {data.activity.rows.map((r) => (
                    <article
                      key={r.companyId}
                      className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border px-3 py-2.5"
                    >
                      <div className="min-w-0">
                        <h3 className="font-display text-sm font-semibold uppercase">
                          {r.companyName}
                        </h3>
                        <p className="text-[12px]">
                          <span className="font-semibold">{formatGbp(r.netSalesToday)}</span>
                          <span className="text-steel">
                            {" "}
                            today · {r.units} unit{r.units === 1 ? "" : "s"} · {r.products} product
                            {r.products === 1 ? "" : "s"}
                          </span>
                        </p>
                        <p className="text-[11px] text-steel">
                          {r.cadenceHuman}
                          {r.lastPurchaseBeforeToday
                            ? ` · Last order before today: ${r.lastPurchaseBeforeTodayLabel}`
                            : ""}
                          {data.canSelectSalesRep && r.salesRepName
                            ? ` · ${r.salesRepName}`
                            : ""}
                        </p>
                      </div>
                      <Link
                        to="/admin/customers/$id"
                        params={{ id: r.companyId }}
                        className="h-8 shrink-0 rounded-md border border-border px-2.5 text-[10px] font-bold uppercase leading-8"
                      >
                        View customer
                      </Link>
                    </article>
                  ))}
                  <SiPager
                    page={data.activity.page}
                    totalPages={Math.max(
                      1,
                      Math.ceil(data.activity.total / data.activity.pageSize),
                    )}
                    total={data.activity.total}
                    onPage={(page) => patchSearch({ activityPage: page })}
                  />
                </div>
              )}
            </section>

            {/* 5. SALES OPPORTUNITIES */}
            <section>
              <div className="mb-2 flex flex-wrap items-end justify-between gap-2">
                <h2 className="font-display text-sm font-semibold uppercase tracking-wide">
                  Sales opportunities
                </h2>
                <Link
                  to={ROUTES.salesIntelligencePortfolio}
                  search={portfolioSearch("HAS_OPPORTUNITIES")}
                  className="text-[11px] font-bold uppercase tracking-wide text-steel hover:text-foreground"
                >
                  View all opportunities
                </Link>
              </div>
              {data.opportunities.length === 0 ? (
                <p className="text-[13px] text-steel">
                  No supported sales opportunities identified from current data.
                </p>
              ) : (
                <div className={dailyBriefCardGridClassName(data.opportunities.length)}>
                  {data.opportunities.map((r) => (
                    <article
                      key={`opp-${r.companyId}`}
                      className="rounded-md border border-border px-3 py-2.5"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div>
                          <h3 className="font-display text-sm font-semibold uppercase">
                            {r.companyName}
                          </h3>
                          <p className="text-[11px] text-steel">
                            {r.opportunityCount} product
                            {r.opportunityCount === 1 ? "" : "s"} worth discussing
                          </p>
                        </div>
                      </div>
                      <ul className="mt-2 space-y-2">
                        {r.lines.map((line, i) => (
                          <li key={`${line.type}-${line.sku ?? line.brandName ?? i}`}>
                            <p className="text-[12px] font-semibold">{line.productLabel}</p>
                            <p className="text-[12px] text-steel">{line.primaryText}</p>
                            {line.secondaryText ? (
                              <p className="text-[11px] text-steel">{line.secondaryText}</p>
                            ) : null}
                            {line.sku &&
                            line.productLabel.toUpperCase() !== line.sku.toUpperCase() ? (
                              <p className="text-[10px] uppercase tracking-wide text-steel">
                                SKU: {line.sku}
                              </p>
                            ) : null}
                          </li>
                        ))}
                      </ul>
                      <div className="mt-2.5 flex flex-wrap gap-2">
                        <Link
                          to="/admin/customers/$id"
                          params={{ id: r.companyId }}
                          className="h-8 rounded-md bg-primary px-2.5 text-[10px] font-bold uppercase leading-8 text-primary-foreground"
                        >
                          View customer
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

            {/* 6. GOOD NEWS */}
            <section>
              <h2 className="mb-2 font-display text-sm font-semibold uppercase tracking-wide">
                Good news
              </h2>
              {data.positiveMovement.length === 0 ? (
                <p className="text-[13px] text-steel">No notable positive changes today.</p>
              ) : (
                <div className="grid gap-2 md:grid-cols-2">
                  {data.positiveMovement.map((p, idx) => (
                    <article
                      key={`${p.kind}-${p.companyId}-${p.sku ?? p.brandName ?? idx}`}
                      className="rounded-md border border-border px-3 py-2.5"
                    >
                      <StatusBadge tone="good">{p.headline}</StatusBadge>
                      <h3 className="mt-1.5 font-display text-sm font-semibold uppercase">
                        {p.companyName}
                      </h3>
                      <p className="mt-1 text-[12px] text-steel">{p.detail}</p>
                      {p.sku && p.productName ? (
                        <p className="mt-0.5 text-[10px] uppercase tracking-wide text-steel">
                          SKU: {p.sku}
                        </p>
                      ) : null}
                      <div className="mt-2">
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

            {/* 7. FOLLOW-UPS */}
            <section>
              <div className="mb-2 flex flex-wrap items-end justify-between gap-2">
                <h2 className="font-display text-sm font-semibold uppercase tracking-wide">
                  {data.greeting.personalized ? "My follow-ups" : "Follow-ups"}
                </h2>
                <Link
                  to={ROUTES.crmTasks}
                  className="text-[11px] font-bold uppercase tracking-wide text-steel hover:text-foreground"
                >
                  Open CRM tasks
                </Link>
              </div>
              {followUpsClear ? (
                <p className={cn("text-[13px] text-good")}>
                  You&apos;re up to date — no follow-ups are overdue or due today.
                </p>
              ) : (
                <div className="space-y-3">
                  {data.followUps.overdueTotal > 0 ? (
                    <div>
                      <h3 className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-destructive">
                        Overdue ({data.followUps.overdueTotal})
                      </h3>
                      <ul className="space-y-2">
                        {data.followUps.overdue.map((t) => (
                          <li
                            key={t.id}
                            className="rounded-md border border-border px-3 py-2 text-[12px]"
                          >
                            <p className="font-semibold uppercase">
                              {t.companyName ?? "No company"}
                            </p>
                            <p>{t.title}</p>
                            <p className="text-[11px] text-steel">
                              {[t.assigneeName, t.sourceLabel, t.dueAt?.slice(0, 10)]
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
                    </div>
                  ) : null}
                  {data.followUps.dueTodayTotal > 0 ? (
                    <div>
                      <h3 className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-steel">
                        Due today ({data.followUps.dueTodayTotal})
                      </h3>
                      <ul className="space-y-2">
                        {data.followUps.dueToday.map((t) => (
                          <li
                            key={t.id}
                            className="rounded-md border border-border px-3 py-2 text-[12px]"
                          >
                            <p className="font-semibold uppercase">
                              {t.companyName ?? "No company"}
                            </p>
                            <p>{t.title}</p>
                            <p className="text-[11px] text-steel">
                              {[t.assigneeName, t.sourceLabel].filter(Boolean).join(" · ")}
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
                    </div>
                  ) : null}
                </div>
              )}
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
