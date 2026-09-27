/**
 * 504C dry-run predictive plan types and financial comparison helpers.
 * Live apply policy is unchanged — dry-run only previews what live would do.
 */

import { moneyToString, parseMoney } from "@/domain/money";

/** Dry-run / detail result classifications (predictive or factual labels). */
export type Autopart504cPlanResult =
  | "WOULD_CREATE"
  | "WOULD_DESPATCH"
  | "DUPLICATE"
  | "ALREADY_DESPATCHED"
  | "UNKNOWN_AB_ORDER"
  | "STATUS_NOT_ELIGIBLE"
  | "FINANCIAL_MISMATCH"
  | "CREDIT"
  | "INVALID"
  | "NON_AB";

export type Autopart504cFinancialCompare = {
  status: "OK" | "MISMATCH" | "N_A";
  /** AB merchandise goods snapshot (Order.subtotal). */
  abGoods: string | null;
  /** AB delivery snapshot (Order.deliveryTotal) — SDEL in Autopart. */
  abDelivery: string | null;
  /** AB taxable net = goods + delivery (compares to 504C Goods). */
  abNet: string | null;
  abVat: string | null;
  abTotal: string | null;
  c504Goods: string | null;
  c504Vat: string | null;
  c504Value: string | null;
  /** True when within ±1p of expected. */
  netOk: boolean;
  vatOk: boolean;
  totalOk: boolean;
};

export type Autopart504cPlanRow = {
  kind: "INVOICE" | "CREDIT";
  documentNumber: string;
  abOrderNumber: string | null;
  accountCode: string;
  goods: string | null;
  vat: string | null;
  value: string | null;
  result: Autopart504cPlanResult;
  resultLabel: string;
  orderId: string | null;
  orderStatus: string | null;
  orderStatusLabel: string | null;
  wouldCreateInvoice: boolean;
  wouldDespatch: boolean;
  wouldSendEmail: boolean;
  fulfilmentFrom: string | null;
  fulfilmentTo: string | null;
  emailAction: string;
  action: string;
  livePolicyNote: string | null;
  financial: Autopart504cFinancialCompare | null;
};

export type Autopart504cDryRunSummary = {
  abMatches: number;
  wouldCreate: number;
  duplicates: number;
  wouldDespatch: number;
  issues: number;
  credits: number;
  nonAbIgnored: number;
  wouldSendEmail: number;
};

export type Autopart504cRunDiagnostics = {
  mode: "DRY_RUN_PREVIEW" | "LIVE";
  headerFound: boolean;
  errors: string[];
  unmatchedAbRefs: string[];
  summary: Autopart504cDryRunSummary;
  plan: Autopart504cPlanRow[];
  reservationNote?: string;
};

export const AUTOPART_504C_PLAN_RESULT_LABEL: Record<Autopart504cPlanResult, string> = {
  WOULD_CREATE: "Would create invoice",
  WOULD_DESPATCH: "Would create invoice and despatch",
  DUPLICATE: "Duplicate — no action",
  ALREADY_DESPATCHED: "Would create invoice (already despatched)",
  UNKNOWN_AB_ORDER: "Unknown AB order",
  STATUS_NOT_ELIGIBLE: "Status not eligible",
  FINANCIAL_MISMATCH: "Financial mismatch",
  CREDIT: "Credit — no despatch",
  INVALID: "Invalid",
  NON_AB: "Non-AB (ignored)",
};

export function money2OrNull(raw: string | null | undefined): string | null {
  if (raw == null || String(raw).trim() === "") return null;
  const m = parseMoney(String(raw));
  return m ? moneyToString(m, 2) : null;
}

export function moneyToCents(raw: string | null | undefined): number | null {
  const s = money2OrNull(raw);
  if (s == null) return null;
  return Math.round(Number(s) * 100);
}

/** Legitimate Autopart penny rounding — ±1p. */
export function withinPennyTolerance(a: string | null, b: string | null): boolean {
  const ca = moneyToCents(a);
  const cb = moneyToCents(b);
  if (ca == null || cb == null) return false;
  return Math.abs(ca - cb) <= 1;
}

export function sumMoney2(a: string | null, b: string | null): string | null {
  const ca = moneyToCents(a);
  const cb = moneyToCents(b);
  if (ca == null && cb == null) return null;
  const total = (ca ?? 0) + (cb ?? 0);
  const sign = total < 0 ? "-" : "";
  const abs = Math.abs(total);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

/**
 * Compare AB order snapshots to 504C amounts.
 * 504C Goods includes SDEL delivery, so AB net = merchandise goods + delivery.
 */
export function compareAbOrderTo504cFinancials(input: {
  abGoods: string | null;
  abDelivery: string | null;
  abVat: string | null;
  abTotal: string | null;
  c504Goods: string | null;
  c504Vat: string | null;
  c504Value: string | null;
}): Autopart504cFinancialCompare {
  const abGoods = money2OrNull(input.abGoods);
  const abDelivery = money2OrNull(input.abDelivery);
  const abNet = sumMoney2(abGoods, abDelivery);
  const abVat = money2OrNull(input.abVat);
  const abTotal = money2OrNull(input.abTotal);
  const c504Goods = money2OrNull(input.c504Goods);
  const c504Vat = money2OrNull(input.c504Vat);
  const c504Value = money2OrNull(input.c504Value);

  const netOk = withinPennyTolerance(abNet, c504Goods);
  const vatOk = withinPennyTolerance(abVat, c504Vat);
  const totalOk = withinPennyTolerance(abTotal, c504Value);

  return {
    status: netOk && vatOk && totalOk ? "OK" : "MISMATCH",
    abGoods,
    abDelivery,
    abNet,
    abVat,
    abTotal,
    c504Goods,
    c504Vat,
    c504Value,
    netOk,
    vatOk,
    totalOk,
  };
}

export function orderStatusLabel(status: string | null | undefined): string | null {
  if (!status) return null;
  if (status === "SUBMITTED") return "Received";
  if (status === "CONFIRMED" || status === "PICKING") return "Processing";
  if (status === "DISPATCHED" || status === "DELIVERED") return "Despatched";
  if (status === "CANCELLED") return "Cancelled";
  return status;
}
