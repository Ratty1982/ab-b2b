import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { PanelHeader } from "@/components/ab/AppShell";
import { StatusBadge } from "@/components/ab/Badges";
import { ROUTES } from "@/lib/app-nav";
import { formatDate, formatDateTime } from "@/lib/datetime";
import { getPortalOrderFn } from "@/server/phase2/fns";

export const Route = createFileRoute("/portal/orders/$orderId/")({
  head: () => ({
    meta: [{ title: "Order detail — Automotive Brands Trade Portal" }],
  }),
  component: PortalOrderDetailPage,
});

type Detail = Extract<Awaited<ReturnType<typeof getPortalOrderFn>>, { ok: true }>["data"];

function statusTone(badge: Detail["statusBadge"]) {
  switch (badge) {
    case "BACKORDERED":
    case "PART_BACKORDERED":
    case "PART_DESPATCHED":
      return "warn" as const;
    case "DESPATCHED":
      return "info" as const;
    case "PROCESSING":
      return "brand" as const;
    case "RECEIVED":
      return "good" as const;
    default:
      return "neutral" as const;
  }
}

function PortalOrderDetailPage() {
  const { orderId } = Route.useParams();
  const [order, setOrder] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const result = await getPortalOrderFn({ data: { orderId } });
    if (!result.ok) {
      setError(result.error);
      setOrder(null);
      return;
    }
    setError(null);
    setOrder(result.data);
  }, [orderId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (error) {
    return (
      <div>
        <PanelHeader title="Order" sub="Trade account" />
        <p className="p-6 text-sm text-bad">{error}</p>
        <Link to={ROUTES.portalOrders} className="ml-6 text-[13px] font-semibold text-primary">
          Back to orders
        </Link>
      </div>
    );
  }

  if (!order) {
    return (
      <div>
        <PanelHeader title="Order" sub="Trade account" />
        <p className="p-6 text-[13px] text-steel">Loading order…</p>
      </div>
    );
  }

  const addr = order.deliveryAddress;

  return (
    <div>
      <PanelHeader
        title={order.orderNumber}
        sub={order.placedAt ? formatDateTime(order.placedAt) ?? "Order detail" : "Order detail"}
        actions={
          <StatusBadge tone={statusTone(order.statusBadge)}>{order.statusLabel}</StatusBadge>
        }
      />
      {order.creditStatus === "HOLD" || order.creditStatus === "REVIEW_REQUIRED" ? (
        <div className="mx-4 mt-4 rounded-lg border border-warn/40 bg-warn/10 px-4 py-3 text-[13px] sm:mx-6">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-warn">
            Account approval
          </p>
          <p className="mt-1 text-steel">
            This order has been received and is awaiting account approval before processing.
          </p>
        </div>
      ) : null}
      {order.hasOutstandingBackorder ? (
        <div className="mx-4 mt-4 rounded-lg border border-cyan/40 bg-cyan/5 px-4 py-3 text-[13px] text-steel sm:mx-6">
          Items on this order are awaiting stock. You do not need to place another order — they
          remain on this order until supplied.
        </div>
      ) : null}
      {order.lineQuantitiesLimitation ? (
        <div className="mx-4 mt-3 rounded-lg border border-border px-4 py-3 text-[12px] text-steel sm:mx-6">
          {order.lineQuantitiesLimitation}
        </div>
      ) : null}
      <div className="grid gap-6 p-4 sm:p-6 lg:grid-cols-2">
        <section className="rounded-lg border border-border p-5">
          <h2 className="font-display text-base font-semibold uppercase">Delivery</h2>
          {addr ? (
            <p className="mt-3 text-[13px] leading-relaxed text-steel">
              {addr.contactName ? (
                <>
                  {addr.contactName}
                  <br />
                </>
              ) : null}
              {addr.line1}
              <br />
              {addr.line2 ? (
                <>
                  {addr.line2}
                  <br />
                </>
              ) : null}
              {addr.town}
              {addr.county ? `, ${addr.county}` : ""} {addr.postcode}
            </p>
          ) : (
            <p className="mt-3 text-[13px] text-steel">—</p>
          )}
          {order.deliveryInstructions ? (
            <p className="mt-3 text-[13px] text-steel">
              <span className="font-semibold text-foreground">Instructions: </span>
              {order.deliveryInstructions}
            </p>
          ) : null}
        </section>
        <section className="rounded-lg border border-border p-5">
          <h2 className="font-display text-base font-semibold uppercase">Order info</h2>
          <dl className="mt-3 space-y-2 text-[13px]">
            <div className="flex justify-between gap-3">
              <dt className="text-steel">Company</dt>
              <dd className="font-medium">{order.companyName}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-steel">Your reference</dt>
              <dd>{order.poNumber || "—"}</dd>
            </div>
            {order.sourceQuoteNumber ? (
              <div className="flex justify-between gap-3">
                <dt className="text-steel">Created from</dt>
                <dd>
                  {order.sourceQuoteId ? (
                    <Link
                      to="/portal/quotes/$quoteId"
                      params={{ quoteId: order.sourceQuoteId }}
                      className="font-semibold text-primary hover:underline"
                    >
                      Quotation {order.sourceQuoteNumber}
                    </Link>
                  ) : (
                    <>Quotation {order.sourceQuoteNumber}</>
                  )}
                </dd>
              </div>
            ) : null}
            <div className="flex justify-between gap-3">
              <dt className="text-steel">Contact</dt>
              <dd className="text-right">
                {order.contact?.name}
                {order.contact?.email ? (
                  <>
                    <br />
                    {order.contact.email}
                  </>
                ) : null}
              </dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-steel">Payment terms</dt>
              <dd>{order.paymentTerms || "As agreed on your trade account"}</dd>
            </div>
          </dl>
        </section>
      </div>

      <div className="px-4 pb-8 sm:px-6">
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[820px] text-[13px]">
            <thead>
              <tr className="border-b border-border bg-surface/60 text-left text-[10px] uppercase text-steel">
                <th className="px-3 py-2">Product</th>
                <th className="px-3 py-2 text-right">Ordered</th>
                <th className="px-3 py-2 text-right">Allocated</th>
                <th className="px-3 py-2 text-right">Despatched</th>
                <th className="px-3 py-2 text-right">Backordered</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2 text-right">Line net</th>
              </tr>
            </thead>
            <tbody>
              {order.items.map((item) => {
                const f = item.fulfilment;
                const showDespatched = f.despatchedQty != null;
                const showOutstanding = f.outstandingBackorderQty != null;
                return (
                  <tr key={item.id} className="border-b border-border/60">
                    <td className="px-3 py-2.5">
                      <div className="font-medium">{item.name}</div>
                      <div className="num text-[12px] text-steel">{item.sku}</div>
                      {item.orderingMode === "FINAL_PART_CASE" ? (
                        <span className="mt-1 inline-block text-[11px] uppercase text-steel">
                          Final part case
                        </span>
                      ) : null}
                      {f.limitation ? (
                        <p className="mt-1 text-[11px] text-steel">{f.limitation}</p>
                      ) : null}
                    </td>
                    <td className="num px-3 py-2.5 text-right">{f.orderedQty}</td>
                    <td className="num px-3 py-2.5 text-right">
                      {f.allocatedAtOrder != null ? f.allocatedAtOrder : "—"}
                    </td>
                    <td className="num px-3 py-2.5 text-right">
                      {showDespatched ? f.despatchedQty : "—"}
                    </td>
                    <td className="num px-3 py-2.5 text-right">
                      {showOutstanding
                        ? f.outstandingBackorderQty
                        : f.backorderedAtOrder > 0
                          ? f.backorderedAtOrder
                          : "—"}
                    </td>
                    <td className="px-3 py-2.5">
                      <StatusBadge
                        tone={
                          f.lineStatusLabel.includes("Backorder") ||
                          f.lineStatusLabel.includes("Part")
                            ? "warn"
                            : f.lineStatusLabel === "Despatched"
                              ? "info"
                              : "neutral"
                        }
                      >
                        {f.lineStatusLabel}
                      </StatusBadge>
                    </td>
                    <td className="num px-3 py-2.5 text-right font-semibold">£{item.lineTotal}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <dl className="mt-4 ml-auto max-w-xs space-y-1 text-[14px]">
          <div className="flex justify-between gap-3">
            <dt className="text-steel">Goods ex VAT</dt>
            <dd className="num">£{order.subtotal}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-steel">Delivery</dt>
            <dd className="num">
              {order.deliveryTotal === "0.00" ? "FREE" : `£${order.deliveryTotal}`}
            </dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-steel">VAT</dt>
            <dd className="num">£{order.vatTotal}</dd>
          </div>
          <div className="flex justify-between gap-3 border-t border-border pt-2 font-semibold">
            <dt>Total inc VAT</dt>
            <dd className="num">£{order.grandTotal}</dd>
          </div>
        </dl>

        {order.fulfilmentTimeline.length > 0 ? (
          <section className="mt-8 max-w-xl">
            <h2 className="font-display text-base font-semibold uppercase">Fulfilment history</h2>
            <ol className="mt-3 space-y-3 border-l border-border pl-4">
              {order.fulfilmentTimeline.map((ev) => (
                <li key={ev.id} className="relative text-[13px]">
                  <span className="absolute -left-[1.3rem] top-1.5 size-2 rounded-full bg-primary" />
                  <div className="text-[11px] uppercase tracking-wide text-steel">
                    {formatDate(ev.occurredAt)}
                  </div>
                  <div className="mt-0.5 font-medium">{ev.summary}</div>
                  {ev.limitation ? (
                    <p className="mt-1 text-[12px] text-steel">{ev.limitation}</p>
                  ) : null}
                </li>
              ))}
            </ol>
          </section>
        ) : null}

        <div className="mt-6 flex flex-wrap gap-3">
          <Link
            to={ROUTES.portalOrders}
            className="inline-flex h-10 items-center rounded-md border border-border px-4 text-[12px] font-bold uppercase"
          >
            Back to orders
          </Link>
          <Link
            to={ROUTES.products}
            className="inline-flex h-10 items-center rounded-md bg-primary px-4 text-[12px] font-bold uppercase text-primary-foreground"
          >
            Continue shopping
          </Link>
          <Link
            to={ROUTES.portalSupport}
            className="inline-flex h-10 items-center rounded-md border border-border px-4 text-[12px] font-bold uppercase"
          >
            Your account manager
          </Link>
        </div>
      </div>
    </div>
  );
}
