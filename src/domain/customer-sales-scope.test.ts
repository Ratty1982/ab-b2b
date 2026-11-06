import { describe, expect, it } from "vitest";
import {
  accountInCustomerScope,
  documentInCustomerScope,
  type CustomerSalesScope,
} from "@/domain/customer-sales-import";

describe("customer sales scope filters", () => {
  const base: CustomerSalesScope = {
    companyId: "ckcompany000000000000000001",
    accountCodes: ["SENCO"],
  };

  it("matches verified accounts case-insensitively", () => {
    expect(accountInCustomerScope("senco", base)).toBe(true);
    expect(accountInCustomerScope("OTHER", base)).toBe(false);
  });

  it("allows all documents when documentReferences is omitted", () => {
    expect(documentInCustomerScope("SS307451", base)).toBe(true);
    expect(documentInCustomerScope("SS999999", base)).toBe(true);
  });

  it("fails closed when documentReferences is an empty list", () => {
    const scoped: CustomerSalesScope = {
      ...base,
      documentReferences: [],
    };
    expect(documentInCustomerScope("SS307451", scoped)).toBe(false);
  });

  it("restricts persistence to the selected invoice references", () => {
    const scoped: CustomerSalesScope = {
      ...base,
      documentReferences: ["SS307451"],
    };
    expect(documentInCustomerScope("ss307451", scoped)).toBe(true);
    expect(documentInCustomerScope("SSOTHER1", scoped)).toBe(false);
    expect(documentInCustomerScope("", scoped)).toBe(false);
  });
});
