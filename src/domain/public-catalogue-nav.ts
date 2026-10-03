export type PublicCategoryNavNode = {
  slug: string;
  name: string;
  children: PublicCategoryNavNode[];
  productCount: number | null;
};

export type PublicCategoryRow = {
  id: string;
  slug: string;
  name: string;
  parentId: string | null;
  sortOrder: number;
};

function sortRows(a: PublicCategoryRow, b: PublicCategoryRow) {
  if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
  return a.name.localeCompare(b.name);
}

/** Nest active categories. Orphans of missing parents sit at the root. */
export function nestPublicCategories(
  rows: PublicCategoryRow[],
  countsById?: Map<string, number>,
): PublicCategoryNavNode[] {
  const byParent = new Map<string | null, PublicCategoryRow[]>();
  const ids = new Set(rows.map((row) => row.id));
  for (const row of rows) {
    const parentKey = row.parentId && ids.has(row.parentId) ? row.parentId : null;
    const list = byParent.get(parentKey) ?? [];
    list.push(row);
    byParent.set(parentKey, list);
  }
  for (const list of byParent.values()) list.sort(sortRows);

  function walk(parentId: string | null): PublicCategoryNavNode[] {
    return (byParent.get(parentId) ?? []).map((row) => {
      const children = walk(row.id);
      const own = countsById?.get(row.id) ?? 0;
      const rolled = children.reduce((sum, child) => sum + (child.productCount ?? 0), own);
      return {
        slug: row.slug,
        name: row.name,
        children,
        productCount: countsById ? rolled : null,
      };
    });
  }

  return walk(null);
}

export function flattenCategorySlugs(nodes: PublicCategoryNavNode[]): string[] {
  return nodes.flatMap((node) => [node.slug, ...flattenCategorySlugs(node.children)]);
}

/** Selected category plus every descendant — one in-memory walk, no extra queries. */
export function categoryIdsForFilter(rows: PublicCategoryRow[], selectedId: string): string[] {
  const byParent = new Map<string, string[]>();
  for (const row of rows) {
    if (!row.parentId) continue;
    const list = byParent.get(row.parentId) ?? [];
    list.push(row.id);
    byParent.set(row.parentId, list);
  }
  const ids = [selectedId];
  const stack = [...(byParent.get(selectedId) ?? [])];
  while (stack.length) {
    const id = stack.pop()!;
    ids.push(id);
    stack.push(...(byParent.get(id) ?? []));
  }
  return ids;
}

export function findCategoryNode(
  nodes: PublicCategoryNavNode[],
  slug: string,
): PublicCategoryNavNode | null {
  for (const node of nodes) {
    if (node.slug === slug) return node;
    const hit = findCategoryNode(node.children, slug);
    if (hit) return hit;
  }
  return null;
}

/**
 * Drop branches whose rolled public product count is zero.
 * A parent with no own products but descendant products is kept (rolled count > 0).
 */
export function pruneEmptyCategoryBranches(nodes: PublicCategoryNavNode[]): PublicCategoryNavNode[] {
  return nodes.flatMap((node) => {
    const children = pruneEmptyCategoryBranches(node.children);
    if ((node.productCount ?? 0) <= 0 && children.length === 0) return [];
    return [{ ...node, children }];
  });
}

export function categorySlugSet(nodes: PublicCategoryNavNode[]): Set<string> {
  return new Set(flattenCategorySlugs(nodes));
}

export function navContainsCategory(nodes: PublicCategoryNavNode[], slug: string | null | undefined): boolean {
  if (!slug) return true;
  return categorySlugSet(nodes).has(slug);
}

export type CatalogueLinkTarget =
  | { to: "/products"; params?: undefined; search: Record<string, string> }
  | { to: "/products/category/$slug"; params: { slug: string }; search: Record<string, string> }
  | { to: "/brands/$slug"; params: { slug: string }; search: Record<string, string> };

function withQuery(q?: string | undefined): Record<string, string> {
  return q ? { q } : {};
}

/** Whether `categorySlug` has eligible products for `brandSlug` (including descendant rollups). */
export function brandHasCategory(
  categorySlugsByBrand: Record<string, string[]> | undefined,
  brandSlug: string,
  categorySlug: string | null | undefined,
): boolean {
  if (!categorySlug) return true;
  if (!categorySlugsByBrand) return true;
  return categorySlugsByBrand[brandSlug]?.includes(categorySlug) ?? false;
}

/**
 * Brand filter URLs: keep the selected category when the destination brand has
 * products there; otherwise fall back to that brand's All Products.
 */
export function resolveBrandSwitchTarget(
  ctx: {
    brandRoute?: boolean;
    categorySlug?: string | null | undefined;
    q?: string | undefined;
    categorySlugsByBrand?: Record<string, string[]>;
  },
  brandSlug: string,
): CatalogueLinkTarget {
  const search = withQuery(ctx.q);
  const keep = brandHasCategory(ctx.categorySlugsByBrand, brandSlug, ctx.categorySlug);
  if (ctx.brandRoute) {
    return {
      to: "/brands/$slug",
      params: { slug: brandSlug },
      search: { ...search, ...(keep && ctx.categorySlug ? { category: ctx.categorySlug } : {}) },
    };
  }
  if (keep && ctx.categorySlug) {
    return {
      to: "/products/category/$slug",
      params: { slug: ctx.categorySlug },
      search: { ...search, brand: brandSlug },
    };
  }
  return { to: "/products", search: { ...search, brand: brandSlug } };
}

/** All Brands keeps a selected category because it belongs to the global catalogue. */
export function resolveAllBrandsTarget(ctx: {
  categorySlug?: string | null | undefined;
  q?: string | undefined;
}): CatalogueLinkTarget {
  const search = withQuery(ctx.q);
  if (ctx.categorySlug) {
    return {
      to: "/products/category/$slug",
      params: { slug: ctx.categorySlug },
      search,
    };
  }
  return { to: "/products", search };
}
