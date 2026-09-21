import { Link } from "@tanstack/react-router";
import type { PublicCategoryNavNode } from "@/domain/public-catalogue-nav";
import { cn } from "@/lib/utils";

export type CatalogueContext = {
  brandSlug?: string | null | undefined;
  categorySlug?: string | null | undefined;
  q?: string | undefined;
  brandRoute?: boolean;
};

export function catalogueSearch(ctx: CatalogueContext, extra?: { page?: number }) {
  return {
    ...(ctx.q ? { q: ctx.q } : {}),
    ...(ctx.brandRoute
      ? ctx.categorySlug
        ? { category: ctx.categorySlug }
        : {}
      : ctx.brandSlug
        ? { brand: ctx.brandSlug }
        : {}),
    ...(extra?.page && extra.page > 1 ? { page: extra.page } : {}),
  };
}

export function CatalogueSidebar({
  brands,
  categories,
  context,
}: {
  brands: Array<{ slug: string; name: string }>;
  categories: PublicCategoryNavNode[];
  context: CatalogueContext;
}) {
  return (
    <nav aria-label="Catalogue filters" className="space-y-7 text-[13px]">
      <div>
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.16em] text-steel">Brands</h2>
        <ul className="mt-2 space-y-1">
          <li>
            <AllBrandsLink context={context} />
          </li>
          {brands.map((brand) => (
            <li key={brand.slug}>
              <BrandLink brand={brand} context={context} />
            </li>
          ))}
        </ul>
      </div>
      <div>
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.16em] text-steel">Categories</h2>
        <ul className="mt-2 space-y-1">
          <li>
            <AllProductsLink context={context} />
          </li>
          {categories.map((node) => (
            <CategoryBranch key={node.slug} node={node} depth={0} context={context} />
          ))}
        </ul>
      </div>
    </nav>
  );
}

function AllBrandsLink({ context }: { context: CatalogueContext }) {
  const className = cn("block rounded-sm px-1 py-0.5 hover:text-primary", !context.brandSlug && "font-semibold text-primary");
  const current = !context.brandSlug ? ("true" as const) : undefined;
  if (context.categorySlug && !context.brandRoute) {
    return (
      <Link to="/products/category/$slug" params={{ slug: context.categorySlug }} search={context.q ? { q: context.q } : {}} className={className} aria-current={current}>
        All Brands
      </Link>
    );
  }
  return (
    <Link to="/products" search={context.q ? { q: context.q } : {}} className={className} aria-current={current}>
      All Brands
    </Link>
  );
}

function BrandLink({
  brand,
  context,
}: {
  brand: { slug: string; name: string };
  context: CatalogueContext;
}) {
  const active = context.brandSlug === brand.slug;
  const className = cn("block rounded-sm px-1 py-0.5 hover:text-primary", active && "font-semibold text-primary");
  const current = active ? ("page" as const) : undefined;
  const q = context.q ? { q: context.q } : {};
  if (context.brandRoute) {
    return (
      <Link
        to="/brands/$slug"
        params={{ slug: brand.slug }}
        search={{ ...q, ...(context.categorySlug ? { category: context.categorySlug } : {}) }}
        className={className}
        aria-current={current}
      >
        {brand.name}
      </Link>
    );
  }
  if (context.categorySlug) {
    return (
      <Link
        to="/products/category/$slug"
        params={{ slug: context.categorySlug }}
        search={{ ...q, brand: brand.slug }}
        className={className}
        aria-current={current}
      >
        {brand.name}
      </Link>
    );
  }
  return (
    <Link to="/products" search={{ ...q, brand: brand.slug }} className={className} aria-current={current}>
      {brand.name}
    </Link>
  );
}

function AllProductsLink({ context }: { context: CatalogueContext }) {
  const className = cn(
    "block rounded-sm px-1 py-0.5 hover:text-primary",
    !context.categorySlug && "font-semibold text-primary",
  );
  const current = !context.categorySlug ? ("true" as const) : undefined;
  const q = context.q ? { q: context.q } : {};
  if (context.brandRoute && context.brandSlug) {
    return (
      <Link to="/brands/$slug" params={{ slug: context.brandSlug }} search={q} className={className} aria-current={current}>
        All Products
      </Link>
    );
  }
  return (
    <Link
      to="/products"
      search={{ ...q, ...(context.brandSlug ? { brand: context.brandSlug } : {}) }}
      className={className}
      aria-current={current}
    >
      All Products
    </Link>
  );
}

function CategoryBranch({
  node,
  depth,
  context,
}: {
  node: PublicCategoryNavNode;
  depth: number;
  context: CatalogueContext;
}) {
  const active = context.categorySlug === node.slug;
  const ancestor = !active && containsSlug(node, context.categorySlug);
  const className = cn(
    "block rounded-sm py-0.5 hover:text-primary",
    depth > 0 && "pl-3 text-[12px] text-steel",
    (active || ancestor) && "text-primary",
    active && "font-semibold",
  );
  const q = context.q ? { q: context.q } : {};
  return (
    <li>
      {context.brandRoute && context.brandSlug ? (
        <Link
          to="/brands/$slug"
          params={{ slug: context.brandSlug }}
          search={{ ...q, category: node.slug }}
          className={className}
          aria-current={active ? "page" : undefined}
        >
          <CategoryLabel node={node} />
        </Link>
      ) : (
        <Link
          to="/products/category/$slug"
          params={{ slug: node.slug }}
          search={{ ...q, ...(context.brandSlug ? { brand: context.brandSlug } : {}) }}
          className={className}
          aria-current={active ? "page" : undefined}
        >
          <CategoryLabel node={node} />
        </Link>
      )}
      {node.children.length ? (
        <ul className="ml-2 mt-0.5 space-y-0.5 border-l border-border/70">
          {node.children.map((child) => (
            <CategoryBranch key={child.slug} node={child} depth={depth + 1} context={context} />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

function CategoryLabel({ node }: { node: PublicCategoryNavNode }) {
  return (
    <>
      {node.name}
      {node.productCount != null ? (
        <span className="num ml-1 text-[11px] text-steel">({node.productCount})</span>
      ) : null}
    </>
  );
}

function containsSlug(node: PublicCategoryNavNode, slug?: string | null): boolean {
  if (!slug) return false;
  return node.children.some((child) => child.slug === slug || containsSlug(child, slug));
}
