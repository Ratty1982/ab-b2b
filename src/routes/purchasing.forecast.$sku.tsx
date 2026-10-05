import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { PanelHeader } from "@/components/ab/AppShell";
import { Field, inputClass } from "@/components/ab/Drawer";
import {
  ErrorState,
  ForecastConfidenceBadge,
  FreshnessBanner,
  LoadingState,
  PurchasingStatusBadge,
  btnClass,
  coverLabel,
  demandComponentLabel,
  gbp,
  incomingNote,
  INCOMING_SOURCE_HINT,
  primaryBtnClass,
  qty,
  rate,
  trendLabel,
  ukDate,
} from "@/components/purchasing/workspace";
import { formatDate } from "@/lib/datetime";
import { ROUTES } from "@/lib/app-nav";
import {
  getPurchasingSkuFn,
  updatePurchasingPlanFn,
  updateSkuPurchasingSettingsFn,
} from "@/server/phase2/fns";

export const Route = createFileRoute("/purchasing/forecast/$sku")({
  head: ({ params }) => ({
    meta: [
      { title: `${params.sku} — Stock Forecast — Automotive Brands` },
      { name: "description", content: "Purchasing forecast drill-down for a single SKU." },
    ],
  }),
  component: PurchasingSkuPage,
});

type Data = Extract<Awaited<ReturnType<typeof getPurchasingSkuFn>>, { ok: true }>["data"];

function PurchasingSkuPage() {
  const { sku } = Route.useParams();
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function load() {
    void getPurchasingSkuFn({ data: { sku } }).then((result) => {
      if (!result.ok) {
        setError(result.error);
        setData(null);
        return;
      }
      setError(null);
      setData(result.data);
    });
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sku]);

  const forecast = data?.forecast;

  async function saveSkuSettings(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!data?.canManage) return;
    const form = new FormData(event.currentTarget);
    const num = (key: string) => {
      const raw = String(form.get(key) ?? "").trim();
      if (!raw) return null;
      const n = Number(raw);
      return Number.isFinite(n) ? n : null;
    };
    const str = (key: string) => {
      const raw = String(form.get(key) ?? "").trim();
      return raw || null;
    };
    setSaving(true);
    const result = await updateSkuPurchasingSettingsFn({
      data: {
        sku,
        supplierName: str("supplierName"),
        supplierSku: str("supplierSku"),
        leadTimeDays: num("leadTimeDays"),
        minimumOrderQty: num("minimumOrderQty"),
        orderMultiple: num("orderMultiple"),
        safetyStockQty: num("safetyStockQty"),
        targetCoverWeeks: num("targetCoverWeeks"),
      },
    });
    setSaving(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setData(result.data);
  }

  async function savePlan(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!data?.canManage) return;
    const form = new FormData(event.currentTarget);
    const plannedRaw = String(form.get("plannedQty") ?? "").trim();
    setSaving(true);
    const result = await updatePurchasingPlanFn({
      data: {
        sku,
        plannedQty: plannedRaw === "" ? null : Number(plannedRaw),
        note: String(form.get("note") ?? "").trim() || null,
      },
    });
    setSaving(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setData(result.data);
  }

  return (
    <>
      <PanelHeader
        title={forecast?.name ?? sku}
        sub={`SKU ${sku} · purchasing decision support, not an Autopart purchase order`}
        crumbs={[
          { label: "Purchasing", to: ROUTES.purchasing },
          { label: "Stock Forecast", to: ROUTES.purchasingForecast },
          { label: sku },
        ]}
      />
      {data ? (
        <FreshnessBanner
          stockUpdated={data.freshness.stockUpdated}
          salesUpdated={data.freshness.salesUpdated}
          stockStale={data.freshness.stockStale}
        />
      ) : null}
      {error ? <ErrorState message={error} /> : null}
      {!data && !error ? <LoadingState /> : null}
      {forecast ? (
        <div className="grid gap-6 px-4 py-5 sm:px-6">
          <div className="flex flex-wrap items-center gap-3">
            <PurchasingStatusBadge status={forecast.status} />
            <ForecastConfidenceBadge
              confidence={forecast.forecastConfidence}
              coverageDays={forecast.salesHistoryCoverageDays}
              warning={forecast.forecastConfidenceWarning}
              verified={forecast.salesHistoryVerified}
            />
            <span className="text-[13px] text-steel">{forecast.statusReason}</span>
          </div>
          {forecast.forecastConfidenceWarning ? (
            <p className="border border-warn/40 bg-warn/10 px-3 py-2 text-[13px]">{forecast.forecastConfidenceWarning}</p>
          ) : null}

          <section className="grid gap-3">
            <h2 className="font-display text-lg font-semibold uppercase">Forecast confidence</h2>
            <dl className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 text-[13px]">
              <Fact label="Forecast confidence" value={forecast.forecastConfidenceLabel} />
              <Fact
                label="Verified sales history"
                value={
                  forecast.salesHistoryVerified && forecast.salesHistoryFrom && forecast.salesHistoryTo
                    ? `${ukDate(forecast.salesHistoryFrom)} → ${ukDate(forecast.salesHistoryTo)}`
                    : "Not verified"
                }
              />
              <Fact
                label="Verified coverage"
                value={
                  forecast.salesHistoryVerified
                    ? forecast.salesHistoryCoverageDays >= 365
                      ? "365+ days"
                      : `${forecast.salesHistoryCoverageDays} days`
                    : "Coverage not verified"
                }
              />
            </dl>
            <p className="text-[13px] text-steel">{forecast.forecastConfidenceCopy}</p>
          </section>

          <section className="grid gap-3">
            <h2 className="font-display text-lg font-semibold uppercase">Current position</h2>
            <dl className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4 text-[13px]">
              <Fact label="Available (Avail)" value={qty(forecast.availableQty)} />
              <Fact label="Incoming" value={incomingNote(forecast.incomingQty)} title={INCOMING_SOURCE_HINT} />
              <Fact label="Current cover" value={coverLabel(forecast.weeksCover, forecast.recommendedWeekly)} />
              <Fact
                label="Cover incl. incoming"
                value={
                  forecast.projectedCover == null
                    ? "—"
                    : `${forecast.projectedCover.toFixed(1)} wks (includes stock not yet received)`
                }
              />
            </dl>
          </section>

          <section className="grid gap-3">
            <h2 className="font-display text-lg font-semibold uppercase">Demand</h2>
            <dl className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4 text-[13px]">
              <Fact label="Last 7 days" value={qty(forecast.rates.last7.netUnits)} />
              <Fact
                label="Last 30 days"
                value={`${qty(forecast.rates.last30.netUnits)}${
                  forecast.demandComponents.last30 === "unverified"
                    ? " (coverage not verified)"
                    : forecast.demandComponents.last30 === "partial"
                      ? " (partial history)"
                      : ""
                }`}
              />
              <Fact
                label="Last 90 days"
                value={`${qty(forecast.rates.last90.netUnits)}${
                  forecast.demandComponents.last90 === "unverified"
                    ? " (coverage not verified)"
                    : forecast.demandComponents.last90 === "partial"
                      ? " (partial history)"
                      : ""
                }`}
              />
              <Fact
                label="Last 365 days"
                value={`${qty(forecast.rates.last365.netUnits)}${
                  forecast.demandComponents.last365 === "unverified"
                    ? " (coverage not verified)"
                    : forecast.demandComponents.last365 === "partial"
                      ? " (partial history)"
                      : ""
                }`}
              />
            </dl>
            <div className="overflow-x-auto border border-border">
              <table className="w-full text-left text-[13px]">
                <thead className="bg-secondary/40 text-[10px] font-semibold uppercase tracking-[0.12em] text-steel">
                  <tr>
                    <th className="px-3 py-2">Component</th>
                    <th className="px-3 py-2">Rate</th>
                    <th className="px-3 py-2">Coverage</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-t border-border/70">
                    <td className="px-3 py-2">30-day rate</td>
                    <td className="px-3 py-2">{rate(forecast.rates.last30.weeklyRate)}</td>
                    <td className="px-3 py-2">{demandComponentLabel(forecast.demandComponents.last30)}</td>
                  </tr>
                  <tr className="border-t border-border/70">
                    <td className="px-3 py-2">90-day rate</td>
                    <td className="px-3 py-2">{rate(forecast.rates.last90.weeklyRate)}</td>
                    <td className="px-3 py-2">{demandComponentLabel(forecast.demandComponents.last90)}</td>
                  </tr>
                  <tr className="border-t border-border/70">
                    <td className="px-3 py-2">365-day rate</td>
                    <td className="px-3 py-2">{rate(forecast.rates.last365.weeklyRate)}</td>
                    <td className="px-3 py-2">{demandComponentLabel(forecast.demandComponents.last365)}</td>
                  </tr>
                  <tr className="border-t border-border/70">
                    <td className="px-3 py-2">Last year comparison</td>
                    <td className="px-3 py-2">{rate(forecast.rates.samePeriodLastYear?.weeklyRate ?? null)}</td>
                    <td className="px-3 py-2">
                      {forecast.demandComponents.seasonalAvailable
                        ? "Available"
                        : forecast.salesHistoryVerified
                          ? "Not yet available"
                          : "Coverage not verified"}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            <dl className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4 text-[13px]">
              <Fact label="Recommended demand" value={rate(forecast.recommendedWeekly)} />
              <Fact label="Trend" value={trendLabel(forecast.trend)} />
            </dl>
            <p className="text-[13px] text-steel">{forecast.demandReason} Based on available periods only.</p>
            <ul className="grid gap-1 text-[13px] text-steel">
              {forecast.demandBasis.map((part) => (
                <li key={part.label}>
                  {part.label}: {rate(part.weeklyRate)}
                  {part.weight ? ` · weight ${Math.round(part.weight * 100)}%` : ""}
                </li>
              ))}
            </ul>
            {forecast.unusual.unusual ? (
              <p className="border border-warn/40 bg-warn/10 px-3 py-2 text-[13px]">
                Unusual demand: {forecast.unusual.reason} The recommended rate is damped and is not set equal to the
                spike.
              </p>
            ) : null}
          </section>

          <section className="grid gap-3">
            <h2 className="font-display text-lg font-semibold uppercase">Weekly net units (12 months)</h2>
            <div className="h-64 border border-border bg-surface/40 p-2">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.chart}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis
                    dataKey="weekStart"
                    tickFormatter={(value: string) => formatDate(value) ?? value}
                    minTickGap={24}
                  />
                  <YAxis />
                  <Tooltip
                    labelFormatter={(value) => formatDate(String(value)) ?? String(value)}
                    formatter={(value) => [Number(value).toLocaleString("en-GB"), "Net units"]}
                  />
                  <ReferenceLine y={0} />
                  <Bar dataKey="units" fill="currentColor" className="text-primary" />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <p className="text-[12px] text-steel">Credits can produce negative net weeks. That is correct.</p>
          </section>

          <section className="grid gap-3">
            <h2 className="font-display text-lg font-semibold uppercase">Forecast</h2>
            <dl className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 text-[13px]">
              <Fact label="Estimated current-stock runout" value={ukDate(forecast.estimatedStockoutDate)} />
              <Fact
                label="Supplier lead time"
                value={forecast.purchasing.leadTimeDays == null ? "Not configured" : `${forecast.purchasing.leadTimeDays} days`}
              />
              <Fact
                label="Demand during lead time"
                value={forecast.leadTimeDemand == null ? "Lead time not set" : qty(forecast.leadTimeDemand)}
              />
              <Fact label="Safety stock" value={qty(forecast.safetyStockQty)} />
              <Fact label="Incoming" value={incomingNote(forecast.incomingQty)} title={INCOMING_SOURCE_HINT} />
              <Fact label="Arrival" value="Not available" />
            </dl>
          </section>

          <section className="grid gap-3">
            <h2 className="font-display text-lg font-semibold uppercase">Purchase recommendation</h2>
            <dl className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 text-[13px]">
              <Fact label="Target cover" value={`${forecast.targetCoverWeeks} weeks`} />
              <Fact label="Forecast target" value={qty(forecast.purchase.targetStock)} />
              <Fact label="Current available" value={`−${qty(forecast.availableQty)}`} />
              <Fact label="Incoming" value={`−${qty(forecast.incomingQty)}`} title={INCOMING_SOURCE_HINT} />
              <Fact label="Raw additional requirement" value={qty(forecast.purchase.rawRequirement)} />
              <Fact label="After MOQ" value={qty(forecast.purchase.afterMoq)} />
              <Fact label="Suggested additional purchase" value={qty(forecast.purchase.suggestedQty)} />
              <Fact label="Estimated value" value={gbp(forecast.suggestedValue)} />
              <Fact label="Latest cost" value={gbp(forecast.latestCost)} />
            </dl>
            <ul className="grid gap-1 text-[13px] text-steel">
              {forecast.purchase.explanation.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ul>
            <div className="border border-border bg-secondary/30 px-4 py-3">
              <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-steel">Why?</div>
              <p className="mt-1 text-[14px]">{forecast.why}</p>
            </div>
          </section>

          {data.sources.length ? (
            <section className="grid gap-3">
              <h2 className="font-display text-lg font-semibold uppercase">Demand sources (last 90 days)</h2>
              <div className="overflow-x-auto border border-border">
                <table className="w-full text-left text-[13px]">
                  <thead className="bg-secondary/40 text-[10px] font-semibold uppercase tracking-[0.12em] text-steel">
                    <tr>
                      <th className="px-3 py-2">Customer / account</th>
                      <th className="px-3 py-2">Net units</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.sources.map((source) => (
                      <tr key={source.name} className="border-t border-border/70">
                        <td className="px-3 py-2">{source.name}</td>
                        <td className="px-3 py-2">{qty(source.units)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ) : null}

          {data.canManage ? (
            <>
              <form onSubmit={saveSkuSettings} className="grid gap-4 border border-border p-4">
                <h2 className="font-display text-lg font-semibold uppercase">SKU purchasing settings</h2>
                <p className="text-[12px] text-steel">
                  Leave blank for not configured. Incomplete settings still produce demand and cover figures.
                </p>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <Field label="Supplier name" htmlFor="supplierName">
                    <input
                      id="supplierName"
                      name="supplierName"
                      className={inputClass}
                      defaultValue={forecast.purchasing.supplierName ?? ""}
                    />
                  </Field>
                  <Field label="Supplier SKU" htmlFor="supplierSku">
                    <input
                      id="supplierSku"
                      name="supplierSku"
                      className={inputClass}
                      defaultValue={forecast.purchasing.supplierSku ?? ""}
                    />
                  </Field>
                  <Field label="Lead time (days)" htmlFor="leadTimeDays">
                    <input
                      id="leadTimeDays"
                      name="leadTimeDays"
                      className={inputClass}
                      type="number"
                      min={0}
                      defaultValue={forecast.purchasing.leadTimeDays ?? ""}
                    />
                  </Field>
                  <Field label="Minimum order qty" htmlFor="minimumOrderQty">
                    <input
                      id="minimumOrderQty"
                      name="minimumOrderQty"
                      className={inputClass}
                      type="number"
                      min={0}
                      defaultValue={forecast.purchasing.minimumOrderQty ?? ""}
                    />
                  </Field>
                  <Field label="Order multiple" htmlFor="orderMultiple">
                    <input
                      id="orderMultiple"
                      name="orderMultiple"
                      className={inputClass}
                      type="number"
                      min={0}
                      defaultValue={forecast.purchasing.orderMultiple ?? ""}
                    />
                  </Field>
                  <Field label="Safety stock qty" htmlFor="safetyStockQty">
                    <input
                      id="safetyStockQty"
                      name="safetyStockQty"
                      className={inputClass}
                      type="number"
                      min={0}
                      defaultValue={forecast.purchasing.safetyStockQty ?? ""}
                    />
                  </Field>
                  <Field label="Target cover weeks" htmlFor="targetCoverWeeks">
                    <input
                      id="targetCoverWeeks"
                      name="targetCoverWeeks"
                      className={inputClass}
                      type="number"
                      min={0}
                      step="0.5"
                      defaultValue={forecast.purchasing.targetCoverWeeks ?? ""}
                    />
                  </Field>
                </div>
                <button type="submit" className={primaryBtnClass} disabled={saving}>
                  {saving ? "Saving…" : "Save SKU settings"}
                </button>
              </form>

              <form onSubmit={savePlan} className="grid gap-4 border border-border p-4">
                <h2 className="font-display text-lg font-semibold uppercase">Planning override</h2>
                <p className="text-[12px] text-steel">
                  Planned qty is Automotive Brands planning data only. It is not written to Autopart and does not
                  change Incoming.
                </p>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Planned order qty" htmlFor="plannedQty">
                    <input
                      id="plannedQty"
                      name="plannedQty"
                      className={inputClass}
                      type="number"
                      min={0}
                      defaultValue={forecast.plannedQty ?? ""}
                    />
                  </Field>
                  <Field label="Purchasing note" htmlFor="note">
                    <input id="note" name="note" className={inputClass} defaultValue={forecast.note ?? ""} />
                  </Field>
                </div>
                <button type="submit" className={btnClass} disabled={saving}>
                  Save plan
                </button>
              </form>
            </>
          ) : null}
        </div>
      ) : null}
    </>
  );
}

function Fact({ label, value, title }: { label: string; value: string; title?: string }) {
  return (
    <div className="border border-border bg-surface/50 px-3 py-2" title={title}>
      <dt className="text-[10px] font-semibold uppercase tracking-[0.14em] text-steel">{label}</dt>
      <dd className="mt-1">{value}</dd>
    </div>
  );
}
