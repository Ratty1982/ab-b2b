import { describe, expect, it } from "vitest";
import {
  compareAbOrderTo504cFinancials,
  withinPennyTolerance,
} from "@/domain/autopart-504c-plan";

describe("504C financial comparison (SDEL-aware)", () => {
  it("reconciles AB-000003: goods+delivery vs 504C Goods", () => {
    const cmp = compareAbOrderTo504cFinancials({
      abGoods: "10.56",
      abDelivery: "5.95",
      abVat: "3.30",
      abTotal: "19.81",
      c504Goods: "16.51",
      c504Vat: "3.30",
      c504Value: "19.81",
    });
    expect(cmp.abNet).toBe("16.51");
    expect(cmp.status).toBe("OK");
    expect(cmp.netOk).toBe(true);
    expect(cmp.vatOk).toBe(true);
    expect(cmp.totalOk).toBe(true);
  });

  it("does not compare 504C Goods only against merchandise goods", () => {
    const wrong = compareAbOrderTo504cFinancials({
      abGoods: "10.56",
      abDelivery: "0.00",
      abVat: "3.30",
      abTotal: "19.81",
      c504Goods: "16.51",
      c504Vat: "3.30",
      c504Value: "19.81",
    });
    expect(wrong.status).toBe("MISMATCH");
    expect(wrong.netOk).toBe(false);
  });

  it("allows ±1p tolerance and flags larger mismatches", () => {
    expect(withinPennyTolerance("16.51", "16.50")).toBe(true);
    expect(withinPennyTolerance("16.51", "16.49")).toBe(false);
    const cmp = compareAbOrderTo504cFinancials({
      abGoods: "10.56",
      abDelivery: "5.95",
      abVat: "3.30",
      abTotal: "19.81",
      c504Goods: "16.40",
      c504Vat: "3.30",
      c504Value: "19.70",
    });
    expect(cmp.status).toBe("MISMATCH");
    expect(cmp.netOk).toBe(false);
  });
});
