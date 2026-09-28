import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState, type ReactNode } from "react";
import { PanelHeader, Metric } from "@/components/ab/AppShell";
import { StatusBadge } from "@/components/ab/Badges";
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

type Dashboard = Extract<Awaited<ReturnType<typeof getAdminDashboardFn>>, { ok: true }>["data"];

function AdminOverview() {
  const [data, setData] = useState<Dashboard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void (async () => {
      setLoading(true);
      const result = await getAdminDashboardFn();
      setLoading(false);
      if (!result.ok) {
        setError(result.error || "Could not load dashboard");
        return;
      }
      setError(null);
      setData(result.data);
    })();
  }, []);

  return (
    <div>
      <PanelHeader
        title="Dashboard"
        sub="What needs attention, what has happened, current system state"
        crumbs={[{ label: "Home" }, { label: "Dashboard", to: ROUTES.admin }]}
      />

      {loading ? (
        <p className="p-6 text-sm text-steel">Loading operational overview…</p>
      ) : error ? (
        <p className="p-6 text-sm text-primary">{error}</p>
      ) : data ? (
        <DashboardBody data={data} />
      ) : null}
    </div>
  );
}

function DashboardBody({ data }: { data: Dashboard }) {
  const cards: Array<{
    label: string;
    value: string;
    hint: string;
    tone?: "brand" | "warn" | "good" | undefined;
    to?: string;
  }> = [
    {
      label: "Orders today",
      value: String(data.summary.ordersToday.count),
      hint:
        data.summary.ordersToday.count === 0
          ? "No B2B orders placed today"
          : `${data.summary.ordersToday.orderValueLabel} order value (inc VAT)`,
      tone: "brand",
      to: ROUTES.adminOrders,
    },
    {
      label: "Open orders",
      value: String(data.summary.openOrders.count),
      hint: "Received, processing, despatched or on hold",
      to: ROUTES.adminOrders,
    },
    {
      label: "Active trade customers",
      value: String(data.summary.activeTradeCustomers.count),
      hint:
        data.customers.newlyApproved7d > 0
          ? `${data.customers.newlyApproved7d} newly approved (7 days)`
          : "ACTIVE companies",
      to: ROUTES.adminCustomers,
    },
    {
      label: "Trade applications",
      value: String(data.summary.tradeApplicationsAttention.count),
      hint: "Submitted / under review / more info required",
      tone: data.summary.tradeApplicationsAttention.count > 0 ? "warn" : undefined,
      to: ROUTES.adminApplications,
    },
  ];

  if (data.summary.openQuotes) {
    cards.push({
      label: "Open quotes",
      value: String(data.summary.openQuotes.count),
      hint: "Draft, sent or viewed",
      to: ROUTES.salesQuotes,
    });
  }

  return (
    <>
      <div
        className={cn(
          "grid gap-px bg-border sm:grid-cols-2",
          cards.length >= 5 ? "lg:grid-cols-5" : "lg:grid-cols-4",
        )}
      >
        {cards.map((card) => (
          <Metric
            key={card.label}
            label={card.label}
            value={card.value}
            hint={card.hint}
            {...(card.tone ? { tone: card.tone } : {})}
          />
        ))}
      </div>

      <div className="grid gap-6 p-4 sm:p-6 xl:grid-cols-3">
        <section className="space-y-6 xl:col-span-2">
          <NeedsAttention items={data.needsAttention} />

          <OrdersAttention data={data} />

          <ApplicationsSection data={data} />

          <RecentOrdersSection rows={data.recentOrders} />
        </section>

        <aside className="space-y-6">
          {data.stock ? <StockCard stock={data.stock} /> : null}
          {data.autopart504c ? <Feed504cCard feed={data.autopart504c} /> : null}
          {data.email ? <EmailCard email={data.email} /> : null}
          {data.callbacks ? <CallbacksCard count={data.callbacks.openCount} /> : null}
          {data.quotes ? <QuotesCard quotes={data.quotes} /> : null}
          <ActivitySection rows={data.recentActivity} />
        </aside>
      </div>
    </>
  );
}

function NeedsAttention({
  items,
}: {
  items: Dashboard["needsAttention"];
}) {
  return (
    <div>
      <h2 className="mb-3 font-display text-lg font-semibold uppercase">Needs attention</h2>
      {items.length === 0 ? (
        <EmptyBox>You're up to date — no action items right now.</EmptyBox>
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border text-[13px]">
          {items.map((item) => (
            <li
              key={item.id}
              className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 px-3 py-3"
            >
              <span
                className={cn(
                  "num inline-grid size-8 place-items-center rounded-md font-semibold",
                  item.severity === "info"
                    ? "bg-surface text-steel"
                    : "bg-primary/15 text-primary",
                )}
              >
                {item.count == null ? "i" : item.count}
              </span>
              <span className="min-w-0 truncate">{item.label}</span>
              <a href={item.href} className="text-[12px] font-semibold text-primary hover:underline">
                Open
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function OrdersAttention({ data }: { data: Dashboard }) {
  const sections = [
    {
      key: "credit-hold",
      title: "Credit Hold",
      count: data.ordersAttention.creditHold.count,
      items: data.ordersAttention.creditHold.items,
      empty: "No orders on credit hold.",
      href: `${ROUTES.adminOrders}?credit=HOLD`,
    },
    {
      key: "credit-review",
      title: "Credit Review",
      count: data.ordersAttention.creditReview.count,
      items: data.ordersAttention.creditReview.items,
      empty: "No orders awaiting account credit review.",
      href: `${ROUTES.adminOrders}?credit=REVIEW`,
    },
    {
      key: "ready",
      title: "Ready for Autopart export",
      count: data.ordersAttention.readyForExport.count,
      items: data.ordersAttention.readyForExport.items,
      empty: "No orders waiting for Autopart export.",
      href: `${ROUTES.adminOrders}?autopartExport=READY`,
    },
    {
      key: "processing",
      title: "Processing / awaiting invoice",
      count: data.ordersAttention.processing.count,
      items: data.ordersAttention.processing.items,
      empty: "No exported orders awaiting 504C despatch.",
      href: `${ROUTES.adminOrders}?autopartExport=EXPORTED`,
    },
    {
      key: "blocked",
      title: "Export blocked",
      count: data.ordersAttention.exportBlocked.count,
      items: data.ordersAttention.exportBlocked.items,
      empty: "No export-blocked orders.",
      href: `${ROUTES.adminOrders}?autopartExport=BLOCKED`,
    },
    {
      key: "backorder",
      title: "Backorders",
      count: data.ordersAttention.backorderedOrders.count,
      items: [],
      empty: "No orders currently contain outstanding backordered quantities.",
      href: `${ROUTES.adminOrders}?backorders=CONTAINS`,
      detail:
        data.ordersAttention.backorderedOrders.count > 0
          ? `${data.ordersAttention.backorderedOrders.units} units · ${data.ordersAttention.backorderedOrders.skusAffected} SKUs${
              data.ordersAttention.backorderedOrders.stockNowAvailableSkus > 0
                ? ` · ${data.ordersAttention.backorderedOrders.stockNowAvailableSkus} with stock now available`
                : ""
            }`
          : null,
    },
  ];

  return (
    <div>
      <div className="mb-3 flex items-end justify-between gap-3">
        <h2 className="font-display text-lg font-semibold uppercase">Orders requiring attention</h2>
        <Link
          to={ROUTES.adminOrders}
          className="text-[12px] font-semibold uppercase tracking-wide text-primary hover:underline"
        >
          All orders
        </Link>
      </div>
      <div className="space-y-4">
        {sections.map((section) => (
          <div key={section.key} className="rounded-lg border border-border">
            <div className="flex items-center justify-between gap-3 border-b border-border px-3 py-2">
              <div className="text-[12px] font-semibold uppercase tracking-[0.12em] text-steel">
                {section.title}
                <span className="ml-2 text-foreground">{section.count}</span>
              </div>
              <a href={section.href} className="text-[11px] font-semibold text-primary hover:underline">
                View
              </a>
            </div>
            {"detail" in section && section.detail ? (
              <p className="border-b border-border/60 px-3 py-2 text-[12px] text-steel">{section.detail}</p>
            ) : null}
            {section.items.length === 0 ? (
              <p className="px-3 py-3 text-[13px] text-steel">{section.empty}</p>
            ) : (
              <OrderTable rows={section.items} />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function ApplicationsSection({ data }: { data: Dashboard }) {
  return (
    <div>
      <div className="mb-3 flex items-end justify-between gap-3">
        <h2 className="font-display text-lg font-semibold uppercase">Trade applications</h2>
        <Link
          to={ROUTES.adminApplications}
          className="text-[12px] font-semibold uppercase tracking-wide text-primary hover:underline"
        >
          View all
        </Link>
      </div>
      <div className="mb-3 grid gap-px bg-border sm:grid-cols-3">
        <Metric label="Submitted" value={String(data.applications.submitted)} />
        <Metric label="Under review" value={String(data.applications.underReview)} />
        <Metric label="More info required" value={String(data.applications.moreInfoRequired)} />
      </div>
      {data.applications.attentionItems.length === 0 ? (
        <EmptyBox>No applications awaiting review. You're up to date.</EmptyBox>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[640px] text-[13px]">
            <thead>
              <tr className="border-b border-border bg-surface/60 text-left text-[10px] uppercase tracking-[0.12em] text-steel">
                <th className="px-3 py-2 font-semibold">Reference</th>
                <th className="px-3 py-2 font-semibold">Company</th>
                <th className="px-3 py-2 font-semibold">Submitted</th>
                <th className="px-3 py-2 font-semibold">Status</th>
              </tr>
            </thead>
            <tbody>
              {data.applications.attentionItems.map((a, i) => (
                <tr
                  key={a.id}
                  className={cn("border-b border-border/60 last:border-0", i % 2 && "bg-surface/30")}
                >
                  <td className="num px-3 py-2.5">
                    <Link
                      to={ROUTES.adminApplications}
                      className="font-semibold text-primary hover:underline"
                    >
                      {a.reference}
                    </Link>
                  </td>
                  <td className="px-3 py-2.5 font-medium">{a.companyName}</td>
                  <td className="num px-3 py-2.5 text-steel">{a.submittedAtLabel}</td>
                  <td className="px-3 py-2.5">
                    <StatusBadge tone="brand">{a.statusLabel}</StatusBadge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function RecentOrdersSection({ rows }: { rows: Dashboard["recentOrders"] }) {
  return (
    <div>
      <div className="mb-3 flex items-end justify-between gap-3">
        <h2 className="font-display text-lg font-semibold uppercase">Recent orders</h2>
        <Link
          to={ROUTES.adminOrders}
          className="text-[12px] font-semibold uppercase tracking-wide text-primary hover:underline"
        >
          All orders
        </Link>
      </div>
      {rows.length === 0 ? (
        <EmptyBox>No B2B orders yet.</EmptyBox>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[720px] text-[13px]">
            <thead>
              <tr className="border-b border-border bg-surface/60 text-left text-[10px] uppercase tracking-[0.12em] text-steel">
                <th className="px-3 py-2 font-semibold">Order</th>
                <th className="px-3 py-2 font-semibold">Company</th>
                <th className="px-3 py-2 font-semibold">Date</th>
                <th className="px-3 py-2 font-semibold">Status</th>
                <th className="px-3 py-2 text-right font-semibold">Total</th>
                <th className="px-3 py-2 font-semibold">Autopart</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((o, i) => (
                <tr
                  key={o.id}
                  className={cn("border-b border-border/60 last:border-0", i % 2 && "bg-surface/30")}
                >
                  <td className="num px-3 py-2.5">
                    <Link
                      to="/admin/orders/$orderId"
                      params={{ orderId: o.id }}
                      className="font-semibold text-primary hover:underline"
                    >
                      {o.orderNumber}
                    </Link>
                  </td>
                  <td className="px-3 py-2.5">{o.companyName}</td>
                  <td className="num px-3 py-2.5 text-steel">{o.placedAtLabel}</td>
                  <td className="px-3 py-2.5">
                    <StatusBadge tone="neutral">{o.statusLabel}</StatusBadge>
                  </td>
                  <td className="num px-3 py-2.5 text-right font-semibold">{o.grandTotalLabel}</td>
                  <td className="px-3 py-2.5 text-steel">{o.autopartLabel}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function OrderTable({ rows }: { rows: Dashboard["recentOrders"] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[560px] text-[13px]">
        <tbody>
          {rows.map((o, i) => (
            <tr
              key={o.id}
              className={cn("border-b border-border/60 last:border-0", i % 2 && "bg-surface/30")}
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
  );
}

function StockCard({ stock }: { stock: NonNullable<Dashboard["stock"]> }) {
  return (
    <SideCard
      title="Autopart stock"
      href={stock.href}
      linkLabel="Stock sync"
    >
      <dl className="space-y-1.5 text-[13px]">
        <Row label="Last successful sync" value={stock.lastSuccessLabel ?? "Never"} />
        <Row label="Matched" value={String(stock.matched)} />
        <Row label="Updated" value={String(stock.updated)} />
        <Row label="Not in AB catalogue" value={String(stock.notInCatalogue)} />
        {stock.ignoredRows > 0 ? (
          <Row
            label="Ignored rows"
            value={<span className="text-steel">{String(stock.ignoredRows)}</span>}
          />
        ) : null}
        {stock.actionableIssues > 0 ? (
          <Row label="Actionable issues" value={String(stock.actionableIssues)} />
        ) : null}
        <Row
          label="Status"
          value={
            <StatusBadge
              tone={
                stock.statusLabel === "Healthy"
                  ? "good"
                  : stock.statusLabel === "Attention required"
                    ? "warn"
                    : "neutral"
              }
            >
              {stock.statusLabel}
            </StatusBadge>
          }
        />
      </dl>
    </SideCard>
  );
}

function Feed504cCard({ feed }: { feed: NonNullable<Dashboard["autopart504c"]> }) {
  return (
    <SideCard title="Autopart invoice / despatch" href={feed.href} linkLabel="Settings">
      <dl className="space-y-1.5 text-[13px]">
        <Row
          label="Status"
          value={
            feed.configured
              ? feed.enabled
                ? "Configured · enabled"
                : "Configured · disabled"
              : "Not configured"
          }
        />
        <Row label="Automatic polling" value={feed.automaticPolling} />
        <Row label="Schedule" value={feed.scheduleLabel} />
      </dl>
      {!feed.configured ? (
        <p className="mt-3 text-[12px] text-steel">
          Waiting for Autopart to configure scheduled email delivery. Do not enable until ready.
        </p>
      ) : null}
    </SideCard>
  );
}

function EmailCard({ email }: { email: NonNullable<Dashboard["email"]> }) {
  return (
    <SideCard title="Email" href={email.href} linkLabel="Settings">
      <dl className="space-y-1.5 text-[13px]">
        <Row label="Configured" value={email.configured ? "Yes" : "No"} />
        <Row label="Enabled" value={email.enabled ? "Yes" : "No"} />
        <Row label="Recent failures (7d)" value={String(email.recentFailures)} />
      </dl>
    </SideCard>
  );
}

function CallbacksCard({ count }: { count: number }) {
  return (
    <SideCard title="Callbacks" href={ROUTES.adminCustomers} linkLabel="Customers">
      {count === 0 ? (
        <p className="text-[13px] text-steel">No open callback tasks.</p>
      ) : (
        <p className="text-[13px]">
          <span className="font-semibold text-primary">{count}</span> open callback task
          {count === 1 ? "" : "s"} requiring attention.
        </p>
      )}
    </SideCard>
  );
}

function QuotesCard({ quotes }: { quotes: NonNullable<Dashboard["quotes"]> }) {
  return (
    <SideCard title="Quotes" href={ROUTES.salesQuotes} linkLabel="Quotes">
      <dl className="space-y-1.5 text-[13px]">
        <Row label="Draft" value={String(quotes.draft)} />
        <Row label="Sent / viewed" value={String(quotes.sentOrViewed)} />
        <Row label="Expiring soon" value={String(quotes.expiringSoon)} />
      </dl>
    </SideCard>
  );
}

function ActivitySection({ rows }: { rows: Dashboard["recentActivity"] }) {
  return (
    <div>
      <h2 className="mb-3 font-display text-lg font-semibold uppercase">Recent activity</h2>
      {rows.length === 0 ? (
        <EmptyBox>No recent business activity recorded.</EmptyBox>
      ) : (
        <ol className="divide-y divide-border rounded-lg border border-border text-[13px]">
          {rows.map((a) => (
            <li key={a.id} className="px-3 py-2.5">
              <div className="num text-[11px] text-steel">
                {a.whenLabel} · {a.who}
              </div>
              <div>{a.what}</div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function SideCard({
  title,
  href,
  linkLabel,
  children,
}: {
  title: string;
  href: string;
  linkLabel: string;
  children: ReactNode;
}) {
  return (
    <div className="rounded-lg border border-border p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="font-display text-base font-semibold uppercase">{title}</h2>
        <a href={href} className="text-[11px] font-semibold uppercase tracking-wide text-primary hover:underline">
          {linkLabel}
        </a>
      </div>
      {children}
    </div>
  );
}

function Row({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <dt className="text-steel">{label}</dt>
      <dd className="text-right font-medium">{value}</dd>
    </div>
  );
}

function EmptyBox({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-border px-4 py-6 text-[13px] text-steel">
      {children}
    </div>
  );
}
