/**
 * Order received email builders (customer + internal).
 * Bodies use ORDER SNAPSHOT prices only — never live catalogue prices.
 * Customer copy must not claim Autopart stock reservation or despatch.
 */

import { moneyToString, parseMoney } from "@/domain/money";
import type { EmailMessage } from "@/infra/email";
import {
  escapeEmailHtml,
  renderTransactionalEmailShell,
} from "@/server/email/shell";

export type OrderEmailLine = {
  sku: string;
  name: string;
  qty: number;
  customerUnitPrice: string;
  lineTotal: string;
  orderingMode: string | null;
};

export type OrderEmailSnapshot = {
  orderId: string;
  orderNumber: string;
  companyName: string;
  status: string;
  poNumber: string | null;
  currency: string;
  subtotal: string;
  vatTotal: string;
  deliveryTotal: string;
  grandTotal: string;
  placedAt: Date;
  paymentTerms: string | null;
  deliveryInstructions: string | null;
  deliveryAddress: {
    line1: string;
    line2: string | null;
    town: string;
    county: string | null;
    postcode: string;
    country: string;
  } | null;
  contact: { name: string; email: string; phone: string | null };
  items: OrderEmailLine[];
  autopartAccountLinked: boolean;
  autopartCustomerCodeSnapshot: string | null;
  salesRepNameSnapshot: string | null;
  salesRepCodeSnapshot: string | null;
  portalOrderUrl: string;
  adminOrderUrl: string;
};

export type EmailFooterMeta = {
  fromName?: string | null;
  fromEmail?: string | null;
  replyToEmail?: string | null;
};

function formatGbp(raw: string): string {
  const m = parseMoney(raw);
  return m ? moneyToString(m, 2) : raw;
}

function formatDelivery(order: OrderEmailSnapshot): string {
  const a = order.deliveryAddress;
  if (!a) return "as provided";
  const parts = [a.line1, a.line2, a.town, a.county, a.postcode].filter(Boolean);
  return parts.join(", ");
}

function itemsPlain(order: OrderEmailSnapshot): string {
  return order.items
    .map(
      (item) =>
        `- ${item.sku} ${item.name} × ${item.qty} @ £${formatGbp(item.customerUnitPrice)} = £${formatGbp(item.lineTotal)}`,
    )
    .join("\n");
}

/** Email-safe order summary: Product (+SKU), Qty, Unit Price, Total. */
function orderSummaryTableHtml(order: OrderEmailSnapshot): string {
  const rows = order.items
    .map(
      (item) => `<tr>
  <td style="padding:10px 8px;border-bottom:1px solid #d7dbe3;font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#1a1f2c;vertical-align:top;">
    <strong>${escapeEmailHtml(item.name)}</strong><br/>
    <span style="font-family:Consolas,monospace;font-size:12px;color:#5c6578;">${escapeEmailHtml(item.sku)}</span>
  </td>
  <td style="padding:10px 8px;border-bottom:1px solid #d7dbe3;font-family:Arial,Helvetica,sans-serif;font-size:14px;text-align:right;vertical-align:top;">${item.qty}</td>
  <td style="padding:10px 8px;border-bottom:1px solid #d7dbe3;font-family:Arial,Helvetica,sans-serif;font-size:14px;text-align:right;vertical-align:top;">£${escapeEmailHtml(formatGbp(item.customerUnitPrice))}</td>
  <td style="padding:10px 8px;border-bottom:1px solid #d7dbe3;font-family:Arial,Helvetica,sans-serif;font-size:14px;text-align:right;vertical-align:top;">£${escapeEmailHtml(formatGbp(item.lineTotal))}</td>
</tr>`,
    )
    .join("\n");

  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="width:100%;border-collapse:collapse;margin:20px 0 8px;">
<thead>
<tr>
  <th align="left" style="padding:8px;border-bottom:2px solid #101826;font-family:Arial,Helvetica,sans-serif;font-size:11px;letter-spacing:0.08em;text-transform:uppercase;color:#5c6578;">Product</th>
  <th align="right" style="padding:8px;border-bottom:2px solid #101826;font-family:Arial,Helvetica,sans-serif;font-size:11px;letter-spacing:0.08em;text-transform:uppercase;color:#5c6578;">Qty</th>
  <th align="right" style="padding:8px;border-bottom:2px solid #101826;font-family:Arial,Helvetica,sans-serif;font-size:11px;letter-spacing:0.08em;text-transform:uppercase;color:#5c6578;">Unit Price</th>
  <th align="right" style="padding:8px;border-bottom:2px solid #101826;font-family:Arial,Helvetica,sans-serif;font-size:11px;letter-spacing:0.08em;text-transform:uppercase;color:#5c6578;">Total</th>
</tr>
</thead>
<tbody>${rows}</tbody>
</table>
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="width:100%;margin:8px 0 16px;">
  <tr>
    <td style="padding:4px 8px;font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#5c6578;">Goods ex VAT</td>
    <td align="right" style="padding:4px 8px;font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#1a1f2c;">£${escapeEmailHtml(formatGbp(order.subtotal))}</td>
  </tr>
  <tr>
    <td style="padding:4px 8px;font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#5c6578;">Delivery</td>
    <td align="right" style="padding:4px 8px;font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#1a1f2c;">${
      formatGbp(order.deliveryTotal) === "0.00"
        ? "FREE"
        : `£${escapeEmailHtml(formatGbp(order.deliveryTotal))}`
    }</td>
  </tr>
  <tr>
    <td style="padding:4px 8px;font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#5c6578;">VAT</td>
    <td align="right" style="padding:4px 8px;font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#1a1f2c;">£${escapeEmailHtml(formatGbp(order.vatTotal))}</td>
  </tr>
  <tr>
    <td style="padding:10px 8px 4px;font-family:Arial,Helvetica,sans-serif;font-size:15px;font-weight:700;color:#1a1f2c;border-top:1px solid #d7dbe3;">Total (inc VAT)</td>
    <td align="right" style="padding:10px 8px 4px;font-family:Arial,Helvetica,sans-serif;font-size:15px;font-weight:700;color:#1a1f2c;border-top:1px solid #d7dbe3;">£${escapeEmailHtml(formatGbp(order.grandTotal))} ${escapeEmailHtml(order.currency)}</td>
  </tr>
</table>`;
}

export function buildOrderReceivedCustomerBodies(
  order: OrderEmailSnapshot,
  footer?: EmailFooterMeta,
): {
  subject: string;
  text: string;
  html: string;
} {
  const ref = order.poNumber ? ` (your reference: ${order.poNumber})` : "";
  const delivery = formatDelivery(order);
  const subject = `We've received your Automotive Brands order ${order.orderNumber}`;

  const text = [
    `Hello ${order.contact.name},`,
    "",
    `We've received your Automotive Brands order ${order.orderNumber}${ref}.`,
    "",
    `Company: ${order.companyName}`,
    `Delivery address: ${delivery}`,
    "",
    "Items:",
    itemsPlain(order),
    "",
    `Goods ex VAT: £${formatGbp(order.subtotal)} ${order.currency}`,
    `Delivery: ${formatGbp(order.deliveryTotal) === "0.00" ? "FREE" : `£${formatGbp(order.deliveryTotal)} ${order.currency}`}`,
    `VAT: £${formatGbp(order.vatTotal)} ${order.currency}`,
    `Total (inc VAT): £${formatGbp(order.grandTotal)} ${order.currency}`,
    "",
    "Your order has been received and is pending processing.",
    "This confirmation does not mean the order has been despatched.",
    "",
    `VIEW YOUR ORDER: ${order.portalOrderUrl}`,
    "",
    "If you have questions, reply to this email or contact your account manager.",
    "",
    "Automotive Brands",
    "https://automotivebrands.co.uk",
  ].join("\n");

  const bodyHtml = `
<p style="margin:0 0 16px;">Hello ${escapeEmailHtml(order.contact.name)},</p>
<p style="margin:0 0 16px;">We've received your Automotive Brands order <strong>${escapeEmailHtml(order.orderNumber)}</strong>${escapeEmailHtml(ref)}.</p>
<p style="margin:0 0 8px;"><strong>Company:</strong> ${escapeEmailHtml(order.companyName)}<br/>
<strong>Delivery address:</strong> ${escapeEmailHtml(delivery)}</p>
${orderSummaryTableHtml(order)}
<p style="margin:0 0 8px;">Your order has been received and is pending processing.<br/>
This confirmation does not mean the order has been despatched.</p>`;

  const html = renderTransactionalEmailShell({
    preheader: `Order ${order.orderNumber} received`,
    bodyHtml,
    cta: { label: "View your order", href: order.portalOrderUrl },
    footer: footer ?? { fromName: "Automotive Brands" },
  });

  return { subject, text, html };
}

export function buildOrderReceivedInternalBodies(
  order: OrderEmailSnapshot,
  footer?: EmailFooterMeta,
): {
  subject: string;
  text: string;
  html: string;
} {
  const subject = `New B2B order ${order.orderNumber} — ${order.companyName}`;
  const salesRep =
    order.salesRepNameSnapshot || order.salesRepCodeSnapshot
      ? `${order.salesRepNameSnapshot ?? "—"}${order.salesRepCodeSnapshot ? ` (${order.salesRepCodeSnapshot})` : ""}`
      : "—";
  const codeSnap = order.autopartCustomerCodeSnapshot ?? "—";

  const text = [
    `Order ${order.orderNumber} received for ${order.companyName}.`,
    `Contact: ${order.contact.name} <${order.contact.email}>`,
    `PO/reference: ${order.poNumber ?? "—"}`,
    `Payment terms: ${order.paymentTerms ?? "—"}`,
    `Autopart linked: ${order.autopartAccountLinked ? "Yes" : "No"}`,
    `Autopart code snapshot: ${codeSnap}`,
    `Sales rep: ${salesRep}`,
    "",
    "Items:",
    itemsPlain(order),
    "",
    `Subtotal: £${formatGbp(order.subtotal)}`,
    `Delivery: ${formatGbp(order.deliveryTotal) === "0.00" ? "FREE" : `£${formatGbp(order.deliveryTotal)}`}`,
    `VAT: £${formatGbp(order.vatTotal)}`,
    `Total (inc VAT): £${formatGbp(order.grandTotal)} ${order.currency}`,
    "",
    "Status: SUBMITTED (received / pending Autopart handoff — not despatched).",
    `VIEW ORDER (admin): ${order.adminOrderUrl}`,
    "",
    "Automotive Brands",
  ].join("\n");

  const bodyHtml = `
<p style="margin:0 0 16px;">Order <strong>${escapeEmailHtml(order.orderNumber)}</strong> received for <strong>${escapeEmailHtml(order.companyName)}</strong>.</p>
<p style="margin:0 0 12px;">
Contact: ${escapeEmailHtml(order.contact.name)} &lt;${escapeEmailHtml(order.contact.email)}&gt;<br/>
PO/reference: ${escapeEmailHtml(order.poNumber ?? "—")}<br/>
Payment terms: ${escapeEmailHtml(order.paymentTerms ?? "—")}<br/>
Autopart linked: <strong>${order.autopartAccountLinked ? "Yes" : "No"}</strong><br/>
Autopart code snapshot: <span style="font-family:Consolas,monospace;">${escapeEmailHtml(codeSnap)}</span><br/>
Sales rep: ${escapeEmailHtml(salesRep)}
</p>
${orderSummaryTableHtml(order)}
<p style="margin:0 0 8px;">Status: SUBMITTED (received / pending Autopart handoff — not despatched).</p>`;

  const html = renderTransactionalEmailShell({
    preheader: `New B2B order ${order.orderNumber}`,
    bodyHtml,
    cta: { label: "View order", href: order.adminOrderUrl },
    footer: footer ?? { fromName: "Automotive Brands" },
  });

  return { subject, text, html };
}

/** @deprecated Prefer buildOrderReceivedCustomerBodies + transactional outbox. */
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

/** Legacy thin builder kept for any remaining callers. */
export function buildOrderReceivedEmail(order: OrderReceivedEmailInput): EmailMessage {
  const ref = order.poNumber ? ` (your reference: ${order.poNumber})` : "";
  const delivery =
    order.deliveryTown && order.deliveryPostcode
      ? `${order.deliveryTown}, ${order.deliveryPostcode}`
      : order.deliveryPostcode ?? order.deliveryTown ?? "as provided";

  const text = [
    `Hello ${order.contactName},`,
    "",
    `We've received your Automotive Brands order ${order.orderNumber}${ref}.`,
    "",
    `Company: ${order.companyName}`,
    `Lines: ${order.lineCount}`,
    `Delivery: ${delivery}`,
    `Subtotal (ex VAT): £${formatGbp(order.subtotal)} ${order.currency}`,
    `VAT: £${formatGbp(order.vatTotal)} ${order.currency}`,
    `Total (inc VAT): £${formatGbp(order.grandTotal)} ${order.currency}`,
    "",
    "Your order has been received and is pending processing.",
    "This confirmation does not mean the order has been despatched.",
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
