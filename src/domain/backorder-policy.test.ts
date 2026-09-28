import { describe, expect, it } from "vitest";
import {
  DEFAULT_GLOBAL_BACKORDER_POLICY,
  DEFAULT_VARIANT_BACKORDER_POLICY,
  allocateOrderLineQuantities,
  resolveBackorderPolicy,
} from "@/domain/backorder";
import {
  publicAvailabilityFromStock,
} from "@/domain/availability";
import {
  assessBasketLineQuantity,
  resolveCustomerOrdering,
  validateOrderQuantity,
} from "@/domain/ordering";

describe("resolveBackorderPolicy", () => {
  it("variant ALLOW / DENY win over global", () => {
    expect(resolveBackorderPolicy({ globalPolicy: "DENY", variantPolicy: "ALLOW" })).toBe("ALLOW");
    expect(resolveBackorderPolicy({ globalPolicy: "ALLOW", variantPolicy: "DENY" })).toBe("DENY");
  });

  it("INHERIT uses global (default ALLOW)", () => {
    expect(resolveBackorderPolicy({ globalPolicy: "ALLOW", variantPolicy: "INHERIT" })).toBe("ALLOW");
    expect(resolveBackorderPolicy({ globalPolicy: "DENY", variantPolicy: "INHERIT" })).toBe("DENY");
    expect(resolveBackorderPolicy({ variantPolicy: "INHERIT" })).toBe("ALLOW");
    expect(resolveBackorderPolicy({})).toBe("ALLOW");
  });

  it("production defaults", () => {
    expect(DEFAULT_GLOBAL_BACKORDER_POLICY).toBe("ALLOW");
    expect(DEFAULT_VARIANT_BACKORDER_POLICY).toBe("INHERIT");
  });
});

describe("PMSCWASH-style zero-stock case backorder", () => {
  const caseQty = 4;
  const sellableQty = 0;
  const global = "ALLOW" as const;
  const variant = "INHERIT" as const;
  const effective = resolveBackorderPolicy({ globalPolicy: global, variantPolicy: variant });

  it("effective policy ALLOW + AVAILABLE_TO_BACKORDER + orderable", () => {
    expect(effective).toBe("ALLOW");
    expect(
      publicAvailabilityFromStock({
        sellableQty: 0,
        stale: false,
        unknown: false,
        backorderAllowed: effective === "ALLOW",
      }),
    ).toBe("backorder");

    const state = resolveCustomerOrdering({
      caseQty,
      sellableQty,
      backorderPolicy: effective,
    });
    expect(state.mode).toBe("CASE");
    expect(state.defaultQuantity).toBe(4);
    expect(state.minimumQuantity).toBe(4);
    expect(state.backordersAllowed).toBe(true);
  });

  it("qty 4 and 8 valid; qty 1 invalid", () => {
    const base = { caseQty, sellableQty, backorderPolicy: effective };
    expect(validateOrderQuantity({ ...base, requestedQuantity: 4 }).ok).toBe(true);
    expect(validateOrderQuantity({ ...base, requestedQuantity: 8 }).ok).toBe(true);
    expect(validateOrderQuantity({ ...base, requestedQuantity: 1 }).ok).toBe(false);
  });

  it("add-to-basket / basket / checkout path valid; reserved 0 backordered 4", () => {
    expect(
      assessBasketLineQuantity({
        quantity: 4,
        caseQty,
        sellableQty,
        productActive: true,
        tradeVisible: true,
        hasTradePrice: true,
        backorderPolicy: effective,
      }),
    ).toBe("VALID");

    const split = allocateOrderLineQuantities({ orderedQty: 4, sellableQty: 0 });
    expect(split).toMatchObject({
      orderedQty: 4,
      availableQtyAtOrder: 0,
      backorderQtyAtOrder: 4,
      reserveQty: 0,
    });
  });
});

describe("override and global-off matrix", () => {
  it("global ALLOW + variant DENY + Avail 0 → OUT_OF_STOCK / not orderable", () => {
    const effective = resolveBackorderPolicy({ globalPolicy: "ALLOW", variantPolicy: "DENY" });
    expect(effective).toBe("DENY");
    expect(
      publicAvailabilityFromStock({
        sellableQty: 0,
        stale: false,
        unknown: false,
        backorderAllowed: false,
      }),
    ).toBe("out");
    expect(
      resolveCustomerOrdering({ caseQty: 4, sellableQty: 0, backorderPolicy: effective }).mode,
    ).toBe("NOT_ORDERABLE");
  });

  it("global DENY + variant INHERIT + Avail 0 → OUT_OF_STOCK", () => {
    const effective = resolveBackorderPolicy({ globalPolicy: "DENY", variantPolicy: "INHERIT" });
    expect(effective).toBe("DENY");
    expect(
      resolveCustomerOrdering({ caseQty: 4, sellableQty: 0, backorderPolicy: effective }).mode,
    ).toBe("NOT_ORDERABLE");
  });

  it("global DENY + variant ALLOW + Avail 0 → AVAILABLE_TO_BACKORDER", () => {
    const effective = resolveBackorderPolicy({ globalPolicy: "DENY", variantPolicy: "ALLOW" });
    expect(effective).toBe("ALLOW");
    expect(
      resolveCustomerOrdering({ caseQty: 4, sellableQty: 0, backorderPolicy: effective }).mode,
    ).toBe("CASE");
    expect(
      publicAvailabilityFromStock({
        sellableQty: 0,
        stale: false,
        unknown: false,
        backorderAllowed: true,
      }),
    ).toBe("backorder");
  });
});

describe("partial stock with ALLOW", () => {
  it("caseQty 4 / Avail 2 / order 4 → reserved 2 backordered 2", () => {
    const effective = "ALLOW" as const;
    expect(
      validateOrderQuantity({
        requestedQuantity: 4,
        caseQty: 4,
        sellableQty: 2,
        backorderPolicy: effective,
      }).ok,
    ).toBe(true);
    expect(allocateOrderLineQuantities({ orderedQty: 4, sellableQty: 2 })).toMatchObject({
      availableQtyAtOrder: 2,
      backorderQtyAtOrder: 2,
      reserveQty: 2,
    });
  });
});

describe("stale stock + ALLOW", () => {
  it("untrusted positive stock treated as zero allocation but still backorderable", () => {
    const effective = "ALLOW" as const;
    // Callers pass trusted sellable = 0 when stale.
    const state = resolveCustomerOrdering({
      caseQty: 4,
      sellableQty: 0,
      orderableByStockPolicy: true,
      backorderPolicy: effective,
    });
    expect(state.mode).toBe("CASE");
    expect(allocateOrderLineQuantities({ orderedQty: 4, sellableQty: 0 }).reserveQty).toBe(0);
  });
});
