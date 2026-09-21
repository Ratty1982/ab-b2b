import { describe, expect, it } from "vitest";
import { publicAvailabilityFromQty, PUBLIC_AVAILABILITY_LABEL } from "@/domain/availability";

describe("public availability contract", () => {
  it("maps quantities without exposing the count", () => {
    expect(publicAvailabilityFromQty(21)).toBe("in");
    expect(publicAvailabilityFromQty(100)).toBe("in");
    expect(publicAvailabilityFromQty(20)).toBe("low");
    expect(publicAvailabilityFromQty(1)).toBe("low");
    expect(publicAvailabilityFromQty(0)).toBe("out");
    expect(publicAvailabilityFromQty(null)).toBeNull();
    expect(publicAvailabilityFromQty(undefined)).toBeNull();
  });

  it("labels bands without quantities", () => {
    expect(PUBLIC_AVAILABILITY_LABEL.in).toBe("In Stock");
    expect(PUBLIC_AVAILABILITY_LABEL.low).toBe("Low Stock");
    expect(PUBLIC_AVAILABILITY_LABEL.out).toBe("Out of Stock");
  });
});
