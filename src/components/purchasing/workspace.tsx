import { Link } from "@tanstack/react-router";
import { StatusBadge, type Tone } from "@/components/ab/Badges";
import { formatDate } from "@/lib/datetime";
import {
  PLANNER_RECOMMENDATION_LABEL,
  type PlannerRecommendation,
} from "@/domain/purchasing-planner";
import {
  DEMAND_COMPONENT_AVAILABILITY_LABEL,
  DEMAND_TREND_LABEL,
  FORECAST_CONFIDENCE_HELP,
  FORECAST_CONFIDENCE_LABEL,
  PURCHASING_STATUS_LABEL,
  formatSalesHistoryCoverage,
  isLimitedForecastConfidence,
  type DemandComponentAvailability,
  type DemandTrend,
  type ForecastConfidence,
  type PurchasingStatus,
} from "@/domain/purchasing-forecast";

export function gbp(value: string | null | undefined): string {
  if (value == null || value === "") return "—";
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(n);
}

export function qty(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return value.toLocaleString("en-GB");
}

export function rate(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${value.toFixed(1)}/week`;
}

export function coverLabel(weeks: number | null | undefined, demand: number | null | undefined): string {
  if (demand == null || demand <= 0) return "No recent demand";
  if (weeks == null) return "—";
  return `${weeks.toFixed(1)} wks`;
}

export function ukDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  return formatDate(iso) ?? "—";
}

export function statusTone(status: PurchasingStatus): Tone {
  if (status === "CRITICAL") return "bad";
  if (status === "REORDER" || status === "OVERSTOCK" || status === "DATA_STALE") return "warn";
  if (status === "WATCH" || status === "INCOMING_COVERS_REQUIREMENT") return "info";
  if (status === "HEALTHY") return "good";
  return "neutral";
}

export function PurchasingStatusBadge({ status }: { status: PurchasingStatus }) {
  return <StatusBadge tone={statusTone(status)}>{PURCHASING_STATUS_LABEL[status]}</StatusBadge>;
}

export function recommendationTone(recommendation: PlannerRecommendation): Tone {
  if (recommendation === "BACKORDERS_AT_RISK") return "bad";
  if (recommendation === "ORDER_NOW" || recommendation === "NO_SUPPLIER" || recommendation === "REVIEW") return "warn";
  if (recommendation === "ORDER_SOON" || recommendation === "COVERED_BY_INCOMING") return "info";
  if (recommendation === "ADEQUATE_STOCK") return "good";
  return "neutral";
}

export function PlannerRecommendationBadge({
  recommendation,
  reason,
}: {
  recommendation: PlannerRecommendation;
  reason?: string | null;
}) {
  return (
    <StatusBadge tone={recommendationTone(recommendation)} className="normal-case tracking-normal">
      <span title={reason ?? undefined}>{PLANNER_RECOMMENDATION_LABEL[recommendation]}</span>
    </StatusBadge>
  );
}

function confidenceTone(confidence: ForecastConfidence): Tone {
  if (confidence === "UNVERIFIED") return "warn";
  if (confidence === "VERY_LOW") return "bad";
  if (confidence === "LOW") return "warn";
  if (confidence === "BUILDING") return "info";
  if (confidence === "GOOD") return "brand";
  return "good";
}

export function ForecastConfidenceBadge({
  confidence,
  coverageDays,
  warning,
  verified,
}: {
  confidence: ForecastConfidence;
  coverageDays?: number;
  warning?: string | null;
  verified?: boolean;
}) {
  const title =
    confidence === "UNVERIFIED" || verified === false
      ? "Historical sales records are present, but complete sales-data coverage has not yet been verified."
      : warning ||
        (coverageDays != null
          ? coverageDays <= 0
            ? "No verified Autopart sales-history window is currently configured."
            : `Based on ${coverageDays >= 365 ? "365+" : coverageDays} days of verified sales history.`
          : FORECAST_CONFIDENCE_HELP);
  return (
    <StatusBadge tone={confidenceTone(confidence)} className="normal-case tracking-normal">
      <span title={title}>{FORECAST_CONFIDENCE_LABEL[confidence]}</span>
    </StatusBadge>
  );
}

export function ForecastCoverageBanner({
  coverageDays,
  confidence,
  historyFrom,
  verified,
  verifiedFrom,
  verifiedTo,
}: {
  coverageDays: number;
  confidence: ForecastConfidence;
  historyFrom?: string | null;
  verified?: boolean;
  verifiedFrom?: string | null;
  verifiedTo?: string | null;
}) {
  const from = verifiedFrom ?? historyFrom ?? null;
  const to = verifiedTo ?? null;
  const unverified = confidence === "UNVERIFIED" || verified === false;
  const building = isLimitedForecastConfidence(confidence) || confidence === "BUILDING";
  return (
    <div className="border-b border-border/70 px-4 py-3 text-[13px] text-steel sm:px-6">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="font-semibold uppercase tracking-[0.12em] text-[10px] text-ink">Forecast data coverage</span>
        <ForecastConfidenceBadge
          confidence={confidence}
          coverageDays={coverageDays}
          verified={!unverified}
        />
        {unverified ? (
          <span>Coverage not verified</span>
        ) : (
          <>
            <span>{formatSalesHistoryCoverage(coverageDays, true)}</span>
            {from && to ? (
              <span>
                Verified sales history: {ukDate(from)} → {ukDate(to)}
              </span>
            ) : null}
          </>
        )}
      </div>
      <p className="mt-1 max-w-3xl">
        {unverified
          ? "Sales-history coverage has not yet been verified. Forecasts are based on the sales records currently available and should be reviewed before purchasing decisions."
          : building
            ? "Verified sales history is still building. Purchasing recommendations use the verified window currently configured and will become more reliable as that window grows."
            : "Purchasing recommendations use the verified Autopart sales-history window currently configured."}{" "}
        Confidence does not measure stock accuracy — stock freshness is shown separately.
      </p>
      <details className="mt-1">
        <summary className="cursor-pointer text-[12px] text-primary">What does confidence mean?</summary>
        <p className="mt-1 max-w-3xl text-[12px]">{FORECAST_CONFIDENCE_HELP}</p>
        {unverified ? (
          <p className="mt-1 text-[12px]">
            An old Autopart invoice proves that invoice exists. It does not prove every invoice between that date and
            today has been imported.
          </p>
        ) : from && to ? (
          <p className="mt-1 text-[12px]">
            Verified sales history: {ukDate(from)} → {ukDate(to)} ({coverageDays} day{coverageDays === 1 ? "" : "s"}).
          </p>
        ) : null}
      </details>
    </div>
  );
}

export function demandComponentLabel(availability: DemandComponentAvailability): string {
  if (availability === "full") return `✓ ${DEMAND_COMPONENT_AVAILABILITY_LABEL[availability]}`;
  if (availability === "partial") return DEMAND_COMPONENT_AVAILABILITY_LABEL[availability];
  return DEMAND_COMPONENT_AVAILABILITY_LABEL[availability];
}

export function trendLabel(trend: DemandTrend): string {
  return DEMAND_TREND_LABEL[trend];
}

export function SkuLink({
  sku,
  name,
  productKind,
}: {
  sku: string;
  name: string;
  productKind?: string;
}) {
  return (
    <Link to="/purchasing/forecast/$sku" params={{ sku }} className="block min-w-0 hover:text-primary">
      <div className="truncate font-medium">{name}</div>
      <div className="truncate font-mono text-[11px] text-steel">
        {sku}
        {productKind === "EXTERNAL" ? " · External" : ""}
      </div>
    </Link>
  );
}

export function ExternalBadge({ kind }: { kind?: string }) {
  if (kind !== "EXTERNAL") return null;
  return <StatusBadge tone="info">External</StatusBadge>;
}

export function FreshnessBanner({
  stockUpdated,
  salesUpdated,
  stockStale,
}: {
  stockUpdated: string;
  salesUpdated: string;
  stockStale: boolean;
}) {
  return (
    <div
      className={
        stockStale
          ? "border border-warn/40 bg-warn/10 px-4 py-3 text-[13px] text-warn sm:px-6"
          : "border-b border-border/70 px-4 py-3 text-[13px] text-steel sm:px-6"
      }
    >
      <span className="font-semibold text-ink">Stock updated:</span> {stockUpdated}
      <span className="mx-2 text-border">·</span>
      <span className="font-semibold text-ink">Sales updated:</span> {salesUpdated}
      {stockStale ? (
        <span className="mt-1 block font-medium">
          Autopart stock is stale. Treat purchase recommendations as out of date until the next 231PO3NEW
          import. Incoming arrival dates are not available.
        </span>
      ) : null}
    </div>
  );
}

export const controlClass =
  "h-9 rounded-md border border-border bg-ink px-2 text-[13px] outline-none focus-visible:border-primary";

export const btnClass =
  "inline-flex h-9 items-center border border-border bg-surface px-3 text-[11px] font-semibold uppercase tracking-[0.12em] hover:border-primary";

export const primaryBtnClass =
  "inline-flex h-9 items-center bg-primary px-3 text-[11px] font-semibold uppercase tracking-[0.12em] text-primary-foreground hover:opacity-90";

export function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="border border-dashed border-border px-4 py-10 text-center">
      <div className="font-display text-lg font-semibold uppercase">{title}</div>
      <p className="mx-auto mt-2 max-w-lg text-[13px] text-steel">{body}</p>
    </div>
  );
}

export function ErrorState({ message }: { message: string }) {
  return (
    <div className="border border-destructive/40 bg-destructive/10 px-4 py-3 text-[13px] text-destructive">
      {message}
    </div>
  );
}

export function LoadingState({ label = "Loading purchasing data…" }: { label?: string }) {
  return <p className="px-4 py-8 text-[13px] text-steel sm:px-6">{label}</p>;
}

export function downloadCsv(csv: string, filename: string) {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function incomingNote(qtyValue: number): string {
  if (qtyValue <= 0) return "None on order";
  return `${qtyValue.toLocaleString("en-GB")} on order — arrival date not available`;
}

/** Source hint for Incoming — outstanding Autopart PO qty (P/Ord Qty). */
export const INCOMING_SOURCE_HINT = "Outstanding quantity on purchase orders from Autopart";

export const STATUS_FILTERS: Array<{ value: string; label: string }> = [
  { value: "", label: "All statuses" },
  ...Object.entries(PURCHASING_STATUS_LABEL).map(([value, label]) => ({ value, label })),
];

export const TREND_FILTERS: Array<{ value: string; label: string }> = [
  { value: "", label: "All trends" },
  ...Object.entries(DEMAND_TREND_LABEL).map(([value, label]) => ({ value, label })),
];

export const SORT_OPTIONS = [
  { value: "cover", label: "Lowest cover" },
  { value: "suggestedValue", label: "Highest suggested value" },
  { value: "demand", label: "Highest demand" },
  { value: "stockout", label: "Stockout soonest" },
  { value: "incoming", label: "Highest incoming" },
  { value: "overstock", label: "Largest overstock" },
] as const;

export type ForecastSearch = {
  status?: string;
  brand?: string;
  supplier?: string;
  trend?: string;
  incoming?: "any" | "yes" | "no";
  productType?: "all" | "catalogue" | "external";
  q?: string;
  sort?: (typeof SORT_OPTIONS)[number]["value"];
  page?: number;
};

export function parseForecastSearch(raw: Record<string, unknown>): ForecastSearch {
  const out: ForecastSearch = {};
  const str = (key: string) => {
    const value = raw[key];
    return typeof value === "string" && value ? value : null;
  };
  const status = str("status");
  if (status) out.status = status;
  const brand = str("brand");
  if (brand) out.brand = brand;
  const supplier = str("supplier");
  if (supplier) out.supplier = supplier;
  const trend = str("trend");
  if (trend) out.trend = trend;
  const incoming = str("incoming");
  if (incoming === "yes" || incoming === "no" || incoming === "any") out.incoming = incoming;
  const productType = str("productType");
  if (productType === "catalogue" || productType === "external" || productType === "all") {
    out.productType = productType;
  }
  const q = str("q");
  if (q) out.q = q;
  const sort = str("sort");
  if (sort && SORT_OPTIONS.some((o) => o.value === sort)) {
    out.sort = sort as NonNullable<ForecastSearch["sort"]>;
  }
  const pageRaw = raw["page"];
  const page = typeof pageRaw === "number" ? pageRaw : Number(pageRaw);
  if (Number.isFinite(page) && page > 1) out.page = Math.trunc(page);
  return out;
}

export type ForecastSearchPatch = {
  [K in keyof ForecastSearch]?: ForecastSearch[K] | undefined;
};

export function mergeForecastSearch(prev: ForecastSearch, next: ForecastSearchPatch): ForecastSearch {
  const merged: ForecastSearch = { ...prev };
  (Object.keys(next) as Array<keyof ForecastSearch>).forEach((key) => {
    const value = next[key];
    if (value === undefined || value === "" || value === "any") {
      delete merged[key];
      return;
    }
    (merged as Record<string, unknown>)[key] = value;
  });
  if (merged.page === 1) delete merged.page;
  return merged;
}

export function Pager({
  page,
  pageSize,
  total,
  onPage,
}: {
  page: number;
  pageSize: number;
  total: number;
  onPage: (page: number) => void;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1) return null;
  return (
    <div className="flex items-center justify-between gap-3 px-4 py-3 text-[12px] text-steel sm:px-6">
      <span>
        {total.toLocaleString("en-GB")} SKUs · page {page} of {pages}
      </span>
      <div className="flex gap-2">
        <button type="button" className={btnClass} disabled={page <= 1} onClick={() => onPage(page - 1)}>
          Previous
        </button>
        <button type="button" className={btnClass} disabled={page >= pages} onClick={() => onPage(page + 1)}>
          Next
        </button>
      </div>
    </div>
  );
}
