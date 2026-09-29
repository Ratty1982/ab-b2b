import { describe, expect, it } from "vitest";
import { companyCreateSchema, companyUpdateSchema } from "@/domain/company";

describe("companyUpdateSchema", () => {
  it("does not inject PROSPECT when status is omitted (commercial save)", () => {
    const parsed = companyUpdateSchema.parse({
      id: "clxxxxxxxxxxxxxxxxxxxx",
      paymentTerms: "60 DAYS",
      taxStatus: "STANDARD",
      salesRepId: null,
      creditLimit: 5000,
    });
    expect(parsed).not.toHaveProperty("status");
    expect(parsed.status).toBeUndefined();
    expect(parsed.paymentTerms).toBe("60 DAYS");
    expect(parsed.creditLimit).toBe(5000);
  });

  it("still allows explicit status changes", () => {
    const parsed = companyUpdateSchema.parse({
      id: "clxxxxxxxxxxxxxxxxxxxx",
      status: "ACTIVE",
    });
    expect(parsed.status).toBe("ACTIVE");
  });

  it("create schema still defaults new companies to PROSPECT", () => {
    const created = companyCreateSchema.parse({ name: "New Prospect Co" });
    expect(created.status).toBe("PROSPECT");
  });
});
