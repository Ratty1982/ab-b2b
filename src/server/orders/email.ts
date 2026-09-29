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
  availableQtyAtOrder: number | null;
  backorderQtyAtOrder: number;
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
  /** Present when the order was created from an accepted quotation. */
  sourceQuoteNumber: string | null;
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

function itemsPlain(order: OrderEmailSnapshot, mode: "customer" | "internal" = "customer"): string {
  return order.items
    .map((item) => {
      const bo = item.backorderQtyAtOrder ?? 0;
      const avail = item.availableQtyAtOrder ?? Math.max(0, item.qty - bo);
      if (mode === "internal") {
        return (
          `- ${item.sku} ${item.name}\n` +
          `  Ordered: ${item.qty} · Available: ${avail} · Backorder: ${bo} @ £${formatGbp(item.customerUnitPrice)} = £${formatGbp(item.lineTotal)}`
        );
      }
      if (bo <= 0) {
        return `- ${item.name}\n  Qty: ${item.qty}\n  Available`;
      }
      return (
        `- ${item.name}\n` +
        `  Qty: ${item.qty}\n` +
        `  ${avail} available\n` +
        `  ${bo} on backorder`
      );
    })
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
    ${
      (item.backorderQtyAtOrder ?? 0) > 0
        ? `<br/><span style="font-size:12px;color:#b45309;">${item.backorderQtyAtOrder} currently on backorder</span>`
        : ""
    }
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
  const quoteLine = order.sourceQuoteNumber
    ? `Created from quotation ${order.sourceQuoteNumber}`
    : null;
  const delivery = formatDelivery(order);
  const subject = `We've received your Automotive Brands order ${order.orderNumber}`;

  const text = [
    `Hello ${order.contact.name},`,
    "",
    `We've received your Automotive Brands order ${order.orderNumber}${ref}.`,
    ...(quoteLine ? [quoteLine, ""] : [""]),
    `Company: ${order.companyName}`,
    `Delivery address: ${delivery}`,
    "",
    "Items:",
    itemsPlain(order, "customer"),
    "",
    `Goods ex VAT: £${formatGbp(order.subtotal)} ${order.currency}`,
    `Delivery: ${formatGbp(order.deliveryTotal) === "0.00" ? "FREE" : `£${formatGbp(order.deliveryTotal)} ${order.currency}`}`,
    `VAT: £${formatGbp(order.vatTotal)} ${order.currency}`,
    `Total (inc VAT): £${formatGbp(order.grandTotal)} ${order.currency}`,
    "",
    ...(order.items.some((i) => (i.backorderQtyAtOrder ?? 0) > 0)
      ? [
          "BACKORDER INFORMATION",
          "Some items on your order are currently awaiting stock. You do not need to place another order for these items. They will remain on your order and will be supplied when available.",
          "Backordered items will be supplied when stock becomes available.",
          "",
        ]
      : []),
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
${
  quoteLine
    ? `<p style="margin:0 0 16px;">${escapeEmailHtml(quoteLine)}.</p>`
    : ""
}
<p style="margin:0 0 8px;"><strong>Company:</strong> ${escapeEmailHtml(order.companyName)}<br/>
<strong>Delivery address:</strong> ${escapeEmailHtml(delivery)}</p>
${orderSummaryTableHtml(order)}
${
  order.items.some((i) => (i.backorderQtyAtOrder ?? 0) > 0)
    ? `<div style="margin:0 0 16px;padding:14px;background:#fff7ed;border:1px solid #fdba74;font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#9a3412;">
<p style="margin:0 0 8px;font-size:12px;letter-spacing:0.08em;text-transform:uppercase;"><strong>Backorder information</strong></p>
<p style="margin:0 0 8px;">Some items on your order are currently awaiting stock. You do not need to place another order for these items. They will remain on your order and will be supplied when available.</p>
<p style="margin:0;">Backordered items will be supplied when stock becomes available.</p>
</div>`
    : ""
}
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

  const quoteOrigin = order.sourceQuoteNumber
    ? `Created from quotation ${order.sourceQuoteNumber}`
    : null;

  const text = [
    `Order ${order.orderNumber} received for ${order.companyName}.`,
    ...(quoteOrigin ? [quoteOrigin] : []),
    `Contact: ${order.contact.name} <${order.contact.email}>`,
    `PO/reference: ${order.poNumber ?? "—"}`,
    `Payment terms: ${order.paymentTerms ?? "—"}`,
    `Autopart linked: ${order.autopartAccountLinked ? "Yes" : "No"}`,
    `Autopart code snapshot: ${codeSnap}`,
    `Sales rep: ${salesRep}`,
    "",
    "Items:",
    itemsPlain(order, "internal"),
    "",
    `Subtotal: £${formatGbp(order.subtotal)}`,
    `Delivery: ${formatGbp(order.deliveryTotal) === "0.00" ? "FREE" : `£${formatGbp(order.deliveryTotal)}`}`,
    `VAT: £${formatGbp(order.vatTotal)}`,
    `Total (inc VAT): £${formatGbp(order.grandTotal)} ${order.currency}`,
    "",
    "Status: SUBMITTED (received / pending Autopart handoff — not despatched).",
    `REVIEW ORDER: ${order.adminOrderUrl}`,
    "",
    "Automotive Brands",
  ].join("\n");

  const bodyHtml = `
<p style="margin:0 0 16px;">Order <strong>${escapeEmailHtml(order.orderNumber)}</strong> received for <strong>${escapeEmailHtml(order.companyName)}</strong>.</p>
<p style="margin:0 0 12px;">
${quoteOrigin ? `${escapeEmailHtml(quoteOrigin)}<br/>` : ""}
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
    cta: { label: "Review order", href: order.adminOrderUrl },
    footer: footer ?? { fromName: "Automotive Brands" },
  });

  return { subject, text, html };
}


/**
 * Partial despatch notification.
 * When line quantities are unknown (504C order-level only), do not invent SKU despatch qty.
 */
export function buildOrderPartDespatchedCustomerBodies(
  order: OrderEmailSnapshot,
  opts: { lineQuantitiesKnown: boolean; footer?: EmailFooterMeta },
): {
  subject: string;
  text: string;
  html: string;
} {
  const subject = `Part of your Automotive Brands order ${order.orderNumber} has been despatched`;
  const backorderItems = order.items.filter((i) => (i.backorderQtyAtOrder ?? 0) > 0);
  const availableItems = order.items.filter((i) => (i.backorderQtyAtOrder ?? 0) <= 0);

  const despatchedBlock = opts.lineQuantitiesKnown
    ? order.items
        .filter((i) => (i.availableQtyAtOrder ?? 0) > 0 || (i.backorderQtyAtOrder ?? 0) < i.qty)
        .map((i) => {
          const despatched = Math.max(0, i.qty - (i.backorderQtyAtOrder ?? 0));
          return despatched > 0 ? `${despatched} × ${i.name}` : null;
        })
        .filter(Boolean)
        .join("\n")
    : availableItems.map((i) => `${i.qty} × ${i.name}`).join("\n") ||
      "Part of this order (exact line quantities will be confirmed on your order detail).";

  const stillBackorderBlock = backorderItems
    .map((i) => `${i.backorderQtyAtOrder} × ${i.name}`)
    .join("\n");

  const text = [
    `Hello ${order.contact.name},`,
    "",
    `Part of your Automotive Brands order ${order.orderNumber} has been despatched.`,
    "",
    "DESPATCHED",
    despatchedBlock || "—",
    "",
    ...(stillBackorderBlock
      ? ["STILL ON BACKORDER", stillBackorderBlock, ""]
      : []),
    "We'll keep any remaining items on backorder and update you when they are despatched.",
    "You do not need to place another order for these items.",
    "",
    ...(opts.lineQuantitiesKnown
      ? []
      : [
          "Note: Autopart invoice confirmation is order-level. Exact SKU despatch quantities will appear on your order detail when confirmed.",
          "",
        ]),
    `VIEW YOUR ORDER: ${order.portalOrderUrl}`,
    "",
    "Automotive Brands",
    "https://automotivebrands.co.uk",
  ].join("\n");

  const bodyHtml = `
<p style="margin:0 0 16px;">Hello ${escapeEmailHtml(order.contact.name)},</p>
<p style="margin:0 0 16px;">Part of your Automotive Brands order <strong>${escapeEmailHtml(order.orderNumber)}</strong> has been despatched.</p>
<p style="margin:16px 0 8px;font-family:Arial,Helvetica,sans-serif;font-size:12px;letter-spacing:0.08em;text-transform:uppercase;color:#5c6578;"><strong>Despatched</strong></p>
<p style="margin:0 0 16px;white-space:pre-line;">${escapeEmailHtml(despatchedBlock || "—")}</p>
${
  stillBackorderBlock
    ? `<p style="margin:16px 0 8px;font-family:Arial,Helvetica,sans-serif;font-size:12px;letter-spacing:0.08em;text-transform:uppercase;color:#9a3412;"><strong>Still on backorder</strong></p>
<p style="margin:0 0 16px;white-space:pre-line;">${escapeEmailHtml(stillBackorderBlock)}</p>`
    : ""
}
<p style="margin:0 0 8px;">We'll keep any remaining items on backorder and update you when they are despatched. You do not need to place another order for these items.</p>
${
  opts.lineQuantitiesKnown
    ? ""
    : `<p style="margin:12px 0 8px;font-size:13px;color:#5c6578;">Autopart invoice confirmation is order-level. Exact SKU despatch quantities will appear on your order detail when confirmed.</p>`
}`;

  const html = renderTransactionalEmailShell({
    preheader: `Part of order ${order.orderNumber} despatched`,
    bodyHtml,
    cta: { label: "View your order", href: order.portalOrderUrl },
    footer: opts.footer ?? { fromName: "Automotive Brands" },
  });

  return { subject, text, html };
}

/**
 * Final despatch after remaining backorder fulfilled.
 */
export function buildOrderRemainingDespatchedCustomerBodies(
  order: OrderEmailSnapshot,
  footer?: EmailFooterMeta,
): {
  subject: string;
  text: string;
  html: string;
} {
  const subject = `Your remaining Automotive Brands order ${order.orderNumber} has been despatched`;
  const remaining = order.items.filter((i) => (i.backorderQtyAtOrder ?? 0) > 0);
  const lines =
    remaining.length > 0
      ? remaining.map((i) => `${i.backorderQtyAtOrder} × ${i.name}`).join("\n")
      : itemsPlain(order, "customer");

  const text = [
    `Hello ${order.contact.name},`,
    "",
    `The remaining items from your order ${order.orderNumber} have now been despatched.`,
    "",
    lines,
    "",
    "Your order is now fully despatched.",
    "",
    `VIEW YOUR ORDER: ${order.portalOrderUrl}`,
    "",
    "Automotive Brands",
    "https://automotivebrands.co.uk",
  ].join("\n");

  const bodyHtml = `
<p style="margin:0 0 16px;">Hello ${escapeEmailHtml(order.contact.name)},</p>
<p style="margin:0 0 16px;">The remaining items from your order <strong>${escapeEmailHtml(order.orderNumber)}</strong> have now been despatched.</p>
<p style="margin:0 0 16px;white-space:pre-line;">${escapeEmailHtml(lines)}</p>
<p style="margin:0 0 8px;">Your order is now fully despatched.</p>`;

  const html = renderTransactionalEmailShell({
    preheader: `Remaining items on ${order.orderNumber} despatched`,
    bodyHtml,
    cta: { label: "View your order", href: order.portalOrderUrl },
    footer: footer ?? { fromName: "Automotive Brands" },
  });

  return { subject, text, html };
}

/**
 * Customer despatch confirmation.
 * Do not claim tracking / APC unless separately available.
 */
export function buildOrderDespatchedCustomerBodies(
  order: OrderEmailSnapshot,
  footer?: EmailFooterMeta,
): {
  subject: string;
  text: string;
  html: string;
} {
  const ref = order.poNumber ? ` (your reference: ${order.poNumber})` : "";
  const subject = `Your Automotive Brands order ${order.orderNumber} has been despatched`;

  const text = [
    `Hello ${order.contact.name},`,
    "",
    `Your order ${order.orderNumber}${ref} has been despatched.`,
    "",
    `Company: ${order.companyName}`,
    "",
    "Items:",
    itemsPlain(order),
    "",
    `Goods ex VAT: £${formatGbp(order.subtotal)} ${order.currency}`,
    `Delivery: ${formatGbp(order.deliveryTotal) === "0.00" ? "FREE" : `£${formatGbp(order.deliveryTotal)} ${order.currency}`}`,
    `VAT: £${formatGbp(order.vatTotal)} ${order.currency}`,
    `Total (inc VAT): £${formatGbp(order.grandTotal)} ${order.currency}`,
    "",
    "Tracking information, where available, may follow separately.",
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
<p style="margin:0 0 16px;">Your order <strong>${escapeEmailHtml(order.orderNumber)}</strong>${escapeEmailHtml(ref)} has been despatched.</p>
<p style="margin:0 0 8px;"><strong>Company:</strong> ${escapeEmailHtml(order.companyName)}</p>
${orderSummaryTableHtml(order)}
<p style="margin:0 0 8px;">Tracking information, where available, may follow separately.</p>`;

  const html = renderTransactionalEmailShell({
    preheader: `Order ${order.orderNumber} despatched`,
    bodyHtml,
    cta: { label: "View your order", href: order.portalOrderUrl },
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
