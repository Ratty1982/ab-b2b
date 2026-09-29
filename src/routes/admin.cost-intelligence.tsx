import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { PanelHeader, Metric } from "@/components/ab/AppShell";
import { Drawer } from "@/components/ab/Drawer";
import { AutopartProductCostPanel } from "@/components/catalogue/AutopartProductCostPanel";
import { ROUTES } from "@/lib/app-nav";
import {
  COST_MAGNITUDE_PRESETS,
  COST_MOVEMENTS,
  COST_PERIODS,
  COST_SORTS,
  COST_VIEWS,
  costPeriodLabel,
  movementLabel,
  parseCostIntelligenceSearch,
  type CostIntelligenceSearch,
} from "@/domain/cost-intelligence";
import {
  exportCostIntelligenceCsvFn,
  getCostIntelligenceWorkspaceFn,
} from "@/server/phase2/fns";

export const Route = createFileRoute("/admin/cost-intelligence")({
  validateSearch: (raw: Record<string, unknown>) => parseCostIntelligenceSearch(raw),
  head: () => ({
    meta: [
      { title: "Cost Intelligence — Automotive Brands Admin" },
      {
        name: "description",
        content:
          "Track Autopart Latest Cost movements from 231PO3NEW for internal commercial review.",
      },
    ],
  }),
  component: CostIntelligencePage,
});

type Data = Extract<
  Awaited<ReturnType<typeof getCostIntelligenceWorkspaceFn>>,
  { ok: true }
>["data"];

function downloadBlob(csv: string, filename: string) {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

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

function fmtDay(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-GB", { timeZone: "Europe/London" });
}

function CostIntelligencePage() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [drillVariantId, setDrillVariantId] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  function patch(
    next: Partial<CostIntelligenceSearch> & {
      clearBrand?: boolean;
      clearCategory?: boolean;
      clearQ?: boolean;
      clearMinPct?: boolean;
      clearMinGbp?: boolean;
    },
  ) {
    void navigate({
      search: (prev) => {
        const merged: CostIntelligenceSearch = { ...prev, ...next };
        if (next.clearBrand || next.brandId === "") {
          delete merged.brandId;
        }
        if (next.clearCategory || next.categoryId === "") {
          delete merged.categoryId;
        }
        if (next.clearQ || next.q === "") {
          delete merged.q;
        }
        if (next.clearMinPct || next.minPct === "") {
          delete merged.minPct;
        }
        if (next.clearMinGbp || next.minGbp === "") {
          delete merged.minGbp;
        }
        delete (merged as { clearBrand?: boolean }).clearBrand;
        delete (merged as { clearCategory?: boolean }).clearCategory;
        delete (merged as { clearQ?: boolean }).clearQ;
        delete (merged as { clearMinPct?: boolean }).clearMinPct;
        delete (merged as { clearMinGbp?: boolean }).clearMinGbp;
        if (
          next.movement ||
          next.view ||
          next.period ||
          next.q !== undefined ||
          next.clearQ ||
          next.brandId !== undefined ||
          next.clearBrand ||
          next.categoryId !== undefined ||
          next.clearCategory
        ) {
          merged.page = next.page ?? 1;
        }
        return merged;
      },
    });
  }

  useEffect(() => {
    setLoading(true);
    void getCostIntelligenceWorkspaceFn({ data: search }).then((r) => {
      setLoading(false);
      if (!r.ok) {
        setError(r.error);
        setData(null);
      } else {
        setError(null);
        setData(r.data);
      }
    });
  }, [search]);

  async function onExport() {
    setExporting(true);
    const r = await exportCostIntelligenceCsvFn({ data: search });
    setExporting(false);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    downloadBlob(r.data.csv, r.data.filename);
  }

  return (
    <div>
      <PanelHeader
        title="Cost Intelligence"
        sub="Track Autopart Latest Cost movements from 231PO3NEW and identify products that may need commercial review."
        actions={
          <button
            type="button"
            onClick={() => void onExport()}
            disabled={exporting}
            className="h-10 rounded-md border border-border px-4 text-[13px] font-bold uppercase disabled:opacity-50"
          >
            {exporting ? "Exporting…" : "Export CSV"}
          </button>
        }
      />
      <p className="border-b border-border/60 px-4 py-2 text-[12px] text-steel sm:px-6">
        Internal only. Cost data is never shown to trade customers and does not automatically change
        sell prices. History begins when AB started recording 231PO3NEW Latest Cost — earlier Autopart
        history is unknown.
      </p>

      {error ? (
        <p className="px-4 py-3 text-sm text-destructive sm:px-6" role="alert">
          {error}
        </p>
      ) : null}

      {data ? (
        <div className="grid gap-px bg-border sm:grid-cols-2 lg:grid-cols-5">
          <button type="button" onClick={() => patch({ movement: "ALL", view: "ALL" })}>
            <Metric label="Products with cost" value={String(data.counts.withCost)} />
          </button>
          <button type="button" onClick={() => patch({ movement: "INCREASED", view: "INCREASES" })}>
            <Metric label="Cost increases" value={String(data.counts.increased)} />
          </button>
          <button type="button" onClick={() => patch({ movement: "DECREASED", view: "DECREASES" })}>
            <Metric label="Cost decreases" value={String(data.counts.decreased)} />
          </button>
          <button type="button" onClick={() => patch({ movement: "FIRST_SEEN", view: "ALL" })}>
            <Metric label="First seen" value={String(data.counts.firstSeen)} />
          </button>
          <button type="button" onClick={() => patch({ movement: "NO_COST", view: "ALL" })}>
            <Metric label="No cost data" value={String(data.counts.noCost)} />
          </button>
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2 border-b border-border/70 px-4 py-3 sm:px-6">
        {COST_VIEWS.map((v) => (
          <button
            key={v}
            type="button"
            onClick={() =>
              patch({
                view: v,
                ...(v === "INCREASES"
                  ? { movement: "INCREASED" as const, sort: "PCT_INCREASE" as const }
                  : v === "DECREASES"
                    ? { movement: "DECREASED" as const, sort: "PCT_DECREASE" as const }
                    : v === "PRICE_REVIEW"
                      ? { magnitude: "PCT_5" as const, movement: "ALL" as const }
                      : v === "REPEATED"
                        ? { movement: "ALL" as const }
                        : { movement: "ALL" as const }),
              })
            }
            className={`h-9 rounded-md px-3 text-[11px] font-bold uppercase tracking-wide ${
              search.view === v
                ? "bg-primary text-primary-foreground"
                : "border border-border text-steel"
            }`}
          >
            {v === "ALL"
              ? "All"
              : v === "RECENT"
                ? "Recent changes"
                : v === "INCREASES"
                  ? "Biggest increases"
                  : v === "DECREASES"
                    ? "Biggest decreases"
                    : v === "REPEATED"
                      ? "Repeated movers"
                      : "Price review"}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap gap-2 px-4 py-3 sm:px-6">
        <label className="text-[12px]">
          <span className="sr-only">Period</span>
          <select
            className="h-9 rounded-md border border-border bg-background px-2"
            value={search.period}
            onChange={(e) => patch({ period: e.target.value as CostIntelligenceSearch["period"] })}
            aria-label="Period"
          >
            {COST_PERIODS.map((p) => (
              <option key={p} value={p}>
                {costPeriodLabel(p)}
              </option>
            ))}
          </select>
        </label>
        {search.period === "CUSTOM" ? (
          <>
            <input
              type="date"
              className="h-9 rounded-md border border-border px-2 text-sm"
              value={search.from ?? ""}
              onChange={(e) => patch({ from: e.target.value })}
              aria-label="From date"
            />
            <input
              type="date"
              className="h-9 rounded-md border border-border px-2 text-sm"
              value={search.to ?? ""}
              onChange={(e) => patch({ to: e.target.value })}
              aria-label="To date"
            />
          </>
        ) : null}
        <select
          className="h-9 rounded-md border border-border bg-background px-2 text-sm"
          value={search.movement}
          onChange={(e) =>
            patch({ movement: e.target.value as CostIntelligenceSearch["movement"] })
          }
          aria-label="Movement"
        >
          {COST_MOVEMENTS.map((m) => (
            <option key={m} value={m}>
              {m === "ALL" ? "All movements" : movementLabel(m)}
            </option>
          ))}
        </select>
        <select
          className="h-9 rounded-md border border-border bg-background px-2 text-sm"
          value={search.magnitude}
          onChange={(e) =>
            patch({ magnitude: e.target.value as CostIntelligenceSearch["magnitude"] })
          }
          aria-label="Magnitude"
        >
          {COST_MAGNITUDE_PRESETS.map((m) => (
            <option key={m} value={m}>
              {m === "ANY"
                ? "Any movement"
                : m === "PCT_1"
                  ? "≥ 1%"
                  : m === "PCT_5"
                    ? "≥ 5%"
                    : m === "PCT_10"
                      ? "≥ 10%"
                      : "Custom"}
            </option>
          ))}
        </select>
        {search.magnitude === "CUSTOM" ? (
          <>
            <input
              className="h-9 w-24 rounded-md border border-border px-2 text-sm"
              placeholder="Min %"
              value={search.minPct ?? ""}
              onChange={(e) => {
                const v = e.target.value;
                if (!v.trim()) patch({ clearMinPct: true });
                else patch({ minPct: v });
              }}
              aria-label="Minimum percent"
            />
            <input
              className="h-9 w-28 rounded-md border border-border px-2 text-sm"
              placeholder="Min £"
              value={search.minGbp ?? ""}
              onChange={(e) => {
                const v = e.target.value;
                if (!v.trim()) patch({ clearMinGbp: true });
                else patch({ minGbp: v });
              }}
              aria-label="Minimum pounds"
            />
          </>
        ) : null}
        <select
          className="h-9 max-w-[160px] rounded-md border border-border bg-background px-2 text-sm"
          value={search.brandId ?? ""}
          onChange={(e) => {
            const v = e.target.value;
            if (!v) patch({ clearBrand: true });
            else patch({ brandId: v });
          }}
          aria-label="Brand"
        >
          <option value="">All brands</option>
          {(data?.brands ?? []).map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
        <select
          className="h-9 max-w-[160px] rounded-md border border-border bg-background px-2 text-sm"
          value={search.categoryId ?? ""}
          onChange={(e) => {
            const v = e.target.value;
            if (!v) patch({ clearCategory: true });
            else patch({ categoryId: v });
          }}
          aria-label="Category"
        >
          <option value="">All categories</option>
          {(data?.categories ?? []).map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <input
          className="h-9 min-w-[180px] flex-1 rounded-md border border-border px-3 text-sm"
          placeholder="Search SKU or product name"
          value={search.q ?? ""}
          onChange={(e) => {
            const v = e.target.value;
            if (!v.trim()) patch({ clearQ: true });
            else patch({ q: v });
          }}
          aria-label="Search"
        />
        <select
          className="h-9 rounded-md border border-border bg-background px-2 text-sm"
          value={search.catalogue}
          onChange={(e) =>
            patch({
              catalogue: e.target.value as CostIntelligenceSearch["catalogue"],
            })
          }
          aria-label="Catalogue scope"
        >
          <option value="CATALOGUE">AB catalogue</option>
          <option value="UNMATCHED">Not in AB catalogue</option>
          <option value="ALL">All observed SKUs</option>
        </select>
        <select
          className="h-9 rounded-md border border-border bg-background px-2 text-sm"
          value={search.sort}
          onChange={(e) => patch({ sort: e.target.value as CostIntelligenceSearch["sort"] })}
          aria-label="Sort"
        >
          {COST_SORTS.map((s) => (
            <option key={s} value={s}>
              {s === "LATEST_CHANGE"
                ? "Latest change"
                : s === "PCT_INCREASE"
                  ? "Largest % increase"
                  : s === "PCT_DECREASE"
                    ? "Largest % decrease"
                    : s === "GBP_INCREASE"
                      ? "Largest £ increase"
                      : s === "GBP_DECREASE"
                        ? "Largest £ decrease"
                        : s === "NAME_AZ"
                          ? "Product A–Z"
                          : s === "SKU"
                            ? "SKU"
                            : s === "COST_HIGH"
                              ? "Latest cost high → low"
                              : "Latest cost low → high"}
            </option>
          ))}
        </select>
      </div>

      {loading || !data ? (
        <p className="px-4 py-8 text-sm text-steel sm:px-6">Loading…</p>
      ) : data.items.length === 0 ? (
        <EmptyState search={search} />
      ) : (
        <div className="overflow-x-auto px-4 pb-6 sm:px-6">
          <table className="w-full min-w-[960px] text-left text-[13px]">
            <thead className="text-[11px] uppercase tracking-wide text-steel">
              <tr>
                <th className="pb-2 pr-3">Product</th>
                <th className="pb-2 pr-3">SKU</th>
                <th className="pb-2 pr-3">Brand</th>
                <th className="pb-2 pr-3">Previous</th>
                <th className="pb-2 pr-3">Latest</th>
                <th className="pb-2 pr-3">£ Change</th>
                <th className="pb-2 pr-3">% Change</th>
                <th className="pb-2 pr-3">Last changed</th>
                {search.view === "PRICE_REVIEW" || search.view === "REPEATED" ? (
                  <>
                    <th className="pb-2 pr-3">Base trade</th>
                    <th className="pb-2 pr-3">RRP</th>
                  </>
                ) : null}
                <th className="pb-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((r) => (
                <tr
                  key={`${r.sku}-${r.productVariantId ?? "x"}`}
                  className="cursor-pointer border-t border-border/60 hover:bg-muted/30"
                  onClick={() => {
                    if (r.productVariantId) setDrillVariantId(r.productVariantId);
                  }}
                >
                  <td className="py-2.5 pr-3 font-semibold">
                    {r.productName ?? (
                      <span className="text-steel">Not in AB catalogue</span>
                    )}
                    {r.priceReview ? (
                      <span className="ml-2 text-[10px] font-bold uppercase text-steel">
                        Review suggested
                      </span>
                    ) : null}
                  </td>
                  <td className="py-2.5 pr-3 font-mono text-[12px]">{r.sku}</td>
                  <td className="py-2.5 pr-3">{r.brandName ?? "—"}</td>
                  <td className="py-2.5 pr-3 tabular-nums">{gbp(r.previousCost)}</td>
                  <td className="py-2.5 pr-3 tabular-nums">{gbp(r.latestCost)}</td>
                  <td className="py-2.5 pr-3 tabular-nums">
                    {r.change
                      ? `${r.change.direction === "up" ? "+" : ""}${gbp(r.change.absolute)}`
                      : "—"}
                  </td>
                  <td className="py-2.5 pr-3 tabular-nums">
                    {r.change?.percent != null ? `${r.change.percent}%` : "—"}
                  </td>
                  <td className="py-2.5 pr-3 tabular-nums text-steel">
                    {r.movement === "FIRST_SEEN"
                      ? `First observed ${fmtDay(r.firstObservedAt)}`
                      : fmtDay(r.lastChangedAt)}
                  </td>
                  {search.view === "PRICE_REVIEW" || search.view === "REPEATED" ? (
                    <>
                      <td className="py-2.5 pr-3 tabular-nums">{gbp(r.tradePrice)}</td>
                      <td className="py-2.5 pr-3 tabular-nums">{gbp(r.rrp, 2)}</td>
                    </>
                  ) : null}
                  <td className="py-2.5">
                    <span className="text-[12px]">{r.movementLabel}</span>
                    {search.view === "REPEATED" ? (
                      <span className="ml-2 text-[11px] text-steel">
                        {r.movementCountInPeriod} moves
                      </span>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="mt-4 flex flex-wrap items-center justify-between gap-2 text-sm">
            <p className="text-steel">
              {data.total} product{data.total === 1 ? "" : "s"}
              {data.period
                ? ` · ${data.period.from} → ${data.period.to}`
                : " · All AB cost history"}
            </p>
            <div className="flex items-center gap-2">
              <select
                className="h-9 rounded-md border border-border px-2"
                value={search.pageSize}
                onChange={(e) => patch({ pageSize: Number(e.target.value), page: 1 })}
                aria-label="Page size"
              >
                {[25, 50, 100].map((n) => (
                  <option key={n} value={n}>
                    {n} / page
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="h-9 rounded-md border border-border px-3 disabled:opacity-40"
                disabled={search.page <= 1}
                onClick={() => patch({ page: search.page - 1 })}
              >
                Previous
              </button>
              <span className="tabular-nums text-steel">
                {search.page} / {data.totalPages}
              </span>
              <button
                type="button"
                className="h-9 rounded-md border border-border px-3 disabled:opacity-40"
                disabled={search.page >= data.totalPages}
                onClick={() => patch({ page: search.page + 1 })}
              >
                Next
              </button>
            </div>
          </div>
        </div>
      )}

      <Drawer
        open={Boolean(drillVariantId)}
        onClose={() => setDrillVariantId(null)}
        title="Cost history"
        sub="Shared product Autopart cost intelligence"
        width="lg"
        footer={(() => {
          const productId = data?.items.find((i) => i.productVariantId === drillVariantId)
            ?.productId;
          if (!productId) return null;
          return (
            <Link
              to="/admin/products/$id"
              params={{ id: productId }}
              className="inline-flex h-11 w-full items-center justify-center rounded-md border border-border text-[13px] font-bold uppercase"
              onClick={() => setDrillVariantId(null)}
            >
              Open product
            </Link>
          );
        })()}
      >
        {drillVariantId ? <AutopartProductCostPanel variantId={drillVariantId} /> : null}
      </Drawer>
    </div>
  );
}

function EmptyState({ search }: { search: CostIntelligenceSearch }) {
  let title = "No cost history yet";
  let body =
    "Cost history will build automatically as 231PO3NEW reports are processed. AB only knows costs from when recording began.";
  if (search.movement === "INCREASED" || search.view === "INCREASES") {
    title = "No cost increases";
    body = "No products had a recorded cost increase in this period.";
  } else if (search.movement === "DECREASED" || search.view === "DECREASES") {
    title = "No cost decreases";
    body = "No products had a recorded cost decrease in this period.";
  } else if (search.view === "REPEATED") {
    title = "No repeated movers";
    body = "No products changed cost more than once in this period.";
  } else if (search.view === "PRICE_REVIEW") {
    title = "No price reviews";
    body = "No products meet the current cost-movement review threshold.";
  } else if (search.movement === "NO_COST") {
    title = "No missing cost data";
    body = "Every active catalogue SKU in this filter has a valid Autopart Latest Cost observation.";
  } else if (search.movement === "FIRST_SEEN") {
    title = "No first-seen costs";
    body = "No products had their first Autopart cost observation in this period.";
  }
  return (
    <div className="mx-4 my-8 rounded-md border border-dashed border-border px-6 py-12 text-center sm:mx-6">
      <p className="font-display text-base font-semibold uppercase">{title}</p>
      <p className="mt-2 text-sm text-steel">{body}</p>
      <p className="mt-4 text-[12px] text-steel">
        <Link to={ROUTES.adminStockSync} className="text-primary hover:underline">
          Autopart Stock sync
        </Link>
      </p>
    </div>
  );
}
