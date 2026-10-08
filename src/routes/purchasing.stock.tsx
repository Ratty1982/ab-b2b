import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { PanelHeader } from "@/components/ab/AppShell";
import { StatusBadge, type Tone } from "@/components/ab/Badges";
import {
  EmptyState,
  ErrorState,
  LoadingState,
  Pager,
  SkuLink,
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
  position?: "all" | "in" | "low" | "out" | "incoming" | "fba";
  catalogue?: "all" | "catalogue" | "external";
  feed?: "current" | "historic" | "all";
  sort?: "recent" | "sku" | "avail" | "incoming";
  page?: number;
};

function parseSearch(raw: Record<string, unknown>): Search {
  const text = (key: string) => (typeof raw[key] === "string" ? raw[key] : "");
  const position = text("position");
  const catalogue = text("catalogue");
  const feed = text("feed");
  const sort = text("sort");
  const page = Number(raw["page"]);
  return {
    ...(text("q") ? { q: text("q") } : {}),
    ...(position === "in" || position === "low" || position === "out" || position === "incoming" || position === "fba"
      ? { position }
      : {}),
    ...(catalogue === "catalogue" || catalogue === "external" ? { catalogue } : {}),
    ...(feed === "historic" || feed === "all" ? { feed } : {}),
    ...(sort === "sku" || sort === "avail" || sort === "incoming" ? { sort } : {}),
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
        content: "Warehouse Avail from the Autopart import, with Amazon FBA kept separate from B2B sellable stock.",
      },
    ],
  }),
  component: StockOverviewPage,
});

type Data = Extract<Awaited<ReturnType<typeof getStockOverviewFn>>, { ok: true }>["data"];

function statusTone(status: Data["items"][number]["stockStatus"]): Tone {
  if (status === "OUT_OF_STOCK") return "bad";
  if (status === "LOW") return "warn";
  return "good";
}

function statusLabel(status: Data["items"][number]["stockStatus"]) {
  if (status === "OUT_OF_STOCK") return "Out";
  if (status === "LOW") return "Low";
  return "In stock";
}

function StockOverviewPage() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState(search.q ?? "");
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    setQ(search.q ?? "");
  }, [search.q]);

  useEffect(() => {
    let cancelled = false;
    void getStockOverviewFn({ data: search }).then((result) => {
      if (cancelled) return;
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
      setError(`Export includes the first ${result.data.exported.toLocaleString("en-GB")} of ${result.data.total.toLocaleString("en-GB")} SKUs.`);
    }
  }

  const summary = data?.summary;

  return (
    <>
      <PanelHeader
        title="Stock Overview"
        sub="Warehouse Avail is the imported 231PO3NEW quantity. FBA is Amazon stock and is not B2B sellable."
        crumbs={[{ label: "Purchasing", to: ROUTES.purchasing }, { label: "Stock Overview" }]}
        actions={
          <button type="button" className={btnClass} disabled={exporting || !data} onClick={() => void exportCsv()}>
            {exporting ? "Exporting" : "Export CSV"}
          </button>
        }
      />
      {error ? <ErrorState message={error} /> : null}
      {!data && !error ? <LoadingState label="Loading stock overview…" /> : null}
      {data && summary ? (
        <>
          <div className="grid gap-3 border-b border-border/70 px-4 py-4 sm:px-6 lg:grid-cols-2">
            <p className={`text-[13px] ${data.warehouse.stale ? "text-warn" : "text-steel"}`}>
              Warehouse import: {data.warehouse.updatedAt ? ukDate(data.warehouse.updatedAt) : "Not imported"}
              {data.warehouse.stale ? " · stale" : ""}
            </p>
            <p className={`text-[13px] ${data.fba.stale ? "text-warn" : "text-steel"}`}>
              {summary.fbaLabel}: {data.fba.updatedAt ? ukDate(data.fba.updatedAt) : "Not imported"}
              {data.fba.fileName ? ` · ${data.fba.fileName}` : ""}
              {data.fba.stale ? ` · older than ${data.fba.staleAfterDays} days` : ""}
            </p>
          </div>
          <div className="grid gap-3 px-4 py-4 sm:grid-cols-2 sm:px-6 xl:grid-cols-4">
            <Metric label={summary.warehouseLabel} value={qty(summary.availUnits)} hint={`${qty(summary.feedSkus)} SKUs on the latest feed`} />
            <Metric label="Incoming" value={qty(summary.incomingUnits)} hint={`${qty(summary.incomingSkus)} SKUs on order`} />
            <Metric label="Out of stock" value={qty(summary.outSkus)} hint={`${qty(summary.lowSkus)} low · ${qty(summary.inSkus)} in stock`} />
            <Metric label={summary.fbaLabel} value={qty(summary.fbaUnits)} hint={`${qty(summary.fbaSkus)} SKUs with FBA stock`} />
          </div>
          <p className="px-4 pb-4 text-[12px] leading-relaxed text-steel sm:px-6">
            {qty(summary.catalogueLinked)} latest-feed SKUs are linked to the catalogue. Reserved units across warehouses:{" "}
            {qty(summary.reservedUnits)}. B2B sellable stock is warehouse quantity minus reservations. FBA is shown in its own column.
          </p>
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
                placeholder="SKU, description or group"
                className={`${controlClass} w-56`}
              />
            </label>
            <label className="grid gap-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-steel">
              Warehouse
              <select
                className={controlClass}
                value={search.position ?? "all"}
                onChange={(event) => patch({ position: event.target.value as NonNullable<Search["position"]>, page: 1 })}
              >
                <option value="all">All positions</option>
                <option value="in">In stock</option>
                <option value="low">Low</option>
                <option value="out">Out of stock</option>
                <option value="incoming">Incoming</option>
                <option value="fba">FBA stock</option>
              </select>
            </label>
            <label className="grid gap-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-steel">
              Catalogue
              <select
                className={controlClass}
                value={search.catalogue ?? "all"}
                onChange={(event) => patch({ catalogue: event.target.value as NonNullable<Search["catalogue"]>, page: 1 })}
              >
                <option value="all">All products</option>
                <option value="catalogue">Catalogue</option>
                <option value="external">External</option>
              </select>
            </label>
            <label className="grid gap-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-steel">
              Feed
              <select
                className={controlClass}
                value={search.feed ?? "current"}
                onChange={(event) => patch({ feed: event.target.value as NonNullable<Search["feed"]>, page: 1 })}
              >
                <option value="current">Latest import</option>
                <option value="historic">Missing from latest import</option>
                <option value="all">All known SKUs</option>
              </select>
            </label>
            <label className="grid gap-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-steel">
              Sort
              <select
                className={controlClass}
                value={search.sort ?? "recent"}
                onChange={(event) => patch({ sort: event.target.value as NonNullable<Search["sort"]>, page: 1 })}
              >
                <option value="recent">Recently seen</option>
                <option value="sku">SKU</option>
                <option value="avail">Warehouse Avail</option>
                <option value="incoming">Incoming</option>
              </select>
            </label>
            <button type="submit" className={btnClass}>
              Search
            </button>
            <Link to={ROUTES.adminStockSync} className={`${btnClass} ml-auto`}>
              Autopart import
            </Link>
          </form>
          {data.items.length === 0 ? (
            <EmptyState title="No stock rows" body="No imported SKUs match these filters." />
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[1100px] text-left text-[13px]">
                  <thead className="bg-secondary/40 text-[10px] font-semibold uppercase tracking-[0.12em] text-steel">
                    <tr>
                      <th className="px-3 py-2">Product</th>
                      <th className="px-3 py-2">Group</th>
                      <th className="px-3 py-2">Condition</th>
                      <th className="px-3 py-2">Warehouse</th>
                      <th className="px-3 py-2">Reserved</th>
                      <th className="px-3 py-2">B2B sellable</th>
                      <th className="px-3 py-2" title={INCOMING_SOURCE_HINT}>
                        Incoming
                      </th>
                      <th className="px-3 py-2">FBA</th>
                      <th className="px-3 py-2">Owned</th>
                      <th className="px-3 py-2">Seen</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.items.map((row) => (
                      <tr key={row.sku} className="border-t border-border/70" data-stock-sku={row.sku}>
                        <td className="px-3 py-2">
                          <SkuLink sku={row.sku} name={row.description || row.sku} productKind={row.kind} />
                          <div className="mt-1">
                            <StatusBadge tone={statusTone(row.stockStatus)}>{statusLabel(row.stockStatus)}</StatusBadge>
                          </div>
                        </td>
                        <td className="px-3 py-2">{row.groupCode || "—"}</td>
                        <td className="px-3 py-2">{row.conditionLabel || "—"}</td>
                        <td className="px-3 py-2 tabular-nums">{qty(row.availQty)}</td>
                        <td className="px-3 py-2 tabular-nums">{row.reservedQty == null ? "—" : qty(row.reservedQty)}</td>
                        <td className="px-3 py-2 tabular-nums">{row.sellableQty == null ? "—" : qty(row.sellableQty)}</td>
                        <td className="px-3 py-2 tabular-nums">{qty(row.incomingQty)}</td>
                        <td className="px-3 py-2 tabular-nums">{qty(row.fbaQty)}</td>
                        <td className="px-3 py-2 tabular-nums">{qty(row.ownedQty)}</td>
                        <td className="px-3 py-2">{ukDate(row.lastSeenAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Pager page={data.page} pageSize={data.pageSize} total={data.total} onPage={(page) => patch({ page })} />
            </>
          )}
        </>
      ) : null}
    </>
  );
}

function Metric({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="border border-border bg-surface/60 p-4">
      <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-steel">{label}</div>
      <div className="mt-1 font-display text-2xl font-semibold tabular-nums">{value}</div>
      <p className="mt-1 text-[12px] text-steel">{hint}</p>
    </div>
  );
}
