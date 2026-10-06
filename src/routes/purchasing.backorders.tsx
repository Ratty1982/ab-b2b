import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { PanelHeader } from "@/components/ab/AppShell";
import { Drawer } from "@/components/ab/Drawer";
import {
  EmptyState,
  ErrorState,
  LoadingState,
  Pager,
  btnClass,
  controlClass,
  downloadCsv,
  gbp,
  primaryBtnClass,
  qty,
  ukDate,
  INCOMING_SOURCE_HINT,
} from "@/components/purchasing/workspace";
import {
  BACKORDER_AGE_FILTERS,
  BACKORDER_POSITION_FILTERS,
  BACKORDER_STATUS_FILTERS,
  ChangeStatusBadge,
  StockPositionBadge,
  mergeBackorderSearch,
  parseBackorderSearch,
  type BackorderSearch,
  type BackorderSearchPatch,
} from "@/components/purchasing/backorders";
import { ROUTES } from "@/lib/app-nav";
import { formatDate, formatOperationalDateTime } from "@/lib/datetime";
import {
  confirmAutopart216vFn,
  exportPurchasingBackordersCsvFn,
  getPurchasingBackorderLineFn,
  getPurchasingBackordersFn,
  pollBackorderMailboxNowFn,
  updateBackorderFeedSettingsFn,
} from "@/server/phase2/fns";

export const Route = createFileRoute("/purchasing/backorders")({
  validateSearch: (raw: Record<string, unknown>) => parseBackorderSearch(raw),
  head: () => ({
    meta: [
      { title: "Backorders — Purchasing — Automotive Brands" },
      {
        name: "description",
        content: "Current Autopart 216V outstanding backorders with stock cover and daily history.",
      },
    ],
  }),
  component: BackordersPage,
});

type Data = Extract<Awaited<ReturnType<typeof getPurchasingBackordersFn>>, { ok: true }>["data"];
type LineDetail = Extract<Awaited<ReturnType<typeof getPurchasingBackorderLineFn>>, { ok: true }>["data"];
type LineRow = Data["lines"]["rows"][number];

function BackordersPage() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState(search.q ?? "");
  const [detail, setDetail] = useState<LineDetail | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [expandedSku, setExpandedSku] = useState<string | null>(null);
  const view = search.view ?? "lines";

  useEffect(() => {
    setQ(search.q ?? "");
  }, [search.q]);

  function load() {
    setData(null);
    void getPurchasingBackordersFn({
      data: {
        view,
        q: search.q ?? null,
        status: search.status ?? null,
        position: search.position ?? null,
        ageDays: search.ageDays ?? null,
        customerAccount: search.customerAccount ?? null,
        brand: search.brand ?? null,
        catalogueType: search.catalogueType ?? null,
        page: search.page ?? 1,
        pageSize: 50,
      },
    }).then((result) => {
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
  }, [search]);

  function patch(next: BackorderSearchPatch) {
    void navigate({ search: (prev: BackorderSearch) => mergeBackorderSearch(prev, next) });
  }

  async function openLine(lineId: string) {
    const result = await getPurchasingBackorderLineFn({ data: { lineId } });
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setDetail(result.data);
    setDetailOpen(true);
  }

  async function exportCsv() {
    setExporting(true);
    const result = await exportPurchasingBackordersCsvFn({
      data: {
        q: search.q ?? null,
        status: search.status ?? null,
        position: search.position ?? null,
        ageDays: search.ageDays ?? null,
        customerAccount: search.customerAccount ?? null,
        brand: search.brand ?? null,
        catalogueType: search.catalogueType ?? null,
      },
    });
    setExporting(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    downloadCsv(result.data.csv, result.data.filename);
  }

  async function onUpload(file: File) {
    setBusy(true);
    const text = await file.text();
    const result = await confirmAutopart216vFn({ data: { text, filename: file.name } });
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    load();
  }

  async function saveFeed(enabled: boolean) {
    if (!data?.canManage) return;
    setBusy(true);
    const result = await updateBackorderFeedSettingsFn({
      data: { enabled, allowedSender: data.feed.allowedSender },
    });
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    load();
  }

  async function pollNow() {
    setBusy(true);
    const result = await pollBackorderMailboxNowFn();
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    load();
  }

  const current = data?.current;

  return (
    <>
      <PanelHeader
        title="Backorders"
        sub="Current Autopart 216V outstanding position. Avail and Incoming come from 231PO3NEW and are not reservations."
        crumbs={[{ label: "Purchasing", to: ROUTES.purchasing }, { label: "Backorders" }]}
      />
      {error ? <ErrorState message={error} /> : null}
      {data?.freshness ? <FreshnessBar freshness={data.freshness} /> : null}
      {current ? <Metrics current={current} /> : null}
      <div className="flex flex-wrap gap-2 border-b border-border/70 px-4 py-3 sm:px-6">
        {(
          [
            ["lines", "Lines"],
            ["sku", "By product / SKU"],
            ["customer", "By customer"],
            ["attention", "Attention"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            className={view === id ? primaryBtnClass : btnClass}
            onClick={() => patch({ view: id, page: undefined })}
          >
            {label}
          </button>
        ))}
        <button type="button" className={btnClass} disabled={exporting} onClick={() => void exportCsv()}>
          {exporting ? "Exporting…" : "Export CSV"}
        </button>
        {data?.canManage ? (
          <>
            <label className={btnClass}>
              Upload 216V
              <input
                type="file"
                accept=".csv,.txt,text/csv,text/plain"
                className="sr-only"
                disabled={busy}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void onUpload(file);
                  e.currentTarget.value = "";
                }}
              />
            </label>
            <button type="button" className={btnClass} disabled={busy} onClick={() => void pollNow()}>
              Poll mailbox
            </button>
            <button type="button" className={btnClass} disabled={busy} onClick={() => void saveFeed(!data.feed.enabled)}>
              Auto-import {data.feed.enabled ? "ON" : "OFF"}
            </button>
          </>
        ) : null}
      </div>
      <Filters search={search} q={q} setQ={setQ} data={data} patch={patch} />
      {!data && !error ? <LoadingState label="Loading backorders…" /> : null}
      {data && !current ? (
        <EmptyState
          title="No 216V snapshot yet"
          body="The daily Autopart 216V report has not been imported. Outstanding backorders will appear here after the first successful file."
        />
      ) : null}
      {data && current && view === "lines" ? (
        <LinesTable rows={data.lines.rows} total={data.lines.total} page={data.lines.page} pageSize={data.lines.pageSize} onPage={(page) => patch({ page })} onOpen={openLine} />
      ) : null}
      {data && current && view === "sku" ? (
        <SkuTable groups={data.skus.rows} total={data.skus.total} page={data.skus.page} pageSize={data.skus.pageSize} expanded={expandedSku} onExpand={setExpandedSku} onPage={(page) => patch({ page })} onOpen={openLine} />
      ) : null}
      {data && current && view === "customer" ? (
        <CustomerTable groups={data.customerGroups.rows} total={data.customerGroups.total} page={data.customerGroups.page} pageSize={data.customerGroups.pageSize} onPage={(page) => patch({ page })} onOpen={openLine} />
      ) : null}
      {data && current && view === "attention" ? <AttentionBoard data={data} onOpen={openLine} /> : null}
      <Drawer
        open={detailOpen}
        onClose={() => setDetailOpen(false)}
        title={detail?.line.orderNumber ?? "Backorder"}
        sub={detail ? `${detail.line.sku} · ${detail.line.customerName}` : ""}
        width="lg"
      >
        {detail ? <LineDetailBody detail={detail} /> : null}
      </Drawer>
    </>
  );
}

function FreshnessBar({ freshness }: { freshness: Data["freshness"] }) {
  return (
    <div className={`border-b px-4 py-3 text-[13px] sm:px-6 ${freshness.stale ? "border-warn/40 bg-warn/10 text-ink" : "border-border/70 text-steel"}`}>
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <span className="font-semibold uppercase tracking-[0.12em] text-[10px] text-ink">216V feed · {freshness.status.replaceAll("_", " ")}</span>
        <span>Last 216V received: {freshness.lastReceivedLabel}</span>
        <span>Next expected report: {freshness.nextExpectedLabel}</span>
        {freshness.filename ? <span>File: {freshness.filename}</span> : null}
      </div>
      {freshness.warning ? <p className="mt-1">{freshness.warning}</p> : null}
      <p className="mt-1 text-[12px]">
        This feed arrives once per working day around 18:00 Europe/London. Weekends do not expect a Saturday or Sunday report. A missing file never clears yesterday&apos;s backorders.
      </p>
    </div>
  );
}

function Metrics({ current }: { current: NonNullable<Data["current"]> }) {
  return (
    <div className="grid gap-3 border-b border-border/70 px-4 py-4 sm:grid-cols-5 sm:px-6">
      <Metric label="Outstanding Orders" value={qty(current.outstandingOrders)} />
      <Metric label="Outstanding Lines" value={qty(current.outstandingLines)} />
      <Metric label="Customers" value={qty(current.customers)} />
      <Metric label="Outstanding Units" value={qty(current.outstandingUnits)} />
      <Metric label="Outstanding Value" value={gbp(current.outstandingValue)} />
      <Metric label="New Today" value={qty(current.newToday)} />
      <Metric label="Cleared Since Previous Report" value={qty(current.clearedSincePrevious)} />
      <Metric label="Reduced Since Previous Report" value={qty(current.reducedSincePrevious)} />
      <Metric label="Increased Since Previous Report" value={qty(current.increasedSincePrevious)} />
    </div>
  );
}

function Filters({
  search,
  q,
  setQ,
  data,
  patch,
}: {
  search: BackorderSearch;
  q: string;
  setQ: (v: string) => void;
  data: Data | null;
  patch: (next: BackorderSearchPatch) => void;
}) {
  return (
    <form
      className="flex flex-wrap gap-2 border-b border-border/70 px-4 py-3 sm:px-6"
      onSubmit={(event) => {
        event.preventDefault();
        patch({ q: q.trim() || undefined, page: undefined });
      }}
    >
      <input className={`${controlClass} min-w-[220px]`} placeholder="Search order, customer, account, SKU, description, ref" value={q} onChange={(e) => setQ(e.target.value)} />
      <select className={controlClass} value={search.status ?? ""} onChange={(e) => patch({ status: e.target.value || undefined, page: undefined })}>
        {BACKORDER_STATUS_FILTERS.map((opt) => (
          <option key={opt.value || "all"} value={opt.value}>{opt.label}</option>
        ))}
      </select>
      <select className={controlClass} value={search.position ?? ""} onChange={(e) => patch({ position: e.target.value || undefined, page: undefined })}>
        {BACKORDER_POSITION_FILTERS.map((opt) => (
          <option key={opt.value || "all"} value={opt.value}>{opt.label}</option>
        ))}
      </select>
      <select className={controlClass} value={search.ageDays ? String(search.ageDays) : ""} onChange={(e) => patch({ ageDays: e.target.value ? Number(e.target.value) : undefined, page: undefined })}>
        {BACKORDER_AGE_FILTERS.map((opt) => (
          <option key={opt.value || "all"} value={opt.value}>{opt.label}</option>
        ))}
      </select>
      <select className={controlClass} value={search.customerAccount ?? ""} onChange={(e) => patch({ customerAccount: e.target.value || undefined, page: undefined })}>
        <option value="">All customers</option>
        {(data?.customers ?? []).map((c) => (
          <option key={c.account} value={c.account}>{c.name} ({c.account})</option>
        ))}
      </select>
      <select className={controlClass} value={search.brand ?? ""} onChange={(e) => patch({ brand: e.target.value || undefined, page: undefined })}>
        <option value="">All brands</option>
        {(data?.brands ?? []).map((brand) => (
          <option key={brand} value={brand}>{brand}</option>
        ))}
      </select>
      <select className={controlClass} value={search.catalogueType ?? ""} onChange={(e) => patch({ catalogueType: (e.target.value as BackorderSearch["catalogueType"]) || undefined, page: undefined })}>
        <option value="">All catalogue types</option>
        <option value="CATALOGUE">Catalogue</option>
        <option value="EXTERNAL">External product</option>
        <option value="HISTORIC_ONLY">Historic/not current</option>
      </select>
      <button type="submit" className={btnClass}>Search</button>
    </form>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-steel">{label}</div>
      <div className="mt-1 font-display text-xl font-semibold">{value}</div>
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[10px] font-semibold uppercase tracking-[0.12em] text-steel">{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function LinesTable({
  rows, total, page, pageSize, onPage, onOpen,
}: {
  rows: LineRow[]; total: number; page: number; pageSize: number; onPage: (page: number) => void; onOpen: (id: string) => void;
}) {
  if (!rows.length) {
    return <EmptyState title="No matching backorders" body="Try clearing filters. CLEARED lines are history only and are not in today's outstanding totals." />;
  }
  return (
    <>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[1280px] text-left text-[13px]">
          <thead className="bg-secondary/40 text-[10px] font-semibold uppercase tracking-[0.12em] text-steel">
            <tr>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">Backorder first seen</th>
              <th className="px-3 py-2">Order No</th>
              <th className="px-3 py-2">Customer</th>
              <th className="px-3 py-2">Customer Account</th>
              <th className="px-3 py-2">Customer Order Ref</th>
              <th className="px-3 py-2">Product</th>
              <th className="px-3 py-2">SKU</th>
              <th className="px-3 py-2">Outstanding Qty</th>
              <th className="px-3 py-2">Unit Value</th>
              <th className="px-3 py-2">Outstanding Value</th>
              <th className="px-3 py-2">Available</th>
              <th className="px-3 py-2" title={INCOMING_SOURCE_HINT}>Incoming</th>
              <th className="px-3 py-2">Position</th>
              <th className="px-3 py-2">Last Changed</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="cursor-pointer border-t border-border/70 hover:bg-secondary/30" onClick={() => onOpen(row.id)}>
                <td className="px-3 py-2"><ChangeStatusBadge status={row.status} label={row.statusLabel} /></td>
                <td className="px-3 py-2">{row.ageLabel}</td>
                <td className="px-3 py-2 font-mono text-[12px]">{row.orderNumber}</td>
                <td className="px-3 py-2">
                  {row.companyId ? (
                    <Link className="text-primary underline-offset-2 hover:underline" to="/admin/customers/$id" params={{ id: row.companyId }}>{row.customerName}</Link>
                  ) : (
                    <><span>{row.customerName}</span><div className="text-[11px] text-steel">Unmapped account</div></>
                  )}
                </td>
                <td className="px-3 py-2 font-mono text-[12px]">{row.customerAccount}</td>
                <td className="px-3 py-2">{row.customerOrderRef || "—"}</td>
                <td className="px-3 py-2">{row.description}<div className="text-[11px] text-steel">{row.productKindLabel}</div></td>
                <td className="px-3 py-2 font-mono text-[12px]">{row.sku}</td>
                <td className="px-3 py-2">{qty(row.outstandingQty)}</td>
                <td className="px-3 py-2">{gbp(row.unitValue)}</td>
                <td className="px-3 py-2">{gbp(row.outstandingValue)}</td>
                <td className="px-3 py-2">{row.availQty == null ? "—" : qty(row.availQty)}</td>
                <td className="px-3 py-2">{row.incomingQty == null ? "—" : qty(row.incomingQty)}</td>
                <td className="px-3 py-2">
                  <StockPositionBadge position={row.position} label={row.positionLabel} />
                  <div className="mt-1 max-w-[220px] text-[11px] text-steel">{row.coverSummary}</div>
                </td>
                <td className="px-3 py-2">{formatOperationalDateTime(row.lastChangedAt) ?? ukDate(row.lastChangedAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Pager page={page} pageSize={pageSize} total={total} onPage={onPage} />
    </>
  );
}

function SkuTable({
  groups, total, page, pageSize, expanded, onExpand, onPage, onOpen,
}: {
  groups: Data["skus"]["rows"]; total: number; page: number; pageSize: number; expanded: string | null;
  onExpand: (key: string | null) => void; onPage: (page: number) => void; onOpen: (id: string) => void;
}) {
  if (!groups.length) return <EmptyState title="No SKU backorder groups" body="No outstanding 216V lines match the current filters." />;
  return (
    <>
      <div className="grid gap-3 px-4 py-4 sm:px-6">
        {groups.map((group) => (
          <section key={group.partMatchKey} className="border border-border">
            <button type="button" className="flex w-full flex-wrap items-start justify-between gap-3 px-4 py-3 text-left" onClick={() => onExpand(expanded === group.partMatchKey ? null : group.partMatchKey)}>
              <div>
                <div className="font-mono text-[13px]">{group.sku}</div>
                <div className="font-display text-lg font-semibold uppercase">{group.description}</div>
                <div className="text-[12px] text-steel">{group.productKindLabel}</div>
              </div>
              <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-[13px] sm:grid-cols-4">
                <Fact label="Outstanding across customers" value={qty(group.outstandingQty)} />
                <Fact label="Orders" value={qty(group.orders)} />
                <Fact label="Customers" value={qty(group.customers)} />
                <Fact label="Avail" value={group.availQty == null ? "—" : qty(group.availQty)} />
                <Fact label="Incoming" value={group.incomingQty == null ? "—" : qty(group.incomingQty)} />
                <Fact label="Position" value={group.positionLabel} />
              </dl>
            </button>
            <p className="border-t border-border/70 px-4 py-2 text-[12px] text-steel">{group.coverSummary}</p>
            {expanded === group.partMatchKey ? (
              <table className="w-full text-left text-[13px]">
                <thead className="bg-secondary/40 text-[10px] font-semibold uppercase tracking-[0.12em] text-steel">
                  <tr>
                    <th className="px-3 py-2">Order</th>
                    <th className="px-3 py-2">Customer</th>
                    <th className="px-3 py-2">Qty</th>
                    <th className="px-3 py-2">Value</th>
                    <th className="px-3 py-2">First seen</th>
                  </tr>
                </thead>
                <tbody>
                  {group.lines.map((line) => (
                    <tr key={line.id} className="cursor-pointer border-t border-border/70 hover:bg-secondary/30" onClick={() => onOpen(line.id)}>
                      <td className="px-3 py-2 font-mono text-[12px]">{line.orderNumber}</td>
                      <td className="px-3 py-2">{line.customerName}{line.unmapped ? <span className="ml-2 text-[11px] text-steel">Unmapped account</span> : null}</td>
                      <td className="px-3 py-2">{qty(line.outstandingQty)}</td>
                      <td className="px-3 py-2">{gbp(line.outstandingValue)}</td>
                      <td className="px-3 py-2">{line.ageLabel}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : null}
          </section>
        ))}
      </div>
      <Pager page={page} pageSize={pageSize} total={total} onPage={onPage} />
    </>
  );
}

function CustomerTable({
  groups, total, page, pageSize, onPage, onOpen,
}: {
  groups: Data["customerGroups"]["rows"]; total: number; page: number; pageSize: number;
  onPage: (page: number) => void; onOpen: (id: string) => void;
}) {
  if (!groups.length) return <EmptyState title="No customer backorder groups" body="No outstanding 216V lines match the current filters." />;
  return (
    <>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[900px] text-left text-[13px]">
          <thead className="bg-secondary/40 text-[10px] font-semibold uppercase tracking-[0.12em] text-steel">
            <tr>
              <th className="px-3 py-2">Customer</th>
              <th className="px-3 py-2">Account</th>
              <th className="px-3 py-2">Orders</th>
              <th className="px-3 py-2">Lines</th>
              <th className="px-3 py-2">Units</th>
              <th className="px-3 py-2">Outstanding Value</th>
              <th className="px-3 py-2">Oldest first seen</th>
              <th className="px-3 py-2">Stock-cover issues</th>
            </tr>
          </thead>
          <tbody>
            {groups.map((group) => (
              <tr key={group.customerAccount} className="border-t border-border/70 align-top">
                <td className="px-3 py-2">
                  {group.companyId ? (
                    <Link className="text-primary underline-offset-2 hover:underline" to="/admin/customers/$id" params={{ id: group.companyId }}>{group.customerName}</Link>
                  ) : (
                    <><span>{group.customerName}</span><div className="text-[11px] text-steel">Unmapped account</div></>
                  )}
                </td>
                <td className="px-3 py-2 font-mono text-[12px]">{group.customerAccount}</td>
                <td className="px-3 py-2">{qty(group.orders)}</td>
                <td className="px-3 py-2">{qty(group.lines)}</td>
                <td className="px-3 py-2">{qty(group.units)}</td>
                <td className="px-3 py-2">{gbp(group.outstandingValue)}</td>
                <td className="px-3 py-2">{group.oldestAgeLabel}</td>
                <td className="px-3 py-2 text-[12px] text-steel">
                  {group.stockCoverIssues.length ? group.stockCoverIssues.join(" · ") : "None"}
                  <div className="mt-2 grid gap-1">
                    {group.lineRows.slice(0, 6).map((line) => (
                      <button key={line.id} type="button" className="text-left text-primary hover:underline" onClick={() => onOpen(line.id)}>
                        {line.orderNumber} · {line.sku} · {qty(line.outstandingQty)}
                      </button>
                    ))}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Pager page={page} pageSize={pageSize} total={total} onPage={onPage} />
    </>
  );
}

function AttentionBoard({ data, onOpen }: { data: Data; onOpen: (id: string) => void }) {
  const sections = [
    { id: "STOCK_NOW_AVAILABLE" as const, title: "STOCK NOW AVAILABLE", copy: "Stock available in Autopart — review allocation/despatch. This does not confirm the order can be fulfilled.", rows: data.attention.STOCK_NOW_AVAILABLE },
    { id: "NO_STOCK_NO_INCOMING" as const, title: "NO STOCK / NO INCOMING", copy: data.attention.rules.find((r) => r.id === "NO_STOCK_NO_INCOMING")?.rule ?? "", rows: data.attention.NO_STOCK_NO_INCOMING },
    { id: "INCOMING_DOES_NOT_COVER" as const, title: "INCOMING DOES NOT COVER TOTAL BACKORDER", copy: data.attention.rules.find((r) => r.id === "INCOMING_DOES_NOT_COVER")?.rule ?? "", rows: data.attention.INCOMING_DOES_NOT_COVER },
    { id: "LONG_STANDING" as const, title: "LONG-STANDING BACKORDER", copy: data.attention.rules.find((r) => r.id === "LONG_STANDING")?.rule ?? "", rows: data.attention.LONG_STANDING },
    { id: "HIGH_VALUE" as const, title: "HIGH OUTSTANDING VALUE", copy: data.attention.rules.find((r) => r.id === "HIGH_VALUE")?.rule ?? "", rows: data.attention.HIGH_VALUE },
  ];
  return (
    <div className="grid gap-6 px-4 py-5 sm:px-6">
      <p className="text-[13px] text-steel">Attention rules are visible and deterministic. There is no hidden score. Incoming has no invented ETA.</p>
      {sections.map((section) => (
        <section key={section.id} className="border border-border">
          <header className="border-b border-border/70 px-4 py-3">
            <h2 className="font-display text-lg font-semibold uppercase">{section.title}</h2>
            <p className="mt-1 text-[13px] text-steel">{section.copy}</p>
          </header>
          {section.rows.length === 0 ? (
            <p className="px-4 py-4 text-[13px] text-steel">None in the current filtered view.</p>
          ) : (
            <ul className="divide-y divide-border/70">
              {section.rows.map((row) => (
                <li key={`${section.id}-${row.id}`}>
                  <button type="button" className="flex w-full flex-wrap items-center justify-between gap-3 px-4 py-3 text-left hover:bg-secondary/30" onClick={() => onOpen(row.id)}>
                    <span><span className="font-mono text-[12px]">{row.orderNumber}</span> · {row.customerName} · {row.sku} · {qty(row.outstandingQty)} units</span>
                    <StockPositionBadge position={row.position} label={row.positionLabel} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      ))}
    </div>
  );
}

function LineDetailBody({ detail }: { detail: LineDetail }) {
  const line = detail.line;
  return (
    <div className="grid gap-5">
      <section className="grid gap-2">
        <h3 className="font-display text-base font-semibold uppercase">Order</h3>
        <dl className="grid gap-2 text-[13px] sm:grid-cols-2">
          <Fact label="Order number" value={line.orderNumber} />
          <Fact label="Customer account" value={line.customerAccount} />
          <Fact label="Customer name" value={line.customerName} />
          <Fact label="Mapped AB company" value={line.companyName ?? "Unmapped account"} />
          <Fact label="Customer order / reference" value={line.customerOrderRef || "—"} />
        </dl>
      </section>
      <section className="grid gap-2">
        <h3 className="font-display text-base font-semibold uppercase">Product</h3>
        <dl className="grid gap-2 text-[13px] sm:grid-cols-2">
          <Fact label="Part number" value={line.sku} />
          <Fact label="Description" value={line.description} />
          <Fact label="Catalogue type" value={line.productKindLabel} />
          <Fact label="AutopartProduct" value={line.autopartProductId ? "Matched" : "Not in AutopartProduct master"} />
        </dl>
      </section>
      <section className="grid gap-2">
        <h3 className="font-display text-base font-semibold uppercase">Backorder</h3>
        <dl className="grid gap-2 text-[13px] sm:grid-cols-2">
          <Fact label="Outstanding qty" value={qty(line.outstandingQty)} />
          <Fact label="Unit value" value={gbp(line.unitValue)} />
          <Fact label="Outstanding value" value={gbp(line.outstandingValue)} />
          <Fact label="Backorder first seen" value={`${line.ageLabel} (${ukDate(line.firstSeenAt)})`} />
          <Fact label="Last seen" value={ukDate(line.lastSeenAt)} />
          <Fact label="Last changed" value={ukDate(line.lastChangedAt)} />
        </dl>
      </section>
      <section className="grid gap-2">
        <h3 className="font-display text-base font-semibold uppercase">Stock</h3>
        <dl className="grid gap-2 text-[13px] sm:grid-cols-2">
          <Fact label="Avail" value={line.availQty == null ? "—" : qty(line.availQty)} />
          <Fact label="Physical" value={line.physicalQty == null ? "—" : qty(line.physicalQty)} />
          <Fact label="Incoming" value={line.incomingQty == null ? "—" : qty(line.incomingQty)} />
          <Fact label="Stock-feed timestamp" value={line.stockFeedAt ? formatOperationalDateTime(line.stockFeedAt) ?? "—" : "—"} />
        </dl>
        <p className="text-[12px] text-steel">{line.coverSummary}</p>
        <p className="text-[12px] text-steel">{detail.stockDisclaimer}</p>
        <p className="text-[12px] text-steel">Incoming is Autopart P/Ord Qty. Arrival date is not available.</p>
      </section>
      <section className="grid gap-2">
        <h3 className="font-display text-base font-semibold uppercase">History</h3>
        <p className="text-[12px] text-steel">Daily outstanding quantity from each successful 216V snapshot.</p>
        <ul className="font-mono text-[13px]">
          {detail.timeline.map((point) => (
            <li key={`${point.date}-${point.status}`}>
              {formatDate(point.date) ?? point.date}{"  "}{point.qty}{point.status === "CLEARED" ? "  CLEARED" : ""}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
