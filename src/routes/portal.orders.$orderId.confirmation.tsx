import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { PanelHeader } from "@/components/ab/AppShell";
import { ROUTES } from "@/lib/app-nav";
import { formatDateTime } from "@/lib/datetime";
import { getPortalOrderFn } from "@/server/phase2/fns";

export const Route = createFileRoute("/portal/orders/$orderId/confirmation")({
  head: () => ({
    meta: [{ title: "Order received — Automotive Brands Trade Portal" }],
  }),
  component: OrderConfirmationPage,
});

type Detail = Extract<Awaited<ReturnType<typeof getPortalOrderFn>>, { ok: true }>["data"];

function OrderConfirmationPage() {
  const { orderId } = Route.useParams();
  const [order, setOrder] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const result = await getPortalOrderFn({ data: { orderId } });
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setOrder(result.data);
  }, [orderId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (error) {
    return (
      <div>
        <PanelHeader title="Order confirmation" />
        <p className="p-6 text-sm text-bad">{error}</p>
      </div>
    );
  }

  if (!order) {
    return (
      <div>
        <PanelHeader title="Order confirmation" />
        <p className="p-6 text-[13px] text-steel">Loading…</p>
      </div>
    );
  }

  return (
    <div>
      <PanelHeader title="Order received" sub={order.companyName} />
      <div className="mx-auto max-w-2xl px-4 py-10 sm:px-6">
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-primary">Thank you</p>
        <h1 className="mt-2 font-display text-3xl font-semibold uppercase">
          We&apos;ve received your order
        </h1>
        <p className="mt-3 text-[15px] text-steel">
          Order <span className="font-semibold text-foreground">{order.orderNumber}</span>
          {order.placedAt ? ` · ${formatDateTime(order.placedAt)}` : null}
        </p>
        <p className="mt-2 text-[14px] text-steel">
          Your order is recorded with Automotive Brands. You will hear from us as it progresses —
          this confirmation does not mean the order has been despatched.
        </p>

        <dl className="mt-8 space-y-2 rounded-lg border border-border bg-surface/30 p-5 text-[14px]">
          <div className="flex justify-between gap-3">
            <dt className="text-steel">Your reference</dt>
            <dd>{order.poNumber || "—"}</dd>
          </div>
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

        <ul className="mt-6 divide-y divide-border/60 rounded-lg border border-border">
          {order.items.map((item) => (
            <li key={item.id} className="flex justify-between gap-3 px-4 py-3 text-[13px]">
              <span>
                <span className="font-medium">{item.name}</span>
                <span className="block text-steel">
                  {item.sku} · Qty {item.qty}
                </span>
              </span>
              <span className="num font-semibold">£{item.lineTotal}</span>
            </li>
          ))}
        </ul>

        <div className="mt-8 flex flex-wrap gap-3">
          <Link
            to="/portal/orders/$orderId"
            params={{ orderId: order.id }}
            className="inline-flex h-11 items-center rounded-md bg-primary px-5 text-[12px] font-bold uppercase text-primary-foreground"
          >
            View order
          </Link>
          <Link
            to={ROUTES.products}
            className="inline-flex h-11 items-center rounded-md border border-border px-5 text-[12px] font-bold uppercase"
          >
            Continue shopping
          </Link>
        </div>
      </div>
    </div>
  );
}
