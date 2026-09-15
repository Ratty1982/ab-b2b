import { createFileRoute, Link } from "@tanstack/react-router";
import {
  FileText,
  Mail,
  Phone,
  Repeat,
  ShoppingCart,
  Zap,
} from "lucide-react";
import { PanelHeader, Metric } from "@/components/ab/AppShell";
import { OrderStatusBadge, StatusBadge } from "@/components/ab/Badges";
import { account, gbp, gbp0, orderLists, products, promos, recentOrders } from "@/lib/data";
import { invoices, quotes, quoteTotal } from "@/lib/crm-data";

export const Route = createFileRoute("/portal/")({
  head: () => ({
    meta: [
      { title: "Trade Dashboard — Automotive Brands" },
      {
        name: "description",
        content:
          "Your Automotive Brands trade dashboard: account status, credit, open orders, quotes, invoices and saved order lists.",
      },
      { property: "og:title", content: "Trade Dashboard — Automotive Brands" },
      { property: "og:description", content: "Account status, credit, orders and order lists." },
    ],
  }),
  component: Dashboard,
});

const managerContact = {
  name: "James Whitfield",
  title: "Account Manager — Midlands",
  phone: "0121 496 0142",
  mobile: "07700 900318",
  email: "james.whitfield@automotivebrands.co.uk",
};

function Dashboard() {
  const available = account.creditLimit - account.creditUsed;
  const outstanding = invoices
    .filter((i) => i.status !== "Paid")
    .reduce((s, i) => s + i.value, 0);
  const openQuotes = quotes.filter((q) => ["Draft", "Sent", "Viewed"].includes(q.status));
  const openQuoteValue = openQuotes.reduce((s, q) => s + quoteTotal(q), 0);
  const openOrders = recentOrders.filter((o) => o.status !== "Delivered");

  return (
    <div>
      <PanelHeader
        title={`Welcome back, ${account.company}`}
        sub={`Account ${account.number} · ${account.terms} · ${account.status}`}
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
              className="inline-flex h-10 items-center rounded-md bg-primary px-5 text-[13px] font-bold uppercase tracking-wide text-primary-foreground transition hover:brightness-110"
            >
              Place an Order
            </Link>
          </>
        }
      />

      {/* Quick actions */}
      <div className="grid grid-cols-2 gap-px border-b border-border bg-border sm:grid-cols-3 lg:grid-cols-5">
        <QuickAction to="/products" icon={ShoppingCart} label="Place order" />
        <QuickAction to="/portal/quick-order" icon={Zap} label="Quick order" primary />
        <QuickAction to="/portal/orders" icon={Repeat} label="Reorder" />
        <QuickAction to="/portal/quotes" icon={FileText} label="Request quote" />
        <QuickAction to="/portal/support" icon={Phone} label="Contact manager" />
      </div>

      <div className="grid gap-px bg-border sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <Metric label="Account status" value={account.status} tone="good" hint={`Account ${account.number}`} />
        <Metric label="Payment terms" value={account.terms} hint="Agreed trading terms" />
        <Metric label="Credit limit" value={gbp0(account.creditLimit)} hint={`${gbp0(account.creditUsed)} in use`} />
        <Metric label="Available credit" value={gbp0(available)} tone="brand" hint="Updated in real time" />
        <Metric label="Outstanding balance" value={gbp0(outstanding)} tone="warn" hint="1 invoice overdue" />
        <Metric label="Open quotes" value={gbp0(openQuoteValue)} hint={`${openQuotes.length} awaiting decision`} />
      </div>

      <div className="grid gap-6 p-4 sm:p-6 xl:grid-cols-3">
        <section className="xl:col-span-2 space-y-6">
          <div>
            <SectionTitle title="Open orders" href="/portal/orders" linkLabel="All orders" />
            <OrderTable rows={openOrders} />
          </div>

          <div>
            <SectionTitle title="Recent orders" href="/portal/orders" linkLabel="Order history" />
            <OrderTable rows={recentOrders} />
          </div>

          <div>
            <SectionTitle title="Recent invoices" href="/portal/invoices" linkLabel="All invoices" />
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full min-w-[560px] text-[13px]">
                <thead>
                  <tr className="border-b border-border bg-surface/60 text-left text-[10px] uppercase tracking-[0.12em] text-steel">
                    <th className="px-3 py-2 font-semibold">Invoice</th>
                    <th className="px-3 py-2 font-semibold">Order</th>
                    <th className="px-3 py-2 font-semibold">Date</th>
                    <th className="px-3 py-2 font-semibold">Due</th>
                    <th className="px-3 py-2 font-semibold">Status</th>
                    <th className="px-3 py-2 text-right font-semibold">Value</th>
                  </tr>
                </thead>
                <tbody>
                  {invoices.map((inv, i) => (
                    <tr
                      key={inv.id}
                      className={`border-b border-border/60 hover:bg-secondary/60 ${i % 2 ? "bg-surface/30" : ""}`}
                    >
                      <td className="num px-3 py-2 font-medium text-primary">{inv.id}</td>
                      <td className="num px-3 py-2 text-steel">{inv.order}</td>
                      <td className="px-3 py-2 text-steel">{inv.date}</td>
                      <td className="px-3 py-2 text-steel">{inv.due}</td>
                      <td className="px-3 py-2">
                        <StatusBadge
                          tone={
                            inv.status === "Overdue" ? "bad" : inv.status === "Paid" ? "good" : "warn"
                          }
                        >
                          {inv.status}
                        </StatusBadge>
                      </td>
                      <td className="num px-3 py-2 text-right font-semibold">{gbp(inv.value)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div>
            <SectionTitle title="Recently purchased" href="/products" linkLabel="Shop all" />
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {products.slice(0, 4).map((p) => (
                <div
                  key={p.sku}
                  className="flex flex-col rounded-lg border border-border bg-surface/40 p-3"
                >
                  <Link to="/products/$sku" params={{ sku: p.sku }} className="min-w-0">
                    <div className="num text-[11px] text-steel">{p.sku}</div>
                    <div className="mt-0.5 text-[13px] font-semibold leading-snug hover:text-primary">
                      {p.name}
                    </div>
                  </Link>
                  <div className="num mt-2 font-display text-base font-semibold">{gbp(p.trade)}</div>
                  <button
                    type="button"
                    className="mt-2 h-8 rounded-md bg-primary text-[12px] font-bold text-primary-foreground transition hover:brightness-110"
                  >
                    Reorder
                  </button>
                </div>
              ))}
            </div>
          </div>

          <div>
            <SectionTitle title="Recommended for your account" href="/products" linkLabel="Browse" />
            <div className="grid gap-3 sm:grid-cols-3">
              {products.slice(4, 7).map((p) => (
                <Link
                  key={p.sku}
                  to="/products/$sku"
                  params={{ sku: p.sku }}
                  className="rounded-lg border border-border bg-surface/40 p-3 transition-colors hover:border-primary/60"
                >
                  <div className="text-[11px] text-cyan">{p.brand}</div>
                  <div className="text-[13px] font-semibold leading-snug">{p.name}</div>
                  <div className="num mt-1 text-[11px] text-steel">
                    Bought by similar motor factors
                  </div>
                  <div className="num mt-2 font-display text-base font-semibold">{gbp(p.trade)}</div>
                </Link>
              ))}
            </div>
          </div>
        </section>

        <aside className="space-y-6">
          <div>
            <SectionTitle title="Your account manager" />
            <div className="rounded-lg border border-border bg-surface/50 p-4">
              <div className="font-display text-lg font-semibold uppercase">{managerContact.name}</div>
              <div className="text-[12px] text-steel">{managerContact.title}</div>
              <ul className="num mt-3 space-y-1.5 text-[13px]">
                <li className="flex items-center gap-2">
                  <Phone className="size-3.5 shrink-0 text-primary" aria-hidden />
                  <a href={`tel:${managerContact.phone.replace(/\s/g, "")}`} className="hover:underline">
                    {managerContact.phone}
                  </a>
                </li>
                <li className="flex items-center gap-2">
                  <Phone className="size-3.5 shrink-0 text-primary" aria-hidden />
                  <a href={`tel:${managerContact.mobile.replace(/\s/g, "")}`} className="hover:underline">
                    {managerContact.mobile}
                  </a>
                </li>
                <li className="flex min-w-0 items-center gap-2">
                  <Mail className="size-3.5 shrink-0 text-primary" aria-hidden />
                  <a href={`mailto:${managerContact.email}`} className="truncate hover:underline">
                    {managerContact.email}
                  </a>
                </li>
              </ul>
              <Link
                to="/portal/support"
                className="mt-4 grid h-10 place-items-center rounded-md bg-primary text-[13px] font-bold text-primary-foreground transition hover:brightness-110"
              >
                Contact account manager
              </Link>
            </div>
          </div>

          <div>
            <SectionTitle title="Open activity" />
            <ul className="divide-y divide-border rounded-lg border border-border text-[13px]">
              <Row label="Open orders" value={String(openOrders.length)} />
              <Row label="Open quotes" value={gbp0(openQuoteValue)} />
              <Row label="Outstanding invoices" value={gbp0(outstanding)} />
              <Row label="Credit notes pending" value="1" />
            </ul>
          </div>

          <div>
            <SectionTitle title="Open quotes" href="/portal/quotes" linkLabel="All quotes" />
            <ul className="divide-y divide-border rounded-lg border border-border text-[13px]">
              {openQuotes.slice(0, 4).map((q) => (
                <li key={q.id} className="grid grid-cols-[minmax(0,1fr)_auto] gap-2 px-3 py-2.5">
                  <span className="min-w-0">
                    <span className="num block font-medium text-primary">{q.id}</span>
                    <span className="block truncate text-[11px] text-steel">
                      Expires {q.expires} · {q.lines.length} lines
                    </span>
                  </span>
                  <span className="self-center text-right">
                    <span className="num block font-semibold">{gbp(quoteTotal(q))}</span>
                    <StatusBadge tone={q.status === "Draft" ? "info" : "brand"}>{q.status}</StatusBadge>
                  </span>
                </li>
              ))}
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

function OrderTable({ rows }: { rows: typeof recentOrders }) {
  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border p-6 text-center text-[13px] text-steel">
        No open orders. Everything has been delivered.
      </div>
    );
  }
  return (
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
          {rows.map((o, i) => (
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
        primary ? "bg-primary text-primary-foreground hover:brightness-110" : "bg-surface/60 hover:bg-surface"
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
