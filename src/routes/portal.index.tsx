import { createFileRoute, Link } from "@tanstack/react-router";
import { PanelHeader, Metric } from "@/components/ab/AppShell";
import { OrderStatusBadge, StatusBadge } from "@/components/ab/Badges";
import { account, gbp, gbp0, orderLists, products, promos, recentOrders } from "@/lib/data";

export const Route = createFileRoute("/portal/")({
  head: () => ({
    meta: [
      { title: "Trade Dashboard — Automotive Brands" },
      {
        name: "description",
        content:
          "Your Automotive Brands trade dashboard: account status, credit, open orders, quotes and saved order lists.",
      },
      { property: "og:title", content: "Trade Dashboard — Automotive Brands" },
      { property: "og:description", content: "Account status, credit, orders and order lists." },
    ],
  }),
  component: Dashboard,
});

function Dashboard() {
  const available = account.creditLimit - account.creditUsed;

  return (
    <div>
      <PanelHeader
        title={`Welcome back, ${account.company}`}
        sub={`Account ${account.number} · ${account.priceGroup} · ${account.terms}`}
        actions={
          <>
            <Link
              to="/portal/quick-order"
              className="inline-flex h-10 items-center rounded-md border border-border px-4 text-[13px] font-semibold transition-colors hover:border-steel"
            >
              Quick Order
            </Link>
            <Link
              to="/products"
              className="inline-flex h-10 items-center rounded-md bg-primary px-5 text-[13px] font-bold text-primary-foreground transition hover:brightness-110"
            >
              Place an Order
            </Link>
          </>
        }
      />

      <div className="grid gap-px bg-border sm:grid-cols-2 lg:grid-cols-4">
        <Metric label="Account status" value={account.status} tone="good" hint={`Manager: ${account.manager}`} />
        <Metric label="Credit limit" value={gbp0(account.creditLimit)} hint={account.terms} />
        <Metric label="Available credit" value={gbp0(available)} tone="brand" hint={`${gbp0(account.creditUsed)} in use`} />
        <Metric label="Outstanding invoices" value={gbp0(4128)} tone="warn" hint="1 invoice overdue" />
      </div>

      <div className="grid gap-6 p-4 sm:p-6 xl:grid-cols-3">
        <section className="xl:col-span-2">
          <SectionTitle title="Recent orders" href="/portal/orders" linkLabel="All orders" />
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full min-w-[640px] text-[13px]">
              <thead>
                <tr className="border-b border-border bg-surface/60 text-left text-[10px] uppercase tracking-[0.12em] text-steel">
                  <th className="px-3 py-2 font-semibold">Order</th>
                  <th className="px-3 py-2 font-semibold">PO Number</th>
                  <th className="px-3 py-2 font-semibold">Date</th>
                  <th className="px-3 py-2 text-right font-semibold">Lines</th>
                  <th className="px-3 py-2 font-semibold">Status</th>
                  <th className="px-3 py-2 text-right font-semibold">Value</th>
                </tr>
              </thead>
              <tbody>
                {recentOrders.map((o, i) => (
                  <tr
                    key={o.id}
                    className={`border-b border-border/60 hover:bg-secondary/60 ${i % 2 ? "bg-surface/30" : ""}`}
                  >
                    <td className="num px-3 py-2 font-medium text-primary">
                      <Link to="/portal/orders">{o.id}</Link>
                    </td>
                    <td className="num px-3 py-2 text-steel">{o.po}</td>
                    <td className="px-3 py-2 text-steel">{o.date}</td>
                    <td className="num px-3 py-2 text-right">{o.lines}</td>
                    <td className="px-3 py-2">
                      <OrderStatusBadge status={o.status} />
                    </td>
                    <td className="num px-3 py-2 text-right font-semibold">{gbp(o.value)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-6">
            <SectionTitle title="Recently purchased" href="/products" linkLabel="Shop all" />
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {products.slice(0, 4).map((p) => (
                <Link
                  key={p.sku}
                  to="/products/$sku"
                  params={{ sku: p.sku }}
                  className="rounded-lg border border-border bg-surface/40 p-3 transition-colors hover:border-primary/60"
                >
                  <div className="num text-[11px] text-steel">{p.sku}</div>
                  <div className="mt-0.5 text-[13px] font-semibold leading-snug">{p.name}</div>
                  <div className="num mt-2 font-display text-base font-semibold">{gbp(p.trade)}</div>
                </Link>
              ))}
            </div>
          </div>
        </section>

        <aside className="space-y-6">
          <div>
            <SectionTitle title="Open activity" />
            <ul className="divide-y divide-border rounded-lg border border-border text-[13px]">
              <Row label="Open orders" value="3" />
              <Row label="Open quotes" value={gbp0(4280)} />
              <Row label="Outstanding invoices" value={gbp0(4128)} />
              <Row label="Credit notes pending" value="1" />
            </ul>
          </div>

          <div>
            <SectionTitle title="Saved order lists" />
            <ul className="divide-y divide-border rounded-lg border border-border text-[13px]">
              {orderLists.map((l) => (
                <li key={l.name} className="grid grid-cols-[minmax(0,1fr)_auto] gap-2 px-3 py-2.5">
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{l.name}</span>
                    <span className="num block text-[11px] text-steel">
                      {l.lines} lines · updated {l.updated}
                    </span>
                  </span>
                  <Link
                    to="/portal/quick-order"
                    className="self-center text-[12px] font-semibold text-primary hover:underline"
                  >
                    Order
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <SectionTitle title="Current trade promotions" />
            <ul className="space-y-2">
              {promos.map((p) => (
                <li key={p.code} className="rounded-lg border border-border bg-surface/50 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="num text-[11px] font-semibold text-primary">{p.code}</span>
                    <StatusBadge tone="warn">Ends {p.ends}</StatusBadge>
                  </div>
                  <p className="mt-1 text-[13px]">{p.title}</p>
                </li>
              ))}
            </ul>
          </div>
        </aside>
      </div>
    </div>
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
