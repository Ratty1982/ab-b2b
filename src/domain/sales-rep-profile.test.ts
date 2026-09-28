import { describe, expect, it } from "vitest";
import {
  isPlausiblePhone,
  normalizePhoneInput,
  salesRepProfileUpdateSchema,
  telHrefFromPhone,
} from "@/domain/sales-rep-profile";

describe("sales rep phone handling", () => {
  it("retains leading zeroes and spaces", () => {
    expect(normalizePhoneInput(" 01234 567890 ")).toBe("01234 567890");
    expect(normalizePhoneInput("07123 456789")).toBe("07123 456789");
    expect(telHrefFromPhone("01234 567890")).toBe("tel:01234567890");
    expect(telHrefFromPhone("+44 7123 456789")).toBe("tel:+447123456789");
  });

  it("accepts international numbers and rejects nonsense", () => {
    expect(isPlausiblePhone("+1 (212) 555-0199")).toBe(true);
    expect(isPlausiblePhone("123")).toBe(false);
    expect(salesRepProfileUpdateSchema.safeParse({
      id: "x",
      phone: "abc",
      customerContactEnabled: true,
      active: true,
    }).success).toBe(false);
  });

  it("normalizes business email and optional blanks", () => {
    const parsed = salesRepProfileUpdateSchema.parse({
      id: "rep1",
      displayName: "  Luke Andrews  ",
      jobTitle: " Account Manager ",
      businessEmail: "  Luke.Andrews@AutomotiveBrands.co.uk ",
      phone: "",
      mobile: "07123 456789",
      customerContactEnabled: true,
      active: true,
      photoMediaId: "",
    });
    expect(parsed.displayName).toBe("Luke Andrews");
    expect(parsed.businessEmail).toBe("luke.andrews@automotivebrands.co.uk");
    expect(parsed.phone).toBeNull();
    expect(parsed.mobile).toBe("07123 456789");
    expect(parsed.photoMediaId).toBeNull();
  });
});
