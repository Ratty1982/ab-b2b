import { describe, expect, it } from "vitest";
import {
  caseBreakNote,
  commercialWindowStatus,
  firstOrderableQuantity,
  parsePriceListImportCsv,
  priceDifferenceFromUnknown,
  priceListExportCsv,
  previewPromotionUnit,
  promotionDisplayState,
} from "@/domain/pricing-management";

describe("price difference (admin display)", () => {
  it("computes absolute and percentage without IEEE floats", () => {
    const diff = priceDifferenceFromUnknown("8.70", "7.95");
    expect(diff?.absoluteDisplay).toBe("-0.75");
    expect(diff?.percentLabel).toBe("-8.6%");
    expect(diff?.signedDisplay).toBe("£-0.75 (-8.6%)");
  });
});

describe("customer / promotion validity", () => {
  const at = new Date("2026-09-21T12:00:00.000Z");

  it("treats open-ended windows as active", () => {
    expect(commercialWindowStatus(at, null, null)).toBe("active");
  });

  it("marks start-only future as scheduled and past end as expired", () => {
    expect(commercialWindowStatus(at, new Date("2026-10-01T00:00:00.000Z"), null)).toBe("scheduled");
    expect(commercialWindowStatus(at, null, new Date("2026-09-01T00:00:00.000Z"))).toBe("expired");
  });

  it("uses both bounds when present", () => {
    expect(
      commercialWindowStatus(at, new Date("2026-09-01T00:00:00.000Z"), new Date("2026-09-30T00:00:00.000Z")),
    ).toBe("active");
  });

  it("disabled promotions are never shown as live", () => {
    expect(promotionDisplayState(at, false, null, null)).toBe("disabled");
    expect(promotionDisplayState(at, true, null, null)).toBe("active");
  });
});

describe("case quantity informational helper", () => {
  it("does not rewrite a stored threshold of 10 when caseQty is 6", () => {
    expect(firstOrderableQuantity(10, 6)).toBe(12);
    expect(caseBreakNote(10, 6)).toBe("First orderable quantity meeting this break: 12 units (2 cases).");
  });

  it("leaves the threshold unchanged when already a case multiple", () => {
    expect(firstOrderableQuantity(12, 6)).toBe(12);
  });
});

describe("promotion preview", () => {
  it("applies PERCENT as percentage off", () => {
    const preview = previewPromotionUnit({ unitPrice: "8.70", type: "PERCENT", value: "10" });
    expect(preview.resultDisplay).toBe("7.83");
  });

  it("applies FIXED as amount-off per unit", () => {
    const preview = previewPromotionUnit({ unitPrice: "8.70", type: "FIXED", value: "0.50" });
    expect(preview.result).toBe("8.2000");
  });

  it("does not apply QUANTITY_DEAL", () => {
    const preview = previewPromotionUnit({ unitPrice: "8.70", type: "QUANTITY_DEAL", value: "12" });
    expect(preview.applied).toBe(false);
    expect(preview.note).toMatch(/not currently applied/i);
  });
});

describe("price list CSV", () => {
  it("parses sku,price and flags duplicates and invalid prices", () => {
    const parsed = parsePriceListImportCsv("sku,price\nGC5000,7.95\nGC5000,8.00\nBAD,nope\nABC123,11.50");
    expect(parsed.rows.map((r) => r.sku)).toEqual(["GC5000", "ABC123"]);
    expect(parsed.issues.some((i) => i.kind === "duplicate_sku")).toBe(true);
    expect(parsed.issues.some((i) => i.kind === "invalid_price")).toBe(true);
  });

  it("exports the suggested columns", () => {
    const csv = priceListExportCsv([
      {
        sku: "GC5000",
        productName: "Window & Glass Cleaner 5 Litre",
        baseTradePrice: "8.7000",
        priceListPrice: "7.9500",
      },
    ]);
    expect(csv.split("\n")[0]).toBe("sku,productName,baseTradePrice,priceListPrice");
    expect(csv).toContain("GC5000");
  });
});
