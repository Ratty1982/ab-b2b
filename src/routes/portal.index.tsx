import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Mail, ShoppingCart, Zap } from "lucide-react";
import { PanelHeader, Metric } from "@/components/ab/AppShell";
import { OrderStatusBadge } from "@/components/ab/Badges";
import { InstantText } from "@/components/ab/InstantText";
import { getPortalDashboardFn } from "@/server/phase2/fns";
import type { PortalDashboard } from "@/server/portal/dashboard";
import { ROUTES } from "@/lib/app-nav";

export const Route = createFileRoute("/portal/")({
  head: () => ({
    meta: [
      { title: "Trade Dashboard — Automotive Brands" },
      {
        name: "description",
        content:
          "Your Automotive Brands trade dashboard: account status, orders, basket and account manager.",
      },
    ],
  }),
  component: Dashboard,
});

function gbp(value: string | number) {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(n);
}

function Dashboard() {
  const [data, setData] = useState<PortalDashboard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void (async () => {
      setLoading(true);
      const r = await getPortalDashboardFn();
      if (!r.ok) {
        setError(r.error);
        setData(null);
      } else {
        setData(r.data);
        setError(null);
      }
      setLoading(false);
    })();
  }, []);

  if (loading) {
    return (
      <div className="p-6 text-[13px] text-steel">Loading your trade account…</div>
    );
  }

  if (error || !data) {
    return (
      <div className="p-6">
        <PanelHeader title="Trade dashboard" sub="Unable to load account data" />
        <p className="mt-4 text-[13px] text-bad">{error ?? "Something went wrong"}</p>
      </div>
    );
  }

  const subParts = [
    data.company.autopartCustomerCode
      ? `Account ${data.company.autopartCustomerCode}`
      : "Trade Account",
    data.company.paymentTerms?.trim() || null,
    data.company.status,
  ].filter(Boolean);

  return (
    <div>
      <PanelHeader
        title={`Welcome back, ${data.company.name}`}
        sub={subParts.join(" · ")}
        actions={
          <>
            <Link
              to={ROUTES.products}
              className="inline-flex h-10 items-center rounded-md bg-primary px-5 text-[13px] font-bold uppercase tracking-wide text-primary-foreground transition hover:brightness-110"
            >
              Place an Order
            </Link>
          </>
        }
      />

      <div className="grid grid-cols-2 gap-px border-b border-border bg-border sm:grid-cols-3">
        <QuickAction to={ROUTES.products} icon={ShoppingCart} label="Shop products" primary />
        <QuickAction to={ROUTES.portalBasket} icon={Zap} label="View basket" />
        <QuickAction to={ROUTES.portalOrders} icon={ShoppingCart} label="Order history" />
      </div>

      <div className="grid gap-px bg-border sm:grid-cols-2 lg:grid-cols-4">
        <Metric
          label="Account status"
          value={data.company.status}
          tone={data.company.status === "ACTIVE" ? "good" : "warn"}
        />
        <Metric
          label="Payment terms"
          value={data.company.paymentTerms?.trim() || "Not set"}
          hint="Agreed trading terms"
        />
        {data.creditLimit != null ? (
          <Metric label="Credit limit" value={gbp(data.creditLimit)} hint="As set on your account" />
        ) : null}
        <Metric
          label="Basket"
          value={String(data.basket.lineCount)}
          hint={
            data.basket.lineCount === 0
              ? "Empty"
              : `${data.basket.unitCount} unit${data.basket.unitCount === 1 ? "" : "s"}`
          }
          tone="brand"
        />
        <Metric
          label="Open orders"
          value={String(data.openOrderCount)}
          hint={data.totalOrderCount === 0 ? "No orders yet" : `${data.totalOrderCount} total`}
        />
      </div>

      <div className="grid gap-6 p-4 sm:p-6 xl:grid-cols-3">
        <section className="space-y-6 xl:col-span-2">
          <div className="rounded-lg border border-border bg-surface/40 p-5">
            <h2 className="font-display text-lg font-semibold uppercase tracking-tight">
              Start ordering
            </h2>
            <p className="mt-2 max-w-xl text-[13px] text-steel">
              Browse Power Maxed and Steel Seal trade products with your account pricing and live
              stock.
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <Link
                to={ROUTES.products}
                className="inline-flex h-10 items-center rounded-md bg-primary px-4 text-[12px] font-bold uppercase text-primary-foreground"
              >
                Shop products
              </Link>
              <Link
                to={ROUTES.portalBasket}
                className="inline-flex h-10 items-center rounded-md border border-border px-4 text-[12px] font-bold uppercase hover:border-steel"
              >
                Basket ({data.basket.lineCount})
              </Link>
            </div>
          </div>

          <div>
            <SectionTitle title="Open orders" href={ROUTES.portalOrders} linkLabel="All orders" />
            <OrderTable
              rows={data.openOrders}
              emptyTitle="No open orders"
              emptyBody="You don't currently have any open orders."
              emptyCta={{ to: ROUTES.products, label: "Place an order" }}
            />
          </div>

          <div>
            <SectionTitle title="Recent orders" href={ROUTES.portalOrders} linkLabel="Order history" />
            <OrderTable
              rows={data.recentOrders}
              emptyTitle="No orders yet"
              emptyBody="Your recent orders will appear here after you place your first order."
              emptyCta={{ to: ROUTES.products, label: "Shop products" }}
            />
          </div>
        </section>

        <aside className="space-y-6">
          <div>
            <SectionTitle title="Your account manager" />
            {data.accountManager ? (
              <div className="rounded-lg border border-border bg-surface/50 p-4">
                <div className="font-display text-lg font-semibold uppercase">
                  {data.accountManager.name}
                </div>
                <div className="text-[12px] text-steel">Account manager</div>
                <ul className="mt-3 space-y-1.5 text-[13px]">
                  <li className="flex min-w-0 items-center gap-2">
                    <Mail className="size-3.5 shrink-0 text-primary" aria-hidden />
                    <a
                      href={`mailto:${data.accountManager.email}`}
                      className="truncate hover:underline"
                    >
                      {data.accountManager.email}
                    </a>
                  </li>
                </ul>
                <a
                  href={`mailto:${data.accountManager.email}`}
                  className="mt-4 grid h-10 place-items-center rounded-md bg-primary text-[13px] font-bold text-primary-foreground transition hover:brightness-110"
                >
                  Contact account manager
                </a>
              </div>
            ) : (
              <div className="rounded-lg border border-border bg-surface/50 p-4 text-[13px]">
                <div className="font-display text-base font-semibold uppercase">
                  Your account manager
                </div>
                <p className="mt-2 text-steel">No account manager is currently assigned.</p>
                <Link
                  to={ROUTES.portalSupport}
                  className="mt-4 inline-flex h-10 items-center rounded-md border border-border px-4 text-[12px] font-bold uppercase hover:border-steel"
                >
                  Contact support
                </Link>
              </div>
            )}
          </div>

          <div>
            <SectionTitle title="Open activity" />
            <ul className="divide-y divide-border rounded-lg border border-border text-[13px]">
              <Row label="Open orders" value={String(data.openOrderCount)} />
              <Row label="Basket lines" value={String(data.basket.lineCount)} />
            </ul>
          </div>
        </aside>
      </div>
    </div>
  );
}

type OrderRow = PortalDashboard["recentOrders"][number];

function OrderTable({
  rows,
  emptyTitle,
  emptyBody,
  emptyCta,
}: {
  rows: OrderRow[];
  emptyTitle: string;
  emptyBody: string;
  emptyCta: { to: string; label: string };
}) {
  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border p-6 text-center">
        <div className="font-display text-sm font-semibold uppercase">{emptyTitle}</div>
        <p className="mt-2 text-[13px] text-steel">{emptyBody}</p>
        <Link
          to={emptyCta.to}
          className="mt-4 inline-flex h-10 items-center rounded-md bg-primary px-4 text-[12px] font-bold uppercase text-primary-foreground"
        >
          {emptyCta.label}
        </Link>
      </div>
    );
  }
  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full min-w-[640px] text-[13px]">
        <thead>
          <tr className="border-b border-border bg-surface/60 text-left text-[10px] uppercase tracking-[0.12em] text-steel">
            <th className="px-3 py-2 font-semibold">Order</th>
            <th className="px-3 py-2 font-semibold">Customer reference</th>
            <th className="px-3 py-2 font-semibold">Date</th>
            <th className="px-3 py-2 text-right font-semibold">Lines</th>
            <th className="px-3 py-2 font-semibold">Status</th>
            <th className="px-3 py-2 text-right font-semibold">Value</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((o, i) => (
            <tr
              key={o.id}
              className={`border-b border-border/60 hover:bg-secondary/60 ${i % 2 ? "bg-surface/30" : ""}`}
            >
              <td className="num px-3 py-2 font-medium text-primary">
                <Link to="/portal/orders/$orderId" params={{ orderId: o.id }}>
                  {o.orderNumber}
                </Link>
              </td>
              <td className="num px-3 py-2 text-steel">{o.poNumber ?? "—"}</td>
              <td className="px-3 py-2 text-steel">
                <InstantText value={o.placedAt} variant="audit" />
              </td>
              <td className="num px-3 py-2 text-right">{o.lineCount}</td>
              <td className="px-3 py-2">
                <OrderStatusBadge status={o.status} />
              </td>
              <td className="num px-3 py-2 text-right font-semibold">{gbp(o.grandTotal)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function QuickAction({
  to,
  icon: Icon,
  label,
  primary,
}: {
  to: string;
  icon: typeof Zap;
  label: string;
  primary?: boolean;
}) {
  return (
    <Link
      to={to}
      className={`flex items-center gap-3 p-4 text-[13px] font-bold uppercase tracking-wide transition-colors ${
        primary
          ? "bg-primary text-primary-foreground hover:brightness-110"
          : "bg-surface/60 hover:bg-surface"
      }`}
    >
      <Icon className={`size-4 shrink-0 ${primary ? "" : "text-primary"}`} aria-hidden />
      <span className="truncate">{label}</span>
    </Link>
  );
}

function SectionTitle({
  title,
  href,
  linkLabel,
}: {
  title: string;
  href?: string;
  linkLabel?: string;
}) {
  return (
    <div className="mb-3 flex items-end justify-between gap-3">
      <h2 className="font-display text-lg font-semibold uppercase tracking-tight">{title}</h2>
      {href && linkLabel ? (
        <Link to={href} className="text-[12px] font-semibold text-steel hover:text-foreground">
          {linkLabel} →
        </Link>
      ) : null}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <li className="flex items-center justify-between gap-3 px-3 py-2.5">
      <span className="text-steel">{label}</span>
      <span className="num font-semibold">{value}</span>
    </li>
  );
}
