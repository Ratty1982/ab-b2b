/**
 * Order received email builders (customer + internal).
 * Bodies use ORDER SNAPSHOT prices only — never live catalogue prices.
 * Customer copy must not claim Autopart stock reservation or despatch.
 */

import { moneyToString, parseMoney } from "@/domain/money";
import type { EmailMessage } from "@/infra/email";

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

function formatGbp(raw: string): string {
  const m = parseMoney(raw);
  return m ? moneyToString(m, 2) : raw;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
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

function itemsHtml(order: OrderEmailSnapshot): string {
  const rows = order.items
    .map(
      (item) => `<tr>
  <td style="padding:6px 8px;border-bottom:1px solid #e5e7eb;font-family:monospace">${escapeHtml(item.sku)}</td>
  <td style="padding:6px 8px;border-bottom:1px solid #e5e7eb">${escapeHtml(item.name)}</td>
  <td style="padding:6px 8px;border-bottom:1px solid #e5e7eb;text-align:right">${item.qty}</td>
  <td style="padding:6px 8px;border-bottom:1px solid #e5e7eb;text-align:right">£${escapeHtml(formatGbp(item.customerUnitPrice))}</td>
  <td style="padding:6px 8px;border-bottom:1px solid #e5e7eb;text-align:right">£${escapeHtml(formatGbp(item.lineTotal))}</td>
</tr>`,
    )
    .join("\n");
  return `<table style="width:100%;border-collapse:collapse;font-size:14px;margin:16px 0">
<thead><tr>
  <th style="text-align:left;padding:6px 8px;border-bottom:2px solid #111">SKU</th>
  <th style="text-align:left;padding:6px 8px;border-bottom:2px solid #111">Item</th>
  <th style="text-align:right;padding:6px 8px;border-bottom:2px solid #111">Qty</th>
  <th style="text-align:right;padding:6px 8px;border-bottom:2px solid #111">Unit</th>
  <th style="text-align:right;padding:6px 8px;border-bottom:2px solid #111">Net</th>
</tr></thead>
<tbody>${rows}</tbody>
</table>`;
}

export function buildOrderReceivedCustomerBodies(order: OrderEmailSnapshot): {
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
    `Delivery: ${delivery}`,
    "",
    "Items:",
    itemsPlain(order),
    "",
    `Subtotal (ex VAT): £${formatGbp(order.subtotal)} ${order.currency}`,
    `VAT: £${formatGbp(order.vatTotal)} ${order.currency}`,
    `Total (inc VAT): £${formatGbp(order.grandTotal)} ${order.currency}`,
    "",
    "Your order has been received and is pending processing.",
    "This confirmation does not mean the order has been despatched.",
    "",
    `VIEW ORDER: ${order.portalOrderUrl}`,
    "",
    "If you have questions, reply to this email or contact your account manager.",
    "",
    "Automotive Brands",
  ].join("\n");

  const html = `<!DOCTYPE html><html><body style="font-family:system-ui,sans-serif;color:#111;line-height:1.5">
<p>Hello ${escapeHtml(order.contact.name)},</p>
<p>We've received your Automotive Brands order <strong>${escapeHtml(order.orderNumber)}</strong>${escapeHtml(ref)}.</p>
<p><strong>Company:</strong> ${escapeHtml(order.companyName)}<br/>
<strong>Delivery:</strong> ${escapeHtml(delivery)}</p>
${itemsHtml(order)}
<p>
Subtotal (ex VAT): <strong>£${escapeHtml(formatGbp(order.subtotal))}</strong> ${escapeHtml(order.currency)}<br/>
VAT: <strong>£${escapeHtml(formatGbp(order.vatTotal))}</strong><br/>
Total (inc VAT): <strong>£${escapeHtml(formatGbp(order.grandTotal))}</strong>
</p>
<p>Your order has been received and is pending processing.<br/>
This confirmation does not mean the order has been despatched.</p>
<p><a href="${escapeHtml(order.portalOrderUrl)}" style="display:inline-block;padding:10px 16px;background:#111;color:#fff;text-decoration:none;font-weight:600">VIEW ORDER</a></p>
<p>If you have questions, reply to this email or contact your account manager.</p>
<p>Automotive Brands</p>
</body></html>`;

  return { subject, text, html };
}

export function buildOrderReceivedInternalBodies(order: OrderEmailSnapshot): {
  subject: string;
  text: string;
  html: string;
} {
  const subject = `Order received ${order.orderNumber} — ${order.companyName}`;
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
    `VAT: £${formatGbp(order.vatTotal)}`,
    `Total (inc VAT): £${formatGbp(order.grandTotal)} ${order.currency}`,
    "",
    "Status: SUBMITTED (received / pending Autopart handoff — not despatched).",
    `VIEW ORDER (admin): ${order.adminOrderUrl}`,
  ].join("\n");

  const html = `<!DOCTYPE html><html><body style="font-family:system-ui,sans-serif;color:#111;line-height:1.5">
<p>Order <strong>${escapeHtml(order.orderNumber)}</strong> received for <strong>${escapeHtml(order.companyName)}</strong>.</p>
<p>
Contact: ${escapeHtml(order.contact.name)} &lt;${escapeHtml(order.contact.email)}&gt;<br/>
PO/reference: ${escapeHtml(order.poNumber ?? "—")}<br/>
Payment terms: ${escapeHtml(order.paymentTerms ?? "—")}<br/>
Autopart linked: <strong>${order.autopartAccountLinked ? "Yes" : "No"}</strong><br/>
Autopart code snapshot: <span style="font-family:monospace">${escapeHtml(codeSnap)}</span><br/>
Sales rep: ${escapeHtml(salesRep)}
</p>
${itemsHtml(order)}
<p>
Subtotal: £${escapeHtml(formatGbp(order.subtotal))}<br/>
VAT: £${escapeHtml(formatGbp(order.vatTotal))}<br/>
Total (inc VAT): <strong>£${escapeHtml(formatGbp(order.grandTotal))}</strong> ${escapeHtml(order.currency)}
</p>
<p>Status: SUBMITTED (received / pending Autopart handoff — not despatched).</p>
<p><a href="${escapeHtml(order.adminOrderUrl)}" style="display:inline-block;padding:10px 16px;background:#111;color:#fff;text-decoration:none;font-weight:600">VIEW ORDER</a></p>
</body></html>`;

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
