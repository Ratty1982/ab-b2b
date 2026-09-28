/**
 * Trade credit control — domain types and pure helpers.
 *
 * Autopart/MAM remains authoritative for ledger exposure (407P100).
 * AB never rejects order creation for credit; it may HOLD / REVIEW_REQUIRED
 * until authorised staff release the order for Autopart export.
 *
 * Order credit requirement = ORDER GROSS TOTAL (goods + delivery + VAT),
 * because Autopart trade-account exposure is a gross charge to the account.
 */

import {
  addMoney,
  moneyToString,
  moneyZero,
  parseMoney,
  subMoney,
  type Money,
} from "@/domain/money";

export type CreditFreshness = "CURRENT" | "STALE" | "NOT_AVAILABLE";

export const ORDER_CREDIT_STATUSES = [
  "NOT_REQUIRED",
  "APPROVED",
  "HOLD",
  "REVIEW_REQUIRED",
] as const;

export type OrderCreditStatus = (typeof ORDER_CREDIT_STATUSES)[number];

export const ORDER_CREDIT_REASONS = [
  "CREDIT_CONTROL_NOT_APPLICABLE",
  "WITHIN_AVAILABLE_CREDIT",
  "EXCEEDS_AVAILABLE_CREDIT",
  "ACCOUNT_ALREADY_OVER_CREDIT_LIMIT",
  "CREDIT_INFORMATION_NOT_AVAILABLE",
  "CREDIT_INFORMATION_STALE",
  "STAFF_RELEASED",
] as const;

export type OrderCreditReason = (typeof ORDER_CREDIT_REASONS)[number];

export type OrderCreditDecision = {
  creditStatus: OrderCreditStatus;
  reason: OrderCreditReason;
  creditApplicable: boolean;
  creditLimit: string | null;
  autopartExposure: string | null;
  importedAvailableCredit: string | null;
  pendingAbExposure: string;
  effectiveAvailableCredit: string | null;
  orderCreditRequirement: string;
  overBy: string | null;
  creditSnapshotUpdatedAt: string | null;
  creditSnapshotStatus: CreditFreshness;
  /** Remaining capacity after approving this order (null when not APPROVED). */
  remainingEffectiveCapacity: string | null;
};

/** Gross total charged to the trade account (goods + delivery + VAT). */
export function orderCreditRequirementFromGrandTotal(grandTotal: unknown): Money {
  return parseMoney(String(grandTotal)) ?? moneyZero();
}

/**
 * Whether trade-credit control applies.
 *
 * Only accounts that consume an Autopart trade credit facility are checked:
 * verified Autopart customer code and/or an imported 407P100 position.
 *
 * Prepaid / cash / card / proforma terms → not applicable even if Autopart-linked.
 * Free-text credit-day terms alone (without Autopart) do NOT enable holds —
 * those companies are not yet on Autopart credit exposure.
 */
export function isCreditControlApplicable(input: {
  paymentTerms: string | null | undefined;
  hasVerifiedAutopartAccount: boolean;
  hasCreditPosition: boolean;
}): boolean {
  const terms = (input.paymentTerms ?? "").trim().toLowerCase();
  if (terms) {
    if (
      /\b(prepay|prepaid|cash|cod|card|proforma|pro-forma|payment\s*in\s*advance)\b/.test(
        terms,
      )
    ) {
      return false;
    }
  }
  return input.hasVerifiedAutopartAccount || input.hasCreditPosition;
}

export function money2(value: Money | null | undefined): string | null {
  if (value == null) return null;
  return moneyToString(value, 2);
}

export function computeOverBy(requirement: Money, effectiveAvailable: Money): Money {
  const over = subMoney(requirement, effectiveAvailable);
  return over.minor > 0n ? over : moneyZero();
}

export function effectiveAvailableFrom(
  importedAvailable: Money,
  pendingAbExposure: Money,
): Money {
  return subMoney(importedAvailable, pendingAbExposure);
}

export function decisionWithinAvailable(input: {
  requirement: Money;
  creditLimit: Money;
  autopartExposure: Money;
  importedAvailable: Money;
  pendingAbExposure: Money;
  effectiveAvailable: Money;
  snapshotUpdatedAt: Date;
  freshness: CreditFreshness;
}): OrderCreditDecision {
  const remaining = subMoney(input.effectiveAvailable, input.requirement);
  return {
    creditStatus: "APPROVED",
    reason: "WITHIN_AVAILABLE_CREDIT",
    creditApplicable: true,
    creditLimit: money2(input.creditLimit),
    autopartExposure: money2(input.autopartExposure),
    importedAvailableCredit: money2(input.importedAvailable),
    pendingAbExposure: money2(input.pendingAbExposure)!,
    effectiveAvailableCredit: money2(input.effectiveAvailable),
    orderCreditRequirement: money2(input.requirement)!,
    overBy: null,
    creditSnapshotUpdatedAt: input.snapshotUpdatedAt.toISOString(),
    creditSnapshotStatus: input.freshness,
    remainingEffectiveCapacity: money2(remaining.minor < 0n ? moneyZero() : remaining),
  };
}

export function decisionExceeds(input: {
  requirement: Money;
  creditLimit: Money;
  autopartExposure: Money;
  importedAvailable: Money;
  pendingAbExposure: Money;
  effectiveAvailable: Money;
  snapshotUpdatedAt: Date;
  freshness: CreditFreshness;
  alreadyOverLimit: boolean;
}): OrderCreditDecision {
  const over = computeOverBy(input.requirement, input.effectiveAvailable);
  return {
    creditStatus: "HOLD",
    reason: input.alreadyOverLimit
      ? "ACCOUNT_ALREADY_OVER_CREDIT_LIMIT"
      : "EXCEEDS_AVAILABLE_CREDIT",
    creditApplicable: true,
    creditLimit: money2(input.creditLimit),
    autopartExposure: money2(input.autopartExposure),
    importedAvailableCredit: money2(input.importedAvailable),
    pendingAbExposure: money2(input.pendingAbExposure)!,
    effectiveAvailableCredit: money2(input.effectiveAvailable),
    orderCreditRequirement: money2(input.requirement)!,
    overBy: money2(over),
    creditSnapshotUpdatedAt: input.snapshotUpdatedAt.toISOString(),
    creditSnapshotStatus: input.freshness,
    remainingEffectiveCapacity: null,
  };
}

export function sumPendingExposure(totals: unknown[]): Money {
  return totals.reduce<Money>((acc, t) => {
    const m = parseMoney(String(t)) ?? moneyZero();
    return addMoney(acc, m);
  }, moneyZero());
}

export function customerCreditBanner(
  status: OrderCreditStatus,
): { title: string; body: string } | null {
  if (status === "HOLD") {
    return {
      title: "Credit approval required",
      body: "This order exceeds the currently available credit on your account. Our team will review it before processing.",
    };
  }
  if (status === "REVIEW_REQUIRED") {
    return {
      title: "Account review required",
      body: "Our team will review your account before the order is processed.",
    };
  }
  return null;
}

export function adminCreditLabel(status: OrderCreditStatus): string {
  switch (status) {
    case "APPROVED":
      return "Credit Approved";
    case "HOLD":
      return "Credit Hold";
    case "REVIEW_REQUIRED":
      return "Credit Review";
    case "NOT_REQUIRED":
      return "Credit N/A";
    default:
      return status;
  }
}
