import { describe, expect, it } from "vitest";
import { companyInvoiceKindLabel, companyInvoiceStatusLabel } from "@/domain/company-invoice";

describe("company invoice labels", () => {
  it("uses business status names", () => {
    expect(companyInvoiceStatusLabel("PART_PAID")).toBe("Part paid");
    expect(companyInvoiceStatusLabel("OVERDUE")).toBe("Overdue");
    expect(companyInvoiceStatusLabel("UNKNOWN_STATUS")).toBe("Invoice");
  });

  it("labels credits without exposing unclassified codes", () => {
    expect(companyInvoiceKindLabel("CREDIT")).toBe("Credit");
    expect(companyInvoiceKindLabel("INVOICE")).toBe("Invoice");
    expect(companyInvoiceKindLabel("UNKNOWN")).toBe("Invoice");
    expect(companyInvoiceKindLabel(null)).toBe("Invoice");
  });
});
