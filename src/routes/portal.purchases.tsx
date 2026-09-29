import { createFileRoute, Link } from "@tanstack/react-router";
import { Fragment, useEffect, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { PanelHeader } from "@/components/ab/AppShell";
import { AvailabilityBadge } from "@/components/ab/AvailabilityBadge";
import { StatusBadge } from "@/components/ab/Badges";
import { ROUTES } from "@/lib/app-nav";
import { formatQuoteDateOnlyUk } from "@/domain/quote";
import type { PublicAvailability } from "@/domain/availability";
import {
  getPortalPurchaseProductInsightFn,
  listPortalPurchaseHistoryFn,
} from "@/server/phase2/fns";

export const Route = createFileRoute("/portal/purchases")({
  head: () => ({
    meta: [
      { title: "Purchase history — Automotive Brands Trade Portal" },
      {
        name: "description",
        content: "View previous purchases and reorder from your trade catalogue.",
      },
    ],
  }),
  component: PortalPurchasesPage,
});

type HistoryData = Extract<
  Awaited<ReturnType<typeof listPortalPurchaseHistoryFn>>,
  { ok: true }
>["data"];
type HistoryItem = HistoryData["items"][number];
type InsightData = Extract<
  Awaited<ReturnType<typeof getPortalPurchaseProductInsightFn>>,
  { ok: true }
>["data"];

type Sort =
  | "RECENT"
  | "MOST_PURCHASED"
  | "MOST_FREQUENT"
  | "HIGHEST_SPEND"
  | "NAME_AZ"
  | "NAME_ZA";
type Purchased =
  | "ANY"
  | "LAST_30"
  | "LAST_90"
  | "LAST_180"
  | "LAST_365"
  | "CUSTOM";
type Availability =
  | "ALL"
  | "AVAILABLE"
  | "LOW_STOCK"
  | "BACKORDER"
  | "HISTORIC_ONLY";
type Quick = "FREQUENT" | "RECENT" | "AVAILABLE_NOW" | "HISTORIC_ONLY" | null;

function gbp(v: string | number) {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return `£${v}`;
  return new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(n);
}

function ActionButton({ item }: { item: HistoryItem | InsightData }) {
  if (item.action === "BUY_AGAIN" && item.canBuyAgain) {
    return (
      <Link
        to="/products/$sku"
        params={{ sku: item.sku }}
        className="inline-flex h-9 items-center rounded-md bg-primary px-3 text-[11px] font-bold uppercase text-primary-foreground"
      >
        Buy again
      </Link>
    );
  }
  if (item.action === "VIEW_PRODUCT" && item.productSlug) {
    return (
      <Link
        to="/products/$sku"
        params={{ sku: item.sku }}
        className="inline-flex h-9 items-center rounded-md border border-border px-3 text-[11px] font-bold uppercase"
      >
        View product
      </Link>
    );
  }
  return <StatusBadge tone="neutral">Historic product</StatusBadge>;
}

function AvailabilityCell({
  band,
  label,
}: {
  band: string;
  label: string;
}) {
  if (band === "historic") {
    return <StatusBadge tone="neutral">{label}</StatusBadge>;
  }
  return <AvailabilityBadge availability={band as PublicAvailability} />;
}

function PortalPurchasesPage() {
  const [data, setData] = useState<HistoryData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [qInput, setQInput] = useState("");
  const [q, setQ] = useState("");
  const [brandId, setBrandId] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [purchased, setPurchased] = useState<Purchased>("ANY");
  const [purchasedFrom, setPurchasedFrom] = useState("");
  const [purchasedTo, setPurchasedTo] = useState("");
  const [availability, setAvailability] = useState<Availability>("ALL");
  const [sort, setSort] = useState<Sort>("RECENT");
  const [quick, setQuick] = useState<Quick>(null);
  const [page, setPage] = useState(1);
  const [filtersOpen, setFiltersOpen] = useState(false);

  const [expandedSku, setExpandedSku] = useState<string | null>(null);
  const [insight, setInsight] = useState<InsightData | null>(null);
  const [insightLoading, setInsightLoading] = useState(false);
  const [chartMetric, setChartMetric] = useState<"units" | "spend">("units");

  useEffect(() => {
    const t = window.setTimeout(() => {
      setQ(qInput.trim());
      setPage(1);
    }, 250);
    return () => window.clearTimeout(t);
  }, [qInput]);

  useEffect(() => {
    void (async () => {
      setLoading(true);
      const r = await listPortalPurchaseHistoryFn({
        data: {
          q: q || undefined,
          brandId: brandId || null,
          categoryId: categoryId || null,
          purchased,
          purchasedFrom: purchased === "CUSTOM" ? purchasedFrom || null : null,
          purchasedTo: purchased === "CUSTOM" ? purchasedTo || null : null,
          availability,
          sort,
          quick,
          page,
          pageSize: 25,
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
    q,
    brandId,
    categoryId,
    purchased,
    purchasedFrom,
    purchasedTo,
    availability,
    sort,
    quick,
    page,
  ]);

  useEffect(() => {
    if (!expandedSku) {
      setInsight(null);
      return;
    }
    void (async () => {
      setInsightLoading(true);
      const r = await getPortalPurchaseProductInsightFn({ data: { sku: expandedSku } });
      if (r.ok) setInsight(r.data);
      else setInsight(null);
      setInsightLoading(false);
    })();
  }, [expandedSku]);

  const totalPages = useMemo(() => {
    if (!data) return 1;
    return Math.max(1, Math.ceil(data.total / data.pageSize));
  }, [data]);

  function toggleQuick(next: Exclude<Quick, null>) {
    setQuick((prev) => (prev === next ? null : next));
    setPage(1);
  }

  function toggleExpand(sku: string) {
    setExpandedSku((prev) => (prev === sku ? null : sku));
  }

  const chartData =
    insight?.monthly.map((m) => ({
      label: m.label,
      units: m.units,
      spend: Number(m.spend),
    })) ?? [];

  return (
    <div>
      <PanelHeader
        title="Purchase history"
        sub="View your previous purchases and quickly reorder products from your current trade catalogue."
      />

      {data?.note ? (
        <p className="border-b border-border px-4 py-2 text-[12px] text-steel sm:px-6">{data.note}</p>
      ) : null}

      {/* Summary */}
      {data?.summary ? (
        <div className="grid grid-cols-2 gap-3 border-b border-border p-4 sm:grid-cols-4 sm:p-6">
          {[
            { label: "Products purchased", value: String(data.summary.productsPurchased) },
            {
              label: "Purchase transactions",
              value: String(data.summary.purchaseTransactions),
            },
            { label: "Historic net spend", value: gbp(data.summary.historicNetSpend) },
            { label: "Units purchased", value: String(data.summary.unitsPurchased) },
          ].map((card) => (
            <div key={card.label} className="rounded-md border border-border/70 bg-surface/30 px-3 py-3">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-steel">{card.label}</p>
              <p className="mt-1 font-display text-lg font-semibold tabular-nums">{card.value}</p>
            </div>
          ))}
        </div>
      ) : null}

      {/* Filters */}
      <div className="border-b border-border p-4 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-steel">Filters</p>
          <button
            type="button"
            className="h-8 rounded-md border border-border px-3 text-[11px] font-bold uppercase sm:hidden"
            onClick={() => setFiltersOpen((v) => !v)}
          >
            {filtersOpen ? "Hide filters" : "Show filters"}
          </button>
        </div>

        <div className={`mt-3 space-y-3 ${filtersOpen ? "block" : "hidden sm:block"}`}>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
            <label className="text-[12px] xl:col-span-2">
              Search
              <input
                className="mt-1 block h-10 w-full rounded-md border border-border px-3 text-[13px]"
                value={qInput}
                onChange={(e) => setQInput(e.target.value)}
                placeholder="Search product or SKU"
              />
            </label>
            <label className="text-[12px]">
              Brand
              <select
                className="mt-1 block h-10 w-full rounded-md border border-border px-3 text-[13px]"
                value={brandId}
                onChange={(e) => {
                  setBrandId(e.target.value);
                  setPage(1);
                }}
              >
                <option value="">All brands</option>
                {(data?.filterOptions.brands ?? []).map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-[12px]">
              Category
              <select
                className="mt-1 block h-10 w-full rounded-md border border-border px-3 text-[13px]"
                value={categoryId}
                onChange={(e) => {
                  setCategoryId(e.target.value);
                  setPage(1);
                }}
              >
                <option value="">All categories</option>
                {(data?.filterOptions.categories ?? []).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-[12px]">
              Purchased
              <select
                className="mt-1 block h-10 w-full rounded-md border border-border px-3 text-[13px]"
                value={purchased}
                onChange={(e) => {
                  setPurchased(e.target.value as Purchased);
                  setPage(1);
                }}
              >
                <option value="ANY">Any time</option>
                <option value="LAST_30">Last 30 days</option>
                <option value="LAST_90">Last 3 months</option>
                <option value="LAST_180">Last 6 months</option>
                <option value="LAST_365">Last 12 months</option>
                <option value="CUSTOM">Custom range</option>
              </select>
            </label>
            <label className="text-[12px]">
              Availability
              <select
                className="mt-1 block h-10 w-full rounded-md border border-border px-3 text-[13px]"
                value={availability}
                onChange={(e) => {
                  setAvailability(e.target.value as Availability);
                  setPage(1);
                }}
              >
                <option value="ALL">All</option>
                <option value="AVAILABLE">Available to order</option>
                <option value="LOW_STOCK">Low stock</option>
                <option value="BACKORDER">Available to backorder</option>
                <option value="HISTORIC_ONLY">Historic only / no longer available</option>
              </select>
            </label>
            <label className="text-[12px]">
              Sort by
              <select
                className="mt-1 block h-10 w-full rounded-md border border-border px-3 text-[13px]"
                value={sort}
                onChange={(e) => {
                  setSort(e.target.value as Sort);
                  setPage(1);
                }}
              >
                <option value="RECENT">Most recently purchased</option>
                <option value="MOST_PURCHASED">Most purchased</option>
                <option value="MOST_FREQUENT">Most frequently purchased</option>
                <option value="HIGHEST_SPEND">Highest historic spend</option>
                <option value="NAME_AZ">Product A–Z</option>
                <option value="NAME_ZA">Product Z–A</option>
              </select>
            </label>
          </div>

          {purchased === "CUSTOM" ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="text-[12px]">
                From
                <input
                  type="date"
                  className="mt-1 block h-10 w-full rounded-md border border-border px-3 text-[13px]"
                  value={purchasedFrom}
                  onChange={(e) => {
                    setPurchasedFrom(e.target.value);
                    setPage(1);
                  }}
                />
              </label>
              <label className="text-[12px]">
                To
                <input
                  type="date"
                  className="mt-1 block h-10 w-full rounded-md border border-border px-3 text-[13px]"
                  value={purchasedTo}
                  onChange={(e) => {
                    setPurchasedTo(e.target.value);
                    setPage(1);
                  }}
                />
              </label>
            </div>
          ) : null}

          <div className="flex flex-wrap gap-2">
            {(
              [
                ["FREQUENT", "Frequently purchased"],
                ["RECENT", "Bought recently"],
                ["AVAILABLE_NOW", "Available now"],
                ["HISTORIC_ONLY", "Historic only"],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => toggleQuick(key)}
                className={`h-8 rounded-md border px-3 text-[11px] font-bold uppercase ${
                  quick === key
                    ? "border-primary bg-primary/15 text-primary"
                    : "border-border text-steel"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {loading ? (
        <p className="p-6 text-[13px] text-steel">Loading purchase history…</p>
      ) : error ? (
        <p className="p-6 text-[13px] text-bad">{error}</p>
      ) : !data ||
        (data.total === 0 &&
          purchased === "ANY" &&
          !q &&
          !brandId &&
          !categoryId &&
          availability === "ALL" &&
          !quick) ? (
        <div className="p-6">
          <p className="text-[14px] text-steel">
            No purchase history is available for this account yet.
          </p>
          <Link
            to={ROUTES.products}
            className="mt-4 inline-block text-[13px] font-semibold text-primary"
          >
            Shop products
          </Link>
        </div>
      ) : data.items.length === 0 ? (
        <p className="p-6 text-[14px] text-steel">
          {purchased !== "ANY"
            ? "No purchases found for this period."
            : "No purchases match these filters."}
        </p>
      ) : (
        <>
          {/* Desktop table */}
          <div className="hidden overflow-x-auto p-4 md:block sm:p-6">
            <table className="w-full text-left text-[13px]">
              <thead>
                <tr className="border-b-2 border-foreground text-[11px] uppercase tracking-wide text-steel">
                  <th className="py-2 pr-3">Product</th>
                  <th className="py-2 pr-3">Last purchased</th>
                  <th className="py-2 pr-3 text-right">Purchases</th>
                  <th className="py-2 pr-3 text-right">Qty purchased</th>
                  <th className="py-2 pr-3 text-right">Historic spend</th>
                  <th className="py-2 pr-3">Availability</th>
                  <th className="py-2 text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((item) => (
                  <Fragment key={item.sku}>
                    <tr
                      className="cursor-pointer border-b border-border/60 hover:bg-surface/40"
                      onClick={() => toggleExpand(item.sku)}
                    >
                      <td className="py-3 pr-3">
                        <div className="font-medium">{item.name}</div>
                        <div className="font-mono text-[11px] text-steel">{item.sku}</div>
                      </td>
                      <td className="py-3 pr-3 text-steel">
                        {item.lastPurchasedDate
                          ? formatQuoteDateOnlyUk(item.lastPurchasedDate)
                          : "—"}
                      </td>
                      <td className="py-3 pr-3 text-right tabular-nums">{item.purchaseCount}</td>
                      <td className="py-3 pr-3 text-right tabular-nums">{item.netUnits}</td>
                      <td className="py-3 pr-3 text-right tabular-nums">{gbp(item.netSpend)}</td>
                      <td className="py-3 pr-3">
                        <AvailabilityCell
                          band={item.availabilityBand}
                          label={item.availabilityLabel}
                        />
                      </td>
                      <td className="py-3 text-right" onClick={(e) => e.stopPropagation()}>
                        <ActionButton item={item} />
                      </td>
                    </tr>
                    {expandedSku === item.sku ? (
                      <tr className="border-b border-border/60 bg-surface/20">
                        <td colSpan={7} className="p-4">
                          <InsightPanel
                            loading={insightLoading}
                            insight={insight}
                            chartMetric={chartMetric}
                            setChartMetric={setChartMetric}
                            chartData={chartData}
                          />
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile cards */}
          <div className="space-y-3 p-4 md:hidden">
            {data.items.map((item) => (
              <article
                key={item.sku}
                className="rounded-md border border-border p-3"
              >
                <button
                  type="button"
                  className="w-full text-left"
                  onClick={() => toggleExpand(item.sku)}
                >
                  <p className="font-medium">{item.name}</p>
                  <p className="font-mono text-[11px] text-steel">{item.sku}</p>
                </button>
                <dl className="mt-3 grid grid-cols-2 gap-2 text-[12px]">
                  <div>
                    <dt className="text-steel">Last purchased</dt>
                    <dd>
                      {item.lastPurchasedDate
                        ? formatQuoteDateOnlyUk(item.lastPurchasedDate)
                        : "—"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-steel">Purchases</dt>
                    <dd className="tabular-nums">{item.purchaseCount}</dd>
                  </div>
                  <div>
                    <dt className="text-steel">Quantity</dt>
                    <dd className="tabular-nums">{item.netUnits}</dd>
                  </div>
                  <div>
                    <dt className="text-steel">Historic spend</dt>
                    <dd className="tabular-nums">{gbp(item.netSpend)}</dd>
                  </div>
                </dl>
                <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                  <AvailabilityCell
                    band={item.availabilityBand}
                    label={item.availabilityLabel}
                  />
                  <ActionButton item={item} />
                </div>
                {expandedSku === item.sku ? (
                  <div className="mt-3 border-t border-border pt-3">
                    <InsightPanel
                      loading={insightLoading}
                      insight={insight}
                      chartMetric={chartMetric}
                      setChartMetric={setChartMetric}
                      chartData={chartData}
                    />
                  </div>
                ) : null}
              </article>
            ))}
          </div>

          <div className="flex items-center justify-between gap-3 border-t border-border px-4 py-4 sm:px-6">
            <p className="text-[12px] text-steel">
              Page {data.page} of {totalPages} · {data.total} products
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                className="h-9 rounded-md border border-border px-3 text-[11px] font-bold uppercase disabled:opacity-40"
              >
                Previous
              </button>
              <button
                type="button"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => p + 1)}
                className="h-9 rounded-md border border-border px-3 text-[11px] font-bold uppercase disabled:opacity-40"
              >
                Next
              </button>
            </div>
          </div>

          <p className="px-4 pb-6 text-[12px] text-steel sm:px-6">
            Buy again uses current catalogue pricing, case quantities, stock and delivery rules —
            not historic prices.
          </p>
        </>
      )}
    </div>
  );
}

function InsightPanel({
  loading,
  insight,
  chartMetric,
  setChartMetric,
  chartData,
}: {
  loading: boolean;
  insight: InsightData | null;
  chartMetric: "units" | "spend";
  setChartMetric: (m: "units" | "spend") => void;
  chartData: Array<{ label: string; units: number; spend: number }>;
}) {
  if (loading) return <p className="text-[12px] text-steel">Loading product history…</p>;
  if (!insight) return <p className="text-[12px] text-bad">Unable to load product history.</p>;

  const m = insight.metrics;
  const cmp = m.comparison12Months;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-steel">
            Purchase insight
          </p>
          <p className="mt-0.5 font-medium">{insight.name}</p>
          <p className="font-mono text-[11px] text-steel">{insight.sku}</p>
        </div>
        <ActionButton item={insight} />
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[
          { label: "Purchase count", value: String(m.purchaseCount) },
          { label: "Net units", value: String(m.totalNetUnits) },
          { label: "Historic spend", value: gbp(m.historicNetSpend) },
          {
            label: "Avg qty / purchase",
            value: m.averageQuantityPerPurchase != null ? String(m.averageQuantityPerPurchase) : "—",
          },
          {
            label: "First known purchase",
            value: m.firstKnownPurchase ? formatQuoteDateOnlyUk(m.firstKnownPurchase) : "—",
          },
          {
            label: "Last purchased",
            value: m.lastPurchased ? formatQuoteDateOnlyUk(m.lastPurchased) : "—",
          },
          {
            label: "Avg days between purchases",
            value:
              m.averageDaysBetweenPurchases != null
                ? `${m.averageDaysBetweenPurchases} days`
                : "—",
          },
          {
            label: "Last 12 months units",
            value: String(m.last12Months.units),
          },
        ].map((row) => (
          <div key={row.label} className="rounded border border-border/60 px-2 py-2">
            <p className="text-[10px] uppercase text-steel">{row.label}</p>
            <p className="mt-0.5 text-[13px] font-semibold tabular-nums">{row.value}</p>
          </div>
        ))}
      </div>

      {cmp ? (
        <p className="text-[12px] text-steel">
          {cmp.direction === "NEW"
            ? cmp.label
            : cmp.unitsChangePct != null
              ? `Units purchased ${cmp.unitsChangePct > 0 ? "+" : ""}${cmp.unitsChangePct}% vs previous 12 months.`
              : cmp.label}
        </p>
      ) : null}

      {!insight.hasDatedHistory || insight.undatedNote ? (
        <p className="text-[12px] text-steel">
          {insight.undatedNote ??
            "Not enough dated purchase history is available for this product."}
        </p>
      ) : (
        <div>
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-steel">
              Monthly trend
            </p>
            <div className="flex gap-1">
              <button
                type="button"
                className={`h-7 rounded border px-2 text-[10px] font-bold uppercase ${
                  chartMetric === "units" ? "border-primary text-primary" : "border-border"
                }`}
                onClick={() => setChartMetric("units")}
              >
                Units
              </button>
              <button
                type="button"
                className={`h-7 rounded border px-2 text-[10px] font-bold uppercase ${
                  chartMetric === "spend" ? "border-primary text-primary" : "border-border"
                }`}
                onClick={() => setChartMetric("spend")}
              >
                Spend
              </button>
            </div>
          </div>
          <div className="h-56 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="label" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} />
                <Tooltip
                  formatter={(value: number) =>
                    chartMetric === "spend" ? gbp(value) : String(value)
                  }
                />
                <Bar
                  dataKey={chartMetric}
                  fill="hsl(var(--primary))"
                  radius={[2, 2, 0, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </div>
  );
}
