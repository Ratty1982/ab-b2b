import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { PanelHeader } from "@/components/ab/AppShell";
import { StatusBadge } from "@/components/ab/Badges";
import { inputClass } from "@/components/ab/Drawer";
import { formatDate } from "@/lib/datetime";
import { cn } from "@/lib/utils";
import { listAdminOrdersFn } from "@/server/phase2/fns";

export const Route = createFileRoute("/admin/orders")({
  head: () => ({ meta: [{ title: "Orders — Automotive Brands Admin" }] }),
  component: AdminOrdersPage,
});

type Row = Extract<Awaited<ReturnType<typeof listAdminOrdersFn>>, { ok: true }>["data"]["items"][number];

function AdminOrdersPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [q, setQ] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const result = await listAdminOrdersFn({ data: { page: 1, pageSize: 50, q: q || undefined } });
    setLoading(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setError(null);
    setRows(result.data.items);
  }, [q]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div>
      <PanelHeader title="Orders" sub="Automotive Brands order workspace" />
      <div className="p-4 sm:p-6">
        {error ? <p className="mb-4 text-sm text-bad">{error}</p> : null}
        <div className="mb-4 flex flex-wrap gap-2">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search order number, company, reference…"
            className={cn(inputClass, "max-w-md")}
            aria-label="Search orders"
          />
        </div>
        {loading ? <p className="text-[13px] text-steel">Loading…</p> : null}
        {!loading && rows.length === 0 ? (
          <p className="text-[13px] text-steel">No orders found.</p>
        ) : null}
        {rows.length > 0 ? (
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full min-w-[900px] text-[13px]">
              <thead>
                <tr className="border-b border-border bg-surface/60 text-left text-[10px] uppercase text-steel">
                  <th className="px-3 py-2">Order</th>
                  <th className="px-3 py-2">Date</th>
                  <th className="px-3 py-2">Company</th>
                  <th className="px-3 py-2">Reference</th>
                  <th className="px-3 py-2">Sales rep</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2 text-right">Total</th>
                  <th className="px-3 py-2">Autopart</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {rows.map((o, i) => (
                  <tr key={o.id} className={cn("border-b border-border/60", i % 2 && "bg-surface/30")}>
                    <td className="num px-3 py-2 font-medium text-primary">{o.orderNumber}</td>
                    <td className="px-3 py-2 text-steel">
                      {o.placedAt ? formatDate(o.placedAt) : "—"}
                    </td>
                    <td className="px-3 py-2">{o.companyName}</td>
                    <td className="px-3 py-2 text-steel">{o.poNumber || "—"}</td>
                    <td className="px-3 py-2 text-steel">{o.salesRepName || "—"}</td>
                    <td className="px-3 py-2">
                      <StatusBadge tone={o.status === "SUBMITTED" ? "good" : "neutral"}>
                        {o.status === "SUBMITTED" ? "Received" : o.status}
                      </StatusBadge>
                    </td>
                    <td className="num px-3 py-2 text-right font-semibold">£{o.grandTotal}</td>
                    <td className="px-3 py-2 text-[12px] text-steel">
                      {o.autopartAccountLinked ? "Linked" : "Not linked"}
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
          Phase 6B records Automotive Brands orders only — nothing is submitted to Autopart.
        </p>
      </div>
    </div>
  );
}
