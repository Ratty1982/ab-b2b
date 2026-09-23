import { describe, expect, it } from "vitest";
import {
  ACCOUNT_MANAGER_HOURS,
  ACCOUNT_MANAGER_HOURS_LINES,
} from "@/domain/account-manager-hours";

describe("account manager hours", () => {
  it("exposes weekday 08:00–16:00 and same-day order cut-off 13:00 without Saturday", () => {
    expect(ACCOUNT_MANAGER_HOURS.heading).toBe("Account manager hours");
    expect(ACCOUNT_MANAGER_HOURS.weekdayLine).toBe("Monday to Friday · 08:00 – 16:00");
    expect(ACCOUNT_MANAGER_HOURS.weekdayCompact).toBe("Mon–Fri 08:00–16:00");
    expect(ACCOUNT_MANAGER_HOURS.orderCutoffLine).toBe("Same-day order cut-off · 13:00");
    expect(ACCOUNT_MANAGER_HOURS_LINES).toEqual([
      "Monday to Friday · 08:00 – 16:00",
      "Same-day order cut-off · 13:00",
    ]);
    expect(ACCOUNT_MANAGER_HOURS_LINES.join(" ")).not.toMatch(/Saturday/i);
    expect(ACCOUNT_MANAGER_HOURS_LINES.join(" ")).not.toMatch(/despatch/i);
    expect(ACCOUNT_MANAGER_HOURS_LINES.join(" ")).not.toMatch(/17:30|15:00/);
  });
});
