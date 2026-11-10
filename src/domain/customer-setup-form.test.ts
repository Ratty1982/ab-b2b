import { describe, expect, it } from "vitest";
import {
  mergePreservedField,
  requirementProgressLabel,
  requirementProgressTone,
  resolveCustomerSetupRefreshMode,
  shouldHydrateFormFields,
} from "@/domain/customer-setup-form";

describe("customer setup form refresh", () => {
  it("preserves form hydration while dirty during background refresh", () => {
    expect(resolveCustomerSetupRefreshMode({ dirty: true })).toBe("server-only");
    expect(shouldHydrateFormFields("server-only")).toBe(false);
  });

  it("hydrates on clean refresh and forced hydrate", () => {
    expect(resolveCustomerSetupRefreshMode({ dirty: false })).toBe("full");
    expect(resolveCustomerSetupRefreshMode({ dirty: true, forceHydrate: true })).toBe("full");
    expect(shouldHydrateFormFields("full")).toBe(true);
  });

  it("keeps local sales rep and credit fields when dirty", () => {
    expect(mergePreservedField(true, "rep-local", "rep-server")).toBe("rep-local");
    expect(mergePreservedField(false, "rep-local", "rep-server")).toBe("rep-server");
    expect(mergePreservedField(true, "5000", "1000")).toBe("5000");
    expect(mergePreservedField(true, "45 DAYS", "30 DAYS")).toBe("45 DAYS");
  });

  it("labels incomplete requirements as action required from server state", () => {
    expect(
      requirementProgressTone({
        complete: false,
        orderingApproved: false,
        requirementId: "primary_contact",
      }),
    ).toBe("action_required");
    expect(
      requirementProgressLabel(
        requirementProgressTone({
          complete: true,
          orderingApproved: true,
          requirementId: "payment_terms",
        }),
      ),
    ).toBe("Complete");
  });
});
