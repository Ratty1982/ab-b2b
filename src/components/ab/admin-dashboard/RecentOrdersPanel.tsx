import { Link } from "@tanstack/react-router";
import { StatusBadge } from "@/components/ab/Badges";
import { customerOrderStatusTone } from "@/domain/order-status";
import { ROUTES } from "@/lib/app-nav";
import type { AdminDashboardData } from "./types";

export function RecentOrdersPanel({
  rows,
}: {
  rows: AdminDashboardData["recentOrders"];
}) {
  return (
    <section aria-labelledby="recent-orders-heading">
      <div className="mb-3 flex items-end justify-between gap-3">
        <h2 id="recent-orders-heading" className="font-display text-lg font-semibold uppercase">
          Recent orders
        </h2>
        <Link
          to={ROUTES.adminOrders}
          className="text-[11px] font-semibold uppercase tracking-[0.12em] text-primary hover:underline"
        >
          All orders
        </Link>
      </div>
      {rows.length === 0 ? (
        <p className="text-[13px] text-steel">No orders today — and no recent B2B orders yet.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg bg-surface ring-1 ring-inset ring-border/50">
          <table className="w-full min-w-[680px] text-[13px]">
            <thead>
              <tr className="border-b border-border/50 text-left text-[10px] uppercase tracking-[0.12em] text-steel">
                <th className="px-3 py-2 font-semibold">Order</th>
                <th className="px-3 py-2 font-semibold">Customer</th>
                <th className="px-3 py-2 font-semibold">Placed</th>
                <th className="px-3 py-2 font-semibold">Status</th>
                <th className="px-3 py-2 text-right font-semibold">Total</th>
                <th className="px-3 py-2 font-semibold">Autopart</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((o) => (
                <tr
                  key={o.id}
                  className="border-b border-border/40 last:border-0 hover:bg-surface-2/80"
                >
                  <td className="num px-3 py-2">
                    <Link
                      to="/admin/orders/$orderId"
                      params={{ orderId: o.id }}
                      className="font-semibold text-primary hover:underline"
                    >
                      {o.orderNumber}
                    </Link>
                  </td>
                  <td className="px-3 py-2">{o.companyName}</td>
                  <td className="num px-3 py-2 text-steel">{o.placedAtLabel}</td>
                  <td className="px-3 py-2">
                    <StatusBadge tone={customerOrderStatusTone(o.status)}>
                      {o.statusLabel}
                    </StatusBadge>
                  </td>
                  <td className="num px-3 py-2 text-right font-semibold">{o.grandTotalLabel}</td>
                  <td className="px-3 py-2 text-steel">{o.autopartLabel}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
