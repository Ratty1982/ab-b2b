import { describe, expect, it } from "vitest";
import {
  assessCustomerSalesReadiness,
  CUSTOMER_SALES_READY_ENFORCE_FROM,
  hasPreRolloutTradingEvidence,
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
    hasPreRolloutOrders: false,
    ...overrides,
  };
}

describe("customer sales readiness", () => {
  it("does not mark READY_FOR_SALES from checklist alone without approval stamp", () => {
    const ready = assessCustomerSalesReadiness(base());
    expect(ready.setupRequirementsComplete).toBe(true);
    expect(ready.orderingApproved).toBe(false);
    expect(ready.readyForSales).toBe(false);
    expect(ready.canCreateStaffOrder).toBe(false);
    expect(ready.label).toBe("SETUP_INCOMPLETE");
    expect(ready.blockReason).toMatch(/not approved/i);
  });

  it("marks READY_FOR_SALES only when checklist and approval stamp are both present", () => {
    const ready = assessCustomerSalesReadiness(
      base({ orderingEnabledAt: "2026-11-10T13:00:00.000Z" }),
    );
    expect(ready.setupRequirementsComplete).toBe(true);
    expect(ready.orderingApproved).toBe(true);
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
    expect(result.setupRequirementsComplete).toBe(false);
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
    const result = assessCustomerSalesReadiness(
      base({
        status: "SUSPENDED",
        orderingEnabledAt: "2026-11-10T13:00:00.000Z",
      }),
    );
    expect(result.label).toBe("BLOCKED");
    expect(result.canCreateStaffOrder).toBe(false);
    expect(result.legacyEligible).toBe(false);
  });

  it("blocks ON_HOLD and CLOSED accounts", () => {
    for (const status of ["ON_HOLD", "CLOSED"] as const) {
      const result = assessCustomerSalesReadiness(
        base({
          status,
          createdAt: "2026-10-01T00:00:00.000Z",
          hasPreRolloutOrders: true,
        }),
      );
      expect(result.label).toBe("BLOCKED");
      expect(result.canCreateStaffOrder).toBe(false);
    }
  });

  it("grandfathers pre-rollout Active customers with trading evidence without a new stamp", () => {
    expect(isPreEnforcementCompany("2026-11-09T23:59:59.000Z")).toBe(true);
    expect(isPreEnforcementCompany(CUSTOMER_SALES_READY_ENFORCE_FROM)).toBe(false);
    expect(
      hasPreRolloutTradingEvidence({
        status: "ACTIVE",
        createdAt: "2026-10-01T00:00:00.000Z",
        hasPreRolloutOrders: false,
        historyStatus: "NOT_STARTED",
        salesCodeVerified: false,
      }),
    ).toBe(true);
    const result = assessCustomerSalesReadiness(
      base({
        createdAt: "2026-10-01T00:00:00.000Z",
        hasPrimaryContact: false,
        historyStatus: "NOT_STARTED",
        creditLimitReviewed: false,
        paymentTerms: null,
        salesCodeVerified: false,
        salesCode: null,
      }),
    );
    expect(result.legacyEligible).toBe(true);
    expect(result.canCreateStaffOrder).toBe(true);
    expect(result.label).toBe("LEGACY_ELIGIBLE");
  });

  it("never exempts a post-rollout customer merely because an order exists", () => {
    const result = assessCustomerSalesReadiness(
      base({
        createdAt: "2026-11-10T12:00:00.000Z",
        hasPreRolloutOrders: false,
        // Post-rollout order activity is irrelevant to legacy — only pre-rollout orders count.
        hasPrimaryContact: false,
        creditLimitReviewed: false,
        historyStatus: "NOT_STARTED",
      }),
    );
    expect(result.legacyEligible).toBe(false);
    expect(result.canCreateStaffOrder).toBe(false);
    expect(result.label).toBe("SETUP_INCOMPLETE");
  });

  it("uses pre-rollout orders as trading evidence for historical legacy customers", () => {
    const result = assessCustomerSalesReadiness(
      base({
        createdAt: "2026-09-01T00:00:00.000Z",
        hasPreRolloutOrders: true,
        hasPrimaryContact: false,
        creditLimitReviewed: false,
        historyStatus: "NOT_STARTED",
        salesCodeVerified: false,
        salesCode: null,
      }),
    );
    expect(result.legacyEligible).toBe(true);
    expect(result.canCreateStaffOrder).toBe(true);
    expect(result.label).toBe("LEGACY_ELIGIBLE");
  });

  it("blocks approved customers when live requirements later become incomplete", () => {
    const result = assessCustomerSalesReadiness(
      base({
        orderingEnabledAt: "2026-11-10T13:00:00.000Z",
        hasPrimaryContact: false,
        paymentTerms: null,
      }),
    );
    expect(result.orderingApproved).toBe(true);
    expect(result.setupRequirementsComplete).toBe(false);
    expect(result.readyForSales).toBe(false);
    expect(result.canCreateStaffOrder).toBe(false);
    expect(result.label).toBe("SETUP_INCOMPLETE");
    expect(result.summary).toMatch(/previously approved/i);
  });

  it("does not treat REVIEW history as complete", () => {
    const result = assessCustomerSalesReadiness(
      base({
        historyStatus: "REVIEW",
        orderingEnabledAt: "2026-11-10T13:00:00.000Z",
      }),
    );
    expect(result.setupRequirementsComplete).toBe(false);
    expect(result.readyForSales).toBe(false);
    expect(result.incomplete.some((item) => item.id === "history_cutover")).toBe(true);
  });
});
