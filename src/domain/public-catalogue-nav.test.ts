import { categoryIdsForFilter, flattenCategorySlugs, nestPublicCategories } from "@/domain/public-catalogue-nav";
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
