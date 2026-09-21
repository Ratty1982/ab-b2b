import { describe, expect, it } from "vitest";
import { PUBLIC_AVAILABILITY_LABEL } from "@/domain/availability";
import {
  classifyPublicSpec,
  featuresForDisplay,
  formatCatalogueSize,
  formatPublicSpecRows,
  formatSpecLabel,
  formatSpecValue,
  hasPublicText,
  parseDirections,
  selectPublicProductDetailRows,
} from "@/domain/product-spec-display";
import {
  PRODUCT_IMAGE_DETAIL_STAGE_CLASS,
  PRODUCT_IMAGE_FIT_CLASS,
  PRODUCT_IMAGE_LIVE_SURFACE_CLASS,
  PRODUCT_IMAGE_MISSING_SURFACE_CLASS,
} from "@/components/public/ProductImage";

describe("public product specification display", () => {
  it("formats camelCase and snake_case labels", () => {
    expect(formatSpecLabel("fastEvaporating")).toBe("Fast Evaporating");
    expect(formatSpecLabel("fast_evaporating")).toBe("Fast Evaporating");
    expect(formatSpecLabel("tintedWindowSafe")).toBe("Tinted Window Safe");
    expect(formatSpecLabel("tinted_window_safe")).toBe("Tinted Window Safe");
    expect(formatSpecLabel("productType")).toBe("Product Type");
    expect(formatSpecLabel("residueFree")).toBe("Residue Free");
    expect(
      formatPublicSpecRows([
        { name: "fastEvaporating", value: "true" },
        { name: "fast_evaporating", value: "false" },
      ]),
    ).toEqual([
      { label: "Fast Evaporating", value: "Yes" },
      { label: "Fast Evaporating", value: "No" },
    ]);
  });

  it("formats booleans as Yes/No", () => {
    expect(formatSpecValue("true")).toBe("Yes");
    expect(formatSpecValue("false")).toBe("No");
  });

  it("uses canonical catalogue sizes", () => {
    expect(formatCatalogueSize("5L")).toBe("5 Litre");
    expect(formatCatalogueSize("5 l")).toBe("5 Litre");
    expect(formatCatalogueSize("1 Litre")).toBe("1 Litre");
    expect(formatCatalogueSize("500ml")).toBe("500ml");
    expect(formatCatalogueSize("25L")).toBe("25 Litre");
    expect(formatCatalogueSize("2L")).toBe("2 Litre");
    expect(formatCatalogueSize("2 Litre")).toBe("2 Litre");
    expect(formatPublicSpecRows([{ name: "size", value: "5L" }])).toEqual([{ label: "Size", value: "5 Litre" }]);
    expect(
      formatPublicSpecRows([
        { name: "finish", value: "Streak-Free" },
        { name: "residueFree", value: "true" },
      ]),
    ).toEqual([
      { label: "Finish", value: "Streak-Free" },
      { label: "Residue Free", value: "Yes" },
    ]);
  });

  it("publishes only useful product details and technical specs", () => {
    const gc5000 = selectPublicProductDetailRows({
      specifications: [
        { name: "size", value: "5L" },
        { name: "productType", value: "Glass Cleaner" },
        { name: "form", value: "Liquid" },
        { name: "finish", value: "Streak-Free" },
        { name: "residueFree", value: "true" },
        { name: "fastEvaporating", value: "true" },
        { name: "tinted_window_safe", value: "true" },
      ],
    });
    expect(gc5000).toEqual([
      { label: "Size", value: "5 Litre" },
      { label: "Product Type", value: "Glass Cleaner" },
      { label: "Form", value: "Liquid" },
    ]);
    expect(gc5000.some((row) => /residue|evaporat|tinted|finish/i.test(row.label))).toBe(false);
    expect(classifyPublicSpec("residueFree", "true")).toBe("hidden");
    expect(classifyPublicSpec("voltage", "12V")).toBe("technical");
    const charger = selectPublicProductDetailRows({
      specifications: [
        { name: "productType", value: "Battery Charger" },
        { name: "voltage", value: "12V" },
        { name: "chargingCurrent", value: "5A" },
        { name: "cableLength", value: "1.5m" },
        { name: "residueFree", value: "true" },
      ],
    });
    expect(charger).toEqual([
      { label: "Product Type", value: "Battery Charger" },
      { label: "Voltage", value: "12V" },
      { label: "Charging Current", value: "5A" },
      { label: "Cable Length", value: "1.5m" },
    ]);
  });

  it("omits empty product-detail placeholders and does not invent EAN/MPN", () => {
    expect(
      selectPublicProductDetailRows({
        specifications: [
          { name: "size", value: "" },
          { name: "form", value: "N/A" },
          { name: "productType", value: "Glass Cleaner" },
        ],
        ean: null,
        mpn: "  ",
      }),
    ).toEqual([{ label: "Product Type", value: "Glass Cleaner" }]);
  });
});

describe("public product content sections", () => {
  it("treats empty strings as absent", () => {
    expect(hasPublicText(null)).toBe(false);
    expect(hasPublicText("")).toBe(false);
    expect(hasPublicText("  ")).toBe(false);
    expect(hasPublicText("Apply and wipe")).toBe(true);
  });

  it("parses numbered directions", () => {
    const parsed = parseDirections("1. Spray the glass\n2. Wipe dry");
    expect(parsed.kind).toBe("steps");
    if (parsed.kind === "steps") expect(parsed.steps).toEqual(["Spray the glass", "Wipe dry"]);
  });

  it("keeps overlapping feature copy from repeating a benefit on the page", () => {
    const features = featuresForDisplay(
      ["Suitable for tinted windows"],
      ["Safe for tinted windows", "Professional-grade glass cleaner"],
    );
    expect(features).toEqual(["Professional-grade glass cleaner"]);
  });
});

describe("public product page presentation contracts", () => {
  it("keeps live imagery contained on a light stage and missing images dark", () => {
    expect(PRODUCT_IMAGE_FIT_CLASS).toContain("object-contain");
    expect(PRODUCT_IMAGE_FIT_CLASS).not.toContain("object-cover");
    expect(PRODUCT_IMAGE_LIVE_SURFACE_CLASS).toContain("product-studio");
    expect(PRODUCT_IMAGE_MISSING_SURFACE_CLASS).toContain("bg-surface");
    expect(PRODUCT_IMAGE_DETAIL_STAGE_CLASS).toContain("lg:h-[520px]");
    expect(PRODUCT_IMAGE_DETAIL_STAGE_CLASS).not.toContain("aspect-[4/5]");
    expect(PRODUCT_IMAGE_DETAIL_STAGE_CLASS).not.toContain("max-h-[36rem]");
  });

  it("never exposes stock quantity in public availability labels", () => {
    expect(Object.values(PUBLIC_AVAILABILITY_LABEL).join(" ")).not.toMatch(/\d/);
    expect(PUBLIC_AVAILABILITY_LABEL.in).toBe("In Stock");
    expect(PUBLIC_AVAILABILITY_LABEL.low).toBe("Low Stock");
    expect(PUBLIC_AVAILABILITY_LABEL.out).toBe("Out of Stock");
  });
});
