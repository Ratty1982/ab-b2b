import { describe, expect, it } from "vitest";
import {
  categoryCreateSchema,
  productDraftSchema,
  slugifyCatalogue,
} from "@/domain/catalogue";

describe("catalogue domain", () => {
  it("slugifies category names", () => {
    expect(slugifyCatalogue("Brake Discs")).toBe("brake-discs");
    expect(slugifyCatalogue("Calipers & Fluid")).toBe("calipers-fluid");
  });

  it("accepts a nested category payload", () => {
    const parsed = categoryCreateSchema.parse({
      name: "Brake Pads",
      slug: "brake-pads",
      parentId: "",
      isActive: true,
      sortOrder: 1,
    });
    expect(parsed.name).toBe("Brake Pads");
    expect(parsed.parentId === "" || parsed.parentId == null).toBe(true);
  });

  it("requires a product SKU and name to save", () => {
    expect(productDraftSchema.safeParse({ sku: "", name: "X", brand: "A", category: "B", trade: 1, rrp: 1, packQty: 1, caseQty: 1 }).success).toBe(
      false,
    );
    expect(
      productDraftSchema.parse({
        sku: "PM-1",
        name: "Pad",
        brand: "Power Maxed",
        category: "Braking",
        trade: 10,
        rrp: 12,
        packQty: 1,
        caseQty: 8,
      }).sku,
    ).toBe("PM-1");
  });
});
