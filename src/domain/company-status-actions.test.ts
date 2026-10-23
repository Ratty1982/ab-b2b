import { describe, expect, it } from "vitest";
import {
  companyActivationWarnings,
  companyOverviewStatusActions,
} from "@/domain/company-status-actions";

describe("company overview status actions", () => {
  it("offers Activate Account for a prospect and does not invite anyone", () => {
    const actions = companyOverviewStatusActions("PROSPECT");
    expect(actions.map((action) => action.label)).toEqual(["Activate Account"]);
    expect(actions[0]?.nextStatus).toBe("ACTIVE");
    expect(actions[0]?.confirmBody).toMatch(/does not invite portal users/i);
    expect(actions[0]?.confirmBody).toMatch(/import sales history/i);
  });

  it("offers hold, suspend, and close for an active account", () => {
    expect(companyOverviewStatusActions("ACTIVE").map((action) => action.nextStatus)).toEqual([
      "ON_HOLD",
      "SUSPENDED",
      "CLOSED",
    ]);
  });

  it("offers reactivate for suspended and on-hold accounts", () => {
    expect(companyOverviewStatusActions("SUSPENDED").some((action) => action.nextStatus === "ACTIVE")).toBe(
      true,
    );
    expect(companyOverviewStatusActions("ON_HOLD").some((action) => action.nextStatus === "ACTIVE")).toBe(
      true,
    );
  });

  it("lists commercial gaps without changing them", () => {
    const warnings = companyActivationWarnings({
      autopartVerified: false,
      autopartCode: "RET01",
      paymentTerms: null,
      priceListName: null,
      salespersonName: null,
    });
    expect(warnings.join(" ")).toMatch(/not verified/);
    expect(warnings.join(" ")).toMatch(/Payment terms/);
    expect(warnings.join(" ")).toMatch(/does not verify/);
    expect(warnings.join(" ")).toMatch(/does not fill commercial settings/);
  });
});
