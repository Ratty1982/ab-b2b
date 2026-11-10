import { describe, expect, it } from "vitest";
import {
  publicCategoryMetaDescription,
  publicCategorySubtitle,
  publicProductCountLabel,
} from "@/domain/public-category-heading";

describe("public category headings", () => {
  it("formats customer-friendly product counts", () => {
    expect(publicProductCountLabel(0)).toBe("0 products");
    expect(publicProductCountLabel(1)).toBe("1 product");
    expect(publicProductCountLabel(18)).toBe("18 products");
    expect(publicProductCountLabel(18)).not.toMatch(/trade-visible|line/i);
  });

  it("returns trimmed category descriptions and omits empty ones", () => {
    expect(publicCategorySubtitle("  Cleaners for workshops.  ")).toBe("Cleaners for workshops.");
    expect(publicCategorySubtitle("")).toBeNull();
    expect(publicCategorySubtitle(null)).toBeNull();
    expect(publicCategorySubtitle(undefined)).toBeNull();
  });

  it("builds SEO meta from the stored description with a sensible length", () => {
    const short = publicCategoryMetaDescription({
      name: "Cleaners",
      description: "Professional cleaners for trade customers.",
    });
    expect(short).toBe("Professional cleaners for trade customers.");

    const long = "A".repeat(200);
    const meta = publicCategoryMetaDescription({ name: "Cleaners", description: long });
    expect(meta.length).toBeLessThanOrEqual(160);
    expect(meta.endsWith("…")).toBe(true);

    const fallback = publicCategoryMetaDescription({ name: "Cleaners", description: null });
    expect(fallback).toContain("Cleaners");
    expect(fallback).not.toMatch(/trade-visible/i);
  });
});
