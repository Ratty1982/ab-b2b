import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { PanelHeader } from "@/components/ab/AppShell";
import { StatusBadge, type Tone } from "@/components/ab/Badges";
import { FbaStockImportPanel } from "@/components/purchasing/fba-stock-import";
import {
  EmptyState,
  ErrorState,
  LoadingState,
  Pager,
  btnClass,
  controlClass,
  downloadCsv,
  primaryBtnClass,
  qty,
  rate,
  ukDate,
} from "@/components/purchasing/workspace";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { parseFbaAmazonSalesCsv } from "@/domain/fba-amazon-sales-csv";
import {
  FBA_INBOUND_STATUSES,
  FBA_RECOMMENDATIONS,
  FBA_RECOMMENDATION_LABEL,
  type FbaInboundStatus,
  type FbaRecommendation,
} from "@/domain/fba-replenishment";
import { guardStaffPage } from "@/lib/guard-staff-page";
import {
  exportFbaForecastCsvFn,
  getFbaForecastSkuFn,
  getFbaForecastWorkspaceFn,
  getFbaOinHistoryFn,
  importFbaAmazonSalesFn,
  saveFbaInboundShipmentFn,
  saveFbaSkuOverrideFn,
  updateFbaForecastSettingsFn,
} from "@/server/phase2/fns";

const TABS = ["overview", "history", "imports", "settings"] as const;
type Tab = (typeof TABS)[number];
const SORTS = ["priority", "cover", "velocity", "suggested"] as const;
type Sort = (typeof SORTS)[number];

type Search = {
  q?: string | undefined;
  page?: number | undefined;
  recommendation?: FbaRecommendation | undefined;
  brand?: string | undefined;
  sort?: Sort | undefined;
  tab?: Tab | undefined;
  sku?: string | undefined;
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
  const brand = raw["brand"];
  if (typeof brand === "string" && brand) out.brand = brand;
  const sort = raw["sort"];
  if (SORTS.some((item) => item === sort)) out.sort = sort as Sort;
  const tab = raw["tab"];
  if (TABS.some((item) => item === tab)) out.tab = tab as Tab;
  const sku = raw["sku"];
  if (typeof sku === "string" && sku) out.sku = sku;
  return out;
}

export const Route = createFileRoute("/purchasing/fba-forecast")({
  beforeLoad: ({ location }) =>
    guardStaffPage("purchasing.fba_forecast.view", location.href, "/purchasing"),
  validateSearch: (raw: Record<string, unknown>) => parseSearch(raw),
  head: () => ({
    meta: [
      { title: "Amazon FBA Forecast — Purchasing — Automotive Brands" },
      {
        name: "description",
        content: "What to send to Amazon FBA UK, how much, and when.",
      },
    ],
  }),
  component: FbaForecastPage,
});

type Data = Extract<Awaited<ReturnType<typeof getFbaForecastWorkspaceFn>>, { ok: true }>["data"];
type Row = Data["rows"][number];
type History = Extract<Awaited<ReturnType<typeof getFbaOinHistoryFn>>, { ok: true }>["data"];
type SkuDetail = Extract<Awaited<ReturnType<typeof getFbaForecastSkuFn>>, { ok: true }>["data"];

function tone(recommendation: FbaRecommendation): Tone {
  if (recommendation === "SEND_NOW") return "bad";
  if (recommendation === "SEND_SOON") return "warn";
  if (recommendation === "HEALTHY") return "good";
  if (recommendation === "OVERSTOCKED") return "info";
  return "neutral";
}

function rowAccent(recommendation: FbaRecommendation): string {
  if (recommendation === "SEND_NOW") return "border-l-4 border-l-destructive";
  if (recommendation === "SEND_SOON") return "border-l-4 border-l-warn";
  return "border-l-4 border-l-transparent";
}

function FbaForecastPage() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const tab = search.tab ?? "overview";
  const [data, setData] = useState<Data | null>(null);
  const [history, setHistory] = useState<History | null>(null);
  const [detail, setDetail] = useState<SkuDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [q, setQ] = useState(search.q ?? "");
  const [reload, setReload] = useState(0);
  const [busy, setBusy] = useState(false);
  const [statusOpen, setStatusOpen] = useState(false);
  const [salesFile, setSalesFile] = useState<{ name: string; text: string } | null>(null);
  const [salesPreview, setSalesPreview] = useState<string | null>(null);
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

  function patch(next: Partial<Search>) {
    void navigate({ search: { ...search, ...next } });
  }

  useEffect(() => {
    let cancelled = false;
    void getFbaForecastWorkspaceFn({
      data: {
        q: search.q,
        page: search.page,
        recommendation: search.recommendation,
        brand: search.brand,
        sort: search.sort,
      },
    }).then((result) => {
      if (cancelled) return;
      if (!result.ok) {
        setError(result.error ?? "The FBA forecast could not be loaded.");
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
  }, [search.q, search.page, search.recommendation, search.brand, search.sort, reload]);

  useEffect(() => {
    if (tab !== "history") return;
    let cancelled = false;
    void getFbaOinHistoryFn({ data: { page: search.page } }).then((result) => {
      if (cancelled) return;
      if (result.ok) setHistory(result.data);
    });
    return () => {
      cancelled = true;
    };
  }, [tab, search.page, reload]);

  useEffect(() => {
    if (!search.sku) {
      setDetail(null);
      return;
    }
    let cancelled = false;
    void getFbaForecastSkuFn({ data: { matchKey: search.sku } }).then((result) => {
      if (cancelled) return;
      if (result.ok) setDetail(result.data);
    });
    return () => {
      cancelled = true;
    };
  }, [search.sku, reload]);

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

  const selected = data?.rows.find((row) => row.matchKey === search.sku) ?? null;

  return (
    <>
      <PanelHeader
        title="Amazon FBA Forecast"
        sub="Know what to replenish, when to send it and how much stock is available."
        crumbs={[{ label: "Purchasing" }, { label: "Amazon FBA" }]}
        actions={
          <>
            <span className="inline-flex h-9 items-center border border-border px-3 text-[11px] font-semibold uppercase tracking-[0.12em]">
              Amazon UK
            </span>
            <button className={btnClass} type="button" onClick={() => setStatusOpen((open) => !open)}>
              Data status
            </button>
          </>
        }
      />
      {notice ? (
        <p className="border-b border-good/30 bg-good/10 px-4 py-2 text-[13px] text-good sm:px-6">{notice}</p>
      ) : null}
      {error ? (
        <div className="px-4 py-3 sm:px-6">
          <ErrorState message={error} />
        </div>
      ) : null}
      {statusOpen && data ? <DataStatus data={data} /> : null}
      <nav className="flex gap-1 overflow-x-auto border-b border-border/70 px-4 py-3 sm:px-6">
        {(
          [
            ["overview", "Overview"],
            ["history", "OIN History"],
            ["imports", "Data & Imports"],
            ["settings", "Settings"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            className={tab === id ? primaryBtnClass : btnClass}
            type="button"
            onClick={() => patch({ tab: id === "overview" ? undefined : id, page: undefined })}
          >
            {label}
          </button>
        ))}
      </nav>
      {tab === "overview" ? (
        <Overview
          data={data}
          q={q}
          setQ={setQ}
          search={search}
          patch={patch}
          onOpen={(row) => {
            setOverride((current) => ({ ...current, sku: row.sku }));
            patch({ sku: row.matchKey });
          }}
          onExport={() => {
            void exportFbaForecastCsvFn({
              data: {
                q: search.q,
                recommendation: search.recommendation,
                brand: search.brand,
                sort: search.sort,
              },
            }).then((result) => {
              if (!result.ok) {
                setError(result.error ?? "The export failed.");
                return;
              }
              downloadCsv(result.data.csv, result.data.filename);
              setNotice(`Exported ${result.data.rows.toLocaleString("en-GB")} recommendations.`);
            });
          }}
        />
      ) : null}
      {tab === "history" ? (
        <HistoryPanel
          history={history}
          warning={data?.oin.warning ?? null}
          exceptions={data?.latestExceptions ?? []}
          onPage={(page) => patch({ page: page > 1 ? page : undefined })}
        />
      ) : null}
      {tab === "imports" && data ? (
        <ImportsPanel
          data={data}
          busy={busy}
          salesFile={salesFile}
          salesPreview={salesPreview}
          completeDaily={completeDaily}
          fbaOnlyAttested={fbaOnlyAttested}
          ukMarketplaceAttested={ukMarketplaceAttested}
          inbound={inbound}
          setCompleteDaily={setCompleteDaily}
          setFbaOnlyAttested={setFbaOnlyAttested}
          setUkMarketplaceAttested={setUkMarketplaceAttested}
          setInbound={setInbound}
          onSalesFile={(file) => {
            void file.text().then((text) => {
              setSalesFile({ name: file.name, text });
              const parsed = parseFbaAmazonSalesCsv(text);
              setSalesPreview(
                parsed.ok
                  ? `${parsed.rows.length.toLocaleString("en-GB")} UK FBA rows, ${parsed.coverageFrom} to ${parsed.coverageTo}${parsed.coverageHasGaps ? ", with gaps" : ""}.`
                  : parsed.error,
              );
            });
          }}
          onImportSales={() => {
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
          onInbound={() => {
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
              "Inbound shipment saved. Only confirmed in-transit stock counts.",
            );
          }}
          onImported={() => setReload((value) => value + 1)}
        />
      ) : null}
      {tab === "settings" && data ? (
        <SettingsPanel
          busy={busy}
          canManage={data.canManage}
          lead={lead}
          cover={cover}
          safety={safety}
          multiple={multiple}
          overstock={overstock}
          setLead={setLead}
          setCover={setCover}
          setSafety={setSafety}
          setMultiple={setMultiple}
          setOverstock={setOverstock}
          onSave={() => {
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
        />
      ) : null}
      <Sheet open={Boolean(search.sku)} onOpenChange={(open) => !open && patch({ sku: undefined })}>
        <SheetContent className="w-[min(40rem,100vw)] sm:max-w-xl">
          {selected ? (
            <SkuDrawer
              row={selected}
              detail={detail}
              canManage={Boolean(data?.canManage)}
              busy={busy}
              override={override}
              setOverride={setOverride}
              onSave={() => {
                const blank = (value: string) => (value.trim() ? Number(value) : null);
                void run(
                  () =>
                    saveFbaSkuOverrideFn({
                      data: {
                        sku: selected.sku,
                        leadTimeDays: blank(override.leadTimeDays),
                        targetCoverWeeks: blank(override.targetCoverWeeks),
                        safetyStockQty: blank(override.safetyStockQty),
                        caseMultiple: blank(override.caseMultiple),
                      },
                    }),
                  "SKU settings saved. Blank fields keep the workspace default.",
                );
              }}
            />
          ) : (
            <SheetHeader>
              <SheetTitle>Product</SheetTitle>
              <SheetDescription>This product is not on the current page of results.</SheetDescription>
            </SheetHeader>
          )}
        </SheetContent>
      </Sheet>
    </>
  );
}

function DataStatus({ data }: { data: Data }) {
  return (
    <div className="grid gap-3 border-b border-border/70 px-4 py-4 text-[13px] sm:grid-cols-2 sm:px-6 xl:grid-cols-4">
      <StatusBlock
        title="OPTIMUS FBA stock"
        body={
          data.fbaFileName
            ? `${data.fbaFileName}, imported ${ukDate(data.fbaImportedAt?.slice(0, 10))}. ${data.unverifiedFbaSkus.toLocaleString("en-GB")} SKUs are older than ${data.staleAfterDays} days.`
            : "No OPTIMUS FBA file has been imported."
        }
      />
      <StatusBlock
        title="RETAILA OIN history"
        body={
          data.oin.documents
            ? `${data.oin.documents.toLocaleString("en-GB")} invoices, latest ${ukDate(data.oin.latestDocumentDate)}. ${data.oin.historicDocuments.toLocaleString("en-GB")} from 561L and ${data.oin.ongoingDocuments.toLocaleString("en-GB")} from TRM21QC.`
            : "No RETAILA OIN invoices are stored yet."
        }
      />
      <StatusBlock
        title="Amazon UK sales"
        body={
          data.sales
            ? `${data.sales.filename}, ${ukDate(data.sales.coverageFrom)} to ${ukDate(data.sales.coverageTo)}. ${data.sales.windows.d30 ? "30-day window is supported." : "30-day window is not supported."}`
            : "No Amazon UK sell-through file has been imported."
        }
      />
      <StatusBlock
        title="Unresolved products"
        body={`${data.summary.dataIssues.toLocaleString("en-GB")} products cannot be forecast yet. OIN invoices are replenishment history, not consumer sales.`}
      />
      {data.oin.warning ? (
        <p className="border border-warn/40 bg-warn/10 px-3 py-2 text-warn sm:col-span-2 xl:col-span-4">
          {data.oin.warning}
        </p>
      ) : null}
    </div>
  );
}

function StatusBlock({ title, body }: { title: string; body: string }) {
  return (
    <div className="border border-border bg-surface/60 p-3">
      <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-steel">{title}</div>
      <p className="mt-1 text-[13px]">{body}</p>
    </div>
  );
}

function Overview({
  data,
  q,
  setQ,
  search,
  patch,
  onOpen,
  onExport,
}: {
  data: Data | null;
  q: string;
  setQ: (value: string) => void;
  search: Search;
  patch: (next: Partial<Search>) => void;
  onOpen: (row: Row) => void;
  onExport: () => void;
}) {
  return (
    <>
      <div className="grid gap-3 px-4 py-4 sm:grid-cols-2 sm:px-6 xl:grid-cols-4">
        <SummaryCard
          label="Send Now"
          value={data ? String(data.summary.sendNow) : "—"}
          hint="Needs a shipment now"
          active={search.recommendation === "SEND_NOW"}
          onClick={() => patch({ recommendation: "SEND_NOW", page: undefined, tab: undefined })}
        />
        <SummaryCard
          label="Send Soon"
          value={data ? String(data.summary.sendSoon) : "—"}
          hint="Replenish shortly"
          active={search.recommendation === "SEND_SOON"}
          onClick={() => patch({ recommendation: "SEND_SOON", page: undefined, tab: undefined })}
        />
        <SummaryCard
          label="Healthy Stock"
          value={data ? String(data.summary.healthy) : "—"}
          hint="Cover is adequate"
          active={search.recommendation === "HEALTHY"}
          onClick={() => patch({ recommendation: "HEALTHY", page: undefined, tab: undefined })}
        />
        <SummaryCard
          label="Data Issues"
          value={data ? String(data.summary.dataIssues) : "—"}
          hint="Forecast cannot be calculated"
          active={search.recommendation === "INSUFFICIENT_DATA"}
          onClick={() =>
            patch({ recommendation: "INSUFFICIENT_DATA", page: undefined, tab: undefined })
          }
        />
      </div>
      <form
        className="grid gap-2 border-y border-border/70 px-4 py-3 sm:px-6 md:grid-cols-[minmax(12rem,1fr)_11rem_11rem_10rem_auto_auto]"
        onSubmit={(event) => {
          event.preventDefault();
          patch({ q: q.trim() || undefined, page: undefined });
        }}
      >
        <input
          className={controlClass}
          placeholder="Search SKU or description"
          aria-label="Search SKU or description"
          value={q}
          onChange={(event) => setQ(event.target.value)}
        />
        <select
          className={controlClass}
          aria-label="Recommendation"
          value={search.recommendation ?? ""}
          onChange={(event) =>
            patch({
              recommendation: (event.target.value || undefined) as FbaRecommendation | undefined,
              page: undefined,
            })
          }
        >
          <option value="">All statuses</option>
          {FBA_RECOMMENDATIONS.map((item) => (
            <option key={item} value={item}>
              {FBA_RECOMMENDATION_LABEL[item]}
            </option>
          ))}
        </select>
        <select
          className={controlClass}
          aria-label="Brand"
          value={search.brand ?? ""}
          onChange={(event) => patch({ brand: event.target.value || undefined, page: undefined })}
        >
          <option value="">All brands</option>
          <option value="__unbranded">Unbranded</option>
          {data?.brands.map((brand) => (
            <option key={brand} value={brand}>
              {brand}
            </option>
          ))}
        </select>
        <select
          className={controlClass}
          aria-label="Sort"
          value={search.sort ?? "priority"}
          onChange={(event) => patch({ sort: event.target.value as Sort, page: undefined })}
        >
          <option value="priority">Priority</option>
          <option value="cover">Weeks cover</option>
          <option value="velocity">Sales velocity</option>
          <option value="suggested">Suggested quantity</option>
        </select>
        <button className={btnClass} type="submit">
          Search
        </button>
        <button className={btnClass} type="button" onClick={onExport}>
          Export
        </button>
      </form>
      {!data ? <LoadingState label="Loading replenishment…" /> : null}
      {data && data.rows.length === 0 ? (
        <EmptyState
          title="Nothing matches"
          body="No products match these filters. Clear the search, or import OPTIMUS FBA stock and an Amazon UK sales file before a shipment can be suggested."
        />
      ) : null}
      {data && data.rows.length > 0 ? (
        <>
          <div className="hidden md:block">
            <table className="w-full text-left text-[14px]">
              <thead className="bg-secondary/40 text-[11px] font-semibold uppercase tracking-[0.12em] text-steel">
                <tr>
                  <th className="px-4 py-3">Product / SKU</th>
                  <th className="px-3 py-3">FBA Stock</th>
                  <th className="px-3 py-3">Sold 30d</th>
                  <th className="px-3 py-3">Weeks Cover</th>
                  <th className="px-3 py-3">Studley Stock</th>
                  <th className="px-3 py-3">Suggested Send</th>
                  <th className="px-4 py-3">Status</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((row) => (
                  <tr
                    key={row.matchKey}
                    className={`cursor-pointer border-t border-border/70 hover:bg-secondary/30 ${rowAccent(row.forecast.recommendation)}`}
                    onClick={() => onOpen(row)}
                  >
                    <td className="px-4 py-3">
                      <div className="font-mono text-[13px]">{row.sku}</div>
                      <div className="max-w-[16rem] text-[12px] text-steel">{row.description}</div>
                    </td>
                    <td className="px-3 py-3">{qty(row.fbaAvailable)}</td>
                    <td className="px-3 py-3">{qty(row.amazonUnits.d30)}</td>
                    <td className="px-3 py-3">
                      {row.forecast.coverWeeks == null ? "—" : `${row.forecast.coverWeeks.toFixed(1)}`}
                    </td>
                    <td className="px-3 py-3">{qty(row.studleyAvailable)}</td>
                    <td className="px-3 py-3">{qty(row.forecast.suggestedSendQty)}</td>
                    <td className="px-4 py-3">
                      <StatusBadge tone={tone(row.forecast.recommendation)}>
                        {row.forecast.recommendationLabel}
                      </StatusBadge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="space-y-3 px-4 py-4 md:hidden">
            {data.rows.map((row) => (
              <button
                key={row.matchKey}
                type="button"
                className={`block w-full border border-border bg-surface/40 p-3 text-left ${rowAccent(row.forecast.recommendation)}`}
                onClick={() => onOpen(row)}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="font-mono text-[13px]">{row.sku}</div>
                    <div className="text-[12px] text-steel">{row.description}</div>
                  </div>
                  <StatusBadge tone={tone(row.forecast.recommendation)}>
                    {row.forecast.recommendationLabel}
                  </StatusBadge>
                </div>
                <dl className="mt-3 grid grid-cols-2 gap-2 text-[13px]">
                  <Fact label="FBA" value={qty(row.fbaAvailable)} />
                  <Fact label="Sold 30d" value={qty(row.amazonUnits.d30)} />
                  <Fact
                    label="Cover"
                    value={row.forecast.coverWeeks == null ? "—" : `${row.forecast.coverWeeks.toFixed(1)} wks`}
                  />
                  <Fact label="Send" value={qty(row.forecast.suggestedSendQty)} />
                </dl>
              </button>
            ))}
          </div>
          <div className="px-4 pb-6 sm:px-6">
            <Pager
              page={data.page}
              pageSize={data.pageSize}
              total={data.total}
              onPage={(page) => patch({ page: page > 1 ? page : undefined })}
            />
          </div>
        </>
      ) : null}
    </>
  );
}

function SummaryCard({
  label,
  value,
  hint,
  active,
  onClick,
}: {
  label: string;
  value: string;
  hint: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`border p-4 text-left ${active ? "border-primary bg-primary/10" : "border-border bg-surface/60"}`}
    >
      <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-steel">{label}</div>
      <div className="mt-1 font-display text-2xl font-semibold">{value}</div>
      <div className="mt-1 text-[12px] text-steel">{hint}</div>
    </button>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[11px] uppercase tracking-[0.12em] text-steel">{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function HistoryPanel({
  history,
  warning,
  exceptions,
  onPage,
}: {
  history: History | null;
  warning: string | null;
  exceptions: Data["latestExceptions"];
  onPage: (page: number) => void;
}) {
  return (
    <div className="space-y-4 px-4 py-4 sm:px-6">
      <p className="max-w-3xl text-[13px] text-steel">
        These are RETAILA invoices already stored from 561L history and the ongoing 504/TRM feed.
        They show what was replenished. They are not Amazon shopper sales, and an invoice is not a
        shipment in transit.
      </p>
      {warning ? <p className="border border-warn/40 bg-warn/10 px-3 py-2 text-[13px] text-warn">{warning}</p> : null}
      {!history ? <LoadingState label="Loading RETAILA OIN history…" /> : null}
      {history && history.documents.length === 0 ? (
        <EmptyState
          title="No RETAILA OIN history"
          body="Nothing beginning with OIN is stored for Autopart account RETAILA. Do not upload the same 504 and TRM files here."
        />
      ) : null}
      {history && history.documents.length > 0 ? (
        <div className="space-y-3">
          {history.documents.map((document) => (
            <article key={`${document.status}-${document.documentReference}`} className="border border-border p-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="font-mono text-[14px]">{document.documentReference}</h2>
                <span className="text-[12px] text-steel">
                  {ukDate(document.documentDate)} · {document.source} · {document.status}
                </span>
              </div>
              <p className="mt-1 text-[13px]">Counted quantity {qty(document.units)}</p>
              <ul className="mt-2 space-y-1 text-[13px]">
                {document.lines.map((line, index) => (
                  <li key={`${line.sku}-${line.source}-${index}`}>
                    {line.sku} · {qty(line.units)} · {line.source}
                    {line.description ? ` · ${line.description}` : ""}
                  </li>
                ))}
              </ul>
            </article>
          ))}
          <Pager page={history.page} pageSize={history.pageSize} total={history.total} onPage={onPage} />
        </div>
      ) : null}
      {exceptions.length ? (
        <div>
          <h2 className="text-[12px] font-semibold uppercase tracking-[0.12em]">Earlier ledger exceptions</h2>
          <ul className="mt-2 space-y-1 text-[13px] text-steel">
            {exceptions.map((item, index) => (
              <li key={`${item.code}-${index}`}>
                {item.code}
                {item.documentReference ? ` ${item.documentReference}` : ""}: {item.message}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function ImportsPanel(props: {
  data: Data;
  busy: boolean;
  salesFile: { name: string; text: string } | null;
  salesPreview: string | null;
  completeDaily: boolean;
  fbaOnlyAttested: boolean;
  ukMarketplaceAttested: boolean;
  inbound: { reference: string; sku: string; qty: string; status: FbaInboundStatus; note: string };
  setCompleteDaily: (value: boolean) => void;
  setFbaOnlyAttested: (value: boolean) => void;
  setUkMarketplaceAttested: (value: boolean) => void;
  setInbound: (value: {
    reference: string;
    sku: string;
    qty: string;
    status: FbaInboundStatus;
    note: string;
  }) => void;
  onSalesFile: (file: File) => void;
  onImportSales: () => void;
  onInbound: () => void;
  onImported: () => void;
}) {
  const { data, inbound, setInbound } = props;
  return (
    <div className="grid gap-6 px-4 py-4 sm:px-6 xl:grid-cols-2">
      <section className="space-y-3 border border-border p-4">
        <h2 className="font-display text-lg">Amazon UK sales</h2>
        <p className="text-[13px] text-steel">
          Upload the latest Amazon UK FBA sell-through file. Without it, shipment quantities stay
          blank.
        </p>
        <label className="block text-[13px]">
          Sales CSV
          <input
            className={`${controlClass} mt-1 w-full`}
            type="file"
            accept=".csv,text/csv"
            aria-label="Amazon UK sales CSV"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) props.onSalesFile(file);
            }}
          />
        </label>
        {props.salesFile ? <p className="text-[13px]">Selected {props.salesFile.name}</p> : null}
        {props.salesPreview ? <p className="text-[13px] text-steel">{props.salesPreview}</p> : null}
        <label className="flex items-start gap-2 text-[13px]">
          <input
            type="checkbox"
            className="mt-1"
            checked={props.fbaOnlyAttested}
            onChange={(event) => props.setFbaOnlyAttested(event.target.checked)}
          />
          I attest every row is Amazon FBA. Merchant-fulfilled orders are not included.
        </label>
        <label className="flex items-start gap-2 text-[13px]">
          <input
            type="checkbox"
            className="mt-1"
            checked={props.ukMarketplaceAttested}
            onChange={(event) => props.setUkMarketplaceAttested(event.target.checked)}
          />
          I attest this extract is Amazon UK only. Required when the file has no marketplace column.
        </label>
        <label className="flex items-start gap-2 text-[13px]">
          <input
            type="checkbox"
            className="mt-1"
            checked={props.completeDaily}
            onChange={(event) => props.setCompleteDaily(event.target.checked)}
          />
          I attest the declared coverage is a complete extract for that range.
        </label>
        <details className="text-[13px] text-steel">
          <summary>File format</summary>
          <p className="mt-2">
            The first rows declare coverage_from, coverage_to, extracted_on, fulfilment_scope FBA
            and, when there is no marketplace column, marketplace_scope AMAZON_UK. Data rows need
            sku, date, units_sold and fulfilment_channel AFN or FBA. MFN, FBM and other marketplaces
            reject the file.
          </p>
        </details>
        <button className={primaryBtnClass} type="button" disabled={props.busy || !data.canManage} onClick={props.onImportSales}>
          Import Amazon sales
        </button>
      </section>
      <section className="space-y-3 border border-border p-4">
        <h2 className="font-display text-lg">FBA stock freshness</h2>
        <p className="text-[13px] text-steel">
          {data.fbaFileName
            ? `${data.fbaFileName} was imported ${ukDate(data.fbaImportedAt?.slice(0, 10))}. ${data.unverifiedFbaSkus.toLocaleString("en-GB")} SKUs are not fresh enough to ship against.`
            : "No OPTIMUS FBA snapshot is stored. A partial file does not refresh SKUs it leaves out."}
        </p>
        <FbaStockImportPanel canManage={data.canManage} onImported={props.onImported} />
      </section>
      <section className="space-y-3 border border-border p-4 xl:col-span-2">
        <h2 className="font-display text-lg">Confirmed inbound</h2>
        <p className="text-[13px] text-steel">
          Only stock confirmed in transit reduces the suggested send. An OIN invoice is not in transit.
        </p>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <label className="text-[13px]">
            Reference
            <input
              className={`${controlClass} mt-1 w-full`}
              value={inbound.reference}
              onChange={(event) => setInbound({ ...inbound, reference: event.target.value })}
            />
          </label>
          <label className="text-[13px]">
            SKU
            <input
              className={`${controlClass} mt-1 w-full`}
              value={inbound.sku}
              onChange={(event) => setInbound({ ...inbound, sku: event.target.value })}
            />
          </label>
          <label className="text-[13px]">
            Quantity
            <input
              className={`${controlClass} mt-1 w-full`}
              value={inbound.qty}
              onChange={(event) => setInbound({ ...inbound, qty: event.target.value })}
            />
          </label>
          <label className="text-[13px]">
            Status
            <select
              className={`${controlClass} mt-1 w-full`}
              value={inbound.status}
              onChange={(event) =>
                setInbound({ ...inbound, status: event.target.value as FbaInboundStatus })
              }
            >
              {FBA_INBOUND_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {status}
                </option>
              ))}
            </select>
          </label>
        </div>
        <button className={btnClass} type="button" disabled={props.busy || !data.canManage} onClick={props.onInbound}>
          Save inbound
        </button>
      </section>
    </div>
  );
}

function SettingsPanel(props: {
  busy: boolean;
  canManage: boolean;
  lead: string;
  cover: string;
  safety: string;
  multiple: string;
  overstock: string;
  setLead: (value: string) => void;
  setCover: (value: string) => void;
  setSafety: (value: string) => void;
  setMultiple: (value: string) => void;
  setOverstock: (value: string) => void;
  onSave: () => void;
}) {
  return (
    <form
      className="max-w-3xl space-y-4 px-4 py-4 sm:px-6"
      onSubmit={(event) => {
        event.preventDefault();
        props.onSave();
      }}
    >
      <p className="text-[13px] text-steel">
        These defaults apply to every SKU. Open a product to set its own lead time, cover, safety
        stock or case multiple.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Lead time (days)" value={props.lead} onChange={props.setLead} />
        <Field label="Target cover (weeks)" value={props.cover} onChange={props.setCover} />
        <Field label="Safety units" value={props.safety} onChange={props.setSafety} />
        <Field label="Case multiple" value={props.multiple} onChange={props.setMultiple} placeholder="No case rule" />
        <Field label="Overstock threshold (weeks)" value={props.overstock} onChange={props.setOverstock} />
      </div>
      <button className={primaryBtnClass} type="submit" disabled={props.busy || !props.canManage}>
        Save settings
      </button>
    </form>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <label className="block text-[13px]">
      {label}
      <input
        className={`${controlClass} mt-1 w-full`}
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}

function SkuDrawer({
  row,
  detail,
  canManage,
  busy,
  override,
  setOverride,
  onSave,
}: {
  row: Row;
  detail: SkuDetail | null;
  canManage: boolean;
  busy: boolean;
  override: {
    sku: string;
    leadTimeDays: string;
    targetCoverWeeks: string;
    safetyStockQty: string;
    caseMultiple: string;
  };
  setOverride: (value: {
    sku: string;
    leadTimeDays: string;
    targetCoverWeeks: string;
    safetyStockQty: string;
    caseMultiple: string;
  }) => void;
  onSave: () => void;
}) {
  return (
    <div className="space-y-5 pr-6">
      <SheetHeader>
        <SheetTitle className="font-mono">{row.sku}</SheetTitle>
        <SheetDescription>{row.description || "No description stored"}</SheetDescription>
      </SheetHeader>
      <StatusBadge tone={tone(row.forecast.recommendation)}>{row.forecast.recommendationLabel}</StatusBadge>
      <p className="text-[13px]">{row.forecast.reason}</p>
      <dl className="grid grid-cols-2 gap-3 text-[13px]">
        <Fact label="FBA UK" value={qty(row.fbaAvailable)} />
        <Fact label="FBA updated" value={ukDate(row.sourceImportedAt?.slice(0, 10))} />
        <Fact label="Studley" value={qty(row.studleyAvailable)} />
        <Fact label="Sold 7d" value={qty(row.amazonUnits.d7)} />
        <Fact label="Sold 30d" value={qty(row.amazonUnits.d30)} />
        <Fact label="Sold 90d" value={qty(row.amazonUnits.d90)} />
        <Fact label="Sold 365d" value={qty(row.amazonUnits.d365)} />
        <Fact label="Velocity" value={rate(row.forecast.weeklyRate)} />
        <Fact label="Confidence" value={row.forecast.confidence} />
        <Fact label="Weeks cover" value={row.forecast.coverWeeks == null ? "—" : row.forecast.coverWeeks.toFixed(1)} />
        <Fact label="Stockout" value={ukDate(row.forecast.stockoutDate)} />
        <Fact label="Next dispatch" value={ukDate(row.forecast.nextSendDate)} />
        <Fact label="Suggested" value={qty(row.forecast.suggestedSendQty)} />
        <Fact label="Dispatchable cases" value={qty(row.forecast.dispatchableQty)} />
        <Fact label="Confirmed inbound" value={qty(row.confirmedInbound)} />
        <Fact label="Purchasing shortfall" value={qty(row.forecast.studleyShortfallQty)} />
      </dl>
      {row.forecast.looseStudleyQty ? (
        <p className="text-[13px] text-steel">
          {qty(row.forecast.looseStudleyQty)} Studley units are loose and are not a shipment.
        </p>
      ) : null}
      <details>
        <summary className="cursor-pointer text-[13px] font-semibold">How this quantity was calculated</summary>
        <ul className="mt-2 list-disc space-y-1 pl-4 text-[13px] text-steel">
          {row.forecast.assumptions.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </details>
      <section>
        <h3 className="text-[12px] font-semibold uppercase tracking-[0.12em]">RETAILA OIN invoices</h3>
        {!detail ? <p className="mt-2 text-[13px] text-steel">Loading invoices…</p> : null}
        {detail && detail.documents.length === 0 ? (
          <p className="mt-2 text-[13px] text-steel">No RETAILA OIN lines for this SKU.</p>
        ) : null}
        <ul className="mt-2 space-y-2 text-[13px]">
          {detail?.documents.map((document) => (
            <li key={`${document.status}-${document.documentReference}`} className="border border-border p-2">
              <div className="font-mono">{document.documentReference}</div>
              <div className="text-steel">
                {ukDate(document.documentDate)} · {document.source} · {document.status} · {qty(document.units)}
              </div>
            </li>
          ))}
        </ul>
      </section>
      {canManage ? (
        <form
          className="space-y-2 border-t border-border pt-4"
          onSubmit={(event) => {
            event.preventDefault();
            onSave();
          }}
        >
          <h3 className="text-[12px] font-semibold uppercase tracking-[0.12em]">This SKU</h3>
          <Field label="Lead days" value={override.leadTimeDays} onChange={(value) => setOverride({ ...override, leadTimeDays: value })} />
          <Field label="Target cover weeks" value={override.targetCoverWeeks} onChange={(value) => setOverride({ ...override, targetCoverWeeks: value })} />
          <Field label="Safety units" value={override.safetyStockQty} onChange={(value) => setOverride({ ...override, safetyStockQty: value })} />
          <Field label="Case multiple" value={override.caseMultiple} onChange={(value) => setOverride({ ...override, caseMultiple: value })} />
          <button className={btnClass} type="submit" disabled={busy}>
            Save SKU settings
          </button>
        </form>
      ) : null}
    </div>
  );
}
