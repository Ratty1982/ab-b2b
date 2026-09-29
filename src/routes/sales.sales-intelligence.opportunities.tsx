import { createFileRoute } from "@tanstack/react-router";
import { Fragment, useEffect, useMemo, useState } from "react";
import { AvailabilityBadge } from "@/components/ab/AvailabilityBadge";
import { StatusBadge } from "@/components/ab/Badges";
import {
  SalesIntelligenceHeader,
  SiClearFiltersButton,
  SiEntityContext,
  SiExportButton,
  SiField,
  SiMetricCard,
  SiPager,
  SiPeriodSummary,
  SiProvenance,
  SiStickyTableHead,
  siControlClassName,
} from "@/components/sales-intelligence/workspace";
import { ROUTES } from "@/lib/app-nav";
import type { PublicAvailability } from "@/domain/availability";
import {
  compactOpportunityUrlSearch,
  parseOpportunityUrlSearch,
  rangeMatchLabel,
  type OpportunityAnalysisPeriod,
  type OpportunitySort,
  type OpportunityUrlSearch,
  type RangeMatch,
} from "@/domain/sales-opportunity";
import { formatPeriodRangeLong, shouldShowEntitySuggestions } from "@/domain/sales-intelligence-ux";
import {
  exportCustomerRangeOpportunitiesCsvFn,
  getCustomerRangeOpportunitiesFn,
  searchSalesIntelligenceCustomersFn,
} from "@/server/phase2/fns";

export const Route = createFileRoute("/sales/sales-intelligence/opportunities")({
  validateSearch: (search: Record<string, unknown>): OpportunityUrlSearch =>
    parseOpportunityUrlSearch(search),
  head: () => ({
    meta: [
      { title: "Range Opportunities — Sales Intelligence — Automotive Brands" },
      {
        name: "description",
        content:
          "Current catalogue products missing from a customer’s range, supported by comparable customer purchasing evidence.",
      },
    ],
  }),
  component: RangeOpportunitiesPage,
});

type CustomerHit = {
  id: string;
  name: string;
  autopartCustomerCode: string | null;
  accountNumber: string | null;
  salesperson: { name: string } | null;
};

type OppData = Extract<
  Awaited<ReturnType<typeof getCustomerRangeOpportunitiesFn>>,
  { ok: true }
>["data"];

const PERIOD_OPTIONS: Array<{ value: OpportunityAnalysisPeriod; label: string }> = [
  { value: "LAST_90", label: "Last 3 months" },
  { value: "LAST_180", label: "Last 6 months" },
  { value: "LAST_365", label: "Last 12 months" },
  { value: "LAST_730", label: "Last 24 months" },
  { value: "CUSTOM", label: "Custom" },
];

function RangeOpportunitiesPage() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const period = (search.period ?? "LAST_365") as OpportunityAnalysisPeriod;
  const sort = (search.sort ?? "RANGE_MATCH") as OpportunitySort;
  const page = search.page ?? 1;
  const availability = search.availability ?? "ORDERABLE";
  /** Empty = default range matches only (exclude broader). */
  const rangeMatch = search.rangeMatch ?? "";

  const [customerQ, setCustomerQ] = useState("");
  const [changingEntity, setChangingEntity] = useState(false);
  const [customerHits, setCustomerHits] = useState<CustomerHit[]>([]);
  const [filterQ, setFilterQ] = useState(search.q ?? "");
  const [data, setData] = useState<OppData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedSku, setExpandedSku] = useState<string | null>(null);

  function patch(next: Partial<Record<keyof OpportunityUrlSearch, string | number | boolean | null>>) {
    const draft: OpportunityUrlSearch = {};
    const nextCompany =
      next.companyId === null ? undefined : ((next.companyId as string | undefined) ?? search.companyId);
    const nextPeriod = (next.period as OpportunityAnalysisPeriod | undefined) ?? period;
    const nextFrom = next.from === null ? undefined : ((next.from as string | undefined) ?? search.from);
    const nextTo = next.to === null ? undefined : ((next.to as string | undefined) ?? search.to);
    const nextQ = next.q === null ? undefined : ((next.q as string | undefined) ?? search.q);
    const nextBrand =
      next.brandId === null ? undefined : ((next.brandId as string | undefined) ?? search.brandId);
    const nextCat =
      next.categoryId === null
        ? undefined
        : ((next.categoryId as string | undefined) ?? search.categoryId);
    const nextMatch =
      next.rangeMatch === null || next.rangeMatch === ""
        ? undefined
        : ((next.rangeMatch as OpportunityUrlSearch["rangeMatch"] | undefined) ??
          (rangeMatch || undefined));
    const nextAvail =
      next.availability === null
        ? undefined
        : ((next.availability as OpportunityUrlSearch["availability"]) ?? availability);
    const nextMin =
      next.minAdoption === null
        ? undefined
        : ((next.minAdoption as number | undefined) ?? search.minAdoption);
    const nextSort = (next.sort as OpportunitySort | undefined) ?? sort;
    const nextPage = (next.page as number | undefined) ?? page;
    const nextBroader =
      next.includeBroader === null
        ? undefined
        : ((next.includeBroader as boolean | undefined) ?? search.includeBroader);

    if (nextCompany) draft.companyId = nextCompany;
    if (nextPeriod !== "LAST_365") draft.period = nextPeriod;
    if (nextPeriod === "CUSTOM") {
      if (nextFrom) draft.from = nextFrom;
      if (nextTo) draft.to = nextTo;
    }
    if (nextQ) draft.q = nextQ;
    if (nextBrand) draft.brandId = nextBrand;
    if (nextCat) draft.categoryId = nextCat;
    if (nextMatch && nextMatch !== "ALL") draft.rangeMatch = nextMatch;
    if (nextAvail && nextAvail !== "ORDERABLE") draft.availability = nextAvail;
    if (nextMin != null && nextMin > 0) draft.minAdoption = nextMin;
    if (nextSort !== "RANGE_MATCH") draft.sort = nextSort;
    if (nextPage > 1) draft.page = nextPage;
    if (nextBroader) draft.includeBroader = true;
    void navigate({ search: compactOpportunityUrlSearch(draft) });
  }

  useEffect(() => {
    if (customerQ.trim().length < 1) {
      setCustomerHits([]);
      return;
    }
    const t = window.setTimeout(() => {
      void searchSalesIntelligenceCustomersFn({ data: { q: customerQ.trim(), limit: 15 } }).then(
        (r) => {
          if (r.ok) setCustomerHits(r.data.items as CustomerHit[]);
        },
      );
    }, 200);
    return () => window.clearTimeout(t);
  }, [customerQ]);

  useEffect(() => {
    const t = window.setTimeout(() => {
      if ((filterQ.trim() || "") === (search.q ?? "")) return;
      patch({ q: filterQ.trim() || null, page: 1 });
    }, 250);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterQ]);

  useEffect(() => {
    setFilterQ(search.q ?? "");
  }, [search.q]);

  useEffect(() => {
    setChangingEntity(false);
    setCustomerQ("");
    setCustomerHits([]);
    setExpandedSku(null);
  }, [search.companyId]);

  useEffect(() => {
    if (!search.companyId) {
      setData(null);
      return;
    }
    void (async () => {
      setLoading(true);
      const r = await getCustomerRangeOpportunitiesFn({
        data: {
          companyId: search.companyId,
          period,
          from: search.from ?? null,
          to: search.to ?? null,
          q: search.q ?? null,
          brandId: search.brandId ?? null,
          categoryId: search.categoryId ?? null,
          rangeMatch: rangeMatch || null,
          availability,
          minAdoption: search.minAdoption ?? null,
          sort,
          page,
          pageSize: 25,
          includeBroader: search.includeBroader === true,
        },
      });
      if (!r.ok) {
        setError(r.error);
        setData(null);
      } else {
        setError(null);
        setData(r.data);
      }
      setLoading(false);
    })();
  }, [
    search.companyId,
    period,
    search.from,
    search.to,
    search.q,
    search.brandId,
    search.categoryId,
    rangeMatch,
    availability,
    search.minAdoption,
    sort,
    page,
    search.includeBroader,
  ]);

  const totalPages = useMemo(() => {
    if (!data) return 1;
    return Math.max(1, Math.ceil(data.items.total / data.items.pageSize));
  }, [data]);

  const customerSelected = Boolean(search.companyId);
  const showHits = shouldShowEntitySuggestions({
    entitySelected: customerSelected,
    changing: changingEntity,
    queryLength: customerQ.trim().length,
    hitCount: customerHits.length,
  });

  const filtersActive = Boolean(
    filterQ.trim() ||
      search.brandId ||
      search.categoryId ||
      Boolean(rangeMatch) ||
      (availability && availability !== "ORDERABLE") ||
      (search.minAdoption != null && search.minAdoption > 0) ||
      (sort && sort !== "RANGE_MATCH"),
  );

  async function exportCsv() {
    if (!search.companyId) return;
    const r = await exportCustomerRangeOpportunitiesCsvFn({
      data: {
        companyId: search.companyId,
        period,
        from: search.from ?? null,
        to: search.to ?? null,
        q: search.q ?? null,
        brandId: search.brandId ?? null,
        categoryId: search.categoryId ?? null,
        rangeMatch: rangeMatch || null,
        availability,
        minAdoption: search.minAdoption ?? null,
        sort,
        includeBroader: search.includeBroader === true,
      },
    });
    if (!r.ok) {
      setError(r.error);
      return;
    }
    const blob = new Blob([r.data.csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = r.data.filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div>
      <SalesIntelligenceHeader
        title="Range Opportunities"
        actions={
          search.companyId ? <SiExportButton onClick={() => void exportCsv()} /> : null
        }
      />

      <div className="space-y-3 p-4 sm:p-5">
        <p className="max-w-3xl text-[13px] text-steel">
          Products missing from this customer’s current purchasing range, supported by comparable
          customer purchasing evidence. Not AI recommendations.
        </p>

        {customerSelected && data && !changingEntity ? (
          <SiEntityContext
            eyebrow="Customer"
            title={data.company.name}
            meta={[
              data.company.autopartCustomerCode || data.company.accountNumber || "No Autopart code",
              data.company.salesperson?.name ?? "",
            ]}
            onChange={() => setChangingEntity(true)}
            changeLabel="Change customer"
          />
        ) : (
          <SiField label="Customer" className="max-w-xl">
            <input
              className={siControlClassName()}
              placeholder="Search name or Autopart account…"
              value={customerQ}
              onChange={(e) => setCustomerQ(e.target.value)}
              autoFocus={changingEntity}
            />
            {showHits ? (
              <ul className="mt-1 max-h-48 overflow-auto rounded-md border border-border bg-card text-[13px]">
                {customerHits.map((c) => (
                  <li key={c.id}>
                    <button
                      type="button"
                      className="flex w-full flex-col px-3 py-2 text-left hover:bg-secondary/60"
                      onClick={() => {
                        setCustomerQ("");
                        setCustomerHits([]);
                        setChangingEntity(false);
                        patch({ companyId: c.id, page: 1 });
                      }}
                    >
                      <span className="font-medium">{c.name}</span>
                      <span className="text-[11px] text-steel">
                        {c.autopartCustomerCode || c.accountNumber || "No Autopart code"}
                        {c.salesperson ? ` · ${c.salesperson.name}` : ""}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </SiField>
        )}

        <div className="grid gap-2 sm:grid-cols-2 lg:max-w-xl">
          <SiField label="Analysis period">
            <select
              className={siControlClassName(period === "CUSTOM")}
              value={period}
              onChange={(e) =>
                patch({ period: e.target.value as OpportunityAnalysisPeriod, page: 1 })
              }
            >
              {PERIOD_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </SiField>
        </div>

        {period === "CUSTOM" ? (
          <div className="grid gap-2 sm:grid-cols-2 lg:max-w-xl">
            <SiField label="From">
              <input
                type="date"
                className={siControlClassName(true)}
                value={search.from ?? ""}
                onChange={(e) => patch({ from: e.target.value || null, page: 1 })}
              />
            </SiField>
            <SiField label="To">
              <input
                type="date"
                className={siControlClassName(true)}
                value={search.to ?? ""}
                onChange={(e) => patch({ to: e.target.value || null, page: 1 })}
              />
            </SiField>
          </div>
        ) : null}

        {error ? <p className="text-[13px] text-bad">{error}</p> : null}
        {loading ? <p className="text-[13px] text-steel">Analysing range opportunities…</p> : null}

        {!loading && !search.companyId ? (
          <p className="text-[14px] text-steel">Search and select a customer to begin.</p>
        ) : null}

        {data ? (
          <div className="space-y-4">
            <div className="space-y-1">
              <SiPeriodSummary
                selectedFrom={data.analysisPeriod.from}
                selectedTo={data.analysisPeriod.to}
              />
              <SiProvenance text={data.dataSource} />
            </div>

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <SiMetricCard
                label="Range opportunities"
                value={String(data.summary.opportunities)}
                primary
              />
              <SiMetricCard
                label="Comparable customers"
                value={String(data.summary.comparableCustomers)}
                primary
              />
              <SiMetricCard
                label="Active categories"
                value={String(data.summary.activeCategories)}
              />
              <SiMetricCard label="Active brands" value={String(data.summary.activeBrands)} />
            </div>

            {data.noPurchaseHistory ? (
              <p className="text-[14px] text-steel">No purchase history in this period.</p>
            ) : null}
            {data.evidenceInsufficient ? (
              <p className="text-[14px] text-steel">
                Not enough comparable customer history to identify reliable range opportunities.
              </p>
            ) : null}

            {!data.noPurchaseHistory && !data.evidenceInsufficient ? (
              <>
                <div className="flex flex-wrap items-end gap-2">
                  <SiField label="Search" className="min-w-[10rem] flex-1">
                    <input
                      className={siControlClassName(Boolean(filterQ.trim()))}
                      value={filterQ}
                      onChange={(e) => setFilterQ(e.target.value)}
                      placeholder="SKU or name"
                    />
                  </SiField>
                  <SiField label="Brand" className="min-w-[9rem]">
                    <select
                      className={siControlClassName(Boolean(search.brandId))}
                      value={search.brandId ?? ""}
                      onChange={(e) => patch({ brandId: e.target.value || null, page: 1 })}
                    >
                      <option value="">All brands</option>
                      {data.filterOptions.brands.map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.name}
                        </option>
                      ))}
                    </select>
                  </SiField>
                  <SiField label="Category" className="min-w-[9rem]">
                    <select
                      className={siControlClassName(Boolean(search.categoryId))}
                      value={search.categoryId ?? ""}
                      onChange={(e) => patch({ categoryId: e.target.value || null, page: 1 })}
                    >
                      <option value="">All categories</option>
                      {data.filterOptions.categories.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </SiField>
                  <SiField label="Range match" className="min-w-[10rem]">
                    <select
                      className={siControlClassName(Boolean(rangeMatch))}
                      value={rangeMatch}
                      onChange={(e) =>
                        patch({
                          rangeMatch: e.target.value || null,
                          includeBroader: e.target.value === "ALL" ? true : null,
                          page: 1,
                        })
                      }
                    >
                      <option value="">Range matches (default)</option>
                      <option value="SAME_BRAND_CATEGORY">Same brand + category</option>
                      <option value="SAME_CATEGORY">Same category</option>
                      <option value="SAME_BRAND">Same brand</option>
                      <option value="BROADER_RANGE">Broader range</option>
                      <option value="ALL">Include broader range</option>
                    </select>
                  </SiField>
                  <SiField label="Availability" className="min-w-[9rem]">
                    <select
                      className={siControlClassName(availability !== "ORDERABLE")}
                      value={availability}
                      onChange={(e) =>
                        patch({
                          availability: e.target.value || null,
                          page: 1,
                        })
                      }
                    >
                      <option value="ORDERABLE">Orderable</option>
                      <option value="IN">In stock</option>
                      <option value="LOW">Low stock</option>
                      <option value="BACKORDER">Backorder</option>
                      <option value="ALL">All</option>
                    </select>
                  </SiField>
                  <SiField label="Sort" className="min-w-[10rem]">
                    <select
                      className={siControlClassName(sort !== "RANGE_MATCH")}
                      value={sort}
                      onChange={(e) => patch({ sort: e.target.value as OpportunitySort, page: 1 })}
                    >
                      <option value="RANGE_MATCH">Strongest range match</option>
                      <option value="ADOPTION">Highest adoption</option>
                      <option value="BUYERS">Most comparable buyers</option>
                      <option value="UNITS">Most comparable units</option>
                      <option value="NAME_AZ">Product A–Z</option>
                    </select>
                  </SiField>
                  {filtersActive ? (
                    <SiClearFiltersButton
                      onClick={() => {
                        setFilterQ("");
                        patch({
                          q: null,
                          brandId: null,
                          categoryId: null,
                          rangeMatch: null,
                          availability: null,
                          minAdoption: null,
                          sort: "RANGE_MATCH",
                          page: 1,
                        });
                      }}
                    />
                  ) : null}
                </div>

                {data.items.total === 0 ? (
                  <p className="text-[14px] text-steel">
                    No range opportunities meet the current evidence criteria.
                  </p>
                ) : (
                  <>
                    <div className="hidden overflow-x-auto md:block">
                      <table className="w-full text-left text-[13px]">
                        <SiStickyTableHead>
                          <tr className="border-b-2 border-foreground text-[11px] uppercase tracking-wide text-steel">
                            <th className="bg-background py-2 pr-2">Product</th>
                            <th className="bg-background py-2 pr-2">Range match</th>
                            <th className="bg-background py-2 pr-2 text-right">Comparable buyers</th>
                            <th className="bg-background py-2 pr-2 text-right">Adoption</th>
                            <th className="bg-background py-2 pr-2 text-right">Comparable units</th>
                            <th className="bg-background py-2 pr-2">Availability</th>
                            <th className="bg-background py-2">Action</th>
                          </tr>
                        </SiStickyTableHead>
                        <tbody>
                          {data.items.items.map((r) => (
                            <Fragment key={r.sku}>
                              <tr
                                className="cursor-pointer border-b border-border/60 hover:bg-surface/40"
                                onClick={() =>
                                  setExpandedSku((prev) => (prev === r.sku ? null : r.sku))
                                }
                              >
                                <td className="py-2.5 pr-2">
                                  <div className="font-medium">{r.name}</div>
                                  <div className="font-mono text-[11px] text-steel">
                                    {r.sku}
                                    {r.brandName || r.categoryName
                                      ? ` · ${[r.brandName, r.categoryName].filter(Boolean).join(" · ")}`
                                      : ""}
                                  </div>
                                </td>
                                <td className="py-2.5 pr-2">
                                  <StatusBadge
                                    tone={
                                      r.rangeMatch === "SAME_BRAND_CATEGORY"
                                        ? "good"
                                        : r.rangeMatch === "BROADER_RANGE"
                                          ? "neutral"
                                          : "brand"
                                    }
                                  >
                                    {r.rangeMatchLabel}
                                  </StatusBadge>
                                </td>
                                <td className="py-2.5 pr-2 text-right tabular-nums">
                                  {r.buyers} / {r.cohort}
                                </td>
                                <td className="py-2.5 pr-2 text-right font-semibold tabular-nums">
                                  {r.adoptionLabel}
                                </td>
                                <td className="py-2.5 pr-2 text-right tabular-nums">
                                  {r.comparableUnits}
                                </td>
                                <td className="py-2.5 pr-2">
                                  {r.availabilityBand ? (
                                    <AvailabilityBadge
                                      availability={r.availabilityBand as PublicAvailability}
                                    />
                                  ) : (
                                    <span className="text-[11px] text-steel">
                                      {r.availabilityLabel}
                                    </span>
                                  )}
                                </td>
                                <td className="py-2.5">
                                  <a
                                    href={`${ROUTES.salesIntelligence}?mode=products&sku=${encodeURIComponent(r.sku)}&period=CUSTOM&from=${data.analysisPeriod.from}&to=${data.analysisPeriod.to}`}
                                    className="inline-flex h-8 items-center rounded-md border border-border px-2.5 text-[10px] font-bold uppercase tracking-wide text-steel hover:border-primary hover:text-primary"
                                    onClick={(e) => e.stopPropagation()}
                                  >
                                    View product enquiry →
                                  </a>
                                </td>
                              </tr>
                              {expandedSku === r.sku ? (
                                <tr className="border-b border-border/40 bg-surface/30">
                                  <td colSpan={7} className="px-3 py-3 text-[12px]">
                                    <WhyPanel
                                      item={r}
                                      analysisFrom={data.analysisPeriod.from}
                                      analysisTo={data.analysisPeriod.to}
                                    />
                                  </td>
                                </tr>
                              ) : null}
                            </Fragment>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    <div className="space-y-3 md:hidden">
                      {data.items.items.map((r) => (
                        <div key={r.sku} className="border-b border-border pb-3">
                          <div className="flex items-start justify-between gap-2">
                            <div>
                              <div className="font-medium">{r.name}</div>
                              <div className="font-mono text-[11px] text-steel">{r.sku}</div>
                            </div>
                            <StatusBadge tone="brand">{r.rangeMatchLabel}</StatusBadge>
                          </div>
                          <dl className="mt-2 grid grid-cols-2 gap-1 text-[12px]">
                            <div>
                              <dt className="text-steel">Comparable buyers</dt>
                              <dd className="tabular-nums">
                                {r.buyers} / {r.cohort}
                              </dd>
                            </div>
                            <div>
                              <dt className="text-steel">Adoption</dt>
                              <dd className="font-semibold tabular-nums">{r.adoptionLabel}</dd>
                            </div>
                            <div>
                              <dt className="text-steel">Availability</dt>
                              <dd>{r.availabilityLabel}</dd>
                            </div>
                          </dl>
                          <button
                            type="button"
                            className="mt-2 text-[11px] font-bold uppercase text-steel"
                            onClick={() =>
                              setExpandedSku((prev) => (prev === r.sku ? null : r.sku))
                            }
                          >
                            Why this appears
                          </button>
                          {expandedSku === r.sku ? (
                            <div className="mt-2">
                              <WhyPanel
                                item={r}
                                analysisFrom={data.analysisPeriod.from}
                                analysisTo={data.analysisPeriod.to}
                              />
                            </div>
                          ) : null}
                          <a
                            href={`${ROUTES.salesIntelligence}?mode=products&sku=${encodeURIComponent(r.sku)}&period=CUSTOM&from=${data.analysisPeriod.from}&to=${data.analysisPeriod.to}`}
                            className="mt-2 inline-block text-[11px] font-bold uppercase text-primary"
                          >
                            View product enquiry →
                          </a>
                        </div>
                      ))}
                    </div>

                    <SiPager
                      page={page}
                      totalPages={totalPages}
                      total={data.items.total}
                      onPage={(p) => patch({ page: p })}
                    />
                  </>
                )}
              </>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function WhyPanel({
  item,
  analysisFrom,
  analysisTo,
}: {
  item: OppData["items"]["items"][number];
  analysisFrom: string;
  analysisTo: string;
}) {
  const pct = (n: number | null) =>
    n == null ? "—" : `${Math.round(n * 100)}%`;
  return (
    <div className="space-y-2">
      <h3 className="text-[11px] font-bold uppercase tracking-wide text-steel">Why this appears</h3>
      <p className="text-steel">
        Analysis period: {formatPeriodRangeLong(analysisFrom, analysisTo)}
      </p>
      <p>
        Comparable cohort: <span className="font-medium">{item.why.comparableCustomers}</span>{" "}
        customers (aggregate evidence only)
      </p>
      <p>
        Shared purchasing behaviour — Category overlap: {pct(item.why.categoryOverlap)} · Brand
        overlap: {pct(item.why.brandOverlap)} · SKU overlap: {pct(item.why.skuOverlap)}
      </p>
      <p>
        Candidate: {item.why.buyers} comparable customers purchased {item.sku};{" "}
        {item.why.units} units; {Math.round(item.why.adoption * 100)}% observed adoption
      </p>
      <p>
        Range match: {rangeMatchLabel(item.rangeMatch)}
        {item.why.customerActiveInCategory
          ? ` · Customer currently buys ${item.relatedCustomerProducts} other product(s) in this category`
          : ""}
      </p>
      {item.why.sampleRelatedProducts.length > 0 ? (
        <div>
          <p className="text-steel">Customer currently buys (related):</p>
          <ul className="mt-1 list-inside list-disc">
            {item.why.sampleRelatedProducts.map((p) => (
              <li key={p.sku}>
                {p.name} <span className="font-mono text-[11px] text-steel">{p.sku}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
