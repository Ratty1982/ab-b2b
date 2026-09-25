import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { PanelHeader } from "@/components/ab/AppShell";
import { StatusBadge } from "@/components/ab/Badges";
import { ROUTES } from "@/lib/app-nav";
import { formatDateTime } from "@/lib/datetime";
import {
  getAdminOrderFn,
  listOrderEmailsFn,
  retryTransactionalEmailFn,
} from "@/server/phase2/fns";

export const Route = createFileRoute("/admin/orders/$orderId")({
  head: () => ({ meta: [{ title: "Order — Automotive Brands Admin" }] }),
  component: AdminOrderDetailPage,
});

type Detail = Extract<Awaited<ReturnType<typeof getAdminOrderFn>>, { ok: true }>["data"];
type EmailRow = Extract<Awaited<ReturnType<typeof listOrderEmailsFn>>, { ok: true }>["data"][number];

function AdminOrderDetailPage() {
  const { orderId } = Route.useParams();
  const [order, setOrder] = useState<Detail | null>(null);
  const [emails, setEmails] = useState<EmailRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [retryingId, setRetryingId] = useState<string | null>(null);
  const [retryMessage, setRetryMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [orderResult, emailResult] = await Promise.all([
      getAdminOrderFn({ data: { orderId } }),
      listOrderEmailsFn({ data: { orderId } }),
    ]);
    if (!orderResult.ok) {
      setError(orderResult.error);
      return;
    }
    setOrder(orderResult.data);
    if (emailResult.ok) {
      setEmails(emailResult.data);
    } else {
      setEmails([]);
    }
  }, [orderId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function onRetry(emailId: string) {
    setRetryingId(emailId);
    setRetryMessage(null);
    const result = await retryTransactionalEmailFn({ data: { emailId } });
    setRetryingId(null);
    if (!result.ok) {
      setRetryMessage(result.error);
      return;
    }
    setRetryMessage(`Retried — status ${result.data.status}`);
    await load();
  }

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
  const customerEmail = emails.find((e) => e.purpose === "ORDER_RECEIVED");
  const internalEmail = emails.find((e) => e.purpose === "ORDER_RECEIVED_INTERNAL");

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
            <div className="flex justify-between gap-3">
              <dt className="text-steel">Total inc VAT</dt>
              <dd className="num font-semibold">£{order.grandTotal}</dd>
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
        <section className="rounded-lg border border-border p-5 lg:col-span-2">
          <h2 className="font-display text-base font-semibold uppercase">Transactional email</h2>
          {retryMessage ? (
            <p className="mt-2 text-[12px] text-steel">{retryMessage}</p>
          ) : null}
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <EmailStatusCard
              label="Customer (ORDER_RECEIVED)"
              row={customerEmail}
              retrying={retryingId === customerEmail?.id}
              {...(customerEmail
                ? { onRetry: () => void onRetry(customerEmail.id) }
                : {})}
            />
            <EmailStatusCard
              label="Internal (ORDER_RECEIVED_INTERNAL)"
              row={internalEmail}
              retrying={retryingId === internalEmail?.id}
              {...(internalEmail
                ? { onRetry: () => void onRetry(internalEmail.id) }
                : {})}
            />
          </div>
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

function EmailStatusCard({
  label,
  row,
  retrying,
  onRetry,
}: {
  label: string;
  row: EmailRow | undefined;
  retrying?: boolean;
  onRetry?: () => void;
}) {
  const tone =
    row?.status === "SENT" ? "good" : row?.status === "FAILED" ? "bad" : "neutral";
  return (
    <div className="rounded-md border border-border/80 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-steel">{label}</p>
          {row ? (
            <>
              <p className="mt-2 text-[13px]">{row.toEmail}</p>
              <p className="mt-1 text-[12px] text-steel">{row.subject}</p>
              {row.lastError ? (
                <p className="mt-1 text-[12px] text-bad">{row.lastError}</p>
              ) : null}
              <p className="mt-1 text-[11px] text-steel">
                Attempts: {row.attemptCount}
                {row.sentAt ? ` · Sent ${formatDateTime(row.sentAt)}` : null}
              </p>
            </>
          ) : (
            <p className="mt-2 text-[13px] text-steel">No email recorded</p>
          )}
        </div>
        {row ? <StatusBadge tone={tone}>{row.status}</StatusBadge> : null}
      </div>
      {row && onRetry && row.status !== "SENT" ? (
        <button
          type="button"
          disabled={retrying}
          onClick={onRetry}
          className="mt-3 inline-flex h-9 items-center rounded-md border border-border px-3 text-[11px] font-bold uppercase disabled:opacity-50"
        >
          {retrying ? "Retrying…" : "Retry"}
        </button>
      ) : null}
    </div>
  );
}
