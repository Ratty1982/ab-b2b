import { describe, expect, it } from "vitest";
import { formatCreditLimitGbp, parseCreditLimitInput } from "@/domain/credit-limit";

describe("credit limit parsing", () => {
  it("accepts null and blank as clear", () => {
    expect(parseCreditLimitInput(null)).toEqual({ ok: true, value: null });
    expect(parseCreditLimitInput("")).toEqual({ ok: true, value: null });
    expect(parseCreditLimitInput("   ")).toEqual({ ok: true, value: null });
    expect(parseCreditLimitInput(undefined)).toEqual({ ok: true, value: undefined });
  });

  it("accepts £0 and large non-negative amounts", () => {
    expect(parseCreditLimitInput("0")).toEqual({ ok: true, value: "0.00" });
    expect(parseCreditLimitInput("£1,250.50")).toEqual({ ok: true, value: "1250.50" });
    expect(parseCreditLimitInput(1000000)).toEqual({ ok: true, value: "1000000.00" });
  });

  it("rejects negatives and invalid input", () => {
    expect(parseCreditLimitInput("-1").ok).toBe(false);
    expect(parseCreditLimitInput("abc").ok).toBe(false);
  });

  it("formats GBP without inventing a limit for null", () => {
    expect(formatCreditLimitGbp(null)).toBeNull();
    expect(formatCreditLimitGbp("")).toBeNull();
    expect(formatCreditLimitGbp("0")).toBe("£0.00");
    expect(formatCreditLimitGbp("1250.5")).toBe("£1,250.50");
  });
});
