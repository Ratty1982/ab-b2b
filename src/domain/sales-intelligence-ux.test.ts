import { describe, expect, it } from "vitest";
import {
  clearedEnquiryTableFilters,
  clearedGapTableFilters,
  creditMovementHint,
  formatDateOnlyLongUk,
  formatPeriodRangeLong,
  hasActiveEnquiryTableFilters,
  hasActiveGapTableFilters,
  movementDirection,
  shouldShowEntitySuggestions,
  toggleGapStatusFilter,
} from "@/domain/sales-intelligence-ux";

describe("sales-intelligence UX helpers", () => {
  it("formats date-only as DD MMM YYYY", () => {
    expect(formatDateOnlyLongUk("2026-08-31")).toBe("31 Aug 2026");
    expect(formatDateOnlyLongUk("2026-09-29")).toBe("29 Sep 2026");
    expect(formatPeriodRangeLong("2026-08-31", "2026-09-29")).toBe(
      "31 Aug 2026 – 29 Sep 2026",
    );
  });

  it("movement direction from signed change", () => {
    expect(movementDirection(-794.1)).toBe("down");
    expect(movementDirection(12)).toBe("up");
    expect(movementDirection(0)).toBe("flat");
    expect(movementDirection("-89.52")).toBe("down");
  });

  it("credit movement hint uses absolute factual wording", () => {
    expect(creditMovementHint("-216.58", "-43.85")).toBe(
      "£172.73 more credits than comparison",
    );
    expect(creditMovementHint("-20.00", "-100.00")).toBe(
      "£80.00 fewer credits than comparison",
    );
    expect(creditMovementHint("-50.00", "-50.00")).toBe("No change vs comparison");
  });

  it("toggles gap status filter back to All Changes when re-clicked", () => {
    expect(toggleGapStatusFilter("ALL_CHANGES", "STOPPED")).toBe("STOPPED");
    expect(toggleGapStatusFilter("STOPPED", "STOPPED")).toBe("ALL_CHANGES");
    expect(toggleGapStatusFilter("STOPPED", "NEW")).toBe("NEW");
  });

  it("detects and clears gap table filters without touching entity/period", () => {
    expect(
      hasActiveGapTableFilters({
        status: "STOPPED",
        compareBy: "UNITS",
        sort: "NET_DECREASE",
      }),
    ).toBe(true);
    expect(hasActiveGapTableFilters({})).toBe(false);
    expect(clearedGapTableFilters()).toEqual({
      status: "ALL_CHANGES",
      compareBy: "UNITS",
      brandId: null,
      categoryId: null,
      salesRepId: null,
      q: null,
      sort: "NET_DECREASE",
    });
  });

  it("detects and clears enquiry table filters", () => {
    expect(hasActiveEnquiryTableFilters({ brandId: "b1" })).toBe(true);
    expect(hasActiveEnquiryTableFilters({})).toBe(false);
    expect(clearedEnquiryTableFilters()).toEqual({
      brandId: null,
      categoryId: null,
      salesRepId: null,
      q: null,
    });
  });

  it("hides entity suggestions once selected unless changing", () => {
    expect(
      shouldShowEntitySuggestions({
        entitySelected: true,
        changing: false,
        queryLength: 4,
        hitCount: 3,
      }),
    ).toBe(false);
    expect(
      shouldShowEntitySuggestions({
        entitySelected: true,
        changing: true,
        queryLength: 4,
        hitCount: 3,
      }),
    ).toBe(true);
    expect(
      shouldShowEntitySuggestions({
        entitySelected: false,
        changing: false,
        queryLength: 2,
        hitCount: 1,
      }),
    ).toBe(true);
  });
});
