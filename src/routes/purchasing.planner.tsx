import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { PanelHeader } from "@/components/ab/AppShell";
import {
  EmptyState,
  ErrorState,
  ForecastCoverageBanner,
  FreshnessBanner,
  LoadingState,
  Pager,
  PlannerRecommendationBadge,
  SkuLink,
  STATUS_FILTERS,
  btnClass,
  controlClass,
  coverLabel,
  downloadCsv,
  gbp,
  primaryBtnClass,
  qty,
  rate,
} from "@/components/purchasing/workspace";
import {
  PLANNER_RECOMMENDATIONS,
  PLANNER_RECOMMENDATION_LABEL,
  plannedQtyWarnings,
  summarizeWorkingSelection,
  type PlannerRecommendation,
  type PlannerSelectionItem,
} from "@/domain/purchasing-planner";
import { exportPurchasePlannerCsvFn, listPurchasePlannerFn } from "@/server/phase2/fns";

const WORKING_KEY = "ab-purchasing-working-list";

type PlannerSearch = {
  supplierId?: string | undefined;
  recommendation?: PlannerRecommendation | undefined;
  brand?: string | undefined;
  productType?: "catalogue" | "external" | undefined;
  status?: string | undefined;
  q?: string | undefined;
  backordersOnly?: boolean | undefined;
  incomingOnly?: boolean | undefined;
  missingSupplier?: boolean | undefined;
  missingCost?: boolean | undefined;
  demand?: "sufficient" | "limited" | undefined;
  plannerSort?: "priority" | "value" | "backorders" | "cover" | undefined;
  page?: number | undefined;
};

type WorkingEntry = { qty: string; selected: boolean };

function flag(raw: Record<string, unknown>, key: string): boolean {
  const value = raw[key];
  return value === true || value === "1" || value === "true";
}

function parsePlannerSearch(raw: Record<string, unknown>): PlannerSearch {
  const out: PlannerSearch = {};
  const str = (key: string) => (typeof raw[key] === "string" && raw[key] ? String(raw[key]) : "");
  const supplierId = str("supplierId");
  if (supplierId) out.supplierId = supplierId;
  const recommendation = str("recommendation");
  if ((PLANNER_RECOMMENDATIONS as readonly string[]).includes(recommendation)) {
    out.recommendation = recommendation as PlannerRecommendation;
  }
  const brand = str("brand");
  if (brand) out.brand = brand;
  const productType = str("productType");
  if (productType === "catalogue" || productType === "external") out.productType = productType;
  const status = str("status");
  if (status) out.status = status;
  const q = str("q");
  if (q) out.q = q;
  if (flag(raw, "backordersOnly")) out.backordersOnly = true;
  if (flag(raw, "incomingOnly")) out.incomingOnly = true;
  if (flag(raw, "missingSupplier")) out.missingSupplier = true;
  if (flag(raw, "missingCost")) out.missingCost = true;
  const demand = str("demand");
  if (demand === "sufficient" || demand === "limited") out.demand = demand;
  const sort = str("plannerSort");
  if (sort === "value" || sort === "backorders" || sort === "cover" || sort === "priority") out.plannerSort = sort;
  const page = Number(raw["page"]);
  if (Number.isFinite(page) && page > 1) out.page = Math.trunc(page);
  return out;
}

export const Route = createFileRoute("/purchasing/planner")({
  validateSearch: (raw: Record<string, unknown>) => parsePlannerSearch(raw),
  head: () => ({
    meta: [
      { title: "Purchase Planner — Automotive Brands" },
      {
        name: "description",
        content: "Supplier-aware purchasing recommendations. The real purchase order is created in Autopart.",
      },
    ],
  }),
  component: PurchasePlannerPage,
});

type Data = Extract<Awaited<ReturnType<typeof listPurchasePlannerFn>>, { ok: true }>["data"];
type Row = Data["rows"][number];

function loadWorking(): Record<string, WorkingEntry> {
  if (typeof sessionStorage === "undefined") return {};
  try {
    const raw = sessionStorage.getItem(WORKING_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, WorkingEntry>;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function PurchasePlannerPage() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [working, setWorking] = useState<Record<string, WorkingEntry>>({});
  const [workingReady, setWorkingReady] = useState(false);
  const [cache, setCache] = useState<Record<string, Row>>({});
  const [explainSku, setExplainSku] = useState<string | null>(null);

  useEffect(() => {
    setWorking(loadWorking());
    setWorkingReady(true);
  }, []);

  useEffect(() => {
    if (!workingReady) return;
    sessionStorage.setItem(WORKING_KEY, JSON.stringify(working));
  }, [working, workingReady]);

  useEffect(() => {
    let cancelled = false;
    void listPurchasePlannerFn({
      data: {
        supplierId: search.supplierId ?? null,
        recommendation: search.recommendation ?? null,
        brand: search.brand ?? null,
        productType: search.productType ?? "all",
        status: search.status ?? null,
        q: search.q ?? null,
        backordersOnly: search.backordersOnly ?? false,
        incomingOnly: search.incomingOnly ?? false,
        missingSupplier: search.missingSupplier ?? false,
        missingCost: search.missingCost ?? false,
        demand: search.demand ?? null,
        plannerSort: search.plannerSort ?? "priority",
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
      setCache((prev) => {
        const next = { ...prev };
        for (const row of result.data.rows) next[row.sku] = row;
        return next;
      });
    });
    return () => {
      cancelled = true;
    };
  }, [search]);

  function patch(next: Partial<PlannerSearch>) {
    void navigate({
      search: (prev) => {
        const merged: PlannerSearch = { ...prev, ...next };
        (Object.keys(merged) as Array<keyof PlannerSearch>).forEach((key) => {
          const value = merged[key];
          if (value === undefined || value === "" || value === false) delete merged[key];
        });
        if (merged.page === 1) delete merged.page;
        if (next.page === undefined && !("page" in next)) delete merged.page;
        return merged;
      },
    });
  }

  const selectedItems: PlannerSelectionItem[] = useMemo(() => {
    return Object.entries(working)
      .filter(([, entry]) => entry.selected)
      .map(([sku, entry]) => {
        const row = cache[sku];
        const entered = entry.qty.trim();
        const planned = entered === "" ? (row?.suggestedQty ?? 0) : Number(entered);
        return {
          sku,
          plannedQty: planned,
          cost: row?.purchasingCost ?? null,
          minimumOrderQty: row?.purchasing.minimumOrderQty ?? null,
          orderMultiple: row?.purchasing.orderMultiple ?? null,
        };
      });
  }, [working, cache]);

  const selection = summarizeWorkingSelection(
    selectedItems,
    data?.supplierSummary && data.supplierSummary.supplierId !== "unassigned"
      ? data.supplierSummary.minimumOrderValue
      : null,
  );
  const explain = explainSku ? (cache[explainSku] ?? data?.rows.find((row) => row.sku === explainSku) ?? null) : null;

  async function exportCsv() {
    setExporting(true);
    const result = await exportPurchasePlannerCsvFn({
      data: {
        supplierId: search.supplierId ?? null,
        recommendation: search.recommendation ?? null,
        brand: search.brand ?? null,
        productType: search.productType ?? "all",
        status: search.status ?? null,
        q: search.q ?? null,
        backordersOnly: search.backordersOnly ?? false,
        incomingOnly: search.incomingOnly ?? false,
        missingSupplier: search.missingSupplier ?? false,
        missingCost: search.missingCost ?? false,
        demand: search.demand ?? null,
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
        sub="What to consider ordering from each supplier. Create the real purchase order in Autopart — this screen does not."
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
            fbaUpdated={data.freshness.fbaUpdated}
            fbaStale={data.freshness.fbaStale}
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
          value={search.supplierId ?? ""}
          onChange={(e) => patch({ supplierId: e.target.value || undefined, page: undefined })}
        >
          <option value="">All suppliers</option>
          <option value="unassigned">Unassigned supplier</option>
          {data?.supplierOptions.map((supplier) => (
            <option key={supplier.id} value={supplier.id}>
              {supplier.name}
              {supplier.code ? ` (${supplier.code})` : ""}
            </option>
          ))}
        </select>
        <select
          className={controlClass}
          value={search.recommendation ?? ""}
          onChange={(e) => patch({ recommendation: (e.target.value || undefined) as PlannerRecommendation | undefined, page: undefined })}
        >
          <option value="">All recommendations</option>
          {PLANNER_RECOMMENDATIONS.map((value) => (
            <option key={value} value={value}>
              {PLANNER_RECOMMENDATION_LABEL[value]}
            </option>
          ))}
        </select>
        <select className={controlClass} value={search.brand ?? ""} onChange={(e) => patch({ brand: e.target.value || undefined, page: undefined })}>
          <option value="">All brands</option>
          {data?.brands.map((brand) => (
            <option key={brand} value={brand}>
              {brand}
            </option>
          ))}
        </select>
        <select
          className={controlClass}
          value={search.productType ?? ""}
          onChange={(e) => patch({ productType: (e.target.value || undefined) as PlannerSearch["productType"], page: undefined })}
        >
          <option value="">All classifications</option>
          <option value="catalogue">Catalogue</option>
          <option value="external">External</option>
        </select>
        <select className={controlClass} value={search.status ?? ""} onChange={(e) => patch({ status: e.target.value || undefined, page: undefined })}>
          {STATUS_FILTERS.map((option) => (
            <option key={option.value || "all"} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <select
          className={controlClass}
          value={search.demand ?? ""}
          onChange={(e) => patch({ demand: (e.target.value || undefined) as PlannerSearch["demand"], page: undefined })}
        >
          <option value="">Any demand confidence</option>
          <option value="sufficient">Verified demand</option>
          <option value="limited">Unverified / limited</option>
        </select>
        <select
          className={controlClass}
          value={search.plannerSort ?? "priority"}
          onChange={(e) => patch({ plannerSort: e.target.value === "priority" ? undefined : (e.target.value as PlannerSearch["plannerSort"]), page: undefined })}
        >
          <option value="priority">Actionable risk first</option>
          <option value="value">Highest estimated value</option>
          <option value="backorders">Largest uncovered backorders</option>
          <option value="cover">Lowest stock cover</option>
        </select>
        <input
          className={controlClass}
          placeholder="Search SKU or product"
          defaultValue={search.q ?? ""}
          key={search.q ?? ""}
          onKeyDown={(e) => {
            if (e.key === "Enter") patch({ q: e.currentTarget.value.trim() || undefined, page: undefined });
          }}
        />
        <FilterCheck label="Backorders only" checked={Boolean(search.backordersOnly)} onChange={(checked) => patch({ backordersOnly: checked || undefined, page: undefined })} />
        <FilterCheck label="Incoming only" checked={Boolean(search.incomingOnly)} onChange={(checked) => patch({ incomingOnly: checked || undefined, page: undefined })} />
        <FilterCheck label="Missing supplier" checked={Boolean(search.missingSupplier)} onChange={(checked) => patch({ missingSupplier: checked || undefined, page: undefined })} />
        <FilterCheck label="Missing cost" checked={Boolean(search.missingCost)} onChange={(checked) => patch({ missingCost: checked || undefined, page: undefined })} />
      </div>

      {data?.supplierSummary ? <SupplierSummary summary={data.supplierSummary} /> : null}
      {data?.supplierGroups ? <SupplierGroups groups={data.supplierGroups} onOpen={(supplierId) => patch({ supplierId, page: undefined })} /> : null}

      {!data && !error ? <LoadingState /> : null}
      {data && data.rows.length === 0 ? (
        <div className="px-4 py-6 sm:px-6">
          <EmptyState title="Nothing to show" body="No products match these purchasing filters." />
        </div>
      ) : null}
      {data && data.rows.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1400px] text-left text-[12px]">
            <thead className="border-b border-border text-[10px] uppercase tracking-wide text-steel">
              <tr>
                <th className="px-3 py-2" />
                <th className="px-2 py-2">Product</th>
                <th className="px-2 py-2">Supplier</th>
                <th className="px-2 py-2 text-right">Warehouse</th>
                <th className="px-2 py-2 text-right">FBA</th>
                <th className="px-2 py-2 text-right">Total Stock</th>
                <th className="px-2 py-2 text-right">Incoming</th>
                <th className="px-2 py-2 text-right">Backorders</th>
                <th className="px-2 py-2 text-right">30 / 90 / 365</th>
                <th className="px-2 py-2 text-right">Weekly</th>
                <th className="px-2 py-2 text-right">Cover</th>
                <th className="px-2 py-2 text-right">After incoming</th>
                <th className="px-2 py-2 text-right">Lead</th>
                <th className="px-2 py-2 text-right">Suggested</th>
                <th className="px-2 py-2">Your qty</th>
                <th className="px-2 py-2 text-right">Cost</th>
                <th className="px-2 py-2 text-right">Value</th>
                <th className="px-2 py-2">Recommendation</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((row) => {
                const entry = working[row.sku] ?? { qty: "", selected: false };
                const warnings = entry.qty.trim() === "" ? [] : plannedQtyWarnings({
                  plannedQty: Number(entry.qty),
                  minimumOrderQty: row.purchasing.minimumOrderQty,
                  orderMultiple: row.purchasing.orderMultiple,
                });
                return (
                  <tr key={row.sku} className="border-b border-border/60 align-top">
                    <td className="px-3 py-2">
                      <input
                        type="checkbox"
                        checked={entry.selected}
                        aria-label={`Select ${row.sku}`}
                        onChange={(e) =>
                          setWorking((prev) => ({
                            ...prev,
                            [row.sku]: { qty: prev[row.sku]?.qty ?? "", selected: e.target.checked },
                          }))
                        }
                      />
                    </td>
                    <td className="px-2 py-2">
                      <SkuLink sku={row.sku} name={row.name} productKind={row.productKind} />
                      <div className="text-[11px] text-steel">{row.productKindLabel}</div>
                    </td>
                    <td className="px-2 py-2">
                      {row.supplier.state === "NONE"
                        ? "NO SUPPLIER"
                        : row.supplier.state === "AMBIGUOUS"
                          ? "Several suppliers"
                          : row.supplier.supplierName}
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums">{qty(row.availableQty)}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{qty(row.fbaQty)}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{qty(row.totalStock)}</td>
                    <td className="px-2 py-2 text-right tabular-nums" title="On order from Autopart P/Ord Qty. Not available stock. No ETA.">
                      {qty(row.incomingQty)}
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums">
                      {qty(row.backorderUnits)}
                      {row.backorderShortfall > 0 ? (
                        <span className="block text-[11px] text-destructive">{qty(row.backorderShortfall)} uncovered</span>
                      ) : null}
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums">
                      {qty(row.rates.last30.netUnits)} / {qty(row.rates.last90.netUnits)} / {qty(row.rates.last365.netUnits)}
                    </td>
                    <td className="px-2 py-2 text-right">{rate(row.recommendedWeekly)}</td>
                    <td className="px-2 py-2 text-right">{coverLabel(row.weeksCover, row.recommendedWeekly)}</td>
                    <td className="px-2 py-2 text-right">{coverLabel(row.projectedCover, row.recommendedWeekly)}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{row.purchasing.leadTimeDays ?? "—"}</td>
                    <td className="px-2 py-2 text-right font-semibold tabular-nums">{qty(row.suggestedQty)}</td>
                    <td className="px-2 py-2">
                      <input
                        value={entry.qty}
                        inputMode="numeric"
                        placeholder={String(row.suggestedQty)}
                        aria-label={`Your qty ${row.sku}`}
                        className="h-8 w-16 rounded-md border border-border bg-ink px-2 text-right tabular-nums"
                        onChange={(e) =>
                          setWorking((prev) => ({
                            ...prev,
                            [row.sku]: { qty: e.target.value, selected: prev[row.sku]?.selected ?? false },
                          }))
                        }
                      />
                      {warnings.map((warning) => (
                        <p key={warning} className="mt-1 max-w-[10rem] text-[11px] text-warn">
                          {warning}
                        </p>
                      ))}
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums">
                      {row.purchasingCost ? gbp(row.purchasingCost) : "—"}
                      {row.costMissing ? <span className="block text-[10px] uppercase text-warn">Cost missing</span> : null}
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums">{gbp(row.estimatedValue)}</td>
                    <td className="px-2 py-2">
                      <PlannerRecommendationBadge recommendation={row.recommendation} reason={row.recommendationReason} />
                      <p className="mt-1 max-w-[16rem] text-[11px] text-steel">{row.recommendationReason}</p>
                      {!row.confidenceSufficient ? (
                        <p className="mt-1 text-[11px] text-warn">Recommendation confidence is limited.</p>
                      ) : null}
                      <button type="button" className="mt-1 text-[11px] text-primary" onClick={() => setExplainSku(row.sku)}>
                        Why this quantity
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <Pager page={data.page} pageSize={data.pageSize} total={data.total} onPage={(page) => patch({ page })} />
        </div>
      ) : null}

      {selectedItems.length > 0 ? (
        <div className="sticky bottom-0 border-t border-border bg-background px-4 py-3 text-[13px] sm:px-6">
          <p className="font-semibold">Working list — not a purchase order</p>
          <p className="mt-1 text-steel">
            {qty(selection.products)} selected · {qty(selection.units)} units · {gbp(selection.knownValue)}
            {selection.missingCostLines > 0 ? ` · ${selection.missingCostLines} lines missing cost` : ""}
            {selection.warningLines > 0 ? ` · ${selection.warningLines} lines outside MOQ or order multiple` : ""}
          </p>
          {selection.minimumOrderValue ? (
            <p className="text-steel">
              Supplier minimum {gbp(selection.minimumOrderValue)}
              {selection.belowMinimumBy
                ? ` · Below supplier minimum by ${gbp(selection.belowMinimumBy)}. Quantities are not increased to reach it.`
                : " · Meets supplier minimum on known cost."}
            </p>
          ) : null}
        </div>
      ) : null}

      {explain ? (
        <div className="fixed inset-y-0 right-0 z-40 w-full max-w-md overflow-auto border-l border-border bg-background p-5 shadow-xl">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[10px] uppercase tracking-wide text-steel">Suggested quantity</p>
              <h2 className="font-display text-lg font-semibold">{explain.sku}</h2>
            </div>
            <button type="button" className={btnClass} onClick={() => setExplainSku(null)}>
              Close
            </button>
          </div>
          <p className="mt-2 text-[13px] text-steel">{explain.recommendationReason}</p>
          <dl className="mt-4 space-y-2 text-[13px]">
            {explain.plan.steps.map((step) => (
              <div key={step.label} className="grid grid-cols-[9rem_1fr] gap-2 border-b border-border/50 pb-2">
                <dt className="text-steel">{step.label}</dt>
                <dd>{step.value}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-4 text-[12px] text-steel">
            Customer backorders are compared with Warehouse Stock + Incoming. They are not added on top of historic sales demand.
            Incoming is on-order stock from Autopart and is not treated as available. No arrival date is assumed.
            Amazon FBA stock is shown separately and is not subtracted from the suggested quantity.
          </p>
        </div>
      ) : null}
    </>
  );
}

function FilterCheck({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex h-9 items-center gap-2 px-1 text-[12px]">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

function SupplierSummary({ summary }: { summary: NonNullable<Data["supplierSummary"]> }) {
  return (
    <div className="grid gap-2 border-b border-border/70 px-4 py-3 text-[13px] sm:grid-cols-3 sm:px-6 lg:grid-cols-6">
      <Stat label="Products to consider" value={qty(summary.productsToConsider)} />
      <Stat label="Order now" value={qty(summary.orderNow)} />
      <Stat label="Backorders at risk" value={qty(summary.backordersAtRisk)} />
      <Stat label="Suggested units" value={qty(summary.suggestedUnits)} />
      <Stat
        label="Estimated suggested value"
        value={gbp(summary.knownValue)}
        hint={summary.missingCostLines > 0 ? `${summary.missingCostLines} lines missing cost` : undefined}
      />
      <Stat
        label="Supplier minimum"
        value={summary.minimumOrderValue ? gbp(summary.minimumOrderValue) : "—"}
        hint={
          summary.belowMinimumBy
            ? `Below minimum by ${gbp(summary.belowMinimumBy)}`
            : summary.meetsMinimum
              ? "Meets minimum on known cost"
              : undefined
        }
      />
    </div>
  );
}

function SupplierGroups({
  groups,
  onOpen,
}: {
  groups: NonNullable<Data["supplierGroups"]>;
  onOpen: (supplierId: string) => void;
}) {
  const visible = groups.groups.filter((group) => group.summary.productsToConsider > 0 || group.summary.backordersAtRisk > 0);
  if (visible.length === 0 && groups.unassigned.missingSupplierActions === 0) return null;
  return (
    <div className="border-b border-border/70 px-4 py-3 sm:px-6">
      <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-steel">Suppliers to review</p>
      <div className="mt-2 flex flex-wrap gap-2">
        {groups.unassigned.missingSupplierActions > 0 ? (
          <button type="button" className={btnClass} onClick={() => onOpen("unassigned")}>
            Unassigned · {groups.unassigned.missingSupplierActions}
          </button>
        ) : null}
        {visible.slice(0, 12).map((group) => (
          <button key={group.supplierId} type="button" className={btnClass} onClick={() => onOpen(group.supplierId)}>
            {group.supplierName} · {group.summary.productsToConsider}
          </button>
        ))}
      </div>
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string | undefined }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-steel">{label}</div>
      <div className="font-semibold tabular-nums">{value}</div>
      {hint ? <div className="text-[11px] text-steel">{hint}</div> : null}
    </div>
  );
}
