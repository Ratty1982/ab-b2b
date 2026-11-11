import { describe, expect, it } from "vitest";
import { isZeroSellingPrice, zeroValueReasonForPrice } from "@/domain/zero-value-reason";

describe("zero value reasons", () => {
  it("treats only a £0.00 selling price as zero", () => {
    expect(isZeroSellingPrice("0.00")).toBe(true);
    expect(isZeroSellingPrice("0")).toBe(true);
    expect(isZeroSellingPrice("0.01")).toBe(false);
    expect(isZeroSellingPrice("10.00")).toBe(false);
  });

  it("requires a reason for a zero price and details when Other is selected", () => {
    expect(zeroValueReasonForPrice({ customerUnitPrice: "10.00", code: null, detail: null })).toEqual({
      ok: true,
      code: null,
      detail: null,
    });
    expect(zeroValueReasonForPrice({ customerUnitPrice: "0.00" }).ok).toBe(false);
    expect(zeroValueReasonForPrice({ customerUnitPrice: "0.00", code: "WARRANTY" })).toMatchObject({
      ok: true,
      code: "WARRANTY",
    });
    expect(zeroValueReasonForPrice({ customerUnitPrice: "0.00", code: "OTHER", detail: " " }).ok).toBe(false);
    expect(
      zeroValueReasonForPrice({ customerUnitPrice: "0.00", code: "OTHER", detail: "Show van sample" }),
    ).toMatchObject({ ok: true, detail: "Show van sample" });
  });
});
