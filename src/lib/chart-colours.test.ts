import { describe, expect, it } from "vitest";
import { CHART_BAR_FILL } from "@/lib/chart-colours";

describe("chart colours", () => {
  it("uses the agreed red bar fill for monthly sales visibility", () => {
    expect(CHART_BAR_FILL).toBe("#EF4444");
  });
});
