import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  AdminDashboardHeader,
  DashboardError,
  DashboardKpiCard,
  DashboardSkeleton,
  NeedsAttentionPanel,
  OrderOperationsPanel,
  RecentActivityPanel,
  RecentOrdersPanel,
  SecondaryOpsPanel,
  SystemHealthPanel,
  TradeApplicationsPanel,
  type AdminDashboardData,
} from "@/components/ab/admin-dashboard";
import { ROUTES } from "@/lib/app-nav";
import { getAdminDashboardFn } from "@/server/phase2/fns";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/admin/")({
  head: () => ({
    meta: [
      { title: "Admin Dashboard — Automotive Brands" },
      {
        name: "description",
        content:
          "Operational overview for Automotive Brands B2B: orders, trade applications, Autopart status and recent activity.",
      },
      { property: "og:title", content: "Admin Dashboard — Automotive Brands" },
    ],
  }),
  component: AdminOverview,
});

function AdminOverview() {
  const [data, setData] = useState<AdminDashboardData | null>(null);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setLoading(true);
      setError(false);
      const result = await getAdminDashboardFn();
      if (cancelled) return;
      setLoading(false);
      if (!result.ok) {
        setError(true);
        setData(null);
        return;
      }
      setData(result.data);
    })();
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  return (
    <div data-admin-dashboard="command-centre">
      {loading ? (
        <DashboardSkeleton />
      ) : error ? (
        <DashboardError onRetry={() => setReloadKey((k) => k + 1)} />
      ) : data ? (
        <DashboardBody data={data} />
      ) : null}
    </div>
  );
}

function DashboardBody({ data }: { data: AdminDashboardData }) {
  const kpiCount = data.summary.openQuotes ? 5 : 4;

  return (
    <>
      <AdminDashboardHeader greeting={data.greeting} quickActions={data.quickActions} />

      <div
        className={cn(
          "grid gap-2 px-4 py-4 sm:grid-cols-2 sm:px-6",
          kpiCount >= 5 ? "lg:grid-cols-5" : "lg:grid-cols-4",
        )}
      >
        <DashboardKpiCard
          label="Today's sales"
          value={data.summary.ordersToday.orderValueLabel}
          hint={
            data.summary.ordersToday.count === 0
              ? "No orders today"
              : `${data.summary.ordersToday.count} order${
                  data.summary.ordersToday.count === 1 ? "" : "s"
                } today`
          }
          href={ROUTES.adminOrders}
          accent="brand"
        />
        <DashboardKpiCard
          label="Open orders"
          value={String(data.summary.openOrders.count)}
          hint={
            data.ordersAttention.readyForExport.count > 0
              ? `${data.ordersAttention.readyForExport.count} ready for Autopart export`
              : "Received, processing, despatched or on hold"
          }
          href={ROUTES.adminOrders}
        />
        <DashboardKpiCard
          label="Trade customers"
          value={String(data.summary.activeTradeCustomers.count)}
          hint={
            data.customers.newlyApproved7d > 0
              ? `+${data.customers.newlyApproved7d} approved in last 7 days`
              : "ACTIVE companies"
          }
          href={ROUTES.adminCustomers}
        />
        <DashboardKpiCard
          label="Trade applications"
          value={String(data.summary.tradeApplicationsAttention.count)}
          hint={
            data.summary.tradeApplicationsAttention.count === 0
              ? "None requiring attention"
              : `${data.summary.tradeApplicationsAttention.count} requiring attention`
          }
          href={ROUTES.adminApplications}
          accent={data.summary.tradeApplicationsAttention.count > 0 ? "warn" : "none"}
        />
        {data.summary.openQuotes ? (
          <DashboardKpiCard
            label="Open quotes"
            value={String(data.summary.openQuotes.count)}
            hint={
              data.summary.openQuotes.expiringSoon > 0
                ? `${data.summary.openQuotes.expiringSoon} expiring soon`
                : "Draft, sent or viewed"
            }
            href={ROUTES.salesQuotes}
          />
        ) : null}
      </div>

      <div className="px-4 sm:px-6">
        <NeedsAttentionPanel items={data.needsAttention} />
      </div>

      <div className="mt-6 grid gap-6 px-4 pb-8 sm:px-6 xl:grid-cols-3">
        <section className="space-y-6 xl:col-span-2">
          <OrderOperationsPanel data={data} />
          <RecentOrdersPanel rows={data.recentOrders} />
          <TradeApplicationsPanel data={data} />
        </section>

        <aside className="space-y-6">
          <SystemHealthPanel rows={data.systemHealth} />
          <SecondaryOpsPanel callbacks={data.callbacks} quotes={data.quotes} />
          <RecentActivityPanel rows={data.recentActivity} />
        </aside>
      </div>
    </>
  );
}
