import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Metric, PanelHeader } from "@/components/ab/AppShell";
import { Field, inputClass } from "@/components/ab/Drawer";
import {
  EmptyState,
  ErrorState,
  ForecastConfidenceBadge,
  ForecastCoverageBanner,
  FreshnessBanner,
  LoadingState,
  PurchasingStatusBadge,
  SkuLink,
  coverLabel,
  gbp,
  incomingNote,
  INCOMING_SOURCE_HINT,
  btnClass,
  primaryBtnClass,
  qty,
  rate,
} from "@/components/purchasing/workspace";
import { ROUTES } from "@/lib/app-nav";
import {
  getPurchasingDashboardFn,
  updatePurchasingSettingsFn,
} from "@/server/phase2/fns";

export const Route = createFileRoute("/purchasing/")({
  head: () => ({
    meta: [
      { title: "Purchasing — Automotive Brands" },
      {
        name: "description",
        content: "Decision support for what to order, what is incoming, and where cash is tied up in stock.",
      },
    ],
  }),
  component: PurchasingDashboardPage,
});

type Data = Extract<Awaited<ReturnType<typeof getPurchasingDashboardFn>>, { ok: true }>["data"];
type Row = Data["orderNow"][number];

function PurchasingDashboardPage() {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function load() {
    void getPurchasingDashboardFn().then((result) => {
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
  }, []);

  async function saveSettings(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!data?.canManage) return;
    const form = new FormData(event.currentTarget);
    setSaving(true);
    const verifiedRaw = String(form.get("verifiedSalesHistoryFrom") ?? "").trim();
    const result = await updatePurchasingSettingsFn({
      data: {
        defaultTargetCoverWeeks: Number(form.get("defaultTargetCoverWeeks")),
        defaultSafetyStockQty: Number(form.get("defaultSafetyStockQty")),
        criticalCoverWeeks: Number(form.get("criticalCoverWeeks")),
        watchCoverWeeks: Number(form.get("watchCoverWeeks")),
        overstockCoverWeeks: Number(form.get("overstockCoverWeeks")),
        verifiedSalesHistoryFrom: verifiedRaw || null,
      },
    });
    setSaving(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    load();
  }

  async function clearVerification() {
    if (!data?.canManage) return;
    setSaving(true);
    const result = await updatePurchasingSettingsFn({
      data: {
        defaultTargetCoverWeeks: data.settings.defaultTargetCoverWeeks,
        defaultSafetyStockQty: data.settings.defaultSafetyStockQty,
        criticalCoverWeeks: data.settings.criticalCoverWeeks,
        watchCoverWeeks: data.settings.watchCoverWeeks,
        overstockCoverWeeks: data.settings.overstockCoverWeeks,
        verifiedSalesHistoryFrom: null,
      },
    });
    setSaving(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    load();
  }

  return (
    <>
      <PanelHeader
        title="Purchasing"
        sub="Decision support only — this module never creates Autopart purchase orders."
        crumbs={[{ label: "Purchasing" }, { label: "Dashboard" }]}
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
      {!data && !error ? <LoadingState /> : null}
      {data ? (
        <div className="grid gap-6 px-4 py-5 sm:px-6">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
            <Metric label="SKUs needing order" value={qty(data.metrics.needingOrder)} tone="warn" />
            <Metric label="Critical" value={qty(data.metrics.critical)} tone="warn" />
            <Metric label="Covered by incoming" value={qty(data.metrics.incomingCovers)} />
            <Metric label="On watch" value={qty(data.metrics.watch)} />
            <Metric label="Overstock SKUs" value={qty(data.metrics.overstock)} />
            <Metric
              label="Suggested purchase value"
              value={gbp(data.metrics.suggestedPurchaseValue)}
              hint={
                data.metrics.suggestedValueMissingCost
                  ? `${data.metrics.suggestedValueMissingCost} SKUs excluded — Latest Cost unavailable (not treated as £0)`
                  : "Suggested qty × Latest Cost. Missing cost is excluded, not £0."
              }
            />
          </div>

          {data.forecastCoverage ? (
            <p className="text-[12px] text-steel">
              Unverified {qty(data.forecastCoverage.counts.UNVERIFIED)} · Strong{" "}
              {qty(data.forecastCoverage.counts.STRONG)} · Good {qty(data.forecastCoverage.counts.GOOD)} · Building{" "}
              {qty(data.forecastCoverage.counts.BUILDING)} · Low {qty(data.forecastCoverage.counts.LOW)} · Very Low{" "}
              {qty(data.forecastCoverage.counts.VERY_LOW)} SKUs
            </p>
          ) : null}

          <PriorityTable
            title="Order now"
            empty="No SKUs currently below reorder after incoming."
            rows={data.orderNow}
          />
          <PriorityTable title="Running low" empty="Nothing approaching reorder." rows={data.runningLow} />
          <PriorityTable
            title="Incoming stock"
            empty="No low-stock SKUs whose on-order quantity already covers the forecast."
            rows={data.incomingStock}
            incomingEmphasis
          />
          <PriorityTable
            title="Demand increasing"
            empty="No material upward trends (small unit moves are ignored)."
            rows={data.demandIncreasing}
          />
          <PriorityTable title="Overstock" empty="No SKUs above the overstock cover threshold." rows={data.overstock} />
          <PriorityTable
            title="No recent sales"
            empty="No stocked SKUs without meaningful recent demand."
            rows={data.noRecentSales}
          />
          {data.unusualDemand.length ? (
            <section className="grid gap-3">
              <h2 className="font-display text-lg font-semibold uppercase">Unusual demand</h2>
              <p className="text-[12px] text-steel">
                Last 7 days materially above the 90-day weekly rate. This does not automatically become the purchase
                forecast.
              </p>
              <div className="overflow-x-auto border border-border">
                <table className="w-full min-w-[720px] text-left text-[13px]">
                  <thead className="bg-secondary/40 text-[10px] font-semibold uppercase tracking-[0.12em] text-steel">
                    <tr>
                      <th className="px-3 py-2">Product</th>
                      <th className="px-3 py-2">7d units</th>
                      <th className="px-3 py-2">Normal weekly</th>
                      <th className="px-3 py-2">Vs normal</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.unusualDemand.map((row) => (
                      <tr key={row.sku} className="border-t border-border/70">
                        <td className="px-3 py-2">
                          <SkuLink sku={row.sku} name={row.name} />
                        </td>
                        <td className="px-3 py-2">{qty(row.unusual.last7Units)}</td>
                        <td className="px-3 py-2">{rate(row.unusual.normalWeekly)}</td>
                        <td className="px-3 py-2">
                          {row.unusual.pctAbove == null ? "—" : `+${Math.round(row.unusual.pctAbove * 100)}%`}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ) : null}

          {data.canManage ? (
            <form onSubmit={saveSettings} className="grid gap-4 border border-border p-4">
              <h2 className="font-display text-lg font-semibold uppercase">Purchasing defaults</h2>
              <p className="text-[12px] text-steel">
                Conservative system defaults. SKU-level values override these when set. Null SKU settings mean not
                configured — forecasts still run on demand and cover.
              </p>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                <Field label="Default target cover (weeks)" htmlFor="defaultTargetCoverWeeks">
                  <input
                    id="defaultTargetCoverWeeks"
                    name="defaultTargetCoverWeeks"
                    className={inputClass}
                    type="number"
                    step="0.5"
                    min={1}
                    defaultValue={data.settings.defaultTargetCoverWeeks}
                    required
                  />
                </Field>
                <Field label="Default safety stock (qty)" htmlFor="defaultSafetyStockQty">
                  <input
                    id="defaultSafetyStockQty"
                    name="defaultSafetyStockQty"
                    className={inputClass}
                    type="number"
                    min={0}
                    defaultValue={data.settings.defaultSafetyStockQty}
                    required
                  />
                </Field>
                <Field label="Critical cover (weeks)" htmlFor="criticalCoverWeeks">
                  <input
                    id="criticalCoverWeeks"
                    name="criticalCoverWeeks"
                    className={inputClass}
                    type="number"
                    step="0.1"
                    min={0.1}
                    defaultValue={data.settings.criticalCoverWeeks}
                    required
                  />
                </Field>
                <Field label="Watch cover (weeks)" htmlFor="watchCoverWeeks">
                  <input
                    id="watchCoverWeeks"
                    name="watchCoverWeeks"
                    className={inputClass}
                    type="number"
                    step="0.1"
                    min={0.1}
                    defaultValue={data.settings.watchCoverWeeks}
                    required
                  />
                </Field>
                <Field label="Overstock cover (weeks)" htmlFor="overstockCoverWeeks">
                  <input
                    id="overstockCoverWeeks"
                    name="overstockCoverWeeks"
                    className={inputClass}
                    type="number"
                    step="0.5"
                    min={1}
                    defaultValue={data.settings.overstockCoverWeeks}
                    required
                  />
                </Field>
              </div>
              <div className="grid gap-2 sm:max-w-md">
                <Field label="Verified sales history from" htmlFor="verifiedSalesHistoryFrom">
                  <input
                    id="verifiedSalesHistoryFrom"
                    name="verifiedSalesHistoryFrom"
                    className={inputClass}
                    type="date"
                    defaultValue={data.settings.verifiedSalesHistoryFrom ?? ""}
                    max={new Date().toISOString().slice(0, 10)}
                  />
                </Field>
                <p className="text-[12px] text-steel">
                  Forecast confidence only treats sales history from this date as complete. Set this to the earliest
                  date from which the imported Autopart sales dataset is known to be reliable and continuous. Do not
                  use the oldest invoice date unless that entire window has been verified.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button type="submit" className={primaryBtnClass} disabled={saving}>
                  {saving ? "Saving…" : "Save defaults"}
                </button>
                <button
                  type="button"
                  className={btnClass}
                  disabled={saving || !data.settings.verifiedSalesHistoryFrom}
                  onClick={() => void clearVerification()}
                >
                  Clear verification
                </button>
              </div>
            </form>
          ) : null}

          <p className="text-[12px] text-steel">
            Incoming is on-order quantity from 231PO3NEW. It is never added to sellable Avail. Arrival dates are not
            invented.{" "}
            <Link className="text-primary underline" to={ROUTES.purchasingForecast}>
              Open stock forecast
            </Link>
          </p>
        </div>
      ) : null}
    </>
  );
}

function PriorityTable({
  title,
  empty,
  rows,
  incomingEmphasis,
}: {
  title: string;
  empty: string;
  rows: Row[];
  incomingEmphasis?: boolean;
}) {
  return (
    <section className="grid gap-3">
      <h2 className="font-display text-lg font-semibold uppercase">{title}</h2>
      {rows.length === 0 ? (
        <EmptyState title={title} body={empty} />
      ) : (
        <div className="overflow-x-auto border border-border">
          <table className="w-full min-w-[880px] text-left text-[13px]">
            <thead className="bg-secondary/40 text-[10px] font-semibold uppercase tracking-[0.12em] text-steel">
              <tr>
                <th className="px-3 py-2">Product</th>
                <th className="px-3 py-2">Avail</th>
                <th className="px-3 py-2" title={INCOMING_SOURCE_HINT}>
                  Incoming
                </th>
                <th className="px-3 py-2">Cover</th>
                <th className="px-3 py-2">Suggested</th>
                <th className="px-3 py-2">Value</th>
                <th className="px-3 py-2">Confidence</th>
                <th className="px-3 py-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.sku} className="border-t border-border/70">
                  <td className="px-3 py-2">
                    <SkuLink sku={row.sku} name={row.name} />
                  </td>
                  <td className="px-3 py-2">{qty(row.availableQty)}</td>
                  <td className="px-3 py-2">
                    {incomingEmphasis ? incomingNote(row.incomingQty) : qty(row.incomingQty)}
                  </td>
                  <td className="px-3 py-2">{coverLabel(row.weeksCover, row.recommendedWeekly)}</td>
                  <td className="px-3 py-2">{qty(row.purchase.suggestedQty)}</td>
                  <td className="px-3 py-2">{gbp(row.suggestedValue)}</td>
                  <td className="px-3 py-2">
                    <ForecastConfidenceBadge
                      confidence={row.forecastConfidence}
                      coverageDays={row.salesHistoryCoverageDays}
                      warning={row.forecastConfidenceWarning}
                      verified={row.salesHistoryVerified}
                    />
                  </td>
                  <td className="px-3 py-2">
                    <PurchasingStatusBadge status={row.status} />
                    {row.status === "OVERSTOCK" && row.forecastConfidenceWarning ? (
                      <div className="mt-1 text-[11px] text-warn">Potential overstock</div>
                    ) : row.forecastConfidenceWarning ? (
                      <div className="mt-1 text-[11px] text-warn">{row.forecastConfidenceWarning}</div>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
