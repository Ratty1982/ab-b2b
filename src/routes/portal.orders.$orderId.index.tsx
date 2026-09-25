import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { PanelHeader } from "@/components/ab/AppShell";
import { StatusBadge } from "@/components/ab/Badges";
import { ROUTES } from "@/lib/app-nav";
import { formatDateTime } from "@/lib/datetime";
import { customerOrderStatusLabel, customerOrderStatusTone } from "@/domain/order-status";
import { getPortalOrderFn } from "@/server/phase2/fns";

export const Route = createFileRoute("/portal/orders/$orderId/")({
  head: () => ({
    meta: [{ title: "Order detail — Automotive Brands Trade Portal" }],
  }),
  component: PortalOrderDetailPage,
});

type Detail = Extract<Awaited<ReturnType<typeof getPortalOrderFn>>, { ok: true }>["data"];

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
          <StatusBadge tone={customerOrderStatusTone(order.status)}>
            {customerOrderStatusLabel(order.status)}
          </StatusBadge>
        }
      />
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
          <table className="w-full min-w-[720px] text-[13px]">
            <thead>
              <tr className="border-b border-border bg-surface/60 text-left text-[10px] uppercase text-steel">
                <th className="px-3 py-2">SKU</th>
                <th className="px-3 py-2">Product</th>
                <th className="px-3 py-2 text-right">Qty</th>
                <th className="px-3 py-2 text-right">Unit ex VAT</th>
                <th className="px-3 py-2 text-right">Line net</th>
              </tr>
            </thead>
            <tbody>
              {order.items.map((item) => (
                <tr key={item.id} className="border-b border-border/60">
                  <td className="num px-3 py-2.5 text-steel">{item.sku}</td>
                  <td className="px-3 py-2.5">
                    {item.name}
                    {item.orderingMode === "FINAL_PART_CASE" ? (
                      <span className="ml-2 text-[11px] uppercase text-steel">Final part case</span>
                    ) : null}
                  </td>
                  <td className="num px-3 py-2.5 text-right">{item.qty}</td>
                  <td className="num px-3 py-2.5 text-right">£{item.customerUnitPrice}</td>
                  <td className="num px-3 py-2.5 text-right font-semibold">£{item.lineTotal}</td>
                </tr>
              ))}
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
        </div>
      </div>
    </div>
  );
}
