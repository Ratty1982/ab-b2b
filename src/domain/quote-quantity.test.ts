import { describe, expect, it } from "vitest";
import { proposeCustomerOrderQuantity, quoteQuantityMessage } from "@/domain/quote";

describe("quote quantities", () => {
  it("accepts any positive whole quantity and rejects blanks and fractions", () => {
    expect(quoteQuantityMessage(1)).toBeNull();
    expect(quoteQuantityMessage(5)).toBeNull();
    expect(quoteQuantityMessage(18)).toBeNull();
    expect(quoteQuantityMessage(0)).toMatch(/whole quantity/);
    expect(quoteQuantityMessage(1.5)).toMatch(/not rounded/);
  });

  it("proposes the next full case only when the quoted quantity is not already valid", () => {
    expect(proposeCustomerOrderQuantity({ quotedQty: 5, caseQty: 12 })).toMatchObject({
      orderQty: 12,
      changed: true,
    });
    expect(proposeCustomerOrderQuantity({ quotedQty: 18, caseQty: 12 })).toMatchObject({
      orderQty: 24,
      changed: true,
    });
    expect(proposeCustomerOrderQuantity({ quotedQty: 24, caseQty: 12 })).toMatchObject({
      orderQty: 24,
      changed: false,
    });
    expect(proposeCustomerOrderQuantity({ quotedQty: 7, caseQty: null })).toMatchObject({
      orderQty: 7,
      changed: false,
    });
    expect(proposeCustomerOrderQuantity({ quotedQty: 7, caseQty: 1 })).toMatchObject({
      orderQty: 7,
      changed: false,
    });
  });
});
