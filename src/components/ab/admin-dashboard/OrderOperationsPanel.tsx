import { Link } from "@tanstack/react-router";
import { StatusBadge } from "@/components/ab/Badges";
import { ROUTES } from "@/lib/app-nav";
import { cn } from "@/lib/utils";
import type { AdminDashboardData } from "./types";

export function OrderOperationsPanel({ data }: { data: AdminDashboardData }) {
  const lanes = [
    {
      key: "ready",
      label: "Ready for Autopart",
      count: data.ordersAttention.readyForExport.count,
      href: data.ordersAttention.readyForExport.href,
      tone: data.ordersAttention.readyForExport.count > 0 ? ("attention" as const) : ("idle" as const),
    },
    {
      key: "processing",
      label: "Processing",
      count: data.ordersAttention.processing.count,
      href: data.ordersAttention.processing.href,
      tone: "idle" as const,
    },
    {
      key: "blocked",
      label: "Export blocked",
      count: data.ordersAttention.exportBlocked.count,
      href: data.ordersAttention.exportBlocked.href,
      tone: data.ordersAttention.exportBlocked.count > 0 ? ("critical" as const) : ("idle" as const),
    },
    {
      key: "backorder",
      label: "Backorders",
      count: data.ordersAttention.backorderedOrders.count,
      href: data.ordersAttention.backorderedOrders.href,
      tone: data.ordersAttention.backorderedOrders.count > 0 ? ("attention" as const) : ("idle" as const),
      detail:
        data.ordersAttention.backorderedOrders.count > 0
          ? `${data.ordersAttention.backorderedOrders.units} units · ${data.ordersAttention.backorderedOrders.skusAffected} SKUs${
              data.ordersAttention.backorderedOrders.stockNowAvailableSkus > 0
                ? ` · ${data.ordersAttention.backorderedOrders.stockNowAvailableSkus} with stock now`
                : ""
            }`
          : null,
    },
  ];

  // Prefer blocked → ready → processing preview rows
  const preview =
    data.ordersAttention.exportBlocked.items.length > 0
      ? data.ordersAttention.exportBlocked.items
      : data.ordersAttention.readyForExport.items.length > 0
        ? data.ordersAttention.readyForExport.items
        : data.ordersAttention.processing.items;

  return (
    <section aria-labelledby="order-ops-heading">
      <div className="mb-3 flex items-end justify-between gap-3">
        <h2 id="order-ops-heading" className="font-display text-lg font-semibold uppercase">
          Order operations
        </h2>
        <Link
          to={ROUTES.adminOrders}
          className="text-[11px] font-semibold uppercase tracking-[0.12em] text-primary hover:underline"
        >
          All orders
        </Link>
      </div>

      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        {lanes.map((lane) => (
          <a
            key={lane.key}
            href={lane.href}
            className={cn(
              "rounded-lg bg-surface px-3 py-2.5 ring-1 ring-inset ring-border/50 transition-colors",
              "hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 active:bg-ink/40",
              "motion-reduce:transition-none",
            )}
          >
            <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-steel">
              {lane.label}
            </div>
            <div
              className={cn(
                "num mt-1 font-display text-xl font-semibold",
                lane.tone === "critical" && "text-primary",
                lane.tone === "attention" && "text-warn",
              )}
            >
              {lane.count}
            </div>
            {"detail" in lane && lane.detail ? (
              <p className="mt-1 text-[10px] leading-snug text-steel">{lane.detail}</p>
            ) : null}
          </a>
        ))}
      </div>

      {preview.length > 0 ? (
        <div className="mt-3 overflow-x-auto rounded-lg bg-surface ring-1 ring-inset ring-border/50">
          <table className="w-full min-w-[520px] text-[13px]">
            <tbody>
              {preview.map((o) => (
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
                  <td className="px-3 py-2">
                    <StatusBadge tone="neutral">{o.statusLabel}</StatusBadge>
                  </td>
                  <td className="num px-3 py-2 text-right font-semibold">{o.grandTotalLabel}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="mt-3 text-[13px] text-steel">No orders currently require operational action.</p>
      )}
    </section>
  );
}
