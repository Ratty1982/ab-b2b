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
