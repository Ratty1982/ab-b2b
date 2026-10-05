import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { PanelHeader } from "@/components/ab/AppShell";
import {
  EmptyState,
  ErrorState,
  FreshnessBanner,
  LoadingState,
  Pager,
  PurchasingStatusBadge,
  SORT_OPTIONS,
  STATUS_FILTERS,
  SkuLink,
  TREND_FILTERS,
  btnClass,
  controlClass,
  coverLabel,
  gbp,
  parseForecastSearch,
  mergeForecastSearch,
  qty,
  rate,
  ukDate,
  INCOMING_SOURCE_HINT,
  type ForecastSearch,
  type ForecastSearchPatch,
} from "@/components/purchasing/workspace";
import { listPurchasingForecastFn } from "@/server/phase2/fns";

export const Route = createFileRoute("/purchasing/forecast/")({
  validateSearch: (raw: Record<string, unknown>) => parseForecastSearch(raw),
  head: () => ({
    meta: [
      { title: "Stock Forecast — Purchasing — Automotive Brands" },
      { name: "description", content: "SKU demand, cover, incoming and suggested purchase quantities." },
    ],
  }),
  component: StockForecastPage,
});

type Data = Extract<Awaited<ReturnType<typeof listPurchasingForecastFn>>, { ok: true }>["data"];

function StockForecastPage() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState(search.q ?? "");

  useEffect(() => {
    setQ(search.q ?? "");
  }, [search.q]);

  useEffect(() => {
    let cancelled = false;
    setData(null);
    void listPurchasingForecastFn({
      data: {
        status: search.status ?? null,
        brand: search.brand ?? null,
        supplier: search.supplier ?? null,
        trend: search.trend ?? null,
        incoming: search.incoming ?? "any",
        q: search.q ?? null,
        sort: search.sort ?? "cover",
        page: search.page ?? 1,
        pageSize: 50,
      },
    }).then((result) => {
      if (cancelled) return;
      if (!result.ok) {
        setError(result.error);
        setData(null);
        return;
      }
      setError(null);
      setData(result.data);
    });
    return () => {
      cancelled = true;
    };
  }, [search]);

  function patch(next: ForecastSearchPatch) {
    void navigate({
      search: (prev) => mergeForecastSearch(prev, next),
    });
  }

  return (
    <>
      <PanelHeader
        title="Stock Forecast"
        sub="Current sellable stock is Avail only. Incoming is on-order quantity with no invented ETA."
        crumbs={[{ label: "Purchasing" }, { label: "Stock Forecast" }]}
      />
      {data ? (
        <FreshnessBanner
          stockUpdated={data.freshness.stockUpdated}
          salesUpdated={data.freshness.salesUpdated}
          stockStale={data.freshness.stockStale}
        />
      ) : null}
      {error ? <ErrorState message={error} /> : null}
      <form
        className="flex flex-wrap gap-2 border-b border-border/70 px-4 py-3 sm:px-6"
        onSubmit={(event) => {
          event.preventDefault();
          patch({ q: q.trim() || undefined, page: undefined });
        }}
      >
        <input
          className={`${controlClass} min-w-[180px]`}
          placeholder="Search SKU / product"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <select
          className={controlClass}
          value={search.status ?? ""}
          onChange={(e) => patch({ status: e.target.value || undefined, page: undefined })}
        >
          {STATUS_FILTERS.map((opt) => (
            <option key={opt.value || "all"} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        <select
          className={controlClass}
          value={search.brand ?? ""}
          onChange={(e) => patch({ brand: e.target.value || undefined, page: undefined })}
        >
          <option value="">All brands</option>
          {(data?.brands ?? []).map((brand) => (
            <option key={brand} value={brand}>
              {brand}
            </option>
          ))}
        </select>
        <select
          className={controlClass}
          value={search.supplier ?? ""}
          onChange={(e) => patch({ supplier: e.target.value || undefined, page: undefined })}
        >
          <option value="">All suppliers</option>
          {(data?.suppliers ?? []).map((supplier) => (
            <option key={supplier} value={supplier}>
              {supplier}
            </option>
          ))}
        </select>
        <select
          className={controlClass}
          value={search.trend ?? ""}
          onChange={(e) => patch({ trend: e.target.value || undefined, page: undefined })}
        >
          {TREND_FILTERS.map((opt) => (
            <option key={opt.value || "all"} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        <select
          className={controlClass}
          value={search.incoming ?? "any"}
          onChange={(e) =>
            patch({ incoming: e.target.value === "any" ? undefined : (e.target.value as "yes" | "no"), page: undefined })
          }
        >
          <option value="any">Incoming: any</option>
          <option value="yes">Incoming: yes</option>
          <option value="no">Incoming: no</option>
        </select>
        <select
          className={controlClass}
          value={search.sort ?? "cover"}
          onChange={(e) => patch({ sort: e.target.value as ForecastSearch["sort"], page: undefined })}
        >
          {SORT_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        <button type="submit" className={btnClass}>
          Search
        </button>
      </form>
      {!data && !error ? <LoadingState /> : null}
      {data && data.rows.length === 0 ? (
        <EmptyState
          title="No matching SKUs"
          body="Try clearing filters. Forecasts still run when supplier, MOQ or lead time are not configured."
        />
      ) : null}
      {data && data.rows.length > 0 ? (
        <>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1400px] text-left text-[13px]">
              <thead className="bg-secondary/40 text-[10px] font-semibold uppercase tracking-[0.12em] text-steel">
                <tr>
                  <th className="px-3 py-2">Product</th>
                  <th className="px-3 py-2">SKU</th>
                  <th className="px-3 py-2">Brand</th>
                  <th className="px-3 py-2">Available</th>
                  <th className="px-3 py-2" title={INCOMING_SOURCE_HINT}>
                    Incoming
                  </th>
                  <th className="px-3 py-2">7d sales</th>
                  <th className="px-3 py-2">30d sales</th>
                  <th className="px-3 py-2">90d sales</th>
                  <th className="px-3 py-2">Avg / week</th>
                  <th className="px-3 py-2">Current cover</th>
                  <th className="px-3 py-2">Lead time</th>
                  <th className="px-3 py-2">Est. runout</th>
                  <th className="px-3 py-2">Suggested order</th>
                  <th className="px-3 py-2">Latest cost</th>
                  <th className="px-3 py-2">Suggested value</th>
                  <th className="px-3 py-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((row) => (
                  <tr key={row.sku} className="border-t border-border/70">
                    <td className="px-3 py-2">
                      <SkuLink sku={row.sku} name={row.name} />
                    </td>
                    <td className="px-3 py-2 font-mono text-[12px]">{row.sku}</td>
                    <td className="px-3 py-2">{row.brand}</td>
                    <td className="px-3 py-2">{qty(row.availableQty)}</td>
                    <td className="px-3 py-2">{qty(row.incomingQty)}</td>
                    <td className="px-3 py-2">{qty(row.rates.last7.netUnits)}</td>
                    <td className="px-3 py-2">{qty(row.rates.last30.netUnits)}</td>
                    <td className="px-3 py-2">{qty(row.rates.last90.netUnits)}</td>
                    <td className="px-3 py-2">{rate(row.recommendedWeekly)}</td>
                    <td className="px-3 py-2">{coverLabel(row.weeksCover, row.recommendedWeekly)}</td>
                    <td className="px-3 py-2">
                      {row.purchasing.leadTimeDays == null ? "Not set" : `${row.purchasing.leadTimeDays}d`}
                    </td>
                    <td className="px-3 py-2">{ukDate(row.estimatedStockoutDate)}</td>
                    <td className="px-3 py-2">{qty(row.purchase.suggestedQty)}</td>
                    <td className="px-3 py-2">{gbp(row.latestCost)}</td>
                    <td className="px-3 py-2">{gbp(row.suggestedValue)}</td>
                    <td className="px-3 py-2">
                      <PurchasingStatusBadge status={row.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pager
            page={data.page}
            pageSize={data.pageSize}
            total={data.total}
            onPage={(page) => patch({ page })}
          />
        </>
      ) : null}
    </>
  );
}
