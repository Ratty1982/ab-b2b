/**
 * Safe fixture objects for Super Admin email template previews.
 * Never written to Order / Quote / Application / CRM tables.
 */

import { getServerEnv } from "@/server/env";
import type { EmailAccountManager } from "@/server/email/layout";
import type { OrderEmailSnapshot } from "@/server/orders/email";
import type { TradeApplicationEmailSnapshot } from "@/server/email/application-templates";
import type {
  QuoteDeclinedEmailSnapshot,
  QuoteSentEmailSnapshot,
} from "@/server/quotes/quote-email";

function appBaseUrl(): string {
  return getServerEnv().APP_URL.replace(/\/$/, "");
}

export const PREVIEW_CUSTOMER = {
  firstName: "Wayne",
  name: "Wayne Radford",
  email: "wayne.preview@example.invalid",
} as const;

export const PREVIEW_COMPANY = {
  name: "Bromsgrove Motor Factors Ltd",
} as const;

export const PREVIEW_ACCOUNT_MANAGER: EmailAccountManager = {
  name: "Luke Andrews",
  jobTitle: "Sales Executive",
  email: "luke.preview@example.invalid",
  phone: "0121 496 0000",
  mobile: "07700 900123",
};

export const PREVIEW_ORDER_NUMBER = "AB-001234";
export const PREVIEW_PO = "BM-45821";
export const PREVIEW_QUOTE_NUMBER = "Q-001234";
export const PREVIEW_APPLICATION_REF = "APP-001234";

const PREVIEW_FOOTER = {
  fromName: "Automotive Brands",
  fromEmail: "b2b@automotivebrands.co.uk",
  replyToEmail: "orders@automotivebrands.co.uk",
};

export function previewFooter() {
  return { ...PREVIEW_FOOTER };
}

function previewOrderItems(withBackorder: boolean): OrderEmailSnapshot["items"] {
  return [
    {
      sku: "PM-APC-500",
      name: "Power Maxed All Purpose Cleaner 500ml",
      qty: 12,
      customerUnitPrice: "4.50",
      lineTotal: "54.00",
      orderingMode: "CASE",
      availableQtyAtOrder: 12,
      backorderQtyAtOrder: 0,
    },
    {
      sku: "SS-HGF-1",
      name: "Steel Seal Head Gasket Fix",
      qty: 6,
      customerUnitPrice: "8.75",
      lineTotal: "52.50",
      orderingMode: "UNIT",
      availableQtyAtOrder: 6,
      backorderQtyAtOrder: 0,
    },
    {
      sku: "PM-GC-5L",
      name: "Power Maxed Glass Cleaner 5L",
      qty: 12,
      customerUnitPrice: "7.50",
      lineTotal: "90.00",
      orderingMode: "CASE",
      availableQtyAtOrder: withBackorder ? 0 : 12,
      backorderQtyAtOrder: withBackorder ? 12 : 0,
    },
  ];
}

export function previewOrderSnapshot(opts?: {
  withBackorder?: boolean;
  withAccountManager?: boolean;
}): OrderEmailSnapshot {
  const withBackorder = opts?.withBackorder ?? false;
  const withAm = opts?.withAccountManager !== false;
  const items = previewOrderItems(withBackorder);
  const subtotal = "196.50";
  return {
    orderId: "preview-order-ab-001234",
    orderNumber: PREVIEW_ORDER_NUMBER,
    companyName: PREVIEW_COMPANY.name,
    status: "SUBMITTED",
    poNumber: PREVIEW_PO,
    currency: "GBP",
    subtotal,
    vatTotal: "39.30",
    deliveryTotal: "0.00",
    grandTotal: "235.80",
    placedAt: new Date("2026-10-03T09:30:00.000Z"),
    paymentTerms: "30 Days Net",
    deliveryInstructions: null,
    deliveryAddress: {
      line1: "14 Birmingham Road",
      line2: null,
      town: "Bromsgrove",
      county: "Worcestershire",
      postcode: "B61 0DD",
      country: "GB",
    },
    contact: {
      name: PREVIEW_CUSTOMER.name,
      email: PREVIEW_CUSTOMER.email,
      phone: "01527 000000",
    },
    items,
    autopartAccountLinked: true,
    autopartCustomerCodeSnapshot: "AP-PREVIEW-0001",
    salesRepNameSnapshot: withAm ? PREVIEW_ACCOUNT_MANAGER.name : null,
    salesRepCodeSnapshot: withAm ? "LA01" : null,
    sourceQuoteNumber: null,
    portalOrderUrl: `${appBaseUrl()}/portal/orders/preview-order-ab-001234`,
    adminOrderUrl: `${appBaseUrl()}/admin/orders/preview-order-ab-001234`,
  };
}

export function previewApplicationSnapshot(opts?: {
  customerMessage?: string | null;
  activationPath?: string | null;
}): TradeApplicationEmailSnapshot {
  return {
    applicationId: "preview-app-001234",
    reference: PREVIEW_APPLICATION_REF,
    companyName: PREVIEW_COMPANY.name,
    contactName: PREVIEW_CUSTOMER.name,
    contactEmail: PREVIEW_CUSTOMER.email,
    customerMessage: opts?.customerMessage ?? null,
    activationPath: opts?.activationPath ?? `${appBaseUrl()}/activate?token=preview-token-not-live`,
    adminApplicationUrl: `${appBaseUrl()}/admin/applications/preview-app-001234`,
  };
}

export function previewQuoteSentSnapshot(): QuoteSentEmailSnapshot {
  return {
    quoteNumber: PREVIEW_QUOTE_NUMBER,
    companyName: PREVIEW_COMPANY.name,
    currency: "GBP",
    grandTotal: "282.96",
    expiresAt: new Date("2026-10-17T23:00:00.000Z"),
    contactName: PREVIEW_CUSTOMER.name,
    portalUrl: `${appBaseUrl()}/portal/quotes/preview-quote-q-001234`,
    preparedBy: { ...PREVIEW_ACCOUNT_MANAGER },
  };
}

export function previewQuoteDeclinedSnapshot(): QuoteDeclinedEmailSnapshot {
  return {
    quoteNumber: PREVIEW_QUOTE_NUMBER,
    companyName: PREVIEW_COMPANY.name,
    reason: "Prices are higher than our current supplier.",
    adminUrl: `${appBaseUrl()}/sales/quotes/preview-quote-q-001234`,
  };
}
