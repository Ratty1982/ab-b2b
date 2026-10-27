import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("purchasing demand excludes OIN replenishment", () => {
  it("keeps OIN document references out of B2B demand and sales-trend SQL", () => {
    const demand = readFileSync(new URL("./demand.ts", import.meta.url), "utf8");
    const trend = readFileSync(new URL("./sales-trend.ts", import.meta.url), "utf8");
    expect(demand.match(/NOT LIKE 'OIN%'/g)?.length).toBe(5);
    expect(trend.match(/NOT LIKE 'OIN%'/g)?.length).toBe(4);
    expect(demand).not.toContain("AutopartSalesDocument.delete");
    expect(trend).not.toContain("AutopartSalesLine.delete");
  });
});
