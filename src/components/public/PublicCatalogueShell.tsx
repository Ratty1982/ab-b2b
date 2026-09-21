import { useState, type ReactNode } from "react";
import { LayoutGrid, Rows3, Search, SlidersHorizontal } from "lucide-react";
import { PublicLayout, Breadcrumbs } from "@/components/ab/PublicLayout";
import { CatalogueSidebar, catalogueSearch, type CatalogueContext } from "@/components/public/CatalogueSidebar";
import { ProductResultGrid } from "@/components/public/ProductCard";
import type { PublicCategoryNavNode } from "@/domain/public-catalogue-nav";
import type { PublicProductCard } from "@/server/catalogue/products";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { Link } from "@tanstack/react-router";

export type PublicCatalogueData = {
  items: PublicProductCard[];
  total: number;
  page: number;
  pageSize: number;
  brands: Array<{ slug: string; name: string }>;
  categories: PublicCategoryNavNode[];
  category: { slug: string; name: string } | null;
  error?: string | null;
};

export function PublicCatalogueShell({
  data,
  heading,
  intro,
  breadcrumbs,
  context,
  searchAction,
  leading,
}: {
  data: PublicCatalogueData;
  heading: string;
  intro?: string | undefined;
  breadcrumbs: Array<{ label: string; to?: string | undefined }>;
  context: CatalogueContext;
  searchAction: string;
  leading?: ReactNode;
}) {
  const [view, setView] = useState<"grid" | "list">("grid");
  const [query, setQuery] = useState(context.q ?? "");
  const pageCount = Math.max(1, Math.ceil(data.total / Math.max(1, data.pageSize)));
  const emptyMessage = context.categorySlug
    ? "No products are currently available in this category."
    : "No products match these filters.";

  return (
    <PublicLayout>
      <div className="border-b border-border/60">
        <div className="mx-auto max-w-[1400px] px-4 py-8 sm:px-6 lg:px-10">
          <Breadcrumbs items={breadcrumbs} />
          {leading}
          <div className="mt-4 flex flex-wrap items-end justify-between gap-4">
            <div>
              <h1 className="font-display text-3xl font-semibold uppercase tracking-tight">{heading}</h1>
              <p className="num mt-1 text-[12px] text-steel">
                {data.total.toLocaleString("en-GB")} active trade-visible line{data.total === 1 ? "" : "s"}
              </p>
              {intro ? <p className="mt-2 max-w-2xl text-sm text-steel">{intro}</p> : null}
            </div>
            <div className="flex items-center gap-2">
              <Sheet>
                <SheetTrigger asChild>
                  <button
                    type="button"
                    className="inline-flex h-10 items-center gap-2 rounded-md border border-border px-3 text-[12px] font-semibold uppercase lg:hidden"
                    aria-label="Filters and categories"
                  >
                    <SlidersHorizontal className="size-4" aria-hidden />
                    Filters / Categories
                  </button>
                </SheetTrigger>
                <SheetContent side="left" className="overflow-y-auto bg-ink text-foreground">
                  <SheetHeader>
                    <SheetTitle className="font-display uppercase">Filters / Categories</SheetTitle>
                  </SheetHeader>
                  <div className="mt-6">
                    <CatalogueSidebar brands={data.brands} categories={data.categories} context={context} />
                  </div>
                </SheetContent>
              </Sheet>
              <div className="flex items-center gap-1 rounded-md border border-border p-1" role="group" aria-label="Catalogue layout">
                <button
                  type="button"
                  onClick={() => setView("grid")}
                  aria-pressed={view === "grid"}
                  aria-label="Grid view"
                  className={cn("grid size-9 place-items-center rounded", view === "grid" && "bg-surface")}
                >
                  <LayoutGrid className="size-4" aria-hidden />
                </button>
                <button
                  type="button"
                  onClick={() => setView("list")}
                  aria-pressed={view === "list"}
                  aria-label="List view"
                  className={cn("grid size-9 place-items-center rounded", view === "list" && "bg-surface")}
                >
                  <Rows3 className="size-4" aria-hidden />
                </button>
              </div>
            </div>
          </div>
          <form className="mt-6 flex max-w-xl gap-2" method="get" action={searchAction}>
            {context.brandSlug && !context.brandRoute ? (
              <input type="hidden" name="brand" value={context.brandSlug} />
            ) : null}
            {context.brandRoute && context.categorySlug ? (
              <input type="hidden" name="category" value={context.categorySlug} />
            ) : null}
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-steel" aria-hidden />
              <input
                name="q"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="h-11 w-full rounded-md border border-border bg-ink pl-9 pr-3 text-sm"
                placeholder="Search product, SKU or brand"
                aria-label="Search catalogue"
              />
            </div>
            <button type="submit" className="h-11 rounded-md bg-primary px-4 text-[12px] font-bold uppercase text-primary-foreground">
              Search
            </button>
          </form>
          {data.error ? <p className="mt-4 text-sm text-bad">{data.error}</p> : null}
        </div>
      </div>
      <div className="mx-auto grid max-w-[1400px] gap-8 px-4 py-8 lg:grid-cols-[220px_minmax(0,1fr)] sm:px-6 lg:px-10">
        <aside className="hidden lg:block">
          <CatalogueSidebar brands={data.brands} categories={data.categories} context={context} />
        </aside>
        <div>
          {data.items.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border bg-surface/30 p-8">
              <p className="font-display text-lg font-semibold uppercase">{emptyMessage}</p>
              <p className="mt-2 text-sm text-steel">Use Brands or Categories to continue browsing the live catalogue.</p>
            </div>
          ) : (
            <ProductResultGrid items={data.items} layout={view} />
          )}
          {pageCount > 1 ? (
            <ol className="mt-8 flex flex-wrap gap-2">
              {Array.from({ length: pageCount }, (_, i) => i + 1).map((page) => (
                <li key={page}>
                  <PaginationLink page={page} current={data.page} context={context} />
                </li>
              ))}
            </ol>
          ) : null}
        </div>
      </div>
    </PublicLayout>
  );
}

function PaginationLink({
  page,
  current,
  context,
}: {
  page: number;
  current: number;
  context: CatalogueContext;
}) {
  const search = catalogueSearch(context, { page });
  const className = cn(
    "grid size-9 place-items-center rounded-md border text-[12px] font-semibold",
    page === current ? "border-primary text-primary" : "border-border text-steel hover:border-primary/50",
  );
  if (context.brandRoute && context.brandSlug) {
    return (
      <Link to="/brands/$slug" params={{ slug: context.brandSlug }} search={search} className={className}>
        {page}
      </Link>
    );
  }
  if (context.categorySlug) {
    return (
      <Link to="/products/category/$slug" params={{ slug: context.categorySlug }} search={search} className={className}>
        {page}
      </Link>
    );
  }
  return (
    <Link to="/products" search={search} className={className}>
      {page}
    </Link>
  );
}
