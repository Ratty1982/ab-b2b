import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { StatusBadge } from "@/components/ab/Badges";
import {
  SalesIntelligenceHeader,
  SiClearFiltersButton,
  SiEntityContext,
  SiExportButton,
  SiField,
  SiMetricCard,
  SiPager,
  SiPeriodSummary,
  SiProvenance,
  SiStickyTableHead,
  siControlClassName,
} from "@/components/sales-intelligence/workspace";
import { ROUTES } from "@/lib/app-nav";
import { cn } from "@/lib/utils";
import { formatGbp } from "@/domain/sales-intelligence";
import { shouldShowEntitySuggestions } from "@/domain/sales-intelligence-ux";
import {
  compactRebateUrlSearch,
  parseRebateUrlSearch,
  type RebateMode,
  type RebateTab,
  type RebateUrlSearch,
} from "@/domain/sales-rebate";
import type { RebatePeriodPreset } from "@/domain/sales-history-period";
import {
  exportCustomerRebateDocumentsCsvFn,
  exportCustomerRebateProductsCsvFn,
  exportCustomerRebateSummaryCsvFn,
  exportMultiCustomerRebateCsvFn,
  getCustomerRebateAnalysisFn,
  getMultiCustomerRebateAnalysisFn,
  searchSalesIntelligenceCustomersFn,
} from "@/server/phase2/fns";

export const Route = createFileRoute("/sales/sales-intelligence/rebates")({
  validateSearch: (search: Record<string, unknown>): RebateUrlSearch =>
    parseRebateUrlSearch(search),
  head: () => ({
    meta: [
      { title: "Rebate Analysis — Sales Intelligence — Automotive Brands" },
      {
        name: "description",
        content:
          "Trusted historic net spend analysis for customer rebate checking. Invoice and credit activity from Autopart imports.",
      },
    ],
  }),
  component: RebateAnalysisPage,
});

type CustomerHit = {
  id: string;
  name: string;
  autopartCustomerCode: string | null;
  accountNumber: string | null;
  salesperson: { name: string } | null;
  paymentTerms: string | null;
};

type CustomerData = Extract<
  Awaited<ReturnType<typeof getCustomerRebateAnalysisFn>>,
  { ok: true }
>["data"];

type MultiData = Extract<
  Awaited<ReturnType<typeof getMultiCustomerRebateAnalysisFn>>,
  { ok: true }
>["data"];

const PERIOD_OPTIONS: Array<{ value: RebatePeriodPreset; label: string }> = [
  { value: "THIS_MONTH", label: "This month" },
  { value: "LAST_MONTH", label: "Last month" },
  { value: "THIS_QUARTER", label: "This quarter" },
  { value: "PREVIOUS_QUARTER", label: "Previous quarter" },
  { value: "YTD", label: "Year to date" },
  { value: "LAST_YEAR", label: "Previous calendar year" },
  { value: "LAST_90", label: "Last 3 months" },
  { value: "LAST_180", label: "Last 6 months" },
  { value: "LAST_365", label: "Last 12 months" },
  { value: "CUSTOM", label: "Custom" },
];

function gbp(value: string) {
  return formatGbp(value);
}

function downloadBlob(csv: string, filename: string) {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function RebateModeSwitch({
  mode,
  onChange,
}: {
  mode: RebateMode;
  onChange: (mode: RebateMode) => void;
}) {
  return (
    <div
      className="inline-flex rounded-md border border-border p-0.5"
      role="tablist"
      aria-label="Rebate mode"
    >
      {(
        [
          ["customer", "Customer"],
          ["multi", "Multi-Customer"],
        ] as const
      ).map(([value, label]) => (
        <button
          key={value}
          type="button"
          role="tab"
          aria-selected={mode === value}
          onClick={() => onChange(value)}
          className={cn(
            "h-8 rounded px-3.5 text-[11px] font-bold uppercase tracking-wide",
            mode === value
              ? "bg-primary text-primary-foreground"
              : "text-steel hover:text-foreground",
          )}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function RebateAnalysisPage() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const mode: RebateMode = search.mode ?? "customer";
  const period = (search.period ?? "CUSTOM") as RebatePeriodPreset;
  const compare = search.compare ?? "OFF";
  const tab: RebateTab = search.tab ?? "documents";
  const docType = search.docType ?? "ALL";
  const page = search.page ?? 1;
  const docPage = search.docPage ?? 1;
  const sort = search.sort ?? "NET_DESC";

  const [customerQ, setCustomerQ] = useState("");
  const [changingEntity, setChangingEntity] = useState(false);
  const [customerHits, setCustomerHits] = useState<CustomerHit[]>([]);
  const [filterQ, setFilterQ] = useState(search.q ?? "");
  const [customerData, setCustomerData] = useState<CustomerData | null>(null);
  const [multiData, setMultiData] = useState<MultiData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exportOpen, setExportOpen] = useState(false);

  function patch(next: Partial<Record<keyof RebateUrlSearch, string | number | boolean | null>>) {
    const draft: RebateUrlSearch = {};
    const nextMode = (next.mode as RebateMode | undefined) ?? mode;
    const nextCompany =
      next.companyId === null ? undefined : ((next.companyId as string | undefined) ?? search.companyId);
    const nextPeriod = (next.period as RebatePeriodPreset | undefined) ?? period;
    const nextFrom = next.from === null ? undefined : ((next.from as string | undefined) ?? search.from);
    const nextTo = next.to === null ? undefined : ((next.to as string | undefined) ?? search.to);
    const nextCompare =
      (next.compare as RebateUrlSearch["compare"] | undefined) ??
      (compare === "OFF" ? undefined : compare);
    const nextCompareFrom =
      next.compareFrom === null
        ? undefined
        : ((next.compareFrom as string | undefined) ?? search.compareFrom);
    const nextCompareTo =
      next.compareTo === null
        ? undefined
        : ((next.compareTo as string | undefined) ?? search.compareTo);
    const nextTab = (next.tab as RebateTab | undefined) ?? tab;
    const nextDocType =
      next.docType === null
        ? undefined
        : ((next.docType as RebateUrlSearch["docType"] | undefined) ??
          (docType === "ALL" ? undefined : docType));
    const nextBrand =
      next.brandId === null ? undefined : ((next.brandId as string | undefined) ?? search.brandId);
    const nextCat =
      next.categoryId === null
        ? undefined
        : ((next.categoryId as string | undefined) ?? search.categoryId);
    const nextCatalogue =
      next.catalogue === null
        ? undefined
        : ((next.catalogue as RebateUrlSearch["catalogue"] | undefined) ?? search.catalogue);
    const nextQ = next.q === null ? undefined : ((next.q as string | undefined) ?? search.q);
    const nextRep =
      next.salesRepId === null
        ? undefined
        : ((next.salesRepId as string | undefined) ?? search.salesRepId);
    const nextMin =
      next.minNet === null ? undefined : ((next.minNet as string | undefined) ?? search.minNet);
    const nextMax =
      next.maxNet === null ? undefined : ((next.maxNet as string | undefined) ?? search.maxNet);
    const nextSort =
      (next.sort as RebateUrlSearch["sort"] | undefined) ?? (sort === "NET_DESC" ? undefined : sort);
    const nextPage = (next.page as number | undefined) ?? page;
    const nextDocPage = (next.docPage as number | undefined) ?? docPage;
    const nextDocRef =
      next.docRef === null ? undefined : ((next.docRef as string | undefined) ?? search.docRef);

    if (nextMode !== "customer") draft.mode = nextMode;
    if (nextCompany) draft.companyId = nextCompany;
    if (nextPeriod !== "CUSTOM") draft.period = nextPeriod;
    if (nextPeriod === "CUSTOM" || nextFrom || nextTo) {
      if (nextFrom) draft.from = nextFrom;
      if (nextTo) draft.to = nextTo;
    }
    if (nextCompare && nextCompare !== "OFF") draft.compare = nextCompare;
    if (nextCompare === "CUSTOM") {
      if (nextCompareFrom) draft.compareFrom = nextCompareFrom;
      if (nextCompareTo) draft.compareTo = nextCompareTo;
    }
    if (nextTab !== "documents") draft.tab = nextTab;
    if (nextDocType && nextDocType !== "ALL") draft.docType = nextDocType;
    if (nextBrand) draft.brandId = nextBrand;
    if (nextCat) draft.categoryId = nextCat;
    if (nextCatalogue && nextCatalogue !== "ALL") draft.catalogue = nextCatalogue;
    if (nextQ) draft.q = nextQ;
    if (nextRep) draft.salesRepId = nextRep;
    if (nextMin) draft.minNet = nextMin;
    if (nextMax) draft.maxNet = nextMax;
    if (nextSort && nextSort !== "NET_DESC") draft.sort = nextSort;
    if (nextPage > 1) draft.page = nextPage;
    if (nextDocPage > 1) draft.docPage = nextDocPage;
    if (nextDocRef) draft.docRef = nextDocRef;
    void navigate({ search: compactRebateUrlSearch(draft) });
  }

  useEffect(() => {
    if (mode !== "customer" || customerQ.trim().length < 1) {
      setCustomerHits([]);
      return;
    }
    const t = window.setTimeout(() => {
      void searchSalesIntelligenceCustomersFn({ data: { q: customerQ.trim(), limit: 15 } }).then(
        (r) => {
          if (r.ok) setCustomerHits(r.data.items as CustomerHit[]);
        },
      );
    }, 200);
    return () => window.clearTimeout(t);
  }, [customerQ, mode]);

  useEffect(() => {
    const t = window.setTimeout(() => {
      if ((filterQ.trim() || "") === (search.q ?? "")) return;
      patch({ q: filterQ.trim() || null, page: 1, docPage: 1 });
    }, 250);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterQ]);

  useEffect(() => {
    setFilterQ(search.q ?? "");
  }, [search.q]);

  useEffect(() => {
    setChangingEntity(false);
    setCustomerQ("");
    setCustomerHits([]);
  }, [search.companyId, mode]);

  useEffect(() => {
    if (mode !== "customer" || !search.companyId) {
      setCustomerData(null);
      return;
    }
    void (async () => {
      setLoading(true);
      const r = await getCustomerRebateAnalysisFn({
        data: {
          companyId: search.companyId,
          period,
          from: search.from ?? null,
          to: search.to ?? null,
          compare,
          compareFrom: search.compareFrom ?? null,
          compareTo: search.compareTo ?? null,
          q: search.q ?? null,
          docType: search.docType ?? "ALL",
          brandId: search.brandId ?? null,
          categoryId: search.categoryId ?? null,
          catalogue: search.catalogue ?? "ALL",
          page,
          docPage,
          pageSize: 25,
          docRef: search.docRef ?? null,
        },
      });
      if (!r.ok) {
        setError(r.error);
        setCustomerData(null);
      } else {
        setError(null);
        setCustomerData(r.data);
      }
      setLoading(false);
    })();
  }, [
    mode,
    search.companyId,
    period,
    search.from,
    search.to,
    compare,
    search.compareFrom,
    search.compareTo,
    search.q,
    search.docType,
    search.brandId,
    search.categoryId,
    search.catalogue,
    page,
    docPage,
    search.docRef,
  ]);

  useEffect(() => {
    if (mode !== "multi") {
      setMultiData(null);
      return;
    }
    void (async () => {
      setLoading(true);
      const r = await getMultiCustomerRebateAnalysisFn({
        data: {
          period,
          from: search.from ?? null,
          to: search.to ?? null,
          compare,
          compareFrom: search.compareFrom ?? null,
          compareTo: search.compareTo ?? null,
          q: search.q ?? null,
          salesRepId: search.salesRepId ?? null,
          minNet: search.minNet ?? null,
          maxNet: search.maxNet ?? null,
          sort,
          page,
          pageSize: 25,
        },
      });
      if (!r.ok) {
        setError(r.error);
        setMultiData(null);
      } else {
        setError(null);
        setMultiData(r.data);
      }
      setLoading(false);
    })();
  }, [
    mode,
    period,
    search.from,
    search.to,
    compare,
    search.compareFrom,
    search.compareTo,
    search.q,
    search.salesRepId,
    search.minNet,
    search.maxNet,
    sort,
    page,
  ]);

  const customerSelected = mode === "customer" && Boolean(search.companyId);
  const showCustomerHits = shouldShowEntitySuggestions({
    entitySelected: customerSelected,
    changing: changingEntity,
    queryLength: customerQ.trim().length,
    hitCount: customerHits.length,
  });

  const docTotalPages = useMemo(() => {
    if (!customerData) return 1;
    return Math.max(1, Math.ceil(customerData.documents.total / customerData.documents.pageSize));
  }, [customerData]);

  const productTotalPages = useMemo(() => {
    if (!customerData) return 1;
    return Math.max(1, Math.ceil(customerData.products.total / customerData.products.pageSize));
  }, [customerData]);

  const multiTotalPages = useMemo(() => {
    if (!multiData) return 1;
    return Math.max(1, Math.ceil(multiData.customers.total / multiData.customers.pageSize));
  }, [multiData]);

  async function exportCustomer(kind: "summary" | "documents" | "products") {
    if (!search.companyId) return;
    const payload = {
      companyId: search.companyId,
      period,
      from: search.from ?? null,
      to: search.to ?? null,
    };
    const fn =
      kind === "summary"
        ? exportCustomerRebateSummaryCsvFn
        : kind === "documents"
          ? exportCustomerRebateDocumentsCsvFn
          : exportCustomerRebateProductsCsvFn;
    const r = await fn({ data: payload });
    if (!r.ok) {
      setError(r.error);
      return;
    }
    downloadBlob(r.data.csv, r.data.filename);
    setExportOpen(false);
  }

  async function exportMulti() {
    const r = await exportMultiCustomerRebateCsvFn({
      data: {
        period,
        from: search.from ?? null,
        to: search.to ?? null,
        q: search.q ?? null,
        salesRepId: search.salesRepId ?? null,
        minNet: search.minNet ?? null,
        maxNet: search.maxNet ?? null,
        sort,
      },
    });
    if (!r.ok) {
      setError(r.error);
      return;
    }
    downloadBlob(r.data.csv, r.data.filename);
  }

  return (
    <div className="min-h-full bg-background print:bg-white">
      <SalesIntelligenceHeader
        title="Rebate / Net Spend Analysis"
        actions={
          <>
            <RebateModeSwitch
              mode={mode}
              onChange={(m) =>
                patch({
                  mode: m === "customer" ? null : m,
                  companyId: m === "multi" ? null : search.companyId ?? null,
                  page: 1,
                  docPage: 1,
                  docRef: null,
                })
              }
            />
            {mode === "customer" && search.companyId ? (
              <div className="relative">
                <SiExportButton onClick={() => setExportOpen((v) => !v)} />
                {exportOpen ? (
                  <div className="absolute right-0 z-20 mt-1 w-52 rounded-md border border-border bg-card py-1 shadow-md print:hidden">
                    <button
                      type="button"
                      className="block w-full px-3 py-1.5 text-left text-xs hover:bg-muted"
                      onClick={() => void exportCustomer("summary")}
                    >
                      Export summary
                    </button>
                    <button
                      type="button"
                      className="block w-full px-3 py-1.5 text-left text-xs hover:bg-muted"
                      onClick={() => void exportCustomer("documents")}
                    >
                      Export documents
                    </button>
                    <button
                      type="button"
                      className="block w-full px-3 py-1.5 text-left text-xs hover:bg-muted"
                      onClick={() => void exportCustomer("products")}
                    >
                      Export product breakdown
                    </button>
                    <button
                      type="button"
                      className="block w-full px-3 py-1.5 text-left text-xs hover:bg-muted"
                      onClick={() => window.print()}
                    >
                      Print report
                    </button>
                  </div>
                ) : null}
              </div>
            ) : null}
            {mode === "multi" ? <SiExportButton onClick={() => void exportMulti()} /> : null}
          </>
        }
      />

      <div className="space-y-4 px-4 py-4 sm:px-6">
        {error ? (
          <p className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
            {error}
          </p>
        ) : null}

        <div className="flex flex-wrap items-end gap-3 print:hidden">
          <SiField label="Period">
            <select
              className={siControlClassName()}
              value={period}
              onChange={(e) =>
                patch({
                  period: e.target.value as RebatePeriodPreset,
                  page: 1,
                  docPage: 1,
                })
              }
            >
              {PERIOD_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </SiField>
          {period === "CUSTOM" ? (
            <>
              <SiField label="From">
                <input
                  type="date"
                  className={siControlClassName()}
                  value={search.from ?? ""}
                  onChange={(e) => patch({ from: e.target.value || null, page: 1 })}
                />
              </SiField>
              <SiField label="To">
                <input
                  type="date"
                  className={siControlClassName()}
                  value={search.to ?? ""}
                  onChange={(e) => patch({ to: e.target.value || null, page: 1 })}
                />
              </SiField>
            </>
          ) : null}
          <SiField label="Compare">
            <select
              className={siControlClassName(compare !== "OFF")}
              value={compare}
              onChange={(e) =>
                patch({
                  compare: e.target.value as "OFF" | "PREVIOUS" | "PREVIOUS_YEAR" | "CUSTOM",
                  page: 1,
                })
              }
            >
              <option value="OFF">Off</option>
              <option value="PREVIOUS">Previous equivalent period</option>
              <option value="PREVIOUS_YEAR">Same period previous year</option>
              <option value="CUSTOM">Custom comparison</option>
            </select>
          </SiField>
          {compare === "CUSTOM" ? (
            <>
              <SiField label="Compare from">
                <input
                  type="date"
                  className={siControlClassName()}
                  value={search.compareFrom ?? ""}
                  onChange={(e) => patch({ compareFrom: e.target.value || null })}
                />
              </SiField>
              <SiField label="Compare to">
                <input
                  type="date"
                  className={siControlClassName()}
                  value={search.compareTo ?? ""}
                  onChange={(e) => patch({ compareTo: e.target.value || null })}
                />
              </SiField>
            </>
          ) : null}
        </div>

        {mode === "customer" ? (
          <>
            {!search.companyId || changingEntity ? (
              <div className="print:hidden">
                <SiField label="Customer">
                  <input
                    className={siControlClassName(true)}
                    placeholder="Search company, trading name, Autopart account…"
                    value={customerQ}
                    onChange={(e) => setCustomerQ(e.target.value)}
                    autoFocus
                  />
                </SiField>
                {showCustomerHits ? (
                  <ul className="mt-1 max-h-64 overflow-auto rounded-md border border-border bg-card">
                    {customerHits.map((h) => (
                      <li key={h.id}>
                        <button
                          type="button"
                          className="flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left text-sm hover:bg-muted"
                          onClick={() => {
                            patch({ companyId: h.id, page: 1, docPage: 1, docRef: null });
                            setChangingEntity(false);
                          }}
                        >
                          <span className="font-medium">{h.name}</span>
                          <span className="text-[11px] text-steel">
                            {[
                              h.autopartCustomerCode,
                              h.salesperson?.name,
                              h.paymentTerms,
                            ]
                              .filter(Boolean)
                              .join(" · ")}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : null}
                {!search.companyId && !customerQ.trim() ? (
                  <p className="mt-6 text-sm text-steel">
                    Select a customer to analyse historic net spend for rebate checking.
                  </p>
                ) : null}
              </div>
            ) : null}

            {customerData ? (
              <>
                <div className="print:block">
                  <p className="hidden text-[10px] font-bold uppercase tracking-[0.18em] text-steel print:block">
                    {customerData.print.organisation} — {customerData.print.title}
                  </p>
                  <SiEntityContext
                    title={customerData.company.name}
                    meta={[
                      customerData.company.autopartCustomerCode ??
                        customerData.company.accountNumber ??
                        "",
                      customerData.company.salesperson?.name ?? "",
                      customerData.company.paymentTerms ?? "",
                    ].filter(Boolean)}
                    onChange={() => setChangingEntity(true)}
                  />
                  <SiPeriodSummary
                    selectedFrom={customerData.period.from}
                    selectedTo={customerData.period.to}
                    comparisonFrom={customerData.comparison?.comparison.from}
                    comparisonTo={customerData.comparison?.comparison.to}
                  />
                  <p className="mt-1 hidden text-[11px] text-steel print:block">
                    Generated {new Date(customerData.print.generatedAt).toLocaleString("en-GB")}
                  </p>
                </div>

                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <SiMetricCard
                    label="Net spend"
                    value={gbp(customerData.summary.netSpend)}
                    primary
                  />
                  <SiMetricCard
                    label="Invoice sales"
                    value={gbp(customerData.summary.invoiceSales)}
                  />
                  <SiMetricCard
                    label="Credits"
                    value={gbp(customerData.summary.credits)}
                  />
                  <SiMetricCard
                    label="Units"
                    value={String(customerData.summary.units)}
                  />
                </div>
                <div className="grid gap-3 sm:grid-cols-3">
                  <SiMetricCard
                    label="Invoice documents"
                    value={String(customerData.summary.invoiceDocuments)}
                  />
                  <SiMetricCard
                    label="Credit documents"
                    value={String(customerData.summary.creditDocuments)}
                  />
                  <SiMetricCard
                    label="Products"
                    value={String(customerData.summary.products)}
                  />
                </div>

                {customerData.comparison?.netSpend ? (
                  <div className="grid gap-3 sm:grid-cols-3 print:hidden">
                    <SiMetricCard
                      label="Net spend (selected)"
                      value={gbp(customerData.comparison.netSpend.primary)}
                    />
                    <SiMetricCard
                      label="Net spend (comparison)"
                      value={gbp(customerData.comparison.netSpend.comparison)}
                    />
                    <SiMetricCard
                      label="Change"
                      value={`${gbp(customerData.comparison.netSpend.difference)}${
                        customerData.comparison.netSpend.percentChange != null
                          ? ` / ${customerData.comparison.netSpend.percentChange.toFixed(1)}%`
                          : ""
                      }`}
                    />
                  </div>
                ) : null}

                <p className="text-[11px] text-steel">{customerData.disclaimer}</p>
                {customerData.undatedExcluded > 0 ? (
                  <p className="text-[11px] text-steel">
                    {customerData.undatedExcluded} undated historic record
                    {customerData.undatedExcluded === 1 ? "" : "s"} excluded from this period.
                  </p>
                ) : null}
                {customerData.filtersActive && customerData.filtered ? (
                  <p className="text-[11px] font-medium text-foreground">
                    Filtered net spend: {gbp(customerData.filtered.netSpend)} (
                    {customerData.filtered.documents} documents / {customerData.filtered.products}{" "}
                    products). Headline totals above are unfiltered.
                  </p>
                ) : null}

                <div className="flex flex-wrap gap-1 border-b border-border/70 print:hidden">
                  {(
                    [
                      ["documents", "Documents"],
                      ["products", "Products"],
                      ["brands", "Brands"],
                      ["categories", "Categories"],
                    ] as const
                  ).map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => patch({ tab: value === "documents" ? null : value })}
                      className={cn(
                        "h-9 px-3 text-[11px] font-bold uppercase tracking-wide",
                        tab === value
                          ? "border-b-2 border-primary text-foreground"
                          : "text-steel hover:text-foreground",
                      )}
                    >
                      {label}
                    </button>
                  ))}
                </div>

                <div className="flex flex-wrap items-end gap-3 print:hidden">
                  <SiField label="Search">
                    <input
                      className={siControlClassName(Boolean(filterQ))}
                      placeholder="Document / SKU / product"
                      value={filterQ}
                      onChange={(e) => setFilterQ(e.target.value)}
                    />
                  </SiField>
                  {tab === "documents" ? (
                    <SiField label="Document type">
                      <select
                        className={siControlClassName(docType !== "ALL")}
                        value={docType}
                        onChange={(e) =>
                          patch({
                            docType: e.target.value === "ALL" ? null : e.target.value,
                            docPage: 1,
                          })
                        }
                      >
                        <option value="ALL">All</option>
                        <option value="INVOICE">Invoices</option>
                        <option value="CREDIT">Credits</option>
                      </select>
                    </SiField>
                  ) : null}
                  {tab === "products" ? (
                    <>
                      <SiField label="Brand">
                        <select
                          className={siControlClassName(Boolean(search.brandId))}
                          value={search.brandId ?? ""}
                          onChange={(e) =>
                            patch({ brandId: e.target.value || null, page: 1 })
                          }
                        >
                          <option value="">All brands</option>
                          {customerData.filterOptions.brands.map((b) => (
                            <option key={b.id} value={b.id}>
                              {b.name}
                            </option>
                          ))}
                        </select>
                      </SiField>
                      <SiField label="Category">
                        <select
                          className={siControlClassName(Boolean(search.categoryId))}
                          value={search.categoryId ?? ""}
                          onChange={(e) =>
                            patch({ categoryId: e.target.value || null, page: 1 })
                          }
                        >
                          <option value="">All categories</option>
                          {customerData.filterOptions.categories.map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.name}
                            </option>
                          ))}
                        </select>
                      </SiField>
                      <SiField label="Catalogue">
                        <select
                          className={siControlClassName(
                            Boolean(search.catalogue && search.catalogue !== "ALL"),
                          )}
                          value={search.catalogue ?? "ALL"}
                          onChange={(e) =>
                            patch({
                              catalogue: e.target.value === "ALL" ? null : e.target.value,
                              page: 1,
                            })
                          }
                        >
                          <option value="ALL">All</option>
                          <option value="CATALOGUE">Current catalogue</option>
                          <option value="HISTORIC">Historic only</option>
                        </select>
                      </SiField>
                    </>
                  ) : null}
                  <SiClearFiltersButton
                    onClick={() =>
                      patch({
                        q: null,
                        docType: null,
                        brandId: null,
                        categoryId: null,
                        catalogue: null,
                        page: 1,
                        docPage: 1,
                      })
                    }
                  />
                </div>

                {loading ? <p className="text-sm text-steel">Loading…</p> : null}

                {tab === "documents" ? (
                  <>
                    {customerData.documents.total === 0 ? (
                      <p className="text-sm text-steel">
                        {docType === "INVOICE"
                          ? "No invoices found."
                          : docType === "CREDIT"
                            ? "No credits found."
                            : "No dated historic sales found in this period."}
                      </p>
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="w-full min-w-[720px] text-left text-sm">
                          <SiStickyTableHead>
                            <tr className="border-b border-border text-[10px] font-bold uppercase tracking-wide text-steel">
                              <th className="py-2 pr-3">Date</th>
                              <th className="py-2 pr-3">Document</th>
                              <th className="py-2 pr-3">Type</th>
                              <th className="py-2 pr-3">Product lines</th>
                              <th className="py-2 pr-3">Units</th>
                              <th className="py-2 pr-3">Net value</th>
                              <th className="py-2 print:hidden">Action</th>
                            </tr>
                          </SiStickyTableHead>
                          <tbody>
                            {customerData.documents.items.map((d) => {
                              const open = search.docRef === d.documentReference;
                              return (
                                <tr
                                  key={`${d.documentType}:${d.documentReference}`}
                                  className="border-b border-border/60 align-top"
                                >
                                  <td className="py-2 pr-3 whitespace-nowrap">
                                    {d.documentDate
                                      ? new Date(`${d.documentDate}T12:00:00Z`).toLocaleDateString(
                                          "en-GB",
                                        )
                                      : "—"}
                                  </td>
                                  <td className="py-2 pr-3 font-medium">{d.documentReference}</td>
                                  <td className="py-2 pr-3">
                                    {d.documentType === "CREDIT" ? "Credit" : "Invoice"}
                                  </td>
                                  <td className="py-2 pr-3">{d.lineCount} lines</td>
                                  <td className="py-2 pr-3">{d.units}</td>
                                  <td className="py-2 pr-3">{gbp(d.netValue)}</td>
                                  <td className="py-2 print:hidden">
                                    <button
                                      type="button"
                                      className="text-[11px] font-bold uppercase tracking-wide text-primary"
                                      onClick={() =>
                                        patch({
                                          docRef: open ? null : d.documentReference,
                                        })
                                      }
                                    >
                                      {open ? "Hide" : "View"}
                                    </button>
                                    {open && customerData.expandedDocument ? (
                                      <div className="mt-2 min-w-[280px] rounded border border-border/70 bg-muted/30 p-2 text-xs">
                                        <p className="font-medium">
                                          {customerData.expandedDocument.documentReference} ·{" "}
                                          {customerData.expandedDocument.documentType === "CREDIT"
                                            ? "Credit"
                                            : "Invoice"}{" "}
                                          · {gbp(customerData.expandedDocument.netValue)}
                                        </p>
                                        <p className="text-steel">
                                          {customerData.company.name} ·{" "}
                                          {customerData.company.autopartCustomerCode ??
                                            customerData.company.accountNumber}
                                        </p>
                                        <table className="mt-2 w-full">
                                          <thead>
                                            <tr className="text-[10px] uppercase text-steel">
                                              <th className="py-1 pr-2 text-left">SKU</th>
                                              <th className="py-1 pr-2 text-left">Description</th>
                                              <th className="py-1 pr-2 text-left">Qty</th>
                                              <th className="py-1 text-left">Net</th>
                                            </tr>
                                          </thead>
                                          <tbody>
                                            {customerData.expandedDocument.lines.map((ln, i) => (
                                              <tr key={`${ln.sku}-${i}`}>
                                                <td className="py-0.5 pr-2">{ln.sku}</td>
                                                <td className="py-0.5 pr-2">
                                                  {ln.description ?? "—"}
                                                  {ln.brandName || ln.categoryName ? (
                                                    <span className="block text-[10px] text-steel">
                                                      {[ln.brandName, ln.categoryName]
                                                        .filter(Boolean)
                                                        .join(" · ")}
                                                    </span>
                                                  ) : null}
                                                </td>
                                                <td className="py-0.5 pr-2">{ln.units}</td>
                                                <td className="py-0.5">{gbp(ln.netValue)}</td>
                                              </tr>
                                            ))}
                                          </tbody>
                                        </table>
                                      </div>
                                    ) : null}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}
                    <SiPager
                      page={docPage}
                      totalPages={docTotalPages}
                      total={customerData.documents.total}
                      onPage={(p) => patch({ docPage: p })}
                    />
                  </>
                ) : null}

                {tab === "products" ? (
                  <>
                    {customerData.products.total === 0 ? (
                      <p className="text-sm text-steel">No products match these filters.</p>
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="w-full min-w-[900px] text-left text-sm">
                          <SiStickyTableHead>
                            <tr className="border-b border-border text-[10px] font-bold uppercase tracking-wide text-steel">
                              <th className="py-2 pr-3">Product</th>
                              <th className="py-2 pr-3">SKU</th>
                              <th className="py-2 pr-3">Brand</th>
                              <th className="py-2 pr-3">Category</th>
                              <th className="py-2 pr-3">Invoice sales</th>
                              <th className="py-2 pr-3">Credits</th>
                              <th className="py-2 pr-3">Net spend</th>
                              <th className="py-2 pr-3">Net units</th>
                              <th className="py-2 pr-3">Invoice docs</th>
                              <th className="py-2">Last purchased</th>
                            </tr>
                          </SiStickyTableHead>
                          <tbody>
                            {customerData.products.items.map((p) => (
                              <tr key={p.sku} className="border-b border-border/60">
                                <td className="py-2 pr-3">
                                  {p.name}
                                  {p.historicOnly ? (
                                    <StatusBadge tone="neutral" className="ml-2">
                                      Historic only
                                    </StatusBadge>
                                  ) : null}
                                </td>
                                <td className="py-2 pr-3">{p.sku}</td>
                                <td className="py-2 pr-3">{p.brandName ?? "Unassigned"}</td>
                                <td className="py-2 pr-3">{p.categoryName ?? "Unassigned"}</td>
                                <td className="py-2 pr-3">{gbp(p.invoiceSales)}</td>
                                <td className="py-2 pr-3">{gbp(p.credits)}</td>
                                <td className="py-2 pr-3 font-medium">{gbp(p.netSpend)}</td>
                                <td className="py-2 pr-3">{p.units}</td>
                                <td className="py-2 pr-3">{p.invoiceDocuments}</td>
                                <td className="py-2">
                                  {p.lastPurchasedDate
                                    ? new Date(
                                        `${p.lastPurchasedDate}T12:00:00Z`,
                                      ).toLocaleDateString("en-GB")
                                    : "—"}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                    <SiPager
                      page={page}
                      totalPages={productTotalPages}
                      total={customerData.products.total}
                      onPage={(p) => patch({ page: p })}
                    />
                  </>
                ) : null}

                {tab === "brands" ? (
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[640px] text-left text-sm">
                      <SiStickyTableHead>
                        <tr className="border-b border-border text-[10px] font-bold uppercase tracking-wide text-steel">
                          <th className="py-2 pr-3">Brand</th>
                          <th className="py-2 pr-3">Invoice sales</th>
                          <th className="py-2 pr-3">Credits</th>
                          <th className="py-2 pr-3">Net spend</th>
                          <th className="py-2 pr-3">Units</th>
                          <th className="py-2">Products</th>
                        </tr>
                      </SiStickyTableHead>
                      <tbody>
                        {customerData.brandBreakdown.map((b) => (
                          <tr key={b.key} className="border-b border-border/60">
                            <td className="py-2 pr-3">{b.label}</td>
                            <td className="py-2 pr-3">{gbp(b.invoiceSales)}</td>
                            <td className="py-2 pr-3">{gbp(b.credits)}</td>
                            <td className="py-2 pr-3 font-medium">{gbp(b.netSpend)}</td>
                            <td className="py-2 pr-3">{b.units}</td>
                            <td className="py-2">{b.products}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : null}

                {tab === "categories" ? (
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[640px] text-left text-sm">
                      <SiStickyTableHead>
                        <tr className="border-b border-border text-[10px] font-bold uppercase tracking-wide text-steel">
                          <th className="py-2 pr-3">Category</th>
                          <th className="py-2 pr-3">Invoice sales</th>
                          <th className="py-2 pr-3">Credits</th>
                          <th className="py-2 pr-3">Net spend</th>
                          <th className="py-2 pr-3">Units</th>
                          <th className="py-2">Products</th>
                        </tr>
                      </SiStickyTableHead>
                      <tbody>
                        {customerData.categoryBreakdown.map((c) => (
                          <tr key={c.key} className="border-b border-border/60">
                            <td className="py-2 pr-3">{c.label}</td>
                            <td className="py-2 pr-3">{gbp(c.invoiceSales)}</td>
                            <td className="py-2 pr-3">{gbp(c.credits)}</td>
                            <td className="py-2 pr-3 font-medium">{gbp(c.netSpend)}</td>
                            <td className="py-2 pr-3">{c.units}</td>
                            <td className="py-2">{c.products}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : null}

                <SiProvenance text={customerData.dataSource} />
              </>
            ) : null}
          </>
        ) : null}

        {mode === "multi" ? (
          <>
            <div className="flex flex-wrap items-end gap-3 print:hidden">
              <SiField label="Search">
                <input
                  className={siControlClassName(Boolean(filterQ))}
                  placeholder="Customer / account / salesperson"
                  value={filterQ}
                  onChange={(e) => setFilterQ(e.target.value)}
                />
              </SiField>
              <SiField label="Salesperson">
                <select
                  className={siControlClassName(Boolean(search.salesRepId))}
                  value={search.salesRepId ?? ""}
                  onChange={(e) => patch({ salesRepId: e.target.value || null, page: 1 })}
                >
                  <option value="">All salespeople</option>
                  {(multiData?.filterOptions.salespeople ?? []).map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </SiField>
              <SiField label="Min net spend">
                <input
                  className={siControlClassName(Boolean(search.minNet))}
                  placeholder="e.g. 1000"
                  value={search.minNet ?? ""}
                  onChange={(e) => patch({ minNet: e.target.value || null, page: 1 })}
                />
              </SiField>
              <SiField label="Max net spend">
                <input
                  className={siControlClassName(Boolean(search.maxNet))}
                  placeholder="e.g. 50000"
                  value={search.maxNet ?? ""}
                  onChange={(e) => patch({ maxNet: e.target.value || null, page: 1 })}
                />
              </SiField>
              <SiField label="Sort">
                <select
                  className={siControlClassName()}
                  value={sort}
                  onChange={(e) => patch({ sort: e.target.value, page: 1 })}
                >
                  <option value="NET_DESC">Net spend high → low</option>
                  <option value="NET_ASC">Net spend low → high</option>
                  <option value="INVOICE_DESC">Invoice sales high → low</option>
                  <option value="CREDITS_DESC">Credits (greatest reduction)</option>
                  <option value="NAME_AZ">Customer A–Z</option>
                </select>
              </SiField>
              <SiClearFiltersButton
                onClick={() =>
                  patch({
                    q: null,
                    salesRepId: null,
                    minNet: null,
                    maxNet: null,
                    sort: null,
                    page: 1,
                  })
                }
              />
            </div>

            {loading ? <p className="text-sm text-steel">Loading…</p> : null}

            {multiData ? (
              <>
                <SiPeriodSummary
                  selectedFrom={multiData.period.from}
                  selectedTo={multiData.period.to}
                  comparisonFrom={multiData.comparison?.comparison.from}
                  comparisonTo={multiData.comparison?.comparison.to}
                />
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <SiMetricCard
                    label="Total net spend"
                    value={gbp(multiData.summary.netSpend)}
                    primary
                  />
                  <SiMetricCard
                    label="Invoice sales"
                    value={gbp(multiData.summary.invoiceSales)}
                  />
                  <SiMetricCard label="Credits" value={gbp(multiData.summary.credits)} />
                  <SiMetricCard
                    label="Customers"
                    value={String(multiData.summary.customers)}
                  />
                </div>
                <p className="text-[11px] text-steel">{multiData.disclaimer}</p>
                {multiData.undatedExcluded > 0 ? (
                  <p className="text-[11px] text-steel">
                    {multiData.undatedExcluded} undated historic record
                    {multiData.undatedExcluded === 1 ? "" : "s"} excluded from this period.
                  </p>
                ) : null}

                {multiData.customers.total === 0 ? (
                  <p className="text-sm text-steel">No customers match the current filters.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[900px] text-left text-sm">
                      <SiStickyTableHead>
                        <tr className="border-b border-border text-[10px] font-bold uppercase tracking-wide text-steel">
                          <th className="py-2 pr-3">Customer</th>
                          <th className="py-2 pr-3">Account</th>
                          <th className="py-2 pr-3">Salesperson</th>
                          <th className="py-2 pr-3">Invoice sales</th>
                          <th className="py-2 pr-3">Credits</th>
                          <th className="py-2 pr-3">Net spend</th>
                          <th className="py-2 pr-3">Invoice docs</th>
                          <th className="py-2 pr-3">Credit docs</th>
                          <th className="py-2">Units</th>
                        </tr>
                      </SiStickyTableHead>
                      <tbody>
                        {multiData.customers.items.map((r) => (
                          <tr key={r.companyId} className="border-b border-border/60">
                            <td className="py-2 pr-3">
                              <Link
                                to={ROUTES.salesIntelligenceRebates}
                                search={{
                                  companyId: r.companyId,
                                  ...(period !== "CUSTOM" ? { period } : {}),
                                  ...(search.from ? { from: search.from } : {}),
                                  ...(search.to ? { to: search.to } : {}),
                                  ...(compare !== "OFF" ? { compare } : {}),
                                  ...(search.compareFrom
                                    ? { compareFrom: search.compareFrom }
                                    : {}),
                                  ...(search.compareTo ? { compareTo: search.compareTo } : {}),
                                }}
                                className="font-medium text-primary hover:underline"
                              >
                                {r.name}
                              </Link>
                            </td>
                            <td className="py-2 pr-3">
                              {r.autopartCustomerCode ?? r.accountNumber ?? "—"}
                            </td>
                            <td className="py-2 pr-3">{r.salesperson?.name ?? "—"}</td>
                            <td className="py-2 pr-3">{gbp(r.invoiceSales)}</td>
                            <td className="py-2 pr-3">{gbp(r.credits)}</td>
                            <td className="py-2 pr-3 font-medium">{gbp(r.netSpend)}</td>
                            <td className="py-2 pr-3">{r.invoiceDocuments}</td>
                            <td className="py-2 pr-3">{r.creditDocuments}</td>
                            <td className="py-2">{r.units}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                <SiPager
                  page={page}
                  totalPages={multiTotalPages}
                  total={multiData.customers.total}
                  onPage={(p) => patch({ page: p })}
                />
                <SiProvenance text={multiData.dataSource} />
              </>
            ) : null}
          </>
        ) : null}
      </div>
    </div>
  );
}
