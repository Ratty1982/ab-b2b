import { describe, expect, it } from "vitest";
import {
  buildMissingAutopartCodeInternalBodies,
  buildTradeAccountApprovedInternalBodies,
  MISSING_AUTOPART_CODE_NOTIFY_EMAIL,
} from "@/server/email/approval-internal-templates";
import { buildTradeApplicationApprovedBodies } from "@/server/email/application-templates";

describe("missing Autopart code PL notification", () => {
  it("uses the required subject and explains MAM check", () => {
    const bodies = buildMissingAutopartCodeInternalBodies({
      applicationId: "app1",
      reference: "APP-20261105-1234",
      companyName: "Test Motors Ltd",
      tradingName: "Test Motors",
      contactName: "Alex Tester",
      submittedAt: "5 Nov 2026, 12:00",
      adminApplicationUrl: "https://example.test/admin/applications/app1",
    });
    expect(bodies.subject).toBe("ACTION REQUIRED — Check MAM before applying for credit");
    expect(bodies.text).toContain("without an Autopart customer code");
    expect(bodies.text).toContain("check MAM Autopart");
    expect(bodies.text).toContain("Test Motors Ltd");
    expect(bodies.text).toContain("APP-20261105-1234");
    expect(MISSING_AUTOPART_CODE_NOTIFY_EMAIL).toBe("pl@automotivebrands.co.uk");
  });
});

describe("internal account approval notification", () => {
  it("includes credit limit when present and omits activation tokens", () => {
    const bodies = buildTradeAccountApprovedInternalBodies({
      companyId: "co1",
      companyName: "Approved Co",
      accountNumber: "AB-100",
      authorisedByName: "Staff User",
      approvedAt: "5 Nov 2026, 13:00",
      accountStatus: "ACTIVE",
      creditLimit: "2500.00",
      paymentTerms: "30 days",
      customerApprovalSummary: "Your trade account has been approved.\nActivation link omitted.",
      source: "TRADE_APPLICATION",
      applicationReference: "APP-1",
    });
    expect(bodies.subject).toContain("Approved Co");
    expect(bodies.text).toContain("£2,500.00");
    expect(bodies.text).toContain("30 days");
    expect(bodies.text).not.toMatch(/token=/i);
    expect(bodies.html).not.toMatch(/token=/i);
  });

  it("customer approval email includes agreed credit limit when set", () => {
    const withLimit = buildTradeApplicationApprovedBodies({
      applicationId: "a1",
      reference: "APP-9",
      companyName: "Limit Co",
      contactName: "Pat",
      contactEmail: "pat@example.invalid",
      activationPath: "/activate?token=SECRET",
      creditLimitDisplay: "£1,000.00",
      paymentTerms: "14 days",
    });
    expect(withLimit.text).toContain("£1,000.00");
    expect(withLimit.text).toContain("14 days");

    const without = buildTradeApplicationApprovedBodies({
      applicationId: "a2",
      reference: "APP-10",
      companyName: "No Limit Co",
      contactName: "Sam",
      contactEmail: "sam@example.invalid",
      activationPath: null,
    });
    expect(without.text).not.toContain("Agreed credit limit");
  });
});
