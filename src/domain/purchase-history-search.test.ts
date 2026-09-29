import { describe, expect, it } from "vitest";
import {
  compactPurchaseHistoryUrlSearch,
  parsePurchaseHistoryUrlSearch,
} from "@/domain/purchase-history-search";

describe("purchase history URL search", () => {
  it("parses purchased windows used by the portal dropdown", () => {
    expect(parsePurchaseHistoryUrlSearch({ purchased: "LAST_30" })).toEqual({
      purchased: "LAST_30",
    });
    expect(parsePurchaseHistoryUrlSearch({ purchased: "LAST_180" }).purchased).toBe("LAST_180");
    expect(parsePurchaseHistoryUrlSearch({ purchased: "bogus" })).toEqual({});
  });

  it("ignores spoofed companyId", () => {
    const parsed = parsePurchaseHistoryUrlSearch({
      purchased: "LAST_90",
      companyId: "clxxxxxxxxxxxxxxxxxxxx",
    });
    expect(parsed).toEqual({ purchased: "LAST_90" });
    expect(parsed).not.toHaveProperty("companyId");
  });

  it("compacts defaults so Any time is an empty search (refresh-stable)", () => {
    expect(
      compactPurchaseHistoryUrlSearch({
        purchased: "ANY",
        availability: "ALL",
        sort: "RECENT",
        page: 1,
      }),
    ).toEqual({});
    expect(compactPurchaseHistoryUrlSearch({ purchased: "LAST_30", page: 2 })).toEqual({
      purchased: "LAST_30",
      page: 2,
    });
  });

  it("keeps custom date bounds only when purchased=CUSTOM", () => {
    expect(
      compactPurchaseHistoryUrlSearch({
        purchased: "LAST_30",
        purchasedFrom: "2026-09-01",
        purchasedTo: "2026-09-29",
      }),
    ).toEqual({ purchased: "LAST_30" });
    expect(
      compactPurchaseHistoryUrlSearch({
        purchased: "CUSTOM",
        purchasedFrom: "2026-03-01",
        purchasedTo: "2026-03-31",
      }),
    ).toEqual({
      purchased: "CUSTOM",
      purchasedFrom: "2026-03-01",
      purchasedTo: "2026-03-31",
    });
  });
});
