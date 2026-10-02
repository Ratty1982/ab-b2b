import { describe, expect, it } from "vitest";
import {
  humanStaffActivityAction,
  staffActivityAreaForAction,
} from "@/domain/staff-activity";

describe("staff activity catalog", () => {
  it("maps machine actions to human-friendly labels", () => {
    expect(humanStaffActivityAction("LOGIN_SUCCESS")).toBe("Logged in");
    expect(humanStaffActivityAction("sales_followup.completed")).toBe("Completed follow-up");
    expect(humanStaffActivityAction("si.daily_brief.opened")).toBe("Opened Daily Sales Brief");
    expect(humanStaffActivityAction("company.updated")).toBe("Updated customer");
  });

  it("classifies actions into operational areas", () => {
    expect(staffActivityAreaForAction("LOGIN_SUCCESS")).toBe("security");
    expect(staffActivityAreaForAction("company.updated")).toBe("customers");
    expect(staffActivityAreaForAction("crm.task.created")).toBe("crm");
    expect(staffActivityAreaForAction("quote.created")).toBe("sales");
    expect(staffActivityAreaForAction("si.portfolio.opened")).toBe("sales_intelligence");
    expect(staffActivityAreaForAction("product.updated")).toBe("catalogue");
  });
});
