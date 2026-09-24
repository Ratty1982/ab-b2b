import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { PanelHeader } from "@/components/ab/AppShell";
import { StatusBadge } from "@/components/ab/Badges";
import { ROUTES } from "@/lib/app-nav";
import { formatDate } from "@/lib/datetime";
import { listPortalOrdersFn } from "@/server/phase2/fns";

export const Route = createFileRoute("/portal/orders")({
  head: () => ({
    meta: [
      { title: "Order History — Automotive Brands Trade Portal" },
      {
        name: "description",
        content: "Your Automotive Brands trade order history.",
      },
    ],
  }),
  component: OrdersPage,
});

type Row = Extract<Awaited<ReturnType<typeof listPortalOrdersFn>>, { ok: true }>["data"]["items"][number];

function OrdersPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const result = await listPortalOrdersFn({ data: { page: 1, pageSize: 50 } });
    setLoading(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setError(null);
    setRows(result.data.items);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div>
      <PanelHeader title="Orders" sub="Orders placed on your trade account" />
      <div className="p-4 sm:p-6">
        {error ? <p className="mb-4 text-sm text-bad">{error}</p> : null}
        {loading ? <p className="text-[13px] text-steel">Loading orders…</p> : null}
        {!loading && rows.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border p-8 text-center">
            <p className="font-display text-lg font-semibold uppercase">No orders yet</p>
            <p className="mt-2 text-[13px] text-steel">Place an order from your basket to see it here.</p>
            <Link
              to={ROUTES.portalBasket}
              className="mt-5 inline-flex h-10 items-center rounded-md bg-primary px-4 text-[12px] font-bold uppercase text-primary-foreground"
            >
              Go to basket
            </Link>
          </div>
        ) : null}
        {rows.length > 0 ? (
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full min-w-[720px] text-[13px]">
              <thead>
                <tr className="border-b border-border bg-surface/60 text-left text-[10px] uppercase tracking-[0.12em] text-steel">
                  <th className="px-3 py-2 font-semibold">Order number</th>
                  <th className="px-3 py-2 font-semibold">Date</th>
                  <th className="px-3 py-2 font-semibold">Your reference</th>
                  <th className="px-3 py-2 font-semibold">Status</th>
                  <th className="px-3 py-2 text-right font-semibold">Total</th>
                  <th className="px-3 py-2 font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((o, i) => (
                  <tr
                    key={o.id}
                    className={`border-b border-border/60 hover:bg-secondary/60 ${i % 2 ? "bg-surface/30" : ""}`}
                  >
                    <td className="num px-3 py-2.5 font-medium text-primary">{o.orderNumber}</td>
                    <td className="px-3 py-2.5 text-steel">
                      {o.placedAt ? formatDate(o.placedAt) : "—"}
                    </td>
                    <td className="px-3 py-2.5 text-steel">{o.poNumber || "—"}</td>
                    <td className="px-3 py-2.5">
                      <StatusBadge tone={o.status === "SUBMITTED" ? "good" : "neutral"}>
                        {o.status === "SUBMITTED" ? "Received" : o.status}
                      </StatusBadge>
                    </td>
                    <td className="num px-3 py-2.5 text-right font-semibold">£{o.grandTotal}</td>
                    <td className="px-3 py-2.5">
                      <Link
                        to="/portal/orders/$orderId"
                        params={{ orderId: o.id }}
                        className="text-[12px] font-semibold text-primary hover:underline"
                      >
                        View
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </div>
    </div>
  );
}
