import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useId, useState } from "react";
import {
  AlertTriangle,
  Boxes,
  ClipboardList,
  Settings,
  Users,
} from "lucide-react";
import { PanelHeader } from "@/components/ab/AppShell";
import { Drawer } from "@/components/ab/Drawer";
import { StatusBadge } from "@/components/ab/Badges";
import { cn } from "@/lib/utils";
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
  BACKORDER_CONDITION_FILTERS,
  ProductConditionBadge,
  StockPositionBadge,
  activeBackorderFilterChips,
  backorderFilterIgnoredByMovement,
  mergeBackorderSearch,
  parseBackorderSearch,
  stockPositionHeadline,
  toggleBackorderMovement,
  type BackorderSearch,
  type BackorderSearchPatch,
} from "@/components/purchasing/backorders";
import {
  autopart216vMovementEmptyCopy,
  formatAutopart216vChangeQty,
  type Autopart216vMovement,
} from "@/domain/autopart-216v-movement";
import { AUTOPART_216V_SCHEDULE_LABEL } from "@/domain/autopart-216v-freshness";
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
type MovementData = NonNullable<Data["movement"]>;
type MovementRow = MovementData["rows"][number];

function BackordersPage() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState(search.q ?? "");
  const [detail, setDetail] = useState<LineDetail | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [expandedSku, setExpandedSku] = useState<string | null>(null);
  const [clearedDetail, setClearedDetail] = useState<MovementRow | null>(null);
  const view = search.view ?? "lines";
  const movement = search.movement ?? null;
  const uploadId = useId();

  useEffect(() => {
    setQ(search.q ?? "");
  }, [search.q]);

  function load() {
    setData(null);
    void getPurchasingBackordersFn({
      data: {
        view,
        movement: search.movement ?? null,
        q: search.q ?? null,
        status: search.status ?? null,
        position: search.position ?? null,
        ageDays: search.ageDays ?? null,
        customerAccount: search.customerAccount ?? null,
        brand: search.brand ?? null,
        catalogueType: search.catalogueType ?? null,
        condition: search.condition ?? null,
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
        movement: search.movement ?? null,
        q: search.q ?? null,
        status: search.status ?? null,
        position: search.position ?? null,
        ageDays: search.ageDays ?? null,
        customerAccount: search.customerAccount ?? null,
        brand: search.brand ?? null,
        catalogueType: search.catalogueType ?? null,
        condition: search.condition ?? null,
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
  const counts = data?.viewCounts;

  return (
    <>
      <PanelHeader
        title="Backorders"
        sub="Current Autopart 216V outstanding position. Avail and Incoming come from 231PO3NEW and are not reservations."
        crumbs={[{ label: "Purchasing", to: ROUTES.purchasing }, { label: "Backorders" }]}
        actions={
          <button
            type="button"
            className={btnClass}
            onClick={() => setSettingsOpen(true)}
            aria-label="Open backorder settings"
          >
            <Settings className="mr-2 size-3.5" aria-hidden />
            Backorder Settings
          </button>
        }
      />
      {error ? <ErrorState message={error} /> : null}
      {data?.freshness ? <FreshnessBar freshness={data.freshness} /> : null}
      {current && data ? (
        <Metrics
          current={current}
          attentionCount={data.attentionSummary.unique}
          movement={movement}
          onMovement={(next) => patch(toggleBackorderMovement(search, next))}
        />
      ) : null}
      {data?.current && data.attentionSummary.unique > 0 ? (
        <AttentionSummary summary={data.attentionSummary} onView={() => patch({ view: "attention", movement: undefined, page: undefined })} />
      ) : null}
      <div className="grid gap-2 border-b border-border/70 px-4 py-3 sm:grid-cols-2 sm:px-6 lg:grid-cols-4">
        <ViewCard
          id="lines"
          label="Lines"
          hint="All backorders"
          count={counts?.lines ?? current?.outstandingLines ?? 0}
          icon={ClipboardList}
          accent="cyan"
          active={!movement && view === "lines"}
          onSelect={() => patch({ view: "lines", movement: undefined, page: undefined })}
        />
        <ViewCard
          id="sku"
          label="Products"
          hint="SKU pressure"
          count={counts?.skus ?? 0}
          icon={Boxes}
          accent="steel"
          active={!movement && view === "sku"}
          onSelect={() => patch({ view: "sku", movement: undefined, page: undefined })}
        />
        <ViewCard
          id="customer"
          label="Customers"
          hint="Customer impact"
          count={counts?.customers ?? 0}
          icon={Users}
          accent="info"
          active={!movement && view === "customer"}
          onSelect={() => patch({ view: "customer", movement: undefined, page: undefined })}
        />
        <ViewCard
          id="attention"
          label="Attention"
          hint="Needs review"
          count={counts?.attention ?? 0}
          icon={AlertTriangle}
          accent="attention"
          strong={Boolean(counts?.attention)}
          active={!movement && view === "attention"}
          onSelect={() => patch({ view: "attention", movement: undefined, page: undefined })}
        />
      </div>
      <Filters search={search} q={q} setQ={setQ} data={data} patch={patch} />
      {!data && !error ? <LoadingState label="Loading backorders…" /> : null}
      {data && !current ? (
        <EmptyState
          title="No 216V snapshot yet"
          body="The daily Autopart 216V report has not been imported. Outstanding backorders will appear here after the first successful file."
        />
      ) : null}
      {data && current && data.movement ? (
        <MovementPanel
          movement={data.movement}
          onClear={() => patch({ movement: undefined, page: undefined })}
          onPage={(page) => patch({ page })}
          onOpen={(row) => (row.currentlyOutstanding ? void openLine(row.id) : setClearedDetail(row))}
        />
      ) : null}
      {data && current && !data.movement && view === "lines" ? (
        <LinesTable rows={data.lines.rows} total={data.lines.total} page={data.lines.page} pageSize={data.lines.pageSize} onPage={(page) => patch({ page })} onOpen={openLine} />
      ) : null}
      {data && current && !data.movement && view === "sku" ? (
        <SkuTable groups={data.skus.rows} total={data.skus.total} page={data.skus.page} pageSize={data.skus.pageSize} expanded={expandedSku} onExpand={setExpandedSku} onPage={(page) => patch({ page })} onOpen={openLine} />
      ) : null}
      {data && current && !data.movement && view === "customer" ? (
        <CustomerTable groups={data.customerGroups.rows} total={data.customerGroups.total} page={data.customerGroups.page} pageSize={data.customerGroups.pageSize} onPage={(page) => patch({ page })} onOpen={openLine} />
      ) : null}
      {data && current && !data.movement && view === "attention" ? <AttentionBoard data={data} onOpen={openLine} /> : null}
      <Drawer
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        title="Backorder Settings"
        sub="216V feed and export. Everyday backorder work stays on this page."
        width="md"
      >
        <SettingsBody
          data={data}
          busy={busy}
          exporting={exporting}
          uploadId={uploadId}
          onExport={() => void exportCsv()}
          onPoll={() => void pollNow()}
          onToggle={() => void saveFeed(!data?.feed.enabled)}
          onUpload={onUpload}
        />
      </Drawer>
      <Drawer
        open={detailOpen}
        onClose={() => setDetailOpen(false)}
        title={detail?.line.orderNumber ?? "Backorder"}
        sub={detail ? `${detail.line.sku} · ${detail.line.customerName}` : ""}
        width="lg"
      >
        {detail ? <LineDetailBody detail={detail} /> : null}
      </Drawer>
      <Drawer
        open={Boolean(clearedDetail)}
        onClose={() => setClearedDetail(null)}
        title={clearedDetail?.orderNumber ?? "Cleared backorder"}
        sub={clearedDetail ? `${clearedDetail.sku} · ${clearedDetail.customerName} · Cleared` : ""}
        width="lg"
      >
        {clearedDetail ? <ClearedDetailBody row={clearedDetail} /> : null}
      </Drawer>
    </>
  );
}

function FreshnessBar({ freshness }: { freshness: Data["freshness"] }) {
  const headline = freshness.headline;
  const toneClass =
    headline.tone === "good"
      ? "border-good/40 bg-good/10"
      : headline.tone === "bad"
        ? "border-destructive/40 bg-destructive/10"
        : "border-warn/40 bg-warn/10";
  const dot =
    headline.tone === "good" ? "bg-good" : headline.tone === "bad" ? "bg-destructive" : "bg-warn";
  return (
    <div className={cn("border-b px-4 py-3 text-[13px] sm:px-6", toneClass)}>
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
        <p className="flex items-center gap-2 font-semibold uppercase tracking-[0.12em] text-[11px] text-ink">
          <span className={cn("size-2 rounded-full", dot)} aria-hidden />
          <span>{headline.label}</span>
        </p>
        <span>
          <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-steel">Current snapshot</span>{" "}
          {freshness.lastReceivedLabel}
        </span>
        {freshness.sourceLabel ? (
          <span>
            <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-steel">Source</span>{" "}
            {freshness.sourceLabel}
          </span>
        ) : null}
        {freshness.filename ? (
          <span>
            <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-steel">File</span>{" "}
            {freshness.filename}
          </span>
        ) : null}
        <span>
          <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-steel">Next automatic report</span>{" "}
          {freshness.nextExpectedLabel}
        </span>
      </div>
      {freshness.warning ? <p className="mt-1">{freshness.warning}</p> : null}
    </div>
  );
}

function Metrics({
  current,
  attentionCount,
  movement,
  onMovement,
}: {
  current: NonNullable<Data["current"]>;
  attentionCount: number;
  movement: Autopart216vMovement | null;
  onMovement: (movement: Autopart216vMovement) => void;
}) {
  const movementCard = (id: Autopart216vMovement, label: string, count: number, accent: "cyan" | "warn" | "good") => (
    <KpiCard
      label={label}
      value={qty(count)}
      accent={accent}
      compact
      selected={movement === id}
      onSelect={() => onMovement(id)}
      ariaLabel={`${label}: ${count} line${count === 1 ? "" : "s"} since the previous 216V snapshot. ${
        movement === id ? "Selected. Activate to return to all current backorders." : "Show these lines."
      }`}
    />
  );
  return (
    <div className="grid gap-3 border-b border-border/70 px-4 py-4 sm:px-6">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="Outstanding Orders" value={qty(current.outstandingOrders)} accent="cyan" />
        <KpiCard label="Outstanding Units" value={qty(current.outstandingUnits)} accent="warn" emphasis />
        <KpiCard label="Outstanding Value" value={gbp(current.outstandingValue)} accent="warn" emphasis />
        <KpiCard label="Attention" value={qty(attentionCount)} accent={attentionCount > 0 ? "bad" : "steel"} emphasis={attentionCount > 0} />
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {movementCard("NEW", "New Today", current.newToday, "cyan")}
        {movementCard("INCREASED", "Increased", current.increasedSincePrevious, "warn")}
        {movementCard("REDUCED", "Reduced", current.reducedSincePrevious, "good")}
        {movementCard("CLEARED", "Cleared", current.clearedSincePrevious, "good")}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <KpiCard label="Outstanding Lines" value={qty(current.outstandingLines)} accent="steel" compact />
        <KpiCard label="Customers" value={qty(current.customers)} accent="steel" compact />
      </div>
    </div>
  );
}

function KpiCard({
  label,
  value,
  accent,
  compact,
  emphasis,
  selected,
  onSelect,
  ariaLabel,
}: {
  label: string;
  value: string;
  accent: "cyan" | "warn" | "good" | "bad" | "steel";
  compact?: boolean;
  emphasis?: boolean;
  selected?: boolean;
  onSelect?: () => void;
  ariaLabel?: string;
}) {
  const border =
    accent === "cyan"
      ? "border-l-cyan/70 bg-cyan/5"
      : accent === "warn"
        ? "border-l-warn/70 bg-warn/5"
        : accent === "good"
          ? "border-l-good/70 bg-good/5"
          : accent === "bad"
            ? "border-l-destructive/70 bg-destructive/5"
            : "border-l-steel/50 bg-surface/60";
  const body = (
    <>
      <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-steel">{label}</div>
      <div className={cn("num mt-1 font-display font-semibold", emphasis || !compact ? "text-2xl" : "text-lg")}>
        {value}
      </div>
    </>
  );
  if (!onSelect) {
    return <div className={cn("border border-border border-l-4 px-3 py-3", border, compact && "py-2")}>{body}</div>;
  }
  return (
    <button
      type="button"
      aria-pressed={Boolean(selected)}
      aria-label={ariaLabel ?? `${label}, ${value}`}
      onClick={onSelect}
      className={cn(
        "cursor-pointer border border-border border-l-4 px-3 py-3 text-left transition-colors hover:border-primary hover:bg-secondary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        border,
        compact && "py-2",
        selected && "border-primary bg-secondary/80 ring-1 ring-primary",
      )}
    >
      {body}
      {selected ? (
        <div className="mt-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-primary">Showing these lines</div>
      ) : null}
    </button>
  );
}

function AttentionSummary({
  summary,
  onView,
}: {
  summary: Data["attentionSummary"];
  onView: () => void;
}) {
  const items = [
    { n: summary.NO_STOCK_NO_INCOMING, label: "No stock or incoming" },
    { n: summary.STOCK_NOW_AVAILABLE, label: "Stock available now" },
    { n: summary.INCOMING_DOES_NOT_COVER, label: "Incoming does not cover" },
    { n: summary.LONG_STANDING, label: "Long-standing" },
    { n: summary.HIGH_VALUE, label: "High outstanding value" },
  ].filter((item) => item.n > 0);
  if (!items.length) return null;
  return (
    <section className="border-b border-border/70 px-4 py-3 sm:px-6" aria-label="Needs attention">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-[10px] font-semibold uppercase tracking-[0.14em] text-warn">Needs attention</h2>
          <ul className="mt-2 grid gap-1 text-[13px] sm:grid-cols-2">
            {items.map((item) => (
              <li key={item.label}>
                <span className="num mr-2 font-display text-lg font-semibold">{item.n}</span>
                {item.label}
              </li>
            ))}
          </ul>
        </div>
        <button type="button" className={primaryBtnClass} onClick={onView}>
          View attention
        </button>
      </div>
    </section>
  );
}

function ViewCard({
  id,
  label,
  hint,
  count,
  icon: Icon,
  accent,
  active,
  strong,
  onSelect,
}: {
  id: string;
  label: string;
  hint: string;
  count: number;
  icon: typeof ClipboardList;
  accent: "cyan" | "steel" | "info" | "attention";
  active: boolean;
  strong?: boolean;
  onSelect: () => void;
}) {
  const accentClass =
    accent === "attention"
      ? strong
        ? "border-warn text-warn"
        : "border-warn/40"
      : accent === "cyan"
        ? "border-cyan/50"
        : accent === "info"
          ? "border-cyan/30"
          : "border-border";
  return (
    <button
      type="button"
      aria-pressed={active}
      aria-label={`${label}, ${count}. ${hint}`}
      onClick={onSelect}
      className={cn(
        "flex items-start justify-between gap-3 border px-3 py-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        accentClass,
        active ? "bg-secondary/80 ring-1 ring-foreground/20" : "bg-surface/40 hover:bg-secondary/40",
      )}
    >
      <div>
        <div className="flex items-center gap-2">
          <Icon className="size-3.5 text-steel" aria-hidden />
          <span className="text-[11px] font-semibold uppercase tracking-[0.12em]">{label}</span>
        </div>
        <div className="mt-1 text-[12px] text-steel">{hint}</div>
      </div>
      <span className={cn("num font-display text-2xl font-semibold", id === "attention" && count > 0 && "text-warn")}>
        {qty(count)}
      </span>
    </button>
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
  const chips = activeBackorderFilterChips(search);
  const statusOff = backorderFilterIgnoredByMovement(search, "status");
  const positionOff = backorderFilterIgnoredByMovement(search, "position");
  const ageOff = backorderFilterIgnoredByMovement(search, "ageDays");
  const ignoredNote =
    search.movement === "CLEARED"
      ? "Cleared lines are historical: status, stock position and age filters describe current backorders and are not applied."
      : search.movement
        ? "Status filter is not applied while a movement is selected."
        : null;
  return (
    <div className="border-b border-border/70 px-4 py-3 sm:px-6">
      <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-steel">Filters</div>
      <div className="mb-3 flex flex-wrap gap-2">
        <QuickFilter
          label="Needs Attention"
          active={!search.movement && search.view === "attention"}
          onClick={() => patch({ view: "attention", movement: undefined, page: undefined })}
        />
        <QuickFilter
          label="Stock Available"
          active={!positionOff && search.position === "STOCK_AVAILABLE"}
          disabled={positionOff}
          onClick={() => patch({ position: search.position === "STOCK_AVAILABLE" ? undefined : "STOCK_AVAILABLE", page: undefined })}
        />
        <QuickFilter
          label="No Stock / No Incoming"
          active={!positionOff && search.position === "NO_STOCK_NO_INCOMING"}
          disabled={positionOff}
          onClick={() =>
            patch({
              position: search.position === "NO_STOCK_NO_INCOMING" ? undefined : "NO_STOCK_NO_INCOMING",
              page: undefined,
            })
          }
        />
        <QuickFilter
          label="7+ Days"
          active={!ageOff && search.ageDays === 7}
          disabled={ageOff}
          onClick={() => patch({ ageDays: search.ageDays === 7 ? undefined : 7, page: undefined })}
        />
        <QuickFilter
          label="Product Issue"
          active={search.condition === "HAS"}
          onClick={() => patch({ condition: search.condition === "HAS" ? undefined : "HAS", page: undefined })}
        />
      </div>
      <form
        className="flex flex-wrap gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          patch({ q: q.trim() || undefined, page: undefined });
        }}
      >
        <input
          className={`${controlClass} min-w-[240px] flex-1 sm:min-w-[380px]`}
          placeholder="Search order, customer, account, SKU or reference…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          aria-label="Search order, customer, account, SKU or reference"
        />
        <select className={cn(controlClass, statusOff && "opacity-50")} disabled={statusOff} title={statusOff ? ignoredNote ?? undefined : undefined} value={search.status ?? ""} onChange={(e) => patch({ status: e.target.value || undefined, page: undefined })} aria-label="Status">
          {BACKORDER_STATUS_FILTERS.map((opt) => (
            <option key={opt.value || "all"} value={opt.value}>{opt.label}</option>
          ))}
        </select>
        <select className={cn(controlClass, positionOff && "opacity-50")} disabled={positionOff} title={positionOff ? ignoredNote ?? undefined : undefined} value={search.position ?? ""} onChange={(e) => patch({ position: e.target.value || undefined, page: undefined })} aria-label="Stock position">
          {BACKORDER_POSITION_FILTERS.map((opt) => (
            <option key={opt.value || "all"} value={opt.value}>{opt.label}</option>
          ))}
        </select>
        <select className={cn(controlClass, ageOff && "opacity-50")} disabled={ageOff} title={ageOff ? ignoredNote ?? undefined : undefined} value={search.ageDays ? String(search.ageDays) : ""} onChange={(e) => patch({ ageDays: e.target.value ? Number(e.target.value) : undefined, page: undefined })} aria-label="Age">
          {BACKORDER_AGE_FILTERS.map((opt) => (
            <option key={opt.value || "all"} value={opt.value}>{opt.label}</option>
          ))}
        </select>
        <select className={controlClass} value={search.customerAccount ?? ""} onChange={(e) => patch({ customerAccount: e.target.value || undefined, page: undefined })} aria-label="Customer">
          <option value="">All customers</option>
          {(data?.customers ?? []).map((c) => (
            <option key={c.account} value={c.account}>{c.name} ({c.account})</option>
          ))}
        </select>
        <select className={controlClass} value={search.brand ?? ""} onChange={(e) => patch({ brand: e.target.value || undefined, page: undefined })} aria-label="Brand">
          <option value="">All brands</option>
          {(data?.brands ?? []).map((brand) => (
            <option key={brand} value={brand}>{brand}</option>
          ))}
        </select>
        <select className={controlClass} value={search.condition ?? ""} onChange={(e) => patch({ condition: (e.target.value as BackorderSearch["condition"]) || undefined, page: undefined })} aria-label="Product condition">
          {BACKORDER_CONDITION_FILTERS.map((opt) => (
            <option key={opt.value || "all"} value={opt.value}>{opt.label}</option>
          ))}
        </select>
        <select className={controlClass} value={search.catalogueType ?? ""} onChange={(e) => patch({ catalogueType: (e.target.value as BackorderSearch["catalogueType"]) || undefined, page: undefined })} aria-label="Catalogue type">
          <option value="">All catalogue types</option>
          <option value="CATALOGUE">Catalogue</option>
          <option value="EXTERNAL">External product</option>
          <option value="HISTORIC_ONLY">Historic/not current</option>
        </select>
        <button type="submit" className={btnClass}>Search</button>
      </form>
      {ignoredNote ? <p className="mt-2 text-[12px] text-steel">{ignoredNote}</p> : null}
      {chips.length ? (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {chips.map((chip) => (
            <button
              key={chip.key}
              type="button"
              className="inline-flex items-center gap-1 border border-border bg-secondary/50 px-2 py-1 text-[11px] uppercase tracking-[0.08em] text-steel hover:border-primary"
              onClick={() => patch({ [chip.key]: undefined, page: undefined })}
            >
              {chip.label} ×
            </button>
          ))}
          <button
            type="button"
            className="text-[11px] font-semibold uppercase tracking-[0.12em] text-primary hover:underline"
            onClick={() =>
              patch({
                movement: undefined,
                q: undefined,
                status: undefined,
                position: undefined,
                ageDays: undefined,
                customerAccount: undefined,
                brand: undefined,
                catalogueType: undefined,
                condition: undefined,
                page: undefined,
              })
            }
          >
            Clear all
          </button>
        </div>
      ) : null}
    </div>
  );
}

function QuickFilter({
  label,
  active,
  disabled,
  onClick,
}: {
  label: string;
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "h-8 border px-3 text-[11px] font-semibold uppercase tracking-[0.12em]",
        active ? "border-primary bg-primary/15 text-foreground" : "border-border bg-surface/40 text-steel hover:border-primary",
        disabled && "cursor-not-allowed opacity-50 hover:border-border",
      )}
    >
      {label}
    </button>
  );
}

function SettingsBody({
  data,
  busy,
  exporting,
  uploadId,
  onExport,
  onPoll,
  onToggle,
  onUpload,
}: {
  data: Data | null;
  busy: boolean;
  exporting: boolean;
  uploadId: string;
  onExport: () => void;
  onPoll: () => void;
  onToggle: () => void;
  onUpload: (file: File) => void;
}) {
  const feed = data?.feed;
  const freshness = data?.freshness;
  return (
    <div className="grid gap-6 text-[13px]">
      <section>
        <h3 className="font-display text-base font-semibold uppercase">Automatic import</h3>
        <dl className="mt-3 grid gap-2">
          <div>
            <dt className="text-[10px] font-semibold uppercase tracking-[0.12em] text-steel">Status</dt>
            <dd className="mt-1 flex items-center gap-2">
              <span className={cn("size-2 rounded-full", feed?.enabled ? "bg-good" : "bg-steel")} aria-hidden />
              {feed?.enabled ? "Enabled" : "Disabled"}
            </dd>
          </div>
          <div>
            <dt className="text-[10px] font-semibold uppercase tracking-[0.12em] text-steel">Expected schedule</dt>
            <dd className="mt-1">{AUTOPART_216V_SCHEDULE_LABEL}</dd>
          </div>
          <div>
            <dt className="text-[10px] font-semibold uppercase tracking-[0.12em] text-steel">Last successful report</dt>
            <dd className="mt-1">{freshness?.lastReceivedLabel ?? "Never"}</dd>
          </div>
          <div>
            <dt className="text-[10px] font-semibold uppercase tracking-[0.12em] text-steel">Current snapshot</dt>
            <dd className="mt-1">{freshness?.filename ?? "—"}{freshness?.sourceLabel ? ` · ${freshness.sourceLabel}` : ""}</dd>
          </div>
        </dl>
        {data?.canManage ? (
          <button type="button" className={`${primaryBtnClass} mt-4`} disabled={busy} onClick={onToggle}>
            {feed?.enabled ? "Disable automatic import" : "Enable automatic import"}
          </button>
        ) : (
          <p className="mt-3 text-[12px] text-steel">purchasing.manage is required to change automatic import.</p>
        )}
      </section>
      <section>
        <h3 className="font-display text-base font-semibold uppercase">Manual actions</h3>
        {data?.canManage ? (
          <div className="mt-3 grid gap-3">
            <div>
              <button type="button" className={btnClass} disabled={busy} onClick={onPoll}>
                Poll mailbox
              </button>
              <p className="mt-1 text-[12px] text-steel">Check the configured Autopart mailbox now.</p>
            </div>
            <div>
              <input
                id={uploadId}
                type="file"
                accept=".csv,.txt,text/csv,text/plain"
                className="sr-only"
                disabled={busy}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) onUpload(file);
                  e.currentTarget.value = "";
                }}
              />
              <label htmlFor={uploadId} className={cn(btnClass, busy && "pointer-events-none opacity-50")}>
                Upload 216V
              </label>
              <p className="mt-1 text-[12px] text-steel">Manually import an Autopart 216V CSV.</p>
            </div>
          </div>
        ) : (
          <p className="mt-2 text-[12px] text-steel">Upload and mailbox poll require purchasing.manage.</p>
        )}
      </section>
      <section>
        <h3 className="font-display text-base font-semibold uppercase">Export</h3>
        <button type="button" className={`${btnClass} mt-3`} disabled={exporting} onClick={onExport}>
          {exporting ? "Exporting…" : "Export current view CSV"}
        </button>
      </section>
    </div>
  );
}

function Fact({ label, value, title }: { label: string; value: string; title?: string | undefined }) {
  return (
    <div>
      <dt className="text-[10px] font-semibold uppercase tracking-[0.12em] text-steel">{label}</dt>
      <dd title={title}>{value}</dd>
    </div>
  );
}

function QuietNote({ children }: { children: React.ReactNode }) {
  return <div className="text-[11px] text-steel/80">{children}</div>;
}

function MovementPanel({
  movement,
  onClear,
  onPage,
  onOpen,
}: {
  movement: MovementData;
  onClear: () => void;
  onPage: (page: number) => void;
  onOpen: (row: MovementRow) => void;
}) {
  const cleared = movement.movement === "CLEARED";
  const filteredOut = movement.total !== movement.kpiCount;
  return (
    <section aria-label={`Movement: ${movement.label}`}>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/70 bg-secondary/30 px-4 py-3 sm:px-6">
        <div className="flex flex-wrap items-center gap-3 text-[13px]">
          <button
            type="button"
            onClick={onClear}
            aria-label={`Clear movement ${movement.label} and return to all current backorders`}
            className="inline-flex items-center gap-1 border border-primary bg-primary/15 px-2 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] hover:bg-primary/25"
          >
            Movement: {movement.label} ×
          </button>
          <span className="num font-semibold">
            {filteredOut
              ? `${qty(movement.total)} of ${qty(movement.kpiCount)} lines match the current filters`
              : `${qty(movement.total)} line${movement.total === 1 ? "" : "s"}`}
          </span>
          <span className="text-steel">
            {movement.previousSnapshot
              ? `Compared with previous snapshot ${movement.previousSnapshot.receivedLabel}${movement.previousSnapshot.filename ? ` (${movement.previousSnapshot.filename})` : ""}`
              : "No previous committed snapshot to compare against"}
          </span>
        </div>
        <button type="button" className={btnClass} onClick={onClear}>
          All current
        </button>
      </div>
      {cleared ? (
        <p className="border-b border-border/70 px-4 py-2 text-[12px] text-steel sm:px-6">
          Cleared lines were outstanding in the previous snapshot and are absent from the current one. They are history only and are not counted in current outstanding totals.
        </p>
      ) : null}
      {movement.rows.length === 0 ? (
        <EmptyState
          title={autopart216vMovementEmptyCopy(movement.movement)}
          body={
            filteredOut
              ? "Some movement lines are hidden by the current filters. Clear filters to see them."
              : "Movement compares the current 216V snapshot with the previous committed snapshot."
          }
        />
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1280px] text-left text-[13px]">
              <thead className="sticky top-0 z-10 bg-secondary/50 text-[10px] font-semibold uppercase tracking-[0.12em] text-steel">
                <tr>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Order No</th>
                  <th className="px-3 py-2">Customer</th>
                  <th className="px-3 py-2">Customer Account</th>
                  <th className="px-3 py-2">Customer Order Ref</th>
                  <th className="px-3 py-2">Product</th>
                  <th className="px-3 py-2">SKU</th>
                  <th className="px-3 py-2 text-right">Previous Qty</th>
                  <th className="px-3 py-2 text-right">Current Qty</th>
                  <th className="px-3 py-2 text-right">Change</th>
                  <th className="px-3 py-2 text-right">Unit Value</th>
                  <th className="px-3 py-2 text-right">Previous Value</th>
                  <th className="px-3 py-2 text-right">Current Value</th>
                  <th className="px-3 py-2">First seen</th>
                  <th className="px-3 py-2">{cleared ? "Cleared at" : "Last changed"}</th>
                  {cleared ? null : <th className="px-3 py-2">Stock</th>}
                </tr>
              </thead>
              <tbody>
                {movement.rows.map((row, i) => (
                  <tr
                    key={row.id}
                    className={cn(
                      "cursor-pointer border-t border-border/80 hover:bg-secondary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      i % 2 === 1 && "bg-secondary/20",
                    )}
                    tabIndex={0}
                    onClick={() => onOpen(row)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        onOpen(row);
                      }
                    }}
                  >
                    <td className="px-3 py-2.5"><ChangeStatusBadge status={row.status} label={row.statusLabel} /></td>
                    <td className="px-3 py-2.5 font-mono text-[12px] font-semibold">{row.orderNumber}</td>
                    <td className="px-3 py-2.5">
                      {row.customerName}
                      {row.unmapped ? <QuietNote>Unmapped account</QuietNote> : null}
                    </td>
                    <td className="px-3 py-2.5 font-mono text-[12px]">{row.customerAccount}</td>
                    <td className="max-w-[140px] truncate px-3 py-2.5" title={row.customerOrderRef || undefined}>
                      {row.customerOrderRef || "—"}
                    </td>
                    <td className="max-w-[220px] px-3 py-2.5">
                      <span className="block truncate" title={row.description}>{row.description}</span>
                      <QuietNote>{row.productKindLabel}</QuietNote>
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="font-mono text-[12px] font-semibold">{row.sku}</div>
                      <ProductConditionBadge code={row.conditionCode} />
                    </td>
                    <td className="num px-3 py-2.5 text-right">{qty(row.previousQty)}</td>
                    <td className="num px-3 py-2.5 text-right text-base font-semibold">{cleared ? "Cleared" : qty(row.currentQty)}</td>
                    <td className="num px-3 py-2.5 text-right font-semibold">{formatAutopart216vChangeQty(row.changeQty)}</td>
                    <td className="num px-3 py-2.5 text-right text-steel">{gbp(row.unitValue)}</td>
                    <td className="num px-3 py-2.5 text-right text-steel">{gbp(row.previousValue)}</td>
                    <td className="num px-3 py-2.5 text-right text-steel">{cleared ? "—" : gbp(row.currentValue)}</td>
                    <td className="px-3 py-2.5">{ukDate(row.firstSeenAt)}</td>
                    <td className="px-3 py-2.5">{formatOperationalDateTime(row.clearedAt ?? row.lastChangedAt) ?? ukDate(row.clearedAt ?? row.lastChangedAt)}</td>
                    {cleared ? null : (
                      <td className="px-3 py-2.5">
                        {row.position && row.positionLabel ? (
                          <PositionCell
                            row={{
                              position: row.position,
                              positionLabel: row.positionLabel,
                              coverSummary: row.coverSummary ?? "",
                              availQty: row.availQty,
                              incomingQty: row.incomingQty,
                              outstandingQty: row.currentQty ?? 0,
                            }}
                          />
                        ) : (
                          "—"
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pager page={movement.page} pageSize={movement.pageSize} total={movement.total} onPage={onPage} />
        </>
      )}
    </section>
  );
}

function ClearedDetailBody({ row }: { row: MovementRow }) {
  return (
    <div className="grid gap-5">
      <section className="grid gap-2">
        <StatusBadge tone="good">Cleared</StatusBadge>
        <p className="text-[12px] text-steel">
          Outstanding in the previous 216V snapshot and absent from the current snapshot. Not part of current outstanding totals.
        </p>
      </section>
      <section className="grid gap-2">
        <h3 className="font-display text-base font-semibold uppercase">Order</h3>
        <dl className="grid gap-2 text-[13px] sm:grid-cols-2">
          <Fact label="Order number" value={row.orderNumber} />
          <Fact label="Customer account" value={row.customerAccount} />
          <Fact label="Customer name" value={row.customerName} />
          <Fact label="Mapped AB company" value={row.companyName ?? "Unmapped account"} />
          <Fact label="Customer order / reference" value={row.customerOrderRef || "—"} />
        </dl>
      </section>
      <section className="grid gap-2">
        <h3 className="font-display text-base font-semibold uppercase">Product</h3>
        <dl className="grid gap-2 text-[13px] sm:grid-cols-2">
          <Fact label="Part number" value={row.sku} />
          <Fact label="Description" value={row.description} />
          <Fact label="Catalogue type" value={row.productKindLabel} />
          {row.conditionLabel ? (
            <Fact
              label="Current Product Condition"
              value={row.conditionLabel}
              title={row.conditionCode ? `Autopart condition: ${row.conditionCode} — ${row.conditionLabel}` : undefined}
            />
          ) : null}
        </dl>
        {row.conditionLabel ? (
          <p className="text-[12px] text-steel">
            Current Autopart product master. This is not the condition at the time the backorder was cleared.
          </p>
        ) : null}
      </section>
      <section className="grid gap-2">
        <h3 className="font-display text-base font-semibold uppercase">Previous backorder</h3>
        <dl className="grid gap-2 text-[13px] sm:grid-cols-2">
          <Fact label="Previous outstanding qty" value={qty(row.previousQty)} />
          <Fact label="Unit value" value={gbp(row.unitValue)} />
          <Fact label="Previous outstanding value" value={gbp(row.previousValue)} />
          <Fact label="First seen" value={ukDate(row.firstSeenAt)} />
          <Fact label="Cleared at" value={formatOperationalDateTime(row.clearedAt ?? row.lastChangedAt) ?? "—"} />
        </dl>
      </section>
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
          <thead className="sticky top-0 z-10 bg-surface text-[10px] font-semibold uppercase tracking-[0.12em] text-steel">
            <tr className="border-b border-border/80">
              <th className="px-3 pt-2 pb-0" colSpan={2}>History</th>
              <th className="border-l border-border/60 px-3 pt-2 pb-0" colSpan={4}>Order</th>
              <th className="border-l border-border/60 px-3 pt-2 pb-0" colSpan={2}>Product</th>
              <th className="border-l border-border/60 px-3 pt-2 pb-0" colSpan={3}>Backorder</th>
              <th className="border-l border-border/60 px-3 pt-2 pb-0" colSpan={3}>Stock</th>
              <th className="px-3 pt-2 pb-0"> </th>
            </tr>
            <tr className="bg-secondary/50">
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">First seen</th>
              <th className="sticky left-0 z-20 border-l border-border/60 bg-secondary/50 px-3 py-2">Order No</th>
              <th className="px-3 py-2">Customer</th>
              <th className="px-3 py-2">Customer Account</th>
              <th className="px-3 py-2">Customer Order Ref</th>
              <th className="border-l border-border/60 px-3 py-2">Product</th>
              <th className="px-3 py-2">SKU</th>
              <th className="border-l border-border/60 px-3 py-2 text-right">Outstanding Qty</th>
              <th className="px-3 py-2 text-right">Unit Value</th>
              <th className="px-3 py-2 text-right">Outstanding Value</th>
              <th className="border-l border-border/60 px-3 py-2 text-right">Available</th>
              <th className="px-3 py-2 text-right" title={INCOMING_SOURCE_HINT}>Incoming</th>
              <th className="px-3 py-2">Position</th>
              <th className="px-3 py-2">Last Changed</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr
                key={row.id}
                className={cn(
                  "cursor-pointer border-t border-border/80 hover:bg-secondary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  i % 2 === 1 && "bg-secondary/20",
                )}
                tabIndex={0}
                onClick={() => onOpen(row.id)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    onOpen(row.id);
                  }
                }}
              >
                <td className="px-3 py-2.5"><ChangeStatusBadge status={row.status} label={row.statusLabel} /></td>
                <td className="px-3 py-2.5">{row.ageLabel}</td>
                <td className={cn("sticky left-0 z-10 px-3 py-2.5 font-mono text-[12px] font-semibold", i % 2 === 1 ? "bg-secondary/20" : "bg-background")}>
                  {row.orderNumber}
                </td>
                <td className="px-3 py-2.5">
                  {row.companyId ? (
                    <Link className="text-primary underline-offset-2 hover:underline" to="/admin/customers/$id" params={{ id: row.companyId }}>{row.customerName}</Link>
                  ) : (
                    <>
                      <span>{row.customerName}</span>
                      <QuietNote>Unmapped account</QuietNote>
                    </>
                  )}
                </td>
                <td className="px-3 py-2.5 font-mono text-[12px]">{row.customerAccount}</td>
                <td className="max-w-[140px] truncate px-3 py-2.5" title={row.customerOrderRef || undefined}>
                  {row.customerOrderRef || "—"}
                </td>
                <td className="max-w-[220px] px-3 py-2.5">
                  <span className="block truncate" title={row.description}>{row.description}</span>
                  {row.productKind === "EXTERNAL" ? (
                    <StatusBadge tone="neutral" className="mt-1 normal-case tracking-normal">External product</StatusBadge>
                  ) : (
                    <QuietNote>{row.productKindLabel}</QuietNote>
                  )}
                </td>
                <td className="px-3 py-2.5">
                  <div className="font-mono text-[12px] font-semibold">{row.sku}</div>
                  <ProductConditionBadge code={row.conditionCode} />
                </td>
                <td className="num px-3 py-2.5 text-right text-base font-semibold">{qty(row.outstandingQty)}</td>
                <td className="num px-3 py-2.5 text-right text-steel">{gbp(row.unitValue)}</td>
                <td className="num px-3 py-2.5 text-right text-steel">{gbp(row.outstandingValue)}</td>
                <td className="num px-3 py-2.5 text-right text-base font-semibold">{row.availQty == null ? "—" : qty(row.availQty)}</td>
                <td className="num px-3 py-2.5 text-right text-base font-semibold">{row.incomingQty == null ? "—" : qty(row.incomingQty)}</td>
                <td className="px-3 py-2.5">
                  <PositionCell row={row} />
                </td>
                <td className="px-3 py-2.5">{formatOperationalDateTime(row.lastChangedAt) ?? ukDate(row.lastChangedAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Pager page={page} pageSize={pageSize} total={total} onPage={onPage} />
    </>
  );
}

function PositionCell({ row }: { row: Pick<LineRow, "position" | "positionLabel" | "coverSummary" | "availQty" | "incomingQty" | "outstandingQty"> }) {
  const title = stockPositionHeadline(row.position);
    const support =
    row.position === "STOCK_AVAILABLE"
      ? `${qty(row.availQty)} available against ${qty(row.outstandingQty)} backordered. Review allocation/despatch.`
      : row.position === "NO_STOCK_NO_INCOMING"
        ? `${qty(row.outstandingQty)} units currently backordered.`
        : row.position === "INCOMING_COVERS"
          ? `${qty(row.incomingQty)} incoming against ${qty(row.outstandingQty)} backordered. Arrival date not available.`
          : row.coverSummary;
  return (
    <div className="max-w-[240px]">
      <StockPositionBadge position={row.position} label={title} />
      <div className="mt-1 text-[11px] text-steel">{support}</div>
    </div>
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
          <section key={group.partMatchKey} className="border border-border bg-surface/40">
            <button type="button" className="flex w-full flex-wrap items-start justify-between gap-4 px-4 py-4 text-left" onClick={() => onExpand(expanded === group.partMatchKey ? null : group.partMatchKey)}>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <div className="font-mono text-[15px] font-semibold">{group.sku}</div>
                  <ProductConditionBadge code={group.conditionCode} />
                </div>
                <div className="font-display text-lg font-semibold uppercase">{group.description}</div>
                {group.productKind === "EXTERNAL" ? (
                  <StatusBadge tone="neutral" className="mt-1 normal-case tracking-normal">External product</StatusBadge>
                ) : (
                  <QuietNote>{group.productKindLabel}</QuietNote>
                )}
                <div className="mt-3">
                  <div className="num font-display text-2xl font-semibold">{qty(group.outstandingQty)} backordered</div>
                  <div className="text-[12px] text-steel">{qty(group.orders)} order · {qty(group.customers)} customer{group.customers === 1 ? "" : "s"}</div>
                </div>
              </div>
              <dl className="grid min-w-[220px] grid-cols-2 gap-x-6 gap-y-2 text-[13px]">
                <Fact label="Available" value={group.availQty == null ? "—" : qty(group.availQty)} />
                <Fact label="Incoming" value={group.incomingQty == null ? "—" : qty(group.incomingQty)} />
                <Fact label="Oldest first seen" value={group.oldestAgeLabel} />
                <div className="col-span-2">
                  <PositionCell
                    row={{
                      position: group.position,
                      positionLabel: group.positionLabel,
                      coverSummary: group.coverSummary,
                      availQty: group.availQty,
                      incomingQty: group.incomingQty,
                      outstandingQty: group.outstandingQty,
                    }}
                  />
                </div>
              </dl>
            </button>
            {expanded === group.partMatchKey ? (
              <table className="w-full text-left text-[13px]">
                <thead className="bg-secondary/40 text-[10px] font-semibold uppercase tracking-[0.12em] text-steel">
                  <tr>
                    <th className="px-3 py-2">Order</th>
                    <th className="px-3 py-2">Customer</th>
                    <th className="px-3 py-2 text-right">Qty</th>
                    <th className="px-3 py-2 text-right">Value</th>
                    <th className="px-3 py-2">First seen</th>
                  </tr>
                </thead>
                <tbody>
                  {group.lines.map((line) => (
                    <tr key={line.id} className="cursor-pointer border-t border-border/70 hover:bg-secondary/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" tabIndex={0} onClick={() => onOpen(line.id)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onOpen(line.id); } }}>
                      <td className="px-3 py-2 font-mono text-[12px] font-semibold">{line.orderNumber}</td>
                      <td className="px-3 py-2">
                        {line.customerName}
                        {line.unmapped ? <span className="ml-2 text-[11px] text-steel/80">Unmapped account</span> : null}
                      </td>
                      <td className="num px-3 py-2 text-right font-semibold">{qty(line.outstandingQty)}</td>
                      <td className="num px-3 py-2 text-right text-steel">{gbp(line.outstandingValue)}</td>
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
          <thead className="sticky top-0 z-10 bg-secondary/50 text-[10px] font-semibold uppercase tracking-[0.12em] text-steel">
            <tr>
              <th className="px-3 py-2">Customer</th>
              <th className="px-3 py-2">Autopart account</th>
              <th className="px-3 py-2 text-right">Orders</th>
              <th className="px-3 py-2 text-right">Lines</th>
              <th className="px-3 py-2 text-right">Units</th>
              <th className="px-3 py-2 text-right">Outstanding Value</th>
              <th className="px-3 py-2">Oldest first seen</th>
              <th className="px-3 py-2">Attention issues</th>
            </tr>
          </thead>
          <tbody>
            {groups.map((group, i) => (
              <tr key={group.customerAccount} className={cn("border-t border-border/80 align-top", i % 2 === 1 && "bg-secondary/20")}>
                <td className="px-3 py-2.5">
                  {group.companyId ? (
                    <Link className="text-primary underline-offset-2 hover:underline" to="/admin/customers/$id" params={{ id: group.companyId }}>{group.customerName}</Link>
                  ) : (
                    <>
                      <span>{group.customerName}</span>
                      <QuietNote>Unmapped account</QuietNote>
                    </>
                  )}
                </td>
                <td className="px-3 py-2.5 font-mono text-[12px]">{group.customerAccount}</td>
                <td className="num px-3 py-2.5 text-right font-semibold">{qty(group.orders)}</td>
                <td className="num px-3 py-2.5 text-right font-semibold">{qty(group.lines)}</td>
                <td className="num px-3 py-2.5 text-right font-semibold">{qty(group.units)}</td>
                <td className="num px-3 py-2.5 text-right text-steel">{gbp(group.outstandingValue)}</td>
                <td className="px-3 py-2.5">{group.oldestAgeLabel}</td>
                <td className="px-3 py-2.5 text-[12px] text-steel">
                  {group.attentionCount > 0 ? (
                    <span className="font-semibold text-warn">{qty(group.attentionCount)} need review</span>
                  ) : (
                    "None"
                  )}
                  {group.stockCoverIssues.length ? (
                    <div className="mt-1 text-[11px]">{group.stockCoverIssues.join(" · ")}</div>
                  ) : null}
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
    {
      id: "STOCK_NOW_AVAILABLE" as const,
      title: "STOCK AVAILABLE — REVIEW",
      copy: "Stock available in Autopart — review allocation/despatch. Avail is not a reservation and does not confirm the order can be fulfilled.",
      rows: data.attention.STOCK_NOW_AVAILABLE,
      tone: "warn" as const,
    },
    {
      id: "NO_STOCK_NO_INCOMING" as const,
      title: "NO STOCK / NO INCOMING",
      copy: data.attention.rules.find((r) => r.id === "NO_STOCK_NO_INCOMING")?.rule ?? "",
      rows: data.attention.NO_STOCK_NO_INCOMING,
      tone: "bad" as const,
    },
    {
      id: "INCOMING_DOES_NOT_COVER" as const,
      title: "INCOMING SHORTFALL",
      copy: data.attention.rules.find((r) => r.id === "INCOMING_DOES_NOT_COVER")?.rule ?? "",
      rows: data.attention.INCOMING_DOES_NOT_COVER,
      tone: "warn" as const,
    },
    {
      id: "LONG_STANDING" as const,
      title: "LONG-STANDING BACKORDER",
      copy: data.attention.rules.find((r) => r.id === "LONG_STANDING")?.rule ?? "",
      rows: data.attention.LONG_STANDING,
      tone: "warn" as const,
    },
    {
      id: "HIGH_VALUE" as const,
      title: "HIGH OUTSTANDING VALUE",
      copy: data.attention.rules.find((r) => r.id === "HIGH_VALUE")?.rule ?? "",
      rows: data.attention.HIGH_VALUE,
      tone: "warn" as const,
    },
  ];
  return (
    <div className="grid gap-6 px-4 py-5 sm:px-6">
      <p className="text-[13px] text-steel">Attention is a work queue. Rules are visible and deterministic. There is no hidden score. Incoming has no invented ETA.</p>
      {sections.map((section) => (
        <section
          key={section.id}
          className={cn(
            "border",
            section.tone === "bad" ? "border-destructive/50" : "border-border",
          )}
        >
          <header className={cn("border-b px-4 py-3", section.tone === "bad" ? "border-destructive/30 bg-destructive/10" : "border-border/70 bg-warn/5")}>
            <h2 className="font-display text-lg font-semibold uppercase">
              {section.title}
              <span className="num ml-2 text-base text-steel">{section.rows.length}</span>
            </h2>
            <p className="mt-1 text-[13px] text-steel">{section.copy}</p>
          </header>
          {section.rows.length === 0 ? (
            <p className="px-4 py-4 text-[13px] text-steel">None in the current filtered view.</p>
          ) : (
            <ul className="divide-y divide-border/70">
              {section.rows.map((row) => (
                <li key={`${section.id}-${row.id}`}>
                  <button type="button" className="flex w-full flex-wrap items-center justify-between gap-3 px-4 py-3 text-left hover:bg-secondary/30" onClick={() => onOpen(row.id)}>
                    <span>
                      <span className="font-mono text-[12px] font-semibold">{row.orderNumber}</span>
                      {" · "}{row.customerName}{" · "}
                      <span className="font-mono">{row.sku}</span>
                      <ProductConditionBadge code={row.conditionCode} />
                      {" · "}
                      <span className="num font-semibold">{qty(row.outstandingQty)}</span> units
                    </span>
                    <StockPositionBadge position={row.position} label={stockPositionHeadline(row.position)} />
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
          {line.conditionLabel ? (
            <Fact
              label="Product Condition"
              value={line.conditionLabel}
              title={line.conditionCode ? `Autopart condition: ${line.conditionCode} — ${line.conditionLabel}` : undefined}
            />
          ) : null}
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
        <PositionCell row={line} />
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
