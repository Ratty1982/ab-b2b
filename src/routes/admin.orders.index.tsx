import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { PanelHeader } from "@/components/ab/AppShell";
import { StatusBadge } from "@/components/ab/Badges";
import { inputClass } from "@/components/ab/Drawer";
import { formatDate } from "@/lib/datetime";
import { cn } from "@/lib/utils";
import { customerOrderStatusLabel, customerOrderStatusTone } from "@/domain/order-status";
import {
  exportAutopartOrdersCsvFn,
  listAdminOrdersFn,
  previewAutopartOrderExportFn,
} from "@/server/phase2/fns";
import { toast } from "sonner";

export const Route = createFileRoute("/admin/orders/")({
  head: () => ({ meta: [{ title: "Orders — Automotive Brands Admin" }] }),
  component: AdminOrdersPage,
});

type Row = Extract<Awaited<ReturnType<typeof listAdminOrdersFn>>, { ok: true }>["data"]["items"][number];
type ExportFilter = "ALL" | "READY" | "EXPORTED" | "BLOCKED";

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
  const [rows, setRows] = useState<Row[]>([]);
  const [q, setQ] = useState("");
  const [exportFilter, setExportFilter] = useState<ExportFilter>("ALL");
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [previewNote, setPreviewNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const result = await listAdminOrdersFn({
      data: {
        page: 1,
        pageSize: 50,
        q: q || undefined,
        autopartExport: exportFilter,
      },
    });
    setLoading(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setError(null);
    setRows(result.data.items);
    setSelected({});
    setPreviewNote(null);
  }, [q, exportFilter]);

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
        </div>
        {previewNote ? <p className="mb-3 text-[12px] text-steel">{previewNote}</p> : null}
        {loading ? <p className="text-[13px] text-steel">Loading…</p> : null}
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
                    <td className="num px-3 py-2 font-medium text-primary">{o.orderNumber}</td>
                    <td className="px-3 py-2 text-steel">
                      {o.placedAt ? formatDate(o.placedAt) : "—"}
                    </td>
                    <td className="px-3 py-2">{o.companyName}</td>
                    <td className="px-3 py-2 text-steel">{o.poNumber || "—"}</td>
                    <td className="px-3 py-2">
                      <StatusBadge tone={customerOrderStatusTone(o.status)}>
                        {customerOrderStatusLabel(o.status)}
                      </StatusBadge>
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
