import { describe, expect, it } from "vitest";
import {
  customerAutopartPrimaryAction,
  customerAutopartStages,
  historicalSalesStatusLabel,
} from "@/domain/customer-autopart-workspace";

const ready = {
  companyStatus: "ACTIVE",
  verified: true,
  hasAccountCode: true,
  ownershipAmbiguous: false,
  historyStatus: "NOT_STARTED" as const,
  ongoingImportCount: 0,
};

describe("customer Autopart workspace stages", () => {
  it("asks for an account before history, and does not require a 407EXP master link", () => {
    const stages = customerAutopartStages({ ...ready, verified: false, hasAccountCode: false });
    expect(stages.find((stage) => stage.id === "verify")?.state).toBe("ACTION_REQUIRED");
    expect(stages.find((stage) => stage.id === "history")?.state).toBe("NOT_STARTED");
    expect(customerAutopartPrimaryAction({ ...ready, verified: false, hasAccountCode: false })).toBe("verify");
  });

  it("holds an unverified code in review", () => {
    const input = { ...ready, verified: false, hasAccountCode: true };
    expect(customerAutopartStages(input).find((stage) => stage.id === "verify")?.state).toBe("UNDER_REVIEW");
    expect(customerAutopartPrimaryAction(input)).toBe("verify");
  });

  it("asks an active verified customer to import history", () => {
    expect(customerAutopartPrimaryAction(ready)).toBe("import-history");
    expect(customerAutopartStages(ready).find((stage) => stage.id === "history")?.state).toBe("ACTION_REQUIRED");
  });

  it("blocks current sales and points at exception review", () => {
    const input = { ...ready, historyStatus: "REVIEW" as const };
    const stages = customerAutopartStages(input);
    expect(stages.find((stage) => stage.id === "exceptions")?.state).toBe("ACTION_REQUIRED");
    expect(stages.find((stage) => stage.id === "current")?.state).toBe("NOT_STARTED");
    expect(customerAutopartPrimaryAction(input)).toBe("review-exceptions");
  });

  it("opens current sales after a completed cutover, then Sales Enquiry after an import", () => {
    const complete = { ...ready, historyStatus: "COMPLETE" as const };
    expect(customerAutopartPrimaryAction(complete)).toBe("import-current");
    expect(customerAutopartStages(complete).find((stage) => stage.id === "enquiry")?.state).toBe("COMPLETE");
    expect(customerAutopartPrimaryAction({ ...complete, ongoingImportCount: 2 })).toBe("view-enquiry");
  });

  it("asks for activation before history when the account is verified but not active", () => {
    const input = { ...ready, companyStatus: "PROSPECT" };
    expect(customerAutopartStages(input).find((stage) => stage.id === "history")?.state).toBe("NOT_STARTED");
    expect(customerAutopartPrimaryAction(input)).toBe("activate");
  });

  it("names the two completed history decisions differently", () => {
    expect(historicalSalesStatusLabel({ historyStatus: "COMPLETE", historyKind: "NO_HISTORICAL_SALES" })).toBe(
      "No historical purchases",
    );
    expect(
      historicalSalesStatusLabel({ historyStatus: "COMPLETE", historyKind: "PRELAUNCH_HISTORY_DISCARDED" }),
    ).toBe("New sales baseline");
    expect(historicalSalesStatusLabel({ historyStatus: "COMPLETE", historyKind: "561L_SLRB" })).toBe(
      "History imported",
    );
    expect(historicalSalesStatusLabel({ historyStatus: "REVIEW", historyKind: null })).toBe("Exceptions to review");
  });
});
