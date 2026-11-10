import { describe, expect, it } from "vitest";
import {
  assessCustomerSalesReadiness,
  CUSTOMER_SALES_READY_ENFORCE_FROM,
  isPreEnforcementCompany,
  type CustomerSalesReadinessInput,
} from "@/domain/customer-sales-readiness";

function base(overrides: Partial<CustomerSalesReadinessInput> = {}): CustomerSalesReadinessInput {
  return {
    status: "ACTIVE",
    salesCode: "SENCO",
    salesCodeVerified: true,
    ownershipAmbiguous: false,
    historyStatus: "COMPLETE",
    historyKind: "NO_HISTORICAL_SALES",
    hasPrimaryContact: true,
    hasBillingAddress: true,
    hasDeliveryAddress: true,
    paymentTerms: "30 DAYS",
    creditLimitReviewed: true,
    creditLimit: null,
    orderingEnabledAt: null,
    createdAt: "2026-11-10T12:00:00.000Z",
    hasExistingOrders: false,
    ...overrides,
  };
}

describe("customer sales readiness", () => {
  it("marks READY_FOR_SALES only when every requirement is complete", () => {
    const ready = assessCustomerSalesReadiness(base());
    expect(ready.readyForSales).toBe(true);
    expect(ready.label).toBe("READY_FOR_SALES");
    expect(ready.canCreateStaffOrder).toBe(true);
    expect(ready.incomplete).toEqual([]);
  });

  it("blocks staff orders for post-rollout incomplete setup", () => {
    const result = assessCustomerSalesReadiness(
      base({
        hasPrimaryContact: false,
        paymentTerms: null,
        creditLimitReviewed: false,
        historyStatus: "NOT_STARTED",
      }),
    );
    expect(result.readyForSales).toBe(false);
    expect(result.label).toBe("SETUP_INCOMPLETE");
    expect(result.canCreateStaffOrder).toBe(false);
    expect(result.incomplete.map((item) => item.id)).toEqual(
      expect.arrayContaining([
        "primary_contact",
        "payment_terms",
        "credit_limit_reviewed",
        "history_cutover",
      ]),
    );
  });

  it("keeps suspended accounts blocked even when other fields look complete", () => {
    const result = assessCustomerSalesReadiness(base({ status: "SUSPENDED" }));
    expect(result.label).toBe("BLOCKED");
    expect(result.canCreateStaffOrder).toBe(false);
  });

  it("grandfathers pre-rollout Active customers without a new stamp", () => {
    expect(isPreEnforcementCompany("2026-11-09T23:59:59.000Z")).toBe(true);
    expect(isPreEnforcementCompany(CUSTOMER_SALES_READY_ENFORCE_FROM)).toBe(false);
    const result = assessCustomerSalesReadiness(
      base({
        createdAt: "2026-10-01T00:00:00.000Z",
        hasPrimaryContact: false,
        historyStatus: "NOT_STARTED",
        creditLimitReviewed: false,
        paymentTerms: null,
      }),
    );
    expect(result.legacyEligible).toBe(true);
    expect(result.canCreateStaffOrder).toBe(true);
    expect(result.label).toBe("LEGACY_ELIGIBLE");
  });

  it("grandfathers existing trading customers with orders", () => {
    const result = assessCustomerSalesReadiness(
      base({
        hasExistingOrders: true,
        hasPrimaryContact: false,
        creditLimitReviewed: false,
      }),
    );
    expect(result.legacyEligible).toBe(true);
    expect(result.canCreateStaffOrder).toBe(true);
  });

  it("does not treat REVIEW history as complete", () => {
    const result = assessCustomerSalesReadiness(base({ historyStatus: "REVIEW" }));
    expect(result.readyForSales).toBe(false);
    expect(result.incomplete.some((item) => item.id === "history_cutover")).toBe(true);
  });
});
