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
import {
  FbaStockPlanningOverview,
  type PlanningRow,
  type StockPlanningSearch,
} from "@/components/purchasing/fba-stock-planning-overview";
import { parseFbaAmazonSalesCsv } from "@/domain/fba-amazon-sales-csv";
import {
  isFbaFocusFilter,
  type FbaSalesActivity,
} from "@/domain/fba-forecast-search";
import {
  FBA_FORECAST_BLOCKER_LABEL,
  FBA_FORECAST_BLOCKERS,
  FBA_INBOUND_STATUSES,
  FBA_RECOMMENDATIONS,
  type FbaForecastBlocker,
  type FbaInboundStatus,
  type FbaRecommendation,
} from "@/domain/fba-replenishment";
import { guardStaffPage } from "@/lib/guard-staff-page";
import {
  approveRetailaPlanningFn,
  disableRetailaPlanningFn,
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
const SORTS = ["priority", "cover", "velocity", "suggested", "sales"] as const;
type Sort = (typeof SORTS)[number];

const HISTORY_WINDOWS = [30, 90, 180, 365] as const;
type HistoryWindow = (typeof HISTORY_WINDOWS)[number];
const LOAD_TIMEOUT_MS = 15_000;

type Search = StockPlanningSearch & {
  tab?: Tab | undefined;
  days?: HistoryWindow | undefined;
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
  const sold = raw["sold"];
  if (sold === "90" || sold === "30" || sold === "all") out.sold = sold;
  if (raw["plan"] === "retaila") out.plan = "retaila";
  const focus = raw["focus"];
  if (isFbaFocusFilter(focus)) out.focus = focus;
  const blocker = raw["blocker"];
  if (FBA_FORECAST_BLOCKERS.some((item) => item === blocker)) {
    out.blocker = blocker as FbaForecastBlocker;
  }
  const tab = raw["tab"];
  if (TABS.some((item) => item === tab)) out.tab = tab as Tab;
  const sku = raw["sku"];
  if (typeof sku === "string" && sku) out.sku = sku;
  const daysRaw = raw["days"];
  const days = typeof daysRaw === "number" ? daysRaw : Number(daysRaw);
  if (HISTORY_WINDOWS.some((item) => item === days) && days !== 90)
    out.days = days as HistoryWindow;
  return out;
}

function settle<T>(request: Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error("The report is taking too long. Retry in a moment."));
    }, LOAD_TIMEOUT_MS);
    request.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error("The FBA forecast could not be loaded."));
      },
    );
  });
}

export const Route = createFileRoute("/purchasing/fba-forecast")({
  beforeLoad: ({ location }) =>
    guardStaffPage("purchasing.fba_forecast.view", location.href, "/purchasing"),
  validateSearch: (raw: Record<string, unknown>) => parseSearch(raw),
  head: () => ({
    meta: [
      { title: "Amazon FBA Stock Planning — Purchasing — Automotive Brands" },
      {
        name: "description",
        content: "Monitor customer sales, stock cover and replenishment requirements.",
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

function FbaForecastPage() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const tab = search.tab ?? "overview";
  const [data, setData] = useState<Data | null>(null);
  const [history, setHistory] = useState<History | null>(null);
  const [detail, setDetail] = useState<SkuDetail | null>(null);
  const [workspaceLoading, setWorkspaceLoading] = useState(true);
  const [workspaceError, setWorkspaceError] = useState<string | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
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
  const [retailaJustification, setRetailaJustification] = useState("");
  const [retailaScope, setRetailaScope] = useState("");

  function patch(next: Partial<Search>) {
    void navigate({ search: { ...search, ...next } });
  }

  useEffect(() => {
    let cancelled = false;
    setWorkspaceLoading(true);
    setWorkspaceError(null);
    // Drop the previous page so counts, rows and export cannot belong to another filter.
    setData(null);
    void settle(
      getFbaForecastWorkspaceFn({
        data: {
          q: search.q,
          page: search.page,
          recommendation: search.recommendation,
          brand: search.brand,
          sort: search.sort,
          sold: search.sold ?? "365",
          plan: search.plan ?? "fba",
          focus: search.focus,
          blocker: search.blocker,
        },
      }),
    )
      .then((result) => {
        if (cancelled) return;
        if (!result.ok) {
          setData(null);
          setWorkspaceError(result.error ?? "The FBA forecast could not be loaded.");
          return;
        }
        setData(result.data);
        setLead(String(result.data.settings.leadTimeDays));
        setCover(String(result.data.settings.targetCoverWeeks));
        setSafety(String(result.data.settings.safetyStockQty));
        setMultiple(
          result.data.settings.caseMultiple == null
            ? ""
            : String(result.data.settings.caseMultiple),
        );
        setOverstock(String(result.data.settings.overstockCoverWeeks));
        setRetailaJustification(result.data.retailaPlanning.justification ?? "");
        setRetailaScope(result.data.retailaPlanning.scope ?? "");
      })
      .catch((caught: unknown) => {
        if (cancelled) return;
        setData(null);
        setWorkspaceError(
          caught instanceof Error ? caught.message : "The FBA forecast could not be loaded.",
        );
      })
      .finally(() => {
        if (!cancelled) setWorkspaceLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [
    search.q,
    search.page,
    search.recommendation,
    search.brand,
    search.sort,
    search.sold,
    search.plan,
    search.focus,
    search.blocker,
    reload,
  ]);

  useEffect(() => {
    if (tab !== "history") return;
    let cancelled = false;
    setHistoryLoading(true);
    setHistoryError(null);
    setHistory(null);
    void settle(
      getFbaOinHistoryFn({ data: { page: search.page, days: search.days ?? 90, q: search.q } }),
    )
      .then((result) => {
        if (cancelled) return;
        if (!result.ok) {
          setHistoryError(result.error ?? "RETAILA OIN history could not be loaded.");
          return;
        }
        setHistory(result.data);
      })
      .catch((caught: unknown) => {
        if (cancelled) return;
        setHistoryError(
          caught instanceof Error ? caught.message : "RETAILA OIN history could not be loaded.",
        );
      })
      .finally(() => {
        if (!cancelled) setHistoryLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [tab, search.page, search.days, search.q, reload]);

  useEffect(() => {
    if (!search.sku) {
      setDetail(null);
      setDetailError(null);
      setDetailLoading(false);
      return;
    }
    let cancelled = false;
    setDetailLoading(true);
    setDetailError(null);
    setDetail(null);
    void settle(getFbaForecastSkuFn({ data: { matchKey: search.sku, days: 90 } }))
      .then((result) => {
        if (cancelled) return;
        if (!result.ok) {
          setDetailError(result.error ?? "RETAILA invoices for this product could not be loaded.");
          return;
        }
        setDetail(result.data);
      })
      .catch((caught: unknown) => {
        if (cancelled) return;
        setDetailError(
          caught instanceof Error
            ? caught.message
            : "RETAILA invoices for this product could not be loaded.",
        );
      })
      .finally(() => {
        if (!cancelled) setDetailLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [search.sku, reload]);

  async function run(action: () => Promise<{ ok: boolean; error?: string }>, done: string) {
    setBusy(true);
    setNotice(null);
    setError(null);
    try {
      const result = await action();
      if (!result.ok) {
        setError(result.error ?? "The FBA forecast action failed.");
        return;
      }
      setNotice(done);
      setReload((value) => value + 1);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The FBA forecast action failed.");
    } finally {
      setBusy(false);
    }
  }

  const selected = data?.rows.find((row) => row.matchKey === search.sku) ?? null;

  return (
    <>
      <PanelHeader
        title="Amazon FBA Stock Planning"
        sub="Monitor customer sales, stock cover and replenishment requirements."
        crumbs={[{ label: "Purchasing" }, { label: "Amazon FBA" }]}
        actions={
          <>
            <span className="inline-flex h-9 items-center border border-border px-3 text-[11px] font-semibold uppercase tracking-[0.12em]">
              Amazon UK
            </span>
            <button
              className={btnClass}
              type="button"
              onClick={() => setStatusOpen((open) => !open)}
            >
              Data status
            </button>
          </>
        }
      />
      {notice ? (
        <p className="border-b border-good/30 bg-good/10 px-4 py-2 text-[13px] text-good sm:px-6">
          {notice}
        </p>
      ) : null}
      {error ? (
        <div className="px-4 py-3 sm:px-6">
          <ErrorState message={error} />
        </div>
      ) : null}
      {workspaceError ? (
        <div className="space-y-2 px-4 py-3 sm:px-6">
          <ErrorState message={workspaceError} />
          <button
            className={btnClass}
            type="button"
            onClick={() => setReload((value) => value + 1)}
          >
            Retry
          </button>
        </div>
      ) : null}
      {data?.oinUnavailable ? (
        <div className="space-y-2 px-4 py-3 sm:px-6">
          <ErrorState message={data.oinUnavailable} />
          <button
            className={btnClass}
            type="button"
            onClick={() => setReload((value) => value + 1)}
          >
            Retry RETAILA history
          </button>
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
        <FbaStockPlanningOverview
          data={data}
          loading={workspaceLoading}
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
                sold: search.sold ?? "365",
                plan: search.plan ?? "fba",
                focus: search.focus,
                blocker: search.blocker,
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
          loading={historyLoading}
          error={historyError}
          days={search.days ?? 90}
          warning={data?.oin.warning ?? null}
          exceptions={data?.latestExceptions ?? []}
          onPage={(page) => patch({ page: page > 1 ? page : undefined })}
          onDays={(days) => patch({ days: days === 90 ? undefined : days, page: undefined })}
          onRetry={() => setReload((value) => value + 1)}
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
          canApprove={data.canApproveRetailaPlanning}
          retailaPlanning={data.retailaPlanning}
          retailaJustification={retailaJustification}
          retailaScope={retailaScope}
          setRetailaJustification={setRetailaJustification}
          setRetailaScope={setRetailaScope}
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
          onApproveRetaila={() => {
            void run(
              () =>
                approveRetailaPlanningFn({
                  data: {
                    justification: retailaJustification.trim(),
                    scope: retailaScope.trim(),
                  },
                }),
              "RETAILA planning mode approved. Recommendations stay estimates until Amazon sell-through is verified separately.",
            );
          }}
          onDisableRetaila={() => {
            void run(
              () => disableRetailaPlanningFn({ data: {} }),
              "RETAILA planning mode disabled. Verified Amazon FBA mode remains available.",
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
              detailLoading={detailLoading}
              detailError={detailError}
              onRetryDetail={() => setReload((value) => value + 1)}
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
              <SheetDescription>
                This product is not on the current page of results.
              </SheetDescription>
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
          data.oinUnavailable
            ? "RETAILA history is unavailable. FBA and Studley stock on this page are still current."
            : data.oin.documents
              ? `${data.oin.documents.toLocaleString("en-GB")} invoices in the last ${data.oin.days} days, latest ${ukDate(data.oin.latestDocumentDate)}. ${data.oin.historicDocuments.toLocaleString("en-GB")} from 561L and ${data.oin.ongoingDocuments.toLocaleString("en-GB")} from TRM21QC.`
              : `No RETAILA customer invoices in the last ${data.oin.days} days.`
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
        title="Forecast unavailable"
        body={
          data.salesActivityUnavailable
            ? "RETAILA customer sales could not be loaded, so sold-product counts are hidden. This is not zero sales."
            : `${data.summary.forecastUnavailable.toLocaleString("en-GB")} products in ${salesScopeLabel(data.salesActivity)} need a demand source, stock snapshot, or approval before a recommendation is shown. Missing Amazon UK FBA proof is not missing RETAILA sales.`
        }
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
      <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-steel">
        {title}
      </div>
      <p className="mt-1 text-[13px]">{body}</p>
    </div>
  );
}

function salesScopeLabel(activity: FbaSalesActivity): string {
  if (activity === "all") return "the full catalogue";
  return `products sold in the last ${activity} days`;
}

function coverBasisCopy(basis: Row["coverBasis"]): string {
  if (basis === "verified_amazon") return "Verified Amazon FBA";
  if (basis === "retaila_planning") return "RETAILA planning estimate";
  if (basis === "illustrative") return "Illustrative (unverified)";
  return "Not available";
}

function SalesSpark({
  d7,
  d30,
  d90,
  d365,
}: {
  d7: number | null;
  d30: number | null;
  d90: number | null;
  d365: number | null;
}) {
  const points = [
    { label: "7d", value: d7 },
    { label: "30d", value: d30 },
    { label: "90d", value: d90 },
    { label: "365d", value: d365 },
  ];
  const max = Math.max(0, ...points.map((point) => point.value ?? 0));
  return (
    <div className="border border-border bg-surface/40 p-3">
      <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-steel">
        Customer sales trend
      </div>
      <div className="mt-3 flex h-16 items-end gap-2">
        {points.map((point) => {
          const height =
            point.value == null || max <= 0 ? 4 : Math.max(6, Math.round((point.value / max) * 56));
          return (
            <div key={point.label} className="flex flex-1 flex-col items-center gap-1">
              <div
                className="w-full bg-primary/70"
                style={{ height }}
                title={point.value == null ? "No figure" : String(point.value)}
              />
              <span className="text-[10px] text-steel">{point.label}</span>
            </div>
          );
        })}
      </div>
    </div>
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
  loading,
  error,
  days,
  warning,
  exceptions,
  onPage,
  onDays,
  onRetry,
}: {
  history: History | null;
  loading: boolean;
  error: string | null;
  days: HistoryWindow;
  warning: string | null;
  exceptions: Data["latestExceptions"];
  onPage: (page: number) => void;
  onDays: (days: HistoryWindow) => void;
  onRetry: () => void;
}) {
  return (
    <div className="space-y-4 px-4 py-4 sm:px-6">
      <p className="max-w-3xl text-[13px] text-steel">
        These are RETAILA customer invoices already stored from 561L history and the ongoing 504/TRM
        feed. The list defaults to the last 90 days. A credit reduces the quantity. An invoice is
        not a shipment in transit, and these rows do not record an Amazon marketplace.
      </p>
      <label className="block max-w-xs text-[13px]">
        Period
        <select
          className={`${controlClass} mt-1 w-full`}
          aria-label="OIN history period"
          value={String(days)}
          onChange={(event) => onDays(Number(event.target.value) as HistoryWindow)}
        >
          {HISTORY_WINDOWS.map((window) => (
            <option key={window} value={window}>
              Last {window} days
            </option>
          ))}
        </select>
      </label>
      {warning ? (
        <p className="border border-warn/40 bg-warn/10 px-3 py-2 text-[13px] text-warn">
          {warning}
        </p>
      ) : null}
      {error ? (
        <div className="space-y-2">
          <ErrorState message={error} />
          <button className={btnClass} type="button" onClick={onRetry}>
            Retry
          </button>
        </div>
      ) : null}
      {loading && !history ? <LoadingState label="Loading RETAILA OIN history…" /> : null}
      {history && history.documents.length === 0 ? (
        <EmptyState
          title="No RETAILA customer invoices"
          body="Nothing beginning with OIN is stored for Autopart account RETAILA in this period. Do not upload the same 504 and TRM files here."
        />
      ) : null}
      {history && history.documents.length > 0 ? (
        <div className="space-y-3">
          {history.documents.map((document) => (
            <article
              key={`${document.status}-${document.documentReference}`}
              className="border border-border p-3"
            >
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
          <Pager
            page={history.page}
            pageSize={history.pageSize}
            total={history.total}
            onPage={onPage}
          />
        </div>
      ) : null}
      {exceptions.length ? (
        <div>
          <h2 className="text-[12px] font-semibold uppercase tracking-[0.12em]">
            Earlier ledger exceptions
          </h2>
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
        <button
          className={primaryBtnClass}
          type="button"
          disabled={props.busy || !data.canManage}
          onClick={props.onImportSales}
        >
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
          Only stock confirmed in transit reduces the suggested send. An OIN invoice is not in
          transit.
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
        <button
          className={btnClass}
          type="button"
          disabled={props.busy || !data.canManage}
          onClick={props.onInbound}
        >
          Save inbound
        </button>
      </section>
    </div>
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

function SettingsPanel(props: {
  busy: boolean;
  canManage: boolean;
  canApprove: boolean;
  retailaPlanning: Data["retailaPlanning"];
  retailaJustification: string;
  retailaScope: string;
  setRetailaJustification: (value: string) => void;
  setRetailaScope: (value: string) => void;
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
  onApproveRetaila: () => void;
  onDisableRetaila: () => void;
}) {
  return (
    <div className="max-w-3xl space-y-8 px-4 py-4 sm:px-6">
      <form
        className="space-y-4"
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
          <Field
            label="Case multiple"
            value={props.multiple}
            onChange={props.setMultiple}
            placeholder="No case rule"
          />
          <Field
            label="Overstock threshold (weeks)"
            value={props.overstock}
            onChange={props.setOverstock}
          />
        </div>
        <button className={primaryBtnClass} type="submit" disabled={props.busy || !props.canManage}>
          Save settings
        </button>
      </form>

      <section className="space-y-3 border border-border bg-surface/40 p-4">
        <h3 className="font-display text-lg font-semibold">RETAILA sales-based planning</h3>
        <p className="text-[13px] text-steel">
          RETAILA OIN invoices are customer sales, not verified Amazon UK FBA sell-through. A Super
          Admin must record the business relationship before this mode can produce planning
          estimates. Approval does not create orders, shipments, purchases or stock movements.
        </p>
        {props.retailaPlanning.enabled ? (
          <div className="space-y-1 border border-border bg-background/40 px-3 py-2 text-[13px]">
            <p>Status: approved planning proxy</p>
            <p>Approved at: {ukDate(props.retailaPlanning.approvedAt?.slice(0, 10))}</p>
            <p className="font-mono text-[12px]">
              Approver: {props.retailaPlanning.approvedByUserId ?? "—"}
            </p>
            <p>Scope: {props.retailaPlanning.scope ?? "—"}</p>
            <p>Justification: {props.retailaPlanning.justification ?? "—"}</p>
          </div>
        ) : (
          <p className="text-[13px] text-steel">
            Status: locked. Sales and illustrative cover remain visible; shipment recommendations
            stay disabled in RETAILA mode.
          </p>
        )}
        <label className="block text-[13px]">
          Business justification
          <textarea
            className={`${controlClass} mt-1 min-h-24 w-full`}
            value={props.retailaJustification}
            onChange={(event) => props.setRetailaJustification(event.target.value)}
            placeholder="Explain why RETAILA invoice demand should plan FBA stock for this scope."
            disabled={!props.canApprove || props.busy}
          />
        </label>
        <label className="block text-[13px]">
          Scope
          <textarea
            className={`${controlClass} mt-1 min-h-20 w-full`}
            value={props.retailaScope}
            onChange={(event) => props.setRetailaScope(event.target.value)}
            placeholder="Brands, SKUs, fulfilment path, or time window covered by this approval."
            disabled={!props.canApprove || props.busy}
          />
        </label>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className={primaryBtnClass}
            disabled={
              props.busy ||
              !props.canApprove ||
              props.retailaJustification.trim().length < 20 ||
              props.retailaScope.trim().length < 10
            }
            onClick={props.onApproveRetaila}
          >
            {props.retailaPlanning.enabled ? "Update approval" : "Approve RETAILA planning"}
          </button>
          <button
            type="button"
            className={btnClass}
            disabled={props.busy || !props.canApprove || !props.retailaPlanning.enabled}
            onClick={props.onDisableRetaila}
          >
            Disable planning mode
          </button>
        </div>
        {!props.canApprove ? (
          <p className="text-[12px] text-steel">Only a Super Admin can approve or disable this mode.</p>
        ) : null}
      </section>
    </div>
  );
}

function SkuDrawer({
  row,
  detail,
  detailLoading,
  detailError,
  onRetryDetail,
  canManage,
  busy,
  override,
  setOverride,
  onSave,
}: {
  row: Row;
  detail: SkuDetail | null;
  detailLoading: boolean;
  detailError: string | null;
  onRetryDetail: () => void;
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
        <SheetTitle>{row.description || row.sku}</SheetTitle>
        <SheetDescription className="font-mono">{row.sku}</SheetDescription>
      </SheetHeader>
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge tone={tone(row.forecast.recommendation)}>
          {row.forecast.blocker
            ? FBA_FORECAST_BLOCKER_LABEL[row.forecast.blocker]
            : row.forecast.recommendationLabel}
        </StatusBadge>
        {row.forecast.planningEstimate ? (
          <StatusBadge tone="info">Planning estimate</StatusBadge>
        ) : null}
      </div>
      <p className="text-[13px]">{row.forecast.reason}</p>
      {row.forecast.blocker ? (
        <p className="border border-border bg-surface/50 px-3 py-2 text-[13px] text-steel">
          {FBA_FORECAST_BLOCKER_LABEL[row.forecast.blocker]}. Resolve this before treating a
          quantity as an operational shipment recommendation.
        </p>
      ) : null}
      <SalesSpark
        d7={row.customerSales.d7}
        d30={row.customerSales.d30}
        d90={row.customerSales.d90}
        d365={row.customerSales.d365}
      />
      <dl className="grid grid-cols-2 gap-3 text-[13px]">
        <Fact label="Demand source" value={row.demand.label} />
        <Fact label="Cover basis" value={coverBasisCopy(row.coverBasis)} />
        <Fact label="FBA UK" value={qty(row.fbaAvailable)} />
        <Fact label="FBA updated" value={ukDate(row.sourceImportedAt?.slice(0, 10))} />
        <Fact label="Studley" value={qty(row.studleyAvailable)} />
        <Fact label="Confirmed inbound" value={qty(row.confirmedInbound)} />
        <Fact label="RETAILA sales 7d" value={qty(row.customerSales.d7)} />
        <Fact label="RETAILA sales 30d" value={qty(row.customerSales.d30)} />
        <Fact label="RETAILA sales 60d" value={qty(row.customerSales.d60)} />
        <Fact label="RETAILA sales 90d" value={qty(row.customerSales.d90)} />
        <Fact label="RETAILA sales 365d" value={qty(row.customerSales.d365)} />
        <Fact label="Avg daily (30d)" value={rate(row.customerDaily)} />
        <Fact label="Avg weekly (30d)" value={rate(row.customerWeekly)} />
        <Fact label="Amazon UK FBA 30d" value={qty(row.amazonUnits.d30)} />
        <Fact
          label="Active cover"
          value={
            row.activeCoverWeeks == null ? "—" : `${row.activeCoverWeeks.toFixed(1)} wks`
          }
        />
        <Fact
          label="Illustrative cover"
          value={row.customerCoverWeeks == null ? "—" : `${row.customerCoverWeeks.toFixed(1)} wks`}
        />
        <Fact label="Planning velocity" value={rate(row.forecast.weeklyRate)} />
        <Fact label="Confidence" value={row.forecast.confidence} />
        <Fact label="Est. stockout" value={ukDate(row.forecast.stockoutDate)} />
        <Fact label="Suggested review" value={ukDate(row.forecast.nextSendDate)} />
        <Fact
          label={row.forecast.planningEstimate ? "Est. replenishment" : "Suggested"}
          value={qty(row.forecast.suggestedSendQty)}
        />
        <Fact label="Available to dispatch" value={qty(row.forecast.dispatchableQty)} />
        <Fact label="Warehouse shortfall" value={qty(row.forecast.studleyShortfallQty)} />
      </dl>
      <p className="text-[12px] text-steel">
        Illustrative cover divides current FBA stock by RETAILA weekly customer sales. It is not
        verified Amazon FBA cover. RETAILA units are never combined with Amazon extract units.
      </p>
      {row.forecast.looseStudleyQty ? (
        <p className="text-[13px] text-steel">
          {qty(row.forecast.looseStudleyQty)} Studley units are loose and are not a shipment.
        </p>
      ) : null}
      <details open>
        <summary className="cursor-pointer text-[13px] font-semibold">
          How this quantity was calculated
        </summary>
        <p className="mt-2 text-[13px] text-steel">{row.demand.reason}</p>
        <ul className="mt-2 list-disc space-y-1 pl-4 text-[13px] text-steel">
          {row.forecast.assumptions.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </details>
      <section>
        <h3 className="text-[12px] font-semibold uppercase tracking-[0.12em]">
          RETAILA customer invoices
        </h3>
        <p className="mt-1 text-[12px] text-steel">
          Last 90 days. Stock balances above are the current snapshot, not this invoice window.
        </p>
        {detailLoading && !detail ? (
          <p className="mt-2 text-[13px] text-steel">Loading invoices…</p>
        ) : null}
        {detailError ? (
          <div className="mt-2 space-y-2">
            <ErrorState message={detailError} />
            <button className={btnClass} type="button" onClick={onRetryDetail}>
              Retry
            </button>
          </div>
        ) : null}
        {detail && detail.documents.length === 0 ? (
          <p className="mt-2 text-[13px] text-steel">
            No RETAILA OIN lines for this SKU in the last 90 days.
          </p>
        ) : null}
        <ul className="mt-2 space-y-2 text-[13px]">
          {detail?.documents.map((document) => (
            <li
              key={`${document.status}-${document.documentReference}`}
              className="border border-border p-2"
            >
              <div className="font-mono">{document.documentReference}</div>
              <div className="text-steel">
                {ukDate(document.documentDate)} · {document.source} · {document.status} ·{" "}
                {qty(document.units)}
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
          <Field
            label="Lead days"
            value={override.leadTimeDays}
            onChange={(value) => setOverride({ ...override, leadTimeDays: value })}
          />
          <Field
            label="Target cover weeks"
            value={override.targetCoverWeeks}
            onChange={(value) => setOverride({ ...override, targetCoverWeeks: value })}
          />
          <Field
            label="Safety units"
            value={override.safetyStockQty}
            onChange={(value) => setOverride({ ...override, safetyStockQty: value })}
          />
          <Field
            label="Case multiple"
            value={override.caseMultiple}
            onChange={(value) => setOverride({ ...override, caseMultiple: value })}
          />
          <button className={btnClass} type="submit" disabled={busy}>
            Save SKU settings
          </button>
        </form>
      ) : null}
    </div>
  );
}
