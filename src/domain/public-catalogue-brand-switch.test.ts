import { describe, expect, it } from "vitest";
import {
  activeBrandMismatchesCategoryTree,
  appliedCatalogueNav,
  brandPageLoaderDeps,
  catalogueRouteMatchId,
  catalogueSidebarContext,
  flattenCategorySlugs,
  productsCategoryLoaderDeps,
  productsIndexLoaderDeps,
  resolveBrandSwitchTarget,
  type PublicCategoryNavNode,
} from "@/domain/public-catalogue-nav";

const slugsByBrand = {
  "power-maxed": [
    "exterior-cleaning",
    "500ml-exterior-cleaning",
    "additives",
    "interior-cleaning",
  ],
  "steel-seal": ["repair-products"],
};

const powerMaxedTree: PublicCategoryNavNode[] = [
  {
    slug: "exterior-cleaning",
    name: "Exterior Cleaning",
    productCount: 4,
    children: [
      { slug: "500ml-exterior-cleaning", name: "500ml Exterior Cleaning", productCount: 1, children: [] },
    ],
  },
  { slug: "additives", name: "Additives", productCount: 2, children: [] },
  { slug: "interior-cleaning", name: "Interior Cleaning", productCount: 1, children: [] },
];

const steelSealTree: PublicCategoryNavNode[] = [
  { slug: "repair-products", name: "Repair Products", productCount: 1, children: [] },
];

const loaders = {
  "power-maxed": appliedCatalogueNav({
    brandSlug: "power-maxed",
    categories: powerMaxedTree,
    categorySlugsByBrand: slugsByBrand,
  }),
  "steel-seal": appliedCatalogueNav({
    brandSlug: "steel-seal",
    categories: steelSealTree,
    categorySlugsByBrand: slugsByBrand,
  }),
};

type ListingUrl = {
  routeId: string;
  path: string;
  search: { brand?: string; q?: string; page?: number; category?: string };
};

function productsUrl(brand: string, extra?: { q?: string; category?: string }): ListingUrl {
  return {
    routeId: "/products/",
    path: "/products/",
    search: { brand, ...extra },
  };
}

function productsCategoryUrl(category: string, brand: string, extra?: { q?: string }): ListingUrl {
  return {
    routeId: "/products/category/$slug",
    path: `/products/category/${category}`,
    search: { brand, ...extra },
  };
}

function brandUrl(slug: string, extra?: { q?: string; category?: string }): ListingUrl {
  return {
    routeId: "/brands/$slug",
    path: `/brands/${slug}`,
    search: { ...extra },
  };
}

function matchIdFor(url: ListingUrl, includeLoaderDeps: boolean): string {
  if (url.routeId === "/brands/$slug") {
    const deps = includeLoaderDeps ? brandPageLoaderDeps(url.search) : "";
    return catalogueRouteMatchId(url.routeId, url.path, deps);
  }
  if (url.routeId === "/products/category/$slug") {
    const deps = includeLoaderDeps
      ? productsCategoryLoaderDeps(url.search, url.path.split("/").pop() ?? "")
      : "";
    return catalogueRouteMatchId(url.routeId, url.path, deps);
  }
  const deps = includeLoaderDeps ? productsIndexLoaderDeps(url.search) : "";
  return catalogueRouteMatchId(url.routeId, url.path, deps);
}

function fetchLoader(url: ListingUrl) {
  const brand = url.routeId === "/brands/$slug" ? url.path.replace("/brands/", "") : url.search.brand;
  const base = brand === "steel-seal" ? loaders["steel-seal"] : loaders["power-maxed"];
  const brandKey = base.brandSlug === "steel-seal" || base.brandSlug === "power-maxed" ? base.brandSlug : null;
  const keepCategory =
    url.search.category && brandKey && slugsByBrand[brandKey]?.includes(url.search.category)
      ? url.search.category
      : url.routeId === "/products/category/$slug"
        ? url.path.split("/").pop()
        : undefined;
  const categorySlug =
    keepCategory && brandKey && slugsByBrand[brandKey]?.includes(keepCategory) ? keepCategory : null;
  return appliedCatalogueNav({
    ...base,
    q: url.search.q,
    brandRoute: url.routeId === "/brands/$slug",
    categorySlug,
    categories: categorySlug
      ? base.categories.filter((node) => node.slug === categorySlug || flattenCategorySlugs([node]).includes(categorySlug))
      : base.categories,
  });
}

function simulate(includeLoaderDeps: boolean) {
  const cache = new Map<string, ReturnType<typeof fetchLoader>>();
  const history: ListingUrl[] = [];
  let cursor = -1;
  const render = (url: ListingUrl) => {
    const id = matchIdFor(url, includeLoaderDeps);
    if (!cache.has(id)) cache.set(id, fetchLoader(url));
    const loader = cache.get(id)!;
    const urlBrand = url.routeId === "/brands/$slug" ? url.path.replace("/brands/", "") : (url.search.brand ?? null);
    const mixed = {
      brandSlug: urlBrand,
      categories: loader.categories,
      categorySlugsByBrand: loader.categorySlugsByBrand,
    };
    const atomic = loader;
    return {
      url,
      urlBrand,
      mixed,
      atomic,
      mixedMismatch: activeBrandMismatchesCategoryTree(mixed),
      atomicMismatch: activeBrandMismatchesCategoryTree(atomic),
    };
  };
  const go = (url: ListingUrl) => {
    history.splice(cursor + 1);
    history.push(url);
    cursor = history.length - 1;
    return render(url);
  };
  const back = () => {
    cursor -= 1;
    return render(history[cursor]!);
  };
  const forward = () => {
    cursor += 1;
    return render(history[cursor]!);
  };
  return { go, back, forward };
}

describe("client-side brand switching match identity", () => {
  it("treats /products?brand=power-maxed and ?brand=steel-seal as the same match without loaderDeps (the production bug)", () => {
    expect(matchIdFor(productsUrl("power-maxed"), false)).toBe(matchIdFor(productsUrl("steel-seal"), false));
  });

  it("gives each products brand a distinct match once loaderDeps include brand", () => {
    expect(matchIdFor(productsUrl("power-maxed"), true)).not.toBe(matchIdFor(productsUrl("steel-seal"), true));
    expect(productsIndexLoaderDeps({ brand: "power-maxed" })).toEqual({
      brand: "power-maxed",
      q: "",
      page: 1,
    });
    expect(productsIndexLoaderDeps({ brand: "steel-seal", q: "cleaner" })).toEqual({
      brand: "steel-seal",
      q: "cleaner",
      page: 1,
    });
  });

  it("revalidates /products/category/$slug when only the brand search param changes", () => {
    const pm = productsCategoryUrl("exterior-cleaning", "power-maxed");
    const ss = productsCategoryUrl("exterior-cleaning", "steel-seal");
    expect(matchIdFor(pm, false)).toBe(matchIdFor(ss, false));
    expect(matchIdFor(pm, true)).not.toBe(matchIdFor(ss, true));
  });

  it("already distinguishes brand-route slugs by path, and still keys category/q search", () => {
    expect(matchIdFor(brandUrl("power-maxed"), false)).not.toBe(matchIdFor(brandUrl("steel-seal"), false));
    expect(matchIdFor(brandUrl("steel-seal", { category: "repair-products" }), false)).toBe(
      matchIdFor(brandUrl("steel-seal"), false),
    );
    expect(matchIdFor(brandUrl("steel-seal", { category: "repair-products" }), true)).not.toBe(
      matchIdFor(brandUrl("steel-seal"), true),
    );
  });
});

describe("client-side Power Maxed ↔ Steel Seal switching", () => {
  it("keeps stale Power Maxed categories when mixing new URL brand with a reused products match", () => {
    const { go } = simulate(false);
    const first = go(productsUrl("power-maxed"));
    expect(first.mixed.brandSlug).toBe("power-maxed");
    expect(flattenCategorySlugs(first.atomic.categories)).toContain("exterior-cleaning");
    expect(first.mixedMismatch).toBe(false);

    const second = go(productsUrl("steel-seal"));
    expect(second.mixed.brandSlug).toBe("steel-seal");
    expect(flattenCategorySlugs(second.mixed.categories)).toContain("exterior-cleaning");
    expect(flattenCategorySlugs(second.mixed.categories)).not.toContain("repair-products");
    expect(second.mixedMismatch).toBe(true);
  });

  it("immediately swaps category trees on Power Maxed → Steel Seal → Power Maxed → Steel Seal", () => {
    const { go } = simulate(true);
    const sequence = ["power-maxed", "steel-seal", "power-maxed", "steel-seal"] as const;
    for (const brand of sequence) {
      const frame = go(productsUrl(brand));
      expect(frame.atomic.brandSlug).toBe(brand);
      expect(frame.atomicMismatch).toBe(false);
      expect(frame.mixedMismatch).toBe(false);
      if (brand === "power-maxed") {
        expect(flattenCategorySlugs(frame.atomic.categories)).toContain("exterior-cleaning");
        expect(flattenCategorySlugs(frame.atomic.categories)).not.toContain("repair-products");
      } else {
        expect(flattenCategorySlugs(frame.atomic.categories)).toEqual(["repair-products"]);
        expect(flattenCategorySlugs(frame.atomic.categories)).not.toContain("exterior-cleaning");
      }
    }
  });

  it("does the same on the brand route", () => {
    const { go } = simulate(true);
    for (const brand of ["power-maxed", "steel-seal", "power-maxed", "steel-seal"] as const) {
      const frame = go(brandUrl(brand));
      expect(frame.atomic.brandSlug).toBe(brand);
      expect(frame.atomic.brandRoute).toBe(true);
      expect(frame.atomicMismatch).toBe(false);
      if (brand === "steel-seal") {
        expect(flattenCategorySlugs(frame.atomic.categories)).toEqual(["repair-products"]);
      } else {
        expect(flattenCategorySlugs(frame.atomic.categories)).toContain("additives");
      }
    }
  });

  it("preserves q across brand switches without using q for the category tree", () => {
    const { go } = simulate(true);
    const pm = go(productsUrl("power-maxed", { q: "cleaner" }));
    expect(pm.atomic.q).toBe("cleaner");
    expect(flattenCategorySlugs(pm.atomic.categories)).toContain("exterior-cleaning");

    const ss = go(productsUrl("steel-seal", { q: "cleaner" }));
    expect(ss.atomic.q).toBe("cleaner");
    expect(flattenCategorySlugs(ss.atomic.categories)).toEqual(["repair-products"]);
    expect(ss.atomicMismatch).toBe(false);
  });

  it("restores matching trees on Back and Forward", () => {
    const { go, back, forward } = simulate(true);
    go(productsUrl("power-maxed"));
    go(productsUrl("steel-seal"));
    const backToPm = back();
    expect(backToPm.atomic.brandSlug).toBe("power-maxed");
    expect(flattenCategorySlugs(backToPm.atomic.categories)).toContain("exterior-cleaning");
    expect(backToPm.atomicMismatch).toBe(false);
    const forwardToSs = forward();
    expect(forwardToSs.atomic.brandSlug).toBe("steel-seal");
    expect(flattenCategorySlugs(forwardToSs.atomic.categories)).toEqual(["repair-products"]);
    expect(forwardToSs.atomicMismatch).toBe(false);
  });

  it("restores brand-route history the same way", () => {
    const { go, back, forward } = simulate(true);
    go(brandUrl("power-maxed"));
    go(brandUrl("steel-seal"));
    const backToPm = back();
    expect(backToPm.atomic.brandSlug).toBe("power-maxed");
    expect(flattenCategorySlugs(backToPm.atomic.categories)).toContain("exterior-cleaning");
    const forwardToSs = forward();
    expect(forwardToSs.atomic.brandSlug).toBe("steel-seal");
    expect(flattenCategorySlugs(forwardToSs.atomic.categories)).toEqual(["repair-products"]);
  });
});

describe("category preserve / fallback during a brand switch", () => {
  it("keeps a compatible category and immediately shows the destination tree", () => {
    const target = resolveBrandSwitchTarget(
      {
        categorySlug: "exterior-cleaning",
        q: "wax",
        categorySlugsByBrand: slugsByBrand,
      },
      "power-maxed",
    );
    expect(target).toEqual({
      to: "/products/category/$slug",
      params: { slug: "exterior-cleaning" },
      search: { q: "wax", brand: "power-maxed" },
    });
    const { go } = simulate(true);
    const frame = go(productsCategoryUrl("exterior-cleaning", "power-maxed", { q: "wax" }));
    expect(frame.atomic.categorySlug).toBe("exterior-cleaning");
    expect(frame.atomic.q).toBe("wax");
    expect(flattenCategorySlugs(frame.atomic.categories)).toContain("exterior-cleaning");
    expect(frame.atomicMismatch).toBe(false);
  });

  it("falls back to All Products when Steel Seal does not have the selected category", () => {
    expect(
      resolveBrandSwitchTarget(
        {
          categorySlug: "exterior-cleaning",
          q: "cleaner",
          categorySlugsByBrand: slugsByBrand,
        },
        "steel-seal",
      ),
    ).toEqual({
      to: "/products",
      search: { q: "cleaner", brand: "steel-seal" },
    });
    const { go } = simulate(true);
    const frame = go(productsUrl("steel-seal", { q: "cleaner" }));
    expect(frame.atomic.categorySlug).toBeNull();
    expect(flattenCategorySlugs(frame.atomic.categories)).toEqual(["repair-products"]);
  });

  it("wires categorySlugsByBrand onto sidebar context used for those decisions", () => {
    const ctx = catalogueSidebarContext(loaders["power-maxed"]);
    expect(ctx.categorySlugsByBrand).toEqual(slugsByBrand);
    expect(ctx.brandSlug).toBe("power-maxed");
    expect(
      resolveBrandSwitchTarget(ctx, "steel-seal"),
    ).toEqual({ to: "/products", search: { brand: "steel-seal" } });
  });
});

describe("atomic chrome never mixes destination URL with previous loader data", () => {
  it("keeps the previous brand highlighted when only the URL has moved on", () => {
    const stale = appliedCatalogueNav({
      brandSlug: "power-maxed",
      categories: powerMaxedTree,
      categorySlugsByBrand: slugsByBrand,
    });
    expect(stale.brandSlug).toBe("power-maxed");
    expect(activeBrandMismatchesCategoryTree({ ...stale, brandSlug: "steel-seal" })).toBe(true);
    expect(activeBrandMismatchesCategoryTree(stale)).toBe(false);
  });
});
