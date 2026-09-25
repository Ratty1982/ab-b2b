/**
 * Automotive Brands → Autopart order CSV contract.
 *
 * Studied from AlphaOps (Ratty1982/alphaops default branch):
 * - backend/src/orders/order-export-csv.util.ts
 * - backend/src/orders/orders.service.ts (exportCsv, buildOrderLineApportionment,
 *   resolveLineFinancials, csvEscape, phone Excel-safety)
 *
 * Independent AB implementation — no AlphaOps runtime dependency.
 * CSV export ONLY. No APC, Autopart API, EDI, or stock reservation side effects.
 */

import { BUSINESS_LOCALE, BUSINESS_TIME_ZONE } from "@/lib/datetime";
import { moneyToString, parseMoney, type Money } from "@/domain/money";

/** Stable Source column for AB B2B trade orders. */
export const AUTOPART_EXPORT_SOURCE = "Automotive Brands B2B";

/**
 * Autopart-compatible headers — same names/order as AlphaOps ORDER_EXPORT_CSV_HEADERS
 * (confirmed on alphaops origin/main).
 */
export const AUTOPART_ORDER_CSV_HEADERS = [
  "External Reference",
  "Order Date",
  "Shipping Name",
  "Shipping Address 1",
  "Shipping Address 2",
  "Shipping City",
  "Shipping County",
  "Shipping Postcode",
  "Shipping Country",
  "Email",
  "Phone",
  "Supplier SKU",
  "Quantity",
  "Sub Total",
  "Shipping",
  "VAT",
  "Total",
  "Price",
  "Source",
  "Payment Amount 1",
  "MAM Account",
] as const;

export type AutopartOrderCsvHeader = (typeof AUTOPART_ORDER_CSV_HEADERS)[number];

export type AutopartExportDeliverySnapshot = {
  line1?: string | null;
  line2?: string | null;
  town?: string | null;
  city?: string | null;
  county?: string | null;
  postcode?: string | null;
  country?: string | null;
  contactName?: string | null;
  contactPhone?: string | null;
  label?: string | null;
};

export type AutopartExportContactSnapshot = {
  name?: string | null;
  email?: string | null;
  phone?: string | null;
};

export type AutopartExportOrderItem = {
  sku: string;
  qty: number;
  /** Goods line net ex VAT (2dp). */
  lineTotal: string;
  /** Customer unit sell price ex VAT (2dp). */
  customerUnitPrice: string;
};

export type AutopartExportOrderInput = {
  orderNumber: string;
  /** Prefer placedAt; fall back to createdAt. */
  orderDate: Date;
  companyName: string;
  deliveryAddress: AutopartExportDeliverySnapshot | null;
  contact: AutopartExportContactSnapshot | null;
  /** Verified Autopart customer code snapshot — required for eligibility. */
  autopartCustomerCodeSnapshot: string;
  subtotal: string;
  deliveryTotal: string;
  vatTotal: string;
  grandTotal: string;
  items: AutopartExportOrderItem[];
};

export type AutopartCsvLineFinancials = {
  subTotal: string;
  shipping: string;
  vat: string;
  total: string;
  price: string;
  paymentAmount1: string;
};

export type AutopartCsvRow = Record<AutopartOrderCsvHeader, string>;

/** Always-quote CSV escape (AlphaOps contract). */
export function csvEscapeAutopartField(value: string): string {
  const escaped = String(value ?? "").replaceAll('"', '""');
  return `"${escaped}"`;
}

/**
 * Excel often coerces long digit strings. Leading tab inside a quoted field
 * forces text (AlphaOps csvEscapeExcelSafePhone).
 */
export function csvEscapeExcelSafePhone(value: string): string {
  const v = String(value ?? "").trim();
  if (!v) return csvEscapeAutopartField("");
  const digits = v.replace(/\D/g, "");
  if (digits.length >= 9) {
    return csvEscapeAutopartField(`\t${v}`);
  }
  return csvEscapeAutopartField(v);
}

/** Guard against spreadsheet formula interpretation for SKU / refs when needed. */
export function csvEscapeFormulaSafe(value: string): string {
  const v = String(value ?? "");
  if (/^[=+\-@]/.test(v)) {
    return csvEscapeAutopartField(`\t${v}`);
  }
  return csvEscapeAutopartField(v);
}

export function formatAutopartExportOrderDate(d: Date): string {
  const parts = new Intl.DateTimeFormat(BUSINESS_LOCALE, {
    timeZone: BUSINESS_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(d);
  const year = parts.find((p) => p.type === "year")?.value ?? "1970";
  const month = parts.find((p) => p.type === "month")?.value ?? "01";
  const day = parts.find((p) => p.type === "day")?.value ?? "01";
  return `${year}-${month}-${day}`;
}

export function formatAutopartExportMoney(value: string | Money): string {
  if (typeof value === "string") {
    const m = parseMoney(value);
    return m ? moneyToString(m, 2) : "0.00";
  }
  return moneyToString(value, 2);
}

function moneyToCents(value: string): number {
  const m = parseMoney(value);
  if (!m) return 0;
  // Money is 4dp scaled; convert to whole pence (2dp) with half-up via string.
  const as2 = moneyToString(m, 2);
  const n = Number(as2);
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

function centsToMoney(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  const whole = Math.floor(abs / 100);
  const frac = String(abs % 100).padStart(2, "0");
  return `${sign}${whole}.${frac}`;
}

/**
 * Largest-remainder apportionment so rounded row sums match the order-level
 * amount exactly (AlphaOps apportionCentsByWeights).
 */
export function apportionCentsByWeights(totalCents: number, weights: number[]): number[] {
  if (weights.length === 0) return [];
  const sum = weights.reduce((a, b) => a + b, 0);
  if (sum <= 0 || totalCents === 0) return weights.map(() => 0);
  const raw = weights.map((w) => (totalCents * w) / sum);
  const floor = raw.map((x) => Math.floor(x));
  let rem = totalCents - floor.reduce((a, b) => a + b, 0);
  const frac = raw.map((x, i) => ({ i, f: x - floor[i]! })).sort((a, b) => b.f - a.f);
  for (let i = 0; i < frac.length && rem > 0; i++) {
    floor[frac[i]!.i]! += 1;
    rem -= 1;
  }
  return floor;
}

export type OrderLineApportionment = {
  shippingByIndex: string[];
  vatByIndex: string[];
  totalByIndex: string[];
  paymentAmountByIndex: string[];
};

/**
 * Apportion order-level Shipping / VAT / Total / Payment Amount 1 across lines
 * by quantity weights (AlphaOps buildOrderLineApportionment).
 */
export function buildOrderLineApportionment(
  items: Array<{ qty: number }>,
  orderAgg: {
    orderShipping: string;
    orderTax: string;
    orderTotal: string;
    paymentAmount1: string;
  },
): OrderLineApportionment {
  const weights = items.map((it) => Math.max(0, Math.floor(it.qty) || 0));
  const fallbackWeights = weights.some((w) => w > 0) ? weights : items.map(() => 1);

  const shipParts = apportionCentsByWeights(moneyToCents(orderAgg.orderShipping), fallbackWeights);
  const taxParts = apportionCentsByWeights(moneyToCents(orderAgg.orderTax), fallbackWeights);
  const totalParts = apportionCentsByWeights(moneyToCents(orderAgg.orderTotal), fallbackWeights);
  const payParts = apportionCentsByWeights(moneyToCents(orderAgg.paymentAmount1), fallbackWeights);

  return {
    shippingByIndex: shipParts.map(centsToMoney),
    vatByIndex: taxParts.map(centsToMoney),
    totalByIndex: totalParts.map(centsToMoney),
    paymentAmountByIndex: payParts.map(centsToMoney),
  };
}

export function resolveLineFinancials(
  item: AutopartExportOrderItem,
  index: number,
  apportioned: OrderLineApportionment,
): AutopartCsvLineFinancials {
  return {
    subTotal: formatAutopartExportMoney(item.lineTotal),
    shipping: apportioned.shippingByIndex[index] ?? "0.00",
    vat: apportioned.vatByIndex[index] ?? "0.00",
    total: apportioned.totalByIndex[index] ?? formatAutopartExportMoney(item.lineTotal),
    /** AB mapping: snapshotted customer unit sell price (not AlphaOps total/qty overwrite). */
    price: formatAutopartExportMoney(item.customerUnitPrice),
    paymentAmount1: apportioned.paymentAmountByIndex[index] ?? "0.00",
  };
}

export function resolveShippingName(
  delivery: AutopartExportDeliverySnapshot | null,
  contact: AutopartExportContactSnapshot | null,
  companyName: string,
): string {
  const fromAddr = delivery?.contactName?.trim();
  if (fromAddr) return fromAddr;
  const fromContact = contact?.name?.trim();
  if (fromContact) return fromContact;
  return companyName.trim();
}

export function buildAutopartCsvRowsForOrder(order: AutopartExportOrderInput): AutopartCsvRow[] {
  const delivery = order.deliveryAddress;
  const contact = order.contact;
  const shippingName = resolveShippingName(delivery, contact, order.companyName);
  const email = contact?.email?.trim() ?? "";
  const phone =
    contact?.phone?.trim() ||
    delivery?.contactPhone?.trim() ||
    "";
  const orderDate = formatAutopartExportOrderDate(order.orderDate);
  const mam = order.autopartCustomerCodeSnapshot.trim();
  const source = AUTOPART_EXPORT_SOURCE;

  const orderShipping = formatAutopartExportMoney(order.deliveryTotal);
  const orderTax = formatAutopartExportMoney(order.vatTotal);
  const orderTotal = formatAutopartExportMoney(order.grandTotal);
  const paymentAmount1 = orderTotal;

  const common = {
    "External Reference": order.orderNumber,
    "Order Date": orderDate,
    "Shipping Name": shippingName,
    "Shipping Address 1": delivery?.line1?.trim() ?? "",
    "Shipping Address 2": delivery?.line2?.trim() ?? "",
    "Shipping City": (delivery?.town ?? delivery?.city)?.trim() ?? "",
    "Shipping County": delivery?.county?.trim() ?? "",
    "Shipping Postcode": delivery?.postcode?.trim() ?? "",
    "Shipping Country": delivery?.country?.trim() || "GB",
    Email: email,
    Phone: phone,
    Source: source,
    "MAM Account": mam,
  } as const;

  if (order.items.length === 0) {
    return [
      {
        ...common,
        "Supplier SKU": "",
        Quantity: "0",
        "Sub Total": "0.00",
        Shipping: orderShipping,
        VAT: orderTax,
        Total: orderTotal,
        Price: "0.00",
        "Payment Amount 1": paymentAmount1,
      },
    ];
  }

  const apportioned = buildOrderLineApportionment(order.items, {
    orderShipping,
    orderTax,
    orderTotal,
    paymentAmount1,
  });

  return order.items.map((item, index) => {
    const fin = resolveLineFinancials(item, index, apportioned);
    return {
      ...common,
      "Supplier SKU": item.sku.trim(),
      Quantity: String(item.qty),
      "Sub Total": fin.subTotal,
      Shipping: fin.shipping,
      VAT: fin.vat,
      Total: fin.total,
      Price: fin.price,
      "Payment Amount 1": fin.paymentAmount1,
    };
  });
}

export function serializeAutopartOrderCsv(rows: AutopartCsvRow[]): string {
  const headerLine = AUTOPART_ORDER_CSV_HEADERS.map((h) => csvEscapeAutopartField(h)).join(",");
  const body = rows.map((row) =>
    AUTOPART_ORDER_CSV_HEADERS.map((h) => {
      if (h === "Phone") return csvEscapeExcelSafePhone(row[h]);
      if (h === "Supplier SKU" || h === "External Reference" || h === "MAM Account") {
        return csvEscapeFormulaSafe(row[h]);
      }
      if (h === "Quantity") return csvEscapeAutopartField(row[h]);
      return csvEscapeAutopartField(row[h]);
    }).join(","),
  );
  return [headerLine, ...body].join("\n");
}

export function buildAutopartOrdersCsv(orders: AutopartExportOrderInput[]): string {
  const rows = orders.flatMap((o) => buildAutopartCsvRowsForOrder(o));
  return serializeAutopartOrderCsv(rows);
}

/** Sum money strings as cents — for reconciliation tests. */
export function sumMoneyStrings(values: string[]): string {
  const cents = values.reduce((acc, v) => acc + moneyToCents(v), 0);
  return centsToMoney(cents);
}

export function buildAutopartExportFilename(input: {
  mode: "single" | "batch";
  orderNumber?: string;
  batchReference?: string;
  at?: Date;
}): string {
  const at = input.at ?? new Date();
  const date = formatAutopartExportOrderDate(at);
  if (input.mode === "single" && input.orderNumber) {
    const safe = input.orderNumber.replace(/[^\w.-]+/g, "-");
    return `autopart-${safe}.csv`;
  }
  const ref = input.batchReference?.replace(/[^\w.-]+/g, "-");
  if (ref) return `automotive-brands-autopart-orders-${ref}.csv`;
  return `automotive-brands-autopart-orders-${date}.csv`;
}
