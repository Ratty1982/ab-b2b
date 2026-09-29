import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { PanelHeader } from "@/components/ab/AppShell";
import { StatusBadge } from "@/components/ab/Badges";
import { inputClass } from "@/components/ab/Drawer";
import { formatDate } from "@/lib/datetime";
import { cn } from "@/lib/utils";
import { customerOrderStatusLabel, customerOrderStatusTone } from "@/domain/order-status";
import {
  deleteAdminOrdersFn,
  exportAutopartOrdersCsvFn,
  listAdminBackorderLinesFn,
  listAdminOrdersFn,
  previewAutopartOrderExportFn,
} from "@/server/phase2/fns";
import { toast } from "sonner";
import { useSession } from "@/lib/session";

type ExportFilter = "ALL" | "READY" | "EXPORTED" | "BLOCKED";
type BackorderFilter = "ALL" | "CONTAINS" | "FULL";
type BackorderLine = Extract<
  Awaited<ReturnType<typeof listAdminBackorderLinesFn>>,
  { ok: true }
>["data"]["items"][number];

function parseExportFilter(value: unknown): ExportFilter | undefined {
  if (value === "READY" || value === "EXPORTED" || value === "BLOCKED" || value === "ALL") {
    return value;
  }
  return undefined;
}

export const Route = createFileRoute("/admin/orders/")({
  validateSearch: (
    search: Record<string, unknown>,
  ): { autopartExport?: ExportFilter; backorders?: BackorderFilter } => {
    const autopartExport = parseExportFilter(search["autopartExport"]);
    const bo = search["backorders"];
    const backorders =
      bo === "ALL" || bo === "CONTAINS" || bo === "FULL" ? (bo as BackorderFilter) : undefined;
    return {
      ...(autopartExport ? { autopartExport } : {}),
      ...(backorders ? { backorders } : {}),
    };
  },
  head: () => ({ meta: [{ title: "Orders — Automotive Brands Admin" }] }),
  component: AdminOrdersPage,
});

type Row = Extract<Awaited<ReturnType<typeof listAdminOrdersFn>>, { ok: true }>["data"]["items"][number];

function downloadCsv(filename: string, csv: string) {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function AdminOrdersPage() {
  const session = useSession();
  const canDeleteOrders =
    session.signedIn &&
    (session.user.navPermissions.includes("orders.edit") ||
      session.user.navPermissions.includes("admin.access"));
  const search = Route.useSearch();
  const [rows, setRows] = useState<Row[]>([]);
  const [backorderLines, setBackorderLines] = useState<BackorderLine[]>([]);
  const [q, setQ] = useState("");
  const [exportFilter, setExportFilter] = useState<ExportFilter>(search.autopartExport ?? "ALL");
  const [backorderFilter, setBackorderFilter] = useState<BackorderFilter>(search.backorders ?? "ALL");
  const [stockNowOnly, setStockNowOnly] = useState(false);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [previewNote, setPreviewNote] = useState<string | null>(null);
  const showBackorderOps = backorderFilter === "CONTAINS" || backorderFilter === "FULL";

  useEffect(() => {
    setExportFilter(search.autopartExport ?? "ALL");
    setBackorderFilter(search.backorders ?? "ALL");
  }, [search.autopartExport, search.backorders]);

  const load = useCallback(async () => {
    setLoading(true);
    const result = await listAdminOrdersFn({
      data: {
        page: 1,
        pageSize: 50,
        q: q || undefined,
        autopartExport: exportFilter,
        backorders: backorderFilter,
      },
    });
    if (!result.ok) {
      setLoading(false);
      setError(result.error);
      return;
    }
    setError(null);
    setRows(result.data.items);
    setSelected({});
    setPreviewNote(null);

    if (backorderFilter === "CONTAINS" || backorderFilter === "FULL") {
      const lines = await listAdminBackorderLinesFn({
        data: {
          q: q || undefined,
          stockNowAvailable: stockNowOnly || undefined,
          fullyBackordered: backorderFilter === "FULL" || undefined,
          partBackordered: undefined,
        },
      });
      if (lines.ok) setBackorderLines(lines.data.items);
      else setBackorderLines([]);
    } else {
      setBackorderLines([]);
    }
    setLoading(false);
  }, [q, exportFilter, backorderFilter, stockNowOnly]);

  useEffect(() => {
    void load();
  }, [load]);

  const selectedIds = useMemo(
    () => Object.entries(selected).filter(([, v]) => v).map(([id]) => id),
    [selected],
  );

  function toggleAll(on: boolean) {
    const next: Record<string, boolean> = {};
    if (on) {
      for (const row of rows) next[row.id] = true;
    }
    setSelected(next);
  }

  async function onDeleteSelected() {
    if (!canDeleteOrders || selectedIds.length === 0) return;
    const selectedRows = rows.filter((r) => selectedIds.includes(r.id));
    const blocked = selectedRows.filter(
      (r) => r.status === "DISPATCHED" || r.status === "DELIVERED",
    );
    const deletable = selectedRows.filter(
      (r) => r.status !== "DISPATCHED" && r.status !== "DELIVERED",
    );
    if (deletable.length === 0) {
      toast.error("Despatched orders cannot be deleted");
      return;
    }
    const numbers = deletable.map((r) => r.orderNumber).join(", ");
    const warn =
      blocked.length > 0
        ? `\n\n${blocked.length} despatched order(s) will be skipped.`
        : "";
    const ok = window.confirm(
      `Delete ${deletable.length} order(s)?\n\n${numbers}\n\nReserved stock will be released back to available sellable stock. This cannot be undone.${warn}`,
    );
    if (!ok) return;
    setDeleting(true);
    const result = await deleteAdminOrdersFn({
      data: {
        orderIds: deletable.map((r) => r.id),
        confirmCount: deletable.length,
      },
    });
    setDeleting(false);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    const released = result.data.deleted.reduce((sum, d) => sum + d.releasedQuantity, 0);
    const skipNote =
      result.data.skipped.length > 0
        ? ` · ${result.data.skipped.length} skipped`
        : "";
    toast.success(
      `Deleted ${result.data.deleted.length} order(s)${
        released > 0 ? ` · ${released} unit(s) returned to stock` : ""
      }${skipNote}`,
    );
    await load();
  }

  async function onExport(confirmReexport = false) {
    if (selectedIds.length === 0) {
      toast.error("Select at least one order");
      return;
    }
    setExporting(true);
    setPreviewNote(null);

    const preview = await previewAutopartOrderExportFn({
      data: { orderIds: selectedIds, allowAlreadyExported: confirmReexport },
    });
    if (!preview.ok) {
      setExporting(false);
      toast.error(preview.error);
      return;
    }

    const p = preview.data;
    setPreviewNote(`Selected: ${p.selected} · Ready: ${p.ready} · Blocked: ${p.blocked}`);

    if (p.blocked > 0 && !confirmReexport) {
      setExporting(false);
      const blockedLines = p.items
        .filter((i) => !i.eligible)
        .map((i) => `${i.orderNumber}: ${i.message}`)
        .join("\n");
      toast.error(`Blocked orders must be removed or resolved before export.\n${blockedLines}`);
      return;
    }

    if (!confirmReexport && p.alreadyExported > 0) {
      setExporting(false);
      toast.error("Some selected orders were already exported. Confirm re-export deliberately.");
      return;
    }

    if (confirmReexport) {
      const prev = p.items.filter((i) => i.exportStatus === "EXPORTED");
      const msg = prev
        .map(
          (i) =>
            `${i.orderNumber} was previously exported${i.previouslyExportedAt ? ` on ${formatDate(i.previouslyExportedAt)}` : ""}${i.previouslyExportedByName ? ` by ${i.previouslyExportedByName}` : ""}.`,
        )
        .join("\n");
      const ok = window.confirm(
        `${msg}\n\nRe-exporting may create a duplicate order if the previous file was already imported into Autopart.\n\nContinue?`,
      );
      if (!ok) {
        setExporting(false);
        return;
      }
    }

    const result = await exportAutopartOrdersCsvFn({
      data: { orderIds: selectedIds, confirmReexport },
    });
    setExporting(false);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    downloadCsv(result.data.filename, result.data.csv);
    toast.success(
      `Exported ${result.data.orderCount} order(s) · ${result.data.batchReference}`,
    );
    await load();
  }

  return (
    <div>
      <PanelHeader title="Orders" sub="Automotive Brands order workspace" />
      <div className="p-4 sm:p-6">
        {error ? <p className="mb-4 text-sm text-bad">{error}</p> : null}
        <div className="mb-4 flex flex-wrap items-end gap-2">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search order number, company, reference…"
            className={cn(inputClass, "max-w-md")}
            aria-label="Search orders"
          />
          <label className="grid gap-1 text-[11px] font-semibold uppercase text-steel">
            Autopart
            <select
              value={exportFilter}
              onChange={(e) => setExportFilter(e.target.value as ExportFilter)}
              className={cn(inputClass, "min-w-[10rem]")}
            >
              <option value="ALL">All</option>
              <option value="READY">Ready for Autopart</option>
              <option value="EXPORTED">Exported</option>
              <option value="BLOCKED">Blocked</option>
            </select>
          </label>
          <label className="grid gap-1 text-[11px] font-semibold uppercase text-steel">
            Backorders
            <select
              value={backorderFilter}
              onChange={(e) => setBackorderFilter(e.target.value as BackorderFilter)}
              className={cn(inputClass, "min-w-[11rem]")}
            >
              <option value="ALL">All</option>
              <option value="CONTAINS">Contains backorder</option>
              <option value="FULL">Fully backordered</option>
            </select>
          </label>
          {showBackorderOps ? (
            <label className="flex h-10 items-center gap-2 text-[12px] text-steel">
              <input
                type="checkbox"
                checked={stockNowOnly}
                onChange={(e) => setStockNowOnly(e.target.checked)}
              />
              Stock now available
            </label>
          ) : null}
          <button
            type="button"
            disabled={exporting || selectedIds.length === 0}
            onClick={() => void onExport(false)}
            className="h-10 rounded-md bg-primary px-4 text-[12px] font-bold uppercase text-primary-foreground disabled:opacity-50"
          >
            {exporting ? "Exporting…" : "Export Autopart CSV"}
          </button>
          <button
            type="button"
            disabled={exporting || selectedIds.length === 0}
            onClick={() => void onExport(true)}
            className="h-10 rounded-md border border-border px-4 text-[12px] font-bold uppercase disabled:opacity-50"
          >
            Re-export CSV
          </button>
          {canDeleteOrders ? (
            <button
              type="button"
              disabled={deleting || exporting || selectedIds.length === 0}
              onClick={() => void onDeleteSelected()}
              className="h-10 rounded-md border border-destructive/40 px-4 text-[12px] font-bold uppercase tracking-wide text-destructive hover:bg-destructive/10 disabled:opacity-50"
              data-admin-action="delete-orders"
            >
              {deleting ? "Deleting…" : `Delete selected (${selectedIds.length})`}
            </button>
          ) : null}
        </div>
        {previewNote ? <p className="mb-3 text-[12px] text-steel">{previewNote}</p> : null}
        {loading ? <p className="text-[13px] text-steel">Loading…</p> : null}
        {showBackorderOps && !loading && backorderLines.length > 0 ? (
          <div className="mb-6">
            <h2 className="mb-2 font-display text-base font-semibold uppercase">
              Outstanding backorder lines
            </h2>
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full min-w-[1100px] text-[13px]">
                <thead>
                  <tr className="border-b border-border bg-surface/60 text-left text-[10px] uppercase text-steel">
                    <th className="px-3 py-2">Order</th>
                    <th className="px-3 py-2">Customer</th>
                    <th className="px-3 py-2">SKU</th>
                    <th className="px-3 py-2">Product</th>
                    <th className="px-3 py-2 text-right">Ordered</th>
                    <th className="px-3 py-2 text-right">Avail at order</th>
                    <th className="px-3 py-2 text-right">Outstanding</th>
                    <th className="px-3 py-2 text-right">Autopart avail</th>
                    <th className="px-3 py-2">Order date</th>
                    <th className="px-3 py-2">Status</th>
                    <th className="px-3 py-2">Account manager</th>
                  </tr>
                </thead>
                <tbody>
                  {backorderLines.map((line, i) => (
                    <tr
                      key={`${line.orderId}-${line.sku}-${i}`}
                      className={cn("border-b border-border/60", i % 2 && "bg-surface/30")}
                    >
                      <td className="num px-3 py-2">
                        <Link
                          to="/admin/orders/$orderId"
                          params={{ orderId: line.orderId }}
                          className="font-medium text-primary"
                        >
                          {line.orderNumber}
                        </Link>
                      </td>
                      <td className="px-3 py-2">{line.companyName}</td>
                      <td className="num px-3 py-2 text-steel">{line.sku}</td>
                      <td className="px-3 py-2">{line.productName}</td>
                      <td className="num px-3 py-2 text-right">{line.orderedQty}</td>
                      <td className="num px-3 py-2 text-right">
                        {line.availableQtyAtOrder ?? "—"}
                      </td>
                      <td className="num px-3 py-2 text-right font-semibold text-warn">
                        {line.outstandingBackorderQty}
                      </td>
                      <td className="num px-3 py-2 text-right">
                        {line.currentAutopartAvail ?? "—"}
                        {line.stockNowAvailable ? (
                          <span className="ml-1 text-[10px] uppercase text-good">Stock now</span>
                        ) : null}
                      </td>
                      <td className="px-3 py-2 text-steel">
                        {line.orderDate ? formatDate(line.orderDate) : "—"}
                      </td>
                      <td className="px-3 py-2">
                        <StatusBadge tone="warn">{line.statusLabel}</StatusBadge>
                      </td>
                      <td className="px-3 py-2 text-steel">{line.salesRepName || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}
        {!loading && rows.length === 0 ? (
          <p className="text-[13px] text-steel">No orders found.</p>
        ) : null}
        {rows.length > 0 ? (
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full min-w-[980px] text-[13px]">
              <thead>
                <tr className="border-b border-border bg-surface/60 text-left text-[10px] uppercase text-steel">
                  <th className="px-3 py-2">
                    <input
                      type="checkbox"
                      aria-label="Select all"
                      checked={rows.length > 0 && selectedIds.length === rows.length}
                      onChange={(e) => toggleAll(e.target.checked)}
                    />
                  </th>
                  <th className="px-3 py-2">Order</th>
                  <th className="px-3 py-2">Date</th>
                  <th className="px-3 py-2">Company</th>
                  <th className="px-3 py-2">Reference</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2 text-right">Total</th>
                  <th className="px-3 py-2">Autopart</th>
                  <th className="px-3 py-2">Export</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {rows.map((o, i) => (
                  <tr key={o.id} className={cn("border-b border-border/60", i % 2 && "bg-surface/30")}>
                    <td className="px-3 py-2">
                      <input
                        type="checkbox"
                        aria-label={`Select ${o.orderNumber}`}
                        checked={Boolean(selected[o.id])}
                        onChange={(e) =>
                          setSelected((prev) => ({ ...prev, [o.id]: e.target.checked }))
                        }
                      />
                    </td>
                    <td className="num px-3 py-2 font-medium text-primary">
                      <Link
                        to="/admin/orders/$orderId"
                        params={{ orderId: o.id }}
                        className="hover:underline"
                      >
                        {o.orderNumber}
                      </Link>
                    </td>
                    <td className="px-3 py-2 text-steel">
                      {o.placedAt ? formatDate(o.placedAt) : "—"}
                    </td>
                    <td className="px-3 py-2">{o.companyName}</td>
                    <td className="px-3 py-2 text-steel">{o.poNumber || "—"}</td>
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <StatusBadge tone={customerOrderStatusTone(o.status, { hasBackorderItems: o.containsBackorder })}>
                          {customerOrderStatusLabel(o.status, { hasBackorderItems: o.containsBackorder })}
                        </StatusBadge>
                        {o.containsBackorder ? (
                          <StatusBadge tone="warn">{o.fullyBackordered ? "Full backorder" : "Backorder"}</StatusBadge>
                        ) : null}
                      </div>
                    </td>
                    <td className="num px-3 py-2 text-right font-semibold">£{o.grandTotal}</td>
                    <td className="px-3 py-2 text-[12px] text-steel">
                      {o.autopartAccountLinked ? "Linked" : "Not linked"}
                    </td>
                    <td className="px-3 py-2 text-[12px]">
                      {o.autopartExportFilter === "EXPORTED" ? (
                        <StatusBadge tone="good">Exported</StatusBadge>
                      ) : o.autopartExportFilter === "READY" ? (
                        <StatusBadge tone="info">Ready</StatusBadge>
                      ) : (
                        <StatusBadge tone="warn">Blocked</StatusBadge>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <Link
                        to="/admin/orders/$orderId"
                        params={{ orderId: o.id }}
                        className="text-[12px] font-semibold text-primary"
                      >
                        Open
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
        <p className="mt-4 text-[12px] text-steel">
          Autopart CSV export is a manual import handoff only — no APC booking and no Autopart API
          submission.
        </p>
      </div>
    </div>
  );
}
