import { createFileRoute } from "@tanstack/react-router";
import { PanelHeader } from "@/components/ab/AppShell";
import { OrderStatusBadge } from "@/components/ab/Badges";
import { gbp, recentOrders } from "@/lib/data";

export const Route = createFileRoute("/portal/orders")({
  head: () => ({
    meta: [
      { title: "Order History — Automotive Brands Trade Portal" },
      {
        name: "description",
        content:
          "Full trade order history with PO numbers, status, delivery, tracking, invoices and one-click reorder.",
      },
      { property: "og:title", content: "Order History — Automotive Brands" },
      { property: "og:description", content: "Track, reorder and download invoices for every order." },
    ],
  }),
  component: Orders,
});

function Orders() {
  return (
    <div>
      <PanelHeader title="Orders" sub="Every order placed on account ABC001" />
      <div className="p-4 sm:p-6">
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[900px] text-[13px]">
            <thead>
              <tr className="border-b border-border bg-surface/60 text-left text-[10px] uppercase tracking-[0.12em] text-steel">
                <th className="px-3 py-2 font-semibold">Order Number</th>
                <th className="px-3 py-2 font-semibold">PO Number</th>
                <th className="px-3 py-2 font-semibold">Date</th>
                <th className="px-3 py-2 text-right font-semibold">Products</th>
                <th className="px-3 py-2 font-semibold">Status</th>
                <th className="px-3 py-2 text-right font-semibold">Value</th>
                <th className="px-3 py-2 font-semibold">Delivery</th>
                <th className="px-3 py-2 font-semibold">Tracking</th>
                <th className="px-3 py-2 font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody>
              {recentOrders.map((o, i) => (
                <tr
                  key={o.id}
                  className={`border-b border-border/60 hover:bg-secondary/60 ${i % 2 ? "bg-surface/30" : ""}`}
                >
                  <td className="num px-3 py-2.5 font-medium text-primary">{o.id}</td>
                  <td className="num px-3 py-2.5 text-steel">{o.po}</td>
                  <td className="px-3 py-2.5 text-steel">{o.date}</td>
                  <td className="num px-3 py-2.5 text-right">{o.lines}</td>
                  <td className="px-3 py-2.5">
                    <OrderStatusBadge status={o.status} />
                  </td>
                  <td className="num px-3 py-2.5 text-right font-semibold">{gbp(o.value)}</td>
                  <td className="px-3 py-2.5 text-steel">{o.delivery}</td>
                  <td className="num px-3 py-2.5 text-steel">{o.tracking}</td>
                  <td className="px-3 py-2.5">
                    <div className="flex gap-2 text-[12px] font-semibold">
                      <button type="button" className="text-primary hover:underline">
                        View
                      </button>
                      <button type="button" className="text-steel hover:text-foreground">
                        Invoice
                      </button>
                      <button type="button" className="text-steel hover:text-foreground">
                        Reorder
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
