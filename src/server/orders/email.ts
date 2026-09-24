import { getEmailAdapter, type EmailMessage } from "@/infra/email";
import { moneyToString, parseMoney } from "@/domain/money";

export type OrderReceivedEmailInput = {
  orderNumber: string;
  companyName: string;
  contactEmail: string;
  contactName: string;
  poNumber: string | null;
  subtotal: string;
  vatTotal: string;
  grandTotal: string;
  currency: string;
  lineCount: number;
  placedAt: Date;
  deliveryTown: string | null;
  deliveryPostcode: string | null;
};

/**
 * Customer + optional internal notification that an order was received.
 * Status is SUBMITTED / pending fulfilment — do not claim Autopart despatch.
 */
export function buildOrderReceivedEmail(order: OrderReceivedEmailInput): EmailMessage {
  const ref = order.poNumber ? ` (your reference: ${order.poNumber})` : "";
  const delivery =
    order.deliveryTown && order.deliveryPostcode
      ? `${order.deliveryTown}, ${order.deliveryPostcode}`
      : order.deliveryPostcode ?? order.deliveryTown ?? "as provided";

  const subtotal = formatGbp(order.subtotal);
  const vat = formatGbp(order.vatTotal);
  const total = formatGbp(order.grandTotal);

  const text = [
    `Hello ${order.contactName},`,
    "",
    `We've received your Automotive Brands order ${order.orderNumber}${ref}.`,
    "",
    `Company: ${order.companyName}`,
    `Lines: ${order.lineCount}`,
    `Delivery: ${delivery}`,
    `Subtotal (ex VAT): ${subtotal} ${order.currency}`,
    `VAT: ${vat} ${order.currency}`,
    `Total (inc VAT): ${total} ${order.currency}`,
    "",
    "Your order has been received and is pending processing.",
    "This confirmation does not mean the order has been despatched.",
    "",
    "If you have questions, reply to this email or contact your account manager.",
    "",
    "Automotive Brands",
  ].join("\n");

  return {
    to: order.contactEmail,
    subject: `We've received your Automotive Brands order ${order.orderNumber}`,
    text,
    tags: {
      kind: "order_received",
      orderNumber: order.orderNumber,
    },
  };
}

function formatGbp(raw: string): string {
  const m = parseMoney(raw);
  return m ? moneyToString(m, 2) : raw;
}

/** Send customer confirmation; optionally notify TRADE_ORDER_NOTIFICATION_EMAIL. */
export async function sendOrderReceivedEmails(order: OrderReceivedEmailInput): Promise<{
  customerOk: boolean;
  internalOk: boolean | null;
  detail?: string;
}> {
  const adapter = getEmailAdapter();
  const customerMsg = buildOrderReceivedEmail(order);
  const customer = await adapter.send(customerMsg);

  const internalTo = (process.env["TRADE_ORDER_NOTIFICATION_EMAIL"] ?? "").trim();
  let internalOk: boolean | null = null;
  if (internalTo) {
    const internal = await adapter.send({
      to: internalTo,
      subject: `Order received ${order.orderNumber} — ${order.companyName}`,
      text: [
        `Order ${order.orderNumber} received for ${order.companyName}.`,
        `Contact: ${order.contactName} <${order.contactEmail}>`,
        `PO/reference: ${order.poNumber ?? "—"}`,
        `Total (inc VAT): ${formatGbp(order.grandTotal)} ${order.currency}`,
        `Lines: ${order.lineCount}`,
        "",
        "Status: SUBMITTED (received / pending Autopart handoff — not despatched).",
      ].join("\n"),
      tags: { kind: "order_received_internal", orderNumber: order.orderNumber },
    });
    internalOk = internal.ok;
  }

  return {
    customerOk: customer.ok,
    internalOk,
    ...(customer.detail ? { detail: customer.detail } : {}),
  };
}
