import { describe, expect, it } from "vitest";
import {
  classifyAutopartProduct,
  formatInternalAvailLine,
  formatInternalIncomingLine,
  parsePhysicalStkCell,
  productKindQualifier,
} from "@/domain/autopart-product";

describe("Autopart product classification", () => {
  it("classifies catalogue, external, and historic-only", () => {
    expect(classifyAutopartProduct({ hasCatalogueVariant: true, presentInLatestFeed: true })).toBe(
      "CATALOGUE",
    );
    expect(classifyAutopartProduct({ hasCatalogueVariant: true, presentInLatestFeed: false })).toBe(
      "CATALOGUE",
    );
    expect(classifyAutopartProduct({ hasCatalogueVariant: false, presentInLatestFeed: true })).toBe(
      "EXTERNAL",
    );
    expect(classifyAutopartProduct({ hasCatalogueVariant: false, presentInLatestFeed: false })).toBe(
      "HISTORIC_ONLY",
    );
  });

  it("formats live, zero, incoming, and stale stock copy", () => {
    expect(
      formatInternalAvailLine({ kind: "EXTERNAL", availQty: 14, stale: false }),
    ).toBe("14 available");
    expect(
      formatInternalIncomingLine({ kind: "EXTERNAL", incomingQty: 0, stale: false }),
    ).toBe("No incoming stock");
    expect(
      formatInternalAvailLine({ kind: "EXTERNAL", availQty: 0, stale: false }),
    ).toBe("Out of stock");
    expect(
      formatInternalIncomingLine({ kind: "EXTERNAL", incomingQty: 24, stale: false }),
    ).toBe("24 incoming");
    expect(
      formatInternalAvailLine({ kind: "EXTERNAL", availQty: 14, stale: true }),
    ).toBe("Stock data delayed");
    expect(
      formatInternalAvailLine({ kind: "HISTORIC_ONLY", availQty: 14, stale: false }),
    ).toBe("Historic only");
  });

  it("parses Physical Stk integers and blanks", () => {
    expect(parsePhysicalStkCell("12")).toBe(12);
    expect(parsePhysicalStkCell("12.0")).toBe(12);
    expect(parsePhysicalStkCell("")).toBeNull();
    expect(parsePhysicalStkCell("x")).toBeNull();
  });

  it("qualifies catalogue, external, and historic-only labels", () => {
    expect(productKindQualifier("EXTERNAL")).toBe("External product");
    expect(productKindQualifier("CATALOGUE", "Power Maxed")).toBe("Power Maxed");
    expect(productKindQualifier("HISTORIC_ONLY")).toBe("Historic only");
  });
});
