import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { PanelHeader } from "@/components/ab/AppShell";
import { StatusBadge, type Tone } from "@/components/ab/Badges";
import { inputClass } from "@/components/ab/Drawer";
import { ROUTES } from "@/lib/app-nav";
import { cn } from "@/lib/utils";
import { InstantText } from "@/components/ab/InstantText";
import { formatSdsCoveragePercent, SDS_NOT_REQUIRED_REASON_HINTS } from "@/domain/sds-coverage";
import {
  exportSdsCoverageCsvFn,
  listCatalogueBrandsFn,
  listSdsCoverageFn,
  setProductSdsRequirementFn,
} from "@/server/phase2/fns";
import { toast } from "sonner";
import { useSession } from "@/lib/session";

const STATUSES = ["ALL", "MISSING", "CURRENT", "ARCHIVED_ONLY", "NOT_REQUIRED"] as const;
type StatusFilter = (typeof STATUSES)[number];
type Population = "active" | "inactive" | "all";

export const Route = createFileRoute("/admin/products/documents")({
  head: () => ({
    meta: [
      { title: "SDS Coverage — Automotive Brands Admin" },
      {
        name: "description",
        content: "See which active catalogue products have a current SDS, which are missing, and which are marked not required.",
      },
    ],
  }),
  validateSearch: (search: Record<string, unknown>): { status?: Exclude<StatusFilter, "ALL"> } => {
    const status = search["status"];
    if (
      status === "MISSING" ||
      status === "CURRENT" ||
      status === "ARCHIVED_ONLY" ||
      status === "NOT_REQUIRED"
    ) {
      return { status };
    }
    return {};
  },
  component: SdsCoveragePage,
});

type CoveragePage = Extract<Awaited<ReturnType<typeof listSdsCoverageFn>>, { ok: true }>["data"];
type CoverageRow = CoveragePage["items"][number];

function statusTone(status: string): Tone {
  if (status === "CURRENT") return "good";
  if (status === "NOT_REQUIRED") return "neutral";
  if (status === "ARCHIVED_ONLY") return "warn";
  return "warn";
}

function statusMark(status: string) {
  if (status === "CURRENT") return "✓ Current";
  if (status === "MISSING") return "⚠ Missing";
  if (status === "ARCHIVED_ONLY") return "⚠ Archived only";
  return "— Not required";
}

function SdsCoveragePage() {
  const session = useSession();
  const navigate = useNavigate({ from: Route.fullPath });
  const search = Route.useSearch();
  const canEdit =
    session.signedIn && session.user.navPermissions.includes("products.edit");

  const [data, setData] = useState<CoveragePage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [brandId, setBrandId] = useState("");
  const [population, setPopulation] = useState<Population>("active");
  const [status, setStatus] = useState<StatusFilter>(search.status ?? "ALL");
  const [page, setPage] = useState(1);
  const [brands, setBrands] = useState<Array<{ id: string; name: string }>>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const [notRequiredOpen, setNotRequiredOpen] = useState(false);
  const [notRequiredIds, setNotRequiredIds] = useState<string[]>([]);
  const [reason, setReason] = useState("");
  const [reasonHint, setReasonHint] = useState("");

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q), 250);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    if (search.status && search.status !== status) {
      setStatus(search.status);
      setPage(1);
    }
  }, [search.status, status]);

  const query = useMemo(
    () => ({
      q: debouncedQ || undefined,
      brandId: brandId || undefined,
      population,
      status,
      page,
      pageSize: 25,
    }),
    [debouncedQ, brandId, population, status, page],
  );

  const load = useCallback(async () => {
    setLoading(true);
    const [pageRes, brandRes] = await Promise.all([
      listSdsCoverageFn({ data: query }),
      listCatalogueBrandsFn(),
    ]);
    if (!pageRes.ok) {
      setError(pageRes.error);
      setData(null);
      setLoading(false);
      return;
    }
    setError(null);
    setData(pageRes.data);
    if (brandRes.ok) setBrands(brandRes.data.map((b: { id: string; name: string }) => ({ id: b.id, name: b.name })));
    setLoading(false);
  }, [query]);

  useEffect(() => {
    void load();
  }, [load]);

  function setStatusFilter(next: StatusFilter) {
    setStatus(next);
    setPage(1);
    setSelected(new Set());
    void navigate({
      search: next === "ALL" || next === undefined ? {} : { status: next },
    });
  }

  async function exportCsv() {
    setBusy("export");
    const res = await exportSdsCoverageCsvFn({
      data: { q: query.q, brandId: query.brandId, population, status },
    });
    setBusy(null);
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    const blob = new Blob([res.data.csv], { type: res.data.mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = res.data.filename;
    a.click();
    URL.revokeObjectURL(url);
    toast.success(`Exported ${res.data.rowCount} rows`);
  }

  function openNotRequired(ids: string[]) {
    if (!ids.length) return;
    setNotRequiredIds(ids);
    setReason("");
    setReasonHint("");
    setNotRequiredOpen(true);
  }

  async function confirmNotRequired() {
    setBusy("not-required");
    const res = await setProductSdsRequirementFn({
      data: {
        productIds: notRequiredIds,
        requirement: "NOT_REQUIRED",
        reason: reason.trim() || reasonHint || null,
        confirm: true,
      },
    });
    setBusy(null);
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    toast.success(
      notRequiredIds.length === 1 ? "SDS marked not required" : `Marked ${res.data.updated} products not required`,
    );
    setNotRequiredOpen(false);
    setSelected(new Set());
    await load();
  }

  async function requireSds(productId: string) {
    setBusy(productId);
    const res = await setProductSdsRequirementFn({
      data: { productIds: [productId], requirement: "REQUIRED", confirm: true },
    });
    setBusy(null);
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    toast.success("SDS requirement restored");
    await load();
  }

  const summary = data?.summary;
  const selectedOnPage = data?.items.filter((row) => selected.has(row.productId)) ?? [];

  return (
    <div>
      <PanelHeader
        title="SDS Coverage"
        sub="Which active catalogue products have a current Safety Data Sheet, which still need one, and which have been marked not required."
        crumbs={[
          { label: "Operations" },
          { label: "Documents" },
        ]}
        actions={
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="h-10 rounded-md border border-border px-4 text-[12px] font-semibold uppercase tracking-wide disabled:opacity-50"
              disabled={busy === "export"}
              onClick={() => void exportCsv()}
            >
              {busy === "export" ? "Exporting…" : "Export CSV"}
            </button>
            <Link
              to={ROUTES.adminProductDocumentsImport}
              className="inline-flex h-10 items-center rounded-md bg-primary px-4 text-[12px] font-semibold uppercase tracking-wide text-primary-foreground"
            >
              Bulk SDS Upload
            </Link>
          </div>
        }
      />

      <div className="space-y-5 p-4 sm:p-6">
        {error ? <p className="text-[13px] text-bad">{error}</p> : null}

        {summary ? (
          <section>
            <div className="grid grid-cols-2 gap-2 lg:grid-cols-6">
              <SummaryCard
                label="Active Products"
                value={String(summary.activeProducts)}
                hint={summary.populationLabel}
              />
              <SummaryCard
                label="Current SDS"
                value={String(summary.currentSds)}
                onClick={() => setStatusFilter("CURRENT")}
                active={status === "CURRENT"}
              />
              <SummaryCard
                label="Missing SDS"
                value={String(summary.missingSds)}
                {...(summary.missingSds > 0 ? { tone: "warn" as const } : {})}
                onClick={() => setStatusFilter("MISSING")}
                active={status === "MISSING"}
              />
              <SummaryCard
                label="Archived Only"
                value={String(summary.archivedOnly)}
                {...(summary.archivedOnly > 0 ? { tone: "warn" as const } : {})}
                onClick={() => setStatusFilter("ARCHIVED_ONLY")}
                active={status === "ARCHIVED_ONLY"}
              />
              <SummaryCard
                label="Not Required"
                value={String(summary.notRequired)}
                onClick={() => setStatusFilter("NOT_REQUIRED")}
                active={status === "NOT_REQUIRED"}
              />
              <SummaryCard
                label="Coverage"
                value={formatSdsCoveragePercent(summary.coveragePercent)}
                hint="(Current SDS + Not Required) / Active Products"
              />
            </div>
            <p className="mt-2 text-[12px] text-steel">
              Coverage {formatSdsCoveragePercent(summary.coveragePercent)} = ({summary.currentSds} current
              + {summary.notRequired} not required) / {summary.activeProducts} active products. Archived-only
              is not counted as covered.
            </p>
          </section>
        ) : null}

        <div className="flex flex-col gap-2 lg:flex-row lg:flex-wrap lg:items-end">
          <label className="block min-w-[12rem] flex-1 text-[12px]">
            <span className="text-steel">Search</span>
            <input
              className={cn(inputClass, "mt-1")}
              value={q}
              placeholder="Product name, SKU or MPN"
              onChange={(e) => {
                setQ(e.target.value);
                setPage(1);
              }}
            />
          </label>
          <label className="block text-[12px]">
            <span className="text-steel">SDS status</span>
            <select
              className={cn(inputClass, "mt-1")}
              value={status}
              onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
            >
              <option value="ALL">All</option>
              <option value="MISSING">Missing SDS</option>
              <option value="CURRENT">Current SDS</option>
              <option value="ARCHIVED_ONLY">Archived only</option>
              <option value="NOT_REQUIRED">Not required</option>
            </select>
          </label>
          <label className="block text-[12px]">
            <span className="text-steel">Brand</span>
            <select
              className={cn(inputClass, "mt-1")}
              value={brandId}
              onChange={(e) => {
                setBrandId(e.target.value);
                setPage(1);
              }}
            >
              <option value="">All brands</option>
              {brands.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-[12px]">
            <span className="text-steel">Catalogue</span>
            <select
              className={cn(inputClass, "mt-1")}
              value={population}
              onChange={(e) => {
                setPopulation(e.target.value as Population);
                setPage(1);
              }}
            >
              <option value="active">Active B2B catalogue</option>
              <option value="inactive">Inactive / hidden</option>
              <option value="all">All products</option>
            </select>
          </label>
        </div>

        {canEdit && selectedOnPage.length > 0 ? (
          <div className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-surface/40 px-3 py-2">
            <p className="text-[12px] text-steel">{selectedOnPage.length} selected</p>
            <button
              type="button"
              className="h-9 rounded-md border border-border px-3 text-[11px] font-semibold uppercase"
              onClick={() => openNotRequired(selectedOnPage.map((r) => r.productId))}
            >
              Mark SDS not required
            </button>
          </div>
        ) : null}

        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[880px] text-[13px]">
            <thead>
              <tr className="border-b border-border bg-surface/60 text-left text-[10px] uppercase tracking-[0.12em] text-steel">
                {canEdit ? <th className="px-3 py-2 font-semibold"> </th> : null}
                <th className="px-3 py-2 font-semibold">Product</th>
                <th className="px-3 py-2 font-semibold">Brand</th>
                <th className="px-3 py-2 font-semibold">Primary SKU</th>
                <th className="px-3 py-2 font-semibold">SDS Status</th>
                <th className="px-3 py-2 font-semibold">Current SDS</th>
                <th className="px-3 py-2 font-semibold">Updated</th>
                <th className="px-3 py-2 text-right font-semibold">Action</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={canEdit ? 8 : 7} className="px-3 py-10 text-center text-sm text-steel">
                    Loading SDS coverage…
                  </td>
                </tr>
              ) : !data?.items.length ? (
                <tr>
                  <td colSpan={canEdit ? 8 : 7} className="px-3 py-10 text-center text-sm text-steel">
                    No products match these filters.
                  </td>
                </tr>
              ) : (
                data.items.map((row, i) => (
                  <CoverageTableRow
                    key={row.productId}
                    row={row}
                    striped={i % 2 === 1}
                    canEdit={canEdit}
                    selected={selected.has(row.productId)}
                    busy={busy === row.productId}
                    onToggle={() => {
                      setSelected((prev) => {
                        const next = new Set(prev);
                        if (next.has(row.productId)) next.delete(row.productId);
                        else next.add(row.productId);
                        return next;
                      });
                    }}
                    onMarkNotRequired={() => openNotRequired([row.productId])}
                    onRequire={() => void requireSds(row.productId)}
                  />
                ))
              )}
            </tbody>
          </table>
        </div>

        {data && data.pageCount > 1 ? (
          <div className="flex items-center justify-between text-[12px] text-steel">
            <p>
              Page {data.page} of {data.pageCount} · {data.total} products
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                className="h-9 rounded-md border border-border px-3 disabled:opacity-40"
                disabled={data.page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                Previous
              </button>
              <button
                type="button"
                className="h-9 rounded-md border border-border px-3 disabled:opacity-40"
                disabled={data.page >= data.pageCount}
                onClick={() => setPage((p) => p + 1)}
              >
                Next
              </button>
            </div>
          </div>
        ) : null}

        <p className="text-[12px] text-steel">
          Not Required is an internal business classification and is not an automated regulatory
          determination. Coverage is measured per product — pack sizes sharing one SDS count once.
        </p>
      </div>

      {notRequiredOpen ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center">
          <div className="w-full max-w-md rounded-lg border border-border bg-background p-5 shadow-lg">
            <h2 className="font-display text-base font-semibold uppercase">Mark SDS not required</h2>
            <p className="mt-2 text-[13px] text-steel">
              This is an internal classification only. You remain responsible for deciding whether an SDS
              is required. {notRequiredIds.length > 1 ? `${notRequiredIds.length} selected products.` : null}
            </p>
            <label className="mt-4 block text-[12px]">
              <span className="text-steel">Reason hint (optional)</span>
              <select
                className={cn(inputClass, "mt-1")}
                value={reasonHint}
                onChange={(e) => setReasonHint(e.target.value)}
              >
                <option value="">Choose a note…</option>
                {SDS_NOT_REQUIRED_REASON_HINTS.map((hint) => (
                  <option key={hint} value={hint}>
                    {hint}
                  </option>
                ))}
              </select>
            </label>
            <label className="mt-3 block text-[12px]">
              <span className="text-steel">Internal reason (optional)</span>
              <textarea
                className="mt-1 min-h-20 w-full rounded-md border border-border bg-background px-3 py-2"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                maxLength={240}
                placeholder="Shown only internally"
              />
            </label>
            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                className="h-10 rounded-md bg-primary px-4 text-[12px] font-semibold uppercase text-primary-foreground disabled:opacity-50"
                disabled={busy === "not-required"}
                onClick={() => void confirmNotRequired()}
              >
                Confirm
              </button>
              <button
                type="button"
                className="h-10 rounded-md border border-border px-4 text-[12px] font-semibold uppercase"
                onClick={() => setNotRequiredOpen(false)}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function SummaryCard({
  label,
  value,
  hint,
  tone,
  onClick,
  active,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "warn";
  onClick?: () => void;
  active?: boolean;
}) {
  const inner = (
    <>
      <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-steel">{label}</p>
      <p className={cn("mt-1 font-display text-2xl font-semibold", tone === "warn" && "text-warn")}>{value}</p>
      {hint ? <p className="mt-1 text-[11px] text-steel">{hint}</p> : null}
    </>
  );
  const className = cn(
    "rounded-lg border bg-surface/40 p-3 text-left",
    active ? "border-primary" : "border-border",
    onClick && "hover:bg-surface/70",
  );
  if (onClick) {
    return (
      <button type="button" className={className} onClick={onClick}>
        {inner}
      </button>
    );
  }
  return <div className={className}>{inner}</div>;
}

function CoverageTableRow({
  row,
  striped,
  canEdit,
  selected,
  busy,
  onToggle,
  onMarkNotRequired,
  onRequire,
}: {
  row: CoverageRow;
  striped: boolean;
  canEdit: boolean;
  selected: boolean;
  busy: boolean;
  onToggle: () => void;
  onMarkNotRequired: () => void;
  onRequire: () => void;
}) {
  const documentsSearch = { tab: "Documents" as const };
  const uploadSearch = { tab: "Documents" as const, uploadSds: true };
  return (
    <tr className={cn("border-b border-border/60 last:border-0", striped && "bg-surface/30")}>
      {canEdit ? (
        <td className="px-3 py-2">
          <input
            type="checkbox"
            aria-label={`Select ${row.name}`}
            checked={selected}
            onChange={onToggle}
          />
        </td>
      ) : null}
      <td className="px-3 py-2">
        <Link to="/admin/products/$id" params={{ id: row.productId }} className="font-medium hover:underline">
          {row.name}
        </Link>
      </td>
      <td className="px-3 py-2 text-steel">{row.brand}</td>
      <td className="num px-3 py-2 text-primary">{row.sku}</td>
      <td className="px-3 py-2">
        <StatusBadge tone={statusTone(row.sdsStatus)}>{statusMark(row.sdsStatus)}</StatusBadge>
      </td>
      <td className="px-3 py-2 text-steel">
        {row.sdsStatus === "ARCHIVED_ONLY" ? (
          <span>Archived SDS available — current SDS required</span>
        ) : row.currentSdsFilename ? (
          <span>
            {row.currentSdsFilename}
            {row.currentSdsDetail ? <span className="block text-[11px]">{row.currentSdsDetail}</span> : null}
          </span>
        ) : (
          "—"
        )}
      </td>
      <td className="num px-3 py-2 text-steel">
        <InstantText value={row.updatedAt} variant="date" />
      </td>
      <td className="px-3 py-2 text-right">
        <div className="flex flex-wrap justify-end gap-2">
          {row.sdsStatus === "MISSING" ? (
            <>
              <Link
                to="/admin/products/$id"
                params={{ id: row.productId }}
                search={uploadSearch}
                className="text-[12px] font-semibold text-primary hover:underline"
              >
                Upload SDS
              </Link>
              {canEdit ? (
                <button
                  type="button"
                  className="text-[12px] font-semibold text-steel hover:underline"
                  onClick={onMarkNotRequired}
                >
                  Mark not required
                </button>
              ) : null}
            </>
          ) : null}
          {row.sdsStatus === "ARCHIVED_ONLY" ? (
            <>
              <Link
                to="/admin/products/$id"
                params={{ id: row.productId }}
                search={documentsSearch}
                className="text-[12px] font-semibold text-primary hover:underline"
              >
                Review documents
              </Link>
              <Link
                to="/admin/products/$id"
                params={{ id: row.productId }}
                search={uploadSearch}
                className="text-[12px] font-semibold text-primary hover:underline"
              >
                Upload SDS
              </Link>
              {canEdit ? (
                <button
                  type="button"
                  className="text-[12px] font-semibold text-steel hover:underline"
                  onClick={onMarkNotRequired}
                >
                  Mark not required
                </button>
              ) : null}
            </>
          ) : null}
          {row.sdsStatus === "CURRENT" ? (
            <Link
              to="/admin/products/$id"
              params={{ id: row.productId }}
              search={documentsSearch}
              className="text-[12px] font-semibold text-primary hover:underline"
            >
              View documents
            </Link>
          ) : null}
          {row.sdsStatus === "NOT_REQUIRED" && canEdit ? (
            <button
              type="button"
              className="text-[12px] font-semibold text-primary hover:underline disabled:opacity-50"
              disabled={busy}
              onClick={onRequire}
            >
              Require SDS
            </button>
          ) : null}
        </div>
      </td>
    </tr>
  );
}
