import { createFileRoute, Link } from "@tanstack/react-router";
import { Fragment, useEffect, useMemo, useState } from "react";
import { StatusBadge } from "@/components/ab/Badges";
import {
  SalesIntelligenceHeader,
  SiExportButton,
  SiField,
  SiMetricCard,
  SiMovementValue,
  SiPager,
  SiPeriodSummary,
  SiProvenance,
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
import { cn } from "@/lib/utils";
import { formatGbp } from "@/domain/sales-intelligence";
import {
  BUSINESS_PERIOD_PRESETS,
  businessPeriodLabel,
  type BusinessPeriodPreset,
} from "@/domain/sales-history-period";
import {
  compactPortfolioUrlSearch,
  parsePortfolioUrlSearch,
  PORTFOLIO_DEFAULT_PERIOD,
  type PortfolioFilter,
  type PortfolioUrlSearch,
} from "@/domain/sales-portfolio";
import {
  exportSalesRepPortfolioCsvFn,
  getSalesRepPortfolioFn,
} from "@/server/phase2/fns";

export const Route = createFileRoute("/sales/sales-intelligence/portfolio")({
  validateSearch: (search: Record<string, unknown>): PortfolioUrlSearch =>
    parsePortfolioUrlSearch(search),
  head: () => ({
    meta: [
      { title: "Sales Rep Portfolio — Sales Intelligence — Automotive Brands" },
      {
        name: "description",
        content:
          "Daily sales-rep portfolio workspace: customers needing attention, growth/decline, stopped products, and explainable opportunities.",
      },
    ],
  }),
  component: SalesRepPortfolioPage,
});

type PortfolioData = Extract<
  Awaited<ReturnType<typeof getSalesRepPortfolioFn>>,
  { ok: true }
>["data"];

const PERIOD_OPTIONS: Array<{ value: BusinessPeriodPreset; label: string }> = [
  ...BUSINESS_PERIOD_PRESETS.map((p) => ({ value: p, label: businessPeriodLabel(p) })),
];

const FILTER_OPTIONS: Array<{ value: PortfolioFilter; label: string }> = [
  { value: "ALL", label: "All customers" },
  { value: "NEEDS_ATTENTION", label: "Needs attention" },
  { value: "DORMANT", label: "Dormant" },
  { value: "DECLINING", label: "Declining" },
  { value: "GROWING", label: "Growing" },
  { value: "STOPPED_PRODUCTS", label: "Stopped products" },
  { value: "HAS_OPPORTUNITIES", label: "Has opportunities" },
  { value: "HAS_FOLLOWUP", label: "Open follow-up" },
  { value: "NO_SALES", label: "No sales this period" },
];

function SalesRepPortfolioPage() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const freshness = useSalesIntelligenceFreshnessLabel();
  const [data, setData] = useState<PortfolioData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [showHelp, setShowHelp] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(search.companyId ?? null);
  const [followUp, setFollowUp] = useState<FollowUpRequest | null>(null);

  const query = useMemo(
    () => ({
      period: search.period ?? PORTFOLIO_DEFAULT_PERIOD,
      from: search.from ?? null,
      to: search.to ?? null,
      salesRepId: search.salesRepId ?? null,
      unassigned: search.unassigned ?? false,
      customerGroupId: search.customerGroupId ?? null,
      brandId: search.brandId ?? null,
      filter: search.filter ?? "ALL",
      q: search.q ?? null,
      page: search.page ?? 1,
    }),
    [search],
  );

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void getSalesRepPortfolioFn({ data: query }).then((res) => {
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
    const next: PortfolioUrlSearch = { ...search, page: 1 };
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined || v === null || v === "" || v === false) {
        delete (next as Record<string, unknown>)[k];
      } else {
        (next as Record<string, unknown>)[k] = v;
      }
    }
    if (typeof patch["page"] === "number") next.page = patch["page"];
    void navigate({ search: compactPortfolioUrlSearch(next) });
  }

  async function exportCsv() {
    const res = await exportSalesRepPortfolioCsvFn({ data: query });
    if (!res.ok) {
      setError(res.error);
      return;
    }
    const blob = new Blob([res.data], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `sales-rep-portfolio-${query.period ?? "period"}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const kpis = data?.kpis;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <SalesIntelligenceHeader
        title="Sales Rep Portfolio"
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
            <SiExportButton onClick={() => void exportCsv()} />
          </>
        }
      />

      <div className="space-y-4 px-4 py-4 sm:px-6">
        {showHelp && data ? (
          <section className="rounded-md border border-border bg-surface/40 p-4 text-[12px] text-steel">
            <h2 className="font-display text-sm font-semibold uppercase text-foreground">
              How customer insights are calculated
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

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6">
          <SiField label="Period">
            <select
              className={siControlClassName()}
              value={query.period}
              onChange={(e) =>
                patchSearch({ period: e.target.value as BusinessPeriodPreset, page: 1 })
              }
            >
              {PERIOD_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </SiField>
          {query.period === "CUSTOM" ? (
            <>
              <SiField label="From">
                <input
                  type="date"
                  className={siControlClassName()}
                  value={search.from ?? ""}
                  onChange={(e) => patchSearch({ from: e.target.value || undefined, page: 1 })}
                />
              </SiField>
              <SiField label="To">
                <input
                  type="date"
                  className={siControlClassName()}
                  value={search.to ?? ""}
                  onChange={(e) => patchSearch({ to: e.target.value || undefined, page: 1 })}
                />
              </SiField>
            </>
          ) : null}
          {data?.canSelectSalesRep ? (
            <SiField label="Sales rep">
              <select
                className={siControlClassName()}
                value={search.unassigned ? "__unassigned__" : (search.salesRepId ?? "")}
                onChange={(e) => {
                  const v = e.target.value;
                  if (v === "__unassigned__") {
                    patchSearch({ unassigned: true, salesRepId: undefined, page: 1 });
                  } else {
                    patchSearch({
                      unassigned: undefined,
                      salesRepId: v || undefined,
                      page: 1,
                    });
                  }
                }}
              >
                <option value="">All (in scope)</option>
                <option value="__unassigned__">Unassigned</option>
                {data.salesReps.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.label}
                  </option>
                ))}
              </select>
            </SiField>
          ) : null}
          <SiField label="Customer group">
            <select
              className={siControlClassName()}
              value={search.customerGroupId ?? ""}
              onChange={(e) =>
                patchSearch({ customerGroupId: e.target.value || undefined, page: 1 })
              }
            >
              <option value="">All groups</option>
              {(data?.customerGroups ?? []).map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
          </SiField>
          <SiField label="Brand">
            <select
              className={siControlClassName()}
              value={search.brandId ?? ""}
              onChange={(e) => patchSearch({ brandId: e.target.value || undefined, page: 1 })}
            >
              <option value="">All brands</option>
              {(data?.brands ?? []).map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </SiField>
          <SiField label="Filter">
            <select
              className={siControlClassName()}
              value={query.filter}
              onChange={(e) =>
                patchSearch({ filter: e.target.value as PortfolioFilter, page: 1 })
              }
            >
              {FILTER_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </SiField>
          <SiField label="Search">
            <input
              className={siControlClassName()}
              placeholder="Customer, MAM, group…"
              value={search.q ?? ""}
              onChange={(e) => patchSearch({ q: e.target.value || undefined, page: 1 })}
            />
          </SiField>
        </div>

        {data ? (
          <SiPeriodSummary
            selectedLabel={`${data.period.label} · ${data.period.displayRangeLabel}`}
            selectedFrom={data.period.displayFrom}
            selectedTo={data.period.displayTo}
            comparisonFrom={data.comparison?.from ?? null}
            comparisonTo={data.comparison?.to ?? null}
            comparisonLabel={data.comparison?.label ?? null}
          />
        ) : null}

        {error ? (
          <p className="rounded-md border border-bad/40 bg-bad/5 px-3 py-2 text-[13px] text-bad">
            {error}
          </p>
        ) : null}

        {kpis ? (
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
            <SiMetricCard
              label="Net sales"
              value={formatGbp(kpis.netSales)}
              primary
              movement={{
                change: kpis.movement,
                percentChange: kpis.movementPercent,
                money: true,
              }}
            />
            <SiMetricCard label="Active customers" value={String(kpis.activeCustomers)} />
            <SiMetricCard label="Needing attention" value={String(kpis.needingAttention)} />
            <SiMetricCard label="Dormant" value={String(kpis.dormantCustomers)} />
            <SiMetricCard label="Growing" value={String(kpis.growingCustomers)} />
            <SiMetricCard label="Declining" value={String(kpis.decliningCustomers)} />
            <SiMetricCard label="Open CRM follow-ups" value={String(kpis.openFollowUps)} />
          </div>
        ) : null}

        {loading ? (
          <p className="text-[13px] text-steel">Loading portfolio…</p>
        ) : null}

        {!loading && data ? (
          <>
            <section>
              <h2 className="mb-2 font-display text-sm font-semibold uppercase tracking-wide">
                Needs attention
              </h2>
              <div className="space-y-2">
                {data.rows.filter((r) => r.needsAttention).length === 0 ? (
                  <p className="text-[12px] text-steel">
                    No customers need attention for the current filters.
                  </p>
                ) : (
                  data.rows
                    .filter((r) => r.needsAttention)
                    .slice(0, 12)
                    .map((r) => (
                      <article
                        key={`attn-${r.companyId}`}
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
                          <div className="text-right text-[12px]">
                            <p className="font-semibold">{formatGbp(r.currentNetSales)}</p>
                            <SiMovementValue
                              change={r.movement}
                              percentChange={r.movementPercent}
                              money
                            />
                          </div>
                        </div>
                        <p className="mt-2 text-[12px] text-steel">{r.cadenceSummary}</p>
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {r.attentionReasons.map((a) => (
                            <StatusBadge key={a.code} tone={a.code === "DORMANT" ? "bad" : "warn"}>
                              {a.label}
                            </StatusBadge>
                          ))}
                          {r.stoppedProductCount > 0 ? (
                            <StatusBadge tone="neutral">
                              {r.stoppedProductCount} stopped
                            </StatusBadge>
                          ) : null}
                          {r.opportunityCount > 0 ? (
                            <StatusBadge tone="neutral">
                              {r.opportunityCount} opportunities
                            </StatusBadge>
                          ) : null}
                        </div>
                        <ul className="mt-2 space-y-1 text-[11px] text-steel">
                          {r.attentionReasons.map((a) => (
                            <li key={`${a.code}-x`}>{a.explanation}</li>
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
                            View sales analysis
                          </Link>
                          <SiCreateFollowUpButton
                            onClick={() =>
                              setFollowUp({
                                sourceModule: "PORTFOLIO",
                                sourceReason: r.dormant
                                  ? "DORMANT"
                                  : r.declining
                                    ? "DECLINING"
                                    : "PURCHASE_GAP",
                                companyId: r.companyId,
                                period: query.period,
                                from: query.from,
                                to: query.to,
                              })
                            }
                          />
                        </div>
                      </article>
                    ))
                )}
              </div>
            </section>

            <section>
              <h2 className="mb-2 font-display text-sm font-semibold uppercase tracking-wide">
                My customers
              </h2>
              <div className="overflow-x-auto rounded-md border border-border">
                <table className="min-w-full text-left text-[12px]">
                  <SiStickyTableHead>
                    <tr className="border-b border-border text-[10px] font-bold uppercase tracking-wide text-steel">
                      <th className="px-3 py-2">Customer</th>
                      <th className="px-3 py-2">Net sales</th>
                      <th className="px-3 py-2">Movement</th>
                      <th className="px-3 py-2">Last purchase</th>
                      <th className="px-3 py-2">Cadence</th>
                      <th className="px-3 py-2">Stopped</th>
                      <th className="px-3 py-2">Opps</th>
                      <th className="px-3 py-2">Follow-ups</th>
                      <th className="px-3 py-2">Status</th>
                    </tr>
                  </SiStickyTableHead>
                  <tbody>
                    {data.rows.length === 0 ? (
                      <tr>
                        <td colSpan={9} className="px-3 py-6 text-steel">
                          No customers match the current filters.
                        </td>
                      </tr>
                    ) : (
                      data.rows.map((r) => (
                        <Fragment key={r.companyId}>
                          <tr
                            className={cn(
                              "border-b border-border/70 hover:bg-surface/40",
                              r.needsAttention && "bg-amber-500/5",
                            )}
                          >
                            <td className="px-3 py-2">
                              <button
                                type="button"
                                className="text-left font-semibold uppercase hover:underline"
                                onClick={() =>
                                  setExpandedId((id) => (id === r.companyId ? null : r.companyId))
                                }
                              >
                                {r.companyName}
                              </button>
                              <p className="text-[10px] text-steel">
                                {[r.mamAccount, r.customerGroupName].filter(Boolean).join(" · ")}
                              </p>
                            </td>
                            <td className="px-3 py-2 font-semibold">{formatGbp(r.currentNetSales)}</td>
                            <td className="px-3 py-2">
                              <SiMovementValue
                                change={r.movement}
                                percentChange={r.movementPercent}
                                money
                              />
                            </td>
                            <td className="px-3 py-2">
                              {r.lastPurchaseDate
                                ? r.lastPurchaseDate.split("-").reverse().join("/")
                                : "—"}
                            </td>
                            <td className="max-w-[14rem] px-3 py-2 text-[11px] text-steel">
                              {r.typicalIntervalDays != null
                                ? `~${r.typicalIntervalDays}d · ${r.daysSinceLastPurchase ?? "—"}d since`
                                : "Insufficient history"}
                            </td>
                            <td className="px-3 py-2">{r.stoppedProductCount}</td>
                            <td className="px-3 py-2">{r.opportunityCount}</td>
                            <td className="px-3 py-2">{r.openFollowUpCount}</td>
                            <td className="px-3 py-2">
                              <div className="flex flex-wrap gap-1">
                                {r.attentionReasons.slice(0, 2).map((a) => (
                                  <StatusBadge
                                    key={a.code}
                                    tone={a.code === "DORMANT" ? "bad" : "warn"}
                                  >
                                    {a.label}
                                  </StatusBadge>
                                ))}
                                {r.growing && !r.needsAttention ? (
                                  <StatusBadge tone="good">Growing</StatusBadge>
                                ) : null}
                              </div>
                            </td>
                          </tr>
                          {expandedId === r.companyId ? (
                            <tr className="border-b border-border bg-surface/30">
                              <td colSpan={9} className="px-3 py-3">
                                <div className="grid gap-3 lg:grid-cols-2">
                                  <div>
                                    <h4 className="text-[10px] font-bold uppercase tracking-wide text-steel">
                                      Purchasing behaviour
                                    </h4>
                                    <p className="mt-1 text-[12px]">{r.cadenceSummary}</p>
                                    <p className="mt-1 text-[12px] text-steel">
                                      Products bought this period: {r.productsPurchased}
                                    </p>
                                  </div>
                                  <div>
                                    <h4 className="text-[10px] font-bold uppercase tracking-wide text-steel">
                                      Opportunities
                                    </h4>
                                    {r.opportunities.length === 0 ? (
                                      <p className="mt-1 text-[12px] text-steel">
                                        No evidence-based opportunities for this customer.
                                      </p>
                                    ) : (
                                      <ul className="mt-1 space-y-1.5 text-[12px]">
                                        {r.opportunities.map((o, i) => (
                                          <li key={`${o.type}-${o.sku ?? o.brandName ?? i}`}>
                                            <span className="font-semibold">{o.title}</span>
                                            <span className="text-steel"> — {o.explanation}</span>
                                          </li>
                                        ))}
                                      </ul>
                                    )}
                                  </div>
                                </div>
                                <div className="mt-3 flex flex-wrap gap-2">
                                  <Link
                                    to="/admin/customers/$id"
                                    params={{ id: r.companyId }}
                                    className="h-8 rounded-md border border-border px-2.5 text-[10px] font-bold uppercase leading-8"
                                  >
                                    View customer
                                  </Link>
                                  <Link
                                    to={ROUTES.salesIntelligenceGaps}
                                    search={{ mode: "customers", companyId: r.companyId }}
                                    className="h-8 rounded-md border border-border px-2.5 text-[10px] font-bold uppercase leading-8"
                                  >
                                    Gap analysis
                                  </Link>
                                  <Link
                                    to={ROUTES.salesIntelligenceOpportunities}
                                    search={{ companyId: r.companyId }}
                                    className="h-8 rounded-md border border-border px-2.5 text-[10px] font-bold uppercase leading-8"
                                  >
                                    Range opportunities
                                  </Link>
                                  <SiCreateFollowUpButton
                                    onClick={() =>
                                      setFollowUp({
                                        sourceModule: "PORTFOLIO",
                                        sourceReason: r.needsAttention
                                          ? r.dormant
                                            ? "DORMANT"
                                            : r.declining
                                              ? "DECLINING"
                                              : "PURCHASE_GAP"
                                          : "CUSTOMER",
                                        companyId: r.companyId,
                                        period: query.period,
                                        from: query.from,
                                        to: query.to,
                                      })
                                    }
                                  />
                                </div>
                              </td>
                            </tr>
                          ) : null}
                        </Fragment>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
              <SiPager
                page={data.page}
                totalPages={Math.max(1, Math.ceil(data.total / data.pageSize))}
                total={data.total}
                onPage={(p) => patchSearch({ page: p })}
              />
            </section>

            <SiProvenance
              text={`Portfolio uses Autopart realised sales only. Credits are signed negative and do not create purchase presence. Comparison uses the previous equivalent-length period.${data.salesRepFilterLabel ? ` Scope: ${data.salesRepFilterLabel}.` : ""}`}
            />
          </>
        ) : null}
      </div>

      <CreateFollowUpDrawer
        open={Boolean(followUp)}
        request={followUp}
        onClose={() => setFollowUp(null)}
      />
    </div>
  );
}
