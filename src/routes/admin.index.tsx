import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  AdminDashboardHeader,
  DashboardError,
  DashboardSkeleton,
  NeedsAttentionPanel,
  OperationalKpis,
  OperationalSections,
  OrderOperationsPanel,
  RecentActivityPanel,
  RecentOrdersPanel,
  SalesTrendPanel,
  SecondaryOpsPanel,
  SystemHealthPanel,
  TradeApplicationsPanel,
  type AdminDashboardData,
} from "@/components/ab/admin-dashboard";
import { getAdminDashboardFn } from "@/server/phase2/fns";

export const Route = createFileRoute("/admin/")({
  head: () => ({
    meta: [
      { title: "Admin Dashboard — Automotive Brands" },
      {
        name: "description",
          content:
          "What needs attention today across sales, CRM, stock and purchasing.",
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
  const sales = data.operational.sales;

  return (
    <>
      <AdminDashboardHeader greeting={data.greeting} quickActions={data.quickActions} />
      <OperationalKpis data={data} />

      <div className="grid gap-4 px-4 sm:px-6 lg:grid-cols-5">
        {sales ? (
          <div className="lg:col-span-3">
            <SalesTrendPanel sales={sales} />
          </div>
        ) : null}
        <div className={sales ? "lg:col-span-2" : "lg:col-span-5"}>
          <NeedsAttentionPanel items={data.needsAttention} />
        </div>
      </div>

      <div className="mt-6">
        <OperationalSections data={data} />
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
