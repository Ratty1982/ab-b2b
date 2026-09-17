import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { LayoutGrid, Rows3, Search } from "lucide-react";
import { PublicLayout, Breadcrumbs } from "@/components/ab/PublicLayout";
import { gbp } from "@/lib/data";
import { cn } from "@/lib/utils";
import { TradePrice } from "@/components/ab/Price";
import { listPublicCatalogueFn } from "@/server/phase2/fns";

export const Route = createFileRoute("/products/")({
  validateSearch: (search: Record<string, unknown>): { brand?: string; category?: string; q?: string; page?: number } => {
    const out: { brand?: string; category?: string; q?: string; page?: number } = {};
    if (typeof search["brand"] === "string") out.brand = search["brand"];
    if (typeof search["category"] === "string") out.category = search["category"];
    if (typeof search["q"] === "string") out.q = search["q"];
    if (typeof search["page"] === "string") out.page = Number(search["page"]);
    return out;
  },
  loader: async ({ location }) => {
    const search = location.search as { brand?: string; category?: string; q?: string; page?: number };
    const result = await listPublicCatalogueFn({
      data: {
        brandSlug: search.brand,
        categorySlug: search.category,
        q: search.q,
        page: search.page,
      },
    });
    if (!result.ok) return { items: [], total: 0, brands: [], categories: [], category: null, page: 1, pageSize: 24, error: result.error };
    return { ...result.data, error: null };
  },
  head: () => ({
    meta: [
      { title: "Trade Product Catalogue — Automotive Brands" },
      { name: "description", content: "Browse the Automotive Brands catalogue. Trade customers sign in to see account pricing." },
    ],
  }),
  component: Catalogue,
});

function Catalogue() {
  const data = Route.useLoaderData();
  const search = Route.useSearch();
  const [view, setView] = useState<"grid" | "compact">("grid");
  const [query, setQuery] = useState(search.q ?? "");

  return (
    <PublicLayout>
      <div className="border-b border-border/60">
        <div className="mx-auto max-w-[1400px] px-4 py-8 sm:px-6 lg:px-10">
          <Breadcrumbs items={[{ label: "Home", to: "/" }, { label: "Products" }]} />
          <div className="mt-4 flex flex-wrap items-end justify-between gap-4">
            <div>
              <h1 className="font-display text-3xl font-semibold uppercase tracking-tight">Trade Catalogue</h1>
              <p className="num mt-1 text-[12px] text-steel">{data.total} active trade-visible lines</p>
            </div>
            <div className="flex items-center gap-1 rounded-md border border-border p-1">
              <button type="button" onClick={() => setView("grid")} className={cn("grid size-9 place-items-center rounded", view === "grid" && "bg-surface")}><LayoutGrid className="size-4" /></button>
              <button type="button" onClick={() => setView("compact")} className={cn("grid size-9 place-items-center rounded", view === "compact" && "bg-surface")}><Rows3 className="size-4" /></button>
            </div>
          </div>
          <form className="mt-6 flex max-w-xl gap-2" method="get">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-steel" />
              <input name="q" value={query} onChange={(e) => setQuery(e.target.value)} className="h-11 w-full rounded-md border border-border bg-ink pl-9 pr-3 text-sm" placeholder="Search products" />
            </div>
            <button type="submit" className="h-11 rounded-md bg-primary px-4 text-[12px] font-bold uppercase text-primary-foreground">Search</button>
          </form>
          {data.error ? <p className="mt-4 text-sm text-bad">{data.error}</p> : null}
        </div>
      </div>
      <div className="mx-auto grid max-w-[1400px] gap-8 px-4 py-8 lg:grid-cols-[220px_minmax(0,1fr)] sm:px-6 lg:px-10">
        <aside className="space-y-6 text-[13px]">
          <div>
            <div className="text-[11px] font-semibold uppercase text-steel">Brands</div>
            <ul className="mt-2 space-y-1">
              {data.brands.map((b) => (
                <li key={b.slug}>
                  <Link to="/products" search={{ brand: b.slug }} className={cn("hover:text-primary", search.brand === b.slug && "font-semibold text-primary")}>{b.name}</Link>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <div className="text-[11px] font-semibold uppercase text-steel">Categories</div>
            <ul className="mt-2 space-y-1">
              {data.categories.map((c) => (
                <li key={c.slug}>
                  <Link to="/products/category/$slug" params={{ slug: c.slug }} className="hover:text-primary">{c.name}</Link>
                </li>
              ))}
            </ul>
          </div>
        </aside>
        <div className={cn(view === "grid" ? "grid gap-4 sm:grid-cols-2 xl:grid-cols-3" : "grid gap-2")}>
          {data.items.length === 0 ? <p className="text-sm text-steel">No live products in this view yet.</p> : null}
          {data.items.map((p) => (
            <Link key={p.id} to="/products/$sku" params={{ sku: p.slug }} className="rounded-lg border border-border bg-surface/40 p-3 transition hover:border-primary/50">
              <div className="aspect-[4/3] overflow-hidden rounded bg-ink">
                {p.imageSrc ? <img src={p.imageSrc} alt="" className="h-full w-full object-cover" /> : null}
              </div>
              <div className="mt-3 font-display text-sm font-semibold uppercase">{p.name}</div>
              <div className="num text-[12px] text-steel">{p.brand} · {p.sku}</div>
              <div className="mt-2">
                <TradePrice trade={p.price.trade ?? 0} rrp={p.price.rrp ?? p.rrp ?? 0} size="sm" ctaMode="text" />
              </div>
            </Link>
          ))}
        </div>
      </div>
    </PublicLayout>
  );
}

void gbp;
