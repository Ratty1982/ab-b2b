import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Metric, PanelHeader } from "@/components/ab/AppShell";
import { StatusBadge, type Tone } from "@/components/ab/Badges";
import { StockPartDrawer } from "@/components/purchasing/stock-part-drawer";
import {
  EmptyState,
  ErrorState,
  Pager,
  btnClass,
  controlClass,
  downloadCsv,
  qty,
  ukDate,
  INCOMING_SOURCE_HINT,
} from "@/components/purchasing/workspace";
import { ROUTES } from "@/lib/app-nav";
import { exportStockOverviewCsvFn, getStockOverviewFn } from "@/server/phase2/fns";

type Search = {
  q?: string;
  position?: "all" | "in" | "low" | "out" | "unknown" | "incoming" | "fba";
  catalogue?: "all" | "catalogue" | "external";
  feed?: "current" | "historic" | "all";
  brand?: string;
  warehouse?: string;
  sort?: "recent" | "sku" | "name" | "brand" | "physical" | "sellable" | "incoming" | "updated";
  page?: number;
};

const POSITIONS = ["in", "low", "out", "unknown", "incoming", "fba"] as const;
const SORTS = ["sku", "name", "brand", "physical", "sellable", "incoming", "updated"] as const;

function parseSearch(raw: Record<string, unknown>): Search {
  const text = (key: string) => (typeof raw[key] === "string" ? raw[key] : "");
  const position = text("position");
  const catalogue = text("catalogue");
  const feed = text("feed");
  const sort = text("sort") === "avail" ? "sellable" : text("sort");
  const page = Number(raw["page"]);
  const brand = text("brand");
  const warehouse = text("warehouse");
  return {
    ...(text("q") ? { q: text("q") } : {}),
    ...(POSITIONS.some((item) => item === position)
      ? { position: position as NonNullable<Search["position"]> }
      : {}),
    ...(catalogue === "catalogue" || catalogue === "external" ? { catalogue } : {}),
    ...(feed === "historic" || feed === "all" ? { feed } : {}),
    ...(brand ? { brand } : {}),
    ...(warehouse ? { warehouse } : {}),
    ...(SORTS.some((item) => item === sort) ? { sort: sort as NonNullable<Search["sort"]> } : {}),
    ...(Number.isFinite(page) && page > 1 ? { page } : {}),
  };
}

export const Route = createFileRoute("/purchasing/stock")({
  validateSearch: (raw: Record<string, unknown>) => parseSearch(raw),
  head: () => ({
    meta: [
      { title: "Stock Overview — Purchasing — Automotive Brands" },
      {
        name: "description",
        content: "Live visibility of imported stock across all part numbers.",
      },
    ],
  }),
  component: StockOverviewPage,
});

type Data = Extract<Awaited<ReturnType<typeof getStockOverviewFn>>, { ok: true }>["data"];
type Item = Data["items"][number];

function statusTone(status: Item["stockStatus"]): Tone {
  if (status === "OUT_OF_STOCK") return "bad";
  if (status === "LOW") return "warn";
  if (status === "UNKNOWN") return "neutral";
  return "good";
}

function StockOverviewPage() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState(search.q ?? "");
  const [exporting, setExporting] = useState(false);
  const [openSku, setOpenSku] = useState<string | null>(null);

  useEffect(() => {
    setQ(search.q ?? "");
  }, [search.q]);

  useEffect(() => {
    if (q === (search.q ?? "")) return;
    const timer = window.setTimeout(() => {
      void navigate({ search: (current) => parseSearch({ ...current, q, page: 1 }) });
    }, 300);
    return () => window.clearTimeout(timer);
  }, [q, search.q, navigate]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void getStockOverviewFn({ data: search }).then((result) => {
      if (cancelled) return;
      setLoading(false);
      if (!result.ok) {
        setError(result.error);
        setData(null);
        return;
      }
      setError(null);
      setData(result.data);
    });
    return () => {
      cancelled = true;
    };
  }, [search]);

  function patch(next: Search) {
    void navigate({
      search: (current) => parseSearch({ ...current, ...next }),
    });
  }

  async function exportCsv() {
    setExporting(true);
    const result = await exportStockOverviewCsvFn({ data: search });
    setExporting(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    downloadCsv(result.data.csv, result.data.filename);
    if (result.data.truncated) {
      setError(
        `Export includes the first ${result.data.exported.toLocaleString("en-GB")} of ${result.data.total.toLocaleString("en-GB")} part numbers.`,
      );
    }
  }

  const summary = data?.summary;

  return (
    <>
      <PanelHeader
        title="Stock Overview"
        sub="Live visibility of imported stock across all part numbers."
        crumbs={[{ label: "Purchasing", to: ROUTES.purchasing }, { label: "Stock Overview" }]}
        actions={
          <button
            type="button"
            className={btnClass}
            disabled={exporting || !data}
            onClick={() => void exportCsv()}
          >
            {exporting ? "Preparing CSV" : "Download CSV"}
          </button>
        }
      />
      {error ? <ErrorState message={error} /> : null}
      {loading && !data ? <OverviewSkeleton /> : null}
      {data && summary ? (
        <>
          <ImportStatus status={data.importStatus} />
          <div className="grid gap-3 px-4 py-4 sm:grid-cols-2 sm:px-6 xl:grid-cols-3">
            <div data-summary-card="part-numbers">
              <Metric
                label="Total Part Numbers"
                value={qty(summary.partNumbers)}
                hint="Latest import. One row per part number."
              />
            </div>
            <div data-summary-card="physical">
              <Metric
                label="Total Physical Stock"
                value={summary.physicalUnits == null ? "—" : qty(summary.physicalUnits)}
                hint={
                  summary.physicalKnown === 0
                    ? "Physical quantity is not stored"
                    : `${qty(summary.physicalKnown)} of ${qty(summary.partNumbers)} part numbers include a physical quantity`
                }
              />
            </div>
            <div data-summary-card="unavailable">
              <Metric
                label="Total Unavailable Stock"
                value={qty(summary.unavailableUnits)}
                hint="Reserved against catalogue warehouse Avail"
              />
            </div>
            <div data-summary-card="sellable">
              <Metric
                label="Total Sellable Stock"
                value={qty(summary.sellableUnits)}
                hint="Catalogue Avail minus reservations. FBA is excluded."
                tone="good"
              />
            </div>
            <div data-summary-card="low">
              <Metric
                label="Low Stock Part Numbers"
                value={qty(summary.lowPartNumbers)}
                hint="At or below a configured reorder point"
                {...(summary.lowPartNumbers > 0 ? { tone: "warn" as const } : {})}
              />
            </div>
            <div data-summary-card="out">
              <Metric
                label="Out of Stock Part Numbers"
                value={qty(summary.outPartNumbers)}
                hint="Warehouse Avail is zero on the latest import"
                {...(summary.outPartNumbers > 0 ? { tone: "warn" as const } : {})}
              />
            </div>
          </div>
          <form
            className="flex flex-wrap items-end gap-2 border-y border-border/70 px-4 py-3 sm:px-6"
            onSubmit={(event) => {
              event.preventDefault();
              patch({ q, page: 1 });
            }}
          >
            <label className="grid gap-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-steel">
              Search
              <input
                value={q}
                onChange={(event) => setQ(event.target.value)}
                placeholder="Part number, name, brand, SKU or EAN"
                className={`${controlClass} w-64 max-w-full`}
              />
            </label>
            <label className="grid gap-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-steel">
              Status
              <select
                className={controlClass}
                value={search.position ?? "all"}
                onChange={(event) =>
                  patch({
                    position: event.target.value as NonNullable<Search["position"]>,
                    page: 1,
                  })
                }
              >
                <option value="all">All statuses</option>
                <option value="in">In stock</option>
                <option value="low">Low stock</option>
                <option value="out">Out of stock</option>
                <option value="unknown">Unknown</option>
                <option value="incoming">Incoming</option>
                <option value="fba">FBA stock</option>
              </select>
            </label>
            <label className="grid gap-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-steel">
              Brand
              <select
                className={controlClass}
                value={search.brand ?? ""}
                onChange={(event) => patch({ brand: event.target.value, page: 1 })}
              >
                <option value="">All brands</option>
                <option value="unlinked">Not linked</option>
                {data.brands.map((brand) => (
                  <option key={brand.id} value={brand.id}>
                    {brand.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-steel">
              Warehouse
              <select
                className={controlClass}
                value={search.warehouse ?? ""}
                onChange={(event) => patch({ warehouse: event.target.value, page: 1 })}
              >
                <option value="">All warehouses</option>
                {data.warehouses.map((warehouse) => (
                  <option key={warehouse.id} value={warehouse.id}>
                    {warehouse.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-steel">
              Catalogue
              <select
                className={controlClass}
                value={search.catalogue ?? "all"}
                onChange={(event) =>
                  patch({
                    catalogue: event.target.value as NonNullable<Search["catalogue"]>,
                    page: 1,
                  })
                }
              >
                <option value="all">All products</option>
                <option value="catalogue">Linked</option>
                <option value="external">Not linked</option>
              </select>
            </label>
            <label className="grid gap-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-steel">
              Feed
              <select
                className={controlClass}
                value={search.feed ?? "current"}
                onChange={(event) =>
                  patch({ feed: event.target.value as NonNullable<Search["feed"]>, page: 1 })
                }
              >
                <option value="current">Latest import</option>
                <option value="historic">Missing from latest import</option>
                <option value="all">All known part numbers</option>
              </select>
            </label>
            <button type="submit" className={btnClass}>
              Search
            </button>
            <Link to={ROUTES.adminStockSync} className={`${btnClass} ml-auto`}>
              Autopart import
            </Link>
          </form>
          <p className="px-4 py-2 text-[12px] text-steel sm:px-6">
            {qty(data.total)} {data.total === 1 ? "part number" : "part numbers"}
            {loading ? " · updating" : ""}
          </p>
          {data.items.length === 0 ? (
            <EmptyState
              title="No stock rows"
              body="No imported part numbers match these filters."
            />
          ) : (
            <>
              <div className="max-w-full overflow-x-auto">
                <table className="w-full min-w-[980px] text-left text-[13px]">
                  <thead className="bg-secondary/40 text-[10px] font-semibold uppercase tracking-[0.12em] text-steel">
                    <tr>
                      <SortHeader
                        label="Part number"
                        sortKey="sku"
                        search={search}
                        onSort={(sort) => patch({ sort, page: 1 })}
                      />
                      <SortHeader
                        label="Product"
                        sortKey="name"
                        search={search}
                        onSort={(sort) => patch({ sort, page: 1 })}
                      />
                      <SortHeader
                        label="Brand"
                        sortKey="brand"
                        search={search}
                        onSort={(sort) => patch({ sort, page: 1 })}
                      />
                      <th className="px-3 py-2">SKU / EAN</th>
                      <SortHeader
                        label="Physical"
                        sortKey="physical"
                        search={search}
                        onSort={(sort) => patch({ sort, page: 1 })}
                      />
                      <th className="px-3 py-2">Unavailable</th>
                      <SortHeader
                        label="Sellable"
                        sortKey="sellable"
                        search={search}
                        onSort={(sort) => patch({ sort, page: 1 })}
                      />
                      <th className="px-3 py-2">Status</th>
                      <SortHeader
                        label="Updated"
                        sortKey="updated"
                        search={search}
                        onSort={(sort) => patch({ sort, page: 1 })}
                      />
                      <th className="px-3 py-2">Catalogue</th>
                      <th className="px-3 py-2">Warehouse</th>
                      <th className="px-3 py-2" title={INCOMING_SOURCE_HINT}>
                        Incoming
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.items.map((row) => (
                      <tr
                        key={row.sku}
                        className="border-t border-border/70"
                        data-stock-sku={row.sku}
                      >
                        <td className="px-3 py-2">
                          <button
                            type="button"
                            className="font-semibold text-primary hover:underline"
                            onClick={() => setOpenSku(row.sku)}
                          >
                            {row.sku}
                          </button>
                        </td>
                        <td className="px-3 py-2">{row.productName || "—"}</td>
                        <td className="px-3 py-2">{row.brandName || "—"}</td>
                        <td className="px-3 py-2">
                          <div>{row.catalogueSku || row.sku}</div>
                          <div className="text-[11px] text-steel">{row.ean || "—"}</div>
                        </td>
                        <td className="px-3 py-2 tabular-nums">
                          {row.physicalQty == null ? "—" : qty(row.physicalQty)}
                        </td>
                        <td className="px-3 py-2 tabular-nums">
                          {row.unavailableQty == null ? "—" : qty(row.unavailableQty)}
                        </td>
                        <td className="px-3 py-2 tabular-nums">
                          {row.sellableQty == null ? "—" : qty(row.sellableQty)}
                        </td>
                        <td className="px-3 py-2">
                          <StatusBadge tone={statusTone(row.stockStatus)}>
                            {row.statusLabel}
                          </StatusBadge>
                        </td>
                        <td className="px-3 py-2">{ukDate(row.lastSeenAt)}</td>
                        <td className="px-3 py-2">{row.catalogueLabel}</td>
                        <td className="px-3 py-2">
                          {row.warehouseName || "—"}
                          {row.fbaQty > 0 ? (
                            <div className="text-[11px] text-steel">FBA {qty(row.fbaQty)}</div>
                          ) : null}
                        </td>
                        <td className="px-3 py-2 tabular-nums">{qty(row.incomingQty)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Pager
                page={data.page}
                pageSize={data.pageSize}
                total={data.total}
                onPage={(page) => patch({ page })}
              />
            </>
          )}
        </>
      ) : null}
      {openSku ? <StockPartDrawer sku={openSku} onClose={() => setOpenSku(null)} /> : null}
    </>
  );
}

function SortHeader({
  label,
  sortKey,
  search,
  onSort,
}: {
  label: string;
  sortKey: NonNullable<Search["sort"]>;
  search: Search;
  onSort: (sort: NonNullable<Search["sort"]>) => void;
}) {
  const active = (search.sort ?? "recent") === sortKey;
  return (
    <th className="px-3 py-2">
      <button
        type="button"
        className={active ? "text-ink" : undefined}
        onClick={() => onSort(sortKey)}
      >
        {label}
        {active ? " ▲" : ""}
      </button>
    </th>
  );
}

function ImportStatus({ status }: { status: Data["importStatus"] }) {
  const label = {
    running: "Import running",
    failed: "Import failed",
    delayed: "Import delayed",
    healthy: "Import healthy",
    unknown: "Import status unknown",
  }[status.health];
  const tone =
    status.health === "healthy"
      ? "good"
      : status.health === "failed"
        ? "bad"
        : status.health === "running"
          ? "info"
          : "warn";
  const fbaLabel = {
    current: "FBA import current",
    delayed: "FBA import delayed",
    unknown: "FBA import not recorded",
  }[status.fbaHealth];
  return (
    <div
      className="grid gap-2 border-b border-border/70 px-4 py-4 sm:px-6"
      data-import-status={status.health}
    >
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge tone={tone}>{label}</StatusBadge>
        <StatusBadge tone={status.fbaHealth === "current" ? "good" : "warn"}>
          {fbaLabel}
        </StatusBadge>
      </div>
      <p className="text-[13px] text-steel">
        Last successful import:{" "}
        {status.lastSuccessfulImportAt ? ukDate(status.lastSuccessfulImportAt) : "Not recorded"}
        {" · "}
        Last successful update:{" "}
        {status.lastSuccessfulUpdateAt
          ? ukDate(status.lastSuccessfulUpdateAt)
          : "No quantity changes recorded"}
        {" · "}
        Last updated: {status.lastUpdatedAt ? ukDate(status.lastUpdatedAt) : "—"}
      </p>
      <p className="text-[13px] text-steel">
        Latest import result: {status.latestStatus ?? "None"}
        {status.rowsRead != null ? ` · ${qty(status.rowsRead)} rows` : ""}
        {status.updatedCount != null ? ` · ${qty(status.updatedCount)} updated` : ""}
        {status.latestError ? ` · ${status.latestError}` : ""}
        {status.fbaFileName ? ` · FBA file ${status.fbaFileName}` : ""}
        {status.fbaUpdatedAt ? ` · ${ukDate(status.fbaUpdatedAt)}` : ""}
      </p>
    </div>
  );
}

function OverviewSkeleton() {
  return (
    <div className="grid gap-3 px-4 py-4 sm:grid-cols-2 sm:px-6 xl:grid-cols-3" aria-hidden>
      {Array.from({ length: 6 }, (_, index) => (
        <div key={index} className="h-24 animate-pulse border border-border bg-secondary/40" />
      ))}
    </div>
  );
}
