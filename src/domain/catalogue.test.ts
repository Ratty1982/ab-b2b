import { describe, expect, it } from "vitest";
import {
  categoryCreateSchema,
  categoryDeleteSchema,
  productDraftSchema,
  shouldSeedDefaultCatalogue,
  slugifyCatalogue,
} from "@/domain/catalogue";
import { parseProductCsv, serializeProductCsv } from "@/domain/catalogue-csv";

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

  it("requires a category id to delete", () => {
    expect(categoryDeleteSchema.safeParse({}).success).toBe(false);
    expect(categoryDeleteSchema.parse({ id: "clxxxxxxxxxxxxxxxxxxxxxxxxx" }).id).toMatch(/^c/);
  });

  it("only seeds default catalogue data on a true first install", () => {
    expect(shouldSeedDefaultCatalogue(0, 0)).toBe(true);
    expect(shouldSeedDefaultCatalogue(0, 5)).toBe(false);
    expect(shouldSeedDefaultCatalogue(8, 0)).toBe(false);
    expect(shouldSeedDefaultCatalogue(8, 5)).toBe(false);
  });

  it("requires a product SKU and name to save", () => {
    expect(
      productDraftSchema.safeParse({
        sku: "",
        name: "X",
        brand: "A",
        category: "B",
        trade: 1,
        rrp: 1,
        packQty: 1,
        caseQty: 1,
      }).success,
    ).toBe(false);
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

  it("parses and serializes a product CSV round-trip", () => {
    const csv = serializeProductCsv([
      {
        sku: "PM-9",
        name: 'Kit, "ceramic"',
        brand: "Power Maxed",
        category: "Braking",
        subcategory: "Brake Discs",
        trade: 10.5,
        rrp: 12,
        packQty: 2,
        caseQty: 8,
        vat: "standard",
        description: "Line\nbreak",
        isActive: true,
      },
    ]);
    const parsed = parseProductCsv(csv);
    expect(parsed.errors).toEqual([]);
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.rows[0]?.sku).toBe("PM-9");
    expect(parsed.rows[0]?.name).toBe('Kit, "ceramic"');
    expect(parsed.rows[0]?.subcategory).toBe("Brake Discs");
  });

  it("rejects a CSV without sku/name/brand", () => {
    const parsed = parseProductCsv("foo,bar\n1,2\n");
    expect(parsed.rows).toHaveLength(0);
    expect(parsed.errors[0]?.message).toMatch(/sku/i);
  });
});
