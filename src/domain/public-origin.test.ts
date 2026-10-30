import { describe, expect, it } from "vitest";
import { absoluteCanonical, canonicalOrigin, isIndexablePublicPath } from "@/domain/public-origin";

describe("public origin", () => {
  it("uses the APP_URL origin without a path", () => {
    expect(canonicalOrigin("https://automotivebrands.co.uk/")).toBe(
      "https://automotivebrands.co.uk",
    );
    expect(canonicalOrigin("https://b2b.automotivebrands.co.uk/login")).toBe(
      "https://b2b.automotivebrands.co.uk",
    );
  });

  it("emits absolute canonicals for public pages and skips staff routes", () => {
    expect(absoluteCanonical("https://automotivebrands.co.uk", "/")).toBe(
      "https://automotivebrands.co.uk/",
    );
    expect(absoluteCanonical("https://automotivebrands.co.uk", "/products/SS-1")).toBe(
      "https://automotivebrands.co.uk/products/SS-1",
    );
    expect(absoluteCanonical("https://automotivebrands.co.uk", "/portal")).toBeNull();
    expect(absoluteCanonical("https://automotivebrands.co.uk", "/admin/orders")).toBeNull();
    expect(absoluteCanonical("https://automotivebrands.co.uk", "/api/internal/stock-sync")).toBeNull();
    expect(isIndexablePublicPath("/login")).toBe(false);
  });
});
