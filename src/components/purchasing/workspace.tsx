import { Link } from "@tanstack/react-router";
import { StatusBadge, type Tone } from "@/components/ab/Badges";
import { formatDate } from "@/lib/datetime";
import {
  DEMAND_TREND_LABEL,
  PURCHASING_STATUS_LABEL,
  type DemandTrend,
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

export function trendLabel(trend: DemandTrend): string {
  return DEMAND_TREND_LABEL[trend];
}

export function SkuLink({ sku, name }: { sku: string; name: string }) {
  return (
    <Link to="/purchasing/forecast/$sku" params={{ sku }} className="block min-w-0 hover:text-primary">
      <div className="truncate font-medium">{name}</div>
      <div className="truncate font-mono text-[11px] text-steel">{sku}</div>
    </Link>
  );
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
