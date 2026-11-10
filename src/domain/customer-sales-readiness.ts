/**
 * READY_FOR_SALES is an assessment, not a second Company.status.
 * ACTIVE means the account may trade once setup is complete.
 * Staff order entry must call this assessment server-side.
 */

export const CUSTOMER_SALES_READY_ENFORCE_FROM = "2026-11-10T00:00:00.000Z";

export type SalesReadinessRequirementId =
  | "active_status"
  | "autopart_verified"
  | "history_cutover"
  | "primary_contact"
  | "billing_address"
  | "delivery_address"
  | "payment_terms"
  | "credit_limit_reviewed";

export type SalesReadinessRequirement = {
  id: SalesReadinessRequirementId;
  label: string;
  complete: boolean;
  detail: string;
};

export type CustomerSalesReadinessInput = {
  status: string;
  salesCode: string | null;
  salesCodeVerified: boolean;
  ownershipAmbiguous: boolean;
  historyStatus: "NOT_STARTED" | "REVIEW" | "COMPLETE";
  historyKind: string | null;
  hasPrimaryContact: boolean;
  hasBillingAddress: boolean;
  hasDeliveryAddress: boolean;
  paymentTerms: string | null;
  /** Explicit staff review of credit limit, including authorised blank/unlimited. */
  creditLimitReviewed: boolean;
  creditLimit: string | null;
  /** Stamp set when SAVE & ENABLE ORDERING succeeded. */
  orderingEnabledAt: string | null;
  /** Company createdAt ISO — used for rollout grandfathering only. */
  createdAt: string;
  /** Existing placed/drafted AB orders — trading history grandfather. */
  hasExistingOrders: boolean;
};

export type CustomerSalesReadiness = {
  readyForSales: boolean;
  label: "READY_FOR_SALES" | "SETUP_INCOMPLETE" | "BLOCKED" | "LEGACY_ELIGIBLE";
  summary: string;
  requirements: SalesReadinessRequirement[];
  incomplete: SalesReadinessRequirement[];
  /** True when ordering is allowed under the compatibility policy without a new stamp. */
  legacyEligible: boolean;
  /** True when staff order entry may proceed (ready or legacy). */
  canCreateStaffOrder: boolean;
  blockReason: string | null;
};

function req(
  id: SalesReadinessRequirementId,
  label: string,
  complete: boolean,
  detail: string,
): SalesReadinessRequirement {
  return { id, label, complete, detail };
}

export function isPreEnforcementCompany(
  createdAt: string,
  enforceFrom = CUSTOMER_SALES_READY_ENFORCE_FROM,
) {
  const created = Date.parse(createdAt);
  const from = Date.parse(enforceFrom);
  if (!Number.isFinite(created) || !Number.isFinite(from)) return false;
  return created < from;
}

/**
 * Live checklist for READY_FOR_SALES. Does not invent Autopart, history, or addresses.
 */
export function assessCustomerSalesReadiness(
  input: CustomerSalesReadinessInput,
): CustomerSalesReadiness {
  const held =
    input.status === "SUSPENDED" || input.status === "ON_HOLD" || input.status === "CLOSED";
  const active = input.status === "ACTIVE";

  const requirements: SalesReadinessRequirement[] = [
    req(
      "active_status",
      "Customer Active",
      active,
      held
        ? `Account is ${input.status}. Use the authorised reactivation flow before ordering.`
        : active
          ? "Account status is ACTIVE."
          : `Account status is ${input.status}. Verify Autopart to activate a prospect, or set status through the authorised flow.`,
    ),
    req(
      "autopart_verified",
      "Autopart verified",
      Boolean(input.salesCodeVerified && input.salesCode && !input.ownershipAmbiguous),
      input.ownershipAmbiguous
        ? "Sales code ownership conflicts with another customer."
        : input.salesCodeVerified && input.salesCode
          ? `Verified sales account ${input.salesCode}.`
          : input.salesCode
            ? `Sales account ${input.salesCode} is saved but not verified.`
            : "No Autopart sales account is verified.",
    ),
    req(
      "history_cutover",
      "Historical sales baseline",
      input.historyStatus === "COMPLETE",
      input.historyStatus === "REVIEW"
        ? "Historical import is in REVIEW. Finish exceptions before enabling ordering."
        : input.historyStatus === "COMPLETE"
          ? input.historyKind === "NO_HISTORICAL_SALES"
            ? "Zero-history baseline confirmed (NO_HISTORICAL_SALES)."
            : "Historical sales cutover is COMPLETE."
          : "Confirm no historical sales, or import 561L/SLRB until cutover is COMPLETE.",
    ),
    req(
      "primary_contact",
      "Primary contact",
      input.hasPrimaryContact,
      input.hasPrimaryContact
        ? "A primary contact is recorded."
        : "Add a primary contact before enabling ordering.",
    ),
    req(
      "billing_address",
      "Billing address",
      input.hasBillingAddress,
      input.hasBillingAddress
        ? "A billing address is recorded."
        : "Add a billing address (default billing) before enabling ordering.",
    ),
    req(
      "delivery_address",
      "Delivery address",
      input.hasDeliveryAddress,
      input.hasDeliveryAddress
        ? "A delivery address is recorded."
        : "Add a delivery address (default delivery) before enabling ordering.",
    ),
    req(
      "payment_terms",
      "Payment terms",
      Boolean(input.paymentTerms?.trim()),
      input.paymentTerms?.trim()
        ? `Payment terms: ${input.paymentTerms.trim()}.`
        : "Set payment terms before enabling ordering.",
    ),
    req(
      "credit_limit_reviewed",
      "Credit limit reviewed",
      input.creditLimitReviewed,
      input.creditLimitReviewed
        ? input.creditLimit
          ? `Credit limit reviewed at £${input.creditLimit} (informational only).`
          : "Credit limit reviewed as blank/unlimited (informational only)."
        : "Confirm the credit limit, including an authorised blank/unlimited choice.",
    ),
  ];

  const incomplete = requirements.filter((item) => !item.complete);
  const readyForSales = incomplete.length === 0;

  const legacyEligible =
    active &&
    !held &&
    !input.orderingEnabledAt &&
    (input.hasExistingOrders || isPreEnforcementCompany(input.createdAt));

  const canCreateStaffOrder = readyForSales || legacyEligible;

  let label: CustomerSalesReadiness["label"];
  let summary: string;
  let blockReason: string | null = null;

  if (held) {
    label = "BLOCKED";
    summary = `Ordering is blocked while the account is ${input.status}.`;
    blockReason = summary;
  } else if (readyForSales) {
    label = "READY_FOR_SALES";
    summary = "Setup is complete. Staff can create sales orders.";
  } else if (legacyEligible) {
    label = "LEGACY_ELIGIBLE";
    summary = input.hasExistingOrders
      ? "Existing trading customer — ordering remains available under the compatibility policy."
      : "Pre-rollout Active customer — ordering remains available under the compatibility policy. Complete setup when convenient.";
  } else {
    label = "SETUP_INCOMPLETE";
    summary = "Complete the outstanding setup items before staff can create orders.";
    blockReason = `Not ready for sales: ${incomplete.map((item) => item.label).join(", ")}.`;
  }

  return {
    readyForSales,
    label,
    summary,
    requirements,
    incomplete,
    legacyEligible,
    canCreateStaffOrder,
    blockReason,
  };
}
