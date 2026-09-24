import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { PanelHeader } from "@/components/ab/AppShell";
import { StatusBadge } from "@/components/ab/Badges";
import { ROUTES } from "@/lib/app-nav";
import { formatDateTime } from "@/lib/datetime";
import { getAdminOrderFn } from "@/server/phase2/fns";

export const Route = createFileRoute("/admin/orders/$orderId")({
  head: () => ({ meta: [{ title: "Order — Automotive Brands Admin" }] }),
  component: AdminOrderDetailPage,
});

type Detail = Extract<Awaited<ReturnType<typeof getAdminOrderFn>>, { ok: true }>["data"];

function AdminOrderDetailPage() {
  const { orderId } = Route.useParams();
  const [order, setOrder] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const result = await getAdminOrderFn({ data: { orderId } });
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
        <PanelHeader title="Order" />
        <p className="p-6 text-sm text-bad">{error}</p>
      </div>
    );
  }
  if (!order) {
    return (
      <div>
        <PanelHeader title="Order" />
        <p className="p-6 text-[13px] text-steel">Loading…</p>
      </div>
    );
  }

  const addr = order.deliveryAddress;

  return (
    <div>
      <PanelHeader
        title={order.orderNumber}
        sub={order.companyName}
        actions={
          <StatusBadge tone={order.status === "SUBMITTED" ? "good" : "neutral"}>
            {order.status === "SUBMITTED" ? "Received" : order.status}
          </StatusBadge>
        }
      />
      <div className="grid gap-6 p-4 sm:p-6 lg:grid-cols-2">
        <section className="rounded-lg border border-border p-5">
          <h2 className="font-display text-base font-semibold uppercase">Order summary</h2>
          <dl className="mt-3 space-y-2 text-[13px]">
            <div className="flex justify-between gap-3">
              <dt className="text-steel">Placed</dt>
              <dd>{order.placedAt ? formatDateTime(order.placedAt) : "—"}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-steel">Customer reference</dt>
              <dd>{order.poNumber || "—"}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-steel">Payment terms</dt>
              <dd>{order.paymentTerms || "—"}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-steel">Net / VAT / Total</dt>
              <dd className="num text-right">
                £{order.subtotal} / £{order.vatTotal} / £{order.grandTotal}
              </dd>
            </div>
          </dl>
        </section>
        <section className="rounded-lg border border-border p-5">
          <h2 className="font-display text-base font-semibold uppercase">Customer & delivery</h2>
          <p className="mt-3 text-[13px] font-medium">{order.companyName}</p>
          {addr ? (
            <p className="mt-2 text-[13px] leading-relaxed text-steel">
              {addr.line1}
              <br />
              {addr.town} {addr.postcode}
            </p>
          ) : null}
          {order.contact ? (
            <p className="mt-3 text-[13px] text-steel">
              {order.contact.name}
              <br />
              {order.contact.email}
              {order.contact.phone ? (
                <>
                  <br />
                  {order.contact.phone}
                </>
              ) : null}
            </p>
          ) : null}
          {order.deliveryInstructions ? (
            <p className="mt-3 text-[13px] text-steel">
              <span className="font-semibold text-foreground">Instructions: </span>
              {order.deliveryInstructions}
            </p>
          ) : null}
        </section>
        <section className="rounded-lg border border-border p-5 lg:col-span-2">
          <h2 className="font-display text-base font-semibold uppercase">
            Integration readiness
          </h2>
          <dl className="mt-3 grid gap-2 text-[13px] sm:grid-cols-2">
            <div className="flex justify-between gap-3">
              <dt className="text-steel">Autopart account linked</dt>
              <dd>{order.autopartAccountLinked ? "Yes" : "No"}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-steel">Autopart code snapshot</dt>
              <dd className="num">{order.autopartCustomerCodeSnapshot || "—"}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-steel">Sales rep</dt>
              <dd>
                {order.salesRepNameSnapshot || "—"}
                {order.salesRepCodeSnapshot ? ` (${order.salesRepCodeSnapshot})` : ""}
              </dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-steel">Autopart submission</dt>
              <dd>Not submitted (Phase 6B)</dd>
            </div>
          </dl>
        </section>
      </div>

      <div className="px-4 pb-8 sm:px-6">
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[960px] text-[13px]">
            <thead>
              <tr className="border-b border-border bg-surface/60 text-left text-[10px] uppercase text-steel">
                <th className="px-3 py-2">SKU</th>
                <th className="px-3 py-2">Name</th>
                <th className="px-3 py-2 text-right">Qty</th>
                <th className="px-3 py-2 text-right">Sell unit</th>
                <th className="px-3 py-2 text-right">Commercial 4dp</th>
                <th className="px-3 py-2">Source</th>
                <th className="px-3 py-2 text-right">Line net</th>
              </tr>
            </thead>
            <tbody>
              {order.items.map((item) => {
                const adminItem = item as typeof item & {
                  unitPrice?: string;
                  priceSource?: string | null;
                };
                return (
                <tr key={item.id} className="border-b border-border/60">
                  <td className="num px-3 py-2">{item.sku}</td>
                  <td className="px-3 py-2">
                    {item.name}
                    {item.orderingMode ? (
                      <span className="ml-2 text-[11px] uppercase text-steel">{item.orderingMode}</span>
                    ) : null}
                  </td>
                  <td className="num px-3 py-2 text-right">{item.qty}</td>
                  <td className="num px-3 py-2 text-right">£{item.customerUnitPrice}</td>
                  <td className="num px-3 py-2 text-right text-steel">
                    £{adminItem.unitPrice ?? item.customerUnitPrice}
                  </td>
                  <td className="px-3 py-2 text-steel">{adminItem.priceSource || "—"}</td>
                  <td className="num px-3 py-2 text-right font-semibold">£{item.lineTotal}</td>
                </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <Link
          to={ROUTES.adminOrders}
          className="mt-6 inline-flex h-10 items-center rounded-md border border-border px-4 text-[12px] font-bold uppercase"
        >
          Back to orders
        </Link>
      </div>
    </div>
  );
}
