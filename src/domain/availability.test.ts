import { describe, expect, it } from "vitest";
import { publicAvailabilityFromQty, PUBLIC_AVAILABILITY_LABEL, publicAvailabilityFromStock } from "@/domain/availability";

describe("public availability contract", () => {
  it("maps quantities without exposing the count", () => {
    expect(publicAvailabilityFromQty(21)).toBe("in");
    expect(publicAvailabilityFromQty(100)).toBe("in");
    expect(publicAvailabilityFromQty(20)).toBe("low");
    expect(publicAvailabilityFromQty(1)).toBe("low");
    expect(publicAvailabilityFromQty(0)).toBe("out");
    expect(publicAvailabilityFromQty(-4)).toBe("out");
    expect(publicAvailabilityFromQty(null)).toBeNull();
    expect(publicAvailabilityFromQty(undefined)).toBeNull();
  });

  it("labels bands without quantities", () => {
    expect(PUBLIC_AVAILABILITY_LABEL.in).toBe("In Stock");
    expect(PUBLIC_AVAILABILITY_LABEL.low).toBe("Low Stock");
    expect(PUBLIC_AVAILABILITY_LABEL.out).toBe("Out of Stock");
  });

  it("does not present stale positive stock as in/low stock", () => {
    expect(publicAvailabilityFromStock({ sellableQty: 36, stale: true, unknown: false })).toBeNull();
    expect(publicAvailabilityFromStock({ sellableQty: 0, stale: true, unknown: false })).toBe("out");
    expect(publicAvailabilityFromStock({ sellableQty: 8, stale: false, unknown: false })).toBe("low");
    expect(publicAvailabilityFromStock({ sellableQty: 10, stale: false, unknown: true })).toBeNull();
  });
});
