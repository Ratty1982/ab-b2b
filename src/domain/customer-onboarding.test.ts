import { describe, expect, it } from "vitest";
import { deriveCustomerOnboarding, type CustomerOnboardingInput } from "@/domain/customer-onboarding";

const staff: Pick<
  CustomerOnboardingInput,
  "canEditCompany" | "canEditContacts" | "canManageUsers" | "canImportHistory"
> = {
  canEditCompany: true,
  canEditContacts: true,
  canManageUsers: true,
  canImportHistory: true,
};

function input(overrides: Partial<CustomerOnboardingInput> = {}): CustomerOnboardingInput {
  return {
    status: "PROSPECT",
    contactCount: 0,
    addressCount: 0,
    salesCode: null,
    salesCodeVerified: false,
    ownershipAmbiguous: false,
    ownershipNote: null,
    masterLinked: false,
    masterCodes: [],
    masterRestricted: false,
    priceListName: null,
    paymentTerms: null,
    customerGroupName: null,
    taxStatus: "STANDARD",
    historyStatus: "NOT_STARTED",
    historyKind: null,
    portalActiveUsers: 0,
    portalPending: 0,
    ...staff,
    ...overrides,
  };
}

describe("customer onboarding summary", () => {
  it("treats a brand-new prospect as active-decision required, not fully onboarded", () => {
    const result = deriveCustomerOnboarding(input());
    expect(result.activationComplete).toBe(false);
    expect(result.onboardingComplete).toBe(false);
    expect(result.next?.id).toBe("activation");
    expect(result.next?.state).toBe("required");
    expect(result.steps.find((step) => step.id === "autopart")?.state).toBe("optional");
    expect(result.steps.find((step) => step.id === "history")?.state).toBe("optional");
    expect(result.steps.find((step) => step.id === "trading")?.summary).toContain("Default Trade Price");
    expect(result.steps.find((step) => step.id === "trading")?.summary).toContain("Credit balance is not stored");
  });

  it("keeps a saved sales code unverified until a verification timestamp exists", () => {
    const result = deriveCustomerOnboarding(
      input({
        salesCode: "WORSBRO",
        salesCodeVerified: false,
        masterLinked: true,
        masterCodes: ["WORSBRO"],
      }),
    );
    const autopart = result.steps.find((step) => step.id === "autopart");
    expect(autopart?.state).toBe("awaiting_verification");
    expect(autopart?.summary).toContain("has not been verified");
    expect(autopart?.summary).toContain("407EXP master WORSBRO");
    expect(result.next?.id).toBe("autopart");
  });

  it("separates an unlinked 407EXP master from a verified sales code", () => {
    const result = deriveCustomerOnboarding(
      input({
        status: "ACTIVE",
        salesCode: "WORSBRO",
        salesCodeVerified: true,
        masterLinked: false,
        historyStatus: "NOT_STARTED",
      }),
    );
    const autopart = result.steps.find((step) => step.id === "autopart");
    expect(autopart?.state).toBe("complete");
    expect(autopart?.summary).toContain("Verified sales account WORSBRO");
    expect(autopart?.summary).toContain("407EXP master is not linked");
    expect(result.activationComplete).toBe(true);
    expect(result.onboardingComplete).toBe(false);
    expect(result.next?.id).toBe("history");
    expect(result.next?.state).toBe("required");
    expect(result.next?.summary).toContain("blank spreadsheet");
  });

  it("does not describe confirmed zero history as discarded history", () => {
    const result = deriveCustomerOnboarding(
      input({
        status: "ACTIVE",
        salesCode: "WORSBRO",
        salesCodeVerified: true,
        historyStatus: "COMPLETE",
        historyKind: "NO_HISTORICAL_SALES",
        portalActiveUsers: 1,
        contactCount: 1,
        addressCount: 1,
        paymentTerms: "30 days",
      }),
    );
    const history = result.steps.find((step) => step.id === "history");
    expect(history?.state).toBe("complete");
    expect(history?.summary).toContain("No historical purchases");
    expect(history?.summary).toContain("not a discarded pre-launch history");
    expect(result.onboardingComplete).toBe(true);
    expect(result.activationComplete).toBe(true);
    expect(result.next).toBeNull();
  });

  it("does not describe discarded pre-launch history as zero purchases", () => {
    const history = deriveCustomerOnboarding(
      input({
        status: "ACTIVE",
        salesCode: "OLD",
        salesCodeVerified: true,
        historyStatus: "COMPLETE",
        historyKind: "PRELAUNCH_HISTORY_DISCARDED",
      }),
    ).steps.find((step) => step.id === "history");
    expect(history?.summary).toContain("New sales baseline");
    expect(history?.summary).toContain("not a claim that the customer never bought");
    expect(history?.summary).not.toContain("No historical purchases");
  });

  it("marks imported history complete and leaves a prospect's activation open", () => {
    const result = deriveCustomerOnboarding(
      input({
        salesCode: "HIST",
        salesCodeVerified: true,
        historyStatus: "COMPLETE",
        historyKind: "561L_SLRB",
      }),
    );
    expect(result.steps.find((step) => step.id === "history")?.summary).toBe("History imported");
    expect(result.next?.id).toBe("activation");
    expect(result.onboardingComplete).toBe(false);
  });

  it("blocks exception review ahead of optional portal setup", () => {
    const result = deriveCustomerOnboarding(
      input({
        status: "ACTIVE",
        salesCode: "HIST",
        salesCodeVerified: true,
        historyStatus: "REVIEW",
      }),
    );
    expect(result.readiness).toBe("blocked");
    expect(result.next?.id).toBe("history");
    expect(result.next?.action?.tab).toBe("Autopart");
  });

  it("shows a pending invitation without treating an active account as finished", () => {
    const result = deriveCustomerOnboarding(
      input({
        status: "ACTIVE",
        salesCode: "PORTAL",
        salesCodeVerified: true,
        historyStatus: "COMPLETE",
        historyKind: "NO_HISTORICAL_SALES",
        portalPending: 1,
      }),
    );
    expect(result.activationComplete).toBe(true);
    expect(result.onboardingComplete).toBe(false);
    expect(result.next?.id).toBe("portal");
    expect(result.next?.state).toBe("awaiting_verification");
  });

  it("hides privileged actions from a viewer who cannot perform them", () => {
    const result = deriveCustomerOnboarding(
      input({
        status: "ACTIVE",
        salesCode: "WORSBRO",
        salesCodeVerified: false,
        canEditCompany: false,
        canEditContacts: false,
        canManageUsers: false,
        canImportHistory: false,
      }),
    );
    expect(result.steps.every((item) => item.action == null)).toBe(true);
    expect(result.next?.summary).toContain("has not been verified");
  });

  it("names an ownership clash as a blocker and does not call the code verified", () => {
    const result = deriveCustomerOnboarding(
      input({
        status: "ACTIVE",
        salesCode: "SHARED",
        salesCodeVerified: false,
        ownershipAmbiguous: true,
        ownershipNote: "Another customer already has this Autopart ID.",
      }),
    );
    expect(result.readiness).toBe("blocked");
    expect(result.next?.id).toBe("autopart");
    expect(result.steps.find((step) => step.id === "history")?.state).toBe("optional");
  });
});
