import { categoryIdsForFilter, flattenCategorySlugs, nestPublicCategories, pruneEmptyCategoryBranches, resolveAllBrandsTarget, resolveBrandSwitchTarget } from "@/domain/public-catalogue-nav";
import { describe, expect, it } from "vitest";

describe("public catalogue category navigation", () => {
  const rows = [
    { id: "p1", slug: "vehicle-cleaning", name: "Vehicle Cleaning", parentId: null, sortOrder: 1 },
    { id: "c1", slug: "exterior", name: "Exterior Cleaning", parentId: "p1", sortOrder: 2 },
    { id: "c2", slug: "interior", name: "Interior Cleaning", parentId: "p1", sortOrder: 1 },
    { id: "p2", slug: "additives", name: "Additives", parentId: null, sortOrder: 2 },
    { id: "orphan", slug: "hidden-child", name: "Hidden Child", parentId: "inactive-parent", sortOrder: 9 },
  ];

  it("nests children under parents in sort then name order", () => {
    const tree = nestPublicCategories(rows);
    expect(tree.map((n) => n.slug)).toEqual(["vehicle-cleaning", "additives", "hidden-child"]);
    expect(tree[0]?.children.map((n) => n.slug)).toEqual(["interior", "exterior"]);
  });

  it("rolls public product counts into parents without N+1", () => {
    const counts = new Map([
      ["p1", 2],
      ["c1", 10],
      ["c2", 4],
      ["p2", 16],
    ]);
    const tree = nestPublicCategories(rows, counts);
    expect(tree[0]?.productCount).toBe(16);
    expect(tree[0]?.children[0]?.productCount).toBe(4);
    expect(tree[1]?.productCount).toBe(16);
  });

  it("prunes zero-count branches but keeps parents that only have descendant products", () => {
    const counts = new Map([
      ["c1", 6],
      ["p2", 0],
    ]);
    const tree = pruneEmptyCategoryBranches(nestPublicCategories(rows, counts));
    expect(tree.map((n) => n.slug)).toEqual(["vehicle-cleaning"]);
    expect(tree[0]?.productCount).toBe(6);
    expect(tree[0]?.children.map((n) => n.slug)).toEqual(["exterior"]);
    expect(tree.some((n) => n.slug === "additives")).toBe(false);
  });

  it("keeps a parent with own products after empty children are removed", () => {
    const counts = new Map([["p1", 2]]);
    const tree = pruneEmptyCategoryBranches(nestPublicCategories(rows, counts));
    expect(tree[0]?.slug).toBe("vehicle-cleaning");
    expect(tree[0]?.productCount).toBe(2);
    expect(tree[0]?.children).toEqual([]);
  });

  it("collects descendant category ids for filtering without flattening the nav tree", () => {
    const tree = nestPublicCategories(rows);
    expect(flattenCategorySlugs(tree)).toEqual([
      "vehicle-cleaning",
      "interior",
      "exterior",
      "additives",
      "hidden-child",
    ]);
    expect(categoryIdsForFilter(rows, "p1").sort()).toEqual(["c1", "c2", "p1"].sort());
  });
});

describe("brand switch category preservation", () => {
  const slugsByBrand = {
    "power-maxed": ["vehicle-cleaning", "exterior", "interior"],
    "steel-seal": ["additives"],
  };

  it("preserves a compatible category when switching brand", () => {
    expect(
      resolveBrandSwitchTarget(
        { categorySlug: "vehicle-cleaning", categorySlugsByBrand: slugsByBrand },
        "power-maxed",
      ),
    ).toEqual({
      to: "/products/category/$slug",
      params: { slug: "vehicle-cleaning" },
      search: { brand: "power-maxed" },
    });
  });

  it("drops an incompatible category when switching brand", () => {
    expect(
      resolveBrandSwitchTarget(
        { categorySlug: "exterior", q: "cleaner", categorySlugsByBrand: slugsByBrand },
        "steel-seal",
      ),
    ).toEqual({
      to: "/products",
      search: { q: "cleaner", brand: "steel-seal" },
    });
  });

  it("preserves compatible category on the brand route", () => {
    expect(
      resolveBrandSwitchTarget(
        {
          brandRoute: true,
          categorySlug: "additives",
          categorySlugsByBrand: slugsByBrand,
        },
        "steel-seal",
      ),
    ).toEqual({
      to: "/brands/$slug",
      params: { slug: "steel-seal" },
      search: { category: "additives" },
    });
  });

  it("keeps the category when returning to All Brands", () => {
    expect(resolveAllBrandsTarget({ categorySlug: "exterior", q: "wax" })).toEqual({
      to: "/products/category/$slug",
      params: { slug: "exterior" },
      search: { q: "wax" },
    });
  });
});
