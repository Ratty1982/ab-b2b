import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { PanelHeader } from "@/components/ab/AppShell";
import { StatusBadge, type Tone } from "@/components/ab/Badges";
import {
  EmptyState,
  ErrorState,
  LoadingState,
  Pager,
  btnClass,
  controlClass,
  primaryBtnClass,
  qty,
  rate,
  ukDate,
} from "@/components/purchasing/workspace";
import {
  FBA_INBOUND_STATUSES,
  FBA_RECOMMENDATIONS,
  FBA_RECOMMENDATION_LABEL,
  type FbaInboundStatus,
  type FbaRecommendation,
} from "@/domain/fba-replenishment";
import { FBA_STOCK_LABEL, WAREHOUSE_STOCK_LABEL } from "@/domain/fba-stock";
import { guardStaffPage } from "@/lib/guard-staff-page";
import {
  getFbaForecastWorkspaceFn,
  importFbaAmazonSalesFn,
  importOinReplenishmentFn,
  saveFbaInboundShipmentFn,
  saveFbaSkuOverrideFn,
  updateFbaForecastSettingsFn,
} from "@/server/phase2/fns";

type Search = {
  q?: string | undefined;
  page?: number | undefined;
  recommendation?: FbaRecommendation | undefined;
};

function parseSearch(raw: Record<string, unknown>): Search {
  const out: Search = {};
  const query = raw["q"];
  if (typeof query === "string" && query) out.q = query;
  const pageRaw = raw["page"];
  const page = typeof pageRaw === "number" ? pageRaw : Number(pageRaw);
  if (Number.isFinite(page) && page > 1) out.page = Math.trunc(page);
  const recommendation = raw["recommendation"];
  if (FBA_RECOMMENDATIONS.some((item) => item === recommendation)) {
    out.recommendation = recommendation as FbaRecommendation;
  }
  return out;
}

export const Route = createFileRoute("/purchasing/fba-forecast")({
  beforeLoad: ({ location }) =>
    guardStaffPage("purchasing.fba_forecast.view", location.href, "/purchasing"),
  validateSearch: (raw: Record<string, unknown>) => parseSearch(raw),
  head: () => ({
    meta: [
      { title: "FBA Forecast — Purchasing — Automotive Brands" },
      {
        name: "description",
        content: "Amazon FBA UK replenishment cover, sell-through and suggested shipments.",
      },
    ],
  }),
  component: FbaForecastPage,
});

type Data = Extract<Awaited<ReturnType<typeof getFbaForecastWorkspaceFn>>, { ok: true }>["data"];

function tone(recommendation: FbaRecommendation): Tone {
  if (recommendation === "SEND_NOW") return "bad";
  if (recommendation === "SEND_SOON") return "warn";
  if (recommendation === "HEALTHY") return "good";
  if (recommendation === "OVERSTOCKED") return "info";
  return "neutral";
}

function readFile(file: File): Promise<string> {
  return file.text();
}

function FbaForecastPage() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [q, setQ] = useState(search.q ?? "");
  const [reload, setReload] = useState(0);
  const [busy, setBusy] = useState(false);
  const [report504, setReport504] = useState<{ name: string; text: string } | null>(null);
  const [reportTrm, setReportTrm] = useState<{ name: string; text: string } | null>(null);
  const [salesFile, setSalesFile] = useState<{ name: string; text: string } | null>(null);
  const [completeDaily, setCompleteDaily] = useState(false);
  const [fbaOnlyAttested, setFbaOnlyAttested] = useState(false);
  const [ukMarketplaceAttested, setUkMarketplaceAttested] = useState(false);
  const [lead, setLead] = useState("14");
  const [cover, setCover] = useState("6");
  const [safety, setSafety] = useState("0");
  const [multiple, setMultiple] = useState("");
  const [overstock, setOverstock] = useState("16");
  const [inbound, setInbound] = useState({
    reference: "",
    sku: "",
    qty: "",
    status: "CONFIRMED_IN_TRANSIT" as FbaInboundStatus,
    note: "",
  });
  const [override, setOverride] = useState({
    sku: "",
    leadTimeDays: "",
    targetCoverWeeks: "",
    safetyStockQty: "",
    caseMultiple: "",
  });

  useEffect(() => {
    setQ(search.q ?? "");
  }, [search.q]);

  useEffect(() => {
    let cancelled = false;
    void getFbaForecastWorkspaceFn({
      data: {
        q: search.q ?? null,
        recommendation: search.recommendation ?? null,
        page: search.page ?? 1,
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
      setLead(String(result.data.settings.leadTimeDays));
      setCover(String(result.data.settings.targetCoverWeeks));
      setSafety(String(result.data.settings.safetyStockQty));
      setMultiple(
        result.data.settings.caseMultiple == null ? "" : String(result.data.settings.caseMultiple),
      );
      setOverstock(String(result.data.settings.overstockCoverWeeks));
    });
    return () => {
      cancelled = true;
    };
  }, [search, reload]);

  function patch(next: Search) {
    void navigate({ search: (prev) => ({ ...prev, ...next }) });
  }

  async function run(action: () => Promise<{ ok: boolean; error?: string }>, done: string) {
    setBusy(true);
    setNotice(null);
    setError(null);
    const result = await action();
    setBusy(false);
    if (!result.ok) {
      setError(result.error ?? "The FBA forecast action failed.");
      return;
    }
    setNotice(done);
    setReload((value) => value + 1);
  }

  return (
    <>
      <PanelHeader
        title="FBA Forecast"
        sub={`${FBA_STOCK_LABEL} is OPTIMUS stock. ${WAREHOUSE_STOCK_LABEL} stays separate. Suggestions are not orders and do not move stock.`}
        crumbs={[{ label: "Purchasing" }, { label: "FBA Forecast" }]}
      />
      <div className="space-y-2 border-b border-border/70 px-4 py-3 text-[13px] text-steel sm:px-6">
        <p>
          OIN Autopart invoices are replenishment into Amazon, not consumer sales. A weekly rate is
          shown only when a complete Amazon UK sales extract covers the last 30 days. Historical OIN
          cadence is a provisional replenishment indicator and is never used as demand.
        </p>
        <p>
          AlphaOps is not connected. Sell-through is the latest manual Amazon UK CSV. Creating an
          OIN invoice does not put stock in transit. Only a confirmed in-transit shipment counts as
          inbound, and received stock is left in the FBA snapshot so it is not counted twice.
        </p>
        <p>
          Each FBA quantity is verified from that SKU&apos;s own OPTIMUS timestamp. A partial upload
          refreshes only the SKUs in the file. Stock older than {data?.staleAfterDays ?? 14} days,
          or with no timestamp, is not sellable inventory for a shipment.
        </p>
        {data && data.unverifiedFbaSkus > 0 ? (
          <p className="font-medium text-warn">
            {data.unverifiedFbaSkus.toLocaleString("en-GB")} SKU
            {data.unverifiedFbaSkus === 1 ? "" : "s"} have a stale or missing OPTIMUS timestamp, so
            no shipment is suggested for them.
          </p>
        ) : null}
        {data?.stale ? (
          <p className="font-medium text-warn">
            The latest OPTIMUS file is older than {data.staleAfterDays} days
            {data.fbaImportedAt ? ` (imported ${ukDate(data.fbaImportedAt.slice(0, 10))})` : ""}.
          </p>
        ) : null}
        {data && !data.sales ? (
          <p>No Amazon sales extract has been imported. Every SKU stays on Insufficient Data.</p>
        ) : null}
        {data?.sales && !data.sales.windows.d30 ? (
          <p>
            The latest Amazon file ({data.sales.filename}, {data.sales.coverageFrom ?? "unknown"} to{" "}
            {data.sales.coverageTo ?? "unknown"}, scope {data.sales.fulfilmentScope || "unset"},
            marketplace {data.sales.marketplace || "unset"}) does not support the last 30 days as
            complete Amazon UK FBA sell-through. No weekly rate is estimated.
            {data.sales.coverageHasGaps
              ? " Days inside the declared range have no row, and omitted days were not declared as zero FBA sales."
              : ""}
          </p>
        ) : null}
        {data && data.overlapDocuments > 0 ? (
          <p>
            {data.overlapDocuments.toLocaleString("en-GB")} OIN document
            {data.overlapDocuments === 1 ? "" : "s"} also exist on the financial sales ledger. They
            stay there. Purchasing demand excludes OIN references so they are not counted twice.
          </p>
        ) : null}
        {data && data.unmatchedCount > 0 ? (
          <p>
            {data.unmatchedCount.toLocaleString("en-GB")} replenishment SKU
            {data.unmatchedCount === 1 ? "" : "s"} have no Autopart product:{" "}
            {data.unmatchedSkus.join(", ")}
            {data.unmatchedCount > data.unmatchedSkus.length ? "…" : ""}.
          </p>
        ) : null}
      </div>
      {notice ? <p className="px-4 py-2 text-[13px] text-steel sm:px-6">{notice}</p> : null}
      {error ? <ErrorState message={error} /> : null}
      {data?.canManage ? (
        <div className="grid gap-4 border-b border-border/70 px-4 py-4 sm:px-6 lg:grid-cols-2">
          <form
            className="space-y-2"
            onSubmit={(event) => {
              event.preventDefault();
              if (!report504 || !reportTrm) {
                setError("Choose both the 504 report and the TRM21QC report.");
                return;
              }
              void run(
                () =>
                  importOinReplenishmentFn({
                    data: {
                      report504: report504.text,
                      reportTrm: reportTrm.text,
                      filename504: report504.name,
                      filenameTrm: reportTrm.name,
                    },
                  }),
                "OIN replenishment ledger updated.",
              );
            }}
          >
            <h2 className="text-[12px] font-semibold uppercase tracking-[0.12em]">
              OIN replenishment
            </h2>
            <p className="text-[12px] text-steel">
              Upload the same 504 and TRM21QC pair. This does not change the mailbox poller,
              customer cutover, or financial invoice ownership. The same file pair is stored once.
            </p>
            <input
              className={controlClass}
              type="file"
              accept=".txt,.csv,text/plain"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (!file) return;
                void readFile(file).then((text) => setReport504({ name: file.name, text }));
              }}
            />
            <input
              className={controlClass}
              type="file"
              accept=".txt,.csv,text/plain"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (!file) return;
                void readFile(file).then((text) => setReportTrm({ name: file.name, text }));
              }}
            />
            <button className={primaryBtnClass} type="submit" disabled={busy}>
              Import OIN pair
            </button>
          </form>
          <form
            className="space-y-2"
            onSubmit={(event) => {
              event.preventDefault();
              if (!salesFile) {
                setError("Choose an Amazon UK sales CSV.");
                return;
              }
              void run(
                () =>
                  importFbaAmazonSalesFn({
                    data: {
                      text: salesFile.text,
                      filename: salesFile.name,
                      completeDaily,
                      fbaOnlyAttested,
                      ukMarketplaceAttested,
                    },
                  }),
                "Amazon UK sales extract stored. Earlier extracts are not added to this one.",
              );
            }}
          >
            <h2 className="text-[12px] font-semibold uppercase tracking-[0.12em]">
              Amazon UK sales
            </h2>
            <p className="text-[12px] text-steel">
              The first rows must declare coverage_from, coverage_to, extracted_on and
              fulfilment_scope FBA. Then sku, date, units_sold and fulfilment_channel AFN or FBA. An
              MFN or FBM row rejects the file. Each row needs marketplace AMAZON_UK, or the metadata
              must say marketplace_scope AMAZON_UK. A missing marketplace is not treated as UK, and
              another market such as AMAZON_DE is rejected. Coverage is not taken from the first and
              last sale. A gap is incomplete unless zeros_omitted is yes. This is not an Amazon API
              feed.
            </p>
            <input
              className={controlClass}
              type="file"
              accept=".csv,text/csv"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (!file) return;
                void readFile(file).then((text) => setSalesFile({ name: file.name, text }));
              }}
            />
            <label className="flex items-center gap-2 text-[13px]">
              <input
                type="checkbox"
                checked={fbaOnlyAttested}
                onChange={(event) => setFbaOnlyAttested(event.target.checked)}
              />
              I attest every row is Amazon FBA (AFN). Merchant-fulfilled orders are not included.
            </label>
            <label className="flex items-center gap-2 text-[13px]">
              <input
                type="checkbox"
                checked={ukMarketplaceAttested}
                onChange={(event) => setUkMarketplaceAttested(event.target.checked)}
              />
              I attest this extract is Amazon UK only. Required when the file has no marketplace
              column.
            </label>
            <label className="flex items-center gap-2 text-[13px]">
              <input
                type="checkbox"
                checked={completeDaily}
                onChange={(event) => setCompleteDaily(event.target.checked)}
              />
              I attest the declared coverage is a complete FBA extract for that range
            </label>
            <button className={primaryBtnClass} type="submit" disabled={busy}>
              Import Amazon sales
            </button>
          </form>
          <form
            className="space-y-2"
            onSubmit={(event) => {
              event.preventDefault();
              const caseMultiple = multiple.trim() ? Number(multiple) : null;
              void run(
                () =>
                  updateFbaForecastSettingsFn({
                    data: {
                      leadTimeDays: Number(lead),
                      targetCoverWeeks: Number(cover),
                      safetyStockQty: Number(safety),
                      caseMultiple,
                      overstockCoverWeeks: Number(overstock),
                    },
                  }),
                "Forecast settings saved.",
              );
            }}
          >
            <h2 className="text-[12px] font-semibold uppercase tracking-[0.12em]">Assumptions</h2>
            <div className="flex flex-wrap gap-2">
              <label className="text-[12px]">
                Lead days
                <input
                  className={`${controlClass} ml-2 w-20`}
                  value={lead}
                  onChange={(e) => setLead(e.target.value)}
                />
              </label>
              <label className="text-[12px]">
                Target weeks
                <input
                  className={`${controlClass} ml-2 w-20`}
                  value={cover}
                  onChange={(e) => setCover(e.target.value)}
                />
              </label>
              <label className="text-[12px]">
                Safety units
                <input
                  className={`${controlClass} ml-2 w-20`}
                  value={safety}
                  onChange={(e) => setSafety(e.target.value)}
                />
              </label>
              <label className="text-[12px]">
                Case multiple
                <input
                  className={`${controlClass} ml-2 w-20`}
                  value={multiple}
                  placeholder="none"
                  onChange={(e) => setMultiple(e.target.value)}
                />
              </label>
              <label className="text-[12px]">
                Overstock weeks
                <input
                  className={`${controlClass} ml-2 w-20`}
                  value={overstock}
                  onChange={(e) => setOverstock(e.target.value)}
                />
              </label>
            </div>
            <button className={btnClass} type="submit" disabled={busy}>
              Save settings
            </button>
          </form>
          <form
            className="space-y-2"
            onSubmit={(event) => {
              event.preventDefault();
              void run(
                () =>
                  saveFbaInboundShipmentFn({
                    data: {
                      reference: inbound.reference,
                      sku: inbound.sku,
                      qty: Number(inbound.qty),
                      status: inbound.status,
                      note: inbound.note || null,
                    },
                  }),
                "Inbound shipment saved. Planned, received and cancelled quantities are not eligible.",
              );
            }}
          >
            <h2 className="text-[12px] font-semibold uppercase tracking-[0.12em]">
              Confirmed inbound
            </h2>
            <div className="flex flex-wrap gap-2">
              <input
                className={`${controlClass} w-32`}
                placeholder="Reference"
                value={inbound.reference}
                onChange={(e) => setInbound({ ...inbound, reference: e.target.value })}
              />
              <input
                className={`${controlClass} w-32`}
                placeholder="SKU"
                value={inbound.sku}
                onChange={(e) => setInbound({ ...inbound, sku: e.target.value })}
              />
              <input
                className={`${controlClass} w-20`}
                placeholder="Qty"
                value={inbound.qty}
                onChange={(e) => setInbound({ ...inbound, qty: e.target.value })}
              />
              <select
                className={controlClass}
                value={inbound.status}
                onChange={(e) =>
                  setInbound({ ...inbound, status: e.target.value as FbaInboundStatus })
                }
              >
                {FBA_INBOUND_STATUSES.map((status) => (
                  <option key={status} value={status}>
                    {status}
                  </option>
                ))}
              </select>
            </div>
            <button className={btnClass} type="submit" disabled={busy}>
              Save inbound
            </button>
          </form>
          <form
            className="space-y-2 lg:col-span-2"
            onSubmit={(event) => {
              event.preventDefault();
              const blank = (value: string) => (value.trim() ? Number(value) : null);
              void run(
                () =>
                  saveFbaSkuOverrideFn({
                    data: {
                      sku: override.sku,
                      leadTimeDays: blank(override.leadTimeDays),
                      targetCoverWeeks: blank(override.targetCoverWeeks),
                      safetyStockQty: blank(override.safetyStockQty),
                      caseMultiple: blank(override.caseMultiple),
                    },
                  }),
                "SKU override saved. Blank fields keep the workspace assumption.",
              );
            }}
          >
            <h2 className="text-[12px] font-semibold uppercase tracking-[0.12em]">SKU override</h2>
            <div className="flex flex-wrap gap-2">
              <input
                className={`${controlClass} w-32`}
                placeholder="SKU"
                value={override.sku}
                onChange={(e) => setOverride({ ...override, sku: e.target.value })}
              />
              <input
                className={`${controlClass} w-24`}
                placeholder="Lead days"
                value={override.leadTimeDays}
                onChange={(e) => setOverride({ ...override, leadTimeDays: e.target.value })}
              />
              <input
                className={`${controlClass} w-24`}
                placeholder="Cover weeks"
                value={override.targetCoverWeeks}
                onChange={(e) => setOverride({ ...override, targetCoverWeeks: e.target.value })}
              />
              <input
                className={`${controlClass} w-24`}
                placeholder="Safety"
                value={override.safetyStockQty}
                onChange={(e) => setOverride({ ...override, safetyStockQty: e.target.value })}
              />
              <input
                className={`${controlClass} w-24`}
                placeholder="Case"
                value={override.caseMultiple}
                onChange={(e) => setOverride({ ...override, caseMultiple: e.target.value })}
              />
            </div>
            <button className={btnClass} type="submit" disabled={busy}>
              Save SKU override
            </button>
          </form>
        </div>
      ) : null}
      {data?.latestExceptions.length ? (
        <div className="border-b border-border/70 px-4 py-3 text-[12px] text-steel sm:px-6">
          <h2 className="mb-1 text-[12px] font-semibold uppercase tracking-[0.12em] text-ink">
            Latest import exceptions
          </h2>
          <ul className="space-y-1">
            {data.latestExceptions.map((item, index) => (
              <li key={`${item.code}-${item.documentReference ?? "none"}-${index}`}>
                {item.code}
                {item.documentReference ? ` ${item.documentReference}` : ""}: {item.message}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <form
        className="flex flex-wrap gap-2 border-b border-border/70 px-4 py-3 sm:px-6"
        onSubmit={(event) => {
          event.preventDefault();
          patch({ q: q.trim() || undefined, page: undefined });
        }}
      >
        <input
          className={`${controlClass} min-w-[180px]`}
          placeholder="Search SKU"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <select
          className={controlClass}
          value={search.recommendation ?? ""}
          onChange={(e) =>
            patch({
              recommendation: (e.target.value || undefined) as FbaRecommendation | undefined,
              page: undefined,
            })
          }
        >
          <option value="">All recommendations</option>
          {FBA_RECOMMENDATIONS.map((item) => (
            <option key={item} value={item}>
              {FBA_RECOMMENDATION_LABEL[item]}
            </option>
          ))}
        </select>
        <button className={btnClass} type="submit">
          Search
        </button>
      </form>
      {!data && !error ? <LoadingState label="Loading FBA forecast…" /> : null}
      {data && data.rows.length === 0 ? (
        <EmptyState
          title="No FBA rows"
          body="Import an OPTIMUS stock file, an OIN 504/TRM pair, or an Amazon UK sales CSV. Nothing is invented while those sources are empty."
        />
      ) : null}
      {data && data.rows.length > 0 ? (
        <>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1500px] text-left text-[13px]">
              <thead className="bg-secondary/40 text-[10px] font-semibold uppercase tracking-[0.12em] text-steel">
                <tr>
                  <th className="px-3 py-2">SKU</th>
                  <th className="px-3 py-2">FBA UK</th>
                  <th className="px-3 py-2">Studley</th>
                  <th className="px-3 py-2">Inbound</th>
                  <th className="px-3 py-2">OIN 90d</th>
                  <th className="px-3 py-2">OIN / week</th>
                  <th className="px-3 py-2">7d</th>
                  <th className="px-3 py-2">30d</th>
                  <th className="px-3 py-2">90d</th>
                  <th className="px-3 py-2">365d</th>
                  <th className="px-3 py-2">Rate</th>
                  <th className="px-3 py-2">Cover</th>
                  <th className="px-3 py-2">Stockout</th>
                  <th className="px-3 py-2">Next send</th>
                  <th className="px-3 py-2">Suggested</th>
                  <th
                    className="px-3 py-2"
                    title="Whole cases only. Units below one case are not dispatch-ready."
                  >
                    Dispatchable
                  </th>
                  <th className="px-3 py-2">Buy shortfall</th>
                  <th className="px-3 py-2">Recommendation</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((row) => (
                  <tr key={row.matchKey} className="border-t border-border/70 align-top">
                    <td className="px-3 py-2">
                      <div className="font-mono text-[12px]">{row.sku}</div>
                      <div className="max-w-[180px] text-[11px] text-steel">{row.description}</div>
                    </td>
                    <td className="px-3 py-2">{qty(row.fbaAvailable)}</td>
                    <td className="px-3 py-2">{qty(row.studleyAvailable)}</td>
                    <td className="px-3 py-2">{qty(row.confirmedInbound)}</td>
                    <td className="px-3 py-2">{qty(row.oinUnits90)}</td>
                    <td
                      className="px-3 py-2"
                      title="Provisional replenishment cadence, not sell-through"
                    >
                      {row.oinWeekly == null ? "—" : row.oinWeekly.toFixed(1)}
                    </td>
                    <td className="px-3 py-2">{qty(row.amazonUnits.d7)}</td>
                    <td className="px-3 py-2">{qty(row.amazonUnits.d30)}</td>
                    <td className="px-3 py-2">{qty(row.amazonUnits.d90)}</td>
                    <td className="px-3 py-2">{qty(row.amazonUnits.d365)}</td>
                    <td className="px-3 py-2">{rate(row.forecast.weeklyRate)}</td>
                    <td className="px-3 py-2">
                      {row.forecast.coverWeeks == null
                        ? "—"
                        : `${row.forecast.coverWeeks.toFixed(1)} wks`}
                    </td>
                    <td className="px-3 py-2">{ukDate(row.forecast.stockoutDate)}</td>
                    <td className="px-3 py-2">{ukDate(row.forecast.nextSendDate)}</td>
                    <td className="px-3 py-2">{qty(row.forecast.suggestedSendQty)}</td>
                    <td
                      className="px-3 py-2"
                      title="Whole cases only. Units below one case are not dispatch-ready."
                    >
                      {qty(row.forecast.dispatchableQty)}
                      {row.forecast.looseStudleyQty ? (
                        <div className="text-[11px] text-steel">
                          {qty(row.forecast.looseStudleyQty)} loose, not a shipment
                        </div>
                      ) : null}
                    </td>
                    <td className="px-3 py-2">{qty(row.forecast.studleyShortfallQty)}</td>
                    <td className="px-3 py-2">
                      <StatusBadge tone={tone(row.forecast.recommendation)}>
                        {row.forecast.recommendationLabel}
                      </StatusBadge>
                      <div className="mt-1 max-w-[240px] text-[11px] text-steel">
                        {row.forecast.reason}
                      </div>
                      <div className="text-[11px] text-steel">
                        Confidence {row.forecast.confidence}
                      </div>
                      <details className="mt-1 text-[11px] text-steel">
                        <summary>Assumptions</summary>
                        <ul className="mt-1 list-disc pl-4">
                          {row.forecast.assumptions.map((item) => (
                            <li key={item}>{item}</li>
                          ))}
                        </ul>
                      </details>
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
            onPage={(page) => patch({ page: page > 1 ? page : undefined })}
          />
        </>
      ) : null}
    </>
  );
}
