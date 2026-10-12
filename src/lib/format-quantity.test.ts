import { describe, expect, it } from "vitest";
import { formatGbp } from "@/domain/sales-intelligence";
import { gbp } from "@/lib/format-money";
import { formatQuantity } from "@/lib/format-quantity";

describe("formatQuantity", () => {
  it("hides trailing zeros and groups whole quantities", () => {
    expect(formatQuantity("41690.000")).toBe("41,690");
    expect(formatQuantity("1128.000")).toBe("1,128");
    expect(formatQuantity("1761.000")).toBe("1,761");
    expect(formatQuantity(41690)).toBe("41,690");
  });

  it("keeps significant fractional digits without rounding", () => {
    expect(formatQuantity("12.500")).toBe("12.5");
    expect(formatQuantity("12.125")).toBe("12.125");
    expect(formatQuantity(12.5)).toBe("12.5");
    expect(formatQuantity(12.125)).toBe("12.125");
    expect(formatQuantity("12.10")).toBe("12.1");
    expect(formatQuantity("0.100")).toBe("0.1");
  });

  it("retains a minus sign and treats signed zero as zero", () => {
    expect(formatQuantity("-1761.000")).toBe("-1,761");
    expect(formatQuantity("-12.500")).toBe("-12.5");
    expect(formatQuantity("-12.125")).toBe("-12.125");
    expect(formatQuantity(-1128)).toBe("-1,128");
    expect(formatQuantity("-0.000")).toBe("0");
    expect(formatQuantity("0.000")).toBe("0");
    expect(formatQuantity(-0)).toBe("0");
  });

  it("accepts already grouped input and rejects values that are not quantities", () => {
    expect(formatQuantity("1,128.000")).toBe("1,128");
    expect(formatQuantity("+12.500")).toBe("12.5");
    expect(formatQuantity(null)).toBe("—");
    expect(formatQuantity(undefined)).toBe("—");
    expect(formatQuantity("")).toBe("—");
    expect(formatQuantity("abc")).toBe("—");
    expect(formatQuantity(Number.NaN)).toBe("—");
  });

  it("leaves money formatters on two decimal places", () => {
    expect(gbp(1234.5)).toBe("£1,234.50");
    expect(formatGbp("1234.50")).toBe("£1,234.50");
    expect(formatGbp("1234.5")).toBe("£1,234.50");
  });
});
