/**
 * Internal email after a hold-until-complete order is released for export.
 * Failures never reverse the stock-hold release.
 */

import { orderStockHoldReadyRecipientIdempotencyKey } from "@/domain/order-stock-hold";
import { mergeOrderInternalNotificationRecipients } from "@/domain/order-sales-rep-notification";
import { formatOperationalDateTime } from "@/lib/datetime";
import {
  emailHero,
  emailParagraph,
  emailProductTable,
  emailReferencePanel,
  emailStatusCallout,
  emailTotalsBlock,
} from "@/server/email/layout";
import { getEmailFooterMeta, getOrderNotificationRecipients } from "@/server/email/settings";
import { renderTransactionalEmailShell } from "@/server/email/shell";
import {
  loadOrderEmailSnapshot,
  upsertPendingEmail,
  safeAttemptDetailed,
} from "@/server/email/transactional";
import type { OrderEmailSnapshot } from "@/server/orders/email";
import { resolveOrderSalesRepNotificationEmail } from "@/server/email/order-sales-rep-notification";

function formatGbp(value: string): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return value;
  return n.toFixed(2);
}

export function buildOrderStockHoldReadyInternalBodies(
  order: OrderEmailSnapshot,
  footer?: { fromName?: string | null; replyTo?: string | null },
): { subject: string; text: string; html: string } {
  const subject = `Order Ready for Export - ${order.orderNumber} - ${order.companyName}`;
  const codeSnap = order.autopartCustomerCodeSnapshot ?? "—";
  const placedAtLabel = formatOperationalDateTime(order.placedAt) ?? order.placedAt ?? "—";
  const releasedHint = "Ready for Autopart CSV export — not despatched.";

  const text = [
    "ORDER READY FOR EXPORT",
    "",
    `Customer: ${order.companyName}`,
    `Autopart account: ${codeSnap}`,
    `AB order: ${order.orderNumber}`,
    `Placed: ${placedAtLabel}`,
    `Contact: ${order.contact.name} <${order.contact.email}>`,
    `PO: ${order.poNumber ?? "—"}`,
    "",
    "Items:",
    ...order.items.map(
      (item) =>
        `- ${item.sku} · ${item.name} · qty ${item.qty} · £${formatGbp(item.lineTotal)}`,
    ),
    "",
    `ORDER TOTAL (inc VAT): £${formatGbp(order.grandTotal)} ${order.currency}`,
    "",
    releasedHint,
    `VIEW ORDER: ${order.adminOrderUrl}`,
    "",
    "Automotive Brands",
  ].join("\n");

  const bodyHtml = `
${emailHero("Order ready for export", order.orderNumber)}
${emailStatusCallout("READY FOR EXPORT", releasedHint, "success")}
${emailReferencePanel([
  { label: "Customer", value: order.companyName },
  { label: "Autopart account", value: codeSnap },
  { label: "AB order", value: order.orderNumber },
  { label: "Placed", value: String(placedAtLabel) },
  { label: "Contact", value: `${order.contact.name} <${order.contact.email}>` },
  { label: "PO", value: order.poNumber ?? "—" },
  { label: "Total inc VAT", value: `£${formatGbp(order.grandTotal)}` },
])}
${emailProductTable(
  order.items.map((item) => ({
    sku: item.sku,
    name: item.name,
    qty: item.qty,
    unitPrice: item.customerUnitPrice,
    lineTotal: item.lineTotal,
  })),
)}
${emailTotalsBlock({
  goods: formatGbp(order.subtotal),
  delivery: formatGbp(order.deliveryTotal),
  vat: formatGbp(order.vatTotal),
  orderTotal: formatGbp(order.grandTotal),
  currency: order.currency,
})}
${emailParagraph(releasedHint, true)}`;

  const html = renderTransactionalEmailShell({
    variant: "internal",
    preheader: `Order ${order.orderNumber} ready for Autopart export — ${order.companyName}`,
    bodyHtml,
    cta: { label: "View order", href: order.adminOrderUrl },
    footer: footer ?? { fromName: "Automotive Brands" },
  });

  return { subject, text, html };
}

/**
 * After a committed stock-hold release: one internal email per recipient.
 * Idempotent purpose keys. Email failure must not reverse release.
 */
export async function sendOrderStockHoldReadyEmailsAfterCommit(
  orderId: string,
): Promise<{ internalOk: boolean | null; detail?: string }> {
  const snapshot = await loadOrderEmailSnapshot(orderId);
  if (!snapshot) {
    return { internalOk: null, detail: "order snapshot missing" };
  }

  const footer = await getEmailFooterMeta();
  const bodies = buildOrderStockHoldReadyInternalBodies(snapshot, footer);

  const configuredRecipients = await getOrderNotificationRecipients();
  const envFallback = (process.env["TRADE_ORDER_NOTIFICATION_EMAIL"] ?? "").trim();
  const configuredOrEnv =
    configuredRecipients.length > 0 ? configuredRecipients : envFallback ? [envFallback] : [];

  const salesRepResolve = await resolveOrderSalesRepNotificationEmail(orderId);
  const salesRepEmail = salesRepResolve.ok ? salesRepResolve.email : null;
  const internalList = mergeOrderInternalNotificationRecipients(
    configuredOrEnv,
    salesRepEmail,
  );

  if (internalList.length === 0) {
    return { internalOk: null, detail: "no_internal_recipients" };
  }

  let anyOk = false;
  for (const toEmail of internalList) {
    try {
      const upsert = await upsertPendingEmail({
        purpose: "ORDER_STOCK_HOLD_READY_INTERNAL",
        toEmail,
        subject: bodies.subject,
        textBody: bodies.text,
        htmlBody: bodies.html,
        entityType: "Order",
        entityId: orderId,
        idempotencyKey: orderStockHoldReadyRecipientIdempotencyKey({
          orderId,
          toEmail,
          salesRepEmail,
        }),
      });
      const dispatch = await safeAttemptDetailed(upsert.id);
      if (dispatch.emailSent || dispatch.emailDeferred) anyOk = true;
    } catch (error) {
      console.error("[ab:stock-hold-email] recipient failed", {
        orderId,
        toEmail,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return { internalOk: anyOk };
}
