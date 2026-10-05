import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { PanelHeader } from "@/components/ab/AppShell";
import {
  EmptyState,
  ErrorState,
  ForecastConfidenceBadge,
  ForecastCoverageBanner,
  FreshnessBanner,
  LoadingState,
  Pager,
  PurchasingStatusBadge,
  SkuLink,
  controlClass,
  coverLabel,
  gbp,
  mergeForecastSearch,
  parseForecastSearch,
  qty,
  ukDate,
  INCOMING_SOURCE_HINT,
  type ForecastSearch,
  type ForecastSearchPatch,
} from "@/components/purchasing/workspace";
import { listPurchasingOverstockFn } from "@/server/phase2/fns";
import { quietSaleFilterLabel } from "@/domain/purchasing-forecast";

type OverstockSearch = ForecastSearch & { quiet?: "all" | "overstock" | "30" | "90" | "180" };
type OverstockSearchPatch = ForecastSearchPatch & { quiet?: OverstockSearch["quiet"] | undefined };

function parseOverstockSearch(raw: Record<string, unknown>): OverstockSearch {
  const base = parseForecastSearch(raw);
  const quiet = typeof raw["quiet"] === "string" ? raw["quiet"] : "";
  if (quiet === "overstock" || quiet === "30" || quiet === "90" || quiet === "180" || quiet === "all") {
    return { ...base, quiet };
  }
  return base;
}

export const Route = createFileRoute("/purchasing/overstock")({
  validateSearch: (raw: Record<string, unknown>) => parseOverstockSearch(raw),
  head: () => ({
    meta: [
      { title: "Overstock — Purchasing — Automotive Brands" },
      { name: "description", content: "Identify cash tied up in slow-moving or high-cover stock." },
    ],
  }),
  component: OverstockPage,
});

type Data = Extract<Awaited<ReturnType<typeof listPurchasingOverstockFn>>, { ok: true }>["data"];

function OverstockPage() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void listPurchasingOverstockFn({
      data: {
        brand: search.brand ?? null,
        supplier: search.supplier ?? null,
        q: search.q ?? null,
        quiet: search.quiet ?? "all",
        page: search.page ?? 1,
        pageSize: 50,
        sort: "overstock",
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

  function patch(next: OverstockSearchPatch) {
    void navigate({
      search: (prev) => {
        const merged = mergeForecastSearch(prev, next) as OverstockSearch;
        if (next.quiet === undefined || next.quiet === "all") delete merged.quiet;
        else if (next.quiet) merged.quiet = next.quiet;
        return merged;
      },
    });
  }

  return (
    <>
      <PanelHeader
        title="Overstock"
        sub="Stock value uses current sellable quantity × Latest Cost. Incoming value is shown separately."
        crumbs={[{ label: "Purchasing" }, { label: "Overstock" }]}
      />
      {data ? (
        <>
          <FreshnessBanner
            stockUpdated={data.freshness.stockUpdated}
            salesUpdated={data.freshness.salesUpdated}
            stockStale={data.freshness.stockStale}
          />
          <ForecastCoverageBanner
            coverageDays={data.forecastCoverage.coverageDays}
            confidence={data.forecastCoverage.confidence}
            historyFrom={data.forecastCoverage.historyFrom}
          />
        </>
      ) : null}
      {error ? <ErrorState message={error} /> : null}
      <div className="flex flex-wrap gap-2 border-b border-border/70 px-4 py-3 sm:px-6">
        <select
          className={controlClass}
          value={search.quiet ?? "all"}
          onChange={(e) => patch({ quiet: e.target.value as OverstockSearch["quiet"], page: undefined })}
        >
          <option value="all">High cover + quiet SKUs</option>
          <option value="overstock">Overstock cover only</option>
          <option value="30">{quietSaleFilterLabel(30, data?.forecastCoverage.coverageDays ?? 30)}</option>
          <option value="90">{quietSaleFilterLabel(90, data?.forecastCoverage.coverageDays ?? 90)}</option>
          <option value="180">{quietSaleFilterLabel(180, data?.forecastCoverage.coverageDays ?? 180)}</option>
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
      </div>
      {!data && !error ? <LoadingState /> : null}
      {data && data.rows.length === 0 ? (
        <EmptyState title="No overstock rows" body="No SKUs currently meet the high-cover or quiet-sales filters." />
      ) : null}
      {data && data.rows.length > 0 ? (
        <>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1200px] text-left text-[13px]">
              <thead className="bg-secondary/40 text-[10px] font-semibold uppercase tracking-[0.12em] text-steel">
                <tr>
                  <th className="px-3 py-2">Product</th>
                  <th className="px-3 py-2">SKU</th>
                  <th className="px-3 py-2">Available</th>
                  <th className="px-3 py-2" title={INCOMING_SOURCE_HINT}>
                    Incoming
                  </th>
                  <th className="px-3 py-2">Last sale</th>
                  <th className="px-3 py-2">30d units</th>
                  <th className="px-3 py-2">90d units</th>
                  <th className="px-3 py-2">Weeks cover</th>
                  <th className="px-3 py-2">Latest cost</th>
                  <th className="px-3 py-2">Stock value</th>
                  <th className="px-3 py-2">Incoming value</th>
                  <th className="px-3 py-2">Confidence</th>
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
                    <td className="px-3 py-2">{qty(row.availableQty)}</td>
                    <td className="px-3 py-2">{qty(row.incomingQty)}</td>
                    <td className="px-3 py-2">{ukDate(row.lastSale)}</td>
                    <td className="px-3 py-2">{qty(row.rates.last30.netUnits)}</td>
                    <td className="px-3 py-2">{qty(row.rates.last90.netUnits)}</td>
                    <td className="px-3 py-2">{coverLabel(row.weeksCover, row.recommendedWeekly)}</td>
                    <td className="px-3 py-2">{gbp(row.latestCost)}</td>
                    <td className="px-3 py-2">{gbp(row.availableStockValue)}</td>
                    <td className="px-3 py-2">{gbp(row.incomingStockValue)}</td>
                    <td className="px-3 py-2">
                      <ForecastConfidenceBadge
                        confidence={row.forecastConfidence}
                        coverageDays={row.salesHistoryCoverageDays}
                        warning={row.forecastConfidenceWarning}
                      />
                    </td>
                    <td className="px-3 py-2">
                      <PurchasingStatusBadge status={row.status} />
                      {row.status === "OVERSTOCK" && row.forecastConfidenceWarning ? (
                        <div className="mt-1 text-[11px] text-warn">Potential overstock</div>
                      ) : null}
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
