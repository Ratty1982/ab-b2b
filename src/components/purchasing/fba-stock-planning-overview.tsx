import { StatusBadge, type Tone } from "@/components/ab/Badges";
import {
  EmptyState,
  LoadingState,
  Pager,
  btnClass,
  controlClass,
  primaryBtnClass,
  qty,
  rate,
  ukDate,
} from "@/components/purchasing/workspace";
import {
  defaultFbaForecastSort,
  planningModeSearchValue,
  salesActivitySearchValue,
  type FbaFocusFilter,
  type FbaForecastSort,
  type FbaPlanningModeSearch,
  type FbaSalesActivity,
} from "@/domain/fba-forecast-search";
import {
  FBA_FORECAST_BLOCKER_LABEL,
  FBA_FORECAST_BLOCKERS,
  FBA_RECOMMENDATION_LABEL,
  FBA_RECOMMENDATIONS,
  type FbaForecastBlocker,
  type FbaRecommendation,
} from "@/domain/fba-replenishment";

export type StockPlanningSearch = {
  q?: string | undefined;
  page?: number | undefined;
  recommendation?: FbaRecommendation | undefined;
  brand?: string | undefined;
  sort?: FbaForecastSort | undefined;
  sold?: "90" | "30" | "all" | undefined;
  plan?: "retaila" | undefined;
  focus?: FbaFocusFilter | undefined;
  blocker?: FbaForecastBlocker | undefined;
  tab?: "overview" | "history" | "imports" | "settings" | undefined;
  sku?: string | undefined;
  days?: 30 | 90 | 180 | 365 | undefined;
};

type Workspace = {
  summary: {
    productsWithSales: number;
    customerSales30: number;
    lowCover: number;
    needsReview: number;
    forecastUnavailable: number;
    productCount: number;
    blockers: Record<FbaForecastBlocker, number>;
  };
  salesActivity: FbaSalesActivity;
  salesActivityUnavailable: boolean;
  planningMode: FbaPlanningModeSearch;
  retailaPlanning: {
    enabled: boolean;
    justification: string | null;
    scopePolicy: string;
    scope: string | null;
    approvedAt: string | null;
    approvedByUserId: string | null;
  };
  retailaReporting: {
    complete: boolean;
    stale: boolean;
    planningAllowed: boolean;
    missingWeekdays: string[];
    last504Day: string | null;
    lastTrmDay: string | null;
    windowFrom: string;
    windowTo: string;
    reason: string;
  };
  canApproveRetailaPlanning: boolean;
  brands: string[];
  oin: {
    documents: number;
    days: number;
    latestDocumentDate: string | null;
    warning: string | null;
  };
  oinUnavailable: string | null;
  fbaImportedAt: string | null;
  fbaFileName: string | null;
  studleyFeedAt: string | null;
  sales: {
    filename: string;
    importedAt: string;
    windows: { d30: boolean };
    coverageFrom: string | null;
    coverageTo: string | null;
  } | null;
  settings: { leadTimeDays: number; targetCoverWeeks: number };
  total: number;
  page: number;
  pageSize: number;
  rows: PlanningRow[];
};

export type PlanningRow = {
  matchKey: string;
  sku: string;
  description: string | null;
  brand: string | null;
  sourceImportedAt: string | null;
  fbaAvailable: number | null;
  studleyAvailable: number | null;
  confirmedInbound: number;
  customerSales: {
    d7: number | null;
    d30: number | null;
    d60: number | null;
    d90: number | null;
    d365: number | null;
  };
  customerWeekly: number | null;
  customerDaily: number | null;
  customerCoverWeeks: number | null;
  activeCoverWeeks: number | null;
  coverBasis: "verified_amazon" | "retaila_planning" | "illustrative" | "none";
  demand: { source: string; label: string; reason: string; blocker: string | null };
  forecast: {
    recommendation: FbaRecommendation;
    recommendationLabel: string;
    reason: string;
    blocker: FbaForecastBlocker | null;
    planningEstimate: boolean;
    coverWeeks: number | null;
    suggestedSendQty: number | null;
    dispatchableQty: number | null;
    studleyShortfallQty: number | null;
    stockoutDate: string | null;
    nextSendDate: string | null;
    weeklyRate: number | null;
    dailyRate: number | null;
    confidence: string;
    assumptions: string[];
  };
};

const SALES_ACTIVITIES = ["365", "90", "30", "all"] as const;
const FOCUS_OPTIONS: Array<{ value: "" | FbaFocusFilter; label: string }> = [
  { value: "", label: "All focus" },
  { value: "low_cover", label: "Low estimated cover" },
  { value: "no_fba", label: "No FBA stock" },
  { value: "no_studley", label: "No Studley stock" },
  { value: "shortfall", label: "Purchasing shortfall" },
  { value: "unavailable", label: "Forecast unavailable" },
  { value: "needs_review", label: "Needs review" },
];

function tone(recommendation: FbaRecommendation): Tone {
  if (recommendation === "SEND_NOW") return "bad";
  if (recommendation === "SEND_SOON") return "warn";
  if (recommendation === "HEALTHY") return "good";
  if (recommendation === "OVERSTOCKED") return "info";
  return "neutral";
}

function coverTone(
  weeks: number | null,
  leadDays: number,
  targetWeeks: number,
): { label: string; className: string } {
  if (weeks == null) return { label: "No cover figure", className: "text-steel" };
  const leadWeeks = leadDays / 7;
  if (weeks <= leadWeeks) return { label: "Urgent review", className: "text-destructive" };
  if (weeks < targetWeeks) return { label: "Review soon", className: "text-warn" };
  if (weeks >= targetWeeks * 2) return { label: "Excess cover", className: "text-info" };
  return { label: "Adequate cover", className: "text-good" };
}

function coverBasisLabel(basis: PlanningRow["coverBasis"]): string {
  if (basis === "verified_amazon") return "Verified Amazon FBA";
  if (basis === "retaila_planning") return "RETAILA planning estimate";
  if (basis === "illustrative") return "Illustrative (unverified)";
  return "Not available";
}

function actionLabel(row: PlanningRow): string {
  if (row.forecast.blocker) return FBA_FORECAST_BLOCKER_LABEL[row.forecast.blocker];
  if (row.forecast.recommendation === "SEND_NOW") return "Send now";
  if (row.forecast.recommendation === "SEND_SOON") return "Review soon";
  if (row.forecast.recommendation === "OVERSTOCKED") return "Excess stock";
  if (row.forecast.recommendation === "HEALTHY") return "Healthy";
  return row.forecast.recommendationLabel;
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[11px] uppercase tracking-[0.12em] text-steel">{label}</dt>
      <dd className="tabular-nums">{value}</dd>
    </div>
  );
}

function SummaryCard({
  label,
  value,
  hint,
  active,
  onClick,
}: {
  label: string;
  value: string;
  hint: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`border p-4 text-left transition-colors ${active ? "border-primary bg-primary/10" : "border-border bg-surface/60 hover:bg-secondary/20"}`}
    >
      <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-steel">{label}</div>
      <div className="mt-1 font-display text-2xl font-semibold tabular-nums">{value}</div>
      <div className="mt-1 text-[12px] text-steel">{hint}</div>
    </button>
  );
}

export function FbaStockPlanningOverview({
  data,
  loading,
  q,
  setQ,
  search,
  patch,
  onOpen,
  onExport,
}: {
  data: Workspace | null;
  loading: boolean;
  q: string;
  setQ: (value: string) => void;
  search: StockPlanningSearch;
  patch: (next: Partial<StockPlanningSearch>) => void;
  onOpen: (row: PlanningRow) => void;
  onExport: () => void;
}) {
  const activity: FbaSalesActivity = search.sold ?? "365";
  const plan: FbaPlanningModeSearch = search.plan ?? "fba";
  const countsHidden = Boolean(data?.salesActivityUnavailable);
  const resultsReady = Boolean(data) && !loading;
  const count = (value: number | undefined) =>
    resultsReady && !countsHidden ? String(value ?? 0) : "—";
  const leadDays = data?.settings.leadTimeDays ?? 14;
  const targetWeeks = data?.settings.targetCoverWeeks ?? 6;
  const sortValue = search.sort ?? defaultFbaForecastSort(activity);

  return (
    <>
      <div className="space-y-3 border-b border-border/70 px-4 py-4 sm:px-6">
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className={plan === "fba" ? primaryBtnClass : btnClass}
            onClick={() => patch({ plan: undefined, page: undefined })}
          >
            Verified FBA forecast
          </button>
          <button
            type="button"
            className={plan === "retaila" ? primaryBtnClass : btnClass}
            onClick={() => patch({ plan: "retaila", page: undefined })}
          >
            RETAILA planning
          </button>
        </div>
        <p className="text-[13px] text-steel">
          {plan === "fba"
            ? "Uses a covered Amazon UK FBA sales extract only. RETAILA invoices stay visible and are never added to that extract."
            : data?.retailaPlanning.enabled
              ? "Uses verified RETAILA customer sales as an approved planning proxy for all eligible RETAILA SKUs. Outputs are estimates, not verified Amazon UK FBA sell-through."
              : "RETAILA sales and illustrative cover stay visible. Shipment recommendations stay locked until a Super Admin records the business relationship."}
        </p>
        {plan === "retaila" && data && !data.retailaPlanning.enabled ? (
          <p className="border border-border bg-surface/50 px-3 py-2 text-[13px] text-steel">
            Planning mode is not approved. Open Settings to record the business justification if you
            are a Super Admin. Approval applies globally to every eligible RETAILA SKU.
          </p>
        ) : null}
        {plan === "retaila" && data?.retailaPlanning.enabled && data.retailaReporting ? (
          <p className="border border-border bg-surface/50 px-3 py-2 text-[13px] text-steel">
            {data.retailaReporting.reason}
          </p>
        ) : null}
      </div>

      <div className="grid gap-3 border-b border-border/70 px-4 py-3 text-[12px] text-steel sm:grid-cols-2 sm:px-6 xl:grid-cols-4">
        <div>
          <div className="font-semibold uppercase tracking-[0.12em]">RETAILA sales</div>
          <p>
            {data?.oinUnavailable
              ? "Unavailable — retry required"
              : data?.oin.documents
                ? `${data.oin.documents.toLocaleString("en-GB")} invoices · last ${data.oin.days}d · latest ${ukDate(data.oin.latestDocumentDate)}`
                : `No invoices in the last ${data?.oin.days ?? 365} days`}
          </p>
        </div>
        <div>
          <div className="font-semibold uppercase tracking-[0.12em]">FBA stock</div>
          <p>
            {data?.fbaFileName
              ? `${data.fbaFileName} · ${ukDate(data.fbaImportedAt?.slice(0, 10))}`
              : "No OPTIMUS snapshot imported"}
          </p>
        </div>
        <div>
          <div className="font-semibold uppercase tracking-[0.12em]">Studley stock</div>
          <p>
            {data?.studleyFeedAt
              ? `Latest feed update ${ukDate(data.studleyFeedAt.slice(0, 10))}`
              : "No Studley feed timestamp available"}
          </p>
        </div>
        <div>
          <div className="font-semibold uppercase tracking-[0.12em]">Forecast source</div>
          <p>
            {plan === "fba"
              ? data?.sales?.windows.d30
                ? "Verified Amazon UK FBA extract"
                : "Amazon UK FBA extract missing or incomplete"
              : data?.retailaPlanning.enabled
                ? "RETAILA planning proxy (approved)"
                : "RETAILA planning locked — awaiting Super Admin approval"}
          </p>
        </div>
      </div>

      <p className="px-4 pt-4 text-[12px] text-steel sm:px-6">
        {loading
          ? "Loading products for the selected sales activity…"
          : countsHidden
            ? "Sales activity could not be checked. Counts stay blank so a failed read is not shown as zero sales."
            : activity === "all"
              ? "Counts include every stock product, including products with no RETAILA sales."
              : `Counts are limited to products with a verified RETAILA invoice in the last ${activity} days.`}
      </p>

      <div className="grid gap-3 px-4 py-4 sm:grid-cols-2 sm:px-6 xl:grid-cols-4">
        <SummaryCard
          label="Products with sales"
          value={count(data?.summary.productsWithSales)}
          hint={activity === "all" ? "In the current catalogue" : `Sold in last ${activity} days`}
          active={false}
          onClick={() => patch({ focus: undefined, page: undefined })}
        />
        <SummaryCard
          label="Customer sales 30d"
          value={
            resultsReady && !countsHidden
              ? qty(data?.summary.customerSales30 ?? null)
              : "—"
          }
          hint="Verified RETAILA net units"
          active={false}
          onClick={() => patch({ sold: "30", page: undefined })}
        />
        <SummaryCard
          label="Below lead-time cover"
          value={count(data?.summary.lowCover)}
          hint={
            plan === "fba"
              ? "Estimated or verified cover inside lead time"
              : "Planning cover inside lead time"
          }
          active={search.focus === "low_cover"}
          onClick={() =>
            patch({ focus: search.focus === "low_cover" ? undefined : "low_cover", page: undefined })
          }
        />
        <SummaryCard
          label="Needs review"
          value={count(data?.summary.needsReview)}
          hint="Send actions, shortfalls, or unavailable forecasts"
          active={search.focus === "needs_review"}
          onClick={() =>
            patch({
              focus: search.focus === "needs_review" ? undefined : "needs_review",
              blocker: undefined,
              page: undefined,
            })
          }
        />
      </div>

      {resultsReady && data && data.summary.forecastUnavailable > 0 ? (
        <div className="mx-4 mb-2 border border-border bg-surface/40 px-3 py-3 text-[13px] sm:mx-6">
          <div className="font-semibold">Why forecasts are unavailable</div>
          <ul className="mt-2 grid gap-1 sm:grid-cols-2">
            {FBA_FORECAST_BLOCKERS.filter((code) => data.summary.blockers[code] > 0).map((code) => (
              <li key={code}>
                <button
                  type="button"
                  className="text-left hover:underline"
                  onClick={() => patch({ blocker: code, focus: "unavailable", page: undefined })}
                >
                  {FBA_FORECAST_BLOCKER_LABEL[code]}: {data.summary.blockers[code].toLocaleString("en-GB")}
                </button>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[12px] text-steel">
            Missing Amazon UK FBA proof is not the same as missing RETAILA sales. Products with
            customer invoices can still appear here when verified demand is unavailable.
          </p>
        </div>
      ) : null}

      <form
        className="grid gap-2 border-y border-border/70 px-4 py-3 sm:px-6 md:grid-cols-[minmax(10rem,1fr)_11rem_10rem_12rem_10rem_10rem_9rem_auto_auto]"
        onSubmit={(event) => {
          event.preventDefault();
          patch({ q: q.trim() || undefined, page: undefined });
        }}
      >
        <input
          className={controlClass}
          placeholder="Search SKU or description"
          aria-label="Search SKU or description"
          value={q}
          onChange={(event) => setQ(event.target.value)}
        />
        <select
          className={controlClass}
          aria-label="Sales activity"
          value={activity}
          onChange={(event) => {
            const next = event.target.value as FbaSalesActivity;
            patch({ sold: salesActivitySearchValue(next), page: undefined });
          }}
        >
          {SALES_ACTIVITIES.map((item) => (
            <option key={item} value={item}>
              {item === "all" ? "All products" : `Sold in last ${item} days`}
            </option>
          ))}
        </select>
        <select
          className={controlClass}
          aria-label="Focus"
          value={search.focus ?? ""}
          onChange={(event) =>
            patch({
              focus: (event.target.value || undefined) as FbaFocusFilter | undefined,
              blocker: undefined,
              page: undefined,
            })
          }
        >
          {FOCUS_OPTIONS.map((item) => (
            <option key={item.value || "all"} value={item.value}>
              {item.label}
            </option>
          ))}
        </select>
        <select
          className={controlClass}
          aria-label="Unavailable reason"
          value={search.blocker ?? ""}
          onChange={(event) =>
            patch({
              blocker: (event.target.value || undefined) as FbaForecastBlocker | undefined,
              focus: event.target.value ? "unavailable" : search.focus,
              page: undefined,
            })
          }
        >
          <option value="">All unavailable reasons</option>
          {FBA_FORECAST_BLOCKERS.map((code) => (
            <option key={code} value={code}>
              {FBA_FORECAST_BLOCKER_LABEL[code]}
            </option>
          ))}
        </select>
        <select
          className={controlClass}
          aria-label="Recommendation"
          value={search.recommendation ?? ""}
          onChange={(event) =>
            patch({
              recommendation: (event.target.value || undefined) as FbaRecommendation | undefined,
              page: undefined,
            })
          }
        >
          <option value="">All statuses</option>
          {FBA_RECOMMENDATIONS.map((item) => (
            <option key={item} value={item}>
              {item === "INSUFFICIENT_DATA"
                ? "Forecast unavailable"
                : FBA_RECOMMENDATION_LABEL[item]}
            </option>
          ))}
        </select>
        <select
          className={controlClass}
          aria-label="Brand"
          value={search.brand ?? ""}
          onChange={(event) => patch({ brand: event.target.value || undefined, page: undefined })}
        >
          <option value="">All brands</option>
          <option value="__unbranded">Unbranded</option>
          {data?.brands.map((brand) => (
            <option key={brand} value={brand}>
              {brand}
            </option>
          ))}
        </select>
        <select
          className={controlClass}
          aria-label="Sort"
          value={sortValue}
          onChange={(event) => {
            const next = event.target.value as FbaForecastSort;
            const implicit = defaultFbaForecastSort(activity);
            patch({ sort: next === implicit ? undefined : next, page: undefined });
          }}
        >
          <option value="sales">Customer sales</option>
          <option value="priority">Priority</option>
          <option value="cover">Weeks cover</option>
          <option value="velocity">Sales velocity</option>
          <option value="suggested">Suggested quantity</option>
        </select>
        <button className={btnClass} type="submit">
          Search
        </button>
        <button
          className={btnClass}
          type="button"
          onClick={onExport}
          disabled={!resultsReady || countsHidden}
        >
          Export
        </button>
      </form>

      {loading ? <LoadingState label="Loading stock planning…" /> : null}
      {data?.salesActivityUnavailable ? (
        <div className="space-y-3 px-4 py-6 sm:px-6">
          <EmptyState
            title="Sales data unavailable"
            body="RETAILA customer sales could not be loaded, so products sold in this period are not listed. This is not a report of zero sales."
          />
          <button
            className={btnClass}
            type="button"
            onClick={() => patch({ sold: "all", page: undefined })}
          >
            View all stock products
          </button>
        </div>
      ) : null}
      {data && !data.salesActivityUnavailable && data.rows.length === 0 && !loading ? (
        <div className="space-y-3 px-4 py-6 sm:px-6">
          <EmptyState
            title={
              activity === "all" || search.q || search.brand || search.recommendation || search.focus
                ? "Nothing matches"
                : "No sales in this period"
            }
            body={
              activity === "all"
                ? "No products match these filters."
                : `No product has a verified RETAILA invoice in the last ${activity} days, or the focus filters removed every row.`
            }
          />
        </div>
      ) : null}

      {data && !data.salesActivityUnavailable && data.rows.length > 0 ? (
        <>
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-left text-[14px]">
              <thead className="bg-secondary/40 text-[11px] font-semibold uppercase tracking-[0.12em] text-steel">
                <tr>
                  <th className="px-4 py-3">Product</th>
                  <th className="px-3 py-3 text-right">Sales 30d</th>
                  <th className="px-3 py-3 text-right">Weekly</th>
                  <th className="px-3 py-3 text-right">FBA stock</th>
                  <th className="px-3 py-3 text-right">Weeks cover</th>
                  <th className="px-3 py-3 text-right">Studley</th>
                  <th className="px-4 py-3">Priority</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((row) => {
                  const cover = coverTone(row.activeCoverWeeks, leadDays, targetWeeks);
                  return (
                    <tr
                      key={row.matchKey}
                      className="cursor-pointer border-t border-border/70 hover:bg-secondary/30"
                      onClick={() => onOpen(row)}
                    >
                      <td className="px-4 py-3">
                        <div className="max-w-[18rem] font-medium leading-snug">
                          {row.description || "No description"}
                        </div>
                        <div className="font-mono text-[12px] text-steel">{row.sku}</div>
                      </td>
                      <td className="px-3 py-3 text-right tabular-nums">{qty(row.customerSales.d30)}</td>
                      <td className="px-3 py-3 text-right tabular-nums">{rate(row.customerWeekly)}</td>
                      <td className="px-3 py-3 text-right tabular-nums">{qty(row.fbaAvailable)}</td>
                      <td className="px-3 py-3 text-right">
                        <div className={`tabular-nums ${cover.className}`}>
                          {row.activeCoverWeeks == null ? "—" : `${row.activeCoverWeeks.toFixed(1)}`}
                        </div>
                        <div className="text-[11px] text-steel">{coverBasisLabel(row.coverBasis)}</div>
                      </td>
                      <td className="px-3 py-3 text-right tabular-nums">{qty(row.studleyAvailable)}</td>
                      <td className="px-4 py-3">
                        <StatusBadge tone={tone(row.forecast.recommendation)}>
                          {actionLabel(row)}
                        </StatusBadge>
                        {row.forecast.planningEstimate ? (
                          <div className="mt-1 text-[11px] text-steel">Planning estimate</div>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="space-y-3 px-4 py-4 md:hidden">
            {data.rows.map((row) => {
              const cover = coverTone(row.activeCoverWeeks, leadDays, targetWeeks);
              return (
                <button
                  key={row.matchKey}
                  type="button"
                  className="block w-full border border-border bg-surface/40 p-3 text-left"
                  onClick={() => onOpen(row)}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="font-medium">{row.description || "No description"}</div>
                      <div className="font-mono text-[12px] text-steel">{row.sku}</div>
                    </div>
                    <StatusBadge tone={tone(row.forecast.recommendation)}>
                      {actionLabel(row)}
                    </StatusBadge>
                  </div>
                  <dl className="mt-3 grid grid-cols-2 gap-2 text-[13px]">
                    <Fact label="Sales 30d" value={qty(row.customerSales.d30)} />
                    <Fact label="Weekly" value={rate(row.customerWeekly)} />
                    <Fact label="FBA" value={qty(row.fbaAvailable)} />
                    <Fact
                      label="Cover"
                      value={
                        row.activeCoverWeeks == null
                          ? "—"
                          : `${row.activeCoverWeeks.toFixed(1)} · ${cover.label}`
                      }
                    />
                    <Fact label="Studley" value={qty(row.studleyAvailable)} />
                    <Fact label="Basis" value={coverBasisLabel(row.coverBasis)} />
                  </dl>
                </button>
              );
            })}
          </div>

          <div className="px-4 pb-6 sm:px-6">
            <Pager
              page={data.page}
              pageSize={data.pageSize}
              total={data.total}
              onPage={(page) => patch({ page: page > 1 ? page : undefined })}
            />
          </div>
        </>
      ) : null}
    </>
  );
}

export { planningModeSearchValue, coverBasisLabel, actionLabel, coverTone };
