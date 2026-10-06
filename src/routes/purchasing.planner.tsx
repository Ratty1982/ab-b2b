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
  STATUS_FILTERS,
  SkuLink,
  btnClass,
  controlClass,
  downloadCsv,
  gbp,
  mergeForecastSearch,
  parseForecastSearch,
  primaryBtnClass,
  qty,
  INCOMING_SOURCE_HINT,
  type ForecastSearch,
  type ForecastSearchPatch,
} from "@/components/purchasing/workspace";
import {
  exportPurchasePlannerCsvFn,
  listPurchasePlannerFn,
  updatePurchasingPlanFn,
} from "@/server/phase2/fns";

type PlannerSearch = ForecastSearch & { horizonDays?: number };
type PlannerSearchPatch = ForecastSearchPatch & { horizonDays?: number | undefined };

function parsePlannerSearch(raw: Record<string, unknown>): PlannerSearch {
  const base = parseForecastSearch(raw);
  const horizonRaw = raw["horizonDays"];
  const horizon = Number(horizonRaw);
  if (Number.isFinite(horizon) && horizon >= 7) {
    return { ...base, horizonDays: Math.trunc(horizon) };
  }
  return base;
}

export const Route = createFileRoute("/purchasing/planner")({
  validateSearch: (raw: Record<string, unknown>) => parsePlannerSearch(raw),
  head: () => ({
    meta: [
      { title: "Purchase Planner — Automotive Brands" },
      { name: "description", content: "Plan suggested purchases. CSV is a human worksheet, not an Autopart PO import." },
    ],
  }),
  component: PurchasePlannerPage,
});

type Data = Extract<Awaited<ReturnType<typeof listPurchasePlannerFn>>, { ok: true }>["data"];

function PurchasePlannerPage() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Record<string, { plannedQty: string; note: string }>>({});
  const [savingSku, setSavingSku] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void listPurchasePlannerFn({
      data: {
        status: search.status ?? null,
        brand: search.brand ?? null,
        supplier: search.supplier ?? null,
        productType: search.productType ?? "all",
        q: search.q ?? null,
        sort: search.sort ?? "suggestedValue",
        page: search.page ?? 1,
        pageSize: 50,
        horizonDays: search.horizonDays ?? 90,
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

  function patch(next: PlannerSearchPatch) {
    void navigate({
      search: (prev) => {
        const merged = mergeForecastSearch(prev, next) as PlannerSearch;
        if (next.horizonDays === undefined || next.horizonDays === 90) delete merged.horizonDays;
        else if (next.horizonDays) merged.horizonDays = next.horizonDays;
        return merged;
      },
    });
  }

  async function saveRow(sku: string) {
    const row = data?.rows.find((r) => r.sku === sku);
    const current = draft[sku] ?? {
      plannedQty: row?.plannedQty == null ? "" : String(row.plannedQty),
      note: row?.note ?? "",
    };
    setSavingSku(sku);
    const plannedRaw = current.plannedQty.trim();
    const result = await updatePurchasingPlanFn({
      data: {
        sku,
        plannedQty: plannedRaw === "" ? null : Number(plannedRaw),
        note: current.note.trim() || null,
      },
    });
    setSavingSku(null);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setData((prev) =>
      prev
        ? {
            ...prev,
            rows: prev.rows.map((item) =>
              item.sku === sku
                ? {
                    ...item,
                    plannedQty: result.data.forecast.plannedQty,
                    note: result.data.forecast.note,
                  }
                : item,
            ),
          }
        : prev,
    );
  }

  async function exportCsv() {
    setExporting(true);
    const result = await exportPurchasePlannerCsvFn({
      data: {
        status: search.status ?? null,
        brand: search.brand ?? null,
        supplier: search.supplier ?? null,
        productType: search.productType ?? "all",
        q: search.q ?? null,
        horizonDays: search.horizonDays ?? 90,
      },
    });
    setExporting(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    downloadCsv(result.data.csv, result.data.filename);
  }

  return (
    <>
      <PanelHeader
        title="Purchase Planner"
        sub="Planning worksheet only. Incoming stays authoritative from 231PO3NEW. CSV is not an Autopart PO import."
        crumbs={[{ label: "Purchasing" }, { label: "Purchase Planner" }]}
        actions={
          <button type="button" className={primaryBtnClass} onClick={() => void exportCsv()} disabled={exporting}>
            {exporting ? "Exporting…" : "Export CSV"}
          </button>
        }
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
            verified={data.forecastCoverage.verified}
            verifiedFrom={data.forecastCoverage.verifiedFrom}
            verifiedTo={data.forecastCoverage.verifiedTo}
          />
        </>
      ) : null}
      {error ? <ErrorState message={error} /> : null}
      <div className="flex flex-wrap gap-2 border-b border-border/70 px-4 py-3 sm:px-6">
        <select
          className={controlClass}
          value={search.horizonDays ?? 90}
          onChange={(e) => patch({ horizonDays: Number(e.target.value), page: undefined })}
        >
          <option value={30}>Horizon 30 days</option>
          <option value={60}>Horizon 60 days</option>
          <option value={90}>Horizon 90 days</option>
        </select>
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
          value={search.productType ?? "all"}
          onChange={(e) =>
            patch({
              productType: (e.target.value as PlannerSearch["productType"]) || undefined,
              page: undefined,
            })
          }
        >
          <option value="all">All product types</option>
          <option value="catalogue">Catalogue</option>
          <option value="external">External</option>
        </select>
      </div>
      {!data && !error ? <LoadingState /> : null}
      {data && data.rows.length === 0 ? (
        <EmptyState title="No planner rows" body="No SKUs match the current filters." />
      ) : null}
      {data && data.rows.length > 0 ? (
        <>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1400px] text-left text-[13px]">
              <thead className="bg-secondary/40 text-[10px] font-semibold uppercase tracking-[0.12em] text-steel">
                <tr>
                  <th className="px-3 py-2">Product</th>
                  <th className="px-3 py-2">SKU</th>
                  <th className="px-3 py-2">Available</th>
                  <th className="px-3 py-2" title={INCOMING_SOURCE_HINT}>
                    Incoming
                  </th>
                  <th className="px-3 py-2">Forecast demand</th>
                  <th className="px-3 py-2">Target stock</th>
                  <th className="px-3 py-2">Suggested qty</th>
                  <th className="px-3 py-2">Confidence</th>
                  <th className="px-3 py-2">MOQ</th>
                  <th className="px-3 py-2">Multiple</th>
                  <th className="px-3 py-2">Latest cost</th>
                  <th className="px-3 py-2">Est. value</th>
                  <th className="px-3 py-2">Planned qty</th>
                  <th className="px-3 py-2">Note</th>
                  <th className="px-3 py-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((row) => {
                  const current = draft[row.sku] ?? {
                    plannedQty: row.plannedQty == null ? "" : String(row.plannedQty),
                    note: row.note ?? "",
                  };
                  return (
                    <tr key={row.sku} className="border-t border-border/70 align-top">
                      <td className="px-3 py-2">
                        <SkuLink sku={row.sku} name={row.name} productKind={row.productKind} />
                      </td>
                      <td className="px-3 py-2 font-mono text-[12px]">{row.sku}</td>
                      <td className="px-3 py-2">{qty(row.availableQty)}</td>
                      <td className="px-3 py-2">{qty(row.incomingQty)}</td>
                      <td className="px-3 py-2">{qty(row.horizonDemand)}</td>
                      <td className="px-3 py-2">{qty(row.targetStock)}</td>
                      <td className="px-3 py-2">{qty(row.purchase.suggestedQty)}</td>
                      <td className="px-3 py-2">
                        <ForecastConfidenceBadge
                          confidence={row.forecastConfidence}
                          coverageDays={row.salesHistoryCoverageDays}
                          warning={row.forecastConfidenceWarning}
                          verified={row.salesHistoryVerified}
                        />
                      </td>
                      <td className="px-3 py-2">{row.purchasing.minimumOrderQty ?? "—"}</td>
                      <td className="px-3 py-2">{row.purchasing.orderMultiple ?? "—"}</td>
                      <td className="px-3 py-2">{gbp(row.latestCost)}</td>
                      <td className="px-3 py-2">{gbp(row.suggestedValue)}</td>
                      <td className="px-3 py-2">
                        {data.canManage ? (
                          <input
                            className={`${controlClass} w-24`}
                            value={current.plannedQty}
                            onChange={(e) =>
                              setDraft((prev) => ({
                                ...prev,
                                [row.sku]: { ...current, plannedQty: e.target.value },
                              }))
                            }
                          />
                        ) : (
                          qty(row.plannedQty)
                        )}
                      </td>
                      <td className="px-3 py-2">
                        {data.canManage ? (
                          <div className="flex gap-2">
                            <input
                              className={`${controlClass} min-w-[140px]`}
                              value={current.note}
                              onChange={(e) =>
                                setDraft((prev) => ({
                                  ...prev,
                                  [row.sku]: { ...current, note: e.target.value },
                                }))
                              }
                            />
                            <button
                              type="button"
                              className={btnClass}
                              disabled={savingSku === row.sku}
                              onClick={() => void saveRow(row.sku)}
                            >
                              {savingSku === row.sku ? "…" : "Save"}
                            </button>
                          </div>
                        ) : (
                          row.note ?? "—"
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <PurchasingStatusBadge status={row.status} />
                      </td>
                    </tr>
                  );
                })}
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
