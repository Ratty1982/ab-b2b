/**
 * Order received / despatch email builders (customer + internal).
 * Bodies use ORDER SNAPSHOT prices only — never live catalogue prices.
 * Customer copy must not claim Autopart stock reservation or despatch.
 */

import { moneyToString, parseMoney } from "@/domain/money";
import type { EmailMessage } from "@/infra/email";
import { formatDate } from "@/lib/datetime";
import { renderTransactionalEmailShell } from "@/server/email/shell";
import {
  emailAccountManagerCard,
  emailHero,
  emailInfoPanel,
  emailParagraph,
  emailProductTable,
  emailProgressSteps,
  emailQtyList,
  emailReferencePanel,
  emailStatusCallout,
  emailTotalsBlock,
  firstNameFrom,
  type EmailAccountManager,
  type EmailOrderLine,
} from "@/server/email/layout";

export type OrderEmailLine = {
  sku: string;
  name: string;
  qty: number;
  customerUnitPrice: string;
  lineTotal: string;
  orderingMode: string | null;
  availableQtyAtOrder: number | null;
  backorderQtyAtOrder: number;
  /** Authoritative line despatch qty when known (504/TRM). */
  despatchedQty?: number;
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

function formatDeliveryLines(order: OrderEmailSnapshot): string[] {
  const a = order.deliveryAddress;
  if (!a) return ["as provided"];
  return [a.line1, a.line2, a.town, a.county, a.postcode].filter((v): v is string => Boolean(v));
}

function formatDelivery(order: OrderEmailSnapshot): string {
  return formatDeliveryLines(order).join(", ");
}

function snapshotAccountManager(order: OrderEmailSnapshot): EmailAccountManager | null {
  const name = order.salesRepNameSnapshot?.trim();
  if (!name) return null;
  return { name };
}

function toProductLines(order: OrderEmailSnapshot): EmailOrderLine[] {
  return order.items.map((item) => ({
    sku: item.sku,
    name: item.name,
    qty: item.qty,
    unitPrice: formatGbp(item.customerUnitPrice),
    lineTotal: formatGbp(item.lineTotal),
    availableQty: item.availableQtyAtOrder,
    backorderQty: item.backorderQtyAtOrder,
  }));
}

function totalsFrom(order: OrderEmailSnapshot) {
  return {
    goods: formatGbp(order.subtotal),
    delivery: formatGbp(order.deliveryTotal),
    vat: formatGbp(order.vatTotal),
    orderTotal: formatGbp(order.grandTotal),
    currency: order.currency,
  };
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
      const skuLine = `  SKU: ${item.sku} · Qty: ${item.qty} · £${formatGbp(item.customerUnitPrice)} · Line total £${formatGbp(item.lineTotal)}`;
      if (bo <= 0) {
        return `- ${item.name}\n${skuLine}`;
      }
      return `- ${item.name}\n${skuLine}\n  ${avail} available · ${bo} on backorder`;
    })
    .join("\n");
}

function hasBackorder(order: OrderEmailSnapshot): boolean {
  return order.items.some((i) => (i.backorderQtyAtOrder ?? 0) > 0);
}

function placedLabel(order: OrderEmailSnapshot): string {
  return formatDate(order.placedAt) ?? "—";
}

export function buildOrderReceivedCustomerBodies(
  order: OrderEmailSnapshot,
  footer?: EmailFooterMeta,
): {
  subject: string;
  text: string;
  html: string;
} {
  const first = firstNameFrom(order.contact.name);
  const delivery = formatDelivery(order);
  const subject = `We've received your Automotive Brands order ${order.orderNumber}`;
  const am = snapshotAccountManager(order);
  const quoteLine = order.sourceQuoteNumber
    ? `Created from quotation ${order.sourceQuoteNumber}`
    : null;

  const text = [
    "ORDER RECEIVED",
    "",
    `Thanks ${first} — we've got your order.`,
    "",
    `Order: ${order.orderNumber}`,
    `Placed: ${placedLabel(order)}`,
    ...(order.poNumber ? [`Your reference: ${order.poNumber}`] : []),
    ...(quoteLine ? [quoteLine] : []),
    "",
    "STATUS",
    "✓ Order received",
    "  Processing",
    "  Despatched",
    "",
    "ORDER ITEMS",
    itemsPlain(order, "customer"),
    "",
    `Goods ex VAT: £${formatGbp(order.subtotal)} ${order.currency}`,
    `Delivery: ${formatGbp(order.deliveryTotal) === "0.00" ? "FREE" : `£${formatGbp(order.deliveryTotal)} ${order.currency}`}`,
    `VAT: £${formatGbp(order.vatTotal)} ${order.currency}`,
    `ORDER TOTAL: £${formatGbp(order.grandTotal)} ${order.currency}`,
    "",
    "DELIVERY TO",
    delivery,
    "",
    ...(hasBackorder(order)
      ? [
          "SOME ITEMS ARE ON BACKORDER",
          "You don't need to place another order for these items. They will remain on your order and we'll update you when they are despatched.",
          "",
        ]
      : []),
    "We're now preparing your order. We'll email you again when it has been despatched.",
    "",
    `VIEW YOUR ORDER: ${order.portalOrderUrl}`,
    ...(am ? ["", "YOUR ACCOUNT MANAGER", am.name] : []),
    "",
    "Automotive Brands",
    "https://automotivebrands.co.uk",
  ].join("\n");

  const refRows = [
    { label: "Order", value: order.orderNumber },
    { label: "Placed", value: placedLabel(order) },
    ...(order.poNumber ? [{ label: "Your reference", value: order.poNumber }] : []),
    ...(quoteLine ? [{ label: "Quotation", value: order.sourceQuoteNumber! }] : []),
  ];

  const bodyHtml = `
${emailHero("Order received", `Thanks ${first} — we've got your order`)}
${emailReferencePanel(refRows)}
${emailProgressSteps("Order received", ["Order received", "Processing", "Despatched"])}
${emailProductTable(toProductLines(order))}
${emailTotalsBlock(totalsFrom(order))}
${emailInfoPanel("Delivery to", formatDeliveryLines(order))}
${
  hasBackorder(order)
    ? emailStatusCallout(
        "Some items are on backorder",
        "You don't need to place another order for these items. They will remain on your order and we'll update you when they are despatched.",
        "warning",
      )
    : ""
}
${emailParagraph("We're now preparing your order. We'll email you again when it has been despatched.")}
${emailAccountManagerCard(am)}`;

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
    "NEW B2B ORDER",
    "",
    order.orderNumber,
    order.companyName,
    `£${formatGbp(order.grandTotal)}`,
    `PO: ${order.poNumber ?? "—"}`,
    `Sales Rep: ${salesRep}`,
    ...(quoteOrigin ? [quoteOrigin] : []),
    `Contact: ${order.contact.name} <${order.contact.email}>`,
    `Payment terms: ${order.paymentTerms ?? "—"}`,
    `Autopart linked: ${order.autopartAccountLinked ? "Yes" : "No"}`,
    `Autopart code snapshot: ${codeSnap}`,
    "",
    "Items:",
    itemsPlain(order, "internal"),
    "",
    `Goods ex VAT: £${formatGbp(order.subtotal)}`,
    `Delivery: ${formatGbp(order.deliveryTotal) === "0.00" ? "FREE" : `£${formatGbp(order.deliveryTotal)}`}`,
    `VAT: £${formatGbp(order.vatTotal)}`,
    `ORDER TOTAL: £${formatGbp(order.grandTotal)} ${order.currency}`,
    "",
    "Status: SUBMITTED (received / pending Autopart handoff — not despatched).",
    `REVIEW ORDER: ${order.adminOrderUrl}`,
    "",
    "Automotive Brands",
  ].join("\n");

  const bodyHtml = `
${emailHero("New B2B order", order.orderNumber)}
${emailReferencePanel([
  { label: "Company", value: order.companyName },
  { label: "Total", value: `£${formatGbp(order.grandTotal)}` },
  { label: "PO", value: order.poNumber ?? "—" },
  { label: "Sales rep", value: salesRep },
  { label: "Contact", value: `${order.contact.name} <${order.contact.email}>` },
  { label: "Payment terms", value: order.paymentTerms ?? "—" },
  { label: "Autopart linked", value: order.autopartAccountLinked ? "Yes" : "No" },
  { label: "Autopart code", value: codeSnap },
  ...(quoteOrigin ? [{ label: "Quotation", value: order.sourceQuoteNumber! }] : []),
])}
${emailProductTable(toProductLines(order))}
${emailTotalsBlock(totalsFrom(order))}
${emailParagraph("Status: SUBMITTED (received / pending Autopart handoff — not despatched).", true)}`;

  const html = renderTransactionalEmailShell({
    variant: "internal",
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
  const first = firstNameFrom(order.contact.name);
  const subject = `Part of your Automotive Brands order ${order.orderNumber} has been despatched`;
  const backorderItems = order.items.filter((i) => (i.backorderQtyAtOrder ?? 0) > 0);

  const despatchedLines = opts.lineQuantitiesKnown
    ? order.items
        .map((i) => {
          const despatched =
            i.despatchedQty != null
              ? Math.max(0, Math.trunc(i.despatchedQty))
              : Math.max(0, i.qty - (i.backorderQtyAtOrder ?? 0));
          return despatched > 0 ? `${despatched} × ${i.name}` : null;
        })
        .filter((line): line is string => Boolean(line))
    : [];

  const stillLines = opts.lineQuantitiesKnown
    ? order.items
        .map((i) => {
          const despatched =
            i.despatchedQty != null
              ? Math.max(0, Math.trunc(i.despatchedQty))
              : Math.max(0, i.qty - (i.backorderQtyAtOrder ?? 0));
          const remaining = Math.max(0, i.qty - despatched);
          return remaining > 0 ? `${remaining} × ${i.name}` : null;
        })
        .filter((line): line is string => Boolean(line))
    : backorderItems.map((i) => `${i.backorderQtyAtOrder} × ${i.name}`);

  const unknownNote =
    "Part of this order has been despatched. Exact item quantities will appear on your order detail when confirmed.";

  const text = [
    "PART OF YOUR ORDER IS ON ITS WAY",
    "",
    `Hello ${first},`,
    "",
    `Order ${order.orderNumber}`,
    "",
    "DESPATCHED",
    opts.lineQuantitiesKnown ? despatchedLines.join("\n") || "—" : unknownNote,
    "",
    ...(stillLines.length ? ["STILL TO COME", stillLines.join("\n"), ""] : []),
    "You don't need to reorder the remaining items. We'll keep them on your order and let you know when they are despatched.",
    "",
    `VIEW YOUR ORDER: ${order.portalOrderUrl}`,
    "",
    "Automotive Brands",
    "https://automotivebrands.co.uk",
  ].join("\n");

  const bodyHtml = `
${emailHero("Part of your order is on its way", `Order ${order.orderNumber}`)}
${emailParagraph(`Hello ${first},`)}
${
  opts.lineQuantitiesKnown
    ? emailQtyList("Despatched", despatchedLines.length ? despatchedLines : ["—"])
    : emailStatusCallout("Despatched", unknownNote, "neutral")
}
${stillLines.length ? emailQtyList("Still to come", stillLines) : ""}
${emailParagraph(
  "You don't need to reorder the remaining items. We'll keep them on your order and let you know when they are despatched.",
  true,
)}`;

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
  const first = firstNameFrom(order.contact.name);
  const subject = `Your remaining Automotive Brands order ${order.orderNumber} has been despatched`;
  const remaining = order.items.filter((i) => (i.backorderQtyAtOrder ?? 0) > 0);
  const remainingLines =
    remaining.length > 0
      ? remaining.map((i) => `${i.backorderQtyAtOrder} × ${i.name}`)
      : order.items.map((i) => `${i.qty} × ${i.name}`);

  const text = [
    "THE REST OF YOUR ORDER IS ON ITS WAY",
    "",
    `Hello ${first},`,
    "",
    `Order ${order.orderNumber}`,
    "",
    remainingLines.join("\n"),
    "",
    "Your order is now fully despatched.",
    "",
    `VIEW YOUR ORDER: ${order.portalOrderUrl}`,
    "",
    "Automotive Brands",
    "https://automotivebrands.co.uk",
  ].join("\n");

  const bodyHtml = `
${emailHero("The rest of your order is on its way", `Order ${order.orderNumber}`)}
${emailParagraph(`Hello ${first},`)}
${emailQtyList("Despatched", remainingLines)}
${emailStatusCallout("Your order is now fully despatched.", "We'll email you if anything further is needed.", "success")}`;

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
  const first = firstNameFrom(order.contact.name);
  const subject = `Your Automotive Brands order ${order.orderNumber} has been despatched`;

  const text = [
    "YOUR ORDER IS ON ITS WAY",
    "",
    `Hello ${first},`,
    "",
    `Order ${order.orderNumber}${order.poNumber ? `\nYour reference: ${order.poNumber}` : ""}`,
    "",
    "ORDER ITEMS",
    itemsPlain(order),
    "",
    `Goods ex VAT: £${formatGbp(order.subtotal)} ${order.currency}`,
    `Delivery: ${formatGbp(order.deliveryTotal) === "0.00" ? "FREE" : `£${formatGbp(order.deliveryTotal)} ${order.currency}`}`,
    `VAT: £${formatGbp(order.vatTotal)} ${order.currency}`,
    `ORDER TOTAL: £${formatGbp(order.grandTotal)} ${order.currency}`,
    "",
    "Tracking information, where available, may follow separately.",
    "",
    `VIEW YOUR ORDER: ${order.portalOrderUrl}`,
    "",
    "Automotive Brands",
    "https://automotivebrands.co.uk",
  ].join("\n");

  const bodyHtml = `
${emailHero("Your order is on its way", `Order ${order.orderNumber}`)}
${emailParagraph(`Hello ${first},`)}
${emailReferencePanel([
  { label: "Order", value: order.orderNumber },
  ...(order.poNumber ? [{ label: "Your reference", value: order.poNumber }] : []),
  { label: "Company", value: order.companyName },
])}
${emailProductTable(toProductLines(order))}
${emailTotalsBlock(totalsFrom(order))}
${emailParagraph("Tracking information, where available, may follow separately.", true)}`;

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
    "We're now preparing your order. We'll email you again when it has been despatched.",
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
