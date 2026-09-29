import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Mail, Phone, Smartphone, ShoppingCart, Zap } from "lucide-react";
import { PanelHeader, Metric } from "@/components/ab/AppShell";
import { OrderStatusBadge } from "@/components/ab/Badges";
import { InstantText } from "@/components/ab/InstantText";
import { getPortalDashboardFn } from "@/server/phase2/fns";
import type { PortalDashboard } from "@/server/portal/dashboard";
import { ROUTES } from "@/lib/app-nav";
import { formatQuoteDateOnlyUk } from "@/domain/quote";

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

      <div className="grid grid-cols-2 gap-px border-b border-border bg-border sm:grid-cols-4">
        <QuickAction to={ROUTES.products} icon={ShoppingCart} label="Shop products" primary />
        <QuickAction to={ROUTES.portalBasket} icon={Zap} label="View basket" />
        <QuickAction to={ROUTES.portalOrders} icon={ShoppingCart} label="Order history" />
        <QuickAction to={ROUTES.portalPurchases} icon={ShoppingCart} label="Purchase history" />
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
        {data.creditLimit != null && data.availableCredit == null ? (
          <Metric label="Credit limit" value={gbp(data.creditLimit)} hint="As set on your account" />
        ) : null}
        {data.availableCredit != null ? (
          <Metric
            label="Available credit"
            value={gbp(data.availableCredit)}
            hint={
              data.creditUpdatedAt
                ? `Updated ${new Date(data.creditUpdatedAt).toLocaleString("en-GB", {
                    timeZone: "Europe/London",
                    day: "2-digit",
                    month: "2-digit",
                    year: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                    hour12: false,
                  })}${data.creditFreshness === "STALE" ? " · not live" : ""}`
                : "Autopart credit position"
            }
            tone={data.creditOverLimitBy ? "warn" : "good"}
          />
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

          {data.availableCredit != null ? (
            <div className="rounded-lg border border-border bg-surface/40 p-5">
              <h2 className="font-display text-lg font-semibold uppercase tracking-tight">
                Account credit
              </h2>
              <dl className="mt-4 grid gap-3 text-[13px] sm:grid-cols-3">
                <div>
                  <dt className="text-steel">Credit limit</dt>
                  <dd className="text-lg font-semibold">{gbp(data.creditLimit ?? 0)}</dd>
                </div>
                <div>
                  <dt className="text-steel">Used credit</dt>
                  <dd className="text-lg font-semibold">{gbp(data.usedCredit ?? 0)}</dd>
                </div>
                <div>
                  <dt className="text-steel">Available credit</dt>
                  <dd className="text-lg font-semibold">{gbp(data.availableCredit)}</dd>
                </div>
              </dl>
              {data.creditOverLimitBy != null ? (
                <p className="mt-3 text-[13px] text-warn">
                  Account currently over credit limit by {gbp(data.creditOverLimitBy)}.
                </p>
              ) : null}
              {data.creditLimit != null && data.creditLimit > 0 ? (
                <div className="mt-4 h-2 overflow-hidden rounded bg-border">
                  <div
                    className="h-full bg-primary"
                    style={{
                      width: `${Math.min(
                        100,
                        Math.max(0, ((data.usedCredit ?? 0) / data.creditLimit) * 100),
                      )}%`,
                    }}
                  />
                </div>
              ) : null}
              <p className="mt-3 text-[12px] text-steel">
                {data.creditUpdatedAt
                  ? `Updated ${new Date(data.creditUpdatedAt).toLocaleString("en-GB", {
                      timeZone: "Europe/London",
                      day: "2-digit",
                      month: "2-digit",
                      year: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                      hour12: false,
                    })}${data.creditFreshness === "STALE" ? " · not a live balance" : ""}`
                  : "Autopart credit position"}
              </p>
            </div>
          ) : data.creditFreshness === "NOT_AVAILABLE" ? (
            <div className="rounded-lg border border-dashed border-border p-5">
              <h2 className="font-display text-lg font-semibold uppercase tracking-tight">
                Account credit
              </h2>
              <p className="mt-2 text-[13px] text-steel">
                Credit information not currently available.
              </p>
            </div>
          ) : null}

          {data.quotesRequiringAction && data.quotesRequiringAction.length > 0 ? (
            <div className="rounded-lg border border-border bg-surface/40 p-5">
              <h2 className="font-display text-lg font-semibold uppercase tracking-tight">
                Quotes requiring action
              </h2>
              <ul className="mt-4 space-y-3">
                {data.quotesRequiringAction.map((q) => (
                  <li
                    key={q.id}
                    className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 pb-3 last:border-0 last:pb-0"
                  >
                    <div>
                      <div className="font-semibold">{q.quoteNumber}</div>
                      <div className="text-[12px] text-steel">
                        {q.validUntil
                          ? `Valid until ${formatQuoteDateOnlyUk(q.validUntil)}`
                          : "Awaiting response"}
                        {" · "}
                        {gbp(q.grandTotal)}
                      </div>
                    </div>
                    <Link
                      to="/portal/quotes/$quoteId"
                      params={{ quoteId: q.id }}
                      className="inline-flex h-9 items-center rounded-md border border-border px-3 text-[12px] font-bold uppercase hover:border-steel"
                    >
                      View
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {data.backorders ? (
            <div className="rounded-lg border border-cyan/40 bg-cyan/5 p-5">
              <h2 className="font-display text-lg font-semibold uppercase tracking-tight text-cyan">
                Backorders
              </h2>
              <p className="mt-2 max-w-xl text-[13px] text-steel">{data.backorders.summary}</p>
              <p className="mt-1 text-[12px] text-steel">
                You do not need to place another order for these items.
              </p>
              <Link
                to="/portal/orders"
                search={{ filter: "BACKORDERS" }}
                className="mt-4 inline-flex h-10 items-center rounded-md bg-primary px-4 text-[12px] font-bold uppercase text-primary-foreground"
              >
                View backorders
              </Link>
            </div>
          ) : null}

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
                <div className="flex items-start gap-3">
                  {data.accountManager.photo ? (
                    <img
                      src={data.accountManager.photo.src}
                      alt={data.accountManager.photo.alt}
                      className="size-14 shrink-0 rounded-full object-cover"
                      style={{ objectPosition: data.accountManager.photo.objectPosition }}
                    />
                  ) : (
                    <div
                      className="grid size-14 shrink-0 place-items-center rounded-full bg-ink font-display text-sm font-semibold text-foreground"
                      aria-hidden
                    >
                      {data.accountManager.initials}
                    </div>
                  )}
                  <div className="min-w-0">
                    <div className="font-display text-lg font-semibold uppercase leading-tight">
                      {data.accountManager.name}
                    </div>
                    <div className="text-[12px] text-steel">{data.accountManager.jobTitle}</div>
                  </div>
                </div>
                <ul className="mt-3 space-y-1.5 text-[13px]">
                  {data.accountManager.email ? (
                    <li className="flex min-w-0 items-center gap-2">
                      <Mail className="size-3.5 shrink-0 text-primary" aria-hidden />
                      <a
                        href={data.accountManager.mailtoHref ?? `mailto:${data.accountManager.email}`}
                        className="truncate hover:underline"
                      >
                        {data.accountManager.email}
                      </a>
                    </li>
                  ) : null}
                  {data.accountManager.phone ? (
                    <li className="flex min-w-0 items-center gap-2">
                      <Phone className="size-3.5 shrink-0 text-primary" aria-hidden />
                      <a
                        href={data.accountManager.telHref ?? undefined}
                        className="truncate hover:underline"
                      >
                        {data.accountManager.phone}
                      </a>
                    </li>
                  ) : null}
                  {data.accountManager.mobile ? (
                    <li className="flex min-w-0 items-center gap-2">
                      <Smartphone className="size-3.5 shrink-0 text-primary" aria-hidden />
                      <a
                        href={data.accountManager.mobileTelHref ?? undefined}
                        className="truncate hover:underline"
                      >
                        {data.accountManager.mobile}
                      </a>
                    </li>
                  ) : null}
                </ul>
                {data.accountManager.primaryContactHref ? (
                  <a
                    href={data.accountManager.primaryContactHref}
                    className="mt-4 grid h-10 place-items-center rounded-md bg-primary text-[13px] font-bold text-primary-foreground transition hover:brightness-110"
                  >
                    {data.accountManager.primaryContactLabel ?? "Contact account manager"}
                  </a>
                ) : data.generalContact.mailtoHref ? (
                  <a
                    href={data.generalContact.mailtoHref}
                    className="mt-4 grid h-10 place-items-center rounded-md bg-primary text-[13px] font-bold text-primary-foreground transition hover:brightness-110"
                  >
                    Contact Automotive Brands
                  </a>
                ) : null}
              </div>
            ) : (
              <div className="rounded-lg border border-border bg-surface/50 p-4 text-[13px]">
                <div className="font-display text-base font-semibold uppercase">
                  Your account manager
                </div>
                <p className="mt-2 text-steel">Our trade team is here to help.</p>
                {data.generalContact.mailtoHref ? (
                  <a
                    href={data.generalContact.mailtoHref}
                    className="mt-4 grid h-10 place-items-center rounded-md bg-primary text-[13px] font-bold text-primary-foreground transition hover:brightness-110"
                  >
                    Contact Automotive Brands
                  </a>
                ) : (
                  <Link
                    to={ROUTES.portalSupport}
                    className="mt-4 inline-flex h-10 w-full items-center justify-center rounded-md border border-border px-4 text-[12px] font-bold uppercase hover:border-steel"
                  >
                    Contact support
                  </Link>
                )}
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
                <div className="flex flex-col gap-1">
                  <OrderStatusBadge
                    status={o.status}
                    hasBackorderItems={o.hasBackorderItems}
                    fullyBackordered={o.fullyBackordered}
                    hasOutstandingBackorder={o.hasOutstandingBackorder}
                  />
                  {o.backorderHint ? (
                    <span className="text-[11px] text-cyan">{o.backorderHint}</span>
                  ) : null}
                </div>
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
